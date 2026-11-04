// services/social/tokenCrypto.js
// Encrypts the OAuth tokens stored in public.social_accounts.
//
// These are credentials for someone else's TikTok / Instagram / YouTube
// account. The table is already unreachable from the browser (R149 migration
// revokes anon and authenticated), so this guards the other case: a database
// dump, a log, a backup, a support export. Encrypted, those are not a set of
// working credentials.
//
// Envelope: "v1:<iv>:<tag>:<ciphertext>", each base64url. AES-256-GCM, so a
// tampered ciphertext fails to authenticate rather than decrypting to
// something unpredictable.
//
// The key is derived from SOCIAL_TOKEN_KEY, or SUPABASE_SERVICE_ROLE_KEY if
// that is not set, so this works without new configuration while still
// allowing a dedicated key. Rotating whichever one is in use makes existing
// tokens undecryptable: decrypt() then returns null, the account reads as
// needing reconnection, and the user reconnects. That is the intended
// failure, which is why nothing here throws on a bad decrypt.

'use strict';

const crypto = require('crypto');

const INFO = 'vibed-social-token-v1';

function keyMaterial() {
    return process.env.SOCIAL_TOKEN_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function derivedKey() {
    const material = keyMaterial();
    if (!material) return null;
    // 32 bytes for AES-256. The info string is mixed in so this key is not the
    // same value as any other use of the same secret elsewhere in the app.
    return crypto.createHash('sha256').update(`${INFO}:${material}`).digest();
}

/** True when tokens can be stored at all. Routes check this before an OAuth start. */
function canEncrypt() {
    return Boolean(keyMaterial());
}

/**
 * Returns the envelope, or null for an empty input (a provider that issues no
 * refresh token, say). Throws only when there is no key, which is a
 * misconfiguration worth failing loudly on rather than storing plaintext.
 */
function encrypt(plain) {
    if (plain === null || plain === undefined || plain === '') return null;
    const key = derivedKey();
    if (!key) {
        throw new Error('[social] SOCIAL_TOKEN_KEY or SUPABASE_SERVICE_ROLE_KEY must be set before storing tokens');
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return [
        'v1',
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url'),
    ].join(':');
}

/** The plaintext, or null if it cannot be recovered for any reason. Never throws. */
function decrypt(envelope) {
    if (typeof envelope !== 'string' || !envelope) return null;
    const parts = envelope.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const key = derivedKey();
    if (!key) return null;
    try {
        const iv = Buffer.from(parts[1], 'base64url');
        const tag = Buffer.from(parts[2], 'base64url');
        const ciphertext = Buffer.from(parts[3], 'base64url');
        if (iv.length !== 12 || tag.length !== 16) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
        // Wrong key, tampering, or a rotated secret. The caller treats the
        // account as needing reconnection.
        return null;
    }
}

module.exports = { encrypt, decrypt, canEncrypt };
