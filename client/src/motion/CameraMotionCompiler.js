/**
 * client/src/motion/CameraMotionCompiler.js
 *
 * R64 — wires Motion-tab "camera" presets (camera-push / camera-pull /
 * camera-zoom — see MotionPresets.js CAMERA_PRESETS) into the FFmpeg export
 * for clips on the BASE video/image track.
 *
 * THE GAP THIS CLOSES: `MotionPanel.jsx` resolves the active clip from ANY
 * track and offers the 'camera' preset group whenever a plain video-type
 * clip is selected (`PRESET_GROUPS.filter(g => g.kinds.includes(layer.kind))`
 * includes VIDEO). Applying one writes `clip.animations` via
 * `applyPresetToClip` — but until this file, nothing downstream ever read
 * that field for a BASE-track clip: the Revideo preview evaluates video/image
 * transforms off `clip.keyframes` (see project.tsx `evaluateKF`), and
 * `jobs/exportProcessor.js`'s STEP 2 concat/zoom path only reads
 * `clip.keyframes.scale`. A preset applied here previously had zero visible
 * effect anywhere — the ninth instance of this codebase's "built but never
 * wired" pattern (CLAUDE.md R33, R37, R46, R52, R55, R55c, R59-era Revideo
 * text branch, R63's caption gap, and now this).
 *
 * SCOPE: scale AND pan. `jobs/exportProcessor.js` animates
 * `clip.keyframes.scale` plus `keyframes.panX` / `keyframes.panY` (fractions
 * of the frame) with one smooth filter (buildSmoothZoomFilter). This derives
 * those arrays from `clip.animations` by sampling the same `resolveMotionAt`
 * the preview uses, so camera-zoom / push / pull AND camera-shake / whip /
 * pan reach the exported file (shake used to be preview-only).
 *
 * A clip that ALSO has its own scale keyframes (zoom rhythm, KeyframeEditor)
 * gets both, multiplied, exactly as the preview composes them
 * (client/src/revideo/project.tsx). It used to keep only the rhythm in the
 * export while the preview showed only the animation.
 */

import { clipToMotionLayer } from './ClipAdapter.js';
import { resolveMotionAt, sampleKeyframeTrack } from './MotionResolver.js';
import { simplifySamples } from './Compositor.js';

/** Seconds between samples — matches Compositor.GEOMETRY_SAMPLE_STEP. */
const SAMPLE_STEP = 1 / 15;

function hasCameraAnimation(layer) {
    return Array.isArray(layer?.animations) && layer.animations.some(a =>
        a && Array.isArray(a.keyframes) && a.keyframes.some(k => k.properties &&
            ('scale' in k.properties || 'x' in k.properties || 'y' in k.properties)));
}

/** Value of a `[{time, value, easing}]` keyframe track at clip-local time t. */
export function evaluateKeyframes(kfs, t, fallback = 1) {
    return sampleKeyframeTrack(kfs, t, fallback);
}

/** Compose a static camera crop with animated zoom and image-pan keyframes. */
export function composeAnimatedCrop(baseCrop, extraScale = 1, panX = 0, panY = 0) {
    if (!baseCrop) return null;
    const scale = Number(extraScale) > 0 ? Number(extraScale) : 1;
    const cropW = Math.max(0.05, Math.min(1, Number(baseCrop.cropW) || 1));
    const cropH = Math.max(0.05, Math.min(1, Number(baseCrop.cropH) || 1));
    const width = Math.min(1, cropW / scale);
    const height = Math.min(1, cropH / scale);
    const centerX = (Number(baseCrop.cropX) || 0) + cropW / 2 - (Number(panX) || 0) * width;
    const centerY = (Number(baseCrop.cropY) || 0) + cropH / 2 - (Number(panY) || 0) * height;
    return {
        cropX: Math.max(0, Math.min(1 - width, centerX - width / 2)),
        cropY: Math.max(0, Math.min(1 - height, centerY - height / 2)),
        cropW: width,
        cropH: height,
    };
}

/**
 * Derive the export camera track for one clip:
 *   { scale: [{time,value}], panX: [{time,value}] | null, panY: ... | null }
 * clip-local seconds; scale is a zoom multiplier (animation × the clip's own
 * scale keyframes), pan is the animation's x/y offset as a fraction of the
 * frame. null when the clip has no camera animation (its own keyframes, if
 * any, then pass through untouched).
 *
 * @param {object} clip
 * @param {object} [track] passed through to `clipToMotionLayer` for kind inference
 */
export function deriveCameraKeyframes(clip, track) {
    if (!clip) return null;
    const duration = Number(clip.duration) || 0;
    if (!(duration > 0)) return null;

    const layer = clipToMotionLayer(clip, track);
    if (!layer || !hasCameraAnimation(layer)) return null;

    const own = Array.isArray(clip.keyframes?.scale) && clip.keyframes.scale.length > 0 ? clip.keyframes.scale : null;
    const start = Number(layer.startTime) || 0;
    const baseX = Number.isFinite(layer.x) ? layer.x : 50;
    const baseY = Number.isFinite(layer.y) ? layer.y : 50;

    // Sample grid plus the clip's own keyframe times (a zoom-rhythm "cut" is
    // 40 ms, shorter than one grid step).
    const times = new Set();
    const steps = Math.max(1, Math.ceil(duration / SAMPLE_STEP));
    for (let i = 0; i <= steps; i++) times.add(Number(Math.min(duration, i * SAMPLE_STEP).toFixed(4)));
    for (const k of own || []) {
        const kt = Number(k.time);
        if (kt >= 0 && kt <= duration) { times.add(Number(kt.toFixed(4))); if (kt > 0.002) times.add(Number((kt - 0.001).toFixed(4))); }
    }
    const sorted = [...times].sort((a, b) => a - b);

    const raw = sorted.map(t => {
        const r = resolveMotionAt(layer, start + t);
        const scale = (Number.isFinite(r.scale) ? r.scale : 1) * (own ? evaluateKeyframes(own, t, 1) : 1);
        return { t, value: scale, px: (r.x - baseX) / 100, py: (r.y - baseY) / 100 };
    });
    if (raw.length === 0) return null;

    const simplify = (key) => simplifySamples(raw.map(p => ({ t: p.t, value: p[key] })), key === 'value' ? 0.002 : 0.0005, ['value'])
        .map(p => ({ time: p.t, value: Number(p.value.toFixed(5)) }));
    const moves = (key) => raw.some(p => Math.abs(p[key]) > 1e-4);
    return {
        scale: simplify('value'),
        panX: moves('px') ? simplify('px') : null,
        panY: moves('py') ? simplify('py') : null,
    };
}

/** Back-compat: just the scale track (or null). */
export function deriveZoomKeyframes(clip, track) {
    return deriveCameraKeyframes(clip, track)?.scale || null;
}

/**
 * Return a tracks array with derived `keyframes.scale` injected on
 * qualifying clips of the identified BASE track. Every other track/clip
 * passes through BY REFERENCE — this runs on every export and must never
 * deep-clone the whole timeline, and must never mutate the live store (the
 * caller still holds the original `tracks` from `useTimelineStore`).
 *
 * @param {Array} tracks `state.tracks` (legacy projection)
 * @param {string|null} baseTrackId the id `Compositor.buildCompositionPlan` selected as base
 * @returns {Array} tracks, unchanged (`===`) when there was nothing to derive
 */
export function applyCameraMotionToBaseTrack(tracks, baseTrackId) {
    if (!Array.isArray(tracks) || !baseTrackId) return tracks;
    let changed = false;
    const next = tracks.map(track => {
        if (!track || track.id !== baseTrackId || !Array.isArray(track.clips)) return track;
        let trackChanged = false;
        const nextClips = track.clips.map(clip => {
            const derived = deriveCameraKeyframes(clip, track);
            if (!derived) return clip;
            trackChanged = true;
            const keyframes = { ...(clip.keyframes || {}), scale: derived.scale };
            if (derived.panX) keyframes.panX = derived.panX;
            if (derived.panY) keyframes.panY = derived.panY;
            return { ...clip, keyframes };
        });
        if (!trackChanged) return track;
        changed = true;
        return { ...track, clips: nextClips };
    });
    return changed ? next : tracks;
}

/**
 * Compute smooth dynamic pan/tilt keyframes from an active subject bounding box
 * track. Accepts both top-left `{t,x,y,w,h}` boxes and center-based
 * `{t,cx,cy,w,h}` samples written by MatteBaker / MediaPipe.
 *
 * Smooths raw coordinates using exponential moving average (EMA) damping,
 * preventing jitter while smoothly following moving speakers across the frame.
 *
 * @param {Array<{t:number, x:number, y:number, w:number, h:number}>} bboxTrack
 * @param {number} clipDuration in seconds
 * @param {object} [opts]
 * @param {number} [opts.smoothing=0.82] 0 (instant) to 0.95 (heavy smoothing)
 * @param {number} [opts.deadzone=0.04] normalized fraction of frame to ignore micro-movement
 * @param {number} [opts.sourceStart=0] source-time in point represented by clip-local t=0
 * @param {number} [opts.speed=1] source seconds per timeline second
 * @returns {{panX: Array<{time:number, value:number}>, panY: Array<{time:number, value:number}>, scale: Array<{time:number, value:number}>}|null}
 */
export function computeActiveSpeakerPan(bboxTrack, clipDuration, opts = {}) {
    if (!Array.isArray(bboxTrack) || bboxTrack.length === 0) return null;
    const dur = Number(clipDuration) || 0;
    if (!(dur > 0)) return null;

    const smoothing = Number.isFinite(Number(opts.smoothing))
        ? Math.max(0, Math.min(0.95, Number(opts.smoothing))) : 0.82;
    const alpha = Math.max(0.05, Math.min(1, 1 - smoothing));
    const deadzone = Number.isFinite(Number(opts.deadzone))
        ? Math.max(0, Number(opts.deadzone)) : 0.04;
    const sourceStart = opts.sourceStart != null && Number.isFinite(Number(opts.sourceStart)) ? Number(opts.sourceStart) : 0;
    const speed = Number(opts.speed) > 0 ? Number(opts.speed) : 1;
    const anchorX = Number.isFinite(Number(opts.anchorX)) ? Number(opts.anchorX) : 0.5;
    const anchorY = Number.isFinite(Number(opts.anchorY)) ? Number(opts.anchorY) : 0.5;
    const cropW = Math.max(0.05, Number(opts.cropW) || 1);
    const cropH = Math.max(0.05, Number(opts.cropH) || 1);
    const sourceEnd = sourceStart + dur * speed;

    const samples = [...bboxTrack]
        .filter(b => b && Number.isFinite(b.t)
            && (Number.isFinite(b.cx) || Number.isFinite(b.x))
            && (Number.isFinite(b.cy) || Number.isFinite(b.y))
            && b.t >= sourceStart && b.t <= sourceEnd)
        .map(b => {
            const cx = Number.isFinite(b.cx) ? b.cx : b.x + (Number(b.w) || 0) / 2;
            const cy = Number.isFinite(b.cy) ? b.cy : b.y + (Number(b.h) || 0) / 2;
            return {
                ...b,
                localTime: (b.t - sourceStart) / speed,
                // pan keyframes describe image movement. Move the image
                // opposite the subject's displacement, normalized by the
                // crop window so the source-space crop reaches the target.
                targetX: (anchorX - cx) / cropW,
                // A person box is taller than the face; bias toward the upper
                // third. A face anchor is already centered on the face.
                targetY: (anchorY - (cy + (opts.anchorType === 'face' ? (Number(b.h) || 0) * 0.1 : (Number(b.h) || 0) * -0.15))) / cropH,
            };
        })
        .sort((a, b) => a.t - b.t);
    if (samples.length === 0) return null;

    let currentTargetX = samples[0].targetX;
    let currentTargetY = samples[0].targetY;

    let smoothedX = currentTargetX;
    let smoothedY = currentTargetY;

    const rawKeyframes = [];

    for (const sample of samples) {
        const targetX = sample.targetX;
        const targetY = sample.targetY;

        if (Math.abs(targetX - currentTargetX) > deadzone) currentTargetX = targetX;
        if (Math.abs(targetY - currentTargetY) > deadzone) currentTargetY = targetY;

        smoothedX += alpha * (currentTargetX - smoothedX);
        smoothedY += alpha * (currentTargetY - smoothedY);

        const px = Math.max(-0.4, Math.min(0.4, smoothedX));
        const py = Math.max(-0.3, Math.min(0.3, smoothedY));

        rawKeyframes.push({
            t: Number(sample.localTime.toFixed(4)),
            px: Number(px.toFixed(4)),
            py: Number(py.toFixed(4)),
        });
    }

    if (rawKeyframes.length === 0) return null;

    const panX = simplifySamples(rawKeyframes.map(k => ({ t: k.t, value: k.px })), 0.001, ['value'])
        .map(k => ({ time: k.t, value: Number(k.value.toFixed(4)), easing: 'easeInOut' }));
    const panY = simplifySamples(rawKeyframes.map(k => ({ t: k.t, value: k.py })), 0.001, ['value'])
        .map(k => ({ time: k.t, value: Number(k.value.toFixed(4)), easing: 'easeInOut' }));

    return {
        panX,
        panY,
        scale: [{ time: 0, value: 1.0, easing: 'linear' }],
    };
}

/**
 * Apply auto-framing speaker tracking directly onto a clip.
 */
export function applyActiveSpeakerTracking(clip, bboxTrack, opts = {}) {
    if (!clip) return clip;
    const dur = Number(clip.duration) || 0;
    const tracking = computeActiveSpeakerPan(bboxTrack, dur, {
        ...opts,
        sourceStart: opts.sourceStart != null && Number.isFinite(Number(opts.sourceStart)) ? Number(opts.sourceStart) : (Number(clip.offset) || 0),
        speed: opts.speed != null && Number(opts.speed) > 0 ? Number(opts.speed) : (Number(clip.speed) > 0 ? Number(clip.speed) : 1),
        anchorX: opts.anchorX ?? (clip.virtualCam ? Number(clip.virtualCam.cropX || 0) + Number(clip.virtualCam.cropW || 1) / 2 : 0.5),
        anchorY: opts.anchorY ?? (clip.virtualCam ? Number(clip.virtualCam.cropY || 0) + Number(clip.virtualCam.cropH || 1) / 2 : 0.5),
        cropW: opts.cropW ?? clip.virtualCam?.cropW ?? 1,
        cropH: opts.cropH ?? clip.virtualCam?.cropH ?? 1,
    });
    if (!tracking) return clip;
    const keyframes = {
        ...(clip.keyframes || {}),
        panX: tracking.panX,
        panY: tracking.panY,
    };
    return { ...clip, keyframes, virtualCam: { ...(clip.virtualCam || {}), tracking: 'active-speaker' } };
}

export default {
    deriveCameraKeyframes,
    deriveZoomKeyframes,
    evaluateKeyframes,
    composeAnimatedCrop,
    applyCameraMotionToBaseTrack,
    computeActiveSpeakerPan,
    applyActiveSpeakerTracking,
};
