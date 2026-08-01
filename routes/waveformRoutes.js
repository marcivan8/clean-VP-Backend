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
const { deriveGcsPath } = require('../utils/waveformPath');

// ─── Peak extraction ──────────────────────────────────────────────────────────

const SAMPLE_RATE     = 22050;
const PEAKS_PER_SEC   = 50;
const SAMPLES_PER_WIN = Math.floor(SAMPLE_RATE / PEAKS_PER_SEC); // 441

// ── Concurrency gate ──────────────────────────────────────────────────────────
// Unlike every ffmpeg-heavy job in this codebase (all run through BullMQ workers
// with explicit concurrency caps — see CLAUDE.md R24), this route spawns ffmpeg
// directly inside the Express request handler with NO limit. A multi-asset
// cleanup job (silence/filler removal) touches every asset's proxy, and the
// client's usePeaks hook re-requests waveforms for all of them at once — each
// request streams a full audio decode of a multi-minute source into memory.
// Concurrent, unbounded waveform extractions during a batch job are exactly the
// kind of spike R24 already identified as OOM-crashing the shared process; this
// route just wasn't covered by that fix since it isn't a BullMQ worker. A
// simple in-process queue caps it the same way videoWorker/assetAnalysisWorker
// are capped, without requiring the client to change how it calls this route
// (callers just wait slightly longer under load instead of getting a 502).
const WAVEFORM_MAX_CONCURRENT = 2;

// How long a request may sit in the queue before we give up and tell the client
// to retry. Without this, a queued request waits FOREVER — and "forever" in
// practice means until Railway's edge gives up on the request and returns a
// bare 502 with nothing in the app logs. That 502 is indistinguishable from a
// crash, which is exactly how this presented: waveform extraction returning
// 502 with no server-side error to point at. A queue that can't drain must
// fail fast and say so, not hold the socket open.
const WAVEFORM_QUEUE_WAIT_MS = 20_000;

// Hard ceiling on a single ffmpeg decode. The GCS read stream feeding ffmpeg
// can stall indefinitely (flaky object read, socket hang) — and because
// extractPeaks only settles on ffmpeg's 'close' event, a stalled stream meant
// that slot was held for the life of the process. Two stalls = the queue never
// drains again and EVERY subsequent waveform request 502s until a redeploy.
const WAVEFORM_FFMPEG_TIMEOUT_MS = 45_000;

let _waveformActive = 0;
const _waveformQueue = [];

function withWaveformSlot(fn) {
    return new Promise((resolve, reject) => {
        let timedOut = false;

        const run = async () => {
            if (timedOut) {
                // Queue slot freed up after we already gave up — release it
                // immediately so the next waiter isn't blocked by a no-op.
                _waveformActive--;
                const next = _waveformQueue.shift();
                if (next) next();
                return;
            }
            clearTimeout(waitTimer);
            try {
                resolve(await fn());
            } catch (err) {
                reject(err);
            } finally {
                _waveformActive--;
                const next = _waveformQueue.shift();
                if (next) next();
            }
        };

        const waitTimer = setTimeout(() => {
            timedOut = true;
            const idx = _waveformQueue.indexOf(queuedRun);
            if (idx !== -1) _waveformQueue.splice(idx, 1);
            const err = new Error('Waveform extraction is busy — try again shortly.');
            err.statusCode = 503;
            reject(err);
        }, WAVEFORM_QUEUE_WAIT_MS);

        const queuedRun = () => { _waveformActive++; run(); };

        if (_waveformActive < WAVEFORM_MAX_CONCURRENT) queuedRun();
        else _waveformQueue.push(queuedRun);
    });
}

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

        if (!ffmpegPath) {
            return reject(new Error('ffmpeg-static binary not resolved — check the Docker image build'));
        }

        // stderr was 'ignore' — every failure here came back as a bare message
        // with no way to tell a bad seek from an unreadable source. Capture the
        // tail so the 500 body actually says something useful.
        const ff = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        let settled = false;
        let stderrTail = '';
        const finish = (err, val) => {
            if (settled) return;
            settled = true;
            clearTimeout(killTimer);
            if (err) reject(err); else resolve(val);
        };

        // A stalled GCS read stream used to hold this promise (and its
        // concurrency slot) open indefinitely — see WAVEFORM_FFMPEG_TIMEOUT_MS.
        const killTimer = setTimeout(() => {
            try { ff.kill('SIGKILL'); } catch { /* already gone */ }
            finish(new Error(`ffmpeg decode timed out after ${WAVEFORM_FFMPEG_TIMEOUT_MS / 1000}s. stderr: ${stderrTail.slice(-300)}`));
        }, WAVEFORM_FFMPEG_TIMEOUT_MS);

        if (inputStream) {
            inputStream.pipe(ff.stdin);
            // Propagate the stream error instead of only destroying stdin and
            // hoping ffmpeg notices. If ffmpeg didn't exit on its own, nothing
            // ever settled this promise.
            inputStream.on('error', (err) => {
                try { ff.stdin.destroy(); } catch { /* noop */ }
                try { ff.kill('SIGKILL'); } catch { /* noop */ }
                finish(new Error(`source read failed: ${err.message}`));
            });
            ff.stdin.on('error', () => {}); // suppress EPIPE when stream closes early
        }

        const chunks = [];
        let pcmBytes = 0;
        // Raw PCM at 22 050 Hz mono s16le is ~44 KB/s, so 200 MB ≈ 75 min of
        // audio. Past that we're buffering a pathological input into the same
        // heap the Express server runs in (R24) — refuse rather than OOM the
        // process, which is itself a 502 generator.
        const MAX_PCM_BYTES = 200 * 1024 * 1024;

        ff.stdout.on('data', chunk => {
            pcmBytes += chunk.length;
            if (pcmBytes > MAX_PCM_BYTES) {
                try { ff.kill('SIGKILL'); } catch { /* noop */ }
                finish(new Error('audio stream exceeded the peak-extraction size cap'));
                return;
            }
            chunks.push(chunk);
        });
        ff.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString()).slice(-2000); });

        ff.on('error', err => finish(new Error(`ffmpeg spawn failed: ${err.message}`)));

        ff.on('close', code => {
            if (settled) return;
            const pcm = Buffer.concat(chunks);

            if (code !== 0 && pcm.length === 0) {
                return finish(new Error(`ffmpeg exited with code ${code} and no output. stderr: ${stderrTail.slice(-300)}`));
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

            finish(null, { peaks, duration: sampleCount / SAMPLE_RATE });
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

    const gcsPath = deriveGcsPath(rawGcsPath, proxyUrl);

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

        // ── 3. Extract peaks (queued — see WAVEFORM_MAX_CONCURRENT above) ─────
        const peaksData = await withWaveformSlot(() => extractPeaks(inputPath, inputStream));
        const jsonStr   = JSON.stringify(peaksData);

        // ── 4. Store result ───────────────────────────────────────────────────
        let peaksUrl = null;

        if (useGCS) {
            // Retry up to 3 times — GCS uploads on Railway can fail with a transient
            // "socket hang up" (ECONNRESET) when the connection pool serves a stale
            // socket.  Simple backoff (500ms, 1s, 2s) covers the vast majority of cases.
            const GCS_RETRIES = 3;
            let lastUploadErr = null;

            for (let attempt = 1; attempt <= GCS_RETRIES; attempt++) {
                try {
                    await storageConfig.bucket
                        .file(gcsDestPath)
                        .save(jsonStr, { contentType: 'application/json', resumable: false });
                    peaksUrl = `/api/proxy/gcs-media/${gcsDestPath}`;
                    lastUploadErr = null;
                    break;
                } catch (uploadErr) {
                    lastUploadErr = uploadErr;
                    console.warn(`[waveformRoutes] GCS upload attempt ${attempt}/${GCS_RETRIES} failed: ${uploadErr.message}`);
                    if (attempt < GCS_RETRIES) {
                        await new Promise(r => setTimeout(r, 500 * attempt)); // 500ms → 1s → 2s
                    }
                }
            }

            // If all retries failed, return peaks inline so the client isn't left empty-handed.
            // The data is in memory — returning it now is better than a 500 that drops everything.
            if (lastUploadErr) {
                console.error('[waveformRoutes] GCS upload failed after retries — returning peaks inline:', lastUploadErr.message);
                return res.json({ peaksUrl: null, cached: false, peaks: peaksData.peaks, duration: peaksData.duration });
            }
        } else {
            const localDir = path.join(__dirname, '../uploads/waveforms', userId);
            fs.mkdirSync(localDir, { recursive: true });
            fs.writeFileSync(path.join(localDir, `${assetId}.json`), jsonStr);
            peaksUrl = `/uploads/waveforms/${userId}/${assetId}.json`;
        }

        return res.json({ peaksUrl, cached: false });

    } catch (err) {
        // A queue-wait timeout is "busy, come back", not "broken" — the client's
        // usePeaks retry handles it. Distinguishing it matters because the
        // symptom it replaced (holding the socket until Railway's edge 502s)
        // was unattributable from either side.
        const status = err.statusCode || 500;
        if (status === 503) {
            console.warn(`[waveformRoutes] extract busy (queue depth ${_waveformQueue.length}, active ${_waveformActive}) for asset ${assetId}`);
            res.set('Retry-After', '5');
        } else {
            console.error(`[waveformRoutes] extract error for asset ${assetId} (gcsPath=${gcsPath}):`, err.message);
        }
        return res.status(status).json({ error: err.message });
    }
});

module.exports = router;
