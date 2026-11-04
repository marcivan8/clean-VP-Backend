// services/social/accounts.js
// Reading and writing public.social_accounts.
//
// Everything that leaves this module for the browser goes through
// publicAccount(), which is the only shape the API returns. Tokens are
// decrypted in exactly one place (accessTokenFor), used server side, and
// never put in a response or a log line.

'use strict';

const { supabaseAdmin } = require('../../config/database');
const { encrypt, decrypt } = require('./tokenCrypto');

const TABLE = 'social_accounts';

/** What the browser may know about a connection. No token, ever. */
function publicAccount(row) {
    if (!row) return null;
    // A token that will not decrypt means the signing secret moved: the row is
    // present but useless, and the honest thing is to ask for a reconnect
    // rather than show a connected account that cannot publish.
    const usable = Boolean(decrypt(row.access_token));
    const expired = Boolean(row.expires_at) && new Date(row.expires_at).getTime() <= Date.now();
    const refreshable = Boolean(decrypt(row.refresh_token));
    return {
        provider:      row.provider,
        handle:        row.handle || null,
        connectedAt:   row.connected_at || null,
        expiresAt:     row.expires_at || null,
        needsReconnect: !usable || (expired && !refreshable),
    };
}

/** Every connection this user has, sanitised. */
async function listAccounts(userId) {
    const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select('provider, handle, scopes, access_token, refresh_token, expires_at, connected_at')
        .eq('user_id', userId);

    if (error) {
        console.error('[social] listAccounts error:', error.message);
        return [];
    }
    return (data || []).map(publicAccount).filter(Boolean);
}

/**
 * Creates or replaces the connection for one provider. Reconnecting the same
 * provider overwrites the row (the table has a unique (user_id, provider)),
 * so stale credentials never accumulate.
 */
async function saveAccount(userId, providerId, token) {
    const row = {
        user_id:       userId,
        provider:      providerId,
        external_id:   token.externalId || null,
        handle:        token.handle || null,
        scopes:        token.scopes || null,
        access_token:  encrypt(token.accessToken),
        refresh_token: encrypt(token.refreshToken),
        expires_at:    token.expiresAt || null,
        updated_at:    new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
        .from(TABLE)
        .upsert(row, { onConflict: 'user_id,provider' });

    if (error) {
        // Deliberately logs the provider and not the row, which holds tokens.
        console.error(`[social] saveAccount(${providerId}) error:`, error.message);
        return false;
    }
    return true;
}

async function disconnect(userId, providerId) {
    const { error } = await supabaseAdmin
        .from(TABLE)
        .delete()
        .eq('user_id', userId)
        .eq('provider', providerId);

    if (error) {
        console.error(`[social] disconnect(${providerId}) error:`, error.message);
        return false;
    }
    return true;
}

/**
 * The decrypted access token, for server side publishing only. Returns null if
 * there is no connection or the token cannot be recovered. Callers must not
 * put the result in a response, a log, or an error message.
 */
async function accessTokenFor(userId, providerId) {
    const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select('access_token, expires_at')
        .eq('user_id', userId)
        .eq('provider', providerId)
        .maybeSingle();

    if (error || !data) return null;
    return decrypt(data.access_token);
}

module.exports = { listAccounts, saveAccount, disconnect, accessTokenFor, publicAccount };
