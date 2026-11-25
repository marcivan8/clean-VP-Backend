'use strict';

const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const https = require('https');
const { supabaseAdmin } = require('../config/database');
const { accessTokenFor } = require('../services/social/accessToken');
const socialAnalytics = require('../services/social/analytics');

const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION || 'v27.0';
const TABLE = 'social_publications';

function assertSafeMediaUrl(raw) {
    const url = new URL(raw);
    const publicBase = process.env.PUBLIC_URL || process.env.FRONTEND_URL;
    const ownHost = publicBase ? new URL(publicBase).hostname : null;
    const allowed = url.protocol === 'https:' && (
        url.hostname === 'storage.googleapis.com'
        || url.hostname.endsWith('.storage.googleapis.com')
        || url.hostname.endsWith('.googleapis.com')
        || url.hostname === ownHost
    );
    if (!allowed) throw new Error('MEDIA_URL_NOT_SUPPORTED');
    return url;
}

async function uploadYouTube(publication, accessToken) {
    const source = assertSafeMediaUrl(publication.media_url);
    const sourceResponse = await fetch(source, { redirect: 'error' });
    if (!sourceResponse.ok || !sourceResponse.body) throw new Error('MEDIA_DOWNLOAD_FAILED');
    const contentLength = Number(sourceResponse.headers.get('content-length'));
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 256 * 1024 ** 3) {
        throw new Error('MEDIA_SIZE_UNSUPPORTED');
    }

    const metadata = {
        snippet: { title: publication.title.slice(0, 100), description: publication.caption.slice(0, 5000), categoryId: '22' },
        status: { privacyStatus: 'public' },
    };
    const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': sourceResponse.headers.get('content-type') || 'video/mp4',
            'X-Upload-Content-Length': String(contentLength),
        },
        body: JSON.stringify(metadata),
    });
    const uploadUrl = start.headers.get('location');
    if (!start.ok || !uploadUrl) throw new Error('YOUTUBE_UPLOAD_INIT_FAILED');

    const response = await new Promise((resolve, reject) => {
        const request = https.request(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': sourceResponse.headers.get('content-type') || 'video/mp4',
                'Content-Length': String(contentLength),
            },
        }, resolve);
        request.on('error', reject);
        pipeline(Readable.fromWeb(sourceResponse.body), request).catch(reject);
    });
    let payload = '';
    for await (const chunk of response) payload += chunk;
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('YOUTUBE_UPLOAD_FAILED');
    let parsed = {};
    try { parsed = JSON.parse(payload); } catch { /* provider response may be empty */ }
    return parsed.id || null;
}

async function publishInstagram(publication, accessToken, instagramUserId) {
    if (!instagramUserId) throw new Error('INSTAGRAM_ACCOUNT_ID_MISSING');
    assertSafeMediaUrl(publication.media_url);
    const base = `https://graph.instagram.com/${GRAPH_VERSION}`;
    const createForm = new URLSearchParams({
        media_type: 'REELS', video_url: publication.media_url,
        caption: publication.caption.slice(0, 2200), access_token: accessToken,
    });
    const created = await fetch(`${base}/${encodeURIComponent(instagramUserId)}/media`, { method: 'POST', body: createForm });
    const container = await created.json().catch(() => ({}));
    if (!created.ok || !container.id) throw new Error('INSTAGRAM_CONTAINER_FAILED');

    let ready = false;
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const statusUrl = new URL(`${base}/${encodeURIComponent(container.id)}`);
        statusUrl.searchParams.set('fields', 'status_code');
        statusUrl.searchParams.set('access_token', accessToken);
        const statusResponse = await fetch(statusUrl);
        const status = await statusResponse.json().catch(() => ({}));
        if (status.status_code === 'FINISHED') { ready = true; break; }
        if (status.status_code === 'ERROR' || !statusResponse.ok) throw new Error('INSTAGRAM_MEDIA_PROCESSING_FAILED');
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (!ready) throw new Error('INSTAGRAM_MEDIA_PROCESSING_TIMEOUT');

    const publishForm = new URLSearchParams({ creation_id: container.id, access_token: accessToken });
    const response = await fetch(`${base}/${encodeURIComponent(instagramUserId)}/media_publish`, { method: 'POST', body: publishForm });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.id) throw new Error('INSTAGRAM_PUBLISH_FAILED');
    return body.id;
}

async function processSocialPublication(job) {
    if (job.name === 'sync-analytics') return socialAnalytics.syncSocialAnalytics();
    const { publicationId, userId } = job.data;
    const { data: publication, error } = await supabaseAdmin.from(TABLE).select('*')
        .eq('id', publicationId).eq('user_id', userId).maybeSingle();
    if (error || !publication || publication.status !== 'scheduled') return { skipped: true };

    const { error: markError } = await supabaseAdmin.from(TABLE).update({ status: 'publishing', updated_at: new Date().toISOString() })
        .eq('id', publicationId).eq('status', 'scheduled');
    if (markError) throw new Error('PUBLICATION_STATE_UPDATE_FAILED');

    try {
        const { accessToken, externalId } = await accessTokenFor(userId, publication.provider);
        const providerPostId = publication.provider === 'youtube'
            ? await uploadYouTube(publication, accessToken)
            : await publishInstagram(publication, accessToken, externalId);
        await supabaseAdmin.from(TABLE).update({
            status: 'published', provider_post_id: providerPostId, published_at: new Date().toISOString(),
            media_url: '', failure_code: null, updated_at: new Date().toISOString(),
        }).eq('id', publicationId);
        return { published: true, providerPostId };
    } catch (err) {
        const manualFallback = true;
        await supabaseAdmin.from(TABLE).update({
            status: manualFallback ? 'manual_reminder' : 'failed',
            media_url: '',
            failure_code: String(err.message || 'PUBLISH_FAILED').slice(0, 80),
            reminder_at: manualFallback ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
        }).eq('id', publicationId);
        // A user-facing row contains the fallback; do not retry a publish call
        // that might have succeeded remotely before a network timeout.
        console.error(`[social] ${publication.provider} publication ${publicationId} failed: ${err.message}`);
        return { published: false, manualFallback };
    }
}

module.exports = processSocialPublication;
