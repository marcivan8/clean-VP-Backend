// scripts/test_motion_knowledge_base.mjs
//
// R103 — the Motion Design Knowledge Base, end to end.
//
//   1. Library integrity, which is really a DRIFT GUARD. Every row's verbs,
//      moods, components, presets, beat kinds, tones and taxonomy values are
//      asserted against the engine's own definitions rather than a copy. A
//      technique that names motion the engine would reject does not fail
//      loudly at render time — `cleanMotionOverride` quietly substitutes the
//      look's own motion — so a typo would ship as "the technique had no
//      effect", the hardest class of bug to notice. This is the test that
//      makes the library trustworthy.
//   2. Retrieval: relevance, determinism, French, and the structured filters.
//   3. Prompt injection: the shortlist reaches the model, and its absence
//      leaves the prompt exactly as it was before techniques existed.
//   4. The beat contract: a technique id becomes executable motion, an
//      unknown id is dropped rather than passed through, and an explicit
//      motion object still wins.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

const { createRequire } = await import('module');
const nodeRequire = createRequire(path.join(ROOT, 'package.json'));

const MC = await import('../client/src/motion/MotionComposer.js');
const SC = await import('../client/src/motion/SceneComposer.js');
const SD = await import('../client/src/motion/SceneDirector.js');

const { MOTION_TECHNIQUES } = nodeRequire(path.join(ROOT, 'server/audio-engine/library/starterMotionLibrary.js'));
const IDX = nodeRequire(path.join(ROOT, 'server/audio-engine/library/MotionTechniqueIndex.js'));
const TYPES = nodeRequire(path.join(ROOT, 'server/audio-engine/types.js'));

log('\n── 1. Library integrity (drift guard against the engine itself) ──');

await check('the library is not empty and every name is unique', () => {
    assert.ok(MOTION_TECHNIQUES.length >= 30, `expected a real library, got ${MOTION_TECHNIQUES.length} rows`);
    const names = MOTION_TECHNIQUES.map(t => t.name);
    assert.equal(new Set(names).size, names.length, 'duplicate technique names would make retrieval ambiguous');
    for (const n of names) assert.match(n, /^[a-z][a-z0-9-]*$/, `"${n}" is not a slug`);
});

await check('every enter verb is an in-verb the engine knows', () => {
    for (const t of MOTION_TECHNIQUES) {
        assert.equal(MC.VERBS[t.motion.enter]?.group, 'in', `${t.name}: enter "${t.motion.enter}"`);
    }
});

await check('every emphasis verb is an emphasis-verb, or a deliberate null', () => {
    for (const t of MOTION_TECHNIQUES) {
        if (t.motion.emphasis === null) continue;
        assert.equal(MC.VERBS[t.motion.emphasis]?.group, 'emphasis', `${t.name}: emphasis "${t.motion.emphasis}"`);
    }
});

await check('every exit verb is an out-verb, or a deliberate null', () => {
    for (const t of MOTION_TECHNIQUES) {
        if (t.motion.exit === null) continue;
        assert.equal(MC.VERBS[t.motion.exit]?.group, 'out', `${t.name}: exit "${t.motion.exit}"`);
    }
});

await check('no row smuggles a hold verb into the emphasis slot', () => {
    // The five hold verbs (float/breathe/sway/drift/push-in) cannot ride in a
    // beat's motion at all — cleanMotionOverride checks the emphasis slot for
    // group 'emphasis' and would drop them. A row that used one would look
    // right in review and do nothing in the product.
    const holds = Object.entries(MC.VERBS).filter(([, v]) => v.group === 'hold').map(([k]) => k);
    assert.ok(holds.length > 0, 'the engine should still have hold verbs');
    for (const t of MOTION_TECHNIQUES) {
        assert.ok(!holds.includes(t.motion.emphasis), `${t.name} uses hold verb "${t.motion.emphasis}" as emphasis`);
        assert.ok(!holds.includes(t.motion.enter), `${t.name} uses hold verb "${t.motion.enter}" as enter`);
    }
});

await check('every motion survives cleanMotionOverride untouched', () => {
    // The real contract: if the client's validator alters a technique's motion,
    // the library is promising something the engine will not deliver.
    const fallback = { enter: 'fade-in', emphasis: 'pulse', exit: 'fade-out', energy: 0.5 };
    for (const t of MOTION_TECHNIQUES) {
        const out = SC.cleanMotionOverride(t.motion, fallback);
        assert.equal(out.enter, t.motion.enter, `${t.name}: enter was rewritten`);
        assert.equal(out.emphasis, t.motion.emphasis, `${t.name}: emphasis was rewritten`);
        assert.equal(out.exit, t.motion.exit, `${t.name}: exit was rewritten`);
        assert.equal(out.energy, t.motion.energy, `${t.name}: energy was rewritten`);
    }
});

await check('every energy is inside 0-1 and every energyLevel inside 1-5', () => {
    for (const t of MOTION_TECHNIQUES) {
        assert.ok(t.motion.energy >= 0 && t.motion.energy <= 1, `${t.name}: energy ${t.motion.energy}`);
        assert.ok(Number.isInteger(t.energyLevel) && t.energyLevel >= 1 && t.energyLevel <= 5, `${t.name}: energyLevel ${t.energyLevel}`);
    }
});

await check('every mood is one the engine defines', () => {
    for (const t of MOTION_TECHNIQUES) assert.ok(MC.MOODS[t.mood], `${t.name}: mood "${t.mood}"`);
});

await check('every component and preset exists in the LOOKS table', () => {
    for (const t of MOTION_TECHNIQUES) {
        if (!t.component) continue;
        assert.ok(SC.LOOKS[t.component], `${t.name}: component "${t.component}"`);
        if (t.preset) assert.ok(SC.LOOKS[t.component][t.preset], `${t.name}: preset "${t.preset}" under ${t.component}`);
    }
});

await check('every beat kind and tone is one the director recognises', () => {
    for (const t of MOTION_TECHNIQUES) {
        assert.ok(Array.isArray(t.beatKinds) && t.beatKinds.length > 0, `${t.name}: no beatKinds`);
        for (const b of t.beatKinds) assert.ok(SD.BEAT_KINDS.includes(b), `${t.name}: beatKind "${b}"`);
        assert.ok(Array.isArray(t.tones) && t.tones.length > 0, `${t.name}: no tones`);
        for (const tone of t.tones) assert.ok(SD.TONES[tone], `${t.name}: tone "${tone}"`);
    }
});

await check('every taxonomy value is a real enum member', () => {
    const intents = new Set(Object.values(TYPES.EditingIntent));
    const emotions = new Set(Object.values(TYPES.EmotionTag));
    const events = new Set(Object.values(TYPES.TimelineEventType));
    for (const t of MOTION_TECHNIQUES) {
        assert.equal(t.type, TYPES.AssetType.ANIMATION, `${t.name}: wrong asset type`);
        for (const i of t.editingIntents) assert.ok(intents.has(i), `${t.name}: intent ${i}`);
        for (const e of t.emotionTags) assert.ok(emotions.has(e), `${t.name}: emotion ${e}`);
        for (const ev of t.compatibleTimelineEvents) assert.ok(events.has(ev), `${t.name}: event ${ev}`);
    }
});

await check('every row carries the craft note that makes it knowledge', () => {
    for (const t of MOTION_TECHNIQUES) {
        assert.ok(typeof t.note === 'string' && t.note.length > 40, `${t.name}: note is missing or too thin`);
        assert.ok(typeof t.description === 'string' && t.description.length > 10, `${t.name}: description`);
        assert.ok(Array.isArray(t.searchKeywords) && t.searchKeywords.length >= 4, `${t.name}: too few searchKeywords to be findable`);
    }
});

await check('every beat kind the director can produce has at least one technique', () => {
    for (const kind of SD.BEAT_KINDS) {
        const hits = MOTION_TECHNIQUES.filter(t => t.beatKinds.includes(kind));
        assert.ok(hits.length > 0, `no technique covers the "${kind}" beat kind`);
    }
});

await check('every tone the director can pick has at least one technique', () => {
    for (const tone of Object.keys(SD.TONES)) {
        const hits = MOTION_TECHNIQUES.filter(t => t.tones.includes(tone));
        assert.ok(hits.length > 0, `no technique covers the "${tone}" tone`);
    }
});

log('\n── 2. Retrieval ──');

await check('a big spoken number finds the figure techniques', () => {
    const top = IDX.findTechniques('a big punchy number', { beatKind: 'stat', tone: 'viral', limit: 3 });
    assert.ok(top.length > 0, 'nothing scored');
    assert.match(top[0].technique.name, /^stat-/, `expected a stat technique first, got ${top[0].technique.name}`);
});

await check('an elegant luxury close finds the quiet close, not the punchy one', () => {
    const top = IDX.findTechniques('elegant luxury close', { beatKind: 'cta', tone: 'premium', limit: 3 });
    assert.equal(top[0].technique.name, 'cta-elegant-fade', `got ${top[0].technique.name}`);
});

await check('a French brief retrieves the same techniques as its English twin', () => {
    const fr = IDX.findTechniques('mets un gros chiffre percutant', { beatKind: 'stat', limit: 3 }).map(r => r.technique.name);
    const en = IDX.findTechniques('put a big punchy number', { beatKind: 'stat', limit: 3 }).map(r => r.technique.name);
    assert.ok(fr.length > 0, 'the French query found nothing');
    assert.ok(fr.some(n => en.includes(n)), `no overlap: FR ${JSON.stringify(fr)} vs EN ${JSON.stringify(en)}`);
});

await check('retrieval is deterministic across identical calls', () => {
    const once = IDX.findTechniques('punchy hook for a short', { tone: 'viral', limit: 6 }).map(r => r.technique.name);
    const twice = IDX.findTechniques('punchy hook for a short', { tone: 'viral', limit: 6 }).map(r => r.technique.name);
    assert.deepEqual(once, twice, 'the same query must rank identically, or the prompt is unreproducible');
});

await check('ties break by name, so order never depends on library order', () => {
    // Two rows scoring equally must come back alphabetically. Without this the
    // shortlist (and therefore the prompt) would shift whenever a row is added.
    const ranked = IDX.findTechniques('text', { limit: 24 });
    for (let i = 1; i < ranked.length; i += 1) {
        if (ranked[i].score !== ranked[i - 1].score) continue;
        assert.ok(
            ranked[i - 1].technique.name.localeCompare(ranked[i].technique.name) <= 0,
            `equal scores out of name order: ${ranked[i - 1].technique.name} before ${ranked[i].technique.name}`,
        );
    }
});

await check('naming a technique outright puts it first', () => {
    const top = IDX.findTechniques('use hook-glitch-cold-open please', { limit: 3 });
    assert.equal(top[0].technique.name, 'hook-glitch-cold-open');
    assert.ok(top[0].reasons.includes('named directly'));
});

await check('the limit is respected and bounded', () => {
    assert.equal(IDX.findTechniques('title', { limit: 2 }).length, 2);
    assert.ok(IDX.findTechniques('title', { limit: 999 }).length <= 24, 'an unbounded limit would blow up the prompt');
});

await check('a query with no signal returns nothing rather than noise', () => {
    assert.deepEqual(IDX.findTechniques('the and of a', {}), []);
    assert.deepEqual(IDX.findTechniques('', {}), []);
    assert.deepEqual(IDX.findTechniques(null, {}), []);
});

await check('structured filters alone are enough to rank', () => {
    const byEvent = IDX.findTechniques('graphic', { eventType: TYPES.TimelineEventType.SPEAKER_CHANGE, limit: 3 });
    assert.ok(byEvent.some(r => r.technique.name.startsWith('lower-third-')), 'a speaker change should surface lower thirds');
});

await check('energy steers the pick between two otherwise similar techniques', () => {
    const calm = IDX.findTechniques('number', { beatKind: 'stat', energy: 0.2, limit: 1 })[0];
    const loud = IDX.findTechniques('number', { beatKind: 'stat', energy: 1, limit: 1 })[0];
    assert.ok(calm.technique.motion.energy < loud.technique.motion.energy,
        `calm pick (${calm.technique.name} @${calm.technique.motion.energy}) should be quieter than loud pick (${loud.technique.name} @${loud.technique.motion.energy})`);
});

await check('motionForTechnique hands back a fresh object, not the library row', () => {
    const a = IDX.motionForTechnique('stat-slam-big-number');
    a.enter = 'fade-in';
    const b = IDX.motionForTechnique('stat-slam-big-number');
    assert.equal(b.enter, 'slam-in', 'a caller mutating its result corrupted the library');
    assert.equal(IDX.motionForTechnique('does-not-exist'), null);
    assert.equal(IDX.motionForTechnique(null), null);
});

await check('promptLines are compact and carry the id, the verbs and the reason', () => {
    const lines = IDX.promptLines(IDX.findTechniques('punchy hook', { limit: 2 }));
    assert.equal(lines.length, 2);
    for (const line of lines) {
        assert.match(line, /^- [a-z][a-z0-9-]*/, 'a line must start with the id the model is meant to echo back');
        assert.match(line, /energy /);
        assert.ok(line.length < 500, 'a prompt line this long would crowd out the transcript');
    }
    assert.deepEqual(IDX.promptLines(null), []);
});

await check('a spoken figure in the text retrieves the stat techniques', () => {
    // Digit strings match no keyword in any row, so without folding them to
    // "number" a transcript entirely about a figure retrieved no stat
    // technique at all — the exact miss this fold was added for.
    assert.ok(IDX.queryTokens('from zero to 40000 euros').includes('number'), 'a bare figure should fold to "number"');
    const top = IDX.findTechniques('i went from zero to 40000 euros in six weeks', { limit: 4 });
    assert.ok(top.some(r => r.technique.name.startsWith('stat-')), `no stat technique for a figure: ${top.map(r => r.technique.name).join(', ')}`);
});

log('\n── 3. The plan shortlist covers the beats the model may choose ──');

const PLAN_QUERY = 'A short-form video: open with a strong hook, surface the most important figure, close with a call to action. so i went from zero to 40000 euros in six weeks';

await check('the shortlist always offers a technique for every beat kind it covers', () => {
    const list = IDX.shortlistForPlan(PLAN_QUERY, { tone: 'viral', platform: 'tiktok', limit: 8 });
    const covered = new Set(list.flatMap(r => r.technique.beatKinds));
    for (const kind of ['intro', 'point', 'stat', 'cta']) {
        assert.ok(covered.has(kind), `nothing in the shortlist can serve a "${kind}" beat: ${list.map(r => r.technique.name).join(', ')}`);
    }
});

await check('coverage holds even for a query that scores nothing at all', () => {
    // The guarantee has to survive the degenerate case, or a brief with no
    // usable wording leaves the model with an empty palette.
    const list = IDX.shortlistForPlan('the and of a', { limit: 8 });
    const covered = new Set(list.flatMap(r => r.technique.beatKinds));
    for (const kind of ['intro', 'point', 'stat', 'cta']) {
        assert.ok(covered.has(kind), `no fallback for "${kind}"`);
    }
    assert.ok(list.every(r => !r.reasons.includes('wording')), 'a stopword-only query must not score on wording');
});

await check('an explicit beat list is what gets covered, when the caller gave one', () => {
    const list = IDX.shortlistForPlan(PLAN_QUERY, { coverBeatKinds: ['quote'], limit: 4 });
    assert.ok(list.some(r => r.technique.beatKinds.includes('quote')), 'the asked-for kind was not covered');
});

await check('the shortlist is deterministic and never duplicates a technique', () => {
    const once = IDX.shortlistForPlan(PLAN_QUERY, { tone: 'viral', limit: 8 }).map(r => r.technique.name);
    const twice = IDX.shortlistForPlan(PLAN_QUERY, { tone: 'viral', limit: 8 }).map(r => r.technique.name);
    assert.deepEqual(once, twice);
    assert.equal(new Set(once).size, once.length, 'a duplicate would waste a prompt slot');
    assert.ok(once.length <= 8);
});

await check('every shortlisted technique is a real library row', () => {
    for (const { technique } of IDX.shortlistForPlan(PLAN_QUERY, { limit: 12 })) {
        assert.ok(IDX.techniqueByName(technique.name), `${technique.name} is not in the library`);
    }
});

log('\n── 4. The shortlist reaches the model ──');

const withStubs = (fn) => {
    const Module = nodeRequire('module');
    const orig = Module.prototype.require;
    Module.prototype.require = function patched(id) {
        if (id.includes('middleware/auth')) return { authenticateUser: (q, s, n) => n(), optionalAuth: (q, s, n) => n() };
        if (id.includes('AIProvider')) return { getAIClient: () => { throw new Error('none'); }, isAIConfigured: () => false, resolveModel: m => m, resolveProvider: () => 'mock' };
        return orig.apply(this, arguments);
    };
    try { return fn(nodeRequire(path.join(ROOT, 'server/routes/motionRoutes.js'))); }
    finally { Module.prototype.require = orig; }
};

await check('the prompt lists the retrieved techniques and asks for ids', () => {
    withStubs((M) => {
        const techniques = IDX.findTechniques('punchy hook for a short', { tone: 'viral', limit: 4 });
        const prompt = M.buildScenePlanPrompt({ brief: 'A punchy hook for a short', techniques });
        for (const { technique } of techniques) {
            assert.ok(prompt.includes(technique.name), `${technique.name} missing from the prompt`);
        }
        assert.match(prompt, /"technique"/, 'the model is never told how to return a technique');
    });
});

await check('with no techniques the prompt is unchanged in shape', () => {
    withStubs((M) => {
        const bare = M.buildScenePlanPrompt({ brief: 'A punchy hook for a short' });
        assert.ok(!bare.includes('motion techniques from the library'), 'an empty shortlist should add no block at all');
        // The assertions the pre-R103 suite already makes must still hold.
        assert.match(bare, /Invent nothing/);
        assert.match(bare, /Pick ONE tone from/);
        assert.match(bare, /slam-in/);
        assert.match(bare, /punch/);
        const narrow = M.buildScenePlanPrompt({ brief: 'x', beats: ['intro', 'point', 'cta'], tone: 'premium' });
        assert.match(narrow, /intro, point, cta/);
        assert.match(narrow, /Invent nothing/);
    });
});

log('\n── 5. A technique becomes executable motion on the beat ──');

await check('a valid technique id expands into the motion the library promised', () => {
    withStubs((M) => {
        const plan = M.cleanScenePlan({ beats: [{ kind: 'intro', text: 'This changes everything', technique: 'hook-slam-headline' }] });
        const beat = plan.beats[0];
        assert.equal(beat.technique, 'hook-slam-headline');
        assert.deepEqual(beat.motion, IDX.motionForTechnique('hook-slam-headline'));
    });
});

await check('an unknown technique is dropped, leaving the look own motion to stand', () => {
    withStubs((M) => {
        const plan = M.cleanScenePlan({ beats: [{ kind: 'intro', text: 'A real title here', technique: 'not-a-real-technique' }] });
        const beat = plan.beats[0];
        assert.equal(beat.technique, undefined, 'a hallucinated id must not survive into the plan');
        assert.equal(beat.motion, undefined, 'and it must not produce motion either');
        assert.equal(beat.text, 'A real title here', 'the rest of the beat is untouched');
    });
});

await check('an explicit motion object wins over the technique', () => {
    withStubs((M) => {
        const plan = M.cleanScenePlan({
            beats: [{
                kind: 'cta',
                text: 'Follow for more',
                technique: 'cta-elegant-fade',
                motion: { enter: 'slam-in', emphasis: 'shake', energy: 0.95 },
            }],
        });
        const beat = plan.beats[0];
        assert.equal(beat.technique, 'cta-elegant-fade', 'the id is kept for the record');
        assert.equal(beat.motion.enter, 'slam-in', 'the more specific instruction should not be discarded');
        assert.equal(beat.motion.energy, 0.95);
    });
});

await check('a technique-driven motion survives the client validator too', () => {
    withStubs((M) => {
        const plan = M.cleanScenePlan({ beats: [{ kind: 'stat', value: '+184%', label: 'in six weeks', technique: 'stat-slam-big-number' }] });
        const motion = plan.beats[0].motion;
        const fallback = { enter: 'fade-in', emphasis: 'pulse', exit: 'fade-out', energy: 0.5 };
        const out = SC.cleanMotionOverride(motion, fallback);
        assert.equal(out.enter, 'slam-in', 'the round trip through both validators must preserve the technique');
        assert.equal(out.emphasis, 'shake');
    });
});

await check('every technique in the library round-trips through the beat contract', () => {
    withStubs((M) => {
        for (const t of MOTION_TECHNIQUES) {
            const kind = t.beatKinds[0];
            const raw = kind === 'stat'
                ? { kind, value: '+10%', label: 'a real label', technique: t.name }
                : { kind, text: 'A real line of text', technique: t.name };
            const plan = M.cleanScenePlan({ beats: [raw] });
            assert.ok(plan, `${t.name}: the plan came back empty`);
            const beat = plan.beats[0];
            assert.equal(beat.technique, t.name, `${t.name}: id did not survive`);
            assert.equal(beat.motion.enter, t.motion.enter, `${t.name}: enter did not survive`);
        }
    });
});

log('');
if (failures > 0) {
    log(`${failures} FAILED`);
    process.exit(1);
}
log('ALL MOTION KNOWLEDGE BASE TESTS PASSED');
