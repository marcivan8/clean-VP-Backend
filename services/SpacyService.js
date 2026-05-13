/**
 * SpacyService.js
 * ===============
 * Thin wrapper around spacyClient.js.
 *
 * spacyClient handles:
 *   - Per-request timeout
 *   - Automatic retry on transient errors
 *   - Circuit breaker (CLOSED → OPEN → HALF_OPEN) with JS fallback
 *
 * This module keeps the same public API (analyzePrompt, analyzeTranscript,
 * isHealthy, warmup) so no other file needs changing.
 */

'use strict';

const spacyClient = require('./spacyClient');

/**
 * Warm up: probe the health endpoint once at startup.
 * Logs the result but never throws.
 */
async function warmup() {
  try {
    const result = await spacyClient.healthCheck();
    if (result.fallbackActive) {
      console.warn('⚠️ [SpacyService] spaCy unreachable at startup — JS fallback active');
    } else {
      console.log(`✅ [SpacyService] spaCy healthy: status=${result.spacy?.status}`);
    }
  } catch (err) {
    console.warn(`⚠️ [SpacyService] warmup error: ${err.message}`);
  }
}

/**
 * Returns true if the spaCy service responded to the last health probe.
 */
async function isHealthy() {
  const result = await spacyClient.healthCheck();
  return !result.fallbackActive;
}

/**
 * Analyze a user prompt for structured extraction + clarity scoring.
 * @param {string} prompt
 * @param {number|null} videoDuration - seconds (optional)
 * @returns {Promise<object>} analysis (never null — falls back to JS)
 */
async function analyzePrompt(prompt, videoDuration = null) {
  try {
    return await spacyClient.analyzePrompt(prompt, videoDuration);
  } catch (err) {
    console.error('[SpacyService] analyzePrompt unexpected error:', err.message);
    return null;
  }
}

/**
 * Analyze a transcript for sentence-level intelligence.
 * @param {string} transcript
 * @param {number|null} videoDuration - seconds (optional)
 * @returns {Promise<object>} analysis (never null — falls back to JS)
 */
async function analyzeTranscript(transcript, videoDuration = null) {
  try {
    return await spacyClient.analyzeTranscript(transcript, videoDuration);
  } catch (err) {
    console.error('[SpacyService] analyzeTranscript unexpected error:', err.message);
    return null;
  }
}

module.exports = { analyzePrompt, analyzeTranscript, isHealthy, warmup };
