const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const { audioQueue } = require('../queue/queues');
const ffmpegPath = require('ffmpeg-static');
const storageConfig = require('../config/storage');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Ensure temp directory exists
const tempDir = path.join(__dirname, '../uploads/audio_temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * POST /api/audio/denoise
 * Applies Noise Reduction to a video or audio file.
 * Returns the path to the cleaned audio/video.
 */
router.post('/denoise', optionalAuth, async (req, res) => {
    try {
        const { filePath, filename } = req.body;

        if (!filePath && !filename) {
            return res.status(400).json({ error: 'No filePath or filename provided' });
        }

        // SECURITY: Resolve path and enforce uploads/ boundary
        const uploadsDir = path.resolve(__dirname, '../uploads');
        let inputPath;

        if (filename && !filePath) {
            const norm = filename.replace(/\\/g, '/').replace(/^\/|\.\.\/|\.\.$/g, '');
            inputPath = path.resolve(uploadsDir, norm);
            // Fall back to temp/ for bare filenames (e.g. "video.mp4" with no directory)
            if (!fs.existsSync(inputPath)) {
                const tempPath = path.resolve(uploadsDir, 'temp', path.basename(filename));
                if (fs.existsSync(tempPath)) inputPath = tempPath;
            }
        } else {
            inputPath = path.resolve(filePath);
        }

        if (!inputPath.startsWith(uploadsDir)) {
            return res.status(403).json({ error: 'Access denied: invalid file path' });
        }

        if (!fs.existsSync(inputPath)) {
            if (storageConfig.bucket && !storageConfig.useLocalStorage) {
                console.warn(`[audioRoutes] File not found locally (${inputPath}); worker will attempt GCS download.`);
            } else {
                return res.status(404).json({ error: 'File not found on server' });
            }
        }

        console.log(`🎧 Enqueuing Denoise: ${inputPath}`);

        const uniqueJobId = `denoise-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
        const job = await audioQueue.add('denoise-audio', {
            action: 'denoise',
            filePath: inputPath
        }, {
            jobId: uniqueJobId
        });

        res.json({
            success: true,
            jobId: job.id,
            status: 'queued'
        });

    } catch (error) {
        console.error("Denoise Endpoint Failed:", error);
        res.status(500).json({ error: error.message });
    }
});


/**
 * POST /api/audio/beat-detect
 * Analyzes audio/video for BPM and beat timestamps.
 */
router.post('/beat-detect', authenticateUser, async (req, res) => {
    try {
        const { filePath, filename } = req.body;

        if (!filePath && !filename) {
            return res.status(400).json({ error: 'No filePath or filename provided' });
        }

        // SECURITY: Enforce uploads/ boundary
        const uploadsDir = path.resolve(__dirname, '../uploads');
        let inputPath;
        if (filename && !filePath) {
            const norm = filename.replace(/\\/g, '/').replace(/^\/|\.\.\/|\.\.$/g, '');
            inputPath = path.resolve(uploadsDir, norm);
            if (!fs.existsSync(inputPath)) {
                const tempPath = path.resolve(uploadsDir, 'temp', path.basename(filename));
                if (fs.existsSync(tempPath)) inputPath = tempPath;
            }
        } else {
            inputPath = path.resolve(filePath);
        }

        if (!inputPath.startsWith(uploadsDir)) {
            return res.status(403).json({ error: 'Access denied: invalid file path' });
        }
        if (!fs.existsSync(inputPath)) {
            if (storageConfig.bucket && !storageConfig.useLocalStorage) {
                console.warn(`[audioRoutes] File not found locally (${inputPath}); worker will attempt GCS download.`);
            } else {
                return res.status(404).json({ error: 'File not found' });
            }
        }

        console.log(`🥁 Enqueuing Beat Detection for: ${inputPath}`);
        
        const uniqueJobId = `beat-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
        const job = await audioQueue.add('beat-detect', {
            action: 'beat-detect',
            filePath: inputPath
        }, {
            jobId: uniqueJobId
        });

        res.json({ success: true, jobId: job.id, status: 'queued' });

    } catch (error) {
        console.error("Beat Detection Failed:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/audio/normalize
 * Normalizes audio loudness to standard levels (EBU R128 / Podcasts).
 * Target: -16 LUFS (Integrated), -1.5 dB (True Peak)
 */
router.post('/normalize', optionalAuth, async (req, res) => {
    try {
        const { filePath, filename } = req.body;

        // SECURITY: Enforce uploads/ boundary
        const uploadsDir = path.resolve(__dirname, '../uploads');
        let inputPath;
        if (filename && !filePath) {
            const norm = filename.replace(/\\/g, '/').replace(/^\/|\.\.\/|\.\.$/g, '');
            inputPath = path.resolve(uploadsDir, norm);
            if (!fs.existsSync(inputPath)) {
                const tempPath = path.resolve(uploadsDir, 'temp', path.basename(filename));
                if (fs.existsSync(tempPath)) inputPath = tempPath;
            }
        } else {
            inputPath = path.resolve(filePath || '');
        }

        if (!inputPath.startsWith(uploadsDir)) {
            return res.status(403).json({ error: 'Access denied: invalid file path' });
        }
        if (!fs.existsSync(inputPath)) {
            if (storageConfig.bucket && !storageConfig.useLocalStorage) {
                console.warn(`[audioRoutes] File not found locally (${inputPath}); worker will attempt GCS download.`);
            } else {
                return res.status(404).json({ error: 'File not found' });
            }
        }

        console.log(`🔊 Enqueuing Audio Normalization for: ${inputPath}`);

        const uniqueJobId = `normalize-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
        const job = await audioQueue.add('normalize-audio', {
            action: 'normalize',
            filePath: inputPath
        }, {
            jobId: uniqueJobId
        });

        res.json({
            success: true,
            jobId: job.id,
            status: 'queued'
        });

    } catch (error) {
        console.error("Normalize Failed:", error);
        res.status(500).json({ error: error.message });
    }
});

const multer = require('multer');

// In-memory storage for filler-detect multipart uploads (files stay in RAM, not disk)
const fillerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * POST /api/audio/transcribe
 * Transcribes an audio file using OpenAI Whisper and returns word-level timestamps.
 * Useful for filler word and bad-take detection.
 */
router.post('/transcribe', authenticateUser, async (req, res) => {
    try {
        const { filename, filePath } = req.body;

        if (!filename && !filePath) {
            return res.status(400).json({ error: 'Filename or filePath is required' });
        }

        // SECURITY: Sanitize filename and restrict to allowed directories
        const uploadsDir = path.resolve(__dirname, '../uploads');
        const publicDir = path.resolve(__dirname, '../client/public');
        
        let inputPath = filePath;
        if (filename && !inputPath) {
            const normalizedFilename = filename.startsWith('/') ? filename.slice(1) : filename;
            inputPath = path.resolve(uploadsDir, normalizedFilename);

            if (!inputPath.startsWith(uploadsDir)) {
                inputPath = path.resolve(publicDir, normalizedFilename);
                if (!inputPath.startsWith(publicDir)) {
                    return res.status(403).json({ error: 'Access denied: Invalid file path' });
                }
            }
        }

        // Bare filenames (e.g. "IMG_0029.MOV") land in uploads/temp/ — fall back there
        if (!fs.existsSync(inputPath)) {
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(inputPath));
            if (tempPath.startsWith(uploadsDir) && fs.existsSync(tempPath)) {
                inputPath = tempPath;
            } else {
                if (storageConfig.bucket && !storageConfig.useLocalStorage) {
                    console.warn(`[audioRoutes] File not found locally (${inputPath}); worker will attempt GCS download.`);
                } else {
                    return res.status(404).json({ error: `File not found: ${filename || filePath}` });
                }
            }
        }

        console.log(`🎙️ Enqueuing Transcription: ${inputPath}`);

        const userId = req.user?.id || (process.env.NODE_ENV !== 'production' ? 'dev-user' : null);
        const uniqueJobId = `transcribe-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
        const job = await audioQueue.add('transcribe-audio', {
            action: 'transcribe',
            filename: path.basename(inputPath),
            filePath: inputPath,
            userId
        }, {
            jobId: uniqueJobId
        });

        res.json({
            success: true,
            jobId: job.id,
            status: 'queued'
        });

    } catch (error) {
        console.error("Transcription Failed:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/audio/filler/detect   ← registered in index.js as /api/audio/filler/detect
 * (also aliased by proxyRoutes to /api/filler/detect for backward compat)
 *
 * Accepts either:
 *   - multipart/form-data  { file: <binary> }  — direct upload
 *   - application/json     { filename: string } — filename already in /uploads/temp
 *
 * Returns:
 *   { success, removedSegments, activeSegments, fillerCount, transcript }
 */

// ── Route: filename-based (JSON body, file already on server) ─────────────────
router.post('/filler/detect', authenticateUser, async (req, res) => {
    try {
        const { filename, filePath, language = 'en' } = req.body;

        if (!filename && !filePath) {
            return res.status(400).json({ error: 'Provide filename or filePath' });
        }

        const uploadsDir = path.resolve(__dirname, '../uploads');
        const normalizedFilename = (filename || '').replace(/\\/g, '/').replace(/^\/|\.\.\/|\.\.$/g, '');
        let inputPath = filePath
            ? path.resolve(filePath)
            : path.resolve(uploadsDir, normalizedFilename);

        if (!inputPath.startsWith(uploadsDir)) {
            return res.status(403).json({ error: 'Access denied: invalid file path' });
        }

        // Bare filenames land in uploads/temp/ — fall back there
        if (!require('fs').existsSync(inputPath)) {
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(inputPath));
            if (tempPath.startsWith(uploadsDir) && require('fs').existsSync(tempPath)) {
                inputPath = tempPath;
            } else {
                if (storageConfig.bucket && !storageConfig.useLocalStorage) {
                    console.warn(`[audioRoutes] File not found locally (${inputPath}); worker will attempt GCS download.`);
                } else {
                    return res.status(404).json({ error: `File not found: ${filename || filePath}` });
                }
            }
        }

        console.log(`🔤 Enqueuing Filler detection: ${inputPath}`);

        const userId = req.user?.id || (process.env.NODE_ENV !== 'production' ? 'dev-user' : null);
        const uniqueJobId = `filler-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const job = await audioQueue.add('filler-detect', {
            action: 'filler-detect',
            filename: path.basename(inputPath),
            filePath: inputPath,
            userId,
            language
        }, {
            jobId: uniqueJobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        res.json({ success: true, jobId: job.id, status: 'queued' });

    } catch (err) {
        console.error('❌ Filler detect (JSON) failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Route: multipart upload (file sent directly) ──────────────────────────────
router.post('/filler/detect-upload', authenticateUser, fillerUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const language = req.body.language || 'en';

        // Write buffer to a temp file so Whisper can stream it
        const tmpPath = path.join(tempDir, `filler-upload-${Date.now()}${path.extname(req.file.originalname || '.mp4')}`);
        require('fs').writeFileSync(tmpPath, req.file.buffer);

        console.log(`🔤 Enqueuing Filler detection (upload): ${tmpPath}`);

        const uniqueJobId = `fillerup-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
        const job = await audioQueue.add('filler-detect', {
            action: 'filler-detect',
            filePath: tmpPath,
            language
        }, {
            jobId: uniqueJobId
        });

        res.json({ success: true, jobId: job.id, status: 'queued' });

    } catch (err) {
        console.error('❌ Filler detect (upload) failed:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
