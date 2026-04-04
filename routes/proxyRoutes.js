// ===== routes/proxyRoutes.js =====
const express = require('express');
const router = express.Router();
const ProxyService = require('../services/ProxyService');
const StorageService = require('../services/StorageService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../uploads/temp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        // Keep original filename if possible to satisfy export Routes, but prepend proxy so it doesn't overwrite if needed?
        // Actually exportRoutes tries to read exact filename. Let's use originalname.
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

/**
 * POST /api/proxy/generate
 * Trigger proxy generation for a video.
 * Body: { videoPath: string, userId: string }
 */
router.post('/generate', async (req, res) => {
    try {
        const { videoPath, userId } = req.body;

        if (!videoPath || !userId) {
            return res.status(400).json({ error: 'Missing videoPath or userId' });
        }

        console.log(`[ProxyRoute] Received request for: ${videoPath}`);

        // 1. Check if proxy already exists
        const filename = videoPath.split('/').pop().split('.')[0];
        // This is a naive check; ideally we store proxy state in DB.
        // But for now, let's just trigger generation.

        // 2. Start generation (Non-blocking response intentionally?)
        // The user wants to run the platform, so blocking until done might be slow (FFmpeg is slow).
        // However, for simplicity, let's await it or return a "job started" status.
        // Let's await for this MVP to avoid complex polling UI. A 30s video takes ~2-5s to proxy.
        // If it's long, we might timeout. Let's try await first.

        const outputRelativePath = await ProxyService.generateProxy(videoPath, userId);

        res.json({
            status: 'completed',
            originalPath: videoPath,
            proxyPath: outputRelativePath,
            proxyUrl: `/uploads/${outputRelativePath}` // Assumes static mount
        });

    } catch (error) {
        console.error('[ProxyRoute] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/proxy/upload
 * Accept multipart/form-data video upload and trigger proxy generation.
 */
router.post('/upload', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No video uploaded' });

        // multer saves to uploads/temp/<filename> — pass the temp-relative path so
        // ProxyService can resolve uploads/temp/<filename> from the uploads root.
        const videoRelativePath = path.join('temp', req.file.filename);
        const userId = req.body.userId || 'demo';

        console.log(`[ProxyRoute] Upload received: ${videoRelativePath}, generating proxy...`);

        const outputRelativePath = await ProxyService.generateProxy(videoRelativePath, userId);

        // Clean up the temp file once proxy is done
        fs.unlink(req.file.path, (err) => {
            if (err) console.warn('[ProxyRoute] Could not delete temp file:', err.message);
        });

        res.json({
            status: 'completed',
            originalPath: videoRelativePath,
            proxyPath: outputRelativePath,
            proxyUrl: `/uploads/${outputRelativePath}`
        });
    } catch (error) {
        console.error('[ProxyRoute Upload] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
