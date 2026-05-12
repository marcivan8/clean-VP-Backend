// client/src/utils/authFetch.js

import { supabase } from '../lib/supabaseClient.js'; // adjust path to match your project

/**
 * authFetch.js
 * Authenticated fetch wrapper for all agent/service API calls.
 *
 * FIX: Previous version read the JWT directly from localStorage without
 *      checking expiry. Expired tokens caused every /api/* call to return
 *      401 "token is expired" until the user hard-refreshed the page.
 *
 *      Now uses supabase.auth.getSession() which automatically refreshes
 *      the token when it's expired or within the refresh window.
 */

/**
 * Get a valid (possibly freshly-refreshed) access token from Supabase.
 * Returns null if the user is not authenticated.
 */
async function getToken() {
    try {
        // getSession() silently refreshes the token if it's expired.
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