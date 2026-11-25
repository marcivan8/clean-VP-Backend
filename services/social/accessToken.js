'use strict';

const accounts = require('./accounts');
const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION || 'v27.0';

/** Return a usable provider token, refreshing it before its safe-use window. */
async function accessTokenFor(userId, provider, requiredUntil = Date.now()) {
    const token = await accounts.tokenRecordFor(userId, provider);
    if (!token?.accessToken) throw new Error('SOCIAL_RECONNECT_REQUIRED');
    const expires = token.expires_at ? new Date(token.expires_at).getTime() : 0;
    const refreshLead = provider === 'instagram' ? 7 * 24 * 60 * 60_000 : 5 * 60_000;
    if (expires > Math.max(Date.now() + refreshLead, requiredUntil)) {
        return { accessToken: token.accessToken, externalId: token.external_id };
    }

    if (provider === 'youtube') {
        if (!token.refreshToken) throw new Error('SOCIAL_RECONNECT_REQUIRED');
        const form = new URLSearchParams({
            client_id: process.env.YOUTUBE_CLIENT_ID || '',
            client_secret: process.env.YOUTUBE_CLIENT_SECRET || '',
            refresh_token: token.refreshToken,
            grant_type: 'refresh_token',
        });
        const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: form });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.access_token) throw new Error('SOCIAL_RECONNECT_REQUIRED');
        const expiresAt = new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString();
        if (!await accounts.updateAccessToken(userId, provider, payload.access_token, expiresAt)) throw new Error('TOKEN_STORE_FAILED');
        return { accessToken: payload.access_token, externalId: token.external_id };
    }

    if (provider === 'instagram') {
        const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/refresh_access_token`);
        url.searchParams.set('grant_type', 'ig_refresh_token');
        url.searchParams.set('access_token', token.accessToken);
        const response = await fetch(url);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.access_token) throw new Error('SOCIAL_RECONNECT_REQUIRED');
        const expiresAt = new Date(Date.now() + Number(payload.expires_in || 5_184_000) * 1000).toISOString();
        if (!await accounts.updateAccessToken(userId, provider, payload.access_token, expiresAt)) throw new Error('TOKEN_STORE_FAILED');
        return { accessToken: payload.access_token, externalId: token.external_id };
    }

    throw new Error('UNSUPPORTED_PROVIDER');
}

module.exports = { accessTokenFor };
