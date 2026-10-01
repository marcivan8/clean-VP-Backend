// Mobile caption editing (phase 4): pure helpers + store actions.
// node scripts/test_caption_edits.mjs
import assert from 'assert/strict';
import { retimeWordsForText, splitCaption, splitIndexAtTime, mergeCaptions, shiftWords } from '../client/src/motion/captionEdits.js';
const Wp = (arr) => arr.map(([t, s, e]) => ({ text: t, start: s, end: e }));
const ws = Wp([['we', 1, 1.4], ['are', 1.5, 1.9], ['going', 2, 3.5]]);
assert.deepEqual(retimeWordsForText(ws, 'we were going').map(w => [w.text, w.start]), [['we', 1], ['were', 1.5], ['going', 2]]);
const four = retimeWordsForText(ws, 'here we go now');
assert.equal(four.length, 4); assert.equal(four[0].start, 1); assert.ok(Math.abs(four[3].end - 3.5) < 1e-9);
assert.equal(retimeWordsForText([], 'x'), null, 'no timing → leave words alone');
assert.deepEqual(retimeWordsForText(ws, '   '), []);
const sp = splitCaption(ws, 'we are going', 1);
assert.equal(sp.splitTime, 1.5); assert.equal(sp.left.content, 'we'); assert.equal(sp.right.content, 'are going');
assert.equal(splitCaption(ws, 'totally different text here', 2).left.content, 'we are', 'content out of step → word texts');
assert.equal(splitCaption(ws, 'x', 0), null); assert.equal(splitCaption(ws, 'x', 3), null);
assert.equal(splitIndexAtTime(ws, 1.95), 2); assert.equal(splitIndexAtTime(ws, 0), 1); assert.equal(splitIndexAtTime([ws[0]], 1), -1);
assert.deepEqual(mergeCaptions({ content: 'we', words: [ws[0]] }, { content: 'are going', words: ws.slice(1) }).content, 'we are going');
assert.equal(shiftWords(ws, 0.5)[0].start, 1.5);
console.log('✓ pure caption helpers');
globalThis.localStorage = { _m:{}, getItem(k){return this._m[k]??null}, setItem(k,v){this._m[k]=String(v)}, removeItem(k){delete this._m[k]} };
globalThis.window = globalThis; globalThis.addEventListener = ()=>{}; globalThis.innerWidth = 390;
const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const tm = window.timelineManager; const st = () => useTimelineStore.getState();
const W = (arr) => arr.map(([t, s, e]) => ({ text: t, start: s, end: e }));
tm.fromLegacyTracks([
  { id: 'track-default-video', type: 'video', name: 'V', clips: [{ id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', start: 0, duration: 10, offset: 0, speed: 1 }] },
  { id: 'txt', type: 'text', name: 'Captions', clips: [
    { id: 'k1', clipId: 'ek1', type: 'text', start: 1, duration: 3, content: 'we are going', words: W([['we',1,1.4],['are',1.5,1.9],['going',2,3.5]]), fontFamily: 'Anton' },
    { id: 'k2', clipId: 'ek2', type: 'text', start: 4, duration: 2, content: 'to talk', words: W([['to',4,4.4],['talk',4.5,5.5]]) },
  ]},
]);
useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 10, past: [], future: [] });
const cap = (id) => st().tracks.find(t => t.type === 'text').clips.find(c => c.id === id);
const caps = () => st().tracks.find(t => t.type === 'text').clips.slice().sort((a,b)=>a.start-b.start);
const fmt = (c) => c.content + '[' + c.start.toFixed(2) + '+' + c.duration.toFixed(2) + '] ' + (c.words||[]).map(w => w.text + '@' + w.start.toFixed(2)).join(' ');

// style all + captionStyle actually stored (legacy updateClip drops it)
assert.ok(st().applyCaptionStyleToAll({ fontFamily: 'Oswald', captionStyle: { packId: 'motivational', uppercase: true, wordHighlight: { mode: 'color', color: '#FACC15', scale: 1.1 } }, animations: [] }));
assert.equal(cap('k1').fontFamily, 'Oswald'); assert.equal(cap('k2').captionStyle.packId, 'motivational');
st().undo(); assert.equal(cap('k1').fontFamily, 'Anton', 'one undo step'); st().redo?.();
if (cap('k1').fontFamily !== 'Oswald') st().applyCaptionStyleToAll({ fontFamily: 'Oswald', captionStyle: { packId: 'motivational' } });
console.log('✓ style all captions incl. captionStyle, one undo step');

assert.ok(st().setCaptionWordHighlight(false)); assert.equal(cap('k1').captionStyle.wordHighlight.mode, 'none');
assert.ok(st().setCaptionWordHighlight(true)); assert.equal(cap('k1').captionStyle.wordHighlight.mode, 'color');
console.log('✓ highlight off / on (pack default)');

// edit text: same count keeps timing, different count spreads
assert.ok(st().editCaptionText('k1', 'we were going'));
assert.equal(fmt(cap('k1')), 'we were going[1.00+3.00] we@1.00 were@1.50 going@2.00');
assert.ok(st().editCaptionText('k1', 'here we go now'));
assert.equal(cap('k1').words.length, 4); assert.equal(cap('k1').words[0].start, 1); assert.ok(Math.abs(cap('k1').words[3].end - 3.5) < 1e-9);
st().undo(); assert.equal(cap('k1').content, 'we were going');
console.log('✓ edit text keeps word timing in step with the text; undo');

// move the caption (wordShift) then edit: displayed timing stays right
const p = tm.getState().entities.placements;
tm.dispatch({ type: 'PLACEMENT_UPDATE', payload: { placementId: 'k1', updates: { startTime: 0.5 } } }); useTimelineStore.setState({ tracks: tm.toLegacyTracks() });
assert.equal(cap('k1').words[0].start, 0.5);
assert.ok(st().editCaptionText('k1', 'we were going'));
assert.equal(cap('k1').words[0].start, 0.5, 'wordShift respected on edit');
console.log('✓ edits respect a moved caption (wordShift)');

// split before word 1 ("were")
assert.ok(st().splitCaptionAt('k1', 1));
let c = caps();
assert.equal(c.length, 3, fmt(c[0]));
assert.equal(fmt(c[0]), 'we[0.50+0.50] we@0.50'); assert.equal(fmt(c[1]), 'were going[1.00+2.50] were@1.00 going@1.50');
assert.equal(c[1].fontFamily, 'Oswald', 'right half keeps the style');
assert.equal(c[1].captionStyle?.packId, 'motivational');
// merge them back
assert.ok(st().mergeCaptionWithNext(c[0].id));
c = caps(); assert.equal(c.length, 2); assert.equal(fmt(c[0]), 'we were going[0.50+3.00] we@0.50 were@1.00 going@1.50');
st().undo(); assert.equal(caps().length, 3); st().undo(); assert.equal(caps().length, 2);
console.log('✓ split / merge, styles carried over, each one undo step');
assert.equal(st().splitCaptionAt('k2', 0), false); assert.equal(st().splitCaptionAt('nope', 1), false);
assert.equal(st().mergeCaptionWithNext('k2'), false, 'last caption has no next');
// desktop Roka style card path: legacy updateClip must keep captionStyle
st().updateClip('txt', 'k2', { fontFamily: 'Anton', captionStyle: { packId: 'bold-impact', uppercase: true } });
assert.equal(cap('k2').captionStyle.packId, 'bold-impact');
console.log('✓ updateClip keeps captionStyle (desktop style card)');
console.log('\nCAPTION STORE CHECKS PASSED');
