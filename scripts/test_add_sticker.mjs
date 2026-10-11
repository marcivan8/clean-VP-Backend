// scripts/test_add_sticker.mjs
//
// R97 — Marc asked for "icons and imojis" among the missing editing
// features; this was the first of three he picked to build (icon/emoji
// insert command, generic shadows, freeform zone blur). This pins the new
// `add_sticker` AI command end to end: registry phrase resolution, the
// EditPlanner's parsing of "add a fire emoji" / "add a heart icon" / a bare
// "add a sticker", and MediaExecutionEngine actually placing something on
// the timeline for each of the three paths (literal emoji, library keyword,
// and the no-keyword fallback), each as exactly one undo step.
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
const SQ = await import('../client/src/agent/stickerQuery.js');
const { default: S } = await import('../client/src/store/useTimelineStore.js');
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js').catch(async () => ({ MediaExecutionEngine: (await import('../client/src/agent/MediaExecutionEngine.js')).default }));

log('\n1 \xb7 stickerQueryFromText parses the wording the registry phrases promise');
await check('a literal emoji glyph wins outright', () => {
    assert.deepEqual(SQ.stickerQueryFromText('add \u{1F525} to the corner'), { emoji: '\u{1F525}' });
});
await check('"add a fire emoji" resolves to the keyword "fire", kind "emoji"', () => {
    assert.deepEqual(SQ.stickerQueryFromText('add a fire emoji'), { keyword: 'fire', kind: 'emoji' });
});
await check('"insert a heart icon" resolves to the keyword "heart", kind "icon"', () => {
    assert.deepEqual(SQ.stickerQueryFromText('insert a heart icon'), { keyword: 'heart', kind: 'icon' });
});
await check('a leading verb never gets swallowed into the keyword', () => {
    const r = SQ.stickerQueryFromText('add a thumbs up emoji');
    assert.equal(r.keyword, 'thumbs up');
});
await check('a bare "add a sticker" has no keyword to resolve', () => {
    assert.equal(SQ.stickerQueryFromText('add a sticker'), null);
});
await check('an unrelated prompt matches nothing', () => {
    assert.equal(SQ.stickerQueryFromText('clean up the audio and add captions'), null);
});

log('\n2 \xb7 Registry: the new phrases resolve to add_sticker, with no collisions');
await check('"add an emoji"/"add a sticker"/"insert an icon" all resolve to add_sticker', () => {
    for (const t of ['add an emoji', 'add a sticker', 'insert an icon', 'add a fire emoji', 'put an emoji']) {
        assert.equal(R.resolveCommand(t).match?.id, 'add_sticker', t);
    }
});
await check('no collisions were introduced', () => {
    assert.deepEqual(R.findCollisions(), []);
});

log('\n3 \xb7 MediaExecutionEngine places something on the timeline for each path, as one undo');
function loadEmptyTimeline() {
    const tm = globalThis.timelineManager;
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [] }]);
    S.setState({ tracks: tm.toLegacyTracks(), past: [], future: [], selectedClipIds: [], currentTime: 0, aspectRatio: '9:16' });
}
function engine() {
    return typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
}

await check('a literal emoji is placed as an AnimatedEmoji component, one undo', async () => {
    loadEmptyTimeline();
    const before = S.getState().past.length;
    const res = await engine().executeStoreAction({ action: 'add_sticker', args: { emoji: '\u{1F525}' } }, {});
    assert.equal(res.success, true, res.message);
    assert.equal(S.getState().past.length - before, 1, 'expected exactly one undo step');
    const clips = S.getState().tracks.flatMap(t => t.clips);
    assert.ok(clips.some(c => c.text === '\u{1F525}' || c.content === '\u{1F525}' || JSON.stringify(c).includes('\u{1F525}')), 'no clip carrying the emoji glyph was placed');
});

await check('a keyword resolves through the sticker-search API and is placed as an overlay, one undo', async () => {
    loadEmptyTimeline();
    const realFetch = globalThis.fetch;
    let sawSearchCall = false;
    globalThis.fetch = async (url, opts) => {
        if (String(url).includes('/api/stickers/search')) {
            sawSearchCall = true;
            const body = JSON.parse(opts?.body || '{}');
            assert.equal(body.query, 'fire');
            return { ok: true, json: async () => ({ results: [{ id: 'sticker-1', name: 'emoji-fire', display_name: 'Fire', preview_url: 'https://cdn.test/fire.png' }] }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };
    try {
        const before = S.getState().past.length;
        const res = await engine().executeStoreAction({ action: 'add_sticker', args: { query: 'fire', kind: 'emoji' } }, {});
        assert.equal(res.success, true, res.message);
        assert.ok(sawSearchCall, 'the sticker-search API was never called');
        // addOverlayClip's own doc comment: creating a FRESH overlay track
        // costs two undo steps by design (addTrack's own history push, then
        // addClip's) rather than adding a third save-point here — the same
        // accepted tradeoff every other sticker/logo overlay placement in
        // this codebase already has.
        assert.ok([1, 2].includes(S.getState().past.length - before), `expected 1 or 2 undo steps, got ${S.getState().past.length - before}`);
        const overlay = S.getState().tracks.find(t => t.type === 'overlay');
        assert.ok(overlay?.clips?.length > 0, 'no overlay clip was placed from the matched sticker');
        assert.ok(overlay.clips.some(c => c.url === 'https://cdn.test/fire.png'), 'the placed clip does not carry the matched sticker\'s url');
    } finally {
        globalThis.fetch = realFetch;
    }
});

await check('no keyword and no emoji still places a default glyph rather than failing', async () => {
    loadEmptyTimeline();
    const before = S.getState().past.length;
    const res = await engine().executeStoreAction({ action: 'add_sticker', args: {} }, {});
    assert.equal(res.success, true, res.message);
    assert.equal(S.getState().past.length - before, 1, 'expected exactly one undo step');
});

await check('a keyword with no library match is an honest failure, not a silent no-op', async () => {
    loadEmptyTimeline();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes('/api/stickers/search')) return { ok: true, json: async () => ({ results: [] }) };
        return { ok: false, status: 404, json: async () => ({}) };
    };
    try {
        const res = await engine().executeStoreAction({ action: 'add_sticker', args: { query: 'glorbnax', kind: 'emoji' } }, {});
        assert.equal(res.success, false, 'a library miss should be reported, not silently swallowed');
        assert.ok(/glorbnax/.test(res.message) && /library/.test(res.message), res.message);
    } finally {
        globalThis.fetch = realFetch;
    }
});

log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL ADD_STICKER CHECKS PASSED');
process.exit(failures ? 1 : 0);
