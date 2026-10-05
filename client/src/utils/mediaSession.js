/**
 * mediaSession.js — keeps the signed media cookie that lets this browser play
 * the signed-in user's own videos.
 *
 * The server only streams a user's files (GET /api/proxy/gcs-media/*,
 * /uploads/*) to that user. A <video> or <img> element cannot send the
 * Authorization header, so POST /api/proxy/media-session sets a short-lived,
 * HttpOnly cookie instead (services/mediaAccess.js). This module asks for it
 * on sign-in, refreshes it before it expires, and clears it on sign-out.
 */
import { authFetch } from './authFetch.js';

let inflight = null;
let validUntil = 0;
let refreshTimer = null;
let started = false;

const REFRESH_MARGIN_MS = 60 * 60 * 1000; // refresh 1 h before expiry

/** Make sure the cookie exists. Resolves true when it does. Never throws. */
export function ensureMediaSession({ force = false } = {}) {
    if (!force && Date.now() < validUntil - REFRESH_MARGIN_MS) return Promise.resolve(true);
    if (inflight) return inflight;
    inflight = authFetch('/api/proxy/media-session', { method: 'POST', body: '{}' })
        .then(async (res) => {
            if (!res.ok) { validUntil = 0; return false; }
            const data = await res.json().catch(() => ({}));
            validUntil = Date.now() + (Number(data.expiresInS) > 0 ? Number(data.expiresInS) : 12 * 3600) * 1000;
            return true;
        })
        .catch((err) => {
            console.warn('[mediaSession] could not start:', err?.message);
            validUntil = 0;
            return false;
        })
        .finally(() => { inflight = null; });
    return inflight;
}

/** Clear the cookie (sign-out). Never throws. */
export function endMediaSession() {
    validUntil = 0;
    return fetch('/api/proxy/media-session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
}

/** Follow the auth state once, for the whole app. */
export function startMediaSessionKeeper(supabase) {
    if (started || !supabase?.auth?.onAuthStateChange) return;
    started = true;
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') { endMediaSession(); return; }
        if (session) ensureMediaSession({ force: event === 'SIGNED_IN' || event === 'USER_UPDATED' });
    });
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { ensureMediaSession(); }, 30 * 60 * 1000);
}
