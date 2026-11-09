/**
 * scripts/test_short_judge.mjs
 *
 * Guards R159: the judge arbitrating WHICH PASSAGE of a long video becomes a
 * short — R158's recommendation #4, and the one place in the app where a cheap
 * semantic judgement most changes the output.
 *
 * The valuable tests here are the negative ones, because this layer is
 * optional in the strong sense: on a project with no judge model configured,
 * `null` is the normal answer and the pick must be IDENTICAL to R158's. So
 * the suite is built around four properties:
 *
 *   1. FAILS CLOSED. No judge, malformed JSON, an invented id, a rate limit,
 *      a timeout — every one leaves the heuristic's own pick standing.
 *   2. VETO, NEVER ADMIT. A verdict may drop a window the heuristic liked
 *      (the judge read the passage; the failure mode is one fewer short,
 *      disclosed). It may NOT lift a window the heuristic refused — the judge
 *      has seen a few hundred characters and not the waveform, the cut or the
 *      detected moments.
 *   3. BOUNDED. +-JUDGE_SPAN is about one real signal's worth of reach:
 *      enough to settle a near-tie, nowhere near enough to turn filler into
 *      the pick.
 *   4. CHEAP. A judge that is not cheap is not a judge, so the prompt size is
 *      asserted rather than hoped for.
 *
 * WHAT THIS SUITE DOES NOT COVER. The MediaExecutionEngine wiring is pinned by
 * source assertions, not behaviour: instantiating the engine needs the store,
 * authFetch and a DOM. The pure picker and the server service are both tested
 * behaviourally, which is where the rules actually live.
 *
 * Run: node scripts/test_short_judge.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// brainRoutes reaches config/database at import time.
process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';
process.env.SUPABASE_ANON_KEY ||= 'test';
process.env.JWT_SECRET ||= 'test';

const quiet = { log: console.log, warn: console.warn, error: console.error };
console.warn = () => {}; console.error = () => {};

const P = await import('../client/src/agent/shortPicker.js');
const SJ = require('../server/brain/ShortJudge.js');

let passed = 0, failed = 0;
const log = quiet.log;
const check = (name, fn) => {
    try { fn(); passed++; log(`  ✓ ${name}`); }
    catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
};
const acheck = async (name, fn) => {
    try { await fn(); passed++; log(`  ✓ ${name}`); }
    catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
};
const section = (t) => log(`\n${t}`);

// ── fixture: a talk with exactly one money moment ────────────────────────────
const FILLER = 'we also looked at the numbers again last quarter and they were broadly similar'.split(' ');

function talk(spec) {
    let t = 0;
    const words = [];
    const sections = {};
    const say = (sentence) => {
        for (const tok of sentence.split(' ')) { words.push({ word: tok, start: t, end: t + 0.30 }); t += 0.38; }
        t += 0.85;
    };
    for (const sec of spec) {
        const start = t;
        say(sec.opener);
        for (let i = 0; i < (sec.body ?? 7); i++) say(FILLER.slice(0, 7 + (i % 4)).join(' ') + '.');
        sections[sec.label] = { start, end: t };
    }
    return { words, sections, duration: t };
}

const GOLD_OPENER = "Here's the secret nobody tells you about pricing your work.";
const FIX = talk([
    { label: 'intro',   opener: 'Okay so today I want to talk about pricing.' },
    { label: 'setup',   opener: 'And you know a lot of people ask me about this.' },
    { label: 'GOLD',    opener: GOLD_OPENER },
    { label: 'tangent', opener: 'And then we can talk about the details later.' },
    { label: 'outro',   opener: 'So in conclusion that is roughly all I had.' },
]);
const SLOT = { platform: 'tiktok', min: 30, max: 90, target: 60 };
const POOL = P.shortWindowPool(FIX.words, { events: [], slots: [SLOT], perSlot: 3, limit: 8 });
const opensOn = (win, label) => {
    const s = FIX.sections[label];
    return win.start <= s.start + 2 && win.end >= s.start + 10;
};
const all = (conf) => Object.fromEntries(POOL.map(w => [w.id, { confidence: conf, why: 'x' }]));

// ── 1. The pool: what the judge is given ─────────────────────────────────────
section('1. The candidate pool');

check('a pool is produced, bounded by `limit`', () => {
    assert.ok(POOL.length >= 2, `expected runners-up, got ${POOL.length}`);
    assert.ok(POOL.length <= 8);
    assert.equal(P.shortWindowPool(FIX.words, { slots: [SLOT], perSlot: 3, limit: 2 }).length, 2);
});

check('no two pooled windows are the same passage', () => {
    // Without this the pool is eight trims of one moment, and the judge call
    // can only choose between LENGTHS of the same passage.
    for (let i = 0; i < POOL.length; i++) {
        for (let j = i + 1; j < POOL.length; j++) {
            const a = POOL[i], b = POOL[j];
            const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
            const shorter = Math.min(a.end - a.start, b.end - b.start);
            const frac = inter > 0 ? inter / shorter : 0;
            assert.ok(frac < 0.6, `${a.id} and ${b.id} overlap ${(frac * 100).toFixed(0)}% of the shorter`);
        }
    }
});

check('pooled windows are sentence-aligned and inside the slot', () => {
    for (const w of POOL) {
        const dur = w.end - w.start;
        assert.ok(dur >= SLOT.min - 0.01 && dur <= SLOT.max + 0.01, `${w.id} is ${dur.toFixed(1)}s`);
        assert.ok(w.opener && w.opener.length > 0, `${w.id} has no opener`);
        assert.ok(w.tail && w.tail.length > 0, `${w.id} has no tail — the judge cannot score has_payoff`);
        assert.ok(w.words > 0);
    }
});

check('the pool ranks by the same rule the picker scores by', () => {
    // If the pool ranked by one rule and the picker by another, the judge
    // would be shown a different set than the one being chosen from.
    const top = POOL[0];
    const pick = P.findShortCandidates(FIX.words, { slots: [SLOT], scoreFloor: 0 })[0];
    assert.ok(pick, 'a pick exists');
    const inter = Math.min(top.end, pick.end) - Math.max(top.start, pick.start);
    assert.ok(inter > 0, `pool top ${top.id} and pick ${P.windowId(pick.start, pick.end)} do not even overlap`);
});

check('an empty transcript pools nothing rather than throwing', () => {
    assert.deepEqual(P.shortWindowPool([], { slots: [SLOT] }), []);
    assert.deepEqual(P.shortWindowPool(null, { slots: [SLOT] }), []);
    assert.deepEqual(P.shortWindowPool(FIX.words, {}).length > 0, true, 'no slots falls back to opts itself');
});

check('ids round-trip to the times they encode', () => {
    for (const w of POOL) {
        const parsed = P.compileJudge({ [w.id]: { confidence: 0.5 } });
        assert.ok(parsed, `${w.id} did not parse`);
        assert.ok(Math.abs(parsed[0].start - w.start) < 0.01);
        assert.ok(Math.abs(parsed[0].end - w.end) < 0.01);
    }
});

// ── 2. The blend is bounded and centred ──────────────────────────────────────
section('2. judgeDelta');

check('no verdicts → no delta, whatever the shape', () => {
    for (const v of [null, undefined, {}, 'nonsense', 42, [], { bad_id: { confidence: 1 } }]) {
        const { delta, confidence } = P.judgeDelta(v, 10, 70);
        assert.equal(delta, 0, JSON.stringify(v));
        assert.equal(confidence, null);
    }
});

check('an average verdict (0.5) is exactly neutral', () => {
    const w = POOL[0];
    assert.equal(P.judgeDelta({ [w.id]: { confidence: 0.5 } }, w.start, w.end).delta, 0);
});

check('the delta is bounded by JUDGE_SPAN in both directions', () => {
    const w = POOL[0];
    assert.equal(P.judgeDelta({ [w.id]: { confidence: 1 } }, w.start, w.end).delta, P.JUDGE_SPAN);
    assert.equal(P.judgeDelta({ [w.id]: { confidence: 0 } }, w.start, w.end).delta, -P.JUDGE_SPAN);
    // Out of range is clamped, not trusted.
    assert.equal(P.judgeDelta({ [w.id]: { confidence: 99 } }, w.start, w.end).delta, P.JUDGE_SPAN);
    assert.equal(P.judgeDelta({ [w.id]: { confidence: -99 } }, w.start, w.end).delta, -P.JUDGE_SPAN);
});

check('a non-numeric confidence is silence, not a zero', () => {
    // Number(null) is 0, which would apply the FULL negative swing: the
    // judge's silence read as its harshest possible verdict.
    const w = POOL[0];
    for (const bad of ['high', null, undefined, NaN, {}, true]) {
        const { delta, confidence } = P.judgeDelta({ [w.id]: { confidence: bad } }, w.start, w.end);
        assert.equal(delta, 0, String(bad));
        assert.equal(confidence, null, String(bad));
    }
});

check('a verdict carries over to trims of the same passage', () => {
    // The pool collapses near-duplicates, so the window the judge saw is one
    // of a family. Matching on the exact id alone would let a veto be dodged
    // by shifting the window a second, and would leave the argmax's own
    // (unjudged) sibling unaffected.
    const w = POOL[0];
    const mid = (w.start + w.end) / 2;
    const trim = { start: w.start + 0.5, end: w.end - 0.5 };
    const v = { [w.id]: { confidence: 1 } };
    assert.equal(P.judgeDelta(v, trim.start, trim.end).delta, P.JUDGE_SPAN, 'a trim inherits');
    // …but a genuinely different passage does not.
    assert.equal(P.judgeDelta(v, mid + (w.end - w.start), mid + 2 * (w.end - w.start)).delta, 0,
        'a non-overlapping passage must not inherit');
});

check('JUDGE_SPAN cannot outweigh the content signals', () => {
    // A verbal hook is 3 and the event cap is 6. A span that could cross
    // those would not be arbitrating the heuristic, it would be replacing it.
    assert.ok(P.JUDGE_SPAN > 0 && P.JUDGE_SPAN <= 3, `span ${P.JUDGE_SPAN}`);
    assert.ok(P.JUDGE_SPAN * 2 < 6 + 3, 'the full swing must not cross a capped event plus a verbal hook');
});

// ── 3. Selection: veto, never admit ──────────────────────────────────────────
section('3. The judge may veto a pick, never admit one');

const pickWith = (opts) => {
    const report = {};
    const out = P.findShortCandidates(FIX.words, { slots: [SLOT], report, ...opts });
    return { out, report };
};

check('with no judge the pick is identical to R158', () => {
    const a = pickWith({ scoreFloor: 0 }).out;
    for (const v of [null, undefined, {}]) {
        const b = pickWith({ scoreFloor: 0, judgeScores: v }).out;
        assert.equal(b.length, a.length);
        assert.equal(b[0].start, a[0].start, `judgeScores=${JSON.stringify(v)} moved the pick`);
        assert.equal(b[0].end, a[0].end);
        assert.equal(b[0].score, a[0].score);
        assert.equal(b[0].judge, null);
    }
});

check('a confident verdict can move the pick onto the passage it rates', () => {
    const gold = POOL.find(w => w.opener.startsWith("Here's the secret"));
    assert.ok(gold, 'the gold passage is in the pool');
    const others = POOL.filter(w => w.id !== gold.id);
    const verdicts = { [gold.id]: { confidence: 1, why: 'the point of the video' } };
    for (const o of others) verdicts[o.id] = { confidence: 0, why: 'filler' };
    const { out, report } = pickWith({ scoreFloor: 0, judgeScores: verdicts });
    assert.ok(out.length === 1);
    assert.ok(opensOn(out[0], 'GOLD'),
        `picked ${out[0].start.toFixed(0)}-${out[0].end.toFixed(0)}s — "${out[0].text.slice(0, 48)}"`);
    assert.equal(report.judged, 1, 'the pick is recorded as judged');
    assert.equal(out[0].judge, 1);
    assert.ok(out[0].baseScore < out[0].score, 'the blended score is above the heuristic one');
});

check('the judge CANNOT lift a window the heuristic refused', () => {
    // Every pooled window adored, with a floor above every base score.
    const base = pickWith({ scoreFloor: 0 }).out[0].baseScore;
    const floor = base + 1;                      // unreachable by +JUDGE_SPAN? no — that is the point
    const { out, report } = pickWith({ scoreFloor: floor, judgeScores: all(1) });
    assert.equal(out.length, 0, 'a maximally confident judge must not admit a sub-floor window');
    assert.equal(report.belowFloor.length, 1);
    assert.equal(report.judgeVetoed.length, 0, 'this is the heuristic refusing, not the judge');
});

check('the judge CAN veto a window the heuristic liked', () => {
    const base = pickWith({ scoreFloor: 0 }).out[0].baseScore;
    const floor = base - 0.5;                    // the heuristic clears it…
    const ok = pickWith({ scoreFloor: floor }).out;
    assert.equal(ok.length, 1, 'without a judge this slot is filled');
    const { out, report } = pickWith({ scoreFloor: floor, judgeScores: all(0) });
    assert.equal(out.length, 0, '…and a doubted passage is dropped');
    assert.equal(report.judgeVetoed.length, 1, 'reported as a judgement, not as arithmetic');
    assert.equal(report.belowFloor.length, 0);
    assert.ok(report.judgeVetoed[0].baseScore >= floor, 'the base score is kept, so the reason is checkable');
});

check('a vetoed slot does not block the stretch for later slots', () => {
    // Same rule R158 established for the quality floor: a rejected window is
    // never added to `taken`.
    const two = [{ ...SLOT }, { ...SLOT, platform: 'reels' }];
    const report = {};
    const out = P.findShortCandidates(FIX.words, { slots: two, scoreFloor: 0, report });
    assert.ok(out.length >= 1);
    const src = readFileSync(new URL('../client/src/agent/shortPicker.js', import.meta.url), 'utf8');
    const refuse = src.slice(src.indexOf('const vetoed = pick.baseScore'), src.indexOf('if (report && typeof pick.judge'));
    assert.ok(!/taken\.push/.test(refuse), 'a refused window must not be added to `taken`');
});

check('the floor is measured against BOTH scores, in source as well as effect', () => {
    const src = readFileSync(new URL('../client/src/agent/shortPicker.js', import.meta.url), 'utf8');
    assert.ok(/pick\.baseScore < floor \|\| pick\.score < floor/.test(src),
        'both the heuristic and the blended score must clear the floor');
});

// ── 4. The server rubric and its prompt ──────────────────────────────────────
section('4. ShortJudge: rubric, schema, prompt');

check('the rubric asks about the passage, not about the edit', () => {
    assert.equal(SJ.SHORT_RUBRIC.length, 4);
    const keys = SJ.SHORT_RUBRIC.map(r => r.key);
    assert.deepEqual(keys, ['self_contained', 'opens_strong', 'has_payoff', 'serves_through_line']);
    for (const r of SJ.SHORT_RUBRIC) assert.ok(r.text.length > 20, r.key);
});

check('the schema is derived from the rubric, so it cannot forget an axis', () => {
    const item = SJ.SHORT_JUDGE_SCHEMA.json_schema.schema.properties.verdicts.items;
    assert.equal(SJ.SHORT_JUDGE_SCHEMA.json_schema.strict, true);
    assert.equal(item.additionalProperties, false);
    for (const r of SJ.SHORT_RUBRIC) {
        assert.ok(item.properties[r.key], `${r.key} missing from the schema`);
        assert.ok(item.required.includes(r.key), `${r.key} not required`);
    }
    assert.ok(item.required.includes('id'));
    assert.ok(item.required.includes('why'));
});

const promptWindows = POOL.slice(0, 2).map(w => ({
    id: w.id, start: w.start, end: w.end, opener: w.opener, tail: w.tail, words: w.words,
}));

check('the prompt names every passage and shows how each opens and ends', () => {
    const p = SJ.buildShortJudgePrompt(promptWindows, { styleId: 'reel', platform: 'tiktok', duration: 600 });
    for (const w of promptWindows) {
        assert.ok(p.includes(w.id), `${w.id} is not in the prompt`);
        assert.ok(p.includes(w.opener.slice(0, 40)), 'the opener is not shown');
    }
    assert.ok(p.includes('reel') && p.includes('tiktok'));
    for (const r of SJ.SHORT_RUBRIC) assert.ok(p.includes(r.key), r.key);
    assert.ok(/no other id/i.test(p), 'the model must be told not to invent passages');
    assert.ok(/do NOT cut/i.test(p), 'the model must be told it is not cutting anything');
});

check('a missing through-line is declared, not guessed', () => {
    const p = SJ.buildShortJudgePrompt(promptWindows, {});
    assert.ok(/not established/.test(p));
    assert.ok(/score it 2/i.test(p), 'an axis with no basis must be told to score 2');
});

check('the prompt stays cheap at the maximum window count', () => {
    const many = Array.from({ length: SJ.MAX_WINDOWS }, (_, i) => ({
        id: `w${i}.00-${i + 60}.00`, start: i, end: i + 60, words: 170,
        opener: 'x'.repeat(400), tail: 'y'.repeat(400),
    }));
    const p = SJ.buildShortJudgePrompt(many, { throughLine: 'z'.repeat(900), opening: 'o'.repeat(900) });
    assert.ok(p.length < 6000, `prompt is ${p.length} chars — a judge that is not cheap is not a judge`);
    assert.ok(!p.includes('x'.repeat(SJ.OPENER_CHARS + 1)), 'openers must be truncated');
    assert.ok(!p.includes('y'.repeat(SJ.TAIL_CHARS + 1)), 'tails must be truncated');
});

check('MAX_WINDOWS bounds what is ever sent', () => {
    assert.ok(SJ.MAX_WINDOWS > 1 && SJ.MAX_WINDOWS <= 12);
});

// ── 5. Fail-closed, against a mock judge ─────────────────────────────────────
section('5. judgeShortWindows fails closed');

await acheck('an empty window list → null', async () => {
    assert.equal(await SJ.judgeShortWindows({ windows: [] }), null);
    assert.equal(await SJ.judgeShortWindows({}), null);
});

await acheck('malformed windows are dropped before anything is sent', async () => {
    const junk = [{ id: '', start: 0, end: 10 }, { id: 'a', start: 10, end: 5 }, { id: 'b', start: NaN, end: 1 }];
    assert.equal(await SJ.judgeShortWindows({ windows: junk }), null);
});

await acheck('no judge client configured → null', async () => {
    const prev = process.env.AI_PROVIDER, prevKey = process.env.OPENAI_API_KEY;
    try {
        delete process.env.OPENAI_API_KEY;
        process.env.AI_PROVIDER = 'openai';
        assert.equal(await SJ.judgeShortWindows({ windows: promptWindows }), null);
    } finally {
        if (prev === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = prev;
        if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
    }
});

/** Re-require ShortJudge with a stubbed AIProvider, exercising the real loop. */
const withMockJudge = (reply) => {
    const aiPath = require.resolve('../services/AIProvider.js');
    const judgePath = require.resolve('../server/brain/JudgeService.js');
    const shortPath = require.resolve('../server/brain/ShortJudge.js');
    const real = { ai: require.cache[aiPath], j: require.cache[judgePath], s: require.cache[shortPath] };
    let sent = null;

    require.cache[aiPath] = {
        id: aiPath, filename: aiPath, loaded: true,
        exports: {
            isAIConfigured: () => true,
            getAIFor: () => ({
                model: 'mock-judge', provider: 'mock',
                client: { chat: { completions: { create: async (payload) => {
                    sent = payload.messages[1].content;
                    if (reply instanceof Error) throw reply;
                    return { choices: [{ message: { content: reply } }] };
                } } } },
            }),
        },
    };
    delete require.cache[judgePath];
    delete require.cache[shortPath];
    const svc = require('../server/brain/ShortJudge.js');
    const restore = () => {
        for (const [path, mod] of [[aiPath, real.ai], [judgePath, real.j], [shortPath, real.s]]) {
            if (mod) require.cache[path] = mod; else delete require.cache[path];
        }
    };
    return { svc, restore, sent: () => sent };
};

const verdict = (id, n, why = '') => ({
    id, self_contained: n, opens_strong: n, has_payoff: n, serves_through_line: n, why,
});

await acheck('a single passage costs NO call at all', async () => {
    // Not merely "returns null": with no judge configured everything returns
    // null, so dropping the guard would pass unnoticed. The mock proves the
    // provider was never reached. One passage cannot be arbitrated against
    // anything, so the call would only cost money.
    const { svc, restore, sent } = withMockJudge(JSON.stringify({
        verdicts: [verdict(promptWindows[0].id, 5)],
    }));
    try {
        assert.equal(await svc.judgeShortWindows({ windows: [promptWindows[0]] }), null);
        assert.equal(sent(), null, 'the judge must not be called for one passage');
        // …and two DOES reach it, so the guard is not simply off.
        assert.ok(await svc.judgeShortWindows({ windows: promptWindows }));
        assert.ok(sent(), 'two passages must reach the judge');
    } finally { restore(); }
});

await acheck('a well-formed verdict normalises to 0..1 confidence', async () => {
    const [a, b] = promptWindows;
    const { svc, restore } = withMockJudge(JSON.stringify({
        verdicts: [verdict(a.id, 5, 'stands alone'), verdict(b.id, 0, 'needs the setup')],
    }));
    try {
        const out = await svc.judgeShortWindows({ windows: promptWindows });
        assert.ok(out, 'expected verdicts');
        assert.equal(out[a.id].confidence, 1);
        assert.equal(out[b.id].confidence, 0);
        assert.equal(out[a.id].why, 'stands alone');
    } finally { restore(); }
});

await acheck('a passage the judge INVENTED is dropped', async () => {
    const [a, b] = promptWindows;
    const { svc, restore } = withMockJudge(JSON.stringify({
        verdicts: [verdict(a.id, 3), verdict('w999.00-1099.00', 5, 'my own idea')],
    }));
    try {
        const out = await svc.judgeShortWindows({ windows: promptWindows });
        assert.ok(out[a.id], 'the real passage survives');
        assert.equal(out['w999.00-1099.00'], undefined, 'an invented passage must be dropped');
        assert.equal(out[b.id], undefined);
    } finally { restore(); }
});

await acheck('out-of-range axis scores are clamped and a non-number is the minimum', async () => {
    const [a] = promptWindows;
    const { svc, restore } = withMockJudge(JSON.stringify({
        verdicts: [{ id: a.id, self_contained: 99, opens_strong: -5, has_payoff: 'x', serves_through_line: 5, why: '' }],
    }));
    try {
        const out = await svc.judgeShortWindows({ windows: promptWindows });
        assert.equal(out[a.id].self_contained, 5);
        assert.equal(out[a.id].opens_strong, 0);
        assert.equal(out[a.id].has_payoff, 0, 'a non-number becomes the minimum, never a guess');
        assert.ok(out[a.id].confidence >= 0 && out[a.id].confidence <= 1);
    } finally { restore(); }
});

await acheck('malformed JSON, an empty list and a provider error are all null', async () => {
    for (const reply of ['not json', JSON.stringify({ verdicts: [] }), JSON.stringify({}), new Error('429 rate limited')]) {
        const { svc, restore } = withMockJudge(reply);
        try {
            assert.equal(await svc.judgeShortWindows({ windows: promptWindows }), null, String(reply).slice(0, 24));
        } finally { restore(); }
    }
});

await acheck('only MAX_WINDOWS passages are ever put in front of the judge', async () => {
    const many = Array.from({ length: SJ.MAX_WINDOWS + 4 }, (_, i) => ({
        id: `w${i}.00-${i + 60}.00`, start: i, end: i + 60, opener: `opener ${i}`, tail: `tail ${i}`, words: 100,
    }));
    const { svc, restore, sent } = withMockJudge(JSON.stringify({ verdicts: [verdict(many[0].id, 3)] }));
    try {
        await svc.judgeShortWindows({ windows: many });
        const prompt = sent();
        assert.ok(prompt.includes(many[0].id));
        assert.ok(!prompt.includes(many[SJ.MAX_WINDOWS].id),
            'the overflow passages must not be sent');
    } finally { restore(); }
});

// ── 6. The route ─────────────────────────────────────────────────────────────
section('6. POST /api/brain/judge-shorts');

const router = require('../server/routes/brainRoutes.js');
const layer = router.stack.find(l => l.route && l.route.path === '/judge-shorts');

check('the route is mounted and authenticated', () => {
    assert.ok(layer, '/judge-shorts is not registered');
    assert.ok(layer.route.methods.post);
    assert.ok(layer.route.stack.length >= 2, 'expected authenticateUser before the handler');
});

const callRoute = async (body) => {
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    let status = 200, payload = null;
    const res = {
        status(c) { status = c; return this; },
        json(p) { payload = p; return this; },
    };
    await handler({ body, user: { id: 'u1' } }, res, () => {});
    return { status, payload };
};

await acheck('a missing or empty window list is a 400, not a crash', async () => {
    for (const body of [undefined, {}, { windows: [] }, { windows: 'nope' }]) {
        const { status } = await callRoute(body);
        assert.equal(status, 400, JSON.stringify(body));
    }
});

await acheck('an absurd window count is refused rather than truncated silently', async () => {
    const many = Array.from({ length: SJ.MAX_WINDOWS * 2 + 1 }, (_, i) => ({ id: `w${i}.00-60.00`, start: i, end: i + 60 }));
    assert.equal((await callRoute({ windows: many })).status, 400);
});

await acheck('windows with no usable id or range are a 400', async () => {
    const { status } = await callRoute({ windows: [{ id: '', start: 0, end: 1 }, { id: 'x', start: 5, end: 5 }] });
    assert.equal(status, 400);
});

await acheck('no judge configured is a SUCCESS carrying null, never a 500', async () => {
    // A 500 here would turn an optional improvement into a dependency of
    // making shorts at all.
    const prev = process.env.AI_PROVIDER, prevKey = process.env.OPENAI_API_KEY;
    try {
        delete process.env.OPENAI_API_KEY;
        process.env.AI_PROVIDER = 'openai';
        const { status, payload } = await callRoute({ windows: promptWindows, context: { duration: 600 } });
        assert.equal(status, 200);
        assert.equal(payload.verdicts, null);
    } finally {
        if (prev === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = prev;
        if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
    }
});

// ── 7. The wiring (source-level) ─────────────────────────────────────────────
section('7. The handlers ask, and disclose');

const engine = readFileSync(new URL('../client/src/agent/MediaExecutionEngine.js', import.meta.url), 'utf8');

check('both shorts handlers pool, judge, and pass the verdicts to the picker', () => {
    assert.ok(/shortWindowPool/.test(engine), 'the pool is never built');
    assert.ok(/findShortCandidates\(words, \{ events, slots, report: pickReport, judgeScores \}\)/.test(engine),
        'repurpose_shorts must pass judgeScores');
    assert.ok(/findBestShortWindow\(words, \{ events, \.\.\.slot, judgeScores: shortJudge \}\)/.test(engine),
        'extract_short must pass judgeScores');
});

check('the judge call is bounded and never fires for a single candidate', () => {
    const from = engine.indexOf('async _judgeShortWindows');
    // NOT indexOf('_tracksWithDerivedAudioPeaks'): its first occurrence is the
    // CALL inside _fetchSemanticEvents, well above this method, which would
    // slice backwards and silently test an empty string.
    const body = engine.slice(from, engine.indexOf('\n    _tracksWithDerivedAudioPeaks(store) {', from));
    assert.ok(body.length > 200, 'the method body was not located');
    assert.ok(/pool\.length < 2/.test(body), 'one candidate must not cost a call');
    assert.ok(/timeoutSignal\(\d|timeoutSignal\(1/.test(body), 'the call must be time-bounded');
    assert.ok(/return null/.test(body) && /catch \(err\)/.test(body), 'every failure path must return null');
    assert.ok(/no_judge/.test(body), 'an unconfigured judge must be distinguished from a failure');
});

check('a veto is disclosed, and an unconfigured judge is not', () => {
    assert.ok(/judgeVetoed/.test(engine), 'a vetoed slot must be reported');
    assert.ok(/dropped after the passage was read/.test(engine), 'the reason must be the judgement, not arithmetic');
    const note = engine.slice(engine.indexOf('const judgeNote'), engine.indexOf('return {\n                    action, success: true,\n                    message: `Found'));
    assert.ok(/timeout|error/.test(note), 'a real failure is disclosed');
    assert.ok(!/no_judge/.test(note), 'an optional unconfigured feature must not be announced every run');
});

// ── done ─────────────────────────────────────────────────────────────────────
console.warn = quiet.warn; console.error = quiet.error;
log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { log('SHORT JUDGE TESTS FAILED'); process.exit(1); }
log('ALL SHORT JUDGE TESTS PASSED');
