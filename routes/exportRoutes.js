const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const storageConfig = require('../config/storage');
const gcsBucket = storageConfig.bucket;

ffmpeg.setFfmpegPath(ffmpegPath);

// Returns true only for URLs that a server-side process can actually fetch.
// Blob URLs are client-only object references — useless outside the originating browser tab.
const isServerUsableUrl = (u) => u && !u.startsWith('blob:');

// Download a URL to a local file using axios streaming.
// Avoids ffmpeg-static HTTPS crashes when passing GCS signed URLs directly.
async function downloadToTemp(url, destPath) {
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 120000 });
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
}

// ============================================================================
// PLATFORM PRESETS
// ============================================================================

const PLATFORM_PRESETS = {
    tiktok: {
        label: 'TikTok',
        width: 1080, height: 1920,
        aspectRatio: '9:16',
        fps: 30,
        bitrate: '6000k',
        audioBitrate: '128k',
        maxDuration: 60,
        codec: 'libx264',
        profile: 'high',
        level: '4.0'
    },
    youtube: {
        label: 'YouTube',
        width: 1920, height: 1080,
        aspectRatio: '16:9',
        fps: 30,
        bitrate: '8000k',
        audioBitrate: '192k',
        maxDuration: null,
        codec: 'libx264',
        profile: 'high',
        level: '4.2'
    },
    reels: {
        label: 'Instagram Reels',
        width: 1080, height: 1920,
        aspectRatio: '9:16',
        fps: 30,
        bitrate: '5500k',
        audioBitrate: '128k',
        maxDuration: 90,
        codec: 'libx264',
        profile: 'high',
        level: '4.0'
    },
    shorts: {
        label: 'YouTube Shorts',
        width: 1080, height: 1920,
        aspectRatio: '9:16',
        fps: 60,
        bitrate: '6000k',
        audioBitrate: '192k',
        maxDuration: 60,
        codec: 'libx264',
        profile: 'high',
        level: '4.1'
    },
    custom: null  // Use user-provided settings
};

// ============================================================================
// RESOLUTION PRESETS
// ============================================================================

const RESOLUTION_PRESETS = {
    '720p':  { width: 1280, height: 720,  bitrate: '4000k' },
    '1080p': { width: 1920, height: 1080, bitrate: '8000k' },
    '2k':    { width: 2560, height: 1440, bitrate: '16000k' },
    '4k':    { width: 3840, height: 2160, bitrate: '35000k' }
};

// ============================================================================
// HELPERS
// ============================================================================

function resolveSourcePath(clip, uploadsDir) {
    if (clip.fsPath && fs.existsSync(clip.fsPath)) return clip.fsPath;
    const inUploads = path.join(uploadsDir, clip.name);
    if (fs.existsSync(inUploads)) return inUploads;
    return null;
}

function buildScaleFilter(width, height, aspectRatio) {
    // Pad to exact dimensions preserving aspect ratio
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

// ============================================================================
// POST /render — Full timeline export
// ============================================================================

const authMiddleware = process.env.NODE_ENV === 'production' ? authenticateUser : optionalAuth;

router.post('/', authMiddleware, async (req, res) => {
    const startTime = Date.now();
    try {
        const { timeline, settings = {} } = req.body;

        if (!timeline || !timeline.tracks) {
            return res.status(400).json({ error: 'Invalid timeline data' });
        }

        // Build an assetId→asset lookup from the assets array sent by the client.
        // Used to recover source URLs for segment clips whose url/sourceUrl were cleared.
        const sentAssets = Array.isArray(timeline.assets) ? timeline.assets : [];
        const assetMap = {};
        sentAssets.forEach(a => { if (a.id) assetMap[a.id] = a; });

        // --- resolve platform / resolution settings ---
        const platform = settings.platform && PLATFORM_PRESETS[settings.platform]
            ? PLATFORM_PRESETS[settings.platform]
            : null;

        const resPreset = RESOLUTION_PRESETS[settings.resolution] || RESOLUTION_PRESETS['1080p'];

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

        console.log(`🎬 Export: ${targetWidth}x${targetHeight} @ ${targetFps}fps | ${videoBitrate} | ${platform?.label || settings.resolution || '1080p'}`);

        // --- gather clips ---
        const videoTracks = timeline.tracks.filter(t =>
            (t.type === 'video' || t.type === 'image') && t.clips?.length > 0
        );
        const audioTracks = timeline.tracks.filter(t =>
            t.type === 'audio' && t.clips?.length > 0
        );

        if (videoTracks.length === 0) {
            return res.status(400).json({ error: 'No video or image clips found in timeline' });
        }

        const uploadsDir = path.join(__dirname, '../uploads/temp');
        const publicDir  = path.join(__dirname, '../client/public');
        const exportsDir = path.join(__dirname, '../uploads/exports');
        if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

        const jobId      = `render-${Date.now()}`;
        const outputPath = path.join(exportsDir, `${jobId}.mp4`);
        const tmpDir     = path.join(exportsDir, jobId);
        fs.mkdirSync(tmpDir, { recursive: true });

        // --- Collect all video/image clips across tracks, sorted by start time ---
        let allClips = [];
        for (const track of videoTracks) {
            for (const clip of track.clips) {
                allClips.push({ ...clip, trackVolume: track.volume ?? 1.0 });
            }
        }
        allClips.sort((a, b) => a.start - b.start);

        // --- Resolve and download clip sources ---
        const userId = req.user ? req.user.id : 'anonymous';
        const bucketName = process.env.GCS_BUCKET_NAME || 'viral-pilot_bucket';

        // Sanitize for GCS key matching — mirrors what the proxy upload route stores.
        // Spaces are replaced with underscores; other unsafe characters are stripped.
        const sanitizeFilename = (name) =>
            name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');

        // Extract the GCS object path from a storage.googleapis.com URL.
        const gcsPathFromStorageUrl = (url) => {
            if (!url || !url.startsWith(`https://storage.googleapis.com/${bucketName}/`)) return null;
            try {
                return decodeURIComponent(new URL(url).pathname.replace(`/${bucketName}/`, ''));
            } catch (_) { return null; }
        };

        // Extract the GCS object path from an /api/proxy/gcs-media/<path> proxy URL.
        // These are the URLs that AI-generated segment clips carry — the GCS path is
        // embedded directly in the proxy route.
        const gcsPathFromProxyUrl = (url) => {
            if (!url) return null;
            const match = url.match(/\/api\/proxy\/gcs-media\/([^?#]+)/);
            return match ? decodeURIComponent(match[1]) : null;
        };

        // Resolve the GCS object path (within the bucket) for a clip.
        // Returns the path string or null.
        const resolveGcsPath = async (clip) => {
            // If the clip's own URL fields are empty but it has an assetId, pull URLs
            // from the assets array the client sent (covers AI-generated segment clips
            // whose blob URLs were cleared on page reload).
            let effectiveClip = clip;
            if (clip.assetId && assetMap[clip.assetId]) {
                const asset = assetMap[clip.assetId];
                const hasUsableUrl = isServerUsableUrl(clip.sourceUrl) || isServerUsableUrl(clip.url) || isServerUsableUrl(clip.proxyUrl);
                if (!hasUsableUrl) {
                    effectiveClip = { ...clip, sourceUrl: asset.sourceUrl, url: asset.proxyUrl || asset.url, proxyUrl: asset.proxyUrl };
                    console.log(`[export] Recovered URLs for clip "${clip.name}" from asset ${clip.assetId}: sourceUrl=${asset.sourceUrl?.slice(0,60)}`);
                }
            }

            const candidates = [effectiveClip.sourceUrl, effectiveClip.url, effectiveClip.src, effectiveClip.videoUrl, effectiveClip.proxyUrl];

            // 1. Direct storage.googleapis.com URL — extract path.
            for (const raw of candidates) {
                const p = gcsPathFromStorageUrl(raw);
                if (p) { console.log(`[export] GCS path from storage URL: ${p}`); return p; }
            }

            // 2. Proxy URL (/api/proxy/gcs-media/<path>) — the path IS the GCS key.
            //    AI-generated segment clips carry the source video's proxy URL here.
            for (const raw of candidates) {
                const p = gcsPathFromProxyUrl(raw);
                if (p) { console.log(`[export] GCS path from proxy URL: ${p}`); return p; }
            }

            // 3. Fall back to matching by filename within the user's raw/ prefix.
            // Prefer originalName (preserved from baseClip before AI renamed it "Segment N").
            // Also try the asset's name if we have one from the asset map.
            const assetForClip = clip.assetId ? assetMap[clip.assetId] : null;
            const filename = effectiveClip.originalName || assetForClip?.name || effectiveClip.name || clip.name;
            if (!filename || !gcsBucket) {
                console.warn(`[export] No URL or filename for clip "${clip.name}" — fields:`,
                    JSON.stringify({ url: (clip.url||'').slice(0,80), sourceUrl: (clip.sourceUrl||'').slice(0,80), proxyUrl: (clip.proxyUrl||'').slice(0,80) }));
                return null;
            }
            // Try both the original filename (proxyRoutes stores originalname as-is, spaces
            // intact) AND the sanitized variant (analyzeRoutes renames files on upload).
            const safeName = sanitizeFilename(filename);
            const rawName  = filename; // may contain spaces — valid GCS object key

            // When the request has no authenticated user, try to recover the real userId
            // from a proxy URL embedded in the clip (e.g. /api/proxy/gcs-media/proxies/<userId>/...).
            let listUserId = userId;
            if (listUserId === 'anonymous') {
                const proxyUrls = [effectiveClip.proxyUrl, effectiveClip.url, effectiveClip.sourceUrl, clip.proxyUrl, clip.url, clip.sourceUrl];
                for (const raw of proxyUrls) {
                    const m = raw?.match(/\/api\/proxy\/gcs-media\/(?:proxies|raw)\/([^/]+)\//);
                    if (m) { listUserId = m[1]; break; }
                }
            }

            // Check exact paths — original first (covers filenames with spaces), then sanitized.
            for (const name of [rawName, safeName]) {
                if (!name) continue;
                const exactPath = `raw/${listUserId}/${name}`;
                try {
                    const [exists] = await gcsBucket.file(exactPath).exists();
                    if (exists) { console.log(`[export] GCS exact match: ${exactPath}`); return exactPath; }
                } catch (e) {
                    console.warn(`[export] GCS exists() error for "${exactPath}":`, e.message);
                }
            }

            try {
                const [files] = await gcsBucket.getFiles({ prefix: `raw/${listUserId}/` });
                const match = files.find(f => {
                    const base = f.name.split('/').pop();
                    return base === rawName || base === safeName
                        || base.endsWith(`-${rawName}`) || base.endsWith(`-${safeName}`);
                });
                if (match) { console.log(`[export] GCS listing match: ${match.name}`); return match.name; }
                console.warn(`[export] No GCS file matched "${rawName}" — available:`, files.map(f => f.name));
            } catch (e) {
                console.warn(`[export] GCS getFiles() error:`, e.message);
            }

            return null;
        };

        // Download a clip's source to a local temp file.
        // Prefers GCS SDK (authenticated) over HTTPS download.
        // Returns the local file path or null.
        const fetchClipSource = async (clip, localPath) => {
            // Enrich clip with asset URLs if its own URL fields are empty
            let c = clip;
            if (clip.assetId && assetMap[clip.assetId] && !(isServerUsableUrl(clip.sourceUrl) || isServerUsableUrl(clip.url) || isServerUsableUrl(clip.proxyUrl))) {
                const asset = assetMap[clip.assetId];
                c = { ...clip, sourceUrl: asset.sourceUrl, url: asset.proxyUrl || asset.url, proxyUrl: asset.proxyUrl };
                console.log(`[export] Recovered URLs for clip "${clip.name}" from asset ${clip.assetId}`);
            }

            // GCS SDK path: authenticated, works for private buckets, no URL issues.
            // Wrapped in try-catch so a transient GCS error falls through gracefully.
            if (gcsBucket) {
                const gcsPath = await resolveGcsPath(c);
                if (gcsPath) {
                    try {
                        console.log(`[export] Downloading from GCS SDK: ${gcsPath} → ${path.basename(localPath)}`);
                        await gcsBucket.file(gcsPath).download({ destination: localPath });
                        return localPath;
                    } catch (sdkErr) {
                        console.warn(`[export] GCS SDK download failed for "${gcsPath}": ${sdkErr.message} — trying HTTP fallback`);
                    }
                }
            }

            // Try local filesystem first (dev environment or recently uploaded files)
            const localSrc = resolveSourcePath(c, uploadsDir);
            if (localSrc) return localSrc;

            // HTTP fallback: for private GCS URLs generate a signed URL so the download
            // doesn't get a 403. Without a signed URL, unauthenticated requests to a
            // private bucket always fail. All other HTTPS URLs are downloaded as-is.
            for (const raw of [c.sourceUrl, c.url, c.src, c.videoUrl]) {
                if (!raw || raw.startsWith('blob:') || raw.includes('/api/proxy') || !raw.startsWith('http')) continue;

                let safeUrl = raw;
                try {
                    // Re-encode path segments so filenames with spaces don't break axios.
                    const parsed = new URL(raw);
                    parsed.pathname = parsed.pathname.split('/').map(seg => encodeURIComponent(decodeURIComponent(seg))).join('/');
                    safeUrl = parsed.toString();
                } catch (_) { /* leave raw as-is */ }

                // For direct storage.googleapis.com URLs, swap in a short-lived signed URL
                // so the download works even when the bucket is private.
                if (gcsBucket && safeUrl.includes('storage.googleapis.com')) {
                    try {
                        const signedGcsPath = gcsPathFromStorageUrl(safeUrl);
                        if (signedGcsPath) {
                            const [signedUrl] = await gcsBucket.file(signedGcsPath).getSignedUrl({
                                version: 'v4',
                                action:  'read',
                                expires: Date.now() + 3_600_000, // 1 hour
                            });
                            safeUrl = signedUrl;
                            console.log(`[export] Signed GCS URL generated for "${signedGcsPath}"`);
                        }
                    } catch (signErr) {
                        console.warn(`[export] Could not sign GCS URL: ${signErr.message} — downloading unsigned (may 403)`);
                    }
                }

                console.log(`[export] HTTP download: ${safeUrl.slice(0, 80)}`);
                try {
                    await downloadToTemp(safeUrl, localPath);
                    return localPath;
                } catch (dlErr) {
                    console.warn(`[export] HTTP download failed for clip "${clip.name}": ${dlErr.message}`);
                    // Continue to next URL candidate rather than crashing the whole render.
                }
            }

            console.warn(`[export] Cannot resolve source for clip "${clip.name}" (userId=${userId}) — clip fields:`,
                JSON.stringify({ url: (clip.url||'').slice(0,100), sourceUrl: (clip.sourceUrl||'').slice(0,100), proxyUrl: (clip.proxyUrl||'').slice(0,100), name: clip.name }));
            return null;
        };

        const scaleFilter = buildScaleFilter(targetWidth, targetHeight);

        // --- STEP 1: Trim each clip into a temp segment ---
        const segments = [];
        for (let i = 0; i < allClips.length; i++) {
            const clip = allClips[i];
            const ext = path.extname(clip.name || '.mp4') || '.mp4';
            const dlPath = path.join(tmpDir, `dl-${i}${ext}`);
            const src = await fetchClipSource(clip, dlPath);
            if (!src) {
                console.warn(`⚠️  Could not find source for clip "${clip.name}", skipping`);
                continue;
            }

            const segPath = path.join(tmpDir, `seg-${i}.mp4`);
            const inPoint = clip.offset || 0;
            const dur     = clip.duration;
            const vol     = (clip.volume ?? 1.0) * (clip.trackVolume ?? 1.0);
            const speed   = clip.speed || 1.0;
            const isImage = clip.type === 'image';

            await new Promise((resolve, reject) => {
                let cmd;
                if (isImage) {
                    // Images need -loop 1 so ffmpeg generates video frames for the full duration
                    cmd = ffmpeg()
                        .input(src)
                        .inputOptions(['-loop', '1'])
                        .setDuration(dur / speed);
                } else {
                    cmd = ffmpeg(src)
                        .setStartTime(inPoint)
                        .setDuration(dur / speed);
                }

                const vFilters = [scaleFilter];
                const aFilters = [];

                if (speed !== 1.0) {
                    vFilters.push(`setpts=${(1/speed).toFixed(4)}*PTS`);
                    if (!isImage) {
                        const aTempo = Math.min(Math.max(speed, 0.5), 2.0);
                        aFilters.push(`atempo=${aTempo.toFixed(4)}`);
                    }
                }
                if (!isImage && vol !== 1.0) aFilters.push(`volume=${vol.toFixed(4)}`);

                cmd.videoFilters(vFilters.join(','));

                if (isImage) {
                    // Generate a silent audio track so all segments have the same streams,
                    // which is required for the concat step.
                    cmd
                        .input(`anullsrc=channel_layout=stereo:sample_rate=44100`)
                        .inputOptions(['-f', 'lavfi']);
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
                    .on('start', (cmdLine) => console.log(`  [ffmpeg] ${cmdLine.slice(0, 120)}...`))
                    .on('stderr', (line) => { if (line.includes('Error') || line.includes('error')) console.warn(`  [ffmpeg stderr] ${line}`); })
                    .on('end', () => { segments.push(segPath); resolve(); })
                    .on('error', (err, stdout, stderr) => {
                        console.error(`  ❌ ffmpeg failed for clip ${i+1}: ${err.message}`);
                        if (stderr) console.error(`  [ffmpeg stderr]\n${stderr.slice(-2000)}`);
                        reject(err);
                    })
                    .run();
            });
            console.log(`  ✅ Segment ${i+1}/${allClips.length}: "${clip.name}"`);
        }

        if (segments.length === 0) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            return res.status(400).json({ error: 'No valid clips could be processed' });
        }

        // --- STEP 2: Concatenate segments ---
        let finalVideoPath = outputPath;
        if (segments.length === 1) {
            // Single clip — rename directly
            fs.renameSync(segments[0], outputPath);
        } else {
            // Build concat list file
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

        // --- STEP 3: Mix in dedicated audio tracks (if any) ---
        if (audioTracks.length > 0) {
            const audioSegments = [];
            for (let i = 0; i < audioTracks.length; i++) {
                const track = audioTracks[i];
                for (let j = 0; j < track.clips.length; j++) {
                    const clip = track.clips[j];
                    const ext = path.extname(clip.name || '.mp3') || '.mp3';
                    const aDlPath = path.join(tmpDir, `adl-${i}-${j}${ext}`);
                    const src = await fetchClipSource(clip, aDlPath);
                    if (!src) continue;
                    const aSegPath = path.join(tmpDir, `audio-${i}-${j}.aac`);
                    const vol = (clip.volume ?? 1.0) * (track.volume ?? 1.0);
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

                    // amix: mix all audio tracks together
                    const amixInputs = 1 + audioSegments.length;
                    const filterComplex = `[0:a]volume=1[va];` +
                        audioSegments.map((seg, i) => `[${i+1}:a]adelay=${Math.round(seg.startTime * 1000)}|${Math.round(seg.startTime * 1000)}[da${i}]`).join(';') +
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

        // --- STEP 4: Add Text Overlays (drawtext) ---
        const textTracks = timeline.tracks.filter(t => 
            t.type === 'text' && t.clips?.length > 0
        );

        const defaultFontPath = path.join(publicDir, 'fonts', 'Roboto-Regular.ttf');

        const fontPath = fs.existsSync(defaultFontPath)
            ? defaultFontPath
            : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
               '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
               '/System/Library/Fonts/Helvetica.ttc'].find(p => fs.existsSync(p)) || null;

        const textFilters = [];
        for (const track of textTracks) {
            for (const clip of track.clips) {
                if (!fontPath) break;
                const startSec = clip.start;
                const endSec   = clip.start + clip.duration;
                // Escape text for FFmpeg drawtext: backslash → \\, ' → \', : → \:, % → %%
                const text = (clip.content || clip.name || '')
                    .replace(/\\/g, '\\\\')
                    .replace(/'/g, "\\'")
                    .replace(/:/g, '\\:')
                    .replace(/%/g, '%%');
                const color = (clip.color || '#ffffff').replace('#', '0x');
                const size  = clip.fontSize || 48;

                let x = '(w-text_w)/2';
                let y = '(h-text_h)/2';
                if (clip.position === 'bottom') y = 'h-text_h-80';
                if (clip.position === 'top')    y = '80';
                if (typeof clip.x === 'number') x = clip.x + (targetWidth / 2);
                if (typeof clip.y === 'number') y = clip.y + (targetHeight / 2);

                // Single quotes protect the commas inside gte()/lte() from FFmpeg's
                // filtergraph comma-splitter. Inside single quotes backslash is literal,
                // so we must NOT escape the commas — plain commas work correctly here.
                textFilters.push(
                    `drawtext=fontfile='${fontPath.replace(/\\/g, '/').replace(/:/g, '\\:')}':text='${text}':fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}:enable='gte(t,${startSec})*lte(t,${endSec})'`
                );
            }
        }

        if (textFilters.length > 0) {
            const textOverlayPath = path.join(tmpDir, 'with_text.mp4');
            try {
                await new Promise((resolve, reject) => {
                    const vfString = textFilters.join(',');
                    ffmpeg(finalVideoPath)
                        // addOutputOption bypasses fluent-ffmpeg's comma-splitting of -vf values
                        .addOutputOption('-vf', vfString)
                        .videoCodec(codec)
                        .audioCodec('copy')
                        .output(textOverlayPath)
                        .on('end', () => { finalVideoPath = textOverlayPath; resolve(); })
                        .on('error', reject)
                        .run();
                });
                console.log('  ✅ Text overlays applied');
            } catch (textErr) {
                console.warn(`  ⚠️  Text overlay failed (skipping): ${textErr.message}`);
            }
        } else if (textTracks.length > 0 && !fontPath) {
            console.warn('  ⚠️  No font file found — text overlays skipped');
        }

        // --- Final move if needed ---
        if (finalVideoPath !== outputPath) {
            fs.renameSync(finalVideoPath, outputPath);
        }

        // --- Cleanup tmp dir ---
        fs.rmSync(tmpDir, { recursive: true, force: true });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const stats = fs.statSync(outputPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

        console.log(`🏁 Export complete: ${sizeMB}MB in ${duration}s`);

        const filename = path.basename(outputPath);
        res.json({
            success: true,
            url: `/uploads/exports/${filename}`,
            filename,
            metadata: {
                duration: `${duration}s render time`,
                sizeMB: parseFloat(sizeMB),
                resolution: `${targetWidth}x${targetHeight}`,
                fps: targetFps,
                codec,
                segments: allClips.length,
                platform: platform?.label || null
            }
        });

    } catch (error) {
        console.error('❌ Render Execution Failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /presets — Return platform and resolution presets for the frontend
// ============================================================================

router.get('/presets', (req, res) => {
    res.json({
        platforms: Object.entries(PLATFORM_PRESETS)
            .filter(([k, v]) => v !== null)
            .map(([key, preset]) => ({
                id: key,
                label: preset.label,
                aspectRatio: preset.aspectRatio,
                resolution: `${preset.width}x${preset.height}`,
                fps: preset.fps,
                maxDuration: preset.maxDuration
            })),
        resolutions: Object.entries(RESOLUTION_PRESETS).map(([key, preset]) => ({
            id: key,
            label: key.toUpperCase(),
            width: preset.width,
            height: preset.height,
            bitrate: preset.bitrate
        }))
    });
});

module.exports = router;
