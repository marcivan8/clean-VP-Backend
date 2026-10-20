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
const os         = require('os');
const crypto     = require('crypto');

const storageConfig  = require('../config/storage');
const { optionalAuth } = require('../middleware/auth');
const { deriveGcsPath, resolveStaticAudioPath, resolveStaticAudioFile } = require('../utils/waveformPath');

// ── External (non-storage) URL fallback ───────────────────────────────────
// deriveGcsPath() can only translate OUR OWN proxy/raw URL shapes (the GCS
// proxy marker, the local /uploads/ marker, a storage.googleapis.com URL, or
// a bare storage-relative key) into a storage object path. A library asset
// whose previewUrl points somewhere else entirely — a sound-effect pack
// served from a third-party CDN, for instance — has no gcsPath to resolve,
// so it fell straight into the 400 below no matter how many times the
// client retried. The asset's audio still played fine, because the player
// uses that URL directly; only waveform extraction (which needs a stream to
// hand ffmpeg) was blocked. Fetch the URL directly as a last resort, the
// same way the GCS branch below streams a storage object into ffmpeg.
const https = require('https');
const http  = require('http');

const EXTERNAL_FETCH_TIMEOUT_MS = 20_000;
const EXTERNAL_FETCH_MAX_REDIRECTS = 3;

/**
 * Resolve an absolute http(s) URL to a readable stream of its body.
 * Follows a bounded number of redirects; rejects on a non-2xx status or on
 * timeout so a stalled third-party host can't hold a ffmpeg slot forever
 * (same concern WAVEFORM_FFMPEG_TIMEOUT_MS addresses for GCS reads below).
 */
function fetchAsReadStream(url, redirectsLeft = EXTERNAL_FETCH_MAX_REDIRECTS) {
    return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(url); } catch { return reject(new Error(`invalid URL: ${url}`)); }
        const client = u.protocol === 'http:' ? http : https;

        const req = client.get(u, { timeout: EXTERNAL_FETCH_TIMEOUT_MS }, (resp) => {
            const status = resp.statusCode || 0;
            if (status >= 300 && status < 400 && resp.headers.location && redirectsLeft > 0) {
                resp.resume(); // drain so the socket can be reused
                const next = new URL(resp.headers.location, u).toString();
                return resolve(fetchAsReadStream(next, redirectsLeft - 1));
            }
            if (status < 200 || status >= 300) {
                resp.resume();
                return reject(new Error(`external source returned ${status}`));
            }
            resolve(resp);
        });
        req.on('timeout', () => { req.destroy(new Error(`external source timed out after ${EXTERNAL_FETCH_TIMEOUT_MS / 1000}s`)); });
        req.on('error', reject);
    });
}

// ── Storage source: seekable input, never a pipe ──────────────────────────
// ffmpeg used to read GCS objects through `-i pipe:0`. A pipe cannot seek, so
// an MP4/MOV with its moov atom at the END (raw phone uploads, R7/R25/R34)
// cannot be demuxed until the whole object has streamed in, and often not at
// all. That is the 500 ("decode timed out" / "no output") on clips that fall
// back to the raw upload. A signed URL lets ffmpeg seek with HTTP range
// requests, the same input interviewRoutes.js gives ffmpeg. When the
// credentials cannot sign (no private key), download to a temp file instead.
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

async function resolveStorageInput(gcsPath) {
    const file = storageConfig.bucket.file(gcsPath);
    try {
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action:  'read',
            expires: Date.now() + SIGNED_URL_TTL_MS,
        });
        return { inputPath: url, cleanup: null };
    } catch (signErr) {
        console.warn(`[waveformRoutes] cannot sign ${gcsPath} (${signErr.message}) — downloading to a temp file`);
        const tmp = path.join(os.tmpdir(), `waveform-${crypto.randomUUID()}${path.extname(gcsPath)}`);
        const cleanup = () => fs.promises.unlink(tmp).catch(() => {});
        try {
            await file.download({ destination: tmp });
        } catch (dlErr) {
            await cleanup();
            if (dlErr.code === 404 || /no such object/i.test(dlErr.message)) {
                const notFoundErr = new Error(`Media file not found in storage: ${gcsPath}`);
                notFoundErr.statusCode = 404;
                throw notFoundErr;
            }
            throw dlErr;
        }
        return { inputPath: tmp, cleanup };
    }
}

// Bundled static audio (`/sfx-library/<file>`) is read from the SPA build, or
// from client/public when there is no build (dev). Both the root list and the
// lookup now live in utils/waveformPath.js, because jobs/exportProcessor.js
// needs the identical resolution — it could not resolve these URLs at all and
// dropped every generated sound effect from the render.

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
//
// 90s, not the original 45s: raw phone uploads routinely have their moov atom
// at the END of the file (R7/R25), so ffmpeg reading one as a network stream
// often can't produce output until it has buffered close to the whole file —
// unlike a proxy, which is always faststart. The primary fix for that is
// client-side (Clip.jsx now withholds gcsPath/proxyUrl for an unproxied video
// asset and waits for the proxy instead of ever hitting this route against the
// raw file). This timeout is the second line of defense for whatever still
// reaches here against a large non-faststart source — a legitimate multi-GB
// 4K interview decoding through a real network stream can genuinely take
// longer than 45s even once seeking isn't the bottleneck.
const WAVEFORM_FFMPEG_TIMEOUT_MS = 90_000;

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
 * Run ffmpeg on inputPath (local file or signed URL) or inputStream (external
 * http(s) response body).
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
                const noAudio = /does not contain any stream|matches no streams|no audio stream/i.test(stderrTail);
                const noAudioExtra = /Stream map.*matches no streams|Output file.*does not contain any stream|Output file #0 does not contain any stream/i.test(stderrTail);
                if (noAudio || noAudioExtra) {
                    return finish(null, {
                        peaks: [],
                        duration: 0,
                        hasAudio: false,
                        extractionFailed: false,
                    });
                }
                const isNotFound = /server returned 404|no such file or directory/i.test(stderrTail);
                const err = new Error(`ffmpeg exited with code ${code} and no output. stderr: ${stderrTail.slice(-300)}`);
                if (isNotFound) err.statusCode = 404;
                return finish(err);
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

            // hasAudio distinguishes "this source genuinely carries no audio"
            // (ffmpeg exits 0 having produced no PCM — e.g. a screen recording or
            // a muted export) from "extraction broke". Both used to resolve
            // identically as `peaks: []`, and the caller had no way to tell them
            // apart — so a legitimately silent file was cached as an empty peaks
            // JSON forever and every later read failed. See CLAUDE.md R41.
            //
            // IT MUST BE GATED ON `code === 0`. The first version of this was
            // `pcm.length > 0 && peaks.length > 0`, which is ALSO false whenever
            // extraction merely FAILED — and because the client caches a
            // hasAudio:false result as a FINAL answer ("render an empty track,
            // stop asking"), a 90-second ffmpeg timeout on a raw HEVC .MOV
            // presented permanently as "this clip has no audio". Observed in
            // production on two clips whose transcripts contained 84 and 168
            // words respectively — so they self-evidently had audio. A failed
            // extraction must stay retryable; only a CLEAN exit may declare a
            // source silent.
            const cleanExit = code === 0;
            finish(null, {
                peaks,
                duration: sampleCount / SAMPLE_RATE,
                hasAudio: cleanExit ? (pcm.length > 0 && peaks.length > 0) : null,
                // null = "we don't know" — extraction did not complete cleanly.
                extractionFailed: !cleanExit,
            });
        });
    });
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/waveform/extract
 * Body: { assetId: string, gcsPath?: string }
 */
router.post('/extract', optionalAuth, async (req, res) => {
    const { assetId, gcsPath: rawGcsPath, proxyUrl, force = false } = req.body || {};

    const gcsPath = deriveGcsPath(rawGcsPath, proxyUrl);

    if (!assetId) {
        return res.status(400).json({ error: 'assetId is required' });
    }

    const userId       = req.user?.id || 'anonymous';
    const gcsDestPath  = `waveforms/${userId}/${assetId}.json`;
    const useGCS       = !!(storageConfig.bucket && !storageConfig.useLocalStorage);

    try {
        // ── 1. Return cached result if it already exists ─────────────────────
        // `force` bypasses this read so a client that just received an EMPTY
        // cached file can recover. Step 3b stops new empty files being written,
        // but assets poisoned before that fix shipped would otherwise stay dead
        // forever — the cache hit means extraction never re-runs on its own.
        if (!force) {
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
        } else {
            console.log(`[waveformRoutes] force=true — bypassing cache for ${assetId}`);
        }

        // ── 2. Build ffmpeg source ────────────────────────────────────────────
        let inputPath   = null;
        let inputStream = null;
        let storagePath = null;
        const staticRel = gcsPath ? null : resolveStaticAudioPath(proxyUrl);

        if (useGCS && gcsPath) {
            // Resolved inside the concurrency slot below — see resolveStorageInput.
            storagePath = gcsPath;
        } else if (gcsPath) {
            // Local storage: resolve from uploads dir
            const uploadsDir = path.resolve(__dirname, '../uploads');
            let resolved     = path.resolve(uploadsDir, gcsPath);
            if (!resolved.startsWith(uploadsDir)) {
                return res.status(403).json({ error: 'Invalid gcsPath' });
            }
            if (rawGcsPath && rawGcsPath !== gcsPath && !fs.existsSync(resolved)) {
                const rawCandidate = path.resolve(uploadsDir, rawGcsPath);
                if (rawCandidate.startsWith(uploadsDir) && fs.existsSync(rawCandidate)) {
                    console.log(`[waveformRoutes] proxy ${gcsPath} not on disk — falling back to raw ${rawGcsPath}`);
                    resolved = rawCandidate;
                }
            }
            if (!fs.existsSync(resolved)) {
                return res.status(404).json({ error: 'Media file not found on disk', assetId });
            }
            inputPath = resolved;
        } else if (staticRel) {
            inputPath = resolveStaticAudioFile(staticRel);
            if (!inputPath) return res.status(404).json({ error: 'Static audio file not found' });
        } else if (proxyUrl && /^https?:\/\//i.test(proxyUrl)) {
            // Not one of our own storage shapes — see the external-URL
            // fallback comment above the imports.
            try {
                inputStream = await fetchAsReadStream(proxyUrl);
            } catch (fetchErr) {
                console.warn(`[waveformRoutes] external fetch failed for ${assetId} (${proxyUrl}):`, fetchErr.message);
                return res.status(502).json({ error: `Could not read external audio source: ${fetchErr.message}` });
            }
        } else {
            return res.status(400).json({
                error: 'gcsPath is required when no cached peaks exist',
            });
        }

        // ── 3. Extract peaks (queued — see WAVEFORM_MAX_CONCURRENT above) ─────
        const doExtract = async (targetStoragePath, targetInputPath, targetStream) => {
            if (!targetStoragePath) return extractPeaks(targetInputPath, targetStream);
            const { inputPath: storageInput, cleanup } = await resolveStorageInput(targetStoragePath);
            try {
                return await extractPeaks(storageInput, null);
            } finally {
                if (cleanup) await cleanup();
            }
        };

        const peaksData = await withWaveformSlot(async () => {
            try {
                return await doExtract(storagePath, inputPath, inputStream);
            } catch (primaryErr) {
                if (useGCS && storagePath && rawGcsPath && rawGcsPath !== storagePath) {
                    console.warn(`[waveformRoutes] extraction for ${storagePath} failed (${primaryErr.message}) — falling back to raw ${rawGcsPath}`);
                    return await doExtract(rawGcsPath, null, null);
                }
                throw primaryErr;
            }
        });

        // ── 3b. NEVER persist an empty result ─────────────────────────────────
        // The cache check in step 1 is an `exists()` test — it does not inspect
        // the file's CONTENT. So writing a zero-peak JSON here poisons this asset
        // permanently: every later request short-circuits to `cached: true` and
        // hands the client a file it will reject ("Peaks JSON contained no
        // data"), at which point WaveformEngine marks the asset permanently
        // failed and stops retrying. One bad extraction = a waveform that can
        // never come back, even after the underlying cause is fixed.
        //
        // Returning inline (never caching) keeps a genuinely silent file cheap to
        // re-answer while leaving a transient failure recoverable on the next
        // attempt. `hasAudio` tells the client which case this is, so it can
        // render an empty track as a FINAL answer instead of retrying forever.
        if (!peaksData.peaks?.length) {
            // `hasAudio: null` means ffmpeg did NOT exit cleanly — we produced no
            // peaks because extraction broke, not because the source is silent.
            // Forwarding `false` here would let the client cache "this clip has
            // no audio" as a final answer over what is really a transient
            // failure; that is what happened in production to two clips whose
            // transcripts proved they had audio.
            const unknown = peaksData.hasAudio === null || peaksData.extractionFailed;

            console.warn(
                `[waveformRoutes] No peaks produced for ${assetId} — `
                + (unknown
                    ? 'extraction did NOT complete cleanly; reporting as retryable, not silent.'
                    : 'source genuinely carries no audio. Returning inline, not caching.')
            );

            if (unknown) {
                // 500, NOT 503. WaveformEngine deliberately treats 503 as
                // backpressure that does NOT consume an attempt (so a saturated
                // queue can't make it give up on a healthy asset) — returning
                // 503 here would make a permanently-failing source retry every
                // 5s forever. A failed extraction needs the BOUNDED retry path:
                // a real error, a consumed attempt, and eventually a clean
                // give-up. The only thing that was ever wrong here was calling
                // it "silent"; the error path itself was correct.
                return res.status(500).json({
                    error:     'Waveform extraction did not complete cleanly.',
                    retryable: true,
                    hasAudio:  null,
                });
            }

            return res.json({
                peaksUrl: null,
                cached:   false,
                peaks:    [],
                duration: peaksData.duration || 0,
                hasAudio: false,
            });
        }

        const jsonStr = JSON.stringify(peaksData);

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
        let status = err.statusCode || (typeof err.code === 'number' && err.code >= 400 && err.code < 600 ? err.code : 500);
        if (/no such (object|file)|not found|404|server returned 404/i.test(err.message)) {
            status = 404;
        }
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
