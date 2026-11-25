#!/usr/bin/env node
/**
 * scripts/test_worker_concurrency.js — R98: worker concurrency is a setting,
 * and the health probe sees EVERY worker instance.
 *
 * Executes the real queue/workerConcurrency.js and services/QueueHealthProbe.js
 * (BullMQ, Redis and the diarize client stubbed), plus static checks that
 * worker.js has no hard-coded concurrency left.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
const root = path.resolve(__dirname, '..');

(async () => {
    const { DEFAULT_CONCURRENCY, ENV_NAMES, MAX_CONCURRENCY, concurrencyFor, resolveAllConcurrency } =
        require(path.join(root, 'queue/workerConcurrency.js'));
    const quiet = { warn: () => {} };

    console.log('\n§1 defaults are exactly the old hard-coded values');
    ok(JSON.stringify(DEFAULT_CONCURRENCY) === JSON.stringify({
        video: 1, audio: 1, analysis: 2, export: 1, assetAnalysis: 1, embedding: 3, objectSegmentation: 2,
    }), 'video 1, audio 1, analysis 2, export 1, assetAnalysis 1, embedding 3, objectSegmentation 2');
    ok(JSON.stringify(resolveAllConcurrency({}, quiet)) === JSON.stringify(DEFAULT_CONCURRENCY), 'no env vars → the old behaviour');

    console.log('\n§2 env overrides, and bad values never stop the worker');
    ok(concurrencyFor('audio', { WORKER_CONCURRENCY_AUDIO: '3' }, quiet) === 3, 'a valid value is used');
    ok(concurrencyFor('audio', { WORKER_CONCURRENCY_AUDIO: ' 2 ' }, quiet) === 2, 'whitespace is tolerated');
    const warned = [];
    const log = { warn: (m) => warned.push(m) };
    ok(concurrencyFor('video', { WORKER_CONCURRENCY_VIDEO: 'two' }, log) === 1, 'non-numeric → default');
    ok(concurrencyFor('video', { WORKER_CONCURRENCY_VIDEO: '0' }, log) === 1, 'zero → default');
    ok(concurrencyFor('video', { WORKER_CONCURRENCY_VIDEO: '1.5' }, log) === 1, 'fraction → default');
    ok(concurrencyFor('video', { WORKER_CONCURRENCY_VIDEO: '40' }, log) === MAX_CONCURRENCY, `above ${MAX_CONCURRENCY} → clamped`);
    ok(warned.length === 4 && warned.every(w => w.includes('WORKER_CONCURRENCY_VIDEO')), 'each bad value is warned about by name');
    ok(concurrencyFor('video', { WORKER_CONCURRENCY_VIDEO: '' }, log) === 1 && warned.length === 4, 'an empty value is just "unset", no warning');
    let threw = false;
    try { concurrencyFor('nope', {}, quiet); } catch { threw = true; }
    ok(threw, 'an unknown worker name is a programming error');
    ok(Object.keys(ENV_NAMES).length === Object.keys(DEFAULT_CONCURRENCY).length, 'every worker has an env var');

    console.log('\n§3 worker.js has no hard-coded concurrency left');
    const workerSrc = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
    // Code only: the explanatory comments still quote the default values.
    const codeOnly = (src) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    ok(!/concurrency:\s*\d/.test(codeOnly(workerSrc)), 'no `concurrency: <number>` in worker.js code');
    for (const [key, re] of [
        ['video', /'video-processing'[\s\S]{0,120}concurrency: CONCURRENCY\.video/],
        ['audio', /'audio-processing'[\s\S]{0,600}concurrency: CONCURRENCY\.audio/],
        ['analysis', /'analysis-processing'[\s\S]{0,120}concurrency: CONCURRENCY\.analysis/],
        ['export', /'export-processing'[\s\S]{0,120}concurrency: CONCURRENCY\.export/],
        ['assetAnalysis', /concurrency: CONCURRENCY\.assetAnalysis \}\);/],
        ['embedding', /createEmbeddingWorker\(\{ concurrency: CONCURRENCY\.embedding \}\)/],
        ['objectSegmentation', /'object-segmentation'[\s\S]{0,120}concurrency: CONCURRENCY\.objectSegmentation/],
    ]) ok(re.test(workerSrc), `${key} worker reads its setting`);
    const embSrc = fs.readFileSync(path.join(root, 'server/audio-engine/embeddings/EmbeddingWorker.js'), 'utf8');
    ok(/function createEmbeddingWorker\(\{ concurrency = 3 \} = \{\}\)/.test(embSrc) && !/concurrency:\s*\d/.test(codeOnly(embSrc)), 'embedding worker takes it as an option (default 3)');
    ok(/connection\.set\(INSTANCE_KEY, payload/.test(workerSrc) && /connection\.set\(HEARTBEAT_KEY, payload/.test(workerSrc), 'worker writes its own heartbeat AND the legacy key');
    ok(/if \(require\.main === module\) \{\s*for \(const sig of \['SIGTERM', 'SIGINT'\]\)/.test(workerSrc), 'shutdown cleanup only when standalone (never inside the API process)');

    console.log('\n§4 instance ids');
    const { workerInstanceId } = require(path.join(root, 'services/buildInfo.js'));
    ok(workerInstanceId({ RAILWAY_REPLICA_ID: 'abc-123' }) === 'abc-123', 'uses the Railway replica id');
    ok(workerInstanceId({ FLY_ALLOC_ID: 'fly 9/x' }) === 'fly_9_x', 'uses the Fly alloc id, made key-safe');
    ok(/-\d+$/.test(workerInstanceId({})), 'falls back to hostname-pid');

    console.log('\n§5 the probe sees every instance');
    const BQ_PATH   = require.resolve('bullmq');
    const CONN_PATH = require.resolve(path.join(root, 'queue/connection.js'));
    const CAS_PATH  = require.resolve(path.join(root, 'services/ClipAnalysisService.js'));
    const PROBE_PATH = require.resolve(path.join(root, 'services/QueueHealthProbe.js'));
    const { HEARTBEAT_KEY, HEARTBEAT_INSTANCE_PREFIX, WORKER_CAPABILITY_VERSION } = require(path.join(root, 'services/buildInfo.js'));

    function loadProbe(store, { withScan = true } = {}) {
        require.cache[BQ_PATH] = { id: BQ_PATH, filename: BQ_PATH, loaded: true, exports: { Queue: class {
            async getJobCounts() { return { waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0 }; }
            async close() {}
        } } };
        const conn = { get: async (k) => store[k] ?? null };
        if (withScan) {
            // Two pages, to prove the cursor loop follows them.
            conn.scan = async (cursor, _m, pattern) => {
                const prefix = pattern.replace(/\*$/, '');
                const keys = Object.keys(store).filter(k => k.startsWith(prefix));
                return cursor === '0' ? ['7', keys.slice(0, 1)] : ['0', keys.slice(1)];
            };
        }
        require.cache[CONN_PATH] = { id: CONN_PATH, filename: CONN_PATH, loaded: true, exports: { connection: conn } };
        require.cache[CAS_PATH] = { id: CAS_PATH, filename: CAS_PATH, loaded: true, exports: { isAvailable: true, ping: async () => true } };
        delete require.cache[PROBE_PATH];
        return require(PROBE_PATH);
    }
    const hb = (id, cap, build = 'b1') => JSON.stringify({ instanceId: id, buildId: build, capabilityVersion: cap, lastSeen: new Date().toISOString(), concurrency: { video: 1 } });
    const cur = WORKER_CAPABILITY_VERSION;

    {
        const store = { [HEARTBEAT_INSTANCE_PREFIX + 'a']: hb('a', cur), [HEARTBEAT_INSTANCE_PREFIX + 'b']: hb('b', cur), [HEARTBEAT_INSTANCE_PREFIX + 'c']: hb('c', cur), [HEARTBEAT_KEY]: hb('c', cur) };
        const r = await loadProbe(store).checkQueueHealth();
        ok(r.worker.running && r.worker.instanceCount === 3 && r.status === 'ok', 'three healthy replicas → ok, all three counted');
        ok(r.worker.instances.every(i => i.concurrency?.video === 1), "each instance reports its concurrency");
    }
    {
        // The case a single shared key could NOT show: the last writer is a
        // healthy copy, while another replica runs an old build.
        const store = { [HEARTBEAT_INSTANCE_PREFIX + 'a']: hb('a', cur), [HEARTBEAT_INSTANCE_PREFIX + 'b']: hb('b', cur - 1, 'old'), [HEARTBEAT_INSTANCE_PREFIX + 'c']: hb('c', cur), [HEARTBEAT_KEY]: hb('c', cur) };
        const r = await loadProbe(store).checkQueueHealth();
        ok(r.status === 'degraded' && r.worker.stale === true, 'one stale replica among healthy ones is caught');
        ok(r.problems.some(p => /1 of 3 worker instances are running capability/.test(p) && /has NOT been redeployed/.test(p)), 'the problem says how many are stale');
        ok(r.worker.capabilityVersion === cur - 1, 'the top-level fields show the worst instance');
        ok(r.warnings.some(w => /different builds/.test(w)), 'mixed builds are warned about');
    }
    {
        const store = { [HEARTBEAT_KEY]: hb('legacy', cur) };
        const r = await loadProbe(store).checkQueueHealth();
        ok(r.worker.running && r.worker.instanceCount === 1, 'a pre-R98 worker (legacy key only) is still seen');
        const r2 = await loadProbe(store, { withScan: false }).checkQueueHealth();
        ok(r2.worker.running && r2.status === 'ok', 'a client without SCAN falls back to the legacy key');
    }
    {
        const r = await loadProbe({}).checkQueueHealth();
        ok(r.worker.running === false && r.worker.instanceCount === 0, 'no heartbeats → not running');
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
