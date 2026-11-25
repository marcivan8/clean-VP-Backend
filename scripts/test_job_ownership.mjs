// scripts/test_job_ownership.mjs — R97: job status is readable by its owner only.
//
// Mounts the REAL routes/jobRoutes.js on an express app, with the BullMQ
// queues and the auth middleware stubbed, and has two users try to read each
// other's jobs. Then checks that every route that queues a job records the
// owner the status check needs.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const Module = require('module');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

// ── Stubs ────────────────────────────────────────────────────────────────────
const JOBS = {
    '41': { data: { userId: 'alice' }, state: 'completed', returnvalue: { words: ['alice secret transcript'] } },
    '42': { data: { userId: 'bob' },   state: 'completed', returnvalue: { words: ['bob secret transcript'] } },
    '43': { data: {},                  state: 'completed', returnvalue: { leak: 'ownerless' } },
    '44': { data: { userId: 'alice' }, state: 'failed',    failedReason: 'boom' },
};
const fakeQueue = {
    getJob: async (id) => {
        const j = JOBS[id];
        if (!j) return null;
        return { ...j, progress: 0, getState: async () => j.state };
    },
};
const empty = { getJob: async () => null };
const stubs = {
    [path.join(root, 'queue/queues.js')]: { videoQueue: fakeQueue, audioQueue: empty, analysisQueue: empty, exportQueue: empty, visionQueue: empty },
    [path.join(root, 'queue/connection.js')]: { connection: {} },
    [path.join(root, 'middleware/auth.js')]: {
        // Bearer <userId> stands in for a verified Supabase token.
        authenticateUser: (req, res, next) => {
            const h = req.headers.authorization || '';
            if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'No valid authorization header' });
            req.user = { id: h.slice(7) };
            next();
        },
        optionalAuth: (req, res, next) => {
            const h = req.headers.authorization || '';
            if (h.startsWith('Bearer ')) req.user = { id: h.slice(7) };
            next();
        },
    },
};
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    let resolved;
    try { resolved = origResolve.call(this, request, parent, isMain); } catch { return origLoad.apply(this, arguments); }
    if (stubs[resolved]) return stubs[resolved];
    if (request === 'bullmq') return { Queue: function () { return empty; } };
    return origLoad.apply(this, arguments);
};

const express = require('express');
const http = require('http');

async function mount(env) {
    process.env.NODE_ENV = env;
    delete require.cache[path.join(root, 'routes/jobRoutes.js')];
    const router = require(path.join(root, 'routes/jobRoutes.js'));
    const app = express();
    app.use(express.json());
    app.use('/api/jobs', router);
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, url, user, body) => {
        const headers = { 'content-type': 'application/json' };
        if (user) headers.authorization = `Bearer ${user}`;
        const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
        let json = null; try { json = await res.json(); } catch { /* not json */ }
        return { status: res.status, json };
    };
    return { call, close: () => new Promise(r => server.close(r)), router };
}

console.log('\n§1 production: owner only, fails closed');
{
    const { call, close } = await mount('production');
    let r = await call('GET', '/api/jobs/41/status', 'alice');
    ok(r.status === 200 && r.json.result?.words?.[0] === 'alice secret transcript', 'the owner reads their own result');
    r = await call('GET', '/api/jobs/42/status', 'alice');
    ok(r.status === 404 && r.json.state === 'not_found' && !JSON.stringify(r.json).includes('bob'), "another user's job is not found, and nothing leaks");
    const missing = await call('GET', '/api/jobs/999/status', 'alice');
    ok(r.status === missing.status && JSON.stringify(r.json) === JSON.stringify(missing.json), 'not-yours is indistinguishable from does-not-exist');
    r = await call('GET', '/api/jobs/41/status', null);
    ok(r.status === 401, 'no token is refused');
    r = await call('GET', '/api/jobs/43/status', 'alice');
    ok(r.status === 404, 'a job with no recorded owner is refused (fails closed)');
    r = await call('GET', '/api/jobs/44/status', 'alice');
    ok(r.status === 200 && r.json.state === 'failed' && r.json.error === 'boom', "the owner still sees their job's failure reason");

    r = await call('POST', '/api/jobs/status-batch', 'alice', { ids: ['41', '42', '43', '999'] });
    ok(r.status === 200 && r.json.jobs['41'].state === 'completed', 'batch: own job returned');
    ok(['42', '43', '999'].every(id => r.json.jobs[id].state === 'not_found') && !JSON.stringify(r.json).includes('bob'), "batch: others' and ownerless jobs read as not_found");
    r = await call('POST', '/api/jobs/status-batch', null, { ids: ['41'] });
    ok(r.status === 401, 'batch: no token is refused');

    r = await call('GET', '/api/jobs/41/progress', 'alice');
    ok(r.status === 404, 'the unauthenticated SSE /progress route is gone');
    await close();
}

console.log('\n§2 development: unchanged for local work');
{
    const { call, close, router } = await mount('development');
    let r = await call('GET', '/api/jobs/43/status', null);
    ok(r.status === 200, 'an ownerless dev job is readable without a token');
    r = await call('GET', '/api/jobs/41/status', 'alice');
    ok(r.status === 200, 'a signed-in dev user reads their own job');
    r = await call('GET', '/api/jobs/42/status', 'alice');
    ok(r.status === 404, "a real user's job is still private in dev");
    const { canReadJob } = router;
    ok(canReadJob({ data: { userId: 'dev-user' } }, 'someone', { isProd: false }), "dev placeholder owners ('dev-user') are readable in dev");
    ok(!canReadJob({ data: { userId: 'dev-user' } }, 'dev-user', { isProd: true }), 'placeholder owners are never honoured in production');
    await close();
}

Module._load = origLoad;

console.log('\n§3 every route that queues a job records its owner');
{
    const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
    const files = ['routes/exportRoutes.js', 'routes/interviewRoutes.js', 'routes/captionRoutes.js', 'routes/proxyRoutes.js',
        'routes/silenceRoutes.js', 'routes/analyzeRoutes.js', 'routes/objectIntelligenceRoutes.js', 'routes/audioRoutes.js',
        'server/routes/brainRoutes.js'];
    const missing = [];
    for (const f of files) {
        const src = read(f);
        const re = /\.add\('([a-z-]+)',\s*\{/g;
        let m;
        while ((m = re.exec(src))) {
            // The job's data object: from its opening brace to the matching close.
            let depth = 0, i = src.indexOf('{', m.index + m[0].length - 1), end = i;
            for (; end < src.length; end++) {
                if (src[end] === '{') depth++;
                else if (src[end] === '}' && --depth === 0) break;
            }
            if (!/\buserId\b/.test(src.slice(i, end))) missing.push(`${f} → ${m[1]}`);
        }
    }
    ok(missing.length === 0, missing.length ? `jobs without an owner: ${missing.join(', ')}` : 'all queued jobs carry userId');
    const sil = read('routes/silenceRoutes.js');
    ok(/router\.post\('\/detect', silenceAuth,/.test(sil) && /NODE_ENV === 'production' \? authenticateUser : optionalAuth/.test(sil), 'silence detection requires a user in production');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
