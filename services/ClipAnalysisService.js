// services/ClipAnalysisService.js
//
// Node.js client for the /classify-clips endpoint in the diarize-service
// Python container.  Reuses the same DIARIZE_SERVICE_URL so no new Railway
// service or env variable is needed — the Python container now hosts both
// /diarize (WhisperX) and /classify-clips (CLIP + MediaPipe + sentence-transformers).
//
// IMPORTANT — filesystem isolation:
// Exactly like DiarizeService, Node and Python run in separate Railway containers.
// We therefore send base64-encoded JPEG frames (not file paths) to the Python
// service.  Frame extraction is handled by the Node /organize-clips route
// before calling this client.
//
// Usage:
//   const ClipAnalysisService = require('./ClipAnalysisService');
//   if (ClipAnalysisService.isAvailable) {
//     const meta = await ClipAnalysisService.classifyClips([
//       { id: 'c1', frames: ['<b64>', '<b64>', '<b64>'], transcript: 'Hey everyone...', duration: 45.2 },
//     ]);
//     // meta.clips → Array<ClipMeta>
//   }

const axios = require('axios');

const BASE_URL   = process.env.DIARIZE_SERVICE_URL || null;
const TIMEOUT_MS = parseInt(process.env.CLIP_ANALYSIS_TIMEOUT_MS || '90000', 10); // 90 s

class ClipAnalysisServiceClass {
    constructor() {
        if (!BASE_URL) {
            console.warn('[ClipAnalysisService] DIARIZE_SERVICE_URL not set — ML clip classification disabled');
        }
    }

    /** True when the Python service URL is configured. */
    get isAvailable() {
        return Boolean(BASE_URL);
    }

    /**
     * Run CLIP + MediaPipe + sentence-transformers on a batch of clips.
     *
     * @param {Array<{
     *   id:          string,
     *   frames:      string[],   // base64-encoded JPEG frames (2–4 recommended)
     *   transcript?: string,     // Whisper text for this clip (optional but improves clustering)
     *   duration?:   number,     // seconds (used for energy heuristics)
     * }>} clips
     *
     * @returns {Promise<{
     *   clips: Array<{
     *     id:                   string,
     *     clip_type:            string,   // e.g. "talking_head_medium"
     *     clip_type_confidence: number,   // 0–1
     *     has_face:             boolean,
     *     face_count:           number,
     *     face_size:            string,   // "none" | "small" | "medium" | "large"
     *     energy:               string,   // "high" | "medium" | "low" | "neutral"
     *     topic_cluster:        number,
     *     top_types:            Record<string, number>,
     *     duration:             number,
     *   }>,
     *   num_topic_clusters: number,
     * }>}
     */
    async classifyClips(clips) {
        if (!this.isAvailable) {
            throw new Error('ClipAnalysisService: DIARIZE_SERVICE_URL not configured');
        }

        const totalFrames = clips.reduce((s, c) => s + (c.frames?.length ?? 0), 0);
        console.log(
            `[ClipAnalysisService] POST /classify-clips — ${clips.length} clips, ${totalFrames} total frames`
        );

        const response = await axios.post(
            `${BASE_URL}/classify-clips`,
            { clips },
            {
                timeout:          TIMEOUT_MS,
                headers:          { 'Content-Type': 'application/json' },
                // Frames are large base64 blobs — allow big payloads
                maxContentLength: Infinity,
                maxBodyLength:    Infinity,
            },
        );

        const { clips: resultClips = [], num_topic_clusters = 1 } = response.data;

        console.log(
            `[ClipAnalysisService] Done — ${resultClips.length} clip(s) classified, ` +
            `${num_topic_clusters} topic cluster(s)`
        );

        return { clips: resultClips, num_topic_clusters };
    }

    /**
     * Health-check the Python service.
     * Returns true if it is up and responding.
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

module.exports = new ClipAnalysisServiceClass();
