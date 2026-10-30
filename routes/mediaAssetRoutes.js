'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const { authenticateUser } = require('../middleware/auth.js');
const { StorageService } = require('../services/StorageService.js');

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (file.mimetype?.startsWith('image/') && ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
            return callback(null, true);
        }
        callback(new Error('Only JPG, PNG, WebP, and GIF images are supported.'));
    },
});

router.post('/image', authenticateUser, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'An image file is required.' });
    try {
        const stored = await StorageService.uploadVideo(req.file, req.user.id, false);
        return res.json({
            gcsPath: stored.path,
            sourceUrl: stored.path,
            mediaUrl: `/api/proxy/gcs-media/${stored.path}`,
            name: req.file.originalname,
            mimeType: req.file.mimetype,
            size: stored.size,
        });
    } catch (error) {
        console.error('[mediaAssetRoutes] image upload failed:', error.message);
        return res.status(500).json({ error: 'Could not store the image.' });
    }
});

module.exports = router;
