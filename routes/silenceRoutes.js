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
 * Body: { filename: "sample.mp4", threshold: "-30dB", duration: "0.5" }
 * Returns: { segments: [{ start: 0, end: 10 }, { start: 12, end: 20 }] } (Active Speech Segments)
 */
router.post('/detect', optionalAuth, async (req, res) => {
    try {
        const { filename, threshold = '-30dB', duration = '0.5' } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'Filename is required and must be a string' });
        }

        // SECURITY: Resolve path and prevent Directory Traversal attacks
        const uploadsDir = path.resolve(__dirname, '../uploads');
        const publicDir = path.resolve(__dirname, '../client/public');

        // Resolve relative to uploadsDir; bare filenames (e.g. "IMG_0029.MOV") that
        // escape uploads/ are retried under uploads/temp/ before returning 403.
        const normalizedFilename = filename.startsWith('/') ? filename.slice(1) : filename;
        let filePath = path.resolve(uploadsDir, normalizedFilename);

        if (!filePath.startsWith(uploadsDir) && !filePath.startsWith(publicDir)) {
            // Bare filename resolves outside uploads/ — check temp/ subdir
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(normalizedFilename));
            if (tempPath.startsWith(uploadsDir)) {
                filePath = tempPath;
            } else {
                return res.status(403).json({ error: 'Access denied: Invalid file path' });
            }
        }

        // Also fall back to uploads/temp/ when the file simply isn't at the resolved path
        if (!fs.existsSync(filePath)) {
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(normalizedFilename));
            if (filePath !== tempPath && fs.existsSync(tempPath)) {
                filePath = tempPath;
            } else {
                return res.status(404).json({ error: `File not found: ${filename}` });
            }
        }

        const userId = req.user?.id || (process.env.NODE_ENV !== 'production' ? 'dev-user' : null);
        console.log(`🎤 Enqueuing silence detection for: ${filename} (Threshold: ${threshold}, MinDuration: ${duration}s)`);

        const job = await audioQueue.add('detect-silence', {
            action: 'silence-detect',
            filename: path.basename(filePath),
            filePath,
            userId,
            threshold,
            duration
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        res.json({ success: true, jobId: job.id, status: 'queued' });

    } catch (error) {
        console.error("Silence Detection Failed:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
