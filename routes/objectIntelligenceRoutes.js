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

// ─────────────────────────────────────────────────────────────────────────────
// R92: free background removal.
//
// The mask is computed IN THE BROWSER with a free on-device segmentation model
// (client/src/vision/MatteBaker.js). This route only turns the uploaded mask
// frames into a small grayscale mp4 and stores it, so preview and export read
// the same file. No paid API is called, so no aiGate.
//
// Upload body: gzip( [uint32 LE header length][header JSON][frames] ), where
// header = { v: 1, width, height, fps, frames, sourceStart, sourceDuration }
// and frames is width*height bytes per frame (0 = background, 255 = person).
// ─────────────────────────────────────────────────────────────────────────────
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
try { ffmpeg.setFfmpegPath(require('ffmpeg-static')); } catch { /* system ffmpeg */ }

const matteAuth = isProd ? [authenticateUser] : [optionalAuth];
const MATTE_MAX_UPLOAD = '120mb';
const MATTE_MAX_DIM = 640;
const MATTE_MAX_FRAMES = 12 * 60 * 15; // 15 min at 12 fps

/** Parse and validate a mask pack. Throws with a user-readable message. */
function parseMattePack(buf) {
    let raw;
    try { raw = zlib.gunzipSync(buf, { maxOutputLength: 1024 * 1024 * 1024 }); }
    catch { throw new Error('The mask upload is not a valid gzip pack.'); }
    if (raw.length < 8) throw new Error('The mask upload is empty.');
    const headerLen = raw.readUInt32LE(0);
    if (headerLen <= 0 || headerLen > 4096 || headerLen + 4 > raw.length) throw new Error('The mask header is invalid.');
    let header;
    try { header = JSON.parse(raw.subarray(4, 4 + headerLen).toString('utf8')); }
    catch { throw new Error('The mask header is not valid JSON.'); }
    const width = Math.round(Number(header.width));
    const height = Math.round(Number(header.height));
    const frames = Math.round(Number(header.frames));
    const fps = Number(header.fps);
    if (!(width >= 16 && width <= MATTE_MAX_DIM && height >= 16 && height <= MATTE_MAX_DIM) || width % 2 || height % 2) {
        throw new Error(`Mask size must be even and between 16 and ${MATTE_MAX_DIM} px.`);
    }
    if (!(fps > 0 && fps <= 30)) throw new Error('Mask fps must be between 1 and 30.');
    if (!(frames >= 1 && frames <= MATTE_MAX_FRAMES)) throw new Error('Too many or too few mask frames.');
    const body = raw.subarray(4 + headerLen);
    if (body.length !== width * height * frames) throw new Error('The mask frames do not match the header size.');
    return {
        width, height, fps, frames, body,
        sourceStart: Math.max(0, Number(header.sourceStart) || 0),
        sourceDuration: Math.max(0, Number(header.sourceDuration) || frames / fps),
    };
}

/** Encode raw gray frames into an H.264 mask video (luma = mask). */
function encodeMaskVideo(pack, outPath) {
    const rawPath = `${outPath}.gray`;
    fs.writeFileSync(rawPath, pack.body);
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(rawPath)
            .inputOptions(['-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${pack.width}x${pack.height}`, '-r', String(pack.fps)])
            .videoCodec('libx264')
            .outputOptions(['-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'veryfast', '-movflags', '+faststart', '-an'])
            .output(outPath)
            .on('end', () => { fs.rm(rawPath, { force: true }, () => {}); resolve(outPath); })
            .on('error', (err) => { fs.rm(rawPath, { force: true }, () => {}); reject(err); })
            .run();
    });
}

async function signedMaskUrl(maskAssetPath) {
    const [url] = await storageConfig.bucket.file(maskAssetPath).getSignedUrl({
        version: 'v4', action: 'read', expires: Date.now() + 24 * 60 * 60 * 1000,
    });
    return url;
}

// TODO: apply uploadLimiter here once traffic patterns are known (large body).
router.post('/matte', ...matteAuth, express.raw({ type: '*/*', limit: MATTE_MAX_UPLOAD }), async (req, res) => {
    const userId = resolveRequestUserId(req);
    if (!userId) return res.status(401).json({ error: 'Sign in to save a background mask.' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'The mask upload is empty.' });

    let pack;
    try { pack = parseMattePack(req.body); }
    catch (err) { return res.status(400).json({ error: err.message }); }

    const id = crypto.randomUUID();
    const tmpOut = path.join(os.tmpdir(), `matte-${id}.mp4`);
    try {
        await encodeMaskVideo(pack, tmpOut);
        const meta = { sourceStart: pack.sourceStart, sourceDuration: pack.sourceDuration, fps: pack.fps, width: pack.width, height: pack.height };
        if (storageConfig.bucket) {
            const maskAssetPath = `masks/${userId}/matte-${id}.mp4`;
            await storageConfig.bucket.upload(tmpOut, { destination: maskAssetPath, metadata: { contentType: 'video/mp4' } });
            return res.json({ maskAssetPath, maskAssetUrl: await signedMaskUrl(maskAssetPath), ...meta });
        }
        // Local storage (dev): served by the /uploads static route.
        const rel = path.posix.join('masks', String(userId).replace(/[^\w-]/g, '_'), `matte-${id}.mp4`);
        const dest = path.join(__dirname, '..', 'uploads', rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(tmpOut, dest);
        return res.json({ maskAssetPath: `local:${rel}`, maskAssetUrl: `${req.protocol}://${req.get('host')}/uploads/${rel}`, ...meta });
    } catch (err) {
        console.error('[objectIntelligenceRoutes POST /matte] error:', err.message);
        return res.status(500).json({ error: 'The background mask could not be saved.' });
    } finally {
        fs.rm(tmpOut, { force: true }, () => {});
    }
});

/** Fresh link for a stored mask (signed links expire after 24 h). */
router.get('/matte-url', ...matteAuth, async (req, res) => {
    const userId = resolveRequestUserId(req);
    const p = String(req.query.path || '');
    if (!p) return res.status(400).json({ error: 'path is required' });
    try {
        if (p.startsWith('local:')) {
            return res.json({ maskAssetUrl: `${req.protocol}://${req.get('host')}/uploads/${p.slice(6)}` });
        }
        if (!userId || !p.startsWith(`masks/${userId}/`)) return res.status(403).json({ error: 'Not your mask.' });
        if (!storageConfig.bucket) return res.status(404).json({ error: 'Storage is not configured.' });
        return res.json({ maskAssetUrl: await signedMaskUrl(p) });
    } catch (err) {
        console.error('[objectIntelligenceRoutes GET /matte-url] error:', err.message);
        return res.status(500).json({ error: 'Could not create a link for the mask.' });
    }
});

router.parseMattePack = parseMattePack;
router.encodeMaskVideo = encodeMaskVideo;


module.exports = router;
