import assert from 'node:assert/strict';
import { EffectPipeline } from '../client/src/effects/EffectPipeline.js';
import { EffectGraph } from '../client/src/effects/EffectGraph.js';
import { resolveGpuCompositeModeId } from '../client/src/effects/engines/GPUEffects.js';

const authoredGraph = new EffectGraph();
const defaultComposite = authoredGraph.addNode({ id: 'default-composite', type: 'composite' });
assert.equal(defaultComposite.getParam('mode'), 'source-over', 'new composites default to the preview/export-compatible normal blend');
assert.equal(defaultComposite.params.mode.options.length, 17, 'the authoring menu exposes the complete canonical blend mode set');
assert.ok(defaultComposite.params.mode.options.every(mode => resolveGpuCompositeModeId(mode) != null),
    'every selectable composite mode is implemented by the live GPU preview');
assert.equal(authoredGraph.addNode({ id: 'legacy-normal', type: 'composite', params: { mode: 'normal' } }).getParam('mode'), 'source-over',
    'legacy normal blend settings migrate to source-over');
assert.equal(authoredGraph.addNode({ id: 'legacy-add', type: 'composite', params: { mode: 'add' } }).getParam('mode'), 'addition',
    'legacy additive blend settings migrate to addition');
assert.equal(authoredGraph.addNode({ id: 'css-add', type: 'composite', params: { mode: 'plus-lighter' } }).getParam('mode'), 'addition',
    'CSS plus-lighter settings migrate to the engine additive blend mode');

const targetId = 'branch-target';
const pipeline = new EffectPipeline();
for (const [id, type, order, params] of [
    ['root', 'glow', 0, {}],
    ['base', 'color_grade', 1, {}],
    ['overlay-a', 'vignette', 2, {}],
    ['overlay-b', 'blur_gaussian', 3, {}],
    ['merge', 'composite', 4, { mode: 'screen', opacity: 0.8 }],
]) {
    pipeline.addEffect({ id, type, targetId, order, params });
}

const graph = pipeline.getGraphForTarget(targetId);
graph.connections = [];
graph.connect('root', 'base')
    .connect('root', 'overlay-a')
    .connect('overlay-a', 'overlay-b')
    .connect('base', 'merge', 'base')
    .connect('overlay-b', 'merge', 'overlay');
assert.equal(graph.getExecutionPlan().joins[0].id, 'merge');

assert.doesNotThrow(() => pipeline.addEffect({
    id: 'tail-effect', type: 'film_grain', targetId, order: 5, params: {},
}), 'the regular effect-add path accepts a valid branched effect graph');
let plan = graph.getExecutionPlan();
assert.equal(plan.sinks[0].id, 'tail-effect', 'new effects continue after the DAG output');
assert.ok(graph.connections.some(edge => edge.from === 'merge' && edge.to === 'tail-effect'),
    'the new effect is linked after the composite sink');
assert.ok(graph.connections.some(edge => edge.from === 'root' && edge.to === 'overlay-a'),
    'adding a sequential effect keeps the authored fork');

assert.equal(pipeline.removeEffect('overlay-b'), true);
plan = graph.getExecutionPlan();
assert.ok(graph.connections.some(edge => edge.from === 'overlay-a' && edge.to === 'merge' && edge.port === 'overlay'),
    'removing a branch effect preserves the destination composite port');
assert.equal(plan.sinks[0].id, 'tail-effect', 'the graph remains executable after removing a branch effect');

console.log('Effect graph authoring checks passed: linear additions append after a DAG, and removals preserve composite ports.');
