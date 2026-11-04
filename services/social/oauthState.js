// services/social/oauthState.js
// The `state` parameter for a destination's OAuth round trip.
//
// This carries more weight here than in a typical web app. The provider sends
// the user back to /api/social/:provider/callback as a BROWSER REDIRECT, which
// carries no Authorization header, so authenticateUser cannot protect that
// route and there is no session cookie to fall back on. The signed state IS
// the authentication for the callback: the user id inside it is trusted
// precisely because only this server could have produced a valid signature
// for it.
//
// That makes two attacks the thing to stop:
//   - Forging a state to attach an attacker's social account to someone
//     else's VIBED account, or the reverse. HMAC over the payload prevents it.
//   - Replaying an old authorization. A short expiry bounds it, and the state
//     is bound to one provider so a state minted for one cannot be spent on
//     another.
//
// Same shape as services/unsubscribeToken.js: HMAC-SHA256, a versioned
// payload, timingSafeEqual.

'use strict';

const crypto = require('crypto');

const VERSION = 'sst1';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function key() {
    return process.env.SOCIAL_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function sign(payloadB64) {
    const k = key();
    if (!k) return '';
    return crypto.createHmac('sha256', k).update(`${VERSION}:${payloadB64}`).digest('base64url');
}

/** A signed state, or null when there is no secret to sign with. */
function createState({ userId, provider, returnTo = null, ttlMs = DEFAULT_TTL_MS }) {
    if (!userId || !provider) return null;
    const payload = {
        v: VERSION,
        uid: String(userId),
        p: String(provider),
        n: crypto.randomBytes(12).toString('base64url'),
        exp: Date.now() + ttlMs,
        // Where to send the browser afterwards. Validated against an allowlist
        // on the way out, never used as given, so this cannot become an open
        // redirect even if a state is somehow forged.
        r: returnTo ? String(returnTo) : null,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = sign(payloadB64);
    if (!sig) return null;
    return `${payloadB64}.${sig}`;
}

/**
 * The payload if the state is intact, unexpired and for `expectedProvider`.
 * Null otherwise. Never throws, and never explains which check failed to the
 * caller: a forged state and an expired one get the same answer.
 */
function readState(state, expectedProvider) {
    if (typeof state !== 'string' || state.length > 4096) return null;
    const dot = state.indexOf('.');
    if (dot <= 0) return null;
    const payloadB64 = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    const expected = sign(payloadB64);
    if (!expected || !sig) return null;

    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on a length mismatch, so compare lengths first.
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!payload || payload.v !== VERSION) return null;
    if (typeof payload.uid !== 'string' || !payload.uid) return null;
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    // A state minted for one destination must not be spendable on another.
    if (expectedProvider && payload.p !== expectedProvider) return null;
    return { userId: payload.uid, provider: payload.p, returnTo: payload.r || null };
}

module.exports = { createState, readState, DEFAULT_TTL_MS };
