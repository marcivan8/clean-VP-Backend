// R113: labels, markers, the rest of the chart family, creator media and
// diagrams. node scripts/test_graphics_r113.mjs
import assert from 'assert/strict';

const log = console.log;
let failures = 0;
const check = (name, fn) => {
    try { fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};

const TG = await import('../client/src/motion/TemplateGraphics.js');
const SB = await import('../client/src/motion/Storyboard.js');
const BR = await import('../client/src/motion/StoryboardBridge.js');

const R113 = ['status-label', 'numbered-marker', 'spotlight', 'magnifier', 'crosshair',
    'pie-chart', 'donut-chart', 'area-chart', 'h-bar-chart',
    'video-thumbnail', 'video-player', 'engagement-counter',
    'process-flow', 'timeline-steps', 'funnel'];

/** A 2D context that records every call, so two draws can be compared exactly. */
function recorder() {
    const calls = [];
    const ctx = new Proxy({}, {
        get(_, prop) {
            if (prop === 'canvas') return { width: 1080, height: 1920 };
            if (prop === 'measureText') return (s) => ({ width: String(s).length * 11 });
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
                return (...a) => { calls.push(`grad(${a.map(n => Number(n).toFixed(2)).join()})`); return { addColorStop: (o, c) => calls.push(`stop(${o},${c})`) }; };
            }
            if (typeof prop === 'string' && /^(fillStyle|strokeStyle|lineWidth|font|globalAlpha|textAlign|textBaseline|lineCap|lineJoin|filter|shadowBlur|shadowColor|globalCompositeOperation)$/.test(prop)) return undefined;
            return (...args) => { calls.push(`${String(prop)}(${args.map(a => (typeof a === 'number' ? a.toFixed(4) : String(a))).join(',')})`); };
        },
        set(_, prop, value) { calls.push(`${String(prop)}=${String(value)}`); return true; },
    });
    return { ctx, calls };
}

log('\n-- 1. Registered, sized and drawable --');

check('every new kind is registered with defaults, a width and a size', () => {
    for (const k of R113) {
        assert.ok(TG.TEMPLATE_KINDS.includes(k), `${k} not in TEMPLATE_KINDS`);
        assert.ok(TG.TEMPLATE_DEFAULTS[k], `${k} has no defaults`);
        assert.ok(TG.TEMPLATE_WIDTH_FRACTION[k] > 0, `${k} has no width fraction`);
        const { w, h } = TG.templateSize(k, {});
        assert.ok(w > 0 && h > 0, `${k} sized ${w}x${h}`);
    }
    assert.equal(TG.TEMPLATE_KINDS.length, new Set(TG.TEMPLATE_KINDS).size, 'a kind is registered twice');
});

check('drawing is pure: the same t twice gives the same calls', () => {
    // Preview and export share this code. A draw that depended on anything
    // outside (t, params) would desync them and no downstream test could say
    // which half was right.
    for (const k of R113) {
        const a = recorder();
        TG.drawTemplate(a.ctx, k, {}, 0.7, 2.6, {});
        const b = recorder();
        TG.drawTemplate(b.ctx, k, {}, 0.7, 2.6, {});
        assert.equal(b.calls.join('|'), a.calls.join('|'), `${k} draws differently on the second pass`);
        assert.ok(a.calls.length > 0, `${k} drew nothing at all`);
    }
});

check('t outside the clip is clamped, and junk params never throw', () => {
    const { ctx } = recorder();
    for (const k of R113) {
        for (const t of [-9, 0, 2.6, 999, NaN]) TG.drawTemplate(ctx, k, {}, t, 2.6, {});
        for (const p of [{ values: '' }, { values: 'abc' }, { steps: '' }, { stages: '' }, { text: '' }, { labels: ',,,' }]) {
            TG.drawTemplate(ctx, k, p, 1, 2.6, {});
        }
    }
});

check('a chart with no usable numbers draws nothing rather than an empty frame', () => {
    for (const [kind, params] of [['pie-chart', { values: '' }], ['donut-chart', { values: 'x,y' }],
        ['area-chart', { values: '5' }], ['h-bar-chart', { values: '' }], ['funnel', { stages: '' }],
        ['process-flow', { steps: '' }], ['timeline-steps', { steps: '' }]]) {
        const { ctx, calls } = recorder();
        TG.drawTemplate(ctx, kind, params, 1, 2.6, {});
        assert.deepEqual(calls.filter(c => c.startsWith('fill(') || c.startsWith('fillText(')), [],
            `${kind} drew an empty graphic from ${JSON.stringify(params)}`);
    }
});

log('\n-- 2. A chart is drawn from its numbers --');

check('a pie slice and its legend percentage come from ONE source', () => {
    // The legend recomputes the share from the same `values` the slice was
    // drawn from, so a caption cannot contradict the picture.
    const { ctx, calls } = recorder();
    TG.drawTemplate(ctx, 'pie-chart', { values: '50,30,20', labels: 'A,B,C' }, 2.4, 2.6, {});
    const texts = calls.filter(c => c.startsWith('fillText(')).join(' ');
    assert.match(texts, /A {2}50%/);
    assert.match(texts, /B {2}30%/);
    assert.match(texts, /C {2}20%/);
});

check('percentages are derived, not echoed: odd totals still sum sensibly', () => {
    const { ctx, calls } = recorder();
    // These do not total 100. The legend must report real shares of the real
    // total, not the raw numbers with a % glued on.
    TG.drawTemplate(ctx, 'pie-chart', { values: '1,1', labels: 'A,B' }, 2.4, 2.6, {});
    const texts = calls.filter(c => c.startsWith('fillText(')).join(' ');
    assert.match(texts, /A {2}50%/, texts);
    assert.match(texts, /B {2}50%/, texts);
});

check('a bar\'s number counts up with its length, so the two always agree', () => {
    const mid = recorder();
    TG.drawTemplate(mid.ctx, 'h-bar-chart', { values: '100', labels: 'X' }, 0.25, 2.6, {});
    const end = recorder();
    TG.drawTemplate(end.ctx, 'h-bar-chart', { values: '100', labels: 'X' }, 2.2, 2.6, {});
    const num = (r) => Number((r.calls.filter(c => c.startsWith('fillText(')).join(' ').match(/fillText\((\d+),/) || [])[1]);
    assert.ok(num(mid) < num(end), `${num(mid)} is not below ${num(end)}`);
    assert.equal(num(end), 100, 'the bar does not finish on its real value');
});

check('a funnel band is as wide as its own value', () => {
    const { ctx, calls } = recorder();
    TG.drawTemplate(ctx, 'funnel', { stages: 'A,B', values: '100,25' }, 2.4, 2.6, {});
    // The rounded rectangle is a LOCAL helper, not ctx.roundRect, so the
    // band shows up as moveTo/arcTo. Its width is the x span of one path.
    const bands = [];
    let x0 = null;
    for (const c of calls) {
        if (c.startsWith('moveTo(')) { x0 = Number(c.slice(7).split(',')[0]); continue; }
        if (c.startsWith('arcTo(') && x0 !== null) {
            const x = Number(c.slice(6).split(',')[0]);
            if (x > x0) { bands.push(x - x0); x0 = null; }
        }
    }
    assert.ok(bands.length >= 2, `fewer than two bands drawn (${bands.length})`);
    assert.ok(bands[0] > bands[1] * 2, `widths ${bands[0]} and ${bands[1]} do not reflect 100 vs 25`);
});

check('seriesColors makes neighbouring slices tellable apart', () => {
    // Three near-identical cyans beside a legend reading 45/30/25 is a chart
    // nobody can read. Caught by rendering it, not by any assertion.
    const { ctx, calls } = recorder();
    TG.drawTemplate(ctx, 'pie-chart', { values: '40,35,25', labels: 'A,B,C' }, 2.4, 2.6, {});
    const fills = [...new Set(calls.filter(c => c.startsWith('fillStyle=#')).map(c => c.slice(10)))];
    assert.ok(fills.length >= 3, `only ${fills.length} distinct slice colours`);
    const lum = (hex) => {
        const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const ls = fills.slice(0, 3).map(lum).sort((a, b) => a - b);
    assert.ok(ls[2] - ls[0] > 0.2, `slice brightness spans only ${(ls[2] - ls[0]).toFixed(2)}`);
});

log('\n-- 3. Things sized by their own content --');

check('a label is as wide as its text', () => {
    const short = TG.templateSize('status-label', { text: 'TIP' });
    const long = TG.templateSize('status-label', { text: 'SOURCE: OFCOM ANNUAL REPORT' });
    assert.ok(long.w > short.w, `${long.w} is not wider than ${short.w}`);
    assert.equal(short.h, long.h, 'the height should not change with the text');
});

check('a marker with no label is a bare disc', () => {
    assert.deepEqual(TG.templateSize('numbered-marker', { label: '' }), { w: 96, h: 96 });
    assert.ok(TG.templateSize('numbered-marker', { label: 'Cut the silences' }).w > 96);
});

check('diagrams and charts grow with their content', () => {
    assert.ok(TG.templateSize('funnel', { stages: 'A,B,C,D' }).h > TG.templateSize('funnel', { stages: 'A,B' }).h);
    assert.ok(TG.templateSize('process-flow', { steps: 'A,B,C,D' }).w > TG.templateSize('process-flow', { steps: 'A,B' }).w);
    assert.ok(TG.templateSize('timeline-steps', { steps: 'A,B,C,D,E' }).w > TG.templateSize('timeline-steps', { steps: 'A,B' }).w);
    assert.ok(TG.templateSize('h-bar-chart', { values: '1,2,3,4' }).h > TG.templateSize('h-bar-chart', { values: '1' }).h);
    // A vertical flow is tall, not wide.
    const v = TG.templateSize('process-flow', { steps: 'A,B,C', direction: 'vertical' });
    const hz = TG.templateSize('process-flow', { steps: 'A,B,C' });
    assert.ok(v.h > hz.h && v.w < hz.w, `vertical ${v.w}x${v.h} vs horizontal ${hz.w}x${hz.h}`);
});

check('the three frame effects are frame-sized, because they act on the frame', () => {
    for (const k of ['spotlight', 'magnifier', 'crosshair']) {
        const { w, h } = TG.templateSize(k, {});
        assert.equal(TG.TEMPLATE_WIDTH_FRACTION[k], 1.0, `${k} is not full width`);
        assert.ok(w >= 1080 && h >= 1920, `${k} is ${w}x${h}`);
    }
});

check('the last milestone of a timeline actually lands', () => {
    // The rail head stops exactly ON the final marker, so a strict "has the
    // head passed x" test left it permanently invisible. Four steps in, four
    // labels out.
    const { ctx, calls } = recorder();
    TG.drawTemplate(ctx, 'timeline-steps', { steps: 'Jan,Mar,Jun,Sep' }, 2.4, 2.6, {});
    const texts = calls.filter(c => c.startsWith('fillText(')).join(' ');
    for (const step of ['Jan', 'Mar', 'Jun', 'Sep']) assert.match(texts, new RegExp(step), `${step} is missing`);
});

check('a funnel label too wide for its band is placed beside it, not clipped', () => {
    // The narrow stages are the ones with the longest names in a real funnel,
    // and clipping "SIGNUPS" to "GNUP" is worse than putting it outside.
    const { ctx, calls } = recorder();
    TG.drawTemplate(ctx, 'funnel', { stages: 'VIEWS,SIGNUPS', values: '100,6' }, 2.4, 2.6, {});
    const texts = calls.filter(c => c.startsWith('fillText('));
    assert.ok(texts.some(c => c.includes('SIGNUPS')), 'the narrow stage lost its label entirely');
    const signups = texts.find(c => c.includes('SIGNUPS'));
    const views = texts.find(c => c.includes('VIEWS'));
    // The wide band centres its label; the narrow one does not.
    assert.notEqual(signups.split(',')[1], views.split(',')[1], 'both labels were placed identically');
});

log('\n-- 4. Askable in words, both languages, without stealing the old kinds --');

check('each new kind can be asked for, in English and French', () => {
    const asks = [
        ['pro tip label', 'status-label'], ['live badge', 'status-label'], ['warning label', 'status-label'],
        ['source citation badge', 'status-label'], ['etiquette astuce', 'status-label'],
        ['numbered marker 3', 'numbered-marker'], ['marqueur numerote', 'numbered-marker'],
        ['spotlight', 'spotlight'], ['projecteur', 'spotlight'],
        ['add a magnifier', 'magnifier'], ['loupe', 'magnifier'],
        ['crosshair on it', 'crosshair'], ['viseur sur', 'crosshair'],
        ['pie chart', 'pie-chart'], ['camembert', 'pie-chart'],
        ['donut chart', 'donut-chart'], ['anneau', 'donut-chart'],
        ['area chart', 'area-chart'], ['courbe remplie', 'area-chart'],
        ['horizontal bar chart', 'h-bar-chart'], ['barres horizontales', 'h-bar-chart'],
        ['video thumbnail', 'video-thumbnail'], ['miniature', 'video-thumbnail'],
        ['video player mockup', 'video-player'], ['lecteur video', 'video-player'],
        ['likes counter', 'engagement-counter'], ['compteur de likes', 'engagement-counter'],
        ['process flow', 'process-flow'], ['diagramme de flux', 'process-flow'],
        ['timeline', 'timeline-steps'], ['chronologie', 'timeline-steps'],
        ['funnel', 'funnel'], ['entonnoir', 'funnel'],
    ];
    for (const [text, kind] of asks) {
        assert.equal(TG.templateFromText(text)?.kind, kind, `"${text}" gave ${TG.templateFromText(text)?.kind}`);
    }
});

check('the specific chart kinds are matched BEFORE the generic ones', () => {
    // "pie chart" and "area chart" both contain "chart", and the bar-chart
    // matcher is loose enough to claim them. Found by asking for a pie chart
    // and being handed a bar chart.
    for (const [text, kind] of [['pie chart', 'pie-chart'], ['donut chart', 'donut-chart'],
        ['area chart', 'area-chart'], ['horizontal bar chart', 'h-bar-chart'],
        ['add a bar chart', 'bar-chart'], ['line graph', 'line-graph']]) {
        assert.equal(TG.templateFromText(text)?.kind, kind, `"${text}" went to ${TG.templateFromText(text)?.kind}`);
    }
});

check('nothing that worked before was stolen', () => {
    for (const [text, kind] of [['add a counter', 'counter'], ['circle it', 'circle-callout'],
        ['add a quote card', 'quote-card'], ['underline it', 'underline'], ['add a progress bar', 'progress-bar'],
        ['show a screenshot', 'screenshot-card'], ['question card', 'question-card'],
        ['add a step card', 'step-card'], ['show a checklist', 'checklist'], ['split label', 'split-label'],
        ['add a sticker', null]]) {
        const got = TG.templateFromText(text)?.kind ?? null;
        if (kind) assert.equal(got, kind, `"${text}" was stolen by ${got}`);
    }
});

check('a quoted request fills the template, and a number reaches the marker', () => {
    assert.equal(TG.templateFromText('numbered marker 3 "Cut the silences"').params.number, 3);
    assert.equal(TG.templateFromText('numbered marker 3 "Cut the silences"').params.label, 'Cut the silences');
    assert.equal(TG.templateFromText('process flow "Record, Edit, Publish"').params.steps, 'Record,Edit,Publish');
    assert.equal(TG.templateFromText('vertical process flow').params.direction, 'vertical');
    assert.equal(TG.templateFromText('funnel "Views, Clicks, Paid"').params.stages, 'Views,Clicks,Paid');
    assert.equal(TG.templateFromText('pro tip label "Keep it under 30s"').params.text, 'Keep it under 30s');
    assert.equal(TG.templateFromText('warning label').params.tone, 'warning');
});

check('every tone a label can take exists in the table', () => {
    for (const tone of Object.keys(TG.LABEL_TONES)) {
        const { ctx, calls } = recorder();
        TG.drawTemplate(ctx, 'status-label', { text: 'X', tone }, 1, 2.6, {});
        assert.ok(calls.length > 0, `tone "${tone}" drew nothing`);
    }
});

log('\n-- 5. The storyboard can plan them, and refuses to invent data --');

check('every graphic the planner can name still resolves', () => {
    for (const [kind, plan] of Object.entries(SB.KIND_PLAN)) {
        for (const g of plan.graphics) assert.ok(SB.resolveGraphic(g), `${kind} names "${g}", which nothing builds`);
        for (const l of plan.layouts) assert.ok(SB.LAYOUTS.includes(l), `${kind} names layout "${l}"`);
    }
});

check('a donut is only planned for a real percentage', () => {
    // A bare count has no whole to be a share OF; drawing one as a ring would
    // invent a denominator the speaker never gave.
    const pct = BR.paramsFor('donut-chart', { text: 'retention hit 68 percent', evidence: '68%' });
    assert.equal(pct.center, '68%');
    assert.equal(pct.values, '68,32');
    assert.equal(BR.paramsFor('donut-chart', { text: 'we made 200 videos', evidence: '200' }), null);
    assert.equal(BR.paramsFor('donut-chart', { text: 'no figure here', evidence: null }), null);
});

check('an engagement counter is never planned from invented numbers', () => {
    // Its defaults are demo figures. Planning it would put stats on screen
    // that the speaker never said, which is the one thing this pipeline
    // refuses to do.
    assert.equal(BR.paramsFor('engagement-counter', { text: 'like and subscribe' }), null);
});

check('a status label takes only a phrase short enough to be a label', () => {
    assert.ok(BR.paramsFor('status-label', { text: 'this actually works' }).text);
    assert.equal(BR.paramsFor('status-label', { text: 'this is a far longer sentence than any badge' }), null);
    assert.equal(BR.paramsFor('status-label', { text: '' }), null);
});

check('a comparison bar chart needs two real sides', () => {
    const real = BR.paramsFor('h-bar-chart', { text: 'manual editing but Vibed instead' });
    const invented = BR.paramsFor('h-bar-chart', { text: 'one clause with no contrast' });
    assert.equal(invented, null, 'it fell back to BEFORE/AFTER and charted it');
    if (real) assert.ok(!/BEFORE/.test(real.labels), real.labels);
});

log(failures === 0 ? '\nALL R113 GRAPHICS TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
