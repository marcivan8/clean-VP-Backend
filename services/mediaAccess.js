/**
 * services/mediaAccess.js — who may read a stored media file.
 *
 * Video files are streamed by GET /api/proxy/gcs-media/* and /uploads/*.
 * Both used to serve ANY object to ANYONE with the path (no authentication,
 * cached publicly for a year). Paths are predictable: raw/<userId>/<file>,
 * proxies/<userId>/..., exports/<userId>/... A <video> element cannot send an
 * Authorization header, so the browser proves who it is with a short-lived,
 * signed, HttpOnly cookie set by POST /api/proxy/media-session (same origin:
 * the app and the API are served by the same Express server).
 *
 * Rules:
 *  - user-scoped prefixes (raw/, proxies/, exports/, ...): the second path
 *    segment must be the requester's user id;
 *  - public prefixes (shared library assets): anyone;
 *  - anything else: nobody (in production).
 * Server-to-server calls (export worker) pass X-Worker-Secret.
 */
'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'vibed_media';
const COOKIE_TTL_S = 12 * 60 * 60; // 12 h; the client refreshes it well before

/** Prefixes whose 2nd segment is the owner's user id. */
const USER_PREFIXES = new Set([
    'raw', 'proxies', 'exports', 'thumbnails', 'processed', 'waveforms',
    'luts', 'analysis-only', 'ai-training', 'masks', 'segments',
]);
/** Shared, non-personal assets. */
const PUBLIC_PREFIXES = new Set(['sticker-library', 'motion-assets', 'sfx-library', 'library']);

function secret() {
    const s = process.env.MEDIA_COOKIE_SECRET
        || process.env.WORKER_SECRET
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || (process.env.NODE_ENV === 'production' ? null : 'dev-media-secret');
    if (!s) throw new Error('No secret available to sign media cookies (set MEDIA_COOKIE_SECRET)');
    // Derive a dedicated key so the raw service key is never used directly.
    return crypto.createHmac('sha256', 'vibed-media-cookie-v1').update(s).digest();
}

function sign(payload) {
    return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Token for a user id, valid `ttlS` seconds. */
function issueToken(userId, ttlS = COOKIE_TTL_S, now = Date.now()) {
    const exp = Math.floor(now / 1000) + ttlS;
    const payload = `${Buffer.from(String(userId)).toString('base64url')}.${exp}`;
    return `${payload}.${sign(payload)}`;
}

/** User id from a token, or null when missing, tampered with or expired. */
function verifyToken(token, now = Date.now()) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [uidB64, expStr, sig] = parts;
    const expected = sign(`${uidB64}.${expStr}`);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp * 1000 < now) return null;
    try {
        const uid = Buffer.from(uidB64, 'base64url').toString('utf8');
        return uid || null;
    } catch {
        return null;
    }
}

function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}

function cookieHeader(token, { secure, maxAgeS = COOKIE_TTL_S } = {}) {
    return [
        `${COOKIE_NAME}=${token}`,
        'Path=/',
        `Max-Age=${maxAgeS}`,
        'HttpOnly',
        'SameSite=Lax',
        secure ? 'Secure' : null,
    ].filter(Boolean).join('; ');
}

function clearCookieHeader({ secure } = {}) {
    return cookieHeader('', { secure, maxAgeS: 0 });
}

/** Normalised object path ("raw/u1/a.mov"), or null when it tries to escape. */
function normalisePath(p) {
    const s = String(p || '').replace(/^\/+/, '');
    if (!s || s.includes('..') || s.includes('\\') || s.includes('\0')) return null;
    return s;
}

/**
 * May `userId` read `objectPath`? `{ allowed, reason }`.
 * `isServer`: a trusted server-to-server request (worker secret).
 */
function canReadObject(objectPath, userId, { isServer = false, localUploads = false } = {}) {
    const p = normalisePath(objectPath);
    if (!p) return { allowed: false, reason: 'bad_path' };
    if (isServer) return { allowed: true, reason: 'server' };
    const [first, second] = p.split('/');
    if (PUBLIC_PREFIXES.has(first)) return { allowed: true, reason: 'public' };
    // /uploads/exports/<render-id>.mp4 — the local-storage fallback for a
    // finished export has no user id in its path (random job id). Signed-in
    // users only; the finished file name is not guessable.
    if (localUploads && first === 'exports' && p.split('/').length === 2) {
        return userId ? { allowed: true, reason: 'local_export' } : { allowed: false, reason: 'no_identity' };
    }
    if (USER_PREFIXES.has(first)) {
        if (!userId) return { allowed: false, reason: 'no_identity' };
        return second && second === String(userId)
            ? { allowed: true, reason: 'owner' }
            : { allowed: false, reason: 'not_owner' };
    }
    return { allowed: false, reason: 'unknown_prefix' };
}

function isServerRequest(req) {
    const s = process.env.WORKER_SECRET;
    const got = req.headers['x-worker-secret'];
    if (!s || typeof got !== 'string' || got.length !== s.length) return false;
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(s));
}

/** User id carried by the request's media cookie (or null). */
function mediaUserFromRequest(req) {
    return verifyToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

/**
 * Express guard for a media path. Enforced in production; in development it
 * only logs (local storage paths use a "dev-user" id and no sign-in).
 * @param {(req) => string} getPath object path for this request
 */
function requireMediaAccess(getPath, { localUploads = false } = {}) {
    return (req, res, next) => {
        const objectPath = getPath(req);
        const userId = mediaUserFromRequest(req);
        const verdict = canReadObject(objectPath, userId, { isServer: isServerRequest(req), localUploads });
        if (verdict.allowed) return next();
        if (process.env.NODE_ENV !== 'production') {
            if (verdict.reason !== 'public') console.warn(`[mediaAccess] (dev, allowed) ${verdict.reason}: ${objectPath}`);
            return next();
        }
        return res.status(verdict.reason === 'no_identity' ? 401 : 403).json({ error: 'Not allowed to read this file' });
    };
}

module.exports = {
    COOKIE_NAME,
    COOKIE_TTL_S,
    USER_PREFIXES,
    PUBLIC_PREFIXES,
    issueToken,
    verifyToken,
    parseCookies,
    cookieHeader,
    clearCookieHeader,
    canReadObject,
    isServerRequest,
    mediaUserFromRequest,
    requireMediaAccess,
};
