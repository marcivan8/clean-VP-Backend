/**
 * scripts/test_judge_lane.mjs
 *
 * Guards the arbitration lane: the `judge` capability in AIProvider,
 * JudgeService's fail-closed contract, and EditPolicy.blendJudge's bounded
 * blending.
 *
 * The whole point of this layer is that it can be WRONG or ABSENT without
 * changing what the app does. So the tests that matter most are the negative
 * ones: no judge configured, a malformed reply, an invented candidate, an
 * out-of-range score, a blocked candidate — every one must leave the
 * deterministic ranking standing.
 *
 * Run: node scripts/test_judge_lane.mjs
 */

import { register, createRequire } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);

import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);

globalThis.localStorage = {
    _m: {}, getItem(k) { return this._m[k] ?? null; },
    setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; },
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

const log = console.log;
console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

const AI = require('../services/AIProvider.js');
const Judge = require('../server/brain/JudgeService.js');
const P = await import('../client/src/agent/EditPolicy.js');

console.log = log;

let passed = 0, failed = 0;
const check = (name, fn) => {
    try { fn(); passed++; log(`  ✓ ${name}`); }
    catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
};
const acheck = async (name, fn) => {
    try { await fn(); passed++; log(`  ✓ ${name}`); }
    catch (e) { failed++; log(`  ✗ ${name}`); log(`      ${e.message}`); }
};
const section = (t) => log(`\n${t}`);

// ── 1. The capability lane ───────────────────────────────────────────────────
section('1. AIProvider judge lane');

check('judge is a declared capability', () => {
    assert.ok(Array.isArray(AI.CAPABILITY_PROVIDERS.judge));
    assert.ok(AI.CAPABILITY_PROVIDERS.judge.includes('groq'));
    assert.ok(AI.CAPABILITY_PROVIDERS.judge.includes('openai'));
});

check('embeddings is still the only real-only capability', () => {
    assert.deepEqual(AI.REAL_ONLY_CAPABILITIES, ['embeddings']);
});

check('AI_JUDGE_PROVIDER overrides AI_PROVIDER for judging only', () => {
    const env = { AI_PROVIDER: 'groq', AI_JUDGE_PROVIDER: 'gemini' };
    assert.equal(AI.resolveProvider({ capability: 'judge', env }), 'gemini');
    assert.equal(AI.resolveProvider({ capability: 'chat', env }), 'groq');
    assert.equal(AI.resolveProvider({ capability: 'motion', env }), 'groq');
});

check('with no override, judging follows AI_PROVIDER', () => {
    const env = { AI_PROVIDER: 'groq' };
    assert.equal(AI.resolveProvider({ capability: 'judge', env }), 'groq');
});

check('a judge model resolves, and GROQ_JUDGE_MODEL wins when set', () => {
    const prev = { p: process.env.AI_PROVIDER, j: process.env.GROQ_JUDGE_MODEL, c: process.env.GROQ_CHAT_MODEL };
    try {
        process.env.AI_PROVIDER = 'groq';
        delete process.env.GROQ_JUDGE_MODEL;
        process.env.GROQ_CHAT_MODEL = 'chat-model';
        assert.equal(AI.resolveModel('gpt-4o', 'judge'), 'chat-model',
            'defaults to the chat model so there is one name to keep current');
        process.env.GROQ_JUDGE_MODEL = 'tiny-judge';
        assert.equal(AI.resolveModel('gpt-4o', 'judge'), 'tiny-judge');
    } finally {
        if (prev.p === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = prev.p;
        if (prev.j === undefined) delete process.env.GROQ_JUDGE_MODEL; else process.env.GROQ_JUDGE_MODEL = prev.j;
        if (prev.c === undefined) delete process.env.GROQ_CHAT_MODEL; else process.env.GROQ_CHAT_MODEL = prev.c;
    }
});

// ── 2. The prompt ────────────────────────────────────────────────────────────
section('2. The judge prompt');

check('the rubric has four axes and a defined range', () => {
    assert.equal(Judge.RUBRIC.length, 4);
    assert.equal(Judge.SCORE_MIN, 0);
    assert.equal(Judge.SCORE_MAX, 5);
});

check('the prompt lists every candidate and forbids inventing one', () => {
    const prompt = Judge.buildJudgePrompt(
        [{ id: 'auto_captions', summary: 'Transcribes and adds captions.' },
         { id: 'silence_removal', summary: 'Cuts dead air.' }],
        { styleId: 'podcast', throughLine: 'how to price freelance work', duration: 1800, clipCount: 4 });
    assert.ok(prompt.includes('auto_captions'));
    assert.ok(prompt.includes('silence_removal'));
    assert.ok(/no other id/i.test(prompt));
    assert.ok(/do NOT add any/i.test(prompt));
    assert.ok(prompt.includes('podcast'));
    assert.ok(prompt.includes('how to price freelance work'));
});

check('a missing through-line tells the judge to score 2, not guess', () => {
    const prompt = Judge.buildJudgePrompt([{ id: 'auto_captions' }], {});
    assert.ok(/not established/i.test(prompt));
    assert.ok(/Do not guess high/i.test(prompt));
});

check('the schema is strict with every field required', () => {
    const item = Judge.JUDGE_SCHEMA.json_schema.schema.properties.verdicts.items;
    assert.equal(Judge.JUDGE_SCHEMA.json_schema.strict, true);
    assert.equal(item.additionalProperties, false);
    for (const r of Judge.RUBRIC) assert.ok(item.required.includes(r.key), r.key);
    assert.ok(item.required.includes('id'));
});

// ── 3. Fail-closed ───────────────────────────────────────────────────────────
section('3. JudgeService fails closed');

await acheck('no candidates → null', async () => {
    assert.equal(await Judge.judgeCandidates({ candidates: [] }), null);
    assert.equal(await Judge.judgeCandidates({}), null);
});

await acheck('only blocked candidates → null (eligibility is not a judgement)', async () => {
    const r = await Judge.judgeCandidates({
        candidates: [{ id: 'silence_removal', blocked: true }, { id: 'rhythm_zoom', blocked: true }],
    });
    assert.equal(r, null);
});

await acheck('no judge client configured → null', async () => {
    const prev = process.env.AI_PROVIDER;
    const prevKey = process.env.OPENAI_API_KEY;
    try {
        delete process.env.OPENAI_API_KEY;
        process.env.AI_PROVIDER = 'openai';
        const r = await Judge.judgeCandidates({ candidates: [{ id: 'auto_captions' }] });
        assert.equal(r, null, 'must return null rather than throwing');
    } finally {
        if (prev === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = prev;
        if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
    }
});

check('isJudgeConfigured never throws', () => {
    assert.equal(typeof Judge.isJudgeConfigured(), 'boolean');
});

check('MAX_CANDIDATES bounds what is ever sent', () => {
    assert.ok(Judge.MAX_CANDIDATES > 0 && Judge.MAX_CANDIDATES <= 20);
});

// ── 4. Blending is bounded and safe ──────────────────────────────────────────
section('4. blendJudge');

// Already in deterministic rank order, as rank() would return it.
const scored = [
    { id: 'auto_captions', score: 100, eligible: true, satisfied: false, reasons: [] },
    { id: 'enhance_audio', score: 30, eligible: true, satisfied: false, reasons: [] },
    { id: 'add_text_overlay', score: 0, eligible: true, satisfied: false, reasons: [] },
    { id: 'rhythm_zoom', score: -500, eligible: true, satisfied: true, reasons: [] },
    { id: 'silence_removal', score: -1000, eligible: false, satisfied: false, reasons: [] },
];

check('no verdicts → scores untouched and rank order preserved', () => {
    for (const v of [null, undefined, {}, 'nonsense', 42]) {
        const out = P.blendJudge(scored, v);
        assert.deepEqual(out.map(s => s.id), scored.map(s => s.id), `verdicts=${JSON.stringify(v)}`);
        assert.ok(out.every((s, i) => s.blendedScore === scored[i].score));
        assert.ok(out.every(s => s.judge === null));
    }
});

check('the output is sorted whether or not a judge ran', () => {
    // Turning the judge on or off must not change ordering by itself.
    const shuffled = [scored[2], scored[0], scored[4], scored[1], scored[3]];
    assert.deepEqual(P.blendJudge(shuffled, null).map(s => s.id), scored.map(s => s.id));
    assert.deepEqual(P.blendJudge(shuffled, {}).map(s => s.id), scored.map(s => s.id));
});

check('a non-array input is tolerated', () => {
    assert.deepEqual(P.blendJudge(null, {}), []);
    assert.deepEqual(P.blendJudge(undefined, null), []);
});

check('an average verdict (0.5) is neutral', () => {
    const out = P.blendJudge(scored, { enhance_audio: { confidence: 0.5, why: 'fine' } });
    const row = out.find(s => s.id === 'enhance_audio');
    assert.equal(row.blendedScore, 30);
});

check('a confident verdict can reorder WITHIN a tier', () => {
    const out = P.blendJudge(scored, {
        enhance_audio:    { confidence: 1.0, why: 'the audio is the problem here' },
        add_text_overlay: { confidence: 0.0, why: 'nothing to label' },
    });
    const order = out.map(s => s.id);
    assert.ok(order.indexOf('enhance_audio') < order.indexOf('add_text_overlay'));
    assert.equal(out.find(s => s.id === 'enhance_audio').blendedScore, 30 + P.JUDGE_SPAN);
});

check('a verdict can NEVER lift an already-done candidate above a runnable one', () => {
    const out = P.blendJudge(scored, {
        rhythm_zoom:   { confidence: 1.0, why: 'I love zooms' },
        enhance_audio: { confidence: 0.0, why: 'no' },
    });
    const order = out.map(s => s.id);
    assert.ok(order.indexOf('enhance_audio') < order.indexOf('rhythm_zoom'),
        `facts must outrank opinion: ${order.join(' > ')}`);
});

check('…nor lift an ineligible candidate into the plan', () => {
    const out = P.blendJudge(scored, {
        silence_removal: { confidence: 1.0, why: 'definitely do this' },
        add_text_overlay: { confidence: 0.0, why: 'no' },
    });
    const order = out.map(s => s.id);
    assert.equal(order[order.length - 1], 'silence_removal',
        `an ineligible candidate must stay last: ${order.join(' > ')}`);
});

check('an unknown id in the verdicts is ignored', () => {
    const out = P.blendJudge(scored, { not_a_candidate: { confidence: 1.0 } });
    assert.equal(out.length, scored.length);
    assert.ok(out.every(s => s.judge === null));
});

check('a candidate with no verdict keeps its own score', () => {
    const out = P.blendJudge(scored, { enhance_audio: { confidence: 1.0 } });
    assert.equal(out.find(s => s.id === 'auto_captions').blendedScore, 100);
    assert.equal(out.find(s => s.id === 'auto_captions').judge, null);
});

check('a confidence outside 0..1 is clamped, not trusted', () => {
    const high = P.blendJudge(scored, { enhance_audio: { confidence: 99 } });
    assert.equal(high.find(s => s.id === 'enhance_audio').blendedScore, 30 + P.JUDGE_SPAN);
    const low = P.blendJudge(scored, { enhance_audio: { confidence: -99 } });
    assert.equal(low.find(s => s.id === 'enhance_audio').blendedScore, 30 - P.JUDGE_SPAN);
});

check('a non-numeric confidence is treated as no verdict', () => {
    for (const bad of ['high', null, undefined, NaN, {}]) {
        const out = P.blendJudge(scored, { enhance_audio: { confidence: bad } });
        assert.equal(out.find(s => s.id === 'enhance_audio').blendedScore, 30, String(bad));
    }
});

check('JUDGE_SPAN is small enough that it cannot cross a tier', () => {
    // The tiers are -500 (already done) and -1000 (ineligible).
    assert.ok(P.JUDGE_SPAN * 2 < 500, `span ${P.JUDGE_SPAN} must not bridge the satisfied penalty`);
});

check('the blend is stable for equal scores', () => {
    const tied = [
        { id: 'b_cmd', score: 10, reasons: [] },
        { id: 'a_cmd', score: 10, reasons: [] },
    ];
    assert.deepEqual(P.blendJudge(tied, null).map(s => s.id), ['a_cmd', 'b_cmd']);
});

// ── 5. The happy path, and what it refuses, against a mock client ───────────
section('5. judgeCandidates against a mock judge');

/**
 * Re-require JudgeService with a stubbed AIProvider so the real call path —
 * prompt build, parse, validate, normalise — is exercised without a network.
 */
const withMockJudge = (reply) => {
    const aiPath = require.resolve('../services/AIProvider.js');
    const judgePath = require.resolve('../server/brain/JudgeService.js');
    const realAI = require.cache[aiPath];
    const realJudge = require.cache[judgePath];
    let sentPrompt = null;

    require.cache[aiPath] = {
        id: aiPath, filename: aiPath, loaded: true,
        exports: {
            isAIConfigured: () => true,
            getAIFor: () => ({
                model: 'mock-judge',
                provider: 'mock',
                client: {
                    chat: {
                        completions: {
                            create: async (payload) => {
                                sentPrompt = payload.messages[1].content;
                                if (reply instanceof Error) throw reply;
                                return { choices: [{ message: { content: reply } }] };
                            },
                        },
                    },
                },
            }),
        },
    };
    delete require.cache[judgePath];
    const svc = require('../server/brain/JudgeService.js');
    const restore = () => {
        if (realAI) require.cache[aiPath] = realAI; else delete require.cache[aiPath];
        if (realJudge) require.cache[judgePath] = realJudge; else delete require.cache[judgePath];
    };
    return { svc, restore, sent: () => sentPrompt };
};

const CANDIDATES = [
    { id: 'auto_captions', summary: 'Adds captions.', reasons: ['Unlocks 11 more.'] },
    { id: 'enhance_audio', summary: 'Evens out the voice.', reasons: [] },
];

await acheck('a well-formed verdict is normalised into 0..1 confidence', async () => {
    const { svc, restore } = withMockJudge(JSON.stringify({
        verdicts: [
            { id: 'auto_captions', serves_through_line: 5, right_for_style: 5, evidence_is_real: 5, right_moment: 5, why: 'always first' },
            { id: 'enhance_audio', serves_through_line: 0, right_for_style: 0, evidence_is_real: 0, right_moment: 0, why: 'not yet' },
        ],
    }));
    try {
        const out = await svc.judgeCandidates({ candidates: CANDIDATES });
        assert.ok(out, 'expected verdicts');
        assert.equal(out.auto_captions.confidence, 1);
        assert.equal(out.enhance_audio.confidence, 0);
        assert.equal(out.auto_captions.why, 'always first');
    } finally { restore(); }
});

await acheck('a candidate the judge INVENTED is dropped', async () => {
    const { svc, restore } = withMockJudge(JSON.stringify({
        verdicts: [
            { id: 'auto_captions', serves_through_line: 3, right_for_style: 3, evidence_is_real: 3, right_moment: 3, why: 'ok' },
            { id: 'queue_export', serves_through_line: 5, right_for_style: 5, evidence_is_real: 5, right_moment: 5, why: 'ship it' },
        ],
    }));
    try {
        const out = await svc.judgeCandidates({ candidates: CANDIDATES });
        assert.ok(out.auto_captions, 'the real candidate survives');
        assert.equal(out.queue_export, undefined, 'an invented candidate must be dropped');
    } finally { restore(); }
});

await acheck('out-of-range axis scores are clamped', async () => {
    const { svc, restore } = withMockJudge(JSON.stringify({
        verdicts: [{ id: 'auto_captions', serves_through_line: 99, right_for_style: -5, evidence_is_real: 'x', right_moment: 5, why: '' }],
    }));
    try {
        const out = await svc.judgeCandidates({ candidates: CANDIDATES });
        assert.equal(out.auto_captions.serves_through_line, 5);
        assert.equal(out.auto_captions.right_for_style, 0);
        assert.equal(out.auto_captions.evidence_is_real, 0, 'a non-number becomes the minimum, never a guess');
        assert.ok(out.auto_captions.confidence >= 0 && out.auto_captions.confidence <= 1);
    } finally { restore(); }
});

await acheck('malformed JSON → null, not a throw', async () => {
    const { svc, restore } = withMockJudge('this is not json');
    try { assert.equal(await svc.judgeCandidates({ candidates: CANDIDATES }), null); }
    finally { restore(); }
});

await acheck('an empty verdict list → null', async () => {
    const { svc, restore } = withMockJudge(JSON.stringify({ verdicts: [] }));
    try { assert.equal(await svc.judgeCandidates({ candidates: CANDIDATES }), null); }
    finally { restore(); }
});

await acheck('a provider error (rate limit, timeout) → null', async () => {
    const { svc, restore } = withMockJudge(new Error('429 rate limit exceeded'));
    try { assert.equal(await svc.judgeCandidates({ candidates: CANDIDATES }), null); }
    finally { restore(); }
});

await acheck('blocked candidates are never put in front of the judge', async () => {
    const { svc, restore, sent } = withMockJudge(JSON.stringify({
        verdicts: [{ id: 'auto_captions', serves_through_line: 3, right_for_style: 3, evidence_is_real: 3, right_moment: 3, why: '' }],
    }));
    try {
        await svc.judgeCandidates({
            candidates: [...CANDIDATES, { id: 'silence_removal', summary: 'Cuts dead air.', blocked: true }],
        });
        assert.ok(!sent().includes('silence_removal'),
            'a blocked candidate must not appear in the prompt');
        assert.ok(sent().includes('auto_captions'));
    } finally { restore(); }
});

await acheck('a verdict about a blocked candidate is ignored even if volunteered', async () => {
    const { svc, restore } = withMockJudge(JSON.stringify({
        verdicts: [{ id: 'silence_removal', serves_through_line: 5, right_for_style: 5, evidence_is_real: 5, right_moment: 5, why: 'do it' }],
    }));
    try {
        const out = await svc.judgeCandidates({
            candidates: [{ id: 'silence_removal', blocked: true }, ...CANDIDATES],
        });
        assert.ok(!out || out.silence_removal === undefined,
            'eligibility is a fact; a verdict cannot overturn it');
    } finally { restore(); }
});

await acheck('the end-to-end shape plugs straight into blendJudge', async () => {
    const { svc, restore } = withMockJudge(JSON.stringify({
        verdicts: [
            { id: 'enhance_audio', serves_through_line: 5, right_for_style: 5, evidence_is_real: 5, right_moment: 5, why: 'the audio is the problem' },
            { id: 'auto_captions', serves_through_line: 1, right_for_style: 1, evidence_is_real: 1, right_moment: 1, why: 'later' },
        ],
    }));
    try {
        const verdicts = await svc.judgeCandidates({ candidates: CANDIDATES });
        const blended = P.blendJudge([
            { id: 'auto_captions', score: 40, reasons: [] },
            { id: 'enhance_audio', score: 30, reasons: [] },
        ], verdicts);
        assert.equal(blended[0].id, 'enhance_audio',
            'a strong verdict should reorder a close call');
        assert.ok(blended[0].judge.why.includes('audio'));
    } finally { restore(); }
});

// ── 6. The wiring (R157): /analyze → store → chip ranking ───────────────────
section('6. The judge is wired, and inert when silent');

const { readFileSync } = await import('node:fs');
const srcOf = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

check('/analyze judges its own suggestions and returns the verdicts', () => {
    const routes = srcOf('../server/routes/brainRoutes.js');
    assert.ok(/require\('\.\.\/brain\/JudgeService'\)/.test(routes), 'JudgeService must be imported');
    assert.ok(/judgeVerdicts = await judgeCandidates\(/.test(routes),
        'verdicts must be awaited, not fire-and-forget: a late verdict would reorder chips under the cursor');
    assert.ok(/judgeVerdicts,/.test(routes), 'verdicts must be in the response');
});

check('…only when there is more than one suggestion to order', () => {
    const routes = srcOf('../server/routes/brainRoutes.js');
    assert.ok(/suggestions\.length > 1/.test(routes),
        'judging a single suggestion cannot change anything and still costs a call');
});

check('…and it is given the project context, not just the ids', () => {
    const routes = srcOf('../server/routes/brainRoutes.js');
    for (const field of ['styleId', 'throughLine', 'editsDone', 'findings']) {
        assert.ok(new RegExp(field).test(routes), `context.${field} missing`);
    }
});

check('useBrain carries the verdicts AND publishes them to the store', () => {
    const hook = srcOf('../client/src/hooks/useBrain.js');
    assert.ok(/judgeVerdicts: data\.judgeVerdicts \?\? null/.test(hook));
    assert.ok(/setJudgeVerdicts\?\.\(data\.judgeVerdicts \?\? null\)/.test(hook),
        'the non-React consumers read the store, so it has to be published there');
});

check('the store discards a non-object payload', () => {
    const store = srcOf('../client/src/store/useAIStore.js');
    assert.ok(/!Array\.isArray\(verdicts\)/.test(store),
        'an array would pass a typeof check and poison the ranking');
});

check('SuggestionEngine imports the pure blend, NOT EditPolicy', () => {
    const se = srcOf('../client/src/agent/SuggestionEngine.js');
    assert.ok(/from '\.\/judgeBlend\.js'/.test(se));
    assert.ok(!/from '\.\/EditPolicy\.js'/.test(se),
        'EditPolicy imports deriveFacts from SuggestionEngine — importing it back is circular');
});

check('EditPolicy re-exports the blend so its surface is unchanged', () => {
    const ep = srcOf('../client/src/agent/EditPolicy.js');
    assert.ok(/from '\.\/judgeBlend\.js'/.test(ep));
    assert.ok(/export \{ blendJudge, JUDGE_SPAN \}/.test(ep));
});

check('the slice to `limit` happens AFTER blending (source order)', () => {
    const se = srcOf('../client/src/agent/SuggestionEngine.js');
    const blendAt = se.indexOf('blendJudge(scored');
    const sliceAt = se.indexOf('ranked.slice(0, limit)');
    assert.ok(blendAt > 0 && sliceAt > blendAt,
        'capping first would discard the suggestions the judge might promote');
});

check('…and the merge loop does not cap early either', () => {
    const se = srcOf('../client/src/agent/SuggestionEngine.js');
    const loop = se.slice(se.indexOf('for (const a of [...brainActions'), se.indexOf('Arbitration (R157)'));
    assert.ok(!/merged\.length >= limit/.test(loop),
        'an early break in the merge loop truncates before the judge sees the candidates — '
        + 'the source-order check above cannot see that, so it is asserted directly');
});

// Behavioural: the ranking itself.
const { default: Store } = await import('../client/src/store/useTimelineStore.js');
const { default: AIStore } = await import('../client/src/store/useAIStore.js');
const SE = await import('../client/src/agent/SuggestionEngine.js');

Store.setState({
    tracks: [{ id: 'v1', type: 'video', clips: [{ id: 'c1' }, { id: 'c2' }] },
             { id: 't1', type: 'text', clips: [] }],
    assets: [{ id: 'a1', type: 'video' }],
    captions: [], editHistory: [], editingStyle: 'talking_head',
    aspectRatio: '16:9', duration: 120,
});

const BRAIN = [
    { type: 'generate_captions', text: 'Add captions', reason: 'Most watch muted' },
    { type: 'remove_silence', text: 'Remove silences', reason: 'Tightens pacing' },
    { type: 'apply_smart_zoom', text: 'Smart zoom', reason: 'Adds dynamism' },
];
const idsOf = (opts) => SE.getNextActions({ brainSuggestions: BRAIN, limit: 6, ...opts }).map(a => a.id);

const deterministic = idsOf({ judgeVerdicts: null });

check('with no verdicts the order is the deterministic one', () => {
    AIStore.getState().setJudgeVerdicts(null);
    assert.deepEqual(idsOf({}), deterministic, 'an empty store must change nothing');
});

check('a confident verdict promotes a suggestion by a few places', () => {
    AIStore.getState().setJudgeVerdicts({
        apply_smart_zoom:  { confidence: 1.0, why: 'static talking head' },
        generate_captions: { confidence: 0.05, why: 'already queued' },
    });
    const judged = idsOf({});
    assert.notDeepEqual(judged, deterministic, 'the judge must actually be able to reorder');
    assert.equal(judged[0], 'apply_smart_zoom', `got ${judged.join(' > ')}`);
    assert.ok(judged.indexOf('generate_captions') > 0, 'a doubted suggestion must fall');
    AIStore.getState().setJudgeVerdicts(null);
});

check('…but cannot move one from last to first', () => {
    // `review` is the lowest-priority rule of all; a perfect verdict must not
    // vault it over everything.
    AIStore.getState().setJudgeVerdicts({ review: { confidence: 1.0, why: 'look at it' } });
    const judged = idsOf({});
    assert.notEqual(judged[0], 'review', `a bounded judge must not rewrite the ranking: ${judged.join(' > ')}`);
    AIStore.getState().setJudgeVerdicts(null);
});

check('an explicit null overrides a populated store', () => {
    AIStore.getState().setJudgeVerdicts({ apply_smart_zoom: { confidence: 1.0 } });
    assert.deepEqual(idsOf({ judgeVerdicts: null }), deterministic);
    AIStore.getState().setJudgeVerdicts(null);
});

check('a malformed store payload falls back to deterministic', () => {
    for (const bad of ['garbage', 42, [], true]) {
        AIStore.getState().setJudgeVerdicts(bad);
        assert.equal(AIStore.getState().judgeVerdicts, null, String(bad));
        assert.deepEqual(idsOf({}), deterministic, String(bad));
    }
    AIStore.getState().setJudgeVerdicts(null);
});

check('real suggestion ids survive the ranking (no synthesised key leaks)', () => {
    AIStore.getState().setJudgeVerdicts({ apply_smart_zoom: { confidence: 1.0 } });
    const actions = SE.getNextActions({ brainSuggestions: BRAIN, limit: 6 });
    assert.ok(actions.every(a => a.id === null || !String(a.id).startsWith('label:')),
        'a synthesised label: key must not reach sendFeedback');
    AIStore.getState().setJudgeVerdicts(null);
});

check('a tight limit still surfaces a judge-promoted suggestion', () => {
    // THE case an early cap breaks: with limit 2, the third-ranked suggestion
    // can only appear if the full candidate set was blended before slicing.
    AIStore.getState().setJudgeVerdicts(null);
    const top2 = idsOf({ limit: 2 });
    assert.ok(!top2.includes('apply_smart_zoom'),
        `precondition: smart zoom must start outside the top 2, got ${top2.join(' > ')}`);

    AIStore.getState().setJudgeVerdicts({
        apply_smart_zoom:  { confidence: 1.0, why: 'static talking head' },
        generate_captions: { confidence: 0.0, why: 'already queued' },
        remove_silence:    { confidence: 0.0, why: 'nothing to cut' },
    });
    const judged2 = SE.getNextActions({ brainSuggestions: BRAIN, limit: 2 }).map(a => a.id);
    assert.ok(judged2.includes('apply_smart_zoom'),
        `a promoted suggestion must survive the cap: got ${judged2.join(' > ')}`);
    AIStore.getState().setJudgeVerdicts(null);
});

check('getQuickChips still returns prompts', () => {
    const chips = SE.getQuickChips({});
    assert.ok(Array.isArray(chips) && chips.length > 0);
    assert.ok(chips.every(c => typeof c === 'string'));
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
log('ALL JUDGE LANE TESTS PASSED');
