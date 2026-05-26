import { API_URL } from '../config';
import { pollJobResult } from '../utils/jobPoller.js';

/**
 * Get the current session token from Supabase (or localStorage fallback).
 * Returns null if no session exists — callers must handle unauthenticated state.
 */
async function getAuthToken() {
    try {
        // Auto-detect Supabase's own key (pattern: sb-*-auth-token)
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
                const raw = localStorage.getItem(key);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    const token = parsed?.access_token;
                    if (token && token !== 'null' && token !== 'undefined') {
                        return token;
                    }
                }
            }
        }
    } catch (_) {
        // localStorage not available or JSON parse error — fall through
    }

    // Fallback: plain token stored under common dev key names
    const stored = localStorage.getItem('sb-access-token')
        || localStorage.getItem('access_token')
        || localStorage.getItem('auth_token');
    if (stored && stored !== 'null' && stored !== 'undefined') {
        return stored;
    }

    return null;
}

/**
 * Build fetch headers, injecting Authorization if a token is available.
 */
async function buildHeaders(extra = {}) {
    const token = await getAuthToken();
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
     */
    static async uploadDirectToGCS(file, userId, onProgress) {
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

        // 3. Notify backend to process the file
        const processResponse = await fetch(`${API_URL}/api/proxy/process-direct`, {
            method: 'POST',
            headers,
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
    static async uploadAndGenerateProxy(file, userId, onProgress) {
        try {
            // Attempt Direct to GCS first
            try {
                return await this.uploadDirectToGCS(file, userId, onProgress);
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

            // Use XMLHttpRequest here too if we want fallback progress, 
            // but standard fetch is fine for the fallback since it's mostly local.
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
