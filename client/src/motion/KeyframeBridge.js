/**
 * client/src/motion/KeyframeBridge.js
 *
 * Adapts the motion engine's `Animation[]` model to the shape
 * `components/Effects/KeyframeEditor.jsx` already speaks, and back again.
 *
 * ─── WHY A BRIDGE AND NOT A REWRITE ─────────────────────────────────────────
 * `KeyframeEditor.jsx` is a complete 372-line visual keyframe timeline —
 * draggable diamonds, per-keyframe easing, add/remove — that has been sitting
 * in this repo with exactly one reference (a barrel export nothing imports)
 * since long before the motion engine existed. Rewriting it for a slightly
 * different data shape would mean throwing away working, debugged UI and
 * leaving the original behind as dead code for a second time.
 *
 * It expects effect-style tracks:  { paramName: [{ time, value, easing }] }
 * The motion engine stores:        [{ type, duration, keyframes: [{ time, properties }] }]
 *
 * This module converts between the two. Nothing else changes on either side.
 *
 * ─── THE ONE MODELLING DECISION ─────────────────────────────────────────────
 * Hand-authored keyframes collapse to a SINGLE animation with `presetId: null`.
 *
 * The engine composes multiple animations (translate adds, scale multiplies),
 * which is right for stacking presets but has no sane representation in a flat
 * per-parameter timeline: two animations both driving `scale` would show as one
 * track whose values are neither of them. So the editor owns one custom
 * animation, and applying a preset REPLACES it — the same rule
 * `applyPresetToClip` already follows. A user therefore always sees exactly
 * what will render, rather than a curve that is one input to a composition.
 *
 * ─── VALUES ARE OFFSETS, NOT ABSOLUTES ──────────────────────────────────────
 * Keyframe values are deltas against the clip's own transform, because that is
 * how the resolver composes them: `x`/`y`/`rotation`/`blur` add, `scale` and
 * `opacity` multiply. So `x: 0, scale: 1, opacity: 1` is "no change". The UI
 * labels them as offsets and multipliers rather than pretending otherwise —
 * showing an absolute position that silently behaves as an offset would be
 * worse than showing the truth.
 */

import { createAnimation, createKeyframe, ANIMATION_TYPES } from './MotionSchema.js';

/** Marks the single animation the keyframe editor owns. */
export const CUSTOM_ANIMATION_ID = 'custom-motion';

/**
 * Parameter definitions in the shape `KeyframeEditor` expects from a
 * `definition.params` object. `type: 'float'` is what makes the editor treat a
 * parameter as animatable at all — it filters on exactly that.
 *
 * `neutral` is the value meaning "no change", which differs per property
 * because of how each composes.
 */
export const MOTION_PARAM_DEFS = {
    x:        { type: 'float', label: 'X offset',   min: -100, max: 100, step: 0.5,  value: 0, neutral: 0 },
    y:        { type: 'float', label: 'Y offset',   min: -100, max: 100, step: 0.5,  value: 0, neutral: 0 },
    scale:    { type: 'float', label: 'Scale',      min: 0,    max: 4,   step: 0.01, value: 1, neutral: 1 },
    rotation: { type: 'float', label: 'Rotation',   min: -180, max: 180, step: 1,    value: 0, neutral: 0 },
    opacity:  { type: 'float', label: 'Opacity',    min: 0,    max: 1,   step: 0.01, value: 1, neutral: 1 },
    blur:     { type: 'float', label: 'Blur',       min: 0,    max: 40,  step: 0.5,  value: 0, neutral: 0 },
};

export const MOTION_PARAM_NAMES = Object.keys(MOTION_PARAM_DEFS);

/**
 * Convert `Animation[]` into per-parameter keyframe tracks for the editor.
 *
 * Times are converted from ANIMATION-local to CLIP-local, because the editor
 * lays keyframes out against the clip's duration. An animation anchored to the
 * clip's END ('out') therefore resolves to real clip-local positions here
 * rather than appearing at the start.
 *
 * @param {Array} animations
 * @param {number} clipDuration seconds
 * @returns {object} `{ paramName: [{ time, value, easing }] }`
 */
export function animationsToParamTracks(animations, clipDuration) {
    const tracks = {};
    if (!Array.isArray(animations)) return tracks;

    for (const anim of animations) {
        if (!anim || !Array.isArray(anim.keyframes)) continue;

        const animDuration = Number(anim.duration) || 0;
        const animStart = anim.anchor === 'out'
            ? Math.max(0, (Number(clipDuration) || 0) - animDuration - (Number(anim.startTime) || 0))
            : (Number(anim.startTime) || 0);

        for (const kf of anim.keyframes) {
            const props = kf?.properties || {};
            for (const [param, value] of Object.entries(props)) {
                if (!MOTION_PARAM_DEFS[param]) continue;
                if (!Number.isFinite(Number(value))) continue;
                if (!tracks[param]) tracks[param] = [];
                tracks[param].push({
                    time: Math.max(0, animStart + (Number(kf.time) || 0)),
                    value: Number(value),
                    easing: kf.easing || anim.easing || 'linear',
                });
            }
        }
    }

    // The editor assumes ascending time and one keyframe per instant.
    for (const param of Object.keys(tracks)) {
        tracks[param].sort((a, b) => a.time - b.time);
        tracks[param] = tracks[param].filter(
            (kf, i, arr) => i === 0 || Math.abs(kf.time - arr[i - 1].time) > 1e-4
        );
    }
    return tracks;
}

/**
 * Convert per-parameter tracks back into a single custom `Animation`.
 *
 * @param {object} tracks `{ paramName: [{ time, value, easing }] }`
 * @param {number} clipDuration seconds
 * @returns {Array} an `Animation[]` of length 0 or 1
 */
export function paramTracksToAnimations(tracks, clipDuration) {
    if (!tracks || typeof tracks !== 'object') return [];

    // Gather every distinct instant any parameter has a keyframe at, so one
    // keyframe can carry several properties — which is what the resolver
    // samples most efficiently.
    const byTime = new Map();
    for (const [param, kfs] of Object.entries(tracks)) {
        if (!MOTION_PARAM_DEFS[param] || !Array.isArray(kfs)) continue;
        for (const kf of kfs) {
            const t = Math.max(0, Number(kf?.time) || 0);
            const value = Number(kf?.value);
            if (!Number.isFinite(value)) continue;
            const key = t.toFixed(4);
            if (!byTime.has(key)) byTime.set(key, { time: t, properties: {}, easing: kf.easing || 'linear' });
            byTime.get(key).properties[param] = value;
        }
    }

    if (byTime.size === 0) return [];

    const entries = [...byTime.values()].sort((a, b) => a.time - b.time);
    const keyframes = entries.map(e => createKeyframe(e.time, e.properties, e.easing));

    // A single keyframe holds a constant — legal, and how a user pins a value.
    const duration = Math.max(
        Number(clipDuration) || 0,
        entries[entries.length - 1].time
    );

    return [createAnimation({
        id: CUSTOM_ANIMATION_ID,
        // TRANSLATE is the most neutral type label; the resolver dispatches on
        // the keyframes' own properties, not on this, so it is descriptive only.
        type: ANIMATION_TYPES.TRANSLATE,
        startTime: 0,
        duration,
        easing: 'linear',
        anchor: 'in',
        presetId: null,
        keyframes,
    })];
}

/**
 * Build the synthetic `effect` + `definition` pair `KeyframeEditor` renders
 * from, out of a clip. Returns null when there is no clip to edit.
 *
 * Only parameters that already have keyframes are exposed as tracks; the panel
 * offers the rest as things the user can start animating.
 */
export function buildEditorModel(clip) {
    if (!clip) return null;
    const duration = Number(clip.duration) || 0;
    return {
        effect: {
            id: CUSTOM_ANIMATION_ID,
            keyframes: animationsToParamTracks(clip.animations, duration),
        },
        definition: { params: MOTION_PARAM_DEFS },
        duration,
    };
}

/**
 * Apply one editor mutation and return the clip updates to dispatch.
 *
 * `op` is `{ kind: 'add'|'remove', param, time, value?, easing? }`.
 * Returns `{}` for an unusable operation rather than throwing, so a stray
 * interaction can never take the editor down.
 */
export function applyKeyframeOp(clip, op) {
    if (!clip || !op || !MOTION_PARAM_DEFS[op.param]) return {};

    const duration = Number(clip.duration) || 0;
    const tracks = animationsToParamTracks(clip.animations, duration);
    const param = op.param;
    const time = Math.max(0, Number(op.time) || 0);
    const list = Array.isArray(tracks[param]) ? [...tracks[param]] : [];

    if (op.kind === 'remove') {
        tracks[param] = list.filter(kf => Math.abs(kf.time - time) > 1e-3);
        if (tracks[param].length === 0) delete tracks[param];
    } else if (op.kind === 'add') {
        const value = Number.isFinite(Number(op.value))
            ? Number(op.value)
            : MOTION_PARAM_DEFS[param].neutral;
        // Replace rather than stack when a keyframe already sits at this
        // instant — two keyframes at the same time make interpolation
        // order-dependent and the curve unpredictable.
        const next = list.filter(kf => Math.abs(kf.time - time) > 1e-3);
        next.push({ time, value, easing: op.easing || 'linear' });
        next.sort((a, b) => a.time - b.time);
        tracks[param] = next;
    } else {
        return {};
    }

    const animations = paramTracksToAnimations(tracks, duration);
    return {
        animations,
        // Clear the legacy single-string animation so the two cannot both claim
        // to drive this clip — `resolveAnimations` prefers the array, but a
        // stale string makes the Text panel show a selection that is not what
        // renders.
        animation: 'none',
    };
}

export default {
    CUSTOM_ANIMATION_ID,
    MOTION_PARAM_DEFS,
    MOTION_PARAM_NAMES,
    animationsToParamTracks,
    paramTracksToAnimations,
    buildEditorModel,
    applyKeyframeOp,
};
