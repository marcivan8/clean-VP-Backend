// services/DiarizeService.js
// Node.js client for the WhisperX diarization microservice.
//
// IMPORTANT — filesystem isolation:
// In Railway production the Node server and the Python diarize container run
// in SEPARATE containers with NO shared filesystem. We therefore always stream
// the audio file as multipart/form-data rather than sending a local path.
// The Python service saves it to a temp file, processes it, and deletes it.
//
// Backward compat: if DIARIZE_SERVICE_URL is unset the class is a no-op and
// isAvailable returns false — the transcription pipeline still runs via Whisper.

const axios      = require('axios');
const fs         = require('fs');
const path       = require('path');
const FormData   = require('form-data');

const TIMEOUT_MS = parseInt(process.env.DIARIZE_TIMEOUT_MS || '600000', 10); // 10 min

// Normalize the service URL — Railway internal hostnames are often set without
// a scheme (e.g. "my-service.railway.internal:5000"). Prepend http:// when
// missing so axios doesn't throw "Invalid URL" before the request is made.
function normalizeServiceUrl(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, '');
    console.warn(`[DiarizeService] DIARIZE_SERVICE_URL has no scheme — prepending http:// to "${trimmed}"`);
    return `http://${trimmed}`.replace(/\/$/, '');
}

const BASE_URL = normalizeServiceUrl(process.env.DIARIZE_SERVICE_URL);

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
     * Run WhisperX transcription + pyannote diarization on an audio file.
     *
     * The file is STREAMED to the Python service via multipart/form-data so
     * this works even when the two services run in separate Railway containers.
     *
     * @param {string} filePath   — Absolute path to the WAV/MP4 on THIS server.
     * @param {string} [language] — ISO-639-1 code, e.g. "en". Omit for auto-detect.
     * @returns {Promise<{
     *   words:    Array<{ word, start, end, speaker }>,
     *   speakers: string[],
     *   language: string,
     * }>}
     */
    async diarize(filePath, language = null) {
        if (!this.isAvailable) {
            throw new Error('Diarization service is not configured (DIARIZE_SERVICE_URL not set)');
        }

        if (!fs.existsSync(filePath)) {
            throw new Error(`[DiarizeService] File not found: ${filePath}`);
        }

        const form = new FormData();
        form.append('audio', fs.createReadStream(filePath), {
            filename:    path.basename(filePath),
            contentType: 'audio/wav',
        });
        if (language) form.append('language', language);

        const fileSize = fs.statSync(filePath).size;
        console.log(
            `[DiarizeService] POST /diarize (multipart) ` +
            `file=${path.basename(filePath)} size=${(fileSize / 1024 / 1024).toFixed(1)} MB` +
            (language ? ` lang=${language}` : '')
        );

        const response = await axios.post(`${BASE_URL}/diarize`, form, {
            timeout:          TIMEOUT_MS,
            headers:          form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength:    Infinity,
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
