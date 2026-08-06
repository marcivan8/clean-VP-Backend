#!/usr/bin/env node
/**
 * Regression: queue health probe (CLAUDE.md R48).
 *
 * Row counts answer "does the data exist"; these answer the question underneath
 * it — "are the jobs being CONSUMED?". `media_assets` sat at 0 rows through
 * three separate correct code fixes because nobody could see whether the
 * asset-analysis queue was being drained at all.
 *
 * The verdicts are the whole point, so they are EXECUTED against a stubbed
 * BullMQ rather than pattern-matched in source:
 *   no_consumer — work queued, nothing active, nothing ever completed
 *   failing     — consumed, but the jobs throw
 *   backlog     — deep queue, but jobs are moving
 *   ok          — healthy
 *
 * Run: node scripts/test_queue_health.js
 */

'use strict';

const path = require('path');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}`); if (detail) console.log(`      ${detail}`); }
}
function section(t) { console.log(`\n${t}`); }

const BQ_PATH    = require.resolve('bullmq');
const CONN_PATH  = require.resolve(path.resolve(__dirname, '../queue/connection.js'));
const CAS_PATH   = require.resolve(path.resolve(__dirname, '../services/ClipAnalysisService.js'));
const PROBE_PATH = require.resolve(path.resolve(__dirname, '../services/QueueHealthProbe.js'));

/**
 * Load the probe with stubbed BullMQ / Redis / diarize service.
 * `countsFor` maps queue name → job counts; `service` controls the diarize stub.
 */
function loadProbe(countsFor, service = { isAvailable: true, reachable: true }, heartbeat = undefined) {
    let closed = 0;
    // Default heartbeat: a current, in-sync worker.
    const hb = heartbeat === undefined
        ? JSON.stringify({ buildId: 'cur', capabilityVersion: 99, lastSeen: new Date().toISOString() })
        : heartbeat;

    require.cache[BQ_PATH] = {
        id: BQ_PATH, filename: BQ_PATH, loaded: true,
        exports: {
            Queue: class {
                constructor(name) { this.name = name; }
                async getJobCounts() {
                    const c = countsFor[this.name];
                    if (c instanceof Error) throw c;
                    return c ?? { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
                }
                async close() { closed++; }
            },
        },
    };
    require.cache[CONN_PATH] = {
        id: CONN_PATH, filename: CONN_PATH, loaded: true,
        exports: { connection: { get: async () => hb } },
    };
    require.cache[CAS_PATH] = {
        id: CAS_PATH, filename: CAS_PATH, loaded: true,
        exports: { isAvailable: service.isAvailable, ping: async () => service.reachable },
    };

    delete require.cache[PROBE_PATH];
    return { probe: require(PROBE_PATH), closedCount: () => closed };
}

const HEALTHY = { waiting: 0, active: 1, completed: 40, failed: 0, delayed: 0 };

async function main() {

    section('1 · The diagnostic that matters: queued but never consumed');
    {
        const { probe } = loadProbe({
            'asset-analysis': { waiting: 12, active: 0, completed: 0, failed: 0, delayed: 0 },
        });
        const r = await probe.checkQueueHealth();
        const aa = r.checks.find(c => c.queue === 'asset-analysis');

        check('verdict is no_consumer', aa.verdict === 'no_consumer', aa.verdict);
        check('status is degraded', r.status === 'degraded', r.status);
        check('the problem names the likely cause',
            r.problems.some(p => /worker service is probably not running/.test(p)),
            r.problems.join(' | '));
        check('the problem names the affected feature',
            r.problems.some(p => /media_assets/.test(p)));
    }

    section('2 · Consumed but failing is a DIFFERENT verdict');
    {
        const { probe } = loadProbe({
            'asset-analysis': { waiting: 3, active: 0, completed: 1, failed: 30, delayed: 0 },
        });
        const r = await probe.checkQueueHealth();
        const aa = r.checks.find(c => c.queue === 'asset-analysis');

        check('verdict is failing, not no_consumer', aa.verdict === 'failing', aa.verdict);
        check('it points at the worker logs',
            r.problems.some(p => /worker service logs/.test(p)));
        // These two need opposite fixes — deploy the worker vs read its logs —
        // so collapsing them would send you to the wrong one.
        check('it does NOT claim nothing is consuming',
            !r.problems.some(p => /nothing is consuming/.test(p)));
    }

    section('3 · Healthy and backlog are not problems');
    {
        const { probe } = loadProbe({ 'asset-analysis': HEALTHY });
        const r = await probe.checkQueueHealth();
        check('healthy queue verdict is ok',
            r.checks.find(c => c.queue === 'asset-analysis').verdict === 'ok');
        check('status is ok', r.status === 'ok', r.status);
        check('no problems raised', r.problems.length === 0, r.problems.join(' | '));
    }
    {
        // Deep queue but jobs ARE moving — a warning, never a hard problem, or
        // the probe screams during any normal upload burst and gets ignored.
        const { probe } = loadProbe({
            'asset-analysis': { waiting: 20, active: 1, completed: 100, failed: 0, delayed: 0 },
        });
        const r = await probe.checkQueueHealth();
        check('a moving backlog is only a warning',
            r.checks.find(c => c.queue === 'asset-analysis').verdict === 'backlog'
            && r.status === 'ok',
            `verdict=${r.checks.find(c => c.queue === 'asset-analysis').verdict} status=${r.status}`);
    }

    section('4 · An empty queue is not a failure');
    {
        const { probe } = loadProbe({});
        const r = await probe.checkQueueHealth();
        check('all-zero counts report ok',
            r.status === 'ok' && r.checks.every(c => c.verdict === 'ok'),
            'nothing queued yet is the normal state of a fresh deployment');
    }

    section('5 · Redis failure degrades, it does not throw');
    {
        const { probe } = loadProbe({ 'asset-analysis': new Error('ECONNREFUSED') });
        let threw = false;
        let r;
        try { r = await probe.checkQueueHealth(); } catch { threw = true; }

        check('checkQueueHealth does not throw', !threw);
        check('the unreachable queue is marked',
            r.checks.find(c => c.queue === 'asset-analysis').verdict === 'unreachable');
        check('it is a warning, not a hard problem',
            r.warnings.some(w => /could not be read/.test(w)));
    }

    section('6 · Queue wrappers are closed, the shared connection is not');
    {
        const { probe, closedCount } = loadProbe({ 'asset-analysis': HEALTHY });
        await probe.checkQueueHealth();
        check('every queue wrapper was closed',
            closedCount() === probe.QUEUES.length,
            `${closedCount()} closed of ${probe.QUEUES.length}`);

        const src = require('fs').readFileSync(PROBE_PATH, 'utf8');
        check('the shared ioredis connection is never closed',
            !/connection\.(quit|disconnect)\(/.test(src),
            'closing it would kill every queue in the process');
    }

    section('7 · The diarize service is reported alongside the queues');
    {
        const { probe } = loadProbe({ 'asset-analysis': HEALTHY },
            { isAvailable: true, reachable: false });
        const r = await probe.checkQueueHealth();
        const svc = r.services.find(s => s.service === 'diarize-service');

        check('the service is included', !!svc);
        check('unreachable-but-configured is a problem',
            svc.configured === true && svc.reachable === false && r.status === 'degraded');
        check('the problem says it fails silently',
            r.problems.some(p => /silently fall back/.test(p)));
    }
    {
        const { probe } = loadProbe({ 'asset-analysis': HEALTHY },
            { isAvailable: false, reachable: false });
        const r = await probe.checkQueueHealth();
        const svc = r.services.find(s => s.service === 'diarize-service');

        // Not configured is a deliberate state, not a fault.
        check('unconfigured is a warning, not a problem',
            svc.configured === false && r.status === 'ok'
            && r.warnings.some(w => /not configured/.test(w)),
            `status=${r.status}`);
    }

    section('7c · A STALE worker is caught even when every queue looks healthy');
    {
        // The exact production situation: waiting=0, active=0, failed=0,
        // completed=33 — a perfectly healthy queue — while the worker runs a
        // build that predates the fixes the API depends on. Queue counts alone
        // report 'ok' here, which is why the capability check exists.
        const { probe } = loadProbe(
            { 'asset-analysis': { waiting: 0, active: 0, completed: 33, failed: 0, delayed: 0 } },
            { isAvailable: true, reachable: true },
            JSON.stringify({ buildId: 'old', capabilityVersion: 1, lastSeen: new Date().toISOString() })
        );
        const r = await probe.checkQueueHealth();

        check('every queue still reports ok',
            r.checks.every(c => c.verdict === 'ok'),
            'this is the point — the queues are genuinely fine');
        check('the overall status is still degraded', r.status === 'degraded', r.status);
        check('the worker is flagged stale', r.worker.stale === true);
        check('the problem says to redeploy the worker',
            r.problems.some(p => /has NOT been redeployed/.test(p)),
            r.problems.join(' | '));
        check('it warns that jobs succeed while doing the wrong thing',
            r.problems.some(p => /complete successfully while doing the wrong thing/.test(p)));
    }

    section('7d · A missing heartbeat is only urgent when there is work');
    {
        const { probe } = loadProbe(
            { 'asset-analysis': { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 } },
            { isAvailable: true, reachable: true }, null
        );
        const r = await probe.checkQueueHealth();
        check('idle system + no worker is a warning, not a problem',
            r.worker.running === false && r.status === 'ok'
            && r.warnings.some(w => /No worker heartbeat/.test(w)),
            `status=${r.status}`);
    }
    {
        const { probe } = loadProbe(
            { 'asset-analysis': { waiting: 7, active: 0, completed: 0, failed: 0, delayed: 0 } },
            { isAvailable: true, reachable: true }, null
        );
        const r = await probe.checkQueueHealth();
        check('queued work + no worker IS a problem',
            r.status === 'degraded'
            && r.problems.some(w => /No worker heartbeat/.test(w)));
    }

    section('8 · Producer and consumer queue names agree');
    {
        const fs = require('fs');
        const brainSrc  = fs.readFileSync(
            path.resolve(__dirname, '../server/routes/brainRoutes.js'), 'utf8');
        const workerSrc = fs.readFileSync(path.resolve(__dirname, '../worker.js'), 'utf8');

        const produced = brainSrc.match(/ASSET_ANALYSIS_QUEUE\s*=\s*'([^']+)'/)?.[1];
        const consumed = workerSrc.match(/new Worker\('([^']*asset-analysis[^']*)'/)?.[1];

        check('the producer declares a queue name', !!produced, String(produced));
        check('the worker consumes the same name', produced === consumed,
            `producer="${produced}" consumer="${consumed}" — a mismatch queues jobs nothing reads`);

        // Strip comments first: this file's own comment explaining the fix
        // contains the literal `new Queue('asset-analysis', ...)`, which makes a
        // naive source grep report the bug it is describing.
        const code = brainSrc
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

        const routeStart = code.indexOf("router.post('/analyze-asset'");
        const routeBody  = code.slice(routeStart, routeStart + 1200);

        check('the route uses the shared singleton',
            /getAssetAnalysisQueue\(\)/.test(routeBody));
        check('the route no longer builds a Queue per request',
            !/new Queue\(/.test(routeBody),
            'a per-request Queue leaks a wrapper on every upload');
        check('exactly one Queue construction exists in the file',
            (code.match(/new Queue\(/g) || []).length === 1,
            `${(code.match(/new Queue\(/g) || []).length} found`);
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Queue health: ${passed} passed, ${failed} failed`);
    console.log('─'.repeat(60));
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('\nTest harness crashed:', err);
    process.exit(1);
});
