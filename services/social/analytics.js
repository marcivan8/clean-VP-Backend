'use strict';

const { supabaseAdmin } = require('../../config/database');
const { accessTokenFor } = require('./accessToken');

const POSTS = 'social_publications';
const METRICS = 'social_publication_metrics';
const RECOMMENDATIONS = 'social_edit_recommendations';
const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION || 'v27.0';
const YOUTUBE_METRICS = [
    'views', 'engagedViews', 'estimatedMinutesWatched', 'averageViewDuration',
    'averageViewPercentage', 'likes', 'comments', 'shares',
];
const INSTAGRAM_METRICS = [
    'views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions',
    'ig_reels_avg_watch_time', 'reels_skip_rate',
];

function utcDate(date) { return new Date(date).toISOString().slice(0, 10); }

async function readYouTubeMetrics(post, accessToken) {
    const today = new Date();
    today.setUTCDate(today.getUTCDate() - 2); // Analytics reports can lag; avoid treating missing recent days as zero.
    const publishedDate = utcDate(post.published_at || post.scheduled_at);
    const endDate = utcDate(today);
    // The reporting API rejects a range whose start is after its end. Leave
    // fresh posts for the next daily pass instead of recording a false error.
    if (publishedDate > endDate) return null;
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    url.searchParams.set('ids', 'channel==MINE');
    url.searchParams.set('startDate', publishedDate);
    url.searchParams.set('endDate', endDate);
    url.searchParams.set('metrics', YOUTUBE_METRICS.join(','));
    url.searchParams.set('dimensions', 'video');
    url.searchParams.set('filters', `video==${post.provider_post_id}`);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.status || 'YOUTUBE_ANALYTICS_FAILED');
    if (!body.rows?.length) return {};
    const row = body.rows[0];
    return Object.fromEntries(YOUTUBE_METRICS.map((name, index) => [name, Number(row[index + 1]) || 0]));
}

async function readInstagramMetrics(post, accessToken) {
    const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/${encodeURIComponent(post.provider_post_id)}/insights`);
    url.searchParams.set('metric', INSTAGRAM_METRICS.join(','));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) throw new Error(body?.error?.code ? `INSTAGRAM_INSIGHTS_${body.error.code}` : 'INSTAGRAM_ANALYTICS_FAILED');
    return Object.fromEntries((body.data || []).map(item => {
        const raw = item.total_value?.value ?? item.values?.[0]?.value;
        const value = Number(raw);
        return [item.name, Number.isFinite(value) ? value : null];
    }).filter(([, value]) => value !== null));
}

async function syncSocialAnalytics() {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const { data: posts, error } = await supabaseAdmin.from(POSTS).select('*')
        .eq('status', 'published').not('provider_post_id', 'is', null)
        .gte('published_at', cutoff).limit(500);
    if (error) throw new Error(`SOCIAL_ANALYTICS_POST_QUERY_FAILED: ${error.message}`);

    let synced = 0;
    let failed = 0;
    for (const post of posts || []) {
        try {
            const { accessToken } = await accessTokenFor(post.user_id, post.provider, Date.now());
            const metrics = post.provider === 'youtube'
                ? await readYouTubeMetrics(post, accessToken)
                : await readInstagramMetrics(post, accessToken);
            if (metrics === null) continue; // Not enough reporting history yet.
            const capturedAt = new Date().toISOString();
            const { error: saveError } = await supabaseAdmin.from(METRICS).upsert({
                user_id: post.user_id,
                publication_id: post.id,
                metric_date: utcDate(capturedAt),
                metrics,
                captured_at: capturedAt,
            }, { onConflict: 'publication_id,metric_date' });
            if (saveError) throw new Error(`METRICS_STORE_FAILED: ${saveError.message}`);
            const { error: updateError } = await supabaseAdmin.from(POSTS).update({
                analytics_last_synced_at: capturedAt, analytics_error: null,
            }).eq('id', post.id);
            if (updateError) throw new Error(`ANALYTICS_STATUS_STORE_FAILED: ${updateError.message}`);
            synced += 1;
        } catch (err) {
            failed += 1;
            await supabaseAdmin.from(POSTS).update({
                analytics_last_synced_at: new Date().toISOString(),
                analytics_error: String(err.message || 'ANALYTICS_FAILED').slice(0, 80),
            }).eq('id', post.id);
            console.warn(`[social analytics] ${post.provider} post ${post.id} sync failed: ${err.message}`);
        }
    }

    await pruneOldSnapshots(utcDate(Date.now() - 30 * 24 * 60 * 60_000));
    console.log(`[social analytics] sync complete: ${synced} synced, ${failed} failed`);
    return { synced, failed };
}

/**
 * Daily snapshots are kept 30 days, EXCEPT each post's latest one (R178).
 * Stats are only refreshed for 30 days after posting, so deleting everything
 * older than 30 days used to leave any post older than about two months with
 * no numbers at all, and the Planner showed it as never measured. The latest
 * snapshot holds the post's final running totals, which is what the table and
 * the lifetime figures need. Fails soft: a failed prune is logged, never thrown,
 * so it cannot break the sync that just ran.
 */
async function pruneOldSnapshots(retentionDate) {
    try {
        const { data: old, error } = await supabaseAdmin.from(METRICS)
            .select('publication_id,metric_date').lt('metric_date', retentionDate)
            .order('metric_date', { ascending: false }).limit(5000);
        if (error) throw new Error(error.message);
        if (!old?.length) return;
        const ids = [...new Set(old.map(r => r.publication_id))];
        const { data: recent, error: recentError } = await supabaseAdmin.from(METRICS)
            .select('publication_id').in('publication_id', ids).gte('metric_date', retentionDate).limit(5000);
        if (recentError) throw new Error(recentError.message);
        const hasRecent = new Set((recent || []).map(r => r.publication_id));
        const newestOld = new Map();
        for (const row of old) if (!newestOld.has(row.publication_id)) newestOld.set(row.publication_id, row.metric_date);
        for (const id of ids) {
            // With a newer snapshot, nothing old is needed; without one, keep the newest old one.
            const cutoff = hasRecent.has(id) ? retentionDate : newestOld.get(id);
            const { error: delError } = await supabaseAdmin.from(METRICS).delete().eq('publication_id', id).lt('metric_date', cutoff);
            if (delError) throw new Error(delError.message);
        }
    } catch (err) {
        console.warn('[social analytics] pruning old snapshots failed:', err.message);
    }
}

async function getUserAnalytics(userId) {
    const { data: posts, error } = await supabaseAdmin.from(POSTS)
        .select('id,provider,provider_post_id,source_short_id,title,caption,scheduled_at,published_at,edit_context,analytics_last_synced_at,analytics_error')
        .eq('user_id', userId).eq('status', 'published').not('provider_post_id', 'is', null)
        .order('published_at', { ascending: false }).limit(100);
    if (error) throw new Error(`SOCIAL_ANALYTICS_QUERY_FAILED: ${error.message}`);
    const ids = (posts || []).map(post => post.id);
    if (!ids.length) return { posts: [], recommendations: [], guidance: [], sampleCount: 0 };

    const [{ data: snapshots, error: snapshotError }, { data: recommendations, error: recommendationError }] = await Promise.all([
        supabaseAdmin.from(METRICS).select('publication_id,metric_date,metrics,captured_at')
            .eq('user_id', userId).in('publication_id', ids).order('metric_date', { ascending: false }).limit(4000),
        supabaseAdmin.from(RECOMMENDATIONS).select('id,provider,category,title,rationale,instruction,evidence,status,created_at')
            .eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
    ]);
    if (snapshotError) throw new Error(`SOCIAL_METRICS_QUERY_FAILED: ${snapshotError.message}`);
    if (recommendationError) throw new Error(`SOCIAL_RECOMMENDATIONS_QUERY_FAILED: ${recommendationError.message}`);
    const latest = new Map();
    const history = new Map();
    for (const row of snapshots || []) {
        if (!latest.has(row.publication_id)) latest.set(row.publication_id, row);
        if (!history.has(row.publication_id)) history.set(row.publication_id, []);
        history.get(row.publication_id).push({ date: row.metric_date, metrics: row.metrics || {} });
    }
    const enriched = (posts || []).map(post => ({
        id: post.id,
        provider: post.provider,
        shortId: post.source_short_id,
        title: post.title,
        publishedAt: post.published_at || post.scheduled_at,
        editContext: post.edit_context || {},
        metrics: latest.get(post.id)?.metrics || null,
        metricsCapturedAt: latest.get(post.id)?.captured_at || null,
        // R178: the daily running totals, oldest first, for the Planner's charts.
        history: (history.get(post.id) || []).slice().reverse(),
        analyticsError: post.analytics_error || null,
    }));
    const measured = enriched.filter(post => post.metrics);
    const guidance = (recommendations || []).filter(row => row.status === 'accepted').map(row => ({
        id: row.id, provider: row.provider, category: row.category, instruction: row.instruction,
    }));
    return { posts: enriched, recommendations: recommendations || [], guidance, sampleCount: measured.length };
}

module.exports = { syncSocialAnalytics, getUserAnalytics, pruneOldSnapshots, YOUTUBE_METRICS, INSTAGRAM_METRICS };
