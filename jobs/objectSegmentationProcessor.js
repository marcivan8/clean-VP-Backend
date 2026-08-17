/**
 * jobs/objectSegmentationProcessor.js
 *
 * R67 — Object Intelligence Integration. BullMQ processor for the
 * 'object-segmentation' queue: "separate speaker" → calls SAM2 (via
 * services/ReplicateSAM2Service.js) on the source clip, downloads the
 * resulting matted/highlighted mask video, extracts a per-frame bounding-box
 * track from it with a plain FFmpeg filter (no custom pixel-scanning code —
 * FFmpeg's own `bbox` filter already does this), and uploads the mask video
 * to GCS alongside the raw/proxy assets this project already stores.
 *
 * WHY A BBOX TRACK, NOT JUST THE MASK: three of this feature's four stated
 * examples — "zoom speaker", "track speaker", "animate speaker" — are
 * fundamentally camera-framing operations, and this project already has a
 * complete, tested, preview+export framing pipeline for exactly that
 * (`virtualCam` crop — see CLAUDE.md R14/R16/R18). Deriving a bounding-box
 * track from the SAM2 mask lets those three examples REUSE that pipeline
 * with zero new render primitive, the same win CameraMotionCompiler.js took
 * for camera-push/pull/zoom presets. Only "blur background" is a genuinely
 * new render primitive (real per-pixel alpha compositing) — see
 * client/src/motion/ObjectLayers.js and the preview/export wiring for that
 * one, scoped and documented separately.
 *
 * Job data: { clipId, assetId, gcsPath, userId, clickPoint?, clickFrame? }
 *   gcsPath    — GCS object path to the source video (e.g. "raw/{userId}/{file}").
 *                MUST already be verified as owned by userId by the ROUTE
 *                before this job is enqueued — this processor does not
 *                re-check ownership (same trust boundary as every other job
 *                in this queue/ — see queue/queues.js's callers).
 *   clickPoint — optional {x, y} PIXEL coordinates (source-frame space) of
 *                where the "speaker" is. Defaults to frame-center, which is
 *                correct for the common single-subject talking-head case and
 *                wrong for anything else — callers with multiple on-screen
 *                people should pass an explicit click from the user.
 *   clickFrame — which frame index clickPoint applies to. Defaults to 0.
 *
 * Returns: { maskAssetPath, maskSignedUrl, bboxTrack, sourceWidth, sourceHeight }
 *   bboxTrack is [{ t, cx, cy, w, h }] with cx/cy/w/h as FRACTIONS of the
 *   source frame (0..1) — the same convention CameraMotionCompiler.js and
 *   the virtualCam crop system already use, so ObjectLayers.js's crop
 *   derivation can consume it directly.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const execFileAsync = promisify(execFile);

const storageConfig = require('../config/storage');
const ReplicateSAM2Service = require('../services/ReplicateSAM2Service');

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
const BBOX_SAMPLE_FPS = 6; // matches the sampling density CameraMotionCompiler uses for zoom keyframes

async function safeUnlink(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
        console.warn('[objectSegmentationProcessor] cleanup failed for', filePath, err.message);
    }
}

/**
 * Resolve a GCS-stored source video to a URL Replicate can fetch over the
 * public internet. Replicate's servers cannot reach a local dev filesystem —
 * this ONLY works when GCS storage is configured (production/staging), which
 * is stated plainly rather than silently returning a broken local path.
 */
async function resolveSourceVideoUrl(gcsPath) {
    if (!storageConfig.bucket || storageConfig.useLocalStorage) {
        throw new Error(
            'Object Intelligence (SAM2) requires GCS storage to be configured — ' +
            'Replicate must be able to fetch the source video over a public URL, ' +
            'which a local-storage dev environment cannot provide.'
        );
    }
    const [signedUrl] = await storageConfig.bucket.file(gcsPath).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // 1h — SAM2 video inference can take minutes
    });
    return signedUrl;
}

async function probeDimensions(localVideoPath) {
    const { stdout } = await execFileAsync(FFPROBE_PATH, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=s=x:p=0',
        localVideoPath,
    ]);
    const [width, height] = stdout.trim().split('x').map(Number);
    if (!width || !height) throw new Error(`ffprobe returned unusable dimensions: "${stdout.trim()}"`);
    return { width, height };
}

/**
 * Download the SAM2 output video to a local temp file.
 */
async function downloadToTemp(url, suffix) {
    const tmpPath = path.join(os.tmpdir(), `sam2-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
    const response = await axios.get(url, { responseType: 'stream', timeout: 120_000 });
    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(tmpPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
    return tmpPath;
}

/**
 * Run FFmpeg's `bbox` filter over the mask video and parse per-frame
 * bounding boxes from stderr. Returns fraction-of-frame boxes, sampled at
 * BBOX_SAMPLE_FPS to keep the track small (matches CameraMotionCompiler's
 * sample-then-simplify approach — a full-fps track is unnecessary precision
 * for a camera-move derivation and would bloat the stored JSON for nothing).
 *
 * ffmpeg's bbox filter logs lines like:
 *   [Parsed_bbox_0 @ 0x...] n:12 pts:12 pts_time:0.5 x1:120 x2:640 y1:40 y2:480 w:520 h:440 crc0:...
 * for every frame where a non-black region exists. Frames with an empty
 * mask (subject briefly fully occluded/off-frame) simply produce no line —
 * we forward-fill from the previous known box in that case rather than
 * collapsing the crop to nothing.
 */
async function extractBBoxTrack(maskVideoPath, sourceWidth, sourceHeight) {
    const args = [
        '-i', maskVideoPath,
        '-vf', `fps=${BBOX_SAMPLE_FPS},bbox=min_val=16`, // min_val=16 ignores near-black compression noise
        '-f', 'null',
        '-',
    ];

    let stderr = '';
    try {
        await execFileAsync(FFMPEG_PATH, args, { maxBuffer: 64 * 1024 * 1024 });
    } catch (err) {
        // ffmpeg with -f null exits non-zero on some builds even on success paths;
        // the bbox data we need is in stderr either way, captured via err.stderr.
        stderr = err.stderr || '';
        if (!stderr.includes('bbox')) throw new Error(`ffmpeg bbox extraction failed: ${err.message}`);
    }

    const lines = stderr.split('\n').filter(l => l.includes('bbox') && l.includes('x1:'));
    const track = [];
    const lineRe = /pts_time:([\d.]+).*?x1:(\d+)\s+x2:(\d+)\s+y1:(\d+)\s+y2:(\d+)/;

    for (const line of lines) {
        const m = lineRe.exec(line);
        if (!m) continue;
        const [, ptsTime, x1, x2, y1, y2] = m;
        const t = parseFloat(ptsTime);
        const bx1 = Number(x1), bx2 = Number(x2), by1 = Number(y1), by2 = Number(y2);
        if (bx2 <= bx1 || by2 <= by1) continue; // degenerate/empty box for this frame — skip, forward-fill below
        track.push({
            t,
            cx: (bx1 + bx2) / 2 / sourceWidth,
            cy: (by1 + by2) / 2 / sourceHeight,
            w: (bx2 - bx1) / sourceWidth,
            h: (by2 - by1) / sourceHeight,
        });
    }

    if (track.length === 0) {
        throw new Error('bbox extraction found no non-empty frames — SAM2 mask may be entirely empty (bad click point?)');
    }
    return track;
}

module.exports = async function processObjectSegmentationJob(job) {
    const { clipId, assetId, gcsPath, userId, clickPoint, clickFrame = 0 } = job.data || {};

    if (!gcsPath) throw new Error('objectSegmentationProcessor: gcsPath is required');
    if (!ReplicateSAM2Service.isConfigured()) {
        throw new Error(
            'REPLICATE_API_TOKEN is not configured on this deployment. ' +
            'Set it in the worker service\'s environment to enable "separate speaker".'
        );
    }

    let localSourcePath = null;
    let localMaskPath = null;

    try {
        await job.updateProgress(5);
        const sourceUrl = await resolveSourceVideoUrl(gcsPath);
        await job.updateProgress(10);

        // Need local dimensions to convert the click point + bboxes to fractions.
        // Download briefly rather than trusting client-reported dimensions, since
        // the crop math downstream (shared with virtualCam) assumes source-accurate values.
        localSourcePath = await downloadToTemp(sourceUrl, path.extname(gcsPath) || '.mp4');
        const { width: sourceWidth, height: sourceHeight } = await probeDimensions(localSourcePath);
        await job.updateProgress(15);

        const resolvedClick = clickPoint && typeof clickPoint.x === 'number' && typeof clickPoint.y === 'number'
            ? clickPoint
            : { x: Math.round(sourceWidth / 2), y: Math.round(sourceHeight / 2) }; // default: frame-center

        console.log(`[objectSegmentation] job ${job.id}: creating Replicate prediction (click=${resolvedClick.x},${resolvedClick.y} @frame ${clickFrame})`);
        const prediction = await ReplicateSAM2Service.createPrediction(sourceUrl, resolvedClick, clickFrame);
        await job.updateProgress(20);

        const finished = await ReplicateSAM2Service.waitForPrediction(prediction.id, {
            onProgress: () => {
                // Replicate doesn't report fine-grained % — nudge the bar so a stuck
                // client doesn't look frozen during multi-minute inference.
                const current = job.progress ?? 20;
                if (typeof current === 'number' && current < 85) job.updateProgress(current + 2).catch(() => {});
            },
        });

        const outputUrl = Array.isArray(finished.output) ? finished.output[0] : finished.output;
        if (!outputUrl) throw new Error('Replicate prediction succeeded but returned no output video URL');
        await job.updateProgress(85);

        localMaskPath = await downloadToTemp(outputUrl, '.mp4');
        await job.updateProgress(90);

        const bboxTrack = await extractBBoxTrack(localMaskPath, sourceWidth, sourceHeight);
        await job.updateProgress(95);

        // Store the mask video next to the source, under the SAME owning
        // userId prefix so the existing per-user IDOR checks (pathOwnedBy in
        // routes/interviewRoutes.js) apply to it unchanged.
        const maskAssetPath = `masks/${userId}/${assetId}/${prediction.id}.mp4`;
        await storageConfig.bucket.upload(localMaskPath, {
            destination: maskAssetPath,
            metadata: { contentType: 'video/mp4' },
        });
        const [maskSignedUrl] = await storageConfig.bucket.file(maskAssetPath).getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 24 * 60 * 60 * 1000,
        });

        await job.updateProgress(100);
        console.log(`[objectSegmentation] job ${job.id}: done — ${bboxTrack.length} bbox samples, mask at ${maskAssetPath}`);

        return {
            clipId,
            assetId,
            maskAssetPath,
            maskSignedUrl,
            bboxTrack,
            sourceWidth,
            sourceHeight,
            predictionId: prediction.id,
        };
    } catch (err) {
        console.error(`[objectSegmentation] job ${job.id} failed:`, err.message);
        throw err;
    } finally {
        await safeUnlink(localSourcePath);
        await safeUnlink(localMaskPath);
    }
};
