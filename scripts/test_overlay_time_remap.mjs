import assert from 'node:assert/strict';
import { resolveOverlayVideoPlaybackRate, resolveOverlayVideoSourceTime } from '../client/src/motion/TimeRemap.js';

assert.equal(resolveOverlayVideoSourceTime({ start: 5, offset: 2, speed: 1.5 }, 7), 5,
    'legacy overlay source offset and speed remain unchanged');
assert.equal(resolveOverlayVideoPlaybackRate({ speed: 2 }, 4), 2,
    'legacy playback rate remains unchanged');

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

console.log('Overlay time-remap checks passed.');
