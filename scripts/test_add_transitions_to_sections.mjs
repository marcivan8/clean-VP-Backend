// R130 — "Unknown tool: add_transitions_to_sections" (reported by the user
// with a screenshot: a 2-step reel edit failed outright on this error).
// add_transitions_to_sections had been compiled (CommandCompiler.js) and
// dispatched (MediaExecutionEngine.js's shared VideoEditorTools case) for
// BOTH long-form edit modes (LongFormEditPlanner._youtubeOptimizedSteps/
// _fullBuildSteps) since the action was first added, but VideoEditorTools'
// execute() switch never had a case for it at all — every single call threw
// "Unknown tool: add_transitions_to_sections" and failed the whole
// long-form edit on this one step, regardless of how short or simple the
// edit was. This pins the new addTransitionsToSections() implementation.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { VideoEditorTools } = await import('../client/src/agent/VideoEditorTools.js');

console.log = realLog;
const ok = (name) => realLog(`✓ ${name}`);

const tm = window.timelineManager;

function setupThreeClips() {
    tm.fromLegacyTracks([{
        id: 'track-video', type: 'video', name: 'V', clips: [
            { id: 'v1', clipId: 'e1', assetId: 'a', type: 'video', name: 'A', start: 0, duration: 4, offset: 0, speed: 1 },
            { id: 'v2', clipId: 'e2', assetId: 'a', type: 'video', name: 'B', start: 4, duration: 4, offset: 4, speed: 1 },
            { id: 'v3', clipId: 'e3', assetId: 'a', type: 'video', name: 'C', start: 8, duration: 4, offset: 8, speed: 1 },
        ],
    }]);
    useTimelineStore.setState({
        tracks: tm.toLegacyTracks(), duration: 12, currentTime: 0, activeClipId: null,
        aspectRatio: '9:16', assets: [{ id: 'a', type: 'video' }],
    });
}

// ── 1. The exact user-reported failure is gone: the tool is reachable. ─────
{
    setupThreeClips();
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'add_transitions_to_sections', args: { type: 'dissolve', duration: 0.3, apply_at: 'all_cuts' } });
    assert.notEqual(r?.message, undefined);
    assert.ok(!/Unknown tool/i.test(r?.message || ''), `must not be the "Unknown tool" failure anymore: ${r?.message}`);
    assert.equal(r.success, true, JSON.stringify(r));
    ok('add_transitions_to_sections no longer throws/returns "Unknown tool" — the exact user-reported failure');
}

// ── 2. apply_at: 'all_cuts' — every clip after the first gets the transition, one undo step. ─
{
    setupThreeClips();
    const tools = new VideoEditorTools();
    const before = useTimelineStore.getState().historyIndex ?? useTimelineStore.getState().history?.length;
    const r = await tools.execute({ name: 'add_transitions_to_sections', args: { type: 'dissolve', duration: 0.3, apply_at: 'all_cuts' } });
    assert.equal(r.success, true);
    assert.equal(r.count, 2, 'two cuts (v2, v3) on a 3-clip timeline');
    const videoTrack = useTimelineStore.getState().tracks.find(t => t.type === 'video');
    const byId = Object.fromEntries(videoTrack.clips.map(c => [c.id, c]));
    assert.equal(byId.v1.transition, undefined, 'the FIRST clip never gets an incoming transition — there is no cut before it');
    assert.deepEqual(byId.v2.transition, { type: 'dissolve', duration: 0.3 });
    assert.deepEqual(byId.v3.transition, { type: 'dissolve', duration: 0.3 });
    ok("apply_at: 'all_cuts' adds a transition to every clip after the first, never the first clip itself");
}

// ── 3. apply_at: 'section_boundaries' with NO chapter markers fails loudly, never a silent no-op. ─
{
    setupThreeClips();
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'add_transitions_to_sections', args: { type: 'fade', duration: 0.5, apply_at: 'section_boundaries' } });
    assert.equal(r.success, false, 'no chapter markers on the timeline — must fail, not silently report success with nothing changed');
    assert.ok(/chapter|section/i.test(r.message || ''), r.message);
    ok("apply_at: 'section_boundaries' with no chapter markers on the timeline reports failure, not a silent success (test_no_silent_noop.js's own contract)");
}

// ── 4. apply_at: 'section_boundaries' WITH a chapter marker only transitions the matching cut. ─
{
    setupThreeClips();
    // A chapter marker clip (R77 shape: isChapter: true) landing exactly on v3's start (8s).
    tm.fromLegacyTracks([
        { id: 'track-video', type: 'video', name: 'V', clips: [
            { id: 'v1', clipId: 'e1', assetId: 'a', type: 'video', name: 'A', start: 0, duration: 4, offset: 0, speed: 1 },
            { id: 'v2', clipId: 'e2', assetId: 'a', type: 'video', name: 'B', start: 4, duration: 4, offset: 4, speed: 1 },
            { id: 'v3', clipId: 'e3', assetId: 'a', type: 'video', name: 'C', start: 8, duration: 4, offset: 8, speed: 1 },
        ] },
        { id: 'track-markers', type: 'text', name: 'Chapter Titles', clips: [
            { id: 'm1', clipId: 'em1', type: 'marker', isChapter: true, start: 8, duration: 0.1, name: 'Chapter 2' },
        ] },
    ]);
    useTimelineStore.setState({
        tracks: tm.toLegacyTracks(), duration: 12, currentTime: 0, activeClipId: null,
        aspectRatio: '9:16', assets: [{ id: 'a', type: 'video' }],
    });
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'add_transitions_to_sections', args: { type: 'fade', duration: 0.5, apply_at: 'section_boundaries' } });
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(r.count, 1, 'only the cut at the chapter boundary (v3) gets a transition');
    const videoTrack = useTimelineStore.getState().tracks.find(t => t.type === 'video');
    const byId = Object.fromEntries(videoTrack.clips.map(c => [c.id, c]));
    assert.equal(byId.v2.transition, undefined, 'v2 is not at a chapter boundary — must not get a transition');
    assert.deepEqual(byId.v3.transition, { type: 'fade', duration: 0.5 });
    ok("apply_at: 'section_boundaries' only transitions the cut that actually lands on a chapter marker");
}

// ── 5. A single-clip timeline fails loudly rather than reporting a no-op success. ─
{
    tm.fromLegacyTracks([{ id: 'track-video', type: 'video', name: 'V', clips: [
        { id: 'v1', clipId: 'e1', assetId: 'a', type: 'video', name: 'A', start: 0, duration: 4, offset: 0, speed: 1 },
    ] }]);
    useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 4, currentTime: 0, activeClipId: null, aspectRatio: '9:16', assets: [{ id: 'a', type: 'video' }] });
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'add_transitions_to_sections', args: {} });
    assert.equal(r.success, false);
    ok('a single-clip timeline (nothing to transition between) reports failure, not a silent success');
}

// ── 6. Defaults: no args at all still works (type/duration/apply_at all default sensibly). ─
{
    setupThreeClips();
    const tools = new VideoEditorTools();
    const r = await tools.execute({ name: 'add_transitions_to_sections', args: {} });
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(r.type, 'fade');
    assert.equal(r.duration, 0.5);
    ok('missing args fall back to sensible defaults (fade, 0.5s, all_cuts) instead of throwing');
}

realLog('\nALL ADD TRANSITIONS TO SECTIONS TESTS PASSED');
