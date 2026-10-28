/**
 * scripts/test_styles_panels.mjs — R116.
 *
 * Two things shipped this round and both have a way of going quietly wrong:
 *
 *  1. The chat box's left button — the EDITING style — and the caption-pack
 *     consolidation that came out of building the wrong thing first. The
 *     desktop Roka card and the mobile sheet had already drifted: the card
 *     looped `updateClip` per clip (so undo took one press per caption) and
 *     dropped the highlight choice, while mobile went through
 *     `applyCaptionStyleToAll`. These checks pin that there is now one
 *     builder and one apply path, and that neither rebuilds the field list.
 *
 *  2. The shared panel control kit. The arithmetic — clamping, track
 *     percentages, step snapping, hex parsing, arrow-key moves — is the half
 *     that can be wrong without anything throwing: a NaN width silently
 *     collapses a slider to the left edge and nothing reports it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(HERE, p), 'utf8');
const log = (...a) => console.log(...a);
let failures = 0;
const check = async (name, fn) => {
    try { await fn(); log(`  ok  ${name}`); }
    catch (e) { failures += 1; log(`  FAIL ${name}: ${e.message}`); }
};

const PACKS = await import('../client/src/components/Assistant/captionStylePacks.js');
const PC = await import('../client/src/components/ui/panelControls.js');
const { EDITING_STYLE_IDS } = await import('../client/src/agent/EditingStyles.js');

const picker = read('../client/src/components/Assistant/EditingStylePicker.jsx');
const composer = read('../client/src/components/Assistant/ChatComposer.jsx');
const roka = read('../client/src/components/Assistant/ReasoningPanel.jsx');
const mobile = read('../client/src/components/MobileCaptionSheets.jsx');
const kit = read('../client/src/components/ui/PanelControls.jsx');
/**
 * Comments stripped. A check that greps a source file for a forbidden string
 * will otherwise match the comment EXPLAINING why that string is forbidden —
 * which is how two of these checks failed the first time they ran.
 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const kitCode = code(kit);
const css = read('../client/src/index.css');

log('\n-- 1. Caption packs: one field list, one apply path --');

await check('every pack is complete and uniquely named', () => {
    const ids = PACKS.CAPTION_STYLES.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate pack id');
    for (const p of PACKS.CAPTION_STYLES) {
        for (const k of ['id', 'name', 'font', 'weight', 'tag', 'color', 'sample']) {
            assert.ok(p[k] !== undefined && p[k] !== '', `${p.id} missing ${k}`);
        }
        assert.equal(PACKS.packById(p.id), p, `packById missed ${p.id}`);
    }
    assert.equal(PACKS.packById('not-a-pack'), null);
});

await check('every pack builds the fields applyCaptionStyleToAll expects', () => {
    // These are exactly the keys the store action writes onto a clip. A pack
    // that produced a different shape would be applied and then render as the
    // old style, with no error anywhere.
    const expected = ['fontFamily', 'fontWeight', 'color', 'stroke', 'textShadow',
        'fontStyle', 'captionStyle', 'animations', 'animation'];
    for (const p of PACKS.CAPTION_STYLES) {
        const u = PACKS.captionPackUpdates(p);
        assert.deepEqual(Object.keys(u).sort(), [...expected].sort(), `${p.id} field shape`);
        assert.equal(u.captionStyle.packId, p.id, `${p.id} does not round-trip its own id`);
        // R61: clearing a hand-authored animation is what makes the pack's own
        // preset actually render.
        assert.deepEqual(u.animations, []);
        assert.equal(u.animation, 'none');
    }
});

await check('junk is not turned into a style', () => {
    for (const bad of [null, undefined, 'bold-impact', 42, {}, { name: 'x' }]) {
        assert.equal(PACKS.captionPackUpdates(bad), null, String(bad));
    }
});

await check('the highlight is kept by default and only switched off when asked', () => {
    // Mobile passes highlight:false when the user has turned the switch off.
    // A picker that does not care must NOT silently disable it — that is how
    // the desktop card used to wipe the choice.
    const pack = PACKS.packById('bold-impact');
    assert.notEqual(PACKS.captionPackUpdates(pack).captionStyle.wordHighlight.mode, 'none');
    assert.notEqual(PACKS.captionPackUpdates(pack, {}).captionStyle.wordHighlight.mode, 'none');
    assert.equal(PACKS.captionPackUpdates(pack, { highlight: false }).captionStyle.wordHighlight.mode, 'none');
});

await check('both pickers go through the one builder and the one apply path', () => {
    for (const [name, src] of [['Roka card', roka], ['mobile sheet', mobile]]) {
        assert.ok(/captionPackUpdates\(/.test(src), `${name} does not use the shared builder`);
        assert.ok(/applyCaptionStyleToAll\(/.test(src), `${name} does not use the shared apply path`);
        // The literal field list must exist in exactly one place.
        assert.ok(!/fontFamily:\s*style\.font/.test(src), `${name} still builds the field list by hand`);
    }
    // One transaction, not one per clip: the loop that made undo take N
    // presses is gone from the Roka card.
    assert.ok(!/track\.clips\.forEach\(clip => updateClip/.test(roka), 'the per-clip updateClip loop is back');
});

await check('one preview, not three', () => {
    for (const p of PACKS.CAPTION_STYLES) {
        const s = PACKS.previewStyle(p, 20);
        assert.ok(s.fontFamily.includes(p.font), `${p.id} preview font`);
        assert.equal(s.color, p.color);
        assert.equal(s.fontSize > 0, true);
    }
    assert.deepEqual(PACKS.previewStyle(null), {});
    assert.ok(/previewStyle\(/.test(roka), 'the Roka card draws its own preview');
    // CSS paints a text stroke OVER the fill, so `motivational` (1.5px black
    // on white) rendered as hollow outlines at preview size — nothing like
    // the pack in a video, where the stroke sits behind.
    assert.equal(PACKS.previewStyle(PACKS.packById('motivational')).paintOrder, 'stroke fill');
});

log('\n-- 2. The editing style is the left button of the chat box --');

await check('the style picker holds the slot, and Tools does not', () => {
    assert.ok(/<EditingStylePicker\b/.test(composer), 'the style picker is not mounted');
    assert.ok(!/<ToolsMenu\b/.test(composer), 'the Tools menu is still mounted');
    assert.ok(!/<StylesMenu\b/.test(composer), 'the caption-pack menu is still mounted');
    // It is the FIRST control in the desktop row, not a pill tucked after one.
    assert.ok(/hidden md:flex[^"]*">\s*<EditingStylePicker/.test(composer),
        'something else took the left slot');
});

await check('the menu is keyboard-operable and labelled', () => {
    for (const k of ['role="menu"', 'role="menuitemradio"', 'aria-checked', "'ArrowUp'", "'ArrowDown'",
        "'Home'", "'End'", "'Escape'", "'Tab'", 'aria-haspopup="menu"', 'aria-expanded']) {
        assert.ok(picker.includes(k), k);
    }
    // Escape must return focus to the button, or the keyboard user is
    // stranded at the end of the document.
    assert.ok(/close\(\)/.test(picker) && /buttonRef\.current\?\.focus\(\)/.test(picker),
        'Escape does not return focus');
});

await check('every style shows what it DOES, in both locales', () => {
    // A name alone is not a choice: "Interview" means nothing until you read
    // that it keeps questions and answers whole.
    assert.ok(/editingStyles\.hints\./.test(picker), 'the menu shows names without hints');
    for (const lang of ['en', 'fr']) {
        const e = JSON.parse(read(`../client/src/locales/${lang}/editor.json`)).editingStyles;
        for (const id of [...EDITING_STYLE_IDS, 'none']) {
            assert.ok(e.hints?.[id], `${lang}.hints.${id}`);
            if (id !== 'none') assert.ok(e.names?.[id], `${lang}.names.${id}`);
        }
        for (const k of ['label', 'none', 'modeLabel', 'normal', 'auto']) assert.ok(e[k], `${lang}.${k}`);
    }
});

await check('every style has a face, including "no style"', () => {
    // The menu is scanned, not read; six rows of hint look alike without an
    // icon to anchor each one. A missing key would fall back silently.
    for (const id of [...EDITING_STYLE_IDS, 'none']) {
        assert.ok(new RegExp(`\\b${id}: `).test(picker), `no icon for ${id}`);
    }
});

await check('the free tier is gated, and the gate is not just a hidden button', () => {
    // Clicking a locked style must RAISE the upgrade path, not silently do
    // nothing - and it must not write the style either.
    assert.ok(/isPaid/.test(picker));
    assert.ok(/QUOTA_EXCEEDED/.test(picker), 'no upgrade event');
    assert.ok(/styleUpgradeRequired/.test(picker) && /autoUpgradeRequired/.test(picker));
    assert.ok(/if \(!isPaid && id !== null\)[\s\S]{0,400}?return;/.test(picker),
        'a locked style can still be set');
});

await check('the R105 anchors survived the move', () => {
    // The walkthrough's Auto step and the `auto_available` hint both point at
    // this element. Losing either attribute breaks onboarding with no error.
    assert.ok(/data-tour="style-picker"/.test(picker));
    assert.ok(/data-hint="style-picker"/.test(picker));
});

await check('the menu and the mode toggle are styled, and share the composer shell', () => {
    for (const cls of ['chat-composer__menu--editing', 'chat-composer__style-hint',
        'chat-composer__style-title', 'chat-composer__pro', 'chat-composer__mode', 'chat-composer__mode-btn']) {
        assert.ok(css.includes(`.${cls}`), `no CSS for ${cls}`);
        assert.ok(picker.includes(cls), `${cls} is never used`);
    }
    // The trigger reuses the composer's own pill, so the one menu in that
    // corner looks like the menu that was there before it.
    assert.ok(/className="chat-composer__pill"/.test(picker));
    // The retired caption-pack menu took its CSS with it.
    assert.ok(!css.includes('chat-composer__styles-grid'), 'dead caption-pack CSS is still shipping');
});

log('\n-- 3. The control kit arithmetic --');

await check('a track percentage is never NaN, however bad the range', () => {
    assert.equal(PC.percentOf(5, 0, 10), 50);
    assert.equal(PC.percentOf(-99, 0, 10), 0);
    assert.equal(PC.percentOf(99, 0, 10), 100);
    // A collapsed range is a real case and the obvious arithmetic gives NaN,
    // which CSS drops silently: the handle sticks at the left and nothing
    // anywhere reports a fault.
    for (const [v, lo, hi] of [[5, 3, 3], [5, NaN, 10], [5, 0, NaN], ['x', 0, 10]]) {
        const p = PC.percentOf(v, lo, hi);
        assert.ok(Number.isFinite(p), `percentOf(${v},${lo},${hi}) = ${p}`);
        assert.ok(p >= 0 && p <= 100, `out of range: ${p}`);
    }
});

await check('clamping treats junk as "nothing given", not as zero-at-any-cost', () => {
    assert.equal(PC.clampTo(5, 0, 10), 5);
    assert.equal(PC.clampTo(-5, 0, 10), 0);
    assert.equal(PC.clampTo('abc', 4, 10), 4, 'junk should fall to the minimum, not below it');
    assert.equal(PC.clampTo(undefined, -10, 10), -10);
    assert.equal(PC.clampTo(3, undefined, undefined), 3);
    // A zero minimum is legitimate and must survive — the `|| fallback` bug.
    assert.equal(PC.clampTo(0, 0, 10), 0);
});

await check('snapping lands on the step and does not leak float noise', () => {
    assert.equal(PC.snapTo(0.35, 0, 1, 0.1), 0.3);
    assert.equal(PC.snapTo(0.34, 0, 1, 0.1), 0.3);
    assert.equal(PC.snapTo(7.9, 0, 10, 2), 8);
    assert.equal(PC.snapTo(6.9, 0, 10, 2), 6);
    assert.equal(PC.snapTo(7, 0, 10, 2), 8, 'a tie rounds up, consistently');
    assert.equal(PC.snapTo(99, 0, 10, 2), 10, 'snapping must not escape the range');
    // 0.1 + 0.2 arithmetic would otherwise show up in a number box as
    // "0.30000000000000004".
    for (let i = 0; i <= 10; i++) {
        const v = PC.snapTo(i / 10, 0, 1, 0.1);
        assert.ok(String(v).length <= 4, `${v} is float noise`);
    }
    assert.equal(PC.snapTo(3.7, 0, 10, 0), 3.7, 'a zero step must not divide by zero');
});

await check('a value reads with the STEP\'s precision, not the value\'s', () => {
    assert.equal(PC.formatValue(12, 1, 'px'), '12px');
    assert.equal(PC.formatValue(12.4, 1), '12');
    assert.equal(PC.formatValue(0.3, 0.1), '0.3');
    assert.equal(PC.formatValue(1, 0.01), '1.00');
    assert.equal(PC.formatValue('junk', 1), '');
});

await check('a typed hex is taken in any spelling a person would use', () => {
    assert.equal(PC.normalizeHex('fff'), '#FFFFFF');
    assert.equal(PC.normalizeHex('#e2cf23'), '#E2CF23');
    assert.equal(PC.normalizeHex('  #ABC  '), '#AABBCC');
    for (const bad of ['', null, 'red', '#12', '#12345', 'ggg', '#1234567']) {
        assert.equal(PC.normalizeHex(bad), null, String(bad));
    }
});

await check('luminance tells a light swatch from a dark one', () => {
    assert.ok(PC.hexLuminance('#FFFFFF') > 0.9);
    assert.ok(PC.hexLuminance('#000000') < 0.05);
    assert.ok(PC.hexLuminance('#E2CF23') > 0.6, 'a bright yellow swatch needs the darker outline');
    assert.equal(PC.hexLuminance('nonsense'), 0);
});

await check('arrow keys wrap, Home and End jump, other keys do not move', () => {
    assert.equal(PC.segmentedKeyMove('ArrowRight', 3, 4), 0, 'no wrap at the end');
    assert.equal(PC.segmentedKeyMove('ArrowLeft', 0, 4), 3, 'no wrap at the start');
    assert.equal(PC.segmentedKeyMove('Home', 2, 4), 0);
    assert.equal(PC.segmentedKeyMove('End', 1, 4), 3);
    // Returning the CURRENT index for an unhandled key is what lets the caller
    // tell "no move" from "moved to 0" — returning null for both is how Home
    // ends up doing nothing.
    assert.equal(PC.segmentedKeyMove('a', 2, 4), 2);
    assert.equal(PC.segmentedKeyMove('ArrowRight', 0, 0), 0, 'an empty control must not throw');
});

await check('a tinted track needs two stops or it is not a ramp', () => {
    assert.equal(PC.trackBackground(null), null);
    assert.equal(PC.trackBackground(['#fff']), null, 'one colour is not a gradient');
    assert.ok(PC.trackBackground(['#000', '#fff']).startsWith('linear-gradient(90deg,'));
});

await check('changed-from-default survives float drift', () => {
    assert.ok(PC.isDefault(0.1 + 0.2, 0.3), 'float drift read as a change');
    assert.ok(PC.isDefault('a', 'a'));
    assert.ok(!PC.isDefault(1, 0));
    assert.deepEqual(PC.changedKeys({ a: 1, b: 2, c: 3 }, { a: 1, b: 0 }), ['b']);
    assert.deepEqual(PC.changedKeys(null, { a: 1 }), []);
});

log('\n-- 4. The kit is one kit --');

await check('every control is exported and keyboard-reachable', () => {
    for (const name of ['PanelSection', 'ControlRow', 'Segmented', 'NumberField', 'Stepper',
        'TrackSlider', 'SwatchRow', 'SelectField', 'ToggleSwitch', 'ThumbGrid', 'DropField']) {
        assert.ok(new RegExp(`export const ${name} =`).test(kit), `no ${name}`);
    }
    // A styling pass that drops keyboard access is a regression in a nicer
    // coat, so the roles are pinned.
    for (const s of ['role="radiogroup"', 'role="radio"', 'role="switch"', 'aria-checked',
        'type="range"', 'aria-expanded', 'tabIndex']) {
        assert.ok(kit.includes(s), s);
    }
});

await check('the kit uses tokens, never a hard-coded theme colour', () => {
    // A hex in here would be a colour that does not follow the light theme.
    // #fff on the switch knob and the slider handle shadow are the deliberate
    // exceptions: a knob is white in both themes.
    const hexes = (kitCode.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(h => h.toLowerCase() !== '#fff' && h !== '#000000');
    assert.deepEqual(hexes, [], `hard-coded colours: ${hexes.join(', ')}`);
    assert.ok(/var\(--line\)/.test(kit) && /var\(--fg/.test(kit) && /var\(--r-xs\)/.test(kit));
});

await check('a number box does not eat what is being typed', () => {
    // type="number" reports a partially-typed value ("1." or "-") as empty, so
    // committing on every keystroke deletes it as the user types. The box
    // keeps a draft and commits on blur or Enter instead.
    assert.ok(/inputMode="decimal"/.test(kitCode), 'the number box is not a text box');
    assert.ok(!/type="number"/.test(kitCode), 'a type="number" box is back');
    assert.ok(/onBlur=\{\(e\) => commit\(e\.target\.value\)\}/.test(kitCode), 'nothing commits the draft');
    assert.ok(/'Escape'/.test(kitCode), 'Escape cannot abandon a draft');
});

log(failures ? `\n${failures} FAILURES` : '\nALL STYLES + PANEL KIT TESTS PASSED');
process.exit(failures ? 1 : 0);
