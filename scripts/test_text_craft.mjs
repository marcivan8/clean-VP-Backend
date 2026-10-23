// scripts/test_text_craft.mjs
//
// R107 — text-motion craft rules.
//
// The motion library says what a beat should DO. These checks are about the
// other list: the few ways animated text goes wrong even when the verb and
// the timing are right. Each rule is a measurement, so each one is testable.
//
// The load-bearing check in here is `the slot never moves`: it draws the
// same word-cycle at three different times and asserts the prefix and the
// word start at the same x every time. That is the whole difference between
// the device looking made and looking generated, and it is the kind of
// defect no unit test on the timing would ever catch.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fsRead = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

const TC = await import('../client/src/motion/TextCraft.js');
const TG = await import('../client/src/motion/TemplateGraphics.js');
const SV = await import('../client/src/motion/SceneValidator.js');
const SS = await import('../client/src/motion/SceneSchema.js');
const TM = await import('../client/src/motion/TextMeasurement.js');
const CT = await import('../client/src/motion/ColorTheory.js');
const CC = await import('../client/src/motion/CaptionCompiler.js');
const { createRequire } = await import('module');
const requireCjs = createRequire(import.meta.url);
const raster = () => requireCjs(path.join(ROOT, 'server/compositor/RasterCaptionCompiler.js'));
/** A time map where output time equals timeline time, so states read directly. */
const identityMap = (duration) => ({
    segments: [{ timelineStart: 0, timelineEnd: duration, outputStart: 0, outputEnd: duration }],
    totalDuration: duration,
});

log('\n── 1. The caret ramps instead of toggling ──');

await check('solid while the line is still arriving', () => {
    for (const t of [0, 0.1, 0.26, 0.4, 1.7]) {
        assert.equal(TC.caretOpacity(t, { typing: true }), 1, `t=${t}`);
    }
});

await check('full at the start of a cycle, dimmest at the half', () => {
    assert.ok(Math.abs(TC.caretOpacity(0) - 1) < 1e-9, 'start');
    const mid = TC.caretOpacity(TC.CARET_PERIOD_S / 2);
    assert.ok(Math.abs(mid - TC.CARET_MIN_ALPHA) < 1e-9, `half was ${mid}`);
    assert.ok(Math.abs(TC.caretOpacity(TC.CARET_PERIOD_S) - 1) < 1e-9, 'end of cycle');
});

await check('never reaches zero — a caret that vanishes looks lost', () => {
    for (let t = 0; t < 2; t += 0.01) {
        assert.ok(TC.caretOpacity(t) >= TC.CARET_MIN_ALPHA - 1e-9, `t=${t.toFixed(2)}`);
    }
});

await check('monotone down then up, with no jump between frames', () => {
    // The symptom being guarded against is a step: at 30 fps no two
    // consecutive frames may differ by more than one ramp step.
    const step = 1 / 30;
    const maxDelta = (1 - TC.CARET_MIN_ALPHA) / ((TC.CARET_PERIOD_S / 2) / step) + 1e-6;
    let prev = TC.caretOpacity(0);
    for (let t = step; t < 3; t += step) {
        const v = TC.caretOpacity(t);
        assert.ok(Math.abs(v - prev) <= maxDelta, `jump of ${Math.abs(v - prev).toFixed(3)} at t=${t.toFixed(3)}`);
        prev = v;
    }
});

await check('periodic — the same alpha one cycle later', () => {
    for (const t of [0.07, 0.19, 0.33, 0.48]) {
        assert.ok(Math.abs(TC.caretOpacity(t) - TC.caretOpacity(t + TC.CARET_PERIOD_S)) < 1e-9, `t=${t}`);
    }
});

log('\n── 2. The constants cannot drift ──');

await check('TextCraft is pure, so every consumer can import it', () => {
    // The rules are arithmetic. Keeping the module free of imports is what
    // lets TemplateGraphics use it on both paths — Vite in the browser and
    // the dynamic import() in server/compositor/TemplateRenderer.js — instead
    // of each path keeping its own copy of the numbers.
    const src = fsRead('client/src/motion/TextCraft.js');
    assert.ok(!/^\s*import\s/m.test(src), 'TextCraft gained an import');
});

await check('TemplateGraphics keeps no copy of the numbers', () => {
    const src = fsRead('client/src/motion/TemplateGraphics.js');
    assert.ok(/from '\.\/TextCraft\.js'/.test(src), 'it does not import the rulebook');
    assert.ok(!/const CRAFT_[A-Z_]+ = [0-9.]/.test(src), 'a copied constant came back');
});

await check('the old toggle is gone from the typing graphic', () => {
    const src = fsRead('client/src/motion/TemplateGraphics.js');
    assert.ok(!/Math\.floor\(t \* 2\) % 2 === 0/.test(src), 'the frame-boundary blink is still there');
    assert.ok(/caretOpacity\(t, \{ typing \}\)/.test(src), 'the caret no longer goes through caretOpacity');
});

log('\n── 3. A swap slot is sized from the widest word ──');

await check('picks the widest alternative, not the first or the last', () => {
    const r = TM.reserveSlotWidth(['Ads', 'Shorts', 'Documentaries', 'Reels'], { fontSize: 80 });
    assert.equal(r.widest, 'Documentaries');
    assert.ok(r.width > Math.max(...r.widths), 'the pad was not applied');
    assert.ok(Math.abs(r.width - Math.max(...r.widths) * (1 + TC.SWAP_SLOT_PAD)) < 1e-6, 'the pad is not the one in the rulebook');
});

await check('empty or junk input measures to nothing rather than throwing', () => {
    for (const input of [null, undefined, [], ['', '  '], 'not an array']) {
        const r = TM.reserveSlotWidth(input, { fontSize: 80 });
        assert.equal(r.width, 0);
        assert.equal(r.widest, '');
    }
});

await check('widestIndex is honest about nothing to compare', () => {
    assert.equal(TC.widestIndex([]), -1);
    assert.equal(TC.widestIndex(null), -1);
    assert.equal(TC.widestIndex([NaN, NaN]), -1);
    assert.equal(TC.widestIndex([3, 9, 4]), 1);
});

log('\n── 4. A swap overlaps; a highlight blends ──');

await check('crossfade weights always sum to one', () => {
    for (let t = -0.3; t < 1; t += 0.017) {
        const w = TC.crossfadeWeights(t, 0.2, 0.22);
        assert.ok(Math.abs((w.out + w.in) - 1) < 1e-9, `t=${t.toFixed(3)}`);
        assert.ok(w.in >= 0 && w.in <= 1 && w.out >= 0 && w.out <= 1, `out of range at t=${t.toFixed(3)}`);
    }
});

await check('crossfade is fully handed over by the end, not before', () => {
    assert.equal(TC.crossfadeWeights(0.2, 0.2).in, 0);
    assert.equal(TC.crossfadeWeights(0.2 + TC.SWAP_CROSSFADE_S, 0.2).in, 1);
    assert.ok(TC.crossfadeWeights(0.2 + TC.SWAP_CROSSFADE_S / 2, 0.2).in > 0.4);
});

await check('the highlight ramp is a blend, never two states', () => {
    const seen = new Set();
    for (let t = 0; t <= TC.HIGHLIGHT_RAMP_S; t += TC.HIGHLIGHT_RAMP_S / 12) {
        seen.add(TC.highlightRamp(t, 0).toFixed(4));
    }
    assert.ok(seen.size >= 10, `only ${seen.size} distinct values — this is a switch, not a ramp`);
    assert.equal(TC.highlightRamp(0, 0), 0);
    assert.equal(TC.highlightRamp(5, 0), 1);
    // Front-loaded: the word must be legibly highlighted before the ramp ends.
    assert.ok(TC.highlightRamp(TC.HIGHLIGHT_RAMP_S / 2, 0) > 0.8, 'the ramp is back-loaded');
});

log('\n── 4b. The highlight ramp, and the parity that makes it shippable ──');

await check('the span is a quarter of the dwell, floored and capped', () => {
    assert.equal(TC.highlightRampSpan(2), TC.HIGHLIGHT_RAMP_S, 'a long hold should get the full ramp');
    assert.ok(Math.abs(TC.highlightRampSpan(0.4) - 0.1) < 1e-9, '0.4s word');
    assert.equal(TC.highlightRampSpan(0.08), 0.05, 'a very short word is floored at one frame-and-a-half');
    assert.equal(TC.highlightRampSpan(0), TC.HIGHLIGHT_RAMP_S, 'no dwell means a keyword that holds');
});

await check('the ramp never lags the word it marks', () => {
    // A highlight that is fully OFF on the first frame of its own word is a
    // worse artefact than the pop this replaces.
    assert.ok(TC.HIGHLIGHT_MIX_STEPS[0] > 0.2, `first step is ${TC.HIGHLIGHT_MIX_STEPS[0]}`);
    assert.equal(TC.highlightMixAt(1.0, 1.0, 0.4), TC.HIGHLIGHT_MIX_STEPS[0]);
    assert.equal(TC.highlightMixAt(0.99, 1.0, 0.4), 0, 'before its word it must be off');
});

await check('it is fully on by the end of the span and stays on', () => {
    const start = 1, dwell = 0.4;
    const span = TC.highlightRampSpan(dwell);
    assert.equal(TC.highlightMixAt(start + span, start, dwell), 1);
    assert.equal(TC.highlightMixAt(start + dwell, start, dwell), 1);
});

await check('it is a step function — every value is one of the declared steps', () => {
    const seen = new Set();
    for (let t = 1; t < 1.4; t += 0.004) seen.add(TC.highlightMixAt(t, 1, 0.4));
    for (const v of seen) {
        assert.ok(TC.HIGHLIGHT_MIX_STEPS.includes(v), `${v} is not a declared step`);
    }
    assert.equal(seen.size, TC.HIGHLIGHT_MIX_STEPS.length, `saw ${seen.size} of ${TC.HIGHLIGHT_MIX_STEPS.length} steps`);
});

await check('every step change has a breakpoint the export can sample', () => {
    // This is the parity contract: the export renders one image per step, so
    // the step boundaries must be exactly the times it is told to sample.
    const start = 1.2, dwell = 0.5;
    const breaks = TC.highlightBreakpoints(start, dwell);
    assert.equal(breaks.length, TC.HIGHLIGHT_MIX_STEPS.length);
    for (let i = 0; i < breaks.length; i += 1) {
        assert.equal(TC.highlightMixAt(breaks[i], start, dwell), TC.HIGHLIGHT_MIX_STEPS[i], `step ${i}`);
        // And just before a breakpoint the value is still the previous step.
        if (i > 0) {
            assert.equal(TC.highlightMixAt(breaks[i] - 1e-4, start, dwell), TC.HIGHLIGHT_MIX_STEPS[i - 1], `before step ${i}`);
        }
    }
});

await check('the compiled word states carry the same mix the preview would read', () => {
    // CaptionCompiler is what the export consumes. If its runs disagree with
    // highlightMixAt, the highlight eases in the preview and steps wrongly in
    // the file — the divergence class this round exists to avoid.
    const words = [
        { text: 'Make', start: 0.0, end: 0.4 },
        { text: 'it', start: 0.4, end: 0.7 },
        { text: 'land', start: 0.7, end: 1.4 },
    ];
    const clip = {
        id: 'c1', type: 'text', content: 'Make it land',
        startTime: 0, duration: 1.4, color: '#ffffff',
        words,
        captionStyle: { packId: 'hormozi', wordHighlight: { mode: 'color', color: '#FFE500', scale: 1.08 } },
    };
    const states = CC.buildWordStates(clip, { startTime: 0, duration: 1.4 }, identityMap(1.4), 3, clip.captionStyle.wordHighlight);
    assert.ok(states.length > words.length, `only ${states.length} states for ${words.length} words — the ramp was not sampled`);
    for (const st of states) {
        assert.ok(TC.HIGHLIGHT_MIX_STEPS.includes(st.mix) || st.mix === 1, `state mix ${st.mix} is not a step`);
        if (st.active >= 0) {
            const w = words[st.active];
            // Read the state in its own middle: that is the value the export
            // renders for the whole run, and the preview must agree there.
            const mid = (st.from + st.to) / 2;
            assert.equal(st.mix, TC.highlightMixAt(mid, w.start, w.end - w.start),
                `state [${st.from}, ${st.to}) on "${w.text}" disagrees with the preview`);
        }
    }
});

await check('the extra images are bounded — at most one per step per word', () => {
    const words = [];
    for (let i = 0; i < 8; i += 1) words.push({ text: `w${i}`, start: i * 0.4, end: (i + 1) * 0.4 });
    const clip = {
        id: 'c2', type: 'text', content: words.map(w => w.text).join(' '),
        startTime: 0, duration: 3.2, color: '#ffffff', words,
        captionStyle: { wordHighlight: { mode: 'color', color: '#FFE500', scale: 1.08 } },
    };
    const states = CC.buildWordStates(clip, { startTime: 0, duration: 3.2 }, identityMap(3.2), words.length, clip.captionStyle.wordHighlight);
    const distinct = new Set(states.map(s => `${s.shown}|${s.active}|${s.mix}`)).size;
    // The claim being protected is that the cost scales with STEPS PER WORD,
    // not with frames: a continuous ramp would need one image per frame.
    const ceiling = words.length * (TC.HIGHLIGHT_MIX_STEPS.length + 1);
    const frames = Math.round(3.2 * 30);
    assert.ok(distinct <= ceiling, `${distinct} distinct images for ${words.length} words (ceiling ${ceiling})`);
    assert.ok(distinct < frames / 2, `${distinct} images for ${frames} frames is not a step function`);
});

await check('the export keys its images by mix, or the ramp never reaches the screen', () => {
    // Two steps of one ramp differ ONLY in mix. A dedupe key without it
    // collapses them into one image and the ffconcat shows the first for the
    // whole word — the ramp would be computed, carried, and then dropped.
    const src = fsRead('server/compositor/RasterCaptionCompiler.js');
    const m = src.match(/const stateKey = \(st\) => `([^`]+)`/);
    assert.ok(m, 'there is no single stateKey');
    assert.ok(/st\.mix/.test(m[1]), `the key does not include mix: ${m[1]}`);
    assert.ok(!/files\.get\(`\$\{st\.shown\}/.test(src), 'a hand-built key bypasses stateKey');
});

await check('preview and export blend colours identically', () => {
    // RasterCaptionCompiler is CommonJS and cannot require ColorTheory, so it
    // mirrors it. This is the check that the mirror is a mirror.
    const RC = raster();
    for (const [a, b] of [['#ffffff', '#FFE500'], ['#000000', '#00E5FF'], ['#123456', '#abcdef'], ['rgb(10,20,30)', '#ffffff']]) {
        for (const p of [0, ...TC.HIGHLIGHT_MIX_STEPS, 1]) {
            assert.equal(RC.mixColor(a, b, p).toLowerCase(), CT.mixColor(a, b, p).toLowerCase(), `${a} → ${b} @ ${p}`);
        }
    }
    for (const p of [0, 0.35, 0.72, 1]) {
        assert.equal(RC.withAlpha('#FFE500', p), CT.withAlpha('#FFE500', p), `alpha @ ${p}`);
    }
    // Both must be honest about an unparseable colour rather than going black.
    assert.equal(CT.mixColor('nonsense', '#FFE500', 0.5), '#FFE500');
    assert.equal(RC.mixColor('nonsense', '#FFE500', 0.5), '#FFE500');
    assert.equal(CT.withAlpha('nonsense', 0.5), null);
});

await check('a program compiled before this round still renders a full highlight', () => {
    // Older caption programs have no `mix` on their word states. Reading that
    // as 0 would silently un-highlight every caption in an existing project.
    const RC = raster();
    const look = RC.wordLook(1, { shown: 3, active: 1 }, {
        highlight: { mode: 'color', color: '#FFE500', scale: 1.1 },
        emphasis: null,
    }, '#ffffff');
    assert.equal(look.color.toLowerCase(), '#ffe500');
    assert.ok(Math.abs(look.scale - 1.1) < 1e-9);
});

await check('at mix 0 the word is left exactly as it was', () => {
    const RC = raster();
    const look = RC.wordLook(1, { shown: 3, active: 1, mix: 0 }, {
        highlight: { mode: 'box', color: '#111827', background: '#FFE500', scale: 1.1 },
        emphasis: null,
    }, '#ffffff');
    assert.equal(look.color.toLowerCase(), '#ffffff', 'the colour moved at mix 0');
    assert.equal(look.scale, 1, 'the scale moved at mix 0');
    assert.ok(/rgba\(255, 229, 0, 0\)/.test(look.background), `the box is not transparent at mix 0: ${look.background}`);
});

log('\n── 5. Words that cannot be read are dropped, not rushed ──');

await check('an even share when no dwell is asked for', () => {
    const plan = TC.planWordCycle(['a', 'b', 'c'], 3);
    assert.ok(Math.abs(plan.dwell - 1) < 1e-9);
    assert.equal(plan.steps.length, 3);
    assert.ok(plan.fits);
});

await check('four words in one second does not fit, and says how many do', () => {
    const plan = TC.planWordCycle(['a', 'b', 'c', 'd'], 1);
    assert.equal(plan.fits, false);
    assert.equal(plan.advised, Math.floor(1 / TC.MIN_SWAP_DWELL_S));
    assert.ok(plan.advised >= 1, 'advised must never be zero');
});

await check('one word always fits — there is nothing to swap', () => {
    assert.equal(TC.planWordCycle(['only'], 0.2).fits, true);
});

await check('the last word does not swap out; the layer exit takes it', () => {
    const plan = TC.planWordCycle(['a', 'b', 'c'], 3);
    assert.equal(plan.steps[2].swapAt, null);
    assert.ok(plan.steps[0].swapAt < plan.steps[0].until, 'the swap must start before the dwell ends');
    assert.ok(plan.steps[0].swapAt > plan.steps[0].at, 'the swap must not start before the word is shown');
});

log('\n── 6. The audit reads a scene, and stays quiet when it cannot ──');

const node = (over = {}) => ({ id: 'n1', name: 'line', duration: 3, animations: [], ...over });

await check('a reveal still running into the exit is reported', () => {
    const found = TC.auditScene([node({
        animations: [
            { type: 'reveal', presetId: 'composed:typewriter', startTime: 0, duration: 2.8 },
            { presetId: 'composed:fade-out', anchor: 'out', startTime: 0, duration: 0.4 },
        ],
    })]);
    assert.equal(found.filter(f => f.rule === 'read-hold').length, 1, JSON.stringify(found));
});

await check('a reveal with room to be read is not reported', () => {
    const found = TC.auditScene([node({
        duration: 4,
        animations: [
            { type: 'reveal', presetId: 'composed:typewriter', startTime: 0, duration: 1.2 },
            { presetId: 'composed:fade-out', anchor: 'out', startTime: 0, duration: 0.4 },
        ],
    })]);
    assert.equal(found.length, 0, JSON.stringify(found));
});

await check('an out-anchored animation is not read as a reveal', () => {
    // On the out anchor a larger startTime means EARLIER (see MotionResolver).
    // Treating one as a forward reveal would read its timing backwards.
    const found = TC.auditScene([node({
        animations: [{ type: 'reveal', anchor: 'out', startTime: 2.5, duration: 0.5 }],
    })]);
    assert.equal(found.length, 0, JSON.stringify(found));
});

await check('a cycling slot with no reserved width is reported once', () => {
    const found = TC.auditScene([node({ alternatives: ['Reels', 'Shorts', 'TikTok'] })]);
    assert.equal(found.filter(f => f.rule === 'swap-slot-reserved').length, 1);
});

await check('a reserved slot is accepted', () => {
    const found = TC.auditScene([node({ alternatives: ['Reels', 'Shorts'], slotWidth: 420 })]);
    assert.equal(found.filter(f => f.rule === 'swap-slot-reserved').length, 0);
});

await check('too many words for the time is reported with the count that fits', () => {
    const found = TC.auditScene([node({ duration: 1, slotWidth: 300, alternatives: ['a', 'b', 'c', 'd'] })]);
    const hit = found.find(f => f.rule === 'swap-dwell');
    assert.ok(hit, JSON.stringify(found));
    assert.ok(/word\(s\) fit/.test(hit.detail), hit.detail);
});

await check('a single alternative is not a cycle', () => {
    assert.equal(TC.auditScene([node({ alternatives: ['Reels'] })]).length, 0);
});

await check('nothing to measure means nothing to say', () => {
    for (const input of [null, undefined, [], {}, { nodes: null }, [null, 'x', 7]]) {
        assert.deepEqual(TC.auditScene(input), []);
    }
    // A layer with no duration is a different rule's problem (ZERO_DURATION).
    assert.deepEqual(TC.auditScene([{ id: 'x', alternatives: ['a', 'b'], slotWidth: 10 }]), []);
});

await check('every checkable rule has a detector, and every rule has a reason', () => {
    for (const rule of TC.TEXT_CRAFT_RULES) {
        assert.ok(rule.id && rule.defect && rule.rule && rule.why, `${rule.id}: incomplete`);
        assert.ok(TC.ruleById(rule.id) === rule, `${rule.id}: not retrievable`);
    }
    assert.equal(TC.ruleById('no-such-rule'), null);
});

log('\n── 7. The validator carries the craft rules ──');

await check('validateScene warns on a reveal with no hold', () => {
    const scene = SS.createScene({
        id: 'r107-scene',
        frame: { w: 1080, h: 1920 },
        duration: 3,
        nodes: [SS.createNode('text', {
            id: 'n1',
            name: 'line',
            content: 'A claim that needs reading',
            start: 0,
            duration: 3,
            style: { fontSize: 80, fontFamily: 'Inter', color: '#ffffff' },
            animations: [
                { type: 'reveal', presetId: 'composed:typewriter', startTime: 0, duration: 2.8 },
                { type: 'fade', presetId: 'composed:fade-out', anchor: 'out', startTime: 0, duration: 0.4 },
            ],
        })],
    });
    const res = SV.validateScene(scene, { skipCollisions: true });
    assert.equal(res.shapeErrors.length, 0, res.shapeErrors.join('; '));
    const hit = res.issues.find(i => i.code === SV.ISSUE_CODES.READ_HOLD);
    assert.ok(hit, res.issues.map(i => i.code).join(', '));
    assert.equal(hit.severity, 'warn', 'a layer that renders wrong is a warning, not an error');
    assert.ok(/never read|read/i.test(hit.message) || hit.message.length > 20, hit.message);
});

await check('retiming and dropping words stay design choices, not auto-fixes', () => {
    for (const code of [SV.ISSUE_CODES.READ_HOLD, SV.ISSUE_CODES.SWAP_DWELL]) {
        assert.ok(code, 'missing code');
        assert.ok(!SV.AUTO_FIXABLE.includes(code), `${code} claims to be auto-fixable, but shortening a reveal or dropping a word changes the design`);
    }
    assert.ok(SV.AUTO_FIXABLE.includes(SV.ISSUE_CODES.SWAP_SLOT_UNRESERVED), 'reserving the slot is arithmetic and should be fixed for the caller');
});

await check('autoFixScene reserves the slot from the widest alternative', () => {
    const scene = SS.createScene({
        id: 'r107-slot',
        frame: { w: 1080, h: 1920 },
        duration: 4.5,
        nodes: [SS.createNode('text', {
            id: 'slot',
            name: 'platforms',
            content: 'Reels',
            start: 0,
            duration: 4.5,
            style: { fontSize: 80, fontFamily: 'Inter', color: '#ffffff' },
            alternatives: ['Ads', 'Documentaries', 'Reels'],
            animations: [],
        })],
    });
    const res = SV.autoFixScene(scene, { skipCollisions: true });
    const fixed = res.scene.nodes.find(n => n.id === 'slot');
    assert.ok(fixed.slotWidth > 0, 'no slot width was reserved');
    const widest = TM.reserveSlotWidth(['Ads', 'Documentaries', 'Reels'], { fontSize: 80, fontFamily: 'Inter' });
    assert.equal(fixed.slotWidth, Math.ceil(widest.width));
    assert.ok(res.fixes.some(f => f.code === SV.ISSUE_CODES.SWAP_SLOT_UNRESERVED), JSON.stringify(res.fixes));
    // And the report no longer carries the issue it just fixed.
    assert.ok(!res.issues.some(i => i.code === SV.ISSUE_CODES.SWAP_SLOT_UNRESERVED), 'the fix did not clear the issue');
});

log('\n── 8. The cycling slot is drawn, and the slot never moves ──');

/** A canvas stub: proportional text metrics, and a log of what was drawn. */
function stubCtx() {
    const calls = [];
    let font = '16px X';
    const noop = () => {};
    return {
        calls,
        globalAlpha: 1,
        fillStyle: '#000',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        get font() { return font; },
        set font(v) { font = v; },
        measureText(s) {
            const size = Number((font.match(/([0-9.]+)px/) || [])[1]) || 16;
            return { width: String(s).length * size * 0.52 };
        },
        fillText(text, x, y) { calls.push({ op: 'fillText', text, x, y, alpha: this.globalAlpha }); },
        fillRect(x, y, w, h) { calls.push({ op: 'fillRect', x, y, w, h, alpha: this.globalAlpha }); },
        fill() { calls.push({ op: 'fill', alpha: this.globalAlpha }); },
        save: noop, restore: noop, scale: noop, translate: noop, rotate: noop,
        beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arcTo: noop,
        arc: noop, stroke: noop, clip: noop, setLineDash: noop, rect: noop,
        createLinearGradient: () => ({ addColorStop: noop }),
        drawImage: noop, strokeText: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    };
}

const CYCLE = { prefix: 'Made for', words: 'Ads,Documentaries,Reels', suffix: '' };

await check('word-cycle is registered everywhere a kind has to be', () => {
    assert.ok(TG.TEMPLATE_KINDS.includes('word-cycle'), 'TEMPLATE_KINDS');
    assert.ok(TG.TEMPLATE_DEFAULTS['word-cycle'], 'TEMPLATE_DEFAULTS');
    assert.ok(TG.TEMPLATE_WIDTH_FRACTION['word-cycle'] > 0, 'TEMPLATE_WIDTH_FRACTION');
    const size = TG.templateSize('word-cycle', {});
    assert.ok(size.w > 0 && size.h > 0, 'templateSize');
    // An unregistered kind is silently dropped by drawTemplate, which is how
    // a finished renderer ends up never being called.
    const ctx = stubCtx();
    TG.drawTemplate(ctx, 'word-cycle', CYCLE, 1.2, 4);
    assert.ok(ctx.calls.length > 0, 'drawTemplate drew nothing');
});

await check('the slot never moves between words', () => {
    const at = (t) => {
        const ctx = stubCtx();
        TG.drawTemplate(ctx, 'word-cycle', CYCLE, t, 4.5);
        const texts = ctx.calls.filter(c => c.op === 'fillText');
        const prefix = texts.find(c => /Made for/.test(c.text));
        const word = texts.find(c => /Ads|Documentaries|Reels/.test(c.text));
        assert.ok(prefix && word, `nothing drawn at t=${t}`);
        return { prefixX: prefix.x, wordX: word.x };
    };
    // One sample inside each word's dwell, away from the swap overlap.
    const a = at(0.6), b = at(2.1), c = at(3.6);
    assert.ok(Math.abs(a.prefixX - b.prefixX) < 1e-6 && Math.abs(b.prefixX - c.prefixX) < 1e-6,
        `the prefix moved: ${a.prefixX} / ${b.prefixX} / ${c.prefixX}`);
    assert.ok(Math.abs(a.wordX - b.wordX) < 1e-6 && Math.abs(b.wordX - c.wordX) < 1e-6,
        `the slot moved: ${a.wordX} / ${b.wordX} / ${c.wordX}`);
});

await check('two words are on screen during a swap, and one outside it', () => {
    const shown = (t) => {
        const ctx = stubCtx();
        TG.drawTemplate(ctx, 'word-cycle', CYCLE, t, 4.5);
        return ctx.calls.filter(c => c.op === 'fillText' && /^(Ads|Documentaries|Reels)$/.test(c.text));
    };
    assert.equal(shown(0.6).length, 1, 'mid-dwell should show one word');
    const dwell = 4.5 / 3;
    const mid = shown(dwell - TC.SWAP_CROSSFADE_S / 2);
    assert.equal(mid.length, 2, 'a swap must overlap the two words');
    assert.ok(mid[0].alpha > 0 && mid[1].alpha > 0, 'both words must be visible during the overlap');
    assert.ok(Math.abs((mid[0].alpha + mid[1].alpha) - 1) < 0.05, `the overlap does not conserve opacity: ${mid[0].alpha} + ${mid[1].alpha}`);
});

await check('words that would be unreadable are dropped, not rushed', () => {
    const ctx = stubCtx();
    // Four words in 1 s: at 0.45 s each only two fit.
    TG.drawTemplate(ctx, 'word-cycle', { ...CYCLE, words: 'One,Two,Three,Four' }, 0.5, 1);
    const drawn = new Set(ctx.calls.filter(c => c.op === 'fillText').map(c => c.text));
    assert.ok(!drawn.has('Four'), 'a word was shown that had no time to be read');
});

await check('a request that lists its alternatives is recognised', () => {
    const t = TG.templateFromText('Made for — cycle through reels, shorts, tiktok');
    assert.ok(t, 'nothing recognised');
    assert.equal(t.kind, 'word-cycle');
    assert.ok(/reels/i.test(t.params.words) && /tiktok/i.test(t.params.words), t.params.words);
});

await check('a bare "cycle" with no alternatives is left alone', () => {
    const t = TG.templateFromText('cycle');
    assert.ok(!t || t.kind !== 'word-cycle', JSON.stringify(t));
});

log('\n── 9. The library can reach the techniques ──');

await check('both R107 techniques are retrievable by what a brief would say', async () => {
    const { createRequire } = await import('module');
    const nodeRequire = createRequire(import.meta.url);
    const IDX = nodeRequire(path.join(ROOT, 'server/audio-engine/library/MotionTechniqueIndex.js'));
    const cycle = IDX.findTechniques('cycle through the platforms we support', { limit: 5 });
    assert.ok(cycle.some(r => r.technique.name === 'list-word-cycle'), cycle.map(r => r.technique.name).join(', '));
    const type = IDX.findTechniques('type the command on screen like a terminal', { limit: 5 });
    assert.ok(type.some(r => r.technique.name === 'type-on-caret'), type.map(r => r.technique.name).join(', '));
});

await check('each new technique note carries its number, not just advice', () => {
    const src = fsRead('server/audio-engine/library/starterMotionLibrary.js');
    for (const name of ['list-word-cycle', 'type-on-caret']) {
        const i = src.indexOf(`name: '${name}'`);
        assert.ok(i > 0, `${name} is missing`);
        // The row ends at its own closing brace, not at the first `},` —
        // which belongs to the nested `motion` object and would cut the note.
        const note = src.slice(i, src.indexOf('\n    },', i));
        assert.ok(/note:/.test(note), `${name}: the row has no note`);
        assert.ok(/0\.\d+s/.test(note), `${name}: the note gives no measurement`);
    }
});

log(failures === 0 ? '\n✅ text craft: all checks passed\n' : `\n❌ text craft: ${failures} failing\n`);
process.exit(failures === 0 ? 0 : 1);
