/**
 * client/src/utils/safeNextPath.js — where to go after sign-in (R101).
 *
 * Only a relative path on this site is accepted. "//evil.com", "https://…",
 * "/\\evil.com" and anything with a scheme fall back, so ?next= can never be
 * used as an open redirect.
 */
export function safeNextPath(next, fallback = '/dashboard') {
    if (typeof next !== 'string' || !next) return fallback;
    if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
    for (let i = 0; i < next.length; i++) {
        if (next.charCodeAt(i) < 0x20) return fallback; // tabs/newlines are stripped by URL parsers
    }
    if (/^\/[^/]*:/.test(next)) return fallback;
    return next;
}
