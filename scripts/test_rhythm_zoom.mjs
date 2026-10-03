// Zoom rhythm: source-time words per shot, one uncut clip works (virtual
// shots, nothing cut), keyframes in clip-local time, one undo step.
// node scripts/test_rhythm_zoom.mjs
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { srtToWords } = require('./lib/srtWords.js');

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 400;
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {};

let posted = null;
globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('rhythm-zoom')) {
        posted = JSON.parse(opts.body || '{}');
        // Echo a plan: first shot push-in, the others punch in on their 2nd word.
        const clipZooms = posted.clips.map((c, i) => {
            if (i === 0) return { clipId: c.id, scale: 1.1, type: 'medium', motion: { kind: 'push_in', from: 1.045, to: 1.1 } };
            const w = c.words[1] || c.words[0];
            return { clipId: c.id, scale: 1.2, type: 'close', motion: { kind: 'punch_in', from: 1.116, to: 1.2, at: +(w.start - c.offset).toFixed(3) } };
        });
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ clipZooms, summary: { counts: { medium: 1, close: clipZooms.length - 1 }, motions: { push_in: 1, punch_in: clipZooms.length - 1 } } }) };
    }
    return { ok: false, status: 503, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '' };
};

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');
const { mediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const { clipSourceWords, splitClipIntoShots, buildRhythmRequest, shotsToKeyframes } = await import('../client/src/agent/rhythmShots.js');
const tm = window.timelineManager;
const W = (a) => a.map(([word, start, end]) => ({ word, start, end }));

// ── Pure: time base ───────────────────────────────────────────────────────
const transcript = W([['one', 0.5, 1], ['two', 2, 2.5], ['cut', 7, 7.5], ['eleven', 10.5, 11], ['twelve', 11.5, 12]]);
const captions = W([['one', 0.5, 1], ['two', 2, 2.5], ['eleven', 5.5, 6], ['twelve', 6.5, 7]]); // timeline, after a cut
const c2 = { id: 'v2', start: 5, duration: 5, offset: 10, speed: 1 };
assert.deepEqual(clipSourceWords(c2, transcript, captions).map(w => w.start), [10.5, 11.5], 'transcript: source range of the clip');
assert.deepEqual(clipSourceWords(c2, null, captions).map(w => w.start), [10.5, 11.5], 'captions mapped back to source time');
assert.deepEqual(clipSourceWords({ ...c2, speed: 2, duration: 2.5 }, null, W([['x', 6, 6.2]])).map(w => w.start), [12], 'speed applied when mapping back');
log('✓ words are SOURCE time per clip (transcript, or captions mapped back)');

// ── Pure: virtual shots on Marc's recording (129 s, one clip) ─────────────
const srt = srtToWords(new URL('./fixtures/retakes_fr.srt', import.meta.url).pathname);
const one = { id: 'c', start: 0, duration: 129, offset: 0, speed: 1 };
const shots = splitClipIntoShots(one, clipSourceWords(one, srt, null));
const lens = shots.map(s => s.srcEnd - s.srcStart);
assert.ok(shots.length >= 12 && shots.length <= 45, `one 129 s clip → ${shots.length} shots`);
assert.ok(Math.min(...lens) >= 1.4, `no tiny shots (min ${Math.min(...lens).toFixed(2)} s)`);
assert.ok(Math.max(...lens) <= 16, `no endless shots (max ${Math.max(...lens).toFixed(2)} s)`);
assert.equal(+shots[0].srcStart.toFixed(3), 0); assert.equal(+shots.at(-1).srcEnd.toFixed(3), 129);
for (let i = 1; i < shots.length; i++) assert.equal(shots[i].srcStart, shots[i - 1].srcEnd, 'shots tile the clip');
assert.ok(shots.every(s => s.words.length > 0), 'every shot has words');
assert.equal(splitClipIntoShots({ id: 's', duration: 6, offset: 0 }, srt.slice(0, 10)).length, 1, 'short clips stay one shot');
log(`✓ one uncut 129 s clip → ${shots.length} virtual shots (${Math.min(...lens).toFixed(1)}–${Math.max(...lens).toFixed(1)} s), nothing cut`);

// ── Pure: keyframes in clip-local timeline time (speed 2) ────────────────
const fast = { id: 'f', start: 0, duration: 5, offset: 20, speed: 2, _trackId: 'v' };
const req = buildRhythmRequest([fast], () => W([['a', 21, 21.5], ['b', 24, 24.5]]));
const kf = shotsToKeyframes(req.shots, [{ clipId: 'f', scale: 1.2, motion: { kind: 'punch_in', from: 1.1, to: 1.2, at: 4 } }], () => 5).get('f');
const snap = kf.find(k => k.value === 1.2);
assert.ok(Math.abs(snap.time - 2.06) < 0.01, `punch lands on the word in timeline time (source +4 s at 2x = 2 s), got ${snap.time}`);
assert.ok(kf.every((k, i) => i === 0 || k.time > kf[i - 1].time), 'keyframe times strictly increase');
log('✓ punch-in lands on the word in clip-local timeline time (speed-aware)');

// ── Parser: one clip → rhythm only, no hidden silence removal ────────────
function setup(clips, extra = {}) {
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips }]);
    useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 129, past: [], future: [],
        assets: [{ id: 'a', type: 'video', name: 'IMG_0001.MOV', duration: 129 }], captions: [], transcripts: { 'IMG_0001.MOV': srt }, ...extra });
}
setup([{ id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', name: 'IMG_0001.MOV', start: 0, duration: 129, offset: 0, speed: 1 }]);
for (const p of ['add zoom rhythm', 'rhythm zoom', 'make it more dynamic', 'zoom rhythm', 'dynamic zooms']) {
    const intent = await IntentParser.parse(p);
    const plan = await EditPlanner.generatePlan(intent);
    assert.deepEqual(plan.plan?.steps?.map(s => s.action), ['rhythm_zoom'], `"${p}" on one clip = zoom rhythm only`);
}
const both = await IntentParser.parse('clean it up and make it dynamic');
assert.equal(both.operation, 'compound_clean_dynamic', 'asking for both still cleans first');
log('✓ "rhythm zoom" on one clip zooms only (no silent clean-up); "clean + dynamic" unchanged');

// ── End to end: one uncut clip ────────────────────────────────────────────
async function runRhythm() {
    const intent = await IntentParser.parse('add zoom rhythm');
    const plan = await EditPlanner.generatePlan(intent);
    const comp = CommandCompiler.compile({ ...plan.plan, intent: { ...intent, confidence: 'HIGH' } }, useTimelineStore.getState());
    const before = useTimelineStore.getState().past.length;
    const r = await mediaExecutionEngine.execute(comp.commands, () => {}, null);
    return { r, undoSteps: useTimelineStore.getState().past.length - before };
}
let out = await runRhythm();
assert.equal(out.r.success, true, JSON.stringify(out.r).slice(0, 300));
assert.ok(posted.clips.length >= 12, 'virtual shots were sent');
assert.ok(posted.clips.every(c => Array.isArray(c.words) && c.words.length && c.words.every(w => w.start >= c.offset - 0.05 && w.start < c.offset + c.duration + 0.05)), 'each shot carries its own source-time words');
let clip = useTimelineStore.getState().tracks[0].clips[0];
assert.equal(useTimelineStore.getState().tracks[0].clips.length, 1, 'nothing was cut');
const scale = clip.keyframes.scale;
assert.ok(scale.length >= posted.clips.length * 2, `${scale.length} keyframes on the one clip`);
assert.ok(scale.every((k, i) => i === 0 || k.time > scale[i - 1].time), 'keyframe times strictly increase');
assert.ok(scale.at(-1).time <= 129 + 1e-6);
assert.equal(out.undoSteps, 1, `one undo step (was ~3 per shot), got ${out.undoSteps}`);
log(`✓ one uncut clip: ${posted.clips.length} shots, ${scale.length} keyframes, 1 undo step`);

// ── End to end: two clips after a cut (the old time-base bug) ────────────
setup([
    { id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', name: 'IMG_0001.MOV', start: 0, duration: 5, offset: 0, speed: 1 },
    { id: 'v2', clipId: 'ev2', assetId: 'a', type: 'video', name: 'IMG_0001.MOV', start: 5, duration: 5, offset: 10, speed: 1 },
], { transcripts: { 'IMG_0001.MOV': transcript }, captions });
out = await runRhythm();
assert.equal(out.r.success, true);
assert.deepEqual(posted.clips.map(c => c.words.map(w => w.word)), [['one', 'two'], ['eleven', 'twelve']], 'each shot gets ITS words (the second used to get none)');
clip = useTimelineStore.getState().tracks[0].clips[1];
const punch = clip.keyframes.scale.find(k => k.value === 1.2);
assert.ok(Math.abs(punch.time - 1.56) < 0.01, `punch on "twelve" at 1.5 s into the clip, got ${punch.time}`);
log('✓ after a cut, every shot gets its own words; punch-ins land on them');

log('\nALL RHYTHM-ZOOM CHECKS PASSED');
process.exit(0);
