// services/DiarizeService.js
// Node.js client for the WhisperX diarization microservice.
//
// Set DIARIZE_SERVICE_URL in Railway's Variables dashboard to the URL of the
// deployed diarize-service container (e.g. https://diarize.up.railway.app).
// Leave it unset to disable speaker diarization gracefully — the transcription
// pipeline still runs via OpenAI Whisper, just without speaker labels.

const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const FormData = require('form-data');

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
     * @param {string} filePath      - Absolute path to the audio/video file on the
     *                                 server filesystem (already downloaded from GCS).
     * @param {string} [language]    - ISO-639-1 language code, e.g. "en". Omit for auto-detect.
     * @param {object} [opts]
     * @param {number} [opts.minSpeakers=2] - Minimum number of speakers to detect.
     *   Setting this to 2 dramatically improves accuracy for interview/podcast content
     *   because pyannote won't collapse two distinct speakers into one.
     * @param {number} [opts.maxSpeakers=10] - Maximum number of speakers to detect.
     * @returns {Promise<{
     *   words:           Array<{ word: string, start: number, end: number, speaker: string|null }>,
     *   speakers:        string[],
     *   language:        string,
     *   diarizationRan:  boolean,   // false when HF_TOKEN not set on the Python service
     * }>}
     */
    async diarize(filePath, language = null, { minSpeakers = 2, maxSpeakers = 10 } = {}) {
        if (!this.isAvailable) {
            throw new Error('Diarization service is not configured (DIARIZE_SERVICE_URL not set)');
        }

        console.log(`[DiarizeService] POST /diarize  filePath=${filePath}  minSpeakers=${minSpeakers}  maxSpeakers=${maxSpeakers}`);

        // Upload the WAV file as multipart so the diarize container doesn't
        // need access to this container's filesystem (required on Railway).
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath), {
            filename: path.basename(filePath),
            contentType: 'audio/wav',
        });
        if (language) form.append('language', language);
        form.append('min_speakers', String(minSpeakers));
        form.append('max_speakers', String(maxSpeakers));

        // Retry up to 3 times on 502/503 — the Python container may be
        // momentarily restarting after an OOM kill.
        let response;
        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                response = await axios.post(`${BASE_URL}/diarize`, form, {
                    timeout: TIMEOUT_MS,
                    headers: form.getHeaders(),
                });
                break; // success
            } catch (err) {
                const status = err.response?.status;
                if ((status === 502 || status === 503) && attempt < MAX_RETRIES) {
                    const delayMs = attempt * 15_000; // 15s, 30s
                    console.warn(`[DiarizeService] ${status} on attempt ${attempt}/${MAX_RETRIES} — retrying in ${delayMs / 1000}s`);
                    await new Promise(r => setTimeout(r, delayMs));
                    continue;
                }
                throw err; // non-retryable or exhausted retries
            }
        }

        const { words, speakers, language: detectedLang, diarization_ran: diarizationRan } = response.data;

        if (!diarizationRan) {
            console.warn(
                `[DiarizeService] ⚠️  Diarization did NOT run on the Python service — all speaker fields will be null. ` +
                `This usually means HF_TOKEN is not set in the diarize-service container. ` +
                `Set HF_TOKEN in Railway Variables and redeploy diarize-service. ` +
                `Also ensure you have accepted the pyannote model terms at ` +
                `https://huggingface.co/pyannote/speaker-diarization-3.1`
            );
        } else {
            console.log(
                `[DiarizeService] Done — ${words.length} words, ` +
                `${speakers.length} speaker(s): ${speakers.join(', ')}, lang=${detectedLang}`
            );
        }

        return { words, speakers, language: detectedLang, diarizationRan: Boolean(diarizationRan) };
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
