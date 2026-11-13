import assert from 'node:assert/strict';
import { resolveTimelineEffectGraphPreview } from '../client/src/motion/TimelineVisualEffects.js';

const noGraph = resolveTimelineEffectGraphPreview(null);
assert.equal(noGraph.hasGraph, false, 'a clip without a graph remains a normal effect-stack preview');
assert.equal(noGraph.supported, true, 'no graph does not create a preview limitation');

const disconnectedStack = resolveTimelineEffectGraphPreview({
    nodes: [
        { id: 'contrast', type: 'contrast', order: 2, enabled: true },
        { id: 'brightness', type: 'brightness', order: 1, enabled: true },
        { id: 'disabled', type: 'grain', order: 3, enabled: false },
    ],
    connections: [],
});
assert.equal(disconnectedStack.supported, true, 'legacy disconnected stacks remain previewable');
assert.deepEqual(disconnectedStack.effects.map(effect => effect.id), ['brightness', 'contrast'],
    'legacy stacks retain authored order and omit disabled effects');

const linearGraph = resolveTimelineEffectGraphPreview({
    nodes: [
        { id: 'source', type: 'brightness', enabled: true },
        { id: 'grade', type: 'color_grade', enabled: true },
        { id: 'analysis', type: 'face_detection', engine: 'ai', enabled: true },
    ],
    connections: [
        { from: 'source', to: 'grade' },
        { from: 'grade', to: 'analysis' },
    ],
});
assert.equal(linearGraph.supported, true, 'a single graph path maps to the live effect stack');
assert.deepEqual(linearGraph.effects.map(effect => effect.id), ['source', 'grade'],
    'the live stack follows edges and excludes analysis-only nodes');

const branchedGraph = resolveTimelineEffectGraphPreview({
    nodes: [
        { id: 'source', type: 'brightness', enabled: true },
        { id: 'left', type: 'blur', enabled: true },
        { id: 'right', type: 'glow', enabled: true },
        { id: 'merge', type: 'composite', enabled: true },
    ],
    connections: [
        { from: 'source', to: 'left' },
        { from: 'source', to: 'right' },
        { from: 'left', to: 'merge', port: 'base' },
        { from: 'right', to: 'merge', port: 'overlay' },
    ],
});
assert.equal(branchedGraph.supported, false, 'a fork/join graph is never flattened into a different preview');
assert.deepEqual(branchedGraph.effects, [], 'an unsupported DAG contributes no misleading CSS stack');
assert.match(branchedGraph.warning, /branched effect graph/i, 'the user-facing reason explains the preview limitation');

const brokenGraph = resolveTimelineEffectGraphPreview({
    nodes: [{ id: 'only', type: 'blur', enabled: true }],
    connections: [{ from: 'only', to: 'missing' }],
});
assert.equal(brokenGraph.supported, false, 'a graph with a missing endpoint is rejected clearly');
assert.match(brokenGraph.warning, /broken connection/i, 'the broken endpoint receives an actionable reason');

const standaloneComposite = resolveTimelineEffectGraphPreview({
    nodes: [{ id: 'merge', type: 'composite', enabled: true }],
    connections: [],
});
assert.equal(standaloneComposite.supported, false, 'a composite without two sources is not faked as a normal effect');

console.log('Effect graph preview compatibility: linear stack, unsupported DAG, and invalid graph guards passed');
