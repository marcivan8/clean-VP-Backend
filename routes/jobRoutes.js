/**
 * routes/jobRoutes.js  (updated)
 *
 * Adds GET /api/jobs/:jobId/status — a plain JSON endpoint that returns the
 * current job state + result.  This lets the frontend use simple authFetch
 * polling instead of EventSource (SSE), which is unreliable behind proxies.
 *
 * The existing SSE endpoint (/api/jobs/:jobId/progress) is kept for backward
 * compatibility.
 */

const express = require('express');
const router  = express.Router();
const { videoQueue, audioQueue, analysisQueue, exportQueue } = require('../queue/queues');

// ─── Helper ──────────────────────────────────────────────────────────────────

async function findJob(jobId) {
    let job = await videoQueue.getJob(jobId);
    if (job) return job;
    job = await audioQueue.getJob(jobId);
    if (job) return job;
    job = await analysisQueue.getJob(jobId);
    if (job) return job;
    job = await exportQueue.getJob(jobId);
    return job;
}

// ─── REST endpoint (used by jobPoller.js) ────────────────────────────────────

/**
 * GET /api/jobs/:jobId/status
 * Returns { state, progress, result?, error? } as plain JSON.
 * No auth required — jobId is a short-lived opaque token.
 */
router.get('/:jobId/status', async (req, res) => {
    try {
        const job = await findJob(req.params.jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found', state: 'not_found' });
        }

        const state    = await job.getState();
        const progress = job.progress ?? 0;

        const payload = { state, progress };

        if (state === 'completed') {
            // Re-fetch so returnvalue is populated from Redis
            const fresh   = await findJob(req.params.jobId);
            payload.result = fresh ? fresh.returnvalue : job.returnvalue;
        } else if (state === 'failed') {
            payload.error = job.failedReason || 'Unknown error';
        }

        res.json(payload);
    } catch (err) {
        console.error('[jobRoutes] /status error:', err);
        res.status(500).json({ state: 'error', error: err.message });
    }
});

// ─── SSE endpoint (kept for backward compatibility) ──────────────────────────

/**
 * GET /api/jobs/:jobId/progress  (SSE)
 */
router.get('/:jobId/progress', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // ← disable Nginx / Railway buffering

    res.write(': connected\n\n');

    const job = await findJob(req.params.jobId);

    if (!job) {
        res.write(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
        return res.end();
    }

    let interval;

    const sendState = async () => {
        try {
            const state    = await job.getState();
            const progress = job.progress ?? 0;
            let data = { state, progress };

            if (state === 'completed') {
                const fresh   = await findJob(req.params.jobId);
                data.result   = fresh ? fresh.returnvalue : job.returnvalue;
            } else if (state === 'failed') {
                data.error = job.failedReason;
            }

            res.write(`data: ${JSON.stringify(data)}\n\n`);

            if (state === 'completed' || state === 'failed') {
                clearInterval(interval);
                res.end();
            }
        } catch (err) {
            console.error('[jobRoutes] SSE sendState error:', err);
            clearInterval(interval);
            res.end();
        }
    };

    await sendState();
    interval = setInterval(sendState, 1000);

    req.on('close', () => clearInterval(interval));
});

module.exports = router;
