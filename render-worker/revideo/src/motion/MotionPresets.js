/**
 * render-worker/revideo/src/motion/MotionPresets.js
 *
 * SYNCED COPY of client/src/motion/MotionPresets.js — verbatim below the header divider.
 * This file has ZERO dependencies beyond its siblings in this directory, so
 * it is safe to duplicate rather than import: the render-worker Docker build
 * context is render-worker/ only (see render-worker/Dockerfile's `COPY . .`),
 * so `client/src/motion/` is unreachable at build time regardless.
 *
 * KEEP IN SYNC BY HAND. If you change the original, copy the change here too —
 * scripts/test_revideo_render_path.js checks the two bodies match (ignoring
 * this header) and fails loudly if they drift, so a missed sync is caught in
 * CI/local test runs rather than silently rendering exports wrong.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * client/src/motion/MotionPresets.js
 *
 * PHASE 3 — the premium motion preset library.
 *
 * Each preset is a GENERATOR: `build(opts) → Animation[]`. It does not store
 * keyframes, it produces them, parameterised by the layer's own duration. That
 * matters because a "slide up" on a 0.8s caption and on a 6s title card are
 * not the same keyframes — a fixed keyframe list would either snap on short
 * clips or crawl on long ones.
 *
 * ─── WHY NOT REUSE effects/presets/PresetLibrary.js ────────────────────────
 * That library is 19 VISUAL FX presets — colour grade, blur, glitch, glow,
 * film grain — which composite over the video frame through the GPU effect
 * pipeline. These are MOTION presets: they animate a layer's transform over
 * time. Different data (Animation[] vs EffectNode[]), different consumer
 * (the resolver vs the shader chain), different lifecycle. Three of the FX
 * presets do declare a `transformKeyframes` field, but nothing has ever read
 * it (`EffectPreset` neither stores nor serialises it), so there is no
 * existing motion-preset behaviour to preserve or conflict with here.
 *
 * All timings are in SECONDS and all positions in PERCENT OF FRAME, matching
 * MotionSchema and the existing clip.x / clip.y convention.
 */

import { createAnimation, createKeyframe, ANIMATION_TYPES, LAYER_KINDS } from './MotionSchema.js';

/** Default entrance length. Short enough to feel snappy on 0.6-1.2s captions. */
const IN = 0.35;
/** Default exit length. Deliberately shorter than IN — exits should not linger. */
const OUT = 0.25;

/** Clamp an animation to something sensible for very short layers. */
const fit = (want, duration) => {
    const d = Number(duration) || 0;
    if (d <= 0) return want;
    // Never let entrance+exit exceed the layer; leave at least 20% held.
    return Math.min(want, d * 0.4);
};

const kf = createKeyframe;

/* ───────────────────────────── TEXT ───────────────────────────── */

const TEXT_PRESETS = {
    'pop': {
        label: 'Pop',
        build: ({ duration } = {}) => {
            const d = fit(0.45, duration);
            return [createAnimation({
                type: ANIMATION_TYPES.SCALE, presetId: 'pop', duration: d, easing: 'backOut',
                keyframes: [
                    kf(0,        { scale: 0.75, opacity: 0 }),
                    kf(d * 0.6,  { scale: 1.08, opacity: 1 }),
                    kf(d,        { scale: 1,    opacity: 1 }),
                ],
            })];
        },
    },
    'slide-up': {
        label: 'Slide Up',
        build: ({ duration } = {}) => {
            const d = fit(IN, duration);
            return [createAnimation({
                type: ANIMATION_TYPES.TRANSLATE, presetId: 'slide-up', duration: d, easing: 'easeOutCubic',
                keyframes: [kf(0, { y: 6, opacity: 0 }), kf(d, { y: 0, opacity: 1 })],
            })];
        },
    },
    'slide-down': {
        label: 'Slide Down',
        build: ({ duration } = {}) => {
            const d = fit(IN, duration);
            return [createAnimation({
                type: ANIMATION_TYPES.TRANSLATE, presetId: 'slide-down', duration: d, easing: 'easeOutCubic',
                keyframes: [kf(0, { y: -6, opacity: 0 }), kf(d, { y: 0, opacity: 1 })],
            })];
        },
    },
    'fade': {
        label: 'Fade',
        build: ({ duration } = {}) => {
            const dIn = fit(IN, duration);
            const dOut = fit(OUT, duration);
            return [
                createAnimation({
                    type: ANIMATION_TYPES.FADE, presetId: 'fade', duration: dIn, easing: 'easeOut',
                    keyframes: [kf(0, { opacity: 0 }), kf(dIn, { opacity: 1 })],
                }),
                createAnimation({
                    type: ANIMATION_TYPES.FADE, presetId: 'fade', duration: dOut, easing: 'easeIn', anchor: 'out',
                    keyframes: [kf(0, { opacity: 1 }), kf(dOut, { opacity: 0 })],
                }),
            ];
        },
    },
    'scale-reveal': {
        label: 'Scale Reveal',
        build: ({ duration } = {}) => {
            const d = fit(0.5, duration);
            return [createAnimation({
                type: ANIMATION_TYPES.SCALE, presetId: 'scale-reveal', duration: d, easing: 'easeOutQuart',
                keyframes: [kf(0, { scale: 0.4, opacity: 0 }), kf(d, { scale: 1, opacity: 1 })],
            })];
        },
    },
    'blur-reveal': {
        label: 'Blur Reveal',
        build: ({ duration } = {}) => {
            const d = fit(0.5, duration);
            return [createAnimation({
                type: ANIMATION_TYPES.BLUR, presetId: 'blur-reveal', duration: d, easing: 'easeOutCubic',
                keyframes: [kf(0, { blur: 12, opacity: 0 }), kf(d, { blur: 0, opacity: 1 })],
            })];
        },
    },
    'typewriter': {
        label: 'Typewriter',
        build: ({ duration } = {}) => {
            // Reveal runs across most of the layer, holding fully-revealed at the end.
            const d = Math.max(0.2, (Number(duration) || 1) * 0.7);
            return [createAnimation({
                type: ANIMATION_TYPES.REVEAL, presetId: 'typewriter', duration: d, easing: 'linear',
                keyframes: [kf(0, { reveal: 0 }), kf(d, { reveal: 1 })],
            })];
        },
    },
    'word-reveal': {
        label: 'Word Reveal',
        build: ({ duration } = {}) => {
            const d = Math.max(0.2, (Number(duration) || 1) * 0.8);
            return [createAnimation({
                type: ANIMATION_TYPES.REVEAL, presetId: 'word-reveal', duration: d, easing: 'linear',
                keyframes: [kf(0, { reveal: 0 }), kf(d, { reveal: 1 })],
            })];
        },
    },
    'glow-reveal': {
        label: 'Glow Reveal',
        build: ({ duration } = {}) => {
            const d = fit(0.6, duration);
            return [createAnimation({
                type: ANIMATION_TYPES.GLOW, presetId: 'glow-reveal', duration: d, easing: 'easeOutCubic',
                keyframes: [
                    kf(0,       { glow: 24, opacity: 0 }),
                    kf(d * 0.4, { glow: 16, opacity: 1 }),
                    kf(d,       { glow: 0,  opacity: 1 }),
                ],
            })];
        },
    },
    'mask-reveal': {
        label: 'Mask Reveal',
        build: ({ duration } = {}) => {
            const d = fit(0.55, duration);
            return [createAnimation({
                type: ANIMATION_TYPES.REVEAL, presetId: 'mask-reveal', duration: d, easing: 'easeInOutCubic',
                keyframes: [kf(0, { reveal: 0, opacity: 1 }), kf(d, { reveal: 1, opacity: 1 })],
            })];
        },
    },
};

/* ───────────────────────────── IMAGE ───────────────────────────── */

const IMAGE_PRESETS = {
    'ken-burns': {
        label: 'Ken Burns',
        build: ({ duration } = {}) => {
            const d = Math.max(0.5, Number(duration) || 5);
            return [createAnimation({
                type: ANIMATION_TYPES.SCALE, presetId: 'ken-burns', duration: d, easing: 'linear',
                keyframes: [kf(0, { scale: 1, x: 0, y: 0 }), kf(d, { scale: 1.18, x: 2, y: -1.5 })],
            })];
        },
    },
    'parallax': {
        label: 'Parallax',
        build: ({ duration } = {}) => {
            const d = Math.max(0.5, Number(duration) || 5);
            return [createAnimation({
                type: ANIMATION_TYPES.TRANSLATE, presetId: 'parallax', duration: d, easing: 'linear',
                keyframes: [kf(0, { x: -3, scale: 1.1 }), kf(d, { x: 3, scale: 1.1 })],
            })];
        },
    },
    'float': {
        label: 'Float',
        build: ({ duration } = {}) => {
            const d = Math.max(1, Number(duration) || 4);
            return [createAnimation({
                type: ANIMATION_TYPES.TRANSLATE, presetId: 'float', duration: d, easing: 'easeInOut',
                keyframes: [kf(0, { y: 0 }), kf(d * 0.5, { y: -1.5 }), kf(d, { y: 0 })],
            })];
        },
    },
    'zoom': {
        label: 'Zoom',
        build: ({ duration } = {}) => {
            const d = Math.max(0.5, Number(duration) || 3);
            return [createAnimation({
                type: ANIMATION_TYPES.SCALE, presetId: 'zoom', duration: d, easing: 'easeInOutCubic',
                keyframes: [kf(0, { scale: 1 }), kf(d, { scale: 1.25 })],
            })];
        },
    },
    'pan': {
        label: 'Pan',
        build: ({ duration } = {}) => {
            const d = Math.max(0.5, Number(duration) || 4);
            return [createAnimation({
                type: ANIMATION_TYPES.TRANSLATE, presetId: 'pan', duration: d, easing: 'linear',
                keyframes: [kf(0, { x: -4, scale: 1.12 }), kf(d, { x: 4, scale: 1.12 })],
            })];
        },
    },
    'reveal': {
        label: 'Reveal',
        build: ({ duration } = {}) => {
            const d = fit(0.6, duration);
            return [createAnimation({
                type: ANIMATION_TYPES.SCALE, presetId: 'reveal', duration: d, easing: 'easeOutQuart',
                keyframes: [kf(0, { scale: 1.15, opacity: 0 }), kf(d, { scale: 1, opacity: 1 })],
            })];
        },
    },
};

/* ──────────────────────────── STICKER ──────────────────────────── */

const STICKER_PRESETS = {
    'bounce': {
        label: 'Bounce',
        build: ({ duration } = {}) => {
            const d = fit(0.7, duration);
            return [createAnimation({
                type: ANIMATION_TYPES.TRANSLATE, presetId: 'bounce', duration: d, easing: 'bounce',
                keyframes: [kf(0, { y: -8, opacity: 0 }), kf(d, { y: 0, opacity: 1 })],
            })];
        },
    },
    'shake': {
        label: 'Shake',
        build: ({ duration } = {}) => {
            const d = Math.min(0.5, Math.max(0.2, Number(duration) || 0.4));
            return [createAnimation({
                type: ANIMATION_TYPES.TRANSLATE, presetId: 'shake', duration: d, easing: 'linear',
                keyframes: [
                    kf(0,        { x: 0 }),  kf(d * 0.2,  { x: -1.2 }),
                    kf(d * 0.4,  { x: 1.2 }), kf(d * 0.6, { x: -0.8 }),
                    kf(d * 0.8,  { x: 0.8 }), kf(d,       { x: 0 }),
                ],
            })];
        },
    },
    'pulse': {
        label: 'Pulse',
        build: ({ duration } = {}) => {
            const d = Math.max(0.6, Number(duration) || 1.2);
            return [createAnimation({
                type: ANIMATION_TYPES.SCALE, presetId: 'pulse', duration: d, easing: 'easeInOut',
                keyframes: [kf(0, { scale: 1 }), kf(d * 0.5, { scale: 1.12 }), kf(d, { scale: 1 })],
            })];
        },
    },
    'wiggle': {
        label: 'Wiggle',
        build: ({ duration } = {}) => {
            const d = Math.max(0.5, Number(duration) || 1);
            return [createAnimation({
                type: ANIMATION_TYPES.ROTATE, presetId: 'wiggle', duration: d, easing: 'easeInOut',
                keyframes: [
                    kf(0,       { rotation: 0 }),  kf(d * 0.25, { rotation: -5 }),
                    kf(d * 0.5, { rotation: 5 }),  kf(d * 0.75, { rotation: -3 }),
                    kf(d,       { rotation: 0 }),
                ],
            })];
        },
    },
    'sticker-pop': {
        label: 'Pop',
        build: ({ duration } = {}) => {
            const d = fit(0.4, duration);
            return [createAnimation({
                type: ANIMATION_TYPES.SCALE, presetId: 'sticker-pop', duration: d, easing: 'backOut',
                keyframes: [kf(0, { scale: 0, opacity: 0 }), kf(d, { scale: 1, opacity: 1 })],
            })];
        },
    },
};

/* ──────────────────────────── CAMERA ───────────────────────────── */
// Camera presets animate the VIDEO layer itself. They intentionally emit the
// same shape as everything else so a "camera push" is just a layer animation —
// but note the existing rhythm-zoom/virtualCam path (clip.keyframes.scale →
// exportProcessor's zoompan) is what currently reaches the EXPORT. These are
// the preview-side equivalents; see the journal entry for how they relate.

const CAMERA_PRESETS = {
    'camera-push': {
        label: 'Push In',
        build: ({ duration } = {}) => {
            const d = Math.max(0.4, Number(duration) || 2);
            return [createAnimation({
                type: ANIMATION_TYPES.SCALE, presetId: 'camera-push', duration: d, easing: 'easeInOutCubic',
                keyframes: [kf(0, { scale: 1 }), kf(d, { scale: 1.15 })],
            })];
        },
    },
    'camera-pull': {
        label: 'Pull Out',
        build: ({ duration } = {}) => {
            const d = Math.max(0.4, Number(duration) || 2);
            return [createAnimation({
                type: ANIMATION_TYPES.SCALE, presetId: 'camera-pull', duration: d, easing: 'easeInOutCubic',
                keyframes: [kf(0, { scale: 1.15 }), kf(d, { scale: 1 })],
            })];
        },
    },
    'camera-zoom': {
        label: 'Punch Zoom',
        build: ({ duration } = {}) => {
            const d = Math.min(0.25, Math.max(0.12, (Number(duration) || 1) * 0.15));
            return [createAnimation({
                type: ANIMATION_TYPES.SCALE, presetId: 'camera-zoom', duration: d, easing: 'easeOutQuart',
                keyframes: [kf(0, { scale: 1 }), kf(d, { scale: 1.12 })],
            })];
        },
    },
    'camera-whip': {
        label: 'Whip',
        build: ({ duration } = {}) => {
            const d = Math.min(0.3, Math.max(0.15, (Number(duration) || 1) * 0.2));
            return [createAnimation({
                type: ANIMATION_TYPES.TRANSLATE, presetId: 'camera-whip', duration: d, easing: 'easeOutQuart',
                keyframes: [
                    kf(0,       { x: -8, blur: 8 }),
                    kf(d * 0.5, { x: 2,  blur: 3 }),
                    kf(d,       { x: 0,  blur: 0 }),
                ],
            })];
        },
    },
    'camera-shake': {
        label: 'Camera Shake',
        build: ({ duration } = {}) => {
            const d = Math.min(0.6, Math.max(0.25, Number(duration) || 0.5));
            return [createAnimation({
                type: ANIMATION_TYPES.TRANSLATE, presetId: 'camera-shake', duration: d, easing: 'linear',
                keyframes: [
                    kf(0,       { x: 0,    y: 0,    scale: 1.04 }),
                    kf(d * 0.2, { x: -1,   y: 0.6,  scale: 1.04 }),
                    kf(d * 0.4, { x: 1,    y: -0.6, scale: 1.04 }),
                    kf(d * 0.6, { x: -0.6, y: 0.3,  scale: 1.04 }),
                    kf(d * 0.8, { x: 0.6,  y: -0.3, scale: 1.04 }),
                    kf(d,       { x: 0,    y: 0,    scale: 1 }),
                ],
            })];
        },
    },
};

/** All presets, flat, keyed by id. */
export const MOTION_PRESETS = {
    ...TEXT_PRESETS,
    ...IMAGE_PRESETS,
    ...STICKER_PRESETS,
    ...CAMERA_PRESETS,
};

/** Preset ids grouped by the layer kind they're intended for. */
export const PRESET_GROUPS = [
    { group: 'text',    kinds: [LAYER_KINDS.TEXT, LAYER_KINDS.CAPTION], ids: Object.keys(TEXT_PRESETS) },
    { group: 'image',   kinds: [LAYER_KINDS.IMAGE],                     ids: Object.keys(IMAGE_PRESETS) },
    { group: 'sticker', kinds: [LAYER_KINDS.STICKER, LAYER_KINDS.SHAPE], ids: Object.keys(STICKER_PRESETS) },
    { group: 'camera',  kinds: [LAYER_KINDS.VIDEO],                     ids: Object.keys(CAMERA_PRESETS) },
];

/**
 * Build the Animation[] for a preset.
 * Returns [] for an unknown id rather than throwing — a preset removed in a
 * later version must not break an old project on load.
 *
 * @param {string} presetId
 * @param {{duration?: number}} [opts]
 * @returns {Array<object>}
 */
export function buildPreset(presetId, opts = {}) {
    const preset = MOTION_PRESETS[presetId];
    if (!preset || typeof preset.build !== 'function') {
        console.warn(`[MotionPresets] unknown preset "${presetId}" — no animation applied`);
        return [];
    }
    try {
        const anims = preset.build(opts);
        return Array.isArray(anims) ? anims : [];
    } catch (err) {
        console.error(`[MotionPresets] preset "${presetId}" failed to build:`, err.message);
        return [];
    }
}

/** Preset ids appropriate for a given layer kind — drives UI pickers. */
export function presetsForKind(kind) {
    const out = [];
    for (const g of PRESET_GROUPS) {
        if (g.kinds.includes(kind)) out.push(...g.ids);
    }
    return out;
}

/**
 * Map the five legacy `clip.animation` string values onto motion presets, so
 * existing projects keep animating once the engine takes over rendering.
 * `word-by-word` maps to `word-reveal`, which the resolver drives properly
 * off real word timings instead of TextOverlay's old linear-progress guess.
 */
export const LEGACY_ANIMATION_MAP = {
    'none':         null,
    'fade-in':      'fade',
    'slide-up':     'slide-up',
    'pop':          'pop',
    'word-by-word': 'word-reveal',
};

export default { MOTION_PRESETS, PRESET_GROUPS, buildPreset, presetsForKind, LEGACY_ANIMATION_MAP };
