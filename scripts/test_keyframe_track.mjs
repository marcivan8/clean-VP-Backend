import assert from 'node:assert/strict';
import { resolveMotionAt, resolvedToCSS, sampleAnimation, sampleKeyframeTrack } from '../client/src/motion/MotionResolver.js';
import { evaluateKeyframes } from '../client/src/motion/CameraMotionCompiler.js';
import { clipToMotionLayer } from '../client/src/motion/ClipAdapter.js';
import { buildCompositionPlan } from '../client/src/motion/Compositor.js';
import { createNode, createScene, flattenScene, NODE_TYPES } from '../client/src/motion/SceneSchema.js';
import { isKnownEasing, resolveEasing } from '../client/src/motion/Easing.js';
import { evaluateMotionExpression, validateMotionExpression } from '../client/src/motion/MotionExpression.js';
import { EffectNode } from '../client/src/effects/EffectNode.js';
import { resolveEffectAtTime } from '../client/src/motion/EffectTiming.js';
import { compilePath } from '../client/src/motion/SceneMotion.js';
import { animationsToParamTracks, paramTracksToAnimations } from '../client/src/motion/KeyframeBridge.js';
import { appendMotionPathPoint, createMotionPath, MAX_MOTION_PATH_POINTS, removeMotionPathPoint, updateMotionPathPoint } from '../client/src/motion/MotionPath.js';
import fs from 'node:fs';

const linear = [{ time: 0, value: 2 }, { time: 2, value: 6 }];
assert.equal(sampleKeyframeTrack(linear, 1, 0), 4);

const authoredPath = createMotionPath(4);
assert.equal(authoredPath.duration, 4, 'new paths span the clip duration');
assert.equal(authoredPath.arcLength, true, 'new Bézier paths use even arc-length travel');
const changedPath = updateMotionPathPoint(authoredPath, 1, 'x', 24);
assert.deepEqual(changedPath.points[1], [24, -10], 'waypoint editing changes only the selected coordinate');
assert.equal(authoredPath.points[1][0], 15, 'waypoint edits preserve immutable history snapshots');
const extendedPath = appendMotionPathPoint(changedPath);
assert.deepEqual(extendedPath.points.at(-1), [48, -20], 'adding a waypoint continues the existing tangent');
let boundedPath = extendedPath;
while (boundedPath.points.length < MAX_MOTION_PATH_POINTS) boundedPath = appendMotionPathPoint(boundedPath);
assert.equal(appendMotionPathPoint(boundedPath), boundedPath, 'motion paths enforce the renderer-safe waypoint limit');
assert.equal(removeMotionPathPoint(authoredPath, 0).points.length, 2, 'paths retain the two-point minimum');
const editablePathLayer = clipToMotionLayer({ id: 'authored-path', type: 'image', start: 0, duration: 4, x: 50, y: 50,
  motionPath: { ...authoredPath, points: [[0, 0], [20, 0]], easing: 'linear' } });
assert.equal(resolveMotionAt(editablePathLayer, 2).x, 60, 'an authored path resolves to the expected midpoint in preview space');
const pathPlan = buildCompositionPlan([
  { id: 'base', type: 'video', order: 0, clips: [{ id: 'base-clip', type: 'video', start: 0, duration: 4, url: 'base.mp4' }] },
  { id: 'graphics', type: 'video', order: 1, clips: [{ id: 'path-overlay', type: 'image', start: 0, duration: 4, url: 'overlay.png', x: 50, y: 50,
    motionPath: { ...authoredPath, points: [[0, 0], [20, 0]], easing: 'linear' } }] },
], { width: 1080, height: 1920, fps: 30 });
const pathGeometry = pathPlan.overlays.find(overlay => overlay.clipId === 'path-overlay')?.geometry || [];
assert.equal(pathGeometry.length, 2, 'linear motion-path export samples reduce to their exact endpoints');
assert.ok(Math.abs(pathGeometry[0].x - 0.375) < 0.002 && Math.abs(pathGeometry[1].x - 0.575) < 0.002,
  'the exported composition geometry carries the motion-path displacement, not just the preview resolver');
assert.ok(Math.abs((pathGeometry[0].x + pathGeometry[1].x) / 2 - 0.475) < 0.002,
  'the export geometry interpolates through the authored motion-path midpoint');

const unevenMotionPath = {
  points: [[0, 0], [5, 0], [100, 0], [100, 100]],
  duration: 4, easing: 'linear', arcLength: true, bank: 0.4,
};
const flattenedPathAnimation = compilePath(unevenMotionPath, { duration: 4 });
assert.equal(flattenedPathAnimation.keyframes.length, 24,
  'scene motion paths use the available keyframe budget to reduce flattening error');
for (const time of [0.25, 0.5, 1, 2, 3]) {
  const resolved = resolveMotionAt({ startTime: 0, duration: 4, x: 0, y: 0, motionPath: unevenMotionPath }, time);
  const flattened = sampleAnimation(flattenedPathAnimation, time);
  assert.ok(Math.hypot(resolved.x - flattened.x, resolved.y - flattened.y) < 1.5,
    `flattened scene path tracks the continuous resolver at ${time}s`);
  assert.ok(Math.abs(resolved.rotation - flattened.rotation) < 1.5,
    `flattened path banking tracks the continuous resolver at ${time}s`);
}
assert.deepEqual(sampleKeyframeTrack([
  { time: 0, value: [1, 0, 0] }, { time: 2, value: [0, 0.5, 1] },
], 1, [0, 0, 0]), [0.5, 0.25, 0.5], 'same-dimension vector tracks interpolate each channel');
assert.deepEqual(sampleKeyframeTrack([
  { time: 0, value: [1, 0, 0] }, { time: 2, value: [0, 1, 0, 1] },
], 0.75, [0, 0, 0]), [1, 0, 0], 'incompatible vector dimensions hold the nearer authored value');
const animatedVectorEffect = resolveEffectAtTime({
  kind: 'glow', params: { color: { value: [1, 0, 0] } },
  keyframes: { color: [{ time: 0, value: [1, 0, 0] }, { time: 2, value: [0, 0.5, 1] }] },
}, 1);
assert.deepEqual(animatedVectorEffect.params.color.value, [0.5, 0.25, 0.5],
  'wrapped vector effect parameters keep animated color channels in the shared preview/export timing resolver');
assert.equal(sampleKeyframeTrack([{ time: 0, value: 0 }, { time: 1, value: 1, easing: 'ease-in' }], 0.5), 0.25);
const customBezier = 'cubic-bezier(0.42, 0, 0.58, 1)';
assert.equal(isKnownEasing(customBezier), true, 'custom Bézier strings are accepted by the canonical easing engine');
assert.ok(Math.abs(resolveEasing(customBezier)(0.5) - 0.5) < 1e-6, 'custom Bézier controls evaluate through the canonical curve solver');
const animatedEffect = new EffectNode({ type: 'blur', params: { radius: { value: 0 } } });
animatedEffect.addKeyframe('radius', 0, 0, 'linear');
animatedEffect.addKeyframe('radius', 1, 1, customBezier);
assert.ok(Math.abs(animatedEffect.getParamAt('radius', 0.25) - resolveEasing(customBezier)(0.25)) < 1e-9,
  'effect parameter keyframes use the canonical custom Bézier curve instead of silently falling back to linear');
assert.equal(animatedEffect.getParamAt('radius', 0.5), 0.5, 'canonical easing keeps symmetric effect keyframes consistent');
const vectorEffect = new EffectNode({ type: 'vector', params: { position: { value: [0, 0] } } });
vectorEffect.addKeyframe('position', 0, [0, 10]);
vectorEffect.addKeyframe('position', 1, [20, 30]);
assert.deepEqual(vectorEffect.getParamAt('position', 0.5), [10, 20], 'same-dimension vector parameters interpolate each finite component');
vectorEffect.keyframes.position = [{ time: 0, value: [0, 10] }, { time: 1, value: [20] }];
assert.deepEqual(vectorEffect.getParamAt('position', 0.25), [0, 10], 'vectors with incompatible dimensions switch discretely without generating NaN components');
assert.deepEqual(vectorEffect.getParamAt('position', 0.75), [20], 'incompatible effect vectors return the nearest authored value without padding channels');
assert.deepEqual(vectorEffect.getParamAt('position', 0.75), sampleKeyframeTrack(vectorEffect.keyframes.position, 0.75),
  'effect and shared motion keyframe samplers agree when vector dimensions differ');
vectorEffect.keyframes.position = [{ time: 0, value: [0, 10] }, { time: 1, value: [20, Number.NaN] }];
assert.deepEqual(vectorEffect.getParamAt('position', 0.75), [20, 10], 'malformed vector components fall back to the nearest finite authored value');
animatedEffect.keyframes.radius = [
  { time: 0, value: 0.2 },
  { time: 1, value: 0.4 },
  { time: 1, value: 0.8 },
  { time: 2, value: 1 },
];
assert.equal(animatedEffect.getParamAt('radius', 1), 0.8, 'effect tracks use the later-authored value when keyframes share a timestamp');
animatedEffect.keyframes.radius = [{ time: 'bad', value: 0.2 }, { time: 1, value: 0.8 }];
assert.equal(animatedEffect.getParamAt('radius', 0.5), 0.8, 'malformed effect keyframes are ignored without destabilizing the track');
animatedEffect.keyframes.radius = [{ time: 'bad', value: 0.2 }];
assert.equal(animatedEffect.getParamAt('radius', 0.5), 0, 'an effect track with no valid keys returns its authored base parameter');
animatedEffect.keyframes.radius = [{ time: '1', value: 0.2 }];
assert.equal(animatedEffect.addKeyframe('radius', 1, 0.7), true, 'keyframe editing accepts finite numeric timestamps');
assert.deepEqual(animatedEffect.keyframes.radius, [{ time: 1, value: 0.7, easing: 'linear' }],
  'adding a numeric timestamp replaces an imported equivalent numeric-string timestamp');
assert.equal(animatedEffect.getParamAt('radius', 1), 0.7, 'the replaced timestamp has one deterministic sampled value');
assert.equal(animatedEffect.addKeyframe('radius', Number.NaN, 0.3), false, 'invalid keyframe timestamps are rejected');
assert.equal(animatedEffect.removeKeyframe('radius', '1'), true, 'keyframe removal normalizes numeric-string timestamps');
assert.deepEqual(animatedEffect.keyframes.radius, [], 'removing an equivalent timestamp removes the track point');
const editorSource = fs.readFileSync(new URL('../client/src/components/Effects/KeyframeEditor.jsx', import.meta.url), 'utf8');
const effectControlsSource = fs.readFileSync(new URL('../client/src/components/Effects/EffectControls.jsx', import.meta.url), 'utf8');
assert.match(effectControlsSource, /validateMotionExpression\(draft/, 'effect expressions are validated before they are persisted');
assert.match(effectControlsSource, /onBlur=\{commitExpression\}/, 'effect expression edits commit only after validation');
assert.match(effectControlsSource, /aria-invalid=\{!!expressionError\}/, 'invalid effect expressions are exposed to assistive technology');
assert.match(effectControlsSource, /scene3d\.expressionErrors\.\$\{expressionError\}/, 'effect expression failures use localized validation messages');
assert.match(editorSource, /easingCustomBezier/, 'the keyframe editor exposes an authorable custom Bézier option');
assert.match(editorSource, /BEZIER_CONTROL_NAMES\.map/, 'the keyframe editor exposes all four Bézier control values');
assert.match(editorSource, /encodeBezierControls\(next\)/, 'editing a Bézier control persists the curve on its keyframe');
assert.match(editorSource, /onBlur=\{\(e\) => updateBezierControl/, 'Bézier controls commit only after entry, so partial decimals remain editable');
assert.match(editorSource, /aria-label=\{`\$\{t\('effects\.bezierControls'\)\} \$\{name\}`\}/, 'Bezier controls have accessible names');
assert.match(editorSource, /easingCustomSteps/, 'the keyframe editor exposes an authorable custom step easing');
assert.match(editorSource, /encodeStepControls\(next\)/, 'step count and position edits persist to the keyframe');
assert.match(editorSource, /aria-label=\{t\('effects\.stepPosition'\)\}/, 'the step position control has an accessible name');
assert.equal(sampleKeyframeTrack([{ time: 1, value: 3 }, { time: 1, value: 8 }], 1), 8,
  'later authored values replace duplicate-time keys');
const duplicateMotionKeys = { duration: 2, easing: 'linear', keyframes: [
  { time: 1, properties: { x: 3 }, easing: 'linear' },
  { time: 1, properties: { x: 8 }, easing: 'easeOutCubic' },
] };
assert.equal(animationsToParamTracks([duplicateMotionKeys], 2).x[0].value, sampleAnimation(duplicateMotionKeys, 1).x,
  'the transform editor retains the same later-authored duplicate-time key as the motion resolver');
const nearbyMotionKeys = { duration: 2, easing: 'linear', keyframes: [
  { time: 0, properties: { x: 0 } },
  { time: 1, properties: { x: 10 } },
  { time: 1.00005, properties: { x: 20 } },
  { time: 2, properties: { x: 30 } },
] };
assert.deepEqual(animationsToParamTracks([nearbyMotionKeys], 2).x.map(key => key.time),
  [0, 1, 1.00005, 2], 'distinct keyframes closer than 0.1 ms remain distinct in the transform editor');
assert.ok(Math.abs(sampleAnimation(nearbyMotionKeys, 1.000025).x - 15) < 1e-8,
  'the motion resolver interpolates between near-duplicate but distinct timestamps');
assert.equal(sampleKeyframeTrack([{ time: 1, value: 3 }], -2, 10), 3);
assert.equal(sampleKeyframeTrack([], 1, 10), 10);
assert.equal(evaluateKeyframes([{ time: 0, value: 0 }, { time: 1, value: 1, easing: 'steps(4)' }], 0.6), 0.5,
  'camera export keyframes use the same canonical step interpolation');
const procedural = clipToMotionLayer({ id: 'procedural', start: 4, duration: 4, x: 10, expressions: { x: '50 + 10*sin(t)', opacity: '1-progress', ignored: 'window.alert(1)' } });
const proceduralAt = resolveMotionAt(procedural, 6);
assert.ok(Math.abs(proceduralAt.x - (50 + 10 * Math.sin(2))) < 1e-9, 'safe procedural expressions evaluate against layer-local time');
assert.equal(proceduralAt.opacity, 0.5, 'procedural expressions can use normalized clip progress');
const axisLayer = clipToMotionLayer({
  id: 'axis-scale', start: 0, duration: 2, scale: 2, scaleX: 1, scaleY: 3,
  animations: [{ id: 'stretch', type: 'scale', duration: 2, keyframes: [
    { time: 0, properties: { scaleX: 1, scaleY: 1 } },
    { time: 2, properties: { scaleX: 2, scaleY: 0.5 } },
  ] }],
});
const axisAt = resolveMotionAt(axisLayer, 1);
assert.equal(axisAt.scale, 2, 'uniform scale remains independent from axis scale');
assert.equal(axisAt.scaleX, 0.75, 'horizontal scale interpolates then composes with the clip axis ratio');
assert.equal(axisAt.scaleY, 1.125, 'vertical scale interpolates then composes with the clip axis ratio');
assert.match(resolvedToCSS(axisAt).transform, /scaleX\(0\.75\).*scaleY\(1\.125\)/,
  'DOM transform serializes the resolved independent scale axes');
assert.equal(resolveMotionAt({ startTime: 0, duration: 2, scaleX: 2, scaleY: 0.5 }, 1).scaleX, 2,
  'base layers can define independent scale axes without animation');
const axisTracks = animationsToParamTracks(axisLayer.animations, 2);
assert.equal(axisTracks.scaleX.length, 2, 'keyframe editor bridge exposes horizontal scale animation tracks');
assert.equal(axisTracks.scaleY.length, 2, 'keyframe editor bridge exposes vertical scale animation tracks');
assert.deepEqual(paramTracksToAnimations(axisTracks, 2)[0].keyframes[1].properties,
  { scaleX: 2, scaleY: 0.5 }, 'independent scale axes survive a keyframe editor round trip');
const transformPanelSource = fs.readFileSync(new URL('../client/src/components/TransformPanel.jsx', import.meta.url), 'utf8');
assert.match(transformPanelSource, /getKeyframeState\('scaleX'\)/, 'transform inspector exposes horizontal scale keyframing');
assert.match(transformPanelSource, /getKeyframeState\('scaleY'\)/, 'transform inspector exposes vertical scale keyframing');
const videoPlayerSource = fs.readFileSync(new URL('../client/src/components/Player/VideoPlayer.jsx', import.meta.url), 'utf8');
assert.match(videoPlayerSource, /import \{ resolveMotionAt, sampleKeyframeTrack \} from '\.\.\/\.\.\/motion\/MotionResolver\.js'/,
  'timeline preview imports the canonical sampler used by scene motion and export');
assert.match(videoPlayerSource, /function interpolateKeyframes\(propKeyframes, defaultVal, localTime\) \{\s*return sampleKeyframeTrack\(propKeyframes, localTime, defaultVal\);\s*\}/,
  'timeline transform preview delegates sorting, duplicate handling and easing to the canonical keyframe sampler');
assert.match(videoPlayerSource, /resolvedMotion\?\.scaleX[^\n]*interpolateKeyframes\(kf\.scaleX/, 'base clip preview composes horizontal axis keyframes with the transform');
assert.match(videoPlayerSource, /resolvedMotion\?\.scaleY[^\n]*interpolateKeyframes\(kf\.scaleY/, 'base clip preview composes vertical axis keyframes with the transform');
assert.equal(resolveMotionAt({ startTime: 4, duration: 2 }, 5.999).visible, true,
  'motion layers remain visible up to but not including their end boundary');
assert.equal(resolveMotionAt({ startTime: 4, duration: 2 }, 6).visible, false,
  'motion layer visibility uses the same half-open timing interval as timeline clips');
assert.equal(procedural.expressions.ignored, 'window.alert(1)', 'unrecognized properties remain inert');
assert.equal(resolveMotionAt({ startTime: 0, duration: 1, x: 23, expressions: { x: 'window.alert(1)' } }, 0.5).x, 23,
  'invalid expressions safely leave the authored base value unchanged');
const wiggleA = evaluateMotionExpression('wiggle(3, 12, 7)', { t: 1.25 });
assert.equal(wiggleA, evaluateMotionExpression('wiggle(3, 12, 7)', { t: 1.25 }),
  'seeded wiggle is deterministic for identical time and inputs');
assert.notEqual(wiggleA, evaluateMotionExpression('wiggle(3, 12, 7)', { t: 1.5 }),
  'wiggle changes continuously with clip-local time');
assert.ok(Math.abs(wiggleA) <= 12, 'wiggle remains within its authored amplitude');
assert.notEqual(evaluateMotionExpression('noise(1.25, 7)'), evaluateMotionExpression('noise(1.25, 8)'),
  'noise seeds produce independently repeatable procedural paths');
assert.equal(evaluateMotionExpression('wiggle(1, 2)', {}), evaluateMotionExpression('wiggle(1, 2)', { t: 0 }),
  'wiggle defaults to the deterministic time-zero sample when no clock is supplied');
assert.equal(evaluateMotionExpression('wiggle(1, 2, 3, 4)', { t: 1 }), null,
  'procedural expressions reject unsupported argument counts');
assert.equal(validateMotionExpression('1 + 0.12 * sin(2 * pi * t)').valid, true,
  'procedural authoring accepts supported time-based formulas');
assert.equal(validateMotionExpression('clamp(value + progress, 0, 1)', { variables: ['t', 'time', 'duration', 'progress', 'value'] }).valid, true,
  'expression validation can opt into effect parameter variables');
assert.deepEqual(validateMotionExpression('progres * 2'), { valid: false, reason: 'unknown_variable', detail: 'progres' },
  'expression validation identifies misspelled variables before save');
assert.equal(validateMotionExpression('window.alert(1)').reason, 'unsupported_syntax',
  'expression validation rejects JavaScript globals and member access');
assert.equal(validateMotionExpression('1 / 0').reason, 'non_finite',
  'expression validation rejects formulas that cannot produce a finite value');
const expressionScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.TEXT, {
  id: 'expression-scene-layer', duration: 1, content: 'Motion', expressions: { x: '50+10*sin(t)' },
})] });
assert.deepEqual(flattenScene(expressionScene).placements[0].clip.expressions, { x: '50+10*sin(t)' },
  'scene expressions survive the canonical scene-to-timeline compilation path');

console.log('Keyframe track checks passed: interpolation, easing, boundaries, camera export parity, and deterministic procedural expressions.');
