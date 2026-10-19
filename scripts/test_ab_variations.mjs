// scripts/test_ab_variations.mjs
//
// Roadmap item 1 — the IterationEngine <-> ABTestPanel store mismatch.
//
// The A/B feature was broken in three places at once, all silent:
//   1. IterationEngine published with `setVariations?.(results)` — and
//      `setVariations` did not exist on useTimelineStore. Optional chaining
//      turned "this store cannot accept these" into a no-op, so the engine
//      logged "3 variations ready" having published them nowhere.
//   2. ABTestPanel read `variations` from the legacy useEditorStore, which
//      nothing writes to any more, so it rendered its empty state forever.
//   3. clear() reset the engine's own fields but left the store's
//      activeVariationId pointing at a variation that no longer existed.
//
// None of it threw. The feature was "built" and did nothing — the pattern
// ADR-001 has now catalogued nine times. These checks assert the contract
// between the engine and the store directly, which is the only place the
// failure was ever visible.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Source checks below must look at CODE, not prose: the fix's own comment
// quotes the broken call it replaced, which a naive regex reads as the bug
// still being present.
// Line-based only, deliberately: a regex strip of /* */ blocks mispairs on a
// 157k JSX file (a delimiter inside a string swallowed the whole tab list),
// and every comment these checks need to ignore is a // line anyway.
const readCode = (p) => read(p)
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

const useTimelineStore = (await import('../client/src/store/useTimelineStore.js')).default;
const { IterationEngine } = await import('../client/src/agent/IterationEngine.js');

const VARIATIONS = [
    { id: 'v1', name: 'Fast cuts', description: 'punchy', engagementScore: 82, snapshot: { tracks: [{ id: 't1', type: 'video', clips: [{ id: 'c1', start: 0, duration: 4 }] }], duration: 4, aspectRatio: '9:16' } },
    { id: 'v2', name: 'Slow build', description: 'calm', engagementScore: 68, snapshot: { tracks: [{ id: 't1', type: 'video', clips: [{ id: 'c1', start: 0, duration: 9 }] }], duration: 9, aspectRatio: '9:16' } },
];

log('\n── 1. The store can actually hold variations ──');

await check('useTimelineStore exposes the whole variations slice', () => {
    const s = useTimelineStore.getState();
    assert.ok(Array.isArray(s.variations), 'variations is not an array');
    assert.equal(s.activeVariationId, null);
    for (const fn of ['setVariations', 'setActiveVariation', 'clearVariations']) {
        assert.equal(typeof s[fn], 'function', `${fn} is missing — the engine's call would no-op again`);
    }
});

await check('setVariations stores the list and caps it at three', () => {
    useTimelineStore.getState().setVariations(VARIATIONS);
    assert.equal(useTimelineStore.getState().variations.length, 2);
    useTimelineStore.getState().setVariations([...VARIATIONS, ...VARIATIONS, ...VARIATIONS]);
    assert.equal(useTimelineStore.getState().variations.length, 3, 'the panel only renders three');
    useTimelineStore.getState().clearVariations();
});

await check('setVariations survives rubbish without throwing', () => {
    useTimelineStore.getState().setVariations(null);
    assert.deepEqual(useTimelineStore.getState().variations, []);
    useTimelineStore.getState().setVariations(undefined);
    assert.deepEqual(useTimelineStore.getState().variations, []);
});

log('\n── 2. The engine publishes where the panel reads ──');

await check('a generated set reaches the store the panel subscribes to', () => {
    // Stand in for a completed generate(): the engine hands its results to
    // the store exactly as generateVariations does at the end of its run.
    IterationEngine.variations = [...VARIATIONS];
    useTimelineStore.getState().setVariations(IterationEngine.variations);
    const seen = useTimelineStore.getState().variations;
    assert.equal(seen.length, 2, 'the panel would still show its empty state');
    assert.equal(seen[0].name, 'Fast cuts');
});

await check('publishing is NOT optionally chained any more', () => {
    // The actual defect was the `?.` — it has to stay gone, or a future
    // rename silently reintroduces exactly this bug.
    const code = readCode('client/src/agent/IterationEngine.js');
    assert.ok(!/setVariations\?\./.test(code), 'setVariations is optionally chained again');
    assert.match(code, /setVariations is missing/, 'nothing fails loudly if the action disappears');
});

await check('the panel reads the same store the engine writes', () => {
    const src = readCode('client/src/components/ABTestPanel.jsx');
    assert.ok(!/useEditorStore/.test(src), 'ABTestPanel still reads the legacy store');
    assert.match(src, /useTimelineStore/, 'ABTestPanel reads no store at all');
});

await check('the panel cannot crash on an undefined list', () => {
    // It reads `variations.length` unguarded in four places.
    const src = read('client/src/components/ABTestPanel.jsx');
    assert.match(src, /s\.variations\)\s*\|\|\s*\[\]/, 'variations is not defaulted');
});

log('\n── 3. Loading, restoring and clearing keep both sides in step ──');

await check('loading a variation applies it AND marks it active in the store', () => {
    useTimelineStore.setState({ tracks: [{ id: 'orig', type: 'video', clips: [] }], duration: 30, aspectRatio: '16:9' });
    IterationEngine.variations = [...VARIATIONS];
    IterationEngine._originalSnapshot = { tracks: [{ id: 'orig', type: 'video', clips: [] }], duration: 30, aspectRatio: '16:9' };

    const ok = IterationEngine.loadVariation('v1');
    assert.equal(ok, true, 'loadVariation reported failure');
    const s = useTimelineStore.getState();
    assert.equal(s.duration, 4, 'the variation never reached the timeline');
    assert.equal(s.activeVariationId, 'v1', 'the panel would not show which variation is active');
});

await check('restoring puts the original back and clears the active id', () => {
    const ok = IterationEngine.restoreOriginal();
    assert.equal(ok, true);
    const s = useTimelineStore.getState();
    assert.equal(s.duration, 30, 'the original timeline did not come back');
    assert.equal(s.activeVariationId, null, 'the panel would still show a variation as active');
});

await check('clear empties the list and the active id together', () => {
    IterationEngine.variations = [...VARIATIONS];
    useTimelineStore.getState().setVariations(VARIATIONS);
    useTimelineStore.getState().setActiveVariation('v2');
    IterationEngine.clear();
    const s = useTimelineStore.getState();
    assert.deepEqual(s.variations, [], 'the list survived Clear');
    assert.equal(s.activeVariationId, null, 'activeVariationId pointed at a deleted variation');
});

await check('an unknown variation id is refused, not half-applied', () => {
    IterationEngine.variations = [...VARIATIONS];
    useTimelineStore.setState({ duration: 30 });
    assert.equal(IterationEngine.loadVariation('does-not-exist'), false);
    assert.equal(useTimelineStore.getState().duration, 30, 'the timeline was touched for a variation that does not exist');
});

log('\n── 4. Variations are workspace state, not timeline content ──');

await check('the variation list is not part of the undo snapshot', () => {
    // If it were, one undo after loading a variation would both restore the
    // clips and forget the variations that produced them.
    const src = read('client/src/store/useTimelineStore.js');
    const snapshot = src.match(/_saveHistory[\s\S]{0,900}/);
    assert.ok(snapshot, 'could not find _saveHistory to inspect');
    assert.ok(!/variations/.test(snapshot[0]), 'variations leaked into the history snapshot');
});

log('\n── 5. Reachability ──');

await check('the A/B panel has an entry point in the app', () => {
    // ADR-001 counted eight features that were fully built and never called,
    // and its prescribed remedy is a reachability test per feature. This one
    // is the ninth: the panel existed, its engine was fixed, and nothing
    // imported it.
    const layout = readCode('client/src/layouts/IDELayout.jsx');
    assert.match(layout, /import ABTestPanel/, 'ABTestPanel is imported nowhere');
    assert.match(layout, /activeTab === 'iterations'/, 'no tab renders the A/B panel');
    assert.match(layout, /'iterations'[,\]]/, "'iterations' is not in the tab list, so the button never appears");
});

await check('ScenePanel stays unmounted, because that was a decision', () => {
    // Worth recording as its own check, because ScenePanel looks exactly like
    // another unreachable panel and is not one. The Scene tab was removed on
    // purpose: it rendered a raw "IDELAYOUT.TABS.SCENE" label (the
    // translation was never added) and was not earning its place in the tab
    // bar. The component is kept, unmounted, as the starting point for a
    // future surface. test_scene_editor.mjs asserts the same thing from the
    // other side; this one exists so anyone adding tabs here sees why.
    // Assert on CODE patterns, not the component's name: a comment explaining
    // why it is absent would otherwise read as the thing being present.
    const layout = readCode('client/src/layouts/IDELayout.jsx');
    assert.ok(!/import\s+ScenePanel/.test(layout), 'the scene editor was imported — see test_scene_editor.mjs first');
    assert.ok(!/activeTab === 'scene'/.test(layout), 'a scene tab was mounted — see test_scene_editor.mjs first');
});

await check('the new tab has a label in every locale', () => {
    for (const locale of ['en', 'fr']) {
        const tabs = JSON.parse(read(`client/src/locales/${locale}/editor.json`)).ideLayout.tabs;
        for (const tab of ['iterations']) {
            assert.ok(tabs[tab] && String(tabs[tab]).trim(), `${locale}: tabs.${tab} is missing, the button would read as its key`);
        }
    }
});

log('');
if (failures > 0) {
    log(`${failures} FAILED`);
    process.exit(1);
}
log('ALL A/B VARIATION TESTS PASSED');
