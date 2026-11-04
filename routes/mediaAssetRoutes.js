'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const { authenticateUser } = require('../middleware/auth.js');
const { StorageService } = require('../services/StorageService.js');
const storageConfig = require('../config/storage.js');
const { supabaseAdmin } = require('../config/database.js');

const router = express.Router();
const REFERENCE_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const REFERENCE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
function referenceKind(ext, contentType) {
    const type = String(contentType || '').toLowerCase();
    const generic = !type || type === 'application/octet-stream';
    if (REFERENCE_VIDEO_EXTENSIONS.has(ext) && (generic || type.startsWith('video/'))) return 'video';
    if (REFERENCE_IMAGE_EXTENSIONS.has(ext) && (generic || type.startsWith('image/'))) return 'image';
    return null;
}
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

// Chat references are stored in their own namespace. They are never sent to
// the proxy/transcription/media-bin pipeline; the edit workflow reads them
// only through /api/brain/analyze-style-reference.
router.post('/reference-upload-url', authenticateUser, async (req, res) => {
    try {
        if (!storageConfig.bucket || storageConfig.useLocalStorage) {
            return res.status(503).json({ error: 'Reference uploads require configured object storage.' });
        }
        const filename = path.basename(String(req.body?.filename || 'reference'));
        const contentType = String(req.body?.contentType || 'application/octet-stream').toLowerCase();
        const assetId = String(req.body?.assetId || '');
        const ext = path.extname(filename).toLowerCase();
        if (!/^asset-[A-Za-z0-9_-]{6,100}$/.test(assetId) || !referenceKind(ext, contentType)) {
            return res.status(400).json({ error: 'A supported video or image reference is required.' });
        }

        const userId = String(req.user.id);
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160) || 'reference';
        const destPath = `references/${userId}/${assetId}/${Date.now()}-${safeName}`;
        const [sessionUrl] = await storageConfig.bucket.file(destPath).createResumableUpload({
            origin: req.headers.origin || '*',
            metadata: {
                contentType,
                metadata: { userId, assetId, originalName: filename, uploadedAt: new Date().toISOString(), purpose: 'assistant-reference' },
            },
        });
        return res.json({ sessionUrl, destPath });
    } catch (error) {
        console.error('[mediaAssetRoutes] reference upload init failed:', error.message);
        return res.status(500).json({ error: 'Could not initialize the reference upload.' });
    }
});

router.post('/complete-reference-upload', authenticateUser, async (req, res) => {
    try {
        const assetId = String(req.body?.assetId || '');
        const gcsPath = String(req.body?.gcsPath || '');
        const name = String(req.body?.name || '').trim().slice(0, 240);
        const userId = String(req.user.id);
        const parts = gcsPath.split('/');
        if (!/^asset-[A-Za-z0-9_-]{6,100}$/.test(assetId)
            || parts.length !== 4
            || parts[0] !== 'references'
            || parts[1] !== userId
            || parts[2] !== assetId
            || !/^[0-9]+-[^/]+$/.test(parts[3])) {
            return res.status(403).json({ error: 'Invalid reference upload path.' });
        }
        if (!storageConfig.bucket) return res.status(503).json({ error: 'Reference storage is unavailable.' });
        const file = storageConfig.bucket.file(gcsPath);
        const [exists] = await file.exists();
        if (!exists) return res.status(400).json({ error: 'Reference upload has not finished.' });
        const [metadata] = await file.getMetadata();
        const contentType = String(metadata?.contentType || '').toLowerCase();
        const ext = path.extname(name || parts[3]).toLowerCase();
        if (!referenceKind(ext, contentType)) return res.status(400).json({ error: 'Uploaded reference must be a supported video or image.' });

        const { error } = await supabaseAdmin.from('media_assets').insert({
            id: assetId,
            user_id: userId,
            // Reference rows are not media-bin footage and therefore do not
            // participate in project asset analysis/classification queries.
            project_id: null,
            name: name || parts[3].replace(/^\d+-/, ''),
            gcs_path: gcsPath,
            is_reference: true,
            analysis_status: 'done',
        });
        if (error?.code === '23505') {
            return res.status(409).json({ error: 'This reference asset id is already in use.' });
        }
        if (error) throw error;

        return res.json({
            assetId,
            gcsPath,
            mediaUrl: `/api/proxy/gcs-media/${gcsPath}`,
            sourceUrl: gcsPath,
            name: name || parts[3].replace(/^\d+-/, ''),
            mimeType: contentType,
            size: Number(metadata?.size) || 0,
        });
    } catch (error) {
        console.error('[mediaAssetRoutes] reference upload completion failed:', error.message);
        return res.status(500).json({ error: 'Could not save the reference asset.' });
    }
});

module.exports = router;
