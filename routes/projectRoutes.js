/**
 * projectRoutes.js
 *
 * Server-side project helpers that require server credentials (GCS, Supabase admin).
 * Currently exposes:
 *   POST /api/projects/:id/thumbnail — upload a JPEG thumbnail for a project
 */

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const { authenticateUser, optionalAuth } = require('../middleware/auth');
const { supabaseAdmin }                  = require('../config/database');
const storageConfig                      = require('../config/storage');

// Accept the thumbnail in memory (max 2 MB — more than enough for a JPEG thumb)
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 2 * 1024 * 1024 },
});

const authMiddleware =
    process.env.NODE_ENV === 'production' ? authenticateUser : optionalAuth;

function resolveUserId(req) {
    if (req.user?.id) return req.user.id;
    if (process.env.NODE_ENV !== 'production') return 'dev-user';
    return null;
}

// ─── POST /api/projects/:id/thumbnail ────────────────────────────────────────
//
// Body: multipart/form-data with a single field "thumbnail" (JPEG)
// Response: { thumbnailUrl: string }
//
router.post('/:id/thumbnail', authMiddleware, upload.single('thumbnail'), async (req, res) => {
    const projectId = req.params.id;
    const userId    = resolveUserId(req);
    if (!userId)    return res.status(401).json({ error: 'Unauthorized' });
    if (!req.file)  return res.status(400).json({ error: 'No thumbnail file provided' });

    try {
        let thumbnailUrl;
        const gcsObjectPath = `thumbnails/${userId}/${projectId}.jpg`;

        if (storageConfig.bucket && !storageConfig.useLocalStorage) {
            // ── GCS: save with public-read ACL so we can use the plain URL ─
            const file = storageConfig.bucket.file(gcsObjectPath);
            await file.save(req.file.buffer, {
                contentType:   'image/jpeg',
                predefinedAcl: 'publicRead',
            });

            const bucketName =
                process.env.GOOGLE_CLOUD_BUCKET_NAME ||
                process.env.GCS_BUCKET_NAME          ||
                'viral-pilot_bucket';

            thumbnailUrl = `https://storage.googleapis.com/${bucketName}/${gcsObjectPath}`;
            console.log(`[projectRoutes] Thumbnail uploaded to GCS: ${thumbnailUrl}`);
        } else {
            // ── Local storage fallback (dev / staging without GCS) ──────────
            const uploadsDir = path.join(__dirname, '..', 'uploads');
            const thumbDir   = path.join(uploadsDir, 'thumbnails', userId);
            fs.mkdirSync(thumbDir, { recursive: true });
            fs.writeFileSync(path.join(thumbDir, `${projectId}.jpg`), req.file.buffer);
            thumbnailUrl = `/uploads/thumbnails/${userId}/${projectId}.jpg`;
            console.log(`[projectRoutes] Thumbnail saved locally: ${thumbnailUrl}`);
        }

        // Update the projects row in Supabase
        const { error } = await supabaseAdmin
            .from('projects')
            .update({ thumbnail_url: thumbnailUrl })
            .eq('id', projectId);

        if (error) {
            console.error('[projectRoutes] Supabase update failed:', error.message);
            return res.status(500).json({ error: 'Failed to persist thumbnail URL' });
        }

        res.json({ thumbnailUrl });
    } catch (err) {
        console.error('[projectRoutes] Thumbnail upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
