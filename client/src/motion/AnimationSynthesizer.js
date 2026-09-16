/**
 * client/src/motion/AnimationSynthesizer.js
 *
 * "Layer 3" — the client-side half of the zero-cost, rule-based bespoke
 * animation synthesizer. See server/audio-engine/timeline/
 * AnimationIntensity.js for the full design rationale (this file's header
 * intentionally does not repeat all of it).
 *
 * ─── WHAT THIS DOES ─────────────────────────────────────────────────────────
 * `applyPresetToClip` (ClipAdapter.js) still resolves a preset id through
 * `buildPreset` exactly as before R81 — this file does not replace that
 * lookup or invent a parallel "raw Animation[]" pipeline. It takes the
 * Animation[] a preset generator ALREADY produced and rescales the parts of
 * it that read as "how big/fast this move is" by a 0..1 `intensity` value:
 *
 *   • magnitude properties (x, y, scale, rotation, blur, glow) are scaled
 *     around their IDENTITY value (MotionSchema.IDENTITY) — a scale of 1.18
 *     is a +0.18 delta from identity 1, and that DELTA is what scales, so
 *     scale never crosses through its own identity and inverts direction.
 *   • opacity and reveal are left untouched — they encode a 0..1 VISIBILITY
 *     or PROGRESS fraction (a fade-in, a mask wipe), not "how strong the
 *     motion is". Scaling them would corrupt the fade/reveal itself (e.g. an
 *     opacity that never reaches 1, a reveal that never finishes).
 *   • duration (and every keyframe's `time`, proportionally) scales too — a
 *     higher-intensity moment reads snappier, a lower one more held/gentle.
 *
 * `intensity = 0.5` is EXACT IDENTITY — both scale factors below evaluate to
 * 1.0 at the midpoint, so every existing caller that doesn't know about
 * intensity (the manual Motion tab preset picker, any test written before
 * R81) is unaffected. Only `animate_automatically`
 * (client/src/agent/MediaExecutionEngine.js) passes a real intensity today.
 *
 * Pure and synchronous — no store access, no clip mutation. Safe to unit
 * test directly against `createAnimation`/`createKeyframe` fixtures.
 */

import { IDENTITY } from './MotionSchema.js';

// Properties this file treats as "magnitude" — see file header. Deliberately
// excludes opacity/reveal (visibility/progress, not strength) even though
// both appear in MotionSchema.IDENTITY.
const MAGNITUDE_PROPS = ['x', 'y', 'scale', 'rotation', 'blur', 'glow'];

// At intensity 0.5 (neutral) both factors below are exactly 1.0 — identity.
// Chosen so a maximally-weak signal still reads as a real, visible motion
// (0.65x, not near-zero) and a maximally-strong one is noticeably bigger
// (1.35x) without the preset's own shape becoming unrecognisable.
const MAGNITUDE_MIN_FACTOR = 0.65;
const MAGNITUDE_MAX_FACTOR = 1.35;
// Duration runs the OPPOSITE direction from magnitude: a stronger moment
// should feel snappier (shorter), a weaker one more held (longer).
const DURATION_MIN_FACTOR = 1.15;
const DURATION_MAX_FACTOR = 0.85;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function lerp(min, max, t) {
    return min + t * (max - min);
}

/**
 * Rescale an Animation[] (as produced by any MotionPresets.js `build()`
 * generator) by a 0..1 intensity. Returns the SAME array reference when
 * intensity isn't a finite number (defensive no-op, matches how
 * `applyPresetToClip` already treats a missing/invalid opts field) so a
 * caller can pass this through unconditionally without an extra guard.
 *
 * @param {import('./MotionSchema').Animation[]} animations
 * @param {number} intensity — 0..1; values outside the range are clamped
 * @returns {import('./MotionSchema').Animation[]}
 */
export function scaleAnimations(animations, intensity) {
    if (!Array.isArray(animations)) return animations;
    if (typeof intensity !== 'number' || !Number.isFinite(intensity)) return animations;

    const t = clamp01(intensity);
    const magFactor = lerp(MAGNITUDE_MIN_FACTOR, MAGNITUDE_MAX_FACTOR, t);
    const durFactor = lerp(DURATION_MIN_FACTOR, DURATION_MAX_FACTOR, t);

    return animations.map((anim) => {
        if (!anim || !Array.isArray(anim.keyframes)) return anim;

        const oldDuration = Number(anim.duration) || 0;
        const newDuration  = oldDuration * durFactor;
        const timeScale    = oldDuration > 0 ? newDuration / oldDuration : 1;

        const keyframes = anim.keyframes.map((kf) => {
            const properties = { ...(kf.properties || {}) };
            for (const prop of MAGNITUDE_PROPS) {
                if (typeof properties[prop] !== 'number') continue;
                const identity = IDENTITY[prop];
                properties[prop] = identity + (properties[prop] - identity) * magFactor;
            }
            return { ...kf, time: (Number(kf.time) || 0) * timeScale, properties };
        });

        return { ...anim, duration: newDuration, keyframes };
    });
}

export default { scaleAnimations };
