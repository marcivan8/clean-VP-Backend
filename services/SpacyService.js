/**
 * SpacyService.js
 * ===============
 * HTTP client for the Python spaCy NLP microservice.
 * Provides prompt analysis and transcript analysis with graceful fallback.
 */

const SPACY_BASE_URL = process.env.SPACY_SERVICE_URL || 'http://localhost:8001';
const SPACY_TIMEOUT = parseInt(process.env.SPACY_TIMEOUT || '5000', 10);

/**
 * Call the spaCy service with graceful fallback.
 * Returns null if the service is unreachable.
 */
async function _callSpacy(endpoint, body) {
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
        if (err.name === 'AbortError') {
            console.warn(`⚠️ [SpacyService] ${endpoint} timed out after ${SPACY_TIMEOUT}ms`);
        } else {
            console.warn(`⚠️ [SpacyService] ${endpoint} unreachable: ${err.message}`);
        }
        return null;
    }
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
 * Check if the spaCy service is healthy.
 * @returns {boolean}
 */
async function isHealthy() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(`${SPACY_BASE_URL}/health`, {
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return response.ok;
    } catch {
        return false;
    }
}

module.exports = {
    analyzePrompt,
    analyzeTranscript,
    isHealthy,
};
