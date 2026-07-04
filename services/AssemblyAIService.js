'use strict';

/**
 * AssemblyAIService.js
 *
 * Primary diarization provider. Uses AssemblyAI's hosted API:
 *   - No GPU required, no HuggingFace gated models
 *   - Handles upload + transcription + diarization in one call
 *   - ~$0.005–0.015 / minute of audio
 *
 * Requires:  ASSEMBLYAI_API_KEY environment variable
 * npm dep:   assemblyai  (official SDK)
 *
 * Returns the same { words, speakers, language } shape as DiarizeService
 * so audioProcessor.js can use either interchangeably.
 */

const API_KEY = process.env.ASSEMBLYAI_API_KEY;

/** True when the service is usable (key is set). */
const isAvailable = Boolean(API_KEY);

/**
 * Convert AssemblyAI speaker label ("A", "B", …) to the SPEAKER_XX format
 * used by the rest of the system.
 *
 * "A" → "SPEAKER_00"
 * "B" → "SPEAKER_01"
 * etc.
 */
function normalizeSpeaker(label) {
    if (!label) return null;
    const idx = label.charCodeAt(0) - 65; // 'A' = 0, 'B' = 1, …
    return `SPEAKER_${String(Math.max(0, idx)).padStart(2, '0')}`;
}

/**
 * Transcribe an audio/video file with speaker diarization.
 *
 * @param {string} filePath  - Absolute local path to the audio/video file.
 *                             AssemblyAI SDK handles upload internally.
 * @param {string|null} language - BCP-47 language code (e.g. "en") or null for auto-detect.
 * @returns {{ words: Array, speakers: string[], language: string }}
 */
async function diarize(filePath, language = null) {
    if (!isAvailable) {
        throw new Error('ASSEMBLYAI_API_KEY is not set — AssemblyAI diarization unavailable');
    }

    let AssemblyAI;
    try {
        // Lazy require so the rest of the app still boots if the package is absent
        ({ AssemblyAI } = require('assemblyai'));
    } catch (e) {
        throw new Error(
            'assemblyai npm package not installed — run: npm install assemblyai'
        );
    }

    const client = new AssemblyAI({ apiKey: API_KEY });

    console.log(`[AssemblyAI] Submitting ${filePath} for diarization…`);

    const params = {
        audio: filePath,          // SDK auto-uploads local files
        speaker_labels: true,
    };

    // AssemblyAI uses "language_code" (BCP-47). Pass through if supplied;
    // otherwise omit so AssemblyAI auto-detects the language.
    if (language) {
        params.language_code = language;
    }

    // transcripts.transcribe() uploads, submits, and polls until done.
    // Typical turnaround: 0.2–0.5× real-time on their infrastructure.
    const transcript = await client.transcripts.transcribe(params);

    if (transcript.status === 'error') {
        throw new Error(`AssemblyAI transcription failed: ${transcript.error}`);
    }

    if (!transcript.words || transcript.words.length === 0) {
        console.warn('[AssemblyAI] Transcript returned 0 words — audio may be silent or unsupported format');
        return { words: [], speakers: [], language: transcript.language_code || language || 'en' };
    }

    // AssemblyAI timestamps are in milliseconds; our system uses seconds.
    const words = transcript.words.map(w => ({
        word:    w.text,
        start:   w.start / 1000,
        end:     w.end / 1000,
        speaker: normalizeSpeaker(w.speaker),
    }));

    // Deduplicate and sort speaker list
    const speakerSet = new Set(words.map(w => w.speaker).filter(Boolean));
    const speakers = [...speakerSet].sort();

    const detectedLanguage = transcript.language_code || language || 'en';

    console.log(
        `[AssemblyAI] Done — ${words.length} words, ${speakers.length} speaker(s): ${speakers.join(', ')}, lang: ${detectedLanguage}`
    );

    return { words, speakers, language: detectedLanguage };
}

module.exports = { isAvailable, diarize };
