// scripts/test_panel_rail.mjs
//
// R108 — the desktop panel rail.
//
// Eleven panels shared one horizontally-scrolling strip of 10px icons, which
// put five of them past the fold behind a 3px chevron. The rail replaces it on
// desktop. These checks are about the two ways that change can go wrong:
//
//   1. A panel in the rail with no render branch (or the reverse) — the
//      "built but never called" pattern this codebase has catalogued nine
//      times, and which IDELayout's own R61 comment warns about by name.
//   2. Two copies of a `data-tour` / `data-hint` anchor in the DOM at once.
//      `document.querySelector` takes the first, the walkthrough would
//      measure a display:none element at zero size and silently give up.
//
// Source-level assertions, because the component is JSX and there is no DOM
// renderer in this suite. They pin the wiring, not the pixels.
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
const check = (name, fn) => {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (err) { failures += 1; console.log(`  ✗ ${name}\n      ${err.message}`); }
};

const RAIL = read('client/src/components/PanelRail.jsx');
const LAYOUT = read('client/src/layouts/IDELayout.jsx');
const CSS = read('client/src/index.css');
const en = JSON.parse(read('client/src/locales/en/editor.json'));
const fr = JSON.parse(read('client/src/locales/fr/editor.json'));

/** Tab ids declared in the rail, in order, including the footer group. */
const railIds = (() => {
    const ids = [];
    for (const name of ['RAIL_TABS', 'RAIL_FOOTER_TABS']) {
        const i = RAIL.indexOf(`export const ${name} = [`);
        assert.ok(i > 0, `${name} is missing`);
        const body = RAIL.slice(i, RAIL.indexOf('];', i));
        for (const m of body.matchAll(/id:\s*'([a-z-]+)'/g)) ids.push(m[1]);
    }
    return ids;
})();

/** Tab ids the mobile strip still offers. */
const stripIds = (() => {
    const m = LAYOUT.match(/\{\[('media',[^\]]+)\]\.map\(tab =>/);
    assert.ok(m, 'the mobile strip list could not be read');
    return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();

console.log('\n── 1. Every panel is reachable, and nothing is advertised twice ──');

check('the rail offers exactly the panels the strip does', () => {
    assert.deepEqual([...railIds].sort(), [...stripIds].sort(),
        `rail: ${railIds.join(', ')}\n      strip: ${stripIds.join(', ')}`);
});

check('no panel is listed twice in the rail', () => {
    assert.equal(new Set(railIds).size, railIds.length, railIds.join(', '));
});

check('every panel in the rail has a render branch in IDELayout', () => {
    // The half-wired panel is this codebase's signature bug: an entry in the
    // switcher with nothing behind it renders an empty sidebar and no error.
    const missing = railIds.filter(id => !LAYOUT.includes(`activeTab === '${id}'`));
    assert.deepEqual(missing, [], `no render branch for: ${missing.join(', ')}`);
});

check('every panel in the rail has a name in both locales', () => {
    for (const [loc, dict] of [['en', en], ['fr', fr]]) {
        const missing = railIds.filter(id => !dict.ideLayout?.tabs?.[id]);
        assert.deepEqual(missing, [], `${loc}: ${missing.join(', ')}`);
    }
    assert.ok(en.ideLayout.panelsRail && fr.ideLayout.panelsRail, 'the rail has no accessible name');
});

check('settings is the only thing below the divider', () => {
    const i = RAIL.indexOf('export const RAIL_FOOTER_TABS = [');
    const body = RAIL.slice(i, RAIL.indexOf('];', i));
    const ids = [...body.matchAll(/id:\s*'([a-z-]+)'/g)].map(m => m[1]);
    assert.deepEqual(ids, ['settings']);
});

console.log('\n── 2. One switcher at a time, so one anchor at a time ──');

check('the rail is mounted only on desktop', () => {
    assert.ok(/\{!isMobile && \(\s*<div className="hidden md:block shrink-0">\s*<PanelRail/.test(LAYOUT), 'the rail is not gated on desktop');
});

check('the desktop timeline overlays the left rail and media panel as the top layer', () => {
    assert.ok(/<main className="flex-1 flex flex-col min-w-0 min-h-0 relative">/.test(LAYOUT), 'the preview column unexpectedly reserves a separate timeline row');
    assert.ok(/mode === 'editor' && isMobile/.test(LAYOUT), 'mobile timeline is not kept in the center column');
    assert.ok(/mode === 'editor' && !isMobile && \([\s\S]*?className="absolute bottom-0 left-0 right-80 z-50 hidden md:flex h-72/.test(LAYOUT), 'desktop timeline does not overlay from the workspace left edge to the AI sidebar');
});

check('the horizontal strip is mounted only on mobile', () => {
    // Gated by mounting, NOT by a `md:hidden` class: a hidden element is
    // still in the DOM, and querySelector would find its anchors first.
    assert.ok(/\{isMobile && \(\s*<div className="relative border-b"/.test(LAYOUT),
        'the strip is not gated on isMobile');
    const strip = LAYOUT.slice(LAYOUT.indexOf('{isMobile && (\n                            <div className="relative border-b"'));
    assert.ok(!/md:hidden/.test(strip.slice(0, 400)), 'the strip is hidden by CSS instead of unmounted');
});

check('both switchers carry the same R105 anchors', () => {
    for (const src of [RAIL, LAYOUT]) {
        assert.ok(/data-tour=\{`tab-\$\{(id|tab)\}`\}/.test(src), 'a tour anchor is missing');
        assert.ok(/data-hint=\{`tab-\$\{(id|tab)\}`\}/.test(src), 'a hint anchor is missing');
    }
});

console.log('\n── 3. Collapsing, and the things that must undo it ──');

check('clicking the open panel collapses, clicking another opens', () => {
    const i = LAYOUT.indexOf('const handleSelectTab');
    const body = LAYOUT.slice(i, LAYOUT.indexOf('}, [activeTab', i));
    assert.ok(/if \(tab === activeTab\) \{[\s\S]*?persistCollapsed\(next\);[\s\S]*?return;/.test(body),
        'the active icon does not toggle');
    assert.ok(/const next = !panelCollapsed;/.test(body), 'the toggle does not read the current state');
    assert.ok(/setActiveTab\(tab\);\s*\n\s*persistCollapsed\(false\);/.test(body),
        'switching panels does not reopen a collapsed workspace');
});

check('the paid gate survived the move off the strip', () => {
    const i = LAYOUT.indexOf('const handleSelectTab');
    const body = LAYOUT.slice(i, LAYOUT.indexOf('}, [activeTab', i));
    assert.ok(/tab === 'shorts' && isFree/.test(body), 'the shorts gate is gone');
    assert.ok(/QUOTA_EXCEEDED/.test(body), 'the upgrade prompt is gone');
    assert.ok(/tab === 'assets'\) setAssetInitialTab\('sfx'\)/.test(body), 'the assets sub-tab default is gone');
});

check('the walkthrough opens the panel before it starts', () => {
    // A tour step that spotlights a control inside a collapsed panel measures
    // zero and gives up without saying anything.
    const i = LAYOUT.indexOf('shouldShowOnboardingTour()) return undefined');
    const body = LAYOUT.slice(i, i + 600);
    assert.ok(/setPanelCollapsed\(false\)/.test(body), 'a collapsed workspace would swallow the tour');
});

check('a clip action opens the panel it targets', () => {
    const i = LAYOUT.indexOf('const handleClipAction');
    const body = LAYOUT.slice(i, LAYOUT.indexOf('}, [setActiveTab', i));
    assert.ok(/persistCollapsed\(false\)/.test(body), 'the action would go nowhere visible');
});

check('the collapse preference cannot throw on a blocked store', () => {
    // localStorage throws rather than returning null in some privacy modes.
    const i = LAYOUT.indexOf('const [panelCollapsed');
    const body = LAYOUT.slice(i, LAYOUT.indexOf('const persistCollapsed', i));
    assert.ok(/try \{/.test(body) && /catch/.test(body), 'the read is unguarded');
    const w = LAYOUT.slice(LAYOUT.indexOf('const persistCollapsed'), LAYOUT.indexOf('const persistCollapsed') + 400);
    assert.ok(/try \{/.test(w) && /catch/.test(w), 'the write is unguarded');
});

console.log('\n── 4. The rail is legible and reachable ──');

check('the icons are a real pointer target, not a 10px glyph', () => {
    const i = CSS.indexOf('.panel-rail-btn {');
    assert.ok(i > 0, 'the rail has no styles');
    const body = CSS.slice(i, CSS.indexOf('}', i));
    const px = (prop) => Number((body.match(new RegExp(prop + ':\\s*([0-9]+)px')) || [])[1]);
    assert.ok(px('width') >= 36, `width is ${px('width')}px`);
    assert.ok(px('height') >= 36, `height is ${px('height')}px`);
});

check('keyboard focus is visible', () => {
    assert.ok(/\.panel-rail-btn:focus-visible \{[^}]*outline:/.test(CSS), 'no focus ring');
});

check('the name is available to a screen reader, not only on hover', () => {
    assert.ok(/aria-label=\{label\}/.test(RAIL), 'no accessible name');
    assert.ok(/role="tablist"/.test(RAIL) && /role="tab"/.test(RAIL), 'not announced as a tab list');
    assert.ok(/aria-selected=\{active\}/.test(RAIL), 'the open panel is not announced');
});

check('the rail is not a scroll container, or it would clip its own labels', () => {
    // Found by rendering it: the hover label is absolutely positioned outside
    // the rail's 56px, so `overflow: auto` showed an empty sliver instead of
    // a name. Nothing about reading the CSS suggests it.
    const i = CSS.indexOf('.panel-rail {');
    // Comments stripped first: the rule's own note explains the trap by
    // naming `overflow: auto`, which would otherwise read as the trap.
    const body = CSS.slice(i, CSS.indexOf('}', i)).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/overflow(-x|-y)?:\s*(auto|hidden|scroll)/.test(body), 'the label will be clipped');
    assert.ok(/overflow:\s*visible/.test(body), 'overflow is not stated, so a later change could clip it silently');
});

check('a short window shrinks the rail instead, so no panel falls off it', () => {
    const m = CSS.match(/@media \(max-height: (\d+)px\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'no compact rule — eleven icons would overflow a laptop window');
    const body = m[0];
    const btn = body.match(/\.panel-rail-btn \{[^}]*height:\s*(\d+)px/);
    assert.ok(btn, 'the compact rule does not resize the buttons');
    const h = Number(btn[1]);
    assert.ok(h >= 32, `compact height ${h}px is below a usable target`);
    // Eleven rows plus the footer have to fit the shortest window it claims.
    const gap = Number((body.match(/\.panel-rail-group \{ gap:\s*(\d+)px/) || [])[1] ?? 4);
    const needed = 11 * (h + gap) + 24;
    assert.ok(needed <= Number(m[1]) - 60, `${needed}px of rail in a ${m[1]}px window, less the header`);
});

check('there is no second, native tooltip', () => {
    assert.ok(!/title=\{label\}/.test(RAIL), 'the browser tooltip would fire after the custom one');
});

check('motion is dropped for anyone who asked for less of it', () => {
    assert.ok(/prefers-reduced-motion[\s\S]{0,200}panel-rail-btn/.test(CSS), 'no reduced-motion branch');
});

console.log('\n── 5. Keyboard navigation ──');

check('the rail is one tab stop, not eleven', () => {
    assert.ok(/tabIndex=\{id === focusId \? 0 : -1\}/.test(RAIL), 'no roving tabindex');
});

check('a panel that is not in the rail still leaves a way in', () => {
    // activeTab can be `marketplace` or `interview`, which no icon matches.
    // Without the fallback the rail would have no tab stop at all.
    assert.ok(/allIds\.includes\(activeTab\) \? activeTab : allIds\[0\]/.test(RAIL),
        'the tab stop can disappear');
});

check('arrow keys move focus, and wrap at both ends', () => {
    const i = RAIL.indexOf('const onKeyDown');
    const body = RAIL.slice(i, RAIL.indexOf('const allIds', i));
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End']) {
        assert.ok(body.includes(`'${key}'`), `${key} is not handled`);
    }
    assert.ok(/from === last \? 0 : from \+ 1/.test(body), 'the end does not wrap');
    assert.ok(/from === 0 \? last : from - 1/.test(body), 'the start does not wrap');
});

check('arrowing moves focus without opening panels', () => {
    const i = RAIL.indexOf('const onKeyDown');
    const body = RAIL.slice(i, RAIL.indexOf('const allIds', i));
    assert.ok(/\.focus\(\)/.test(body), 'focus is not moved');
    assert.ok(!/onSelect\(/.test(body), 'arrowing opens panels, which would mount ten on the way to the eleventh');
});

check('the rail stops the event, so it does not also step the playhead', () => {
    // IDELayout binds ←/→ at the window to step one frame. Both behaviours
    // are right; whichever has focus has to win, and only one can.
    const i = RAIL.indexOf('const onKeyDown');
    const body = RAIL.slice(i, RAIL.indexOf('const allIds', i));
    assert.ok(/stopPropagation\(\)/.test(body), 'the playhead would move at the same time');
    assert.ok(/preventDefault\(\)/.test(body), 'the page would scroll too');
});

check('modified arrows are left to the browser', () => {
    const i = RAIL.indexOf('const onKeyDown');
    const body = RAIL.slice(i, RAIL.indexOf('const allIds', i));
    assert.ok(/event\.metaKey \|\| event\.ctrlKey \|\| event\.altKey/.test(body), 'OS shortcuts are swallowed');
});

console.log('\n── 6. Collapsing says so, once ──');

check('the first collapse fires a hint', () => {
    const i = LAYOUT.indexOf('const handleSelectTab');
    const body = LAYOUT.slice(i, LAYOUT.indexOf('}, [activeTab', i));
    assert.ok(/triggerHint\('panel_collapsed'\)/.test(body), 'the panel vanishes with nothing said');
    assert.ok(/if \(next\) triggerHint/.test(body), 'it would also fire when REopening');
});

check('the hint has an anchor that exists, and copy in both locales', () => {
    const HINT = read('client/src/components/FirstRunHint.jsx');
    const m = HINT.match(/panel_collapsed: \{ anchor: '([a-z-]+)',\s*placement: '([a-z]+)'/);
    assert.ok(m, 'the hint is not declared');
    const [, anchor, placement] = m;
    assert.ok(RAIL.includes(`data-hint="${anchor}"`), `nothing carries data-hint="${anchor}"`);
    // The rail is at the far left, so the card has to open to its right.
    assert.equal(placement, 'right');
    for (const [loc, dict] of [['en', en], ['fr', fr]]) {
        const copy = dict.hints?.panel_collapsed;
        assert.ok(copy?.title && copy?.body, `${loc}: no copy`);
    }
});

console.log(failures === 0 ? '\n✅ panel rail: all checks passed\n' : `\n❌ panel rail: ${failures} failing\n`);
process.exit(failures === 0 ? 0 : 1);
