// services/DiarizeService.js
// Node.js client for the WhisperX diarization microservice.
//
// Set DIARIZE_SERVICE_URL in Railway's Variables dashboard to the URL of the
// deployed diarize-service container (e.g. https://diarize.up.railway.app).
// Leave it unset to disable speaker diarization gracefully — the transcription
// pipeline still runs via OpenAI Whisper, just without speaker labels.

const axios = require('axios');

const BASE_URL   = process.env.DIARIZE_SERVICE_URL || null;
const TIMEOUT_MS = parseInt(process.env.DIARIZE_TIMEOUT_MS || '600000', 10); // 10 min default

class DiarizeServiceClass {
    constructor() {
        if (!BASE_URL) {
            console.warn('[DiarizeService] DIARIZE_SERVICE_URL not set — speaker diarization disabled');
        }
    }

    get isAvailable() {
        return Boolean(BASE_URL);
    }

    /**
     * Run WhisperX transcription + pyannote diarization on a local audio file.
     *
     * @param {string} filePath  - Absolute path to the audio/video file on the
     *                             server filesystem (already downloaded from GCS).
     * @param {string} [language] - ISO-639-1 language code, e.g. "en". Omit for auto-detect.
     * @returns {Promise<{
     *   words:    Array<{ word: string, start: number, end: number, speaker: string|null }>,
     *   speakers: string[],
     *   language: string,
     * }>}
     */
    async diarize(filePath, language = null) {
        if (!this.isAvailable) {
            throw new Error('Diarization service is not configured (DIARIZE_SERVICE_URL not set)');
        }

        console.log(`[DiarizeService] POST /diarize  filePath=${filePath}`);

        const body = { filePath };
        if (language) body.language = language;

        const response = await axios.post(`${BASE_URL}/diarize`, body, {
            timeout: TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' },
        });

        const { words, speakers, language: detectedLang } = response.data;
        console.log(
            `[DiarizeService] Done — ${words.length} words, ` +
            `${speakers.length} speaker(s): ${speakers.join(', ')}, lang=${detectedLang}`
        );

        return { words, speakers, language: detectedLang };
    }

    /**
     * Health-check the Python service.
     * Returns true if the service is up and responding.
     */
    async ping() {
        if (!BASE_URL) return false;
        try {
            const res = await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
            return res.data?.ok === true;
        } catch {
            return false;
        }
    }
}

module.exports = new DiarizeServiceClass();
