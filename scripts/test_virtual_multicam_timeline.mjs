import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { splitClipAtSpeakerSegments } from '../client/src/agent/virtualMulticamTimeline.js';
const require = createRequire(import.meta.url);
const { useWideDuoBoundary, soloAngleForChunk } = require('../routes/virtualMulticamAngles.js');

const camera = (angle, start, end) => ({
    angle, start, end, speaker: `SPEAKER_${angle}`,
    scale: 2, cropX: angle === 'left' ? 0.1 : 0.5, cropY: 0.1, cropW: 0.4, cropH: 0.4,
});

const partial = splitClipAtSpeakerSegments(
    { id: 'clip', start: 5, duration: 10, offset: 10, speed: 1 },
    [camera('left', 12, 15)],
);
assert.deepEqual(partial.map(p => [p.clip.start, p.clip.duration, p.clip.offset, p.clip.virtualCam.angle]), [
    [5, 2, 10, 'wide'],
    [7, 3, 12, 'left'],
    [10, 5, 15, 'wide'],
]);
assert.equal(partial.at(-1).clip.end, 15, 'the original timeline end must stay fixed');

const retimed = splitClipAtSpeakerSegments(
    { id: 'retimed', start: 20, duration: 5, offset: 10, speed: 2 },
    [camera('left', 12, 14), camera('right', 16, 19)],
);
assert.deepEqual(retimed.map(p => [p.clip.start, p.clip.duration, p.clip.offset, p.clip.virtualCam.angle]), [
    [20, 1, 10, 'wide'],
    [21, 1, 12, 'left'],
    [22, 1, 14, 'wide'],
    [23, 1.5, 16, 'right'],
    [24.5, 0.5, 19, 'wide'],
]);
assert.equal(retimed.reduce((sum, p) => sum + p.clip.duration, 0), 5, 'retimed pieces must cover the original timeline duration');

const full = splitClipAtSpeakerSegments(
    { id: 'whole', start: 3, duration: 4, offset: 8 },
    [camera('left', 8, 12)],
);
assert.equal(full.length, 1);
assert.equal(full[0].clip.id, 'whole', 'a full-clip turn should not create a new clip id');
assert.equal(full[0].clip.virtualCam.angle, 'left');
assert.deepEqual(splitClipAtSpeakerSegments(
    { id: 'unmatched', start: 0, duration: 2, offset: 0 },
    [camera('left', 5, 7)],
), [], 'an unrelated source-time segment should not tag the clip');

const engine = readFileSync(new URL('../client/src/agent/MediaExecutionEngine.js', import.meta.url), 'utf8');
assert.match(engine, /splitClipAtSpeakerSegments\(clip, clipSegs\)/, 'virtual_multicam must use the tested source-to-timeline splitter');
const route = readFileSync(new URL('../routes/interviewRoutes.js', import.meta.url), 'utf8');
assert.match(route, /useWideDuoBoundary\(i, rawSegments\.length\)/, 'duo angle planning must keep short dialogue edits from forcing every turn wide');
assert.match(route, /soloAngleForChunk\(i, chunks\.length, cycleIdx\)/, 'solo angle planning must use the tested turn-count policy');
assert.equal(useWideDuoBoundary(0, 2), false, 'two speaker turns must be eligible for close-up crops');
assert.equal(useWideDuoBoundary(1, 2), false);
assert.equal(useWideDuoBoundary(0, 3), true, 'longer interviews keep their establishing wide shot');
assert.equal(useWideDuoBoundary(2, 3), true, 'longer interviews keep their closing wide shot');
assert.equal(soloAngleForChunk(0, 2), 'wide');
assert.equal(soloAngleForChunk(1, 2), 'close', 'a two-chunk single-person podcast must create an actual close-up');
assert.equal(soloAngleForChunk(1, 3), 'close');
console.log('ALL VIRTUAL MULTICAM TIMELINE TESTS PASSED');
