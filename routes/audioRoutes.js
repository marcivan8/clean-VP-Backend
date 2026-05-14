const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { authenticateUser } = require('../middleware/auth');
const { audioQueue } = require('../queue/queues');
const ffmpegPath = require('ffmpeg-static');

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
router.post('/denoise', authenticateUser, async (req, res) => {
    try {
        const { filePath, filename } = req.body;

        if (!filePath && !filename) {
            return res.status(400).json({ error: 'No filePath or filename provided' });
        }

        // SECURITY: Resolve path and enforce uploads/ boundary
        const uploadsDir = path.resolve(__dirname, '../uploads');
        let inputPath;

        if (filename && !filePath) {
            inputPath = path.resolve(uploadsDir, 'temp', path.basename(filename));
        } else {
            inputPath = path.resolve(filePath);
        }

        if (!inputPath.startsWith(uploadsDir)) {
            return res.status(403).json({ error: 'Access denied: invalid file path' });
        }

        if (!fs.existsSync(inputPath)) {
            return res.status(404).json({ error: 'File not found on server' });
        }

        const outputPath = path.join(tempDir, `denoised-${Date.now()}.mp4`);

        console.log(`🎧 Enqueuing Denoise: ${inputPath}`);

        const job = await audioQueue.add('denoise-audio', {
            action: 'denoise',
            filePath: inputPath
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

const { detectBeats } = require('../analysis/beatDetector');

// ... existing /denoise route ...

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
        let inputPath = filename && !filePath
            ? path.resolve(uploadsDir, 'temp', path.basename(filename))
            : path.resolve(filePath);

        if (!inputPath.startsWith(uploadsDir)) {
            return res.status(403).json({ error: 'Access denied: invalid file path' });
        }
        if (!fs.existsSync(inputPath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        console.log(`🥁 Enqueuing Beat Detection for: ${inputPath}`);
        
        const job = await audioQueue.add('beat-detect', {
            action: 'beat-detect',
            filePath: inputPath
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
router.post('/normalize', authenticateUser, async (req, res) => {
    try {
        const { filePath, filename } = req.body;

        // SECURITY: Enforce uploads/ boundary
        const uploadsDir = path.resolve(__dirname, '../uploads');
        let inputPath = filename && !filePath
            ? path.resolve(uploadsDir, 'temp', path.basename(filename))
            : path.resolve(filePath || '');

        if (!inputPath.startsWith(uploadsDir)) {
            return res.status(403).json({ error: 'Access denied: invalid file path' });
        }
        if (!fs.existsSync(inputPath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const outputPath = path.join(tempDir, `normalized-${Date.now()}.mp4`);
        console.log(`🔊 Enqueuing Audio Normalization for: ${inputPath}`);

        const job = await audioQueue.add('normalize-audio', {
            action: 'normalize',
            filePath: inputPath
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
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

        if (!fs.existsSync(inputPath)) {
            return res.status(404).json({ error: `File not found: ${filename || filePath}` });
        }

        console.log(`🎙️ Enqueuing Transcription: ${inputPath}`);

        const job = await audioQueue.add('transcribe-audio', {
            action: 'transcribe',
            filePath: inputPath
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

// ── Core filler detection logic (shared by both call styles) ──────────────────
async function detectFillerWords(inputPath, language = 'en') {
    const FILLER_WORDS = new Set([
        'um', 'uh', 'ah', 'er', 'eh', 'hmm', 'hm',
        'like', 'basically', 'literally',
        'you know', 'i mean', 'kind of', 'sort of',
        // French
        'euh', 'ben', 'genre', 'voilà', 'bah',
    ]);

    const stats = require('fs').statSync(inputPath);
    if (stats.size > 25 * 1024 * 1024) {
        throw new Error('File exceeds OpenAI 25 MB Whisper limit. Extract audio first.');
    }

    console.log(`🔤 Filler detection: transcribing ${inputPath}`);

    const transcription = await openai.audio.transcriptions.create({
        file: require('fs').createReadStream(inputPath),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
        language: language === 'auto' ? undefined : language,
    });

    const words = transcription.words || [];
    const totalDuration = transcription.duration || (words.length ? words[words.length - 1].end : 0);

    // Identify filler word spans (merge adjacent fillers separated by < 0.15 s)
    const MERGE_GAP = 0.15;
    const fillerSpans = [];
    let current = null;

    for (const w of words) {
        const token = w.word.toLowerCase().replace(/[^a-zàâéèêëîïôùûüç ]/g, '').trim();
        const isFiller = FILLER_WORDS.has(token);

        if (isFiller) {
            if (current && w.start - current.end <= MERGE_GAP) {
                current.end = w.end; // extend running span
            } else {
                if (current) fillerSpans.push(current);
                current = { start: w.start, end: w.end };
            }
        } else {
            if (current) { fillerSpans.push(current); current = null; }
        }
    }
    if (current) fillerSpans.push(current);

    // Build the inverse: speech segments to KEEP
    const activeSegments = [];
    let cursor = 0;
    for (const span of fillerSpans) {
        if (span.start > cursor + 0.01) {
            activeSegments.push({ start: cursor, end: span.start, duration: span.start - cursor });
        }
        cursor = span.end;
    }
    if (cursor < totalDuration - 0.01) {
        activeSegments.push({ start: cursor, end: totalDuration, duration: totalDuration - cursor });
    }

    return {
        fillerCount: fillerSpans.length,
        removedSegments: fillerSpans.map(s => ({ ...s, duration: s.end - s.start })),
        activeSegments,
        transcript: transcription.text,
        totalDuration,
    };
}

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
        if (!require('fs').existsSync(inputPath)) {
            return res.status(404).json({ error: `File not found: ${filename || filePath}` });
        }

        console.log(`🔤 Enqueuing Filler detection: ${inputPath}`);

        const job = await audioQueue.add('filler-detect', {
            action: 'filler-detect',
            filePath: inputPath,
            language
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

        const job = await audioQueue.add('filler-detect', {
            action: 'filler-detect',
            filePath: tmpPath,
            language
        });

        res.json({ success: true, jobId: job.id, status: 'queued' });

    } catch (err) {
        console.error('❌ Filler detect (upload) failed:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
