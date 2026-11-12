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
const { sampleAnimation } = await import('../client/src/motion/MotionResolver.js');
const CM = await import('../client/src/motion/Compositor.js');
const CL = await import('../client/src/motion/ComponentLibrary.js');
const {
    SCENE3D_TEXTURE_MASK_SHAPES,
    MAX_SCENE_OBJECTS,
    MAX_SCENE_LIGHTS,
    MAX_SCENE_PARTICLES,
    MAX_SCENE_TRIANGLES,
    MAX_MESH_VERTICES,
    MAX_MESH_FACES,
} = await import('../client/src/motion/Scene3D.js');
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

await check('scene normalization drops empty or non-numeric keyframe values instead of turning them into zero', () => {
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.TEXT, {
        id: 'invalid-keyframe-values', duration: 2, content: 'Motion',
        animations: [{ duration: 2, keyframes: [
            { time: null, properties: { x: 99 } },
            { time: '', properties: { x: 98 } },
            { time: 0, properties: { x: null, y: '', scale: true } },
            { time: '1', properties: { x: '12', y: 8 } },
        ] }],
    })] }));
    assert.deepEqual(SS.findNode(scene, 'invalid-keyframe-values').node.animations[0].keyframes, [
        { time: 1, properties: { x: 12, y: 8 } },
    ], 'only finite, explicitly authored numeric time and transform values survive import');
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
    let patchCalls = 0;
    const patchedOnce = SS.updateNode(s, title.id, node => { patchCalls++; return { name: `${node.name} updated`, transform: { x: 42 } }; });
    assert.equal(patchCalls, 1, 'functional patches are evaluated exactly once');
    assert.equal(SS.findNode(patchedOnce, title.id).node.transform.x, 42, 'the resolved transform patch is applied');
    assert.equal(SS.findNode(patchedOnce, title.id).node.name, 'Title updated', 'the resolved node patch is applied');
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

await check('lifting a clip into a scene preserves effects, blend mode, and masks', () => {
    const clip = {
        id: 'graded-overlay', type: 'image', start: 0, duration: 2, x: 50, y: 50, scale: 0.8,
        url: '/media/card.png', blendMode: 'screen',
        shadow: { color: '#000000', blur: 8, dx: 3, dy: 4, opacity: 0.4 },
        effects: [{ kind: 'blur', params: { radius: 3 }, enabled: false }],
        sceneMask: { kind: 'shape', shape: 'ellipse', inset: 0.1 },
    };
    const scene = SS.sceneFromPlacements([{ trackType: 'overlay', clip, asset: { url: clip.url } }], { duration: 2 });
    const lifted = SS.flattenScene(scene).placements[0].clip;
    assert.equal(lifted.blendMode, 'screen');
    assert.deepEqual(lifted.shadow, clip.shadow);
    assert.deepEqual(lifted.effects, clip.effects);
    assert.deepEqual(lifted.sceneMask, clip.sceneMask);
});

await check('scene normalization and flattening preserve effect animation and active time windows', () => {
    const effect = {
        kind: 'blur', params: { radius: 2 }, startTime: 0.25, endTime: 1.5,
        keyframes: { radius: [
            { time: 0, value: 2 }, { time: 1, value: 12, easing: 'ease-in-out' },
        ] },
    };
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.SHAPE, {
        id: 'animated-effect', duration: 2, vector: { kind: 'circle', w: 80, h: 80, fill: '#fff' }, effects: [effect],
    })] }));
    const normalized = SS.findNode(scene, 'animated-effect').node.effects[0];
    const flattened = SS.flattenScene(scene).placements[0].clip.effects[0];
    assert.deepEqual(normalized, effect, 'scene normalization retains authored effect timing and keyframes');
    assert.deepEqual(flattened, effect, 'flattening retains effect animation for preview and export');
});

await check('vector timeline clips lift back into editable vector scene nodes', () => {
    const clip = {
        id: 'vector-arrow', type: 'vector', start: 0, duration: 2, x: 44, y: 55, scale: 0.6,
        vector: { kind: 'arrow', w: 220, h: 90, fill: '#38BDF8', stroke: '#ffffff', strokeWidth: 4 },
        metadata: { resolution: { w: 220, h: 90 } },
    };
    const scene = SS.sceneFromPlacements([{ trackType: 'overlay', clip }], { duration: 2 });
    const flat = SS.flattenScene(scene).placements[0].clip;
    assert.equal(SS.rootGroup(scene).children[0].type, NODE_TYPES.SHAPE);
    assert.equal(flat.type, 'vector');
    assert.deepEqual(flat.vector, clip.vector);
});

await check('rich text and cycling word slots survive scene lifting and flattening', () => {
    const rich = {
        id: 'rich-copy', type: 'text', start: 0, duration: 3, x: 50, y: 48,
        content: 'Make it', fontSize: 72, fontFamily: 'Inter', color: '#FFFFFF',
        runs: [{ text: 'Make', color: '#FFFFFF' }, { text: ' it', color: '#38BDF8' }],
        charAnim: { preset: 'wave', amplitude: 0.12 },
    };
    const richScene = SS.sceneFromPlacements([{ trackType: 'text', clip: rich }], { duration: 3 });
    const richFlat = SS.flattenScene(richScene).placements[0].clip;
    assert.equal(richFlat.template.kind, 'rich-text');
    assert.deepEqual(richFlat.runs, rich.runs);
    assert.deepEqual(richFlat.charAnim, rich.charAnim);

    const cycle = {
        id: 'cycle-copy', type: 'text', start: 0, duration: 3, x: 50, y: 58,
        content: 'Made for', fontSize: 72, color: '#FFFFFF',
        alternatives: ['Reels', 'Shorts', 'Stories'], slotWidth: 310, dwell: 0.8,
    };
    const cycleScene = SS.sceneFromPlacements([{ trackType: 'text', clip: cycle }], { duration: 3 });
    const cycleFlat = SS.flattenScene(cycleScene).placements[0].clip;
    assert.equal(cycleFlat.template.kind, 'word-cycle');
    assert.deepEqual(cycleFlat.alternatives, cycle.alternatives);
    assert.equal(cycleFlat.content, cycle.content);
    assert.equal(cycleFlat.template.params.dwell, cycle.dwell);
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
    const textIdx = before.findIndex(p => p.clip.type === 'text' || p.clip.template?.kind === 'rich-text');
    if (before[textIdx].clip.template?.kind === 'rich-text') {
        assert.equal(V(after[textIdx].clip.scale), V(before[textIdx].clip.scale * 0.5), 'rich text scales through the shared graphic transform');
    } else {
        assert.equal(V(after[textIdx].clip.fontSize), V(before[textIdx].clip.fontSize * 0.5), 'plain text scales through its font size');
    }
    const shapeIdx = before.findIndex(p => p.clip.template && p.clip.template.kind !== 'rich-text');
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

await check('3D scenes warn before renderer object, receiver, light, particle and mesh limits silently omit content', () => {
    const mesh = { id: 'oversized-mesh', name: 'Oversized mesh', type: 'mesh', vertices: Array(MAX_MESH_VERTICES + 1).fill({ x: 0, y: 0, z: 0 }), faces: Array(MAX_MESH_FACES + 1).fill([0, 0, 0]) };
    const scene = SS.normalizeScene(SS.createScene({
        duration: 2,
        nodes: [SS.createNode(NODE_TYPES.SHAPE, {
            id: 'scene-3d', duration: 2,
            template: { kind: '3d-scene', params: { scene: {
                objects: [mesh, ...Array(17)].map((object, index) => object || ({ id: `receiver-${index}`, type: 'plane', receivesShadow: true }))
                    .concat(Array.from({ length: MAX_SCENE_OBJECTS - 17 }, (_, index) => ({ id: `object-${index}`, type: 'box' })), { id: 'object-overflow', type: 'box' }),
                lights: Array(MAX_SCENE_LIGHTS + 1).fill({ type: 'point' }),
                particles: { count: MAX_SCENE_PARTICLES + 1 },
            } } },
        })],
    }));
    const limits = SV.validateScene(scene).issues.filter(issue => issue.code === SV.ISSUE_CODES.SCENE_RENDER_LIMIT);
    assert.deepEqual(limits.map(issue => issue.detail.label), [
        'objects', 'lights', 'shadow receiver planes', 'particles',
        'vertices on mesh “Oversized mesh”', 'faces on mesh “Oversized mesh”',
    ]);
    assert.ok(limits.every(issue => issue.severity === 'warn'));
    assert.match(limits[0].message, /extra content will not appear/);
});

await check('3D mesh validation reports expanded polygon work before the renderer caps it', () => {
    const mesh = {
        id: 'polygon-heavy-mesh', name: 'Polygon heavy', type: 'mesh',
        vertices: Array.from({ length: 64 }, (_, index) => ({ x: index, y: 0, z: 0 })),
        faces: Array.from({ length: 200 }, () => Array.from({ length: 64 }, (_, index) => index)),
    };
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.SHAPE, {
        id: 'scene-with-many-triangles', duration: 2,
        template: { kind: '3d-scene', params: { scene: { objects: [mesh] } } },
    })] }));
    const issues = SV.validateScene(scene).issues.filter(issue => issue.code === SV.ISSUE_CODES.SCENE_RENDER_LIMIT);
    assert.ok(issues.some(issue => issue.detail.label === 'triangles on mesh “Polygon heavy”' && issue.detail.actual === 12400),
        'the report counts n-gon expansion, rather than treating 200 authored faces as cheap');
});

await check('3D global face budget includes built-in primitive tessellation and particle sprites', () => {
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.SHAPE, {
        id: 'dense-primitive-scene', duration: 2,
        template: { kind: '3d-scene', params: { scene: {
            objects: Array.from({ length: 105 }, (_, index) => ({ id: `torus-${index}`, type: 'torus' })),
        } } },
    })] }));
    const warning = SV.validateScene(scene).issues.find(issue => issue.code === SV.ISSUE_CODES.SCENE_RENDER_LIMIT
        && issue.detail.label === 'triangles and particle sprites in the 3D scene');
    assert.ok(warning, 'the renderer drops excess primitive triangles, so validation must warn');
    assert.equal(warning.detail.actual, MAX_SCENE_TRIANGLES + 400);
    assert.equal(warning.detail.limit, MAX_SCENE_TRIANGLES);

    const mixedScene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.SHAPE, {
        id: 'primitive-particle-scene', duration: 2,
        template: { kind: '3d-scene', params: { scene: {
            objects: Array.from({ length: 102 }, (_, index) => ({ id: `torus-${index}`, type: 'torus' })),
            particles: { count: MAX_SCENE_PARTICLES },
        } } },
    })] }));
    assert.ok(SV.validateScene(mixedScene).issues.some(issue => issue.code === SV.ISSUE_CODES.SCENE_RENDER_LIMIT
        && issue.detail.label === 'triangles and particle sprites in the 3D scene'
        && issue.detail.actual === 50_960), 'particle sprites also consume the global scene face budget');
});

await check('unsupported masks on 3D media planes are reported instead of silently ignored', () => {
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.SHAPE, {
        id: 'scene-with-unsupported-mask', duration: 2,
        template: { kind: '3d-scene', params: { scene: { objects: [
            { id: 'masked-image-plane', name: 'Reference frame', type: 'image', maskShape: 'heart', imageUrl: 'ref.png' },
        ] } } },
    })] }));
    const warning = SV.validateScene(scene).issues.find(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_MASK);
    assert.equal(warning?.detail?.objectId, 'masked-image-plane');
    assert.equal(warning?.detail?.shape, 'heart');
    assert.match(warning?.message || '', /mask will be ignored/);
    for (const shape of SCENE3D_TEXTURE_MASK_SHAPES) {
        const supported = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.SHAPE, {
            id: `scene-with-${shape}-mask`, duration: 2,
            template: { kind: '3d-scene', params: { scene: { objects: [
                { id: 'masked-image-plane', type: 'image', maskShape: shape, imageUrl: 'ref.png' },
            ] } } },
        })] }));
        assert.ok(!SV.validateScene(supported).issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_MASK),
            `renderer-supported mask “${shape}” is accepted by validation`);
    }
});

await check('unsupported 3D authored values are reported before rendering', () => {
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.SHAPE, {
        id: 'scene-with-unsupported-values', duration: 2,
        template: { kind: '3d-scene', params: { scene: {
            objects: [{ id: 'custom-primitive', type: 'star-poly', material: { side: 'both' }, blendMode: 'linear-dodge' }],
            lights: [{ type: 'area' }],
        } } },
    })] }));
    const issues = SV.validateScene(scene).issues.filter(item => item.code === SV.ISSUE_CODES.SCENE_COMPATIBILITY);
    // Area lights are now rendered by the software 3D path, so only the
    // primitive, material side and blend mode should report fallbacks.
    assert.equal(issues.length, 3);
    assert.ok(issues.every(item => item.severity === 'warn'));
    assert.match(issues[0].message, /will be skipped/);
    assert.match(issues[1].message, /front-sided/);
    assert.match(issues[2].message, /source-over/);
    assert.ok(issues.every(item => !/area light.*point light/i.test(item.message)),
        'supported area lights must not be reported as falling back to point lights');
});

await check('authored animations beyond ROKA generation caps remain valid and renderable', () => {
    const scene = SS.normalizeScene(SS.createScene({ duration: 3, nodes: [SS.createNode(NODE_TYPES.TEXT, {
        id: 'crowded-animation-layer', duration: 3, content: 'Tracks',
        animations: Array.from({ length: 17 }, (_, index) => ({
            type: 'custom', startTime: 0, duration: 1,
            keyframes: Array.from({ length: index === 0 ? 25 : 2 }, (_, time) => ({ time, properties: { opacity: time ? 1 : 0 } })),
        })),
    })] }));
    const report = SV.validateScene(scene);
    assert.ok(!report.issues.some(issue => issue.code === 'animation_render_limit'),
        'generation limits must not be presented as renderer limits');
    const animation = scene.nodes[0].animations[0];
    assert.equal(animation.keyframes.length, 25, 'normalization preserves all authored keyframes');
    assert.equal(sampleAnimation(animation, 24).opacity, 1,
        'the final authored keyframe is sampled after the generation limit');
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

await check('unsupported vector blend modes are reported and reset before flattening', () => {
    const scene = SS.normalizeScene(SS.createScene({ duration: 1, nodes: [SS.createNode(NODE_TYPES.SHAPE, {
        id: 'unsupported-vector-blend', duration: 1,
        vector: { kind: 'rect', w: 80, h: 40, fill: '#FFFFFF', blendMode: 'vivid-light' },
    })] }));
    const report = SV.validateScene(scene);
    assert.ok(report.issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_BLEND_MODE
        && issue.detail?.mode === 'vivid-light'), 'validation names the unsupported authored mode');
    const fixed = SV.autoFixScene(scene);
    assert.equal(SS.findNode(fixed.scene, 'unsupported-vector-blend').node.vector.blendMode, 'source-over');
    assert.equal(SS.flattenScene(fixed.scene).placements[0].clip.blendMode || 'source-over', 'source-over',
        'the corrected vector mode survives into the executable timeline composition');
    assert.ok(!fixed.issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_BLEND_MODE));
});

await check('video scene mattes reach the existing preview and export matte path', () => {
    const layerMask = { maskAssetPath: 'masks/person.mp4', settings: { mode: 'blur' } };
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.VIDEO, {
        id: 'matted-video', duration: 2, source: { assetId: 'speaker' }, mask: { kind: 'matte', layerMask },
    })] }));
    const clip = SS.flattenScene(scene).placements[0].clip;
    assert.equal(clip.layerTarget, 'background');
    assert.deepEqual(clip.layerMask, layerMask);
    assert.ok(!SV.validateScene(scene).issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_MASK));

    const unsupported = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.IMAGE, {
        id: 'matted-image', duration: 2, source: { assetId: 'still' }, mask: { kind: 'matte', layerMask },
    })] }));
    assert.ok(SV.validateScene(unsupported).issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_MASK),
        'a matte on a still image is surfaced as unsupported instead of silently ignored');
});

await check('vector shape masks are accepted when the shared graphic renderer can execute them', () => {
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.SHAPE, {
        id: 'masked-vector', duration: 2,
        vector: { kind: 'rectangle', w: 200, h: 100, fill: '#ffffff' },
        size: { w: 200, h: 100 },
        mask: { kind: 'shape', shape: 'ellipse', inset: 0.1 },
    })] }));
    const report = SV.validateScene(scene);
    assert.ok(!report.issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_MASK));
    assert.deepEqual(SS.flattenScene(scene).placements[0].clip.sceneMask, { kind: 'shape', shape: 'ellipse', inset: 0.1 });
});

await check('circle and rounded-rectangle masks survive scene validation and flattening', () => {
    for (const shape of ['circle', 'rounded-rectangle']) {
        const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [SS.createNode(NODE_TYPES.SHAPE, {
            id: `masked-${shape}`, duration: 2,
            vector: { kind: 'rectangle', w: 200, h: 100, fill: '#ffffff' },
            size: { w: 200, h: 100 },
            mask: { kind: 'shape', shape, radius: 0.2 },
        })] }));
        assert.ok(!SV.validateScene(scene).issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_MASK), `${shape} should be supported`);
        assert.equal(SS.flattenScene(scene).placements[0].clip.sceneMask.shape, shape);
    }
});

await check('node masks preserve their source layer identity instead of becoming bounding boxes', () => {
    for (const kind of ['circle', 'capsule', 'rect']) {
        const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [
            SS.createNode(NODE_TYPES.IMAGE, {
                id: `masked-image-${kind}`, duration: 2, source: { url: 'image.png' }, size: { w: 400, h: 300 },
                mask: { kind: 'node', nodeId: `mask-${kind}` },
            }),
            SS.createNode(NODE_TYPES.SHAPE, {
                id: `mask-${kind}`, duration: 2, size: { w: 200, h: 200 },
                vector: { kind, ...(kind === 'rect' ? { radius: 24 } : {}), w: 200, h: 200, fill: '#ffffff' },
            }),
        ] }));
        const mask = SS.flattenScene(scene).placements[0].clip.sceneMask;
        assert.equal(mask.kind, 'layer');
        assert.equal(mask.nodeId, `mask-${kind}`);
        assert.equal(mask.invert, false);
    }
    const lumaScene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [
        SS.createNode(NODE_TYPES.IMAGE, {
            id: 'luma-target', duration: 2, source: { url: 'image.png' }, size: { w: 400, h: 300 },
            mask: { kind: 'node', nodeId: 'luma-source', mode: 'luminance', invert: true },
        }),
        SS.createNode(NODE_TYPES.SHAPE, {
            id: 'luma-source', duration: 2, size: { w: 200, h: 200 },
            vector: { kind: 'circle', w: 200, h: 200, fill: '#ffffff' },
        }),
    ] }));
    const lumaMask = SS.flattenScene(lumaScene).placements[0].clip.sceneMask;
    assert.deepEqual(lumaMask, { kind: 'layer', nodeId: 'luma-source', mode: 'luminance', invert: true });
    assert.ok(!SV.validateScene(lumaScene).issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_MASK));

    const invalidMode = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [
        SS.createNode(NODE_TYPES.IMAGE, {
            id: 'bad-mode-target', duration: 2, source: { url: 'image.png' },
            mask: { kind: 'node', nodeId: 'bad-mode-source', mode: 'depth' },
        }),
        SS.createNode(NODE_TYPES.SHAPE, {
            id: 'bad-mode-source', duration: 2,
            vector: { kind: 'circle', w: 200, h: 200, fill: '#fff' },
        }),
    ] }));
    assert.ok(SV.validateScene(invalidMode).issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_MASK),
        'an unknown matte mode is reported instead of silently treated as alpha');
});

await check('hidden node masks remain available for compositor matte resolution', () => {
    const scene = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [
        SS.createNode(NODE_TYPES.IMAGE, {
            id: 'hidden-mask-target', duration: 2, source: { url: 'image.png' }, size: { w: 400, h: 300 },
            mask: { kind: 'node', nodeId: 'hidden-mask-source' },
        }),
        SS.createNode(NODE_TYPES.SHAPE, {
            id: 'hidden-mask-source', duration: 2, hidden: true,
            vector: { kind: 'circle', w: 200, h: 200, fill: '#fff' },
        }),
    ] }));
    const placements = SS.flattenScene(scene).placements;
    assert.deepEqual(placements.map(({ clip }) => clip.sceneNodeId), ['hidden-mask-target', 'hidden-mask-source']);
    assert.equal(placements[0].clip.sceneMask.nodeId, 'hidden-mask-source');

    const nested = SS.normalizeScene(SS.createScene({ duration: 2, nodes: [
        SS.createNode(NODE_TYPES.IMAGE, {
            id: 'nested-hidden-target', duration: 2, source: { url: 'image.png' },
            mask: { kind: 'node', nodeId: 'nested-hidden-source' },
        }),
        SS.createGroup({ id: 'hidden-mask-group', hidden: true, children: [
            SS.createNode(NODE_TYPES.SHAPE, {
                id: 'nested-hidden-source', duration: 2,
                vector: { kind: 'circle', w: 200, h: 200, fill: '#fff' },
            }),
            SS.createNode(NODE_TYPES.TEXT, { id: 'unrelated-hidden-sibling', content: 'hidden', duration: 2 }),
        ] }),
    ] }));
    assert.deepEqual(SS.flattenScene(nested).placements.map(({ clip }) => clip.sceneNodeId), [
        'nested-hidden-target', 'nested-hidden-source',
    ], 'a hidden parent is traversed only along the matte source path');

    const plan = CM.buildCompositionPlan([
        { id: 'matte-base', type: 'video', order: 0, clips: [{ id: 'base', type: 'video', start: 0, duration: 2, url: 'base.mp4' }] },
        { id: 'matte-scene', type: 'overlay', order: 1, clips: placements.map(({ clip }) => clip) },
    ], { width: 1080, height: 1920, fps: 30 });
    const target = plan.overlays.find(overlay => overlay.sceneNodeId === 'hidden-mask-target');
    const source = plan.overlays.find(overlay => overlay.sceneNodeId === 'hidden-mask-source');
    assert.equal(target.sceneMask.sourceOverlayId, source.id, 'the source is resolved through the shared compositor plan');
    assert.equal(source.matteOnly, true, 'the hidden source is consumed as a matte, not drawn visibly');
});

await check('media overlays report and remove effects unsupported by their render path', () => {
    const s = SS.normalizeScene(SS.createScene({
        duration: 2,
        nodes: [SS.createNode(NODE_TYPES.IMAGE, {
            id: 'media-effects', duration: 2, source: { url: 'media.png' },
            effects: [
                { kind: 'shadow', params: { color: '#000', blur: 8 } },
                { kind: 'drop-shadow', params: { color: '#f00', blur: 5 } },
                { kind: 'glow', params: { color: '#fff', intensity: 0.5 } },
                { kind: 'gradient-fill', params: { from: '#fff', to: '#000' } },
                { kind: 'stroke', params: { color: '#fff', width: 2 } },
                { kind: 'inner-shadow', params: { color: '#000', blur: 2 } },
                { kind: 'contrast', params: { amount: 1.2 } },
            ],
        }), SS.createNode(NODE_TYPES.VIDEO, {
            id: 'video-gradient', duration: 2, source: { url: 'video.mp4' },
            effects: [
                { kind: 'shadow', params: { color: '#000', blur: 8 } },
                { kind: 'glow', params: { color: '#fff', intensity: 0.5 } },
                { kind: 'gradient-fill', params: { from: '#fff', to: '#000' } },
                { kind: 'inner-shadow', params: { color: '#000', blur: 2 } },
                { kind: 'stroke', params: { color: '#fff', width: 2 } },
            ],
        })],
    }));
    const report = SV.validateScene(s);
    assert.ok(!report.issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_EFFECT && issue.nodeId === 'media-effects'), 'image stroke and inner shadow are supported');
    assert.ok(!report.issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_EFFECT && issue.nodeId === 'video-gradient' && issue.detail?.kind === 'gradient-fill'), 'gradient fill is supported on video layers now that preview and export both render it');
    assert.ok(report.issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_EFFECT && issue.nodeId === 'video-gradient' && issue.detail?.kind === 'stroke'));
    const fixed = SV.autoFixScene(s);
    assert.deepEqual(SS.findNode(fixed.scene, 'media-effects').node.effects.map(effect => effect.kind), ['shadow', 'drop-shadow', 'glow', 'gradient-fill', 'stroke', 'inner-shadow', 'contrast']);
    assert.deepEqual(SS.findNode(fixed.scene, 'video-gradient').node.effects.map(effect => effect.kind), ['shadow', 'glow', 'gradient-fill', 'inner-shadow']);
});

await check('disabled effects stay in the stack without render warnings', () => {
    const s = SS.normalizeScene(SS.createScene({
        duration: 2,
        nodes: [SS.createNode(NODE_TYPES.TEXT, {
            id: 'disabled-effect', duration: 2, content: 'Title',
            effects: [{ kind: 'lens-distortion', enabled: false, params: { amount: 4 } }],
        })],
    }));
    const report = SV.validateScene(s);
    assert.ok(!report.issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_EFFECT && issue.nodeId === 'disabled-effect'));
    const fixed = SV.autoFixScene(s);
    assert.deepEqual(SS.findNode(fixed.scene, 'disabled-effect').node.effects, s.nodes[0].effects);
});

await check('grayscale and sepia are accepted on graphic scene layers', () => {
    const scene = SS.normalizeScene(SS.createScene({
        duration: 2,
        nodes: [SS.createNode(NODE_TYPES.TEXT, {
            id: 'graphic-color-effects', duration: 2, content: 'Tone',
            effects: [
                { kind: 'grayscale', params: { amount: 0.8 } },
                { kind: 'sepia', params: { amount: 0.6 } },
            ],
        })],
    }));
    const report = SV.validateScene(scene);
    assert.ok(!report.issues.some(issue => issue.code === SV.ISSUE_CODES.UNSUPPORTED_EFFECT),
        'supported color filters should not be rejected by scene validation');
    assert.deepEqual(SS.flattenScene(scene).placements[0].clip.effects.map(effect => effect.kind),
        ['grayscale', 'sepia'], 'both effects remain attached when the scene flattens into its renderable layer');
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

await check('CSS HSL vector blend modes survive scene normalization and flattening', () => {
    for (const mode of ['hue', 'saturation', 'color', 'luminosity']) {
        const scene = SS.normalizeScene(SS.createScene({ nodes: [SS.createGroup({
            blendMode: mode,
            children: [SS.createNode(NODE_TYPES.SHAPE, {
                duration: 1, vector: { type: 'rect', blendMode: mode, paths: [] },
            })],
        })] }));
        const group = scene.nodes[0];
        const leaf = SS.flattenScene(scene).placements[0].clip;
        assert.equal(group.blendMode, mode, `${mode} group blend mode is normalized`);
        assert.ok(leaf.compositionStack.some(entry => entry.blendMode === mode), `${mode} group blend mode reaches compositor plan`);
        assert.equal(leaf.blendMode, mode, `${mode} vector blend mode reaches compositor plan`);
    }
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
