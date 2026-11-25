// routes/socialRoutes.js
// Social account OAuth, publishing, analytics, and approved edit guidance.
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
const { supabaseAdmin } = require('../config/database');
const { enqueuePublication, removePublicationJob } = require('../services/social/publicationQueue');
const { aiGate, requirePlan } = require('../middleware/usageGate');

// Social publishing and post analytics are Pro features (R104). The gate is on
// everything that STARTS something: connecting an account, scheduling a post,
// AI copy, analytics and recommendations. Reading, cancelling and deleting what
// already exists, and disconnecting an account, stay open, so someone who
// leaves Pro can still clean up after themselves.
const socialGate = requirePlan('pro', { code: 'SOCIAL_PRO', feature: 'Social publishing and post analytics' });
const { getAIClient, isAIConfigured, resolveModel, resolveProvider } = require('../services/AIProvider');
const { executeChatCompletionWithFailover } = require('../services/motionProvider');
const storageConfig = require('../config/storage');
const socialAnalytics = require('../services/social/analytics');
const { accessTokenFor } = require('../services/social/accessToken');

const router = express.Router();
const PUBLICATION_TABLE = 'social_publications';

async function ownedPublicMediaUrl(value, userId, scheduleMs) {
    try {
        const url = new URL(value, 'https://vibed.invalid');
        const pathPrefix = `/api/proxy/gcs-media/exports/${userId}/`;
        if (!url.pathname.startsWith(pathPrefix)) return null;
        if (!storageConfig.bucket) return null;
        const objectPath = decodeURIComponent(url.pathname.slice('/api/proxy/gcs-media/'.length));
        if (objectPath.includes('..') || objectPath.includes('\\')) return null;
        const file = storageConfig.bucket.file(objectPath);
        const [exists] = await file.exists();
        if (!exists) return null;
        // Meta needs a server-fetchable URL; editor media endpoints require a
        // user cookie and cannot be fetched by Instagram's media processor.
        const expires = scheduleMs + 12 * 60 * 60 * 1000;
        if (expires > Date.now() + 7 * 24 * 60 * 60 * 1000) return null;
        const [signedUrl] = await file.getSignedUrl({ version: 'v4', action: 'read', expires });
        return signedUrl;
    } catch {
        return null;
    }
}

// Generate editable copy tailored to the selected network. This is an AI
// operation and therefore passes through the same usage gate as other AI APIs.
router.post('/copy/generate', authenticateUser, socialGate, aiGate, async (req, res) => {
    const provider = req.body?.provider;
    const title = String(req.body?.title || '').trim().slice(0, 300);
    const context = String(req.body?.context || '').trim().slice(0, 5000);
    const language = String(req.body?.language || 'English').slice(0, 40);
    if (!['youtube', 'instagram'].includes(provider)) return res.status(400).json({ error: 'UNSUPPORTED_PROVIDER' });
    if (!title && !context) return res.status(400).json({ error: 'CONTENT_REQUIRED' });
    if (!isAIConfigured({ capability: 'chat' })) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });
    try {
        const aiProvider = resolveProvider({ capability: 'chat' });
        const model = resolveModel('gpt-4o-mini', { capability: 'chat', provider: aiProvider });
        const ai = getAIClient({ capability: 'chat', provider: aiProvider });
        const network = provider === 'youtube'
            ? 'YouTube Shorts: write a concise searchable title up to 100 characters and an informative description with relevant hashtags.'
            : 'Instagram Reels: write a natural engaging caption with a clear hook and a few relevant hashtags; no separate title.';
        const { completion } = await executeChatCompletionWithFailover({
            ai,
            requestParams: {
                model, max_tokens: 600, response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: `Write original, accurate social post copy in ${language}. ${network} Do not invent claims, metrics, offers, or facts. Return JSON only with keys title and caption.` },
                    { role: 'user', content: JSON.stringify({ title, context }) },
                ],
            },
            provider: aiProvider, model, capability: 'chat',
        });
        const raw = completion?.choices?.[0]?.message?.content || '{}';
        const generated = JSON.parse(raw);
        return res.json({ title: String(generated.title || title).slice(0, 100), caption: String(generated.caption || '').slice(0, 5000) });
    } catch (err) {
        console.error('[social] copy generation failed:', err.message);
        return res.status(502).json({ error: 'COPY_GENERATION_FAILED' });
    }
});

router.get('/publications', authenticateUser, async (req, res) => {
    const { data, error } = await supabaseAdmin.from(PUBLICATION_TABLE).select('*')
        .eq('user_id', req.user.id).order('scheduled_at', { ascending: true }).limit(100);
    if (error) {
        console.error('[social] list publications error:', error.message);
        return res.status(500).json({ error: 'PUBLICATIONS_UNAVAILABLE' });
    }
    const now = Date.now();
    res.json({ publications: (data || []).map(row => ({
        id: row.id, provider: row.provider, title: row.title, caption: row.caption, shortId: row.source_short_id,
        scheduledAt: row.scheduled_at, status: row.status, failureCode: row.failure_code,
        reminderDue: row.status === 'scheduled' && !row.reminder_seen_at
            && new Date(row.scheduled_at).getTime() - now <= 24 * 60 * 60 * 1000
            && new Date(row.scheduled_at).getTime() > now,
        createdAt: row.created_at,
    })) });
});

router.get('/analytics', authenticateUser, socialGate, async (req, res) => {
    try {
        return res.json(await socialAnalytics.getUserAnalytics(req.user.id));
    } catch (err) {
        console.error('[social] analytics read failed:', err.message);
        return res.status(500).json({ error: 'ANALYTICS_UNAVAILABLE' });
    }
});

router.post('/analytics/recommendations/generate', authenticateUser, socialGate, aiGate, async (req, res) => {
    if (!isAIConfigured({ capability: 'chat' })) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });
    try {
        const analytics = await socialAnalytics.getUserAnalytics(req.user.id);
        const measured = analytics.posts.filter(post => post.metrics).slice(0, 20);
        if (measured.length < 3) {
            return res.status(409).json({ error: 'MORE_POSTS_NEEDED', sampleCount: measured.length, required: 3 });
        }
        const evidence = measured.map(post => ({
            provider: post.provider, title: post.title, publishedAt: post.publishedAt,
            metrics: post.metrics, editContext: post.editContext,
        }));
        const provider = resolveProvider({ capability: 'chat' });
        const model = resolveModel('gpt-4o-mini', { capability: 'chat', provider });
        const ai = getAIClient({ capability: 'chat', provider });
        const { completion } = await executeChatCompletionWithFailover({
            ai,
            requestParams: {
                model, max_tokens: 1000, response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content: 'You are an evidence-led short-form video editor. Compare only the provided posts and measured metrics. Do not claim causation from small samples; describe patterns as tentative. Return at most four actionable editing recommendations, not social-copy or posting-time advice. Each recommendation must map to a real edit choice for future Shorts/Reels: hook, pacing, captions, framing, duration, or story. Keep each instruction to one concise imperative the editor can use while building a new short. Return JSON only: {"recommendations":[{"provider":"youtube|instagram|all","category":"hook|pacing|captions|framing|duration|story","title":"...","rationale":"...","instruction":"...","postIds":["..."]}]}',
                    },
                    { role: 'user', content: JSON.stringify({ posts: evidence }) },
                ],
            },
            provider, model, capability: 'chat',
        });
        const raw = completion?.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(raw);
        const allowedCategories = new Set(['hook', 'pacing', 'captions', 'framing', 'duration', 'story']);
        const knownIds = new Set(measured.map(post => post.id));
        const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
            .map(item => ({
                user_id: req.user.id,
                provider: ['youtube', 'instagram', 'all'].includes(item?.provider) ? item.provider : 'all',
                category: allowedCategories.has(item?.category) ? item.category : 'story',
                title: String(item?.title || '').trim().slice(0, 120),
                rationale: String(item?.rationale || '').trim().slice(0, 500),
                instruction: String(item?.instruction || '').trim().slice(0, 300),
                evidence: Array.isArray(item?.postIds) ? item.postIds.filter(id => knownIds.has(id)).slice(0, 8) : [],
                status: 'pending',
            }))
            .filter(item => item.title && item.rationale && item.instruction)
            .slice(0, 4);
        if (!recommendations.length) return res.status(502).json({ error: 'NO_USABLE_RECOMMENDATIONS' });
        const { data, error } = await supabaseAdmin.from('social_edit_recommendations').insert(recommendations)
            .select('id,provider,category,title,rationale,instruction,evidence,status,created_at');
        if (error) throw new Error(`RECOMMENDATIONS_SAVE_FAILED: ${error.message}`);
        return res.status(201).json({ recommendations: data || [] });
    } catch (err) {
        console.error('[social] recommendation generation failed:', err.message);
        return res.status(502).json({ error: 'RECOMMENDATION_GENERATION_FAILED' });
    }
});

router.patch('/analytics/recommendations/:id', authenticateUser, socialGate, async (req, res) => {
    const status = req.body?.status;
    if (!['accepted', 'dismissed'].includes(status)) return res.status(400).json({ error: 'INVALID_RECOMMENDATION_STATUS' });
    const { data, error } = await supabaseAdmin.from('social_edit_recommendations').update({
        status, decided_at: new Date().toISOString(),
    }).eq('id', req.params.id).eq('user_id', req.user.id)
        .in('status', ['pending', 'accepted', 'dismissed'])
        .select('id,status').maybeSingle();
    if (error) {
        console.error('[social] recommendation update failed:', error.message);
        return res.status(500).json({ error: 'RECOMMENDATION_UPDATE_FAILED' });
    }
    if (!data) return res.status(404).json({ error: 'RECOMMENDATION_NOT_FOUND' });
    res.json({ recommendation: data });
});

router.post('/publications', authenticateUser, socialGate, async (req, res) => {
    const providerId = req.body?.provider;
    const provider = getProvider(providerId);
    const mediaUrlInput = typeof req.body?.mediaUrl === 'string' ? req.body.mediaUrl : '';
    const scheduledMs = Date.parse(req.body?.scheduledAt);
    const title = String(req.body?.title || '').trim().slice(0, 100);
    const caption = String(req.body?.caption || '').trim().slice(0, 5000);
    const rawEdit = req.body?.editContext && typeof req.body.editContext === 'object' ? req.body.editContext : {};
    const editContext = {
        durationSeconds: Math.max(0, Math.min(600, Number(rawEdit.durationSeconds) || 0)),
        pickerScore: Number.isFinite(Number(rawEdit.pickerScore)) ? Math.max(0, Math.min(100, Number(rawEdit.pickerScore))) : null,
        hookEvent: String(rawEdit.hookEvent || '').slice(0, 100),
        captionsEnabled: rawEdit.captionsEnabled === true,
        polishEnabled: rawEdit.polishEnabled === true,
        soundEffectsEnabled: rawEdit.soundEffectsEnabled === true,
        speakerPopOutEnabled: rawEdit.speakerPopOutEnabled === true,
    };
    if (!['youtube', 'instagram'].includes(providerId) || !provider) return res.status(400).json({ error: 'UNSUPPORTED_PROVIDER' });
    if (!Number.isFinite(scheduledMs) || scheduledMs < Date.now() + 60_000 || scheduledMs > Date.now() + 6 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000) {
        return res.status(400).json({ error: 'SCHEDULE_OUT_OF_RANGE', message: 'Choose a time between one minute and six and a half days from now.' });
    }
    const mediaUrl = await ownedPublicMediaUrl(mediaUrlInput, req.user.id, scheduledMs);
    if (!mediaUrl) return res.status(400).json({ error: 'MEDIA_URL_NOT_SUPPORTED', message: 'A finished export in your connected cloud storage is required for scheduled publishing.' });
    if (providerId === 'youtube' && !title) return res.status(400).json({ error: 'TITLE_REQUIRED' });
    const connected = await accounts.listAccounts(req.user.id);
    const account = connected.find(item => item.provider === providerId && !item.needsReconnect);
    if (!account) return res.status(409).json({ error: 'ACCOUNT_NOT_CONNECTED' });
    // Instagram long-lived tokens have no refresh token: they must be refreshed
    // while still valid. Do that before enqueuing whenever this token could
    // expire before the scheduled post and its fetch window.
    if (providerId === 'instagram') {
        try { await accessTokenFor(req.user.id, providerId, scheduledMs + 12 * 60 * 60 * 1000); }
        catch (err) {
            console.error('[social] Instagram token refresh before schedule failed:', err.message);
            return res.status(409).json({ error: 'ACCOUNT_RECONNECT_REQUIRED' });
        }
    }

    const { data, error } = await supabaseAdmin.from(PUBLICATION_TABLE).insert({
        user_id: req.user.id, provider: providerId, media_url: mediaUrl, title, caption,
        edit_context: editContext,
        source_short_id: typeof req.body?.shortId === 'string' ? req.body.shortId.slice(0, 100) : null,
        scheduled_at: new Date(scheduledMs).toISOString(), reminder_at: new Date(scheduledMs - 24 * 60 * 60 * 1000).toISOString(),
        status: 'scheduled',
    }).select('id,user_id,provider,title,caption,scheduled_at,status').single();
    if (error || !data) {
        console.error('[social] create publication error:', error?.message);
        return res.status(500).json({ error: 'SCHEDULE_FAILED' });
    }
    try {
        await enqueuePublication(data, scheduledMs - Date.now());
    } catch (err) {
        await supabaseAdmin.from(PUBLICATION_TABLE).update({ status: 'failed', failure_code: 'QUEUE_UNAVAILABLE' }).eq('id', data.id);
        console.error('[social] enqueue publication failed:', err.message);
        return res.status(503).json({ error: 'QUEUE_UNAVAILABLE' });
    }
    return res.status(201).json({ publication: {
        id: data.id, provider: data.provider, title: data.title, caption: data.caption,
        scheduledAt: data.scheduled_at, status: data.status,
    } });
});

router.post('/publications/:id/reminder-seen', authenticateUser, async (req, res) => {
    const { error } = await supabaseAdmin.from(PUBLICATION_TABLE).update({ reminder_seen_at: new Date().toISOString() })
        .eq('id', req.params.id).eq('user_id', req.user.id).eq('status', 'scheduled');
    if (error) return res.status(500).json({ error: 'REMINDER_UPDATE_FAILED' });
    res.json({ ok: true });
});

router.delete('/publications/:id', authenticateUser, async (req, res) => {
    const { data } = await supabaseAdmin.from(PUBLICATION_TABLE).select('id,status')
        .eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (!data) return res.status(404).json({ error: 'PUBLICATION_NOT_FOUND' });
    if (data.status !== 'scheduled') return res.status(409).json({ error: 'PUBLICATION_NOT_CANCELLABLE' });
    let removed;
    try { removed = await removePublicationJob(data.id); }
    catch (err) {
        console.error('[social] cancel queue error:', err.message);
        return res.status(503).json({ error: 'QUEUE_UNAVAILABLE' });
    }
    if (!removed) return res.status(409).json({ error: 'PUBLICATION_ALREADY_RUNNING' });
    const { error } = await supabaseAdmin.from(PUBLICATION_TABLE).update({ status: 'cancelled', media_url: '', updated_at: new Date().toISOString() })
        .eq('id', data.id).eq('user_id', req.user.id).eq('status', 'scheduled');
    if (error) return res.status(500).json({ error: 'CANCEL_FAILED' });
    res.json({ cancelled: true });
});

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
router.post('/:provider/connect', authenticateUser, socialGate, async (req, res) => {
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

        let accessToken = payload.access_token;
        let expiresIn = Number(payload.expires_in) || 0;
        let externalId = payload.open_id || payload.user_id || payload.sub || null;
        let handle = null;
        // Instagram Login initially returns a short-lived token. Exchange it
        // immediately so scheduled posts can refresh it in the background.
        if (provider.id === 'instagram') {
            const longUrl = new URL('https://graph.instagram.com/access_token');
            longUrl.searchParams.set('grant_type', 'ig_exchange_token');
            longUrl.searchParams.set('client_secret', clientSecret(provider));
            longUrl.searchParams.set('access_token', accessToken);
            const longResponse = await fetch(longUrl);
            const longPayload = await longResponse.json().catch(() => ({}));
            if (!longResponse.ok || !longPayload.access_token) {
                console.error(`[social] instagram long-lived token exchange failed: ${longResponse.status}`);
                return backTo(res, verified.returnTo, { social_error: 'exchange_failed', provider: provider.id });
            }
            accessToken = longPayload.access_token;
            expiresIn = Number(longPayload.expires_in) || expiresIn;
            const profileUrl = new URL('https://graph.instagram.com/me');
            profileUrl.searchParams.set('fields', 'user_id,username');
            profileUrl.searchParams.set('access_token', accessToken);
            const profileResponse = await fetch(profileUrl);
            const profile = await profileResponse.json().catch(() => ({}));
            if (!profileResponse.ok || !(profile.user_id || profile.id)) {
                console.error(`[social] instagram profile lookup failed: ${profileResponse.status}`);
                return backTo(res, verified.returnTo, { social_error: 'exchange_failed', provider: provider.id });
            }
            externalId = String(profile.user_id || profile.id);
            handle = profile.username || null;
        }

        const expiresAt = expiresIn
            ? new Date(Date.now() + expiresIn * 1000).toISOString()
            : null;

        const saved = await accounts.saveAccount(verified.userId, provider.id, {
            // Providers disagree on what they call the account id, and the
            // display handle usually needs a second authenticated call that
            // differs per provider. That lands with publishing; until then the
            // UI shows the destination without a handle rather than guessing.
            externalId,
            handle,
            scopes:       typeof payload.scope === 'string' ? payload.scope : provider.scopes.join(' '),
            accessToken,
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
