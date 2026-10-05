// R90 (motion to-do A6/A7): word-synced cutaways, number pops, one-undo
// history groups and style recipes.
// node scripts/test_sync_recipes.mjs
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {};

let failures = 0;
const check = (name, fn) => {
    try { fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};
const checkAsync = async (name, fn) => {
    try { await fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const VET = await import('../client/src/agent/VideoEditorTools.js');
const { findSpokenNumbers, matchTranscriptToBroll, SYNC_EVENT_TYPES } = VET;
const { STYLE_RECIPES, STYLE_RECIPE_IDS, recipeFromText, recipeTransitionForCut } = await import('../client/src/motion/StyleRecipes.js');
const { TRANSITION_TYPES } = await import('../client/src/motion/TransitionFX.js');
const { CAPTION_STYLE_PACKS: STYLE_PACKS } = await import('../client/src/motion/CaptionModel.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');

const W = (arr) => arr.map(([word, start, end]) => ({ word, start, end: end ?? start + 0.3 }));

log('findSpokenNumbers');
check('price with currency word', () => {
    const r = findSpokenNumbers(W([['it', 0], ['costs', 0.3], ['49', 0.6], ['euros', 0.9]]));
    assert.equal(r.length, 1); assert.equal(r[0].text, '49€'); assert.equal(r[0].start, 0.6);
});
check('range joined', () => {
    const r = findSpokenNumbers(W([['between', 0], ['15', 0.3], ['to', 0.6], ['20', 0.8], ['dollars', 1.1]]));
    assert.equal(r[0].text, '$15-20');
});
check('French range with à and €', () => {
    const r = findSpokenNumbers(W([['entre', 0], ['15', 0.3], ['à', 0.6], ['20', 0.8], ['€', 1.1]]));
    assert.equal(r[0].text, '15-20€');
});
check('percent and magnitude', () => {
    const r = findSpokenNumbers(W([['up', 0], ['30%', 0.3], ['and', 6], ['10', 6.3], ['thousand', 6.6], ['views', 7]]));
    assert.deepEqual(r.map(n => n.text), ['30%', '10K']);
});
check('bare small number ignored, bare large only on an event', () => {
    assert.equal(findSpokenNumbers(W([['I', 0], ['have', 0.2], ['3', 0.4], ['kids', 0.6]])).length, 0);
    assert.equal(findSpokenNumbers(W([['day', 0], ['42', 0.4]])).length, 0);
    const r = findSpokenNumbers(W([['day', 0], ['42', 0.4]]), { events: [{ eventType: 'REVEAL', timelineTime: 0.5 }] });
    assert.equal(r.length, 1); assert.equal(r[0].event, 'REVEAL');
});
check('spacing and max', () => {
    const words = [];
    for (let i = 0; i < 10; i++) words.push([`${i + 10}€`, i * 1.0]);
    assert.ok(findSpokenNumbers(W(words)).length <= 3);
    assert.equal(findSpokenNumbers(W(words), { minSpacing: 0.5, max: 2 }).length, 2);
});
check('empty / bad input', () => {
    assert.deepEqual(findSpokenNumbers(null), []);
    assert.deepEqual(findSpokenNumbers([{ word: '', start: 'x' }]), []);
});

log('matchTranscriptToBroll word sync');
const words = W([['so', 0], ['today', 0.4], ['we', 0.8], ['walk', 1.2], ['through', 1.5], ['the', 1.8], ['spice', 2.1], ['market', 2.4]]);
const cands = [{ assetId: 'm', name: 'market.mp4', keywords: new Set(['market', 'spice']) }];
check('default behaviour unchanged (window start)', () => {
    const p = matchTranscriptToBroll(words, cands);
    if (p.length) { assert.equal(p[0].timelineTime, 0); assert.equal(p[0].wordTime, undefined); }
});
check('wordSync anchors on the first shared word', () => {
    const p = matchTranscriptToBroll(words, cands, [], { wordSync: true });
    assert.ok(p.length >= 1, 'placed');
    assert.equal(p[0].wordTime, 2.1);
    assert.ok(Math.abs(p[0].timelineTime - (2.1 - 0.08)) < 1e-9);
});
check('event bonus picks the candidate on the reveal', () => {
    const two = [
        { assetId: 'a', name: 'a', keywords: new Set(['today', 'walk']) },
        { assetId: 'b', name: 'b', keywords: new Set(['spice', 'market']) },
    ];
    const p = matchTranscriptToBroll(words, two, [], { wordSync: true, events: [{ eventType: 'REVEAL', timelineTime: 2.3 }] });
    assert.equal(p[0].assetId, 'b'); assert.equal(p[0].event, 'REVEAL');
    assert.equal(cands[0].keywords.size, 2, 'candidates not mutated');
});
check('event types exported', () => assert.deepEqual(SYNC_EVENT_TYPES, ['REVEAL', 'PUNCHLINE_DETECTED', 'EMPHASIS_MOMENT']));

log('history group');
const tm = window.timelineManager;
tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [
    { id: 'v1', clipId: 'e1', assetId: 'a', type: 'video', name: 'A', start: 0, duration: 10, offset: 0, speed: 1 }] }]);
useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 10, currentTime: 0, past: [], future: [], assets: [{ id: 'a', type: 'video', name: 'A', duration: 10 }] });
check('three adds inside a group make one undo step', () => {
    const s = useTimelineStore.getState();
    const before = s.past.length;
    s.beginHistoryGroup();
    try {
        s.addTemplateClip('price-pop', { text: '1€' }, { start: 1, select: false });
        s.addTemplateClip('price-pop', { text: '2€' }, { start: 4, select: false });
        s.addTemplateClip('counter', {}, { start: 6, select: false });
    } finally { s.endHistoryGroup(); }
    assert.equal(useTimelineStore.getState().past.length, before + 1);
    assert.equal(useTimelineStore.getState()._historyGroupDepth, 0);
    const n = () => useTimelineStore.getState().tracks.flatMap(t => t.clips).filter(c => c.type === 'template').length;
    assert.equal(n(), 3);
    useTimelineStore.getState().undo();
    assert.equal(n(), 0, 'one undo removes all three');
});
check('nested groups save once and outside a group history still records', () => {
    const s = useTimelineStore.getState();
    const before = s.past.length;
    s.beginHistoryGroup(); s.beginHistoryGroup();
    s.addTemplateClip('counter', {}, { start: 1, select: false });
    s.endHistoryGroup(); s.endHistoryGroup(); s.endHistoryGroup();
    assert.equal(useTimelineStore.getState()._historyGroupDepth, 0);
    assert.equal(useTimelineStore.getState().past.length, before + 1);
    useTimelineStore.getState().addTemplateClip('counter', {}, { start: 3, select: false });
    assert.equal(useTimelineStore.getState().past.length, before + 2);
});

log('placeNumberPops');
check('places on spoken numbers and is idempotent', () => {
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [
        { id: 'v1', clipId: 'e1', assetId: 'a', type: 'video', name: 'A', start: 0, duration: 20, offset: 0, speed: 1 }] }]);
    useTimelineStore.setState({ tracks: tm.toLegacyTracks(), duration: 20, past: [], future: [],
        captions: W([['only', 1], ['49', 1.4], ['euros', 1.7], ['and', 8], ['30%', 8.3], ['off', 8.6]]) });
    const tools = new VET.VideoEditorTools();
    const r1 = tools.placeNumberPops({});
    assert.equal(r1.success, true); assert.equal(r1.placed, 2);
    const pops = useTimelineStore.getState().tracks.flatMap(t => t.clips).filter(c => c.template?.kind === 'price-pop');
    assert.deepEqual(pops.map(c => c.template.params.text).sort(), ['30%', '49€']);
    assert.ok(Math.abs(pops.find(c => c.template.params.text === '49€').start - 1.3) < 1e-6);
    const r2 = tools.placeNumberPops({});
    assert.equal(r2.placed, 0);
});

log('recipes');
check('four recipes, valid transitions and caption packs', () => {
    assert.deepEqual([...STYLE_RECIPE_IDS].sort(), ['explainer', 'podcast', 'punchy', 'travel']);
    for (const id of STYLE_RECIPE_IDS) {
        const r = STYLE_RECIPES[id];
        for (const t of r.transitions?.cycle || []) assert.ok(TRANSITION_TYPES.includes(t), `${id}: ${t}`);
        if (STYLE_PACKS) assert.ok(STYLE_PACKS[r.captionPack], `${id}: pack ${r.captionPack}`);
    }
});
check('recipeFromText', () => {
    assert.equal(recipeFromText('Apply the punchy style recipe'), 'punchy');
    assert.equal(recipeFromText('make it look like a travel vlog'), 'travel');
    assert.equal(recipeFromText('style vlog voyage'), 'travel');
    assert.equal(recipeFromText('style tutoriel'), 'explainer');
    assert.equal(recipeFromText('Apply the podcast style recipe'), 'podcast');
    assert.equal(recipeFromText('style recipe'), null);
});
check('recipeTransitionForCut cycles', () => {
    const p = STYLE_RECIPES.punchy;
    const c = p.transitions.cycle;
    assert.equal(recipeTransitionForCut(p, 0).type, c[0]);
    assert.equal(recipeTransitionForCut(p, c.length).type, c[0]);
    assert.equal(recipeTransitionForCut({}, 0), null);
});

log('assistant routing');
const route = async (text) => {
    const intent = await IntentParser.parse(text);
    const plan = await EditPlanner.generatePlan(intent);
    return { steps: plan.plan?.steps || [] };
};
for (const [text, action, extra] of [
    ['Apply the punchy style recipe', 'apply_style_recipe', s => assert.equal(s.args?.recipeId, 'punchy')],
    ['Apply the travel style recipe', 'apply_style_recipe', s => assert.equal(s.args?.recipeId, 'travel')],
    ['Apply the explainer style recipe', 'apply_style_recipe', s => assert.equal(s.args?.recipeId, 'explainer')],
    ['Apply the podcast style recipe', 'apply_style_recipe', s => assert.equal(s.args?.recipeId, 'podcast')],
    ['Sync the b-roll and number pops to the words', 'sync_cutaways', null],
    ['affiche les prix', 'sync_cutaways', s => assert.equal(s.args?.broll, false)],
    ['make it punchy', 'rhythm_zoom', null],
]) {
    await checkAsync(`"${text}" → ${action}`, async () => {
        const { steps } = await route(text);
        const s = steps.find(x => x.action === action);
        assert.ok(s, `got ${steps.map(x => x.action).join(',') || 'nothing'}`);
        if (extra) extra(s);
    });
}

log('engine wiring (static: MediaExecutionEngine needs the browser)');
const eng = fs.readFileSync(new URL('../client/src/agent/MediaExecutionEngine.js', import.meta.url), 'utf8');
check('both cases run inside a history group and close it in finally', () => {
    for (const c of ['sync_cutaways', 'apply_style_recipe']) {
        const i = eng.indexOf(`case '${c}'`);
        assert.ok(i > 0, c);
        const body = eng.slice(i, i + 6000);
        assert.ok(/beginHistoryGroup\(\)/.test(body), `${c} begin`);
        assert.ok(/finally\s*\{[^}]*endHistoryGroup\(\)/.test(body), `${c} finally end`);
    }
});
check('semantic events fetched from animate-automatically', () => assert.ok(/_fetchSemanticEvents[\s\S]{0,1500}animate-automatically/.test(eng)));

log(failures ? `\n${failures} FAILURES` : '\nALL SYNC/RECIPE TESTS PASSED');
process.exit(failures ? 1 : 0);
