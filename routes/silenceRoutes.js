const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const { audioQueue } = require('../queue/queues');
const { optionalAuth } = require('../middleware/auth');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * POST /api/silence/detect
 * Body: { filename: "temp/sample.mp4", threshold: "-30dB", duration: "0.5" }
 * Returns: { jobId: "silence-1716000000000-abc123", status: "queued" }
 *
 * FIX: Use a unique string jobId (e.g. "silence-<timestamp>-<random>") so
 * findJob() in jobRoutes.js cannot confuse this job with a same-numbered job
 * in videoQueue (proxy upload jobs).  BullMQ auto-increment IDs are per-queue,
 * so videoQueue and audioQueue can both have a job #13.  A prefixed string ID
 * is globally unique across all queues.
 */
router.post('/detect', optionalAuth, async (req, res) => {
    try {
        const { filename, threshold = '-30dB', duration = '0.5' } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'Filename is required and must be a string' });
        }

        // SECURITY: Resolve path and prevent Directory Traversal attacks
        const uploadsDir = path.resolve(__dirname, '../uploads');
        const publicDir  = path.resolve(__dirname, '../client/public');

        const normalizedFilename = filename.startsWith('/') ? filename.slice(1) : filename;
        let filePath = path.resolve(uploadsDir, normalizedFilename);

        if (!filePath.startsWith(uploadsDir) && !filePath.startsWith(publicDir)) {
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(normalizedFilename));
            if (tempPath.startsWith(uploadsDir)) {
                filePath = tempPath;
            } else {
                return res.status(403).json({ error: 'Access denied: Invalid file path' });
            }
        }

        // Fall back to uploads/temp/ when the file isn't at the resolved path
        if (!fs.existsSync(filePath)) {
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(normalizedFilename));
            if (filePath !== tempPath && fs.existsSync(tempPath)) {
                filePath = tempPath;
            } else {
                // On a distributed deployment (separate API + Worker services) the
                // worker downloads from GCS, so the file may not be local here.
                // Only hard-reject when we're sure it can't be found anywhere.
                if (process.env.NODE_ENV === 'production') {
                    console.warn(`[silenceRoutes] File not found locally (${filePath}); worker will attempt GCS download.`);
                    // Allow the job to be queued — the worker has its own GCS fallback
                } else {
                    return res.status(404).json({ error: `File not found: ${filename}` });
                }
            }
        }

        const userId = req.user?.id || null;
        console.log(`🎤 Enqueuing silence detection for: ${filename} (threshold=${threshold}, minDur=${duration}s)`);

        // ── KEY FIX: unique string jobId prevents cross-queue ID collisions ──
        const uniqueJobId = `silence-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        const job = await audioQueue.add('detect-silence', {
            action:    'silence-detect',
            filename:  path.basename(filePath),
            filePath,
            userId,
            threshold,
            duration
        }, {
            jobId:   uniqueJobId,   // ← prevents collision with videoQueue integer IDs
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        res.json({ success: true, jobId: job.id, status: 'queued' });

    } catch (error) {
        console.error('Silence Detection Failed:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
