/**
 * client/src/motion/MotionComposer.js
 *
 * R92: motion that is written rather than picked from a list.
 *
 * Before R92 every animation in Vibed came from 26 fixed presets, and the LLM
 * could only choose a preset id. This module lets motion be WRITTEN, the way
 * a motion designer (or an LLM writing animation code) would write it:
 *
 *   1. a MOTION SCRIPT: a list of beats, each a verb from a physics-aware
 *      vocabulary ("slam-in at 0 s, energy 0.8, from below", "punch at 1.4 s",
 *      "float for the whole hold", "whip-out at the end"), and/or
 *   2. RAW KEYFRAMES: animations with per-property keyframes and any easing
 *      Easing.js understands (springs, cubic-bezier, steps…).
 *
 * Both compile to the existing Animation[] format (MotionSchema.js). The
 * resolver already renders that format the same way in preview and export,
 * so neither renderer has to learn anything new.
 *
 * EVERYTHING IS SANITISED. A script can come from an LLM, so every number is
 * clamped to a safe range, every time is kept inside the clip, unknown verbs,
 * properties and easings are dropped or replaced, and counts are capped. A bad
 * script degrades to less motion, never to a broken render.
 *
 * Pure module: no DOM, no store, no network. The server imports it too
 * (server/routes/motionRoutes.js), so the LLM prompt and the validation use
 * the same vocabulary as the client.
 */

import { createAnimation, createKeyframe, validateMotionLayer, ANIMATION_TYPES, ANIMATABLE_PROPS, LAYER_KINDS } from './MotionSchema.js';
import { isKnownEasing } from './Easing.js';
import { anticipationFor } from './MotionPrinciples.js';

/** Tag on animations written by this module. */
export const COMPOSED = 'composed';

export const LIMITS = Object.freeze({
    maxBeats: 16,
    maxAnimations: 16,
    maxKeyframes: 24,
    /** Safe value range per property. x/y are offsets in % of the frame. */
    ranges: {
        x: [-120, 120], y: [-120, 120], scale: [0, 6], scaleX: [0, 6], scaleY: [0, 6], rotation: [-1080, 1080],
        opacity: [0, 1], blur: [0, 60], glow: [0, 60], reveal: [0, 1],
    },
});

/** Direction of travel. `up` means the layer comes from below and moves up. */
const DIRS = {
    up:    { x: 0,  y: 1 },
    down:  { x: 0,  y: -1 },
    left:  { x: 1,  y: 0 },
    right: { x: -1, y: 0 },
};

const clampNum = (v, lo, hi, fallback) => {
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return n < lo ? lo : n > hi ? hi : n;
};
const lerp = (a, b, t) => a + (b - a) * t;
const round3 = n => Math.round(n * 1000) / 1000;

function typeFor(props) {
    const keys = new Set(props);
    if (keys.has('reveal')) return ANIMATION_TYPES.REVEAL;
    if (keys.has('scale') || keys.has('scaleX') || keys.has('scaleY')) return ANIMATION_TYPES.SCALE;
    if (keys.has('x') || keys.has('y')) return ANIMATION_TYPES.TRANSLATE;
    if (keys.has('rotation')) return ANIMATION_TYPES.ROTATE;
    if (keys.has('blur')) return ANIMATION_TYPES.BLUR;
    if (keys.has('glow')) return ANIMATION_TYPES.GLOW;
    return ANIMATION_TYPES.FADE;
}

/** Build one animation from [time, props, easing?] tuples. */
function anim(frames, { at = 0, easing = 'easeOutCubic', anchor = 'in', verb = null } = {}) {
    const keyframes = frames.map(([t, props, e]) => createKeyframe(round3(t), props, e));
    const duration = keyframes.reduce((m, k) => Math.max(m, k.time), 0);
    const props = keyframes.flatMap(k => Object.keys(k.properties));
    return createAnimation({
        type: typeFor(props), startTime: round3(at), duration, easing, anchor,
        presetId: verb ? `composed:${verb}` : null, keyframes,
    });
}

/** Evenly spaced keyframes for a looping hold (float, breathe, sway). */
function loopFrames(duration, period, fn) {
    const span = Math.max(0.2, duration);
    const step = Math.max(0.1, period / 4, span / (LIMITS.maxKeyframes - 1));
    const frames = [];
    for (let t = 0; t <= span + 1e-6 && frames.length < LIMITS.maxKeyframes; t += step) {
        frames.push([t, fn((t / period) * Math.PI * 2)]);
    }
    return frames;
}

/** Alternating, decaying offsets: shake, wobble, glitch. */
function decaying(duration, n, amp, prop) {
    const frames = [];
    for (let i = 0; i <= n; i++) {
        frames.push([(duration * i) / n, { [prop]: i === n ? 0 : (i % 2 ? amp : -amp) * (1 - i / n) }]);
    }
    return frames;
}

// ─── The verb vocabulary ────────────────────────────────────────────────────
//
// Each verb: { group, describe, build(ctx) → Animation[] }.
// ctx = { at, duration, energy (0..1), dir, kind, easing? }.
// Entrances own opacity. Emphasis and hold verbs never touch opacity, so they
// can play mid-clip on a layer that is already visible.

export const VERBS = {
    // ── Entrances ──
    'fade-in': {
        group: 'in', describe: 'Soft opacity fade.',
        build: ({ at, duration, easing }) => [anim([[0, { opacity: 0 }], [duration, { opacity: 1 }]], { at, easing: easing || 'easeOutSine', verb: 'fade-in' })],
    },
    'rise-in': {
        group: 'in', describe: 'Rises into place while fading in and settles on a spring.',
        build: ({ at, duration, energy, dir, easing }) => {
            const d = lerp(4, 16, energy);
            const v = dir || DIRS.up;
            return [
                anim([[0, { x: v.x * d, y: v.y * d }], [duration, { x: 0, y: 0 }]], { at, easing: easing || 'spring', verb: 'rise-in' }),
                anim([[0, { opacity: 0 }], [duration * 0.5, { opacity: 1 }]], { at, easing: 'easeOutSine', verb: 'rise-in' }),
            ];
        },
    },
    'drop-in': {
        group: 'in', describe: 'Falls from above and bounces to rest.',
        build: ({ at, duration, energy, easing }) => [
            anim([[0, { y: -lerp(10, 40, energy) }], [duration, { y: 0 }]], { at, easing: easing || 'springWobbly', verb: 'drop-in' }),
            anim([[0, { opacity: 0 }], [Math.min(0.12, duration * 0.3), { opacity: 1 }]], { at, easing: 'linear', verb: 'drop-in' }),
        ],
    },
    'slide-in': {
        group: 'in', describe: 'Slides in from a side (direction) and stops smoothly.',
        build: ({ at, duration, energy, dir, easing }) => {
            const v = dir || DIRS.right;
            const d = lerp(15, 60, energy);
            return [
                anim([[0, { x: v.x * d, y: v.y * d }], [duration, { x: 0, y: 0 }]], { at, easing: easing || 'easeOutExpo', verb: 'slide-in' }),
                anim([[0, { opacity: 0 }], [duration * 0.4, { opacity: 1 }]], { at, easing: 'linear', verb: 'slide-in' }),
            ];
        },
    },
    'slam-in': {
        group: 'in', describe: 'Big impact: starts oversized and blurred, slams down to size.',
        build: ({ at, duration, energy, easing }) => [
            anim([[0, { scale: lerp(1.6, 2.6, energy) }], [duration * 0.55, { scale: 0.94 }], [duration, { scale: 1 }, 'springSnappy']], { at, easing: easing || 'easeInExpo', verb: 'slam-in' }),
            anim([[0, { blur: lerp(6, 18, energy), opacity: 0 }], [duration * 0.5, { blur: 0, opacity: 1 }]], { at, easing: 'easeInCubic', verb: 'slam-in' }),
        ],
    },
    'pop-in': {
        group: 'in', describe: 'Springy scale-up from small with a slight overshoot.',
        build: ({ at, duration, energy, easing }) => [
            anim([[0, { scale: lerp(0.6, 0.2, energy) }], [duration, { scale: 1 }]], { at, easing: easing || (energy > 0.6 ? 'springWobbly' : 'springGentle'), verb: 'pop-in' }),
            anim([[0, { opacity: 0 }], [duration * 0.25, { opacity: 1 }]], { at, easing: 'linear', verb: 'pop-in' }),
        ],
    },
    'zoom-in': {
        group: 'in', describe: 'Cinematic zoom from slightly large, pulling focus.',
        build: ({ at, duration, energy, easing }) => [
            anim([[0, { scale: lerp(1.15, 1.6, energy), blur: lerp(4, 14, energy), opacity: 0 }], [duration, { scale: 1, blur: 0, opacity: 1 }]], { at, easing: easing || 'easeOutExpo', verb: 'zoom-in' }),
        ],
    },
    'whip-in': {
        group: 'in', describe: 'Very fast whip from the side with motion blur.',
        build: ({ at, duration, energy, dir, easing }) => {
            const v = dir || DIRS.right;
            const d = lerp(40, 90, energy);
            return [anim([[0, { x: (v.x || -1) * d, blur: lerp(14, 30, energy), opacity: 0 }], [duration * 0.15, { opacity: 1 }], [duration, { x: 0, blur: 0, opacity: 1 }]], { at, easing: easing || 'easeOutExpo', verb: 'whip-in' })];
        },
    },
    'swing-in': {
        group: 'in', describe: 'Swings in on a rotation and settles like a hanging sign.',
        build: ({ at, duration, energy, easing }) => [
            anim([[0, { rotation: -lerp(12, 35, energy) }], [duration, { rotation: 0 }]], { at, easing: easing || 'springWobbly', verb: 'swing-in' }),
            anim([[0, { opacity: 0 }], [duration * 0.3, { opacity: 1 }]], { at, easing: 'linear', verb: 'swing-in' }),
        ],
    },
    'spin-in': {
        group: 'in', describe: 'Spins and scales up from nothing.',
        build: ({ at, duration, energy, easing }) => [
            anim([[0, { rotation: -lerp(90, 360, energy), scale: 0.2, opacity: 0 }], [duration, { rotation: 0, scale: 1, opacity: 1 }]], { at, easing: easing || 'backOut', verb: 'spin-in' }),
        ],
    },
    'blur-in': {
        group: 'in', describe: 'Comes into focus from a soft blur. Elegant.',
        build: ({ at, duration, energy, easing }) => [
            anim([[0, { blur: lerp(8, 24, energy), opacity: 0, scale: 1.04 }], [duration, { blur: 0, opacity: 1, scale: 1 }]], { at, easing: easing || 'easeOutSine', verb: 'blur-in' }),
        ],
    },
    'typewriter': {
        group: 'in', describe: 'Text types on character by character.',
        build: ({ at, duration, easing }) => [anim([[0, { reveal: 0 }], [duration, { reveal: 1 }]], { at, easing: easing || 'linear', verb: 'typewriter' })],
    },
    'word-reveal': {
        group: 'in', describe: 'Text reveals progressively with a soft ease.',
        build: ({ at, duration, easing }) => [
            anim([[0, { reveal: 0, opacity: 0 }], [Math.min(0.15, duration * 0.3), { opacity: 1 }], [duration, { reveal: 1, opacity: 1 }]], { at, easing: easing || 'easeOutCubic', verb: 'word-reveal' }),
        ],
    },
    'glitch-in': {
        group: 'in', describe: 'Digital glitch: jittering position and flickering opacity, then locks.',
        build: ({ at, duration, energy }) => {
            const j = lerp(1.5, 5, energy);
            const n = 6;
            const frames = [];
            for (let i = 0; i <= n; i++) {
                const last = i === n;
                frames.push([(duration * i) / n, {
                    x: last ? 0 : (i % 2 ? j : -j) * (1 - i / n),
                    opacity: last ? 1 : (i % 2 ? 0.35 : 1),
                    blur: last ? 0 : (i % 3 === 0 ? 3 : 0),
                }]);
            }
            return [anim(frames, { at, easing: 'steps(1)', verb: 'glitch-in' })];
        },
    },

    // ── Emphasis (never touches opacity) ──
    'punch': {
        group: 'emphasis', describe: 'Quick scale punch on a word or beat.',
        build: ({ at, duration, energy, easing }) => [
            anim([[0, { scale: 1 }], [duration * 0.3, { scale: lerp(1.08, 1.25, energy) }, 'easeOutExpo'], [duration, { scale: 1 }, easing || 'springSnappy']], { at, verb: 'punch' }),
        ],
    },
    'pulse': {
        group: 'emphasis', describe: 'Two soft pulses, like a heartbeat.',
        build: ({ at, duration, energy }) => {
            const s = lerp(1.04, 1.12, energy);
            return [anim([[0, { scale: 1 }], [duration * 0.2, { scale: s }], [duration * 0.4, { scale: 1 }], [duration * 0.6, { scale: s }], [duration, { scale: 1 }]], { at, easing: 'easeInOutSine', verb: 'pulse' })];
        },
    },
    'shake': {
        group: 'emphasis', describe: 'Decaying horizontal shake. Impact, error, surprise.',
        build: ({ at, duration, energy }) => [anim(decaying(duration, 8, lerp(0.8, 3, energy), 'x'), { at, easing: 'easeInOutSine', verb: 'shake' })],
    },
    'wobble': {
        group: 'emphasis', describe: 'Playful decaying rotation wobble.',
        build: ({ at, duration, energy }) => [anim(decaying(duration, 6, lerp(4, 12, energy), 'rotation'), { at, easing: 'easeInOutSine', verb: 'wobble' })],
    },
    'nod': {
        group: 'emphasis', describe: 'Small vertical dip and return.',
        build: ({ at, duration, energy }) => [anim([[0, { y: 0 }], [duration * 0.35, { y: lerp(1, 3, energy) }], [duration, { y: 0 }, 'springGentle']], { at, easing: 'easeOutCubic', verb: 'nod' })],
    },
    'flash': {
        group: 'emphasis', describe: 'Glow flash that fades back.',
        build: ({ at, duration, energy }) => [anim([[0, { glow: 0 }], [duration * 0.2, { glow: lerp(12, 36, energy) }], [duration, { glow: 0 }]], { at, easing: 'easeOutCubic', verb: 'flash' })],
    },
    'jiggle': {
        group: 'emphasis', describe: 'Squash-and-stretch style jiggle.',
        build: ({ at, duration, energy }) => {
            const s = lerp(0.06, 0.16, energy);
            return [anim([[0, { scale: 1, rotation: 0 }], [duration * 0.25, { scale: 1 + s, rotation: -3 }], [duration * 0.5, { scale: 1 - s / 2, rotation: 2 }], [duration, { scale: 1, rotation: 0 }, 'springWobbly']], { at, easing: 'easeOutCubic', verb: 'jiggle' })];
        },
    },
    'bounce': {
        group: 'emphasis', describe: 'Hops up and lands on a spring.',
        build: ({ at, duration, energy }) => [anim([[0, { y: 0 }], [duration * 0.35, { y: -lerp(3, 9, energy) }, 'easeOutQuart'], [duration, { y: 0 }, 'springWobbly']], { at, verb: 'bounce' })],
    },
    'follow-through': {
        group: 'emphasis',
        describe: 'The move does not stop dead: it overshoots and settles, with the parts trailing the body.',
        // The principle, as one layer can express it. Placed right after an
        // entrance it is the entrance's settle; placed after a camera move
        // it is the weight catching up. The counter-rotation is what makes
        // it read as PARTS trailing rather than the whole thing wobbling.
        build: ({ at, duration, energy, easing }) => {
            const d = lerp(1.2, 3.5, energy);
            const r = lerp(0.8, 2.4, energy);
            return [anim([
                [0, { y: 0, rotation: 0 }],
                [duration * 0.3, { y: -d, rotation: -r }, 'easeOutQuad'],
                [duration * 0.62, { y: d * 0.38, rotation: r * 0.35 }, 'easeInOutSine'],
                [duration, { y: 0, rotation: 0 }, easing || 'springGentle'],
            ], { at, verb: 'follow-through' })];
        },
    },

    // ── Holds (play across a span) ──
    'float': {
        group: 'hold', describe: 'Gentle up and down float across the hold.',
        build: ({ at, duration, energy }) => [anim(loopFrames(duration, 2.4, p => ({ y: Math.sin(p) * lerp(0.5, 1.8, energy) })), { at, easing: 'easeInOutSine', verb: 'float' })],
    },
    'breathe': {
        group: 'hold', describe: 'Slow scale breathing.',
        build: ({ at, duration, energy }) => [anim(loopFrames(duration, 3, p => ({ scale: 1 + (Math.sin(p) + 1) * lerp(0.01, 0.03, energy) })), { at, easing: 'easeInOutSine', verb: 'breathe' })],
    },
    'sway': {
        group: 'hold', describe: 'Slow rotation sway.',
        build: ({ at, duration, energy }) => [anim(loopFrames(duration, 3.2, p => ({ rotation: Math.sin(p) * lerp(1, 4, energy) })), { at, easing: 'easeInOutSine', verb: 'sway' })],
    },
    'drift': {
        group: 'hold', describe: 'Slow constant drift in a direction, for a parallax feel.',
        build: ({ at, duration, energy, dir }) => {
            const v = dir || DIRS.left;
            const d = lerp(1, 5, energy);
            return [anim([[0, { x: 0, y: 0 }], [Math.max(0.2, duration), { x: -v.x * d, y: -v.y * d }]], { at, easing: 'linear', verb: 'drift' })];
        },
    },
    'push-in': {
        group: 'hold', describe: 'Slow cinematic scale push across the hold (Ken Burns).',
        build: ({ at, duration, energy }) => [anim([[0, { scale: 1 }], [Math.max(0.2, duration), { scale: lerp(1.05, 1.18, energy) }]], { at, easing: 'easeInOutSine', verb: 'push-in' })],
    },

    // ── Exits (anchored to the clip end; `at` is an offset from the end) ──
    'fade-out': {
        group: 'out', describe: 'Soft fade away.',
        build: ({ at, duration, easing }) => [anim([[0, { opacity: 1 }], [duration, { opacity: 0 }]], { at, easing: easing || 'easeInSine', anchor: 'out', verb: 'fade-out' })],
    },
    'sink-out': {
        group: 'out', describe: 'Sinks down while fading.',
        build: ({ at, duration, energy, easing }) => [anim([[0, { y: 0, opacity: 1 }], [duration, { y: lerp(4, 14, energy), opacity: 0 }]], { at, easing: easing || 'easeInCubic', anchor: 'out', verb: 'sink-out' })],
    },
    'fly-out': {
        group: 'out', describe: 'Accelerates off-frame with motion blur (direction).',
        build: ({ at, duration, energy, dir, easing }) => {
            const v = dir || DIRS.left;
            const d = lerp(40, 100, energy);
            return [anim([[0, { x: 0, y: 0, blur: 0, opacity: 1 }], [duration, { x: -v.x * d, y: -v.y * d, blur: lerp(10, 26, energy), opacity: 0 }]], { at, easing: easing || 'easeInExpo', anchor: 'out', verb: 'fly-out' })];
        },
    },
    'shrink-out': {
        group: 'out', describe: 'Winds back, then shrinks away.',
        build: ({ at, duration, easing }) => [anim([[0, { scale: 1, opacity: 1 }], [duration, { scale: 0, opacity: 0 }]], { at, easing: easing || 'backIn', anchor: 'out', verb: 'shrink-out' })],
    },
    'blur-out': {
        group: 'out', describe: 'Defocuses and fades.',
        build: ({ at, duration, energy, easing }) => [anim([[0, { blur: 0, opacity: 1 }], [duration, { blur: lerp(8, 24, energy), opacity: 0 }]], { at, easing: easing || 'easeInSine', anchor: 'out', verb: 'blur-out' })],
    },
    'whip-out': {
        group: 'out', describe: 'Very fast whip off-frame.',
        build: ({ at, duration, energy, dir }) => {
            const v = dir || DIRS.left;
            const d = lerp(50, 110, energy);
            return [anim([[0, { x: 0, blur: 0, opacity: 1 }], [duration, { x: -(v.x || 1) * d, blur: lerp(16, 34, energy), opacity: 0 }]], { at, easing: 'easeInExpo', anchor: 'out', verb: 'whip-out' })];
        },
    },
};

/** Default beat length per verb group (holds fill the remaining clip). */
const DEFAULT_DURATION = { in: 0.5, emphasis: 0.45, hold: null, out: 0.35 };

/** Catalog for UIs and LLM prompts: [{ verb, group, describe }]. */
export function verbCatalog() {
    return Object.entries(VERBS).map(([verb, v]) => ({ verb, group: v.group, describe: v.describe }));
}

// ─── Sanitisation ───────────────────────────────────────────────────────────

/**
 * Clean raw animations (from an LLM or a saved project). Returns only valid,
 * clamped Animation objects. Never throws.
 */
export function sanitizeAnimations(raw, { duration = 3, kind } = {}) {
    if (!Array.isArray(raw)) return [];
    const clipDur = Math.max(0.1, Number(duration) || 3);
    const out = [];
    for (const a of raw.slice(0, LIMITS.maxAnimations)) {
        if (!a || typeof a !== 'object' || !Array.isArray(a.keyframes)) continue;
        const keyframes = [];
        for (const k of a.keyframes.slice(0, LIMITS.maxKeyframes)) {
            if (!k || typeof k !== 'object') continue;
            const src = k.properties && typeof k.properties === 'object' ? k.properties : k;
            const props = {};
            for (const p of ANIMATABLE_PROPS) {
                if (src[p] === undefined) continue;
                if (kind === LAYER_KINDS.VIDEO && (p === 'opacity' || p === 'reveal')) continue;
                const [lo, hi] = LIMITS.ranges[p];
                const v = clampNum(src[p], lo, hi, null);
                if (v !== null) props[p] = round3(v);
            }
            if (Object.keys(props).length === 0) continue;
            const t = clampNum(k.time, 0, clipDur, null);
            if (t === null) continue;
            const easingByProperty = Object.fromEntries(Object.entries(k.easingByProperty || {})
                .filter(([property, easing]) => props[property] !== undefined && isKnownEasing(easing)));
            keyframes.push(createKeyframe(round3(t), props, isKnownEasing(k.easing) ? k.easing : undefined, easingByProperty));
        }
        if (keyframes.length === 0) continue;
        keyframes.sort((x, y) => x.time - y.time);
        const span = keyframes[keyframes.length - 1].time;
        const startTime = clampNum(a.startTime, 0, clipDur, 0);
        out.push({
            ...createAnimation({
                type: Object.values(ANIMATION_TYPES).includes(a.type) ? a.type : typeFor(keyframes.flatMap(k => Object.keys(k.properties))),
                startTime: Math.min(startTime, Math.max(0, clipDur - span)),
                duration: Math.min(span, clipDur),
                easing: isKnownEasing(a.easing) ? a.easing : 'easeOutCubic',
                anchor: a.anchor === 'out' ? 'out' : 'in',
                presetId: typeof a.presetId === 'string' ? a.presetId.slice(0, 60) : null,
                keyframes,
            }),
            ...(typeof a.source === 'string' ? { source: a.source.slice(0, 40) } : {}),
        });
    }
    return out;
}

function dirOf(value) {
    const d = String(value || '').toLowerCase();
    if (DIRS[d]) return DIRS[d];
    if (/top|above/.test(d)) return DIRS.down;
    if (/bottom|below/.test(d)) return DIRS.up;
    return null;
}

/**
 * Compile a motion script into Animation[].
 *
 * @param {{beats?: object[], animations?: object[]}} script
 * @param {{duration:number, kind?:string, source?:string}} opts
 * @returns {{animations: object[], dropped: string[]}}
 */
export function composeMotion(script, { duration = 3, kind, source = COMPOSED } = {}) {
    const clipDur = Math.max(0.1, Number(duration) || 3);
    const dropped = [];
    const built = [];
    const beats = Array.isArray(script?.beats) ? script.beats.slice(0, LIMITS.maxBeats) : [];

    for (const beat of beats) {
        const name = String(beat?.verb || '').toLowerCase().trim();
        const verb = VERBS[name];
        if (!verb) { dropped.push(name || '(empty)'); continue; }
        if (kind === LAYER_KINDS.VIDEO && (verb.group === 'in' || verb.group === 'out')) {
            // Fading a whole video layer in or out mid-edit reads as a glitch.
            // Video layers only get camera-style verbs.
            dropped.push(`${name} (not for video)`);
            continue;
        }
        const energy = clampNum(beat.energy, 0, 1, 0.5);
        const want = Number(beat.duration);
        const at = clampNum(beat.at, 0, clipDur, 0);
        let d;
        if (verb.group === 'hold') {
            d = Number.isFinite(want) && want > 0 ? want : Math.max(0.5, clipDur - at);
        } else {
            d = Number.isFinite(want) && want > 0 ? want : DEFAULT_DURATION[verb.group];
            // Short clips: entrance and exit each stay inside 40 % of the clip.
            d = Math.min(d, Math.max(0.12, clipDur * 0.4));
        }
        d = Math.min(d, Math.max(0.1, clipDur - at));
        const easing = isKnownEasing(beat.easing) ? beat.easing : undefined;
        const dir = dirOf(beat.direction);
        try {
            // ANTICIPATION (R103 round F): a small move against the main move,
            // just before it. Opt-in per beat, and only where the principle
            // applies — see MotionPrinciples.ANTICIPATION, which records a
            // reason for every verb that cannot have one rather than leaving
            // the gap to be rediscovered.
            if (beat.anticipate === true || (Number.isFinite(Number(beat.anticipate)) && Number(beat.anticipate) > 0)) {
                const strength = beat.anticipate === true ? 1 : clampNum(beat.anticipate, 0, 1, 1);
                const a = anticipationFor(name, { at, duration: round3(d), energy: energy * strength, dir, group: verb.group });
                if (a) {
                    built.push(anim(a.frames, { at: a.at, easing: a.easing, anchor: a.anchor, verb: `${name}-anticipate` }));
                }
            }
            built.push(...verb.build({ at, duration: round3(d), energy, dir, kind, easing }));
        } catch {
            dropped.push(name);
        }
    }

    let all = [...built, ...sanitizeAnimations(script?.animations, { duration: clipDur, kind })];
    if (kind === LAYER_KINDS.VIDEO) all = sanitizeAnimations(all, { duration: clipDur, kind });
    all = all.slice(0, LIMITS.maxAnimations);

    // Final gate: the same validator the rest of the engine trusts.
    const validationKind = Object.values(LAYER_KINDS).includes(kind) ? kind : LAYER_KINDS.TEXT;
    const animations = all
        .filter(a => validateMotionLayer({ id: 'probe', kind: validationKind, startTime: 0, duration: clipDur, animations: [a] }).valid)
        .map(a => ({ ...a, source }));

    return { animations, dropped };
}

// ─── Deterministic director (no LLM needed) ─────────────────────────────────

/** Moods → a full beat program. Used when no LLM is configured or it fails. */
export const MOODS = {
    punchy:    ({ d }) => [{ verb: 'slam-in', energy: 0.8 }, { verb: 'follow-through', at: 0.42, energy: 0.6, duration: 0.5 }, { verb: 'punch', at: Math.min(d * 0.5, 1.6), energy: 0.7, anticipate: true }, { verb: 'whip-out', energy: 0.7, anticipate: true }],
    elegant:   ({ d }) => [{ verb: 'blur-in', energy: 0.5, duration: 0.7 }, { verb: 'breathe', at: 0.7, energy: 0.3, duration: Math.max(0.5, d - 1.1) }, { verb: 'fade-out', duration: 0.45 }],
    cinematic: ({ d }) => [{ verb: 'zoom-in', energy: 0.5, duration: 0.8 }, { verb: 'push-in', at: 0.8, energy: 0.4, duration: Math.max(0.5, d - 1.2) }, { verb: 'blur-out', duration: 0.4 }],
    playful:   ({ d }) => [{ verb: 'pop-in', energy: 0.8 }, { verb: 'bounce', at: 0.5, energy: 0.5, duration: 0.45, anticipate: true }, { verb: 'wobble', at: Math.min(d * 0.45, 1.4), energy: 0.6 }, { verb: 'shrink-out' }],
    techy:     ({ d }) => [{ verb: 'glitch-in', energy: 0.6, duration: 0.45 }, { verb: 'flash', at: Math.min(d * 0.5, 1.5), energy: 0.5 }, { verb: 'fade-out', duration: 0.2 }],
    calm:      ({ d }) => [{ verb: 'fade-in', duration: 0.6 }, { verb: 'float', at: 0.6, energy: 0.4, duration: Math.max(0.5, d - 1) }, { verb: 'fade-out', duration: 0.4 }],
    bold:      ({ d }) => [{ verb: 'drop-in', energy: 0.7 }, { verb: 'follow-through', at: 0.45, energy: 0.7, duration: 0.55 }, { verb: 'pulse', at: Math.min(d * 0.5, 1.6), energy: 0.6, anticipate: true }, { verb: 'sink-out', anticipate: true }],
};

const MOOD_WORDS = [
    [/punchy|energetic|hype|aggressive|impact|dynamic|viral|tiktok/, 'punchy'],
    [/elegant|classy|premium|luxury|smooth|sleek|minimal/, 'elegant'],
    [/cinematic|epic|movie|trailer|dramatic/, 'cinematic'],
    [/playful|fun|cute|bouncy|cartoon/, 'playful'],
    [/\btech|digital|futuristic|cyber|hacker|\bcode/, 'techy'],
    [/calm|soft|gentle|chill|relaxed|subtle/, 'calm'],
    [/\bbold|strong|heavy|loud/, 'bold'],
];

// Explicit, tested motion recipes are the offline knowledge base. Each recipe
// contains a small coordinated phrase rather than independent preset picks.
const RULE_RECIPES = Object.freeze({
    title: {
        punchy: [{ verb: 'rise-in', energy: 0.62 }, { verb: 'punch', at: 0.72, energy: 0.5 }],
        elegant: [{ verb: 'blur-in', energy: 0.34 }, { verb: 'breathe', at: 0.65, energy: 0.22 }],
        cinematic: [{ verb: 'zoom-in', energy: 0.38 }, { verb: 'push-in', at: 0.72, energy: 0.3 }],
        playful: [{ verb: 'pop-in', energy: 0.58 }, { verb: 'bounce', at: 0.58, energy: 0.42 }],
        techy: [{ verb: 'glitch-in', energy: 0.38 }, { verb: 'pulse', at: 0.62, energy: 0.3 }],
        calm: [{ verb: 'fade-in', energy: 0.2 }, { verb: 'breathe', at: 0.55, energy: 0.18 }],
        bold: [{ verb: 'drop-in', energy: 0.58 }, { verb: 'follow-through', at: 0.42, energy: 0.45 }],
    },
    caption: {
        punchy: [{ verb: 'rise-in', energy: 0.32 }], elegant: [{ verb: 'fade-in', energy: 0.2 }],
        cinematic: [{ verb: 'fade-in', energy: 0.24 }], playful: [{ verb: 'pop-in', energy: 0.34 }],
        techy: [{ verb: 'word-reveal', energy: 0.25 }], calm: [{ verb: 'fade-in', energy: 0.16 }],
        bold: [{ verb: 'rise-in', energy: 0.38 }],
    },
    image: {
        punchy: [{ verb: 'push-in', energy: 0.48 }], elegant: [{ verb: 'drift', energy: 0.3 }],
        cinematic: [{ verb: 'push-in', energy: 0.4 }], playful: [{ verb: 'drift', energy: 0.34 }],
        techy: [{ verb: 'push-in', energy: 0.3 }], calm: [{ verb: 'drift', energy: 0.22 }],
        bold: [{ verb: 'push-in', energy: 0.54 }],
    },
    video: {
        punchy: [{ verb: 'push-in', energy: 0.45 }], elegant: [{ verb: 'drift', energy: 0.24 }],
        cinematic: [{ verb: 'push-in', energy: 0.38 }], playful: [{ verb: 'drift', energy: 0.28 }],
        techy: [{ verb: 'push-in', energy: 0.32 }], calm: [{ verb: 'drift', energy: 0.2 }],
        bold: [{ verb: 'push-in', energy: 0.52 }],
    },
    sticker: {
        punchy: [{ verb: 'pop-in', energy: 0.52 }, { verb: 'pulse', at: 0.65, energy: 0.35 }],
        elegant: [{ verb: 'fade-in', energy: 0.25 }], cinematic: [{ verb: 'rise-in', energy: 0.32 }],
        playful: [{ verb: 'pop-in', energy: 0.62 }, { verb: 'bounce', at: 0.55, energy: 0.42 }],
        techy: [{ verb: 'pop-in', energy: 0.38 }], calm: [{ verb: 'fade-in', energy: 0.18 }],
        bold: [{ verb: 'drop-in', energy: 0.52 }, { verb: 'pulse', at: 0.68, energy: 0.32 }],
    },
});

const ACTION_PATTERNS = [
    ['in', /\b(?:slam(?:s|med)?\s*(?:in|on)?|claque(?:r|z)?|surgi(?:t|r)|pop(?:s|ped)?\s*(?:in|up|on)|jailli(?:t|r)|drop(?:s|ped)?\s*in|tombe(?:r)?\s*(?:du|de)\s*(?:haut|dessus)|rise(?:s|n)?\s*(?:in|up)?|monte(?:r)?|slide(?:s|d)?\s*in|glisse(?:r)?|whip(?:s|ped)?\s*in|swing(?:s|ing)?\s*in|spin(?:s|ning)?\s*in|blur(?:s|red)?\s*in|floute(?:r)?\s*(?:en\s*)?apparition|typewriter|typing|type(?:s|d)?\s*(?:in|on)|glitch(?:es|ed)?\s*in|zoom(?:s|ed)?\s*in|fade(?:s|d)?\s*in|fade\s*in|fondu\s*(?:entrant|en\s*entree)|appar(?:ais|ait|aitre|aisse|aissent)|reveal(?:s|ed)?|word\s*by\s*word)\b/gu,
        { slam: 'slam-in', claque: 'slam-in', surg: 'rise-in', pop: 'pop-in', jaill: 'pop-in', drop: 'drop-in', tomb: 'drop-in', rise: 'rise-in', mont: 'rise-in', slide: 'slide-in', gliss: 'slide-in', whip: 'whip-in', swing: 'swing-in', spin: 'spin-in', blur: 'blur-in', flout: 'blur-in', typewriter: 'typewriter', typing: 'typewriter', type: 'typewriter', glitch: 'glitch-in', zoom: 'zoom-in', fade: 'fade-in', fondu: 'fade-in', appar: 'fade-in', reveal: 'word-reveal' }],
    ['emphasis', /\b(?:follow\s*through|overshoot|settle(?:s|d)?|catch(?:es)?\s*up|punch(?:es|ed)?|pulse(?:s|d)?|heartbeat|shake(?:s|n)?|shaking|wobble(?:s|d)?|flash(?:es|ed)?|glow(?:s|ed)?|jiggle(?:s|d)?|squash(?:es|ed)?|bounce(?:s|d)?|bounc(?:e|es|ed)|nod(?:s|ded)?|rebondit|rebond|tremble|oscille(?:r)?|pulse|souligne)\b/gu,
        { follow: 'follow-through', overshoot: 'follow-through', settle: 'follow-through', catch: 'follow-through', punch: 'punch', pulse: 'pulse', heartbeat: 'pulse', shake: 'shake', shaking: 'shake', wobble: 'wobble', flash: 'flash', glow: 'flash', jiggle: 'jiggle', squash: 'jiggle', bounce: 'bounce', bounc: 'bounce', nod: 'nod', rebond: 'bounce', tremble: 'shake', oscill: 'wobble', soulign: 'flash' }],
    ['hold', /\b(?:float(?:s|ing|ed)?|drift(?:s|ing|ed)?|breath(?:e|es|ing)?|sway(?:s|ing|ed)?|parallax|ken\s*burns|push\s*in|slow\s*zoom|flotte(?:r)?|derive(?:r)?|respire(?:r)?|balance(?:r)?|pan(?:s|ning)?\s*(?:left|right|up|down)|zooms?\s*(?:lentement|slowly))\b/gu,
        { float: 'float', drift: 'drift', breath: 'breathe', sway: 'sway', parallax: 'drift', ken: 'push-in', push: 'push-in', slow: 'push-in', flotte: 'float', derive: 'drift', respir: 'breathe', balance: 'sway', pan: 'drift', zoom: 'push-in' }],
    ['out', /\b(?:fly\s*(?:out|off|away)|whip\s*(?:out|off|away)|shrink(?:s|ing)?\s*(?:out|away)?|sink(?:s|ing)?\s*(?:out|away)?|blur\s*(?:out|away)|defocus|fade\s*(?:out|away)|fade\s*out|fondu\s*(?:sortant|de\s*sortie)|disparai(?:t|sse)|sort(?:ir|ie)|s'envole|s'efface)\b/gu,
        { fly: 'fly-out', whip: 'whip-out', shrink: 'shrink-out', sink: 'sink-out', blur: 'blur-out', defocus: 'blur-out', fade: 'fade-out', fondu: 'fade-out', disparai: 'fade-out', sort: 'fade-out', "s'envole": 'fly-out', "s'efface": 'fade-out' }],
];

function normalizedBrief(value) {
    return String(value || '').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’]/g, "'");
}

function actionVerb(group, match, map) {
    const token = match[0].split(/\s+/)[0];
    const stem = Object.keys(map).find(key => token.startsWith(key));
    return map[stem || token] || null;
}

function parsedActions(text) {
    const found = [];
    for (const [group, pattern, map] of ACTION_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
            const verb = actionVerb(group, match, map);
            if (verb) found.push({ group, verb, index: match.index, phrase: match[0] });
        }
    }
    found.sort((a, b) => a.index - b.index);
    return found.slice(0, LIMITS.maxBeats);
}

function hashSeed(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
}

function inferLayerRole(layer = {}) {
    const identity = normalizedBrief(`${layer.role || ''} ${layer.id || ''} ${layer.name || ''}`);
    if (layer.kind === 'caption' || /caption|subtitle|subtitle|sous.titre/.test(identity)) return 'caption';
    if (/background|backdrop|plate|panel|fond|arriere.plan/.test(identity)) return 'backdrop';
    if (/accent|underline|underline|decoration|accent|decoration/.test(identity)) return 'decoration';
    if (/logo|brand/.test(identity)) return 'logo';
    if (/cta|button|call.to.action/.test(identity)) return 'cta';
    if (/title|headline|hook|titre|accroche/.test(identity)) return 'title';
    return layer.kind === 'video' ? 'video' : layer.kind === 'image' ? 'image' : layer.kind === 'sticker' || layer.kind === 'shape' ? 'sticker' : 'title';
}

function inferMood(s) {
    const explicit = MOOD_WORDS.find(([re]) => re.test(s));
    if (explicit) return explicit[1];
    if (/\b(?:podcast|interview|talking head|conversation|calm|soft|gentle|chill|relaxed|subtle|doux|calme|entretien|conversation)\b/.test(s)) return 'calm';
    if (/\b(?:premium|luxury|elegant|elegance|minimal|clean|editorial|raffine|elegant)\b/.test(s)) return 'elegant';
    if (/\b(?:cinematic|cinema|film|trailer|dramatic|cinematique|dramatique)\b/.test(s)) return 'cinematic';
    if (/\b(?:playful|fun|cute|cartoon|funny|amusant|ludique|marrant)\b/.test(s)) return 'playful';
    if (/\b(?:tech|digital|futuristic|cyber|hacker|code|numerique|futuriste)\b/.test(s)) return 'techy';
    if (/\b(?:bold|strong|heavy|loud|impact|fort|puissant)\b/.test(s)) return 'bold';
    return null;
}

function energyFromBrief(s) {
    if (/\b(?:very|super|really|extremely|huge|massive|crazy|tres|hyper|extremement|enorme|tres fort)\b/.test(s)) return 0.9;
    if (/\b(?:subtle|slight|slightly|light|little|gentle|soft|discret|leger|doucement|doux|calme)\b/.test(s)) return 0.28;
    return 0.55;
}

export const VIDEO_SAFE_VERBS = new Set(['punch', 'pulse', 'shake', 'wobble', 'nod', 'flash', 'jiggle', 'bounce', 'float', 'breathe', 'sway', 'drift', 'push-in']);

function fitRecipeToLayer(beats, kind, role, duration) {
    const isVideo = kind === 'video';
    const canRevealText = kind === 'text' || kind === 'caption';
    let output = beats.filter(beat => !isVideo || VIDEO_SAFE_VERBS.has(beat.verb));
    if (!canRevealText) output = output.filter(beat => beat.verb !== 'typewriter' && beat.verb !== 'word-reveal');
    if (role === 'backdrop') output = output.map(beat => ({ ...beat, verb: ['slam-in', 'drop-in', 'whip-in', 'glitch-in'].includes(beat.verb) ? 'fade-in' : beat.verb, energy: Math.min(0.32, beat.energy ?? 0.3) }));
    if (role === 'decoration' && output.some(beat => ['fade-in', 'rise-in', 'pop-in'].includes(beat.verb))) {
        output = output.map(beat => ['fade-in', 'rise-in'].includes(beat.verb) ? { ...beat, verb: 'pop-in', at: Math.max(0.12, Number(beat.at) || 0) } : beat);
    }
    if (role === 'logo') output = output.map(beat => ({ ...beat, verb: ['slam-in', 'whip-in', 'glitch-in', 'spin-in'].includes(beat.verb) ? 'fade-in' : beat.verb, energy: Math.min(0.35, beat.energy ?? 0.3) }));
    if (role === 'cta') output = output.map(beat => beat.verb === 'punch' ? { ...beat, verb: 'pulse' } : beat);
    // Do not spend the whole runtime animating very short layers.
    const maxAt = Math.max(0.1, duration * 0.78);
    output = output.map(beat => ({ ...beat, at: beat.at === undefined ? beat.at : Math.min(maxAt, Math.max(0, Number(beat.at) || 0)) }));
    return output;
}

/**
 * Turn a plain-language brief ("make the title slam in then shake, fade out")
 * into a motion script. Named motions win; otherwise a mood is used.
 */
export function planMotionFromBrief(brief, {
    duration = 3, kind = 'text', role = '', name = '', content = '', editingStyle = '',
    aspectRatio = '16:9', seed = '', layerIndex = 0, layerCount = 1,
} = {}) {
    const s = normalizedBrief(brief);
    const d = Math.max(0.3, Number(duration) || 3);
    const layer = { kind, role, name, content };
    const resolvedRole = inferLayerRole(layer);
    const resolvedKind = kind === 'caption' ? 'caption' : kind === 'video' ? 'video'
        : kind === 'image' ? 'image' : kind === 'sticker' || kind === 'shape' ? 'sticker' : 'text';
    const recipeRole = ['caption', 'video', 'image', 'sticker'].includes(resolvedKind) ? resolvedKind
        : ['backdrop', 'decoration', 'logo', 'cta'].includes(resolvedRole) ? 'sticker' : 'title';
    let mood = inferMood(s) || (resolvedKind === 'video' || ['caption', 'logo', 'backdrop'].includes(resolvedRole) ? 'calm' : 'punchy');
    const style = normalizedBrief(editingStyle);
    if (/podcast|interview|talking.head|entretien/.test(style)) mood = 'calm';
    const energy = Math.min(energyFromBrief(s), /podcast|interview|talking.head|entretien/.test(style) ? 0.4 : 1);
    const explicit = parsedActions(s);
    const anticipated = /anticipat|wind(?:s|ing)? up|winds? back|pulls? back|crouch|coil|lean(?:s|ing)? back|brace|anticipation|prend son elan|recul avant/.test(s);
    const sourceDirection = (s.match(/\b(?:from|depuis|de)\s+(?:(?:the|la|le|les)\s+)?(left|right|top|bottom|above|below|gauche|droite|haut|bas)\b/) || [])[1];
    const toward = { left: 'right', right: 'left', top: 'down', above: 'down', bottom: 'up', below: 'up', gauche: 'right', droite: 'left', haut: 'down', bas: 'up' };
    const layerSeed = hashSeed(`${seed}|${brief}|${resolvedRole}|${resolvedKind}|${layerIndex}`);
    const recipe = RULE_RECIPES[recipeRole]?.[mood] || RULE_RECIPES.title.punchy;
    let beats;
    if (explicit.length) {
        beats = explicit.map((item, index) => {
            const progress = explicit.length > 1 ? index / (explicit.length - 1) : 0;
            const common = { verb: item.verb, energy, ...(anticipated && ['emphasis', 'out'].includes(item.group) ? { anticipate: true } : {}) };
            if (item.group === 'in') return { ...common, at: Math.min(d * 0.6, d * progress), duration: Math.min(0.65, d * 0.24), ...(sourceDirection ? { direction: toward[sourceDirection] } : {}) };
            if (item.group === 'out') return { ...common, at: explicit.length === 1 ? 0 : Math.max(0, d * (1 - progress) * 0.18), duration: Math.min(0.38, d * 0.18), ...(sourceDirection ? { direction: toward[sourceDirection] } : {}) };
            if (item.group === 'hold') return { ...common, at: Math.min(d * 0.55, d * progress), duration: Math.max(0.3, d * (1 - progress - 0.08)), ...(item.verb === 'drift' && (/(?:pan|balanc|drift|derive)/.test(s)) ? { direction: sourceDirection ? toward[sourceDirection] : (layerSeed % 2 ? 'left' : 'right') } : {}) };
            const semanticAt = d * (explicit.length === 1 ? 0.42 : progress);
            const at = item.verb === 'follow-through' ? Math.min(d * 0.2, 0.42) : Math.max(0.12, Math.min(d * 0.76, semanticAt));
            return { ...common, at, duration: Math.min(0.48, d * 0.16) };
        });
    } else {
        const intensityScale = energy / 0.55;
        beats = recipe.map(beat => ({ ...beat, energy: Math.max(0.14, Math.min(0.9, (beat.energy ?? 0.35) * intensityScale)) }));
        // A compact fade completes text/graphic sequences; footage stays
        // continuously visible and uses camera motion only.
        if (!['video', 'image'].includes(resolvedKind) && d >= 1.25 && recipeRole !== 'caption' && recipeRole !== 'video') {
            beats.push({ verb: 'fade-out', duration: Math.min(0.28, d * 0.14), energy: 0.2 });
        }
    }

    beats = fitRecipeToLayer(beats, resolvedKind, resolvedRole, d);
    if (resolvedKind === 'video' && !beats.some(beat => VIDEO_SAFE_VERBS.has(beat.verb))) {
        beats = [{ verb: 'push-in', at: 0, duration: d, energy: Math.min(0.42, energy) }];
    }
    if (layerCount > 1 && ['title', 'caption', 'cta'].includes(resolvedRole)) {
        const stagger = Math.min(0.16, Math.max(0, d * 0.035)) * Math.max(0, Number(layerIndex) || 0);
        beats = beats.map(beat => {
            if (VERBS[beat.verb]?.group === 'in') return { ...beat, at: Math.min(d * 0.24, (Number(beat.at) || 0) + stagger) };
            // Out beats are anchored to the clip end; higher startTime means
            // an earlier exit, so later arrivals get the larger offset.
            if (VERBS[beat.verb]?.group === 'out') return { ...beat, at: Math.min(d * 0.18, stagger) };
            return beat;
        });
    }
    beats = beats.slice(0, LIMITS.maxBeats);
    const dropped = beats.filter(beat => !VERBS[beat.verb]);
    if (dropped.length) beats = beats.filter(beat => VERBS[beat.verb]);
    return { beats, mood, recipe: `${recipeRole}-${mood}`, seed: layerSeed, aspectRatio };
}

/** Coordinate offline motion across a related layer stack with stable variation. */
export function planMotionForLayers(layers, brief, { editingStyle = '', aspectRatio = '16:9', seed = '' } = {}) {
    const list = Array.isArray(layers) ? layers.slice(0, LIMITS.maxBeats) : [];
    const sharedSeed = hashSeed(`${brief}|${editingStyle}|${aspectRatio}|${seed}`);
    return Object.fromEntries(list.map((layer, index) => [layer.id, planMotionFromBrief(brief, {
        duration: layer.duration,
        kind: layer.kind,
        role: layer.role,
        name: layer.name || layer.id,
        content: layer.content,
        editingStyle,
        aspectRatio,
        seed: sharedSeed,
        layerIndex: index,
        layerCount: list.length,
    })]));
}

export default { VERBS, MOODS, LIMITS, COMPOSED, RULE_RECIPES, verbCatalog, sanitizeAnimations, composeMotion, planMotionFromBrief, planMotionForLayers };
