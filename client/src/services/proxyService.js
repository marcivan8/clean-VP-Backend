import { API_URL } from '../config';
import { pollJobResult } from '../utils/jobPoller.js';
import { supabase } from '../lib/supabaseClient';

/**
 * Build fetch headers, injecting Authorization if a valid session exists.
 * Uses supabase.auth.getSession() so expired tokens are auto-refreshed.
 */
async function buildHeaders(extra = {}) {
    let token = null;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token ?? null;
    } catch (_) {}

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
        // 1. Get Resumable URL
        const headers = await buildHeaders({ 'Content-Type': 'application/json' });
        const initResponse = await fetch(`${API_URL}/api/proxy/upload-url`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ filename: file.name, contentType: file.type })
        });

        if (!initResponse.ok) {
            const err = await initResponse.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to initialize direct upload');
        }

        const { sessionUrl, destPath } = await initResponse.json();

        // 2. Upload directly to GCS using XMLHttpRequest for progress events
        await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', sessionUrl, true);
            xhr.setRequestHeader('Content-Type', file.type);
            
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
                    onProgress(percentComplete);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve();
                } else {
                    reject(new Error(`GCS direct upload failed: ${xhr.status} ${xhr.responseText}`));
                }
            };
            
            xhr.onerror = () => reject(new Error('GCS direct upload network error'));
            xhr.send(file);
        });

        // File is now on GCS — fire callback so callers can start parallel work
        // (e.g. transcription) without waiting for proxy encoding to finish.
        try { onUploadComplete?.(destPath); } catch (_) {}

        // 3. Notify backend to process the file.
        // Re-build auth headers here — the GCS upload can take minutes for large
        // files, and the Supabase token may have been refreshed since step 1.
        // Using the stale token would cause optionalAuth to see req.user = null,
        // making resolveUserId return null/'dev-user' and failing the destPath check.
        const processHeaders = await buildHeaders({ 'Content-Type': 'application/json' });
        const processResponse = await fetch(`${API_URL}/api/proxy/process-direct`, {
            method: 'POST',
            headers: processHeaders,
            body: JSON.stringify({ destPath, originalFilename: file.name })
        });

        if (!processResponse.ok) {
            const err = await processResponse.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to trigger proxy processing');
        }

        const data = await processResponse.json();

        if (data.jobId) {
            console.log(`[ProxyService] Polling proxy job ${data.jobId}...`);
            const result = await pollJobResult(data.jobId);
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

            const response = await fetch(`${API_URL}/api/proxy/upload`, {
                method: 'POST',
                headers,
                body: formData,
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || `Upload failed (${response.status})`);
            }

            const data = await response.json();

            // File is on the server — fire callback for parallel work before proxy polling
            try { onUploadComplete?.(data.originalPath || data.videoPath || null); } catch (_) {}

            // If the backend queued a job, poll until it completes.
            if (data.jobId) {
                console.log(`[ProxyService] Polling proxy job ${data.jobId}...`);
                const result = await pollJobResult(data.jobId);
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
