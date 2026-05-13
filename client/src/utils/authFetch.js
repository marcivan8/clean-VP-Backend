// client/src/utils/authFetch.js
//
// Changes over the previous version:
//  1. On 401 responses the token is force-refreshed once and the request
//     retried — handles the edge case where the cached session is slightly
//     stale even after getSession() returns it.
//  2. Throws AuthError (not a plain Error) so callers can distinguish auth
//     failures from network / server errors and redirect to login if needed.
//  3. Exports a typed AuthError class for instanceof checks.

import { supabase } from '../lib/supabaseClient.js';

// ─── Typed error ─────────────────────────────────────────────────────────────

export class AuthError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'AuthError';
        this.status = status;
    }
}

// ─── Token retrieval ─────────────────────────────────────────────────────────

/**
 * getToken(forceRefresh)
 * Returns a valid access token.
 * If forceRefresh=true, refreshSession() is called to guarantee a fresh JWT.
 */
async function getToken(forceRefresh = false) {
    try {
        if (forceRefresh) {
            const { data, error } = await supabase.auth.refreshSession();
            if (error) {
                console.warn('[authFetch] refreshSession error:', error.message);
                return null;
            }
            return data.session?.access_token ?? null;
        }

        // Normal path — getSession() refreshes automatically when expired
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
            console.warn('[authFetch] getSession error:', error.message);
            return null;
        }
        return session?.access_token ?? null;

    } catch (err) {
        console.warn('[authFetch] Could not retrieve session:', err.message);
        return null;
    }
}

// ─── Authenticated fetch ──────────────────────────────────────────────────────

/**
 * authFetch(url, options)
 *
 * Drop-in replacement for fetch() that:
 *  - Sets Content-Type: application/json (unless body is FormData)
 *  - Injects Authorization: Bearer <token>
 *  - On 401 → force-refreshes the token and retries once
 *  - On second 401 → throws AuthError so the app can redirect to login
 *
 * All other options (method, body, signal, headers, …) are forwarded as-is.
 */
export async function authFetch(url, options = {}, _isRetry = false) {
    const token = await getToken(_isRetry);   // forceRefresh on retry
    const isFormData = options.body instanceof FormData;

    const headers = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
    };

    const response = await fetch(url, { ...options, headers });

    // 401 → token may be freshly expired; try once more with a forced refresh
    if (response.status === 401 && !_isRetry) {
        console.warn('[authFetch] 401 received — refreshing token and retrying:', url);
        return authFetch(url, options, true);
    }

    // Second 401 → permanent auth failure
    if (response.status === 401 && _isRetry) {
        throw new AuthError(
            'Authentication failed after token refresh. Please sign in again.',
            401
        );
    }

    return response;
}

export default authFetch;