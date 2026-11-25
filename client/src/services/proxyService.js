import { fetchWithRateLimitRetry } from '../utils/retryOn429.js';
import { API_URL } from '../config';
import { pollJobResult } from '../utils/jobPoller.js';
import { supabase } from '../lib/supabaseClient';

// Proxy generation now runs at videoWorker concurrency:1 (see worker.js / CLAUDE.md
// R24) so a multi-file upload legitimately queues jobs behind each other — the
// generic 300s job-poller default is too tight for e.g. the 4th/5th clip in a
// 5-file batch. IDELayout already falls back to the raw upload on timeout, so
// extending this budget only reduces false "proxy failed" fallbacks; it doesn't
// change what happens once a job genuinely never finishes.
const BASE_PROXY_POLL_TIMEOUT_MS = 900_000; // 15 min — covers typical 1080p/short clips

// A flat 15-min budget was tuned against everyday clips, not long-form 4K
// (see CLAUDE.md R36). A 48-min 4K interview is realistically 10-25GB, and the
// full pipeline for that (client→GCS resumable upload, worker re-downloading
// the same bytes back down because raw uploads need random-access to handle a
// trailing moov atom — R7/R25/R34 — then the actual encode) scales with file
// size, not just duration. Scale the poll budget by size instead of assuming
// everything fits in 15 minutes: +2 min per GB beyond the first 3GB, capped at
// 60 min so a genuinely stuck/dead job still gives up and falls back to raw
// playback (see the .catch() in IDELayout.jsx) in bounded time.
const PROXY_TIMEOUT_FREE_GB = 3;
const PROXY_TIMEOUT_PER_GB_MS = 120_000; // 2 min/GB
const MAX_PROXY_POLL_TIMEOUT_MS = 3_600_000; // 60 min hard cap

// Exported so the upload UI (DraggableAsset.jsx) can show the SAME estimate
// it's actually going to wait for, instead of a made-up/duplicated number.
export function computeProxyPollTimeout(fileSizeBytes) {
    if (!fileSizeBytes || fileSizeBytes <= 0) return BASE_PROXY_POLL_TIMEOUT_MS;
    const gb = fileSizeBytes / (1024 ** 3);
    const extraGb = Math.max(0, gb - PROXY_TIMEOUT_FREE_GB);
    const timeoutMs = BASE_PROXY_POLL_TIMEOUT_MS + extraGb * PROXY_TIMEOUT_PER_GB_MS;
    return Math.min(Math.round(timeoutMs), MAX_PROXY_POLL_TIMEOUT_MS);
}

// ── Upload concurrency ────────────────────────────────────────────────────────
// handleFileImport (IDELayout.jsx) starts every file's upload without awaiting
// it, so dropping 25 videos used to open 25 simultaneous multi-GB PUTs: the
// browser split its bandwidth 25 ways (no file finished early, so nothing
// became editable early), held 25 upload buffers, and then every file landed
// at about the same moment and queued its proxy/transcription/analysis jobs in
// one spike. A small fixed pool keeps the browser responsive and makes files
// arrive — and start processing — one after another.
export const MAX_CONCURRENT_UPLOADS = 3;
let activeUploads = 0;
const uploadWaiters = [];

async function withUploadSlot(fn) {
    if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
        await new Promise(resolve => uploadWaiters.push(resolve));
    }
    activeUploads++;
    try {
        return await fn();
    } finally {
        activeUploads--;
        const next = uploadWaiters.shift();
        if (next) next();
    }
}

/**
 * XHR PUT with progress. Only reports a percentage when it CHANGES: an XHR
 * fires progress events many times per second, and each one used to become a
 * store update and a re-render of every component reading assets.
 */
function putWithProgress(url, file, contentType, onProgress, label) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url, true);
        xhr.setRequestHeader('Content-Type', contentType);
        let lastPct = -1;
        xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable || !onProgress) return;
            const pct = Math.round((e.loaded / e.total) * 100);
            if (pct === lastPct) return;
            lastPct = pct;
            onProgress(pct);
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
            ? resolve()
            : reject(new Error(`${label} failed: ${xhr.status} ${xhr.responseText}`));
        xhr.onerror = () => reject(new Error(`${label} network error`));
        xhr.send(file);
    });
}

// Proxy jobs run one at a time on the worker (R24). Waiting in line behind
// other files must not count against a file's own encode budget, or the later
// files in a big batch give up and fall back to raw playback while their
// encode is still queued.
const PROXY_POLL_OPTIONS = { countQueueTime: false };

/**
 * Build fetch headers, injecting Authorization if a valid session exists.
 * Uses supabase.auth.getSession() so expired tokens are auto-refreshed.
 */
async function buildHeaders(extra = {}) {
    let token = null;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token ?? null;
    } catch { /* no session: the request goes out unauthenticated */ }

    const headers = { ...extra };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

/**
 * Service to handle proxy generation requests.
 */
class ProxyService {
    /** Store assistant guidance media without queuing an editable-media job. */
    static async uploadReference(file, assetId, projectId, onProgress) {
        const extension = file.name.split('.').pop()?.toLowerCase();
        const contentType = file.type || ({
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
            mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
            mkv: 'video/x-matroska', avi: 'video/x-msvideo',
        }[extension] || 'application/octet-stream');
        const headers = await buildHeaders({ 'Content-Type': 'application/json' });
        const initResponse = await fetch(`${API_URL}/api/assets/reference-upload-url`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ filename: file.name, contentType, assetId }),
        });
        if (!initResponse.ok) {
            const err = await initResponse.json().catch(() => ({}));
            throw new Error(err.error || `Reference upload could not start (${initResponse.status})`);
        }
        const { sessionUrl, destPath } = await initResponse.json();
        await withUploadSlot(() => putWithProgress(sessionUrl, file, contentType, onProgress, 'Reference upload'));

        const completeHeaders = await buildHeaders({ 'Content-Type': 'application/json' });
        const completeResponse = await fetch(`${API_URL}/api/assets/complete-reference-upload`, {
            method: 'POST',
            headers: completeHeaders,
            body: JSON.stringify({ assetId, gcsPath: destPath, name: file.name, projectId }),
        });
        if (!completeResponse.ok) {
            const err = await completeResponse.json().catch(() => ({}));
            throw new Error(err.error || `Reference upload could not be finalized (${completeResponse.status})`);
        }
        return completeResponse.json();
    }

    /**
     * Request proxy generation for an already-uploaded video.
     * @param {string} videoPath - Relative path of the video (relative to /uploads).
     * @param {string} userId - ID of the user.
     * @returns {Promise<{ proxyPath: string, proxyUrl: string }>}
     */
    static async generateProxy(videoPath, userId) {
        try {
            const headers = await buildHeaders({ 'Content-Type': 'application/json' });

            const response = await fetch(`${API_URL}/api/proxy/generate`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ videoPath, userId }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `Proxy generation failed (${response.status})`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ProxyService] generateProxy error:', error);
            throw error;
        }
    }

    /**
     * Upload directly to GCS via Resumable Session URL, then process.
     *
     * @param {Function} [onUploadComplete] - Called with (destPath) the instant the file
     *   lands on GCS — before proxy encoding starts. Use this to kick off parallel work
     *   like transcription so it runs concurrently with proxy generation.
     */
    static async uploadDirectToGCS(file, onProgress, onUploadComplete) {
        // The slot covers session creation + the PUT only. It is released
        // before proxy polling, which can take many minutes and uses no
        // bandwidth — holding the slot through it would stall every other
        // file's upload behind the encode queue.
        const destPath = await withUploadSlot(() => this._putToGCS(file, onProgress));

        // File is now on GCS — fire callback so callers can start parallel work
        // (e.g. transcription) without waiting for proxy encoding to finish.
        try { onUploadComplete?.(destPath); } catch (err) { console.warn('[proxyService] onUploadComplete threw:', err?.message || err); }

        return this._processDirect(file, destPath);
    }

    static async _putToGCS(file, onProgress) {
        // 1. Get Resumable URL
        const initResponse = await fetchWithRateLimitRetry(async () => fetch(`${API_URL}/api/proxy/upload-url`, {
            method: 'POST',
            headers: await buildHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ filename: file.name, contentType: file.type })
        }), { label: 'upload-url' });

        if (!initResponse.ok) {
            const err = await initResponse.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to initialize direct upload');
        }

        const { sessionUrl, destPath } = await initResponse.json();

        // 2. Upload directly to GCS using XMLHttpRequest for progress events
        await putWithProgress(sessionUrl, file, file.type, onProgress, 'GCS direct upload');
        return destPath;
    }

    static async _processDirect(file, destPath) {
        // 3. Notify backend to process the file.
        // Re-build auth headers here — the GCS upload can take minutes for large
        // files, and the Supabase token may have been refreshed since step 1.
        // Using the stale token would cause optionalAuth to see req.user = null,
        // making resolveUserId return null/'dev-user' and failing the destPath check.
        const processResponse = await fetchWithRateLimitRetry(async () => fetch(`${API_URL}/api/proxy/process-direct`, {
            method: 'POST',
            headers: await buildHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ destPath, originalFilename: file.name })
        }), { label: 'process-direct' });

        if (!processResponse.ok) {
            const err = await processResponse.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to trigger proxy processing');
        }

        const data = await processResponse.json();

        if (data.jobId) {
            const timeoutMs = computeProxyPollTimeout(file.size);
            console.log(`[ProxyService] Polling proxy job ${data.jobId}... (timeout ${Math.round(timeoutMs / 60000)} min for a ${(file.size / (1024 ** 3)).toFixed(1)}GB file)`);
            const result = await pollJobResult(data.jobId, null, timeoutMs, null, PROXY_POLL_OPTIONS);
            // Attach the raw GCS path so callers can store it in clip.sourceUrl
            return { ...(result ?? data), rawGcsPath: destPath };
        }
        return { ...data, rawGcsPath: destPath };
    }

    /**
     * Upload a video file to the server and trigger proxy generation.
     * Uses REST polling (not SSE) to track job completion — SSE is unreliable
     * behind Railway / Nginx reverse proxies (ERR_CONNECTION_RESET).
     *
     * @param {File} file - The video File object.
     * @param {string} userId - ID of the user.
     * @param {Function} onProgress - Callback for upload progress (0-100).
     * @returns {Promise<{ proxyPath: string, proxyUrl: string }>}
     */
    static async uploadAndGenerateProxy(file, userId, onProgress, onUploadComplete) {
        try {
            // Attempt Direct to GCS first
            try {
                return await this.uploadDirectToGCS(file, onProgress, onUploadComplete);
            } catch (err) {
                // If it fails because GCS is not configured, fallback to legacy upload
                if (err.message === 'GCS not configured') {
                    console.log('[ProxyService] GCS not configured, falling back to legacy upload...');
                } else {
                    throw err; // Rethrow actual upload errors
                }
            }

            // Legacy Fallback
            const formData = new FormData();
            formData.append('video', file);
            if (userId) formData.append('userId', userId);

            const headers = await buildHeaders();

            const response = await withUploadSlot(() => fetch(`${API_URL}/api/proxy/upload`, {
                method: 'POST',
                headers,
                body: formData,
            }));

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `Upload failed (${response.status})`);
            }

            const data = await response.json();

            // File is on the server — fire callback for parallel work before proxy polling
            try { onUploadComplete?.(data.originalPath || data.videoPath || null); } catch (err) { console.warn('[proxyService] onUploadComplete threw:', err?.message || err); }

            // If the backend queued a job, poll until it completes.
            if (data.jobId) {
                const timeoutMs = computeProxyPollTimeout(file.size);
                console.log(`[ProxyService] Polling proxy job ${data.jobId}... (timeout ${Math.round(timeoutMs / 60000)} min for a ${(file.size / (1024 ** 3)).toFixed(1)}GB file)`);
                const result = await pollJobResult(data.jobId, null, timeoutMs, null, PROXY_POLL_OPTIONS);
                // Attach the raw GCS path (returned by the upload endpoint) so
                // callers can store it in clip.sourceUrl for reliable export later.
                return { ...(result ?? data), rawGcsPath: data.gcsPath ?? null };
            }

            return data;
        } catch (error) {
            console.error('[ProxyService Upload] Error:', error);
            throw error;
        }
    }
}

export default ProxyService;
