// services/social/returnTo.js
// Where the browser is allowed to land after an OAuth round trip.
//
// The value travels inside the signed state, so it is not attacker controlled
// in the ordinary case. It is still validated on the way out, because a
// redirect target used as given is an open redirect, and an open redirect on
// the callback path is worth more to an attacker than usual: it sits on the
// app's own origin, right next to a flow the user has just been asked to
// trust with their social account.
//
// Relative paths only. Anything else becomes /editor.

'use strict';

const FALLBACK = '/editor';

function safeReturnTo(value) {
    if (typeof value !== 'string') return FALLBACK;
    if (!value.startsWith('/')) return FALLBACK;
    // "//host" is protocol relative and leaves the site entirely.
    if (value.startsWith('//')) return FALLBACK;
    // A colon can smuggle a scheme ("/\t/evil.com", "javascript:"), and some
    // browsers normalise a backslash to a slash, so "/\evil.com" escapes too.
    if (value.includes(':') || value.includes('\\')) return FALLBACK;
    // Control characters are stripped or normalised inconsistently between
    // browsers, which is how a value that looks relative stops being one.
    if (/[\u0000-\u001F\u007F]/.test(value)) return FALLBACK;
    if (value.length > 512) return FALLBACK;
    return value;
}

module.exports = { safeReturnTo, FALLBACK };
