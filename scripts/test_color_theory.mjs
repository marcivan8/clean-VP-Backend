// scripts/test_color_theory.mjs
//
// R103 round E — colour becomes knowledge the engine can reason with.
//
// Before this round the engine knew typography (a type scale), composition (a
// measured layout with safe zones), spacing and hierarchy — but colour was
// only ever a hand-picked PALETTE plus one contrast check in the validator,
// which fires on an explicit `backdropColor`. A FILLED accent never sets one,
// so nothing in the codebase compared a badge's fill with the text drawn on
// top of it.
//
// That gap shipped a real defect: CTAWidget/follow put #ffffff on #00E5FF,
// a contrast ratio of 1.54:1 where WCAG asks 3.0 for large type. Check 4 is
// the guard that stops it coming back — it walks every preset of every
// filled-accent component and compares what the composer actually chose for
// the text against what it actually chose for the fill.
//
// The rest pins the module's own contract: the colour maths is correct and
// round-trips, hue is preserved because hue is a brand decision, and the
// footage path's harmonisation falls back rather than inventing colour.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fsRead = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

const CT = await import('../client/src/motion/ColorTheory.js');
const SC = await import('../client/src/motion/SceneComposer.js');
const SV = await import('../client/src/motion/SceneValidator.js');
const CL = await import('../client/src/motion/ComponentLibrary.js');

log('\n── 1. The colour maths is right ──');

await check('every notation parses to the same triple', () => {
    for (const form of ['#f00', '#ff0000', 'rgb(255, 0, 0)', 'rgba(255,0,0,0.5)']) {
        assert.deepEqual(CT.parseColor(form), [255, 0, 0], `${form} parsed wrong`);
    }
    for (const junk of ['', null, undefined, 'red', '#gg0000', '#ff00']) {
        assert.equal(CT.parseColor(junk), null, `${junk} should not parse`);
    }
});

await check('hex → hsl → hex round-trips', () => {
    for (const hex of ['#00e5ff', '#ff3b5c', '#ffe500', '#c8a96a', '#0e0f11', '#ffffff', '#808080']) {
        const hsl = CT.toHsl(hex);
        assert.ok(hsl, `${hex} gave no hsl`);
        const back = CT.hslToHex(hsl.h, hsl.s, hsl.l);
        assert.equal(back, hex, `${hex} came back as ${back}`);
    }
});

await check('WCAG anchors are exact', () => {
    // The two values in the spec: black-on-white is 21:1, same-on-same is 1:1.
    assert.ok(Math.abs(CT.contrastRatio('#000000', '#ffffff') - 21) < 0.01, 'black on white is not 21:1');
    assert.ok(Math.abs(CT.contrastRatio('#00e5ff', '#00e5ff') - 1) < 0.001, 'a colour on itself is not 1:1');
    assert.equal(CT.luminance('#000000'), 0, 'black is not luminance 0');
    assert.ok(Math.abs(CT.luminance('#ffffff') - 1) < 1e-9, 'white is not luminance 1');
    assert.equal(CT.contrastRatio('not a colour', '#fff'), null, 'unparseable input should give null, not a number');
    assert.deepEqual(
        { large: CT.CONTRAST.large, body: CT.CONTRAST.body, strong: CT.CONTRAST.strong },
        { large: 3, body: 4.5, strong: 7 },
        'the WCAG thresholds drifted',
    );
});

log('\n── 2. Harmony rotates hue and nothing else ──');

await check('the classic relationships land on the right hues', () => {
    const h = CT.harmonies('#00e5ff'); // cyan, hue ~187
    const base = CT.toHsl('#00e5ff').h;
    assert.ok(Math.abs(CT.hueDistance('#00e5ff', h.complementary) - 180) < 1.5, 'complementary is not opposite');
    for (const a of h.analogous) assert.ok(Math.abs(CT.hueDistance('#00e5ff', a) - 30) < 1.5, 'analogous is not 30° away');
    for (const t of h.triadic) assert.ok(Math.abs(CT.hueDistance('#00e5ff', t) - 120) < 1.5, 'triadic is not 120° away');
    for (const s of h.splitComplementary) assert.ok(Math.abs(CT.hueDistance('#00e5ff', s) - 150) < 1.5, 'split-complementary is not 150° away');
    // Saturation and lightness are the look's, not the harmony's, to change.
    for (const derived of [h.complementary, ...h.analogous, ...h.triadic]) {
        const d = CT.toHsl(derived);
        assert.ok(Math.abs(d.s - CT.toHsl('#00e5ff').s) < 0.02, `${derived} changed saturation`);
        assert.ok(Math.abs(d.l - CT.toHsl('#00e5ff').l) < 0.02, `${derived} changed lightness`);
    }
    assert.ok(base > 180 && base < 195, `cyan read as hue ${base}`);
});

await check('hue distance is the short way round the wheel', () => {
    assert.ok(CT.hueDistance('#ff0000', '#ff0000') < 0.01, 'a colour is not 0° from itself');
    assert.ok(Math.abs(CT.hueDistance('#ff0000', '#00ff00') - 120) < 1, 'red to green is not 120°');
    // 350° and 10° are 20° apart, not 340°.
    assert.ok(CT.hueDistance(CT.hslToHex(350, 1, 0.5), CT.hslToHex(10, 1, 0.5)) < 21, 'distance went the long way round');
    assert.equal(CT.hueDistance('nonsense', '#fff'), null, 'unparseable input should give null');
});

log('\n── 3. ensureContrast reaches the target without losing the brand ──');

await check('a colour already readable is returned untouched', () => {
    assert.equal(CT.ensureContrast('#ffffff', '#0e0f11'), '#ffffff', 'white on near-black was altered for no reason');
});

await check('chromatic text keeps its hue while gaining contrast', () => {
    // A brand colour must stay recognisably itself: lightness moves, hue does not.
    const brand = '#C8A96A';
    const fixed = CT.ensureContrast(brand, '#D9CBB0', CT.CONTRAST.body);
    assert.ok(CT.contrastRatio(fixed, '#D9CBB0') >= CT.CONTRAST.body, `only reached ${CT.contrastRatio(fixed, '#D9CBB0')}`);
    assert.ok(CT.hueDistance(fixed, brand) < 3, `hue moved ${CT.hueDistance(fixed, brand)}° — the brand colour stopped being itself`);
});

await check('achromatic text flips to ink or paper, not to a mid grey', () => {
    // The defect this branch exists for: walking white's lightness down
    // reached the 3:1 target at #737373 (3.08:1) — a number that passes and
    // a badge that looks washed out. Near-black is the call a designer makes.
    const onCyan = CT.ensureContrast('#ffffff', '#00E5FF', CT.CONTRAST.large);
    assert.ok(CT.contrastRatio(onCyan, '#00E5FF') > 8, `only reached ${CT.contrastRatio(onCyan, '#00E5FF').toFixed(2)}:1 — still scraping the threshold`);
    assert.ok(CT.toHsl(onCyan).l < 0.2, `${onCyan} is not near-black`);
    // And the other way: on a near-black fill, white stays white.
    assert.equal(CT.ensureContrast('#ffffff', '#111111', CT.CONTRAST.large), '#ffffff');
    assert.equal(CT.ensureContrast('#1a1a1a', '#0e0f11', CT.CONTRAST.large), '#ffffff', 'dark grey on near-black should flip to paper');
});

await check('an unreachable target returns the most readable attempt, not the original', () => {
    // Nothing reaches 7:1 against a mid grey. The caller still has to draw
    // something, so it gets the best option rather than the broken one.
    const best = CT.ensureContrast('#8a8a8a', '#808080', CT.CONTRAST.strong);
    assert.ok(CT.contrastRatio(best, '#808080') > CT.contrastRatio('#8a8a8a', '#808080'), 'gave back the unreadable original');
});

await check('unparseable input is passed through rather than guessed at', () => {
    assert.equal(CT.ensureContrast('not a colour', '#fff'), 'not a colour');
    assert.equal(CT.ensureContrast('#fff', 'not a colour'), '#fff');
});

log('\n── 4. The shipped defect: text on a filled accent ──');

// The guard, stated behaviourally rather than by inspecting LOOKS: build
// every preset of every composed component, find the accents the composer
// actually FILLED, and compare them with the text colour it actually chose.
// A new component with a filled plate is covered the day it is added.
const filledPairs = () => {
    const rows = [];
    for (const id of SC.COMPOSED_COMPONENTS) {
        for (const preset of Object.keys(SC.LOOKS[id] || {})) {
            for (const aspect of ['9:16', '16:9']) {
                const out = CL.buildComponent(
                    id, preset,
                    { duration: 3, text: 'Follow for part two', quote: 'It changed how I think', label: 'SUBSCRIBE', value: '92%' },
                    { aspectRatio: aspect, safeZone: SV.safeZoneForAspect(aspect) },
                );
                if (!out || !out.placements) continue;
                const fills = out.placements
                    .filter(p => p.clip?.template?.params?.fill === true)
                    .map(p => p.clip.template.params.color);
                if (!fills.length) continue;
                for (const fill of fills) {
                    for (const p of out.placements.filter(p => p.trackType === 'text')) {
                        rows.push({ id, preset, aspect, fill, text: p.clip.color, ratio: CT.contrastRatio(p.clip.color, fill) });
                    }
                }
            }
        }
    }
    return rows;
};

await check('at least one component really does draw a filled accent', () => {
    // If this ever goes to zero the check below becomes vacuous, which is a
    // worse failure than a red test: it passes while guarding nothing.
    const rows = filledPairs();
    assert.ok(rows.length >= 4, `only ${rows.length} filled-accent/text pairs found — the guard below has nothing to check`);
});

await check('no preset draws text below 3:1 on its own filled accent', () => {
    const bad = filledPairs().filter(r => !(r.ratio >= CT.CONTRAST.large));
    const show = bad.map(r => `${r.id}/${r.preset} ${r.aspect}: ${r.text} on ${r.fill} = ${(r.ratio ?? 0).toFixed(2)}:1`).join('\n      ');
    assert.equal(bad.length, 0, `illegible filled accents:\n      ${show}`);
});

await check('the specific regression — CTAWidget/follow is no longer 1.54:1', () => {
    const out = CL.buildComponent('CTAWidget', 'follow', { duration: 3 }, { aspectRatio: '9:16', safeZone: SV.safeZoneForAspect('9:16') });
    const label = out.placements.find(p => p.trackType === 'text').clip;
    const fill = out.placements.find(p => p.clip?.template?.params?.fill === true).clip.template.params.color;
    assert.equal(fill, '#00E5FF', 'the preset no longer uses the accent this check was written for');
    assert.notEqual(label.color, '#ffffff', 'the label is white on cyan again');
    assert.ok(CT.contrastRatio(label.color, fill) > 8, `${label.color} on ${fill} is only ${CT.contrastRatio(label.color, fill).toFixed(2)}:1`);
});

log('\n── 5. The footage path harmonises instead of trusting the pixels ──');

await check('no suggestion means the look keeps its palette, with a reason', () => {
    const tone = { text: '#ffffff', sub: '#E2E8F0', accent: '#FFE500' };
    const out = CT.harmonisePalette(null, tone);
    assert.equal(out.text, tone.text);
    assert.equal(out.accent, tone.accent);
    assert.ok(out.notes.length === 1 && /no colour was read/i.test(out.notes[0]), `notes were ${JSON.stringify(out.notes)}`);
});

await check('a usable suggestion wins on hue', () => {
    const tone = { text: '#ffffff', sub: '#E2E8F0', accent: '#FFE500' };
    const out = CT.harmonisePalette({ text: '#F5EFE3', sub: '#D9CBB0', accent: '#C8A96A' }, tone);
    assert.equal(out.accent, '#C8A96A', 'the sampled accent was discarded');
    assert.equal(out.text, '#F5EFE3');
});

await check('an accent too close to the text hue moves to its complementary', () => {
    // paletteFromPixels takes the most saturated hue bin of a frame, so this
    // happens whenever the shot is dominated by the same colour as the type.
    const tone = { text: '#ffffff', sub: '#E2E8F0', accent: '#FFE500' };
    const out = CT.harmonisePalette({ text: '#FF3B5C', sub: '#ffffff', accent: '#FF5A4A' }, tone);
    assert.ok(CT.hueDistance(out.accent, out.text) >= 25, `accent ${out.accent} is still ${CT.hueDistance(out.accent, out.text)}° from the text`);
    assert.ok(out.notes.some(n => /complementary/i.test(n)), `no note explained the move: ${JSON.stringify(out.notes)}`);
});

await check('a legitimate monochromatic palette is left alone', () => {
    // The first version of this rule flipped any accent within 25° of the
    // text hue, which destroyed the editorial look: gold #C8A96A under cream
    // #F5EFE3 is 0.2° apart in hue and obviously two colours — lightness
    // separates them (1.96:1). Hue proximity alone is not a defect.
    const tone = { text: '#ffffff', sub: '#E2E8F0', accent: '#FFE500' };
    const out = CT.harmonisePalette({ text: '#F5EFE3', sub: '#D9CBB0', accent: '#C8A96A' }, tone);
    assert.equal(out.accent, '#C8A96A', 'a monochromatic pairing was overridden');
    assert.ok(!out.notes.some(n => /complementary/i.test(n)), 'it claimed to have moved the accent');
});

await check('hue is not measured against achromatic type', () => {
    // White has no hue, so a hue distance from it is whatever the accent's
    // own hue happens to be — a coin toss, not a judgement.
    const tone = { text: '#ffffff', sub: '#E2E8F0', accent: '#FFE500' };
    for (const accent of ['#00E5FF', '#FF3B5C', '#C8A96A']) {
        const out = CT.harmonisePalette({ text: '#ffffff', sub: '#E2E8F0', accent }, tone);
        assert.equal(out.accent, accent, `${accent} was moved because white's hue read as 0`);
    }
});

await check('text on the harmonised accent is readable, and says so', () => {
    const tone = { text: '#ffffff', sub: '#E2E8F0', accent: '#FFE500' };
    const out = CT.harmonisePalette({ text: '#ffffff', sub: '#E2E8F0', accent: '#00E5FF' }, tone);
    assert.ok(CT.contrastRatio(out.onAccent, out.accent) >= CT.CONTRAST.large, `onAccent ${out.onAccent} fails against ${out.accent}`);
    assert.ok(out.notes.some(n => /readable/i.test(n)), `no note recorded the adjustment: ${JSON.stringify(out.notes)}`);
});

await check('garbage fields fall back field-by-field rather than failing whole', () => {
    const tone = { text: '#ffffff', sub: '#E2E8F0', accent: '#FFE500' };
    const out = CT.harmonisePalette({ text: 'chartreuse-ish', sub: null, accent: '#C8A96A' }, tone);
    assert.equal(out.text, tone.text, 'an unparseable text colour should fall back to the look');
    assert.equal(out.sub, tone.sub);
    assert.equal(out.accent, '#C8A96A', 'the one good field was thrown away with the bad ones');
});

log('\n── 6. One home for the colour maths ──');

await check('SceneValidator still exports the contrast helpers it used to own', () => {
    // It moved them to ColorTheory and re-exports; a consumer that imported
    // them from the validator must not notice. `export … from` would not
    // have created the local bindings the default-export object needs, so
    // this also pins that the module still loads at all.
    assert.equal(typeof SV.contrastRatio, 'function', 'SceneValidator.contrastRatio is gone');
    assert.equal(typeof SV.luminance, 'function', 'SceneValidator.luminance is gone');
    assert.ok(Math.abs(SV.contrastRatio('#000', '#fff') - CT.contrastRatio('#000', '#fff')) < 1e-9, 'the two now disagree');
    assert.equal(SV.luminance('#ffffff'), CT.luminance('#ffffff'));
});

await check('the formulas exist once, not twice', () => {
    // The drift class this codebase keeps counting: a second copy of a
    // formula that silently diverges. ColorTheory is the only definition.
    const src = fsRead('client/src/motion/SceneValidator.js');
    assert.ok(/from '\.\/ColorTheory\.js'/.test(src), 'the validator no longer imports the colour module');
    assert.ok(!/0\.2126/.test(src), 'the validator has its own luminance coefficients again');
});

log(failures === 0 ? '\n✅ colour theory: all checks passed\n' : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
