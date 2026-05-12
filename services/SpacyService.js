/**
 * SpacyService.js
 * ===============
 * HTTP client for the Python spaCy NLP microservice.
 * Provides prompt analysis and transcript analysis with graceful fallback.
 *
 * FAST-PATH: A health check is run once on the first call (or explicitly via
 * warmup()). If the service is down, _available is set to false and all
 * subsequent calls skip the network round-trip entirely, returning null
 * immediately so the Claude fallback path is taken without latency penalty.
 *
 * The availability flag is re-tested every RECHECK_INTERVAL_MS so the
 * service can come back online without a server restart.
 */

const SPACY_BASE_URL = process.env.SPACY_SERVICE_URL || 'http://localhost:8001';
const SPACY_TIMEOUT = parseInt(process.env.SPACY_TIMEOUT || '5000', 10);
const RECHECK_INTERVAL_MS = 60_000; // re-probe every 60 s

/** Tri-state: null = not yet checked, true = up, false = down */
let _available = null;
let _lastCheck = 0;

/**
 * Internal: probe the /health endpoint.
 * Sets _available and _lastCheck; never throws.
 */
async function _probe() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(`${SPACY_BASE_URL}/health`, {
            signal: controller.signal,
        });
        clearTimeout(timeout);
        _available = response.ok;
    } catch {
        _available = false;
    }
    _lastCheck = Date.now();
    if (!_available) {
        console.warn(`⚠️ [SpacyService] Service unreachable at ${SPACY_BASE_URL} — skipping on all requests until it recovers.`);
    } else {
        console.log(`✅ [SpacyService] Service is healthy at ${SPACY_BASE_URL}`);
    }
}

/**
 * Returns true if the service is (currently) available.
 * Runs the probe lazily on first call; re-probes after RECHECK_INTERVAL_MS.
 */
async function _isAvailable() {
    const now = Date.now();
    if (_available === null || now - _lastCheck > RECHECK_INTERVAL_MS) {
        await _probe();
    }
    return _available;
}

/**
 * Call the spaCy service with graceful fallback.
 * Returns null if the service is unreachable (fast-path or network error).
 */
async function _callSpacy(endpoint, body) {
    if (!(await _isAvailable())) return null;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SPACY_TIMEOUT);

        const response = await fetch(`${SPACY_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
            console.warn(`⚠️ [SpacyService] ${endpoint} returned ${response.status}`);
            return null;
        }

        return await response.json();
    } catch (err) {
        // Mark as unavailable so the next call is also a fast-path skip,
        // then schedule a re-probe after the normal interval.
        _available = false;
        _lastCheck = Date.now();
        if (err.name === 'AbortError') {
            console.warn(`⚠️ [SpacyService] ${endpoint} timed out after ${SPACY_TIMEOUT}ms — disabling until next health check.`);
        } else {
            console.warn(`⚠️ [SpacyService] ${endpoint} failed: ${err.message} — disabling until next health check.`);
        }
        return null;
    }
}

/**
 * Warm up the health check eagerly (call from server startup).
 * Safe to call multiple times — subsequent calls are no-ops until
 * RECHECK_INTERVAL_MS has elapsed.
 */
async function warmup() {
    await _isAvailable();
}

/**
 * Analyze a user prompt for structured extraction + clarity scoring.
 * @param {string} prompt - The user's natural language prompt.
 * @param {number|null} videoDuration - Video duration in seconds (optional).
 * @returns {object|null} Analysis result or null if service unavailable.
 */
async function analyzePrompt(prompt, videoDuration = null) {
    console.log('🔬 [SpacyService] Analyzing prompt...');
    const result = await _callSpacy('/analyze-prompt', {
        prompt,
        video_duration_seconds: videoDuration,
    });
    if (result) {
        console.log(`🔬 [SpacyService] Clarity: ${result.clarity_score}, Needs clarification: ${result.needs_clarification}`);
    }
    return result;
}

/**
 * Analyze a transcript for sentence-level intelligence.
 * @param {string} transcript - Full transcript text.
 * @param {number|null} videoDuration - Video duration in seconds (optional).
 * @returns {object|null} Analysis result or null if service unavailable.
 */
async function analyzeTranscript(transcript, videoDuration = null) {
    console.log('🔬 [SpacyService] Analyzing transcript...');
    return await _callSpacy('/analyze-transcript', {
        transcript,
        video_duration_seconds: videoDuration,
    });
}

/**
 * Check if the spaCy service is healthy (cached result).
 * @returns {boolean}
 */
async function isHealthy() {
    return await _isAvailable();
}

module.exports = {
    analyzePrompt,
    analyzeTranscript,
    isHealthy,
    warmup,
};
