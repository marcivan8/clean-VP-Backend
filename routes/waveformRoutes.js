/**
 * routes/waveformRoutes.js
 *
 * POST /api/waveform/extract
 *   Body: { assetId, gcsPath }
 *   Returns: { peaksUrl, cached }
 *
 * Extracts audio peaks from a video/audio file using ffmpeg, stores the result
 * as waveforms/{userId}/{assetId}.json in GCS (or uploads/ locally), and
 * returns a URL the client can fetch to get the peaks array.
 *
 * Peak extraction: raw PCM at 22 050 Hz mono → 441 samples/peak → 50 peaks/sec.
 * Peaks are normalised 0-1 (max absolute amplitude in each window).
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const { spawn }  = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const path       = require('path');
const fs         = require('fs');

const storageConfig  = require('../config/storage');
const { optionalAuth } = require('../middleware/auth');

// ─── Peak extraction ──────────────────────────────────────────────────────────

const SAMPLE_RATE     = 22050;
const PEAKS_PER_SEC   = 50;
const SAMPLES_PER_WIN = Math.floor(SAMPLE_RATE / PEAKS_PER_SEC); // 441

/**
 * Run ffmpeg on inputPath (file) or inputStream (GCS read stream).
 * Returns { peaks: number[], duration: number }.
 */
function extractPeaks(inputPath, inputStream) {
    return new Promise((resolve, reject) => {
        const args = [
            '-i', inputStream ? 'pipe:0' : inputPath,
            '-vn',                          // drop video stream
            '-ac', '1',                     // mono
            '-ar', String(SAMPLE_RATE),
            '-f', 's16le',
            '-acodec', 'pcm_s16le',
            'pipe:1',
        ];

        const ff = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'ignore'] });

        if (inputStream) {
            inputStream.pipe(ff.stdin);
            inputStream.on('error', () => ff.stdin.destroy());
            ff.stdin.on('error', () => {}); // suppress EPIPE when stream closes early
        }

        const chunks = [];
        ff.stdout.on('data', chunk => chunks.push(chunk));

        ff.on('error', reject);

        ff.on('close', code => {
            const pcm = Buffer.concat(chunks);

            if (code !== 0 && pcm.length === 0) {
                return reject(new Error(`ffmpeg exited with code ${code} and no output`));
            }

            const sampleCount = Math.floor(pcm.length / 2); // s16le = 2 bytes/sample
            const peakCount   = Math.floor(sampleCount / SAMPLES_PER_WIN);
            const peaks       = new Array(peakCount);

            for (let i = 0; i < peakCount; i++) {
                let max = 0;
                const base = i * SAMPLES_PER_WIN * 2;
                for (let j = 0; j < SAMPLES_PER_WIN; j++) {
                    const off = base + j * 2;
                    if (off + 1 >= pcm.length) break;
                    const v = Math.abs(pcm.readInt16LE(off));
                    if (v > max) max = v;
                }
                peaks[i] = max / 32767;
            }

            resolve({ peaks, duration: sampleCount / SAMPLE_RATE });
        });
    });
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/waveform/extract
 * Body: { assetId: string, gcsPath?: string }
 */
router.post('/extract', optionalAuth, async (req, res) => {
    const { assetId, gcsPath: rawGcsPath, proxyUrl } = req.body || {};

    // Derive GCS path from proxyUrl when gcsPath is not stored on the asset.
    // proxyUrl is served via /api/proxy/gcs-media/<gcsPath>, so strip that prefix.
    const gcsPath = rawGcsPath || (() => {
        if (!proxyUrl) return null;
        const marker = '/api/proxy/gcs-media/';
        const idx = proxyUrl.indexOf(marker);
        return idx !== -1 ? proxyUrl.slice(idx + marker.length) : null;
    })();

    if (!assetId) {
        return res.status(400).json({ error: 'assetId is required' });
    }

    const userId       = req.user?.id || 'anonymous';
    const gcsDestPath  = `waveforms/${userId}/${assetId}.json`;
    const useGCS       = !!(storageConfig.bucket && !storageConfig.useLocalStorage);

    try {
        // ── 1. Return cached result if it already exists ─────────────────────
        if (useGCS) {
            const [exists] = await storageConfig.bucket.file(gcsDestPath).exists();
            if (exists) {
                return res.json({
                    peaksUrl: `/api/proxy/gcs-media/${gcsDestPath}`,
                    cached: true,
                });
            }
        } else {
            const localPeaksPath = path.join(__dirname, '../uploads', gcsDestPath);
            if (fs.existsSync(localPeaksPath)) {
                return res.json({
                    peaksUrl: `/uploads/${gcsDestPath}`,
                    cached: true,
                });
            }
        }

        // ── 2. Build ffmpeg source ────────────────────────────────────────────
        let inputPath   = null;
        let inputStream = null;

        if (useGCS && gcsPath) {
            // Stream directly from GCS — no local copy needed
            inputStream = storageConfig.bucket.file(gcsPath).createReadStream();
        } else if (gcsPath) {
            // Local storage: resolve from uploads dir
            const uploadsDir = path.resolve(__dirname, '../uploads');
            const resolved   = path.resolve(uploadsDir, gcsPath);
            if (!resolved.startsWith(uploadsDir)) {
                return res.status(403).json({ error: 'Invalid gcsPath' });
            }
            inputPath = resolved;
        } else {
            return res.status(400).json({
                error: 'gcsPath is required when no cached peaks exist',
            });
        }

        // ── 3. Extract peaks ──────────────────────────────────────────────────
        const peaksData = await extractPeaks(inputPath, inputStream);
        const jsonStr   = JSON.stringify(peaksData);

        // ── 4. Store result ───────────────────────────────────────────────────
        let peaksUrl;

        if (useGCS) {
            await storageConfig.bucket
                .file(gcsDestPath)
                .save(jsonStr, { contentType: 'application/json', resumable: false });
            peaksUrl = `/api/proxy/gcs-media/${gcsDestPath}`;
        } else {
            const localDir = path.join(__dirname, '../uploads/waveforms', userId);
            fs.mkdirSync(localDir, { recursive: true });
            fs.writeFileSync(path.join(localDir, `${assetId}.json`), jsonStr);
            peaksUrl = `/uploads/waveforms/${userId}/${assetId}.json`;
        }

        return res.json({ peaksUrl, cached: false });

    } catch (err) {
        console.error('[waveformRoutes] extract error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
