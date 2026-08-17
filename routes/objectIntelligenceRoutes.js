/**
 * routes/objectIntelligenceRoutes.js
 *
 * R67 — Object Intelligence Integration.
 *   POST /api/vision/separate-speaker  — enqueue a SAM2 segmentation job
 *   GET  /api/vision/separate-speaker/:jobId  — poll it (thin wrapper; the
 *        canonical polling endpoint is GET /api/jobs/:jobId/status, this one
 *        exists only so the client doesn't need to know which queue a given
 *        jobId belongs to when it's specifically an object-segmentation job)
 *
 * Auth/gating mirrors routes/interviewRoutes.js's virtual-multicam exactly
 * (authAndGate in production, optionalAuth + 'dev-user' fallback outside it)
 * since this is the same "expensive AI feature behind a plan gate" shape.
 */

const express = require('express');
const router = express.Router();

const { authenticateUser, optionalAuth } = require('../middleware/auth');
const { aiGate } = require('../middleware/usageGate'); // same gate virtual-multicam uses
const storageConfig = require('../config/storage');
const { visionQueue } = require('../queue/queues');
const ReplicateSAM2Service = require('../services/ReplicateSAM2Service');

const isProd = process.env.NODE_ENV === 'production';
const authAndGate = isProd ? [authenticateUser, aiGate] : [optionalAuth];

// ── IDOR guard — identical logic to routes/interviewRoutes.js's helpers of ──
// the same name. Duplicated rather than imported because interviewRoutes.js
// doesn't export them; if a third route needs these, promote them to a
// shared util/ module instead of a third copy.
function resolveRequestUserId(req) {
    if (req.user?.id) return req.user.id;
    if (!isProd) return 'dev-user';
    return null;
}

function pathOwnerUserId(gcsPath) {
    const m = String(gcsPath || '').match(/^(?:raw|proxies)\/([^/]+)\//);
    return m ? m[1] : null;
}

function pathOwnedBy(gcsPath, requestUserId) {
    const owner = pathOwnerUserId(gcsPath);
    if (!owner) return true;
    if (!requestUserId) return false;
    return owner === requestUserId;
}

// TODO: apply uploadLimiter or a dedicated visionLimiter here once traffic
// patterns are known — this calls a metered external API (Replicate), so an
// unthrottled endpoint is a real cost-exposure risk, same caution as aiLimiter
// on /api/ai in index.js.
router.post('/separate-speaker', ...authAndGate, async (req, res) => {
    const { clipId, assetId, gcsPath, clickPoint, clickFrame } = req.body || {};
    const requestUserId = resolveRequestUserId(req);

    if (!clipId) return res.status(400).json({ error: 'clipId is required' });
    if (!assetId) return res.status(400).json({ error: 'assetId is required' });
    if (!gcsPath) return res.status(400).json({ error: 'gcsPath is required' });

    if (!pathOwnedBy(gcsPath, requestUserId)) {
        console.warn(`[objectIntelligenceRoutes] user "${requestUserId}" denied access to "${gcsPath}"`);
        return res.status(403).json({ error: 'Not authorized to access this asset' });
    }

    if (!ReplicateSAM2Service.isConfigured()) {
        return res.status(503).json({
            error: 'Object Intelligence is not configured on this deployment (REPLICATE_API_TOKEN missing).',
        });
    }
    if (!storageConfig.bucket || storageConfig.useLocalStorage) {
        return res.status(503).json({
            error: 'Object Intelligence requires cloud storage (GCS) to be configured — unavailable in local-storage mode.',
        });
    }

    try {
        const job = await visionQueue.add('separate-speaker', {
            clipId,
            assetId,
            gcsPath,
            userId: requestUserId,
            clickPoint: clickPoint && typeof clickPoint.x === 'number' && typeof clickPoint.y === 'number'
                ? clickPoint
                : null,
            clickFrame: Number.isFinite(clickFrame) ? clickFrame : 0,
        });

        return res.json({ jobId: job.id, status: 'queued' });
    } catch (err) {
        console.error('[objectIntelligenceRoutes] /separate-speaker error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

router.get('/separate-speaker/:jobId', async (req, res) => {
    try {
        const job = await visionQueue.getJob(req.params.jobId);
        if (!job) return res.status(404).json({ error: 'Job not found', state: 'not_found' });

        const state = await job.getState();
        const progress = job.progress ?? 0;
        const payload = { state, progress };

        if (state === 'completed') {
            const fresh = await visionQueue.getJob(req.params.jobId);
            payload.result = fresh ? fresh.returnvalue : job.returnvalue;
        } else if (state === 'failed') {
            payload.error = job.failedReason || 'Unknown error';
        }

        return res.json(payload);
    } catch (err) {
        console.error('[objectIntelligenceRoutes] /separate-speaker/:jobId error:', err.message);
        return res.status(500).json({ state: 'error', error: err.message });
    }
});

module.exports = router;
