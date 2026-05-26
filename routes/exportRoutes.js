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

function resolveSourcePath(clip, uploadsDir, publicDir) {
    if (clip.fsPath && fs.existsSync(clip.fsPath)) return clip.fsPath;
    const inUploads = path.join(uploadsDir, clip.name);
    if (fs.existsSync(inUploads)) return inUploads;
    const inPublic = path.join(publicDir, clip.name);
    if (fs.existsSync(inPublic)) return inPublic;
    // fallback demo
    const sample = path.join(publicDir, 'sample.mp4');
    if (fs.existsSync(sample)) return sample;
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

        // --- Resolve GCS URLs for all clips ---
        const userId = req.user ? req.user.id : 'anonymous';
        const bucketName = process.env.GCS_BUCKET_NAME || 'viral-pilot_bucket';

        // Sanitize filename the same way the upload routes do.
        const sanitizeFilename = (name) =>
            name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');

        // Resolve the raw GCS URL for a clip.
        // Clips stored in the timeline may only have a blob: URL or a proxy URL — we
        // need the underlying GCS raw file.  Strategy:
        //   1. Use clip.sourceUrl / url if it already points to storage.googleapis.com
        //   2. Fall back to searching GCS for raw/${userId}/<name> (handles both
        //      sanitized exact match and timestamp-prefixed uploads)
        const resolveGcsUrl = async (clip) => {
            const candidates = [clip.sourceUrl, clip.url, clip.src, clip.videoUrl];
            for (const raw of candidates) {
                if (raw && raw !== '' && !raw.startsWith('blob:') && !raw.startsWith('/api/')) {
                    return raw; // already an absolute URL pointing to real storage
                }
            }

            const filename = clip.name || clip.originalName;
            if (!filename) return undefined;
            const safeName = sanitizeFilename(filename);

            if (gcsBucket) {
                // Try exact sanitized path first (legacy upload stores files here)
                const exactPath = `raw/${userId}/${safeName}`;
                try {
                    const [exists] = await gcsBucket.file(exactPath).exists();
                    if (exists) return `https://storage.googleapis.com/${bucketName}/${exactPath}`;
                } catch (_) {}

                // Scan for a timestamp-prefixed file (direct-to-GCS uploads)
                try {
                    const [files] = await gcsBucket.getFiles({ prefix: `raw/${userId}/` });
                    const match = files.find(f => {
                        const base = f.name.split('/').pop();
                        return base === safeName || base.endsWith(`-${safeName}`);
                    });
                    if (match) return `https://storage.googleapis.com/${bucketName}/${match.name}`;
                } catch (_) {}
            }

            // Last resort: construct URL and hope it exists
            return `https://storage.googleapis.com/${bucketName}/raw/${userId}/${encodeURIComponent(safeName)}`;
        };

        const signClipUrl = async (clip) => {
            const rawUrl = await resolveGcsUrl(clip);
            if (!rawUrl) return clip;

            if (!gcsBucket) {
                // No GCS client — use the URL as-is (will be downloaded by axios)
                return { ...clip, resolvedPath: rawUrl };
            }
            try {
                const urlObj = new URL(rawUrl);
                let filePath = decodeURIComponent(urlObj.pathname.replace(/^\/[^/]+\//, ''));
                const [signedUrl] = await gcsBucket.file(filePath).getSignedUrl({
                    version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000,
                });
                return { ...clip, resolvedPath: signedUrl };
            } catch (e) {
                console.warn('[export] Could not sign URL for clip:', clip.name, e.message);
                // Fall back to the unsigned URL so the download step can still try
                return { ...clip, resolvedPath: rawUrl };
            }
        };

        allClips = await Promise.all(allClips.map(signClipUrl));
        for (const track of audioTracks) {
            track.clips = await Promise.all(track.clips.map(signClipUrl));
        }

        const scaleFilter = buildScaleFilter(targetWidth, targetHeight);

        // --- STEP 1: Trim each clip into a temp segment ---
        const segments = [];
        const downloadedFiles = []; // track files to clean up
        for (let i = 0; i < allClips.length; i++) {
            const clip = allClips[i];
            let src = clip.resolvedPath || resolveSourcePath(clip, uploadsDir, publicDir);
            if (!src) {
                console.warn(`⚠️  Could not find source for clip "${clip.name}", skipping`);
                continue;
            }

            // Download remote URLs locally before passing to ffmpeg.
            // ffmpeg-static's HTTPS support can be unreliable in cloud environments
            // (GCS signed URLs with long query strings trigger SIGSEGV on some builds).
            if (src.startsWith('http://') || src.startsWith('https://')) {
                const ext = path.extname(src.split('?')[0]) || '.mp4';
                const dlPath = path.join(tmpDir, `dl-${i}${ext}`);
                console.log(`  ⬇️  Downloading clip ${i+1}/${allClips.length}...`);
                await downloadToTemp(src, dlPath);
                downloadedFiles.push(dlPath);
                src = dlPath;
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
                    let src = clip.resolvedPath || resolveSourcePath(clip, uploadsDir, publicDir);
                    if (!src) continue;
                    if (src.startsWith('http://') || src.startsWith('https://')) {
                        const ext = path.extname(src.split('?')[0]) || '.mp3';
                        const dlPath = path.join(tmpDir, `adl-${i}-${j}${ext}`);
                        console.log(`  ⬇️  Downloading audio clip...`);
                        await downloadToTemp(src, dlPath);
                        src = dlPath;
                    }
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

        const textFilters = [];
        for (const track of textTracks) {
            for (const clip of track.clips) {
                const startMs = clip.start;
                const endMs   = clip.start + clip.duration;
                // Escape text for FFmpeg drawtext: ' -> \' and : -> \:
                const text    = (clip.content || clip.name || '').replace(/'/g, "\\'").replace(/:/g, '\\:');
                const color   = (clip.color || '#ffffff').replace('#', '0x');
                const size    = clip.fontSize || 48;

                // Position mapping
                let x = '(w-text_w)/2'; // center
                let y = '(h-text_h)/2';
                if (clip.position === 'bottom') y = 'h-text_h-80';
                if (clip.position === 'top')    y = '80';
                if (typeof clip.x === 'number') x = clip.x + (targetWidth / 2);
                if (typeof clip.y === 'number') y = clip.y + (targetHeight / 2);

                textFilters.push(
                    `drawtext=fontfile='${defaultFontPath.replace(/\\/g, '/').replace(/:/g, '\\:')}':text='${text}':fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}:enable='between(t,${startMs},${endMs})'`
                );
            }
        }

        if (textFilters.length > 0) {
            const textOverlayPath = path.join(tmpDir, 'with_text.mp4');
            await new Promise((resolve, reject) => {
                let cmd = ffmpeg(finalVideoPath);
                
                // Chain all drawtext filters together
                cmd.videoFilters(textFilters.join(','));
                
                cmd
                    .videoCodec(codec)
                    .audioCodec('copy')
                    .output(textOverlayPath)
                    .on('end', () => { finalVideoPath = textOverlayPath; resolve(); })
                    .on('error', reject)
                    .run();
            });
            console.log('  ✅ Text overlays applied');
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
