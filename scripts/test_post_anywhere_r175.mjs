// scripts/test_post_anywhere_r175.mjs — R175: publish or schedule from the
// Export complete screen and from the Planner ("New post"), any export, and
// exports kept until their post has gone out.
//
// §1 the format rules (pure)
// §2 the REAL social router: publish now, the exports list, the Pro gate
// §3 the REAL deletion code: scheduled exports kept, orphans still cleaned
// §4 wiring and copy
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'mock-anon-key';

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const DAY = 86_400_000;

// ── §1 ──────────────────────────────────────────────────────────────────────
console.log('\n§1 format rules');
const F = await import('../client/src/lib/socialFormat.js');
const f = (w, h, d) => F.postFormat({ width: w, height: h, duration: d });
ok(f(1080, 1920, 45).youtube === 'short' && f(1080, 1080, 60).youtube === 'short', 'vertical or square, 3 min or less → YouTube Short');
ok(f(1080, 1920, 200).youtube === 'video' && f(1920, 1080, 30).youtube === 'video', 'longer than 3 min or landscape → regular YouTube video');
ok(f(1080, 1920, 45).instagram === 'ok' && f(1920, 1080, 45).instagram === 'bars', 'Instagram: vertical fine, landscape shows with bars (not refused)');
ok(f(1080, 1920, 16 * 60).instagram === 'tooLong', 'Instagram refuses Reels over 15 minutes');
ok(F.postFormat({}).youtube === null && F.postFormat({}).instagram === null, 'unknown size and length: no guess');
ok(F.postFormat({ width: 1080, height: 1920 }).youtube === 'short', 'size known, length not yet: vertical reads as a Short');
ok(F.parseResolution('1920x1080').width === 1920 && F.parseResolution(' 1080 x 1920 ').height === 1920 && !F.parseResolution('?').width, 'export metadata resolution parses');
ok(F.isPostableExport('/api/proxy/gcs-media/exports/u1/p1/job.mp4') && !F.isPostableExport('/uploads/exports/job.mp4') && !F.isPostableExport('/api/proxy/gcs-media/exports/u1/x.zip'), 'only cloud video exports can be posted');

// ── §2 ──────────────────────────────────────────────────────────────────────
console.log('\n§2 the real router');
const db = {
    social_publications: [],
    projects: [
        { id: 'p1', user_id: 'u_pro', name: 'Launch video' },
        { id: 'p2', user_id: 'u_other', name: 'Not mine' },
    ],
};
let nextId = 1;
function builder(table) {
    const st = { filters: [], op: 'select', patch: null, single: false, order: null, limit: null };
    const rows = () => db[table].filter(r => st.filters.every(fn => fn(r)));
    const run = () => {
        if (st.op === 'insert') {
            const row = { id: `pub${nextId++}`, created_at: new Date().toISOString(), ...st.patch };
            db[table].push(row);
            return { data: st.single ? { ...row } : [{ ...row }], error: null };
        }
        if (st.op === 'update') {
            const hit = rows(); for (const r of hit) Object.assign(r, st.patch);
            return { data: st.single ? (hit[0] || null) : hit, error: null };
        }
        let data = rows().map(r => ({ ...r }));
        if (st.limit) data = data.slice(0, st.limit);
        return { data: st.single ? (data[0] || null) : data, error: null };
    };
    const b = {
        select() { return b; }, order() { return b; }, limit(n) { st.limit = n; return b; },
        insert(row) { st.op = 'insert'; st.patch = row; return b; },
        update(p) { st.op = 'update'; st.patch = p; return b; },
        eq(c, v) { st.filters.push(r => r[c] === v); return b; },
        neq(c, v) { st.filters.push(r => r[c] !== v); return b; },
        in(c, vs) { st.filters.push(r => vs.includes(r[c])); return b; },
        gte() { return b; }, lt() { return b; },
        maybeSingle() { st.single = true; return Promise.resolve(run()); },
        single() { st.single = true; return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
}
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('../config/database.js', { supabaseAdmin: { from: builder } });
const queued = [];
stub('../services/social/publicationQueue.js', { queue: {}, enqueuePublication: async (pub, delay) => { queued.push({ id: pub.id, delay }); }, removePublicationJob: async () => true });
const t0 = Date.now();
const gcsFiles = [
    { name: 'exports/u_pro/p1/old.mp4', metadata: { size: '1000', timeCreated: new Date(t0 - 3 * DAY).toISOString() } },
    { name: 'exports/u_pro/p1/new.mp4', metadata: { size: '2000', timeCreated: new Date(t0 - DAY).toISOString() } },
    { name: 'exports/u_pro/loose.mov', metadata: { size: '3000', timeCreated: new Date(t0 - 2 * DAY).toISOString() } },
    { name: 'exports/u_pro/p1/_revideo-base-x.mp4', metadata: { timeCreated: new Date(t0).toISOString() } },
    { name: 'exports/u_pro/p1/frames.zip', metadata: { timeCreated: new Date(t0).toISOString() } },
    { name: 'exports/u_pro/p2/sneaky.mp4', metadata: { timeCreated: new Date(t0 - 5 * DAY).toISOString() } },
];
const storage = { useLocalStorage: false, bucket: {
    name: 'bkt',
    getFiles: async ({ prefix }) => [gcsFiles.filter(x => x.name.startsWith(prefix))],
    file: (p) => ({ exists: async () => [true], getSignedUrl: async ({ expires }) => [`https://storage.googleapis.com/bkt/${p}?exp=${expires}`] }),
} };
stub('../config/storage.js', storage);
const plans = { u_pro: 'pro', u_free: 'free' };
stub('../middleware/auth.js', { authenticateUser: (req, res, next) => { const id = req.headers['x-user']; if (!id) return res.status(401).end(); req.user = { id }; next(); } });
stub('../middleware/usageGate.js', {
    aiGate: (q, r, n) => n(), getUserPlan: async (id) => plans[id] || 'free',
    requirePlan: (min) => (req, res, next) => (plans[req.user?.id] === 'pro' || min !== 'pro' ? next() : res.status(402).json({ error: 'SOCIAL_PRO', upgradeRequired: 'pro' })),
});
stub('../services/social/accounts.js', { listAccounts: async () => [{ provider: 'youtube', needsReconnect: false }] });
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
const call = async (method, p, user, body) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
};

const media = '/api/proxy/gcs-media/exports/u_pro/p1/new.mp4';
let r = await call('POST', '/publications', 'u_pro', { provider: 'youtube', mediaUrl: media, title: 'Hi', publishNow: true, shortId: 'export:new.mp4' });
ok(r.status === 201 && queued.at(-1)?.delay === 0, 'publish now: queued with no delay');
const created = db.social_publications.at(-1);
ok(created && Math.abs(Date.parse(created.scheduled_at) - Date.now()) < 5000 && created.source_short_id === 'export:new.mp4', 'its time is now, and it is tied to the export');
ok(/exp=/.test(created.media_url), 'the export is signed for the platform to fetch');
r = await call('POST', '/publications', 'u_pro', { provider: 'youtube', mediaUrl: media, title: 'Hi', scheduledAt: new Date(Date.now() + 10_000).toISOString() });
ok(r.status === 400, 'a normal schedule still needs at least a minute');
r = await call('POST', '/publications', 'u_pro', { provider: 'youtube', mediaUrl: media, title: 'Hi', publishNow: 'yes' });
ok(r.status === 400, 'only publishNow === true skips the time check');
ok((await call('POST', '/publications', 'u_free', { provider: 'youtube', mediaUrl: media, title: 'Hi', publishNow: true })).status === 402, 'publishing now is a Pro action too');

r = await call('GET', '/exports', 'u_pro');
const names = (r.body.exports || []).map(e => e.name);
ok(r.status === 200 && names.join() === 'new.mp4,loose.mov,old.mp4,sneaky.mp4', `exports newest first, videos only, no Revideo base (${names})`);
const byName = Object.fromEntries((r.body.exports || []).map(e => [e.name, e]));
ok(byName['new.mp4']?.projectName === 'Launch video' && byName['loose.mov']?.projectName === null, 'project names come from the user\'s own projects');
ok(byName['sneaky.mp4']?.projectName === null, "another user's project name is never shown");
ok(byName['new.mp4']?.mediaUrl === '/api/proxy/gcs-media/exports/u_pro/p1/new.mp4', 'each export carries the URL the publisher accepts');
ok((await call('GET', '/exports', 'u_free')).status === 402, 'listing exports to post is Pro');
ok((await call('GET', '/exports')).status === 401, 'no user is 401');
storage.useLocalStorage = true;
r = await call('GET', '/exports', 'u_pro');
ok(r.status === 200 && r.body.storageUnavailable === true && r.body.exports.length === 0, 'no cloud storage: says so instead of an empty list');
storage.useLocalStorage = false;
server.close();

// ── §3 ──────────────────────────────────────────────────────────────────────
console.log('\n§3 exports are kept until posted');
const SE = require('../services/social/scheduledExports.js');
const pubDb = (rows, fail = false) => ({ from: () => {
    const st = { filters: [] };
    const b = {
        select() { return b; },
        in(c, vs) { st.filters.push(r => vs.includes(r[c])); return b; },
        eq(c, v) { st.filters.push(r => r[c] === v); return b; },
        then(res, rej) { return Promise.resolve(fail ? { data: null, error: { message: 'down' } } : { data: rows.filter(r => st.filters.every(fn => fn(r))), error: null }).then(res, rej); },
    };
    return b;
} });
const rows = [
    { user_id: 'u1', status: 'scheduled', media_url: 'https://storage.googleapis.com/bkt/exports/u1/p1/a.mp4?sig' },
    { user_id: 'u1', status: 'published', media_url: '' },
    { user_id: 'u1', status: 'cancelled', media_url: 'https://storage.googleapis.com/bkt/exports/u1/p1/c.mp4?sig' },
    { user_id: 'u2', status: 'publishing', media_url: 'https://storage.googleapis.com/bkt/exports/u2/p9/b.mp4?sig' },
    { user_id: 'u1', status: 'scheduled', media_url: 'https://storage.googleapis.com/bkt/exports/u2/p9/b.mp4?sig' },
];
let paths = await SE.scheduledExportPaths(pubDb(rows), 'u1', 'bkt');
ok(paths.has('exports/u1/p1/a.mp4') && paths.size === 1, 'one user: only their pending posts, and never a path into another user\'s folder');
paths = await SE.scheduledExportPaths(pubDb(rows), null, 'bkt');
ok(paths.has('exports/u2/p9/b.mp4') && paths.has('exports/u1/p1/a.mp4') && !paths.has('exports/u1/p1/c.mp4'), 'everyone (retention): scheduled and publishing, not cancelled or done');
ok(await SE.exportProtection(pubDb(rows, true), 'u1', 'bkt') === 'all-exports', 'unreadable: protect every export rather than guess');
ok(SE.isProtected('exports/u/p/x.mp4', 'all-exports') && !SE.isProtected('raw/u/x.mov', 'all-exports'), "'all-exports' protects exports only, not uploads");

const { deleteProjectFiles } = require('../services/projectFiles.js');
const deleted = [];
const fakeBucket = {
    file: (p) => ({ delete: async () => { deleted.push(p); } }),
    getFiles: async ({ prefix }) => [['exports/u1/p1/a.mp4', 'exports/u1/p1/z.mp4'].filter(n => n.startsWith(prefix)).map(n => ({ name: n, delete: async () => { deleted.push(n); } }))],
};
const project = { id: 'p1', user_id: 'u1', timeline_state: { assets: [] } };
const rep1 = await deleteProjectFiles(fakeBucket, project, [], { userId: 'u1', protect: new Set(['exports/u1/p1/a.mp4']) });
ok(!deleted.includes('exports/u1/p1/a.mp4') && deleted.includes('exports/u1/p1/z.mp4') && rep1.kept.includes('exports/u1/p1/a.mp4'), 'deleting a project keeps the export a post is waiting for, deletes the rest');
deleted.length = 0;
await deleteProjectFiles(fakeBucket, project, [], { userId: 'u1', protect: 'all-exports' });
ok(!deleted.some(p => p.startsWith('exports/')), "with 'all-exports', no export is deleted");
deleted.length = 0;
await deleteProjectFiles(fakeBucket, project, [], { userId: 'u1' });
ok(deleted.includes('exports/u1/p1/a.mp4'), 'without protection, behaviour is unchanged');

const { findStrayFiles } = require('../services/retentionJob.js');
const now = Date.now();
const old = new Date(now - 40 * DAY).toISOString();
const strayBucket = { getFiles: async ({ prefix }) => [[
    { name: 'exports/u1/live/x.mp4', metadata: { timeCreated: old } },
    { name: 'exports/u1/gone/y.mp4', metadata: { timeCreated: old } },
    { name: 'exports/u1/loose.mp4', metadata: { timeCreated: old } },
].filter(x => x.name.startsWith(prefix))] };
const strayDb = { from: (table) => {
    const b = {
        select() { return b; }, eq() { return b; },
        maybeSingle: async () => ({ data: { id: 'u1', plan: 'free', plan_expires_at: null }, error: null }),
        then(res, rej) { return Promise.resolve({ data: table === 'projects' ? [{ id: 'live', user_id: 'u1', timeline_state: {} }] : [], error: null }).then(res, rej); },
    };
    return b;
} };
const strays = (await findStrayFiles({ db: strayDb, bucket: strayBucket, now })).map(x => x.name).sort();
ok(strays.join() === 'exports/u1/gone/y.mp4,exports/u1/loose.mp4', `clean-up: a deleted project's export is now removed, a live project's is kept (${strays})`);
const retention = read('services/retentionJob.js');
ok(/deleteProjectFiles\(bucket, full, others \|\| \[\], \{ userId: p\.user_id, dryRun, protect \}\)/.test(retention) && /filter\(f => !isProtected\(f\.name, protect\)\)/.test(retention), 'the retention run passes the protection to both deletion passes');
ok(/exportProtection\(supabaseAdmin, userId/.test(read('routes/projectRoutes.js')), 'deleting a project from the dashboard uses it too');

// ── §4 ──────────────────────────────────────────────────────────────────────
console.log('\n§4 wiring and copy');
const pub = read('client/src/components/SocialPublisher.jsx');
ok(/publishNow: true/.test(pub) && /submit\(true\)/.test(pub), 'the publisher has Publish now');
ok(/post\.shortId === sourceKey/.test(pub) && !/post\.shortId === short\?\.id/.test(pub), 'its post list follows the source (short or export)');
ok(/blocked = provider === 'instagram' && format\.instagram === 'tooLong'/.test(pub), 'a Reel over 15 minutes cannot be sent');
ok(/<ExportPublish result=\{exportResult\} \/>/.test(read('client/src/components/ExportModal.jsx')), 'desktop Export complete screen has it');
ok(/<ExportPublish result=\{result\} \/>/.test(read('client/src/components/MobileExportSheet.jsx')), 'mobile export sheet has it');
const ep = read('client/src/components/ExportPublish.jsx');
ok(/plan !== 'pro'/.test(ep) && /ProFeatureLock feature="social"/.test(ep), 'below Pro it shows the Pro lock');
const planner = read('client/src/pages/PlannerPage.jsx');
ok(/function NewPostDialog/.test(planner) && /authFetch\('\/api\/social\/exports'\)/.test(planner) && /<SocialPublisher/.test(planner), 'the Planner has New post: pick an export, then the publisher');
ok(/onClick=\{\(\) => navigate\('\/dashboard'\)\}/.test(read('client/src/pages/UserStylePage.jsx')) && (read('client/src/pages/UserStylePage.jsx').match(/<BackToProjects \/>/g) || []).length === 4, 'Style page: a Projects button on every state');
for (const lang of ['en', 'fr']) {
    const ed = JSON.parse(read(`client/src/locales/${lang}/editor.json`)).socialPublisher;
    const da = JSON.parse(read(`client/src/locales/${lang}/dashboard.json`)).planner;
    const need = ['exportTitle', 'notPostable', 'publishNow', 'publishing', 'titleRequired', 'formatShort', 'formatVideo', 'reelBars', 'reelTooLong'];
    const needP = ['newPost', 'postCreated', 'pickExport', 'loadingExports', 'exportsError', 'noCloud', 'noExports', 'otherVideo'];
    ok(need.every(k => ed?.[k]) && needP.every(k => da?.[k]), `${lang}: all new copy present`);
    ok(!/—/.test(JSON.stringify(need.map(k => ed[k])) + JSON.stringify(needP.map(k => da[k]))), `${lang}: no em dashes`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log('ALL POST-ANYWHERE CHECKS PASSED');
