const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const { audioQueue } = require('../queue/queues');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * POST /api/silence/detect
 * Body: { filename: "sample.mp4", threshold: "-30dB", duration: "0.5" }
 * Returns: { segments: [{ start: 0, end: 10 }, { start: 12, end: 20 }] } (Active Speech Segments)
 */
router.post('/detect', async (req, res) => {
    try {
        const { filename, threshold = '-30dB', duration = '0.5' } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'Filename is required and must be a string' });
        }

        // SECURITY: Resolve path and prevent Directory Traversal attacks
        const uploadsDir = path.resolve(__dirname, '../uploads');
        const publicDir = path.resolve(__dirname, '../client/public');
        
        // Remove leading slash if present so it resolves correctly
        const normalizedFilename = filename.startsWith('/') ? filename.slice(1) : filename;
        let filePath = path.resolve(__dirname, '..', normalizedFilename);

        if (!filePath.startsWith(uploadsDir) && !filePath.startsWith(publicDir)) {
            return res.status(403).json({ error: 'Access denied: Invalid file path' });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `File not found: ${filename}` });
        }

        console.log(`🎤 Enqueuing silence detection for: ${filename} (Threshold: ${threshold}, MinDuration: ${duration}s)`);

        const job = await audioQueue.add('detect-silence', {
            action: 'silence-detect',
            filename,
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
