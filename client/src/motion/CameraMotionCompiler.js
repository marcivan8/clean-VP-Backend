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
 * SCOPE: scale only. `jobs/exportProcessor.js` already knows how to animate
 * a piecewise `z=` zoompan expression from `clip.keyframes.scale` — that is
 * the exact mechanism a hand-authored zoom rhythm (KeyframeEditor) already
 * uses via `buildZoomKeyframeExpr`. Rather than teach the server a second,
 * parallel scale-animation format, this derives an EQUIVALENT
 * `keyframes.scale` array from `clip.animations` by sampling the same
 * `resolveMotionAt` the preview uses, and ships it inside the existing,
 * well-tested zoompan path unchanged.
 *
 * translate-type camera presets (camera-whip, camera-shake) are NOT derived
 * here. They are short (<=0.6s), sub-percent-of-frame pans meant to read as
 * a camera "snap"/"shake" — teaching zoompan's x=/y= pan window a matching
 * expression is a materially bigger, higher-risk change (zoompan's pan
 * coordinates already caused the R16 multicam-crop bug) and is out of scope
 * for this pass. They animate correctly in the live Revideo preview (see
 * project.tsx's `motionOffsets`) but do not yet reach the exported file —
 * a known, explicit scope limit, not an oversight.
 *
 * A clip that already has its own hand-authored `clip.keyframes.scale`
 * (drawn in KeyframeEditor) is left completely alone — this only fills the
 * gap for clips that have NOTHING today.
 */

import { clipToMotionLayer } from './ClipAdapter.js';
import { resolveMotionAt } from './MotionResolver.js';
import { ANIMATION_TYPES } from './MotionSchema.js';
import { simplifySamples } from './Compositor.js';

/** Seconds between samples — matches Compositor.GEOMETRY_SAMPLE_STEP. */
const SAMPLE_STEP = 1 / 15;

function hasScaleAnimation(layer) {
    return Array.isArray(layer?.animations) && layer.animations.some(a =>
        a && a.type === ANIMATION_TYPES.SCALE &&
        Array.isArray(a.keyframes) && a.keyframes.some(k => k.properties && 'scale' in k.properties));
}

/**
 * Derive a `clip.keyframes.scale`-shaped array (`[{time, value}]`, clip-local
 * seconds, value a zoom multiplier) for one clip, or null when there is
 * nothing to derive: no scale-type animation, empty/zero duration, or the
 * clip already carries its own hand-authored scale rhythm (never overridden).
 *
 * @param {object} clip
 * @param {object} [track] passed through to `clipToMotionLayer` for kind inference
 * @returns {Array<{time:number,value:number}>|null}
 */
export function deriveZoomKeyframes(clip, track) {
    if (!clip || Array.isArray(clip.keyframes?.scale)) return null;
    const duration = Number(clip.duration) || 0;
    if (!(duration > 0)) return null;

    const layer = clipToMotionLayer(clip, track);
    if (!layer || !hasScaleAnimation(layer)) return null;

    const start = Number(layer.startTime) || 0;
    const raw = [];
    const steps = Math.max(1, Math.ceil(duration / SAMPLE_STEP));
    for (let i = 0; i <= steps; i++) {
        const t = Math.min(duration, i * SAMPLE_STEP);
        const resolved = resolveMotionAt(layer, start + t);
        raw.push({ t: Number(t.toFixed(4)), value: Number.isFinite(resolved.scale) ? resolved.scale : 1 });
        if (t >= duration) break;
    }
    if (raw.length === 0) return null;

    const simplified = simplifySamples(raw, 0.004, ['value']);
    return simplified.map(p => ({ time: p.t, value: p.value }));
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
            const derived = deriveZoomKeyframes(clip, track);
            if (!derived) return clip;
            trackChanged = true;
            return { ...clip, keyframes: { ...(clip.keyframes || {}), scale: derived } };
        });
        if (!trackChanged) return track;
        changed = true;
        return { ...track, clips: nextClips };
    });
    return changed ? next : tracks;
}

export default { deriveZoomKeyframes, applyCameraMotionToBaseTrack };
