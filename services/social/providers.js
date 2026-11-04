// services/social/providers.js
// The destinations a finished short can be published to.
//
// A registry rather than a switch, so adding a destination is a row here plus
// two environment variables, not new code in the routes.
//
// The env var NAMES are listed instead of their values being read at module
// load, so a destination can sit in this registry long before there are
// credentials for it. isConfigured() then simply reports false and the UI
// shows it as unavailable rather than offering a Connect button that dead
// ends.
//
// IMPORTANT, and the reason every URL below is overridable by an env var:
// these endpoints and scope names are the ones current as of early 2026 and
// all three providers revise them. Confirm each against the provider's own
// documentation before going live, and override rather than edit this file if
// one has moved.
//
// Separately, `publishReady` is about app review, not code. Every one of these
// requires an approved app before it will accept an upload from anyone but the
// developer's own test account, so connecting works long before publishing
// does. See docs below each entry.

'use strict';

const env = (name, fallback) => process.env[name] || fallback;

const PROVIDERS = {
    tiktok: {
        id: 'tiktok',
        label: 'TikTok',
        // TikTok calls it client_key, not client_id. Sending client_id gets a
        // generic invalid_request with nothing pointing at the cause.
        clientIdParam: 'client_key',
        authorizeUrl: env('TIKTOK_AUTHORIZE_URL', 'https://www.tiktok.com/v2/auth/authorize/'),
        tokenUrl:     env('TIKTOK_TOKEN_URL',     'https://open.tiktokapis.com/v2/oauth/token/'),
        scopes: ['user.info.basic', 'video.upload'],
        scopeSeparator: ',',
        envClientId: 'TIKTOK_CLIENT_KEY',
        envClientSecret: 'TIKTOK_CLIENT_SECRET',
        publishReady: false,
        // video.upload puts a draft in the user's TikTok inbox. Posting
        // straight to the feed needs video.publish, which needs the Content
        // Posting API approved and an audited app.
        reviewNote: 'TikTok must approve the app for the Content Posting API.',
    },

    instagram: {
        id: 'instagram',
        label: 'Instagram',
        clientIdParam: 'client_id',
        // Instagram publishing runs through the Facebook Graph API and needs
        // a Business or Creator account linked to a Facebook Page. There is
        // also a newer Instagram-login variant; override these if you use it.
        authorizeUrl: env('INSTAGRAM_AUTHORIZE_URL', 'https://www.facebook.com/v21.0/dialog/oauth'),
        tokenUrl:     env('INSTAGRAM_TOKEN_URL',     'https://graph.facebook.com/v21.0/oauth/access_token'),
        scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
        scopeSeparator: ',',
        envClientId: 'INSTAGRAM_CLIENT_ID',
        envClientSecret: 'INSTAGRAM_CLIENT_SECRET',
        publishReady: false,
        reviewNote: 'Meta App Review is required, and the account must be Business or Creator.',
    },

    youtube: {
        id: 'youtube',
        label: 'YouTube',
        clientIdParam: 'client_id',
        authorizeUrl: env('YOUTUBE_AUTHORIZE_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
        tokenUrl:     env('YOUTUBE_TOKEN_URL',     'https://oauth2.googleapis.com/token'),
        scopes: ['https://www.googleapis.com/auth/youtube.upload'],
        scopeSeparator: ' ',
        envClientId: 'YOUTUBE_CLIENT_ID',
        envClientSecret: 'YOUTUBE_CLIENT_SECRET',
        // Google needs these two to issue a refresh token at all: without
        // access_type=offline the token expires in an hour and the user has to
        // reconnect, and without prompt=consent a second connect returns no
        // refresh token because the user already granted it once.
        extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
        publishReady: false,
        reviewNote: 'An unaudited Google project uploads as private only, and is capped.',
    },
};

/** Every destination, in display order. */
function listProviders() {
    return ['tiktok', 'instagram', 'youtube'].map((id) => PROVIDERS[id]);
}

function getProvider(id) {
    if (typeof id !== 'string') return null;
    return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : null;
}

function clientId(provider) {
    return process.env[provider.envClientId] || '';
}

function clientSecret(provider) {
    return process.env[provider.envClientSecret] || '';
}

/** Whether this destination has credentials and can start an OAuth round trip. */
function isConfigured(provider) {
    return Boolean(provider && clientId(provider) && clientSecret(provider));
}

/**
 * Where the browser is sent to come back to. Built from server configuration
 * and NEVER from the request, because a redirect_uri taken from a request is
 * how an authorization code ends up delivered to someone else's server. It
 * must also match the value registered with the provider exactly.
 */
function redirectUri(providerId) {
    const base = (process.env.PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    if (!base) return '';
    return `${base}/api/social/${providerId}/callback`;
}

/** The provider's consent screen for this user's round trip. */
function authorizeUrl(provider, state) {
    const url = new URL(provider.authorizeUrl);
    url.searchParams.set(provider.clientIdParam, clientId(provider));
    url.searchParams.set('redirect_uri', redirectUri(provider.id));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', provider.scopes.join(provider.scopeSeparator));
    url.searchParams.set('state', state);
    for (const [k, v] of Object.entries(provider.extraAuthParams || {})) {
        url.searchParams.set(k, v);
    }
    return url.toString();
}

/** What the browser is allowed to know. Never includes a secret or a token. */
function publicShape(provider) {
    return {
        id: provider.id,
        label: provider.label,
        configured: isConfigured(provider),
        publishReady: Boolean(provider.publishReady),
        reviewNote: provider.reviewNote || null,
    };
}

module.exports = {
    PROVIDERS, listProviders, getProvider, isConfigured,
    clientId, clientSecret, redirectUri, authorizeUrl, publicShape,
};
