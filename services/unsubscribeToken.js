// services/unsubscribeToken.js
// Signed unsubscribe links: /unsubscribe?uid=<user id>&sig=<hmac>.
// The same signature is computed in supabase/functions/send-email/index.ts
// (keep both in sync): HMAC-SHA256 over "unsub:v1:<uid>", key =
// EMAIL_FUNCTION_SECRET if set, else SUPABASE_SERVICE_ROLE_KEY.

'use strict';

const crypto = require('crypto');

function key() {
    return process.env.EMAIL_FUNCTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function signUnsubscribe(uid) {
    const k = key();
    if (!k || !uid) return '';
    return crypto.createHmac('sha256', k).update(`unsub:v1:${uid}`).digest('hex');
}

function verifyUnsubscribe(uid, sig) {
    if (typeof uid !== 'string' || typeof sig !== 'string') return false;
    if (!/^[0-9a-f-]{36}$/i.test(uid) || !/^[0-9a-f]{64}$/i.test(sig)) return false;
    const expected = signUnsubscribe(uid);
    if (!expected) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig.toLowerCase(), 'hex'));
}

module.exports = { signUnsubscribe, verifyUnsubscribe };
