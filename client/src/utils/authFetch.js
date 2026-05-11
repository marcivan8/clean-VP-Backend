/**
 * authFetch.js
 * Authenticated fetch wrapper for all agent/service API calls.
 * Automatically injects the Supabase JWT Bearer token from localStorage.
 * Use this instead of raw fetch() for every /api/... call.
 */

async function getToken() {
    try {
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
        // localStorage unavailable or JSON parse error
    }

    // Fallback: plain token under common dev key names
    const stored =
        localStorage.getItem('sb-access-token') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('auth_token');

    if (stored && stored !== 'null' && stored !== 'undefined') {
        return stored;
    }

    return null;
}

/**
 * Authenticated fetch. Mirrors the fetch() API exactly.
 * - Automatically sets Content-Type: application/json (unless body is FormData)
 * - Automatically injects Authorization: Bearer <token> when a session exists
 * - Any headers passed in options.headers override the defaults
 */
export async function authFetch(url, options = {}) {
    const token = await getToken();
    const isFormData = options.body instanceof FormData;

    const headers = {
        // Skip Content-Type for FormData — browser sets it with the correct boundary
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
    };

    return fetch(url, {
        ...options,
        headers,
    });
}

export default authFetch;