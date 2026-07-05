/**
 * authFetch.js
 * Authenticated fetch wrapper that:
 * 1. Always sets Content-Type: application/json for POST/PUT/PATCH
 * 2. Attaches the Supabase JWT Bearer token
 * 3. On 401, attempts one silent token refresh then retries once
 *    (uses a module-level promise so concurrent 401s share a single
 *    refreshSession() call instead of racing each other)
 * 4. Returns the raw Response (same signature as native fetch)
 */

import { supabase } from '../lib/supabaseClient';

// Singleton refresh promise — prevents concurrent 401s from each spawning
// their own supabase.auth.refreshSession() call, which interfere and all fail.
let _refreshPromise = null;

async function buildHeaders(token, options) {
    const method = (options.method || 'GET').toUpperCase();
    const needsContentType = ['POST', 'PUT', 'PATCH'].includes(method) && options.body;
    const anonSessionId = !token ? (localStorage.getItem('vp_session') ?? null) : null;

    return {
        ...(needsContentType ? { 'Content-Type': 'application/json' } : {}),
        ...(token           ? { Authorization:  `Bearer ${token}` }   : {}),
        ...(anonSessionId   ? { 'X-Session-Id': anonSessionId }       : {}),
        ...(options.headers || {}),
    };
}

export async function authFetch(url, options = {}) {
    // ── 1. Get the current session token ──────────────────────────────────
    let token = null;
    try {
        if (supabase) {
            const { data: { session } } = await supabase.auth.getSession();
            token = session?.access_token ?? null;
        }
    } catch (err) {
        console.warn('[authFetch] Could not retrieve session token:', err.message);
    }

    // ── 2. First attempt ───────────────────────────────────────────────────
    const headers = await buildHeaders(token, options);
    let response = await fetch(url, { ...options, headers });

    // ── 3. Silent token refresh on 401 ────────────────────────────────────
    // Returning users whose JWT expired get a seamless refresh instead of
    // hitting a wall of silent failures across every protected route.
    // _refreshPromise ensures that if multiple requests hit 401 at the same
    // time (e.g. during a burst of AI calls), they share ONE refreshSession()
    // call rather than racing and all failing.
    if (response.status === 401 && supabase && token) {
        try {
            if (!_refreshPromise) {
                _refreshPromise = supabase.auth.refreshSession().finally(() => {
                    _refreshPromise = null;
                });
            }
            const { data: refreshData, error: refreshError } = await _refreshPromise;
            if (!refreshError && refreshData?.session?.access_token) {
                const newToken = refreshData.session.access_token;
                const retryHeaders = await buildHeaders(newToken, options);
                response = await fetch(url, { ...options, headers: retryHeaders });
            }
        } catch (err) {
            console.warn('[authFetch] Token refresh failed:', err.message);
        }
    }

    return response;
}

export default authFetch;
