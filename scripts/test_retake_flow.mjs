// Retake flow in the app: source-time transcript of the right video, review
// before cutting (Apply / Cancel), cut applied to that video only.
// node scripts/test_retake_flow.mjs
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { resolveRetakeSource, retakeReviewLines } = await import('../client/src/agent/retakeSource.js');

// ── Source selection ──────────────────────────────────────────────────────
const W = (arr) => arr.map(([word, start, end]) => ({ word, start, end }));
const srcA = W([['hello', 10, 10.4], ['there', 10.5, 11]]);
const srcB = W([['other', 1, 2]]);
const base = {
    assets: [{ id: 'a', name: 'IMG_1.MOV', gcsPath: 'raw/u/171-IMG_1.MOV' }, { id: 'b', name: 'IMG_2.MOV' }],
    transcripts: { '171-IMG_1.MOV': srcA, 'IMG_2.MOV': srcB },
    captions: W([['hello', 0, 0.4]]), // timeline time (after a cut)
    tracks: [{ id: 'v', type: 'video', clips: [{ id: 'c1', assetId: 'a', start: 0, offset: 10, duration: 5 }, { id: 'c2', assetId: 'a', start: 5, offset: 20, duration: 5 }, { id: 'c3', assetId: 'b', start: 10, offset: 0, duration: 3 }] }],
};
let s = resolveRetakeSource(base, {});
assert.equal(s.assetId, 'a', 'primary recording = most clips on the main track');
assert.deepEqual(s.words.map(w => w.start), [10, 10.5], 'SOURCE-time transcript, not timeline captions');
s = resolveRetakeSource(base, { assetId: 'b' });
assert.deepEqual(s.words.map(w => w.word), ['other'], 'per video, never flattened together');
s = resolveRetakeSource(base, { filePath: 'raw/u/171-IMG_1.MOV' });
assert.equal(s.assetId, 'a');
s = resolveRetakeSource({ ...base, transcripts: {} }, {});
assert.equal(s.error, 'no_transcript', 'edited timeline: captions are not source time → refuse');
s = resolveRetakeSource({ ...base, transcripts: {}, tracks: [{ id: 'v', type: 'video', clips: [{ id: 'c1', assetId: 'a', start: 0, offset: 0, duration: 5, speed: 1 }] }] }, {});
assert.deepEqual(s.words.map(w => w.word), ['hello'], 'one untouched clip: captions = source time');
log('✓ retakes read ONE video\'s source-time transcript');

const lines = retakeReviewLines([{ takes: 3, keptTake: 3, kept: { text: 'Tony Robbins, qui est une personne qui a été bien connue dans le domaine du développement personnel' }, removed: [{ start: 4.6, end: 13.1 }, { start: 13.1, end: 25 }] }],
    (k, o) => o.defaultValue.replace(/{{(\w+)}}/g, (_, x) => o[x]));
assert.match(lines[0], /^3 takes of “Tony Robbins, qui est une personne qui a été bien connue dans le doma…”/, "quote shortened to 70 chars");
assert.match(lines[0], /keeping take 3, removing 20\.4 s$/);
log('✓ review lines: "3 takes of …: keeping take 3, removing 20.4 s"');

// ── End to end through MediaExecutionEngine ───────────────────────────────
const GROUPS = [{ takes: 2, keptTake: 2, kept: { start: 14, end: 16, text: 'the good take' }, removed: [{ start: 10, end: 14 }] }];
let posted = null;
globalThis.fetch = async (url, opts = {}) => {
    posted = JSON.parse(opts.body || '{}');
    return { ok: true, status: 200, headers: { get: () => 'application/json' },
        json: async () => ({ activeSegments: [{ start: 0, end: 10.04, duration: 10.04 }, { start: 13.96, end: 30, duration: 16.04 }], removedRanges: [{ start: 10, end: 14 }], removedCount: 1, groups: GROUPS }) };
};
const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { mediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');
const { EventBus, EVENT_TYPES } = await import('../client/src/agent/EventBus.js');
const tm = window.timelineManager;
function setup() {
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [{ id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', name: 'IMG_1.MOV', start: 0, duration: 30, offset: 0, speed: 1 }] }]);
    useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 30, past: [], future: [], uploadedFile: { name: 'IMG_1.MOV' }, uploadedFilePath: 'raw/u/IMG_1.MOV',
        assets: [{ id: 'a', type: 'video', name: 'IMG_1.MOV', gcsPath: 'raw/u/IMG_1.MOV', duration: 30 }],
        transcripts: { 'IMG_1.MOV': W([['the', 10, 10.5], ['take', 11, 12], ['the', 14, 14.5], ['good', 14.6, 15], ['take', 15.1, 16]]) } });
}
const plan = { plan_id: 'p', operation: 'remove_repetition', steps: [{ step_id: 'step_1', action: 'remove_repeated_takes' }], intent: { confidence: 'HIGH', operation: 'remove_repetition' } };
async function runWith(answer) {
    setup();
    let review = null;
    const off = EventBus.on(EVENT_TYPES.APPROVAL_REQUIRED, (p) => {
        review = p;
        setTimeout(() => EventBus.emit(answer ? EVENT_TYPES.APPROVAL_GRANTED : EVENT_TYPES.APPROVAL_DENIED, { jobId: p.jobId }), 5);
    });
    const comp = CommandCompiler.compile(plan, useTimelineStore.getState());
    const r = await mediaExecutionEngine.execute(comp.commands, () => {}, null);
    off?.();
    const clips = useTimelineStore.getState().tracks.find(t => t.type === 'video').clips.map(c => [+(c.offset || 0).toFixed(2), +c.duration.toFixed(2)]);
    return { r, review, clips };
}
let out = await runWith(true);
assert.deepEqual(posted.words.map(w => w.start), [10, 11, 14, 14.6, 15.1], 'posts the source-time transcript');
assert.equal(out.review.kind, 'take_review');
assert.match(out.review.actions, /2 takes of “the good take”: keeping take 2/);
assert.equal(out.r.success, true);
assert.equal(out.clips.length, 2, 'Apply → the earlier take is cut');
log('✓ Apply: review shown, earlier take removed (' + JSON.stringify(out.clips) + ')');
out = await runWith(false);
assert.equal(out.r.success, true);
assert.deepEqual(out.clips, [[0, 30]], 'Cancel → nothing cut');
log('✓ Cancel: timeline untouched');

log('\nALL RETAKE-FLOW CHECKS PASSED');
process.exit(0);
