// R112 round C: the camera moves, the plan is inspected, and only the broken
// beat is repaired. node scripts/test_storyboard_qa.mjs
import assert from 'assert/strict';
import fs from 'fs';

const log = console.log;
let failures = 0;
const check = (name, fn) => {
    try { fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const SB = await import('../client/src/motion/Storyboard.js');
const BR = await import('../client/src/motion/StoryboardBridge.js');
const FR = await import('../client/src/motion/StoryboardFraming.js');
const QA = await import('../client/src/motion/StoryboardQA.js');

const FRAME = { w: 1080, h: 1920 };
const SAFE = { top: 0.10, bottom: 0.20, left: 0.05, right: 0.08 };
const tpl = (id, over = {}) => ({
    beatId: over.beatId || id, graphic: id, source: 'template', id,
    params: over.params || {}, x: 50, y: 50, start: 0, duration: 2, ...over,
});

log('\n-- 1. The camera: `punch` is a real push-in --');

check('a punch writes four keyframes and always returns to 1', () => {
    const clip = { id: 'c1', _trackId: 't1', start: 0, duration: 40 };
    const { work, applied } = FR.framingPlan([{ id: 'b1', start: 5, end: 8, layout: 'punch' }], [clip]);
    assert.equal(applied, 1);
    const kfs = work[0].keyframes;
    assert.equal(kfs.length, 4);
    assert.equal(kfs[0].value, 1, 'does not start at 1');
    assert.equal(kfs[kfs.length - 1].value, 1, 'does not come back to 1');
    assert.equal(kfs[1].value, FR.PUNCH_SCALE);
    for (let i = 1; i < kfs.length; i++) assert.ok(kfs[i].time > kfs[i - 1].time, 'keyframes are not in time order');
});

check('keyframe times are CLIP-LOCAL, not timeline time', () => {
    // A clip starting at 10s: a beat at 15s is the clip's own 5s mark. Writing
    // timeline time into a clip-local field puts the move in the wrong place
    // on every clip that is not the first.
    const clip = { id: 'c1', _trackId: 't1', start: 10, duration: 30 };
    const { work } = FR.framingPlan([{ id: 'b1', start: 15, end: 18, layout: 'punch' }], [clip]);
    assert.equal(work[0].keyframes[0].time, 5, `got ${work[0].keyframes[0].time}`);
});

check('a clip that already has a zoom rhythm is left alone', () => {
    // rhythm_zoom writes keyframes.scale. Taking it over would delete a zoom
    // the user asked for, silently.
    const clip = { id: 'c1', _trackId: 't1', start: 0, duration: 40, keyframes: { scale: [{ time: 0, value: 1 }] } };
    const r = FR.framingPlan([{ id: 'b1', start: 5, end: 8, layout: 'punch' }], [clip]);
    assert.equal(r.applied, 0);
    assert.equal(r.work.length, 0, 'it wrote keyframes anyway');
    assert.match(r.refused[0].reason, /zoom rhythm/);
});

check('each refusal names its own reason, not the last one checked', () => {
    const clip = { id: 'c1', _trackId: 't1', start: 0, duration: 40 };
    const r = FR.framingPlan([
        { id: 'ok', start: 5, end: 8, layout: 'punch' },
        { id: 'tooClose', start: 8.4, end: 11, layout: 'punch' },
        { id: 'tooShort', start: 20, end: 20.8, layout: 'punch' },
        { id: 'crossesCut', start: 39, end: 42, layout: 'punch' },
    ], [clip]);
    const by = Object.fromEntries(r.refused.map(x => [x.beatId, x.reason]));
    assert.match(by.tooClose, /too close/);
    assert.match(by.tooShort, /too short/);
    assert.match(by.crossesCut, /cross a cut/);
    assert.equal(by.ok, undefined, 'a good punch was refused');
});

check('only `punch` beats move the camera', () => {
    const clip = { id: 'c1', _trackId: 't1', start: 0, duration: 40 };
    const beats = SB.LAYOUTS.filter(l => l !== 'punch').map((l, i) => ({ id: l, start: 2 + i * 5, end: 5 + i * 5, layout: l }));
    assert.equal(FR.framingPlan(beats, [clip]).applied, 0);
});

check('a layout nothing implements is not in the vocabulary', () => {
    // `broll` meant "cut away to other footage", nothing supplied the footage
    // and nothing consumed the layout: a beat could be planned as a cutaway,
    // report success and render as an ordinary card.
    assert.ok(!SB.LAYOUTS.includes('broll'), 'broll is still offered');
    for (const [kind, plan] of Object.entries(SB.KIND_PLAN)) {
        for (const l of plan.layouts) assert.ok(SB.LAYOUTS.includes(l), `${kind} plans "${l}"`);
    }
    // And every layout that IS offered has a position.
    for (const l of SB.LAYOUTS) assert.ok(BR.LAYOUT_POSITION[l], `no position for "${l}"`);
});

log('\n-- 2. The quality pass: faults of the PLAN, not of any one graphic --');

check('a graphic over the speaker is found', () => {
    const subject = { x: 0.25, y: 0.3, w: 0.5, h: 0.55 };
    const { findings } = QA.inspect([tpl('step-card')], { frame: FRAME, subject });
    assert.ok(findings.some(f => f.code === QA.QA_CODES.OVER_SUBJECT), JSON.stringify(findings));
});

check('two graphics on screen at once in the same place collide', () => {
    const a = tpl('step-card', { beatId: 'a', start: 2, duration: 3 });
    const b = tpl('quote-card', { beatId: 'b', start: 3, duration: 3 });
    const { findings } = QA.inspect([a, b], { frame: FRAME });
    assert.ok(findings.some(f => f.code === QA.QA_CODES.OVERLAP), 'no overlap found');
    // The same two, never on screen together, are fine.
    const apart = QA.inspect([a, { ...b, start: 20 }], { frame: FRAME }).findings;
    assert.ok(!apart.some(f => f.code === QA.QA_CODES.OVERLAP), 'collided across time');
});

check('a graphic that flashes past is found', () => {
    const { findings } = QA.inspect([tpl('step-card', { duration: 0.6 })], { frame: FRAME });
    assert.ok(findings.some(f => f.code === QA.QA_CODES.TOO_BRIEF));
});

check('the platform safe area is respected', () => {
    const low = tpl('quote-card', { y: 88 });
    const { findings } = QA.inspect([low], { frame: FRAME, safeZone: SAFE });
    assert.ok(findings.some(f => f.code === QA.QA_CODES.SAFE_AREA || f.code === QA.QA_CODES.OFF_FRAME), JSON.stringify(findings));
    // Centred, the same card is fine.
    assert.ok(QA.inspect([tpl('quote-card')], { frame: FRAME, safeZone: SAFE }).ok, 'a centred card was flagged');
});

check('a clean plan reports clean', () => {
    const plan = [tpl('quote-card', { beatId: 'a', start: 0, duration: 2 }),
        tpl('step-card', { beatId: 'b', start: 6, duration: 2 })];
    const r = QA.inspect(plan, { frame: FRAME, safeZone: SAFE, duration: 40 });
    assert.equal(r.ok, true, JSON.stringify(r.findings));
});

check('density is measured against the VIDEO, not the graphics\' own extent', () => {
    // The first version took the span of the placements themselves, so one
    // 2-second card computed as thirty a minute and every small clean plan
    // reported "crowded".
    const one = [tpl('quote-card', { duration: 2 })];
    assert.ok(QA.inspect(one, { frame: FRAME, duration: 60 }).ok, 'one card in a minute was called crowded');
    // With no duration there is nothing to measure against, so it must not
    // guess one.
    assert.ok(!QA.inspect(one, { frame: FRAME }).findings.some(f => f.code === QA.QA_CODES.CROWDED));
    const many = Array.from({ length: 20 }, (_, i) => tpl('quote-card', { beatId: `b${i}`, start: i * 2, duration: 1.5 }));
    assert.ok(QA.inspect(many, { frame: FRAME, duration: 40 }).findings.some(f => f.code === QA.QA_CODES.CROWDED));
});

check('an empty or junk plan is inspected without throwing', () => {
    for (const bad of [[], null, undefined, [null], [{}]]) {
        assert.doesNotThrow(() => QA.inspect(bad, { frame: FRAME }));
    }
});

log('\n-- 3. The repair touches ONLY the broken beat --');

check('a beat with no finding comes back byte-identical', () => {
    // This is the whole point of the round: "retry only the problematic scene
    // or element, rather than regenerating the entire video". A repair pass
    // that rewrote every beat would be exactly what it replaces.
    const good = tpl('quote-card', { beatId: 'good', start: 20, duration: 2.5 });
    const bad = tpl('step-card', { beatId: 'bad', start: 0, duration: 0.5 });
    const { placements, repairs } = QA.repair([good, bad], { frame: FRAME, safeZone: SAFE });
    const after = placements.find(p => p.beatId === 'good');
    assert.deepEqual(after, good, 'an untouched beat was rewritten');
    assert.deepEqual(repairs.map(r => r.beatId), ['bad'], JSON.stringify(repairs));
});

check('a flashing graphic is held longer, and nothing else about it changes', () => {
    const before = tpl('step-card', { beatId: 'b', duration: 0.5 });
    const { placements } = QA.repair([before], { frame: FRAME });
    const after = placements[0];
    assert.ok(after.duration >= QA.MIN_ON_SCREEN_S, `held ${after.duration}s`);
    assert.equal(after.id, before.id);
    assert.deepEqual(after.params, before.params);
    assert.equal(after.start, before.start, 'the start moved');
});

check('a graphic over the speaker is moved off them, and the move works', () => {
    const subject = { x: 0.25, y: 0.3, w: 0.5, h: 0.55 };
    const opts = { frame: FRAME, safeZone: SAFE, subject };
    const r = QA.repair([tpl('step-card', { beatId: 'b' })], opts);
    assert.equal(r.repairs.length, 1, 'nothing was repaired');
    // And the repair is real: inspecting the result finds it no longer there.
    const after = QA.inspect(r.placements, opts).findings.filter(f => f.code === QA.QA_CODES.OVER_SUBJECT);
    assert.deepEqual(after, [], 'it is still over the speaker after the repair');
});

check('a repair that cannot find a free spot says so instead of claiming success', () => {
    // A subject filling the frame leaves nowhere clear. Moving the graphic
    // somewhere also wrong, and reporting "repaired", is the failure mode.
    const opts = { frame: FRAME, safeZone: SAFE, subject: { x: 0, y: 0, w: 1, h: 1 } };
    const r = QA.repair([tpl('step-card', { beatId: 'b' })], opts);
    assert.ok(r.unresolved.some(u => u.beatId === 'b'), 'it claimed to fix the unfixable');
    assert.ok(!r.repairs.some(x => x.beatId === 'b' && x.fixed.some(f => /moved/.test(f))), 'it moved it anyway');
});

check('a finding it cannot repair is reported, not swallowed', () => {
    // Density is a property of the whole plan; there is no per-beat move that
    // fixes it, so it must surface rather than disappear.
    const many = Array.from({ length: 10 }, (_, i) => tpl('quote-card', { beatId: `b${i}`, start: i * 2, duration: 1.5 }));
    const r = QA.repair(many, { frame: FRAME, duration: 20, maxPerMinute: 6 });
    assert.ok(r.unresolved.some(u => u.codes.includes(QA.QA_CODES.CROWDED)), JSON.stringify(r.unresolved));
});

check('repairs do not create new collisions with each other', () => {
    const subject = { x: 0.25, y: 0.3, w: 0.5, h: 0.55 };
    const opts = { frame: FRAME, safeZone: SAFE, subject };
    // Two graphics on screen at the same time, both over the speaker: each
    // must move somewhere the other is not.
    const two = ['a', 'b'].map(id => tpl('quote-card', { beatId: id, start: 1, duration: 3 }));
    const r = QA.repair(two, opts);
    const left = QA.inspect(r.placements, opts).findings.filter(f => f.code === QA.QA_CODES.OVERLAP);
    assert.deepEqual(left, [], `the repair left collisions: ${JSON.stringify(left)}`);
    assert.notDeepEqual([r.placements[0].x, r.placements[0].y], [r.placements[1].x, r.placements[1].y],
        'both were moved to the same spot');
});

check('more cards than there are free positions is refused, not faked', () => {
    // A wide card over a subject filling most of the frame has very few
    // viable spots. Five of them at once cannot all be placed, and claiming
    // otherwise would put graphics back on top of each other.
    const opts = { frame: FRAME, safeZone: SAFE, subject: { x: 0.25, y: 0.3, w: 0.5, h: 0.55 } };
    const five = ['a', 'b', 'c', 'd', 'e'].map(id => tpl('quote-card', { beatId: id, start: 1, duration: 3 }));
    const r = QA.repair(five, opts);
    assert.ok(r.unresolved.length > 0, 'it claimed to place them all');
    assert.ok(/no free position/.test(r.unresolved[0].reason));
});

log('\n-- 4. Real pictures reach the cards --');

check('the image field is the one the renderers already resolve', () => {
    // TemplateCanvas resolves params.imageUrl into opts.images for the
    // preview, and the export keys its downloaded files by the same url. A
    // param name of its own would render empty everywhere but in my head.
    const tg = read('../client/src/motion/TemplateGraphics.js');
    assert.ok(/'screenshot-card':\s*\{ imageUrl:/.test(tg), 'screenshot-card does not use imageUrl');
    assert.ok(/'profile-portrait':\s*\{ imageUrl:/.test(tg), 'profile-portrait does not use imageUrl');
    assert.ok(!/\bp\.src\b/.test(tg), 'a draw function still reads p.src');
    assert.ok(read('../client/src/components/Player/TemplateCanvas.jsx').includes('params?.imageUrl'),
        'the preview resolves a different field than the templates declare');
});

check('a project image whose name matches the beat is used', () => {
    const assets = [{ id: 'a1', type: 'image', name: 'vibed-dashboard.png', url: 'https://x/v.png' }];
    assert.equal(BR.imageFor({ evidence: 'Vibed', text: 'using Vibed daily' }, assets), 'https://x/v.png');
});

check('an unrelated image is never put on screen', () => {
    // Guessing harder than a name match puts a picture of the user's on
    // screen attributed to a sentence they said. A placeholder is better.
    const assets = [{ id: 'a1', type: 'image', name: 'holiday-photo.png', url: 'https://x/h.png' }];
    assert.equal(BR.imageFor({ evidence: 'Vibed', text: 'using Vibed daily' }, assets), null);
    assert.equal(BR.imageFor({ text: 'ab cd' }, assets), null, 'short words should not match');
    assert.equal(BR.imageFor({ text: 'anything' }, []), null);
    assert.equal(BR.imageFor({ text: 'anything' }, null), null);
    // A video asset is not a picture for a card.
    assert.equal(BR.imageFor({ text: 'holiday' }, [{ ...assets[0], type: 'video' }]), null);
});

check('a portrait is only planned when there is a real face to show', () => {
    // With no picture it is a silhouette with a name under it: a weak beat,
    // and not one worth spending a moment on.
    assert.equal(BR.paramsFor('profile-portrait', { text: 'my friend Sarah' }), null);
    const withPic = BR.paramsFor('profile-portrait', { text: 'my friend Sarah' }, { imageUrl: 'https://x/s.png' });
    assert.equal(withPic.imageUrl, 'https://x/s.png');
});

check('the store passes the project\'s assets into the bridge', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    assert.ok(/placementsFor\(plan\.beats, \{ kindPlan: KIND_PLAN, assets: st\.assets \|\| \[\] \}\)/.test(store),
        'applyStoryboard does not pass assets');
});

log('\n-- 5. Wiring: the store runs all three --');

check('framing, QA and the placements are all inside ONE undo', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    const body = store.slice(store.indexOf('applyStoryboard:'), store.indexOf('R65 — Motion Graphics Components'));
    assert.equal((body.match(/_saveHistory\(\)/g) || []).length, 1, 'more than one snapshot');
    assert.ok(body.indexOf('framingPlan(') < body.indexOf('_saveHistory()'), 'the framing is planned after the snapshot');
    assert.ok(body.indexOf('inspectStoryboard(') < body.indexOf('_saveHistory()'), 'the QA runs after the snapshot');
});

check('a QA pass that throws costs the user nothing', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    const body = store.slice(store.indexOf('applyStoryboard:'), store.indexOf('R65 — Motion Graphics Components'));
    const qa = body.slice(body.indexOf('inspectStoryboard'));
    assert.ok(/catch \(err\)/.test(qa), 'the QA pass has no catch');
    assert.ok(/placing unrepaired/.test(qa), 'a failed QA pass does not fall back to the unrepaired plan');
});

check('the placed beats are the REPAIRED ones', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    const body = store.slice(store.indexOf('applyStoryboard:'), store.indexOf('R65 — Motion Graphics Components'));
    assert.ok(/for \(const p of finalPlacements\)/.test(body), 'the loop places the unrepaired placements');
});

check('the chat says what the quality pass did', () => {
    // A silent repair is indistinguishable from not having checked at all.
    const engine = read('../client/src/agent/MediaExecutionEngine.js');
    const body = engine.slice(engine.indexOf("case 'storyboard_video'"), engine.indexOf("case 'design_scene'"));
    assert.ok(/quality pass found/.test(body), 'the message never mentions the quality pass');
    assert.ok(/could not fix/.test(body), 'an unresolved finding is never reported');
    assert.ok(/push in on you/.test(body), 'the push-ins are never reported');
});

log(failures === 0 ? '\nALL STORYBOARD QA TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
