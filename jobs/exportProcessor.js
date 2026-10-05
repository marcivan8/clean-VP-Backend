'use strict';

/**
 * jobs/exportProcessor.js
 *
 * BullMQ job handler for timeline exports.
 * Replaces the synchronous HTTP handler in routes/exportRoutes.js.
 *
 * Job data shape:
 *   { timeline, settings, userId, assetMap }
 *
 * Returns:
 *   { url, filename, metadata }
 *   url = '/api/proxy/gcs-media/exports/{userId}/{jobId}.mp4'  (GCS)
 *      OR '/uploads/exports/{jobId}.mp4'                       (local dev fallback)
 */

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const { spawnSync, spawn } = require('child_process');

ffmpeg.setFfprobePath(ffprobeInstaller.path);
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const storageConfig = require('../config/storage');

ffmpeg.setFfmpegPath(ffmpegPath);

// ── drawtext / libfreetype detection ─────────────────────────────────────────
// ffmpeg-static omits libfreetype on most platforms, so the drawtext filter
// (used to burn captions into the exported video) is unavailable.  We probe
// once at startup: if the static binary lacks it we fall back to the system
// ffmpeg (installed via apt in the Dockerfile) which ships with libfreetype.
function _probeDrawtext(bin) {
    try {
        const r = spawnSync(bin, ['-filters'], { encoding: 'utf-8', timeout: 8000 });
        return (r.stdout || r.stderr || '').includes('drawtext');
    } catch (_) { return false; }
}
const SYSTEM_FFMPEG = '/usr/bin/ffmpeg';
const DRAWTEXT_BIN  =
    _probeDrawtext(ffmpegPath)                             ? ffmpegPath   :
    (fs.existsSync(SYSTEM_FFMPEG) && _probeDrawtext(SYSTEM_FFMPEG)) ? SYSTEM_FFMPEG :
    ffmpegPath; // last resort — drawtext will still fail but at least logs why
console.log(`[exportProcessor] drawtext ffmpeg: ${DRAWTEXT_BIN === ffmpegPath ? 'static' : 'system ('+SYSTEM_FFMPEG+')'}`);

/** Run an ffmpeg binary with argv, rejecting with the stderr tail on failure. */
function runFfmpegArgs(bin, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args);
        const stderrChunks = [];
        proc.stderr.on('data', chunk => stderrChunks.push(chunk));
        proc.on('error', reject);
        proc.on('close', code => {
            if (code === 0) return resolve();
            const errTail = Buffer.concat(stderrChunks).toString('utf-8').slice(-1200);
            reject(new Error(`ffmpeg exited ${code}:\n${errTail}`));
        });
    });
}
// ─────────────────────────────────────────────────────────────────────────────

const gcsBucket = storageConfig.bucket;

// ─── Helpers (mirrors exportRoutes.js) ───────────────────────────────────────

const isServerUsableUrl = (u) => u && !u.startsWith('blob:');

async function downloadToTemp(url, destPath, headers = undefined) {
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 120_000, headers });
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
}

function resolveSourcePath(clip, uploadsDir) {
    if (clip.fsPath && fs.existsSync(clip.fsPath)) return clip.fsPath;
    const inUploads = path.join(uploadsDir, clip.name);
    if (fs.existsSync(inUploads)) return inUploads;
    return null;
}

function buildScaleFilter(width, height) {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

/**
 * Audio tempo for a clip speed, as a chain of atempo filters. One atempo
 * only accepts 0.5-2.0 (older ffmpeg), so 4x is atempo=2,atempo=2 and 0.25x
 * is atempo=0.5,atempo=0.5. It used to clamp to 0.5-2.0, so a 4x clip's
 * audio ran at 2x and drifted out of sync with its picture.
 */
function atempoChain(speed) {
    let s = Number(speed) > 0 ? Number(speed) : 1;
    const parts = [];
    while (s > 2.0 + 1e-9) { parts.push(2.0); s /= 2.0; }
    while (s < 0.5 - 1e-9) { parts.push(0.5); s /= 0.5; }
    parts.push(s);
    return parts.map(x => `atempo=${x.toFixed(4)}`);
}

/**
 * Smooth, sub-pixel zoom for scale keyframes (zoom rhythm push-ins and
 * punch-ins), as an ffmpeg filter string: `fps=N,perspective=...`.
 *
 * Replaces zoompan, which snaps its crop window to whole pixels: on a slow
 * push-in the picture stepped back and forth by up to 2 px per frame (visible
 * shake). `perspective` samples the window with (bilinear) interpolation, so
 * the motion is smooth and only ever moves one way. Measured on a 5 s
 * 1.05 -> 1.10 push-in: zoompan 25 backward steps, this 0. Cost: about +55%
 * encode time on the zoomed clips only (bicubic was +90% for no visible gain
 * at these zoom levels).
 *
 * Time is the frame index over `fps` (the filter starts with `fps=N`), i.e.
 * clip-local timeline seconds when placed after the speed `setpts`, the same
 * axis the keyframes use. Each segment uses the DESTINATION keyframe's easing,
 * like the preview's evaluateKF (client/src/revideo/project.tsx).
 *
 * anchor:
 *   { mode: 'fixed', x, y }   the point at (x, y) (fractions of the frame)
 *                             stays put, e.g. the talking-head anchor (0.5, 0.28)
 *   { mode: 'center', x, y }  the window is centred on (x, y) and kept inside
 *                             the frame (multicam angle centre)
 * Returns null when there is nothing visible to animate.
 */
function zoomEaseExpr(easing, u) {
    switch (easing) {
        case 'easeOutCubic': return `(1-pow(1-${u},3))`;
        case 'easeInCubic': return `pow(${u},3)`;
        case 'easeIn': case 'ease-in': return `(${u}*${u})`;
        case 'easeOut': case 'ease-out': return `(${u}*(2-${u}))`;
        case 'easeInOut': case 'ease-in-out': return `if(lt(${u},0.5),2*${u}*${u},-1+(4-2*${u})*${u})`;
        default: return u;
    }
}

/** Piecewise expression of a `[{time,value,easing}]` track over T, or null. */
function keyframeExpr(pts, T, digits = 4) {
    if (!pts.length) return null;
    if (pts.length === 1) return pts[0].v.toFixed(digits);
    let e = pts[pts.length - 1].v.toFixed(digits);
    for (let i = pts.length - 2; i >= 0; i--) {
        const a = pts[i], b = pts[i + 1];
        const span = b.t - a.t;
        const seg = span > 0.001
            ? `(${a.v.toFixed(digits)}+(${(b.v - a.v).toFixed(digits)})*${zoomEaseExpr(b.e, `((${T}-${a.t.toFixed(3)})/${span.toFixed(3)})`)})`
            : b.v.toFixed(digits);
        e = `if(lt(${T},${b.t.toFixed(3)}),${seg},${e})`;
    }
    return `if(lt(${T},${pts[0].t.toFixed(3)}),${pts[0].v.toFixed(digits)},${e})`;
}

function buildSmoothZoomFilter(kfs, { fps = 30, anchor = { mode: 'fixed', x: 0.5, y: 0.28 }, multiplier = 1, minZoom = 1.0, maxZoom = 2.0, panX = null, panY = null } = {}) {
    const clean = (arr, map) => (arr || [])
        .filter(k => k && Number.isFinite(Number(k.time)) && Number.isFinite(Number(k.value)))
        .map(k => ({ t: Math.max(0, Number(k.time)), v: map(Number(k.value)), e: k.easing }))
        .sort((a, b) => a.t - b.t);
    const pts = clean(kfs, v => Math.min(maxZoom, Math.max(minZoom, v * multiplier)));
    // Camera pan (shake / whip / pan), fraction of the frame: the picture
    // moves right by panX × width. Fed by CameraMotionCompiler.
    const px = clean(panX, v => Math.max(-0.5, Math.min(0.5, v)));
    const py = clean(panY, v => Math.max(-0.5, Math.min(0.5, v)));
    const pans = px.some(p => Math.abs(p.v) > 1e-4) || py.some(p => Math.abs(p.v) > 1e-4);
    if (!pts.length && !pans) return null;
    if (!pans && !pts.some(p => p.v > 1.0005)) return null; // never zoomed in: nothing to draw

    const T = `(in/${fps})`;
    const z = keyframeExpr(pts, T) || '1';
    const dx = pans ? keyframeExpr(px, T, 5) : null;
    const dy = pans ? keyframeExpr(py, T, 5) : null;

    const ax = Math.max(0, Math.min(1, Number(anchor?.x ?? 0.5)));
    const ay = Math.max(0, Math.min(1, Number(anchor?.y ?? 0.28)));
    let L, Tp;
    if (anchor?.mode === 'center') {
        L  = `clip(W*${ax.toFixed(4)}-W/(2*(${z})),0,W-W/(${z}))`;
        Tp = `clip(H*${ay.toFixed(4)}-H/(2*(${z})),0,H-H/(${z}))`;
    } else {
        L  = `(W*${ax.toFixed(4)}*(1-1/(${z})))`;
        Tp = `(H*${ay.toFixed(4)}*(1-1/(${z})))`;
    }
    // Moving the picture right by dx·W = moving the sampled window left.
    if (dx) L  = `(${L}-(${dx})*W/(${z}))`;
    if (dy) Tp = `(${Tp}-(${dy})*H/(${z}))`;
    const R = `(${L}+W/(${z}))`;
    const B = `(${Tp}+H/(${z}))`;
    return `fps=${fps},perspective=x0='${L}':y0='${Tp}':x1='${R}':y1='${Tp}':x2='${L}':y2='${B}':x3='${R}':y3='${B}':interpolation=linear:eval=frame`;
}

/**
 * R67 — Object Intelligence Integration, "blur background" export path.
 *
 * This is a genuinely NEW render primitive, unlike zoom/track/animate
 * speaker (which reuse the existing `clip.virtualCam` crop pipeline
 * unchanged — see client/src/motion/ObjectLayers.js's header for why).
 * Nothing in this codebase has ever composited two video sources with an
 * alpha mask before (confirmed by ADR-001's audit before this was written).
 *
 * DELIBERATE SCOPE LIMIT, stated plainly per this project's convention
 * (see CameraMotionCompiler.js's translate-preset scope note for the
 * precedent): a clip using `layerTarget: 'background'` renders through
 * THIS function instead of the main per-clip pipeline above, which means
 * rotation-correction, `virtualCam` crop, and zoom-rhythm keyframes on the
 * SAME clip are not composed with the blur here — layerTarget is set by
 * `setLayerTarget`/`zoomToSpeaker` as mutually-exclusive choices in the
 * store today, so this has not come up in practice, but if a future clip
 * genuinely needs both, this function is the one to extend.
 *
 * Filter graph (fluent-ffmpeg complexFilter, two inputs — source + mask):
 *   [0:v] scale to output dims                                  → [base]
 *   [1:v] scale mask to output dims (nearest-neighbor edges         )
 *                                                                → [maskscaled]
 *   [base] boxblur (background blur amount)                     → [blurred]
 *   [base][maskscaled] alphamerge (mask's luma → base's alpha)  → [fg]
 *   [blurred][fg] overlay                                       → [outv]
 * `alphamerge` is the standard FFmpeg primitive for "use this second video's
 * luma as this first video's alpha channel" — exactly matte-video compositing,
 * which is what a SAM2 "highlighted" mask output already is.
 */
async function downloadUrlToFile(url, localPath) {
    const response = await axios.get(url, { responseType: 'stream', timeout: 120_000 });
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(localPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
    return localPath;
}

/**
 * R69 — resolve this backend's own public URL, for handing to the render-worker
 * so it can fetch `/uploads/...`-relative assets. SAME resolution order the
 * internal-proxy-download fallback already uses a few dozen lines below
 * (PUBLIC_URL → RAILWAY_PUBLIC_DOMAIN → localhost) — reused here rather than
 * re-derived, so the two can never silently disagree about what "this server"
 * means.
 */
function resolvePublicBackendUrl() {
    return process.env.PUBLIC_URL
        || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
        || `http://localhost:${process.env.PORT || 3000}`;
}

/**
 * R69 — call the self-hosted (non-Lambda) Revideo render-worker (render-worker/,
 * deployed to Fly.io) to composite captions/motion-graphics/stickers on top of
 * an already-cut, already-graded, already-audio-mixed base video. Streams the
 * resulting MP4 to `outputPath`.
 *
 * Deliberately a single request/response call, not a queued job — the worker
 * itself is the concurrency boundary (see CLAUDE.md: without Lambda's elastic
 * scaling, this is one fixed-capacity renderer, sized by RENDER_WORKER_URL's
 * own machine). A future high-concurrency mode would swap this call for the
 * dormant `render-lambda/` path instead of changing anything here.
 *
 * @throws on any failure — caller is responsible for the fails-open fallback.
 */
async function renderViaRevideoWorker({ baseVideoUrl, tracks, duration, aspectRatio, fps, backendUrl, outputPath }) {
    const workerUrl    = process.env.RENDER_WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl) throw new Error('RENDER_WORKER_URL is not configured');

    const controller  = new AbortController();
    const timeoutMs   = Number(process.env.REVIDEO_RENDER_TIMEOUT_MS) || 6 * 60 * 1000; // 6 min — matches other long-render timeouts in this codebase
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(`${workerUrl.replace(/\/$/, '')}/render`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(workerSecret ? { Authorization: workerSecret } : {}),
            },
            body: JSON.stringify({ baseVideoUrl, tracks, duration, aspectRatio, fps, backendUrl }),
            signal: controller.signal,
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`render-worker responded ${res.status}: ${errText.slice(0, 300)}`);
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length === 0) throw new Error('render-worker returned an empty response');
        fs.writeFileSync(outputPath, buffer);
        return outputPath;
    } finally {
        clearTimeout(timeoutHandle);
    }
}

function renderBackgroundBlurSegment(clip, src, segPath, opts) {
    const { targetWidth, targetHeight, targetFps, codec, profile, audioBitrate, maskLocalPath, blurAmount = 20 } = opts;
    return new Promise((resolve, reject) => {
        const cmd = ffmpeg()
            .input(src)
            .setStartTime(clip.offset || 0)
            .setDuration(clip.duration)
            .input(maskLocalPath);

        cmd.complexFilter([
            `[0:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}[base]`,
            `[1:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}[maskscaled]`,
            `[base]boxblur=${blurAmount}:2[blurred]`,
            `[base][maskscaled]alphamerge[fg]`,
            `[blurred][fg]overlay=shortest=1[outv]`,
        ], 'outv');

        const vol = (clip.volume ?? 1.0) * (clip.trackVolume ?? 1.0);
        if (vol !== 1.0) cmd.audioFilters(`volume=${vol.toFixed(4)}`);

        cmd
            .fps(targetFps)
            .videoCodec(codec)
            .addOutputOption('-profile:v', profile)
            .addOutputOption('-pix_fmt', 'yuv420p')
            .addOutputOption('-movflags', '+faststart')
            .addOutputOption('-shortest')
            .audioBitrate(audioBitrate)
            .output(segPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
}

/**
 * Probe a video file and return its stored rotation in degrees (0, 90, 180, 270).
 * Phone-recorded portrait videos are often stored as landscape with a rotate=90
 * metadata tag. We need to correct for this before applying the scale filter,
 * otherwise the dimensions are swapped and the video ends up tiny with black bars.
 */
/**
 * Rotation (0/90/180/270, clockwise) from one ffprobe video stream, in any of
 * the three shapes it can arrive in:
 *   - `stream.rotation`        fluent-ffmpeg's parser flattens the Display
 *                              Matrix side data onto the stream (ffprobe >= 5).
 *                              This is what a modern iPhone .MOV reports, and
 *                              the one the old code never read: every phone
 *                              portrait clip probed as 0.
 *   - `stream.side_data_list`  ffprobe's own JSON output.
 *   - `stream.tags.rotate`     ffmpeg <= 4.
 * ffprobe reports the matrix as a negative angle (-90 = 90 deg clockwise).
 */
function rotationFromProbeStream(vStream) {
    if (!vStream) return 0;
    const norm = (deg) => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
    const has = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
    const sd = (Array.isArray(vStream.side_data_list) ? vStream.side_data_list : []).find(d => d && has(d.rotation));
    if (sd) return norm(-Number(sd.rotation));
    if (has(vStream.rotation)) return norm(-Number(vStream.rotation));
    const tag = parseInt(vStream?.tags?.rotate || 0, 10);
    return Number.isFinite(tag) ? norm(tag) : 0;
}

function getVideoRotation(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) { resolve(0); return; }
            const vStream = (metadata?.streams || []).find(s => s.codec_type === 'video');
            resolve(rotationFromProbeStream(vStream));
        });
    });
}

/**
 * Probe a video file's width/height as stored. Used to report the RENDERED
 * size of the finished export (metadata.resolution). Returns null on any
 * probe failure.
 */
function getVideoDimensions(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) { resolve(null); return; }
            const vStream = (metadata?.streams || []).find(s => s.codec_type === 'video');
            if (!vStream?.width || !vStream?.height) { resolve(null); return; }
            resolve({ width: vStream.width, height: vStream.height });
        });
    });
}

/**
 * Download a Google Font TTF to `destPath` if it isn't already present.
 * Uses the legacy CSS1 API (old browser UA) so the response contains TTF URLs.
 */
// ── Font registry ─────────────────────────────────────────────────────────────
// Maps every font offered in TextPanel.jsx + ReasoningPanel.jsx to a local
// filename + jsDelivr download spec (@fontsource v4 packages include TTF files).
// jsDelivr: reliable CDN, no auth, no UA tricks, no rate limits.
// URL pattern: https://cdn.jsdelivr.net/npm/@fontsource/{slug}@4/files/{slug}-{subset}-{weight}-normal.ttf
const FONT_SPECS = {
    // Talking Head
    'Anton':              { file: 'Anton-Regular.ttf',             slug: 'anton',              weight: 400, subset: 'latin' },
    'Bebas Neue':         { file: 'BebasNeue-Regular.ttf',         slug: 'bebas-neue',         weight: 400, subset: 'latin' },
    'Montserrat':         { file: 'Montserrat-Bold.ttf',           slug: 'montserrat',         weight: 800, subset: 'latin' },
    'Inter':              { file: 'Inter-Regular.ttf',             slug: 'inter',              weight: 400, subset: 'latin' },
    'Barlow Condensed':   { file: 'BarlowCondensed-Bold.ttf',      slug: 'barlow-condensed',   weight: 700, subset: 'latin' },
    // Podcast / Doc
    'Playfair Display':   { file: 'PlayfairDisplay-Regular.ttf',   slug: 'playfair-display',   weight: 400, subset: 'latin' },
    'Lora':               { file: 'Lora-Regular.ttf',              slug: 'lora',               weight: 400, subset: 'latin' },
    'Merriweather':       { file: 'Merriweather-Regular.ttf',      slug: 'merriweather',       weight: 400, subset: 'latin' },
    'DM Serif Display':   { file: 'DMSerifDisplay-Regular.ttf',    slug: 'dm-serif-display',   weight: 400, subset: 'latin' },
    'Cormorant Garamond': { file: 'CormorantGaramond-Regular.ttf', slug: 'cormorant-garamond', weight: 400, subset: 'latin' },
    // Lifestyle / Vlog
    'Nunito':             { file: 'Nunito-Regular.ttf',            slug: 'nunito',             weight: 400, subset: 'latin' },
    'Poppins':            { file: 'Poppins-Regular.ttf',           slug: 'poppins',            weight: 400, subset: 'latin' },
    'Quicksand':          { file: 'Quicksand-Regular.ttf',         slug: 'quicksand',          weight: 400, subset: 'latin' },
    'Josefin Sans':       { file: 'JosefinSans-Regular.ttf',       slug: 'josefin-sans',       weight: 400, subset: 'latin' },
    'Raleway':            { file: 'Raleway-Regular.ttf',           slug: 'raleway',            weight: 400, subset: 'latin' },
    // Gaming / Tech
    'Rajdhani':           { file: 'Rajdhani-Regular.ttf',          slug: 'rajdhani',           weight: 400, subset: 'latin' },
    'Exo 2':              { file: 'Exo2-Regular.ttf',              slug: 'exo-2',              weight: 400, subset: 'latin' },
    'Orbitron':           { file: 'Orbitron-Regular.ttf',          slug: 'orbitron',           weight: 400, subset: 'latin' },
    'Oxanium':            { file: 'Oxanium-Regular.ttf',           slug: 'oxanium',            weight: 400, subset: 'latin' },
    'Roboto Condensed':   { file: 'RobotoCondensed-Regular.ttf',   slug: 'roboto-condensed',   weight: 400, subset: 'latin' },
    // Motivational
    'Oswald':             { file: 'Oswald-Regular.ttf',            slug: 'oswald',             weight: 400, subset: 'latin' },
    'Teko':               { file: 'Teko-Regular.ttf',              slug: 'teko',               weight: 400, subset: 'latin' },
    'Black Han Sans':     { file: 'BlackHanSans-Regular.ttf',      slug: 'black-han-sans',     weight: 400, subset: 'latin' },
    'Saira Condensed':    { file: 'SairaCondensed-Regular.ttf',    slug: 'saira-condensed',    weight: 400, subset: 'latin' },
    'Cabin':              { file: 'Cabin-Regular.ttf',             slug: 'cabin',              weight: 400, subset: 'latin' },
    // Handwritten
    'Caveat':             { file: 'Caveat-Regular.ttf',            slug: 'caveat',             weight: 400, subset: 'latin' },
    'Pacifico':           { file: 'Pacifico-Regular.ttf',          slug: 'pacifico',           weight: 400, subset: 'latin' },
    'Kalam':              { file: 'Kalam-Regular.ttf',             slug: 'kalam',              weight: 400, subset: 'latin' },
    'Satisfy':            { file: 'Satisfy-Regular.ttf',           slug: 'satisfy',            weight: 400, subset: 'latin' },
    'Dancing Script':     { file: 'DancingScript-Regular.ttf',     slug: 'dancing-script',     weight: 400, subset: 'latin' },
    // Neon / Glow
    'Boogaloo':           { file: 'Boogaloo-Regular.ttf',          slug: 'boogaloo',           weight: 400, subset: 'latin' },
    'Righteous':          { file: 'Righteous-Regular.ttf',         slug: 'righteous',          weight: 400, subset: 'latin' },
    'Press Start 2P':     { file: 'PressStart2P-Regular.ttf',      slug: 'press-start-2p',     weight: 400, subset: 'latin' },
    'Audiowide':          { file: 'Audiowide-Regular.ttf',         slug: 'audiowide',          weight: 400, subset: 'latin' },
    // Caption style picker extras (CaptionStylesCard)
    'DM Sans':            { file: 'DMSans-Regular.ttf',            slug: 'dm-sans',            weight: 400, subset: 'latin' },
    'Unbounded':          { file: 'Unbounded-Regular.ttf',         slug: 'unbounded',          weight: 400, subset: 'latin' },
};

/**
 * Download a font TTF to `destPath` if not already present.
 *
 * All 36 fonts in FONT_SPECS are now committed as real .ttf files directly in
 * client/public/fonts/ (see CLAUDE.md EXT2 + the Dockerfile's font-presence
 * check), so in practice this function's existsSync guard below returns
 * immediately and nothing past it ever runs. It only matters as a defensive
 * fallback if someone adds a new font to FONT_SPECS without committing its
 * file first.
 *
 * HISTORY: this used to try jsDelivr's @fontsource npm package path
 * (`/npm/@fontsource/{slug}@4/files/{slug}-{subset}-{weight}-normal.ttf`)
 * first. That path is fundamentally broken and was removed — @fontsource v4
 * packages only ever published .woff/.woff2, never .ttf, so that request
 * 404'd on literally every call, silently wasting up to ~40s (two attempts:
 * declared subset + 'all', 20s timeout each) before falling through to the
 * fallback below. This was the actual root cause of captions "always falling
 * back to the presaved font" — the primary path could never succeed for any
 * font, in any environment. See utils/waveformPath.js-style lesson: verify a
 * dependency's file layout before writing a URL against it.
 *
 * Remaining fallback: Google Fonts CSS1 API with legacy UA (returns TTF for
 * old browsers). Undocumented and fragile, but it's the only remaining path
 * that has actually been observed to return a real TTF. Does NOT use
 * encodeURIComponent on the full name — encodes the space as '+' and passes
 * weight as ':700' (not '%3A700') so the API parses it.
 */
async function downloadFont(destPath, spec) {
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 5_000) return;
    const { weight } = spec;

    // ── Fallback: Google Fonts CSS1 API (legacy TTF endpoint) ────────────────
    // Encode space as '+', weight as ':700' (NOT %3A700 — that breaks the API).
    const familyParam = spec.file
        .replace(/-.*/, '')                         // strip weight/style suffix
        .replace(/([a-z])([A-Z])/g, '$1 $2')       // CamelCase → words
        .replace(/ /g, '+');                        // spaces → +
    const weightSuffix = weight !== 400 ? `:${weight}` : '';
    const cssUrl = `https://fonts.googleapis.com/css?family=${familyParam}${weightSuffix}`;
    try {
        const cssRes = await axios.get(cssUrl, {
            headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)' },
            timeout: 15_000,
        });
        const match = (cssRes.data || '').match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/);
        if (match) {
            const response = await axios({ url: match[1], method: 'GET', responseType: 'stream', timeout: 30_000 });
            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(destPath);
                response.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            if (fs.existsSync(destPath) && fs.statSync(destPath).size > 5_000) {
                console.log(`[fonts] ✓ ${path.basename(destPath)} (Google Fonts fallback)`);
                return;
            }
        }
    } catch { /* silent */ }

    console.warn(`[fonts] ✗ Could not download ${path.basename(destPath)} — will use fallback font`);
}

const PLATFORM_PRESETS = {
    tiktok:  { label: 'TikTok',             width: 1080, height: 1920, fps: 30,  bitrate: '6000k', audioBitrate: '128k', codec: 'libx264', profile: 'high', level: '4.0' },
    youtube: { label: 'YouTube',             width: 1920, height: 1080, fps: 30,  bitrate: '8000k', audioBitrate: '192k', codec: 'libx264', profile: 'high', level: '4.2' },
    reels:   { label: 'Instagram Reels',     width: 1080, height: 1920, fps: 30,  bitrate: '5500k', audioBitrate: '128k', codec: 'libx264', profile: 'high', level: '4.0' },
    shorts:  { label: 'YouTube Shorts',      width: 1080, height: 1920, fps: 60,  bitrate: '6000k', audioBitrate: '192k', codec: 'libx264', profile: 'high', level: '4.1' },
};

const RESOLUTION_PRESETS = {
    '720p':  { width: 1280, height: 720,  bitrate: '4000k' },
    '1080p': { width: 1920, height: 1080, bitrate: '8000k' },
    '2k':    { width: 2560, height: 1440, bitrate: '16000k' },
    '4k':    { width: 3840, height: 2160, bitrate: '35000k' },
};

// ── Aspect-ratio reference dimensions ───────────────────────────────────────
// MUST mirror client/src/utils/playerDimensions.js's getPlayerDimensions()
// exactly — that table is what `project.settings.shared.size` gets synced to
// for the live `<Player>`, what `clip.fontSize` is authored against (a raw
// pixel value in THIS coordinate space), and what TextOverlay.jsx's
// `previewScale` divides by. Every RESOLUTION_PRESETS width below is that
// same table's 16:9 width at each quality tier (1280/1920/2560/3840) — no
// coincidence, `getResolutionDimensions()` below derives every OTHER aspect
// ratio's dimensions the same way, so 16:9 exports are byte-identical to
// before this fix and every other aspect ratio finally matches too.
//
// THE BUG THIS FIXES: `targetWidth`/`targetHeight` (below) used to come
// ONLY from RESOLUTION_PRESETS/PLATFORM_PRESETS — both blind to the
// project's actual aspect ratio unless the user happens to pick a platform
// preset (tiktok/reels/shorts) that matches it. A 9:16 project exported at
// the default '1080p' resolution (no platform selected) rendered at
// 1920x1080 — LANDSCAPE — while the editor's reference resolution for that
// same project was 1080x1920 PORTRAIT. `clip.fontSize` is an absolute pixel
// value in that reference space, so every caption came out roughly 1.78x
// off from what the editor showed, on top of the video itself being
// letterboxed into the wrong orientation. This is the actual cause of
// "caption size doesn't match the editor" that survived the earlier
// TextOverlay.jsx previewScale fix — that fix made the editor correctly
// show fontSize against ITS reference resolution; it could never have fixed
// the export using a DIFFERENT, aspect-ratio-blind one.
const ASPECT_RATIO_DIMENSIONS = {
    '9:16': { width: 1080, height: 1920 },
    '1:1':  { width: 1080, height: 1080 },
    '4:3':  { width: 1440, height: 1080 },
    '4:5':  { width: 1080, height: 1350 },
    '21:9': { width: 2560, height: 1080 },
    '16:9': { width: 1920, height: 1080 },
};

/**
 * Derive target export dimensions for a resolution TIER ('720p'/'1080p'/
 * '2k'/'4k') at a given aspect ratio, by scaling ASPECT_RATIO_DIMENSIONS'
 * 1080p-tier numbers to that tier's long edge — the same numbers
 * RESOLUTION_PRESETS already uses for 16:9, so 16:9 output is unchanged.
 * Falls back to the plain 16:9 RESOLUTION_PRESETS entry for an unrecognized
 * aspect ratio rather than throwing — an export must never fail over this.
 */
function getResolutionDimensions(aspectRatio, tier) {
    const resPreset = RESOLUTION_PRESETS[tier] || RESOLUTION_PRESETS['1080p'];
    const ref = ASPECT_RATIO_DIMENSIONS[aspectRatio];
    if (!ref) return { width: resPreset.width, height: resPreset.height };
    const scale = resPreset.width / ASPECT_RATIO_DIMENSIONS['16:9'].width;
    // FFmpeg's yuv420p output requires even width/height.
    const roundEven = (n) => Math.round(n * scale / 2) * 2;
    return { width: roundEven(ref.width), height: roundEven(ref.height) };
}

// ─── Main job handler ─────────────────────────────────────────────────────────

module.exports = async function processExportJob(job) {
    const startTime = Date.now();
    const { timeline, settings = {}, userId = 'anonymous', assetMap = {} } = job.data;

    await job.updateProgress(2);

    // ── Resolve platform / resolution settings ─────────────────────────────
    const platform   = settings.platform && PLATFORM_PRESETS[settings.platform] ? PLATFORM_PRESETS[settings.platform] : null;
    const resPreset  = RESOLUTION_PRESETS[settings.resolution] || RESOLUTION_PRESETS['1080p'];
    // A platform preset (tiktok/reels/shorts/youtube) already names an exact
    // orientation the user explicitly opted into — leave those untouched.
    // Otherwise derive from the PROJECT's actual aspect ratio (see
    // ASPECT_RATIO_DIMENSIONS/getResolutionDimensions above) instead of
    // blindly using resPreset's bare (always-16:9) width/height — that blind
    // default was the real cause of captions (and the whole frame) rendering
    // at the wrong size/orientation for any non-16:9 project exported
    // without an explicit platform selected.
    const resolvedDims = platform || getResolutionDimensions(settings.aspectRatio, settings.resolution);

    const targetWidth  = platform?.width  || resolvedDims.width;
    const targetHeight = platform?.height || resolvedDims.height;
    const targetFps    = platform?.fps    || settings.fps    || 30;
    const codec        = platform?.codec  || 'libx264';
    const profile      = platform?.profile || 'high';

    // ── Caption font-size resolution correction ────────────────────────────
    // `clip.fontSize`/`clip.stroke.width` are authored in the project's
    // REFERENCE resolution for its aspect ratio (ASPECT_RATIO_DIMENSIONS
    // above — the same table client/src/utils/playerDimensions.js uses for
    // the live `<Player>`). That equals `targetWidth` exactly for the common
    // case (no platform preset, default '1080p' resolution tier), which is
    // why the earlier R57/clip.scale fix looked complete on its own. It is
    // NOT equal whenever a DIFFERENT resolution tier is chosen — '720p'/'2k'/
    // '4k' all scale targetWidth/targetHeight by getResolutionDimensions()
    // above, but nothing scaled the caption font/stroke to match, so a
    // caption authored (and correctly shown) at the 1080p reference came out
    // proportionally too big at 720p and too small at 2k/4k. Computed once
    // here and applied to BOTH caption render paths below (the plain
    // per-clip drawtext loop and the animated captionProgram path).
    const captionRefDims = ASPECT_RATIO_DIMENSIONS[settings.aspectRatio] || ASPECT_RATIO_DIMENSIONS['16:9'];
    const captionScaleFactor = targetWidth / captionRefDims.width;

    let videoBitrate;
    switch (settings.quality) {
        case 'high':   videoBitrate = platform?.bitrate || '8000k';  break;
        case 'medium': videoBitrate = '5000k'; break;
        case 'low':    videoBitrate = '2000k'; break;
        default:       videoBitrate = platform?.bitrate || resPreset.bitrate;
    }

    const audioBitrate = platform?.audioBitrate || '192k';

    console.log(`🎬 [ExportJob ${job.id}] ${targetWidth}x${targetHeight} @ ${targetFps}fps | ${videoBitrate} | ${platform?.label || settings.resolution || '1080p'}`);

    // ── Gather clips ───────────────────────────────────────────────────────
    const videoTracks = timeline.tracks.filter(t =>
        (t.type === 'video' || t.type === 'image') && t.clips?.length > 0
    );
    const audioTracks = timeline.tracks.filter(t =>
        t.type === 'audio' && t.clips?.length > 0
    );
    // R69 — render architecture split. 'text' (captions/titles) and 'overlay'
    // (stickers/logos/lower-thirds) tracks are the two categories that move to
    // the Revideo render-worker when it's enabled; everything else (cuts,
    // grading, camera motion, audio) stays exactly where it already is in
    // this file, per the confirmed split.
    const revideoTextTracks    = timeline.tracks.filter(t => t.type === 'text'    && t.clips?.length > 0);
    const revideoOverlayTracks = timeline.tracks.filter(t => t.type === 'overlay' && t.clips?.length > 0);
    // Opt-in only — with this unset (the default), nothing below changes:
    // STEP 2.5 and STEP 4 run exactly as they always have. This is a NEW,
    // not-yet-independently-verified render path (see CLAUDE.md), so it does
    // not become every user's default behaviour just by existing.
    const revideoEnabled = process.env.REVIDEO_RENDER_ENABLED === '1' && !!process.env.RENDER_WORKER_URL;
    const useRevideo = revideoEnabled && (revideoTextTracks.length > 0 || revideoOverlayTracks.length > 0);
    let revideoSucceeded = false;
    let revideoWarning = null;

    if (videoTracks.length === 0) {
        throw new Error('No video or image clips found in timeline');
    }

    const uploadsDir = path.join(__dirname, '../uploads/temp');
    const publicDir  = path.join(__dirname, '../client/public');
    const exportsDir = path.join(__dirname, '../uploads/exports');
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const jobId      = `render-${job.id}-${Date.now()}`;
    const outputPath = path.join(exportsDir, `${jobId}.mp4`);
    const tmpDir     = path.join(exportsDir, jobId);
    fs.mkdirSync(tmpDir, { recursive: true });

    // ── URL/GCS helpers ────────────────────────────────────────────────────
    const bucketName = process.env.GCS_BUCKET_NAME || 'viral-pilot_bucket';

    const sanitizeFilename = (name) =>
        name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');

    const gcsPathFromStorageUrl = (url) => {
        if (!url || !url.startsWith(`https://storage.googleapis.com/${bucketName}/`)) return null;
        try { return decodeURIComponent(new URL(url).pathname.replace(`/${bucketName}/`, '')); }
        catch (_) { return null; }
    };

    const gcsPathFromProxyUrl = (url) => {
        if (!url) return null;
        const match = url.match(/\/api\/proxy\/gcs-media\/([^?#]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    };

    const resolveGcsPath = async (clip) => {
        let effectiveClip = clip;
        if (clip.assetId && assetMap[clip.assetId]) {
            const asset = assetMap[clip.assetId];
            const hasUsableUrl = isServerUsableUrl(clip.sourceUrl) || isServerUsableUrl(clip.url) || isServerUsableUrl(clip.proxyUrl);
            if (!hasUsableUrl) {
                effectiveClip = { ...clip, sourceUrl: asset.sourceUrl, url: asset.proxyUrl || asset.url, proxyUrl: asset.proxyUrl };
            }
        }

        const candidates = [effectiveClip.sourceUrl, effectiveClip.url, effectiveClip.src, effectiveClip.videoUrl, effectiveClip.proxyUrl];

        for (const raw of candidates) {
            const p = gcsPathFromStorageUrl(raw);
            if (p) return p;
        }
        for (const raw of candidates) {
            const p = gcsPathFromProxyUrl(raw);
            if (p) return p;
        }

        const assetForClip = clip.assetId ? assetMap[clip.assetId] : null;
        const filename = effectiveClip.originalName || assetForClip?.name || effectiveClip.name || clip.name;
        if (!filename || !gcsBucket) return null;

        const safeName = sanitizeFilename(filename);
        const rawName  = filename;

        let listUserId = userId;
        if (listUserId === 'anonymous') {
            const proxyUrls = [effectiveClip.proxyUrl, effectiveClip.url, effectiveClip.sourceUrl, clip.proxyUrl, clip.url, clip.sourceUrl];
            for (const raw of proxyUrls) {
                const m = raw?.match(/\/api\/proxy\/gcs-media\/(?:proxies|raw)\/([^/]+)\//);
                if (m) { listUserId = m[1]; break; }
            }
        }

        for (const name of [rawName, safeName]) {
            if (!name) continue;
            const exactPath = `raw/${listUserId}/${name}`;
            try {
                const [exists] = await gcsBucket.file(exactPath).exists();
                if (exists) return exactPath;
            } catch (_) {}
        }

        try {
            const [files] = await gcsBucket.getFiles({ prefix: `raw/${listUserId}/` });
            const match = files.find(f => {
                const base = f.name.split('/').pop();
                return base === rawName || base === safeName
                    || base.endsWith(`-${rawName}`) || base.endsWith(`-${safeName}`);
            });
            if (match) return match.name;
        } catch (_) {}

        return null;
    };

    const fetchClipSource = async (clip, localPath) => {
        let c = clip;
        if (clip.assetId && assetMap[clip.assetId] && !(isServerUsableUrl(clip.sourceUrl) || isServerUsableUrl(clip.url) || isServerUsableUrl(clip.proxyUrl))) {
            const asset = assetMap[clip.assetId];
            c = { ...clip, sourceUrl: asset.sourceUrl, url: asset.proxyUrl || asset.url, proxyUrl: asset.proxyUrl };
        }

        if (gcsBucket) {
            // ── 1. Try proxy/storage URL from clip metadata ──────────────────
            const gcsPath = await resolveGcsPath(c);
            if (gcsPath) {
                console.log(`[ExportJob] GCS download: ${gcsPath}`);
                try {
                    await gcsBucket.file(gcsPath).download({ destination: localPath });
                    return localPath;
                } catch (gcsErr) {
                    console.warn(`[ExportJob] GCS proxy download failed (${gcsPath}): ${gcsErr.message} — trying raw file`);
                }
            }

            // ── 2. Try raw/{userId}/{filename} — uploaded by proxyRoutes ────
            const clipName = c.name || clip.name;
            if (clipName) {
                const safeName = sanitizeFilename(clipName);
                for (const name of [clipName, safeName]) {
                    if (!name) continue;
                    const rawPath = `raw/${userId}/${name}`;
                    try {
                        const [exists] = await gcsBucket.file(rawPath).exists();
                        if (exists) {
                            console.log(`[ExportJob] GCS raw fallback: ${rawPath}`);
                            await gcsBucket.file(rawPath).download({ destination: localPath });
                            return localPath;
                        }
                    } catch (_) {}
                }
                // Try listing in case filename was prefixed with a timestamp
                try {
                    const [files] = await gcsBucket.getFiles({ prefix: `raw/${userId}/` });
                    const match = files.find(f => {
                        const base = f.name.split('/').pop();
                        return base === clipName || base === safeName
                            || base.endsWith(`-${clipName}`) || base.endsWith(`-${safeName}`);
                    });
                    if (match) {
                        console.log(`[ExportJob] GCS raw fallback (listed): ${match.name}`);
                        await gcsBucket.file(match.name).download({ destination: localPath });
                        return localPath;
                    }
                } catch (_) {}
            }
        }

        // ── 3. Local filesystem (monolith / dev mode) ────────────────────────
        const localSrc = resolveSourcePath(c, uploadsDir);
        if (localSrc) return localSrc;

        // ── 4. Absolute HTTP URLs (signed GCS URLs, CDN, etc.) ───────────────
        for (const raw of [c.sourceUrl, c.url, c.src, c.videoUrl]) {
            if (raw && !raw.startsWith('blob:') && !raw.includes('/api/proxy') && raw.startsWith('http')) {
                let safeUrl = raw;
                try {
                    const parsed = new URL(raw);
                    parsed.pathname = parsed.pathname.split('/').map(seg => encodeURIComponent(decodeURIComponent(seg))).join('/');
                    safeUrl = parsed.toString();
                } catch (_) {}
                try {
                    await downloadToTemp(safeUrl, localPath);
                    return localPath;
                } catch (httpErr) {
                    console.warn(`[ExportJob] HTTP download failed (${raw}): ${httpErr.message}`);
                }
            }
        }

        // ── 5. Proxy URL via internal server URL (cross-container fallback) ──
        const proxyRelUrl = c.proxyUrl || c.url;
        if (proxyRelUrl && proxyRelUrl.startsWith('/api/proxy/')) {
            const serverBase = process.env.PUBLIC_URL
                || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
                || `http://localhost:${process.env.PORT || 3000}`;
            const fullUrl = `${serverBase.replace(/\/$/, '')}${proxyRelUrl}`;
            try {
                console.log(`[ExportJob] Internal proxy download: ${fullUrl}`);
                // Server-to-server: the media route is owner-only, so the
                // worker identifies itself (services/mediaAccess.js).
                await downloadToTemp(fullUrl, localPath,
                    process.env.WORKER_SECRET ? { 'X-Worker-Secret': process.env.WORKER_SECRET } : undefined);
                return localPath;
            } catch (err) {
                console.warn(`[ExportJob] Internal proxy download failed: ${err.message}`);
            }
        }

        console.warn(`[ExportJob] Cannot resolve source for clip "${clip.name}" — skipping`);
        return null;
    };

    // ── Collect & sort clips ───────────────────────────────────────────────
    let allClips = [];
    for (const track of videoTracks) {
        for (const clip of track.clips) {
            allClips.push({ ...clip, trackVolume: track.volume ?? 1.0 });
        }
    }
    allClips.sort((a, b) => a.start - b.start);

    const scaleFilter = buildScaleFilter(targetWidth, targetHeight);

    // ── Project colour grade (LUT) ──────────────────────────────────────────
    // server/lut-engine/library/LUTExportIntegration.js has always known how to
    // download a .cube and build the `lut3d` filter string — nothing ever called
    // it, so selecting a LUT changed no pixel in the export (nor in the preview;
    // see R55). Resolved ONCE per job rather than per clip: it downloads a file,
    // and the grade is a project-level setting.
    //
    // FAILS OPEN BY DESIGN: getLUTFilterForExport() returns null on every error
    // path (missing LUT, no gcs_path, download failure), and a null simply means
    // no filter is added. An export must never fail because a colour grade could
    // not be fetched — an ungraded video is a far better outcome than no video.
    let lutFilter = null;
    const projectLUTId = settings.projectLUTId || timeline?.projectLUTId || null;
    if (projectLUTId) {
        try {
            const { lutExportIntegration } = require('../server/lut-engine/library/LUTExportIntegration.js');
            lutFilter = await lutExportIntegration.getLUTFilterForExport(projectLUTId, tmpDir);
            console.log(lutFilter
                ? `🎨 [ExportJob ${job.id}] LUT ${projectLUTId} applied: ${lutFilter}`
                : `🎨 [ExportJob ${job.id}] LUT ${projectLUTId} could not be resolved — exporting ungraded`);
        } catch (lutErr) {
            console.warn(`[ExportJob ${job.id}] LUT lookup failed (exporting ungraded):`, lutErr.message);
            lutFilter = null;
        }
    }

    await job.updateProgress(5);

    // ── STEP 1: Trim each clip into a segment ──────────────────────────────
    const segments = [];
    // Caption timing: track the output-video start time for every successful
    // segment so that STEP 4 can map Vibed-timeline positions → output times.
    // The output video concatenates clips back-to-back (no gaps), so a caption
    // at Vibed t=30 could appear at output t=12 if there were 18 seconds of
    // gaps or deliberate empty space before that point in the Vibed timeline.
    const segOutputStarts = []; // output video start time (s) for each segment
    const segClips        = []; // allClips entry that produced each segment
    let   cumulativeOut   = 0;  // running total output duration (s)

    for (let i = 0; i < allClips.length; i++) {
        const clip    = allClips[i];
        const ext     = path.extname(clip.name || '.mp4') || '.mp4';
        const dlPath  = path.join(tmpDir, `dl-${i}${ext}`);
        const src     = await fetchClipSource(clip, dlPath);

        if (!src) {
            console.warn(`⚠️  [ExportJob] No source for "${clip.name}", skipping`);
            continue;
        }

        const segPath = path.join(tmpDir, `seg-${i}.mp4`);
        const inPoint = clip.offset || 0;
        // `duration` is TIMELINE length (= output length); the clip shows
        // duration × speed seconds of SOURCE from `offset` (the store's model,
        // client/src/timeline/speedChange.js). fluent's setDuration() is an
        // OUTPUT -t, so it is `dur`: -ss seeks the source, setpts/atempo play
        // it at `speed`, -t stops after the clip's timeline length. It used to
        // be dur / speed, so a 2x clip exported at half its length (0.25x at
        // 4x its length) and every later caption drifted.
        const dur     = clip.duration;
        const vol     = (clip.volume ?? 1.0) * (clip.trackVolume ?? 1.0);
        const speed   = clip.speed || 1.0;
        const isImage = clip.type === 'image';

        // R67 — "blur background" (Object Intelligence). A genuinely different
        // render path (two-input alpha compositing, see
        // renderBackgroundBlurSegment's header for why this is a separate
        // function rather than another branch inside the shared vFilters
        // pipeline below). Handled and `continue`d here so every clip WITHOUT
        // layerTarget:'background' goes through the existing, unmodified path.
        if (!isImage && clip.layerTarget === 'background' && clip.layerMask?.maskAssetUrl) {
            try {
                const maskLocalPath = path.join(tmpDir, `mask-${i}.mp4`);
                await downloadUrlToFile(clip.layerMask.maskAssetUrl, maskLocalPath);
                await renderBackgroundBlurSegment(clip, src, segPath, {
                    targetWidth, targetHeight, targetFps, codec, profile, audioBitrate,
                    maskLocalPath,
                });
                segments.push(segPath);
                segOutputStarts.push(cumulativeOut);
                segClips.push(clip);
                // renderBackgroundBlurSegment reads `duration` seconds at 1x,
                // so the segment lasts exactly `dur` (speed is not applied on
                // this path).
                cumulativeOut += dur;
                console.log(`  [blur-background] clip "${clip.name}": composited via SAM2 mask`);
            } catch (err) {
                console.error(`[ExportJob] blur-background failed for clip "${clip.name}", falling back to unblurred: ${err.message}`);
                // Fail-open per this project's convention (see CLAUDE.md's
                // compositorWarning/captionProgramWarning precedent) — an
                // export must never hard-fail because one effect couldn't
                // render. Falls through to the normal per-clip path below by
                // simply NOT `continue`-ing, so the clip still exports, just
                // without the blur.
            }
            if (segments[segments.length - 1] === segPath) continue;
        }

        // Phones store portrait clips as landscape + a rotation matrix. FFmpeg's
        // own autorotation (left ON, see below) turns them upright before our
        // filters run and leaves the matrix out of the output. Probed only for
        // the log line.
        //
        // It used to be the other way round: -noautorotate plus a manual
        // transpose chosen from this probe. The probe read the wrong field (see
        // rotationFromProbeStream), so every iPhone clip came back as 0 and got
        // no transpose, and -noautorotate copied the rotation matrix onto the
        // segment: a 1080x1920 file that players turned into a 1920x1080 frame
        // with the speaker pillarboxed in the middle. The caption pass then
        // burned the captions onto that landscape frame. That was "the exported
        // size isn't right / captions are the wrong size", even with a 9:16
        // platform preset.
        const rotation = isImage ? 0 : await getVideoRotation(src);
        if (rotation) console.log(`  [rotate] clip "${clip.name}": stored at ${rotation}°, auto-rotated upright`);

        await new Promise((resolve, reject) => {
            let cmd;
            if (isImage) {
                cmd = ffmpeg().input(src).inputOptions(['-loop', '1']).setDuration(dur);
            } else {
                // FFmpeg autorotates by default (rotation matrix applied before
                // the filters, and not copied to the output). Never pass
                // -noautorotate here: see the rotation note above.
                cmd = ffmpeg(src)
                    .setStartTime(inPoint)
                    .setDuration(dur);
            }

            // Virtual multicam crop (clip.virtualCam) — the editor preview applies
            // this via PlaybackEngine's UV sub-region sampling (u_cropOffset /
            // u_cropSize); the export must mirror it or multicam projects come out
            // 100% wide. Placement matters: AFTER rotation correction (coords are
            // in the upright frame the user saw in preview) and BEFORE scaling
            // (coords are fractions of the source frame, not the output frame).
            const vc = clip.virtualCam;
            const hasCrop = vc && typeof vc.cropW === 'number' && typeof vc.cropH === 'number'
                && (vc.cropW < 0.999 || vc.cropH < 0.999);
            // Camera track: scale keyframes (zoom rhythm, KeyframeEditor, camera
            // presets) plus panX/panY (camera shake/whip/pan, from
            // CameraMotionCompiler). Images get it too: a base-track photo
            // with a Ken Burns / zoom animation now moves in the export.
            const scaleKfs = clip.keyframes && Array.isArray(clip.keyframes.scale) && clip.keyframes.scale.length
                ? clip.keyframes.scale
                : null;
            const panX = Array.isArray(clip.keyframes?.panX) && clip.keyframes.panX.length ? clip.keyframes.panX : null;
            const panY = Array.isArray(clip.keyframes?.panY) && clip.keyframes.panY.length ? clip.keyframes.panY : null;

            const vFilters = [];
            const aFilters = [];
            // Scale keyframes animate on clip-local TIMELINE time, so the speed
            // change runs first whenever a zoom follows (spatial filters do not
            // care about timestamps, so this order changes nothing else).
            const hasZoomKfs = !!(scaleKfs || panX || panY);
            const speedFirst = !isImage && speed !== 1.0 && hasZoomKfs;
            if (speedFirst) vFilters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);

            if (hasCrop && hasZoomKfs) {
                // ── COMPOSED: multicam crop + zoom-rhythm on the SAME clip ──────
                // ONE zoom whose level is vc.scale * the rhythm scale, centred on
                // the multicam angle (R16: never stack a static crop and a second
                // zoom). Runs on the upright source frame; scale/pad follows.
                const cx0 = Math.max(0, Math.min(1, (vc.cropX ?? 0) + (vc.cropW ?? 1) / 2));
                const cy0 = Math.max(0, Math.min(1, (vc.cropY ?? 0) + (vc.cropH ?? 1) / 2));
                const baseZoom = vc.scale || (1 / Math.min(vc.cropW, vc.cropH));
                const anchor = { mode: 'center', x: cx0, y: cy0 };
                const zoom = buildSmoothZoomFilter(scaleKfs || [{ time: 0, value: 1 }], { fps: targetFps, anchor, multiplier: baseZoom, maxZoom: 8.0, panX, panY })
                    || buildSmoothZoomFilter([{ time: 0, value: baseZoom }], { fps: targetFps, anchor, maxZoom: 8.0 });
                if (zoom) vFilters.push(zoom);
                vFilters.push(scaleFilter);
                console.log(
                    `  [multicam+rhythm] clip "${clip.name}" angle=${vc.angle || '?'}: composed zoom ` +
                    `centred @(${cx0.toFixed(2)},${cy0.toFixed(2)}), base=${baseZoom.toFixed(2)}x`
                );
            } else {
                if (hasCrop) {
                    const cx = Math.max(0, Math.min(1, vc.cropX ?? 0));
                    const cy = Math.max(0, Math.min(1, vc.cropY ?? 0));
                    const cw = Math.max(0.05, Math.min(1 - cx, vc.cropW));
                    const ch = Math.max(0.05, Math.min(1 - cy, vc.cropH));
                    vFilters.push(`crop=iw*${cw.toFixed(4)}:ih*${ch.toFixed(4)}:iw*${cx.toFixed(4)}:ih*${cy.toFixed(4)}`);
                    console.log(`  [multicam] clip "${clip.name}" angle=${vc.angle || '?'} crop=${cw.toFixed(2)}x${ch.toFixed(2)}@(${cx.toFixed(2)},${cy.toFixed(2)})`);
                }
                vFilters.push(scaleFilter);
            }

            // A still image just lasts `dur`; speed means nothing for it.
            if (!isImage && speed !== 1.0) {
                if (!speedFirst) vFilters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
                aFilters.push(...atempoChain(speed));
            }
            if (!isImage && vol !== 1.0) aFilters.push(`volume=${vol.toFixed(4)}`);

            // Zoom-rhythm scale keyframes, NO multicam crop on this clip → smooth
            // animated zoom (push-ins / punch-ins) on the output frame. Anchor:
            // horizontally centred, the point 28% from the top stays put (the
            // speaker's face). The editor preview uses the same anchor
            // (RHYTHM_ANCHOR_Y in client/src/revideo/project.tsx).
            if (!hasCrop && hasZoomKfs) {
                const zoom = buildSmoothZoomFilter(scaleKfs, { fps: targetFps, anchor: { mode: 'fixed', x: 0.5, y: 0.28 }, panX, panY });
                if (zoom) {
                    vFilters.push(zoom);
                    console.log(`  [camera] clip "${clip.name}": animated zoom/pan (${scaleKfs?.length || 0} scale, ${(panX?.length || 0) + (panY?.length || 0)} pan keyframes)`);
                }
            }

            // Colour grade LAST, so it grades the final composed frame rather
            // than an intermediate one — after rotation correction, crop,
            // zoompan and scale/pad. Grading before the scale would apply the
            // LUT to padding bars as well.
            if (lutFilter) vFilters.push(lutFilter);

            cmd.videoFilters(vFilters.join(','));

            if (isImage) {
                cmd.input(`anullsrc=channel_layout=stereo:sample_rate=44100`).inputOptions(['-f', 'lavfi']);
            } else if (aFilters.length) {
                cmd.audioFilters(aFilters.join(','));
            }

            cmd
                .fps(targetFps)
                .videoCodec(codec)
                .addOutputOption('-profile:v', profile)
                .addOutputOption('-pix_fmt', 'yuv420p')
                .addOutputOption('-movflags', '+faststart')
                .addOutputOption('-shortest')
                .audioBitrate(audioBitrate)
                .output(segPath)
                .on('end', () => {
                    segments.push(segPath);
                    // Record this clip's output start time BEFORE incrementing.
                    segOutputStarts.push(cumulativeOut);
                    segClips.push(clip);
                    cumulativeOut += dur;
                    resolve();
                })
                .on('error', (err, _stdout, stderr) => {
                    console.error(`[ExportJob] ffmpeg failed clip ${i + 1}: ${err.message}`);
                    if (stderr) console.error(stderr.slice(-1000));
                    reject(err);
                })
                .run();
        });

        const pct = 5 + Math.round(((i + 1) / allClips.length) * 55);
        await job.updateProgress(pct);
        console.log(`  ✅ Segment ${i + 1}/${allClips.length}: "${clip.name}"`);
    }

    if (segments.length === 0) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw new Error('No valid clips could be processed');
    }

    // ── STEP 2: Concatenate ────────────────────────────────────────────────
    let finalVideoPath = outputPath;
    if (segments.length === 1) {
        fs.renameSync(segments[0], outputPath);
    } else {
        const concatList = path.join(tmpDir, 'concat.txt');
        fs.writeFileSync(concatList, segments.map(s => `file '${s}'`).join('\n'));

        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(concatList)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .videoCodec('copy')
                .audioCodec('copy')
                .output(outputPath)
                .on('end', resolve)
                .on('error', reject)
                .run();
        });
        console.log(`  ✅ Concatenated ${segments.length} segments`);
    }

    await job.updateProgress(70);

    // ── STEP 2.5: Composite overlay layers (R60) ───────────────────────────
    // The layered-graphics pass. Everything above this line composites NOTHING:
    // `allClips` flattens every clip from every video track into one array
    // sorted by start time, so two clips overlapping in time on different
    // tracks are played in SEQUENCE, not stacked. That is why stickers, logos,
    // lower thirds and picture-in-picture have been impossible.
    //
    // ── THIS RUNS ALONGSIDE THE EXISTING PIPELINE, IT DOES NOT REPLACE IT ──
    // Three independent conditions must all hold before a single filter runs:
    //   1. the client sent a composition plan,
    //   2. the plan validates,
    //   3. the plan has at least one overlay (`planIsNoOp` is false).
    // A project with one video track — i.e. every project that renders
    // correctly today — produces an empty overlay list, so this block is
    // skipped entirely and the export is byte-for-byte what it was before.
    // COMPOSITOR_DISABLED=1 is a deploy-free kill switch if it ever misbehaves
    // in production.
    //
    // FAILS OPEN, like the LUT lookup (R55) and the caption burn-in: any error
    // leaves `finalVideoPath` pointing at the un-composited video and the export
    // continues. A video missing its stickers is a far better outcome than no
    // video, and the reason is surfaced to the user rather than swallowed.
    let compositorWarning = null;
    const rawPlan = settings.compositionPlan || null;

    // R63 — animated captions. Declared here, at function scope, NOT inside the
    // `if (textTracks.length > 0 && !useRevideo)` block further down where the
    // caption program is actually compiled: the final return statement (below)
    // reads this value long after that block has closed, and `let` is block-
    // scoped. A declaration nested inside that if/else was invisible to the
    // return statement — every export unconditionally threw
    // "captionProgramWarning is not defined" building the result object, since
    // the reference at the bottom resolved to no binding at all, not to a not-
    // yet-initialized one. Mirrors compositorWarning/revideoWarning above/below,
    // which are correctly declared at this same top level for the same reason.
    let captionProgramWarning = null;

    // R69: when Revideo is compositing overlays, FFmpeg must not ALSO
    // composite them here — doing both would draw every sticker/lower-third
    // twice. `useRevideo` is decided up front, before this step, for exactly
    // that reason.
    if (rawPlan && process.env.COMPOSITOR_DISABLED !== '1' && !useRevideo) {
        try {
            const { compileCompositionPlan, validateCompositionPlanShape } =
                require('../server/compositor/CompositorCompiler.js');

            // The plan carries its own version; a worker that predates a plan
            // format must decline it rather than mis-render it.
            const planErrors = validateCompositionPlanShape(rawPlan, targetWidth, targetHeight);
            if (planErrors.length > 0) {
                throw new Error(`plan rejected: ${planErrors.slice(0, 3).join('; ')}`);
            }

            // Plan geometry is NORMALISED (0..1 of the frame), so the same plan
            // renders correctly at any resolution. Tell the compiler which one
            // this job is actually producing — this is where fractions become
            // pixels, and it is the only place that conversion happens.
            rawPlan.renderWidth  = targetWidth;
            rawPlan.renderHeight = targetHeight;

            const overlays = rawPlan.overlays || [];
            console.log(`🧩 [ExportJob ${job.id}] compositing ${overlays.length} overlay layer(s)`);

            // Fetch each overlay's source. A layer we cannot fetch is DROPPED,
            // not fatal — one dead sticker URL must not cost the whole export.
            const inputs = [];
            const inputFiles = [];
            for (let i = 0; i < overlays.length; i++) {
                const ov = overlays[i];
                const srcClip = {
                    id: ov.clipId,
                    name: `overlay-${i}${path.extname(ov.source?.url || '') || '.mp4'}`,
                    assetId: ov.source?.assetId,
                    url: ov.source?.url,
                    sourceUrl: ov.source?.url,
                    proxyUrl: ov.source?.url,
                };
                const dlPath = path.join(tmpDir, `ovdl-${i}${path.extname(ov.source?.url || '') || '.mp4'}`);
                const src = await fetchClipSource(srcClip, dlPath);
                if (!src) {
                    console.warn(`  ⚠️  overlay ${ov.id}: source unresolved — layer skipped`);
                    continue;
                }
                // Input 0 is the base video, so overlay inputs start at 1.
                inputs.push({ overlayId: ov.id, inputIndex: inputFiles.length + 1 });
                inputFiles.push({
                    path: src,
                    isImage: ov.source?.type === 'image',
                    outputEnd: ov.outputEnd,
                    // R88: a video overlay starts at its own in-point (clip.offset),
                    // not at the top of the file. Images/stickers have none.
                    seek: ov.source?.type === 'video' ? Math.max(0, Number(ov.sourceOffset) || 0) : 0,
                });
            }

            const compiled = compileCompositionPlan(rawPlan, inputs);
            if (!compiled) throw new Error('no drawable overlay layers after source resolution');

            const compositedPath = path.join(tmpDir, 'composited.mp4');
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg(finalVideoPath);
                for (const f of inputFiles) {
                    // A still image has no duration of its own; -loop 1 gives it
                    // one, and -t stops it running past its window forever.
                    if (f.isImage) cmd = cmd.input(f.path).inputOptions(['-loop', '1', '-t', String(Math.max(0.1, f.outputEnd))]);
                    else if (f.seek > 0) cmd = cmd.input(f.path).inputOptions(['-ss', String(f.seek)]);
                    else           cmd = cmd.input(f.path);
                }
                cmd
                    .complexFilter(compiled.filterComplex, compiled.outputLabel)
                    .videoCodec(codec)
                    .videoBitrate(videoBitrate)
                    .outputOptions([`-profile:v`, profile, '-pix_fmt', 'yuv420p'])
                    // Audio is untouched here — STEP 3 still mixes it afterwards.
                    .audioCodec('copy')
                    .output(compositedPath)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });

            finalVideoPath = compositedPath;
            console.log(`  ✅ Composited ${compiled.used} overlay layer(s)`);
        } catch (compErr) {
            compositorWarning = `Overlay layers could not be composited: ${compErr.message}`;
            console.warn(`[ExportJob ${job.id}] compositor failed (exporting without overlays):`, compErr.message);
        }
    }

    await job.updateProgress(74);

    // ── STEP 3: Mix audio tracks ───────────────────────────────────────────
    if (audioTracks.length > 0) {
        const audioSegments = [];
        for (let i = 0; i < audioTracks.length; i++) {
            const track = audioTracks[i];
            for (let j = 0; j < track.clips.length; j++) {
                const clip    = track.clips[j];
                const ext     = path.extname(clip.name || '.mp3') || '.mp3';
                const aDlPath = path.join(tmpDir, `adl-${i}-${j}${ext}`);
                const src     = await fetchClipSource(clip, aDlPath);
                if (!src) continue;

                const aSegPath = path.join(tmpDir, `audio-${i}-${j}.aac`);
                const vol      = (clip.volume ?? 1.0) * (track.volume ?? 1.0);

                await new Promise((resolve, reject) => {
                    const aSpeed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
                    ffmpeg(src)
                        .setStartTime(clip.offset || 0)
                        .setDuration(clip.duration || 0) // output -t: the clip's timeline length
                        .audioFilters([...(aSpeed !== 1 ? atempoChain(aSpeed) : []), `volume=${vol.toFixed(4)}`].join(','))
                        .audioBitrate(audioBitrate)
                        .output(aSegPath)
                        .on('end', () => { audioSegments.push({ path: aSegPath, startTime: clip.start }); resolve(); })
                        .on('error', reject)
                        .run();
                });
            }
        }

        if (audioSegments.length > 0) {
            const mixedPath = path.join(tmpDir, 'mixed.mp4');
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg(finalVideoPath);
                for (const seg of audioSegments) cmd = cmd.input(seg.path);

                const amixInputs  = 1 + audioSegments.length;
                const filterComplex =
                    `[0:a]volume=1[va];` +
                    audioSegments.map((seg, i) => `[${i + 1}:a]adelay=${Math.round(seg.startTime * 1000)}|${Math.round(seg.startTime * 1000)}[da${i}]`).join(';') +
                    `;[va]${audioSegments.map((_, i) => `[da${i}]`).join('')}amix=inputs=${amixInputs}:duration=first:dropout_transition=0[aout]`;

                cmd
                    .complexFilter(filterComplex, 'aout')
                    .videoCodec('copy')
                    .audioBitrate(audioBitrate)
                    .output(mixedPath)
                    .on('end', () => { finalVideoPath = mixedPath; resolve(); })
                    .on('error', reject)
                    .run();
            });
            console.log('  ✅ Audio tracks mixed');
        }
    }

    await job.updateProgress(82);

    // ── STEP 3.5: Revideo composite — captions + motion graphics (R69) ─────
    // Only runs when REVIDEO_RENDER_ENABLED=1, RENDER_WORKER_URL is set, and
    // there's actually a 'text' or 'overlay' track to draw. `finalVideoPath`
    // at this point is FFmpeg's fully cut/graded/audio-mixed output — exactly
    // the single `baseVideoUrl` the render-worker's scene expects (see its
    // own header for why it owns nothing else).
    //
    // FAILS OPEN, same rule as STEP 2.5 and STEP 4 below: any failure here
    // (worker unreachable, timeout, bad response) leaves `finalVideoPath`
    // pointing at the plain base video and STEP 4 runs as the fallback —
    // this call and the old drawtext path are mutually exclusive, so a
    // Revideo failure means "ship the video without captions/graphics and
    // say so," never "run both and risk double-rendering."
    if (useRevideo) {
        try {
            const backendUrl = resolvePublicBackendUrl();

            // The worker fetches this by URL — it cannot read tmpDir directly
            // (it's a separate service, possibly on a different machine).
            let baseVideoUrl;
            let uploadedTempGcsPath = null;
            if (gcsBucket) {
                uploadedTempGcsPath = `exports/${userId}/_revideo-base-${jobId}.mp4`;
                await gcsBucket.upload(finalVideoPath, {
                    destination: uploadedTempGcsPath,
                    metadata: { contentType: 'video/mp4' },
                });
                baseVideoUrl = `https://storage.googleapis.com/${bucketName}/${uploadedTempGcsPath}`;
            } else {
                // Local-storage dev mode: serve it from this same backend's
                // /uploads/exports/ static route, same fallback local exports
                // already use for the final result.
                const localName = `_revideo-base-${jobId}.mp4`;
                fs.copyFileSync(finalVideoPath, path.join(exportsDir, localName));
                baseVideoUrl = `${backendUrl}/uploads/exports/${localName}`;
            }

            const revideoOutPath = path.join(tmpDir, 'revideo-composite.mp4');
            await renderViaRevideoWorker({
                baseVideoUrl,
                tracks: [...revideoTextTracks, ...revideoOverlayTracks],
                duration: allClips.reduce((max, c) => Math.max(max, (c.start || 0) + (c.duration || 0)), 0),
                aspectRatio: settings.aspectRatio || '16:9',
                fps: targetFps,
                backendUrl,
                outputPath: revideoOutPath,
            });

            finalVideoPath = revideoOutPath;
            revideoSucceeded = true;
            console.log('  ✅ Revideo composite (captions + motion graphics) applied');

            // Best-effort cleanup of the temporary base-video copy — a failure
            // here doesn't affect the export, so it's logged, not thrown.
            if (uploadedTempGcsPath) {
                gcsBucket.file(uploadedTempGcsPath).delete().catch(err =>
                    console.warn(`  ⚠️  Could not clean up temp GCS base video: ${err.message}`));
            }
        } catch (revideoErr) {
            revideoWarning = revideoErr.message.slice(0, 800);
            console.error(`  ❌ Revideo composite failed — captions/graphics missing:\n${revideoErr.message}`);
        }
    }

    // ── STEP 4: Text overlays ──────────────────────────────────────────────
    // Skipped when Revideo already composited captions (revideoSucceeded) —
    // running both would draw every caption twice. When useRevideo was
    // requested but failed, this does NOT run either (see the fails-open note
    // above): a Revideo attempt that fails ships without captions/graphics
    // rather than silently falling through to the old drawtext path, which
    // could otherwise mask a worker outage as "everything's fine."
    // captionError is set if the burn-in step fails; surfaced in job result.
    let captionError = null;
    // Fonts the user actually asked for that couldn't be resolved to a real file
    // and were silently substituted with the fallback (Anton). Previously this
    // was invisible — the export "succeeded" with the wrong font baked in and
    // no warning anywhere. Collected here and folded into captionWarning below.
    const fontFallbackWarnings = new Set();
    const textTracks = timeline.tracks.filter(t => t.type === 'text' && t.clips?.length > 0);

    if (textTracks.length > 0 && !useRevideo) {
        // ── Font resolution ────────────────────────────────────────────────
        const fontsDir = path.join(publicDir, 'fonts');
        if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

        // Collect only the font families actually used in this export
        const neededFamilies = new Set(['Anton']); // Anton always needed as fallback
        for (const track of textTracks) {
            for (const clip of track.clips) {
                if (clip.fontFamily) neededFamilies.add(clip.fontFamily);
            }
        }

        // Download missing fonts in parallel (files persist across exports)
        await Promise.all(
            [...neededFamilies].map(family => {
                const spec = FONT_SPECS[family];
                if (!spec) return Promise.resolve();
                return downloadFont(path.join(fontsDir, spec.file), spec);
            })
        );

        // Build FAMILY_PATHS from FONT_SPECS (only include files that exist on disk)
        const FAMILY_PATHS = {};
        for (const [family, spec] of Object.entries(FONT_SPECS)) {
            const p = path.join(fontsDir, spec.file);
            if (fs.existsSync(p) && fs.statSync(p).size > 5_000) FAMILY_PATHS[family] = p;
        }
        // Also include system fonts as aliases
        const systemFontAliases = {
            'Liberation Sans': '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            'DejaVu Sans':     '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            'FreeSans':        '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
            'Helvetica':       '/System/Library/Fonts/Helvetica.ttc',
        };
        for (const [family, p] of Object.entries(systemFontAliases)) {
            if (fs.existsSync(p)) FAMILY_PATHS[family] = p;
        }

        // Ordered fallback list — Anton first (Vibed default)
        const fallbackFontPath = [
            path.join(fontsDir, 'Anton-Regular.ttf'),
            path.join(fontsDir, 'Roboto-Regular.ttf'),
            '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
            '/System/Library/Fonts/Helvetica.ttc',
        ].find(p => fs.existsSync(p)) || null;

        if (!fallbackFontPath) {
            console.warn('  ⚠️  No usable font found for caption export — skipping text overlay');
        } else {
            // ── Vibed-timeline → output-video time mapping ─────────────────
            // The exported video has all clips concatenated with no gaps.
            // segClips[i] is the source clip and segOutputStarts[i] is where it
            // starts in the output video.  Captions carry Vibed timeline times,
            // which must be converted to output times before writing the enable expr.
            const vibedToOutputTime = (vibedTime) => {
                for (let si = 0; si < segClips.length; si++) {
                    const sc = segClips[si];
                    const clipEnd = sc.start + sc.duration;
                    if (vibedTime >= sc.start && vibedTime < clipEnd) {
                        // A clip lasts its timeline duration in the output, so
                        // time inside it maps 1:1 (speed is already in it).
                        return segOutputStarts[si] + (vibedTime - sc.start);
                    }
                }
                // Before the first clip → clamp to output t=0
                if (segClips.length === 0 || vibedTime <= segClips[0].start) return 0;
                // Past the last clip → clamp to total output duration
                return cumulativeOut;
            };

            // ── Build drawtext filter chain ────────────────────────────────
            // IMPORTANT: Use textfile= (not text=) so ffmpeg reads text from a file.
            // This completely avoids ffmpeg filter-string escaping issues — apostrophes,
            // commas, colons, quotes, etc. in caption text all work transparently.
            const textFilters = [];
            let filterIdx = 0;

            // ── R63: animated captions (motion/textShadow/uppercase/reveal) ────
            // `captionProgram` is built client-side from the SAME resolver that
            // drives the live preview (client/src/motion/CaptionCompiler.js) and
            // ships in export settings exactly like `compositionPlan` (R59-60).
            // Clips it covers are rendered by the compiled program below and
            // SKIPPED by the plain per-clip loop that follows — one clip must
            // never be drawn by both paths. A clip with no animation/shadow/
            // uppercase never appears in the program at all, so today's plain
            // captions take the exact code path they always have.
            // FAILS OPEN like the compositor and the LUT lookup (R55): any
            // problem here just means `programClipIds` stays empty and every
            // clip falls through to the untouched static path below.
            // captionProgramWarning itself is declared at function scope (near
            // compositorWarning, above) — see the comment there. Only reassigned
            // here, never re-declared, so the final return statement can see it.
            const programClipIds = new Set();
            let compiledCaptionProgram = { filters: [], tempFiles: [], skipped: [] };
            // R88 raster captions: prepared images + the program entries they
            // replace (kept for the drawtext fallback if the overlay pass fails).
            let rasterPrepared = null;
            let rasterProgramEntries = [];
            const rawCaptionProgram = settings.captionProgram || null;

            if (rawCaptionProgram && process.env.CAPTION_PROGRAM_DISABLED !== '1') {
                try {
                    const { compileCaptionProgram, validateCaptionProgramShape } =
                        require('../server/compositor/CaptionCompiler.js');

                    const programErrors = validateCaptionProgramShape(rawCaptionProgram);
                    if (programErrors.length > 0) {
                        throw new Error(`caption program rejected: ${programErrors.slice(0, 3).join('; ')}`);
                    }

                    // Same reference-resolution correction as the static drawtext
                    // path above (`captionScaleFactor`) — `entry.style.fontSize`/
                    // `stroke.width` are reference-resolution pixels, and
                    // CaptionCompiler.js has no other way to know the actual
                    // render resolution can differ from that reference (any
                    // resolution tier other than the '1080p' one the reference
                    // table matches). Scaled once here, at the call site, so
                    // CaptionCompiler.js itself stays resolution-agnostic rather
                    // than also learning about targetWidth/ASPECT_RATIO_DIMENSIONS.
                    const scaledCaptionProgram = captionScaleFactor === 1
                        ? rawCaptionProgram
                        : {
                            ...rawCaptionProgram,
                            entries: rawCaptionProgram.entries.map(entry => ({
                                ...entry,
                                style: {
                                    ...entry.style,
                                    fontSize: (Number(entry.style?.fontSize) || 48) * captionScaleFactor,
                                    stroke: entry.style?.stroke
                                        ? { ...entry.style.stroke, width: (Number(entry.style.stroke.width) || 0) * captionScaleFactor }
                                        : entry.style?.stroke,
                                },
                            })),
                        };

                    // R88 — captions with rotation, per-word highlight or keyword
                    // emphasis are drawn as images (RasterCaptionCompiler), not
                    // drawtext. Prepared FIRST: an entry is only taken off the
                    // drawtext program once its images actually exist. If
                    // preparation fails, the entry stays below and renders as
                    // plain animated text, exactly as it did before R88.
                    if (process.env.RASTER_CAPTIONS_DISABLED !== '1') {
                        try {
                            const { prepareRasterCaptions, rasterEntries } = require('../server/compositor/RasterCaptionCompiler.js');
                            const wanted = rasterEntries(scaledCaptionProgram);
                            if (wanted.length > 0) {
                                rasterPrepared = prepareRasterCaptions(wanted, {
                                    tmpDir,
                                    frameWidth: targetWidth,
                                    frameHeight: targetHeight,
                                    pxScale: captionScaleFactor,
                                    fallbackFontPath,
                                    resolveFont: (family) => (family && FAMILY_PATHS[family]) ? FAMILY_PATHS[family] : null,
                                });
                                if (rasterPrepared.skipped.length > 0) {
                                    console.warn(`  ⚠️  ${rasterPrepared.skipped.length} raster caption(s) fell back to text:`, rasterPrepared.skipped.slice(0, 3));
                                }
                                console.log(`🖼️  [ExportJob ${job.id}] raster captions: ${rasterPrepared.items.length}/${wanted.length} prepared`);
                            }
                        } catch (rasterErr) {
                            rasterPrepared = null;
                            captionProgramWarning = `Rotated/highlighted captions were exported as plain text: ${rasterErr.message}`;
                            console.warn(`[ExportJob ${job.id}] raster caption preparation failed (plain text instead):`, rasterErr.message);
                        }
                    }
                    const rasterIds = new Set((rasterPrepared?.items || []).map(it => it.clipId));
                    rasterProgramEntries = scaledCaptionProgram.entries.filter(e => rasterIds.has(e.clipId));
                    const drawtextProgram = rasterIds.size === 0
                        ? scaledCaptionProgram
                        : { ...scaledCaptionProgram, entries: scaledCaptionProgram.entries.filter(e => !rasterIds.has(e.clipId)) };

                    compiledCaptionProgram = compileCaptionProgram(drawtextProgram, {
                        tmpDir,
                        escapePath: (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:'),
                        fallbackFontPath,
                        resolveFont: (family) => (family && FAMILY_PATHS[family]) ? FAMILY_PATHS[family] : null,
                    });

                    for (const entry of rawCaptionProgram.entries) programClipIds.add(entry.clipId);
                    if (compiledCaptionProgram.skipped.length > 0) {
                        captionProgramWarning = `${compiledCaptionProgram.skipped.length} animated caption(s) fell back to plain rendering (font unresolved).`;
                    }
                    // Font substitutions on THIS path used to be completely silent —
                    // see the comment on compileCaptionProgram's return shape in
                    // server/compositor/CaptionCompiler.js. Feed them into the SAME
                    // `fontFallbackWarnings` set the static per-clip loop below
                    // already populates, so both rendering paths report through the
                    // one unified `captionWarning` field instead of the static path
                    // being the only one honest about a substitution happening.
                    for (const { requestedFamily } of (compiledCaptionProgram.fontFallbacks || [])) {
                        fontFallbackWarnings.add(
                            FONT_SPECS[requestedFamily]
                                ? `"${requestedFamily}" (download failed — see [fonts] log above)`
                                : `"${requestedFamily}" (unknown font — not in FONT_SPECS)`
                        );
                    }
                    console.log(`🎬 [ExportJob ${job.id}] animated captions: ${rawCaptionProgram.entries.length} clip(s), ${compiledCaptionProgram.filters.length} filter(s)`);
                } catch (progErr) {
                    captionProgramWarning = `Animated captions could not be rendered — exported with plain static captions instead: ${progErr.message}`;
                    console.warn(`[ExportJob ${job.id}] caption program failed (falling back to static captions):`, progErr.message);
                    programClipIds.clear();
                    compiledCaptionProgram = { filters: [], tempFiles: [], skipped: [] };
                    rasterPrepared = null;
                    rasterProgramEntries = [];
                }
            }

            for (const track of textTracks) {
                for (const clip of track.clips) {
                    if (programClipIds.has(clip.id)) continue; // rendered by the compiled program instead
                    const rawText    = clip.content || clip.name || '';
                    // Convert Vibed timeline positions to output video positions.
                    const vibedStart = typeof clip.start    === 'number' ? clip.start    : 0;
                    const vibedDur   = typeof clip.duration === 'number' ? clip.duration : 3;
                    const startSec   = Math.max(0, vibedToOutputTime(vibedStart));
                    const endSec     = vibedToOutputTime(vibedStart + vibedDur);

                    if (endSec <= startSec) continue; // skip zero/negative duration or out-of-range

                    // Write the caption text to a temp file — no escaping needed
                    const textFilePath = path.join(tmpDir, `cap-${filterIdx}.txt`);
                    fs.writeFileSync(textFilePath, rawText, 'utf8');
                    // Escape the file path for the drawtext option (only : needs escaping)
                    const escapedTextFile = textFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');

                    // Font: prefer the clip's declared fontFamily, fall back to default
                    const declaredFamily = clip.fontFamily;
                    const familyPath = declaredFamily && FAMILY_PATHS[declaredFamily]
                        ? FAMILY_PATHS[declaredFamily]
                        : null;
                    const familyResolved = !!(familyPath && fs.existsSync(familyPath));
                    const resolvedFont = familyResolved ? familyPath : fallbackFontPath;
                    // Track silent substitutions: the user asked for a specific font
                    // and it couldn't be resolved — either it's missing from
                    // FONT_SPECS entirely, or it IS registered but the file never
                    // downloaded successfully.
                    //
                    // IMPORTANT: this used to skip warning when declaredFamily was
                    // 'Anton', on the assumption "Anton is the fallback anyway, so
                    // Anton-requests-Anton is never a substitution." That's true only
                    // when Anton's OWN file actually resolves. If Anton's file is
                    // missing too (e.g. a fresh deployment before fonts finish baking/
                    // downloading), resolvedFont falls further down fallbackFontPath
                    // to Roboto/DejaVu/system fonts — a real substitution that the
                    // Anton exclusion was hiding with zero warning. Captions rendered
                    // in a plain system font instead of Anton, silently, on every
                    // export, until this was removed.
                    if (declaredFamily && !familyResolved) {
                        fontFallbackWarnings.add(
                            FONT_SPECS[declaredFamily]
                                ? `"${declaredFamily}" (download failed — see [fonts] log above)`
                                : `"${declaredFamily}" (unknown font — not in FONT_SPECS)`
                        );
                    }
                    const escapedFont = resolvedFont.replace(/\\/g, '/').replace(/:/g, '\\:');

                    // Vibed caption defaults must match addCaptionClips defaults
                    // (#FACC15 yellow + Anton 48 — not plain white Roboto).
                    const color    = (clip.color || '#FACC15').replace('#', '0x');
                    // clip.scale is the pinch-to-resize/drag-handle factor applied in
                    // the live preview (TextOverlay.jsx: `transform: scale(${clip.scale
                    // || 1})` on top of `fontSize * previewScale`). The export never
                    // read it, so a caption the user visibly enlarged in the editor
                    // (e.g. to fill ~1/8 of the frame height) burned in at its raw,
                    // un-resized base fontSize — tiny relative to what the preview
                    // showed. previewScale itself is resolution-normalizing and cancels
                    // out here since drawtext already renders at the true output
                    // resolution, so `fontSize * clip.scale` is the correct export-side
                    // equivalent.
                    const size     = Math.round((clip.fontSize || 48) * (clip.scale || 1) * captionScaleFactor);

                    // IMPORTANT: clip.x/clip.y are 0-100 PERCENTAGES of the frame,
                    // representing where the CENTER of the text box sits — this is
                    // exactly what client/src/components/Player/TextOverlay.jsx uses
                    // for the live preview: `left:${clip.x}%; top:${clip.y}%` plus
                    // `transform: translate(-50%,-50%)` to center the box on that
                    // point. This used to be treated as a raw pixel offset added to
                    // targetWidth/2 (`Math.round(clip.x + targetWidth/2)`), which was
                    // wrong on two counts: wrong unit (percent vs pixels) and it threw
                    // away the text_w/text_h centering term entirely, so drawtext's
                    // x= (which is the text box's LEFT edge, not its center) landed
                    // far past where the text should start — pushing captions off the
                    // right/bottom edge of the frame, worse the wider the text. The
                    // fix mirrors the preview's math as an ffmpeg eval expression so
                    // exported captions land exactly where the editor showed them.
                    let x = '(w-text_w)/2';
                    let y = '(h-text_h)/2';
                    if (clip.position === 'bottom') y = 'h*0.85-text_h/2';
                    if (clip.position === 'top')    y = 'h*0.12-text_h/2';
                    if (typeof clip.x === 'number') x = `(${(clip.x / 100).toFixed(6)})*w-text_w/2`;
                    if (typeof clip.y === 'number') y = `(${(clip.y / 100).toFixed(6)})*h-text_h/2`;

                    // Stroke (border) — maps directly to drawtext borderw / bordercolor.
                    // Default matches addCaptionClips: 2px black outline.
                    // Same clip.scale correction as fontSize above — the preview's
                    // CSS scale() visually scales the stroke along with the glyphs.
                    const strokeWidth = Math.round((clip.stroke?.width ?? 2) * (clip.scale || 1) * captionScaleFactor);
                    const strokeColor = (clip.stroke?.color || '#000000').replace('#', '0x');
                    const strokePart  = strokeWidth > 0
                        ? `:borderw=${strokeWidth}:bordercolor=${strokeColor}`
                        : '';

                    textFilters.push(
                        `drawtext=fontfile='${escapedFont}'` +
                        `:textfile='${escapedTextFile}'` +
                        `:fontsize=${size}:fontcolor=${color}` +
                        `:x=${x}:y=${y}` +
                        strokePart +
                        `:enable='gte(t,${startSec})*lte(t,${endSec})'`
                    );
                    filterIdx++;
                }
            }

            // Splice in the animated-caption filters built above, appended
            // AFTER every static filter. Each drawtext is `enable`-gated to
            // its own window, so this is correct for the overwhelmingly
            // common case (one caption visible at a time). KNOWN LIMIT: if a
            // project has a STATIC caption on one track overlapping in time
            // with an ANIMATED caption on another, the animated one always
            // draws on top regardless of track order — this reorders relative
            // to the original per-track/per-clip interleaving the static-only
            // path used. Narrow edge case (multiple simultaneous overlapping
            // caption tracks are themselves unusual); stated here rather than
            // left to be discovered.
            textFilters.push(...compiledCaptionProgram.filters);

            if (textFilters.length > 0) {
                const textOverlayPath = path.join(tmpDir, 'with_text.mp4');
                // Join filters with comma; each drawtext is one element in the vf chain.
                // Note: commas inside individual filter options are already inside
                // single-quoted strings so they don't act as filter separators.
                const vfChain = textFilters.join(',');
                // A project with many animated caption clips (per-word reveal
                // effects generate ~10 drawtext filters per clip) can produce a
                // vf chain hundreds of KB long. Passing that as a single argv
                // entry to spawn() blows past the OS's combined argv+environ
                // limit (ARG_MAX) and spawn() fails with `spawn E2BIG` before
                // ffmpeg even starts — this is why captions silently went
                // missing on exports with many caption clips (41 clips / 402
                // filters in the reported case). Fix: write the filtergraph to
                // a file and point ffmpeg at it with -filter_script:v, which
                // takes the same syntax as -vf but reads it from disk instead
                // of the command line, so the argv stays tiny regardless of
                // how many filters are chained.
                const filterScriptPath = path.join(tmpDir, 'caption_filters.txt');
                fs.writeFileSync(filterScriptPath, vfChain, 'utf-8');
                const drawtextArgs = [
                    '-i',  finalVideoPath,
                    '-filter_script:v', filterScriptPath,
                    '-map', '0:v',
                    '-map', '0:a?',
                    '-c:v', codec,
                    '-b:v', videoBitrate,  // preserve quality on caption re-encode
                    '-profile:v', profile,
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'copy',
                    '-y',
                    textOverlayPath,
                ];
                console.log(`  🔤 Applying ${textFilters.length} caption(s) with ${DRAWTEXT_BIN === ffmpegPath ? 'static' : 'system'} ffmpeg`);
                try {
                    await new Promise((resolve, reject) => {
                        const proc = spawn(DRAWTEXT_BIN, drawtextArgs);
                        const stderrChunks = [];
                        proc.stderr.on('data', chunk => stderrChunks.push(chunk));
                        proc.on('error', reject);
                        proc.on('close', code => {
                            if (code === 0) {
                                resolve();
                            } else {
                                const errTail = Buffer.concat(stderrChunks).toString('utf-8').slice(-1200);
                                reject(new Error(`ffmpeg drawtext exited ${code}:\n${errTail}`));
                            }
                        });
                    });
                    finalVideoPath = textOverlayPath;
                    console.log('  ✅ Text overlays applied');
                } catch (textErr) {
                    captionError = textErr.message.slice(0, 800);
                    console.error(`  ❌ Text overlay failed — captions missing:\n${textErr.message}`);
                    // Deliver the video without captions rather than failing the
                    // whole job.  The error is surfaced in the job result so the
                    // client can show a toast ("Video exported, but captions failed").
                }
            }

            // ── R88: raster captions (rotation / word highlight / emphasis) ──
            // One extra pass, only when such captions exist, so every other
            // project renders exactly as before. FAILS OPEN: if the overlay
            // pass fails, the same entries are drawn as plain animated text
            // with the R63 drawtext compiler, so the words are never lost.
            if (rasterPrepared && rasterPrepared.items.length > 0) {
                const { compileRasterOverlays } = require('../server/compositor/RasterCaptionCompiler.js');
                const rasterOutPath = path.join(tmpDir, 'with_raster_captions.mp4');
                try {
                    const graph = compileRasterOverlays(rasterPrepared.items, {
                        frameWidth: targetWidth, frameHeight: targetHeight, fps: targetFps,
                    });
                    if (!graph) throw new Error('nothing to draw');
                    const graphPath = path.join(tmpDir, 'raster_caption_graph.txt');
                    fs.writeFileSync(graphPath, graph.filterComplex, 'utf-8');
                    const args = ['-i', finalVideoPath];
                    for (const inp of graph.inputs) args.push(...inp.inputOptions, '-i', inp.path);
                    args.push(
                        '-filter_complex_script', graphPath,
                        '-map', `[${graph.outputLabel}]`,
                        '-map', '0:a?',
                        '-c:v', codec,
                        '-b:v', videoBitrate,
                        '-profile:v', profile,
                        '-pix_fmt', 'yuv420p',
                        '-c:a', 'copy',
                        '-y',
                        rasterOutPath,
                    );
                    console.log(`  🖼️  Drawing ${rasterPrepared.items.length} raster caption(s)`);
                    await runFfmpegArgs(DRAWTEXT_BIN, args);
                    finalVideoPath = rasterOutPath;
                    console.log('  ✅ Raster captions applied');
                } catch (rasterErr) {
                    console.warn(`[ExportJob ${job.id}] raster caption pass failed, drawing them as text:`, rasterErr.message.slice(0, 600));
                    captionProgramWarning = 'Rotated/highlighted captions were exported as plain text.';
                    try {
                        const { compileCaptionProgram } = require('../server/compositor/CaptionCompiler.js');
                        const fallback = compileCaptionProgram({ version: rawCaptionProgram.version, entries: rasterProgramEntries }, {
                            tmpDir,
                            escapePath: (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:'),
                            fallbackFontPath,
                            resolveFont: (family) => (family && FAMILY_PATHS[family]) ? FAMILY_PATHS[family] : null,
                        });
                        if (fallback.filters.length > 0) {
                            const fbScript = path.join(tmpDir, 'raster_fallback_filters.txt');
                            fs.writeFileSync(fbScript, fallback.filters.join(','), 'utf-8');
                            const fbOut = path.join(tmpDir, 'with_raster_fallback.mp4');
                            await runFfmpegArgs(DRAWTEXT_BIN, [
                                '-i', finalVideoPath, '-filter_script:v', fbScript,
                                '-map', '0:v', '-map', '0:a?',
                                '-c:v', codec, '-b:v', videoBitrate, '-profile:v', profile,
                                '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-y', fbOut,
                            ]);
                            finalVideoPath = fbOut;
                        }
                    } catch (fbErr) {
                        captionError = `Some captions could not be drawn: ${fbErr.message.slice(0, 400)}`;
                        console.error(`  ❌ Raster caption fallback failed:`, fbErr.message.slice(0, 600));
                    }
                }
            }
        }
    }

    if (finalVideoPath !== outputPath) {
        fs.renameSync(finalVideoPath, outputPath);
    }

    // Report what was actually rendered, not what was asked for. The old
    // metadata echoed targetWidth x targetHeight, so a 1920x1080 file came
    // back labelled "1080x1920" and the wrong-shape bug was invisible.
    const renderedDims = await getVideoDimensions(outputPath);
    if (renderedDims && (renderedDims.width !== targetWidth || renderedDims.height !== targetHeight)) {
        console.warn(`  ⚠️  [ExportJob ${job.id}] rendered ${renderedDims.width}x${renderedDims.height}, expected ${targetWidth}x${targetHeight}`);
    }

    await job.updateProgress(90);

    // ── Upload to GCS or keep local ────────────────────────────────────────
    const filename = path.basename(outputPath);
    let resultUrl;

    if (gcsBucket) {
        // exports/<userId>/<projectId>/<file>: deleting the project (or the
        // retention job) can then remove its exports too (services/projectFiles.js).
        const projectFolder = /^[0-9a-f-]{8,64}$/i.test(String(settings.projectId || '')) ? `${settings.projectId}/` : '';
        const gcsDestPath = `exports/${userId}/${projectFolder}${filename}`;
        try {
            await gcsBucket.upload(outputPath, {
                destination: gcsDestPath,
                metadata: { contentType: 'video/mp4' },
            });
            // Remove local file after successful GCS upload
            fs.unlinkSync(outputPath);
            resultUrl = `/api/proxy/gcs-media/${gcsDestPath}`;
            console.log(`  ✅ Uploaded to GCS: ${gcsDestPath}`);
        } catch (uploadErr) {
            console.warn(`  ⚠️  GCS upload failed, falling back to local: ${uploadErr.message}`);
            resultUrl = `/uploads/exports/${filename}`;
        }
    } else {
        resultUrl = `/uploads/exports/${filename}`;
    }

    // ── Cleanup temp dir ───────────────────────────────────────────────────
    fs.rmSync(tmpDir, { recursive: true, force: true });

    await job.updateProgress(100);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const stats    = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
    const sizeMB   = stats ? (stats.size / 1024 / 1024).toFixed(1) : '?';

    console.log(`🏁 [ExportJob ${job.id}] Complete: ${sizeMB}MB in ${duration}s → ${resultUrl}`);

    // Combine drawtext failure (video has NO captions) with font-substitution
    // warnings (video has captions, but in the wrong font) into one field so
    // any future UI toast surfaces both without needing a second field wired up.
    let fontWarningMsg = null;
    if (fontFallbackWarnings.size > 0) {
        const list = [...fontFallbackWarnings].join(', ');
        fontWarningMsg = `Caption font fallback: ${list} — used the default font instead.`;
        console.warn(`  ⚠️  [ExportJob ${job.id}] ${fontWarningMsg}`);
    }
    const captionWarning = captionError || fontWarningMsg || undefined;

    return {
        success: true,
        url: resultUrl,
        filename,
        // Populated when the caption burn-in step failed outright (no captions
        // at all) OR when captions rendered but with a substituted font.
        captionWarning,
        // Populated when the overlay compositing pass (STEP 2.5) failed and the
        // video was exported WITHOUT its overlay layers. Surfaced rather than
        // swallowed: the export succeeded, but not as the user composed it, and
        // silently shipping a video missing its graphics is the failure mode
        // this codebase keeps rediscovering.
        compositorWarning: compositorWarning || undefined,
        // Populated when animated captions (R63) couldn't render — the export
        // still has captions (the static path never ran for those clips'
        // siblings, and on failure `programClipIds` is cleared so EVERY
        // caption falls back to the static path), just without their motion/
        // shadow/uppercase/reveal.
        captionProgramWarning: captionProgramWarning || undefined,
        // R69 — populated when Revideo compositing was attempted (useRevideo)
        // but failed: the export ships WITHOUT captions/motion-graphics/
        // stickers rather than silently falling back to the FFmpeg drawtext
        // path, so this is the one warning field that means "missing
        // entirely," not "missing some polish."
        revideoWarning: revideoWarning || undefined,
        metadata: {
            duration:   `${duration}s render time`,
            sizeMB:     parseFloat(sizeMB) || 0,
            resolution: renderedDims ? `${renderedDims.width}x${renderedDims.height}` : `${targetWidth}x${targetHeight}`,
            fps:        targetFps,
            codec,
            segments:   allClips.length,
            platform:   platform?.label || null,
        },
    };
};

module.exports.FONT_SPECS = FONT_SPECS;
// Pure helpers, exported for scripts/test_export_rotation_zoom.js.
module.exports.rotationFromProbeStream = rotationFromProbeStream;
module.exports.buildSmoothZoomFilter = buildSmoothZoomFilter;
module.exports.atempoChain = atempoChain;



