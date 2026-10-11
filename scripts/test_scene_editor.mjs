// scripts/test_scene_editor.mjs
//
// R95 — PHASES 2 to 5: the design system end to end.
//   1. Layout: the type scale, measured stacking, the measure, accents sized
//      for the frame they are drawn in (the 1080-wide assumption that put an
//      underline through TikTok's caption bar)
//   2. Composition: the four designed components built as scenes, laid out for
//      the real frame, validating clean with no repairs needed
//   3. Coordinated motion: stagger, paths, repeat and parenting, all compiled
//      into plain keyframes so preview and export need no new concepts
//   4. The director: a brief becomes beats, a tone, a placement clear of the
//      subject, and one scene whose beats run in order
//   5. The editor: edit a layer and the clips follow as one undo, drag a clip
//      and the scene follows, and the design survives save and load
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`✓ ${name}`); }
    catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}`); }
}
const V = (n) => Math.round(Number(n) * 1000) / 1000;

const SL = await import('../client/src/motion/SceneLayout.js');
const SC = await import('../client/src/motion/SceneComposer.js');
const SM = await import('../client/src/motion/SceneMotion.js');
const SD = await import('../client/src/motion/SceneDirector.js');
const SS = await import('../client/src/motion/SceneSchema.js');
const SV = await import('../client/src/motion/SceneValidator.js');
const TM = await import('../client/src/motion/TextMeasurement.js');
const TG = await import('../client/src/motion/TemplateGraphics.js');
const { buildComponent } = await import('../client/src/motion/ComponentLibrary.js');
const MR = await import('../client/src/motion/MotionResolver.js');
const { clipToMotionLayer } = await import('../client/src/motion/ClipAdapter.js');
const { NODE_TYPES } = SS;

// ── 1. Layout ────────────────────────────────────────────────────────────────
log('\n1 · Typography and layout');

await check('type sizes follow the frame, so a title is right in both shapes', () => {
    const wide = SL.typeScaleFor('16:9');
    const tall = SL.typeScaleFor('9:16');
    assert.ok(tall.display > wide.display, 'a taller frame carries larger text');
    assert.equal(wide.caption, 48, 'the caption role still matches the app default of 48 px at 1080 high');
    assert.equal(SL.sizeForRole('16:9', 'title', 120), 120, 'an explicit size wins');
    assert.ok(SL.sizeForRole('16:9', 'nonsense') > 0, 'an unknown role falls back rather than throwing');
});

await check('the usable rectangle honours a platform safe zone, else a title-safe margin', () => {
    const plain = SL.contentRectFor('16:9');
    assert.ok(plain.x > 0 && plain.w < 1920);
    const safe = SL.contentRectFor('9:16', { top: 0.1, bottom: 0.2, left: 0.05, right: 0.08 });
    assert.equal(V(safe.y), 192);
    assert.equal(V(safe.h), 1920 - 192 - 384);
});

await check('items are measured and stacked with real gaps, not magic offsets', () => {
    const block = SL.layoutStack({
        frame: '16:9',
        items: [
            { key: 'k', role: 'kicker', text: 'EPISODE 01' },
            { key: 't', role: 'display', text: 'Built to last' },
            { key: 's', role: 'subtitle', text: 'Why it matters' },
        ],
        anchor: 'centre',
    });
    assert.equal(block.items.length, 3);
    const [k, t, s] = block.items;
    assert.ok(k.y < t.y && t.y < s.y, 'stacked in order down the frame');
    assert.ok(t.fontSize > s.fontSize && s.fontSize > k.fontSize, 'the hierarchy holds');
    assert.ok(block.blockHeight > 0 && block.top > 0);
    // Centred means the block's middle is the rectangle's middle.
    const rect = SL.contentRectFor('16:9');
    assert.ok(Math.abs((block.top + block.blockHeight / 2) - (rect.y + rect.h / 2)) < 2);
    assert.equal(block.overflowed, false);
    assert.equal(SL.layoutStack({ frame: '16:9', items: [{ role: 'title', text: '   ' }] }).items.length, 0, 'empty text is not laid out');
});

await check('a block too tall for its band grows away from what the band avoids', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ key: `i${i}`, role: 'display', text: `Line number ${i}` }));
    const band = { x: 54, y: 1200, w: 900, h: 300 };
    const top = SL.layoutStack({ frame: '9:16', rect: band, items, anchor: 'bottom' });
    assert.equal(top.overflowed, true);
    assert.ok(top.top <= band.y, 'a bottom band grows downward from its own top edge');
    const above = SL.layoutStack({ frame: '9:16', rect: { ...band, y: 200 }, items, anchor: 'top' });
    assert.ok(above.top <= 200, 'a top band grows upward into the margin, not down over the subject');
});

await check('an accent is sized for the frame it will be drawn in', () => {
    const item = { text: 'Built to last', fontSize: 80, fontFamily: 'Inter', fontWeight: 700, y: 50, height: 90, maxWidth: 880 };
    const wide = SL.accentFor(item, { frame: '16:9', shapeKind: 'underline' });
    const tall = SL.accentFor(item, { frame: '9:16', shapeKind: 'underline' });
    assert.equal(wide.w, tall.w, 'the shape is the same size in pixels');
    assert.ok(tall.scale > wide.scale * 1.7, 'but its scale differs, because the frame is narrower');
    // What the renderers will actually draw: a fraction of the frame width.
    const drawnWide = 1920 * SS.OVERLAY_WIDTH_FRACTION * wide.scale;
    const drawnTall = 1080 * SS.OVERLAY_WIDTH_FRACTION * tall.scale;
    assert.ok(Math.abs(drawnWide - drawnTall) < 6, 'so it comes out the same width either way');
    assert.ok(Math.abs(drawnWide - wide.w) < 6, 'and that width is the measured one');
    // The old behaviour, pinned so the regression cannot come back.
    assert.equal(TM.computeAccentBounds('x', { fontSize: 40 }).scale, TM.computeAccentBounds('x', { fontSize: 40, frameWidth: 1080 }).scale, '1080 stays the default');
});

await check('a backdrop panel is sized from the block it sits behind, and draws', () => {
    const block = SL.layoutStack({ frame: '16:9', items: [{ role: 'display', text: 'A premium launch' }, { role: 'subtitle', text: 'Why it matters' }] });
    const panel = SL.backdropFor(block, { frame: '16:9' });
    assert.ok(panel.w > Math.max(...block.items.map(i => i.width)), 'wider than the widest line');
    assert.ok(panel.h > block.blockHeight, 'taller than the block');
    assert.equal(panel.kind, 'panel');
    assert.ok(TG.TEMPLATE_KINDS.includes('panel'));
    assert.ok(!TG.SHAPE_KINDS.includes('panel'), 'a panel hides what is behind it, unlike a drawn stroke');
    assert.deepEqual(TG.templateSize('panel', { w: 700, h: 220 }), { w: 700, h: 220 });
});

// ── 2. Components as scenes ──────────────────────────────────────────────────
log('\n2 · Components compose themselves');

await check('the designed components are scenes, laid out for the frame they are given', () => {
    for (const id of SC.COMPOSED_COMPONENTS) {
        const preset = Object.keys(SC.LOOKS[id])[0];
        const built = buildComponent(id, preset, { title: 'A premium launch', subtitle: 'Why it matters', value: '+184%', label: 'RETENTION' }, { aspectRatio: '9:16' });
        assert.ok(built.scene, `${id} came back as a scene`);
        assert.equal(SS.validateSceneShape(built.scene).valid, true, `${id} is well formed`);
        assert.ok(built.placements.length >= 2, `${id} has layers`);
        assert.equal(new Set(built.placements.map(p => p.clip.groupId)).size, 1, `${id} moves as one group`);
        assert.ok(built.placements.every(p => p.clip.sceneNodeId), `${id} clips name their node`);
    }
});

await check('a vertical project gets a vertical layout: nothing to repair, nothing to warn about', () => {
    for (const aspectRatio of ['16:9', '9:16']) {
        const built = buildComponent('TitleSequence', 'cinematic', { title: 'A premium technology launch', subtitle: 'Three reasons it matters' }, { aspectRatio });
        const report = SV.validateScene(built.scene, { safeZone: SV.safeZoneForAspect(aspectRatio) });
        assert.equal(report.counts.error, 0, `${aspectRatio} errors: ${report.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ')}`);
        assert.equal(report.counts.warn, 0, `${aspectRatio} warnings: ${report.issues.filter(i => i.severity === 'warn').map(i => i.message).join('; ')}`);
        const fixed = SV.autoFixScene(built.scene, { safeZone: SV.safeZoneForAspect(aspectRatio) });
        assert.deepEqual(fixed.fixes, [], `${aspectRatio} needed repairs: ${fixed.fixes.map(f => f.message).join(' | ')}`);
    }
});

await check('composed text carries what it needs to be read over footage, and to be measured again', () => {
    const built = buildComponent('TitleSequence', 'cinematic', { title: 'Over the footage', subtitle: 'A supporting line' }, { aspectRatio: '9:16' });
    const texts = SS.listNodes(built.scene).filter(e => e.node.type === NODE_TYPES.TEXT).map(e => e.node);
    assert.ok(texts.length >= 2);
    for (const node of texts) {
        assert.ok(node.style.textShadow, `${node.name} has a shadow`);
        assert.ok(node.style.lineHeight > 0, `${node.name} records its line height, so the validator measures the same box the layout did`);
        assert.ok(node.constraints.maxWidthFrac > 0, `${node.name} records the measure it was fitted to`);
    }
    const display = texts.find(n => n.content === 'Over the footage');
    assert.ok(display.style.stroke?.width >= 2, 'the big role gets an outline too');
});

await check('a long headline shrinks or wraps, and its accent follows the text', () => {
    const short = buildComponent('KineticTitle', 'punchy', { title: 'GROW FAST' }, { aspectRatio: '16:9' });
    const long = buildComponent('KineticTitle', 'punchy', { title: 'HOW WE GREW THE WHOLE BUSINESS IN A SINGLE QUARTER' }, { aspectRatio: '16:9' });
    const fs = (b) => b.placements.find(p => p.clip.type === 'text' && /GROW|HOW WE/.test(p.clip.content)).clip.fontSize;
    assert.ok(fs(long) < fs(short), `long ${fs(long)} should be smaller than short ${fs(short)}`);
    const accentW = (b) => b.placements.find(p => p.clip.template).clip.template.params.w;
    assert.ok(accentW(long) > accentW(short), 'the accent tracks the text it decorates');
});

await check('the user\'s own colours and text win over the look', () => {
    const built = buildComponent('StatCallout', 'growth', { value: '+300%', label: 'REVENUE', color: '#FF0000', accentColor: '#00FF00' }, { aspectRatio: '16:9' });
    const stat = built.placements.find(p => p.clip.content === '+300%').clip;
    assert.equal(stat.color, '#FF0000');
    assert.equal(built.placements.find(p => p.clip.template).clip.template.params.color, '#00FF00');
    assert.ok(built.placements.some(p => p.clip.content === 'REVENUE'));
});

// ── 3. Coordinated motion ────────────────────────────────────────────────────
log('\n3 · Coordinated motion');

const fadeIn = (id, duration = 0.5) => ({ id, type: 'fade', anchor: 'in', startTime: 0, duration, easing: 'easeOutCubic', keyframes: [{ time: 0, properties: { opacity: 0 } }, { time: duration, properties: { opacity: 1 } }] });

await check('a stagger order can lead from the front, the back, the middle or the edges', () => {
    assert.deepEqual(SM.staggerSlots(4, 'forward'), [0, 1, 2, 3]);
    assert.deepEqual(SM.staggerSlots(4, 'reverse'), [3, 2, 1, 0]);
    assert.deepEqual(SM.staggerSlots(5, 'centre'), [3, 1, 0, 2, 4]);
    assert.deepEqual(SM.staggerSlots(5, 'edges'), [0, 2, 4, 3, 1]);
    assert.deepEqual(SM.staggerSlots(0, 'forward'), []);
    assert.deepEqual(SM.staggerSlots(3, 'nonsense'), [0, 1, 2], 'an unknown order is just forward');
});

await check('one setting on a group staggers its children, and the exits stay put', () => {
    const kids = ['a', 'b', 'c'].map(id => SS.createNode(NODE_TYPES.TEXT, {
        id, content: id, duration: 3,
        animations: [fadeIn(`in-${id}`), { id: `out-${id}`, type: 'fade', anchor: 'out', startTime: 0, duration: 0.4, easing: 'easeInSine', keyframes: [{ time: 0, properties: { opacity: 1 } }, { time: 0.4, properties: { opacity: 0 } }] }],
    }));
    const scene = SS.normalizeScene(SS.createScene({ duration: 3, nodes: [SS.createGroup({ id: 'g', duration: 3, motion: { stagger: 0.15 }, children: kids })] }));
    const clips = SS.flattenScene(scene).placements.map(p => p.clip);
    assert.deepEqual(clips.map(c => V(c.animations.find(a => a.anchor === 'in').startTime)), [0, 0.15, 0.3]);
    assert.deepEqual(clips.map(c => V(c.animations.find(a => a.anchor === 'out').startTime)), [0, 0, 0], 'an exit anchored to the end is not dragged along');
});

await check('a stagger that would outrun the layers is capped', () => {
    const kids = Array.from({ length: 6 }, (_, i) => SS.createNode(NODE_TYPES.TEXT, { id: `n${i}`, content: `n${i}`, duration: 1, animations: [fadeIn(`in${i}`, 0.3)] }));
    const scene = SS.normalizeScene(SS.createScene({ duration: 1, nodes: [SS.createGroup({ id: 'g', duration: 1, motion: { stagger: 0.4, max: 0.6 }, children: kids })] }));
    const starts = SS.flattenScene(scene).placements.map(p => V(p.clip.animations[0].startTime));
    assert.ok(Math.max(...starts) <= 0.7, `last layer starts at ${Math.max(...starts)}, which must stay inside its own life`);
    assert.ok(starts.every((s, i) => i === 0 || s >= starts[i - 1]), 'still in order');
});

await check('a path becomes a plain keyframe track, and can bank into the turn', () => {
    const node = SS.createNode(NODE_TYPES.SHAPE, {
        id: 'p', duration: 2, size: { w: 200, h: 200 }, template: { kind: 'burst' },
        path: { points: [[0, 0], [12, -8], [24, 0]], duration: 1.5, bank: 0.5 },
    });
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [node] }));
    const anim = SS.flattenScene(scene).placements[0].clip.animations.find(a => a.presetId === 'path');
    assert.ok(anim, 'the path compiled');
    assert.ok(anim.keyframes.length >= 8 && anim.keyframes.length <= 24, 'enough samples, within the keyframe limit');
    assert.deepEqual(anim.keyframes[0].properties.x !== undefined, true);
    assert.equal(V(anim.keyframes.at(-1).properties.x), 24, 'it ends where the path ends');
    assert.ok(anim.keyframes.some(k => k.properties.rotation !== undefined), 'banking writes rotation');
    assert.equal(SM.compilePath({ points: [[0, 0]] }, { duration: 2 }), null, 'one point is not a path');
    assert.equal(SM.compilePath({ points: 'nope' }, { duration: 2 }), null);
});

await check('a repeat lays the move down again, and a ping-pong comes back', () => {
    const base = { id: 'r', type: 'scale', anchor: 'in', startTime: 0, duration: 0.5, easing: 'linear', keyframes: [{ time: 0, properties: { scale: 1 } }, { time: 0.5, properties: { scale: 1.2 } }] };
    const loop = SM.expandRepeat({ ...base, repeat: { times: 3 } }, { duration: 3 });
    assert.equal(V(loop.duration), 1.5);
    assert.equal(loop.repeat, undefined, 'the instruction is consumed, not shipped');
    const pong = SM.expandRepeat({ ...base, repeat: { times: 2, mode: 'pingpong' } }, { duration: 3 });
    assert.deepEqual(pong.keyframes.map(k => k.properties.scale), [1, 1.2, 1], 'out and back');
    const open = SM.expandRepeat({ ...base, repeat: { times: 0 } }, { duration: 1.6 });
    assert.ok(V(open.duration) <= 1.6 && open.keyframes.length > 2, 'times 0 means for as long as the layer lives');
    assert.equal(SM.expandRepeat(base, { duration: 3 }), base, 'no repeat, no change');
});

await check('animating a group moves what is inside it, and a rotating group makes them orbit', () => {
    const child = SS.createNode(NODE_TYPES.TEXT, { id: 'c', content: 'x', duration: 2, transform: { x: 20, y: 0 } });
    const scene = SS.normalizeScene(SS.createScene({
        aspectRatio: '16:9', duration: 2,
        nodes: [SS.createGroup({
            id: 'g', duration: 2, transform: { x: 50, y: 50 }, children: [child],
            animations: [{ id: 'spin', type: 'rotate', anchor: 'in', startTime: 0, duration: 2, easing: 'linear', keyframes: [{ time: 0, properties: { rotation: 0 } }, { time: 2, properties: { rotation: 90 } }] }],
        })],
    }));
    const clip = SS.flattenScene(scene).placements[0].clip;
    assert.ok(clip.animations.some(a => a.presetId === 'inherited'), 'the group handed its motion down');
    const layer = clipToMotionLayer(clip, { id: 't', type: 'text' });
    const at0 = MR.resolveMotionAt(layer, 0);
    const at2 = MR.resolveMotionAt(layer, 2);
    assert.equal(V(at0.x), 70, 'it starts 20 % to the right of the group origin');
    assert.ok(Math.abs(at2.x - 50) < 1, 'a quarter turn later it is directly below the origin');
    // 20 % of 1920 px across becomes the same 384 px down, which is 35.6 % of 1080.
    assert.ok(Math.abs(at2.y - 85.6) < 1, `orbited to ${V(at2.y)}, not spun in place`);
});

await check('every compiled animation is gated, and ids survive a re-flatten', () => {
    const node = SS.createNode(NODE_TYPES.TEXT, {
        id: 'n', content: 'x', duration: 2,
        animations: [{ id: 'wild', type: 'translate', anchor: 'in', startTime: 0, duration: 1, easing: 'linear', keyframes: [{ time: 0, properties: { x: 9999, scale: -5 } }, { time: 1, properties: { x: 0, scale: 1 } }] }],
    });
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [node] }));
    const a = SS.flattenScene(scene).placements[0].clip.animations[0];
    assert.ok(a.keyframes[0].properties.x <= 120, 'out-of-range values are clamped to what the renderers trust');
    assert.ok(a.keyframes[0].properties.scale >= 0);
    assert.equal(a.id, 'wild', 'the id is kept, so re-flattening is not a churn of new objects');
    assert.deepEqual(SS.flattenScene(scene).placements[0].clip.animations[0], a, 'and flattening twice gives the same thing');
});

// ── 4. The director ──────────────────────────────────────────────────────────
log('\n4 · From a brief');

const BRIEF = 'Make this product reveal feel like a premium technology launch. Introduce the product, highlight three benefits, and finish with a strong call to action.';

await check('the brief is read for its tone and its beats', () => {
    const plan = SD.planFromBrief(BRIEF);
    assert.deepEqual(plan.beats.map(b => b.kind), ['intro', 'point', 'point', 'point', 'cta']);
    assert.equal(plan.beats[1].kicker, '01', 'the points are numbered');
    assert.ok(plan.rationale.length >= 3, 'and it can say why');
    assert.equal(SD.toneFromBrief('a viral tiktok hook').label, 'punchy');
    assert.equal(SD.toneFromBrief('a documentary explainer').label, 'editorial');
    assert.equal(SD.toneFromBrief('nothing in particular').label, 'technology', 'there is always a default');
    assert.equal(SD.planFromBrief('five reasons this works').beats.filter(b => b.kind === 'point').length, 5);
    assert.ok(SD.planFromBrief('a single title').beats.length >= 1, 'a brief with no structure still produces something');
});

await check('words that were not given come back as placeholders, never invented', () => {
    const out = SD.composeSceneFromBrief(BRIEF, { aspectRatio: '16:9' });
    assert.equal(out.placeholders.length, 5);
    assert.deepEqual(out.placeholders.slice(0, 3), ['YOUR HEADLINE', 'Point 1', 'Point 2']);
    const withWords = SD.composeSceneFromBrief(BRIEF, {
        aspectRatio: '16:9',
        plan: { title: 'The new standard', points: ['Twice the battery', 'Half the weight', 'Built to last'], cta: 'Pre-order today' },
    });
    assert.equal(withWords.placeholders.length, 0);
    const texts = SS.listNodes(withWords.scene).filter(e => e.node.type === NODE_TYPES.TEXT).map(e => e.node.content);
    assert.ok(texts.includes('The new standard') && texts.includes('Half the weight') && texts.includes('Pre-order today'));
});

await check('a graphic is placed where the subject of the shot is not', () => {
    const low = SD.placementAvoiding({ cx: 0.5, cy: 0.72, w: 0.45, h: 0.55 }, '9:16');
    assert.equal(low.anchor, 'top');
    const high = SD.placementAvoiding({ cx: 0.5, cy: 0.3, w: 0.45, h: 0.5 }, '9:16');
    assert.equal(high.anchor, 'bottom');
    const fills = SD.placementAvoiding({ cx: 0.3, cy: 0.5, w: 0.9, h: 0.95 }, '9:16');
    assert.equal(fills.anchor, 'centre');
    assert.ok(fills.x > 50, 'the subject is left of centre, so the graphic goes right');
    assert.equal(SD.placementAvoiding(null, '9:16').anchor, 'centre');
    assert.ok(SD.placementAvoiding(null, '9:16').reason.length > 0, 'and it says why');
    const tracked = SD.subjectFromClips([{ layerMask: { bboxTrack: [{ t: 1, cx: 0.4, cy: 0.6, w: 0.3, h: 0.5 }, { t: 2, cx: 0.6, cy: 0.6, w: 0.3, h: 0.5 }] } }]);
    assert.ok(tracked && tracked.cy === 0.6);
    assert.equal(SD.subjectFromClips([{}]), null);
});

await check('the beats run in order, each arriving as one staggered move, and it all validates', () => {
    const out = SD.composeSceneFromBrief(BRIEF, { aspectRatio: '9:16', safeZone: SV.safeZoneForAspect('9:16'), subject: { cx: 0.5, cy: 0.72, w: 0.45, h: 0.55 } });
    assert.equal(out.scene.nodes.length, 5, 'one group per beat');
    const starts = out.scene.nodes.map(n => n.start);
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b), 'in sequence');
    for (let i = 1; i < out.scene.nodes.length; i++) {
        assert.ok(Math.abs(starts[i] - (starts[i - 1] + out.scene.nodes[i - 1].duration)) < 0.01, 'back to back, no overlap');
    }
    assert.ok(out.scene.nodes.every(n => n.motion?.stagger > 0), 'each beat staggers its own layers');
    const report = SV.validateScene(out.scene, { safeZone: SV.safeZoneForAspect('9:16') });
    assert.equal(report.counts.error, 0, report.issues.map(i => i.message).join(' | '));
    assert.equal(report.counts.warn, 0, report.issues.filter(i => i.severity === 'warn').map(i => i.message).join(' | '));
    const fixed = SV.autoFixScene(out.scene, { safeZone: SV.safeZoneForAspect('9:16') });
    assert.deepEqual(fixed.fixes, [], `the director should not need repairs: ${fixed.fixes.map(f => f.message).join(' | ')}`);
    const titleY = SS.listNodes(out.scene).filter(e => e.node.type === NODE_TYPES.TEXT)[0].node.transform.y;
    assert.ok(titleY < 40, `the subject is low, so the first title should be high (got ${titleY})`);
    assert.ok(out.scene.meta.rationale.length >= 3);
});

await check('the AI words route cleans what a model hands back', async () => {
    const { createRequire } = await import('module');
    const require = createRequire(path.join(ROOT, 'package.json'));
    const Module = require('module');
    const orig = Module.prototype.require;
    Module.prototype.require = function patched(id) {
        if (id.includes('middleware/auth')) return { authenticateUser: (q, s, n) => n(), optionalAuth: (q, s, n) => n() };
        if (id.includes('AIProvider')) return { getAIClient: () => { throw new Error('none'); }, isAIConfigured: () => false, resolveModel: m => m, resolveProvider: () => 'mock' };
        return orig.apply(this, arguments);
    };
    try {
        const M = require(path.join(ROOT, 'server/routes/motionRoutes.js'));
        const prompt = M.buildScenePlanPrompt({ brief: BRIEF, beats: ['intro', 'point', 'cta'], tone: 'premium' });
        assert.match(prompt, /Invent nothing/);
        assert.match(prompt, /intro, point, cta/);
        const plan = M.cleanScenePlan({
            title: '"The new standard" #launch 🚀',
            points: ['Twice the battery.', 'Twice the battery.', 'x', 'Half the weight'],
            cta: 'Pre-order today!!',
            stat: { value: '+184%', label: 'organic retention rate growth more' },
        });
        assert.equal(plan.title, 'The new standard', 'quotes, hashtags and emoji come off');
        assert.deepEqual(plan.points, ['Twice the battery', 'Half the weight'], 'duplicates and junk go');
        assert.equal(plan.cta, 'Pre-order today', 'no shouting punctuation');
        assert.equal(plan.stat.value, '+184%');
        assert.equal(M.cleanScenePlan({ title: 'Hi', points: ['A real point'] }).title, '', 'one word is a label, not a title');
        assert.equal(M.cleanScenePlan({ title: 'Hi' }), null, 'a one-word title and nothing else is nothing usable');
        assert.equal(M.cleanScenePlan({}), null, 'nothing usable means nothing, so placeholders stand');
        // Found in review: String({}) is "[object Object]", which passed every
        // filter and would have been put on screen as a headline.
        const odd = M.cleanScenePlan({ title: 'A real title', points: [{ text: 'Twice the battery' }, 'Half the weight', 42], stat: { value: { n: 5 }, label: ['x'] } });
        assert.deepEqual(odd.points, ['Half the weight'], 'only strings are text');
        assert.equal(odd.stat, undefined, 'and a stat with no usable value is dropped');
    } finally {
        Module.prototype.require = orig;
    }
});

// ── 5. The editor ────────────────────────────────────────────────────────────
log('\n5 · Editing a design');

const { default: S } = await import('../client/src/store/useTimelineStore.js');
const tm = globalThis.timelineManager;
function loadProject(aspectRatio = '16:9') {
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [{ id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', start: 0, duration: 60, offset: 0, speed: 1 }] }]);
    S.setState({ tracks: tm.toLegacyTracks(), duration: 60, aspectRatio, currentTime: 5, assets: [{ id: 'a' }], past: [], future: [], scenes: {}, captions: [] });
}
const clipsOf = (sceneId) => S.getState().tracks.flatMap(t => t.clips || []).filter(c => c.sceneId === sceneId);

await check('a design remembers where it was placed, so an edit does not snap it back to zero', () => {
    loadProject();
    const r = S.getState().addMotionComponent('TitleSequence', 'cinematic', { title: 'Original title', subtitle: 'The sub' });
    assert.equal(r.success, true, r.error);
    assert.equal(S.getState().getScene(r.sceneId).meta.placedAt, 5);
    assert.ok(clipsOf(r.sceneId).every(c => c.start >= 5));
});

await check('editing a layer changes the clip, keeps its place on the timeline, and is one undo', () => {
    loadProject();
    const r = S.getState().addMotionComponent('TitleSequence', 'cinematic', { title: 'Original title', subtitle: 'The sub' });
    const node = SS.listNodes(S.getState().getScene(r.sceneId)).find(e => e.node.content === 'Original title').node;
    const historyBefore = S.getState().past.length;
    const edit = S.getState().editSceneNode(r.sceneId, node.id, { content: 'A brand new title' });
    assert.equal(edit.success, true);
    assert.equal(edit.changed, 1, 'only the layer that changed was touched');
    assert.equal(edit.added + edit.removed, 0);
    const clip = clipsOf(r.sceneId).find(c => c.sceneNodeId === node.id);
    assert.equal(clip.content, 'A brand new title');
    assert.equal(clip.start, 5, 'still where it was put');
    assert.equal(S.getState().past.length, historyBefore + 1, 'one history entry for the edit');
    S.getState().undo();
    assert.equal(clipsOf(r.sceneId).find(c => c.sceneNodeId === node.id).content, 'Original title');
});

await check('dragging the graphic on the player writes back into the design', () => {
    loadProject();
    const r = S.getState().addMotionComponent('TitleSequence', 'cinematic', { title: 'Draggable', subtitle: 'Under it' });
    const node = SS.listNodes(S.getState().getScene(r.sceneId)).find(e => e.node.content === 'Draggable').node;
    const clip = clipsOf(r.sceneId).find(c => c.sceneNodeId === node.id);
    const absBefore = SS.resolveAbsoluteTransform(S.getState().getScene(r.sceneId), node.id);
    const trackId = S.getState().tracks.find(t => t.type === 'text').id;
    S.getState().updateClip(trackId, clip.id, { x: absBefore.x + 10, y: absBefore.y - 5 }, { skipHistory: true });

    const absAfter = SS.resolveAbsoluteTransform(S.getState().getScene(r.sceneId), node.id);
    assert.equal(V(absAfter.x), V(absBefore.x + 10), 'the design followed the drag');
    assert.equal(V(absAfter.y), V(absBefore.y - 5));
    // And re-applying the design must not undo the drag.
    const re = S.getState().applySceneToTimeline(r.sceneId, { skipHistory: true });
    assert.equal(re.changed, 0, 'nothing to change, because the design already agrees with the clips');
    const after = clipsOf(r.sceneId).find(c => c.sceneNodeId === node.id);
    assert.equal(V(after.x), V(absBefore.x + 10), 'the drag survived');
    assert.equal(after.start, 5, 'and so did its place in time');
});

await check('hiding a layer takes its clip away, showing it brings it back, deleting is final', () => {
    loadProject();
    const r = S.getState().addMotionComponent('TitleSequence', 'cinematic', { title: 'Keep', subtitle: 'Drop me' });
    const sub = SS.listNodes(S.getState().getScene(r.sceneId)).find(e => e.node.content === 'Drop me').node;
    const full = clipsOf(r.sceneId).length;
    S.getState().setSceneNodeHidden(r.sceneId, sub.id, true);
    assert.equal(clipsOf(r.sceneId).length, full - 1);
    S.getState().setSceneNodeHidden(r.sceneId, sub.id, false);
    assert.equal(clipsOf(r.sceneId).length, full, 'and back');
    S.getState().deleteSceneNode(r.sceneId, sub.id);
    assert.equal(clipsOf(r.sceneId).length, full - 1);
    assert.equal(SS.findNode(S.getState().getScene(r.sceneId), sub.id), null, 'gone from the design too');
    assert.equal(S.getState().editSceneNode(r.sceneId, sub.id, { content: 'x' }).success, false, 'and cannot be edited afterwards');
});

await check('an edit is checked: it cannot quietly push text off the frame', () => {
    loadProject('9:16');
    const r = S.getState().addMotionComponent('TitleSequence', 'cinematic', { title: 'Reasonable', subtitle: 'Fine' });
    const node = SS.listNodes(S.getState().getScene(r.sceneId)).find(e => e.node.content === 'Reasonable').node;
    const edit = S.getState().editSceneNode(r.sceneId, node.id, { transform: { y: 140 } });
    assert.equal(edit.success, true);
    assert.ok(edit.fixes.length >= 1, 'the check moved it back and said so');
    const y = SS.findNode(S.getState().getScene(r.sceneId), node.id).node.transform.y;
    assert.ok(y <= 100, `y went to ${y}, which must be back inside the frame`);
    const report = SV.validateScene(S.getState().getScene(r.sceneId), { safeZone: SV.safeZoneForAspect('9:16') });
    assert.equal(report.counts.error, 0);
});

await check('a whole designed sequence from a brief lands as one undo and survives a reload', () => {
    loadProject('9:16');
    const before = S.getState().tracks.flatMap(t => t.clips).length;
    const r = S.getState().designScene(BRIEF, { plan: { title: 'The new standard', points: ['Twice the battery', 'Half the weight', 'Built to last'], cta: 'Pre-order today' } });
    assert.equal(r.success, true, r.error);
    assert.ok(r.clipCount >= 10, `${r.clipCount} clips`);
    assert.deepEqual(r.plan.beats, ['intro', 'point', 'point', 'point', 'cta']);
    assert.equal(r.placeholders.length, 0, 'the words were supplied, so nothing is a placeholder');
    assert.equal(S.getState().past.length, 1, 'one history entry for the whole sequence');

    const data = S.getState().saveProject();
    assert.ok(data.scenes[r.sceneId], 'saved with the project');
    S.setState({ scenes: {} });
    S.getState().loadProject(data);
    const reloaded = S.getState().getScene(r.sceneId);
    assert.ok(reloaded, 'back after a reload');
    assert.equal(reloaded.meta.placedAt, 5, 'including where it was placed');
    const texts = SS.listNodes(reloaded).filter(e => e.node.type === NODE_TYPES.TEXT).map(e => e.node.content);
    assert.ok(texts.includes('The new standard') && texts.includes('Pre-order today'));

    S.setState({ past: [], future: [] });
    S.getState().undo();
    assert.equal(S.getState().tracks.flatMap(t => t.clips).length, before + r.clipCount, 'nothing to undo after a reload, so the clips stay');
});

await check('an empty or useless brief is refused with something to act on', () => {
    loadProject();
    assert.equal(S.getState().designScene('').success, false);
    assert.equal(S.getState().applySceneToTimeline('nope').success, false);
    assert.equal(S.getState().editSceneNode('nope', 'nope', {}).success, false);
    assert.equal(S.getState().deleteSceneNode('nope', 'nope').success, false);
});

await check('hiding one layer of a design does not take the rest of the selection with it', () => {
    // Found in review: removeClip deletes the whole SELECTION when the clip it
    // is given happens to be part of it. Right for the Delete key, silent data
    // loss when a scene edit removes one layer it chose itself.
    loadProject();
    const r = S.getState().addMotionComponent('TitleSequence', 'cinematic', { title: 'Keep me', subtitle: 'Hide me' });
    const sub = SS.listNodes(S.getState().getScene(r.sceneId)).find(e => e.node.content === 'Hide me').node;
    const subClip = clipsOf(r.sceneId).find(c => c.sceneNodeId === sub.id);
    // The user has that layer AND an unrelated video clip selected.
    S.setState({ selectedClipIds: [subClip.id, 'v1'], activeClipId: subClip.id });
    S.getState().setSceneNodeHidden(r.sceneId, sub.id, true);
    const left = S.getState().tracks.flatMap(t => t.clips || []).map(c => c.id);
    assert.ok(!left.includes(subClip.id), 'the hidden layer went');
    assert.ok(left.includes('v1'), 'and the unrelated clip that was selected is still there');
});

await check('trimming a design clip on the timeline is not reverted by the next edit', () => {
    // Found in review: `duration` travels in placementUpdates, not clipUpdates,
    // so the mirror never saw it and the next scene edit re-applied the old
    // length from the scene.
    loadProject();
    const r = S.getState().addMotionComponent('TitleSequence', 'cinematic', { title: 'Trim me', subtitle: 'Sub' });
    const node = SS.listNodes(S.getState().getScene(r.sceneId)).find(e => e.node.content === 'Trim me').node;
    const clip = clipsOf(r.sceneId).find(c => c.sceneNodeId === node.id);
    const trackId = S.getState().tracks.find(t => t.type === 'text').id;
    S.getState().updateClip(trackId, clip.id, { duration: 2 }, { skipHistory: true });
    assert.equal(V(SS.findNode(S.getState().getScene(r.sceneId), node.id).node.duration), 2, 'the design followed the trim');
    // Now change something else; the trim must survive.
    const other = SS.listNodes(S.getState().getScene(r.sceneId)).find(e => e.node.content === 'Sub').node;
    S.getState().editSceneNode(r.sceneId, other.id, { style: { color: '#ff0000' } });
    assert.equal(V(clipsOf(r.sceneId).find(c => c.sceneNodeId === node.id).duration), 2, 'and it is still 2 s afterwards');
});

await check('undo takes the design back too, so the next edit cannot resurrect the change', () => {
    // Found in review: `scenes` was not in the history snapshot, so undo put
    // the clips back while the scene kept the undone words.
    loadProject();
    const r = S.getState().addMotionComponent('TitleSequence', 'cinematic', { title: 'Original', subtitle: 'Sub' });
    const node = SS.listNodes(S.getState().getScene(r.sceneId)).find(e => e.node.content === 'Original').node;
    S.getState().editSceneNode(r.sceneId, node.id, { content: 'Changed' });
    S.getState().undo();
    assert.equal(SS.findNode(S.getState().getScene(r.sceneId), node.id).node.content, 'Original', 'the design went back as well as the clip');
    const other = SS.listNodes(S.getState().getScene(r.sceneId)).find(e => e.node.content === 'Sub').node;
    S.getState().editSceneNode(r.sceneId, other.id, { style: { color: '#00ff00' } });
    assert.equal(clipsOf(r.sceneId).find(c => c.sceneNodeId === node.id).content, 'Original', 'and an unrelated edit does not bring the undone words back');
    S.getState().redo();
});

await check('a loop repeats forwards and snaps back; only a ping-pong turns round', () => {
    // Found in review: skipping the seam keyframe on every cycle made a LOOP
    // play its later cycles backwards, or freeze on a two-keyframe move.
    const base = {
        id: 'r', type: 'translate', anchor: 'in', startTime: 0, duration: 0.5, easing: 'linear',
        keyframes: [{ time: 0, properties: { x: 0 } }, { time: 0.25, properties: { x: 25 } }, { time: 0.5, properties: { x: 50 } }],
    };
    const loop = SM.expandRepeat({ ...base, repeat: { times: 3 } }, { duration: 3 });
    const xs = loop.keyframes.map(k => k.properties.x);
    // Each cycle must run 0 -> 25 -> 50 and then start again at 0.
    assert.deepEqual(xs, [0, 25, 50, 0, 25, 50, 0, 25, 50], `loop played ${xs.join(',')}`);
    assert.ok(loop.keyframes.every((k, i) => i === 0 || k.time > loop.keyframes[i - 1].time), 'times strictly increase');
    const two = SM.expandRepeat({ ...base, keyframes: [{ time: 0, properties: { x: 0 } }, { time: 0.5, properties: { x: 50 } }], repeat: { times: 3 } }, { duration: 3 });
    assert.deepEqual(two.keyframes.map(k => k.properties.x), [0, 50, 0, 50, 0, 50], 'a two-keyframe loop does not freeze');
    const pong = SM.expandRepeat({ ...base, repeat: { times: 2, mode: 'pingpong' } }, { duration: 3 });
    assert.deepEqual(pong.keyframes.map(k => k.properties.x), [0, 25, 50, 25, 0], 'a ping-pong turns round at the seam, with no duplicate instant');
});

await check('an emptied box in the editor leaves the value alone instead of committing zero', () => {
    // Found in review: Number('') is 0, so clearing the size box made the
    // layer invisible and nothing warned about it.
    const panel = read('client/src/components/ScenePanel.jsx');
    assert.match(panel, /const commitNumber = \(raw, build\) => \{/);
    assert.match(panel, /if \(!text \|\| !Number\.isFinite\(Number\(text\)\)\) return;/);
    for (const call of [/fontSize: Math\.max\(1, v\)/, /transform: \{ x: v \}/, /transform: \{ y: v \}/, /duration: Math\.max\(0\.1, v\)/]) {
        assert.match(panel, call, `${call} should go through commitNumber`);
    }
    assert.doesNotMatch(panel, /onBlur=\{e => commit\(\{ style: \{ fontSize/, 'no raw numeric commit is left');
});

await check('the scene editor component is still wired to the store, and its words carry no em dashes', () => {
    // The "Scene" tab was removed from the editor's sidebar (it showed up
    // as a raw, untranslated "IDELAYOUT.TABS.SCENE" label — the translation
    // was never added — and wasn't earning its place in the tab bar), but
    // the AI command (design_scene) and the engine underneath it are
    // unaffected: a designed scene still lands on the timeline and renders
    // normally. ScenePanel.jsx itself is left in place, unmounted, rather
    // than deleted, so a future surface for editing a scene's layers (e.g.
    // from the player, or a re-added tab) is not starting from scratch.
    const panel = read('client/src/components/ScenePanel.jsx');
    assert.match(panel, /editSceneNode\(sceneId, node\.id, patch\)/);
    assert.match(panel, /setSceneNodeHidden\(sceneId, node\.id/);
    assert.match(panel, /deleteSceneNode\(sceneId, node\.id\)/);
    const ide = read('client/src/layouts/IDELayout.jsx');
    assert.doesNotMatch(ide, /ScenePanel/, 'the Scene tab was removed from the editor UI on purpose; ScenePanel should not be mounted there');
    assert.doesNotMatch(ide, /'motion', 'scene', 'shorts'/, 'the scene tab should no longer be in the tab bar');
    for (const lang of ['en', 'fr']) {
        const words = JSON.parse(read(`client/src/locales/${lang}/editor.json`)).scenePanel;
        for (const key of ['title', 'empty', 'words', 'size', 'colour', 'across', 'down', 'seconds', 'footnote']) {
            assert.ok(words?.[key], `${lang}.scenePanel.${key}`);
        }
        assert.doesNotMatch(JSON.stringify(words), /—/, `${lang} has an em dash`);
    }
    // The command the director answers to still works, independent of the
    // (now removed) manual-editing tab.
    const registry = read('client/src/agent/CommandRegistry.js');
    assert.match(registry, /id: 'design_scene'/);
    assert.match(read('client/src/agent/CommandCompiler.js'), /\['design_scene'/);
});

log(failures ? `\n${failures} FAILURE(S)` : '\nALL SCENE EDITOR CHECKS PASSED');
process.exit(failures ? 1 : 0);
