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
        
        const uniqueJobId = `proxy-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
        const job = await videoQueue.add('generate-proxy', {
            filename: path.basename(safePath),
            userId,
            inputPath: relativeVideoPath,
            outputDir: `proxies/${userId}`
        }, {
            jobId: uniqueJobId,
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

// ── In-memory segment cache ───────────────────────────────────────────────────
// Caches small GCS objects (HLS .ts segments, .m3u8 playlists) so seek-backs
// after playback.reload() are instant instead of re-fetching from GCS each time.
const _segCache   = new Map(); // gcsPath → { buf: Buffer, ts: number }
const SEG_TTL_MS  = 10 * 60 * 1000; // .ts segments expire after 10 min
const M3U8_TTL_MS = 30 * 1000;       // .m3u8 playlists expire after 30 s
const MAX_CACHE_BYTES = 5 * 1024 * 1024; // never cache objects > 5 MB
const MAX_CACHE_ENTRIES = 120;

function _cacheGet(key, ext) {
    const entry = _segCache.get(key);
    if (!entry) return null;
    const ttl = ext === '.m3u8' ? M3U8_TTL_MS : SEG_TTL_MS;
    if (Date.now() - entry.ts > ttl) { _segCache.delete(key); return null; }
    return entry.buf;
}

function _cachePut(key, buf) {
    if (buf.length > MAX_CACHE_BYTES) return;
    if (_segCache.size >= MAX_CACHE_ENTRIES) {
        _segCache.delete(_segCache.keys().next().value); // evict oldest (insertion order)
    }
    _segCache.set(key, { buf, ts: Date.now() });
}

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

        // If using GCS, upload the raw file BEFORE enqueuing the proxy job so
        // the worker (which may be a separate Railway container) can always find
        // the source file in GCS when it picks up the job.
        let rawGcsPath = null;
        if (storageConfig.bucket && !storageConfig.useLocalStorage) {
            const safeFilename = req.file.filename
                .replace(/\s+/g, '_')
                .replace(/[^a-zA-Z0-9._-]/g, '');
            rawGcsPath = `raw/${userId}/${safeFilename}`;
            console.log(`[ProxyRoute] Uploading raw file to GCS: ${rawGcsPath}...`);
            try {
                await storageConfig.bucket.upload(req.file.path, { destination: rawGcsPath });
                console.log(`[ProxyRoute] Raw file uploaded to GCS: ${rawGcsPath}`);
            } catch (err) {
                console.error(`[ProxyRoute] GCS raw upload failed (will retry in worker):`, err.message);
                rawGcsPath = null; // don't lie to the worker if upload failed
            }
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
            originalPath: videoRelativePath,
            gcsPath: rawGcsPath,
        });
    } catch (error) {
        console.error('[ProxyRoute Upload] Error:', error);
        res.status(500).json({ error: 'Failed to enqueue upload proxy generation' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Direct to GCS Upload Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/proxy/upload-url
 * Generate a Resumable Session URL for direct-to-GCS browser uploads.
 */
router.post('/upload-url', authMiddleware, async (req, res) => {
    try {
        const { filename, contentType } = req.body;
        if (!storageConfig.bucket || storageConfig.useLocalStorage) {
            return res.status(400).json({ error: 'GCS not configured' });
        }
        const userId = resolveUserId(req);
        
        // Use a timestamp to prevent filename collisions in GCS
        const safeFilename = path.basename(filename || 'video.mp4').replace(/[^a-zA-Z0-9.\-_]/g, '');
        const destPath = `raw/${userId}/${Date.now()}-${safeFilename}`;
        const file = storageConfig.bucket.file(destPath);
        
        const [sessionUrl] = await file.createResumableUpload({
            origin: req.headers.origin || '*',
            metadata: {
                contentType: contentType || 'application/octet-stream',
            }
        });
        
        res.json({ sessionUrl, destPath });
    } catch (err) {
        console.error('[ProxyRoute] upload-url error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/proxy/process-direct
 * Triggers the proxy generation job for a file that was just directly uploaded to GCS.
 */
router.post('/process-direct', authMiddleware, async (req, res) => {
    try {
        const { destPath, originalFilename } = req.body;
        const userId = resolveUserId(req);
        
        if (!destPath || !destPath.startsWith(`raw/${userId}/`)) {
            return res.status(403).json({ error: 'Invalid destination path' });
        }

        console.log(`[ProxyRoute] Enqueuing proxy generation for direct upload: ${destPath}`);

        // The worker expects inputPath to be relative to 'uploads/'.
        // By passing 'temp/filename', it fails local fs checks and falls back to GCS download
        // using the job's filename (which we set exactly to the GCS basename).
        const filenameInGcs = path.basename(destPath);
        const pseudoInputPath = path.join('temp', filenameInGcs);

        const uniqueJobId = `proxy2-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
        const job = await videoQueue.add('generate-proxy', {
            filename: filenameInGcs,
            userId,
            inputPath: pseudoInputPath,
            outputDir: `proxies/${userId}`
        }, {
            jobId: uniqueJobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        res.json({
            jobId: job.id,
            status: 'queued',
            originalPath: pseudoInputPath
        });
    } catch (error) {
        console.error('[ProxyRoute Process Direct] Error:', error);
        res.status(500).json({ error: 'Failed to enqueue proxy generation' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/proxy/gcs-media/*
// Streams any GCS object (or local file) through the server.
// Avoids CORS and public-access issues — the server has credentials, clients don't.
// Works for both .m3u8 playlist files and .ts HLS segment files; relative segment
// URLs in a playlist resolve back to this route automatically.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/gcs-media/*', async (req, res) => {
    const gcsPath = req.params[0];
    if (!gcsPath) return res.status(400).end();

    const storageConfig = require('../config/storage');
    const { bucket, useLocalStorage } = storageConfig;

    const CONTENT_TYPES = {
        '.m3u8': 'application/x-mpegURL',
        '.ts':   'video/MP2T',
        '.mp4':  'video/mp4',
        '.webm': 'video/webm',
        '.mov':  'video/quicktime',
        '.json': 'application/json',
    };
    const ext = path.extname(gcsPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    // ── Local storage fallback ────────────────────────────────────────────
    if (useLocalStorage || !bucket) {
        const localPath = safeResolve(gcsPath);
        if (!localPath || !fs.existsSync(localPath)) return res.status(404).end();
        return res.sendFile(localPath);
    }

    // ── GCS with in-memory cache for HLS segments ─────────────────────────
    // .ts segments and .m3u8 playlists are buffered on first fetch so that
    // repeat seeks (after playback.reload()) are served instantly from memory.
    const CACHEABLE_EXTS = new Set(['.ts', '.m3u8', '.json']);
    const cachedBuf = _cacheGet(gcsPath, ext);

    try {
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.setHeader('Access-Control-Allow-Origin', '*');
        // Always advertise range support — required for video seeking in browsers
        // and to prevent HTTP/2 ERR_HTTP2_PROTOCOL_ERROR when the browser retries.
        res.setHeader('Accept-Ranges', 'bytes');

        // ── Cache hit ──────────────────────────────────────────────────────
        if (cachedBuf) {
            if (req.headers.range) {
                const fileSize = cachedBuf.length;
                const [startStr, endStr] = req.headers.range.replace(/bytes=/, '').split('-');
                const start = parseInt(startStr);
                const end = endStr ? parseInt(endStr) : fileSize - 1;
                res.status(206);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                res.setHeader('Content-Length', end - start + 1);
                return res.end(cachedBuf.slice(start, end + 1));
            }
            res.setHeader('Content-Length', cachedBuf.length);
            return res.end(cachedBuf);
        }

        // ── Cache miss: fetch from GCS ─────────────────────────────────────
        const file = bucket.file(gcsPath);
        const [exists] = await file.exists();
        if (!exists) return res.status(404).end();

        // Fetch metadata once — needed for Content-Length (full response) and
        // Content-Range (range response). Always required for video seeking.
        const [metadata] = await file.getMetadata();
        const fileSize = parseInt(metadata.size);

        if (req.headers.range) {
            const [startStr, endStr] = req.headers.range.replace(/bytes=/, '').split('-');
            const start = parseInt(startStr);
            const end = endStr ? parseInt(endStr) : fileSize - 1;
            const chunkLen = end - start + 1;
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            res.setHeader('Content-Length', chunkLen);
            const stream = file.createReadStream({ start, end });
            stream.on('error', (err) => {
                console.error('[proxy/gcs-media] Range stream error', gcsPath, ':', err.message);
                if (!res.headersSent) res.status(500).end();
            });
            // Destroy GCS stream if client disconnects to avoid hanging connections
            res.on('close', () => stream.destroy());
            return stream.pipe(res);
        }

        if (CACHEABLE_EXTS.has(ext)) {
            // Buffer the whole object so it can be cached for future seeks
            const chunks = [];
            const stream = file.createReadStream();
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => {
                const buf = Buffer.concat(chunks);
                _cachePut(gcsPath, buf);
                res.setHeader('Content-Length', buf.length);
                res.end(buf);
            });
            stream.on('error', (err) => {
                console.error('[proxy/gcs-media] Stream error', gcsPath, ':', err.message);
                if (!res.headersSent) res.status(500).end();
            });
        } else {
            // Large video files (mp4/mov/webm) — stream directly with Content-Length.
            // Without Content-Length Railway's HTTP/2 proxy returns ERR_HTTP2_PROTOCOL_ERROR
            // because it can't frame the response correctly over a multiplexed connection.
            res.setHeader('Content-Length', fileSize);
            const stream = file.createReadStream();
            stream.on('error', (err) => {
                console.error('[proxy/gcs-media] Video stream error', gcsPath, ':', err.message);
                if (!res.headersSent) res.status(500).end();
            });
            res.on('close', () => stream.destroy());
            stream.pipe(res);
        }
    } catch (err) {
        console.error('[proxy/gcs-media] Error streaming', gcsPath, ':', err.message);
        if (!res.headersSent) res.status(500).end();
    }
});

module.exports = router;
