// R122 — _applySegmentsToTimeline's sanity guard must catch a detection
// result that no longer overlaps what's left on the timeline, BEFORE
// removing anything. This is what was reaching Marc as "when I run the same
// commands many times on the same video, it ends up hallucinating... in
// auto mode, the video ends up almost completely chopped off and it doesn't
// keep the right parts."
//
// Root cause: silence/filler/retake detection always runs against the WHOLE
// source file (by design — retakes must be "detected on the untouched
// recording", per EditPlanner.js). Auto mode's Reel playbook runs
// extract_short BEFORE "Clean up the video", so by the time silence/filler/
// retake removal runs, the clip on the timeline may already cover only a
// narrow slice of the source. The OLD sanity guard compared the raw
// (source-file-scale) segment list against totalOriginalDuration — which is
// actually the CURRENT TIMELINE SPAN of the clips being replaced, not the
// original source length — so on a short (<=30s) already-trimmed clip the
// guard was skipped entirely, and a zero-overlap detection result silently
// wiped the clip (clips were already removed from the store before the
// empty-pieces problem was ever discoverable).
//
// node scripts/test_apply_segments_sanity.mjs
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`✓ ${name}`); }
    catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}\n${err.stack}`); }
}

const { default: S } = await import('../client/src/store/useTimelineStore.js');
const { mediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const tm = window.timelineManager;

// A clip already trimmed down to a narrow slice of its source — exactly
// what extract_short leaves behind: 22s on the timeline, covering only
// source seconds 40-62 of what was originally a much longer recording.
function setupTrimmedClip() {
    tm.fromLegacyTracks([
        { id: 'track-default-video', type: 'video', name: 'V', clips: [
            { id: 'short', clipId: 'eshort', assetId: 'x', type: 'video', name: 'A.MOV', start: 0, duration: 22, offset: 40, speed: 1, sourceDuration: 180 },
        ] },
    ]);
    S.setState({ tracks: tm.toLegacyTracks(), duration: 22, past: [], future: [] });
}

await check('a detection result with ZERO overlap on the clip\'s remaining source window is rejected, not silently wiped', () => {
    setupTrimmedClip();
    // The server's "kept" segments cover plenty of the ORIGINAL 180s file
    // (passes any source-scale "is this at least 10% of something" check)
    // but none of it falls inside this clip's actual remaining window
    // (source 40-62s) — e.g. retake detection decided a different, earlier
    // occurrence of this line is the one to keep.
    mediaExecutionEngine._applySegmentsToTimeline(
        [{ start: 0, end: 150, duration: 150 }].flatMap(() => [
            { start: 0, end: 30, duration: 30 },
            { start: 70, end: 180, duration: 110 },
        ]),
        'take',
    );
    const clips = S.getState().tracks.find(t => t.type === 'video').clips;
    assert.equal(clips.length, 1, 'the clip must still be there — it should never have been removed');
    assert.equal(clips[0].id, 'short', 'the original clip, untouched');
});

await check('a detection result that keeps most of the clip\'s remaining window is still applied normally', () => {
    setupTrimmedClip();
    // This time the kept ranges cover source 40-60 of the clip's 40-62
    // window — a legitimate small trim, not a wipe.
    mediaExecutionEngine._applySegmentsToTimeline(
        [{ start: 0, end: 60, duration: 60 }, { start: 100, end: 180, duration: 80 }],
        'take',
    );
    const clips = S.getState().tracks.find(t => t.type === 'video').clips;
    assert.ok(clips.length >= 1, 'a legitimate partial trim must still go through');
    const total = clips.reduce((t, c) => t + c.duration, 0);
    assert.ok(total > 15 && total < 22, `expected a small trim (~20s), got ${total}s`);
});

await check('a detection result that keeps NOTHING at all (not just off-window) is also rejected', () => {
    setupTrimmedClip();
    mediaExecutionEngine._applySegmentsToTimeline(
        [{ start: 100, end: 110, duration: 10 }], // nowhere near source 40-62
        'silence',
    );
    const clips = S.getState().tracks.find(t => t.type === 'video').clips;
    assert.equal(clips.length, 1, 'the clip must still be there');
});

log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL APPLY-SEGMENTS SANITY CHECKS PASSED');
process.exit(failures ? 1 : 0);
