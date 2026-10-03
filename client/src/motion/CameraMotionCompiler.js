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
import { resolveMotionAt } from './MotionResolver.js';
import { simplifySamples } from './Compositor.js';

/** Seconds between samples — matches Compositor.GEOMETRY_SAMPLE_STEP. */
const SAMPLE_STEP = 1 / 15;

function hasCameraAnimation(layer) {
    return Array.isArray(layer?.animations) && layer.animations.some(a =>
        a && Array.isArray(a.keyframes) && a.keyframes.some(k => k.properties &&
            ('scale' in k.properties || 'x' in k.properties || 'y' in k.properties)));
}

// Same easing the preview's evaluateKF applies to clip.keyframes
// (client/src/revideo/project.tsx), so the product of the two matches it.
const KF_EASING = {
    linear: t => t,
    easeIn: t => t * t, 'ease-in': t => t * t,
    easeOut: t => t * (2 - t), 'ease-out': t => t * (2 - t),
    easeInOut: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    'ease-in-out': t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    easeOutCubic: t => 1 - Math.pow(1 - t, 3),
    easeInCubic: t => t * t * t,
};

/** Value of a `[{time, value, easing}]` keyframe track at clip-local time t. */
export function evaluateKeyframes(kfs, t, fallback = 1) {
    if (!Array.isArray(kfs) || kfs.length === 0) return fallback;
    const s = [...kfs].filter(k => Number.isFinite(Number(k.time)) && Number.isFinite(Number(k.value)))
        .sort((a, b) => a.time - b.time);
    if (s.length === 0) return fallback;
    if (t <= s[0].time) return Number(s[0].value);
    if (t >= s[s.length - 1].time) return Number(s[s.length - 1].value);
    for (let i = 0; i < s.length - 1; i++) {
        if (t >= s[i].time && t < s[i + 1].time) {
            const u = (t - s[i].time) / Math.max(s[i + 1].time - s[i].time, 0.0001);
            const ease = KF_EASING[s[i + 1].easing || 'linear'] || KF_EASING.linear;
            return Number(s[i].value) + (Number(s[i + 1].value) - Number(s[i].value)) * ease(u);
        }
    }
    return Number(s[s.length - 1].value);
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

export default { deriveCameraKeyframes, deriveZoomKeyframes, evaluateKeyframes, applyCameraMotionToBaseTrack };
