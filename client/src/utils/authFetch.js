/**
 * authFetch.js
 * Authenticated fetch wrapper that:
 * 1. Always sets Content-Type: application/json for POST/PUT/PATCH
 * 2. Attaches the Supabase JWT Bearer token
 * 3. On 401, attempts one silent token refresh then retries once
 * 4. Returns the raw Response (same signature as native fetch)
 */

import { supabase } from '../lib/supabaseClient';

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
    if (response.status === 401 && supabase && token) {
        try {
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
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
