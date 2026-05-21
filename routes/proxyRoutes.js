// ===== routes/proxyRoutes.js =====
const express = require('express');
const router = express.Router();
const { videoQueue } = require('../queue/queues');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateUser, optionalAuth } = require('../middleware/auth');

const uploadsDir = path.resolve(__dirname, '../uploads');
const uploadDir  = path.join(uploadsDir, 'temp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer: keep the original filename (used by exportRoutes to locate clips by name)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // 2 GB

// ─────────────────────────────────────────────────────────────────────────────
// Helper: validate that a resolved path stays inside /uploads
// ─────────────────────────────────────────────────────────────────────────────
function safeResolve(rawPath) {
    const resolved = path.resolve(uploadsDir, rawPath);
    if (!resolved.startsWith(uploadsDir)) return null;
    return resolved;
}

/**
 * Resolve a user ID from the request.
 * In production this comes from req.user (Supabase JWT).
 * In development (no session), fall back to a stable dev ID so the
 * pipeline keeps working without requiring a full auth flow.
 */
function resolveUserId(req) {
    if (req.user?.id) return req.user.id;
    // Dev fallback — clearly labelled so it's easy to spot in logs
    if (process.env.NODE_ENV !== 'production') return 'dev-user';
    return null;
}

/**
 * POST /api/proxy/generate
 * Trigger proxy generation for an already-uploaded video.
 * Body: { videoPath: string } (path relative to /uploads)
 *
 * Uses optionalAuth — authenticated users get their user ID attached;
 * unauthenticated dev requests continue with a dev-user ID.
 * In production, swap optionalAuth → authenticateUser to enforce auth.
 */
const authMiddleware = process.env.NODE_ENV === 'production' ? authenticateUser : optionalAuth;

router.post('/generate', authMiddleware, async (req, res) => {
    try {
        const { videoPath } = req.body;

        if (!videoPath) {
            return res.status(400).json({ error: 'Missing videoPath' });
        }

        // SECURITY: Enforce uploads/ boundary — no absolute paths from clients
        const safePath = safeResolve(videoPath);
        if (!safePath) {
            return res.status(403).json({ error: 'Access denied: invalid file path' });
        }
        if (!fs.existsSync(safePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const userId = resolveUserId(req);
        console.log(`[ProxyRoute] Generating proxy for: ${safePath} (user: ${userId})`);

        // Pass the uploads-relative path to job
        const relativeVideoPath = path.relative(uploadsDir, safePath);
        
        const job = await videoQueue.add('generate-proxy', {
            filename: path.basename(safePath),
            userId,
            inputPath: relativeVideoPath,
            outputDir: `proxies/${userId}`
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        res.json({
            jobId: job.id,
            status: 'queued',
            originalPath: relativeVideoPath
        });

    } catch (error) {
        console.error('[ProxyRoute] Error:', error);
        res.status(500).json({ error: 'Failed to enqueue proxy generation' });
    }
});

const storageConfig = require('../config/storage');

/**
 * POST /api/proxy/upload
 * Accept multipart/form-data video upload and trigger proxy generation.
 *
 * Uses optionalAuth for the same reason as /generate above.
 * Swap to authenticateUser before going to production.
 */
router.post('/upload', authMiddleware, (req, res, next) => {
    upload.single('video')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File too large. Maximum upload size is 2 GB.' });
            }
            return res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No video uploaded' });

        const userId = resolveUserId(req);
        const videoRelativePath = path.join('temp', req.file.filename);

        console.log(`[ProxyRoute] Upload received: ${videoRelativePath} (user: ${userId})`);

        // If using GCS, upload the raw file immediately so background workers
        // running on different nodes (e.g. Railway) can access it.
        if (storageConfig.bucket && !storageConfig.useLocalStorage) {
            const destPath = `raw/${userId}/${req.file.filename}`;
            console.log(`[ProxyRoute] Uploading raw file to GCS: ${destPath}...`);
            await storageConfig.bucket.upload(req.file.path, { destination: destPath });
            console.log(`[ProxyRoute] Raw file uploaded to GCS.`);
            // Note: We don't delete the local file here in case there's a local worker
            // or the export node needs it. The storage will clean it up later.
        }

        console.log(`[ProxyRoute] Enqueuing proxy generation...`);

        const job = await videoQueue.add('generate-proxy', {
            filename: req.file.filename,
            userId,
            inputPath: videoRelativePath,
            outputDir: `proxies/${userId}`
        }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        res.json({
            jobId: job.id,
            status: 'queued',
            originalPath: videoRelativePath
        });
    } catch (error) {
        console.error('[ProxyRoute Upload] Error:', error);
        res.status(500).json({ error: 'Failed to enqueue upload proxy generation' });
    }
});

module.exports = router;
