// scripts/test_planner_r172.mjs — R172: the posting planner (calendar,
// reschedule, cancel, mark as posted) and feature-specific upgrade prompts.
//
// §1 the signed-media helpers (pure)
// §2 the REAL social router against an in-memory database and a stub queue
// §3 the calendar date logic (pure)
// §4 the upgrade-feature mapping (pure) and its copy in both languages
// §5 wiring: route, dashboard entries, every upgrade trigger names its feature
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'mock-anon-key';
process.env.TZ = 'Europe/Paris';

import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const HOUR = 3600_000, DAY = 24 * HOUR;

// ── §1 ──────────────────────────────────────────────────────────────────────
console.log('\n§1 signed media helpers');
const media = require('../services/social/scheduleMedia.js');
const now = Date.now();
ok(media.scheduleOutOfRange(now + 30_000, now) && !media.scheduleOutOfRange(now + 2 * 60_000, now), 'less than a minute ahead is refused, two minutes is fine');
ok(!media.scheduleOutOfRange(now + 6 * DAY, now) && media.scheduleOutOfRange(now + 7 * DAY, now), 'six days is fine, seven is past the signed-link lifetime');
ok(media.scheduleOutOfRange(NaN, now), 'an unparseable time is refused');
const opts = { userId: 'u1', bucketName: 'bkt' };
ok(media.objectPathFromMediaUrl('/api/proxy/gcs-media/exports/u1/a.mp4', opts) === 'exports/u1/a.mp4', 'editor path → object path');
ok(media.objectPathFromMediaUrl('https://storage.googleapis.com/bkt/exports/u1/a%20b.mp4?X-Goog-Signature=x', opts) === 'exports/u1/a b.mp4', 'path-style signed URL → object path (decoded)');
ok(media.objectPathFromMediaUrl('https://bkt.storage.googleapis.com/exports/u1/a.mp4?sig=1', opts) === 'exports/u1/a.mp4', 'virtual-hosted signed URL → object path');
ok(media.objectPathFromMediaUrl('https://storage.googleapis.com/bkt/exports/u2/a.mp4', opts) === null, "another user's export is refused");
ok(media.objectPathFromMediaUrl('https://storage.googleapis.com/other/exports/u1/a.mp4', opts) === null, 'another bucket is refused');
ok(media.objectPathFromMediaUrl('/api/proxy/gcs-media/exports/u1/../u2/a.mp4', opts) === null, 'path traversal is refused');
ok(media.objectPathFromMediaUrl('/api/proxy/gcs-media/raw/u1/a.mp4', opts) === null, 'a raw upload is not an export');

// ── §2 ──────────────────────────────────────────────────────────────────────
console.log('\n§2 the real router');
const db = { social_publications: [], social_publication_metrics: [] };
function builder(table) {
    const st = { table, filters: [], op: 'select', patch: null, order: null, limit: null, single: false };
    const rows = () => db[table].filter(r => st.filters.every(f => f(r)));
    const run = () => {
        if (st.op === 'update') {
            const hit = rows();
            for (const r of hit) Object.assign(r, st.patch);
            const data = hit.map(r => ({ ...r }));
            return { data: st.single ? (data[0] || null) : data, error: null };
        }
        let data = rows().map(r => ({ ...r }));
        if (st.order) data.sort((a, b) => (a[st.order.col] > b[st.order.col] ? 1 : -1) * (st.order.asc ? 1 : -1));
        if (st.limit) data = data.slice(0, st.limit);
        return { data: st.single ? (data[0] || null) : data, error: null };
    };
    const b = {
        select() { return b; },
        update(patch) { st.op = 'update'; st.patch = patch; return b; },
        eq(c, v) { st.filters.push(r => r[c] === v); return b; },
        neq(c, v) { st.filters.push(r => r[c] !== v); return b; },
        in(c, vs) { st.filters.push(r => vs.includes(r[c])); return b; },
        gte(c, v) { st.filters.push(r => r[c] >= v); return b; },
        lt(c, v) { st.filters.push(r => r[c] < v); return b; },
        order(col, { ascending = true } = {}) { st.order = { col, asc: ascending }; return b; },
        limit(n) { st.limit = n; return b; },
        maybeSingle() { st.single = true; return Promise.resolve(run()); },
        single() { st.single = true; return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
}
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('../config/database.js', { supabaseAdmin: { from: builder } });
const queue = { jobs: new Map(), active: new Set(), failAdd: false };
stub('../services/social/publicationQueue.js', {
    queue: {},
    enqueuePublication: async (pub, delay) => { if (queue.failAdd) throw new Error('redis down'); queue.jobs.set(pub.id, delay); },
    removePublicationJob: async (id) => { if (queue.active.has(id)) return false; queue.jobs.delete(id); return true; },
});
const signed = [];
stub('../config/storage.js', { bucket: { name: 'bkt', file: (path) => ({
    exists: async () => [!path.includes('gone')],
    getSignedUrl: async ({ expires }) => { signed.push({ path, expires }); return [`https://storage.googleapis.com/bkt/${path}?exp=${expires}`]; },
}) } });
const plans = { u_pro: 'pro', u_free: 'free', u_other: 'pro' };
stub('../middleware/auth.js', { authenticateUser: (req, res, next) => {
    const id = req.headers['x-user'];
    if (!id) return res.status(401).json({ error: 'AUTH' });
    req.user = { id }; next();
} });
stub('../middleware/usageGate.js', {
    aiGate: (req, res, next) => next(),
    getUserPlan: async (id) => plans[id] || 'free',
    requirePlan: (min) => (req, res, next) => (plans[req.user?.id] === 'pro' || min !== 'pro' ? next()
        : res.status(402).json({ error: 'SOCIAL_PRO', upgradeRequired: 'pro' })),
});
stub('../services/social/accessToken.js', { accessTokenFor: async () => ({ accessToken: 't' }) });
stub('../services/social/analytics.js', { getUserAnalytics: async () => ({ posts: [] }) });
stub('../services/AIProvider.js', { getAIClient: () => null, isAIConfigured: () => false, resolveModel: (m) => m, resolveProvider: () => 'openai' });
stub('../services/motionProvider.js', { executeChatCompletionWithFailover: async () => ({}) });

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/social', require('../routes/socialRoutes.js'));
const server = http.createServer(app);
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/api/social`;
const call = async (method, path, user, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
};
const iso = (ms) => new Date(ms).toISOString();
const row = (over) => ({
    id: over.id, user_id: 'u_pro', provider: 'youtube', title: 'T', caption: '', source_short_id: 's1',
    media_url: 'https://storage.googleapis.com/bkt/exports/u_pro/a.mp4?old', scheduled_at: iso(now + 2 * DAY),
    status: 'scheduled', provider_post_id: null, failure_code: null, reminder_seen_at: null, published_at: null,
    created_at: iso(now), ...over,
});
db.social_publications.push(
    row({ id: 'p1' }),
    row({ id: 'p2', status: 'published', provider_post_id: 'yt1', published_at: iso(now - DAY), scheduled_at: iso(now - DAY) }),
    row({ id: 'p3', status: 'manual_reminder', media_url: '', scheduled_at: iso(now - 2 * HOUR) }),
    row({ id: 'p4', status: 'cancelled' }),
    row({ id: 'p5', user_id: 'u_other' }),
    row({ id: 'p6', media_url: 'https://storage.googleapis.com/bkt/exports/u_pro/gone.mp4?x' }),
    row({ id: 'p7', media_url: 'https://storage.googleapis.com/bkt/exports/u_other/a.mp4?x' }),
    row({ id: 'p8', user_id: 'u_free' }),
);
db.social_publication_metrics.push(
    { publication_id: 'p2', user_id: 'u_pro', metric_date: '2026-11-20', metrics: { views: 10 } },
    { publication_id: 'p2', user_id: 'u_pro', metric_date: '2026-11-24', metrics: { views: 420, likes: 12 } },
);

const range = `?from=${encodeURIComponent(iso(now - 10 * DAY))}&to=${encodeURIComponent(iso(now + 10 * DAY))}`;
let r = await call('GET', '/calendar' + range, 'u_pro');
const ids = (r.body.publications || []).map(p => p.id).sort();
ok(r.status === 200 && ids.join() === 'p1,p2,p3,p6,p7', `calendar lists the user's posts in range, not cancelled or others' (${ids})`);
const p2 = r.body.publications.find(p => p.id === 'p2');
ok(p2?.metrics?.views === 420 && r.body.metricsIncluded === true, 'Pro: a published post carries its LATEST metrics snapshot');
r = await call('GET', '/calendar' + range, 'u_free');
ok(r.status === 200 && r.body.publications.length === 1 && !r.body.publications[0].metrics && r.body.metricsIncluded === false, 'below Pro the calendar still opens (to manage queued posts) without metrics');
ok((await call('GET', `/calendar?from=${iso(now)}&to=${iso(now + 200 * DAY)}`, 'u_pro')).status === 400, 'a range over 100 days is refused');
ok((await call('GET', '/calendar?from=x&to=y', 'u_pro')).status === 400, 'an unparseable range is refused');
ok((await call('GET', '/calendar' + range)).status === 401, 'no user is 401');

const target = now + 4 * DAY;
queue.jobs.set('p1', 2 * DAY);
r = await call('PATCH', '/publications/p1', 'u_pro', { scheduledAt: iso(target) });
const p1 = db.social_publications.find(p => p.id === 'p1');
ok(r.status === 200 && p1.scheduled_at === iso(target), 'reschedule moves the post');
ok(Math.abs(queue.jobs.get('p1') - (target - Date.now())) < 5000, 'the queued job is replaced with the new delay');
ok(signed.at(-1)?.path === 'exports/u_pro/a.mp4' && signed.at(-1).expires === target + 12 * HOUR && p1.media_url.includes(`exp=${target + 12 * HOUR}`), 'the media link is re-signed to expire 12 h after the NEW time');
ok(p1.reminder_at === iso(target - DAY) && p1.reminder_seen_at === null, 'the reminder moves with it and shows again');
ok(r.body.publication?.scheduledAt === iso(target), 'the response is the moved post');
ok((await call('PATCH', '/publications/p1', 'u_pro', { scheduledAt: iso(now + 8 * DAY) })).status === 400, 'a time past six and a half days is refused');
ok((await call('PATCH', '/publications/p5', 'u_pro', { scheduledAt: iso(target) })).status === 404, "someone else's post reads as not found");
ok((await call('PATCH', '/publications/p2', 'u_pro', { scheduledAt: iso(target) })).status === 409, 'a published post cannot be rescheduled');
r = await call('PATCH', '/publications/p6', 'u_pro', { scheduledAt: iso(target) });
ok(r.status === 409 && r.body.error === 'MEDIA_UNAVAILABLE' && db.social_publications.find(p => p.id === 'p6').scheduled_at !== iso(target), 'export gone from storage: refused, post untouched');
r = await call('PATCH', '/publications/p7', 'u_pro', { scheduledAt: iso(target) });
ok(r.status === 409 && r.body.error === 'MEDIA_UNAVAILABLE', "a stored link into another user's exports is never re-signed");
ok((await call('PATCH', '/publications/p8', 'u_free', { scheduledAt: iso(target) })).status === 402, 'rescheduling is a Pro action (402 below Pro)');
queue.active.add('p1');
r = await call('PATCH', '/publications/p1', 'u_pro', { scheduledAt: iso(now + 3 * DAY) });
ok(r.status === 409 && r.body.error === 'PUBLICATION_ALREADY_RUNNING' && p1.scheduled_at === iso(target), 'a post being published right now is not moved');
queue.active.delete('p1');
queue.failAdd = true;
r = await call('PATCH', '/publications/p1', 'u_pro', { scheduledAt: iso(now + 3 * DAY) });
ok(r.status === 503 && p1.status === 'failed' && p1.failure_code === 'QUEUE_UNAVAILABLE', 'queue down after the move: the post is marked failed, not silently lost');
queue.failAdd = false;

r = await call('POST', '/publications/p3/posted', 'u_free');
ok(r.status === 404 || r.status === 409, "marking someone else's post does nothing");
r = await call('POST', '/publications/p3/posted', 'u_pro');
const p3 = db.social_publications.find(p => p.id === 'p3');
ok(r.status === 200 && p3.status === 'published' && p3.published_at && r.body.publication?.postedManually === true, 'mark as posted: published, flagged as posted by hand');
ok((await call('POST', '/publications/p3/posted', 'u_pro')).status === 409, 'a second mark is refused (nothing to change)');
ok((await call('POST', '/publications/p2/posted', 'u_pro')).status === 409, 'an automatically published post cannot be "marked as posted"');

server.close();

console.log('\n§2b route shape');
const routes = code('../routes/socialRoutes.js');
ok(/router\.patch\('\/publications\/:id', authenticateUser, socialGate,/.test(routes), 'PATCH /publications/:id is auth + Pro');
ok(/router\.post\('\/publications\/:id\/posted', authenticateUser, async/.test(routes), 'mark as posted stays open below Pro (cleanup)');
ok(/router\.get\('\/calendar', authenticateUser, async/.test(routes), 'the calendar read stays open below Pro');
ok(!/enqueuePublication\(row, 0/.test(routes) && /enqueuePublication\(row, Date\.parse\(row\.scheduled_at\) - Date\.now\(\)\)/.test(routes), 'a failed update puts the job back at its ORIGINAL time, never "now"');

// ── §3 ──────────────────────────────────────────────────────────────────────
console.log('\n§3 calendar date logic');
const cal = await import('../client/src/lib/socialCalendar.js');
const grid = cal.monthGrid(2026, 10); // November 2026, starts on a Sunday
ok(grid.length === 42 && grid[0].key === '2026-10-26' && grid[6].key === '2026-11-01', 'weeks start Monday; Nov 2026 opens on Mon 26 Oct');
ok(grid.filter(d => d.inMonth).length === 30, 'every day of the month is in the grid exactly once');
const rg = cal.gridRange(2026, 10);
ok(Date.parse(rg.to) - Date.parse(rg.from) === 42 * DAY - HOUR || Date.parse(rg.to) - Date.parse(rg.from) === 42 * DAY, 'the fetched range covers the 6 visible weeks');
const moved = cal.moveToDay('2026-11-03T17:30:00.000Z', '2026-11-10');
ok(new Date(moved).getHours() === new Date('2026-11-03T17:30:00.000Z').getHours() && cal.dayKey(moved) === '2026-11-10', 'drag to another day keeps the local time of day');
const by = cal.groupByDay([
    { id: 'b', status: 'scheduled', scheduledAt: '2026-11-03T18:00:00Z' },
    { id: 'a', status: 'scheduled', scheduledAt: '2026-11-03T08:00:00Z' },
    { id: 'c', status: 'published', scheduledAt: '2026-11-01T08:00:00Z', publishedAt: '2026-11-02T09:00:00Z' },
]);
ok(by.get('2026-11-03').map(p => p.id).join() === 'a,b', 'a day lists its posts in time order');
ok(by.get('2026-11-02')?.[0]?.id === 'c' && !by.has('2026-11-01'), 'a published post sits on the day it went out');
ok(cal.canScheduleAt(new Date(Date.now() + DAY).toISOString()) && !cal.canScheduleAt(new Date(Date.now() - HOUR).toISOString()) && !cal.canScheduleAt(new Date(Date.now() + 7 * DAY).toISOString()), 'the client checks the same window as the server');
const a = (s, isPro = true) => cal.postActions({ status: s }, { isPro });
ok(a('scheduled').reschedule && a('scheduled').cancel && !a('scheduled').markPosted, 'scheduled: move and cancel');
ok(!a('scheduled', false).reschedule && a('scheduled', false).cancel, 'below Pro: cancel, but not move');
ok(a('manual_reminder').markPosted && a('failed').markPosted && !a('manual_reminder').cancel, 'post-by-hand and failed: mark as posted');
ok(!a('published').reschedule && !a('published').cancel && !a('published').markPosted, 'published: read only');
ok(cal.localInputValue('bad') === '' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(cal.localInputValue(Date.now())), 'datetime-local value');
const serverMedia = media.MAX_LEAD_MS === cal.MAX_LEAD_MS && media.MIN_LEAD_MS === cal.MIN_LEAD_MS;
ok(serverMedia, 'client and server agree on the scheduling window');

// ── §4 ──────────────────────────────────────────────────────────────────────
console.log('\n§4 upgrade features');
const uf = await import('../client/src/lib/upgradeFeatures.js');
ok(uf.featureFromPayload({ reason: 'paid_feature', feature: 'shorts' }) === 'shorts', 'an explicit feature wins');
ok(uf.featureFromPayload({ error: 'STOCK_MEDIA_PAID' }) === 'stock' && uf.featureFromPayload({ code: 'SOCIAL_PRO' }) === 'social' && uf.featureFromPayload({ code: 'DESIGN_STUDIO_PRO' }) === 'designStudio', 'server 402 codes map to features');
ok(uf.featureFromPayload({ reason: 'ai_ops' }) === 'aiOps' && uf.featureFromPayload({ reason: 'auto_trial' }) === 'autoTrial' && uf.featureFromPayload({ reason: 'projects' }) === 'projects', 'quota reasons map to features');
ok(uf.featureFromPayload({ reason: 'paid_feature' }) === null && uf.featureFromPayload({ feature: 'nope' }) === null, 'an unnamed or unknown feature falls back to the generic sheet');
ok(uf.planForFeature('social', { upgradeTo: 'creator', currentPlan: 'free' }) === 'pro', 'a Pro feature never offers Creator');
ok(uf.planForFeature('shorts', { currentPlan: 'free' }) === 'creator', 'a Creator feature offers Creator to Free');
ok(uf.planForFeature('aiOps', { upgradeTo: 'creator', currentPlan: 'creator' }) === 'pro', 'never offers the plan the user already has');
ok(uf.otherPlanFeatures(['Everything in Creator', 'Design Studio: x', 'Unlimited AI'], ['design studio']).join() === 'Unlimited AI', 'the "also in" list drops the header and what the feature already covers');
for (const lang of ['en', 'fr']) {
    const c = JSON.parse(read(`../client/src/locales/${lang}/common.json`));
    const missing = Object.keys(uf.UPGRADE_FEATURES).filter(k => {
        const f = c.upgradeFeatures?.[k];
        return !f || !f.title || !f.body || !f.without || !Array.isArray(f.gains) || f.gains.length < 3 || !Array.isArray(f.overlap);
    });
    ok(missing.length === 0 && c.upgradeFeatures.youGet && c.upgradeFeatures.without && c.upgradeFeatures.alsoIn, `${lang}: every feature has a title, what it does, 3+ gains and what still works (${missing})`);
    ok(c.planLock?.planner?.title && c.planLock?.planner?.body, `${lang}: the Planner has a Pro lock`);
    const text = JSON.stringify(c.upgradeFeatures);
    ok(!/—/.test(text), `${lang}: no em dashes in the copy`);
}
const en = JSON.parse(read('../client/src/locales/en/dashboard.json')).planner;
const fr = JSON.parse(read('../client/src/locales/fr/dashboard.json')).planner;
const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
ok(en && fr && keys(en).join() === keys(fr).join(), 'planner copy has the same keys in English and French');
const plannerSrc = read('../client/src/pages/PlannerPage.jsx');
const used = [...plannerSrc.matchAll(/t\('planner\.([a-zA-Z_.]+)'/g)].map(m => m[1]);
const flat = new Set(keys(en));
const plural = (k) => flat.has(`${k}_one`) && flat.has(`${k}_other`);
ok(used.every(k => flat.has(k) || plural(k)), `every planner key the page uses exists (${used.filter(k => !flat.has(k) && !plural(k))})`);

// ── §5 ──────────────────────────────────────────────────────────────────────
console.log('\n§5 wiring');
ok(/path="\/planner"\s+element=\{<PlannerPage \/>\}/.test(read('../client/src/App.jsx')), '/planner is routed');
const dash = read('../client/src/pages/DashboardPage.jsx');
ok((dash.match(/navigate\('\/planner'\)/g) || []).length >= 3, 'dashboard header, mobile menu and mobile home all reach the Planner');
ok(/onPlanner/.test(read('../client/src/components/MobileHome.jsx')), 'mobile home has a Planner row');
ok(/ProFeatureLock feature="planner"/.test(plannerSrc), 'the Planner shows its Pro lock below Pro');
const sheet = read('../client/src/components/PlanSheet.jsx');
ok(/featureFromPayload\(/.test(sheet) && /<UpgradeFeatureDetails/.test(sheet), 'the mobile sheet explains the refused feature');
const modal = read('../client/src/components/UpgradeModal.jsx');
ok(/<UpgradeFeatureDetails/.test(modal) && /feature=\{featureProp\}/.test(modal) && /startCheckout\(targetPlan\)/.test(modal), 'desktop modal too, passes the feature to mobile, checks out the right plan');
ok(/<UpgradeFeatureDetails/.test(read('../client/src/components/ProFeatureLock.jsx')), 'the Pro lock lists what the plan adds');
const ide = read('../client/src/layouts/IDELayout.jsx');
ok(/feature: payload\?\.feature/.test(ide) && /feature=\{quotaModal\.feature\}/.test(ide), 'the editor forwards the feature to the modal');
ok(/feature=\{limitInfo\?\.feature\}/.test(read('../client/src/components/MobileFlow.jsx')) && /feature: info\.feature/.test(read('../client/src/store/useMobileFlowStore.js')), 'the guided mobile flow forwards it too');
const emitters = [
    ['../client/src/components/ShortsPanel.jsx', 'shorts'], ['../client/src/layouts/IDELayout.jsx', 'shorts'],
    ['../client/src/components/AssetPanel.jsx', 'stock'], ['../client/src/agent/VideoEditorTools.js', 'stock'],
];
for (const [file, feat] of emitters) {
    const blocks = read(file).split('EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED').slice(1).filter(b => /reason: 'paid_feature'/.test(b.slice(0, 300)));
    ok(blocks.length > 0 && blocks.every(b => new RegExp(`feature: '${feat}'`).test(b.slice(0, 300))), `${file.split('/').pop()}: every paid-feature prompt names '${feat}' (${blocks.length})`);
}
const picker = read('../client/src/components/Assistant/EditingStylePicker.jsx');
ok(/feature: 'editingStyles'/.test(picker) && /feature: 'autoMode'/.test(picker), 'editing styles and Auto mode name themselves');
for (const f of ['../client/src/agent/TranscriptionManager.js', '../client/src/agent/MediaExecutionEngine.js', '../client/src/lib/aiRequestError.js']) {
    ok(/code: (errorData|body|errorBody)\?\.error/.test(read(f)), `${f.split('/').pop()}: server 402s carry their code`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log('ALL PLANNER CHECKS PASSED');
