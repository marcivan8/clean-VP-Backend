/**
 * spacyClient.js
 * ==============
 * Resilient HTTP client for the spaCy NLP microservice.
 *
 * Problems solved:
 *  1. "Unreachable at http://spacy-service.railway.internal:8001 — skipping"
 *     → Circuit breaker opens after N failures and auto-falls back to the
 *       pure-JS fallback_analyzer so features keep working.
 *  2. No timeout was set, causing requests to hang for 30 s+ on cold starts.
 *  3. No retry — a single transient blip killed the whole request.
 *
 * Circuit breaker states:
 *   CLOSED    → normal operation, all requests go to spaCy
 *   OPEN      → spaCy is down, all requests use JS fallback immediately
 *   HALF_OPEN → probe request sent; if it succeeds the breaker resets to CLOSED
 */

'use strict';

const { analyzePrompt: fallbackPrompt, analyzeTranscript: fallbackTranscript } =
  require('./fallback_analyzer');

// ─── Configuration ────────────────────────────────────────────────────────────

const SPACY_BASE_URL =
  process.env.SPACY_SERVICE_URL ||
  'http://spacy-service.railway.internal:8001';

const CONFIG = {
  timeoutMs:        4_000,   // per-request timeout
  maxRetries:       1,       // retries before counting as a failure
  failureThreshold: 3,       // failures before opening circuit
  successThreshold: 2,       // successes in HALF_OPEN before closing circuit
  resetTimeoutMs:   30_000,  // wait before probing from OPEN
};

// ─── Circuit breaker state ────────────────────────────────────────────────────

const breaker = {
  state:    'CLOSED',   // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  failures:  0,
  successes: 0,
  openedAt:  null,

  recordSuccess() {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= CONFIG.successThreshold) {
        console.log('[spacyClient] ✅ Circuit CLOSED — spaCy service recovered');
        this.state    = 'CLOSED';
        this.successes = 0;
      }
    }
  },

  recordFailure() {
    this.successes = 0;
    this.failures++;
    if (this.state === 'CLOSED' && this.failures >= CONFIG.failureThreshold) {
      console.warn(
        `[spacyClient] ⚡ Circuit OPEN after ${this.failures} failures — ` +
        `switching to JS fallback for ${CONFIG.resetTimeoutMs / 1000}s`
      );
      this.state    = 'OPEN';
      this.openedAt = Date.now();
    }
  },

  /** Returns true when a request is allowed through to spaCy. */
  allow() {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= CONFIG.resetTimeoutMs) {
        console.log('[spacyClient] 🔁 Circuit HALF_OPEN — probing spaCy');
        this.state    = 'HALF_OPEN';
        this.successes = 0;
        return true;   // let one request through as a probe
      }
      return false;    // still open, use fallback
    }
    // HALF_OPEN: allow probe requests
    return true;
  },
};

// ─── Low-level fetch with timeout + retry ────────────────────────────────────

async function fetchWithRetry(url, body, retries = CONFIG.maxRetries) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      return await res.json();

    } catch (err) {
      clearTimeout(timer);
      const isLast = attempt === retries;
      if (!isLast) {
        // brief back-off between retries
        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * analyzePrompt
 * Calls POST /analyze-prompt on the spaCy service, falls back to JS if down.
 *
 * @param {string}      prompt
 * @param {number|null} videoDurationSeconds
 * @returns {Promise<object>} Structured prompt analysis
 */
async function analyzePrompt(prompt, videoDurationSeconds = null) {
  if (!breaker.allow()) {
    return fallbackPrompt(prompt, videoDurationSeconds);
  }

  try {
    const result = await fetchWithRetry(`${SPACY_BASE_URL}/analyze-prompt`, {
      prompt,
      video_duration_seconds: videoDurationSeconds,
    });

    breaker.recordSuccess();
    return result;

  } catch (err) {
    breaker.recordFailure();
    console.warn(`[spacyClient] analyzePrompt failed (${err.message}), using JS fallback`);
    return fallbackPrompt(prompt, videoDurationSeconds);
  }
}

/**
 * analyzeTranscript
 * Calls POST /analyze-transcript on the spaCy service, falls back to JS if down.
 *
 * @param {string}      transcript
 * @param {number|null} videoDurationSeconds
 * @returns {Promise<object>} Per-sentence transcript intelligence
 */
async function analyzeTranscript(transcript, videoDurationSeconds = null) {
  if (!breaker.allow()) {
    return fallbackTranscript(transcript, videoDurationSeconds);
  }

  try {
    const result = await fetchWithRetry(`${SPACY_BASE_URL}/analyze-transcript`, {
      transcript,
      video_duration_seconds: videoDurationSeconds,
    });

    breaker.recordSuccess();
    return result;

  } catch (err) {
    breaker.recordFailure();
    console.warn(`[spacyClient] analyzeTranscript failed (${err.message}), using JS fallback`);
    return fallbackTranscript(transcript, videoDurationSeconds);
  }
}

/**
 * healthCheck
 * Returns live status of the spaCy service + current circuit breaker state.
 * Safe to expose on GET /api/nlp/health.
 */
async function healthCheck() {
  const circuitState = {
    state:    breaker.state,
    failures: breaker.failures,
    openedAt: breaker.openedAt,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    const res = await fetch(`${SPACY_BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    return { spacy: data, circuit: circuitState, fallbackActive: false };
  } catch {
    return {
      spacy:         { status: 'unreachable' },
      circuit:       circuitState,
      fallbackActive: true,
    };
  }
}

module.exports = { analyzePrompt, analyzeTranscript, healthCheck };
