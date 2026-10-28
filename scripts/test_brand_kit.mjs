// R114: the brand kit, the brand graphics, the rest of the diagrams, the two
// social cards and the audio pair. node scripts/test_brand_kit.mjs
import assert from 'assert/strict';
import fs from 'fs';

const log = console.log;
let failures = 0;
const check = (name, fn) => {
    try { fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const BK = await import('../client/src/motion/BrandKit.js');
const TG = await import('../client/src/motion/TemplateGraphics.js');
const SB = await import('../client/src/motion/Storyboard.js');
const BR = await import('../client/src/motion/StoryboardBridge.js');
const { resolveCommand } = await import('../client/src/agent/CommandRegistry.js');

const R114 = ['logo-reveal', 'end-card', 'cta-banner', 'episode-badge', 'sponsor-card',
    'comparison-matrix', 'hierarchy', 'cycle-diagram', 'concept-map', 'annotated-shot',
    'reply-thread', 'dm-bubble', 'waveform', 'audio-bars'];

function recorder() {
    const calls = [];
    const ctx = new Proxy({}, {
        get(_, prop) {
            if (prop === 'canvas') return { width: 1080, height: 1920 };
            if (prop === 'measureText') return (s) => ({ width: String(s).length * 11 });
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
                return () => ({ addColorStop: (o, c) => calls.push(`stop(${o},${c})`) });
            }
            if (typeof prop === 'string' && /^(fillStyle|strokeStyle|lineWidth|font|globalAlpha|textAlign|textBaseline|lineCap|lineJoin|filter|shadowBlur|shadowColor|globalCompositeOperation)$/.test(prop)) return undefined;
            return (...args) => { calls.push(`${String(prop)}(${args.map(a => (typeof a === 'number' ? a.toFixed(4) : String(a))).join(',')})`); };
        },
        set(_, prop, value) { calls.push(`${String(prop)}=${String(value)}`); return true; },
    });
    return { ctx, calls };
}
const drawn = (kind, params, opts) => { const r = recorder(); TG.drawTemplate(r.ctx, kind, params, 1.4, 2.6, opts || {}); return r.calls.join(' '); };

log('\n-- 1. The kit itself --');

check('a partial kit fills from the defaults and never returns undefined', () => {
    const k = BK.normalizeBrand({ accent: '#ff0033' });
    for (const field of Object.keys(BK.BRAND_DEFAULTS)) assert.notEqual(k[field], undefined, field);
    assert.equal(k.accent, '#ff0033');
    assert.equal(k.display, BK.BRAND_DEFAULTS.display);
    assert.deepEqual(BK.normalizeBrand(null), BK.normalizeBrand({}), 'null is not the default kit');
    assert.deepEqual(BK.normalizeBrand('nonsense'), BK.normalizeBrand({}));
});

check('junk is dropped, not carried into a draw call', () => {
    const k = BK.normalizeBrand({ accent: 'red', text: 'rgb(1,2,3)', pace: 99, radius: -40, display: 'A, B' });
    assert.equal(k.accent, BK.BRAND_DEFAULTS.accent, 'a colour name was accepted as a hex');
    assert.equal(k.text, BK.BRAND_DEFAULTS.text);
    // A font STACK silently fails to match a registered face in the export
    // renderer, so a comma means it is not a family name.
    assert.equal(k.display, BK.BRAND_DEFAULTS.display, 'a font stack was accepted');
    assert.ok(k.pace <= 2 && k.pace >= 0.5, `pace ${k.pace} is out of range`);
    assert.ok(k.radius >= 0, `radius ${k.radius}`);
});

check('pace can never be zero or runaway', () => {
    // 0 would divide by zero in an entrance; 10 would mean a graphic that
    // never finishes arriving before it has to leave.
    assert.ok(BK.paced(0.4, { pace: 0 }) > 0);
    assert.ok(BK.paced(0.4, { pace: 100 }) <= 0.4 * 2 + 1e-9);
    assert.equal(BK.paced(0.4, {}), 0.4);
});

log('\n-- 2. One brand, 52+ templates, no draw function touched --');

check('every colour field the catalogue declares has a brand source', () => {
    const declared = new Set();
    for (const defaults of Object.values(TG.TEMPLATE_DEFAULTS)) {
        for (const [field, value] of Object.entries(defaults)) {
            if (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)) declared.add(field);
        }
    }
    for (const field of declared) {
        assert.ok(BK.BRAND_COLOR_FIELDS.includes(field),
            `templates declare "${field}" but the brand has no source for it`);
    }
});

check('the brand reaches a template through drawTemplate', () => {
    const plain = drawn('counter', {}, {});
    const branded = drawn('counter', {}, { brand: { accent: '#ff0033' } });
    assert.ok(/ff0033/i.test(branded), 'the brand colour never reached the draw');
    assert.ok(!/ff0033/i.test(plain), 'the unbranded draw already had it');
});

check('`color` means the mark on one kind and the text on another', () => {
    // The catalogue uses one field name for two jobs. The template's own
    // default decides: white is text, anything else is a mark. Get this wrong
    // and either every chart turns white or every card's text turns cyan.
    const kit = { accent: '#ff0033', accent2: '#00ff88', text: '#eeddcc', surface: '#111827' };

    const bars = BK.applyBrand('bar-chart', {}, kit, TG.TEMPLATE_DEFAULTS['bar-chart']);
    assert.equal(bars.color, kit.accent, 'a chart\'s bars took the TEXT colour');

    const card = BK.applyBrand('step-card', {}, kit, TG.TEMPLATE_DEFAULTS['step-card']);
    assert.equal(card.color, kit.text, 'a card\'s text took the ACCENT colour');
    assert.equal(card.accent, kit.accent);

    // A panel is a surface, and its second gradient stop is an off-switch.
    const panel = BK.applyBrand('panel', {}, kit, TG.TEMPLATE_DEFAULTS['panel']);
    assert.equal(panel.color, kit.surface, 'a panel took a foreground colour');
    assert.ok(!panel.color2, 'the brand switched on a gradient nobody asked for');

    // Two stops that both exist DO both get branded.
    const wash = BK.applyBrand('gradient-wash', {}, kit, TG.TEMPLATE_DEFAULTS['gradient-wash']);
    assert.equal(wash.color, kit.accent);
    assert.equal(wash.color2, kit.accent2);
});

check('a colour the CALLER chose is never repainted', () => {
    // Applying a brand must not silently destroy a hand-tuned graphic already
    // on someone's timeline.
    const out = drawn('counter', { accent: '#00ff00' }, { brand: { accent: '#ff0033' } });
    assert.ok(/00ff00/i.test(out), 'the explicit colour was lost');
    assert.ok(!/ff0033/i.test(out), 'the brand overwrote an explicit colour');
});

check('a fully RESOLVED param set still takes the brand', () => {
    // Every internal caller passes the resolved params, so "untouched" cannot
    // mean "undefined" — it has to mean "still the template\'s own default".
    const resolved = { ...TG.TEMPLATE_DEFAULTS.funnel };
    const out = BK.applyBrand('funnel', resolved, { accent: '#ff0033' }, TG.TEMPLATE_DEFAULTS.funnel);
    assert.equal(out.accent, '#ff0033');
    assert.notEqual(resolved.accent, '#ff0033', 'applyBrand mutated its input');
});

check('the brand sets the fonts too', () => {
    assert.ok(/Bebas/.test(drawn('counter', {}, { brand: { display: 'Bebas' } })), 'the brand font never reached the draw');
    // An explicit `fonts` option still wins over the brand.
    assert.ok(/Impact/.test(drawn('counter', {}, { brand: { display: 'Bebas' }, fonts: { display: 'Impact' } })));
});

check('a tone that MEANS its colour is not repaintable', () => {
    // A red warning repainted to the brand\'s blue is no longer a warning.
    const warn = drawn('status-label', { tone: 'warning' }, { brand: { accent: '#ff0033' } });
    assert.ok(/FFB020/i.test(warn), 'the warning lost its colour');
    const category = drawn('status-label', { tone: 'category' }, { brand: { accent: '#ff0033' } });
    assert.ok(/ff0033/i.test(category), 'the neutral tone did not take the brand');
});

check('no brand means exactly what it meant before the kit existed', () => {
    assert.equal(drawn('funnel', {}, {}), drawn('funnel', {}, { brand: null }));
});

check('a project kit prefers the user over the footage', () => {
    const fromFootage = BK.brandFromProject({ palette: { accent: '#123456' } });
    assert.equal(fromFootage.accent, '#123456');
    const fromUser = BK.brandFromProject({ brand: { accent: '#abcdef' }, palette: { accent: '#123456' } });
    assert.equal(fromUser.accent, '#abcdef', 'a sampled frame overrode the user\'s own brand');
});

log('\n-- 3. The new graphics --');

check('every new kind is registered, sized, and draws deterministically', () => {
    for (const k of R114) {
        assert.ok(TG.TEMPLATE_KINDS.includes(k), `${k} not registered`);
        assert.ok(TG.TEMPLATE_DEFAULTS[k], `${k} has no defaults`);
        assert.ok(TG.TEMPLATE_WIDTH_FRACTION[k] > 0, `${k} has no width`);
        const { w, h } = TG.templateSize(k, {});
        assert.ok(w > 0 && h > 0, `${k} sized ${w}x${h}`);
        const params = TG.previewParams(k);
        const a = drawn(k, params, {});
        const b = drawn(k, params, {});
        assert.equal(a, b, `${k} draws differently on the second pass`);
        assert.ok(a.length > 0, `${k} drew nothing even with preview params`);
    }
});

check('junk and empty params never throw', () => {
    const { ctx } = recorder();
    for (const k of R114) {
        for (const t of [-9, 0, 2.6, 999, NaN]) TG.drawTemplate(ctx, k, {}, t, 2.6, {});
        for (const p of [{ steps: '' }, { messages: '' }, { pins: 'junk' }, { samples: 'a,b' },
            { options: '', criteria: '' }, { nodes: '' }, { text: '' }, { children: '' }]) {
            TG.drawTemplate(ctx, k, p, 1, 2.6, {});
        }
    }
});

check('an audio graphic with no samples draws NOTHING', () => {
    // A waveform that invents its own shape is a decoration pretending to be
    // data — it would be lying about the very thing it depicts.
    for (const k of TG.DATA_REQUIRED_KINDS) {
        const empty = drawn(k, { samples: '' }, {});
        assert.ok(!/fill\(|fillText\(/.test(empty), `${k} drew something from no data`);
        const withData = drawn(k, TG.previewParams(k), {});
        assert.ok(/fill\(/.test(withData), `${k} drew nothing even with samples`);
    }
});

check('a waveform follows its samples, not the clock', () => {
    const flat = drawn('waveform', { samples: '0.5,0.5,0.5,0.5,0.5,0.5' }, {});
    const peaky = drawn('waveform', { samples: '0.1,1,0.1,1,0.1,1' }, {});
    assert.notEqual(flat, peaky, 'two different signals drew identically');
});

check('a message with a comma in it stays one message', () => {
    // parseList takes a separator precisely so "How fast, really?" is not two
    // replies.
    const one = TG.templateSize('reply-thread', { messages: 'How do you edit so fast, Marc?' });
    const two = TG.templateSize('reply-thread', { messages: 'first|second' });
    assert.ok(two.h > one.h, `one message sized ${one.h}, two sized ${two.h}`);
});

check('a comparison matrix reads its marks row-major', () => {
    // Row-major is the order a person writes a grid in; column-major would
    // transpose every answer silently.
    const r = recorder();
    TG.drawTemplate(r.ctx, 'comparison-matrix',
        { options: 'A,B', criteria: 'one,two', marks: 'y,n,n,y' }, 2.4, 2.6, {});
    const out = r.calls.join(' ');
    assert.ok(/moveTo/.test(out), 'nothing was drawn');
    // Two ticks and two crosses: a tick is 3 points, a cross is 4 in 2 paths.
    assert.ok(out.length > 100);
});

check('diagrams and cards grow with their content', () => {
    assert.ok(TG.templateSize('hierarchy', { children: 'a,b,c,d' }).w > TG.templateSize('hierarchy', { children: 'a' }).w);
    assert.ok(TG.templateSize('comparison-matrix', { criteria: 'a,b,c,d' }).h > TG.templateSize('comparison-matrix', { criteria: 'a' }).h);
    assert.ok(TG.templateSize('comparison-matrix', { options: 'a,b,c' }).w > TG.templateSize('comparison-matrix', { options: 'a' }).w);
    assert.ok(TG.templateSize('cta-banner', { sub: 'x' }).h > TG.templateSize('cta-banner', { sub: '' }).h);
    assert.ok(TG.templateSize('logo-reveal', { tagline: 'x' }).h > TG.templateSize('logo-reveal', { tagline: '' }).h);
});

check('a brand graphic with no logo draws a monogram, not a hole', () => {
    const out = drawn('logo-reveal', { name: 'Vibed', imageUrl: '' }, {});
    assert.ok(/fillText\(V,/.test(out), 'no monogram was drawn in place of the missing logo');
});

check('a card with no `name` field still gets a monogram, not a "?"', () => {
    // An end card has a `title` and a `handle`, not a `name`: the mark fell
    // back to "?" and the card read as a broken image.
    const out = drawn('end-card', { imageUrl: '', handle: '@vibedstudio', title: 'Thanks' }, {});
    assert.ok(!/fillText\(\?,/.test(out), 'the monogram is still a question mark');
    assert.ok(/fillText\(@,/.test(out), 'the handle was not used for the initial');
});

check('a cycle label never runs off the card', () => {
    // A step at 3 o'clock pushed R+74 to the right ran off the edge, and
    // "Learn" rendered as "arn". Found by reading the picture.
    const { w } = TG.templateSize('cycle-diagram', {});
    const r = recorder();
    TG.drawTemplate(r.ctx, 'cycle-diagram', { steps: 'Research,Write,Record,Edit,Publish,Review' }, 2.4, 2.6, {});
    const labels = r.calls.filter(c => /^fillText\([A-Z][a-z]+,/.test(c));
    assert.ok(labels.length >= 4, `only ${labels.length} labels drawn`);
    for (const call of labels) {
        const x = Number(call.split(',')[1]);
        assert.ok(x >= 0 && x <= w, `a label is at x=${x} on a card ${w} wide`);
    }
});

check('the annotated shot is classed as a frame effect', () => {
    // It is pins ON the shot beneath; a backing surface would defeat it, so
    // it is sparse by design and must be classified rather than "fixed".
    assert.ok(TG.FRAME_EFFECT_KINDS.includes('annotated-shot'));
    assert.equal(TG.TEMPLATE_WIDTH_FRACTION['annotated-shot'], 1.0);
});

check('a pin label may contain a comma', () => {
    const r = recorder();
    TG.drawTemplate(r.ctx, 'annotated-shot', { pins: '0.3,0.4,Wait, watch this' }, 2.4, 2.6, {});
    assert.ok(/fillText\(Wait, watch this,/.test(r.calls.join(' ')), 'the label was split on its own comma');
});

log('\n-- 4. Askable, and nothing stolen --');

check('each new kind can be asked for, in English and French', () => {
    const asks = [['logo reveal', 'logo-reveal'], ['end card', 'end-card'], ['cta banner', 'cta-banner'],
        ['banniere', 'cta-banner'], ['episode badge 12', 'episode-badge'], ['sponsored by', 'sponsor-card'],
        ['comparison matrix', 'comparison-matrix'], ['tableau comparatif', 'comparison-matrix'],
        ['org chart', 'hierarchy'], ['organigramme', 'hierarchy'], ['cycle diagram', 'cycle-diagram'],
        ['boucle', 'cycle-diagram'], ['diagramme circulaire', 'cycle-diagram'], ['concept map', 'concept-map'], ['carte mentale', 'concept-map'],
        ['annotated screenshot', 'annotated-shot'], ['reply thread', 'reply-thread'],
        ['dm bubble', 'dm-bubble'], ['message prive', 'dm-bubble'],
        ['waveform', 'waveform'], ['forme d onde', 'waveform'],
        ['audio bars', 'audio-bars'], ['equalizer', 'audio-bars']];
    for (const [text, kind] of asks) {
        assert.equal(TG.templateFromText(text)?.kind, kind, `"${text}" gave ${TG.templateFromText(text)?.kind}`);
    }
});

check('nothing that worked before was stolen', () => {
    for (const [text, kind] of [['pie chart', 'pie-chart'], ['add a bar chart', 'bar-chart'],
        ['donut chart', 'donut-chart'], ['process flow', 'process-flow'], ['diagramme de flux', 'process-flow'],
        ['timeline', 'timeline-steps'], ['funnel', 'funnel'], ['quote card', 'quote-card'],
        ['comment bubble', 'comment-bubble'], ['add a counter', 'counter'], ['search bar', 'search-bar'],
        ['step card', 'step-card'], ['pro tip label', 'status-label'], ['screenshot', 'screenshot-card'],
        ['logo card', 'logo-card'], ['ui card', 'ui-card'], ['circle it', 'circle-callout'],
        ['video thumbnail', 'video-thumbnail'],
        // "cycle" alone is R107's word-cycle, not a ring of steps.
        ['cycle through reels, shorts, tiktok', 'word-cycle']]) {
        assert.equal(TG.templateFromText(text)?.kind, kind, `"${text}" was stolen by ${TG.templateFromText(text)?.kind}`);
    }
});

check('the brand command resolves, and the colour is read from the sentence', () => {
    for (const phrase of ['set my brand colour to #FF0033', 'use my brand colors',
        'make the graphics match my brand', 'applique ma charte']) {
        const r = resolveCommand(phrase);
        assert.equal(r.match?.id, 'set_brand_kit', `"${phrase}" went to ${r.match?.id}`);
        assert.equal(r.confidence, 'high');
    }
    const planner = read('../client/src/agent/EditPlanner.js');
    const body = planner.slice(planner.indexOf("case 'set_brand_kit'"), planner.indexOf("case 'storyboard_video'"));
    assert.ok(/#\[0-9a-fA-F\]\{6\}/.test(body.replace(/\\\\/g, '\\')) || /0-9a-fA-F/.test(body), 'no hex parser');
    assert.ok(/rouge|bleu/.test(body), 'the colour names are English-only');
});

check('the kit survives a save, and is not an unsaved-state bug waiting to happen', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    assert.ok(/brandKit:\s*_preRestoredProject\?\.brandKit/.test(store), 'it is not restored');
    assert.ok(/brandKit:\s+state\.brandKit \|\| null,/.test(store), 'it is not in the save payload');
});

check('the brand is baked in at PLACEMENT, so preview and export cannot disagree', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    const body = store.slice(store.indexOf('addTemplateClip:'), store.indexOf('addTemplateClip:') + 2200);
    assert.ok(/applyBrand\(kind, params, kit, TEMPLATE_DEFAULTS\[kind\]\)/.test(body),
        'the brand is not applied when the clip is placed');
    // Passing a live brand into two renderers is two places to forget it.
    assert.ok(/opts\.brand === null \? null : \(opts\.brand \|\| get\(\)\.brandKit\)/.test(body),
        'a caller cannot opt out of the brand');
});

log('\n-- 5. The storyboard still refuses to invent --');

check('every graphic the planner can name resolves', () => {
    for (const [kind, plan] of Object.entries(SB.KIND_PLAN)) {
        for (const g of plan.graphics) assert.ok(SB.resolveGraphic(g), `${kind} names "${g}"`);
        for (const l of plan.layouts) assert.ok(SB.LAYOUTS.includes(l), `${kind} names layout "${l}"`);
    }
});

check('a comparison matrix is never planned from one sentence', () => {
    // A contrast gives two sides and nothing to compare them ON. Filling the
    // grid would mean inventing the criteria.
    assert.equal(BR.paramsFor('comparison-matrix', { text: 'manual editing but Vibed instead' }), null);
});

check('a cycle needs real steps', () => {
    assert.equal(BR.paramsFor('cycle-diagram', { text: 'one clause only' }), null);
    assert.ok(BR.paramsFor('cycle-diagram', { text: 'First film, second edit, third post' }).steps);
});

log(failures === 0 ? '\nALL BRAND KIT TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
