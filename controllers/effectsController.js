/**
 * effectsController.js
 * Handles AI-driven effect analysis and generation.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(require('ffmpeg-static'));
ffmpeg.setFfprobePath(require('@ffprobe-installer/ffprobe').path);
const { detectBeats } = require('../analysis/beatDetector');
const { detectFaces } = require('../analysis/emotionAnalyzer');
const { resolveEffectMedia } = require('../services/effectMediaResolver');

/**
 * Detect smart zoom targets (faces, objects)
 * POST /api/effects/smart-zoom
 */
const smartZoom = async (req, res) => {
    let media;
    let frameDir;
    try {
        const userId = req.user?.id || (process.env.NODE_ENV !== 'production' ? 'dev-user' : null);
        if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
        const reference = req.body?.videoUrl || req.body?.videoPath;
        if (!reference) return res.status(400).json({ success: false, error: 'videoUrl is required' });
        media = await resolveEffectMedia(reference, userId);

        // Bound the work on long recordings while retaining useful tracking
        // density. Frame extraction is intentionally analysis-only.
        const metadata = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(media.path, (error, data) => error ? reject(error) : resolve(data));
        });
        const duration = Number(metadata?.format?.duration);
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read video duration');
        const requestedStart = Math.max(0, Number(req.body?.startTime) || 0);
        const requestedEnd = Math.min(duration, Number(req.body?.endTime) || duration);
        if (requestedEnd <= requestedStart) return res.status(400).json({ success: false, error: 'Invalid analysis time range' });
        const rangeDuration = requestedEnd - requestedStart;
        const subject = String(req.body?.subject || 'face');
        const zoomLevel = Math.max(1, Math.min(3, Number(req.body?.zoomLevel) || 1.5));
        if (subject === 'center') {
            return res.json({
                success: true,
                effectType: 'smart_zoom',
                trackingMethod: 'fixed_center',
                subjectFound: false,
                confidence: 1,
                keyframes: [
                    { time: requestedStart, x: 0.5, y: 0.5, scale: zoomLevel, easing: 'easeInOut' },
                    { time: requestedEnd, x: 0.5, y: 0.5, scale: zoomLevel, easing: 'easeInOut' }
                ]
            });
        }
        if (subject === 'speaker' || subject === 'action') {
            return res.status(501).json({ success: false, error: `Smart zoom tracking for "${subject}" is not available yet. Choose face or center.` });
        }
        if (subject !== 'face') return res.status(400).json({ success: false, error: `Unsupported tracking subject: ${subject}` });
        const interval = Math.max(0.75, rangeDuration / 90);
        frameDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibed-smart-zoom-'));
        // The shared extractor processes from the beginning; crop the interval
        // at decode time so timestamped detections map back to source time.
        await new Promise((resolve, reject) => {
            ffmpeg(media.path)
                .seekInput(requestedStart)
                .duration(rangeDuration)
                .outputOptions([`-vf fps=1/${interval}`, '-q:v 2'])
                .output(path.join(frameDir, 'frame-%d.jpg'))
                .on('end', resolve)
                .on('error', reject)
                .run();
        });
        const filenames = (await fs.promises.readdir(frameDir))
            .filter(name => /^frame-\d+\.jpg$/.test(name))
            .sort((a, b) => Number(a.match(/frame-(\d+)/)[1]) - Number(b.match(/frame-(\d+)/)[1]));
        const smoothness = Math.max(0, Math.min(1, Number(req.body?.smoothness) || 0));
        const keyframes = [];
        let confidenceSum = 0;
        let previous = null;
        for (let index = 0; index < filenames.length; index++) {
            const imagePath = path.join(frameDir, filenames[index]);
            const analysis = await detectFaces(imagePath);
            const faces = Array.isArray(analysis.faces) ? analysis.faces : [];
            if (!faces.length) continue;
            const time = requestedStart + index * interval;
            const trackingPrevious = previous && time - previous.time <= Math.max(3, interval * 3) ? previous : null;
            const candidates = faces.map(face => {
                const box = face.box || {};
                const xMin = Number(box.xMin), yMin = Number(box.yMin);
                const width = Number(box.width), height = Number(box.height);
                if (![xMin, yMin, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
                const x = (xMin + width / 2) / analysis.width;
                const y = (yMin + height * 0.42) / analysis.height;
                const area = (width * height) / (analysis.width * analysis.height);
                const confidence = Math.max(0, Math.min(1, Number(face.score) || 0));
                const distance = trackingPrevious ? Math.hypot(x - trackingPrevious.x, y - trackingPrevious.y) : 0;
                const sizeChange = trackingPrevious ? Math.abs(Math.log(Math.max(area, 1e-6) / Math.max(trackingPrevious.area, 1e-6))) : 0;
                return { face, xMin, yMin, width, height, x, y, area, confidence, cost: distance + sizeChange * 0.12 - confidence * 0.02 };
            }).filter(Boolean);
            if (!candidates.length) continue;
            const candidate = trackingPrevious
                ? candidates.sort((a, b) => a.cost - b.cost)[0]
                : candidates.sort((a, b) => b.area - a.area || b.confidence - a.confidence)[0];
            // Reject a sudden identity jump; a missed sample is safer than
            // cutting the crop to a different person across the room.
            if (trackingPrevious && Math.hypot(candidate.x - trackingPrevious.x, candidate.y - trackingPrevious.y) > 0.35) continue;
            const { xMin, yMin, width, height, confidence } = candidate;
            if (![xMin, yMin, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
            const x = Math.max(0, Math.min(1, candidate.x));
            const y = Math.max(0, Math.min(1, candidate.y));
            const faceScale = Math.min((analysis.width * 0.58) / width, (analysis.height * 0.46) / height);
            const scale = Math.max(1, Math.min(zoomLevel, faceScale));
            confidenceSum += confidence;
            keyframes.push({ time, x, y, scale, confidence, easing: 'easeInOut' });
            previous = { x, y, area: candidate.area, time };
        }
        if (!keyframes.length) return res.status(422).json({ success: false, error: 'No face was detected in the selected video range.' });
        if (smoothness > 0 && keyframes.length > 2) {
            const original = keyframes.map(frame => ({ ...frame }));
            for (let index = 1; index < keyframes.length - 1; index++) {
                const blend = smoothness * 0.5;
                for (const property of ['x', 'y', 'scale']) {
                    keyframes[index][property] = original[index][property] * (1 - blend)
                        + (original[index - 1][property] + original[index + 1][property]) * blend / 2;
                }
            }
        }
        return res.json({ success: true, effectType: 'smart_zoom', keyframes, subjectFound: true, confidence: confidenceSum / keyframes.length });
    } catch (error) {
        console.error('[Effects] Smart zoom error:', error);
        return res.status(422).json({ success: false, error: error.message || 'Failed to analyze smart zoom' });
    } finally {
        if (frameDir) await fs.promises.rm(frameDir, { recursive: true, force: true }).catch(() => {});
        await media?.cleanup?.().catch(error => console.warn('[Effects] Temp media cleanup failed:', error.message));
    }
};

/**
 * Detect beats for synchronization
 * POST /api/effects/beat-sync
 */
const beatSync = async (req, res) => {
    let media;
    try {
        const userId = req.user?.id || (process.env.NODE_ENV !== 'production' ? 'dev-user' : null);
        if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
        const reference = req.body?.audioUrl || req.body?.videoUrl || req.body?.audioPath;
        if (!reference) return res.status(400).json({ success: false, error: 'audioUrl or videoUrl is required' });
        media = await resolveEffectMedia(reference, userId);
        const detected = await detectBeats(media.path, { sensitivity: req.body?.sensitivity });
        const startTime = Number.isFinite(Number(req.body?.startTime)) ? Number(req.body.startTime) : 0;
        const endTime = Number.isFinite(Number(req.body?.endTime)) ? Number(req.body.endTime) : Infinity;
        const baseBeats = detected.beats.filter(time => time >= startTime && time < endTime);
        const division = Number(req.body?.beatDivision) || 1;
        const beats = division >= 1
            ? baseBeats.filter((_, index) => index % Math.max(1, Math.round(division)) === 0)
            : baseBeats.slice(0, -1).flatMap((time, index) => {
                const next = baseBeats[index + 1];
                const step = (next - time) * division;
                if (!Number.isFinite(step) || step <= 0) return [];
                const points = [];
                for (let point = time; point < next - 0.01; point += step) points.push(Number(point.toFixed(3)));
                return points;
            });
        if (!beats.length || !detected.bpm) return res.status(422).json({ success: false, error: 'No reliable beat pattern was detected in this media.' });
        return res.json({ success: true, status: 'success', effectType: 'beat_sync', bpm: detected.bpm, beats, count: beats.length });
    } catch (error) {
        console.error('[Effects] Beat sync error:', error);
        return res.status(422).json({ success: false, error: error.message || 'Failed to analyze beats' });
    } finally {
        await media?.cleanup?.().catch(error => console.warn('[Effects] Temp media cleanup failed:', error.message));
    }
};

/**
 * Analyze emotions for framing/color
 * POST /api/effects/emotion-frame
 */
const emotionFrame = async (req, res) => {
    return res.status(501).json({ success: false, error: 'Emotion-based framing is unavailable until real visual analysis is enabled.' });
};

module.exports = {
    smartZoom,
    beatSync,
    emotionFrame
};
