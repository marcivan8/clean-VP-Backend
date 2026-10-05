// R88 — keyword emphasis executes end to end through the real store:
// VideoEditorTools.emphasizeKeywords → utils/captionEmphasis → applyCaptionUpdate.
// node scripts/test_keyword_emphasis_exec.mjs
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
let llmCalls = 0;
let llmAnswer = null; // null → service down (503)
globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/captions/keywords')) {
        llmCalls++;
        if (!llmAnswer) return { ok: false, status: 503, json: async () => ({ fallback: true }) };
        const body = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ picks: llmAnswer(body.phrases) }) };
    }
    return { ok: false, status: 503, json: async () => ({}), text: async () => '' };
};
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {};

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { VideoEditorTools } = await import('../client/src/agent/VideoEditorTools.js');
const { toggleEmphasisWord } = await import('../client/src/utils/captionEmphasis.js');

const tm = window.timelineManager;
const setup = () => {
    tm.fromLegacyTracks([
        { id: 'track-default-video', type: 'video', name: 'V', clips: [{ id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', name: 'A.MOV', start: 0, duration: 10, offset: 0, speed: 1 }] },
        { id: 'text-1', type: 'text', name: 'Captions', clips: [
            { id: 'c1', type: 'text', content: 'Day 14 of 30', start: 0, duration: 2 },
            { id: 'c2', type: 'text', content: 'I want to show you this', start: 2, duration: 2 },
            { id: 'c3', type: 'text', content: 'so yeah', start: 4, duration: 2 },
        ] },
    ]);
    useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 10, captionEditScope: 'global' });
};
const clip = (id) => useTimelineStore.getState().tracks.find(t => t.type === 'text').clips.find(c => c.id === id);
const ok = (name) => log(`✓ ${name}`);

setup();
const tools = new VideoEditorTools();
let r = await tools.execute({ name: 'emphasize_keywords', args: {} });
assert.equal(r.success, true, JSON.stringify(r));
assert.deepEqual(clip('c1').emphasis?.indices, [1]);
ok('rules pick "14" in "Day 14 of 30"');
assert.equal(clip('c3').emphasis ?? null, null);
ok('a filler-only caption gets no keyword');
assert.equal(llmCalls, 1);
assert.deepEqual(clip('c2').emphasis?.indices, [3]);
ok('the unsure caption asked the LLM once, and kept the rule pick when the service was down');
assert.equal(clip('c1').emphasis.source, 'assistant');
ok('assistant picks are marked as such');

// global scope must NOT fan emphasis indices out to other captions
toggleEmphasisWord('c1', 3);
assert.deepEqual(clip('c1').emphasis.indices, [1, 3]);
assert.deepEqual(clip('c2').emphasis.indices, [3]);
assert.equal(clip('c1').emphasis.source, 'user');
ok('a hand toggle stays on its own caption even in Global scope, marked "user"');

llmAnswer = (phrases) => phrases.map(p => ({ id: p.id, index: 2 }));
r = await tools.execute({ name: 'emphasize_keywords', args: {} });
assert.deepEqual(clip('c1').emphasis.indices, [1, 3]);
ok('a second auto pass leaves hand-picked captions alone');
assert.deepEqual(clip('c2').emphasis.indices, [2]);
ok('...and uses the LLM answer when the service responds');

r = await tools.execute({ name: 'emphasize_keywords', args: {} });
assert.equal(r.success, false);
ok('nothing to change → success:false with a reason (R30)');

r = await tools.execute({ name: 'clear_keywords', args: {} });
assert.equal(r.success, true);
assert.equal(clip('c1').emphasis ?? null, null);
r = await tools.execute({ name: 'clear_keywords', args: {} });
assert.equal(r.success, false);
ok('clear removes every highlight, and a second clear reports nothing to do');

// Persistence: emphasis and rotation survive a save/reload round trip
// (toLegacyTracks → fromLegacyTracks is the project save format).
toggleEmphasisWord('c2', 1);
useTimelineStore.getState().applyCaptionUpdate({ rotation: -8 }, { clipId: 'c2', scope: 'individual' });
const saved = JSON.parse(JSON.stringify(tm.toLegacyTracks()));
tm.fromLegacyTracks(saved);
useTimelineStore.setState({ tracks: tm.toLegacyTracks() });
assert.deepEqual(clip('c2').emphasis?.indices, [1]);
assert.equal(clip('c2').rotation, -8);
ok('emphasis and rotation survive a project save/reload');
log('\nALL KEYWORD EMPHASIS EXECUTION CHECKS PASSED');
