// scripts/test_composed_components.mjs
//
// R103 round B — Callout, QuoteCard and CTAWidget join the design system.
//
// These three were the text-bearing components still building flat
// placements: hardcoded font sizes (36 / 44 / 32), hardcoded y positions, no
// safe-zone awareness, no legibility outline. On a 1080x1920 vertical frame
// the type scale puts a caption at ~84px, so the CTA was rendering at 32px —
// smaller than the captions beneath it. That is a visible quality cliff
// between the four designed components and everything else.
//
// What these checks pin:
//   1. they compose (a scene, not loose placements)
//   2. the type is derived from the FRAME, not a constant, and is no longer
//      dwarfed by the captions
//   3. they validate clean and need no repairs, on both aspect ratios
//   4. the preset a caller asks for is the preset they get
//   5. the several names a caller might use for "the words" all work — the
//      old Callout required `params.text` exactly and returned nothing for
//      `content`
//   6. an explicit y still wins, for the one component that honoured it
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

const CL = await import('../client/src/motion/ComponentLibrary.js');
const SC = await import('../client/src/motion/SceneComposer.js');
const SV = await import('../client/src/motion/SceneValidator.js');
const SL = await import('../client/src/motion/SceneLayout.js');
const TM = await import('../client/src/motion/TextMeasurement.js');
const SS = await import('../client/src/motion/SceneSchema.js');

const NEW = ['Callout', 'QuoteCard', 'CTAWidget'];
const build = (id, preset, params, aspect = '9:16') => CL.buildComponent(
    id, preset, { duration: 3, ...params },
    { aspectRatio: aspect, safeZone: SV.safeZoneForAspect(aspect) },
);
const textsOf = (out) => out.placements.filter(p => p.trackType === 'text').map(p => p.clip);

log('\n── 1. They are part of the design system now ──');

await check('all three are composed components', () => {
    for (const id of NEW) assert.ok(SC.COMPOSED_COMPONENTS.includes(id), `${id} is still lifted`);
});

await check('buildComponent returns a composed scene for each', () => {
    const cases = [
        ['Callout', 'dark', { text: 'This is the important part' }],
        ['QuoteCard', 'classic', { quote: 'It changed how I think about everything', author: 'Marc' }],
        ['CTAWidget', 'subscribe', { text: 'Follow for part two' }],
    ];
    for (const [id, preset, params] of cases) {
        const out = build(id, preset, params);
        assert.ok(out.scene, `${id} did not compose`);
        assert.ok(out.placements.length >= 2, `${id} produced ${out.placements.length} placements`);
        assert.ok(!out.error, `${id} errored: ${out.error}`);
    }
});

await check('every composed clip shares one groupId, so the piece moves as one', () => {
    // R66's contract, which flattenScene satisfies by stamping the enclosing
    // group's id. Without it, dragging the plate leaves the words behind.
    for (const [id, preset, params] of [
        ['Callout', 'dark', { text: 'One line here' }],
        ['QuoteCard', 'classic', { quote: 'A quote worth reading twice', author: 'Marc' }],
        ['CTAWidget', 'follow', {}],
    ]) {
        const out = build(id, preset, params);
        const groups = new Set(out.placements.map(p => p.clip.groupId));
        assert.equal(groups.size, 1, `${id} spread across ${groups.size} groups`);
        assert.ok([...groups][0], `${id} has no groupId at all`);
    }
});

log('\n── 2. The type comes from the frame, not from a constant ──');

await check('the same component sizes differently in 9:16 and 16:9', () => {
    const vertical = textsOf(build('Callout', 'dark', { text: 'This is the important part' }, '9:16'))[0];
    const wide = textsOf(build('Callout', 'dark', { text: 'This is the important part' }, '16:9'))[0];
    assert.ok(vertical.fontSize !== wide.fontSize, `both frames gave ${vertical.fontSize}px — the type is still frame-blind`);
});

await check('the old hardcoded sizes are comfortably beaten on vertical', () => {
    // Old constants: Callout 36, QuoteCard 44, CTAWidget 32.
    const callout = textsOf(build('Callout', 'dark', { text: 'This is the important part' }))[0];
    const quote = textsOf(build('QuoteCard', 'classic', { quote: 'It changed how I think about everything' }))[0];
    const cta = textsOf(build('CTAWidget', 'subscribe', { text: 'Follow for part two' }))[0];
    assert.ok(callout.fontSize >= 72, `callout at ${callout.fontSize}px (was 36)`);
    assert.ok(quote.fontSize >= 66, `quote at ${quote.fontSize}px (was 44)`);
    assert.ok(cta.fontSize >= 64, `cta at ${cta.fontSize}px (was 32)`);
});

await check('a four-word CTA is no longer dwarfed by the captions', () => {
    // The specific defect: pinned to one unwrapped line it shrank to 43px,
    // under the caption role's own size on the same frame.
    const captionSize = SL.sizeForRole('9:16', 'caption');
    const cta = textsOf(build('CTAWidget', 'subscribe', { text: 'Follow for part two' }))[0];
    assert.ok(cta.fontSize > captionSize * 0.9, `CTA ${cta.fontSize}px vs caption ${captionSize}px — a call to action should not read smaller than the subtitles`);
});

await check('an explicit fontSize from the caller is still respected', () => {
    const cta = textsOf(build('CTAWidget', 'subscribe', { text: 'FOLLOW', fontSize: 64 }))[0];
    assert.ok(cta.fontSize <= 64, `asked for 64px, got ${cta.fontSize}px`);
});

log('\n── 3. They are placed legally ──');

await check('each validates with no errors and needs no repairs, both aspects', () => {
    for (const aspect of ['9:16', '16:9']) {
        const safeZone = SV.safeZoneForAspect(aspect);
        for (const [id, preset, params] of [
            ['Callout', 'dark', { text: 'This is the important part of the whole thing' }],
            ['QuoteCard', 'classic', { quote: 'It changed how I think about everything I do', author: 'Marc Ivan' }],
            ['CTAWidget', 'subscribe', { text: 'Follow for part two' }],
        ]) {
            const out = build(id, preset, params, aspect);
            const report = SV.validateScene(out.scene, { safeZone });
            assert.equal(report.counts.error, 0, `${id} @${aspect}: ${report.issues.filter(i => i.severity === 'error').map(i => i.message).join(' | ')}`);
            const fixed = SV.autoFixScene(out.scene, { safeZone });
            assert.deepEqual(fixed.fixes, [], `${id} @${aspect} needed repairs: ${fixed.fixes.map(f => f.message).join(' | ')}`);
        }
    }
});

await check('the CTA sits low in the frame, near the platform action buttons', () => {
    const cta = textsOf(build('CTAWidget', 'follow', {}))[0];
    assert.ok(cta.y > 55, `a CTA at y=${cta.y} is not a close`);
});

log('\n── 4. The preset asked for is the preset given ──');

await check('dark and light callouts are genuinely different looks', () => {
    const dark = textsOf(build('Callout', 'dark', { text: 'Same words' }))[0];
    const light = textsOf(build('Callout', 'light', { text: 'Same words' }))[0];
    assert.notEqual(dark.color, light.color, 'both callout presets rendered the same text colour');
});

await check('subscribe and follow are different looks, and each has its own default wording', () => {
    const sub = build('CTAWidget', 'subscribe', {});
    const fol = build('CTAWidget', 'follow', {});
    const subText = String(textsOf(sub)[0].content || '');
    const folText = String(textsOf(fol)[0].content || '');
    assert.match(subText, /SUBSCRIBE/i, `subscribe default was "${subText}"`);
    assert.match(folText, /FOLLOW/i, `follow default was "${folText}"`);
    const subAccent = sub.placements.find(p => p.trackType !== 'text');
    const folAccent = fol.placements.find(p => p.trackType !== 'text');
    assert.ok(subAccent && folAccent, 'a CTA should carry its badge shape');
});

await check('an unknown preset falls back instead of failing', () => {
    const out = build('Callout', 'not-a-real-preset', { text: 'Still works' });
    assert.ok(out.scene, 'an unknown preset should still produce a graphic');
    assert.ok(!out.error, out.error);
});

log('\n── 5. The words land whatever the caller calls them ──');

await check('Callout accepts text, content, label or title', () => {
    for (const key of ['text', 'content', 'label', 'title']) {
        const out = build('Callout', 'dark', { [key]: 'The important part' });
        assert.ok(out.scene, `Callout got nothing from params.${key}`);
        const words = textsOf(out).map(c => String(c.content || '')).join(' ');
        assert.match(words, /The important part/, `params.${key} did not reach the screen`);
    }
});

await check('QuoteCard accepts quote, text or content, and author or attribution', () => {
    for (const key of ['quote', 'text', 'content']) {
        const out = build('QuoteCard', 'classic', { [key]: 'A line worth quoting' });
        const words = textsOf(out).map(c => String(c.content || '')).join(' ');
        assert.match(words, /A line worth quoting/, `params.${key} did not reach the screen`);
    }
    for (const key of ['author', 'attribution']) {
        const out = build('QuoteCard', 'classic', { quote: 'A line worth quoting', [key]: 'Marc' });
        const words = textsOf(out).map(c => String(c.content || '')).join(' ');
        assert.match(words, /Marc/, `params.${key} did not reach the screen`);
    }
});

await check('CTAWidget accepts label, text, content or title', () => {
    for (const key of ['label', 'text', 'content', 'title']) {
        const out = build('CTAWidget', 'subscribe', { [key]: 'Join the list' });
        const words = textsOf(out).map(c => String(c.content || '')).join(' ');
        assert.match(words, /Join the list/, `params.${key} did not reach the screen`);
    }
});

log('\n── 6. An accent covers the text it decorates ──');

await check('a wrapped headline gets an accent that frames it, not one inside it', () => {
    // computeAccentBounds re-measures the string independently of the
    // measurement layoutStack already did, and the two disagree once the text
    // wraps. On 9:16 a three-line headline laid out at 494x319 was getting a
    // 365x254 highlight-box — a box sitting INSIDE the words.
    const frame = SL.resolveFrame('9:16');
    const rect = SL.contentRectFor(frame, SV.safeZoneForAspect('9:16'));
    const maxWidth = Math.min(rect.w, SC.MEASURE.display * frame.w);
    for (const text of ['Launch Day', 'Zero To Forty', 'Zero To Forty Thousand', 'This Headline Is Deliberately Long']) {
        const item = { key: 't', text, role: 'display', fontFamily: 'Montserrat', fontWeight: 800, maxWidthFrac: SC.MEASURE.display, maxLines: 2 };
        const placed = SL.layoutStack({ frame, rect, items: [item], anchor: 'top', maxWidthFrac: SC.MEASURE.display }).items[0];
        for (const kind of ['highlight-box', 'burst', 'circle-callout']) {
            const a = SL.accentFor({ ...placed, maxWidth }, { frame, shapeKind: kind, x: 50 });
            assert.ok(a.w >= placed.width, `${kind} on "${text}": accent ${Math.round(a.w)}px narrower than text ${Math.round(placed.width)}px`);
            assert.ok(a.h >= placed.height, `${kind} on "${text}": accent ${Math.round(a.h)}px shorter than text ${Math.round(placed.height)}px`);
        }
        const rule = SL.accentFor({ ...placed, maxWidth }, { frame, shapeKind: 'underline', x: 50 });
        assert.ok(rule.w >= placed.width - 1, `underline on "${text}" spans ${Math.round(rule.w)}px of ${Math.round(placed.width)}px of text`);
    }
});

await check('an accent never gets wider than the frame', () => {
    const frame = SL.resolveFrame('9:16');
    const rect = SL.contentRectFor(frame, SV.safeZoneForAspect('9:16'));
    const item = { key: 't', text: 'An Extremely Long Headline That Will Not Fit', role: 'display', fontFamily: 'Montserrat', fontWeight: 800, maxWidthFrac: 0.95, maxLines: 2 };
    const placed = SL.layoutStack({ frame, rect, items: [item], anchor: 'top', maxWidthFrac: 0.95 }).items[0];
    const a = SL.accentFor({ ...placed, maxWidth: 0.95 * frame.w }, { frame, shapeKind: 'highlight-box', x: 50 });
    assert.ok(a.w <= frame.w, `accent ${Math.round(a.w)}px wider than the ${frame.w}px frame`);
});

await check('the accent scale still matches its width', () => {
    // scale is the factor from the renderer's base overlay width up to w, so
    // growing w without recomputing scale would draw the accent at the old size.
    const frame = SL.resolveFrame('9:16');
    const rect = SL.contentRectFor(frame, SV.safeZoneForAspect('9:16'));
    const item = { key: 't', text: 'Zero To Forty Thousand', role: 'display', fontFamily: 'Montserrat', fontWeight: 800, maxWidthFrac: SC.MEASURE.display, maxLines: 2 };
    const placed = SL.layoutStack({ frame, rect, items: [item], anchor: 'top', maxWidthFrac: SC.MEASURE.display }).items[0];
    const a = SL.accentFor({ ...placed, maxWidth: SC.MEASURE.display * frame.w }, { frame, shapeKind: 'highlight-box', x: 50 });
    const implied = a.scale * frame.w * SS.OVERLAY_WIDTH_FRACTION;
    assert.ok(Math.abs(implied - a.w) < 1.5, `scale implies ${Math.round(implied)}px but w is ${Math.round(a.w)}px`);
});

log('\n── 7. The measure is aspect-aware ──');

await check('landscape keeps the rule it was derived from', () => {
    // 0.46 is "880px of 1920" — a landscape value. It must not move.
    for (const role of ['display', 'title', 'stat']) {
        assert.equal(SC.measureFor(role, '16:9'), SC.MEASURE[role], `${role} changed on 16:9`);
    }
    assert.equal(SC.measureFor('caption', '16:9'), SC.MEASURE.caption);
});

await check('a vertical frame lets text run much wider than the landscape rule', () => {
    const wide = SC.measureFor('display', '16:9');
    const tall = SC.measureFor('display', '9:16');
    assert.ok(tall > wide * 1.6, `9:16 display measure ${tall} is barely wider than 16:9's ${wide}`);
});

await check('a headline is never given a narrower measure than the captions under it', () => {
    // The defect: headlines ran at 0.46 while captions had always run at 0.8,
    // so on 9:16 the hook title was confined to a 497px column while the
    // subtitles beneath it had 864px.
    for (const aspect of ['9:16', '4:5', '1:1', '16:9']) {
        const head = SC.measureFor('display', aspect);
        const caption = SC.measureFor('caption', aspect);
        const frame = SL.resolveFrame(aspect);
        const headPx = head * frame.w;
        const capPx = caption * frame.w;
        if (frame.h > frame.w) {
            assert.ok(headPx >= capPx - 1, `${aspect}: headline ${Math.round(headPx)}px is narrower than captions ${Math.round(capPx)}px`);
        }
    }
});

await check('every portrait format gets the portrait rule, not a ramp toward it', () => {
    // A gradient between the two left 4:5 — an ordinary Instagram format —
    // with a headline narrower than its own captions.
    const tall = SC.measureFor('display', '9:16');
    assert.equal(SC.measureFor('display', '4:5'), tall, '4:5 did not get the portrait measure');
    assert.equal(SC.measureFor('display', '1:1'), SC.MEASURE.display, 'square should keep the landscape rule');
});

await check('a vertical headline actually uses the frame', () => {
    const frame = SL.resolveFrame('9:16');
    const out = build('TitleSequence', 'cinematic', { title: 'Zero To Forty Thousand' });
    const text = textsOf(out)[0];
    // Two lines at this measure, not three narrow fragments.
    const bounds = TM.measureTextBounds(text.content, {
        fontSize: text.fontSize, fontFamily: text.fontFamily, fontWeight: text.fontWeight,
        maxWidth: SC.measureFor('display', frame) * frame.w,
    });
    assert.ok(bounds.lines.length <= 2, `a six-word headline still breaks into ${bounds.lines.length} lines`);
    assert.ok(bounds.width > frame.w * 0.55, `the headline only spans ${Math.round(bounds.width)}px of ${frame.w}px`);
});

await check('nothing breaches the safe area at either aspect after widening', () => {
    for (const aspect of ['9:16', '16:9']) {
        const safeZone = SV.safeZoneForAspect(aspect);
        for (const text of ['Launch Day', 'Zero To Forty Thousand', 'This Changes Everything', 'A Much Longer Headline That Has To Wrap']) {
            const out = build('TitleSequence', 'cinematic', { title: text }, aspect);
            const report = SV.validateScene(out.scene, { safeZone });
            assert.equal(report.counts.error, 0, `${aspect} "${text}": ${report.issues.filter(i => i.severity === 'error').map(i => i.message).join(' | ')}`);
            const fixed = SV.autoFixScene(out.scene, { safeZone });
            assert.deepEqual(fixed.fixes, [], `${aspect} "${text}" needed repairs: ${fixed.fixes.map(f => f.message).join(' | ')}`);
        }
    }
});

await check('an accent is sized from the WRAPPED text, not the unwrapped string', () => {
    // computeAccentBounds measures the string as one line. "Launch Day" lays
    // out as two lines of 587px but measures 978px unwrapped, and the accent
    // built from that came to 1012px of a 1080px frame.
    const frame = SL.resolveFrame('9:16');
    const rect = SL.contentRectFor(frame, SV.safeZoneForAspect('9:16'));
    const frac = SC.measureFor('display', frame);
    const maxWidth = Math.min(rect.w, frac * frame.w);
    const item = { key: 't', text: 'Launch Day', role: 'display', fontFamily: 'Montserrat', fontWeight: 800, maxWidthFrac: frac, maxLines: 2 };
    const placed = SL.layoutStack({ frame, rect, items: [item], anchor: 'top', maxWidthFrac: frac }).items[0];
    const rule = SL.accentFor({ ...placed, maxWidth }, { frame, shapeKind: 'underline', x: 50 });
    assert.ok(rule.w <= placed.width + 1, `underline ${Math.round(rule.w)}px exceeds the wrapped text's ${Math.round(placed.width)}px`);
});

await check('an accent never exceeds the measure its text was laid out to', () => {
    // The content rect is not centred in the frame, so "inside the frame" is
    // not enough: a centred shape wider than the measure overruns the rect.
    const frame = SL.resolveFrame('9:16');
    const rect = SL.contentRectFor(frame, SV.safeZoneForAspect('9:16'));
    const frac = SC.measureFor('display', frame);
    const maxWidth = Math.min(rect.w, frac * frame.w);
    for (const text of ['Zero To Forty Thousand', 'This Changes Everything', 'Launch Day']) {
        const item = { key: 't', text, role: 'display', fontFamily: 'Montserrat', fontWeight: 800, maxWidthFrac: frac, maxLines: 2 };
        const placed = SL.layoutStack({ frame, rect, items: [item], anchor: 'top', maxWidthFrac: frac }).items[0];
        for (const kind of ['highlight-box', 'burst', 'circle-callout']) {
            const a = SL.accentFor({ ...placed, maxWidth }, { frame, shapeKind: kind, x: 50 });
            assert.ok(a.w <= maxWidth + 1, `${kind} on "${text}": ${Math.round(a.w)}px exceeds the ${Math.round(maxWidth)}px measure`);
        }
    }
});

log('\n── 8. What must not change ──');

await check('an explicit y keeps the hand-built path, so placement from a caller wins', () => {
    const out = build('Callout', 'dark', { text: 'Pinned low', y: 80 });
    assert.ok(!out.scene, 'an explicitly placed callout should not be re-laid-out by the design system');
    for (const p of out.placements) assert.equal(p.clip.y, 80, `y was moved to ${p.clip.y}`);
});

await check('the four original composed components are untouched', () => {
    for (const [id, preset] of [['TitleSequence', 'cinematic'], ['KineticTitle', 'punchy'], ['StatCallout', 'metric-callout'], ['LowerThird', 'pro-minimal']]) {
        const out = build(id, preset, { title: 'A Real Headline', value: '+184%', label: 'in six weeks' });
        assert.ok(out.scene, `${id} stopped composing`);
        const report = SV.validateScene(out.scene, { safeZone: SV.safeZoneForAspect('9:16') });
        assert.equal(report.counts.error, 0, `${id}: ${report.issues.filter(i => i.severity === 'error').map(i => i.message).join(' | ')}`);
    }
});

await check('every composed component carries real motion', () => {
    for (const [id, preset, params] of [
        ['Callout', 'dark', { text: 'One line here' }],
        ['QuoteCard', 'classic', { quote: 'A quote worth reading' }],
        ['CTAWidget', 'follow', {}],
    ]) {
        const out = build(id, preset, params);
        const presets = out.placements.flatMap(p => (p.clip.animations || []).map(a => a.presetId)).filter(Boolean);
        assert.ok(presets.some(p => /^composed:/.test(p)), `${id} came out static: ${JSON.stringify(presets)}`);
    }
});

log('');
if (failures > 0) {
    log(`${failures} FAILED`);
    process.exit(1);
}
log('ALL COMPOSED COMPONENT TESTS PASSED');
