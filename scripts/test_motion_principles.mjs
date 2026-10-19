// scripts/test_motion_principles.mjs
//
// R103 round F — anticipation, follow-through and secondary action.
//
// The motion vocabulary covered timing, easing, springs, staging, transitions
// and choreography. The three principles it did not cover share one property:
// each is a RELATIONSHIP between moves, which is precisely what a vocabulary
// of 33 independent verbs cannot express.
//
//   ANTICIPATION      the engine had the WORD — Easing.js aliases
//                     'anticipate' to `backIn` — but an easing curve shapes
//                     the move itself. The principle is a separate, earlier,
//                     opposite gesture.
//   FOLLOW-THROUGH    several entrances already land on a spring, which is
//                     follow-through for one layer. Across a stack it was
//                     absent: three lines arrived one at a time and then
//                     vanished together on a single frame.
//   SECONDARY ACTION  accent shapes played the SAME verb as the text they
//                     decorate, at the same moment — a duplicate, not support.
//
// These checks are about the relationships, not about whether a verb exists.
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

const MP = await import('../client/src/motion/MotionPrinciples.js');
const MC = await import('../client/src/motion/MotionComposer.js');
const SC = await import('../client/src/motion/SceneComposer.js');
const SS = await import('../client/src/motion/SceneSchema.js');

const build = (beats, duration = 4) => MC.composeMotion({ beats }, { duration, kind: 'text' }).animations;
const byId = (anims, id) => anims.filter(a => a.presetId === `composed:${id}`);
const peakOf = (anim, prop) => anim.keyframes.map(k => k.properties[prop]).filter(v => Number.isFinite(v));

log('\n── 1. Anticipation ──');

await check('every emphasis and exit verb has a verdict, not a gap', () => {
    // The point of the table is that a verb without anticipation says WHY.
    // A missing entry is indistinguishable from an oversight, and this
    // codebase has catalogued nine features that went quiet exactly that way.
    const missing = Object.entries(MC.VERBS)
        .filter(([, v]) => v.group === 'emphasis' || v.group === 'out')
        .map(([name]) => name)
        .filter(name => !(name in MP.ANTICIPATION) && name !== 'follow-through');
    assert.deepEqual(missing, [], `no verdict recorded for: ${missing.join(', ')}`);
});

await check('entrances are excluded, and the module says why', () => {
    for (const [name, v] of Object.entries(MC.VERBS)) {
        if (v.group !== 'in') continue;
        assert.equal(
            MP.anticipationFor(name, { at: 1, duration: 0.5, energy: 0.8, group: 'in' }),
            null,
            `${name} produced an anticipation, but nothing is on screen before an entrance`,
        );
    }
    assert.match(MP.ANTICIPATION_EXCLUDES_ENTRANCES, /does not exist before it runs/);
});

await check('it is off unless asked for', () => {
    // A look written before this round must render exactly as it did.
    const before = build([{ verb: 'punch', at: 1, energy: 0.8 }]);
    assert.equal(byId(before, 'punch-anticipate').length, 0, 'a beat gained a wind-up it never asked for');
    for (const junk of [false, 0, null, 'yes', {}, -1]) {
        const got = build([{ verb: 'punch', at: 1, energy: 0.8, anticipate: junk }]);
        assert.equal(byId(got, 'punch-anticipate').length, 0, `anticipate: ${JSON.stringify(junk)} switched it on`);
    }
});

await check('a punch crouches before it grows', () => {
    const anims = build([{ verb: 'punch', at: 1.2, energy: 0.8, anticipate: true }]);
    const wind = byId(anims, 'punch-anticipate')[0];
    const punch = byId(anims, 'punch')[0];
    assert.ok(wind, 'no wind-up was produced');
    assert.ok(Math.min(...peakOf(wind, 'scale')) < 1, 'the wind-up did not scale DOWN — that is not anticipation');
    assert.ok(Math.max(...peakOf(punch, 'scale')) > 1, 'the punch should still grow');
    // It must END where the punch BEGINS: two gestures that overlap read as
    // one stutter rather than as a wind-up and a release.
    assert.ok(Math.abs((wind.startTime + wind.duration) - punch.startTime) < 0.02,
        `wind-up ends at ${(wind.startTime + wind.duration).toFixed(3)}, punch starts at ${punch.startTime}`);
    // And it returns to rest, so the punch departs from the same place it would have.
    const last = wind.keyframes[wind.keyframes.length - 1].properties;
    assert.equal(last.scale, 1, 'the wind-up did not come back to rest');
});

await check('an exit leans against its own direction of travel', () => {
    const anims = build([{ verb: 'fly-out', energy: 0.7, direction: 'left', anticipate: true }]);
    const wind = byId(anims, 'fly-out-anticipate')[0];
    const exit = byId(anims, 'fly-out')[0];
    assert.ok(wind, 'no wind-up was produced');
    const travel = peakOf(exit, 'x').find(v => v !== 0);
    const lean = peakOf(wind, 'x').find(v => v !== 0);
    assert.ok(travel < 0 && lean > 0, `exit travels ${travel} and the wind-up leans ${lean} — they should oppose`);
    assert.ok(Math.abs(lean) < Math.abs(travel) / 4, 'the wind-up is nearly as big as the move it precedes');
});

await check('an out-anchored wind-up is timed so it lands EARLIER, not later', () => {
    // The resolver places an `out` animation at
    // `layerDuration - animDuration - startTime`, so a LARGER startTime runs
    // sooner. Getting this backwards would play the wind-up after the layer
    // has already left — invisible, and the kind of thing that only shows up
    // on someone else's timeline.
    const D = 4;
    const anims = build([{ verb: 'whip-out', energy: 0.6, direction: 'left', anticipate: true }], D);
    const wind = byId(anims, 'whip-out-anticipate')[0];
    const exit = byId(anims, 'whip-out')[0];
    const startOf = a => D - a.duration - a.startTime;
    assert.ok(startOf(wind) < startOf(exit), 'the wind-up does not run before the exit');
    assert.ok(Math.abs((startOf(wind) + wind.duration) - startOf(exit)) < 0.02, 'the wind-up does not abut the exit');
});

await check('no room at the head of the clip means no anticipation, not an overlap', () => {
    const anims = build([{ verb: 'punch', at: 0, energy: 0.8, anticipate: true }]);
    assert.equal(byId(anims, 'punch-anticipate').length, 0, 'a wind-up was squeezed in before t=0');
    assert.equal(byId(anims, 'punch').length, 1, 'the punch itself was lost');
});

await check('verbs that cannot anticipate do not', () => {
    // Each of these records a reason in the table; this pins the behaviour.
    for (const verb of ['shake', 'wobble', 'flash', 'shrink-out', 'fade-out', 'blur-out']) {
        const anims = build([{ verb, at: 1.2, energy: 0.8, anticipate: true }]);
        assert.equal(byId(anims, `${verb}-anticipate`).length, 0, `${verb} produced a wind-up it has no shape for`);
        assert.ok(byId(anims, verb).length >= 1, `${verb} itself went missing`);
    }
});

log('\n── 2. Follow-through ──');

await check('the verb exists and keeps the emphasis contract', () => {
    const v = MC.VERBS['follow-through'];
    assert.ok(v, 'there is no follow-through verb');
    assert.equal(v.group, 'emphasis', 'it must be placeable mid-clip');
    // Emphasis verbs never touch opacity, so they can play on a layer that is
    // already visible without flashing it.
    const anims = build([{ verb: 'follow-through', at: 0.5, energy: 0.7, duration: 0.5 }]);
    assert.ok(anims.length, 'it produced nothing');
    for (const a of anims) {
        for (const k of a.keyframes) {
            assert.equal(k.properties.opacity, undefined, 'follow-through touched opacity');
        }
    }
});

await check('it overshoots and comes back to rest', () => {
    const [a] = build([{ verb: 'follow-through', at: 0.5, energy: 0.8, duration: 0.5 }]);
    const ys = a.keyframes.map(k => k.properties.y);
    assert.ok(Math.min(...ys) < 0 && Math.max(...ys) > 0, `y went ${JSON.stringify(ys)} — an overshoot crosses rest in both directions`);
    const last = a.keyframes[a.keyframes.length - 1].properties;
    assert.equal(last.y, 0, 'it did not settle');
    assert.equal(last.rotation, 0, 'the rotation did not settle');
});

await check('a brief that asks for a settle gets one, attached to the entrance', () => {
    // Reachability: the verb is useless if nothing can ask for it. And WHERE
    // it sits is the principle — at the tail of a move, not halfway through
    // the shot like a punch.
    const plan = MC.planMotionFromBrief('title slams in then settles', { duration: 4 });
    const beat = plan.beats.find(b => b.verb === 'follow-through');
    assert.ok(beat, `the brief produced ${JSON.stringify(plan.beats.map(b => b.verb))}`);
    assert.ok(beat.at < 0.6, `it landed at ${beat.at}s — that is a mid-clip wobble, not follow-through`);
});

await check('stack timing reverses the cascade: last in, first out', () => {
    const t = i => MP.stackTiming({ index: i, count: 3, stagger: 0.12, duration: 4 });
    assert.ok(t(0).enterAt < t(1).enterAt && t(1).enterAt < t(2).enterAt, 'entrances do not cascade');
    // An `out` startTime counts backwards from the clip end, so a LARGER
    // value leaves earlier. Index 0 is the lead and holds longest.
    assert.equal(t(0).exitAt, 0, 'the lead does not hold longest');
    assert.ok(t(2).exitAt > t(1).exitAt && t(1).exitAt > t(0).exitAt, 'exits do not cascade in reverse');
    // A lone layer has nothing to cascade with.
    assert.equal(MP.stackTiming({ index: 0, count: 1, stagger: 0.12, duration: 4 }).exitAt, 0);
});

const stackExits = (id, preset, params, duration = 4) => {
    const scene = SC.composeComponentScene(id, preset, { duration, ...params }, { aspectRatio: '9:16' });
    return SS.listNodes(scene)
        .filter(e => e.node.type === 'text')
        .map(e => (e.node.animations || []).filter(a => a.anchor === 'out').map(a => a.startTime));
};

await check('a three-line stack no longer vanishes on one frame', () => {
    // The defect: they arrived one at a time and left together, which is the
    // clearest tell of machine-made motion.
    const exits = stackExits('TitleSequence', 'cinematic', { title: 'The headline here', subtitle: 'A supporting line', kicker: 'EPISODE 4' });
    assert.equal(exits.length, 3, `expected 3 text layers, got ${exits.length}`);
    const firsts = exits.map(e => Math.min(...e));
    assert.equal(new Set(firsts).size, 3, `all three exit at ${JSON.stringify(firsts)} — still lockstep`);
    assert.ok(firsts[0] < firsts[1] && firsts[1] < firsts[2], 'the cascade is not in reverse order');
});

await check('a single-text component is left exactly as it was', () => {
    const exits = stackExits('Callout', 'dark', { text: 'This is the important part' });
    assert.equal(exits.length, 1);
    for (const t of exits[0]) assert.equal(t, 0, 'a lone layer had its exit shifted for no reason');
});

await check('a staggered exit carries its wind-up with it', () => {
    // The bug this check exists for: the re-timing pass first assigned every
    // out-anchored animation the SAME startTime, which collapsed the offset
    // an anticipation wind-up depends on — so the wind-up played on top of
    // the move it is supposed to precede.
    const scene = SC.composeComponentScene('KineticTitle', 'punchy', { title: 'Ships today now', kicker: '01', duration: 4 }, { aspectRatio: '9:16' });
    const texts = SS.listNodes(scene).filter(e => e.node.type === 'text').map(e => e.node);
    assert.ok(texts.length >= 2, 'need a stack for this check');
    let checked = 0;
    for (const node of texts) {
        const outs = (node.animations || []).filter(a => a.anchor === 'out');
        const wind = outs.find(a => /-anticipate$/.test(a.presetId || ''));
        const move = outs.find(a => !/-anticipate$/.test(a.presetId || ''));
        if (!wind || !move) continue;
        checked += 1;
        assert.ok(wind.startTime > move.startTime, `${node.name}: the wind-up no longer runs before its exit`);
    }
    assert.ok(checked >= 2, `only ${checked} layer(s) had a wind-up to check — the punchy look should anticipate its exit`);
});

await check('no exit is pushed outside the clip it belongs to', () => {
    for (const d of [1.2, 2, 4, 8]) {
        const scene = SC.composeComponentScene('TitleSequence', 'modern-bold', { title: 'The headline here', subtitle: 'A supporting line', kicker: 'EP 4', duration: d }, { aspectRatio: '9:16' });
        for (const { node } of SS.listNodes(scene)) {
            for (const a of node.animations || []) {
                if (a.anchor !== 'out') continue;
                assert.ok(a.startTime + a.duration <= d, `a ${d}s clip has an exit running to ${a.startTime + a.duration}s`);
            }
        }
    }
});

log('\n── 3. Secondary action ──');

await check('a shape is classified by what it IS, not by its name', () => {
    assert.equal(MP.accentRole('underline'), 'decoration');
    assert.equal(MP.accentRole('burst'), 'decoration');
    assert.equal(MP.accentRole('circle-callout'), 'decoration');
    // highlight-box is the ambiguous one: outlined it decorates, filled it is
    // a plate the words land on. An explicit fill settles it either way.
    assert.equal(MP.accentRole('highlight-box'), 'backdrop');
    assert.equal(MP.accentRole('underline', { fill: true }), 'backdrop', 'a filled shape is something to land on, whatever its kind');
    assert.equal(MP.accentRole('highlight-box', { fill: false }), 'decoration');
});

await check('a backdrop leads, quieter than the words it carries', () => {
    const lead = { enter: 'slam-in', exit: 'whip-out', energy: 0.9 };
    const { beats, note } = MP.secondaryActionFor(lead, { role: 'backdrop', leadAt: 0.12, duration: 4 });
    assert.ok(beats[0].at <= 0.12, `the plate arrives at ${beats[0].at}, after the words at 0.12`);
    assert.ok(beats[0].energy < lead.energy, 'the plate is as loud as the words it carries');
    assert.notEqual(beats[0].verb, lead.enter, 'the plate plays the exact same entrance as the text');
    assert.match(note, /land on it/);
});

await check('a decoration follows the words it punctuates', () => {
    const lead = { enter: 'rise-in', exit: 'fade-out', energy: 0.5 };
    const { beats, note } = MP.secondaryActionFor(lead, { role: 'decoration', leadAt: 0.12, duration: 4 });
    assert.ok(beats[0].at > 0.12, `the underline arrives at ${beats[0].at}, at or before the words at 0.12`);
    assert.match(note, /after the words/);
});

const accentOf = (id, preset, params) => {
    const scene = SC.composeComponentScene(id, preset, { duration: 4, ...params }, { aspectRatio: '9:16' });
    const nodes = SS.listNodes(scene).map(e => e.node);
    return {
        shape: nodes.find(n => n.type === 'shape'),
        text: nodes.find(n => n.type === 'text'),
    };
};
const enterOf = node => (node.animations || []).filter(a => a.anchor === 'in' && !/-anticipate$/.test(a.presetId || ''))[0];

await check('an underline no longer races the headline it underlines', () => {
    // The defect: the accent was given `motionFor(look, …)` — the SAME verb
    // as the text, starting FIRST. Two elements doing one identical move read
    // as a duplicate, not as support.
    const { shape, text } = accentOf('TitleSequence', 'cinematic', { title: 'The headline here' });
    const s = enterOf(shape);
    const t = enterOf(text);
    assert.ok(s && t, 'missing an entrance to compare');
    assert.ok(s.startTime > t.startTime, `the underline still starts at ${s.startTime} against the text's ${t.startTime}`);
});

await check('a filled plate still arrives first, so the words land on it', () => {
    const { shape, text } = accentOf('CTAWidget', 'follow', { text: 'Follow for part two' });
    const s = enterOf(shape);
    const t = enterOf(text);
    assert.ok(s.startTime <= t.startTime, `the plate arrives at ${s.startTime}, after its own label at ${t.startTime}`);
    assert.notEqual(s.presetId, t.presetId, 'the plate and its label still play the identical verb');
});

await check('no composed component has an accent that duplicates its text exactly', () => {
    // The guard, across the whole set: same verb AND same instant is the
    // signature of the defect, and it would come back the moment someone
    // reached for motionFor() again in accentNode.
    const clashes = [];
    for (const id of SC.COMPOSED_COMPONENTS) {
        for (const preset of Object.keys(SC.LOOKS[id] || {})) {
            const { shape, text } = accentOf(id, preset, { title: 'The headline here', text: 'This is the line', quote: 'It changed how I think', value: '92%', label: 'SUBSCRIBE' });
            if (!shape || !text) continue;
            const s = enterOf(shape);
            const t = enterOf(text);
            if (!s || !t) continue;
            if (s.presetId === t.presetId && Math.abs(s.startTime - t.startTime) < 0.01) {
                clashes.push(`${id}/${preset}: both ${s.presetId} at ${s.startTime}`);
            }
        }
    }
    assert.deepEqual(clashes, [], `accents moving in lockstep with their text:\n      ${clashes.join('\n      ')}`);
});

log('\n── 4. Reachable on the paths that matter ──');

await check('the default motion of a loud look really does anticipate', () => {
    // Nothing above proves the principle reaches a user: `anticipate` is
    // opt-in, and an opt-in nobody opts into is the ADR-001 pattern this
    // codebase has catalogued nine times. Loud looks turn it on by rule.
    const scene = SC.composeComponentScene('KineticTitle', 'punchy', { title: 'Ships today now', duration: 4 }, { aspectRatio: '9:16' });
    const anims = SS.listNodes(scene).flatMap(e => e.node.animations || []);
    assert.ok(anims.some(a => /-anticipate$/.test(a.presetId || '')), 'no wind-up anywhere in a punchy title');
});

await check('a calm look does not, because there it reads as a stutter', () => {
    const scene = SC.composeComponentScene('TitleSequence', 'cinematic', { title: 'A quiet opening line', duration: 4 }, { aspectRatio: '9:16' });
    const anims = SS.listNodes(scene).flatMap(e => e.node.animations || []);
    assert.ok(!anims.some(a => /-anticipate$/.test(a.presetId || '')), 'a cinematic title wound up before its moves');
});

await check('a caller or an LLM can ask for a wind-up explicitly, either way', () => {
    const on = SC.composeComponentScene('TitleSequence', 'cinematic', { title: 'A quiet opening line', duration: 4, motion: { enter: 'rise-in', emphasis: 'punch', exit: 'fade-out', energy: 0.5, anticipate: true } }, { aspectRatio: '9:16' });
    const anims = SS.listNodes(on).flatMap(e => e.node.animations || []);
    assert.ok(anims.some(a => /-anticipate$/.test(a.presetId || '')), 'an explicit request for anticipation was ignored');

    const off = SC.composeComponentScene('KineticTitle', 'punchy', { title: 'Ships today now', duration: 4, motion: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out', energy: 0.9, anticipate: false } }, { aspectRatio: '9:16' });
    const quiet = SS.listNodes(off).flatMap(e => e.node.animations || []);
    assert.ok(!quiet.some(a => /-anticipate$/.test(a.presetId || '')), 'an explicit opt-out was overridden by the energy rule');
});

const { createRequire } = await import('module');
const require_ = createRequire(import.meta.url);
const IDX = require_('../server/audio-engine/library/MotionTechniqueIndex.js');

await check('the knowledge base carries the principle too', () => {
    // The 34 catalogued techniques are the other way a beat gets its motion.
    // If anticipation stopped at the looks, a plan built from a technique id
    // would quietly lose it.
    const loud = IDX.motionForTechnique('hook-slam-headline');
    assert.equal(loud.anticipate, true, `a 0.9-energy slam does not anticipate: ${JSON.stringify(loud)}`);
    // And the same rule as the looks, not a second one: quiet techniques stay quiet.
    const all = IDX.allTechniques();
    assert.ok(all.length >= 30, `the library returned ${all.length} techniques`);
    let quiet = 0;
    for (const t of all) {
        const m = IDX.motionForTechnique(t.name);
        if (!m) continue;
        if (m.energy >= 0.7) assert.equal(m.anticipate, true, `${t.name} (energy ${m.energy}) does not anticipate`);
        else { assert.equal(m.anticipate, false, `${t.name} (energy ${m.energy}) anticipates`); quiet += 1; }
    }
    assert.ok(quiet > 0, 'no restrained technique was found to check the other half of the rule');
});

await check('the LLM is told the rules, not just the verb', () => {
    // A principle the model is never told about is a principle it will never
    // use. Both prompts carry it: the free motion script and the scene plan.
    const src = fsRead('server/routes/motionRoutes.js');
    assert.match(src, /anticipate.*wind-up AGAINST the move/s, 'the motion-script prompt does not explain anticipation');
    assert.match(src, /Follow-through: a stack that arrives one line at a time/, 'the scene-plan prompt does not explain follow-through');
    assert.match(src, /Secondary action: when two layers move together/, 'the scene-plan prompt does not explain secondary action');
    // And the sanitiser must actually let it through, or the prompt lies.
    assert.match(src, /const anticipate = raw\.anticipate === true;/, 'the server drops the field it asks the model for');
});

log(failures === 0 ? '\n✅ motion principles: all checks passed\n' : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
