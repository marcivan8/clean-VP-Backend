/**
 * services/spacyClient.js
 * ========================
 * Resilient client for the spaCy NLP microservice.
 *
 * Key fixes over previous version:
 *  1. healthCheck() now feeds failures INTO the circuit breaker, so the
 *     circuit pre-opens at startup on ENOTFOUND — zero per-request failure
 *     logs after the startup warning.
 *  2. FATAL_CODES (ENOTFOUND, EAI_AGAIN) open the circuit immediately,
 *     no threshold — there is no point retrying a DNS failure.
 *  3. Uses axios instead of native fetch for consistent behaviour across
 *     Node versions and clearer error codes.
 *  4. Log deduplication — one warning when the circuit opens, one when it
 *     closes. All other calls are fully silent.
 *  5. SPACY_ENABLED=false env var to permanently skip spaCy (local dev).
 */

const axios = require('axios');
const { analyzePrompt: fallbackPrompt, analyzeTranscript: fallbackTranscript } =
  require('./fallback_analyzer');   // adjust path to your project layout

// ─── Configuration ────────────────────────────────────────────────────────────

const SPACY_BASE_URL =
  process.env.SPACY_SERVICE_URL ||
  'http://spacy-service.railway.internal:8001';

// Set SPACY_ENABLED=false to skip spaCy entirely and always use JS fallback.
// Useful in local dev when you haven't started the spaCy service.
const SPACY_ENABLED = process.env.SPACY_ENABLED !== 'false';

const CONFIG = {
  timeoutMs: 4_000,
  retryDelayMs: 300,
  maxRetries: 1,       // only for transient errors, not DNS failures
  failureThreshold: 3,
  successThreshold: 2,
  resetTimeoutMs: 60_000,  // probe interval when OPEN
};

// DNS-level errors: the host doesn't exist in this network — open immediately.
const FATAL_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL', 'ENOENT']);

// ─── Circuit breaker ─────────────────────────────────────────────────────────

const breaker = {
  state: 'CLOSED',
  failures: 0,
  successes: 0,
  openedAt: null,

  open(reason) {
    if (this.state === 'OPEN') return;   // already open, suppress duplicate log
    this.state = 'OPEN';
    this.openedAt = Date.now();
    console.warn(
      `[spacyClient] ⚡ Circuit OPEN (${reason}) — JS fallback active for all NLP calls.\n` +
      `  Probe interval: ${CONFIG.resetTimeoutMs / 1000}s\n` +
      `  To run spaCy locally: cd spacy-service && uvicorn main:app --port 8001\n` +
      `  Then set env: SPACY_SERVICE_URL=http://localhost:8001\n` +
      `  To disable spaCy entirely: SPACY_ENABLED=false`
    );
  },

  recordSuccess() {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= CONFIG.successThreshold) {
        console.log('[spacyClient] ✅ Circuit CLOSED — spaCy service recovered');
        this.state = 'CLOSED';
        this.successes = 0;
      }
    }
  },

  recordFailure(err) {
    this.successes = 0;
    const code = err?.code || err?.cause?.code || '';

    if (FATAL_CODES.has(code)) {
      // DNS / host-not-found: open immediately, no threshold wait
      this.failures = CONFIG.failureThreshold;
      this.open(code);
      return;
    }

    this.failures++;
    if (this.state === 'CLOSED' && this.failures >= CONFIG.failureThreshold) {
      this.open(`${this.failures} consecutive failures`);
    }
  },

  allow() {
    if (!SPACY_ENABLED) return false;
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= CONFIG.resetTimeoutMs) {
        console.log('[spacyClient] 🔁 Circuit HALF_OPEN — probing spaCy');
        this.state = 'HALF_OPEN';
        this.successes = 0;
        return true;
      }
      return false;   // still OPEN → silent fallback, no log
    }
    return true;       // HALF_OPEN probe
  },
};

// ─── axios instance ───────────────────────────────────────────────────────────

const http = axios.create({
  baseURL: SPACY_BASE_URL,
  timeout: CONFIG.timeoutMs,
  headers: { 'Content-Type': 'application/json' },
});

async function post(path, body) {
  for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      const { data } = await http.post(path, body);
      return data;
    } catch (err) {
      const code = err.code || '';
      if (FATAL_CODES.has(code) || attempt === CONFIG.maxRetries) throw err;
      await new Promise(r => setTimeout(r, CONFIG.retryDelayMs * (attempt + 1)));
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function analyzePrompt(prompt, videoDurationSeconds = null) {
  if (!breaker.allow()) return fallbackPrompt(prompt, videoDurationSeconds);
  try {
    const result = await post('/analyze-prompt', { prompt, video_duration_seconds: videoDurationSeconds });
    breaker.recordSuccess();
    return result;
  } catch (err) {
    breaker.recordFailure(err);
    return fallbackPrompt(prompt, videoDurationSeconds);
  }
}

async function analyzeTranscript(transcript, videoDurationSeconds = null) {
  if (!breaker.allow()) return fallbackTranscript(transcript, videoDurationSeconds);
  try {
    const result = await post('/analyze-transcript', { transcript, video_duration_seconds: videoDurationSeconds });
    breaker.recordSuccess();
    return result;
  } catch (err) {
    breaker.recordFailure(err);
    return fallbackTranscript(transcript, videoDurationSeconds);
  }
}

/**
 * healthCheck()
 * =============
 * Call ONCE at server startup (in app.listen callback or similar).
 * If spaCy is unreachable, pre-opens the circuit so ZERO per-request
 * failure messages are logged before the breaker engages.
 *
 * Example:
 *   app.listen(PORT, async () => {
 *     await spacyClient.healthCheck();
 *     console.log(`Server running on ${PORT}`);
 *   });
 */
async function healthCheck() {
  if (!SPACY_ENABLED) {
    console.log('[spacyClient] ℹ️  SPACY_ENABLED=false — JS fallback always active, spaCy skipped');
    breaker.open('SPACY_ENABLED=false');
    return { spacy: { status: 'disabled' }, circuit: 'OPEN', fallbackActive: true };
  }

  try {
    const { data } = await http.get('/health', { timeout: 3_000 });
    console.log('[spacyClient] ✅ spaCy reachable —', data);
    return { spacy: data, circuit: breaker.state, fallbackActive: false };
  } catch (err) {
    // Feed into circuit breaker → pre-opens on ENOTFOUND
    // All subsequent analyzePrompt/analyzeTranscript calls skip the HTTP attempt silently
    breaker.recordFailure(err);
    return {
      spacy: { status: 'unreachable', code: err.code || 'UNKNOWN' },
      circuit: breaker.state,
      fallbackActive: true,
    };
  }
}

function getStatus() {
  return {
    circuit: breaker.state,
    failures: breaker.failures,
    openedAt: breaker.openedAt,
    spacyUrl: SPACY_ENABLED ? SPACY_BASE_URL : 'disabled',
    fallbackActive: breaker.state !== 'CLOSED' || !SPACY_ENABLED,
  };
}

module.exports = { analyzePrompt, analyzeTranscript, healthCheck, getStatus };