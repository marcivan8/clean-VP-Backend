const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { audioQueue } = require('../queue/queues');
const { optionalAuth } = require('../middleware/auth');

/**
 * POST /api/captions/generate
 * Transcribes the video with Whisper and returns word-level timestamps.
 * The client polls /api/jobs/:jobId for the result, which is:
 *   { text: string, words: [{ word, start, end }] }
 */
router.post('/generate', optionalAuth, async (req, res) => {
    try {
        const { filename, language = 'en' } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'filename is required' });
        }

        const uploadsDir = path.resolve(__dirname, '../uploads');
        const normalizedFilename = filename.startsWith('/') ? filename.slice(1) : filename;
        let filePath = path.resolve(uploadsDir, normalizedFilename);

        if (!filePath.startsWith(uploadsDir)) {
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(normalizedFilename));
            if (tempPath.startsWith(uploadsDir)) {
                filePath = tempPath;
            } else {
                return res.status(403).json({ error: 'Access denied: invalid file path' });
            }
        }

        if (!fs.existsSync(filePath)) {
            // Try uploads/temp/<basename> as fallback
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(normalizedFilename));
            if (filePath !== tempPath && fs.existsSync(tempPath)) {
                filePath = tempPath;
            } else {
                return res.status(404).json({ error: `File not found: ${filename}` });
            }
        }

        const userId = req.user?.id || null;
        const job = await audioQueue.add('transcribe-audio', {
            action: 'transcribe',
            filename: path.basename(filePath),
            filePath,
            userId,
            language,
        });

        res.json({ jobId: job.id, status: 'queued' });

    } catch (err) {
        console.error('[captionRoutes] /generate error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
