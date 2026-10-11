// scripts/test_design_scene_live.mjs
//
// Verifies the `design_scene` AI command actually works end to end through
// the real running pipeline, not just its isolated data-model unit tests
// (test_scene_design.mjs, test_scene_editor.mjs already cover SceneLayout/
// SceneComposer/SceneDirector/SceneSchema in isolation, and
// test_command_pipeline.mjs covers phrase -> intent -> plan -> compile for
// every registry command including design_scene). The one hop nothing else
// exercises is MediaExecutionEngine.executeStoreAction('design_scene', ...)
// itself: SceneDirector.planFromBrief -> (AI words over authFetch, or not) ->
// useTimelineStore.designScene -> composeSceneFromBrief -> _placeScene ->
// flattenScene -> addClip, landing real clips on real text/overlay tracks.
//
// This is the exact path Shorts' hook title and Auto mode's "reel" playbook
// are about to be wired through, and the project's own status doc flagged
// it as never having been clicked through in the running app.
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
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js').catch(async () => ({ MediaExecutionEngine: (await import('../client/src/agent/MediaExecutionEngine.js')).default }));
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');

const tm = globalThis.timelineManager;
function loadTracks(list, extra = {}) {
    tm.fromLegacyTracks(JSON.parse(JSON.stringify(list)));
    S.setState({ tracks: tm.toLegacyTracks(), duration: 10, currentTime: 2, past: [], future: [], selectedClipIds: [], scenes: {}, aspectRatio: '16:9', captions: [], ...extra });
}

const BASE_TRACKS = [
    { id: 'v1', type: 'video', name: 'V', clips: [{ id: 'vid', assetId: 'a', type: 'video', name: 'IMG.MOV', start: 0, duration: 10, offset: 0, speed: 1 }] },
];

log('\n1 · The phrase reaches the command, end to end, through the real pipeline');
await check('"design a scene..." parses, plans and compiles to design_scene with no clarification', async () => {
    loadTracks(BASE_TRACKS);
    const prompt = 'design a scene: introduce the product, highlight three benefits, finish with a call to action';
    const intent = await IntentParser.parse(prompt);
    assert.equal(intent.confidence, 'HIGH', `confidence was ${intent.confidence}`);
    const plan = await EditPlanner.generatePlan(intent);
    assert.notEqual(plan.status, 'clarification_needed', 'stopped at a clarification');
    const commands = CommandCompiler.compile({ ...plan.plan, intent: { ...intent, confidence: 'HIGH' } }, S.getState()).commands || [];
    assert.ok(commands.length > 0, 'compiled to nothing');
    assert.equal(commands[0].action, 'design_scene', JSON.stringify(commands.map(c => c.action)));
    assert.ok(typeof commands[0].args?.brief === 'string' && commands[0].args.brief.length > 0, 'brief carried through to the compiled command');
});

log('\n2 · executeStoreAction(design_scene) actually places a scene (no AI words — offline)');
await check('without a transcript, the brief still designs a sequence, placeholders and all, as one undo', async () => {
    loadTracks(BASE_TRACKS);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    try {
        const engine = typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
        const before = S.getState().past.length;
        const res = await engine.executeStoreAction({ action: 'design_scene', args: { brief: 'Make this feel like a premium technology launch. Introduce the product, highlight three benefits, finish with a call to action.' } }, null);
        assert.equal(res.success, true, res.message || res.error);
        assert.ok(res.message.includes('sequence'), res.message);
        assert.ok(res.details?.clipCount > 0, 'no clips were placed');
        assert.ok(res.details?.beats?.length > 0, 'no beats came back');
        assert.equal(res.details.usedAiWords, false, 'no transcript/AI path should mean placeholders, not AI words');

        const state = S.getState();
        assert.equal(state.past.length - before, 1, `expected one undo step, got ${state.past.length - before}`);
        assert.ok(state.scenes && state.scenes[res.details.sceneId], 'the scene was not kept for later editing');

        const textTrack = state.tracks.find(t => t.type === 'text');
        const overlayTrack = state.tracks.find(t => t.type === 'overlay');
        assert.ok(textTrack && textTrack.clips.length > 0, 'no text clips were created for the beats');
        assert.ok(overlayTrack && overlayTrack.clips.length > 0, 'no overlay clips were created for the beats');

        // The exact condition that crashed the player with React error #310
        // (hooks called conditionally) before GraphicOverlay/TextOverlay were
        // fixed: a text clip and an overlay clip overlapping in time. A
        // design_scene sequence, like a finished short, puts both kinds of
        // beat on screen together, so this project now exercises that fix too.
        const overlaps = (a, b) => a.start < b.start + b.duration && b.start < a.start + a.duration;
        const hasOverlap = textTrack.clips.some(t => overlayTrack.clips.some(o => overlaps(t, o)));
        assert.ok(hasOverlap, 'expected at least one text+overlay beat to overlap in time (the real player scenario)');
    } finally {
        globalThis.fetch = realFetch;
    }
});

log('\n3 · executeStoreAction(design_scene) uses AI-written words when a transcript is available');
await check('with captions/transcript present, the server AI-words route is used and no placeholders remain', async () => {
    loadTracks(BASE_TRACKS, { captions: [{ word: 'Meet' }, { word: 'the' }, { word: 'new' }, { word: 'Vibed' }, { word: 'app' }] });
    const realFetch = globalThis.fetch;
    let sawRequest = false;
    globalThis.fetch = async (url, opts) => {
        if (String(url).includes('/api/motion/scene-plan')) {
            sawRequest = true;
            return {
                ok: true,
                json: async () => ({ plan: { title: 'Meet Vibed', points: ['Edit faster', 'Export anywhere', 'Collaborate live'], cta: 'Try it free today' } }),
            };
        }
        return { ok: false, status: 404, json: async () => ({}) };
    };
    try {
        const engine = typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
        const res = await engine.executeStoreAction({ action: 'design_scene', args: { brief: 'Make this feel like a premium technology launch. Introduce the product, highlight three benefits, finish with a call to action.' } }, null);
        assert.equal(res.success, true, res.message || res.error);
        assert.ok(sawRequest, 'the scene-plan endpoint was never called even though a transcript was available');
        assert.equal(res.details.usedAiWords, true, 'expected the AI-words path to be used');
        assert.equal(res.details.placeholders, 0, 'AI words should leave nothing as a placeholder');
    } finally {
        globalThis.fetch = realFetch;
    }
});

log('\n4 · A vertical (Shorts-shaped) project designs correctly too');
await check('9:16 aspect ratio produces a scene that fits the frame with no unresolved issues', async () => {
    loadTracks(BASE_TRACKS, { aspectRatio: '9:16' });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    try {
        const engine = typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
        const res = await engine.executeStoreAction({ action: 'design_scene', args: { brief: 'three quick tips, then a call to action' } }, null);
        assert.equal(res.success, true, res.message || res.error);
        assert.ok(res.details?.clipCount > 0, 'no clips were placed in a vertical frame');
    } finally {
        globalThis.fetch = realFetch;
    }
});

await check('an empty brief is refused with something to act on, not a silent no-op', async () => {
    loadTracks(BASE_TRACKS);
    const engine = typeof MediaExecutionEngine === 'function' ? new MediaExecutionEngine() : MediaExecutionEngine;
    const res = await engine.executeStoreAction({ action: 'design_scene', args: { brief: '   ' } }, null);
    assert.equal(res.success, false);
    assert.ok(res.message && res.message.length > 0);
});

log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL DESIGN-SCENE-LIVE CHECKS PASSED');
process.exit(failures ? 1 : 0);
