/**
 * routes/jobRoutes.js  (updated)
 *
 * Adds GET /api/jobs/:jobId/status — a plain JSON endpoint that returns the
 * current job state + result.  This lets the frontend use simple authFetch
 * polling instead of EventSource (SSE), which is unreliable behind proxies.
 *
 * OWNERSHIP (R97): every status read requires the caller to OWN the job
 * (job.data.userId === the authenticated user). These endpoints used to be
 * public on the theory that a job id is "a short-lived opaque token" — but
 * BullMQ ids are often sequential integers, and a completed job's result holds
 * the user's transcript, analysis, signed media URLs. Anyone could read anyone
 * else's results by counting. A job you don't own reads exactly like a job
 * that doesn't exist ('not_found'), so ids can't be probed (same rule as R27).
 * The unauthenticated SSE endpoint (/:jobId/progress) was removed: nothing in
 * the client used it, and EventSource cannot send an Authorization header.
 */

const express = require('express');
const router  = express.Router();
const { videoQueue, audioQueue, analysisQueue, exportQueue, visionQueue } = require('../queue/queues');
const { connection } = require('../queue/connection');
const { authenticateUser, optionalAuth } = require('../middleware/auth');

const IS_PROD = process.env.NODE_ENV === 'production';
// Same production/dev split the job-creating routes use (proxyRoutes.js etc.).
const jobAuth = IS_PROD ? authenticateUser : optionalAuth;

// Who is asking. Mirrors how the creating routes record userId, including
// their non-production 'dev-user' fallback, so dev keeps working unchanged.
function requesterId(req) {
    if (req.user?.id) return req.user.id;
    return IS_PROD ? null : 'dev-user';
}

// Owners that only ever appear outside production, from routes that queue a
// job without a real user. Never honoured in production.
const DEV_PLACEHOLDER_OWNERS = new Set(['dev-user', 'anonymous']);

/**
 * May `requester` read `job`? Fails CLOSED in production: a job without a
 * recorded owner, or a caller without an id, is denied.
 */
function canReadJob(job, requester, { isProd = IS_PROD } = {}) {
    const owner = job?.data?.userId ?? null;
    if (isProd) return !!requester && !!owner && !DEV_PLACEHOLDER_OWNERS.has(owner) && owner === requester;
    if (!owner || DEV_PLACEHOLDER_OWNERS.has(owner)) return true;
    return owner === requester;
}
let _assetAnalysisQueue = null;
function getAssetAnalysisQueue() {
    if (!_assetAnalysisQueue) {
        const { Queue } = require('bullmq');
        _assetAnalysisQueue = new Queue('asset-analysis', { connection });
    }
    return _assetAnalysisQueue;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

async function findJob(jobId) {
    let job = await videoQueue.getJob(jobId);
    if (job) return job;
    job = await audioQueue.getJob(jobId);
    if (job) return job;
    job = await analysisQueue.getJob(jobId);
    if (job) return job;
    job = await exportQueue.getJob(jobId);
    if (job) return job;
    job = await visionQueue.getJob(jobId); // R67 — object-segmentation (SAM2) jobs
    if (job) return job;
    job = await getAssetAnalysisQueue().getJob(jobId);
    return job;
}

// Shared by the single and batch status endpoints.
async function describeJob(jobId, requester) {
    const job = await findJob(jobId);
    // Not yours reads the same as missing — no way to probe other users' ids.
    if (!job || !canReadJob(job, requester)) return { state: 'not_found' };
    const state    = await job.getState();
    const payload  = { state, progress: job.progress ?? 0 };
    if (state === 'completed') {
        // Re-fetch so returnvalue is populated from Redis
        const fresh   = await findJob(jobId);
        payload.result = fresh ? fresh.returnvalue : job.returnvalue;
    } else if (state === 'failed') {
        payload.error = job.failedReason || 'Unknown error';
    }
    return payload;
}

// ─── Batch endpoint (used by jobPoller.js) ───────────────────────────────────

/**
 * POST /api/jobs/status-batch   body: { ids: string[] }  (max 100)
 * Returns { jobs: { [id]: { state, progress, result?, error? } } }.
 *
 * Why it exists: every pending upload used to run its own poll loops (proxy +
 * transcription), each a separate request every 1.5-5s. Twenty-five files is
 * ~50 loops — several hundred requests a minute from one browser, against a
 * global limit of 120/min per IP (index.js). The limiter then answered EVERY
 * request from that user with 429 — saves, waveforms, the assistant — which is
 * what "the platform froze" looked like. The client now asks about all its
 * jobs in one request per tick.
 */
const BATCH_MAX_IDS = 100;
router.post('/status-batch', jobAuth, async (req, res) => {
    try {
        const raw = Array.isArray(req.body?.ids) ? req.body.ids : null;
        if (!raw) return res.status(400).json({ error: 'ids must be an array' });
        const ids = [...new Set(raw.map(String).filter(id => id && id.length <= 128))].slice(0, BATCH_MAX_IDS);

        const requester = requesterId(req);
        const entries = await Promise.all(ids.map(async id => {
            try {
                return [id, await describeJob(id, requester)];
            } catch (err) {
                console.error(`[jobRoutes] /status-batch error for ${id}:`, err.message);
                return [id, { state: 'error', error: err.message }];
            }
        }));
        res.json({ jobs: Object.fromEntries(entries) });
    } catch (err) {
        console.error('[jobRoutes] /status-batch error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── REST endpoint (single job) ──────────────────────────────────────────────

/**
 * GET /api/jobs/:jobId/status
 * Returns { state, progress, result?, error? } as plain JSON — to the job's
 * owner only (see OWNERSHIP above).
 */
router.get('/:jobId/status', jobAuth, async (req, res) => {
    try {
        const payload = await describeJob(req.params.jobId, requesterId(req));
        if (payload.state === 'not_found') {
            return res.status(404).json({ error: 'Job not found', state: 'not_found' });
        }
        res.json(payload);
    } catch (err) {
        console.error('[jobRoutes] /status error:', err);
        res.status(500).json({ state: 'error', error: err.message });
    }
});

module.exports = router;
// Exported for scripts/test_job_ownership.mjs
module.exports.canReadJob = canReadJob;
