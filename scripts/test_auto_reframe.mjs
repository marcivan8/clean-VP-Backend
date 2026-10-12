// R100 — intelligent reframe now runs AUTOMATICALLY on every aspect-ratio
// switch, from any entry point, not just when an AI command explicitly asked
// for face-aware reframing. Covers: the store action itself (used by the
// settings panel, timeline dropdown, mobile sheet), the AI-command path
// through MediaExecutionEngine, and switching back to a wide frame correctly
// dropping the crop again.
// node scripts/test_auto_reframe.mjs
import { register, createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

const require = createRequire(import.meta.url);
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {};
const ok = (n) => log(`✓ ${n}`);

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');

const tm = window.timelineManager;
const bbox = [
    { t: 0, cx: 0.5, cy: 0.5, w: 0.3, h: 0.5 },
    { t: 9, cx: 0.5, cy: 0.5, w: 0.3, h: 0.5 },
];

function setup() {
    tm.fromLegacyTracks([
        { id: 'track-default-video', type: 'video', name: 'V', clips: [
            { id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', name: 'TALK.MOV', start: 0, duration: 9, offset: 0, speed: 1,
              virtualCam: null,
              layerMask: { maskAssetUrl: 'm', bboxTrack: bbox, sourceWidth: 1920, sourceHeight: 1080, status: 'ready' } } ] },
    ]);
    useTimelineStore.setState({
        tracks: tm.toLegacyTracks(), duration: 9, aspectRatio: '16:9', currentTime: 0, activeClipId: null,
        assets: [{ id: 'a', type: 'video', resolution: { w: 1920, h: 1080 } }],
        past: [], future: [],
    });
}
const st = () => useTimelineStore.getState();
const clip = () => st().tracks.find(t => t.type === 'video').clips[0];

// ── 1 · store action: switching to vertical crops automatically ──────────
setup();
assert.equal(clip().virtualCam, null, 'sanity: no crop before the switch');
st().setAspectRatio('9:16');
assert.equal(st().aspectRatio, '9:16');
let vc = clip().virtualCam;
assert.ok(vc && vc.reframe === '9:16', `expected an automatic crop, got ${JSON.stringify(vc)}`);
assert.equal(vc.faceAware, true, 'bboxTrack was present, so the crop should be face-aware');
ok('setAspectRatio("9:16") alone — no explicit reframe request — crops the clip automatically');

// ── 2 · switching back to a wide frame drops the crop again ───────────────
st().setAspectRatio('16:9');
assert.equal(clip().virtualCam, null, `expected the crop to be dropped, got ${JSON.stringify(clip().virtualCam)}`);
ok('switching back to 16:9 removes the auto-applied crop');

// ── 3 · same ratio twice is a no-op (no redundant reframe pass) ──────────
setup();
st().setAspectRatio('9:16');
const vcBefore = JSON.stringify(clip().virtualCam);
st().setAspectRatio('9:16');
assert.equal(JSON.stringify(clip().virtualCam), vcBefore, 'repeating the same ratio should not recompute/alter the crop');
ok('setting the same ratio twice is a no-op');

// ── 4 · a user-authored crop (not ours) is left alone ─────────────────────
setup();
tm.fromLegacyTracks([
    { id: 'track-default-video', type: 'video', name: 'V', clips: [
        { id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', name: 'TALK.MOV', start: 0, duration: 9, offset: 0, speed: 1,
          virtualCam: { cropX: 0.1, cropY: 0.1, cropW: 0.5, cropH: 0.5 }, // no `reframe` tag → user/multicam crop
          layerMask: { maskAssetUrl: 'm', bboxTrack: bbox, sourceWidth: 1920, sourceHeight: 1080, status: 'ready' } } ] },
]);
useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 9, aspectRatio: '16:9', currentTime: 0, activeClipId: null,
    assets: [{ id: 'a', type: 'video', resolution: { w: 1920, h: 1080 } }], past: [], future: [] });
const manualCropBefore = JSON.stringify(clip().virtualCam);
st().setAspectRatio('9:16');
assert.equal(JSON.stringify(clip().virtualCam), manualCropBefore, 'a manual/multicam crop (no reframe tag) must not be touched by auto-reframe');
ok('a pre-existing manual crop (e.g. multicam) is left untouched by the automatic reframe');

// ── 5 · AI-command path (MediaExecutionEngine) also auto-reframes ─────────
setup();
const engine = new MediaExecutionEngine();
const result = await engine.executeStoreAction({ action: 'setAspectRatio', args: { ratio: '9:16' } }, {});
assert.equal(result.success, true);
assert.ok(/Reframed 1 clip/.test(result.message || ''), `expected a reframe message, got ${JSON.stringify(result)}`);
assert.ok(clip().virtualCam && clip().virtualCam.reframe === '9:16');
ok('the AI-command setAspectRatio path auto-reframes and reports it, with no reframeMode flag needed');

console.log = log;
console.log('\nAll auto-reframe checks passed.');

// ── 6 · the shorts/repurposing pipeline shares the SAME reframe logic ────
// (not a second, separately-maintained copy) -- a source-level wiring check,
// the same style test_lut_export.js already uses for this kind of guarantee.
{
    const fs = (await import('fs')).default;
    const storeSrc = fs.readFileSync(new URL('../client/src/store/useTimelineStore.js', import.meta.url), 'utf8');
    const shortSrc = fs.readFileSync(new URL('../client/src/agent/shortTimeline.js', import.meta.url), 'utf8');
    assert.ok(/import \{[^}]*computeReframePlan[^}]*\} from '\.\.\/motion\/LayoutPresets\.js'/.test(storeSrc),
        'useTimelineStore.js should import computeReframePlan from LayoutPresets.js');
    assert.ok(/import \{ computeReframePlan \} from '\.\.\/motion\/LayoutPresets\.js'/.test(shortSrc),
        'shortTimeline.js should import computeReframePlan from LayoutPresets.js');
    ok('both reframeToFrame() (live editor) and buildShortTimeline() (shorts/repurposing) import the SAME computeReframePlan — no duplicated crop logic to drift apart');
}

console.log('\nAll auto-reframe checks passed (including cross-pipeline wiring).');
