// Mobile manual edits (phase 6). node scripts/test_manual_edits.mjs
import assert from 'assert/strict';
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.innerWidth = 390;
const { computeCaptionFollow } = await import('../client/src/timeline/captionFollow.js');

// pure: captions follow the main-track clip their start was over
const prev = [
  { id: 'v', type: 'video', clips: [{ id: 'A', start: 0, duration: 4 }, { id: 'B', start: 4, duration: 3 }] },
  { id: 't', type: 'text', clips: [{ id: 'k1', start: 1, duration: 2 }, { id: 'k2', start: 4.5, duration: 2 }, { id: 'k3', start: 9, duration: 1 }] },
];
const next = [{ id: 'v', type: 'video', clips: [{ id: 'B', start: 0, duration: 3 }, { id: 'A', start: 3, duration: 4 }] }, prev[1]];
assert.deepEqual(computeCaptionFollow(prev, next), [{ clipId: 'k1', start: 4 }, { clipId: 'k2', start: 0.5 }]);
assert.deepEqual(computeCaptionFollow(prev, prev), []);
console.log('✓ captions follow swapped clips; captions over nothing stay');

const { default: S } = await import('../client/src/store/useTimelineStore.js');
const tm = window.timelineManager;
const W = (arr) => arr.map(([t, s, e]) => ({ text: t, start: s, end: e }));
const load = () => {
  tm.fromLegacyTracks([
    { id: 'track-default-video', type: 'video', name: 'V', clips: [
      { id: 'A', clipId: 'eA', assetId: 'a', type: 'video', start: 0, duration: 4, offset: 0, speed: 1 },
      { id: 'B', clipId: 'eB', assetId: 'a', type: 'video', start: 4, duration: 3, offset: 10, speed: 1 } ] },
    { id: 'txt', type: 'text', name: 'C', clips: [
      { id: 'k1', clipId: 'ek1', type: 'text', start: 1, duration: 2, content: 'hello there', words: W([['hello', 1, 1.5], ['there', 1.6, 2.5]]) },
      { id: 'k2', clipId: 'ek2', type: 'text', start: 4.5, duration: 2, content: 'bye now', words: W([['bye', 4.5, 5], ['now', 5.1, 6]]) } ] },
  ]);
  S.setState({ tracks: tm.toLegacyTracks(), duration: 7, past: [], future: [] });
};
const clip = (id) => S.getState().tracks.flatMap(t => t.clips).find(c => c.id === id);

// mobile trim gesture: snapshot first, live skipHistory update, gap closes, ONE undo restores everything
load();
const st = S.getState();
st.beginEditGesture();
st.updateClip('track-default-video', 'A', { duration: 3 }, { skipHistory: true });          // live drag frame
st.updateClip('track-default-video', 'A', { duration: 3 }, { skipHistory: true });          // release commit
S.getState().rippleDeleteGap('track-default-video', 3.001, { skipHistory: true });
S.getState().endEditGesture(true);
assert.equal(clip('A').duration, 3); assert.equal(clip('B').start, 3, 'gap closed');
assert.equal(clip('k2').start, 3.5, 'caption after the gap moved with B'); assert.equal(clip('k2').words[0].start, 3.5);
assert.equal(S.getState().past.length, 1);
S.getState().undo();
assert.equal(clip('A').duration, 4, 'undo restores the trim'); assert.equal(clip('B').start, 4); assert.equal(clip('k2').start, 4.5);
// a gesture that changed nothing leaves no undo step
S.getState().beginEditGesture(); S.getState().endEditGesture(false);
assert.equal(S.getState().past.length, 0);
console.log('✓ trim: one undo step restores trim + gap + captions; no-op gesture leaves none');

// long-press reorder: B moves before A, its caption goes with it
load();
const before = S.getState().tracks;
const moved = S.getState().moveSelectedClips(-4, ['B']);
assert.ok(moved.ok, JSON.stringify(moved));
assert.equal(clip('B').start, 0); assert.equal(clip('A').start, 3);
assert.equal(S.getState().followMainTrackMove(before), 2);
assert.equal(clip('k2').start, 0.5, 'B caption moved'); assert.equal(clip('k2').words[0].start, 0.5);
assert.equal(clip('k1').start, 4, 'A caption moved'); assert.equal(clip('k1').words[0].start, 4);
const pastLen = S.getState().past.length;
S.getState().undo();
assert.equal(clip('B').start, 4); assert.equal(clip('k2').start, 4.5, 'one undo restores clips and captions');
assert.equal(S.getState().past.length, pastLen - 1);
console.log('✓ reorder: captions travel with their clip, same undo step');
// desktop trim path (no ripple): one undo step brings the clip back; a click
// on a handle with no drag keeps the redo stack
load();
S.getState().updateClip('track-default-video', 'B', { duration: 2 });   // something to undo/redo
S.getState().undo();
const futureLen = S.getState().future.length;
assert.ok(futureLen > 0);
S.getState().beginEditGesture(); S.getState().endEditGesture(false);
assert.equal(S.getState().future.length, futureLen, 'no-op gesture keeps redo');
S.getState().beginEditGesture();
S.getState().updateClip('track-default-video', 'A', { duration: 3 }, { skipHistory: true });
S.getState().endEditGesture(true);
assert.equal(clip('A').duration, 3);
S.getState().undo();
assert.equal(clip('A').duration, 4, 'desktop trim undo works');
console.log('✓ desktop trim: undo restores, redo kept on a no-op click');

// motion presets survive updateClip (desktop Motion panel / animate automatically)
S.getState().updateClip('txt', 'k1', { animations: [{ id: 'pop-1', preset: 'pop' }] });
assert.equal(clip('k1').animations?.[0]?.id, 'pop-1');
S.getState().updateClip('txt', 'k1', { animations: [] });
assert.deepEqual(clip('k1').animations, []);
console.log('✓ updateClip keeps animations (and clearing them)');
// ── R150: ripple delete from the assistant ───────────────────────────────────
//
// The timeline store has rippleDeleteClip and rippleDeleteGap, but no
// `rippleDelete`. MediaExecutionEngine called exactly that, and _callStore
// throws on a method that does not exist, so ripple_delete was dead from the
// assistant: the compiler emitted it (CommandCompiler ripple_delete ->
// ENGINE.STORE 'rippleDelete'), and executing it threw "Store method
// \"rippleDelete\" does not exist." A second, unreachable stub in
// useEditorStore returned the state unchanged after taking a history snapshot.
{
    // MediaExecutionEngine imports '../store/useTimelineStore' without an
    // extension, which Vite resolves and plain Node does not. The loader hook
    // the other engine suites use handles it; registered here rather than at
    // the top of the file so the rest of this suite stays dependency free.
    const { register } = await import('module');
    register('./lib/clientLoaderHooks.mjs', import.meta.url);

    const { readFileSync } = await import('fs');
    const engineSrc = readFileSync(new URL('../client/src/agent/MediaExecutionEngine.js', import.meta.url), 'utf8');
    const editorSrc = readFileSync(new URL('../client/src/store/useEditorStore.js', import.meta.url), 'utf8');
    assert.ok(!/_callStore\(store, 'rippleDelete'/.test(engineSrc),
        'the engine must not call a store method that does not exist');
    assert.ok(!/rippleDelete: \(atTime\)/.test(editorSrc),
        'the unreachable useEditorStore stub must be gone');

    const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
    const engine = new MediaExecutionEngine();
    const job = { id: 'test-ripple', signal: { aborted: false }, results: [] };

    load();
    // Shrink A so there is a real gap between 3 and 4.
    S.getState().updateClip('track-default-video', 'A', { duration: 3 });
    assert.equal(clip('B').start, 4, 'the gap exists before the command runs');

    let r = await engine.executeCommand({ action: 'rippleDelete', args: { atTime: 3.5 } }, job);
    assert.equal(r.success, true, 'the assistant path must close the gap, not throw');
    assert.equal(clip('B').start, 3, 'B slid left by the gap length');
    // Captions follow, the same as the right-click path.
    assert.equal(clip('k2').start, 3.5, 'the caption after the gap moved with B');

    // There is no gap at 1s, it is inside a clip. The old code would have
    // reported success for doing nothing.
    r = await engine.executeCommand({ action: 'rippleDelete', args: { atTime: 1 } }, job);
    assert.equal(r.success, false, 'no gap must be reported as a failure');
    assert.match(r.message, /no gap/i);
    console.log('\u2713 ripple delete works from the assistant, and says so when there is no gap');
}

// ── R155: an edit that shortens the timeline must not strand the playhead ───
//
// VideoPlayer renders the clip whose range contains currentTime. After a cut
// the playhead used to stay where it was, so with nothing under it there was no
// active clip, no media URL, and the canvas went black while the controls still
// looked alive. Reported as "after an edit the preview gets dark and does not
// play the edited video".
{
    const contentEnd = (st) => (st.tracks || []).reduce((m, t) =>
        Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
    const clipUnderPlayhead = (st) => (st.tracks || [])
        .filter(t => t.type === 'video')
        .flatMap(t => t.clips || [])
        .find(c => st.currentTime >= c.start - 0.001 && st.currentTime < c.start + c.duration + 0.001) || null;

    // rippleDeleteClip, the path an "extract a short" style cut takes.
    load();
    S.setState({ currentTime: 6.5 });
    assert.ok(clipUnderPlayhead(S.getState()), 'the playhead starts over real footage');
    S.getState().rippleDeleteClip('track-default-video', 'B');
    let st = S.getState();
    assert.ok(st.currentTime <= contentEnd(st) + 0.001,
        `playhead ${st.currentTime} is past the end ${contentEnd(st)}: the preview would be black`);
    assert.ok(clipUnderPlayhead(st), 'there must still be a clip to draw');

    // cutTimelineRange, used by the phrase-level cuts auto mode makes.
    load();
    S.setState({ currentTime: 7.9 });
    S.getState().cutTimelineRange(2, 7);
    st = S.getState();
    assert.ok(st.currentTime <= contentEnd(st) + 0.001, 'cutting a range must not strand the playhead either');

    // Shortening directly, which is where every one of those paths ends up.
    load();
    S.setState({ currentTime: 6.9 });
    S.getState().setDuration(3);
    st = S.getState();
    assert.ok(st.currentTime <= 3 + 0.001, `setDuration left the playhead at ${st.currentTime}`);

    // Growing the timeline must leave the playhead alone: the user's position
    // is still over real footage and moving it would be the annoying kind of
    // helpful.
    load();
    S.setState({ currentTime: 2 });
    S.getState().setDuration(60);
    assert.equal(S.getState().currentTime, 2, 'a longer timeline must not move the playhead');

    console.log('\u2713 a shortening edit keeps the playhead over the footage');
}

// ── R155: play at the very end restarts instead of doing nothing ────────────
{
    load();
    const end = (S.getState().tracks || []).reduce((m, t) =>
        Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);

    S.setState({ currentTime: end, isPlaying: false });
    S.getState().togglePlay();
    assert.equal(S.getState().isPlaying, true);
    assert.equal(S.getState().currentTime, 0, 'play at the end restarts rather than stalling');

    // Mid-timeline play must not rewind.
    S.setState({ currentTime: 2, isPlaying: false });
    S.getState().togglePlay();
    assert.equal(S.getState().currentTime, 2, 'play in the middle keeps its place');

    // Pause never moves the playhead, wherever it is.
    S.setState({ currentTime: end, isPlaying: true });
    S.getState().togglePlay();
    assert.equal(S.getState().isPlaying, false);
    assert.equal(S.getState().currentTime, end, 'pausing at the end holds the last frame');

    console.log('\u2713 play restarts at the end, and pause never moves the playhead');
}

console.log('\nALL MANUAL-EDIT CHECKS PASSED');
