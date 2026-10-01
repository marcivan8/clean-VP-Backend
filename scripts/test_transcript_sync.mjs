// Transcript/caption sync after edits: timeline/transcriptMap.js + timeline/rangeCut.js (pure).
// node scripts/test_transcript_sync.mjs
import assert from 'assert/strict';
import { mapTranscriptToTimeline, listMainTrackSources } from '../client/src/timeline/transcriptMap.js';
const A = ['one','two','three','four','five','six'].map((w,i)=>({word:w,start:i+0.1,end:i+0.8}));
const B = ['alpha','beta','gamma'].map((w,i)=>({word:w,start:i+0.1,end:i+0.8}));
const transcripts = { '111-A.MOV': A, '222-B.MOV': B };
const assets = [{ id:'a', name:'A.MOV', gcsPath:'raw/u/111-A.MOV' }, { id:'b', name:'B.MOV', gcsPath:'raw/u/222-B.MOV' }];
const V = (clips) => [{ id:'track-default-video', type:'video', clips }, { id:'txt', type:'text', clips: [] }];
const words = (r) => r.map(w => w.word+'@'+w.start.toFixed(1)).join(' ');
let r = mapTranscriptToTimeline({ tracks: V([{id:'c1',assetId:'a',start:0,duration:3,offset:3},{id:'c2',assetId:'a',start:3,duration:2,offset:0},{id:'c3',assetId:'b',start:5,duration:3,offset:0}]), assets, transcripts });
assert.equal(words(r), 'four@0.1 five@1.1 six@2.1 one@3.1 two@4.1 alpha@5.1 beta@6.1 gamma@7.1');
r = mapTranscriptToTimeline({ tracks: V([{id:'c',assetId:'a',start:10,duration:2,offset:0,speed:2}]), assets, transcripts });
assert.equal(words(r), 'one@10.1 two@10.6 three@11.1 four@11.6');
r = mapTranscriptToTimeline({ tracks: V([{id:'c',assetId:'a',start:0,duration:1.3,offset:0.2}]), assets, transcripts });
assert.equal(words(r), 'one@0.0 two@0.9');
r = mapTranscriptToTimeline({ tracks: V([{id:'c',assetId:'a',start:0,duration:2,offset:1}]), assets, transcripts: {}, fallbackWords: A });
assert.equal(words(r), 'two@0.1 three@1.1');
r = mapTranscriptToTimeline({ tracks: V([{id:'c',assetId:'b',start:0,duration:1,offset:0}]), assets: [{id:'b',name:'B.MOV'}], transcripts: {'B.MOV': B} });
assert.equal(words(r), 'alpha@0.1');
// sources: every distinct file on the main track, b-roll/images ignored
const src = listMainTrackSources([
  { id:'m', type:'video', clips:[{id:'1',assetId:'a',start:0,duration:1},{id:'2',assetId:'b',start:1,duration:1},{id:'3',assetId:'a',start:2,duration:1},{id:'4',assetId:'img',start:3,duration:1}] },
  { id:'br', type:'video', clips:[{id:'5',assetId:'c',start:0,duration:1}] }],
  [...assets, {id:'img',type:'image',gcsPath:'raw/u/p.png'}, {id:'c',gcsPath:'raw/u/333-C.MOV'}]);
assert.deepEqual(src, [{key:'111-A.MOV',path:'raw/u/111-A.MOV',name:'A.MOV'},{key:'222-B.MOV',path:'raw/u/222-B.MOV',name:'B.MOV'}]);
assert.deepEqual(listMainTrackSources([], assets), []);
console.log('ALL TRANSCRIPT-MAP CHECKS PASSED');
import { computeRangeCut } from '../client/src/timeline/rangeCut.js';

const TT = (main, text = [], extra = []) => [
  { id: 'main', type: 'video', clips: main },
  ...extra,
  { id: 'txt', type: 'text', clips: text },
];
const WW = (arr) => arr.map(([t, s, e]) => ({ text: t, start: s, end: e }));

// 1) cut inside one clip of a 2-file edit: only that clip is split, later clip slides left
let p; p = computeRangeCut(TT([
  { id: 'c1', clipId: 'e1', assetId: 'a', start: 0, duration: 4, offset: 10 },
  { id: 'c2', clipId: 'e2', assetId: 'b', start: 4, duration: 3, offset: 0 },
]), 1, 2);
assert.deepEqual(p.updates.find(u => u.id === 'c1').updates, { duration: 1 });
assert.deepEqual(p.adds, [{ fromId: 'c1', overrides: { startTime: 1, duration: 2, offset: 12 } }]);
assert.deepEqual(p.updates.find(u => u.id === 'c2').updates, { startTime: 3 });
assert.equal(p.removeIds.length, 0);
console.log('✓ spanning clip split, file-B clip untouched except sliding left');

// 2) the old bug: same source time in another clip must NOT be cut
p = computeRangeCut(TT([
  { id: 'c1', clipId: 'e1', assetId: 'a', start: 0, duration: 3, offset: 0 },
  { id: 'c2', clipId: 'e2', assetId: 'b', start: 3, duration: 3, offset: 0 },
]), 3.5, 4);   // cut inside c2 only
assert.ok(!p.updates.some(u => u.id === 'c1')); assert.ok(!p.removeIds.includes('c1'));
console.log('✓ cutting in clip B leaves clip A (same source seconds) alone');

// 3) range spanning a clip boundary: trims right of c1, trims left of c2
p = computeRangeCut(TT([
  { id: 'c1', clipId: 'e1', start: 0, duration: 3, offset: 5 },
  { id: 'c2', clipId: 'e2', start: 3, duration: 3, offset: 20, speed: 2 },
]), 2, 4);
assert.deepEqual(p.updates.find(u => u.id === 'c1').updates, { duration: 2 });
assert.deepEqual(p.updates.find(u => u.id === 'c2').updates, { startTime: 2, duration: 2, offset: 22 });
console.log('✓ cross-boundary cut, speed-aware offset (2x: 1s timeline = 2s source)');

// 4) clip fully inside removed
p = computeRangeCut(TT([
  { id: 'c1', clipId: 'e1', start: 0, duration: 2 },
  { id: 'c2', clipId: 'e2', start: 2, duration: 1 },
  { id: 'c3', clipId: 'e3', start: 3, duration: 2 },
]), 2, 3);
assert.deepEqual(p.removeIds, ['c2']);
assert.deepEqual(p.updates, [{ id: 'c3', updates: { startTime: 2 } }]);
console.log('✓ clip fully inside removed, next clip closes the gap');

// 5) captions: words in range dropped, rest re-timed, text rewritten, later caption moved
p = computeRangeCut(TT(
  [{ id: 'c1', clipId: 'e1', start: 0, duration: 10 }],
  [
    { id: 'k1', clipId: 'ke1', start: 1, duration: 3, content: 'one two three', words: WW([['one', 1, 1.8], ['two', 2, 2.8], ['three', 3, 3.8]]) },
    { id: 'k2', clipId: 'ke2', start: 5, duration: 1, content: 'four', words: WW([['four', 5, 5.8]]) },
  ]), 2, 3);
const k1u = p.updates.find(u => u.id === 'k1').updates;
assert.deepEqual(k1u, { startTime: 1, duration: 2 });
const k1w = p.wordEdits.find(e => e.id === 'k1');
assert.equal(k1w.content, 'one three');
assert.deepEqual(k1w.words.map(w => [w.text, w.start, +w.end.toFixed(3)]), [['one', 1, 1.8], ['three', 2, 2.8]]);
assert.deepEqual(p.updates.find(u => u.id === 'k2').updates, { startTime: 4 });
console.log('✓ caption loses cut word, remaining words re-timed, caption after cut slides left');

// 6) caption whose words are all cut is removed; user-edited text is not overwritten
p = computeRangeCut(TT(
  [{ id: 'c1', clipId: 'e1', start: 0, duration: 10 }],
  [
    { id: 'k1', clipId: 'ke1', start: 2, duration: 1, content: 'two', words: WW([['two', 2, 2.8]]) },
    { id: 'k2', clipId: 'ke2', start: 3, duration: 2, content: 'MY TEXT', words: WW([['three', 3, 3.8], ['four', 4, 4.8]]) },
  ]), 2, 4);
assert.ok(p.removeIds.includes('k1'));
const k2 = p.wordEdits.find(e => e.id === 'k2');
assert.equal(k2.content, undefined);
assert.deepEqual(k2.words.map(w => w.text), ['four']);
console.log('✓ empty caption removed, user-typed caption text preserved');

// 7) b-roll / audio untouched; text overlay inside range lands on cut point
p = computeRangeCut(TT(
  [{ id: 'c1', clipId: 'e1', start: 0, duration: 10 }],
  [{ id: 'o1', clipId: 'oe', start: 3, duration: 0.5, content: 'hi' }],
  [{ id: 'broll', type: 'video', clips: [{ id: 'b1', clipId: 'be', start: 6, duration: 2 }] },
   { id: 'aud', type: 'audio', clips: [{ id: 'm1', clipId: 'me', start: 6, duration: 2 }] }]), 2, 4);
assert.ok(!p.updates.some(u => ['b1', 'm1'].includes(u.id)));
assert.deepEqual(p.updates.find(u => u.id === 'o1').updates, { startTime: 2 });
console.log('✓ b-roll and audio untouched, overlay inside the cut kept at the cut point');

// 8) cut in a pause inside a caption: no words removed, later words still slide left
p = computeRangeCut(TT(
  [{ id: 'c1', clipId: 'e1', start: 0, duration: 10 }],
  [{ id: 'k1', clipId: 'ke1', start: 1, duration: 4, content: 'a b', words: WW([['a', 1, 1.5], ['b', 4, 4.5]]) }]), 2, 3);
const k = p.wordEdits.find(e => e.id === 'k1');
assert.deepEqual(k.words.map(w => [w.text, w.start]), [['a', 1], ['b', 3]]);
assert.equal(k.content, undefined);
console.log('✓ cut in a pause re-times the words after it');

// 9) invalid / no-op
assert.equal(computeRangeCut(TT([{ id: 'c1', start: 0, duration: 2 }]), 3, 3).changed, false);
assert.equal(computeRangeCut([], 0, 1).changed, false);
console.log('✓ empty range / empty timeline is a no-op');
console.log('\nALL RANGE-CUT CHECKS PASSED');
