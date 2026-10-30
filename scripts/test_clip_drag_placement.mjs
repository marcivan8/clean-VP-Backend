import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClipCollisionDetection, getClipDropStart } from '../client/src/timeline/clipDrop.js';

const tracks = [{ id: 'video-1', clips: [{ id: 'clip-a', start: 10, duration: 2 }] }];
assert.equal(getClipDropStart({ tracks, movingIds: ['clip-a'], clipStart: 10, deltaX: 40, zoomLevel: 20 }), 12,
    'dragging right converts pixels to a later timeline position');
assert.equal(getClipDropStart({ tracks, movingIds: ['clip-a'], clipStart: 10, deltaX: -60, zoomLevel: 20 }), 7,
    'dragging left converts pixels to an earlier timeline position');
assert.equal(getClipDropStart({ tracks, movingIds: ['clip-a'], clipStart: 1, deltaX: -60, zoomLevel: 20 }), 0,
    'leftward placement stays clamped at the start of the timeline');

const sourceDrop = { id: 'drop-clip-clip-a', data: { current: { trackId: 'video-1' } } };
const targetLane = { id: 'video-2', data: { current: { trackId: 'video-2' } } };
const targetClip = { id: 'drop-clip-clip-b', data: { current: { trackId: 'video-2', type: 'clip' } } };
let pointerInputs;
let pointerResults = [
    { id: 'video-2' },
    { id: 'drop-clip-clip-b' },
];
const collisionDetection = createClipCollisionDetection({
    pointerWithin(args) {
        pointerInputs = args.droppableContainers;
        return pointerResults;
    },
    rectIntersection() { return [{ id: 'fallback' }]; },
});
const hits = collisionDetection({
    active: { id: 'clip-a', data: { current: { clip: { id: 'clip-a' } } } },
    droppableContainers: [sourceDrop, targetLane, targetClip],
});
assert.deepEqual(pointerInputs, [targetLane, targetClip], 'clip drag ignores its own moving drop target');
assert.deepEqual(hits, [{ id: 'drop-clip-clip-b' }], 'dropping over a clip targets its destination track');

pointerResults = [];
const fallbackHits = collisionDetection({
    active: { id: 'clip-a', data: { current: { clip: { id: 'clip-a' } } } },
    droppableContainers: [sourceDrop, targetLane],
});
assert.deepEqual(fallbackHits, [{ id: 'fallback' }], 'rectangle collision remains a fallback when pointer hits are unavailable');
assert.deepEqual(collisionDetection({
    active: { id: 'effect-1', data: { current: { type: 'effect' } } },
    droppableContainers: [sourceDrop, targetLane],
}), [{ id: 'fallback' }], 'non-clip drags retain the existing collision behavior');

const layout = await readFile(new URL('../client/src/layouts/IDELayout.jsx', import.meta.url), 'utf8');
assert.match(layout, /collisionDetection=\{clipCollisionDetection\}/, 'the clip-aware collision strategy is wired into the editor drag context');
assert.match(layout, /getClipDropStart\(/, 'drop placement uses the tested horizontal timeline conversion');

console.log('✅ Clip drag placement checks passed');
