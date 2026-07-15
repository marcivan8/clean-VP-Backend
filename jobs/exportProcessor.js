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
// ─────────────────────────────────────────────────────────────────────────────

const gcsBucket = storageConfig.bucket;

// ─── Helpers (mirrors exportRoutes.js) ───────────────────────────────────────

const isServerUsableUrl = (u) => u && !u.startsWith('blob:');

async function downloadToTemp(url, destPath) {
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 120_000 });
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
 * Probe a video file and return its stored rotation in degrees (0, 90, 180, 270).
 * Phone-recorded portrait videos are often stored as landscape with a rotate=90
 * metadata tag. We need to correct for this before applying the scale filter,
 * otherwise the dimensions are swapped and the video ends up tiny with black bars.
 */
function getVideoRotation(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) { resolve(0); return; }
            const vStream = (metadata?.streams || []).find(s => s.codec_type === 'video');
            if (!vStream) { resolve(0); return; }
            // Old-style: stream.tags.rotate (e.g. "90")
            const tagRotate = parseInt(vStream?.tags?.rotate || 0, 10);
            if (tagRotate) { resolve(tagRotate); return; }
            // New-style: side_data_list with a Display Matrix entry
            const sd = (vStream?.side_data_list || []).find(d =>
                d.side_data_type === 'Display Matrix' || d.rotation !== undefined
            );
            if (sd?.rotation !== undefined) {
                // FFmpeg reports the stored rotation as a negative angle (e.g. -90 for CW 90°)
                resolve(((-sd.rotation) % 360 + 360) % 360);
            } else {
                resolve(0);
            }
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
};

/**
 * Download a font TTF to `destPath` if not already present.
 * Primary:  jsDelivr CDN (@fontsource v4) — reliable, no rate limits, no UA tricks.
 *           Tries latin subset first, falls back to 'all' subset.
 * Fallback: Google Fonts CSS1 API with legacy UA (returns TTF for old browsers).
 *           Does NOT use encodeURIComponent on the full name — encodes the space
 *           as '+' and passes weight as ':700' (not '%3A700') so the API parses it.
 */
async function downloadFont(destPath, spec) {
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 5_000) return;
    const { slug, weight, subset = 'latin' } = spec;

    // ── Primary: jsDelivr ────────────────────────────────────────────────────
    for (const sub of [subset, 'all']) {
        const url = `https://cdn.jsdelivr.net/npm/@fontsource/${slug}@4/files/${slug}-${sub}-${weight}-normal.ttf`;
        try {
            const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 20_000,
                validateStatus: s => s === 200 });
            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(destPath);
                response.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            if (fs.existsSync(destPath) && fs.statSync(destPath).size > 5_000) {
                console.log(`[fonts] ✓ ${path.basename(destPath)} (jsDelivr ${sub})`);
                return;
            }
            fs.existsSync(destPath) && fs.unlinkSync(destPath);
        } catch { /* try next */ }
    }

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

// ─── Main job handler ─────────────────────────────────────────────────────────

module.exports = async function processExportJob(job) {
    const startTime = Date.now();
    const { timeline, settings = {}, userId = 'anonymous', assetMap = {} } = job.data;

    await job.updateProgress(2);

    // ── Resolve platform / resolution settings ─────────────────────────────
    const platform   = settings.platform && PLATFORM_PRESETS[settings.platform] ? PLATFORM_PRESETS[settings.platform] : null;
    const resPreset  = RESOLUTION_PRESETS[settings.resolution] || RESOLUTION_PRESETS['1080p'];

    const targetWidth  = platform?.width  || resPreset.width;
    const targetHeight = platform?.height || resPreset.height;
    const targetFps    = platform?.fps    || settings.fps    || 30;
    const codec        = platform?.codec  || 'libx264';
    const profile      = platform?.profile || 'high';

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
                await downloadToTemp(fullUrl, localPath);
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

    await job.updateProgress(5);

    // ── STEP 1: Trim each clip into a segment ──────────────────────────────
    const segments = [];
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
        const dur     = clip.duration;
        const vol     = (clip.volume ?? 1.0) * (clip.trackVolume ?? 1.0);
        const speed   = clip.speed || 1.0;
        const isImage = clip.type === 'image';

        // Probe rotation BEFORE we build the filter chain.
        // Phones store portrait clips as landscape + rotate=90 metadata. When
        // we add a -vf filter chain, FFmpeg's automatic display-matrix rotation
        // can be suppressed, so we detect and correct it explicitly.
        const rotation = isImage ? 0 : await getVideoRotation(src);

        await new Promise((resolve, reject) => {
            let cmd;
            if (isImage) {
                cmd = ffmpeg().input(src).inputOptions(['-loop', '1']).setDuration(dur / speed);
            } else {
                // -noautorotate disables FFmpeg's implicit rotation so we can
                // handle it ourselves in the filter chain (avoids double-rotate).
                cmd = ffmpeg(src)
                    .inputOptions(['-noautorotate'])
                    .setStartTime(inPoint)
                    .setDuration(dur / speed);
            }

            // Build rotation-correction filter.
            // rotate=90 (phone portrait stored as landscape CW) → transpose=1 (CW 90°)
            // rotate=270 (stored landscape CCW)                 → transpose=2 (CCW 90°)
            // rotate=180                                        → hflip,vflip
            let correctionFilters = [];
            if      (rotation === 90)                  correctionFilters = ['transpose=1'];
            else if (rotation === 270 || rotation === -90) correctionFilters = ['transpose=2'];
            else if (rotation === 180)                 correctionFilters = ['hflip', 'vflip'];

            const vFilters = [...correctionFilters, scaleFilter];
            const aFilters = [];

            if (speed !== 1.0) {
                vFilters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
                if (!isImage) {
                    const aTempo = Math.min(Math.max(speed, 0.5), 2.0);
                    aFilters.push(`atempo=${aTempo.toFixed(4)}`);
                }
            }
            if (!isImage && vol !== 1.0) aFilters.push(`volume=${vol.toFixed(4)}`);

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
                .on('end', () => { segments.push(segPath); resolve(); })
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
                    ffmpeg(src)
                        .setStartTime(clip.offset || 0)
                        .setDuration(clip.duration)
                        .audioFilters(`volume=${vol.toFixed(4)}`)
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

    // ── STEP 4: Text overlays ──────────────────────────────────────────────
    const textTracks = timeline.tracks.filter(t => t.type === 'text' && t.clips?.length > 0);

    if (textTracks.length > 0) {
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
            // ── Build drawtext filter chain ────────────────────────────────
            // IMPORTANT: Use textfile= (not text=) so ffmpeg reads text from a file.
            // This completely avoids ffmpeg filter-string escaping issues — apostrophes,
            // commas, colons, quotes, etc. in caption text all work transparently.
            const textFilters = [];
            let filterIdx = 0;

            for (const track of textTracks) {
                for (const clip of track.clips) {
                    const rawText  = clip.content || clip.name || '';
                    const startSec = typeof clip.start    === 'number' ? clip.start    : 0;
                    const endSec   = typeof clip.duration === 'number'
                        ? startSec + clip.duration
                        : startSec + 3;

                    if (endSec <= startSec) continue; // skip zero/negative duration

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
                    const resolvedFont = (familyPath && fs.existsSync(familyPath))
                        ? familyPath
                        : fallbackFontPath;
                    const escapedFont = resolvedFont.replace(/\\/g, '/').replace(/:/g, '\\:');

                    // Vibed caption defaults must match addCaptionClips defaults
                    // (#FACC15 yellow + Anton 48 — not plain white Roboto).
                    const color    = (clip.color || '#FACC15').replace('#', '0x');
                    const size     = clip.fontSize || 48;

                    let x = '(w-text_w)/2';
                    let y = '(h-text_h)/2';
                    if (clip.position === 'bottom') y = 'h-text_h-80';
                    if (clip.position === 'top')    y = '80';
                    if (typeof clip.x === 'number') x = Math.round(clip.x + targetWidth  / 2);
                    if (typeof clip.y === 'number') y = Math.round(clip.y + targetHeight / 2);

                    // Stroke (border) — maps directly to drawtext borderw / bordercolor.
                    // Default matches addCaptionClips: 2px black outline.
                    const strokeWidth = clip.stroke?.width ?? 2;
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

            if (textFilters.length > 0) {
                const textOverlayPath = path.join(tmpDir, 'with_text.mp4');
                // Join filters with comma; each drawtext is one element in the vf chain.
                // Note: commas inside individual filter options are already inside
                // single-quoted strings so they don't act as filter separators.
                const vfChain = textFilters.join(',');
                const drawtextArgs = [
                    '-i',  finalVideoPath,
                    '-vf', vfChain,
                    '-map', '0:v',
                    '-map', '0:a?',
                    '-c:v', codec,
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
                    // Log the full error — this used to silently skip captions.
                    // Now the error is visible in worker logs to aid debugging.
                    console.error(`  ❌ Text overlay failed — captions will be missing:\n${textErr.message}`);
                    // Swallow: we still deliver the video without captions rather than
                    // failing the whole export job over a text-rendering issue.
                }
            }
        }
    }

    if (finalVideoPath !== outputPath) {
        fs.renameSync(finalVideoPath, outputPath);
    }

    await job.updateProgress(90);

    // ── Upload to GCS or keep local ────────────────────────────────────────
    const filename = path.basename(outputPath);
    let resultUrl;

    if (gcsBucket) {
        const gcsDestPath = `exports/${userId}/${filename}`;
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

    return {
        success: true,
        url: resultUrl,
        filename,
        metadata: {
            duration:   `${duration}s render time`,
            sizeMB:     parseFloat(sizeMB) || 0,
            resolution: `${targetWidth}x${targetHeight}`,
            fps:        targetFps,
            codec,
            segments:   allClips.length,
            platform:   platform?.label || null,
        },
    };
};
