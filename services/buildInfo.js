/**
 * services/buildInfo.js
 *
 * Identifies which BUILD a process is running, so the API service and the
 * worker service can be compared.
 *
 * WHY: production runs two deploys off one repo (see R48) — Express from
 * `index.js`, workers from `worker.js`. They deploy independently, and a worker
 * left on an old build fails in the most expensive way possible: it consumes
 * jobs, completes them, and logs success, while the code inside is months stale.
 *
 * That is exactly what happened with `media_assets`. The asset-analysis queue
 * showed waiting=0, active=0, completed=N, failed=0 — a perfectly healthy queue
 * — while every job ran pre-R38 code that handed a GCS key straight to the
 * analyzers, logged "✓ Asset analyzed (unknown, silent)", and wrote nothing
 * because nothing INSERTed the row. Row counts said "empty", queue counts said
 * "fine", and neither could say "the worker is running old code".
 *
 * A build marker is the missing third signal. Dependency-free on purpose so
 * both entry points can import it before anything else is wired up.
 */

'use strict';

const path = require('path');

/**
 * Best-effort build identifier.
 *
 * Railway injects RAILWAY_GIT_COMMIT_SHA automatically, which is the most
 * precise source and needs no configuration. The others are fallbacks so this
 * still returns something useful off-platform.
 */
function getBuildId() {
    const sha =
        process.env.RAILWAY_GIT_COMMIT_SHA ||
        process.env.GIT_COMMIT_SHA ||
        process.env.SOURCE_VERSION ||          // Heroku
        process.env.VERCEL_GIT_COMMIT_SHA ||
        null;

    if (sha) return sha.slice(0, 12);

    // No CI-provided SHA. Fall back to the package version — coarse, but it at
    // least distinguishes major redeploys.
    try {
        const pkg = require(path.resolve(__dirname, '../package.json'));
        return `v${pkg.version}`;
    } catch {
        return 'unknown';
    }
}

/**
 * A CAPABILITY marker, versioned by hand.
 *
 * The commit SHA answers "are these the same build?" but only when both sides
 * report one. This answers the question that actually matters — "does the
 * worker contain the fixes the API expects it to?" — and works even without a
 * SHA.
 *
 * BUMP THIS whenever a change to worker-executed code must be paired with an
 * API-side change, and state what the bump requires. The API compares its own
 * value against the worker's heartbeat and warns on a mismatch.
 *
 *   1 — baseline (pre-R38): analyzers received the raw GCS key; media_assets
 *       rows were never INSERTed.
 *   2 — R38: _ensureAssetRow() creates the row before any update, and
 *       _resolveToLocalFile() downloads the object to a local path before the
 *       analyzers touch it. A worker below this writes NO media_assets rows.
 *   3 — R160: consumes the social-publishing queue for scheduled Shorts/Reels.
 *       A worker below this leaves queued social posts waiting until redeploy.
 *   4 — R161: syncs post analytics daily. A worker below this never refreshes
 *       social performance data or applies approved editing guidance.
 */
const WORKER_CAPABILITY_VERSION = 4;

// ── Worker heartbeat keys (shared by worker.js and QueueHealthProbe) ────────
// HEARTBEAT_KEY is the original single key: every worker instance overwrites
// it, so with several replicas it only ever shows the last writer. Kept for
// compatibility with an API deployed before R98. Each instance ALSO writes
// HEARTBEAT_INSTANCE_PREFIX + its id, which is what the probe reads now.
const HEARTBEAT_KEY = 'vibed:worker:heartbeat';
const HEARTBEAT_INSTANCE_PREFIX = 'vibed:worker:heartbeat:instance:';

/**
 * A stable id for this worker process. Uses the platform's replica id when
 * there is one (Railway, Fly), else hostname + pid — unique per process, which
 * is all the probe needs to count instances.
 */
function workerInstanceId(env = process.env) {
    const platformId = env.RAILWAY_REPLICA_ID || env.FLY_ALLOC_ID || null;
    const raw = platformId || `${require('os').hostname()}-${process.pid}`;
    return String(raw).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
}

module.exports = {
    getBuildId,
    WORKER_CAPABILITY_VERSION,
    HEARTBEAT_KEY,
    HEARTBEAT_INSTANCE_PREFIX,
    workerInstanceId,
};
