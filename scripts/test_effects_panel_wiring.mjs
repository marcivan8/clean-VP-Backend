/**
 * scripts/test_effects_panel_wiring.mjs
 *
 * R166 — the effects panel went live, so what it promises has to be true.
 *
 * Why this suite exists: EffectsPanel, EffectControls, PresetBrowser and the
 * useEffects hook sat in the tree for months reachable from nothing (R165 —
 * their only importer was a barrel nobody imported). Unreachable code is not
 * merely unused, it is UNTESTED BY USE, and mounting it surfaced two real
 * defects that no linter catches:
 *
 *   1. the hook called `effectRegistry.getCategories()`, which has never
 *      existed — a TypeError on first render;
 *   2. the add-effect menu destructured definition objects as `[type, def]`
 *      pairs, so every button had an undefined key and name, and clicking one
 *      called `onAdd(undefined)`.
 *
 * And one product defect: the menu offered all 20 registry effects, including
 * six that only render through the client WebGL runtime or are not footage
 * looks at all, so a user could add a control that silently did nothing.
 *
 * The checks below pin the registry API the panel depends on, the exact set of
 * effects a hand can apply, and that both surfaces — the hand and the AI —
 * filter by the same predicate.
 *
 * Run: node scripts/test_effects_panel_wiring.mjs
 */

import { register } from 'node:module';
// Transforms .jsx and no-ops CSS imports so the panel can actually be
// rendered, not just read. See scripts/lib/jsxLoaderHooks.mjs.
register('./lib/jsxLoaderHooks.mjs', import.meta.url);

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { effectRegistry, EFFECT_CATEGORIES } from '../client/src/effects/EffectRegistry.js';
import { isGpuClipEffect } from '../client/src/effects/ClipEffectAdapter.js';
import { isHandAppliableEffect, HAND_EXCLUDED_EFFECTS, HAND_SPECIAL_EFFECTS } from '../client/src/effects/handAppliable.js';
import { presetLibrary } from '../client/src/effects/presets/PresetLibrary.js';

let passed = 0, failed = 0;
const check = (name, fn) => {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}`); console.log(`      ${e.message}`); }
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/**
 * Comments stripped before any source assertion.
 *
 * Found by mutation: commenting out `reorderEffects(next)` left the string
 * intact, so a test asserting the call still passed while the handle did
 * nothing. Exactly the false positive the reachability guard had, and the
 * reason this codebase's comments — which quote code constantly — must not be
 * part of what a source check reads.
 */
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

const hook = strip(read('../client/src/hooks/useEffects.js'));
const panel = strip(read('../client/src/components/Effects/EffectsPanel.jsx'));

console.log('\n1. The registry API the panel actually calls');

check('every effectRegistry method the hook calls exists', () => {
    const called = [...new Set([...hook.matchAll(/effectRegistry\.([a-zA-Z]+)\(/g)].map(m => m[1]))];
    assert.ok(called.length >= 5, `only found ${called.length} calls — the scan is wrong`);
    for (const m of called) {
        assert.equal(typeof effectRegistry[m], 'function',
            `effectRegistry.${m}() does not exist. This is the getCategories/getCategorized bug.`);
    }
});

check('every presetLibrary method the hook calls exists', () => {
    const called = [...new Set([...hook.matchAll(/presetLibrary\.([a-zA-Z]+)\(/g)].map(m => m[1]))];
    assert.ok(called.length >= 5);
    for (const m of called) {
        assert.equal(typeof presetLibrary[m], 'function', `presetLibrary.${m}() does not exist`);
    }
});

check('getCategorized returns definition OBJECTS that carry their own type', () => {
    const grouped = effectRegistry.getCategorized();
    const defs = Object.values(grouped).flat();
    assert.ok(defs.length > 0, 'no categorised effects at all');
    for (const def of defs) {
        assert.equal(typeof def, 'object', 'a category entry is not an object');
        assert.ok(typeof def.type === 'string' && def.type, `a definition has no type: ${JSON.stringify(def).slice(0, 60)}`);
        assert.ok(typeof def.name === 'string' && def.name, `${def.type} has no name to render`);
    }
    // The shape the menu renders. A [type, def] pair would destructure to
    // undefined on both halves, which is what it used to do.
    assert.ok(!Array.isArray(defs[0]), 'getCategorized returns pairs, not definitions');
});

check('search() returns the same shape as getCategorized', () => {
    const hits = effectRegistry.search('blur');
    assert.ok(hits.length > 0, 'searching for blur found nothing');
    assert.ok(!Array.isArray(hits[0]), 'search returns pairs, not definitions');
    assert.ok(hits.every(d => typeof d.type === 'string'));
});

console.log('\n2. Only effects that render are offered by hand');

// The server compositor is what renders an exported effect, and
// motion/TimelineVisualEffects is what approximates it in preview. An effect
// offered by hand must be real on both.
const compositor = read('../server/compositor/CompositorCompiler.js');
const previewLayer = read('../client/src/motion/TimelineVisualEffects.js');

// The panel's own rule, imported rather than re-implemented here. A test that
// recomputes the filter cannot catch a filter that matches nothing — which is
// exactly what `([type]) => ...` over definition objects did.
const offered = effectRegistry.getAll().map(d => d.type).filter(isHandAppliableEffect);

check('the rule itself answers correctly, type by type', () => {
    for (const yes of ['blur_gaussian', 'glow', 'vignette', 'invert', 'fade_in', 'color_grade', 'shake']) {
        assert.equal(isHandAppliableEffect(yes), true, `${yes} should be hand-appliable`);
    }
    for (const no of ['smart_zoom', 'beat_sync', 'emotion_frame', 'speed_change',
        'audio_normalize', 'audio_denoise', 'lut_apply']) {
        assert.equal(isHandAppliableEffect(no), false, `${no} should NOT be hand-appliable`);
    }
    for (const junk of [null, undefined, '', 42, {}, []]) {
        assert.equal(isHandAppliableEffect(junk), false, `${JSON.stringify(junk)} is not a type`);
    }
    assert.deepEqual([...HAND_EXCLUDED_EFFECTS], ['lut_apply']);
    assert.deepEqual([...HAND_SPECIAL_EFFECTS], ['shake']);
});

check('the rule applied to real registry definitions keeps a usable menu', () => {
    // The bug this pins: filtering definition OBJECTS with a [type, def]
    // destructure yields `undefined` for every type, so the predicate says no
    // to everything and the menu renders empty — indistinguishable from a
    // working filter unless something counts what survives.
    const defs = Object.values(effectRegistry.getCategorized()).flat();
    const kept = defs.filter(def => isHandAppliableEffect(def?.type));
    assert.ok(kept.length >= 8, `only ${kept.length} of ${defs.length} definitions survive the filter`);
    assert.ok(kept.every(d => d && typeof d.name === 'string'), 'a kept entry has no name to render');
});

check('the offered set is a real subset of the registry', () => {
    assert.ok(offered.length >= 8, `only ${offered.length} effects offered`);
    assert.ok(offered.length < effectRegistry.getAll().length,
        'every registry effect is offered — the filter is not doing anything');
});

check('every offered effect is rendered by the export compositor', () => {
    for (const type of offered) {
        assert.ok(compositor.includes(`'${type}'`),
            `${type} is offered by hand but the export compositor has no branch for it`);
    }
});

check('every offered effect is approximated in the live preview', () => {
    for (const type of offered) {
        assert.ok(previewLayer.includes(`'${type}'`),
            `${type} is offered by hand but nothing renders it in preview`);
    }
});

check('the WebGL-only and non-footage effects are NOT offered', () => {
    // smart_zoom / beat_sync / emotion_frame live in engines/AIEffects.js, which
    // is only reachable through the unmounted client WebGL runtime (R165).
    // speed_change, audio_normalize and audio_denoise are retiming and audio.
    for (const type of ['smart_zoom', 'beat_sync', 'emotion_frame', 'speed_change',
        'audio_normalize', 'audio_denoise']) {
        assert.ok(effectRegistry.get(type), `${type} left the registry — update this list`);
        assert.ok(!offered.includes(type), `${type} is offered by hand but nothing renders it`);
    }
});

check('lut_apply stays out: a LUT has its own command and its own export path', () => {
    assert.ok(isGpuClipEffect('lut_apply'), 'lut_apply is no longer a clip effect — revisit this');
    assert.ok(!offered.includes('lut_apply'));
    assert.ok(!compositor.includes("'lut_apply'"),
        'the compositor now renders lut_apply — it could be offered by hand after all');
});

console.log('\n3. The hand and the AI filter by the same rule');

check('the panel uses the shared rule, and the AI tool the same predicate under it', () => {
    assert.match(panel, /import \{ isHandAppliableEffect \}/, 'the panel does not use the shared rule');
    assert.match(panel, /isHandAppliableEffect\(def\?\.type\)/, 'the panel does not apply it to definitions');
    const tools = read('../client/src/agent/VideoEditorTools.js');
    assert.match(tools, /isHandAppliableEffect\(type\)/, 'the AI tool no longer shares the predicate');
});

check('the AI can apply every effect the hand can, except the fades it handles separately', () => {
    const tools = read('../client/src/agent/VideoEditorTools.js');
    const enumBlock = tools.slice(tools.indexOf('ROKA_FOOTAGE_EFFECT_TYPES = Object.freeze(['),
        tools.indexOf(']);', tools.indexOf('ROKA_FOOTAGE_EFFECT_TYPES = Object.freeze([')));
    const aiTypes = [...enumBlock.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    const handOnly = offered.filter(t => !aiTypes.includes(t));
    assert.deepEqual(handOnly, [],
        `the hand can apply these and the AI cannot: ${handOnly.join(', ')}`);
});

console.log('\n4. The panel is mounted, and does not revive the WebGL runtime');

check('the effects panel has a rail entry and a render branch', () => {
    const railSrc = read('../client/src/components/PanelRail.jsx');
    const layout = read('../client/src/layouts/IDELayout.jsx');
    assert.match(railSrc, /\{ id: 'effects',/, 'no rail entry');
    assert.match(layout, /activeTab === 'effects' && <EffectsPanelHost \/>/, 'no render branch');
    for (const lang of ['en', 'fr']) {
        const dict = JSON.parse(read(`../client/src/locales/${lang}/editor.json`));
        assert.ok(dict.ideLayout.tabs.effects, `${lang} has no name for the tab`);
    }
});

check('nothing in the live chain imports the WebGL barrel', () => {
    // effects/index.js pulls EffectPipeline, EffectRenderer and the GPU/CPU/AI
    // engines. The hook needs the registry and the preset library only.
    for (const [name, src] of [['useEffects', hook], ['EffectsPanel', panel],
        ['EffectsPanelHost', strip(read('../client/src/components/Effects/EffectsPanelHost.jsx'))]]) {
        assert.ok(!/from\s+'[^']*\/effects'/.test(src),
            `${name} imports the effects barrel, which loads the unreachable WebGL runtime`);
    }
    assert.match(hook, /from '\.\.\/effects\/EffectRegistry\.js'/);
    assert.match(hook, /from '\.\.\/effects\/presets\/PresetLibrary\.js'/);
});

check('the host does not hand the panel a playback engine', () => {
    const host = strip(read('../client/src/components/Effects/EffectsPanelHost.jsx'));
    assert.ok(!/playbackEngine/.test(host),
        'the host passes a playbackEngine, which is the WebGL handle');
});

console.log('\n5. It renders');

// The one class of defect no source assertion reaches. Both bugs this round
// found would have thrown here on the first render: a missing registry method
// and a destructuring mismatch. Minimal browser globals, no DOM library — if
// the component tree throws, renderToStaticMarkup throws.
globalThis.window = globalThis;
globalThis.localStorage = globalThis.localStorage || {
    _m: {}, getItem(k) { return this._m[k] ?? null; },
    setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; },
};
globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.removeEventListener = globalThis.removeEventListener || (() => {});
globalThis.matchMedia = globalThis.matchMedia
    || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((cb) => setTimeout(() => cb(0), 0));
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || (() => {});
globalThis.fetch = globalThis.fetch
    || (async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }));

const quiet = { log: console.log, warn: console.warn, error: console.error };
let React, renderToStaticMarkup, EffectsPanel, EffectsPanelHost;
try {
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    // Explicit paths: react lives in client/node_modules, and this file is not
    // under client/, so a bare specifier would not resolve.
    ({ default: React } = await import('../client/node_modules/react/index.js'));
    ({ renderToStaticMarkup } = await import('../client/node_modules/react-dom/server.js'));
    ({ default: EffectsPanel } = await import('../client/src/components/Effects/EffectsPanel.jsx'));
    ({ default: EffectsPanelHost } = await import('../client/src/components/Effects/EffectsPanelHost.jsx'));
} finally {
    console.log = quiet.log; console.warn = quiet.warn; console.error = quiet.error;
}

const renderQuiet = (el) => {
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    try { return renderToStaticMarkup(el); }
    finally { console.log = quiet.log; console.warn = quiet.warn; console.error = quiet.error; }
};

check('with no clip selected it renders its empty state, not a crash', () => {
    const html = renderQuiet(React.createElement(EffectsPanel, { targetId: null, playhead: 0 }));
    assert.ok(html.length > 100, `rendered only ${html.length} chars`);
});

check('with a clip selected the whole hook chain runs', () => {
    // Exercises useEffects -> timelineManager.getEffectsForTarget and the
    // registry, which the empty state never touches.
    const html = renderQuiet(React.createElement(EffectsPanel, { targetId: 'clip-probe-1', playhead: 2.5 }));
    assert.ok(html.length > 1000, `rendered only ${html.length} chars with a clip`);
    assert.ok(/<svg/.test(html), 'no icons rendered');
});

check('the reorder handle is wired, not decoration', () => {
    // It was a GripVertical with `cursor-grab` and nothing behind it, while
    // the panel destructured reorderEffects and never called it. An effect
    // stack is ordered, so that handle promised the one thing it could not do.
    assert.match(panel, /reorderEffects\(next\)/, 'nothing calls reorderEffects');
    assert.match(panel, /draggable/, 'the row is not draggable');
    assert.match(panel, /onMove\.drop\(index\)/, 'a drop does not move anything');
    // Native drag is not keyboard-reachable, so the handle is a real button.
    assert.match(panel, /ArrowUp'/, 'no keyboard path to reorder');
    assert.match(panel, /aria-label=\{t\('effects\.reorderEffect'/, 'the handle has no accessible name');
    for (const lang of ['en', 'fr']) {
        const dict = JSON.parse(read(`../client/src/locales/${lang}/editor.json`));
        assert.ok(dict.effects.reorderEffect, `${lang} has no reorderEffect copy`);
    }
});

check('a move is computed from the current order, not tracked incrementally', () => {
    // Two drops in a row must not disagree about where an effect is.
    assert.match(panel, /const ids = effects\.map\(e => e\.id\)/);
    assert.match(panel, /next\.splice\(to, 0, next\.splice\(from, 1\)\[0\]\)/);
});

check('the host renders too, reading the store for itself', () => {
    const html = renderQuiet(React.createElement(EffectsPanelHost));
    assert.ok(html.length > 100, `host rendered only ${html.length} chars`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('EFFECTS PANEL WIRING FAILED'); process.exit(1); }
console.log('ALL EFFECTS PANEL WIRING CHECKS PASSED');
