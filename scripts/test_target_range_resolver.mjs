import assert from 'node:assert/strict';
import { buildTimelineSourceMap, clampToTimelineRange, mapFindingsToTimeline, mergeAdjacentFindings, wordsInTimelineRange } from '../client/src/timeline/targetRangeResolver.js';

const tracks = [
    { id: 'v1', type: 'video', clips: [
        { id: 'use-a', assetId: 'asset-a', start: 5, duration: 4, offset: 10, speed: 2 },
        { id: 'use-b', assetId: 'asset-a', start: 20, duration: 20, offset: 0, speed: 1 },
        { id: 'use-other', assetId: 'asset-b', start: 30, duration: 10, offset: 0, speed: 1 },
    ] },
    { id: 'text', type: 'text', clips: [{ id: 'title', assetId: 'asset-a', start: 0, duration: 3 }] },
];

const finding = { id: 'target-1', assetId: 'asset-a', sourceStart: 12, sourceEnd: 16, kind: 'object', label: 'red car', evidence: 'red car visible', confidence: 0.91 };
const resolved = mapFindingsToTimeline([finding], tracks);
assert.equal(resolved.length, 2, 'one source finding maps to both timeline uses');
assert.deepEqual(resolved.map(x => [x.clipId, x.timelineStart, x.timelineEnd]), [
    ['use-a', 6, 8], // source 12–16 at 2x playback from timeline second 5
    ['use-b', 32, 36],
]);
assert.equal(resolved[0].kind, 'object');
assert.equal(resolved[0].confidence, 0.91);

const sourceMap = buildTimelineSourceMap(tracks, [{ id: 'asset-a', name: 'street.mp4' }]);
assert.equal(sourceMap.length, 3, 'source map excludes non-video caption placements');
assert.deepEqual(sourceMap[0], {
    assetId: 'asset-a', assetName: 'street.mp4', clipId: 'use-a', trackId: 'v1',
    sourceStart: 10, sourceEnd: 18, timelineStart: 5, timelineEnd: 9, speed: 2,
});

const grouped = mergeAdjacentFindings([
    { ...resolved[0], timelineStart: 6, timelineEnd: 6.5, sourceStart: 12, sourceEnd: 13 },
    { ...resolved[0], timelineStart: 6.7, timelineEnd: 7, sourceStart: 13.4, sourceEnd: 14 },
], 0.25);
assert.equal(grouped.length, 1, 'adjacent observations merge only for the same target and clip');
assert.equal(grouped[0].timelineEnd, 7);
assert.equal(grouped[0].confidence, 0.91);

const words = [
    { word: 'before', start: 1, end: 2 },
    { word: 'target', start: 4.8, end: 5.2 },
    { word: 'after', start: 8, end: 9 },
];
assert.deepEqual(wordsInTimelineRange(words, { start: 5, end: 8 }), [words[1]], 'word range includes tokens that overlap either boundary');
assert.deepEqual(clampToTimelineRange(4, 5, { start: 5, end: 7 }, 0.5), { start: 5, duration: 2 }, 'B-roll placement is clamped to selected range');
assert.equal(clampToTimelineRange(1, 0.2, { start: 5, end: 7 }, 0.5), null, 'tiny/outside placements are refused');

console.log('ALL TARGET-RANGE RESOLVER CHECKS PASSED');
