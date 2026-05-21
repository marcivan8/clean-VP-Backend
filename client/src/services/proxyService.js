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
     * Upload a video file to the server and trigger proxy generation.
     * Uses REST polling (not SSE) to track job completion — SSE is unreliable
     * behind Railway / Nginx reverse proxies (ERR_CONNECTION_RESET).
     *
     * @param {File} file - The video File object.
     * @param {string} userId - ID of the user.
     * @returns {Promise<{ proxyPath: string, proxyUrl: string }>}
     */
    static async uploadAndGenerateProxy(file, userId) {
        try {
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

            // If the backend queued a job, poll until it completes.
            // We use REST polling instead of EventSource (SSE) because SSE
            // connections are killed by Railway's / Nginx's proxy after ~30s.
            if (data.jobId) {
                console.log(`[ProxyService] Polling proxy job ${data.jobId}...`);
                const result = await pollJobResult(data.jobId);
                // result may be null if the job completed before the first poll;
                // fall back to the original response data.
                return result ?? data;
            }

            return data;
        } catch (error) {
            console.error('[ProxyService Upload] Error:', error);
            throw error;
        }
    }
}

export default ProxyService;
