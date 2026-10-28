// R112: moment analysis, shot boundaries, the storyboard, and the graphics it names.
// node scripts/test_storyboard.mjs
import assert from 'assert/strict';

const log = console.log;
let failures = 0;
const check = (name, fn) => {
    try { fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};

const MA = await import('../client/src/motion/MomentAnalyzer.js');
const SS = await import('../client/src/vision/ShotSampler.js');
const SB = await import('../client/src/motion/Storyboard.js');
const TG = await import('../client/src/motion/TemplateGraphics.js');

/** Words at 0.4s each from `t0`, so a phrase's timing is predictable. */
const say = (text, t0 = 0, step = 0.4) => text.split(' ').map((w, i) => ({
    word: w, start: +(t0 + i * step).toFixed(3), end: +(t0 + i * step + step * 0.85).toFixed(3),
}));

log('\n-- 1. Moments: the speaker\'s own words, at the right second --');

check('a spoken figure is a stat, carrying the figure as evidence', () => {
    const m = MA.findMoments(say('my revenue grew by forty percent.', 0));
    const stat = m.find(x => x.kind === 'stat');
    assert.ok(stat, 'no stat found');
    assert.equal(stat.evidence, '40%');
    // "forty" is word index 4 → 1.6s. The moment is ON the word, not at 0.
    assert.equal(stat.t, 1.6);
});

check('digits, currency and spelled numbers all read; a bare small count does not', () => {
    assert.equal(MA.figureAt([{ word: '40%' }], 0), '40%');
    assert.equal(MA.figureAt([{ word: '$2000' }], 0), '$2000');
    assert.equal(MA.figureAt([{ word: 'ten' }, { word: 'thousand' }], 0), '10K');
    // French writes its unit as two words, and reads across both.
    assert.equal(MA.figureAt([{ word: 'quarante' }, { word: 'pour' }, { word: 'cent' }], 0), '40%');
    assert.equal(MA.figureAt([{ word: '40' }, { word: 'pour' }, { word: 'cent' }], 0), '40%');
    // "two things" is a count, not a figure worth putting on screen.
    assert.equal(MA.figureAt([{ word: '2' }, { word: 'things' }], 0), null);
    // ...unless a unit follows it.
    assert.equal(MA.figureAt([{ word: '2' }, { word: 'million' }], 0), '2M');
});

check('French cues are read, not only English', () => {
    const fr = MA.findMoments(say('Mais le vrai probleme est simple.', 0));
    assert.equal(fr[0]?.kind, 'contrast', `got ${fr[0]?.kind}`);
    const cta = MA.findMoments(say('Le lien est dans ma bio.', 0));
    assert.ok(cta.some(m => m.kind === 'cta'), 'no FR cta');
});

check('a phrase stops at a pause, so it never quotes the next sentence', () => {
    const words = [
        ...say('But the reason', 0),
        // A one-second silence, then a new sentence.
        ...say('completely different thing here', 2.5),
    ];
    const m = MA.findMoments(words);
    assert.equal(m[0].kind, 'contrast');
    assert.ok(!/completely/.test(m[0].text), `phrase ran through the pause: "${m[0].text}"`);
});

check('a phrase never ends on a dangling connector', () => {
    const p = MA.phraseAt(say('first you record the'), 0);
    assert.ok(!/\b(the|and|of)$/.test(p.text), `dangling: "${p.text}"`);
});

check('nothing is invented: every moment\'s text is a slice of what was said', () => {
    const words = say('So last year my revenue grew by forty percent.', 0);
    const spoken = words.map(w => w.word).join(' ');
    for (const m of MA.findMoments(words)) {
        for (const w of m.text.split(' ')) assert.ok(spoken.includes(w), `"${w}" was never said`);
    }
});

check('two moments inside the hold window collapse to the stronger one', () => {
    // "never" (emphasis, 2) and "40%" (stat, 10) land 0.4s apart.
    const m = MA.findMoments(say('I never made 40% before.', 0));
    assert.equal(m.length, 1, `expected one moment, got ${m.map(x => x.kind).join()}`);
    assert.equal(m[0].kind, 'stat');
});

check('capping by weight keeps the late video, not just the first third', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ t: i * 5, kind: 'claim', text: 'x', weight: i === 9 ? 99 : 1 }));
    const kept = MA.capMoments(many, { max: 2 });
    assert.equal(kept.length, 2);
    assert.ok(kept.some(m => m.t === 45), 'the strongest late moment was truncated away');
    assert.deepEqual(kept.map(m => m.t), [...kept.map(m => m.t)].sort((a, b) => a - b), 'not in time order');
});

check('junk input gives no moments and never throws', () => {
    for (const bad of [null, undefined, [], [{}], [{ word: 'x' }], 'nope']) {
        assert.deepEqual(MA.findMoments(bad), [], JSON.stringify(bad));
    }
});

log('\n-- 2. Shot boundaries: adaptive, so a handheld clip is not all cuts --');

const frame = (r, g, b, n = 24 * 14) => {
    const a = [];
    for (let i = 0; i < n; i++) a.push(r, g, b, 255);
    return a;
};
const noisy = (r, g, b, seed) => frame(r + (seed % 7), g, b);

check('a histogram is normalised and a flat frame fills one bucket', () => {
    const h = SS.histogram(frame(10, 10, 10));
    assert.equal(+h.reduce((a, b) => a + b, 0).toFixed(6), 1);
    assert.equal(h.filter(x => x > 0).length, 1);
    assert.deepEqual(SS.histogram([]).filter(x => x > 0), [], 'empty buffer must not divide by zero');
});

check('identical frames are distance 0, opposite frames distance 1', () => {
    assert.equal(SS.histogramDistance(SS.histogram(frame(0, 0, 0)), SS.histogram(frame(0, 0, 0))), 0);
    assert.equal(SS.histogramDistance(SS.histogram(frame(0, 0, 0)), SS.histogram(frame(250, 250, 250))), 1);
});

check('a locked-off clip reports only the real cut', () => {
    const s = [];
    for (let i = 0; i < 10; i++) s.push({ t: i * 0.5, hist: SS.histogram(noisy(30, 40, 50, i)) });
    for (let i = 10; i < 20; i++) s.push({ t: i * 0.5, hist: SS.histogram(noisy(200, 180, 160, i)) });
    assert.deepEqual(SS.boundariesFrom(s).cuts, [5]);
});

check('a noisy handheld clip with no cut reports no cut (the adaptive bar earns its place)', () => {
    // A real handheld shot: the same scene, with a slice of the frame moving
    // into another colour bin each sample. The distance sits ABOVE CUT_FLOOR,
    // so only the adaptive bar can suppress it — which is the whole point of
    // measuring against the clip's own median rather than a constant.
    const handheld = (seed) => {
        const n = 24 * 14;
        const moved = Math.round(n * [0.05, 0.25, 0.10, 0.30][seed % 4]);
        const a = [];
        for (let i = 0; i < n; i++) {
            const shifted = i < moved;
            a.push(shifted ? 140 : 60, shifted ? 150 : 70, shifted ? 160 : 80, 255);
        }
        return a;
    };
    const s = [];
    for (let i = 0; i < 20; i++) s.push({ t: i * 0.5, hist: SS.histogram(handheld(i)) });
    const r = SS.boundariesFrom(s);
    assert.ok(r.baseline > SS.CUT_FLOOR, `baseline ${r.baseline} must exceed the floor for this to prove anything`);
    assert.deepEqual(r.cuts, [], `false cuts: ${r.cuts}`);
});

check('a distance above the ceiling is a cut however busy the clip', () => {
    // Every sample differs completely. The adaptive bar alone would raise
    // itself with the median and report nothing.
    const s = [];
    for (let i = 0; i < 6; i++) s.push({ t: i, hist: SS.histogram(frame(i % 2 ? 0 : 255, i % 2 ? 0 : 255, i % 2 ? 0 : 255)) });
    assert.ok(SS.boundariesFrom(s).cuts.length >= 4, `the ceiling did not fire: ${SS.boundariesFrom(s).cuts}`);
});

check('two boundaries inside MIN_SHOT_S are one cut, not two', () => {
    const s = [
        { t: 0, hist: SS.histogram(frame(0, 0, 0)) },
        { t: 0.2, hist: SS.histogram(frame(255, 255, 255)) },
        { t: 0.4, hist: SS.histogram(frame(0, 0, 0)) },
    ];
    assert.equal(SS.boundariesFrom(s).cuts.length, 1);
});

check('shots cover the whole duration with no gap or overlap', () => {
    const shots = SS.shotsFromCuts([3, 7], 10);
    assert.deepEqual(shots.map(s => [s.start, s.end]), [[0, 3], [3, 7], [7, 10]]);
    assert.deepEqual(SS.shotsFromCuts([3], 0), [], 'no duration, no shots');
    // A cut outside the clip is ignored rather than producing a zero-length shot.
    assert.deepEqual(SS.shotsFromCuts([-2, 12], 10).map(s => [s.start, s.end]), [[0, 10]]);
});

check('nearestBoundary only answers inside its window', () => {
    assert.equal(SS.nearestBoundary([5], 4.7, 0.5), 5);
    assert.equal(SS.nearestBoundary([5], 4.2, 0.5), null);
    assert.equal(SS.nearestBoundary([], 4.7), null);
});

log('\n-- 3. The storyboard --');

const WORDS = [
    ...say('So last year my revenue grew by forty percent.', 0),
    ...say('But the real reason is simple.', 8),
    ...say('First you record, second you upload.', 16),
    ...say('I use Vibed every single day now.', 22),
    ...say('Want to try it? Link in bio.', 28),
];

check('beats carry the speaker\'s words, a layout, a graphic and a reason', () => {
    const { beats } = SB.planStoryboard({ words: WORDS, duration: 34 });
    assert.ok(beats.length >= 3, `only ${beats.length} beats`);
    for (const b of beats) {
        assert.ok(b.text && b.layout && b.graphic && b.reason, JSON.stringify(b));
        assert.ok(SB.LAYOUTS.includes(b.layout), `unknown layout ${b.layout}`);
        assert.ok(b.end > b.start, 'beat ends before it starts');
    }
});

check('every graphic a plan can name resolves to a template or a component', () => {
    for (const [kind, plan] of Object.entries(SB.KIND_PLAN)) {
        for (const g of plan.graphics) {
            assert.ok(SB.resolveGraphic(g), `${kind} names "${g}", which nothing builds`);
        }
        assert.ok(plan.layouts.every(l => SB.LAYOUTS.includes(l)), `${kind} names an unknown layout`);
    }
});

check('beats never overlap, and never run past the video', () => {
    const { beats } = SB.planStoryboard({ words: WORDS, duration: 34 });
    for (let i = 0; i < beats.length - 1; i++) {
        assert.ok(beats[i].end <= beats[i + 1].start, `${beats[i].id} overlaps ${beats[i + 1].id}`);
    }
    assert.ok(beats[beats.length - 1].end <= 34);
});

check('every beat is held long enough to read', () => {
    const { beats } = SB.planStoryboard({ words: WORDS, duration: 34 });
    for (const b of beats) {
        assert.ok(b.end - b.start >= 0.4, `${b.id} holds ${b.end - b.start}s`);
    }
    // A two-word beat still gets the full minimum, not TextCraft's word floor.
    assert.ok(SB.holdFor('forty percent') >= SB.DEFAULTS.minHold);
    assert.ok(SB.holdFor('a much longer phrase than that one is by some way') <= SB.DEFAULTS.maxHold);
});

check('the same layout and the same graphic never run back to back', () => {
    const { beats } = SB.planStoryboard({ words: WORDS, duration: 34 });
    for (let i = 0; i < beats.length - 1; i++) {
        assert.notEqual(beats[i].layout, beats[i + 1].layout, `${beats[i].id} repeats its layout`);
        assert.notEqual(beats[i].graphic, beats[i + 1].graphic, `${beats[i].id} repeats its graphic`);
    }
});

check('a beat near a cut lands ON the cut', () => {
    const { beats } = SB.planStoryboard({ words: WORDS, cuts: [8.2, 16.1], duration: 34 });
    const onCut = beats.filter(b => b.onCut);
    assert.ok(onCut.length >= 2, 'nothing snapped');
    for (const b of onCut) assert.ok([8.2, 16.1].includes(b.start), `${b.id} says onCut but starts at ${b.start}`);
});

check('a cut far from every beat changes nothing', () => {
    const a = SB.planStoryboard({ words: WORDS, duration: 34 });
    const b = SB.planStoryboard({ words: WORDS, cuts: [31.9], duration: 34 });
    assert.deepEqual(a.beats.map(x => x.start), b.beats.map(x => x.start));
});

check('the opening stays clean', () => {
    const { beats } = SB.planStoryboard({ words: say('40% growth happened immediately.', 0), duration: 20 });
    for (const b of beats) assert.ok(b.start >= SB.DEFAULTS.leadIn, `a graphic at ${b.start}s is over the first words`);
});

check('density is a rate: a short video gets fewer graphics than a long one', () => {
    const short = SB.planStoryboard({ words: WORDS, duration: 12 });
    const long = SB.planStoryboard({ words: WORDS, duration: 34 });
    assert.ok(short.beats.length < long.beats.length, `${short.beats.length} vs ${long.beats.length}`);
    assert.ok(long.density <= SB.DEFAULTS.maxPerMinute + 0.01, `density ${long.density}`);
});

check('no transcript, no duration and junk all give an explained empty plan, never a throw', () => {
    for (const input of [{ words: [], duration: 30 }, { words: WORDS, duration: 0 }, {}, { words: null, duration: 10 }]) {
        const r = SB.planStoryboard(input);
        assert.deepEqual(r.beats, []);
        assert.ok(r.reasoning.length > 0, 'an empty plan with no reason given');
    }
});

check('the plan explains itself in words', () => {
    const r = SB.planStoryboard({ words: WORDS, cuts: [8.2], duration: 34 });
    assert.ok(r.reasoning.join(' ').includes('graphic beats'), r.reasoning.join(' '));
    assert.ok(r.reasoning.some(x => /moved to the cut/.test(x)), 'the snap was not explained');
});

check('clean spans are the inverse of the beats and cover the rest', () => {
    const { beats } = SB.planStoryboard({ words: WORDS, duration: 34 });
    const spans = SB.cleanSpans(beats, 34);
    for (const s of spans) {
        assert.ok(s.end > s.start, 'empty span');
        for (const b of beats) assert.ok(s.end <= b.start || s.start >= b.end, `clean span ${s.start}-${s.end} sits under ${b.id}`);
    }
    assert.equal(spans[0].start, 0);
    assert.equal(spans[spans.length - 1].end, 34);
});

log('\n-- 4. The new graphics --');

const R112_KINDS = ['step-card', 'checklist', 'question-card', 'split-label',
    'screenshot-card', 'ui-card', 'profile-portrait', 'stat-grid'];

check('each new kind is registered, sized, and has defaults and a width', () => {
    for (const k of R112_KINDS) {
        assert.ok(TG.TEMPLATE_KINDS.includes(k), `${k} not in TEMPLATE_KINDS`);
        assert.ok(TG.TEMPLATE_DEFAULTS[k], `${k} has no defaults`);
        assert.ok(TG.TEMPLATE_WIDTH_FRACTION[k] > 0, `${k} has no width fraction`);
        const { w, h } = TG.templateSize(k, {});
        assert.ok(w > 0 && h > 0, `${k} sized ${w}x${h}`);
    }
});

check('a list card grows with its content instead of clipping it', () => {
    const one = TG.templateSize('step-card', { steps: 'A' });
    const three = TG.templateSize('step-card', { steps: 'A,B,C' });
    assert.ok(three.h > one.h, `${three.h} is not taller than ${one.h}`);
    const titled = TG.templateSize('step-card', { steps: 'A', title: 'HOW' });
    assert.ok(titled.h > one.h, 'a title did not make room for itself');
    assert.ok(TG.templateSize('checklist', { items: 'A,B,C,D' }).h > TG.templateSize('checklist', { items: 'A' }).h);
    assert.ok(TG.templateSize('stat-grid', { values: '1,2,3' }).w > TG.templateSize('stat-grid', { values: '1' }).w);
});

check('drawing is pure: the same t twice gives the same picture, and nothing throws', () => {
    // A recording 2D context: every call is captured, so two runs can be
    // compared exactly. Preview and export share this code, so a draw that
    // depended on anything outside (t, params) would silently desync them.
    const calls = [];
    const rec = new Proxy({}, {
        get(_, prop) {
            if (prop === 'canvas') return { width: 1080, height: 1920 };
            if (prop === 'measureText') return (s) => ({ width: String(s).length * 11 });
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
                return () => ({ addColorStop() {} });
            }
            if (typeof prop === 'string' && /^(fillStyle|strokeStyle|lineWidth|font|globalAlpha|textAlign|textBaseline|lineCap|lineJoin|filter|shadowBlur|shadowColor|globalCompositeOperation)$/.test(prop)) return undefined;
            return (...args) => { calls.push(`${String(prop)}(${args.map(a => (typeof a === 'number' ? a.toFixed(4) : String(a))).join(',')})`); };
        },
        set(_, prop, value) { calls.push(`${String(prop)}=${String(value)}`); return true; },
    });
    for (const k of R112_KINDS) {
        calls.length = 0;
        TG.drawTemplate(rec, k, {}, 0.7, 2.6, {});
        const first = calls.join('|');
        calls.length = 0;
        TG.drawTemplate(rec, k, {}, 0.7, 2.6, {});
        assert.equal(calls.join('|'), first, `${k} draws differently on the second pass`);
        assert.ok(first.length > 0, `${k} drew nothing at all`);
    }
});

check('an empty list draws nothing rather than an empty card', () => {
    const calls = [];
    const rec = new Proxy({}, {
        get(_, p) {
            if (p === 'measureText') return (s) => ({ width: String(s).length * 11 });
            if (p === 'canvas') return { width: 1080, height: 1920 };
            return (...a) => calls.push(String(p));
        },
        set() { return true; },
    });
    for (const [k, params] of [['step-card', { steps: '' }], ['checklist', { items: ' , ' }], ['stat-grid', { values: '' }]]) {
        calls.length = 0;
        TG.drawTemplate(rec, k, params, 0.7, 2.6, {});
        assert.deepEqual(calls.filter(c => c === 'fill' || c === 'fillText'), [], `${k} drew an empty card`);
    }
});

check('t outside the clip is clamped, not extrapolated', () => {
    const noop = new Proxy({}, {
        get(_, p) {
            if (p === 'measureText') return (s) => ({ width: String(s).length * 11 });
            if (p === 'canvas') return { width: 1080, height: 1920 };
            return () => {};
        },
        set() { return true; },
    });
    for (const k of R112_KINDS) {
        for (const t of [-5, 0, 2.6, 99, NaN]) {
            TG.drawTemplate(noop, k, {}, t, 2.6, {});
        }
    }
});

check('each new kind can be asked for in words, in English and French', () => {
    const asks = [
        ['add a step card', 'step-card'], ['etape par etape', 'step-card'],
        ['show a checklist', 'checklist'], ['ajoute une liste a cocher', 'checklist'],
        ['question card "Why?"', 'question-card'], ['carte question', 'question-card'],
        ['split label', 'split-label'], ['avant apres', 'split-label'],
        ['show a screenshot', 'screenshot-card'], ['capture d ecran', 'screenshot-card'],
        ['add a ui card', 'ui-card'], ['maquette', 'ui-card'],
        ['add a profile portrait', 'profile-portrait'], ['photo de profil', 'profile-portrait'],
        ['stat grid', 'stat-grid'], ['grille de chiffres', 'stat-grid'],
    ];
    for (const [text, kind] of asks) {
        assert.equal(TG.templateFromText(text)?.kind, kind, `"${text}" gave ${TG.templateFromText(text)?.kind}`);
    }
});

check('a quoted request fills the template with the quoted content', () => {
    assert.equal(TG.templateFromText('question card "Why bother?"').params.question, 'Why bother?');
    assert.deepEqual(
        TG.templateFromText('split label "Before, After"').params,
        { left: 'Before', right: 'After' },
    );
    assert.equal(TG.templateFromText('stat grid "40%, 3x, 12k"').params.values, '40%,3x,12k');
    assert.equal(TG.templateFromText('phone screenshot').params.chrome, 'phone');
});

check('the older templates still answer their own phrasings (no regression from the new matches)', () => {
    for (const [text, kind] of [['add a counter', 'counter'], ['add a bar chart', 'bar-chart'],
        ['circle it', 'circle-callout'], ['add a quote card', 'quote-card'], ['underline it', 'underline']]) {
        assert.equal(TG.templateFromText(text)?.kind, kind, `"${text}" was stolen by a new match`);
    }
});

log(failures === 0 ? '\nALL STORYBOARD TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
