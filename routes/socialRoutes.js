// routes/socialRoutes.js
// Connecting and disconnecting publishing destinations.
//
// The shape to understand here is the callback. The provider returns the user
// by redirecting their BROWSER to /api/social/:provider/callback, which
// carries no Authorization header, and this app authenticates with bearer
// tokens rather than cookies. So authenticateUser cannot guard that route and
// there is nothing to read a session from. The signed state is what
// authenticates it: the user id inside it is trusted because only this server
// could have signed it. See services/social/oauthState.js.
//
// Consequences that are easy to get wrong and are handled below:
//   - /connect is authenticated and returns a URL for the client to navigate
//     to. It does not 302, because a bearer-authenticated XHR cannot navigate
//     the browser and a 302 would just be followed by fetch().
//   - the callback never returns a body, only a redirect to a relative app
//     path, so an authorization code cannot end up rendered or logged.
//   - redirect_uri comes from server config, never from the request.

'use strict';

const express = require('express');
const { authenticateUser } = require('../middleware/auth');
const {
    listProviders, getProvider, isConfigured, clientId, clientSecret,
    redirectUri, authorizeUrl, publicShape,
} = require('../services/social/providers');
const { createState, readState } = require('../services/social/oauthState');
const { canEncrypt } = require('../services/social/tokenCrypto');
const accounts = require('../services/social/accounts');
const { safeReturnTo } = require('../services/social/returnTo');

const router = express.Router();

function backTo(res, returnTo, params) {
    const path = safeReturnTo(returnTo);
    const qs = new URLSearchParams(params).toString();
    return res.redirect(`${path}${path.includes('?') ? '&' : '?'}${qs}`);
}

// ── What can this user publish to, and what is already connected ──────────
router.get('/accounts', authenticateUser, async (req, res) => {
    const connected = await accounts.listAccounts(req.user.id);
    const byProvider = new Map(connected.map((a) => [a.provider, a]));

    res.json({
        destinations: listProviders().map((provider) => ({
            ...publicShape(provider),
            connection: byProvider.get(provider.id) || null,
        })),
    });
});

// ── Start a round trip ────────────────────────────────────────────────────
router.post('/:provider/connect', authenticateUser, async (req, res) => {
    const provider = getProvider(req.params.provider);
    if (!provider) {
        return res.status(404).json({ error: 'UNKNOWN_PROVIDER' });
    }
    if (!isConfigured(provider)) {
        return res.status(503).json({
            error: 'PROVIDER_NOT_CONFIGURED',
            message: `${provider.label} is not set up on this server yet.`,
            needs: [provider.envClientId, provider.envClientSecret],
        });
    }
    if (!redirectUri(provider.id)) {
        return res.status(503).json({
            error: 'PROVIDER_NOT_CONFIGURED',
            message: 'The server does not know its own public URL.',
            needs: ['PUBLIC_URL'],
        });
    }
    // Refuse before sending the user to a consent screen whose result could
    // not be stored. Getting their approval and then dropping it is worse
    // than saying no now.
    if (!canEncrypt()) {
        return res.status(503).json({
            error: 'PROVIDER_NOT_CONFIGURED',
            message: 'The server cannot store tokens securely yet.',
            needs: ['SOCIAL_TOKEN_KEY'],
        });
    }

    const state = createState({
        userId: req.user.id,
        provider: provider.id,
        returnTo: safeReturnTo(req.body?.returnTo),
    });
    if (!state) {
        return res.status(503).json({ error: 'PROVIDER_NOT_CONFIGURED', needs: ['SOCIAL_STATE_SECRET'] });
    }

    res.json({ url: authorizeUrl(provider, state) });
});

// ── Come back from the provider ───────────────────────────────────────────
// Deliberately NOT authenticateUser: see the note at the top of this file.
router.get('/:provider/callback', async (req, res) => {
    const provider = getProvider(req.params.provider);
    if (!provider) return res.redirect('/editor?social_error=unknown_provider');

    // Verified first, before anything is read from the query, because this is
    // the only thing establishing who the caller is.
    const verified = readState(req.query.state, provider.id);
    if (!verified) {
        // A forged state, an expired one and one minted for another
        // destination all land here with the same answer.
        return res.redirect('/editor?social_error=expired');
    }

    // The provider reports a refusal in the query rather than by failing.
    if (req.query.error) {
        return backTo(res, verified.returnTo, { social_error: 'declined', provider: provider.id });
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) {
        return backTo(res, verified.returnTo, { social_error: 'no_code', provider: provider.id });
    }

    try {
        const body = new URLSearchParams({
            [provider.clientIdParam]: clientId(provider),
            client_secret: clientSecret(provider),
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri(provider.id),
        });

        const response = await fetch(provider.tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.access_token) {
            // Logs the status, never the payload: a failed exchange can still
            // echo the code back, and a successful one holds the token.
            console.error(`[social] ${provider.id} token exchange failed: ${response.status}`);
            return backTo(res, verified.returnTo, { social_error: 'exchange_failed', provider: provider.id });
        }

        const expiresAt = Number(payload.expires_in)
            ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
            : null;

        const saved = await accounts.saveAccount(verified.userId, provider.id, {
            // Providers disagree on what they call the account id, and the
            // display handle usually needs a second authenticated call that
            // differs per provider. That lands with publishing; until then the
            // UI shows the destination without a handle rather than guessing.
            externalId:   payload.open_id || payload.user_id || payload.sub || null,
            handle:       null,
            scopes:       typeof payload.scope === 'string' ? payload.scope : provider.scopes.join(' '),
            accessToken:  payload.access_token,
            refreshToken: payload.refresh_token || null,
            expiresAt,
        });

        if (!saved) {
            return backTo(res, verified.returnTo, { social_error: 'save_failed', provider: provider.id });
        }
        return backTo(res, verified.returnTo, { connected: provider.id });
    } catch (err) {
        console.error(`[social] ${provider.id} callback error:`, err.message);
        return backTo(res, verified.returnTo, { social_error: 'exchange_failed', provider: provider.id });
    }
});

// ── Disconnect ────────────────────────────────────────────────────────────
router.delete('/:provider', authenticateUser, async (req, res) => {
    const provider = getProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: 'UNKNOWN_PROVIDER' });

    const ok = await accounts.disconnect(req.user.id, provider.id);
    if (!ok) return res.status(500).json({ error: 'DISCONNECT_FAILED' });
    res.json({ disconnected: provider.id });
});

module.exports = router;
