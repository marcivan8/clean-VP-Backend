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

// A selected transcript range must be independently editable even when the
// source placement is also used by another part of the edit.
const multiUse = [{ id: 'track-default-video', type: 'video', clips: [
    { id: 'c1', clipId: 'shared-entity', assetId: 'a', type: 'video', start: 0, duration: 10, offset: 0, speed: 1 },
    { id: 'c2', clipId: 'shared-entity', assetId: 'a', type: 'video', start: 12, duration: 5, offset: 0, speed: 1 },
] }];
tm.fromLegacyTracks(multiUse);
S.setState({ tracks: tm.toLegacyTracks(), assets, duration: 17, past: [], future: [] });
const historyBeforeSegment = S.getState().past.length;
const selectedPiece = S.getState().isolateTimelineRange(3, 6);
assert.equal(selectedPiece.length, 1);
assert.equal(selectedPiece[0].start, 3);
assert.equal(selectedPiece[0].duration, 3);
assert.notEqual(selectedPiece[0].clipId, 'shared-entity', 'the selected piece must detach from the shared source entity');
assert.equal(S.getState().past.length, historyBeforeSegment + 1, 'range isolation is one undo step');
S.getState().updateClip('track-default-video', selectedPiece[0].id, { filter: 'warm' }, { skipHistory: true });
const isolatedTracks = S.getState().tracks.find(t => t.id === 'track-default-video').clips;
assert.equal(isolatedTracks.find(c => c.id === selectedPiece[0].id).filter, 'warm');
assert.ok(isolatedTracks.filter(c => c.id !== selectedPiece[0].id).every(c => !c.filter), 'the visual edit leaked outside the selected range');
S.getState().undo();
assert.equal(S.getState().tracks.find(t => t.id === 'track-default-video').clips.length, 2, 'one undo restores the original unsplit multi-clip edit');
console.log('✓ selected segment isolation: independent clip entity, one undo, no effect leakage');

// Regenerating captions for one range replaces only that region and keeps
// words from captions that crossed either selection boundary.
tm.fromLegacyTracks(tracks);
S.setState({ tracks: tm.toLegacyTracks(), assets, duration: 10, past: [], future: [] });
S.getState().addCaptionClips([
    { text: 'before keep selected', start: 0, end: 4, words: [
        { word: 'before', start: 0.2, end: 0.5 }, { word: 'keep', start: 0.6, end: 0.9 }, { word: 'selected', start: 3.2, end: 3.8 },
    ] },
    { text: 'replace later', start: 4, end: 8, words: [
        { word: 'replace', start: 4.2, end: 4.8 }, { word: 'later', start: 7, end: 7.6 },
    ] },
]);
S.getState().addCaptionClips([
    { text: 'new segment captions', start: 3.1, end: 4.9, words: [
        { word: 'new', start: 3.1, end: 3.5 }, { word: 'segment', start: 3.5, end: 4.2 }, { word: 'captions', start: 4.2, end: 4.9 },
    ] },
], { replaceRange: [3, 5] });
const captionTexts = S.getState().tracks.filter(t => t.type === 'text').flatMap(t => t.clips || [])
    .filter(c => String(c.clipId || c.id).startsWith('caption-')).map(c => c.content);
assert.ok(captionTexts.some(text => /before keep/.test(text)), `pre-range words disappeared: ${captionTexts}`);
assert.ok(captionTexts.some(text => /new segment captions/.test(text)), `selected-range captions missing: ${captionTexts}`);
assert.ok(captionTexts.some(text => /later/.test(text)), `post-range words disappeared: ${captionTexts}`);
assert.ok(!captionTexts.some(text => /selected|replace/.test(text)), `old captions inside range were not replaced: ${captionTexts}`);
console.log('✓ scoped caption regeneration: only selected interval replaced, boundary words preserved');
console.log('\nALL TRANSCRIPT-EDIT CHECKS PASSED');
