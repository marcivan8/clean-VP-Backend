// scripts/test_bulk_upload.mjs — R96: many files at once without crashing,
// freezing, or rate-limiting the editor into the ground.
//
// Runs the REAL jobPoller / retryOn429 / upload-slot code (stubbing only the
// network), plus static wiring checks for the parts that need a browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-upload-'));

// ── Load jobPoller with a stub authFetch ─────────────────────────────────────
const net = { calls: [], handler: null };
globalThis.__stubAuthFetch = async (url, opts = {}) => { net.calls.push({ url, opts }); return net.handler(url, opts); };
const pollerSrc = read('client/src/utils/jobPoller.js')
    .replace(/import \{ authFetch \} from '\.\/authFetch\.js';/, 'const authFetch = (...a) => globalThis.__stubAuthFetch(...a);');
fs.writeFileSync(path.join(tmp, 'jobPoller.mjs'), pollerSrc);
const { pollJobResult } = await import(pathToFileURL(path.join(tmp, 'jobPoller.mjs')).href);
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } });

console.log('\n§1 job status is batched — 30 pollers, a handful of requests');
{
    const polls = new Map(); // id -> number of times seen
    net.calls = [];
    net.handler = (url, opts) => {
        const ids = JSON.parse(opts.body).ids;
        const jobs = {};
        for (const id of ids) {
            const n = (polls.get(id) || 0) + 1; polls.set(id, n);
            jobs[id] = n >= 2 ? { state: 'completed', result: { id } } : { state: 'active', progress: 10 };
        }
        return json(200, { jobs });
    };
    const ids = Array.from({ length: 30 }, (_, i) => `job-${i}`);
    const t0 = Date.now();
    const results = await Promise.all(ids.map(id => pollJobResult(id, null, 60_000)));
    ok(results.every((r, i) => r.id === ids[i]), 'every poller got its own job result');
    ok(net.calls.every(c => c.url === '/api/jobs/status-batch'), 'all status traffic went through the batch route');
    ok(net.calls.length <= 4, `30 pollers → ${net.calls.length} requests (was ≥60)`);
    ok(Date.now() - t0 < 15_000, 'batched polling still completes promptly');
}

console.log('\n§2 queue time does not consume the budget when countQueueTime:false');
{
    let n = 0;
    net.handler = (url, opts) => {
        n++;
        const id = JSON.parse(opts.body).ids[0];
        return json(200, { jobs: { [id]: n < 5 ? { state: 'waiting' } : { state: 'completed', result: 'done' } } });
    };
    // 3s budget, ~8s of waiting: would time out if queue time counted.
    const r = await pollJobResult('queued-job', null, 3000, null, { countQueueTime: false });
    ok(r === 'done', 'a job queued longer than its budget still completes');

    n = 0;
    let err = null;
    try { await pollJobResult('queued-job-2', null, 3000); } catch (e) { err = e; }
    ok(err && err.code === 'POLL_TIMEOUT', 'default behaviour unchanged: queue time counts, timeout tagged POLL_TIMEOUT');

    net.handler = (url, opts) => json(200, { jobs: { [JSON.parse(opts.body).ids[0]]: { state: 'waiting' } } });
    err = null;
    try { await pollJobResult('dead-worker', null, 1000, null, { countQueueTime: false, maxQueueWaitMs: 2500 }); } catch (e) { err = e; }
    ok(err && err.code === 'POLL_TIMEOUT', 'queue waiting is still bounded (a dead worker cannot poll forever)');
}

console.log('\n§3 failed / cancelled / old backend');
{
    net.handler = (url, opts) => json(200, { jobs: { [JSON.parse(opts.body).ids[0]]: { state: 'failed', error: 'boom' } } });
    let err = null;
    try { await pollJobResult('bad', null, 10_000); } catch (e) { err = e; }
    ok(err && err.message === 'boom' && err.code !== 'POLL_TIMEOUT', 'a failed job rejects with its reason, not as a timeout');

    net.handler = () => json(200, { jobs: {} });
    const ctrl = new AbortController();
    const p = pollJobResult('cancel-me', ctrl.signal, 60_000);
    setTimeout(() => ctrl.abort(), 300);
    err = null;
    try { await p; } catch (e) { err = e; }
    ok(err && err.message === 'Polling cancelled', 'abort cancels a poll waiting on the shared batch');

    net.calls = [];
    net.handler = (url) => url === '/api/jobs/status-batch'
        ? json(404, {})
        : json(200, { state: 'completed', result: 'single' });
    const r = await pollJobResult('legacy', null, 10_000);
    ok(r === 'single' && net.calls.some(c => c.url === '/api/jobs/legacy/status'), 'falls back to per-job status when the batch route is missing');
}

console.log('\n§4 retryOn429 waits out a rate limit');
{
    const { fetchWithRateLimitRetry, retryDelayMs } = await import(pathToFileURL(path.join(root, 'client/src/utils/retryOn429.js')).href);
    const hdr = (h) => ({ get: (k) => h[k] ?? null });
    ok(retryDelayMs({ headers: hdr({ 'Retry-After': '2' }) }) >= 2000 && retryDelayMs({ headers: hdr({ 'Retry-After': '2' }) }) < 3100, 'honours Retry-After seconds');
    ok(retryDelayMs({ headers: hdr({ 'RateLimit-Reset': '1' }) }) < 2100, 'falls back to RateLimit-Reset');
    ok(retryDelayMs({ headers: hdr({ 'Retry-After': '999' }) }) <= 61_000, 'caps the wait at 60s');
    let n = 0;
    const res = await fetchWithRateLimitRetry(async () => (++n < 3 ? { status: 429, headers: hdr({ 'Retry-After': '0.1' }) } : { status: 200, headers: hdr({}) }));
    ok(res.status === 200 && n === 3, 'retries a 429 until it goes through');
    n = 0;
    const last = await fetchWithRateLimitRetry(async () => { n++; return { status: 429, headers: hdr({ 'Retry-After': '0.05' }) }; }, { maxRetries: 2 });
    ok(last.status === 429 && n === 3, 'gives up after maxRetries and returns the 429');
    n = 0;
    const r500 = await fetchWithRateLimitRetry(async () => { n++; return { status: 500, headers: hdr({}) }; });
    ok(r500.status === 500 && n === 1, 'never retries a non-429 error');
}

console.log('\n§5 uploads run through a bounded pool');
{
    const src = read('client/src/services/proxyService.js');
    const m = src.match(/export const MAX_CONCURRENT_UPLOADS = (\d+);[\s\S]*?(let activeUploads[\s\S]*?\n}\n)/);
    ok(!!m, 'proxyService defines MAX_CONCURRENT_UPLOADS and withUploadSlot');
    const limit = Number(m[1]);
    // eslint-disable-next-line no-new-func
    const withUploadSlot = new Function(`const MAX_CONCURRENT_UPLOADS = ${limit};\n${m[2]}\nreturn withUploadSlot;`)();
    let active = 0, peak = 0;
    const job = () => withUploadSlot(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 20)); active--; });
    await Promise.all(Array.from({ length: 25 }, job));
    ok(peak === limit, `25 uploads never exceed ${limit} at once (peak ${peak})`);
    let thrown = 0;
    await Promise.all(Array.from({ length: 6 }, (_, i) => withUploadSlot(async () => { if (i % 2) throw new Error('x'); }).catch(() => thrown++)));
    await withUploadSlot(async () => {});
    ok(thrown === 3, 'a failing upload releases its slot (later uploads still run)');
    ok(/withUploadSlot\(\(\) => this\._putToGCS\(/.test(src), 'direct-to-GCS PUT takes a slot');
    ok(/_processDirect\(file, destPath\)/.test(src) && !/withUploadSlot\([^)]*_processDirect/.test(src), 'slot is released before proxy polling');
    ok(/withUploadSlot\(\(\) => putWithProgress\(sessionUrl, file, contentType/.test(src), 'reference uploads take a slot');
    ok(/withUploadSlot\(\(\) => fetch\(`\$\{API_URL\}\/api\/proxy\/upload`/.test(src), 'legacy multipart upload takes a slot');
    ok((src.match(/PROXY_POLL_OPTIONS\)/g) || []).length === 2, 'both proxy polls are queue-aware');
    ok(/if \(pct === lastPct\) return;/.test(src), 'upload progress only reported when the percentage changes');
    ok(/fetchWithRateLimitRetry\(async \(\) => fetch\(`\$\{API_URL\}\/api\/proxy\/upload-url`/.test(src)
        && /fetchWithRateLimitRetry\(async \(\) => fetch\(`\$\{API_URL\}\/api\/proxy\/process-direct`/.test(src),
        'upload-url and process-direct wait out a 429');
}

console.log('\n§6 transcription: one job per file, queue-aware');
{
    const src = read('client/src/agent/TranscriptionManager.js');
    ok((src.match(/pollJobResult\([^)]*QUEUE_AWARE\)/g) || []).length === 2, 'both transcription polls are queue-aware');
    const catchIdx = src.indexOf('} catch (jobErr) {');
    const fallbackIdx = src.indexOf("authFetch('/api/audio/transcribe'", catchIdx);
    const rethrowIdx = src.indexOf("jobErr?.code === 'POLL_TIMEOUT'", catchIdx);
    ok(catchIdx > 0 && rethrowIdx > catchIdx && rethrowIdx < fallbackIdx, 'a poll timeout is rethrown BEFORE the fallback queues a second job');
    ok((src.match(/fetchWithRateLimitRetry\(\(\) => authFetch\('\/api\/audio\//g) || []).length === 3, 'diarize/transcribe starts wait out a 429');
}

console.log('\n§7 browser: no fake "processing", probes release their video');
{
    const ide = read('client/src/layouts/IDELayout.jsx');
    ok(!/processingTimer/.test(ide), 'the fixed 5s "processing" timer is gone');
    ok(/updateAsset\(assetId, \{ uploadPhase: 'processing', uploadProgress: 100 \}\);\s*\n\s*if \(gcsPath\) \{/.test(ide), "'processing' is set when the upload really finishes");
    ok(/fetchWithRateLimitRetry\(\(\) => authFetch\('\/api\/brain\/analyze-asset'/.test(ide), 'analysis queuing waits out a 429');
    const probe = read('client/src/utils/mediaProbe.js');
    ok(/video\.removeAttribute\('src'\); video\.load\(\);/.test(probe) && /const resolve = \(v\) => \{ release\(\); resolveRaw\(v\); \};/.test(probe), 'video probe releases its element on every exit');
}

console.log('\n§8 server limits and batch route');
{
    const jr = read('routes/jobRoutes.js');
    // R97: jobAuth = authenticateUser in production (ownership itself is
    // exercised end to end by scripts/test_job_ownership.mjs).
    ok(/router\.post\('\/status-batch', jobAuth,/.test(jr) && /const jobAuth = IS_PROD \? authenticateUser : optionalAuth;/.test(jr), 'batch status route exists and requires auth in production');
    ok(/slice\(0, BATCH_MAX_IDS\)/.test(jr), 'batch size is capped');
    const idx = read('index.js');
    ok(/skip: isMediaRead/.test(idx) && /\/api\/proxy\/gcs-media\//.test(idx), 'media reads are not counted by the global limiter');
    ok(/routePath === '\/analyze-asset'\) return assetQueueLimiter/.test(idx), 'analyze-asset has its own limiter (not the 15/min AI one)');
    const pr = read('routes/proxyRoutes.js');
    ok(/router\.post\('\/upload-url', directUploadLimiter/.test(pr) && /router\.post\('\/process-direct', directUploadLimiter/.test(pr), 'direct-upload calls use the batch-sized limiter');
    ok(/router\.post\('\/upload', uploadLimiter/.test(pr) && /router\.post\('\/generate', uploadLimiter/.test(pr), 'heavy in-process upload routes keep the strict limiter');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
