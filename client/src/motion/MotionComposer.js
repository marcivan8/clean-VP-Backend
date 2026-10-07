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

/** Tag on animations written by this module. */
export const COMPOSED = 'composed';

export const LIMITS = Object.freeze({
    maxBeats: 16,
    maxAnimations: 16,
    maxKeyframes: 24,
    /** Safe value range per property. x/y are offsets in % of the frame. */
    ranges: {
        x: [-120, 120], y: [-120, 120], scale: [0, 6], rotation: [-1080, 1080],
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
    if (keys.has('scale')) return ANIMATION_TYPES.SCALE;
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
            keyframes.push(createKeyframe(round3(t), props, isKnownEasing(k.easing) ? k.easing : undefined));
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
        try {
            built.push(...verb.build({ at, duration: round3(d), energy, dir: dirOf(beat.direction), kind, easing }));
        } catch {
            dropped.push(name);
        }
    }

    let all = [...built, ...sanitizeAnimations(script?.animations, { duration: clipDur, kind })];
    if (kind === LAYER_KINDS.VIDEO) all = sanitizeAnimations(all, { duration: clipDur, kind });
    all = all.slice(0, LIMITS.maxAnimations);

    // Final gate: the same validator the rest of the engine trusts.
    const animations = all
        .filter(a => validateMotionLayer({ id: 'probe', kind: LAYER_KINDS.TEXT, startTime: 0, duration: clipDur, animations: [a] }).valid)
        .map(a => ({ ...a, source }));

    return { animations, dropped };
}

// ─── Deterministic director (no LLM needed) ─────────────────────────────────

/** Moods → a full beat program. Used when no LLM is configured or it fails. */
export const MOODS = {
    punchy:    ({ d }) => [{ verb: 'slam-in', energy: 0.8 }, { verb: 'punch', at: Math.min(d * 0.5, 1.6), energy: 0.7 }, { verb: 'whip-out', energy: 0.7 }],
    elegant:   ({ d }) => [{ verb: 'blur-in', energy: 0.5, duration: 0.7 }, { verb: 'breathe', at: 0.7, energy: 0.3, duration: Math.max(0.5, d - 1.1) }, { verb: 'fade-out', duration: 0.45 }],
    cinematic: ({ d }) => [{ verb: 'zoom-in', energy: 0.5, duration: 0.8 }, { verb: 'push-in', at: 0.8, energy: 0.4, duration: Math.max(0.5, d - 1.2) }, { verb: 'blur-out', duration: 0.4 }],
    playful:   ({ d }) => [{ verb: 'pop-in', energy: 0.8 }, { verb: 'wobble', at: Math.min(d * 0.45, 1.4), energy: 0.6 }, { verb: 'shrink-out' }],
    techy:     ({ d }) => [{ verb: 'glitch-in', energy: 0.6, duration: 0.45 }, { verb: 'flash', at: Math.min(d * 0.5, 1.5), energy: 0.5 }, { verb: 'fade-out', duration: 0.2 }],
    calm:      ({ d }) => [{ verb: 'fade-in', duration: 0.6 }, { verb: 'float', at: 0.6, energy: 0.4, duration: Math.max(0.5, d - 1) }, { verb: 'fade-out', duration: 0.4 }],
    bold:      ({ d }) => [{ verb: 'drop-in', energy: 0.7 }, { verb: 'pulse', at: Math.min(d * 0.5, 1.6), energy: 0.6 }, { verb: 'sink-out' }],
};

const ENTRANCE_WORDS = [
    [/\bslam/, 'slam-in'], [/\bpops? (?:in|up|on)|\bpop\b/, 'pop-in'], [/\bdrops? in|\bfall(?:s|ing)? in/, 'drop-in'],
    [/\brises?\b|\brising\b/, 'rise-in'], [/\bslides?\b/, 'slide-in'], [/\bwhip(?:s)? in/, 'whip-in'],
    [/\bswing/, 'swing-in'], [/\bspin/, 'spin-in'], [/\bfocus|\bblur(?:s)? in/, 'blur-in'],
    [/type ?writer|\btyping\b|\btypes? (?:in|on|out)/, 'typewriter'], [/\bglitch/, 'glitch-in'],
    [/\bzooms? in/, 'zoom-in'], [/\bfades? in/, 'fade-in'], [/word by word|reveal/, 'word-reveal'],
];
const EMPHASIS_WORDS = [
    [/\bpunch/, 'punch'], [/\bpulse|heartbeat/, 'pulse'], [/\bshake|shaking/, 'shake'], [/\bwobble/, 'wobble'],
    [/\bflash|\bglow/, 'flash'], [/\bjiggle|squash/, 'jiggle'], [/\bbounce/, 'bounce'], [/\bnod\b/, 'nod'],
];
const HOLD_WORDS = [[/\bfloat/, 'float'], [/\bbreath/, 'breathe'], [/\bsway/, 'sway'], [/\bdrift|parallax/, 'drift'], [/ken burns|push in|slow zoom/, 'push-in']];
const EXIT_WORDS = [
    [/fl(?:y|ies) (?:out|off|away)/, 'fly-out'], [/whip(?:s)? (?:out|off|away)/, 'whip-out'], [/\bshrink/, 'shrink-out'],
    [/\bsink/, 'sink-out'], [/blur(?:s)? out|defocus/, 'blur-out'], [/fades? (?:out|away)/, 'fade-out'],
];
const MOOD_WORDS = [
    [/punchy|energetic|hype|aggressive|impact|dynamic|viral|tiktok/, 'punchy'],
    [/elegant|classy|premium|luxury|smooth|sleek|minimal/, 'elegant'],
    [/cinematic|epic|movie|trailer|dramatic/, 'cinematic'],
    [/playful|fun|cute|bouncy|cartoon/, 'playful'],
    [/\btech|digital|futuristic|cyber|hacker|\bcode/, 'techy'],
    [/calm|soft|gentle|chill|relaxed|subtle/, 'calm'],
    [/\bbold|strong|heavy|loud/, 'bold'],
];

/**
 * Turn a plain-language brief ("make the title slam in then shake, fade out")
 * into a motion script. Named motions win; otherwise a mood is used.
 */
export function planMotionFromBrief(brief, { duration = 3 } = {}) {
    const s = String(brief || '').toLowerCase();
    const d = Math.max(0.3, Number(duration) || 3);
    const energy = /\b(very|super|really|extremely|huge|massive|crazy)\b/.test(s) ? 0.9
        : /\b(subtle|slight|slightly|light|little|gentle|soft)\b/.test(s) ? 0.25 : 0.55;
    const from = (s.match(/\bfrom (?:the )?(left|right|top|bottom|above|below)\b/) || [])[1];
    const toward = { left: 'right', right: 'left', top: 'down', above: 'down', bottom: 'up', below: 'up' };
    const direction = from ? toward[from] : undefined;

    const pick = list => (list.find(([re]) => re.test(s)) || [])[1];
    const entrance = pick(ENTRANCE_WORDS);
    const emphasis = pick(EMPHASIS_WORDS);
    const hold = pick(HOLD_WORDS);
    const exit = pick(EXIT_WORDS);

    if (entrance || emphasis || hold || exit) {
        const beats = [];
        if (entrance) beats.push({ verb: entrance, energy, direction });
        if (hold) beats.push({ verb: hold, at: entrance ? 0.5 : 0, energy });
        if (emphasis) beats.push({ verb: emphasis, at: entrance ? Math.min(d * 0.5, 1.5) : 0, energy });
        if (exit) beats.push({ verb: exit, energy, direction });
        return { beats, mood: null };
    }
    const mood = pick(MOOD_WORDS) || 'punchy';
    const scale = energy / 0.55;
    const beats = MOODS[mood]({ d }).map(b => ({ ...b, energy: Math.min(1, (b.energy ?? 0.5) * scale) }));
    return { beats, mood };
}

export default { VERBS, MOODS, LIMITS, COMPOSED, verbCatalog, sanitizeAnimations, composeMotion, planMotionFromBrief };
