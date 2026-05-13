/**
 * routes/nlp.js  (Express router)
 * ================================
 * Exposes the NLP microservice to the frontend through authenticated
 * backend routes.  All calls go through spacyClient which has a built-in
 * circuit breaker and JS fallback — so these routes NEVER return 503 just
 * because the spaCy Railway service is temporarily unreachable.
 *
 * Mounted in index.js:
 *   app.use('/api/nlp', authenticateUser, nlpRoutes);
 */

'use strict';

const express = require('express');
const router  = express.Router();

const { analyzePrompt, analyzeTranscript, healthCheck } = require('../services/spacyClient');

// ─── Validation helpers ───────────────────────────────────────────────────────

function requireString(val, name, res) {
  if (typeof val !== 'string' || val.trim().length === 0) {
    res.status(400).json({ error: `"${name}" must be a non-empty string` });
    return false;
  }
  return true;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/nlp/health
 * Returns spaCy service health + circuit breaker state.
 * No auth required — safe to expose for monitoring.
 */
router.get('/health', async (_req, res) => {
  try {
    const status = await healthCheck();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/nlp/analyze-prompt
 * Body: { prompt: string, video_duration_seconds?: number }
 *
 * Returns structured prompt analysis (action, platform, content_type,
 * clarity_score, needs_clarification, clarification_questions, …).
 * Falls back to JS analyzer if spaCy is down — never returns 503.
 */
router.post('/analyze-prompt', async (req, res) => {
  const { prompt, video_duration_seconds } = req.body;
  if (!requireString(prompt, 'prompt', res)) return;

  try {
    const result = await analyzePrompt(
      prompt.trim(),
      typeof video_duration_seconds === 'number' ? video_duration_seconds : null
    );
    res.json(result);
  } catch (err) {
    console.error('[nlp route] analyze-prompt error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/nlp/analyze-transcript
 * Body: { transcript: string, video_duration_seconds?: number }
 *
 * Returns per-sentence intelligence (emotion_score, is_question, is_cta,
 * entities, highlight_score).
 * Falls back to JS analyzer if spaCy is down — never returns 503.
 */
router.post('/analyze-transcript', async (req, res) => {
  const { transcript, video_duration_seconds } = req.body;
  if (!requireString(transcript, 'transcript', res)) return;

  if (transcript.length > 500_000) {
    return res.status(413).json({
      error: 'Transcript too large. Split into chunks of ≤500 000 characters.',
    });
  }

  try {
    const result = await analyzeTranscript(
      transcript.trim(),
      typeof video_duration_seconds === 'number' ? video_duration_seconds : null
    );
    res.json(result);
  } catch (err) {
    console.error('[nlp route] analyze-transcript error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
