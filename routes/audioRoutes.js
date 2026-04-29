const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { devAuth } = require('../middleware/devAuth');
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
router.post('/denoise', devAuth, async (req, res) => {
    try {
        const { filePath, filename } = req.body;

        // Initial validation for input
        if (!filePath && !filename) {
            return res.status(400).json({ error: 'No filePath or filename provided' });
        }

        let inputPath = filePath;

        // If 'filename' is provided, look in uploads/temp (Standard for this app)
        if (filename && !inputPath) {
            inputPath = path.join(__dirname, '../uploads/temp', filename);
        }

        // Validate existence
        if (!inputPath || !fs.existsSync(inputPath)) {
            // Fallback: try resolving filePath relative to uploads/temp if it was just a name
            if (filePath && !path.isAbsolute(filePath)) {
                const tryPath = path.join(__dirname, '../uploads/temp', filePath);
                if (fs.existsSync(tryPath)) inputPath = tryPath;
            }

            if (!inputPath || !fs.existsSync(inputPath)) {
                return res.status(404).json({ error: 'File not found on server', path: inputPath || filePath });
            }
        }

        const outputPath = path.join(tempDir, `denoised-${Date.now()}.mp4`);

        console.log(`🎧 Denoising: ${inputPath}`);

        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .audioFilters('afftdn=nf=-25') // FFT Denoise, Noise Floor -25dB
                .videoCodec('copy') // Copy video stream (fast)
                .output(outputPath)
                .on('end', () => {
                    console.log('✅ Denoise Complete');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('❌ Denoise Error:', err);
                    reject(err);
                })
                .run();
        });

        // Return relative path for frontend to play/download
        // We need a route to serve this file.
        // Assuming express.static serves /uploads
        const servePath = `/uploads/audio_temp/${path.basename(outputPath)}`;

        res.json({
            success: true,
            url: servePath,
            message: "Noise reduction applied successfully."
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
router.post('/beat-detect', devAuth, async (req, res) => {
    try {
        const { filePath, filename } = req.body;

        // Validation similar to /denoise
        if (!filePath && !filename) {
            return res.status(400).json({ error: 'No filePath or filename provided' });
        }

        let inputPath = filePath;
        if (filename && !inputPath) inputPath = path.join(__dirname, '../uploads/temp', filename);

        if (!inputPath || !fs.existsSync(inputPath)) {
            if (filePath && !path.isAbsolute(filePath)) {
                const tryPath = path.join(__dirname, '../uploads/temp', filePath);
                if (fs.existsSync(tryPath)) inputPath = tryPath;
            }
            if (!inputPath || !fs.existsSync(inputPath)) {
                return res.status(404).json({ error: 'File not found' });
            }
        }

        console.log(`🥁 Detecting Beats for: ${inputPath}`);
        const result = await detectBeats(inputPath);
        console.log(`✅ BPM: ${result.bpm}, Detected ${result.beats.length} beats`);

        res.json({ success: true, ...result });

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
router.post('/normalize', devAuth, async (req, res) => {
    try {
        const { filePath, filename } = req.body;

        let inputPath = filePath;
        if (filename && !inputPath) inputPath = path.join(__dirname, '../uploads/temp', filename);

        if (!inputPath || !fs.existsSync(inputPath)) {
            // Fallback logic similar to others
            if (filePath && !path.isAbsolute(filePath)) {
                const tryPath = path.join(__dirname, '../uploads/temp', filePath);
                if (fs.existsSync(tryPath)) inputPath = tryPath;
            }
        }

        if (!inputPath || !fs.existsSync(inputPath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const outputPath = path.join(tempDir, `normalized-${Date.now()}.mp4`);
        console.log(`🔊 Normalizing Audio for: ${inputPath}`);

        await new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                // loudnorm filter: I=-16 (Integrated Loudness), TP=-1.5 (True Peak), LRA=11 (Loudness Range)
                .audioFilters('loudnorm=I=-16:TP=-1.5:LRA=11')
                .videoCodec('copy')
                .output(outputPath)
                .on('end', () => {
                    console.log('✅ Normalization Complete');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('❌ Normalization Error:', err);
                    reject(err);
                })
                .run();
        });

        const servePath = `/uploads/audio_temp/${path.basename(outputPath)}`;
        res.json({
            success: true,
            url: servePath,
            message: "Audio normalized to -16 LUFS."
        });

    } catch (error) {
        console.error("Normalize Failed:", error);
        res.status(500).json({ error: error.message });
    }
});

const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/audio/transcribe
 * Transcribes an audio file using OpenAI Whisper and returns word-level timestamps.
 * Useful for filler word and bad-take detection.
 */
router.post('/transcribe', devAuth, async (req, res) => {
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

        console.log(`🎙️ Transcribing with Whisper: ${inputPath}`);

        // Check if the file is a video, we might need to extract audio first for Whisper 
        // to save upload bandwidth and avoid 25MB limit on OpenAI.
        // For now, we will send it directly, assuming files are small enough for testing,
        // but we should ideally extract audio to a temp .mp3 first.
        const stats = fs.statSync(inputPath);
        if (stats.size > 25 * 1024 * 1024) {
             return res.status(400).json({ error: 'File is larger than OpenAI 25MB limit. Audio extraction needed.' });
        }

        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(inputPath),
            model: 'whisper-1',
            response_format: 'verbose_json',
            timestamp_granularities: ['word']
        });

        console.log(`✅ Transcription Complete. Words detected: ${transcription.words?.length || 0}`);

        res.json({
            success: true,
            text: transcription.text,
            words: transcription.words, // Array of { word, start, end }
            message: "Transcription successful"
        });

    } catch (error) {
        console.error("Transcription Failed:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
