const fs = require('fs');
// R45/R84: services/AIProvider.js is the ONLY place an OpenAI-compatible
// client is constructed. This file used to build its own `new OpenAI()`
// directly off the raw env var AND throw at require-time when
// OPENAI_API_KEY was missing/blank — which would have crashed the whole
// process on `require('./utils/transcribe')` under AI_PROVIDER=groq/gemini
// (OPENAI_API_KEY is intentionally blank in that setup). No current caller
// in this codebase requires this file, but the same bug class already bit
// analysis/audioAnalyzer.js in production, so it's fixed here too rather
// than left as a live bypass waiting for the next caller to hit it.
const { getAIClient, resolveModel } = require('../services/AIProvider');

const openai = getAIClient({ capability: 'audio' });

/**
 * Transcribes audio using Whisper with word-level timestamps.
 * Returns plain text (legacy-compatible).
 */
async function transcribeAudio(filePath) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: resolveModel('whisper-1', 'audio'),
    });

    return transcription.text;
  } catch (error) {
    console.error('❌ Erreur transcription détaillée :', error?.response?.data || error.message);
    throw new Error('Transcription failed');
  }
}

/**
 * Transcribes audio with full word-level timestamps.
 * Used by the Long-Form Intelligence Engine for semantic segmentation.
 *
 * @param {string} filePath - Path to audio/video file
 * @returns {Promise<{
 *   text: string,
 *   language: string,
 *   duration: number,
 *   segments: Array<{
 *     id: number, start: number, end: number, text: string,
 *     words: Array<{ word: string, start: number, end: number, probability: number }>
 *   }>
 * }>}
 */
async function transcribeWithTimestamps(filePath) {
  try {
    console.log(`🎙️ [Transcribe] Starting word-level transcription for: ${filePath}`);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: resolveModel('whisper-1', 'audio'),
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });

    // Normalize segment structure — Whisper may return words at top level or nested per segment
    const segments = (transcription.segments || []).map((seg) => ({
      id: seg.id,
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
      words: (seg.words || []).map((w) => ({
        word: w.word.trim(),
        start: w.start,
        end: w.end,
        probability: w.probability ?? 1.0,
      })),
    }));

    // If Whisper returned words at the top level (some API versions), attach them to segments
    if (transcription.words && transcription.words.length > 0 && segments.length > 0) {
      const allWords = transcription.words.map((w) => ({
        word: w.word.trim(),
        start: w.start,
        end: w.end,
        probability: w.probability ?? 1.0,
      }));

      // Distribute top-level words into their corresponding segments
      segments.forEach((seg) => {
        if (seg.words.length === 0) {
          seg.words = allWords.filter((w) => w.start >= seg.start && w.end <= seg.end + 0.1);
        }
      });
    }

    const result = {
      text: transcription.text,
      language: transcription.language || 'en',
      duration: transcription.duration || 0,
      segments,
    };

    console.log(
      `✅ [Transcribe] Complete. Language: ${result.language}, ` +
      `Segments: ${segments.length}, Words: ${segments.reduce((n, s) => n + s.words.length, 0)}`
    );

    return result;
  } catch (error) {
    console.error('❌ [Transcribe] Word-timestamp transcription failed:', error?.response?.data || error.message);
    throw new Error(`Transcription with timestamps failed: ${error.message}`);
  }
}

module.exports = { transcribeAudio, transcribeWithTimestamps };

