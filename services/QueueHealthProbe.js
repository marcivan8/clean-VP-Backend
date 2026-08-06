/**
 * services/QueueHealthProbe.js
 *
 * Reports BullMQ queue depth so "the worker isn't running" is distinguishable
 * from "the worker is running and failing".
 *
 * WHY THIS EXISTS: `media_assets` sat at 0 rows in production across three
 * separate fixes (R21 added the migration, R38 added the INSERT and the local-
 * file resolution, R43/R44 built features on top of it). Every one of those was
 * a real bug, but none of them answered the operational question underneath:
 * are the jobs even being CONSUMED?
 *
 * That question is invisible from the API service's own logs, because in
 * production `index.js` does NOT start the inline workers — GCS is configured,
 * so the `useLocalStorage || !bucket || WORKER_INLINE` condition is false and
 * `worker.js` runs as a SEPARATE Railway service with its own deploy and its
 * own log stream. An API deploy therefore does not redeploy the worker: the
 * Express side can be running today's code while the worker still runs last
 * month's. Queue counts are the cheapest signal that tells you which.
 *
 * HOW TO READ IT:
 *   waiting high, active 0, completed 0  → nothing is consuming. The worker
 *                                          service is down, or was never
 *                                          deployed, or lost its Redis URL.
 *   waiting high, failed high            → the worker IS consuming and every
 *                                          job throws. Read the worker's logs.
 *   waiting 0, completed > 0             → healthy.
 *   all zero                             → nothing has been queued yet.
 *
 * Read-only and best-effort: it never throws, and a Redis failure degrades to
 * `reachable: false` rather than taking down the endpoint that calls it.
 */

'use strict';

const { Queue } = require('bullmq');

/**
 * Queues worth reporting on, with the feature each one powers so an operator
 * reading this at 2am doesn't have to know the codebase.
 */
const QUEUES = [
    { name: 'asset-analysis',      feature: 'media_assets rows → Organize v2 profiles, project map, footage-aware Brain advice' },
    { name: 'video-processing',    feature: 'Proxy generation (playback, waveforms, frame extraction)' },
    { name: 'audio-processing',    feature: 'Transcription, silence/filler detection' },
    { name: 'analysis-processing', feature: 'Virality analysis' },
    { name: 'export-processing',   feature: 'Timeline exports' },
];

/** A depth that suggests a backlog rather than normal in-flight work. */
const BACKLOG_THRESHOLD = 5;

async function checkQueueHealth() {
    const checkedAt = new Date().toISOString();
    const checks = [];
    const problems = [];
    const warnings = [];

    let connection;
    try {
        ({ connection } = require('../queue/connection'));
    } catch (err) {
        return {
            status: 'unknown', checkedAt, checks: [],
            problems: [`Redis connection module unavailable: ${err.message}`],
            warnings: [],
        };
    }

    for (const { name, feature } of QUEUES) {
        let queue;
        try {
            // Reuse the shared ioredis connection rather than opening one per
            // queue — this probe must not add connection pressure to the thing
            // it is measuring.
            queue = new Queue(name, { connection });

            const counts = await queue.getJobCounts(
                'waiting', 'active', 'completed', 'failed', 'delayed'
            );

            const check = {
                queue:     name,
                feature,
                reachable: true,
                waiting:   counts.waiting   ?? 0,
                active:    counts.active    ?? 0,
                completed: counts.completed ?? 0,
                failed:    counts.failed    ?? 0,
                delayed:   counts.delayed   ?? 0,
                error:     null,
            };

            // The diagnostic that matters: work queued, nothing consuming it.
            if (check.waiting >= BACKLOG_THRESHOLD && check.active === 0 && check.completed === 0) {
                check.verdict = 'no_consumer';
                problems.push(
                    `Queue "${name}" has ${check.waiting} waiting job(s), 0 active and 0 ever completed — ` +
                    `nothing is consuming it. The worker service is probably not running or not deployed. ` +
                    `Affects: ${feature}`
                );
            } else if (check.failed >= BACKLOG_THRESHOLD && check.failed > check.completed) {
                check.verdict = 'failing';
                problems.push(
                    `Queue "${name}" has ${check.failed} failed job(s) vs ${check.completed} completed — ` +
                    `the worker is consuming but the jobs throw. Check the worker service logs. ` +
                    `Affects: ${feature}`
                );
            } else if (check.waiting >= BACKLOG_THRESHOLD) {
                check.verdict = 'backlog';
                warnings.push(
                    `Queue "${name}" has ${check.waiting} waiting job(s) — a backlog, but jobs are moving.`
                );
            } else {
                check.verdict = 'ok';
            }

            checks.push(check);
        } catch (err) {
            checks.push({
                queue: name, feature, reachable: false,
                waiting: null, active: null, completed: null, failed: null, delayed: null,
                verdict: 'unreachable', error: err.message,
            });
            warnings.push(`Queue "${name}" could not be read: ${err.message}`);
        } finally {
            // Close the Queue wrapper but NOT the shared connection.
            if (queue) { try { await queue.close(); } catch { /* ignore */ } }
        }
    }

    // ── Worker build check ───────────────────────────────────────────────────
    // The signal queue counts CANNOT provide. A worker running an old build
    // consumes jobs, completes them, and logs success — waiting=0, failed=0,
    // completed=N, a queue that looks perfectly healthy — while the code inside
    // does the wrong thing. `media_assets` stayed at 0 rows for exactly this
    // reason: the worker had never been redeployed with R38's fixes, so every
    // job handed a GCS key to the analyzers and wrote nothing.
    let worker = null;
    try {
        const { WORKER_CAPABILITY_VERSION } = require('./buildInfo');
        const raw = await connection.get('vibed:worker:heartbeat');

        if (!raw) {
            worker = { running: false, buildId: null, capabilityVersion: null };
            // Only a problem if there is work to do — an idle system with no
            // worker is indistinguishable from one that was never started, and
            // shouting about it on every poll is how a probe gets ignored.
            const anyWork = checks.some(c => (c.waiting ?? 0) > 0 || (c.active ?? 0) > 0);
            (anyWork ? problems : warnings).push(
                'No worker heartbeat in the last 90s — the worker service is not running ' +
                '(or predates the heartbeat and needs a redeploy).'
            );
        } else {
            const hb = JSON.parse(raw);
            worker = {
                running:           true,
                buildId:           hb.buildId ?? null,
                capabilityVersion: hb.capabilityVersion ?? null,
                startedAt:         hb.startedAt ?? null,
                lastSeen:          hb.lastSeen ?? null,
                expectedCapability: WORKER_CAPABILITY_VERSION,
            };

            if ((hb.capabilityVersion ?? 0) < WORKER_CAPABILITY_VERSION) {
                worker.stale = true;
                problems.push(
                    `Worker is running capability v${hb.capabilityVersion ?? 'unknown'} but the API expects ` +
                    `v${WORKER_CAPABILITY_VERSION} — the worker service has NOT been redeployed. ` +
                    'Its jobs will complete successfully while doing the wrong thing. ' +
                    'Redeploy the worker service.'
                );
            } else {
                worker.stale = false;
            }
        }
    } catch (err) {
        warnings.push(`Worker heartbeat could not be read: ${err.message}`);
    }

    // ── External service reachability ────────────────────────────────────────
    // The Python diarize service is a separate deployment with no contract in
    // this repo (TD6). When it 500s, the only symptom is one line in the
    // organize path saying ML classification was skipped — everything silently
    // degrades to the vision fallback and nobody notices the ML path has been
    // dead for weeks. Reporting it here puts it next to the queue depths, which
    // is where someone debugging "why is analysis not happening" will look.
    const services = [];
    try {
        const ClipAnalysisService = require('./ClipAnalysisService');
        if (!ClipAnalysisService.isAvailable) {
            services.push({
                service: 'diarize-service',
                configured: false,
                reachable: null,
                feature: 'ML clip classification (organize v2 ML tier), speaker diarization',
                note: 'DIARIZE_SERVICE_URL is not set — the ML tier is disabled and organize falls back to vision.',
            });
            warnings.push('diarize-service is not configured (DIARIZE_SERVICE_URL unset) — ML clip classification disabled.');
        } else {
            const reachable = await ClipAnalysisService.ping();
            services.push({
                service: 'diarize-service',
                configured: true,
                reachable,
                feature: 'ML clip classification (organize v2 ML tier), speaker diarization',
                note: reachable ? null : 'Configured but its /health check did not answer ok.',
            });
            if (!reachable) {
                problems.push(
                    'diarize-service is configured but not answering its health check — ' +
                    'ML clip classification and diarization will fail and silently fall back.'
                );
            }
        }
    } catch (err) {
        warnings.push(`diarize-service check could not run: ${err.message}`);
    }

    return {
        status: problems.length > 0 ? 'degraded' : 'ok',
        checkedAt, checks, worker, services, problems, warnings,
    };
}

module.exports = { checkQueueHealth, QUEUES, BACKLOG_THRESHOLD };
