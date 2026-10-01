// Mobile transcript editing (phase 5). node scripts/test_transcript_edit.mjs
import assert from 'assert/strict';
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.innerWidth = 390;
const { getDisplayWords, findFillerIndices, rangesForIndices, selectionSummary, activeWordIndexAt, normalizeWord } =
    await import('../client/src/timeline/transcriptSelect.js');

const A = ['So', 'today', 'um,', 'we', 'are', 'going', 'euh', 'uh', 'to', 'talk'].map((w, i) => ({ word: w, start: i, end: i + 0.8 }));
const assets = [{ id: 'a', type: 'video', gcsPath: 'raw/u/111-A.MOV' }];
const tracks = [{ id: 'track-default-video', type: 'video', clips: [{ id: 'c', clipId: 'e', assetId: 'a', type: 'video', start: 0, duration: 10, offset: 0, speed: 1 }] }];
const words = getDisplayWords({ transcripts: { '111-A.MOV': A }, transcriptVerified: { '111-A.MOV': true }, tracks, assets, captions: [] });
assert.equal(words.length, 10);
assert.equal(getDisplayWords({ transcripts: {}, tracks, assets, captions: [{ text: 'hi', start: 1, end: 2 }] })[0].word, 'hi', 'falls back to captions');
assert.equal(normalizeWord(' Euh, '), 'euh');
assert.deepEqual(findFillerIndices(words), [2, 6, 7]);
assert.deepEqual(rangesForIndices(words, [2, 6, 7]), [[2, 2.8], [6, 7.8]], 'neighbours merged');
const sum = selectionSummary(words, 5, 3);
assert.deepEqual([sum.first, sum.last, sum.count, sum.start, sum.end], [3, 5, 3, 3, 5.8]);
assert.equal(activeWordIndexAt(words, 4.5), 4); assert.equal(activeWordIndexAt(words, -1), -1);
console.log('✓ display words, fillers (en/fr), merged ranges, selection, active word');

// store: Remove all fillers = one undo step, only that clip shrinks, captions follow
const { default: S } = await import('../client/src/store/useTimelineStore.js');
const tm = window.timelineManager;
tm.fromLegacyTracks(tracks);
S.setState({ tracks: tm.toLegacyTracks(), assets, duration: 10, past: [], future: [] });
S.getState().setCaptions(A, 'raw/u/111-A.MOV');
const before = S.getState().past.length;
const n = S.getState().cutTimelineRanges(rangesForIndices(words, [2, 6, 7]));
assert.equal(n, 2);
assert.equal(S.getState().past.length, before + 1, 'one undo step');
const after = getDisplayWords({ ...S.getState() });
assert.equal(after.map(w => w.word).join(' '), 'So today we are going to talk');
const end = Math.max(...S.getState().tracks[0].clips.map(c => c.start + c.duration));
assert.ok(Math.abs(end - (10 - 0.8 - 1.8)) < 1e-6, 'timeline shortened by the filler time: ' + end);
S.getState().undo();
assert.equal(getDisplayWords({ ...S.getState() }).length, 10, 'undo restores');
assert.equal(S.getState().cutTimelineRanges([]), 0);
assert.equal(S.getState().past.length, before, 'empty batch leaves no undo step');
console.log('✓ Remove all fillers: one undo step, words gone, timeline shorter, undo restores');
console.log('\nALL TRANSCRIPT-EDIT CHECKS PASSED');
