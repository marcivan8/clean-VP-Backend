const fs = require('fs');
const { OpenAI } = require('openai');

const apiKey = process.env.OPENAI_API_KEY;

// Check if API key is loaded correctly
if (!apiKey || apiKey.startsWith('=')) {
  console.error('❌ Clé API invalide ou non définie. Vérifiez votre fichier .env');
  throw new Error('Invalid or missing OpenAI API key');
}

const openai = new OpenAI({
  apiKey: apiKey,
});

/**
 * Transcribes audio using Whisper with word-level timestamps.
 * Returns plain text (legacy-compatible).
 */
async function transcribeAudio(filePath) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
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
      model: 'whisper-1',
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

