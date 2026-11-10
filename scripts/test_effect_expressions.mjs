import assert from 'node:assert/strict';
import { resolveEffectAtTime } from '../client/src/motion/EffectTiming.js';
import { resolveTimelineEffectFilter } from '../client/src/motion/TimelineVisualEffects.js';
import { evaluateMotionExpression } from '../client/src/motion/MotionExpression.js';
import { evaluateMotionExpression as evaluateWorkerMotionExpression } from '../render-worker/revideo/src/motion/MotionExpression.js';
import { resolveMotionAt } from '../client/src/motion/MotionResolver.js';
import { validateMotionExpression } from '../client/src/motion/MotionExpression.js';
import { validateMotionExpression as validateWorkerMotionExpression } from '../render-worker/revideo/src/motion/MotionExpression.js';
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
const vectorExpression = {
    kind: 'glow',
    params: { color: { value: [0.1, 0.2, 0.3] } },
    keyframes: { color: [{ time: 0, value: [0.1, 0.2, 0.3] }, { time: 2, value: [0.3, 0.4, 0.5] }] },
    expressions: { color: 'value + progress * 0.2' },
};
assert.deepEqual(resolveEffectAtTime(vectorExpression, 1, { clipDuration: 2 }).params.color.value.map(value => Number(value.toFixed(6))), [0.3, 0.4, 0.5],
    'vector effect expressions evaluate independently over the interpolated channel values');
const effectVectorTrack = new EffectNode({
    type: 'glow',
    params: { color: [0, 0] },
    keyframes: { color: [
        { time: 0, value: [0, 0] },
        { time: 1, value: [Number.NaN, 4] },
        { time: 2, value: [2, 2] },
    ] },
});
assert.deepEqual(effectVectorTrack.getParamAt('color', 1), [1, 1],
    'effect tracks ignore partially invalid vector keyframes instead of synthesizing mixed channels');
const dimensionChangeTrack = new EffectNode({
    type: 'glow',
    params: { color: [0, 0, 0] },
    keyframes: { color: [
        { time: 0, value: [0, 0, 0] },
        { time: 2, value: [1, 1, 1, 1] },
    ] },
});
assert.deepEqual(dimensionChangeTrack.getParamAt('color', 0.5), [0, 0, 0],
    'effect tracks hold the nearest complete vector when channel dimensions change');
assert.deepEqual(dimensionChangeTrack.getParamAt('color', 1.5), [1, 1, 1, 1],
    'effect tracks switch to the nearest complete vector after the midpoint');
const serializedNumericTrack = new EffectNode({
    type: 'blur',
    params: { radius: { value: 0, type: 'float' } },
    keyframes: { radius: [
        { time: 0, value: '0' },
        { time: 10, value: '10' },
    ] },
});
assert.equal(serializedNumericTrack.getParamAt('radius', 5), 5,
    'numeric strings from serialized effect tracks are normalized and interpolated');
const legacyPropertyTrack = new EffectNode({
    type: 'blur',
    params: { radius: { value: 0, type: 'float' } },
    keyframes: { radius: [
        { time: 0, properties: { radius: 0 } },
        { time: 10, properties: { radius: 20 } },
    ] },
});
assert.equal(legacyPropertyTrack.getParamAt('radius', 5), 10,
    'GPU effect preview samples legacy sparse property keyframes like the shared export resolver');
const enumTrack = new EffectNode({
    type: 'transition',
    params: { direction: { value: 'left', type: 'select' } },
    keyframes: { direction: [
        { time: 0, value: 'left' },
        { time: 10, value: 'right' },
    ] },
});
assert.equal(enumTrack.getParamAt('direction', 4), 'left',
    'select effect parameters remain discrete while numeric parameters normalize serialized strings');
const clipProgressEffect = { kind: 'brightness', params: { amount: { value: 0, expression: 'progress' } } };
assert.match(resolveTimelineEffectFilter([clipProgressEffect], 12, { clipStart: 10, clipDuration: 4 }), /brightness\(0\.5\)/,
    'preview effect expressions use clip-local progress');
assert.equal(evaluateMotionExpression('wiggle(2, 0.5)', { t: 1 }), evaluateMotionExpression('wiggle(2, 0.5)', { t: 1 }));
for (const [expression, expected] of [
    ['linear(progress, 0, 1, 10, 110)', 60],
    ['linear(1.5, 0, 1, 0, 100)', 150],
    ['ease(progress, 0, 1, 0, 100)', 50],
    ['easeIn(progress, 0, 1, 0, 100)', 25],
    ['easeOut(progress, 0, 1, 0, 100)', 75],
]) {
    const variables = { t: 0.5, time: 0.5, duration: 1, progress: 0.5, value: 0.5 };
    const clientValue = evaluateMotionExpression(expression, variables);
    assert.equal(clientValue, expected, `${expression} evaluates with the expected remap curve`);
    assert.equal(evaluateWorkerMotionExpression(expression, variables), clientValue,
        `${expression} matches in browser preview and Revideo export`);
    assert.equal(validateMotionExpression(expression).valid, true, `${expression} is accepted by authoring validation`);
}
assert.equal(evaluateMotionExpression('ease(0.5, 0, 1)', { t: 0.5 }), null,
    'keyframe remappers reject incomplete argument lists');
assert.equal(validateMotionExpression('value + wiggle(2, 3)').valid, true,
    'motion expression authoring accepts the current property value used by procedural offsets');
for (const validate of [validateMotionExpression, validateWorkerMotionExpression]) {
    assert.equal(validate('customAmount * 2', { variables: ['t', 'customAmount'] }).valid, true,
        'custom declared variables receive deterministic validation probe values');
    assert.deepEqual(validate('1 / (customAmount - 1)', { variables: ['t', 'customAmount'] }),
        { valid: false, reason: 'non_finite' },
        'custom variable probes still reject expressions with sampled singularities');
}
assert.deepEqual(validateMotionExpression('1 / (t - 1)'), { valid: false, reason: 'non_finite' },
    'expression validation rejects formulas that become non-finite at an interior sample time');
for (const expression of ['sin(1, 2)', 'clamp(0.5, 0)', 'noise(1, 2, 3)', 'wiggle(2)']) {
    assert.equal(evaluateMotionExpression(expression), null, `client rejects invalid function arity: ${expression}`);
    assert.equal(evaluateWorkerMotionExpression(expression), null, `worker rejects invalid function arity: ${expression}`);
}
for (const expression of ['sin(1)', 'clamp(0, 1, 0.5)', 'noise(1, 2)', 'wiggle(2, 0.5, 4)']) {
    assert.equal(evaluateWorkerMotionExpression(expression), evaluateMotionExpression(expression),
        `client and worker agree on expression output: ${expression}`);
}
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
const boundedGpuEffect = new EffectNode({
    ...gpuConfig,
    id: 'gpu-windowed-expression',
    startTime: 11,
    endTime: 13,
});
assert.equal(boundedGpuEffect.getParamsAt(12, { placement: { startTime: 10, duration: 4 } }).intensity, 0.5,
    'GPU effect preview uses the effect window for progress when it is narrower than its clip');
assert.equal(boundedGpuEffect.getParamsAt(13, { placement: { startTime: 10, duration: 4 } }).intensity, 1,
    'GPU effect preview reaches progress one at the end of its own window');
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

const vectorPlan = buildCompositionPlan([{
    id: 'vector-base', type: 'video', clips: [{
        id: 'vector-footage', type: 'video', start: 0, duration: 2,
        effects: [{ ...vectorExpression, params: { color: { value: [0.1, 0.2, 0.3] } } }],
    }],
}]);
const vectorSamples = vectorPlan.base.effectsByClip[0].effects[0].samples.color;
assert.ok(vectorSamples.some(point => Array.isArray(point.value) && point.value[0] > 0.2),
    'composition planning retains sampled vector expression channels for export');
const vectorFilters = exportProcessor.compileTimelineVisualEffects([{
    kind: 'glow', params: { color: [26, 51, 77], intensity: 1 },
    samples: { color: vectorSamples },
}], { duration: 2, complexGlow: true });
assert.ok(vectorFilters.some(filter => filter.includes('color') && filter.includes('if(')),
    'glow export compiles animated vector color channels into the effect filter');
const vectorPipeline = new EffectPipeline();
vectorPipeline.addEffect({
    id: 'vector-expression-effect', targetId: 'vector-pipeline-clip', type: 'glow',
    params: { color: { value: [0.1, 0.2, 0.3] }, intensity: 1 },
    expressions: { color: 'value + progress * 0.2' },
});
const vectorJob = await vectorPipeline.buildRenderJob({ tracks: [{ id: 'track', clips: [{
    id: 'vector-pipeline-clip', type: 'video', start: 0, duration: 2,
}], }], duration: 2 });
const pipelineVectorSamples = vectorJob.timeline.tracks[0].clips[0].effects[0].samples.color;
assert.ok(pipelineVectorSamples.some(point => Array.isArray(point.value) && point.value[0] > 0.2),
    'effect graph export samples vector expressions before handing them to the render worker');

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
