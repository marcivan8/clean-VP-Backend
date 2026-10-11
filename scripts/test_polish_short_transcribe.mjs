// scripts/test_polish_short_transcribe.mjs
//
// Marc's report: "I want to clean this video, add animatios and motions to
// make it pro grade looking and add nice captions and it should be dynamic.
// I'll post it on social medias" only ever ran auto_captions -- nothing
// else. Traced to the real cause: CommandRegistry.resolveCommand() picks a
// single winning command by longest phrase match, and "add nice captions"
// was the ONLY phrase in that whole run-on sentence (and its typo'd
// "animatios") that matched anything in the registry at all. The one
// command built to do captions + hook title + motion + camera + transitions
// together -- polish_short, "Pro short finish" -- had no phrase close to
// "pro grade looking", so it never got a chance to win.
//
// Two fixes, both pinned here:
//  1. polish_short's phrase list now covers "pro grade"/"professional"
//     wording, so this kind of request routes to the multi-layer finish
//     instead of degrading to a single unrelated command.
//  2. polish_short used to read the transcript (state.captions) as-is, so a
//     freshly uploaded, never-transcribed video got NONE of its
//     transcript-dependent layers -- hook title, captions, number pops --
//     silently. It now transcribes the main track first (reusing the exact
//     code the plain "add captions" command uses) when there's no
//     transcript yet, as one step of the SAME undo as the rest of the
//     finish, not a second one.
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

const R = await import('../client/src/agent/CommandRegistry.js');
const { default: S } = await import('../client/src/store/useTimelineStore.js');
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js').catch(async () => ({ MediaExecutionEngine: (await import('../client/src/agent/MediaExecutionEngine.js')).default }));

const MARC_PROMPT = "I want to clean this video, add animatios and motions to make it pro grade looking and add nice captions and it should be dynamic. I'll post it on social medias";

log('\n1 \xb7 Registry: the near-miss wording now reaches the multi-layer finish');
await check('"pro grade looking" and friends resolve to polish_short, not a single unrelated command', () => {
    for (const t of ['make it pro grade looking', 'pro grade', 'make it pro grade', 'professional looking', 'professional grade', 'looking pro']) {
        assert.equal(R.resolveCommand(t).match?.id, 'polish_short', t);
    }
});
await check("Marc's exact run-on sentence resolves to polish_short, not auto_captions", () => {
    const resolved = R.resolveCommand(MARC_PROMPT);
    assert.equal(resolved.match?.id, 'polish_short', `got "${resolved.match?.id}" -- the multi-layer finish should win over a single "add captions" match`);
});
await check('no new collisions were introduced', () => {
    const collisions = R.findCollisions();
    assert.deepEqual(collisions, [], JSON.stringify(collisions));
});

log('\n2 \xb7 A never-transcribed video gets transcribed first, then the full finish');
const tm = globalThis.timelineManager;
function loadTracks(list, extra = {}) {
    tm.fromLegacyTracks(JSON.parse(JSON.stringify(list)));
    S.setState({ tracks: tm.toLegacyTracks(), past: [], future: [], selectedClipIds: [], editingStyle: null, currentTime: 0, shorts: [],
        uploadedFile: { name: 'IMG.MOV' }, assets: [{ id: 'a', type: 'video', name: 'IMG.MOV', duration: 60, resolution: { w: 1080, h: 1920 }, proxyUrl: 'raw/u/IMG.MOV' }],
        captions: [], transcripts: {}, transcriptVerified: {}, ...extra });
}
const FRESH = [
    { id: 'track-default-video', type: 'video', name: 'V', clips: [{ id: 'v1', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 0, duration: 20, offset: 0, speed: 1 }] },
];
const W = (text, step = 0.4, t0 = 1) => text.split(' ').map((w, i) => ({ word: w, start: t0 + i * step, end: t0 + i * step + 0.3 }));
const TRANSCRIBED_WORDS = W('here is the video it should look professional and dynamic for social media');

function fakeJob() {
    const listeners = [];
    return {
        signal: {
            aborted: false,
            addEventListener: (ev, fn) => listeners.push(fn),
            removeEventListener: () => {},
        },
        timeoutHandle: null,
        cancel() {},
        setState() {},
        error: null,
    };
}

await check('polish_short with no transcript yet transcribes the main track, then builds the full finish, as one undo', async () => {
    loadTracks(FRESH);
    const realFetch = globalThis.fetch;
    let sawTranscribeCall = false;
    globalThis.fetch = async (url) => {
        if (String(url).includes('/api/captions/generate')) {
            sawTranscribeCall = true;
            return { ok: true, json: async () => ({ words: TRANSCRIBED_WORDS }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };
    try {
        const engine = typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
        const before = S.getState().past.length;
        const res = await engine.executeStoreAction({ action: 'polish_short', args: { brief: 'pro grade looking' } }, fakeJob());
        assert.equal(res.success, true, res.message || res.error);
        assert.ok(sawTranscribeCall, 'polish_short never transcribed the never-captioned main track');

        const state = S.getState();
        assert.ok(state.captions?.length > 0, 'the transcript should now be on the timeline');
        assert.equal(state.past.length - before, 1, `expected exactly one undo step for the whole finish, got ${state.past.length - before}`);

        // Clips placed through the store carry the id we gave them in
        // clipId (the TIMELINE id, in `id`, is generated fresh by
        // addPlacement) -- the same convention MediaExecutionEngine.isFinishLayer
        // and test_round_c.mjs check against.
        const allClips = state.tracks.flatMap(t => t.clips);
        const idOf = c => String(c.clipId || c.id || '');
        assert.ok(allClips.some(c => idOf(c).startsWith('short-hook')), 'no hook title was added -- transcript-dependent layers still silently skipped');
        const caption = allClips.find(c => Array.isArray(c.words) && c.words.length > 0 && !idOf(c).startsWith('short-hook'));
        assert.ok(caption, 'no caption clip was built from the freshly transcribed words');
        assert.ok(caption.fontFamily, 'the caption was never styled with the platform pack');
    } finally {
        globalThis.fetch = realFetch;
    }
});

await check('a re-run with the transcript now present does not transcribe again', async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (url) => {
        if (String(url).includes('/api/captions/generate')) calls += 1;
        if (String(url).includes('/api/motion/short-plan')) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: false, status: 404, json: async () => ({}) };
    };
    try {
        const engine = typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
        const res = await engine.executeStoreAction({ action: 'polish_short', args: { brief: 'pro grade looking for tiktok' } }, fakeJob());
        assert.equal(res.success, true, res.message || res.error);
        assert.equal(calls, 0, 'should reuse the transcript already on the timeline instead of re-transcribing');
    } finally {
        globalThis.fetch = realFetch;
    }
});

await check('with no job (programmatic/test call), polish_short never crashes -- it just skips auto-transcription', async () => {
    loadTracks(FRESH);
    const engine = typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
    const res = await engine.executeStoreAction({ action: 'polish_short', args: { brief: 'pro finish' } }, null);
    assert.equal(res.success, true, res.message || res.error);
    assert.equal(S.getState().captions.length, 0, 'no job means no transcription attempt -- same as before this change');
});

log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL POLISH-SHORT-TRANSCRIBE CHECKS PASSED');
process.exit(failures ? 1 : 0);
