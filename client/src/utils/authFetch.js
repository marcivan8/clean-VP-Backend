/**
 * authFetch.js
 * Authenticated fetch wrapper that:
 * 1. Always sets Content-Type: application/json for POST/PUT/PATCH
 * 2. Attaches the Supabase JWT Bearer token
 * 3. Returns the raw Response (same signature as native fetch)
 */

import { supabase } from '../lib/supabaseClient';

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

    // ── 2. Anonymous session fallback ─────────────────────────────────────
    // When there's no JWT, attach the anonymous session ID so the server can
    // associate uploads and operations with this user's project.
    const anonSessionId = !token ? (localStorage.getItem('vp_session') ?? null) : null;

    // ── 3. Build headers ──────────────────────────────────────────────────
    const method = (options.method || 'GET').toUpperCase();
    const needsContentType = ['POST', 'PUT', 'PATCH'].includes(method) && options.body;

    const headers = {
        ...(needsContentType ? { 'Content-Type': 'application/json' } : {}),
        ...(token          ? { Authorization:  `Bearer ${token}` }   : {}),
        ...(anonSessionId  ? { 'X-Session-Id': anonSessionId }       : {}),
        ...(options.headers || {}),
    };

    // ── 4. Execute fetch ──────────────────────────────────────────────────
    return fetch(url, { ...options, headers });
}

export default authFetch;