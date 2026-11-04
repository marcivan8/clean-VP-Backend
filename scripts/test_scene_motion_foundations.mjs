import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const load = name => import(pathToFileURL(path.join(root, 'client/src/motion', name)));
const [{ createScene, createGroup, createNode, flattenScene }, { sampleAnimation }, { composeSceneFromBrief }] = await Promise.all([
    load('SceneSchema.js'), load('MotionResolver.js'), load('SceneDirector.js'),
]);

const movingObjectScene = createScene({
    aspectRatio: '9:16', duration: 3,
    nodes: [createGroup({
        name: 'Speaker cutout', duration: 3,
        path: { points: [[-20, 0], [20, 0]], duration: 3, easing: 'linear' },
        children: [createNode('image', { name: 'Speaker', duration: 3, transform: { x: 50, y: 50 }, source: { url: '/speaker.png' } })],
    })],
});
const speaker = flattenScene(movingObjectScene).placements[0].clip;
const position = speaker.animations.find(animation => animation.keyframes.some(kf => 'x' in kf.properties));
assert.ok(position, 'group path should become an ordinary child position animation');
assert.equal(sampleAnimation(position, 0).x, -20);
assert.equal(sampleAnimation(position, 3).x, 20);

const directed = composeSceneFromBrief('Introduce the product with an animated background and a short title.', {
    aspectRatio: '16:9', duration: 4,
    plan: {
        tone: 'technology',
        background: { kind: 'gradient-wash', color: '#00E5FF', color2: '#8A2BE2', opacity: 0.16 },
        beats: [{ kind: 'intro', text: 'Meet Flow' }],
    },
});
assert.ok(directed?.scene?.nodes[0]?.meta?.animatedBackground);
const placements = flattenScene(directed.scene).placements;
const backdrop = placements[0].clip;
assert.equal(backdrop.template.kind, 'gradient-wash');
assert.deepEqual(backdrop.metadata.resolution, { w: 1920, h: 1080 });
assert.equal(backdrop.scale, 4);
assert.ok(placements.some(item => item.clip.type === 'text'));

const fallback = composeSceneFromBrief('Introduce a short title.', { aspectRatio: '9:16' });
assert.ok(!fallback.scene.nodes.some(node => node.meta?.animatedBackground), 'background motion stays optional');
const requestedFallback = composeSceneFromBrief('Introduce a short title over a subtle animated background.', { aspectRatio: '9:16' });
assert.equal(requestedFallback.scene.nodes[0].template.kind, 'gradient-wash', 'rules fallback honors an explicit background request');
console.log('ALL SCENE MOTION FOUNDATION CHECKS PASSED');
