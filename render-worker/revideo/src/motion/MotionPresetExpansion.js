/**
 * Additional curated motion recipes. Kept data-driven so the preset catalog
 * can grow without cloning timing/keyframe boilerplate for every variation.
 */
import { createAnimation, createKeyframe, ANIMATION_TYPES } from './MotionSchema.js';

const expansionKf = createKeyframe;
const clampEntrance = (requested, clipDuration) => {
    const clip = Number(clipDuration) || 0;
    return clip > 0 ? Math.min(requested, clip * 0.4) : requested;
};

function makePreset({ id, label, type, frames, easing = 'easeOutCubic', duration = 0.55, fitToClip = true }) {
    return {
        label,
        build: ({ duration: clipDuration } = {}) => {
            const d = fitToClip
                ? clampEntrance(duration, clipDuration)
                : Math.max(0.4, Number(clipDuration) || duration);
            return [createAnimation({
                type,
                presetId: id,
                duration: d,
                easing,
                keyframes: frames.map(([at, properties]) => expansionKf(d * at, properties)),
            })];
        },
    };
}

const bank = rows => Object.fromEntries(rows.map(([id, label, type, frames, easing, duration, fitToClip]) => [
    id,
    makePreset({ id, label, type, frames, easing, duration, fitToClip }),
]));

const { FADE, SCALE, TRANSLATE, ROTATE, BLUR, GLOW, REVEAL } = ANIMATION_TYPES;

export const TEXT_EXPANSIONS = bank([
    ['txt-rise-soft', 'Soft Rise', TRANSLATE, [[0, { y: 4, opacity: 0 }], [1, { y: 0, opacity: 1 }]], 'easeOutCubic', 0.48],
    ['txt-rise-bounce', 'Bouncy Rise', TRANSLATE, [[0, { y: 8, opacity: 0 }], [0.72, { y: -0.8, opacity: 1 }], [1, { y: 0, opacity: 1 }]], 'backOut', 0.62],
    ['txt-drop-bounce', 'Drop & Bounce', TRANSLATE, [[0, { y: -9, opacity: 0 }], [0.68, { y: 0.8, opacity: 1 }], [1, { y: 0, opacity: 1 }]], 'bounce', 0.62],
    ['txt-slide-left', 'Slide From Left', TRANSLATE, [[0, { x: -8, opacity: 0 }], [1, { x: 0, opacity: 1 }]], 'easeOutCubic', 0.45],
    ['txt-slide-right', 'Slide From Right', TRANSLATE, [[0, { x: 8, opacity: 0 }], [1, { x: 0, opacity: 1 }]], 'easeOutCubic', 0.45],
    ['txt-slide-down', 'Slide From Top', TRANSLATE, [[0, { y: -7, opacity: 0 }], [1, { y: 0, opacity: 1 }]], 'easeOutCubic', 0.45],
    ['txt-zoom-soft', 'Soft Zoom', SCALE, [[0, { scale: 0.88, opacity: 0 }], [1, { scale: 1, opacity: 1 }]], 'easeOutCubic', 0.45],
    ['txt-zoom-out-in', 'Zoom Settle', SCALE, [[0, { scale: 1.24, opacity: 0 }], [0.76, { scale: 0.98, opacity: 1 }], [1, { scale: 1, opacity: 1 }]], 'backOut', 0.5],
    ['txt-tilt-left', 'Tilt From Left', ROTATE, [[0, { rotation: -12, scale: 0.94, opacity: 0 }], [1, { rotation: 0, scale: 1, opacity: 1 }]], 'easeOutCubic', 0.48],
    ['txt-tilt-right', 'Tilt From Right', ROTATE, [[0, { rotation: 12, scale: 0.94, opacity: 0 }], [1, { rotation: 0, scale: 1, opacity: 1 }]], 'easeOutCubic', 0.48],
    ['txt-spin-quarter', 'Quarter Spin', ROTATE, [[0, { rotation: -90, scale: 0.7, opacity: 0 }], [1, { rotation: 0, scale: 1, opacity: 1 }]], 'backOut', 0.6],
    ['txt-blur-slide', 'Blur Slide', BLUR, [[0, { x: 5, blur: 10, opacity: 0 }], [1, { x: 0, blur: 0, opacity: 1 }]], 'easeOutCubic', 0.55],
    ['txt-blur-zoom', 'Blur Zoom', BLUR, [[0, { scale: 0.76, blur: 14, opacity: 0 }], [1, { scale: 1, blur: 0, opacity: 1 }]], 'easeOutQuart', 0.58],
    ['txt-glow-rise', 'Glow Rise', GLOW, [[0, { y: 3, glow: 0, opacity: 0 }], [0.72, { y: 0, glow: 12, opacity: 1 }], [1, { y: 0, glow: 0, opacity: 1 }]], 'easeOutCubic', 0.62],
    ['txt-mask-wipe', 'Mask Wipe', REVEAL, [[0, { reveal: 0, x: -2 }], [1, { reveal: 1, x: 0 }]], 'easeInOutCubic', 0.62],
    ['txt-scale-pulse', 'Scale Pulse In', SCALE, [[0, { scale: 0.6, opacity: 0 }], [0.72, { scale: 1.1, opacity: 1 }], [1, { scale: 1, opacity: 1 }]], 'backOut', 0.5],
    ['txt-flip-up', 'Flip Up', ROTATE, [[0, { rotation: 70, y: 4, opacity: 0 }], [1, { rotation: 0, y: 0, opacity: 1 }]], 'easeOutCubic', 0.55],
    ['txt-spring-up', 'Spring Up', TRANSLATE, [[0, { y: 10, scale: 0.92, opacity: 0 }], [0.75, { y: -1, scale: 1.03, opacity: 1 }], [1, { y: 0, scale: 1, opacity: 1 }]], 'elastic', 0.66],
    ['txt-squash-pop', 'Squash Pop', SCALE, [[0, { scale: 0.7, opacity: 0 }], [0.62, { scale: 1.12, opacity: 1 }], [0.78, { scale: 0.96, opacity: 1 }], [1, { scale: 1, opacity: 1 }]], 'backOut', 0.58],
    ['txt-fade-lift', 'Fade & Lift', FADE, [[0, { y: 3, opacity: 0 }], [1, { y: 0, opacity: 1 }]], 'easeOutCubic', 0.42],
    ['txt-fade-drop', 'Fade & Drop', FADE, [[0, { y: -3, opacity: 0 }], [1, { y: 0, opacity: 1 }]], 'easeOutCubic', 0.42],
    ['txt-fade-left', 'Fade From Left', FADE, [[0, { x: -5, opacity: 0 }], [1, { x: 0, opacity: 1 }]], 'easeOutCubic', 0.42],
    ['txt-fade-right', 'Fade From Right', FADE, [[0, { x: 5, opacity: 0 }], [1, { x: 0, opacity: 1 }]], 'easeOutCubic', 0.42],
    ['txt-highlight-flash', 'Highlight Flash', GLOW, [[0, { glow: 0 }], [0.32, { glow: 20 }], [1, { glow: 0 }]], 'easeOutCubic', 0.72],
    ['txt-focus-reveal', 'Focus Reveal', BLUR, [[0, { blur: 16, opacity: 0 }], [0.55, { blur: 2, opacity: 1 }], [1, { blur: 0, opacity: 1 }]], 'easeOutCubic', 0.62],
    ['txt-bounce-in', 'Bounce In', SCALE, [[0, { scale: 0.4, opacity: 0 }], [0.62, { scale: 1.16, opacity: 1 }], [0.82, { scale: 0.96, opacity: 1 }], [1, { scale: 1, opacity: 1 }]], 'bounce', 0.68],
]);

export const IMAGE_EXPANSIONS = bank([
    ['img-zoom-out-soft', 'Soft Zoom Out', SCALE, [[0, { scale: 1.18 }], [1, { scale: 1.04 }]], 'easeInOutCubic', 5, false],
    ['img-zoom-in-slow', 'Slow Zoom In', SCALE, [[0, { scale: 1.02 }], [1, { scale: 1.22 }]], 'linear', 6, false],
    ['img-pan-left', 'Pan Left', TRANSLATE, [[0, { x: 4, scale: 1.12 }], [1, { x: -4, scale: 1.12 }]], 'linear', 5, false],
    ['img-pan-right', 'Pan Right', TRANSLATE, [[0, { x: -4, scale: 1.12 }], [1, { x: 4, scale: 1.12 }]], 'linear', 5, false],
    ['img-pan-diagonal-ne', 'Pan Diagonal NE', TRANSLATE, [[0, { x: -3, y: 3, scale: 1.12 }], [1, { x: 3, y: -3, scale: 1.12 }]], 'linear', 5, false],
    ['img-pan-diagonal-sw', 'Pan Diagonal SW', TRANSLATE, [[0, { x: 3, y: -3, scale: 1.12 }], [1, { x: -3, y: 3, scale: 1.12 }]], 'linear', 5, false],
    ['img-tilt-left', 'Tilt Left', ROTATE, [[0, { rotation: -1.4, scale: 1.08 }], [1, { rotation: 0, scale: 1.04 }]], 'easeInOutCubic', 5, false],
    ['img-tilt-right', 'Tilt Right', ROTATE, [[0, { rotation: 1.4, scale: 1.08 }], [1, { rotation: 0, scale: 1.04 }]], 'easeInOutCubic', 5, false],
    ['img-float-up', 'Float Up', TRANSLATE, [[0, { y: 2, scale: 1.08 }], [0.5, { y: -1, scale: 1.08 }], [1, { y: 2, scale: 1.08 }]], 'easeInOut', 4, false],
    ['img-float-down', 'Float Down', TRANSLATE, [[0, { y: -2, scale: 1.08 }], [0.5, { y: 1, scale: 1.08 }], [1, { y: -2, scale: 1.08 }]], 'easeInOut', 4, false],
    ['img-parallax-slow', 'Slow Parallax', TRANSLATE, [[0, { x: -2, y: 1, scale: 1.08 }], [1, { x: 2, y: -1, scale: 1.08 }]], 'easeInOutSine', 7, false],
    ['img-parallax-fast', 'Fast Parallax', TRANSLATE, [[0, { x: -5, y: 2, scale: 1.16 }], [1, { x: 5, y: -2, scale: 1.16 }]], 'easeInOutCubic', 3, false],
    ['img-focus-reveal', 'Focus Reveal', BLUR, [[0, { blur: 12, scale: 1.06 }], [1, { blur: 0, scale: 1 }]], 'easeOutCubic', 1.1, true],
    ['img-flash-reveal', 'Flash Reveal', GLOW, [[0, { opacity: 0.55, glow: 16 }], [0.35, { opacity: 1, glow: 6 }], [1, { opacity: 1, glow: 0 }]], 'easeOutCubic', 0.7, true],
    ['img-drift-left', 'Drift Left', TRANSLATE, [[0, { x: 3, scale: 1.08 }], [1, { x: -3, scale: 1.08 }]], 'linear', 5, false],
    ['img-drift-right', 'Drift Right', TRANSLATE, [[0, { x: -3, scale: 1.08 }], [1, { x: 3, scale: 1.08 }]], 'linear', 5, false],
    ['img-push-top', 'Push From Top', TRANSLATE, [[0, { y: -4, scale: 1.12 }], [1, { y: 0, scale: 1.02 }]], 'easeInOutCubic', 4, false],
    ['img-push-bottom', 'Push From Bottom', TRANSLATE, [[0, { y: 4, scale: 1.12 }], [1, { y: 0, scale: 1.02 }]], 'easeInOutCubic', 4, false],
    ['img-pull-center', 'Pull To Center', SCALE, [[0, { scale: 1.22, x: 1.5, y: -1 }], [1, { scale: 1.04, x: 0, y: 0 }]], 'easeInOutCubic', 5, false],
    ['img-orbit-left', 'Orbit Left', ROTATE, [[0, { rotation: -1.2, x: 2, scale: 1.1 }], [1, { rotation: 1.2, x: -2, scale: 1.1 }]], 'easeInOutCubic', 5, false],
    ['img-orbit-right', 'Orbit Right', ROTATE, [[0, { rotation: 1.2, x: -2, scale: 1.1 }], [1, { rotation: -1.2, x: 2, scale: 1.1 }]], 'easeInOutCubic', 5, false],
    ['img-rack-focus', 'Rack Focus', BLUR, [[0, { blur: 10 }], [0.45, { blur: 0 }], [0.72, { blur: 3 }], [1, { blur: 0 }]], 'easeInOutCubic', 4, false],
    ['img-ken-burns-nw', 'Ken Burns NW', SCALE, [[0, { scale: 1.03, x: 2, y: 2 }], [1, { scale: 1.2, x: -2, y: -2 }]], 'linear', 6, false],
    ['img-ken-burns-se', 'Ken Burns SE', SCALE, [[0, { scale: 1.03, x: -2, y: -2 }], [1, { scale: 1.2, x: 2, y: 2 }]], 'linear', 6, false],
    ['img-settle', 'Settle In', SCALE, [[0, { scale: 1.12, blur: 3 }], [0.38, { scale: 0.99, blur: 0 }], [1, { scale: 1, blur: 0 }]], 'easeOutCubic', 0.9, true],
]);

export const STICKER_EXPANSIONS = bank([
    ['stkr-bounce-soft', 'Soft Bounce', TRANSLATE, [[0, { y: -5, opacity: 0 }], [0.72, { y: 1, opacity: 1 }], [1, { y: 0, opacity: 1 }]], 'backOut', 0.62],
    ['stkr-bounce-hard', 'Big Bounce', TRANSLATE, [[0, { y: -12, scale: 0.75, opacity: 0 }], [0.68, { y: 2, scale: 1.12, opacity: 1 }], [1, { y: 0, scale: 1, opacity: 1 }]], 'bounce', 0.72],
    ['stkr-spin-clockwise', 'Spin Clockwise', ROTATE, [[0, { rotation: -180, scale: 0.5, opacity: 0 }], [1, { rotation: 0, scale: 1, opacity: 1 }]], 'backOut', 0.62],
    ['stkr-spin-counter', 'Spin Counterclockwise', ROTATE, [[0, { rotation: 180, scale: 0.5, opacity: 0 }], [1, { rotation: 0, scale: 1, opacity: 1 }]], 'backOut', 0.62],
    ['stkr-pop-left', 'Pop From Left', SCALE, [[0, { x: -8, scale: 0.5, opacity: 0 }], [0.72, { x: 0, scale: 1.12, opacity: 1 }], [1, { x: 0, scale: 1, opacity: 1 }]], 'backOut', 0.52],
    ['stkr-pop-drop', 'Drop Pop', SCALE, [[0, { y: -10, scale: 0.65, opacity: 0 }], [0.72, { y: 1, scale: 1.12, opacity: 1 }], [1, { y: 0, scale: 1, opacity: 1 }]], 'bounce', 0.6],
    ['stkr-wiggle-soft', 'Soft Wiggle', ROTATE, [[0, { rotation: 0 }], [0.25, { rotation: -3 }], [0.5, { rotation: 3 }], [0.75, { rotation: -1.5 }], [1, { rotation: 0 }]], 'easeInOut', 1.1, false],
    ['stkr-wiggle-strong', 'Big Wiggle', ROTATE, [[0, { rotation: 0 }], [0.2, { rotation: -10 }], [0.4, { rotation: 9 }], [0.6, { rotation: -7 }], [0.8, { rotation: 5 }], [1, { rotation: 0 }]], 'easeInOut', 0.8, false],
    ['stkr-pulse-slow', 'Slow Pulse', SCALE, [[0, { scale: 1 }], [0.5, { scale: 1.12 }], [1, { scale: 1 }]], 'easeInOutSine', 2, false],
    ['stkr-pulse-quick', 'Quick Pulse', SCALE, [[0, { scale: 1 }], [0.35, { scale: 1.16 }], [0.7, { scale: 1 }], [1, { scale: 1.08 }]], 'easeInOut', 0.9, false],
    ['stkr-float-up', 'Float Up', TRANSLATE, [[0, { y: 1 }], [0.5, { y: -2 }], [1, { y: 1 }]], 'easeInOut', 2.2, false],
    ['stkr-float-down', 'Float Down', TRANSLATE, [[0, { y: -1 }], [0.5, { y: 2 }], [1, { y: -1 }]], 'easeInOut', 2.2, false],
    ['stkr-swing-left', 'Swing Left', ROTATE, [[0, { rotation: 0 }], [0.35, { rotation: -12 }], [0.7, { rotation: 5 }], [1, { rotation: 0 }]], 'easeInOut', 1.2, false],
    ['stkr-swing-right', 'Swing Right', ROTATE, [[0, { rotation: 0 }], [0.35, { rotation: 12 }], [0.7, { rotation: -5 }], [1, { rotation: 0 }]], 'easeInOut', 1.2, false],
    ['stkr-flip-in', 'Flip In', ROTATE, [[0, { rotation: 100, scale: 0.6, opacity: 0 }], [1, { rotation: 0, scale: 1, opacity: 1 }]], 'backOut', 0.6],
    ['stkr-slide-top', 'Slide From Top', TRANSLATE, [[0, { y: -12, opacity: 0 }], [1, { y: 0, opacity: 1 }]], 'easeOutCubic', 0.48],
    ['stkr-slide-bottom', 'Slide From Bottom', TRANSLATE, [[0, { y: 12, opacity: 0 }], [1, { y: 0, opacity: 1 }]], 'easeOutCubic', 0.48],
    ['stkr-elastic-pop', 'Elastic Pop', SCALE, [[0, { scale: 0.2, opacity: 0 }], [0.55, { scale: 1.2, opacity: 1 }], [0.78, { scale: 0.92, opacity: 1 }], [1, { scale: 1, opacity: 1 }]], 'elastic', 0.68],
    ['stkr-roll-in', 'Roll In', ROTATE, [[0, { x: -12, rotation: -120, opacity: 0 }], [1, { x: 0, rotation: 0, opacity: 1 }]], 'easeOutCubic', 0.62],
    ['stkr-boing', 'Boing', SCALE, [[0, { scale: 0.8 }], [0.35, { scale: 1.2 }], [0.58, { scale: 0.88 }], [0.78, { scale: 1.08 }], [1, { scale: 1 }]], 'bounce', 0.85, false],
    ['stkr-jelly', 'Jelly', ROTATE, [[0, { rotation: 0, scale: 1 }], [0.2, { rotation: -6, scale: 1.08 }], [0.4, { rotation: 5, scale: 0.95 }], [0.6, { rotation: -3, scale: 1.04 }], [0.8, { rotation: 2, scale: 0.98 }], [1, { rotation: 0, scale: 1 }]], 'easeInOut', 0.8, false],
    ['stkr-shake-hard', 'Hard Shake', TRANSLATE, [[0, { x: 0 }], [0.16, { x: -3 }], [0.32, { x: 3 }], [0.48, { x: -2.4 }], [0.64, { x: 2.4 }], [0.82, { x: -1 }], [1, { x: 0 }]], 'linear', 0.55, false],
    ['stkr-spring-in', 'Spring In', TRANSLATE, [[0, { y: 10, scale: 0.7, opacity: 0 }], [0.65, { y: -1, scale: 1.08, opacity: 1 }], [1, { y: 0, scale: 1, opacity: 1 }]], 'elastic', 0.7],
    ['stkr-orbit-in', 'Orbit In', ROTATE, [[0, { x: 12, y: -6, rotation: -90, scale: 0.6, opacity: 0 }], [1, { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }]], 'easeOutCubic', 0.7],
    ['stkr-hover', 'Hover', TRANSLATE, [[0, { y: 0 }], [0.5, { y: -1.4 }], [1, { y: 0 }]], 'easeInOutSine', 2.4, false],
    ['stkr-tilt-pop', 'Tilt Pop', ROTATE, [[0, { rotation: -14, scale: 0.6, opacity: 0 }], [0.7, { rotation: 3, scale: 1.1, opacity: 1 }], [1, { rotation: 0, scale: 1, opacity: 1 }]], 'backOut', 0.58],
]);

export const CAMERA_EXPANSIONS = bank([
    ['cam-push-slow', 'Slow Push In', SCALE, [[0, { scale: 1 }], [1, { scale: 1.12 }]], 'easeInOutSine', 6, false],
    ['cam-push-fast', 'Fast Push In', SCALE, [[0, { scale: 1 }], [1, { scale: 1.18 }]], 'easeOutCubic', 1.8, false],
    ['cam-pull-slow', 'Slow Pull Out', SCALE, [[0, { scale: 1.14 }], [1, { scale: 1 }]], 'easeInOutSine', 6, false],
    ['cam-pull-fast', 'Fast Pull Out', SCALE, [[0, { scale: 1.18 }], [1, { scale: 1 }]], 'easeOutCubic', 1.8, false],
    ['cam-pan-left', 'Camera Pan Left', TRANSLATE, [[0, { x: 4, scale: 1.1 }], [1, { x: -4, scale: 1.1 }]], 'easeInOutCubic', 4, false],
    ['cam-pan-right', 'Camera Pan Right', TRANSLATE, [[0, { x: -4, scale: 1.1 }], [1, { x: 4, scale: 1.1 }]], 'easeInOutCubic', 4, false],
    ['cam-pan-up', 'Camera Pan Up', TRANSLATE, [[0, { y: 4, scale: 1.1 }], [1, { y: -4, scale: 1.1 }]], 'easeInOutCubic', 4, false],
    ['cam-pan-down', 'Camera Pan Down', TRANSLATE, [[0, { y: -4, scale: 1.1 }], [1, { y: 4, scale: 1.1 }]], 'easeInOutCubic', 4, false],
    ['cam-tilt-up', 'Camera Tilt Up', ROTATE, [[0, { rotation: 1.6, y: 2, scale: 1.08 }], [1, { rotation: 0, y: -2, scale: 1.08 }]], 'easeInOutCubic', 3, false],
    ['cam-tilt-down', 'Camera Tilt Down', ROTATE, [[0, { rotation: -1.6, y: -2, scale: 1.08 }], [1, { rotation: 0, y: 2, scale: 1.08 }]], 'easeInOutCubic', 3, false],
    ['cam-dolly-left', 'Dolly Left', TRANSLATE, [[0, { x: 5, scale: 1.14 }], [1, { x: -5, scale: 1.14 }]], 'easeInOutSine', 4, false],
    ['cam-dolly-right', 'Dolly Right', TRANSLATE, [[0, { x: -5, scale: 1.14 }], [1, { x: 5, scale: 1.14 }]], 'easeInOutSine', 4, false],
    ['cam-dolly-in', 'Dolly In', SCALE, [[0, { scale: 1.04, y: 1 }], [1, { scale: 1.16, y: -1 }]], 'easeInOutCubic', 3.5, false],
    ['cam-dolly-out', 'Dolly Out', SCALE, [[0, { scale: 1.16, y: -1 }], [1, { scale: 1.04, y: 1 }]], 'easeInOutCubic', 3.5, false],
    ['cam-rack-focus', 'Rack Focus', BLUR, [[0, { blur: 7 }], [0.4, { blur: 0 }], [0.68, { blur: 2 }], [1, { blur: 0 }]], 'easeInOutCubic', 3, false],
    ['cam-handheld-medium', 'Handheld Medium', TRANSLATE, [[0, { x: 0, y: 0, scale: 1.04 }], [0.2, { x: -0.6, y: 0.4, scale: 1.04 }], [0.4, { x: 0.5, y: -0.4, scale: 1.04 }], [0.62, { x: -0.45, y: -0.2, scale: 1.04 }], [0.82, { x: 0.5, y: 0.3, scale: 1.04 }], [1, { x: 0, y: 0, scale: 1.04 }]], 'linear', 2.5, false],
    ['cam-handheld-strong', 'Handheld Strong', TRANSLATE, [[0, { x: 0, y: 0, scale: 1.07 }], [0.16, { x: -1.1, y: 0.7, scale: 1.07 }], [0.34, { x: 0.9, y: -0.8, scale: 1.07 }], [0.52, { x: -0.8, y: -0.5, scale: 1.07 }], [0.72, { x: 1, y: 0.65, scale: 1.07 }], [0.86, { x: -0.4, y: 0.3, scale: 1.07 }], [1, { x: 0, y: 0, scale: 1.07 }]], 'linear', 1.6, false],
    ['cam-orbit-left', 'Orbit Left', ROTATE, [[0, { rotation: -1.5, x: 3, scale: 1.12 }], [1, { rotation: 1.5, x: -3, scale: 1.12 }]], 'easeInOutCubic', 4, false],
    ['cam-orbit-right', 'Orbit Right', ROTATE, [[0, { rotation: 1.5, x: -3, scale: 1.12 }], [1, { rotation: -1.5, x: 3, scale: 1.12 }]], 'easeInOutCubic', 4, false],
    ['cam-zoom-pulse', 'Zoom Pulse', SCALE, [[0, { scale: 1 }], [0.35, { scale: 1.1 }], [0.62, { scale: 1.03 }], [1, { scale: 1.12 }]], 'easeInOutCubic', 2.6, false],
    ['cam-snap-zoom-out', 'Snap Zoom Out', SCALE, [[0, { scale: 1.2 }], [0.24, { scale: 1.06 }], [1, { scale: 1 }]], 'easeOutQuart', 0.75, true],
    ['cam-parallax', 'Camera Parallax', TRANSLATE, [[0, { x: -3, y: 2, scale: 1.14 }], [1, { x: 3, y: -2, scale: 1.14 }]], 'easeInOutSine', 4.5, false],
    ['cam-crane-up', 'Crane Up', TRANSLATE, [[0, { y: 5, scale: 1.15 }], [1, { y: -5, scale: 1.05 }]], 'easeInOutCubic', 4, false],
    ['cam-crane-down', 'Crane Down', TRANSLATE, [[0, { y: -5, scale: 1.05 }], [1, { y: 5, scale: 1.15 }]], 'easeInOutCubic', 4, false],
    ['cam-drift-diagonal', 'Diagonal Drift', TRANSLATE, [[0, { x: -3, y: 2, scale: 1.1 }], [1, { x: 3, y: -2, scale: 1.1 }]], 'easeInOutSine', 5, false],
    ['cam-roll', 'Camera Roll', ROTATE, [[0, { rotation: -2.4, scale: 1.12 }], [1, { rotation: 0, scale: 1.04 }]], 'easeOutCubic', 2.8, false],
    ['cam-steady-float', 'Steady Float', TRANSLATE, [[0, { x: -0.5, y: 0.5, scale: 1.05 }], [0.5, { x: 0.5, y: -0.5, scale: 1.05 }], [1, { x: -0.5, y: 0.5, scale: 1.05 }]], 'easeInOutSine', 5, false],
    ['cam-zoom-soft', 'Soft Camera Zoom', SCALE, [[0, { scale: 1 }], [1, { scale: 1.08 }]], 'easeInOutSine', 4, false],
    ['cam-pan-whip', 'Whip Pan', TRANSLATE, [[0, { x: -12, blur: 9, scale: 1.12 }], [0.45, { x: 3, blur: 4, scale: 1.12 }], [1, { x: 0, blur: 0, scale: 1.08 }]], 'easeOutCubic', 0.42, true],
]);

export default { TEXT_EXPANSIONS, IMAGE_EXPANSIONS, STICKER_EXPANSIONS, CAMERA_EXPANSIONS };
