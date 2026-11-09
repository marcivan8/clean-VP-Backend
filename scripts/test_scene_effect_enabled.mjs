import assert from 'node:assert/strict';
import { createNode, createScene, flattenScene, NODE_TYPES } from '../client/src/motion/SceneSchema.js';

const effects = [
  { kind: 'brightness', enabled: false, params: { amount: 1.5 } },
  { kind: 'contrast', enabled: true, params: { amount: 1.2 } },
  { kind: 'grain', params: { amount: 4 } },
];
const node = createNode(NODE_TYPES.IMAGE, {
  id: 'effect-image', start: 0, duration: 2, source: { url: 'image.png' }, effects,
});
assert.deepEqual(node.effects, effects, 'scene node retains enabled state and effect settings');
const scene = createScene({ id: 'effect-scene', duration: 2, nodes: [node] });
const [placement] = flattenScene(scene).placements;
assert.deepEqual(placement.clip.effects, effects, 'flattening a scene retains disabled and enabled effect states');
console.log('Scene effect enabled-state checks passed.');
