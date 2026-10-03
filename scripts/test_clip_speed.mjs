// Clip speed: a speed change keeps the clip's own piece of source (not the
// whole asset), later clips and captions move with it, split/trim/cut keep the
// right source in-point, and the exporter's time map does not apply speed twice.
// node scripts/test_clip_speed.mjs
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { default: S } = await import('../client/src/store/useTimelineStore.js');
const { buildTimeMap, timelineToOutputTime } = await import('../client/src/motion/Compositor.js');
const { mediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const tm = window.timelineManager;
const st = () => S.getState();
const vclips = () => st().tracks.find(t => t.type === 'video').clips.map(c => ({ id: c.id, start: +c.start.toFixed(3), dur: +c.duration.toFixed(3), off: +(c.offset || 0).toFixed(3), sp: c.speed || 1 }));
const texts = () => st().tracks.filter(t => t.type === 'text').flatMap(t => t.clips).map(c => ({ id: c.id, start: +c.start.toFixed(3), dur: +c.duration.toFixed(3) }));

function setup() {
    tm.fromLegacyTracks([
        { id: 'track-default-video', type: 'video', name: 'V', clips: [
            { id: 'a', clipId: 'ea', assetId: 'x', type: 'video', name: 'A.MOV', start: 0, duration: 8, offset: 0, speed: 1, sourceDuration: 20 },
            { id: 'b', clipId: 'eb', assetId: 'x', type: 'video', name: 'A.MOV', start: 8, duration: 12, offset: 8, speed: 1, sourceDuration: 20 }] },
        { id: 'track-text', type: 'text', name: 'T', clips: [
            { id: 't1', clipId: 'et1', type: 'text', content: 'in a', start: 2, duration: 2 },
            { id: 't2', clipId: 'et2', type: 'text', content: 'in b', start: 10, duration: 2 }] },
    ]);
    S.setState({ tracks: tm.toLegacyTracks(), duration: 20, past: [], future: [],
        captions: [{ word: 'two', start: 2, end: 2.5 }, { word: 'ten', start: 10, end: 10.5 }] });
}

// ── Speed keeps the clip's own source, not the whole asset ───────────────
setup();
st().setClipSpeed('track-default-video', 'a', 0.5);
let v = vclips();
assert.deepEqual(v[0], { id: 'a', start: 0, dur: 16, off: 0, sp: 0.5 }, '8 s at 0.5x = 16 s (it used to become 20 / 0.5 = 40 s)');
assert.equal(v[1].start, 16, 'the next clip moves along instead of being run over');
assert.deepEqual(texts(), [{ id: 't1', start: 4, dur: 4 }, { id: 't2', start: 18, dur: 2 }], 'caption inside stretches with the clip, caption after moves');
assert.deepEqual(st().captions.map(w => [w.start, w.end]), [[4, 5], [18, 18.5]], 'word captions remapped');
assert.equal(st().duration, 28, 'timeline end follows');
st().undo();
assert.deepEqual(vclips().map(c => [c.start, c.dur, c.sp]), [[0, 8, 1], [8, 12, 1]], 'one undo restores');
assert.deepEqual(st().captions.map(w => w.start), [2, 10], 'undo restores word captions');
log('✓ slow-down: same source, 2x longer, later clips + captions move, one undo');

setup();
st().setClipSpeed('track-default-video', 'b', 2);
v = vclips();
assert.deepEqual(v[1], { id: 'b', start: 8, dur: 6, off: 8, sp: 2 }, '12 s at 2x = 6 s (it used to become 20 / 2 = 10 s)');
st().setClipSpeed('track-default-video', 'b', 1);
assert.equal(vclips()[1].dur, 12, 'back to 1x = original length');
log('✓ speed-up: half as long; back to 1x restores the length');

// ── Split / trim on a sped clip keep the right source in-point ───────────
setup();
st().setClipSpeed('track-default-video', 'a', 0.5); // a: 0-16, source 0-8
st().splitClip('track-default-video', 'a', 4);
v = vclips();
assert.equal(v[1].off, 2, 'split 4 s into a 0.5x clip = 2 s of source (it used to say 4)');
assert.equal(v[1].dur, 12);
st().trimClip('track-default-video', v[1].id, 'start', 2);
assert.equal(vclips()[1].off, 3, 'trimming 2 s off the start of a 0.5x clip moves the in-point 1 s');
log('✓ split and trim on a sped clip move the source in-point by time × speed');

// ── Silence/retake cuts on a sped clip ───────────────────────────────────
setup();
st().setClipSpeed('track-default-video', 'b', 2); // b: timeline 8-14, source 8-20
// keep source 0-8 and 12-20 (cut 8-12 = 2 s of timeline in the 2x clip)
mediaExecutionEngine._applySegmentsToTimeline([{ start: 0, end: 8, duration: 8 }, { start: 12, end: 20, duration: 8 }], 'test');
v = vclips();
const last = v[v.length - 1];
assert.equal(last.off, 12);
assert.equal(last.dur, 4, '8 s of source at 2x = 4 s on the timeline (not 8)');
assert.equal(last.sp, 2);
assert.equal(+(last.start).toFixed(3), 8, 'packed right after the first piece');
log('✓ cuts on a 2x clip keep its speed and length');

// ── Export time map: no double speed ──────────────────────────────────────
const map = buildTimeMap([{ id: 'a', start: 0, duration: 8, speed: 1 }, { id: 'b', start: 8, duration: 6, speed: 2 }]);
assert.equal(map.totalDuration, 14, 'output length = timeline length');
assert.equal(timelineToOutputTime(map, 11), 11, 'time inside a 2x clip maps 1:1');
const exp = fs.readFileSync(new URL('../jobs/exportProcessor.js', import.meta.url), 'utf8');
assert.ok(!/setDuration\(dur \/ speed\)/.test(exp) && !/cumulativeOut \+= dur \/ speed/.test(exp), 'exporter no longer divides the clip length by speed');
assert.ok(/\.setDuration\(dur\);/.test(exp), 'segment -t is the timeline length');
const preview = fs.readFileSync(new URL('../client/src/revideo/project.tsx', import.meta.url), 'utf8');
assert.ok(/time=\{\(\) => \(playback\.time - clip\.start\) \* \(clip\.speed \|\| 1\) \+ \(clip\.offset \|\| 0\)\}/.test(preview) && /playbackRate=\{clip\.speed \|\| 1\}/.test(preview), 'preview plays the clip at its speed');
log('✓ export time map and preview agree on speed');

log('\nALL CLIP-SPEED CHECKS PASSED');
process.exit(0);
