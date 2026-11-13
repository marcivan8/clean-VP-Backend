import assert from 'node:assert/strict';
import { resolveOverlayVideoPlaybackRate, resolveOverlayVideoSourceTime } from '../client/src/motion/TimeRemap.js';

assert.equal(resolveOverlayVideoSourceTime({ start: 5, offset: 2, speed: 1.5 }, 7), 5,
    'legacy overlay source offset and speed remain unchanged');
assert.equal(resolveOverlayVideoPlaybackRate({ speed: 2 }, 4), 2,
    'legacy playback rate remains unchanged');

const procedural = {
    start: 10,
    duration: 4,
    offset: 1,
    timeRemap: { duration: 8, expression: 't * 1.5' },
};
assert.equal(resolveOverlayVideoSourceTime(procedural, 12), 4,
    'a procedural source-time expression maps local timeline time into source seconds');
assert.ok(Math.abs(resolveOverlayVideoPlaybackRate(procedural, 12) - 1.5) < 0.02,
    'native preview playback rate follows the procedural source-time expression');
assert.equal(resolveOverlayVideoSourceTime({ ...procedural, timeRemap: { duration: 8, expression: 'window.alert(1)' } }, 12), 3,
    'an invalid procedural expression safely falls back to legacy timing');

const retimed = {
    start: 10,
    duration: 4,
    offset: 3,
    speed: 1,
    timeRemap: {
        duration: 6,
        keyframes: [
            { time: 0, value: 0, interpolation: 'linear' },
            { time: 4, value: 6, interpolation: 'linear' },
        ],
    },
};
assert.equal(resolveOverlayVideoSourceTime(retimed, 12), 6,
    'a source-time curve offsets from the clip in-point');
assert.ok(Math.abs(resolveOverlayVideoPlaybackRate(retimed, 12) - 1.5) < 0.02,
    'the preview playback rate follows the local curve slope');
assert.equal(resolveOverlayVideoSourceTime(retimed, 10), 3,
    'the keyframed overlay starts at the authored source in-point');

const reverse = {
    start: 20,
    duration: 4,
    offset: 8,
    timeRemap: { duration: 8, keyframes: [
        { time: 0, value: 8, interpolation: 'linear' },
        { time: 4, value: 0, interpolation: 'linear' },
    ] },
};
assert.ok(resolveOverlayVideoPlaybackRate(reverse, 22) < 0,
    'the preview exposes reverse direction instead of converting it to forward playback');
assert.equal(resolveOverlayVideoSourceTime(reverse, 22), 12,
    'reverse preview still seeks to the authored source time');

const hold = { ...reverse, timeRemap: { duration: 8, keyframes: [
    { time: 0, value: 3, interpolation: 'linear' },
    { time: 4, value: 3, interpolation: 'linear' },
] } };
assert.equal(resolveOverlayVideoPlaybackRate(hold, 22), 0,
    'a held source frame does not creep forward at a minimum playback rate');

const forwardLoop = { ...retimed, timeRemap: { mode: 'loop', duration: 6, keyframes: [
    { time: 0, value: 0, interpolation: 'linear' },
    { time: 4, value: 8, interpolation: 'linear' },
] } };
assert.ok(resolveOverlayVideoPlaybackRate(forwardLoop, 13) > 0,
    'a forward loop keeps forward playback direction across its modulo boundary');
const reverseLoop = { ...reverse, timeRemap: { mode: 'loop', duration: 6, keyframes: [
    { time: 0, value: 8, interpolation: 'linear' },
    { time: 4, value: -8, interpolation: 'linear' },
] } };
assert.ok(resolveOverlayVideoPlaybackRate(reverseLoop, 22) < 0,
    'a reverse loop keeps reverse playback direction across its modulo boundary');

console.log('Overlay time-remap checks passed.');
