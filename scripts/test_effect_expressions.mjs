import assert from 'node:assert/strict';
import { resolveEffectAtTime } from '../client/src/motion/EffectTiming.js';
import { resolveTimelineEffectFilter } from '../client/src/motion/TimelineVisualEffects.js';
import { evaluateMotionExpression } from '../client/src/motion/MotionExpression.js';
import { resolveMotionAt } from '../client/src/motion/MotionResolver.js';
import { validateMotionExpression } from '../client/src/motion/MotionExpression.js';
import { resolveMotionAt as resolveWorkerMotionAt } from '../render-worker/revideo/src/motion/MotionResolver.js';
import { EffectNode } from '../client/src/effects/EffectNode.js';
import { createGpuClipEffectConfigs } from '../client/src/effects/ClipEffectAdapter.js';
import { EffectPipeline } from '../client/src/effects/EffectPipeline.js';
import { buildCompositionPlan, planIsNoOp } from '../client/src/motion/Compositor.js';
import exportProcessor from '../jobs/exportProcessor.js';

const effect = {
    kind: 'brightness',
    startTime: 2,
    endTime: 6,
    params: { amount: { value: 1, expression: '0.5 + progress' } },
};
assert.equal(resolveEffectAtTime(effect, 4).params.amount.value, 1);
assert.equal(resolveEffectAtTime(effect, 5).params.amount.value, 1.25);
assert.equal(resolveEffectAtTime(effect, 6), null);
assert.match(resolveTimelineEffectFilter([effect], 5), /brightness\(1\.25\)/);
const clipProgressEffect = { kind: 'brightness', params: { amount: { value: 0, expression: 'progress' } } };
assert.match(resolveTimelineEffectFilter([clipProgressEffect], 12, { clipStart: 10, clipDuration: 4 }), /brightness\(0\.5\)/,
    'preview effect expressions use clip-local progress');
assert.equal(evaluateMotionExpression('wiggle(2, 0.5)', { t: 1 }), evaluateMotionExpression('wiggle(2, 0.5)', { t: 1 }));
assert.equal(validateMotionExpression('value + wiggle(2, 3)').valid, true,
    'motion expression authoring accepts the current property value used by procedural offsets');
const valueExpressionLayer = { x: 24, startTime: 0, duration: 4, expressions: { x: 'value + 10' } };
assert.equal(resolveMotionAt(valueExpressionLayer, 2).x, 34,
    'motion expressions can build on the resolved keyframed/base property instead of replacing it blindly');
assert.deepEqual(resolveWorkerMotionAt(valueExpressionLayer, 2), resolveMotionAt(valueExpressionLayer, 2),
    'procedural value expressions resolve identically in browser preview and Revideo export');

const gpuConfig = createGpuClipEffectConfigs('clip-expression', [{
    id: 'gpu-expression', kind: 'glow', params: { intensity: { value: 0, expression: 'progress' } },
}], { startTime: 10, duration: 4 })[0];
assert.equal(gpuConfig.params.intensity, 0, 'GPU clip effects keep the authored base value');
assert.equal(gpuConfig.expressions.intensity, 'progress', 'GPU clip adaptation preserves authored expressions');
const gpuEffect = new EffectNode(gpuConfig);
assert.equal(gpuEffect.getParamsAt(12, { placement: { startTime: 10, duration: 4 } }).intensity, 0.5,
    'GPU effect expression preview evaluates against clip-local progress');
assert.equal(EffectNode.deserialize(gpuEffect.serialize()).getParamsAt(12, {
    placement: { startTime: 10, duration: 4 },
}).intensity, 0.5, 'GPU effect expressions survive project serialization and reload');
const editablePipeline = new EffectPipeline();
editablePipeline.addEffect(gpuConfig);
editablePipeline.updateEffect(gpuConfig.id, { params: { intensity: { value: 0, expression: '0.25 + progress' } } });
assert.equal(editablePipeline.getEffect(gpuConfig.id).getParamsAt(12, {
    placement: { startTime: 10, duration: 4 },
}).intensity, 0.75, 'effect parameter edits update the live GPU expression as well as its value');

const plan = buildCompositionPlan([
    { id: 'base-track', type: 'video', clips: [{ id: 'base', type: 'video', start: 0, duration: 2 }] },
    { id: 'overlay-track', type: 'video', role: 'overlay', clips: [{
        id: 'overlay', type: 'video', start: 0, startTime: 0, duration: 2,
        effects: [{ kind: 'brightness', params: { amount: { value: 1, expression: '0.5 + 0.5*t' } } }],
    }] },
]);
const overlaySamples = plan.overlays[0].effects[0].samples.amount;
assert.ok(overlaySamples.some(point => Math.abs(point.value - 1.5) < 0.01));

const basePlan = buildCompositionPlan([{
    id: 'base-only', type: 'video', clips: [{
        id: 'main-footage', type: 'video', start: 10, duration: 2,
        effects: [{ kind: 'brightness', params: { amount: { value: 1, expression: '0.5 + progress' } } }],
    }],
}]);
assert.equal(planIsNoOp(basePlan), false, 'base footage expressions keep their samples in the export request without overlay layers');
const baseCompiled = exportProcessor.compileTimelineVisualEffects(basePlan.base.effectsByClip[0].effects, { duration: 2 });
assert.ok(baseCompiled.some(filter => filter.includes('0.500000') && filter.includes('1.500000')),
    'the main-footage filter compiler consumes the compositor-sampled expression curve');
const mergedBaseEffects = exportProcessor.applyEffectSamples(
    [{ kind: 'brightness', params: { amount: 1 } }],
    basePlan.base.effectsByClip[0].effects,
);
assert.ok(mergedBaseEffects[0].samples.amount.length > 2,
    'the export worker maps sampled base curves back onto the original clip effects');
assert.equal(mergedBaseEffects[0].samples.amount[0].value, 0.5);
assert.equal(mergedBaseEffects[0].samples.amount.at(-1).value, 1.5,
    'base footage export samples the same clip-local progress curve as preview');

const sampledEffect = {
    kind: 'brightness',
    params: { amount: { value: 1, expression: 't' } },
    samples: { amount: [{ t: 0, value: 0.5 }, { t: 1, value: 1.5 }] },
};
const filters = exportProcessor.compileTimelineVisualEffects([sampledEffect], { duration: 1 });
assert.ok(filters.some(filter => filter.includes('eq=brightness=')));
assert.ok(filters.some(filter => filter.includes('0.500000')));
assert.ok(filters.some(filter => filter.includes('1.500000')));

console.log('Effect expression checks passed');
