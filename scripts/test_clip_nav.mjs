// Mobile transport ⏮/⏭ (client/src/timeline/clipNav.js). node scripts/test_clip_nav.mjs
import assert from 'assert/strict';
import { prevClipBoundary, nextClipBoundary } from '../client/src/timeline/clipNav.js';
const T = [{ id: 'v', type: 'video', clips: [{ start: 0, duration: 4 }, { start: 4, duration: 3 }, { start: 9, duration: 2 }] },
           { id: 'b', type: 'video', clips: [{ start: 5.5, duration: 1 }] }];
assert.equal(nextClipBoundary(T, 0), 4);
assert.equal(nextClipBoundary(T, 4), 9, 'b-roll on another track is not a stop');
assert.equal(nextClipBoundary(T, 10), 11, 'past the last start → end of the edit');
assert.equal(nextClipBoundary(T, 11), 11);
assert.equal(prevClipBoundary(T, 5), 4);
assert.equal(prevClipBoundary(T, 4.1), 0, 'already at a start → previous clip');
assert.equal(prevClipBoundary(T, 0.1), 0);
assert.equal(prevClipBoundary([], 3), 0); assert.equal(nextClipBoundary([], 3), 3);
console.log('ALL CLIP-NAV CHECKS PASSED');
