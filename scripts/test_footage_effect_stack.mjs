import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { TIMELINE_EFFECTS, resolveTimelineEffectFilter, resolveTimelineEffectTransform, resolveTimelineFadeOpacity, resolveTimelineFadeOverlays, resolveTimelineSvgEffectParams, resolveTimelineSvgEffectInstances, resolveTimelineVignetteStyle } from '../client/src/motion/TimelineVisualEffects.js';
import { resolveEffectAtTime } from '../client/src/motion/EffectTiming.js';
import { matteFilterGraph } from '../client/src/motion/MatteSettings.js';
import { EFFECT_DEFINITIONS } from '../client/src/effects/EffectRegistry.js';
import { listEasingNames, resolveEasing } from '../client/src/motion/Easing.js';
import { createGpuClipEffectConfigs } from '../client/src/effects/ClipEffectAdapter.js';
import { EffectPipeline } from '../client/src/effects/EffectPipeline.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const { compileTimelineVisualEffects, compileTimelineVisualEffectGraph, compileTimelineAudioEffects, resolveTimelineSpeedEffect, buildSpeedRetimePlan, applyRetimeEasing, compileScalarEffectTrack, collectTimelineEffectWarnings } = require('../jobs/exportProcessor.js');
const { compileOverlaySource } = require('../server/compositor/CompositorCompiler.js');
const timedEffect = { kind: 'contrast', params: { amount: 1 }, startTime: 4, endTime: 6, keyframes: { amount: [
  { time: 4, value: 1 }, { time: 6, value: 3, easing: 'linear' },
] } };
assert.equal(resolveEffectAtTime(timedEffect, 3.99), null, 'overlay effects stay off before their timeline start');
assert.equal(resolveEffectAtTime(timedEffect, 6), null, 'overlay effects stop at their exclusive timeline end');
assert.equal(resolveEffectAtTime(timedEffect, 5).params.amount, 2, 'overlay effect parameters sample project-time keyframes');
const footageFx = ['film-grain', 'chromatic-aberration', 'motion-blur', 'lens-distortion'];
const catalogue = new Map(TIMELINE_EFFECTS.map(effect => [effect.id, effect]));
const presetExportFilters = TIMELINE_EFFECTS.flatMap(({ id }) => {
  const effect = { id, enabled: true };
  const filters = compileTimelineVisualEffects([effect], { width: 96, height: 64, duration: 1 });
  assert.ok(filters.length > 0, `advertised visual preset ${id} compiles to an export filter`);
  assert.deepEqual(collectTimelineEffectWarnings([{ name: id, effects: [effect] }]), [],
    `advertised visual preset ${id} is not reported as skipped during export`);
  return filters;
});
const presetExportGraph = compileTimelineVisualEffectGraph(presetExportFilters, {
  input: '0:v', output: 'all_visual_presets',
}).join(';');
const presetExportRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=1:duration=1',
  '-filter_complex', presetExportGraph, '-map', '[all_visual_presets]', '-frames:v', '1', '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(presetExportRender.status, 0,
  `FFmpeg executes the complete advertised visual preset catalog: ${presetExportRender.stderr || presetExportRender.error?.message || ''}`);
const analyticSpringTrack = compileScalarEffectTrack([
  { time: 0, value: 0 }, { time: 0.2, value: 1, easing: 'spring(180,12)' },
]);
assert.match(analyticSpringTrack, /exp\(/, 'scalar effect tracks compile spring motion analytically instead of flattening it to fixed-rate samples');
assert.match(analyticSpringTrack, /cos\(/, 'underdamped scalar springs preserve their oscillation in export');
const analyticCircTrack = compileScalarEffectTrack([
  { time: 0, value: 0 }, { time: 1, value: 1, easing: 'easeOutCirc' },
]);
assert.match(analyticCircTrack, /sqrt\(/, 'scalar effects use the same analytic easing family as camera motion');
const exactStepTrack = compileScalarEffectTrack([
  { time: 0, value: 0 }, { time: 1, value: 1, easing: 'steps(4, jump-start)' },
]);
assert.match(exactStepTrack, /floor\(/, 'discrete scalar step curves keep exact jump boundaries in export');
const springFrameParity = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc='${analyticSpringTrack}':s=20:d=0.2`,
  '-f', 'f32le', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(springFrameParity.status, 0,
  `FFmpeg renders the compiled spring curve: ${springFrameParity.stderr?.toString() || springFrameParity.error?.message || ''}`);
for (let frame = 0; frame < 4; frame++) {
  const time = frame / 20;
  const expected = resolveEasing('spring(180,12)')(time / 0.2);
  const actual = springFrameParity.stdout.readFloatLE(frame * 4);
  assert.ok(Math.abs(actual - expected) <= 1e-5,
    `spring export frame ${frame} matches the canonical preview easing (expected ${expected}, got ${actual})`);
}
const bezierEasing = 'cubic-bezier(0.8,-0.5,0.9,1.5)';
const bezierTrack = compileScalarEffectTrack([
  { time: 0, value: 0 }, { time: 1, value: 1, easing: bezierEasing },
]);
assert.ok(bezierTrack.length < 10000, 'adaptive Bézier export remains within a bounded expression size');
const bezierFrameParity = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc='${bezierTrack}':s=120:d=1`,
  '-f', 'f32le', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(bezierFrameParity.status, 0,
  `FFmpeg renders the compiled custom Bézier curve: ${bezierFrameParity.stderr?.toString() || bezierFrameParity.error?.message || ''}`);
const canonicalBezier = resolveEasing(bezierEasing);
let maxBezierError = 0;
for (let frame = 0; frame < 120; frame++) {
  const actual = bezierFrameParity.stdout.readFloatLE(frame * 4);
  maxBezierError = Math.max(maxBezierError, Math.abs(actual - canonicalBezier(frame / 120)));
}
assert.ok(maxBezierError < 0.001,
  `custom Bézier export matches canonical preview at frame cadence (max normalized error ${maxBezierError})`);
const easingMismatches = [];
for (const easing of listEasingNames()) {
  const track = compileScalarEffectTrack([
    { time: 0, value: 0 }, { time: 1, value: 1, easing },
  ]);
  const rendered = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc='${track}':s=30:d=1`,
    '-f', 'f32le', 'pipe:1',
  ], { encoding: null, timeout: 20000 });
  if (rendered.status !== 0) {
    easingMismatches.push(`${easing}: FFmpeg rejected the easing expression`);
    continue;
  }
  const canonical = resolveEasing(easing);
  for (let frame = 0; frame < 30; frame++) {
    const actual = rendered.stdout.readFloatLE(frame * 4);
    const expected = canonical(frame / 30);
    if (Math.abs(actual - expected) > 0.002) {
      easingMismatches.push(`${easing} at frame ${frame}: expected ${expected}, got ${actual}`);
      break;
    }
  }
}
assert.deepEqual(easingMismatches, [],
  'all 70 canonical easing names and aliases render through FFmpeg within 0.002 normalized progress of preview');
for (const id of footageFx) assert.ok(catalogue.has(id), `${id} is available in the visual effect shelf`);
const selected = footageFx.map(id => catalogue.get(id));
const preview = resolveTimelineEffectFilter(selected);
assert.match(preview, /vibed-film-grain/);
assert.match(preview, /vibed-chromatic-aberration/);
assert.match(preview, /vibed-motion-blur/);
assert.match(preview, /vibed-lens-distortion/);
assert.equal(resolveTimelineEffectFilter([{ kind: 'glitch', params: { intensity: 0.5 } }]), 'url(#vibed-glitch-0)', 'glitch uses its own preview treatment instead of lens distortion');
assert.equal(resolveTimelineEffectFilter([{ kind: 'glow', params: { radius: 6, threshold: 0.8, intensity: 0.9, color: '#00C8FF' } }]), 'url(#vibed-highlight-glow-0)', 'glow preview uses the same highlight-bloom treatment as export');
const stackedGlowEffects = [
  { kind: 'glow', params: { radius: 3, threshold: 0.4, intensity: 0.5, color: '#FF0000' } },
  { kind: 'glow', params: { radius: 12, threshold: 0.85, intensity: 1.7, color: '#0000FF' } },
];
assert.equal(resolveTimelineEffectFilter(stackedGlowEffects), 'url(#vibed-highlight-glow-0) url(#vibed-highlight-glow-1)',
  'same-type SVG effects keep separate filter ids in the preview chain');
const stackedGlowDefinitions = resolveTimelineSvgEffectInstances(stackedGlowEffects);
assert.deepEqual(stackedGlowDefinitions.map(({ id }) => id), ['vibed-highlight-glow-0', 'vibed-highlight-glow-1'],
  'the preview emits one SVG filter definition for every active effect instance');
assert.deepEqual(stackedGlowDefinitions.map(({ params }) => params.glow.radius), [3, 12],
  'stacked SVG filters retain their own authored parameters');
const reorderedEffects = [
  { kind: 'brightness', order: 20, params: { amount: 1.4 } },
  { kind: 'contrast', order: 10, params: { amount: 1.8 } },
];
const reorderedPreview = resolveTimelineEffectFilter(reorderedEffects);
assert.ok(reorderedPreview.indexOf('contrast(') < reorderedPreview.indexOf('brightness('),
  'preview applies footage effects in authored stack order rather than storage-array order');
const reorderedExport = compileTimelineVisualEffects(reorderedEffects).join(',');
assert.ok(reorderedExport.indexOf('eq=contrast=') < reorderedExport.indexOf('colorchannelmixer='),
  'FFmpeg export applies the same authored footage effect order as preview');
const reorderedRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x646464:s=2x2:d=1',
  '-vf', reorderedExport, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { timeout: 20000 });
assert.equal(reorderedRender.status, 0, `FFmpeg renders the ordered effect stack: ${reorderedRender.stderr?.toString() || reorderedRender.error?.message || ''}`);
assert.ok(Math.abs(reorderedRender.stdout[0] - 102) <= 5,
  `authored contrast-then-brightness stack produces the expected pixel, received ${reorderedRender.stdout[0]}`);
const invertedOrderRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x646464:s=2x2:d=1',
  '-vf', compileTimelineVisualEffects([
    { kind: 'brightness', order: 10, params: { amount: 1.4 } },
    { kind: 'contrast', order: 20, params: { amount: 1.8 } },
  ]).join(','), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { timeout: 20000 });
assert.equal(invertedOrderRender.status, 0, `FFmpeg renders the alternate effect order: ${invertedOrderRender.stderr?.toString() || invertedOrderRender.error?.message || ''}`);
assert.ok(Math.abs(invertedOrderRender.stdout[0] - reorderedRender.stdout[0]) > 20,
  'changing authored effect order changes the rendered pixels, proving the order is executed');
const gpuBlurEffects = [
  { id: 'radial', kind: 'blur_radial', params: { intensity: 0.6, centerX: 0.25, centerY: 0.7, samples: 8 } },
  { id: 'directional', kind: 'motion-blur', params: { intensity: 0.8, angle: 45, samples: 24 } },
  { kind: 'glow', params: { intensity: 1, color: '#00C8FF' } },
  { kind: 'film-grain', params: { amount: 24 }, keyframes: { amount: [{ time: 0, value: 48 }] } },
  { kind: 'glitch', params: { amount: 16 } },
  { kind: 'chromatic-aberration', params: { amount: 3 } },
  { kind: 'color_grade', params: { temperature: 10 } },
  { kind: 'blur', params: { radius: 4 } },
  { kind: 'vignette', params: { intensity: 0.5, color: '#000000' } },
  { kind: 'blur_motion', enabled: false, params: { intensity: 0.3 } },
];
const gpuConfigs = createGpuClipEffectConfigs('clip-main', gpuBlurEffects);
assert.deepEqual(gpuConfigs.map(({ type }) => type), [
  'blur_radial', 'blur_motion', 'glow', 'film_grain', 'glitch', 'rgb_split', 'color_grade', 'blur_gaussian', 'vignette',
], 'shader-backed footage effects map to their GPU shaders while disabled effects stay out of the GPU graph');
assert.equal(gpuConfigs[3].params.intensity, 0.5, 'legacy grain amount is normalized to shader intensity');
assert.equal(gpuConfigs[3].keyframes.intensity[0].value, 1, 'legacy grain amount keyframes are normalized too');
assert.equal(gpuConfigs[4].params.intensity, 0.5, 'legacy glitch amount is normalized to shader intensity');
assert.deepEqual(gpuConfigs[5].params.centerX, 0.5, 'legacy chromatic aberration receives the shader center default');
assert.deepEqual(gpuConfigs[2].params.color, [0, 200 / 255, 1], 'hex glow color is converted to normalized GPU color');
const clipLocalConfig = createGpuClipEffectConfigs('clip-local', [{
  kind: 'vignette',
  params: { intensity: { value: 0.2 }, radius: { value: 0.4, keyframes: [
    { time: 0, value: 0.4 }, { time: 2, value: 0.8 },
  ] } },
  keyframes: { intensity: [{ time: 0, value: 0.2 }, { time: 2, value: 0.8 }] },
}], { startTime: 10, duration: 4 })[0];
assert.equal(clipLocalConfig.params.intensity, 0.2, 'wrapped GPU footage parameters become shader-ready scalar values');
assert.deepEqual(clipLocalConfig.keyframes.intensity.map(frame => frame.time), [0, 2],
  'project-time footage keyframes keep their authored timestamps for GPU sampling');
assert.deepEqual(clipLocalConfig.keyframes.radius.map(frame => frame.time), [0, 2],
  'parameter-nested keyframes keep their authored project timestamps');
const clipLocalNode = new EffectPipeline().addEffect(clipLocalConfig);
assert.equal(clipLocalNode.getParamAt('intensity', 1), 0.5,
  'GPU preview samples interpolated footage parameters at project time');
assert.equal(clipLocalNode.getParamAt('intensity', 11), 0.8,
  'a clip placement at 10 seconds does not shift project-time effect keyframes a second time');
assert.ok(Math.abs(clipLocalNode.getParamAt('radius', 1) - 0.6) < 1e-12,
  'GPU preview samples nested parameter keyframes at their authored project time');
const legacyMotionConfig = createGpuClipEffectConfigs('clip-main', [{
  id: 'legacy-motion', kind: 'motion-blur', params: { amount: 2, angle: 45 }, keyframes: { amount: [
    { time: 0, value: 1 }, { time: 1, value: 3 },
  ] },
}])[0];
assert.ok(Math.abs(legacyMotionConfig.params.intensity - (2 / 31.176914536)) < 1e-12,
  'legacy pixel-radius motion blur is normalized to the GPU shutter-travel control');
assert.ok(Math.abs(legacyMotionConfig.keyframes.intensity[1].value - (3 / 31.176914536)) < 1e-12,
  'legacy motion-blur keyframes are converted with the same strength mapping');
const directBlurPipeline = new EffectPipeline();
const directBlurConfigs = createGpuClipEffectConfigs('clip-main', [
  { id: 'radial', kind: 'blur_radial', startTime: 2, endTime: 4, params: { intensity: 0.2, centerX: 0.5, centerY: 0.5, samples: 16 }, keyframes: { intensity: [
    { time: 2, value: 0.2 }, { time: 4, value: 0.8 },
  ] } },
]);
directBlurConfigs.forEach(config => directBlurPipeline.addEffect(config));
const directBlurPlacement = { id: 'clip-main', startTime: 0, duration: 6 };
assert.equal(directBlurPipeline.getActiveEffects('clip-main', 1, directBlurPlacement).length, 0,
  'GPU clip effects respect their authored timeline start');
assert.equal(directBlurPipeline.getActiveEffects('clip-main', 3, directBlurPlacement)[0].getParamAt('intensity', 3), 0.5,
  'GPU clip effects preserve animated controls through the effect graph');
assert.equal(directBlurPipeline.getActiveEffects('clip-main', 4, directBlurPlacement).length, 0,
  'GPU clip effects use a half-open end time');
assert.equal(resolveTimelineEffectFilter(gpuBlurEffects.slice(0, 2), 0, { gpuPreview: true }), '', 'GPU canvas omits CSS approximations once the real blur shaders handle the clip effects');
assert.equal(resolveTimelineEffectFilter([{ kind: 'blur_radial', params: { intensity: 0.6 } }]), '', 'native-video fallback does not misrepresent radial blur as directional Gaussian blur');
assert.equal(resolveTimelineEffectFilter(gpuBlurEffects, 0, { gpuPreview: true }), '', 'all shader-backed clip effects omit duplicate CSS approximations on the GPU canvas');
assert.equal(resolveTimelineVignetteStyle(gpuBlurEffects, 0, { gpuPreview: true }), null, 'GPU vignette does not receive a second CSS vignette overlay');
assert.match(resolveTimelineEffectFilter([{ kind: 'glow', params: { intensity: 1 } }]), /vibed-highlight-glow/, 'native-video fallback retains the glow approximation');
assert.deepEqual(resolveTimelineSvgEffectParams(selected), {
  grain: { intensity: 0.15, size: 1.5, seed: 9, animated: true }, chromatic: { amount: 1.5, angle: 0 }, motion: { amount: 1.2 }, radial: { intensity: 0, centerX: 0.5, centerY: 0.5, samples: 12 }, distortion: { amount: 5 }, colorGrade: { temperature: 0, tint: 0 },
  glitch: { amount: 8, seed: 17 }, glow: { threshold: 0.7, intensity: 1, radius: 10, color: 'rgb(255 255 255)' },
}, 'shelf presets have safe SVG preview values');
const glowPreview = resolveTimelineSvgEffectParams([{ kind: 'glow', params: { radius: 6, threshold: 0.8, intensity: 2, color: [0, 0.5, 1] } }]);
assert.deepEqual(glowPreview.glow, { threshold: 0.8, intensity: 2, radius: 6, color: 'rgb(0 128 255)' }, 'glow preview retains threshold, radius, intensity and tint controls');
assert.deepEqual(resolveTimelineSvgEffectParams([{ kind: 'blur_radial', params: { intensity: 0.6, centerX: 0.25, centerY: 0.7, samples: 8 } }]).radial,
  { intensity: 0.6, centerX: 0.25, centerY: 0.7, samples: 8 }, 'native fallback radial canvas receives authored center, intensity and bounded sample count');
const playerSource = readFileSync(new URL('../client/src/components/Player/VideoPlayer.jsx', import.meta.url), 'utf8');
assert.match(playerSource, /RadialFootageCanvas[\s\S]*?videoRef=\{fallbackVideoRef\}[\s\S]*?radial=\{svgEffectParams\.radial\}/,
  'native fallback renders the source video through the radial blur canvas');
const glowFilterSource = playerSource.match(/case 'glow':[\s\S]*?default:/)?.[0] || '';
assert.match(glowFilterSource, /feColorMatrix[\s\S]*0\.2126 0\.7152 0\.0722/, 'preview glow isolates source luminance');
assert.match(glowFilterSource, /feComponentTransfer[\s\S]*p\.glow\.threshold/, 'preview glow applies its configured highlight threshold');
assert.match(glowFilterSource, /feGaussianBlur[\s\S]*p\.glow\.radius/, 'preview glow uses its configured bloom radius');
assert.match(glowFilterSource, /feFlood[\s\S]*p\.glow\.color[\s\S]*feComposite[\s\S]*colored-bloom/, 'preview glow tints and composites only the blurred highlights');

const exported = compileTimelineVisualEffects(selected);
assert.ok(exported.some(filter => filter.startsWith('noise=')), 'grain compiles to temporal FFmpeg noise');
assert.ok(exported.some(filter => filter.startsWith('chromashift=')), 'chromatic aberration compiles to RGB channel offsets');
assert.ok(exported.includes('chromashift=cbh=-2:crh=2:edge=smear'), 'export channel directions match the red-right/blue-left live preview');
assert.ok(exported.some(filter => /^gblur=sigma=1\.4000:sigmaV=0\.2940$/.test(filter)) && !exported.some(filter => filter.startsWith('tmix=')), 'motion blur shelf preset preserves the preview vertical blur component without temporal trails');
assert.ok(exported.some(filter => filter.startsWith('lenscorrection=')), 'lens distortion compiles to FFmpeg lens correction');
assert.deepEqual(compileTimelineVisualEffects(selected.map(effect => ({ ...effect, enabled: false }))), [], 'disabled footage effects are not exported');
const malformedParameterEffects = [
  { kind: 'blur_gaussian', params: { radius: 'not-a-number' } },
  { kind: 'contrast', params: { amount: Number.NaN } },
  { kind: 'color_grade', params: { brightness: Infinity, contrast: 'bad', saturation: undefined } },
];
const malformedParameterFilters = compileTimelineVisualEffects(malformedParameterEffects);
assert.ok(malformedParameterFilters.length > 0, 'malformed numeric controls still compile to a safe fallback effect');
assert.ok(malformedParameterFilters.every(filter => !/NaN|Infinity/.test(filter)),
  'malformed numeric effect controls never leak invalid values into FFmpeg filter expressions');
const highlightGlow = compileTimelineVisualEffects([{ kind: 'glow', params: { radius: 6, threshold: 0.8, intensity: 0.9, color: '#00C8FF' } }], { complexGlow: true });
assert.ok(highlightGlow[0].startsWith('__VIBED_HIGHLIGHT_GLOW__'), 'primary footage glow compiles as a complex highlight bloom stage');
const strongerGlow = compileTimelineVisualEffects([{ kind: 'glow', params: { intensity: 2 } }], { complexGlow: true });
assert.match(strongerGlow[0], /"intensity":1\.4/, 'export glow preserves intensity values above 1 up to the catalog maximum of 3');
assert.match(compileTimelineVisualEffectGraph(strongerGlow).join(';'), /255\*clip\(\(1\.4000\)/,
  'higher export glow intensity reaches the highlight matte opacity');
const glowGraph = compileTimelineVisualEffectGraph([
  'drawbox=x=31:y=31:w=2:h=2:color=white:t=fill', ...highlightGlow,
], { output: 'vfxout' }).join(';');
assert.match(glowGraph, /split\[vfx_/);
assert.match(glowGraph, /clip\(\(\(0\.2126\*r\(X,Y\)\+0\.7152\*g\(X,Y\)\+0\.0722\*b\(X,Y\)\)-\(204\.000\)\)\/max\(255-\(204\.000\),1\),0,1\)/,
  'export glow uses the same soft Rec. 709 luminance threshold ramp as the live preview');
assert.match(glowGraph, /gblur=sigma=6\.000/);
const animatedGlow = compileTimelineVisualEffects([{ kind: 'glow', params: {
  radius: 3, threshold: 0.5, intensity: 0.8, color: [1, 0, 0],
}, keyframes: { color: [
  { time: 0, value: [1, 0, 0] }, { time: 1, value: [0, 0, 1] },
] , radius: [
  { time: 0, value: 2 }, { time: 1, value: 8, easing: 'easeInOut' },
], threshold: [
  { time: 0, value: 0.2 }, { time: 1, value: 0.8 },
], intensity: [
  { time: 0, value: 0.2 }, { time: 1, value: 1 },
] } }], { complexGlow: true });
const animatedGlowGraph = compileTimelineVisualEffectGraph(animatedGlow).join(';');
assert.match(animatedGlowGraph, /g='if\(lt\(T,/,
  'complex glow carries animated RGB channel expressions through the FFmpeg compositor graph');
assert.match(animatedGlowGraph, /gblur=sigma=2\.000/);
assert.match(animatedGlowGraph, /gblur=sigma=8\.000/);
assert.match(animatedGlowGraph, /blend=all_expr='A\*\(1-\(clip\(\(if\(lt\(T,/,
  'complex glow interpolates animated radius by blending fixed-radius bloom passes');
assert.match(animatedGlowGraph, /clip\(\(\(0\.2126\*r\(X,Y\)\+0\.7152\*g\(X,Y\)\+0\.0722\*b\(X,Y\)\)-\(\(if\(lt\(T,/,
  'complex glow applies the keyframed threshold to its highlight matte');
assert.match(animatedGlowGraph, /255\*clip\(\(\(if\(lt\(T,/,
  'complex glow applies and clamps the keyframed intensity to its bloom opacity');
const animatedGlowRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2:duration=1',
  '-filter_complex', compileTimelineVisualEffectGraph(animatedGlow, { input: '0:v', output: 'animated_glow' }).join(';'),
  '-map', '[animated_glow]', '-frames:v', '2', '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(animatedGlowRender.status, 0,
  `FFmpeg renders the keyframed glow graph: ${animatedGlowRender.stderr || animatedGlowRender.error?.message || ''}`);
const animatedRadiusGlow = compileTimelineVisualEffects([{ kind: 'glow', params: {
  radius: 2, threshold: 0.5, intensity: 1, color: '#FFFFFF',
}, keyframes: { radius: [{ time: 0, value: 2 }, { time: 1, value: 10 }] } }], { complexGlow: true });
const animatedRadiusRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=3:d=1',
  '-filter_complex', compileTimelineVisualEffectGraph([
    'drawbox=x=31:y=31:w=2:h=2:color=white:t=fill', ...animatedRadiusGlow,
  ], { input: '0:v', output: 'radius_glow' }).join(';'),
  '-map', '[radius_glow]', '-frames:v', '3', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(animatedRadiusRender.status, 0,
  `FFmpeg renders keyframed glow radius: ${animatedRadiusRender.stderr?.toString() || animatedRadiusRender.error?.message || ''}`);
const radiusProbe = (frame) => animatedRadiusRender.stdout[(frame * 64 * 64 + 32 * 64 + 35) * 4 + 2];
assert.notEqual(radiusProbe(0), radiusProbe(2), 'keyframed glow radius changes the rendered bloom across frames');
const windowedGlow = compileTimelineVisualEffects([{ kind: 'glow', startTime: 10.5, endTime: 11, params: { radius: 6, threshold: 0.8, intensity: 0.9, color: '#00C8FF' } }], {
  complexGlow: true, clipStart: 10, duration: 1.5,
});
assert.match(windowedGlow[0], /"window":\{"start":0\.5,"end":1\}/,
  'partial complex glow carries clip-local timing into the compositor graph');
const windowedGlowGraph = compileTimelineVisualEffectGraph(windowedGlow, { input: 'in', output: 'out' }).join(';');
assert.match(windowedGlowGraph, /overlay=shortest=1:format=auto:enable='gte\(t,0\.500000\)\*lt\(t,1\.000000\)'/,
  'partial glow is gated in the export graph rather than applied to the full clip');
const windowedGlowRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=2:d=1.5',
  '-filter_complex', compileTimelineVisualEffectGraph([
    'drawbox=x=31:y=31:w=2:h=2:color=white:t=fill', ...windowedGlow,
  ], { input: '0:v', output: 'windowed' }).join(';'),
  '-map', '[windowed]', '-frames:v', '3', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(windowedGlowRender.status, 0, `FFmpeg renders time-gated glow: ${windowedGlowRender.stderr?.toString() || windowedGlowRender.error?.message || ''}`);
const glowSampleOffset = (32 * 64 + 34) * 4;
assert.equal(windowedGlowRender.stdout[glowSampleOffset + 2], 0, 'partial glow leaves the frame unchanged before its window');
assert.ok(windowedGlowRender.stdout[64 * 64 * 4 + glowSampleOffset + 2] > 0,
  'partial glow blooms only once its authored clip-local window begins');
const glowRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1:d=1',
  '-filter_complex', glowGraph, '-map', '[vfxout]', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(glowRender.status, 0, `FFmpeg renders the footage highlight bloom: ${glowRender.stderr?.toString() || glowRender.error?.message || ''}`);
const pixelOffset = (x, y) => (y * 64 + x) * 4;
assert.ok(glowRender.stdout[pixelOffset(34, 32) + 2] > 0,
  'highlight glow spreads tinted light outside the source highlight instead of blurring the whole frame');
const renderGlowAtIntensity = intensity => {
  const effect = compileTimelineVisualEffects([{ kind: 'glow', params: {
    radius: 4, threshold: 0.5, intensity, color: '#00C8FF',
  } }], { complexGlow: true });
  return spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1:d=1',
    '-filter_complex', compileTimelineVisualEffectGraph([
      'drawbox=x=31:y=31:w=2:h=2:color=white:t=fill', ...effect,
    ], { input: '0:v', output: 'intensity_glow' }).join(';'),
    '-map', '[intensity_glow]', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { encoding: null, timeout: 20000 });
};
const normalIntensityGlow = renderGlowAtIntensity(1);
const highIntensityGlow = renderGlowAtIntensity(3);
assert.equal(normalIntensityGlow.status, 0, 'FFmpeg renders standard glow intensity');
assert.equal(highIntensityGlow.status, 0, 'FFmpeg renders maximum catalog glow intensity');
assert.ok(highIntensityGlow.stdout[pixelOffset(34, 32) + 2] > normalIntensityGlow.stdout[pixelOffset(34, 32) + 2],
  'raising glow intensity above 1 increases visible exported bloom pixels');
const renderThresholdRamp = (highlightColor) => {
  const effect = compileTimelineVisualEffects([{ kind: 'glow', params: {
    radius: 4, threshold: 0.5, intensity: 1, color: '#00C8FF',
  } }], { complexGlow: true });
  return spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1:d=1',
    '-filter_complex', compileTimelineVisualEffectGraph([
      `drawbox=x=31:y=31:w=2:h=2:color=${highlightColor}:t=fill`, ...effect,
    ]).join(';'), '-map', '[vfxout]', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { encoding: null, timeout: 20000 });
};
const midtoneGlowRender = renderThresholdRamp('0x9B9B9B');
const whiteGlowRender = renderThresholdRamp('white');
assert.equal(midtoneGlowRender.status, 0, `FFmpeg renders soft threshold midtone: ${midtoneGlowRender.stderr?.toString() || ''}`);
assert.equal(whiteGlowRender.status, 0, `FFmpeg renders soft threshold white: ${whiteGlowRender.stderr?.toString() || ''}`);
assert.ok(midtoneGlowRender.stdout[pixelOffset(34, 32) + 2] > 0
  && midtoneGlowRender.stdout[pixelOffset(34, 32) + 2] < whiteGlowRender.stdout[pixelOffset(34, 32) + 2],
  'glow intensity ramps smoothly between its threshold and white instead of switching on abruptly');
const matteGlowGraph = matteFilterGraph({ mode: 'color', color: '#000000', feather: 0, softness: 0.1 }, {
  width: 64, height: 64,
  outputGraph: compileTimelineVisualEffectGraph(highlightGlow, { input: 'outbase', output: 'outv' }),
}).join(';');
const matteGlowRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1:d=1,drawbox=x=31:y=31:w=2:h=2:color=white:t=fill',
  '-f', 'lavfi', '-i', 'color=c=white:s=64x64:r=1:d=1', '-filter_complex', matteGlowGraph,
  '-map', '[outv]', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(matteGlowRender.status, 0, `FFmpeg renders highlight glow on a matted clip: ${matteGlowRender.stderr?.toString() || matteGlowRender.error?.message || ''}`);
assert.ok(matteGlowRender.stdout[pixelOffset(34, 32) + 2] > 0,
  'matted footage uses the same highlight bloom graph as the standard clip export path');

// Effects Panel footage stack uses {kind, params}, unlike the older shelf's
// {id, filter} presets. Both must affect the preview and the primary clip's
// FFmpeg chain, with disabled items omitted.
const authored = [
  { kind: 'blur', params: { radius: 2.5 } },
  { kind: 'brightness', params: { amount: 1.1 } },
  { kind: 'contrast', params: { amount: 1.25 } },
  { kind: 'saturation', params: { amount: 0.8 } },
  { kind: 'hue', params: { degrees: 12 } },
  { kind: 'grain', params: { amount: 10 } },
  { kind: 'chromatic-aberration', params: { amount: 3 } },
  { kind: 'motion-blur', params: { amount: 2 } },
  { kind: 'distortion', params: { amount: 0.03 } },
  { type: 'blur_gaussian', params: { radius: { value: 1.5 } } },
  { type: 'color_grade', params: { brightness: { value: 110 }, contrast: { value: 120 }, saturation: { value: 90 }, hueRotate: { value: 45 }, temperature: { value: 30 }, tint: { value: -20 } } },
  { type: 'film_grain', params: { intensity: { value: 0.2 } } },
  { type: 'rgb_split', params: { amount: { value: 4 } } },
  { type: 'vignette', params: { intensity: { value: 0.5 } } },
  { type: 'glow', params: { radius: { value: 5 }, intensity: { value: 1 } } },
  { type: 'shake', params: { intensity: { value: 12 }, frequency: { value: 8 }, randomSeed: { value: 12 }, rotationAmount: { value: 1.5 } } },
  { kind: 'contrast', params: { amount: 3 }, enabled: false },
];
const authoredPreview = resolveTimelineEffectFilter(authored);
assert.match(authoredPreview, /blur\(2\.5px\)/);
assert.match(authoredPreview, /brightness\(1\.1\)/);
assert.match(authoredPreview, /contrast\(1\.25\)/);
assert.match(authoredPreview, /saturate\(0\.8\)/);
assert.match(authoredPreview, /hue-rotate\(12deg\)/);
assert.match(authoredPreview, /vibed-film-grain/);
assert.match(authoredPreview, /blur\(1\.5px\)/, 'EffectRegistry parameter objects are read in preview');
assert.match(authoredPreview, /brightness\(1\.1\).*contrast\(1\.2\).*saturate\(0\.9\)/, 'registered color grade maps to preview CSS');
assert.match(authoredPreview, /vibed-color-grade/, 'temperature and tint map to the live SVG color grade filter');
assert.match(authoredPreview, /hue-rotate\(45deg\)/, 'registered color grade hue rotation is applied in preview');
assert.match(authoredPreview, /vibed-chromatic-aberration/, 'registered RGB split maps to preview');
assert.doesNotMatch(authoredPreview, /contrast\(3\)/, 'disabled effects are omitted from preview');
const authoredSvg = resolveTimelineSvgEffectParams(authored);
assert.equal(authoredSvg.grain.intensity, 0.2, 'authored grain amount controls preview grain strength');
assert.equal(authoredSvg.chromatic.amount, 4, 'registered RGB split controls preview channel offset');
assert.equal(resolveTimelineSvgEffectParams([{ kind: 'rgb_split', params: { amount: 4, angle: 90 } }]).chromatic.angle, 90, 'RGB split direction is retained for preview');
assert.equal(authoredSvg.motion.amount, 2, 'motion blur amount controls preview blur');
assert.deepEqual(authoredSvg.glow, { threshold: 0.7, intensity: 1, radius: 5, color: 'rgb(255 255 255)' }, 'registered glow controls are available to the preview filter');
assert.ok(Math.abs(authoredSvg.distortion.amount - (0.03 * (5 / 0.018))) < 1e-9, 'lens distortion strength controls preview displacement');
assert.deepEqual(authoredSvg.colorGrade, { temperature: 30, tint: -20 }, 'temperature and tint controls are available to the live SVG filter');
assert.equal(resolveTimelineSvgEffectParams([{ kind: 'rgb_split', params: { amount: Number.NaN } }]).chromatic.amount, 5, 'invalid controls fall back to finite SVG values');
assert.equal(resolveTimelineEffectTransform(authored, 0.5, 1080), resolveTimelineEffectTransform(authored, 0.5, 1080), 'camera shake preview is deterministic at a given clip-local time');
assert.notEqual(resolveTimelineEffectTransform(authored, 0.5, 1080), resolveTimelineEffectTransform(authored, 0.75, 1080), 'camera shake moves as clip-local time advances');
assert.equal(resolveTimelineEffectTransform([{ type: 'shake', enabled: false }], 0.5), '', 'disabled camera shake does not transform preview');
assert.equal(resolveTimelineEffectTransform([{ type: 'shake', startTime: 10, endTime: 12, params: { intensity: 12 } }], 0.5, 1080, 9.99), '',
  'camera shake respects its project-time effect window');
const animatedPreviewEffect = [{ kind: 'contrast', params: { amount: 1 }, keyframes: { amount: [
  { time: 0, value: 1 }, { time: 1, value: 3, easing: 'linear' },
] } }];
assert.match(resolveTimelineEffectFilter(animatedPreviewEffect, 0.5), /contrast\(2\)/,
  'the footage effect preview samples project-time parameter keyframes at the current time');
const laterClipEffect = [{ kind: 'contrast', params: { amount: 1 }, startTime: 10, endTime: 12, keyframes: { amount: [
  { time: 10, value: 1 }, { time: 11, value: 3, easing: 'linear' },
] } }];
assert.match(resolveTimelineEffectFilter(laterClipEffect, 10.5), /contrast\(2\)/,
  'footage effect keyframes remain aligned to a clip placed later on the project timeline');
assert.equal(resolveTimelineEffectFilter(laterClipEffect, 9.99), '', 'a footage effect stays off before its project-time start');
assert.equal(resolveTimelineEffectFilter(laterClipEffect, 12), '', 'a footage effect stops at its exclusive project-time end');
const fadeIn = [{ kind: 'fade_in', params: { duration: 1, color: { value: [1, 0.5, 0] } } }];
assert.deepEqual(resolveTimelineFadeOverlays(fadeIn, 10, { clipStart: 10, clipDuration: 2 }), [{ color: 'rgb(255 128 0)', opacity: 1 }],
  'fade-in preview begins fully covered by its authored color at clip start');
assert.equal(resolveTimelineFadeOverlays(fadeIn, 10.5, { clipStart: 10, clipDuration: 2 })[0].opacity, 0.5,
  'fade-in preview tracks export progress at the midpoint');
assert.equal(resolveTimelineFadeOpacity(fadeIn, 10, { clipStart: 10, clipDuration: 2 }), 0,
  'transparent overlay fade-in starts fully transparent');
assert.equal(resolveTimelineFadeOpacity(fadeIn, 10.5, { clipStart: 10, clipDuration: 2 }), 0.5,
  'transparent overlay fade-in reaches half layer opacity');
assert.equal(resolveTimelineFadeOpacity(fadeIn, 11, { clipStart: 10, clipDuration: 2 }), 1,
  'transparent overlay fade-in settles at full layer opacity');
assert.deepEqual(resolveTimelineFadeOverlays(fadeIn, 11, { clipStart: 10, clipDuration: 2 }), [],
  'fade-in overlay is removed when its duration ends');
assert.deepEqual(resolveTimelineFadeOverlays([{ kind: 'fade_in', params: { duration: 0.001, color: [255, 128, 0] } }], 0, { clipDuration: 2 }),
  [{ color: 'rgb(255 128 0)', opacity: 1 }], 'preview parses 8-bit RGB arrays and uses the export minimum fade duration');
assert.deepEqual(resolveTimelineFadeOverlays([{ kind: 'fade_in', params: { duration: 20 } }], 2.5, { clipDuration: 10 }),
  [{ color: '#000000', opacity: 0.5 }], 'preview uses the same five-second maximum fade duration as export');
const fadeOut = [{ type: 'fade_out', endTime: 12, params: { duration: 0.8, color: '#fff' } }];
assert.equal(resolveTimelineFadeOverlays(fadeOut, 11.6, { clipStart: 10, clipDuration: 2 })[0].opacity, 0.5,
  'fade-out preview reaches half color at the midpoint of its ending window');
assert.equal(resolveTimelineFadeOpacity(fadeOut, 11.6, { clipStart: 10, clipDuration: 2 }), 0.5,
  'transparent overlay fade-out uses matching layer opacity');
const shortFadeWindow = [{ kind: 'fade_out', startTime: 11.8, endTime: 12, params: { duration: 0.8 } }];
assert.deepEqual(resolveTimelineFadeOverlays(shortFadeWindow, 11.7, { clipStart: 10, clipDuration: 2 }), [],
  'fade-out preview stays inside the authored effect window when duration is longer');
assert.equal(resolveTimelineFadeOverlays(shortFadeWindow, 11.9, { clipStart: 10, clipDuration: 2 })[0].opacity, 0.5,
  'fade-out duration is clipped to the effect window just like export');
assert.deepEqual(resolveTimelineFadeOverlays([{ ...fadeIn[0], enabled: false }], 10.5, { clipStart: 10, clipDuration: 2 }), [],
  'disabled fade effects do not appear in preview');
const graphicPreviewSource = readFileSync(new URL('../client/src/components/Player/GraphicOverlay.jsx', import.meta.url), 'utf8');
const videoPreviewSource = readFileSync(new URL('../client/src/components/Player/VideoPlayer.jsx', import.meta.url), 'utf8');
assert.match(graphicPreviewSource, /resolveTimelineFadeOverlays\(clip\.effects, currentTime, effectContext\)/,
  'media overlay preview renders footage fade color layers');
assert.match(videoPreviewSource, /resolveTimelineFadeOverlays\(activeClip\?\.effects, currentTime, effectContext\)/,
  'main footage preview renders footage fade color layers');
const vignettePreview = resolveTimelineVignetteStyle([{ type: 'vignette', params: { intensity: { value: 0.6 }, radius: { value: 0.8 }, softness: { value: 0.4 }, color: { value: [0.1, 0.2, 0.3] } } }]);
assert.match(vignettePreview.background, /radial-gradient/);
assert.equal(resolveTimelineVignetteStyle([{ type: 'vignette', enabled: false }]), null, 'disabled vignette is absent from preview');
const vignetteExport = compileTimelineVisualEffects([{ type: 'vignette', params: { intensity: 0.6, radius: 0.8, softness: 0.4, color: [0.1, 0.2, 0.3] } }]).join(',');
assert.match(vignetteExport, /format=rgba,geq=/, 'footage vignette export uses the same radial compositing model as preview');
assert.match(vignetteExport, /\+\(26\)\*\(/, 'footage vignette export preserves authored tint color');
assert.match(vignetteExport, /0\.800000-0\.400000/, 'footage vignette export preserves radius and softness');
const animatedVignetteExport = compileTimelineVisualEffects([{ type: 'vignette', params: { intensity: 0.5, radius: 0.7, softness: 0.5 }, keyframes: {
  intensity: [{ time: 0, value: 0.2 }, { time: 1, value: 0.8 }],
} }]).join(',');
assert.match(animatedVignetteExport, /T-0\.000000/, 'footage vignette export evaluates project-time animation per frame');
const laterClipVignetteExport = compileTimelineVisualEffects([{ type: 'vignette', params: { intensity: 0.5, radius: 0.7, softness: 0.5 }, keyframes: {
  intensity: [{ time: 10, value: 0.2 }, { time: 11, value: 0.8 }],
} }], { clipStart: 10, duration: 2 }).join(',');
assert.match(laterClipVignetteExport, /T-0\.000000/, 'effect keyframes on a later clip are converted from project time to clip-local export time');
assert.match(laterClipVignetteExport, /lt\(T,1\.000000\)/, 'the later clip retains the keyframe interval after time conversion');
const animatedVignetteColor = compileTimelineVisualEffects([{ type: 'vignette', params: {
  intensity: 0.8, radius: 0.7, softness: 0.5, color: [1, 0, 0],
}, keyframes: { color: [
  { time: 0, value: [1, 0, 0] }, { time: 1, value: [0, 0, 1] },
] } }]).join(',');
assert.match(animatedVignetteColor, /T-0\.000000/, 'animated vignette RGB channels compile into time-dependent FFmpeg expressions');
assert.match(animatedVignetteColor, /255\.000000/, 'normalized color keyframes use the same 0–255 channel range as the preview');
const animatedVignetteRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=64x64:r=2:d=1',
  '-vf', animatedVignetteColor, '-frames:v', '2', '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(animatedVignetteRender.status, 0,
  `FFmpeg accepts animated RGB vignette channels: ${animatedVignetteRender.stderr || animatedVignetteRender.error?.message || ''}`);
const radialBlur = compileTimelineVisualEffects([{ kind: 'blur_radial', params: { intensity: 0.6, centerX: 0.25, centerY: 0.7, samples: 8 } }]);
assert.ok(radialBlur[0].includes('geq=') && radialBlur[0].includes('0.25-X/W') && radialBlur[0].includes('0.7-Y/H'),
  'radial blur export follows its authored center and intensity instead of substituting gaussian blur');
const radialBlurRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2:duration=1',
  '-vf', radialBlur.join(','), '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(radialBlurRender.status, 0, `FFmpeg accepts and renders radial blur: ${radialBlurRender.stderr || radialBlurRender.error?.message || ''}`);
const directionalBlur = compileTimelineVisualEffects([{ kind: 'blur_motion', params: {
  intensity: 0.65, angle: 45, samples: 12,
} }]);
assert.ok(directionalBlur[0].includes('geq=') && directionalBlur[0].includes('cos((45.000000)*PI/180)')
  && directionalBlur[0].includes('sin((45.000000)*PI/180)'),
  'directional blur export samples along the same authored angle as the GPU shader');
const directionalBlurRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2:duration=1',
  '-vf', directionalBlur.join(','), '-frames:v', '1', '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(directionalBlurRender.status, 0,
  `FFmpeg renders shader-aligned directional blur: ${directionalBlurRender.stderr || directionalBlurRender.error?.message || ''}`);
const animatedDirectionalBlur = compileTimelineVisualEffects([{ kind: 'blur_motion', params: {
  intensity: 0.2, angle: 0, samples: 8,
}, keyframes: {
  intensity: [{ time: 0, value: 0.2 }, { time: 1, value: 0.8 }],
  angle: [{ time: 0, value: 0 }, { time: 1, value: 90 }],
} }]);
assert.match(animatedDirectionalBlur[0], /T-0\.000000/,
  'motion-blur export carries animated intensity and angle into the per-frame sampling kernel');
const animatedDirectionalBlurRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2:duration=1',
  '-vf', animatedDirectionalBlur.join(','), '-frames:v', '2', '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(animatedDirectionalBlurRender.status, 0,
  `FFmpeg accepts animated directional blur: ${animatedDirectionalBlurRender.stderr || animatedDirectionalBlurRender.error?.message || ''}`);
const rgbSplit = compileTimelineVisualEffects([{ kind: 'rgb_split', params: { amount: 12, angle: 45, centerX: 0.2, centerY: 0.8 } }]);
assert.ok(rgbSplit[0].includes('geq=') && rgbSplit[0].includes('0.2') && rgbSplit[0].includes('0.8')
  && rgbSplit[0].includes('cos((45.000000)*PI/180)') && rgbSplit[0].includes('12.000000'),
  'RGB split export follows its authored angle and radial center');
const rgbSplitRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2:duration=1',
  '-vf', rgbSplit.join(','), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(rgbSplitRender.status, 0, `FFmpeg accepts and renders RGB split: ${rgbSplitRender.stderr || rgbSplitRender.error?.message || ''}`);
const baselineRgb = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2:duration=1',
  '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(baselineRgb.status, 0, 'RGB split baseline frame renders');
assert.notDeepEqual(rgbSplitRender.stdout, baselineRgb.stdout, 'RGB split changes actual exported pixels');
const verticalSplit = compileTimelineVisualEffects([{ kind: 'rgb_split', params: { amount: 12, angle: 90, centerX: 0.2, centerY: 0.8 } }]);
const verticalSplitRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2:duration=1',
  '-vf', verticalSplit.join(','), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(verticalSplitRender.status, 0, `FFmpeg renders vertical RGB split: ${verticalSplitRender.stderr || verticalSplitRender.error?.message || ''}`);
assert.notDeepEqual(verticalSplitRender.stdout, rgbSplitRender.stdout, 'changing RGB split angle changes exported pixels');
const animatedChromatic = compileTimelineVisualEffects([{ kind: 'chromatic-aberration', params: { amount: 0, angle: 0 }, keyframes: {
  amount: [{ time: 0, value: 0 }, { time: 1, value: 12 }],
  angle: [{ time: 0, value: 0 }, { time: 1, value: 90 }],
} }]);
assert.ok(animatedChromatic[0].includes('geq=') && animatedChromatic[0].includes('T-0.000000'),
  'chromatic-aberration exports through the animated RGB-split kernel used by the GPU preview');
const animatedChromaticRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2:duration=1.5',
  '-vf', animatedChromatic.join(','), '-frames:v', '3', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(animatedChromaticRender.status, 0,
  `FFmpeg renders animated chromatic aberration: ${animatedChromaticRender.stderr?.toString() || animatedChromaticRender.error?.message || ''}`);
assert.notDeepEqual(animatedChromaticRender.stdout.subarray(64 * 64 * 3, 2 * 64 * 64 * 3),
  animatedChromaticRender.stdout.subarray(2 * 64 * 64 * 3, 3 * 64 * 64 * 3),
  'keyframed chromatic offset and angle change the later exported frames');
const animatedDistortion = compileTimelineVisualEffects([{ kind: 'distortion', params: { amount: 0, phase: 0.4 }, keyframes: {
  amount: [{ time: 0, value: 0 }, { time: 1, value: 0.08 }],
} }]);
assert.ok(animatedDistortion[0].includes('sin(Y*0.045+0.400000)')
  && animatedDistortion[0].includes('sin(X*0.04)')
  && animatedDistortion[0].includes('T-0.000000'),
  'footage distortion export matches the shared bounded displacement model and retains animated strength');
const animatedDistortionRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2:duration=1.5',
  '-vf', animatedDistortion.join(','), '-frames:v', '3', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(animatedDistortionRender.status, 0,
  `FFmpeg renders animated footage distortion: ${animatedDistortionRender.stderr?.toString() || animatedDistortionRender.error?.message || ''}`);
assert.notDeepEqual(animatedDistortionRender.stdout.subarray(64 * 64 * 3, 2 * 64 * 64 * 3),
  animatedDistortionRender.stdout.subarray(2 * 64 * 64 * 3, 3 * 64 * 64 * 3),
  'animated distortion strength changes later exported footage frames');
const authoredExport = compileTimelineVisualEffects(authored);
assert.ok(authoredExport.includes('colorchannelmixer=rr=1.1000:gg=1.1000:bb=1.1000'), 'export brightness matches CSS brightness multiplication instead of adding to the channel range');
assert.ok(authoredExport.includes('hue=h=45'), 'registered color-grade hue rotation is applied on export');
assert.ok(authoredExport.some(filter => filter.startsWith('format=rgba,geq=')
  && filter.includes('(30.000000)*0.765') && filter.includes('(-20.000000)*0.765')),
'registered color-grade temperature and tint use the live shader’s linear RGB channel offsets on export');
const colorGradeExport = compileTimelineVisualEffects([{ type: 'color_grade', params: {
  brightness: 100, contrast: 100, saturation: 100,
}, keyframes: { brightness: [
  { time: 0, value: 100 }, { time: 0.5, value: 200, easing: 'linear' },
] } }]);
assert.ok(colorGradeExport.some(filter => filter.startsWith('format=rgba,geq=')),
  'animated color-grade brightness uses a multiplicative per-frame expression');
const animatedWhiteBalance = compileTimelineVisualEffects([{ kind: 'color_grade', params: {
  brightness: 100, contrast: 100, saturation: 100, temperature: 0, tint: 0,
}, keyframes: {
  temperature: [{ time: 0, value: -60 }, { time: 1, value: 60, easing: 'linear' }],
  tint: [{ time: 0, value: 0 }, { time: 1, value: 40, easing: 'linear' }],
} }]);
const whiteBalanceFilters = animatedWhiteBalance.filter(filter => filter.startsWith('format=rgba,geq='));
assert.ok(whiteBalanceFilters.some(filter => filter.includes('-60.000000+(60.000000--60.000000)')
  && filter.includes('0.000000+(40.000000-0.000000)')),
'temperature and tint keyframes compile into per-frame RGB channel offset expressions');
const whiteBalanceRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=16x16:r=4:d=1',
  '-vf', animatedWhiteBalance.join(','), '-frames:v', '4', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(whiteBalanceRender.status, 0,
  `FFmpeg renders animated temperature and tint: ${whiteBalanceRender.stderr?.toString() || whiteBalanceRender.error?.message || ''}`);
const whiteBalanceFrameBytes = 16 * 16 * 3;
const whiteBalanceFrame = frame => whiteBalanceRender.stdout.subarray(frame * whiteBalanceFrameBytes, (frame + 1) * whiteBalanceFrameBytes);
assert.notDeepEqual(whiteBalanceFrame(0), whiteBalanceFrame(3),
  'temperature and tint animation changes rendered footage pixels over time');
const animatedEffectCurve = easing => compileTimelineVisualEffects([{ kind: 'brightness', params: { amount: 1 }, keyframes: { amount: [
  { time: 0, value: 1 }, { time: 1, value: 2, easing },
] } }]).join(',');
assert.notEqual(animatedEffectCurve('springWobbly'), animatedEffectCurve('linear'),
  'animated footage effects export the canonical spring easing instead of falling back to linear');
assert.notEqual(animatedEffectCurve('cubic-bezier(0.2,1.4,0.8,-0.4)'), animatedEffectCurve('cubic-bezier(0.2,1.4,0.8,0.4)'),
  'footage-effect export preserves negative custom Bézier controls');
const steppedContrast = compileTimelineVisualEffects([{ kind: 'contrast', params: { amount: 1 }, keyframes: { amount: [
  { time: 0, value: 1 }, { time: 1, value: 3, easing: 'steps(2, jump-end)' },
] } }]);
assert.match(steppedContrast.join(','), /floor\(clip\(\(t-0\.000000\)\/1\.000000,0,1\)\*2\)\+0\)\/2/,
  'stepped keyframes compile to exact hold intervals instead of interpolating between sampled values');
const steppedContrastRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x606060:s=8x8:r=4:d=1',
  '-vf', steppedContrast.join(','), '-frames:v', '4', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(steppedContrastRender.status, 0,
  `FFmpeg renders discrete stepped footage keyframes: ${steppedContrastRender.stderr?.toString() || steppedContrastRender.error?.message || ''}`);
const steppedPixel = frame => steppedContrastRender.stdout[frame * 64 + 32];
assert.equal(steppedPixel(0), steppedPixel(1), 'the first stepped interval holds its initial contrast without a ramp');
assert.equal(steppedPixel(2), steppedPixel(3), 'the second stepped interval holds its discrete contrast value');
assert.notEqual(steppedPixel(0), steppedPixel(2), 'the rendered step boundary changes the footage treatment');
for (const easing of listEasingNames()) {
  assert.ok(compileTimelineVisualEffects([{ kind: 'brightness', params: { amount: 1 }, keyframes: { amount: [
    { time: 0, value: 1 }, { time: 1, value: 2, easing },
  ] } }]).length > 0, `animated footage effects compile for canonical easing ${easing}`);
}
const laterClipExport = compileTimelineVisualEffects([{ kind: 'contrast', params: { amount: 1 }, keyframes: { amount: [
  { time: 10, value: 1 }, { time: 11, value: 3, easing: 'linear' },
] } }], { clipStart: 10 });
assert.match(laterClipExport.join(','), /t-0\.000000/,
  'export converts project-time effect keyframes to clip-local filter time');
const partialWindowExport = compileTimelineVisualEffects([{ kind: 'brightness', params: { amount: 2 }, startTime: 10.5, endTime: 11 }], {
  clipStart: 10, duration: 1.5,
});
assert.match(partialWindowExport[0], /enable='gte\(t,0\.500000\)\*lt\(t,1\.000000\)'/,
  'export scopes an effect card to its project-time window in clip-local time');
const partialWindowRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x323232:s=64x64:r=4:d=1.5',
  '-vf', partialWindowExport.join(','), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(partialWindowRender.status, 0,
  `FFmpeg accepts the scoped effect filter: ${partialWindowRender.stderr?.toString() || partialWindowRender.error?.message || ''}`);
const frameByteLength = 64 * 64 * 3;
const redAt = frame => partialWindowRender.stdout[frame * frameByteLength];
assert.ok(redAt(0) < redAt(2) && redAt(2) > redAt(4) && Math.abs(redAt(0) - redAt(4)) < 4,
  'partial effect export changes only frames inside the authored effect window');
for (const effect of [
  { kind: 'blur_gaussian', params: { radius: 2 } },
  { kind: 'hue', params: { degrees: 20 } },
  { kind: 'film_grain', params: { intensity: 0.1 } },
  { kind: 'rgb_split', params: { amount: 2 } },
  { kind: 'distortion', params: { amount: 0.02 } },
  { kind: 'vignette', params: { intensity: 0.4 } },
  { kind: 'color_grade', params: { brightness: 110, contrast: 105, saturation: 95, hueRotate: 3, temperature: 5 } },
  { id: 'warm-film' },
].map(effect => ({ ...effect, startTime: 4.25, endTime: 4.75 }))) {
  const filters = compileTimelineVisualEffects([effect], { clipStart: 4, duration: 1 });
  const render = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=4:duration=1',
    '-vf', filters.join(','), '-frames:v', '1', '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(render.status, 0,
    `FFmpeg accepts a windowed ${effect.kind || effect.id} effect: ${render.stderr || render.error?.message || ''}`);
}
const overlayGradeExport = compileOverlaySource({
  outputStart: 0, source: { type: 'image' },
  geometry: [{ t: 0, x: 0.5, y: 0.5, w: 0.5, h: 0.5, opacity: 1, rotation: 0 }],
  effects: [{ type: 'color_grade', params: {
    brightness: 100, contrast: 120, saturation: 80, hueRotate: 45, temperature: 30, tint: -20,
  } }],
}, 1, 'color_grade_overlay', { width: 1080, height: 1920, fps: 30 });
assert.ok(overlayGradeExport.includes('hue=h=45'), 'overlay color grade exports authored hue rotation');
assert.ok(overlayGradeExport.includes("geq=r='clip(r(X,Y)+(30.000000)*0.765,0,255)'")
  && overlayGradeExport.includes("g='clip(g(X,Y)+(-20.000000)*0.765,0,255)'"),
  'overlay color grade uses the same linear temperature and tint offsets as preview');
const animatedOverlayWhiteBalance = compileOverlaySource({
  outputStart: 0, outputEnd: 1, source: { type: 'image' },
  geometry: [{ t: 0, x: 0.5, y: 0.5, w: 0.5, h: 0.5, opacity: 1, rotation: 0 }],
  effects: [{ type: 'color_grade', params: { temperature: 0, tint: 0 }, samples: {
    temperature: [{ t: 0, value: -60 }, { t: 1, value: 60 }],
    tint: [{ t: 0, value: 0 }, { t: 1, value: 40 }],
  } }],
}, 0, 'animated_overlay_white_balance', { width: 64, height: 64, fps: 4 });
assert.ok(animatedOverlayWhiteBalance.includes('if(lt(T,1),-60+(120)*(T-0)/1,60)')
  && animatedOverlayWhiteBalance.includes('if(lt(T,1),0+(40)*(T-0)/1,40)'),
  'overlay white-balance samples compile into per-frame RGB offsets');
const animatedOverlayRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x808080:s=64x64:r=4:d=1',
  '-filter_complex', animatedOverlayWhiteBalance, '-map', '[animated_overlay_white_balance]',
  '-frames:v', '4', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(animatedOverlayRender.status, 0,
  `FFmpeg renders animated overlay temperature and tint: ${animatedOverlayRender.stderr?.toString() || animatedOverlayRender.error?.message || ''}`);
const overlayFrameBytes = 32 * 32 * 4;
const overlayFrame = frame => animatedOverlayRender.stdout.subarray(frame * overlayFrameBytes, (frame + 1) * overlayFrameBytes);
assert.notDeepEqual(overlayFrame(0), overlayFrame(3),
  'animated overlay temperature and tint change exported pixels over time');
const transparentOverlayFade = compileOverlaySource({
  outputStart: 0, outputEnd: 2, source: { type: 'image' },
  geometry: [{ t: 0, x: 0.5, y: 0.5, w: 0.5, h: 0.5, opacity: 1, rotation: 0 }],
  effects: [{ kind: 'fade_in', params: { duration: 0.5, color: [1, 0, 0] } }],
}, 1, 'transparent_overlay_fade', { width: 1080, height: 1920, fps: 30 });
assert.match(transparentOverlayFade, /fade=t=in:st=0(?::|\.0+:)d=0\.5(?:0+)?:alpha=1/,
  'image overlays fade alpha without filling transparent pixels with a color');
const videoOverlayFade = compileOverlaySource({
  outputStart: 0, outputEnd: 2, source: { type: 'video' },
  geometry: [{ t: 0, x: 0.5, y: 0.5, w: 0.5, h: 0.5, opacity: 1, rotation: 0 }],
  effects: [{ kind: 'fade_in', params: { duration: 0.5, color: [1, 0, 0] } }],
}, 1, 'video_overlay_fade', { width: 1080, height: 1920, fps: 30 });
assert.match(videoOverlayFade, /fade=t=in:st=0(?::|\.0+:)d=0\.5(?:0+)?:color=0xff0000/,
  'video overlays retain authored fade-from-color behavior');
const overlayMotionBlurExport = compileOverlaySource({
  outputStart: 0, source: { type: 'video' },
  geometry: [{ t: 0, x: 0.5, y: 0.5, w: 0.5, h: 0.5, opacity: 1, rotation: 0 }],
  effects: [{ kind: 'motion-blur', params: { amount: 2, angle: 35 } }],
}, 1, 'motion_blur_overlay', { width: 1080, height: 1920, fps: 30 });
assert.match(overlayMotionBlurExport, /rotate=-0\.6109/);
assert.match(overlayMotionBlurExport, /gblur=sigma=1:sigmaV=0/,
  'legacy overlay blur radius matches the normalized GPU shutter travel at the overlay dimensions');
assert.doesNotMatch(overlayMotionBlurExport, /tmix=/, 'overlay motion blur is spatial and does not leave temporal frame trails');
const overlayRegistryMotionExport = compileOverlaySource({
  outputStart: 0, source: { type: 'video' },
  geometry: [{ t: 0, x: 0.5, y: 0.5, w: 0.5, h: 0.5, opacity: 1, rotation: 0 }],
  effects: [{ kind: 'blur_motion', params: { intensity: 0.5, samples: 16, angle: 90 } }],
}, 1, 'registry_motion_blur_overlay', { width: 1080, height: 1920, fps: 30 });
assert.match(overlayRegistryMotionExport, /gblur=sigma=7\.7942:sigmaV=0/,
  'registry motion-blur intensity scales against the actual overlay pixel width');
const overlayRadialBlurExport = compileOverlaySource({
  outputStart: 0, source: { type: 'video' },
  geometry: [{ t: 0, x: 0.5, y: 0.5, w: 0.5, h: 0.5, opacity: 1, rotation: 0 }],
  effects: [{ kind: 'blur_radial', params: { intensity: 0.6, centerX: 0.25, centerY: 0.7, samples: 8 } }],
}, 1, 'radial_blur_overlay', { width: 1080, height: 1920, fps: 30 });
assert.ok(overlayRadialBlurExport.includes('geq=') && overlayRadialBlurExport.includes('0.25-X/W')
  && overlayRadialBlurExport.includes('0.7-Y/H'),
  'scene overlay radial blur export follows its authored center instead of substituting gaussian blur');
const overlayRadialRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=2:d=1',
  '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2:duration=1',
  '-filter_complex', overlayRadialBlurExport, '-map', '[radial_blur_overlay]',
  '-frames:v', '1', '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(overlayRadialRender.status, 0,
  `FFmpeg accepts scene overlay radial blur: ${overlayRadialRender.stderr || overlayRadialRender.error?.message || ''}`);
const fadeFilters = compileTimelineVisualEffects([
  { kind: 'fade_in', params: { duration: 0.25, color: [0, 0, 0] } },
  { kind: 'fade_out', params: { duration: 0.25, color: [1, 1, 1] } },
], { duration: 1 });
assert.deepEqual(fadeFilters, ['fade=t=in:st=0.000:d=0.250:color=0x000000', 'fade=t=out:st=0.750:d=0.250:color=0xffffff'],
  'built-in fade effects compile to clip-relative filters with authored color and duration');
const fadeRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=8:duration=1',
  '-vf', fadeFilters.join(','), '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(fadeRender.status, 0, `FFmpeg renders built-in fade effects: ${fadeRender.stderr || fadeRender.error?.message || ''}`);
assert.deepEqual(compileTimelineAudioEffects([
  { type: 'audio_normalize', params: { targetLevel: -6 } },
  { kind: 'audio_denoise', params: { amount: 0.75 } },
]), ['loudnorm=I=-6:TP=-1.5:LRA=11', 'afftdn=nf=-35.0'], 'built-in audio effects compile to audio filters in stack order');
const audioRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2',
  '-af', compileTimelineAudioEffects([
    { type: 'audio_normalize', params: { targetLevel: -6 } },
    { kind: 'audio_denoise', params: { amount: 0.75 } },
  ]).join(','), '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(audioRender.status, 0, `FFmpeg renders built-in audio effects: ${audioRender.stderr || audioRender.error?.message || ''}`);
assert.equal(resolveTimelineSpeedEffect([{ kind: 'speed_change', params: { speed: 1.5 } }], 0, 4).speed, 1.5,
  'full-clip speed effect becomes the export clip speed');
assert.equal(resolveTimelineSpeedEffect([{ kind: 'speed_change', params: { speed: 1.5, maintainPitch: false } }], 0, 4).maintainPitch, false,
  'speed effect preserves the user pitch preference for the audio render');
const partialSpeed = resolveTimelineSpeedEffect([{ kind: 'speed_change', startTime: 1, endTime: 3, params: { speed: 1.5 } }], 0, 4);
assert.ok(partialSpeed.retime && !partialSpeed.warning,
  'partial speed changes build a retime plan with normal-speed sections around the effect');
assert.ok(Math.abs(partialSpeed.retime.sourceDuration - 5) < 1e-4,
  'partial speed changes preserve normal playback before and after the active window');
const animatedSpeed = resolveTimelineSpeedEffect([{ kind: 'speed_change', params: { speed: 1 }, keyframes: { speed: [
  { time: 0, value: 1 }, { time: 2, value: 1.8 },
] } }], 0, 4);
assert.ok(animatedSpeed.retime && !animatedSpeed.warning,
  'animated time remapping resolves to a renderable retime plan');
const animatedSpeedOnLaterClip = resolveTimelineSpeedEffect([{ kind: 'speed_change', params: { speed: 1 }, keyframes: { speed: [
  { time: 10, value: 1 }, { time: 12, value: 1.8 },
] } }], 10, 4);
assert.ok(animatedSpeedOnLaterClip.retime && !animatedSpeedOnLaterClip.warning,
  'animated speed keyframes authored in project time map correctly on a clip placed later in the timeline');
assert.ok(Math.abs(animatedSpeedOnLaterClip.retime.sourceDuration - animatedSpeed.retime.sourceDuration) < 1e-6,
  'later clip placement does not shift the animated speed curve or its integrated source duration');
assert.equal(resolveTimelineSpeedEffect([{ kind: 'speed_change', params: { speed: 1 }, keyframes: { speed: [
  { time: 0, value: 1.75 },
] } }], 0, 4).speed, 1.75,
  'a single authored speed keyframe resolves to the clip constant');
const speedRetime = buildSpeedRetimePlan(2, [{ time: 0, value: 1 }, { time: 2, value: 2 }]);
assert.ok(speedRetime, 'animated speed keys produce a retime plan');
assert.equal(speedRetime.duration, 2, 'retiming preserves the authored clip duration');
assert.ok(Math.abs(speedRetime.sourceDuration - 3) < 1e-6, 'retime integrates the changing source rate');
const steppedSpeedRetime = buildSpeedRetimePlan(2, [
  { time: 0, value: 0.1 }, { time: 2, value: 4, easing: 'steps(2, end)' },
]);
assert.ok(steppedSpeedRetime, 'step-eased speed keyframes produce an export plan');
assert.ok(Math.abs(steppedSpeedRetime.sourceDuration - 2.15) < 1e-8,
  'export integrates discrete step rates without inventing ramps');
assert.deepEqual([...new Set(steppedSpeedRetime.intervals.map(interval => Number(interval.speed.toFixed(6))))], [0.1, 2.05],
  'export intervals align with each exact speed step');
assert.equal(resolveTimelineSpeedEffect([{ kind: 'speed_change', params: { speed: 1 }, keyframes: { speed: [
  { time: 0, value: 1 }, { time: 2, value: 2 },
] } }], 0, 2).retime.sourceDuration, 3, 'speed effects resolve to the same shared retime map');
for (const easing of [...listEasingNames(), 'cubic-bezier(0.2,1.4,0.8,-0.4)', 'spring(180,12)', 'steps(5)']) {
  const easedPlan = buildSpeedRetimePlan(2, [
    { time: 0, value: 0.1 }, { time: 2, value: 4, easing },
  ]);
  assert.ok(easedPlan, `${easing} speed animation produces an export plan`);
  assert.ok(easedPlan.intervals.every(interval => Number.isFinite(interval.speed) && interval.speed >= 0.1 && interval.speed <= 4),
    `${easing} overshoot stays within FFmpeg's supported playback speed range`);
  assert.ok(Number.isFinite(easedPlan.sourceDuration) && easedPlan.sourceDuration > 0,
    `${easing} produces a finite source-time map`);
  const canonical = resolveEasing(easing);
  for (const interval of easedPlan.intervals) {
    const atStart = Math.max(0.1, Math.min(4, 0.1 + (4 - 0.1) * canonical(interval.start / 2)));
    const atEnd = Math.max(0.1, Math.min(4, 0.1 + (4 - 0.1) * canonical(interval.end / 2)));
    const expectedSpeed = easing.startsWith('steps(')
      ? Math.max(0.1, Math.min(4, 0.1 + (4 - 0.1) * canonical(((interval.start + interval.end) / 4))))
      : (atStart + atEnd) / 2;
    assert.ok(Math.abs(interval.speed - expectedSpeed) < 0.03,
      `${easing} matches the canonical motion easing curve across a retime interval`);
  }
}
for (const easing of ['steps(4, start)', 'steps(4, end)', 'steps(4, jump-start)', 'steps(4, jump-end)', 'steps(4, jump-none)', 'steps(4, jump-both)']) {
  const canonical = resolveEasing(easing);
  for (const progress of [0, 0.01, 0.24, 0.25, 0.51, 0.99, 1]) {
    assert.ok(Math.abs(applyRetimeEasing(easing, progress) - canonical(progress)) < 1e-9,
      `${easing} export easing matches canonical resolution at ${progress}`);
  }
}
assert.equal(applyRetimeEasing('steps(1, jump-none)', 0.25), resolveEasing('steps(1, jump-none)')(0.25),
  'invalid one-step jump-none falls back to canonical linear easing');
const retimeVideo = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=96x64:rate=24:duration=${speedRetime.sourceDuration}`,
  '-vf', speedRetime.videoFilter, '-t', String(speedRetime.duration), '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(retimeVideo.status, 0, `FFmpeg renders the animated video retime: ${retimeVideo.stderr || retimeVideo.error?.message || ''}`);
const retimeAudio = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${speedRetime.sourceDuration}`,
  '-filter_complex', speedRetime.audioGraph, '-map', '[aretimed]', '-t', String(speedRetime.duration), '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(retimeAudio.status, 0, `FFmpeg renders the synchronized audio retime: ${retimeAudio.stderr || retimeAudio.error?.message || ''}`);
const partialSpeedVideo = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=96x64:rate=24:duration=${partialSpeed.retime.sourceDuration}`,
  '-vf', partialSpeed.retime.videoFilter, '-t', String(partialSpeed.retime.duration), '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(partialSpeedVideo.status, 0,
  `FFmpeg renders partial speed changes: ${partialSpeedVideo.stderr || partialSpeedVideo.error?.message || ''}`);
const animatedFootageBlur = compileTimelineVisualEffects([{
  kind: 'blur_gaussian', startTime: 10.25, endTime: 11.25,
  params: { radius: 0 }, keyframes: { radius: [
    { time: 10, value: 0 }, { time: 11.5, value: 32, easing: 'easeInOutCubic' },
  ] },
}], { width: 96, height: 64, clipStart: 10, duration: 2 });
assert.match(animatedFootageBlur[0], /^__VIBED_ANIMATED_BLUR__/,
  'animated Gaussian radius is compiled as a dynamic blur operation');
const animatedFootageBlurGraph = compileTimelineVisualEffectGraph(animatedFootageBlur, {
  input: '0:v', output: 'animated_footage_blur',
}).join(';');
assert.match(animatedFootageBlurGraph, /blend=all_expr=/,
  'animated Gaussian blur interpolates between pre-rendered blur radii instead of using unsupported runtime gblur commands');
assert.ok([0.01, 10, 20, 30, 40, 50].every(radius => animatedFootageBlurGraph.includes(`gblur=sigma=${radius}`)),
  'animated Gaussian blur uses intermediate render levels for a smooth radius response across its full range');
assert.match(animatedFootageBlurGraph, /enable='gte\(t,0\.250000\)\*lt\(t,1\.250000\)'/,
  'animated Gaussian blur respects its clip-local effect window');
const animatedFootageBlurRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=4:duration=2',
  '-filter_complex', animatedFootageBlurGraph, '-map', '[animated_footage_blur]', '-frames:v', '8', '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(animatedFootageBlurRender.status, 0,
  `FFmpeg renders animated footage blur: ${animatedFootageBlurRender.stderr || animatedFootageBlurRender.error?.message || ''}`);
assert.deepEqual(collectTimelineEffectWarnings([{ name: 'Interview', effects: [
  { kind: 'blur_gaussian', enabled: true }, { kind: 'lut_apply', enabled: true },
  { kind: 'mystery_effect', enabled: true }, { kind: 'glow', enabled: false },
] }]), [
  'Interview: its LUT could not be resolved for export and was skipped.',
  'Interview: the “mystery_effect” effect is not supported in export and was skipped.',
], 'unsupported enabled effects are reported while supported and disabled effects stay quiet');
assert.deepEqual(collectTimelineEffectWarnings([{ name: 'Interview', start: 10, duration: 4, effects: [
  { kind: 'glow', startTime: 11, endTime: 12 }, { kind: 'shake', startTime: 12, endTime: 13 },
] }]), [
], 'supported partial glow and shake effects do not produce false skipped-effect warnings');
const windowedShake = compileTimelineVisualEffects([{
  kind: 'shake', startTime: 10.5, endTime: 11, params: { intensity: 40, frequency: 8, rotationAmount: 2, randomSeed: 11 },
}], { width: 96, height: 64, clipStart: 10, duration: 1.5 });
assert.match(windowedShake[0], /^__VIBED_SHAKE__/);
const windowedShakeGraph = compileTimelineVisualEffectGraph(windowedShake, { input: '0:v', output: 'windowed_shake' }).join(';');
assert.match(windowedShakeGraph, /enable='gte\(t,0\.500000\)\*lt\(t,1\.000000\)'/,
  'partial shake is isolated and enabled only within its clip-local effect window');
const windowedShakeRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=4:duration=1.5',
  '-filter_complex', windowedShakeGraph, '-map', '[windowed_shake]', '-frames:v', '6', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(windowedShakeRender.status, 0,
  `FFmpeg renders windowed footage shake: ${windowedShakeRender.stderr?.toString() || windowedShakeRender.error?.message || ''}`);
const unshakenRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=4:duration=1.5',
  '-frames:v', '6', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(unshakenRender.status, 0,
  `FFmpeg renders comparison footage: ${unshakenRender.stderr?.toString() || unshakenRender.error?.message || ''}`);
const shakeFrameBytes = 96 * 64 * 3;
const shakeFrame = index => windowedShakeRender.stdout.subarray(index * shakeFrameBytes, (index + 1) * shakeFrameBytes);
const unshakenFrame = index => unshakenRender.stdout.subarray(index * shakeFrameBytes, (index + 1) * shakeFrameBytes);
for (const index of [0, 1, 4, 5]) assert.deepEqual(shakeFrame(index), unshakenFrame(index),
  `windowed shake leaves frame ${index} outside its authored interval unchanged`);
assert.ok(!shakeFrame(2).equals(unshakenFrame(2)) || !shakeFrame(3).equals(unshakenFrame(3)),
  'windowed shake changes at least one frame inside its authored interval');
assert.deepEqual(collectTimelineEffectWarnings([{ name: 'Unanalyzed', effects: [
  { id: 'zoom-1', kind: 'smart_zoom', enabled: true },
  { id: 'beat-1', kind: 'beat_sync', params: { effectType: 'shake' }, enabled: true },
] }]), [
  'Unanalyzed: “smart_zoom” has no completed analysis keyframes, so it was skipped in export.',
  'Unanalyzed: “beat_sync” mode “shake” has no export implementation and was skipped.',
], 'AI effects without renderable analyzed tracks or a supported mode are not reported as successful exports');
assert.deepEqual(collectTimelineEffectWarnings([{ name: 'Analyzed', keyframes: { scale: [{ time: 0, value: 1 }, { time: 1, value: 1.2 }] },
  metadata: { aiEffectAnalysis: { 'zoom-2': { keyframes: [{ time: 0, scale: 1 }, { time: 1, scale: 1.2 }] } } },
  effects: [{ id: 'zoom-2', kind: 'smart_zoom', enabled: true }] }]), [],
  'analyzed AI framing effects are recognized as rendered by their exported keyframe tracks');

// Keep the public Effects panel catalogue and primary-footage export in sync.
// A declared effect must render, be handled by the dedicated retiming path, or
// explicitly disclose why it cannot render; it must never disappear silently.
for (const [id, definition] of Object.entries(EFFECT_DEFINITIONS)) {
  const effect = { id: `catalog-${id}`, kind: id, type: id, params: Object.fromEntries(
    Object.entries(definition.params || {}).map(([key, value]) => [key, value.value]),
  ) };
  const videoFilters = compileTimelineVisualEffects([effect], { width: 1080, height: 1920, duration: 3 });
  const audioFilters = compileTimelineAudioEffects([effect]);
  const warnings = collectTimelineEffectWarnings([{ name: 'Catalogue probe', effects: [effect] }]);
  const retiming = id === 'speed_change' && resolveTimelineSpeedEffect([effect], 0, 3)?.speed > 0;
  assert.ok(videoFilters.length || audioFilters.length || warnings.length || retiming,
    `catalogued ${id} has an export implementation or an explicit warning`);
}
const staticGrain = compileTimelineVisualEffects([{ kind: 'film_grain', params: { intensity: 0.2, size: 2.5, seed: 41, animated: false } }]);
const animatedGrain = compileTimelineVisualEffects([{ kind: 'film_grain', params: { intensity: 0.2, size: 1, seed: 41, animated: { value: true } } }]);
assert.ok(staticGrain[0].includes('floor(X/2.5000)') && staticGrain[0].includes('41*7.1') && !staticGrain[0].includes('floor(T*30)'), 'film grain export applies authored size and seed while holding the pattern when animation is disabled');
assert.ok(animatedGrain[0].includes('floor(X/1.0000)') && animatedGrain[0].includes('floor(T*30)'), 'wrapped animation control advances the seeded grain at 30 fps');
const keyedGrain = compileTimelineVisualEffects([{
  kind: 'film_grain',
  params: { intensity: 0, size: 1.5, seed: 41, animated: true },
  samples: { intensity: [{ t: 0, value: 0 }, { t: 1, value: 1 }] },
}]);
assert.ok(keyedGrain[0].includes('T') && keyedGrain[0].includes('*510'), 'film grain export maps sampled normalized intensity to the shader’s full signed 8-bit amplitude');
const keyedGrainRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=8:duration=1.5',
  '-vf', keyedGrain.join(','), '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(keyedGrainRender.status, 0, `FFmpeg accepts and renders animated film grain: ${keyedGrainRender.stderr || keyedGrainRender.error?.message || ''}`);
const grainFixture = 'color=c=0x808080:s=64x64:r=1:d=1';
const grainInput = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', grainFixture,
  '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
const grainOutput = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', grainFixture,
  '-vf', staticGrain.join(','), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { encoding: null, timeout: 20000 });
assert.equal(grainInput.status, 0, `FFmpeg creates the film-grain baseline: ${grainInput.stderr?.toString() || grainInput.error?.message || ''}`);
assert.equal(grainOutput.status, 0, `FFmpeg renders normalized film grain: ${grainOutput.stderr?.toString() || grainOutput.error?.message || ''}`);
const grainRms = Math.sqrt(grainOutput.stdout.reduce((sum, value, index) => {
  const delta = value - grainInput.stdout[index];
  return sum + delta * delta;
}, 0) / grainOutput.stdout.length);
assert.ok(grainRms > 20 && grainRms < 40,
  `normalized intensity 0.2 produces shader-scale grain in export (expected 20–40 RGB RMS, received ${grainRms.toFixed(2)})`);
const glitchExport = compileTimelineVisualEffects([{ kind: 'glitch', params: { intensity: { value: 0.5 }, blockSize: { value: 24 }, colorShift: { value: true }, scanlines: { value: true } } }]);
assert.ok(glitchExport.some(filter => filter.includes('geq=') && filter.includes('floor(T*12)')), 'glitch exports timed horizontal displacement bands like the live preview');
assert.ok(!glitchExport.some(filter => filter.startsWith('noise=') || filter.startsWith('chromashift=') || filter.startsWith('drawgrid=')), 'glitch does not substitute noise, RGB split, or scanlines for the preview effect');
const basicGlitch = compileTimelineVisualEffects([{ kind: 'glitch', params: { intensity: 0.5 } }]);
assert.ok(basicGlitch.some(filter => filter.includes('geq=') && filter.includes('*(20.0000)')), 'glitch intensity maps to the preview displacement distance');
const glitchRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=8:duration=0.5',
  '-vf', glitchExport.join(','), '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(glitchRender.status, 0, `FFmpeg accepts and renders the authored glitch chain: ${glitchRender.stderr || glitchRender.error?.message || ''}`);
assert.ok(authoredExport.filter(filter => filter.startsWith('colorchannelmixer=rr=1.1000:gg=1.1000:bb=1.1000')).length >= 2, 'color-grade brightness uses the same multiplicative model');
assert.ok(authoredExport.some(filter => filter.startsWith('format=rgba,geq=') && filter.includes('cos((0.000000)*PI/180)')),
  'authored chromatic shift preserves preview channel direction in export');
for (const prefix of ['gblur=', 'colorchannelmixer=', 'eq=contrast=', 'eq=saturation=', 'hue=', 'noise=', 'format=rgba,geq=']) {
  assert.ok(authoredExport.some(filter => filter.startsWith(prefix)), `${prefix} authored effect compiles for base footage export`);
}
const authoredShake = compileTimelineVisualEffects([{ kind: 'shake', params: { intensity: 5, frequency: 8, rotationAmount: 1, randomSeed: 2 } }], { width: 96, height: 64 });
assert.ok(authoredShake.some(filter => String(filter).startsWith('__VIBED_SHAKE__')),
  'shake is serialized for the isolated compositor graph');
const authoredShakeGraph = compileTimelineVisualEffectGraph(authoredShake, { input: '0:v', output: 'authored_shake' }).join(';');
for (const operation of ['scale=', 'rotate=', 'crop=', 'overlay=']) {
  assert.ok(authoredShakeGraph.includes(operation), `shake graph applies ${operation} to the footage`);
}
for (const previewPathComponent of [
  'sin((t*8*2*PI)*1.17+2*12.9898)*0.72+sin((t*8*2*PI)*0.73+2*7.31)*0.28',
  'sin((t*8*2*PI)*0.91+100+2*3.17)*0.68+sin((t*8*2*PI)*1.31+2*9.2)*0.32',
  'sin((t*8*2*PI)*0.83+200+2*5.13)',
]) assert.ok(authoredShakeGraph.includes(previewPathComponent),
  `shake export uses the same deterministic motion equation as preview (${previewPathComponent})`);
const portraitShake = compileTimelineVisualEffectGraph(compileTimelineVisualEffects([
  { kind: 'shake', params: { intensity: 30, rotationAmount: 10 } },
], { width: 108, height: 192 }), { input: '0:v', output: 'portrait_shake' }).join(';');
assert.match(portraitShake, /scale=152:268/,
  'portrait shake reserves the larger overscan required to rotate a tall frame without exposing empty corners');
assert.ok(authoredExport.some(filter => filter.includes('geq=') && filter.includes('sqrt(pow(X/W-0.5,2)')),
  'vignette authored effect compiles as a radial edge tint for base footage export');
assert.ok(!authoredExport.some(filter => filter === 'eq=contrast=3'), 'disabled effects are omitted from export');

for (const [kind, parameter, values] of [
  ['contrast', 'amount', [1, 2]], ['saturation', 'amount', [0.5, 1.5]],
  ['brightness', 'amount', [0.75, 1.25]], ['hue', 'degrees', [-30, 30]],
  ['color_grade', 'brightness', [80, 120]],
]) {
  const effect = { kind, params: { [parameter]: values[0] }, keyframes: { [parameter]: [
    { time: 0, value: values[0] }, { time: 0.5, value: values[1], easing: 'ease-in-out' },
  ] } };
  const filters = compileTimelineVisualEffects([effect]);
  assert.ok(filters.length > 0, `${kind} keyframes compile to an animated export filter`);
  const rendered = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24:duration=0.5',
    '-vf', filters.join(','), '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(rendered.status, 0, `FFmpeg renders animated ${kind}: ${rendered.stderr || rendered.error?.message || ''}`);
}

const render = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=8:duration=0.5',
  '-vf', exported.join(','), '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(render.status, 0, `FFmpeg accepts and renders the footage effect chain: ${render.stderr || render.error?.message || ''}`);

const authoredRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=8:duration=0.5',
  '-filter_complex', compileTimelineVisualEffectGraph(authoredExport, { input: '0:v', output: 'authored_out' }).join(';'),
  '-map', '[authored_out]', '-f', 'null', '-',
], { encoding: 'utf8', timeout: 20000 });
assert.equal(authoredRender.status, 0, `FFmpeg accepts the authored footage effect chain: ${authoredRender.stderr || authoredRender.error?.message || ''}`);

const brightnessRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x646464:s=2x2:d=1',
  '-vf', compileTimelineVisualEffects([{ kind: 'brightness', params: { amount: 1.5 } }]).join(','),
  '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { timeout: 20000 });
assert.equal(brightnessRender.status, 0, `FFmpeg renders multiplicative brightness: ${brightnessRender.stderr?.toString() || brightnessRender.error?.message || ''}`);
assert.ok([...brightnessRender.stdout.subarray(0, 3)].every(channel => Math.abs(channel - 150) <= 5),
  `1.5x brightness maps channel value 100 near 150, received ${[...brightnessRender.stdout.subarray(0, 3)].join(',')}`);

const animatedGradeRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x646464:s=2x2:r=24:d=0.5',
  '-vf', colorGradeExport.join(','), '-frames:v', '12', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
], { timeout: 20000 });
assert.equal(animatedGradeRender.status, 0,
  `FFmpeg renders animated multiplicative color-grade brightness: ${animatedGradeRender.stderr?.toString() || animatedGradeRender.error?.message || ''}`);
const gradePixels = animatedGradeRender.stdout;
assert.ok(Math.abs(gradePixels[0] - 100) <= 4, `animated grade begins at neutral, received ${gradePixels[0]}`);
const finalFrameOffset = 11 * 2 * 2 * 3;
assert.ok(Math.abs(gradePixels[finalFrameOffset] - 188) <= 5,
  `animated 2x brightness approaches 200 from 100 at the clip end, received ${gradePixels[finalFrameOffset]}`);
const gradeAlphaRender = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.5:s=2x2:r=1:d=1,format=rgba',
  '-vf', colorGradeExport.join(','), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
], { timeout: 20000 });
assert.equal(gradeAlphaRender.status, 0,
  `FFmpeg retains alpha while animating grade: ${gradeAlphaRender.stderr?.toString() || gradeAlphaRender.error?.message || ''}`);
assert.ok(Math.abs(gradeAlphaRender.stdout[3] - 128) <= 2,
  `animated color grade preserves 50% source alpha, received ${gradeAlphaRender.stdout[3]}`);

console.log('Footage effect stack passed: presets and authored effects render through preview and primary-footage export.');
