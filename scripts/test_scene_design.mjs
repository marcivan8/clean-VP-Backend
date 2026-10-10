// scripts/test_scene_design.mjs
//
// R94 — PHASE 1 (design-scene schema) and PHASE 6 (validation):
//   1. The scene model: versioned, normalised, migrated, structurally checked
//   2. Transforms: nested groups compose, rotation respects the frame's shape
//   3. Round trip: today's components lift into a scene and flatten back to
//      the same clips, with the overlay geometry the renderers actually use
//   4. The validator: every check fires when it should and stays quiet when it
//      should, and auto-fix repairs what is arithmetic rather than taste
//   5. Wiring: a graphic added to the timeline IS a scene, is checked first,
//      is one undo, and survives save and load
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

const SS = await import('../client/src/motion/SceneSchema.js');
const SV = await import('../client/src/motion/SceneValidator.js');
const CL = await import('../client/src/motion/ComponentLibrary.js');
const PP = await import('../client/src/agent/PlatformProfiles.js');

const { NODE_TYPES } = SS;
const V = (n) => Math.round(n * 1000) / 1000;

/** A deliberately well-behaved scene: nothing should be reported on it. */
function cleanScene() {
    return SS.normalizeScene(SS.createScene({
        name: 'Clean', aspectRatio: '16:9', duration: 4,
        nodes: [SS.createGroup({
            name: 'Card', transform: { x: 50, y: 50 },
            children: [
                SS.createNode(NODE_TYPES.TEXT, {
                    name: 'Title', content: 'Built to last', start: 0, duration: 4,
                    transform: { x: 0, y: -4 },
                    style: { fontSize: 72, fontFamily: 'Inter', fontWeight: 700, color: '#ffffff', stroke: { width: 3, color: '#000000' } },
                }),
                SS.createNode(NODE_TYPES.SHAPE, {
                    name: 'Underline', start: 0, duration: 4,
                    transform: { x: 0, y: 2, scale: 1 },
                    size: { w: 600, h: 60 },
                    template: { kind: 'underline', params: { color: '#FFE500' } },
                }),
            ],
        })],
    }));
}

// ── 1. The model ─────────────────────────────────────────────────────────────
log('\n1 · The scene model');

await check('a scene is versioned, sized from its aspect ratio and as long as its content', () => {
    const s = SS.createScene({ aspectRatio: '9:16', nodes: [SS.createNode(NODE_TYPES.TEXT, { start: 1, duration: 2.5 })] });
    assert.equal(s.schemaVersion, SS.SCENE_SCHEMA_VERSION);
    assert.deepEqual({ w: s.frame.w, h: s.frame.h }, { w: 1080, h: 1920 });
    assert.equal(s.duration, 3.5, 'duration covers the last node');
    assert.equal(SS.frameForAspect('nonsense').w, 1920, 'an unknown ratio falls back to 16:9');
});

await check('normalising is idempotent, fills defaults and makes ids unique', () => {
    const raw = {
        schemaVersion: 1, id: 'scene-x', frame: { aspectRatio: '16:9', w: 1920, h: 1080 }, duration: 3,
        nodes: [
            { id: 'dup', type: 'text', content: 'A', duration: 2 },
            { id: 'dup', type: 'text', content: 'B', duration: 2, transform: { x: 'oops', opacity: 4 } },
        ],
    };
    const once = SS.normalizeScene(raw);
    const twice = SS.normalizeScene(once);
    assert.deepEqual(twice, once, 'normalising a normalised scene changes nothing');
    const ids = SS.listNodes(once).map(e => e.node.id);
    assert.equal(new Set(ids).size, 2, 'the duplicate id was replaced');
    const b = once.nodes[1];
    assert.equal(b.transform.x, 50, 'an unreadable position falls back to the centre');
    assert.equal(b.transform.opacity, 1, 'opacity is clamped to 0..1');
    assert.deepEqual(b.children, [], 'a leaf always has an empty children list');
});

await check('a versionless scene migrates; a newer one is read as far as it can be', () => {
    const migrated = SS.normalizeScene({ nodes: [{ type: 'text', content: 'hi', duration: 1 }] });
    assert.equal(migrated.schemaVersion, SS.SCENE_SCHEMA_VERSION);
    assert.equal(migrated.nodes.length, 1);
    assert.equal(SS.normalizeScene({ layers: [{ type: 'text', content: 'old', duration: 1 }] }).nodes.length, 1, 'the old "layers" key is read');
    assert.equal(SS.normalizeScene(null), null);
    assert.ok(SS.normalizeScene({ schemaVersion: 99, nodes: [] }), 'a future version is kept, not refused');
});

await check('the structure check catches what cannot be rendered', () => {
    assert.equal(SS.validateSceneShape(cleanScene()).valid, true);
    const bad = { schemaVersion: 1, id: 's', frame: { w: 0, h: 0 }, nodes: [{ id: 'a', type: 'nope', start: -1, duration: 1, transform: {}, animations: [], children: [{ id: 'b', type: 'text' }] }] };
    const report = SS.validateSceneShape(bad);
    assert.equal(report.valid, false);
    const joined = report.errors.join(' | ');
    assert.match(joined, /frame needs a positive/);
    assert.match(joined, /unknown type "nope"/);
    assert.match(joined, /start must be a non-negative/);
    assert.match(joined, /cannot have children/);
});

await check('a node can be found, patched and removed without touching the rest', () => {
    const s = cleanScene();
    const title = SS.listNodes(s).find(e => e.node.name === 'Title').node;
    assert.equal(SS.findNode(s, title.id).depth, 1, 'it is one group deep');
    assert.equal(SS.findNode(s, 'nope'), null);
    const moved = SS.updateNode(s, title.id, { transform: { ...title.transform, y: -10 } });
    assert.equal(SS.findNode(moved, title.id).node.transform.y, -10);
    assert.equal(SS.findNode(s, title.id).node.transform.y, -4, 'the original scene is untouched');
    assert.equal(SS.listNodes(SS.removeNode(moved, title.id)).length, 2, 'the group and the shape remain');
    assert.equal(SS.updateNode(s, 'nope', { name: 'x' }), s, 'patching nothing returns the same scene');
});

// ── 2. Transforms ────────────────────────────────────────────────────────────
log('\n2 · Nested transforms');

await check('a top-level node keeps its own position, exactly like a clip', () => {
    const s = SS.normalizeScene(SS.createScene({ nodes: [SS.createNode(NODE_TYPES.TEXT, { id: 'solo', transform: { x: 30, y: 70 }, duration: 1 })] }));
    const abs = SS.resolveAbsoluteTransform(s, 'solo');
    assert.deepEqual({ x: abs.x, y: abs.y, scale: abs.scale }, { x: 30, y: 70, scale: 1 });
});

await check('a group origin plus child offsets gives the absolute position', () => {
    const s = SS.normalizeScene(SS.createScene({
        nodes: [SS.createGroup({
            id: 'g', transform: { x: 40, y: 60, scale: 1 },
            children: [SS.createNode(NODE_TYPES.TEXT, { id: 'c', transform: { x: 5, y: -10 }, duration: 1 })],
        })],
    }));
    const abs = SS.resolveAbsoluteTransform(s, 'c');
    assert.deepEqual({ x: abs.x, y: abs.y }, { x: 45, y: 50 });
});

await check('scaling a group shrinks it in place, and scale and opacity compose', () => {
    const s = SS.normalizeScene(SS.createScene({
        nodes: [SS.createGroup({
            id: 'g', transform: { x: 50, y: 50, scale: 0.5, opacity: 0.8 },
            children: [SS.createNode(NODE_TYPES.TEXT, { id: 'c', transform: { x: 20, y: 0, scale: 2, opacity: 0.5 }, duration: 1 })],
        })],
    }));
    const abs = SS.resolveAbsoluteTransform(s, 'c');
    assert.equal(abs.x, 60, 'the offset halved: it moved toward the group origin, not the frame corner');
    assert.equal(abs.scale, 1, '0.5 x 2');
    assert.equal(V(abs.opacity), 0.4, '0.8 x 0.5');
});

await check('rotating a group keeps the real distance, because percent is not square', () => {
    const s = SS.normalizeScene(SS.createScene({
        aspectRatio: '9:16',
        nodes: [SS.createGroup({
            id: 'g', transform: { x: 50, y: 50, rotation: 90 },
            children: [SS.createNode(NODE_TYPES.TEXT, { id: 'c', transform: { x: 10, y: 0 }, duration: 1 })],
        })],
    }));
    const abs = SS.resolveAbsoluteTransform(s, 'c');
    // 10 % of 1080 px across becomes 108 px down, which is 5.625 % of 1920.
    assert.equal(V(abs.x), 50);
    assert.equal(V(abs.y), 55.625, 'a naive percent rotation would wrongly say 60');
    assert.equal(abs.rotation, 90, 'rotation adds');
});

await check('nesting composes through every level, three groups deep', () => {
    const inner = SS.createGroup({ id: 'i', transform: { x: 10, y: 0, scale: 0.5 }, children: [SS.createNode(NODE_TYPES.TEXT, { id: 'leaf', transform: { x: 10, y: 0 }, duration: 1 })] });
    const mid = SS.createGroup({ id: 'm', transform: { x: 20, y: 0, scale: 2 }, children: [inner] });
    const s = SS.normalizeScene(SS.createScene({ nodes: [SS.createGroup({ id: 'o', transform: { x: 10, y: 50 }, children: [mid] })] }));
    // 10 + 20 + 10*2 + 10*(2*0.5)
    assert.equal(V(SS.resolveAbsoluteTransform(s, 'leaf').x), 60);
    assert.equal(V(SS.resolveAbsoluteTransform(s, 'leaf').scale), 1);
});

await check("a group's life covers its children, and node life includes the parent's start", () => {
    const s = SS.normalizeScene(SS.createScene({
        nodes: [SS.createGroup({ id: 'g', start: 2, children: [SS.createNode(NODE_TYPES.TEXT, { id: 'c', start: 1, duration: 3 })] })],
    }));
    assert.equal(SS.findNode(s, 'g').node.duration, 4, 'the group was given the span of its children');
    assert.deepEqual(SS.nodeLife(s, 'c'), { start: 3, end: 6 });
});

// ── 3. Round trip with today's components ────────────────────────────────────
log('\n3 · Lifting and flattening');

await check("a component's placements lift into one group and flatten back unchanged", () => {
    const built = CL.buildComponent('TitleSequence', 'cinematic', { title: 'A premium technology launch', subtitle: 'Why it matters' });
    assert.ok(built.placements.length >= 3);
    const scene = SS.sceneFromPlacements(built.placements, { componentId: 'TitleSequence', presetId: 'cinematic', aspectRatio: '16:9' });
    assert.equal(scene.nodes.length, 1, 'one group holds the whole graphic');
    const group = SS.rootGroup(scene);
    assert.equal(group.children.length, built.placements.length);
    assert.equal(scene.meta.componentId, 'TitleSequence');

    const flat = SS.flattenScene(scene);
    assert.equal(flat.placements.length, built.placements.length);
    flat.placements.forEach((p, i) => {
        const original = built.placements[i].clip;
        assert.equal(p.trackType, built.placements[i].trackType, `trackType ${i}`);
        assert.equal(p.clip.type, original.type, `type ${i}`);
        assert.equal(V(p.clip.x), V(original.x ?? 50), `x ${i}`);
        assert.equal(V(p.clip.y), V(original.y ?? 50), `y ${i}`);
        assert.equal(p.clip.content ?? '', original.content ?? '', `content ${i}`);
        assert.equal(V(p.clip.duration), V(original.duration), `duration ${i}`);
        if (original.fontSize) assert.equal(V(p.clip.fontSize), V(original.fontSize), `fontSize ${i}`);
        if (original.scale) assert.equal(V(p.clip.scale), V(original.scale), `scale ${i}`);
        assert.deepEqual(p.clip.animations, original.animations, `animations ${i}`);
    });
});

await check('every flattened clip can be traced back to its scene and node', () => {
    const built = CL.buildComponent('LowerThird', 'pro-minimal', { title: 'Marc', subtitle: 'Founder' });
    const scene = SS.sceneFromPlacements(built.placements, { componentId: 'LowerThird' });
    const flat = SS.flattenScene(scene);
    for (const p of flat.placements) {
        assert.equal(p.clip.sceneId, scene.id);
        assert.ok(SS.findNode(scene, p.clip.sceneNodeId), `node ${p.clip.sceneNodeId} exists`);
        assert.ok(p.clip.groupId, 'the pieces share a group so they move together');
    }
    assert.equal(new Set(flat.placements.map(p => p.clip.groupId)).size, 1);
});

await check('groups do not become clips, and a hidden or lifeless node is left out', () => {
    const s = SS.normalizeScene(SS.createScene({
        duration: 3,
        nodes: [SS.createGroup({
            children: [
                SS.createNode(NODE_TYPES.TEXT, { id: 'ok', content: 'yes', duration: 2 }),
                SS.createNode(NODE_TYPES.TEXT, { id: 'hidden', content: 'no', duration: 2, hidden: true }),
                SS.createNode(NODE_TYPES.TEXT, { id: 'nolife', content: 'no', duration: 0 }),
            ],
        })],
    }));
    const ids = SS.flattenScene(s).placements.map(p => p.clip.sceneNodeId);
    assert.deepEqual(ids, ['ok']);
    assert.equal(SS.flattenScene(s, { includeHidden: true }).placements.length, 2, 'hidden can be asked for');
});

await check('a group transform is baked into the clips, so one renderer draws everything', () => {
    const built = CL.buildComponent('KineticTitle', 'punchy', { title: 'SCALE FAST' });
    const scene = SS.sceneFromPlacements(built.placements, { componentId: 'KineticTitle' });
    const group = SS.rootGroup(scene);
    const shrunk = SS.updateNode(scene, group.id, { transform: { ...group.transform, scale: 0.5 } });
    const before = SS.flattenScene(scene).placements;
    const after = SS.flattenScene(shrunk).placements;
    const textIdx = before.findIndex(p => p.clip.type === 'text');
    assert.equal(V(after[textIdx].clip.fontSize), V(before[textIdx].clip.fontSize * 0.5), 'text scales through its font size');
    const shapeIdx = before.findIndex(p => p.clip.type === 'template');
    if (shapeIdx >= 0) assert.equal(V(after[shapeIdx].clip.scale), V(before[shapeIdx].clip.scale * 0.5), 'a shape scales through clip.scale');
    assert.ok(after.every(p => p.clip.type !== 'group'), 'no group clip reaches the timeline');
});

await check('an overlay node is measured the way the renderers actually draw it', () => {
    const s = SS.normalizeScene(SS.createScene({
        aspectRatio: '9:16',
        nodes: [SS.createNode(NODE_TYPES.SHAPE, { id: 'sh', duration: 2, transform: { x: 50, y: 50, scale: 2 }, size: { w: 800, h: 400 }, template: { kind: 'underline' } })],
    }));
    const node = SS.findNode(s, 'sh').node;
    const box = SS.nodeBox(s, node, SS.resolveAbsoluteTransform(s, 'sh'));
    // 1080 * 0.25 * 2 = 540 wide, keeping the 2:1 aspect of its own size.
    assert.equal(V(box.w), 540, 'width is a fraction of the frame times the clip scale, not the pixel size');
    assert.equal(V(box.h), 270);
    assert.equal(V(box.cx), 540);
    assert.equal(SS.OVERLAY_WIDTH_FRACTION, 0.25, 'must match Compositor.js and GraphicOverlay.jsx');
});

// ── 4. The validator ─────────────────────────────────────────────────────────
log('\n4 · Validation');

await check('a well-made scene reports nothing that matters', () => {
    const report = SV.validateScene(cleanScene());
    assert.equal(report.ok, true, `errors: ${report.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ')}`);
    assert.equal(report.counts.error, 0);
    assert.equal(report.counts.warn, 0, report.issues.filter(i => i.severity === 'warn').map(i => i.code).join(','));
});

await check('a malformed scene reports its structure and stops there', () => {
    const report = SV.validateScene({ nodes: 'not an array' });
    assert.equal(report.ok, false);
    assert.ok(report.shapeErrors.length > 0);
    assert.ok(report.issues.every(i => i.code === SV.ISSUE_CODES.SHAPE_INVALID));
});

await check('text wider than its space is an error, and shrinking it is the fix', () => {
    const s = SS.normalizeScene(SS.createScene({
        aspectRatio: '16:9', duration: 3,
        nodes: [SS.createNode(NODE_TYPES.TEXT, {
            id: 't', duration: 3, content: 'This headline is far too long to ever fit across one single line of the frame',
            style: { fontSize: 140, fontWeight: 700, stroke: { width: 2, color: '#000' } },
            constraints: { allowWrap: false },
        })],
    }));
    const before = SV.validateScene(s);
    const overflow = before.issues.find(i => i.code === SV.ISSUE_CODES.TEXT_OVERFLOW);
    assert.ok(overflow, 'the overflow is reported');
    assert.equal(overflow.severity, 'error');
    assert.equal(overflow.fix, 'auto');
    const fixed = SV.autoFixScene(s);
    assert.ok(fixed.fixes.some(f => f.code === SV.ISSUE_CODES.TEXT_OVERFLOW), 'it was shrunk');
    const after = SS.findNode(fixed.scene, 't').node.style.fontSize;
    assert.ok(after < 140, `font went 140 -> ${after}`);
    assert.ok(!fixed.issues.some(i => i.code === SV.ISSUE_CODES.TEXT_OVERFLOW), 'and the overflow is gone');
});

await check('a layer off the frame is an error and is moved back inside', () => {
    const s = SS.normalizeScene(SS.createScene({
        aspectRatio: '16:9', duration: 2,
        nodes: [SS.createNode(NODE_TYPES.TEXT, { id: 't', duration: 2, content: 'Off the edge', transform: { x: 98, y: 50 }, style: { fontSize: 80, stroke: { width: 2, color: '#000' } } })],
    }));
    const issue = SV.validateScene(s).issues.find(i => i.code === SV.ISSUE_CODES.OUTSIDE_FRAME);
    assert.ok(issue && issue.severity === 'error');
    const fixed = SV.autoFixScene(s);
    assert.ok(fixed.fixes.some(f => f.code === SV.ISSUE_CODES.OUTSIDE_FRAME));
    assert.ok(SS.findNode(fixed.scene, 't').node.transform.x < 98);
    assert.ok(!fixed.issues.some(i => i.code === SV.ISSUE_CODES.OUTSIDE_FRAME));
});

await check("the platform's safe zone is honoured, and a layer can opt out of it", () => {
    const opts = { safeZone: PP.PLATFORM_PROFILES.tiktok.safeZone };
    const make = (constraints) => SS.normalizeScene(SS.createScene({
        aspectRatio: '9:16', duration: 2,
        nodes: [SS.createNode(NODE_TYPES.TEXT, { id: 't', duration: 2, content: 'Under the buttons', transform: { x: 50, y: 88 }, style: { fontSize: 60, stroke: { width: 2, color: '#000' } }, constraints })],
    }));
    const issue = SV.validateScene(make({}), opts).issues.find(i => i.code === SV.ISSUE_CODES.SAFE_AREA);
    assert.ok(issue && issue.severity === 'warn');
    assert.match(issue.message, /buttons/);
    const fixed = SV.autoFixScene(make({}), opts);
    assert.ok(SS.findNode(fixed.scene, 't').node.transform.y < 88, 'it was lifted out of the caption bar');
    assert.ok(!SV.validateScene(make({ keepInSafeArea: false }), opts).issues.some(i => i.code === SV.ISSUE_CODES.SAFE_AREA), 'a layer may opt out');
    assert.equal(SV.safeZoneForAspect('16:9'), null, 'landscape gets the title-safe margin instead');
    assert.ok(SV.safeZoneForAspect('9:16').bottom > 0.1, 'vertical reserves the bottom');
});

await check('a shape too big for the frame is scaled down, not shuffled around', () => {
    const s = SS.normalizeScene(SS.createScene({
        aspectRatio: '9:16', duration: 2,
        nodes: [SS.createNode(NODE_TYPES.SHAPE, { id: 'sh', duration: 2, transform: { x: 50, y: 50, scale: 6 }, size: { w: 900, h: 300 }, template: { kind: 'underline' } })],
    }));
    const fixed = SV.autoFixScene(s, { safeZone: SV.safeZoneForAspect('9:16') });
    const scale = SS.findNode(fixed.scene, 'sh').node.transform.scale;
    assert.ok(scale < 6, `scale 6 -> ${scale}`);
    assert.ok(fixed.fixes.some(f => /too big/.test(f.message)), fixed.fixes.map(f => f.message).join(' | '));
    assert.ok(fixed.ok, 'and the scene is clean afterwards');
});

await check('two cards over each other is reported; a stroke over its own text is not', () => {
    const together = (kindA, paramsA) => SS.normalizeScene(SS.createScene({
        duration: 3,
        nodes: [SS.createGroup({
            children: [
                SS.createNode(NODE_TYPES.SHAPE, { id: 'a', name: 'A', duration: 3, transform: { x: 0, y: 0 }, size: { w: 600, h: 300 }, template: { kind: kindA, params: paramsA } }),
                SS.createNode(NODE_TYPES.TEXT, { id: 'b', name: 'B', duration: 3, transform: { x: 0, y: 0 }, content: 'Over the top', style: { fontSize: 60, stroke: { width: 2, color: '#000' } } }),
            ],
        })],
    }));
    const collide = SV.validateScene(together('quote-card', {})).issues.find(i => i.code === SV.ISSUE_CODES.LAYER_COLLISION);
    assert.ok(collide, 'a card covering text is a real defect');
    assert.equal(collide.fix, 'manual', 'layout is not auto-guessed');
    assert.match(collide.message, /cover each other/);
    assert.ok(!SV.validateScene(together('underline', {})).issues.some(i => i.code === SV.ISSUE_CODES.LAYER_COLLISION), 'an underline is decoration, not an obstruction');
    assert.ok(!SV.validateScene(together('quote-card', {}), { skipCollisions: true }).issues.some(i => i.code === SV.ISSUE_CODES.LAYER_COLLISION));
});

await check('layers that are never on screen together do not collide', () => {
    const s = SS.normalizeScene(SS.createScene({
        duration: 6,
        nodes: [SS.createGroup({
            children: [
                SS.createNode(NODE_TYPES.TEXT, { id: 'a', name: 'A', start: 0, duration: 2, content: 'First', style: { fontSize: 60, stroke: { width: 2, color: '#000' } } }),
                SS.createNode(NODE_TYPES.TEXT, { id: 'b', name: 'B', start: 3, duration: 2, content: 'Second', style: { fontSize: 60, stroke: { width: 2, color: '#000' } } }),
            ],
        })],
    }));
    assert.ok(!SV.validateScene(s).issues.some(i => i.code === SV.ISSUE_CODES.LAYER_COLLISION));
});

await check('a missing file, an unknown shape and empty text are each reported', () => {
    const s = SS.normalizeScene(SS.createScene({
        duration: 2,
        nodes: [
            SS.createNode(NODE_TYPES.IMAGE, { id: 'img', duration: 2, source: { assetId: 'gone' } }),
            SS.createNode(NODE_TYPES.IMAGE, { id: 'nosrc', duration: 2 }),
            SS.createNode(NODE_TYPES.SHAPE, { id: 'sh', duration: 2, template: { kind: 'does-not-exist' } }),
            SS.createNode(NODE_TYPES.TEXT, { id: 'blank', duration: 2, content: '   ', style: { fontSize: 60 } }),
        ],
    }));
    const report = SV.validateScene(s, { assets: [{ id: 'other' }] });
    const codes = report.issues.map(i => i.code);
    assert.ok(codes.includes(SV.ISSUE_CODES.MISSING_ASSET));
    assert.equal(report.issues.filter(i => i.code === SV.ISSUE_CODES.MISSING_ASSET).length, 2, 'a gone asset and no source at all');
    assert.ok(codes.includes(SV.ISSUE_CODES.UNKNOWN_TEMPLATE));
    assert.ok(codes.includes(SV.ISSUE_CODES.EMPTY_CONTENT));
    assert.equal(report.ok, false);
    assert.ok(!SV.validateScene(s, { assets: [{ id: 'gone' }] }).issues.some(i => i.detail?.assetId === 'gone'), 'present assets pass');
});

await check('an effect or mask this build cannot render is dropped rather than shipped', () => {
    const s = SS.normalizeScene(SS.createScene({
        duration: 2,
        nodes: [SS.createNode(NODE_TYPES.TEXT, {
            id: 't', duration: 2, content: 'Fancy', style: { fontSize: 60, stroke: { width: 2, color: '#000' } },
            effects: [{ kind: 'glow' }, { kind: 'quantum-shimmer' }],
            mask: { kind: 'telekinesis' },
        })],
    }));
    const report = SV.validateScene(s);
    assert.ok(report.issues.some(i => i.code === SV.ISSUE_CODES.UNSUPPORTED_EFFECT));
    assert.ok(report.issues.some(i => i.code === SV.ISSUE_CODES.UNSUPPORTED_MASK));
    assert.equal(report.ok, true, 'neither is fatal: the rest of the graphic still works');
    const fixed = SV.autoFixScene(s);
    const effects = SS.findNode(fixed.scene, 't').node.effects.map(e => e.kind);
    assert.deepEqual(effects, ['glow'], 'the known effect is kept');
});

await check('animation timing is brought inside its own layer', () => {
    const anim = (overrides) => ({ id: `a-${overrides.anchor}-${overrides.startTime}`, type: 'fade', easing: 'easeOutCubic', keyframes: [{ time: 0, properties: { opacity: 0 } }, { time: 1, properties: { opacity: 1 } }], ...overrides });
    const s = SS.normalizeScene(SS.createScene({
        duration: 2,
        nodes: [SS.createNode(NODE_TYPES.TEXT, {
            id: 't', duration: 2, content: 'Late', style: { fontSize: 60, stroke: { width: 2, color: '#000' } },
            animations: [anim({ anchor: 'in', startTime: 3, duration: 1 }), anim({ anchor: 'in', startTime: 1.5, duration: 2 }), anim({ anchor: 'out', startTime: 0, duration: 5 })],
        })],
    }));
    const report = SV.validateScene(s);
    assert.equal(report.issues.filter(i => i.code === SV.ISSUE_CODES.TIMING_OUT_OF_RANGE).length, 3);
    assert.match(report.issues.find(i => i.code === SV.ISSUE_CODES.TIMING_OUT_OF_RANGE).message, /after the layer has gone|past the end|only lives/);
    const fixed = SV.autoFixScene(s);
    const animations = SS.findNode(fixed.scene, 't').node.animations;
    for (const a of animations) {
        if (a.anchor === 'out') assert.ok(a.duration <= 2, `exit ${a.duration}`);
        else assert.ok(a.startTime + a.duration <= 2 + 1e-6, `${a.startTime}+${a.duration}`);
    }
    assert.ok(!fixed.issues.some(i => i.code === SV.ISSUE_CODES.TIMING_OUT_OF_RANGE));
});

await check('an exit that starts before the entrance finishes is reported', () => {
    const kf = [{ time: 0, properties: { opacity: 0 } }, { time: 1, properties: { opacity: 1 } }];
    const s = SS.normalizeScene(SS.createScene({
        duration: 2,
        nodes: [SS.createNode(NODE_TYPES.TEXT, {
            id: 't', duration: 2, content: 'Clash', style: { fontSize: 60, stroke: { width: 2, color: '#000' } },
            animations: [
                { id: 'in', type: 'fade', anchor: 'in', startTime: 0, duration: 1.8, easing: 'easeOutCubic', keyframes: kf },
                { id: 'out', type: 'fade', anchor: 'out', startTime: 0, duration: 1.5, easing: 'easeOutCubic', keyframes: kf },
            ],
        })],
    }));
    const issue = SV.validateScene(s).issues.find(i => i.code === SV.ISSUE_CODES.EXIT_BEFORE_ENTRANCE);
    assert.ok(issue);
    assert.equal(issue.fix, 'manual', 'which animation to shorten is a choice, not a calculation');
});

await check('a layer with no time on screen, or starting after the end, is caught', () => {
    const s = SS.normalizeScene(SS.createScene({
        duration: 5,
        nodes: [
            SS.createNode(NODE_TYPES.TEXT, { id: 'dead', duration: 0, content: 'Never', style: { fontSize: 60 } }),
            SS.createNode(NODE_TYPES.TEXT, { id: 'late', start: 6, duration: 1, content: 'Too late', style: { fontSize: 60 } }),
        ],
    }));
    const codes = SV.validateScene(s).issues.map(i => i.code);
    assert.ok(codes.includes(SV.ISSUE_CODES.ZERO_DURATION));
    assert.ok(codes.includes(SV.ISSUE_CODES.STARTS_AFTER_SCENE));
    const fixed = SV.autoFixScene(s);
    assert.equal(SS.findNode(fixed.scene, 'dead').node.duration, 5, 'it was given the rest of the scene');
});

await check('text too small to read, and text with nothing to lift it off the video', () => {
    const s = SS.normalizeScene(SS.createScene({
        aspectRatio: '9:16', duration: 2,
        nodes: [SS.createNode(NODE_TYPES.TEXT, { id: 't', duration: 2, content: 'Tiny', style: { fontSize: 20, color: '#ffffff' } })],
    }));
    const report = SV.validateScene(s);
    assert.ok(report.issues.some(i => i.code === SV.ISSUE_CODES.TEXT_TOO_SMALL));
    const contrast = report.issues.find(i => i.code === SV.ISSUE_CODES.LOW_CONTRAST);
    assert.ok(contrast && contrast.severity === 'info', 'advice, not a defect');
    assert.ok(!SV.validateScene(s, { skipContrast: true }).issues.some(i => i.code === SV.ISSUE_CODES.LOW_CONTRAST));
    assert.equal(V(SV.contrastRatio('#ffffff', '#000000')), 21);
    assert.equal(SV.contrastRatio('#ffffff', 'not a colour'), null);
    assert.ok(SV.luminance('rgb(255,255,255)') > 0.9);
});

await check('auto-fix settles, is safe to re-run, and never reports a fix it did not make', () => {
    const s = SS.normalizeScene(SS.createScene({
        aspectRatio: '9:16', duration: 3,
        nodes: [SS.createGroup({
            children: [
                SS.createNode(NODE_TYPES.TEXT, { id: 'big', duration: 3, content: 'An enormous headline that cannot possibly fit', transform: { x: 46, y: 92 }, style: { fontSize: 160, fontWeight: 800 }, constraints: { allowWrap: false } }),
                SS.createNode(NODE_TYPES.SHAPE, { id: 'huge', duration: 3, transform: { x: 50, y: 10, scale: 9 }, size: { w: 900, h: 200 }, template: { kind: 'underline' } }),
            ],
        })],
    }));
    const opts = { safeZone: SV.safeZoneForAspect('9:16') };
    const first = SV.autoFixScene(s, opts);
    assert.ok(first.fixes.length >= 2, first.fixes.map(f => f.code).join(','));
    assert.equal(first.issues.filter(i => i.fix === 'auto').length, 0, 'nothing auto-fixable is left over');
    const second = SV.autoFixScene(first.scene, opts);
    assert.deepEqual(second.fixes, [], 'a second pass finds nothing to do');
    assert.equal(SS.validateSceneShape(first.scene).valid, true);
    assert.ok(SV.describeIssues(first.issues).length >= 0);
    assert.equal(SV.describeIssues([]), '');
    assert.match(SV.describeIssues([{ message: 'a' }, { message: 'b' }, { message: 'c' }], 1), /a And 2 more\./);
});

await check('issues come back worst first, and every one names its layer', () => {
    const s = SS.normalizeScene(SS.createScene({
        aspectRatio: '9:16', duration: 2,
        nodes: [
            SS.createNode(NODE_TYPES.TEXT, { id: 'blank', name: 'Blank', duration: 2, content: '', style: { fontSize: 20 } }),
            SS.createNode(NODE_TYPES.TEXT, { id: 'small', name: 'Small', duration: 2, content: 'hi', style: { fontSize: 20 } }),
        ],
    }));
    const { issues } = SV.validateScene(s);
    const order = issues.map(i => i.severity);
    assert.deepEqual([...order].sort((a, b) => ({ error: 0, warn: 1, info: 2 })[a] - ({ error: 0, warn: 1, info: 2 })[b]), order, 'sorted by severity');
    assert.ok(issues.every(i => i.nodeId && i.nodeName && i.message && i.code));
    assert.ok(issues.every(i => ['auto', 'manual'].includes(i.fix)));
});

// ── 5. Wiring ────────────────────────────────────────────────────────────────
log('\n5 · On the timeline');

const { default: S } = await import('../client/src/store/useTimelineStore.js');
const { mediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const tm = globalThis.timelineManager;

function loadProject(aspectRatio = '16:9') {
    tm.fromLegacyTracks([{ id: 'track-default-video', type: 'video', name: 'V', clips: [{ id: 'v1', clipId: 'ev1', assetId: 'a', type: 'video', start: 0, duration: 60, offset: 0, speed: 1 }] }]);
    S.setState({
        tracks: tm.toLegacyTracks(), duration: 60, aspectRatio, currentTime: 3,
        assets: [{ id: 'a', type: 'video', name: 't.mp4' }], past: [], future: [], scenes: {}, shorts: [], captions: [],
    });
}

await check('a graphic added to the timeline is stored as a scene, and its clips point back to it', () => {
    loadProject('16:9');
    const result = S.getState().addMotionComponent('TitleSequence', 'cinematic', { title: 'Premium launch', subtitle: 'Three reasons' });
    assert.equal(result.success, true, result.error);
    assert.ok(result.sceneId, 'the scene id comes back');
    const st = S.getState();
    const scene = st.getScene(result.sceneId);
    assert.ok(scene && scene.schemaVersion === SS.SCENE_SCHEMA_VERSION);
    assert.equal(SS.rootGroup(scene).children.length, result.clipCount);
    const added = st.tracks.flatMap(t => t.clips).filter(c => c.sceneId === result.sceneId);
    assert.equal(added.length, result.clipCount);
    assert.ok(added.every(c => c.sceneNodeId && SS.findNode(scene, c.sceneNodeId)), 'each clip names its node');
    assert.ok(added.every(c => c.start >= 3), 'placed at the playhead');
});

await check('the whole graphic is one undo, even when it needs two new tracks', () => {
    loadProject('16:9');
    const before = S.getState().tracks.flatMap(t => t.clips).length;
    const r = S.getState().addMotionComponent('TitleSequence', 'cinematic', { title: 'One undo' });
    assert.ok(r.clipCount >= 2);
    assert.equal(S.getState().past.length, 1, 'one history entry, not one per track');
    S.getState().undo();
    assert.equal(S.getState().tracks.flatMap(t => t.clips).length, before, 'everything went back together');
});

await check('a graphic is checked before it lands: it is fixed, and what is left is said plainly', async () => {
    loadProject('9:16');
    const r = await mediaExecutionEngine.executeStoreAction({
        action: 'addMotionComponent',
        args: { component: 'TitleSequence', preset: 'cinematic', params: { title: 'A premium technology launch that keeps going and going', subtitle: 'Why it matters' } },
    }, null);
    assert.equal(r.success, true, r.error);
    assert.match(r.message, /^Added a title sequence \(cinematic\)\./);
    assert.ok(r.details.sceneId);
    const scene = S.getState().getScene(r.details.sceneId);
    const report = SV.validateScene(scene, { safeZone: SV.safeZoneForAspect('9:16'), assets: S.getState().assets });
    assert.equal(report.counts.error, 0, `errors left on the timeline: ${report.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ')}`);
    assert.ok(!report.issues.some(i => i.fix === 'auto'), 'nothing mechanically fixable was left for the user');
    assert.doesNotMatch(r.message, /—/, 'no em dashes in what the user reads');
});

await check('scenes are saved, come back on load, and do not pile up once a graphic is gone', () => {
    loadProject('16:9');
    const r = S.getState().addMotionComponent('StatCallout', 'growth', { value: '300%', label: 'REVENUE' });
    const saved = S.getState().saveProject();
    assert.ok(saved.scenes[r.sceneId], 'saved with the project');
    S.setState({ scenes: {} });
    S.getState().loadProject(saved);
    assert.ok(S.getState().getScene(r.sceneId), 'back after a load');
    assert.ok(S.getState().tracks.flatMap(t => t.clips).some(c => c.sceneId === r.sceneId), 'the link survives the timeline round trip');

    loadProject('16:9');
    const r2 = S.getState().addMotionComponent('StatCallout', 'growth', { value: '10%' });
    S.getState().undo();
    assert.equal(Object.keys(S.getState().saveProject().scenes || {}).length, 0, 'an undone graphic leaves no scene behind');
    assert.ok(r2.sceneId);
});

await check('a scene can be stored, read back and removed through the store', () => {
    loadProject('16:9');
    const stored = S.getState().setScene(SS.createScene({ id: 'scene-manual', name: 'Manual', nodes: [SS.createNode(NODE_TYPES.TEXT, { duration: 1, content: 'x' })] }));
    assert.equal(stored.id, 'scene-manual');
    assert.equal(S.getState().getScene('scene-manual').name, 'Manual');
    assert.equal(S.getState().setScene(null), null, 'a bad scene is refused, not stored');
    S.getState().removeScene('scene-manual');
    assert.equal(S.getState().getScene('scene-manual'), null);
});

await check('the scene link is persisted by the timeline itself, not just in memory', () => {
    const src = read('client/src/timeline/TimelineStateManager.js');
    assert.match(src, /sceneId: clip\.sceneId \?\? null/);
    assert.match(src, /sceneNodeId: legacyClip\.sceneNodeId \?\? null/);
    const store = read('client/src/store/useTimelineStore.js');
    assert.match(store, /scenes:\s+pruneScenes\(state\.scenes, state\.tracks\)/);
    assert.match(store, /addTrack: \(type, options = \{\}\) =>/);
});

log(failures ? `\n${failures} FAILURE(S)` : '\nALL SCENE DESIGN CHECKS PASSED');
process.exit(failures ? 1 : 0);
