import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Canvas from '@napi-rs/canvas';
import { createNode, createScene, flattenScene, NODE_TYPES } from '../client/src/motion/SceneSchema.js';
import { autoFixScene, ISSUE_CODES, validateScene } from '../client/src/motion/SceneValidator.js';
import { drawLayerWithEffects, GRAPHIC_EFFECT_KINDS } from '../client/src/motion/LayerEffects.js';
import { drawVectorFrame } from '../client/src/motion/VectorGraphics.js';
import { renderVectorFrames } from '../server/compositor/TemplateRenderer.js';

const overlayPreviewSource = fs.readFileSync(new URL('../client/src/components/Player/GraphicOverlay.jsx', import.meta.url), 'utf8');
const directionalOverlayBlur = overlayPreviewSource.slice(
  overlayPreviewSource.indexOf("if (effect.kind === 'blur_motion')"),
  overlayPreviewSource.indexOf("if (effect.kind === 'distortion')"),
);
assert.match(directionalOverlayBlur, /Math\.cos\(angle\)[\s\S]*Math\.sin\(angle\)/,
  'overlay preview follows the authored directional motion-blur angle');
assert.match(directionalOverlayBlur, /feOffset[\s\S]*feComposite[\s\S]*arithmetic/,
  'overlay preview builds a sampled directional blur instead of an ordinary Gaussian blur');
assert.doesNotMatch(overlayPreviewSource.slice(overlayPreviewSource.indexOf('function overlayFilterCss'), overlayPreviewSource.indexOf('function ' , overlayPreviewSource.indexOf('function overlayFilterCss') + 10)), /case 'blur_motion'/,
  'directional motion blur is not also replaced by a CSS Gaussian blur');
const overlayImageSource = overlayPreviewSource.slice(overlayPreviewSource.indexOf('function cssGradient'), overlayPreviewSource.indexOf('const effectFilterId'));
assert.match(overlayImageSource, /effect\?\.kind \|\| effect\?\.type/,
  'image overlay gradient fill accepts registry type discriminators as well as scene kind discriminators');
assert.match(overlayImageSource, /effect\.params\?\.opacity\?\.value/,
  'image overlay gradient opacity unwraps registry parameter values');
assert.match(overlayImageSource, /resolveEffectAtTime\(effect, currentTime, effectContext\)/,
  'image overlay gradient fills sample animated parameters and authored time windows at preview time');
assert.match(overlayPreviewSource.slice(overlayPreviewSource.indexOf('function cssGradient'), overlayPreviewSource.indexOf('function effectColorCss')),
  /Array\.isArray\(rawColor\)[\s\S]*effectColorCss\(rawColor\)/,
  'video and image CSS gradient previews accept normalized RGB array color stops');
assert.match(overlayPreviewSource, /<OverlayImage clip=\{clip\} src=\{src\} style=\{mediaStyle\} currentTime=\{currentTime\}(?: motionContext=\{transformBlurContext\})? \/>/,
  'unframed image overlay passes the live playhead and optional temporal-blur context into its effect renderer');
const overlayVideoSource = overlayPreviewSource.slice(overlayPreviewSource.indexOf('const OverlayVideo ='), overlayPreviewSource.indexOf('function cssGradient'));
assert.match(overlayVideoSource, /const gradients = .*clip\.effects[\s\S]*resolveEffectAtTime\(effect, currentTime, effectContext\)/,
  'video overlay gradient fills sample animated parameters and authored time windows at preview time');
assert.match(overlayVideoSource, /if \(!gradients\.length\) return video;[\s\S]*gradients\.map\(\(effect, index\)/,
  'video overlay preview composites each active gradient above the footage');
assert.match(overlayPreviewSource, /function resolveShakeTransform[\s\S]*rotationAmount[\s\S]*transform: shakeTransform/,
  'Camera Shake is sampled into the live preview transform for media and template layers');

const effects = [
  { kind: 'blur', params: { radius: 3 } },
  { kind: 'brightness', params: { amount: 1.15 } },
  { kind: 'shadow', params: { color: '#000000', blur: 8, x: 2, y: 3 } },
  { kind: 'grain', params: { amount: 8, seed: 7 } },
  { kind: 'chromatic-aberration', params: { amount: 2 } },
  { kind: 'gradient-fill', params: { colors: ['#FF355E', '#6930C3'], angle: 45 } },
  { kind: 'stroke', params: { width: 2, color: '#FFFFFF' } },
  { kind: 'inner-shadow', params: { x: 2, y: 2, blur: 2, color: '#000000', opacity: 0.35 } },
];

const typedEffectScene = createScene({ nodes: [createNode(NODE_TYPES.TEXT, {
  id: 'typed-effect-text', start: 0, duration: 1, content: 'Effect survives flattening',
  effects: [{ type: 'glow', enabled: true, params: { radius: 8, intensity: 0.7 } }],
})] });
assert.equal(flattenScene(typedEffectScene).placements[0].clip.effects[0].kind, 'glow', 'registry-style type effects normalize to kind when scene nodes flatten to timeline clips');
const mediaEffectScene = createScene({ duration: 2, nodes: [createNode(NODE_TYPES.VIDEO, {
  id: 'media-effects', start: 0, duration: 2, source: { assetId: 'footage-1' },
  effects: [{ kind: 'vignette', params: { intensity: 0.5 } }, { kind: 'glitch', params: { intensity: 0.2 } },
    { kind: 'fade_in', params: { duration: 0.5 } }, { kind: 'fade_out', params: { duration: 0.4 } }],
})] });
assert.equal(validateScene(mediaEffectScene, { assets: [{ id: 'footage-1' }], skipCollisions: true }).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_EFFECT), false,
  'implemented footage effects are recognized by scene validation');
assert.deepEqual(autoFixScene(mediaEffectScene, { assets: [{ id: 'footage-1' }], skipCollisions: true }).scene.nodes[0].effects.map(effect => effect.kind), ['vignette', 'glitch', 'fade_in', 'fade_out'],
  'auto-fix preserves supported footage effects');
const scene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
  duration: 1, effects, vector: { kind: 'circle', w: 120, h: 120, fill: '#FF355E' },
})] });
const [placement] = flattenScene(scene).placements;
assert.deepEqual(placement.clip.effects, effects, 'scene effects survive compilation into the graphic layer');

function render(stack, timeSeconds = 0) {
  const canvas = Canvas.createCanvas(160, 160);
  const ctx = canvas.getContext('2d');
  drawLayerWithEffects(ctx, stack, drawCtx => drawVectorFrame(drawCtx, { kind: 'circle', w: 120, h: 120, fill: '#FF355E' }, 1, 1), null, timeSeconds);
  return canvas.toBuffer('image/png');
}
assert.notDeepEqual(render([]), render(effects), 'effect stack changes actual rendered output');
assert.deepEqual(
  render([{ type: 'brightness', params: { amount: 0.35 } }]),
  render([{ kind: 'brightness', params: { amount: 0.35 } }]),
  'registry-shaped type effects dispatch identically to kind-shaped graphic effects',
);
assert.deepEqual(
  render([{ type: 'brightness', enabled: false, params: { amount: 0.35 } }]),
  render([]),
  'disabled registry-shaped effects remain disabled after kind normalization',
);
const translucentEffectCanvas = Canvas.createCanvas(24, 24);
const translucentEffectCtx = translucentEffectCanvas.getContext('2d');
translucentEffectCtx.globalAlpha = 0.4;
drawLayerWithEffects(translucentEffectCtx, [{ kind: 'brightness', params: { amount: 1 } }], drawCtx => {
  drawCtx.fillStyle = '#0000FF'; drawCtx.fillRect(4, 4, 16, 16);
});
assert.ok(Math.abs(translucentEffectCtx.getImageData(12, 12, 1, 1).data[3] - 102) <= 1,
  'effect-isolated layers preserve the caller opacity during their final composite');
const blendedEffectCanvas = Canvas.createCanvas(24, 24);
const blendedEffectCtx = blendedEffectCanvas.getContext('2d');
blendedEffectCtx.fillStyle = '#C8C8C8'; blendedEffectCtx.fillRect(0, 0, 24, 24);
blendedEffectCtx.globalCompositeOperation = 'multiply';
drawLayerWithEffects(blendedEffectCtx, [{ kind: 'brightness', params: { amount: 1 } }], drawCtx => {
  drawCtx.fillStyle = '#FF0000'; drawCtx.fillRect(4, 4, 16, 16);
});
const blendedPixel = blendedEffectCtx.getImageData(12, 12, 1, 1).data;
assert.ok(blendedPixel[0] >= 198 && blendedPixel[0] <= 202 && blendedPixel[1] <= 2 && blendedPixel[2] <= 2,
  'effect-isolated layers preserve the caller blend mode during their final composite');
function glowSample(sourceColor) {
  const canvas = Canvas.createCanvas(48, 48);
  drawLayerWithEffects(canvas.getContext('2d'), [{ kind: 'glow', params: { threshold: 0.7, intensity: 1.5, radius: 5, color: '#00C8FF' } }], drawCtx => {
    drawCtx.fillStyle = sourceColor; drawCtx.fillRect(16, 16, 16, 16);
  });
  return canvas.getContext('2d').getImageData(13, 24, 1, 1).data;
}
assert.ok(glowSample('#FFFFFF')[3] > 0, 'glow blooms above-threshold highlights beyond the source silhouette');
assert.equal(glowSample('#222222')[3], 0, 'glow threshold suppresses bloom from dark pixels');
const animatedGraphicBrightness = [{ kind: 'brightness', params: { amount: 1 }, keyframes: { amount: [
  { time: 0, value: 0 }, { time: 1, value: 1.5, easing: 'linear' },
] } }];
assert.notDeepEqual(render(animatedGraphicBrightness, 0), render(animatedGraphicBrightness, 1),
  'graphic layer effects sample their keyframes at the render time');
const sparseAnimatedBrightness = [{ kind: 'brightness', keyframes: { amount: [
  { time: 0, value: 0.25 }, { time: 1, value: 1.75, easing: 'linear' },
] } }];
assert.notDeepEqual(render(sparseAnimatedBrightness, 0), render(sparseAnimatedBrightness, 1),
  'graphic layer effects materialize top-level keyframes when the parameter is absent');
const sparseExpressionBrightness = [{ kind: 'brightness', expressions: { amount: '1 + t' } }];
assert.notDeepEqual(render(sparseExpressionBrightness, 0), render(sparseExpressionBrightness, 1),
  'graphic layer effects materialize top-level expressions when the parameter is absent');
const boundedGraphicBrightness = [{ kind: 'brightness', startTime: 0.5, endTime: 1.5, params: { amount: 1.8 } }];
assert.deepEqual(render(boundedGraphicBrightness, 0), render([], 0),
  'graphic effects respect their authored start time');
assert.notDeepEqual(render(boundedGraphicBrightness, 1), render([], 1),
  'graphic effects apply while inside their authored time range');
assert.deepEqual(render(boundedGraphicBrightness, 1.5), render([], 1.5),
  'graphic effects stop at their authored end time');
const unboundedGraphicBrightness = [{ kind: 'brightness', startTime: null, endTime: null, params: { amount: 0.2 } }];
assert.notDeepEqual(render(unboundedGraphicBrightness, 0.5), render([], 0.5),
  'nullable effect bounds mean no explicit time limit rather than an end time of zero');
assert.notDeepEqual(render([]), render([{ kind: 'color_grade', params: { brightness: 100, contrast: 150, saturation: 100 } }]), 'color grade changes graphic layer pixels');
assert.notDeepEqual(render([]), render([{ kind: 'color_grade', params: { hueRotate: 120 } }]), 'color grade hue rotation changes graphic layer pixels');
assert.notDeepEqual(render([]), render([{ kind: 'color_grade', params: { temperature: 60, tint: -30 } }]), 'color grade temperature and tint change graphic layer pixels');
assert.notDeepEqual(render([]), render([{ kind: 'vignette', params: { intensity: 0.9, radius: 0.35, softness: 0.2 } }]), 'vignette changes graphic layer pixels');
assert.notDeepEqual(render([{ kind: 'glitch', params: { amount: 24, seed: 3 } }], 0), render([{ kind: 'glitch', params: { amount: 24, seed: 3 } }], 0.5), 'glitch varies with frame time');
assert.notDeepEqual(render([]), render([{ kind: 'glitch', params: { intensity: { value: 0.8 }, seed: 3 } }], 0), 'glitch resolves registry-wrapped intensity parameters');
assert.notDeepEqual(render([]), render([{ kind: 'blur_radial', params: { intensity: 0.8, centerX: 0.1, centerY: 0.2, samples: 12 } }]), 'radial blur changes graphic layer pixels');
function directionalBlurBounds(width, height) {
  const source = Canvas.createCanvas(width, height);
  const sourceContext = source.getContext('2d');
  const pixel = sourceContext.createImageData(width, height);
  const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  pixel.data.set([255, 255, 255, 255], center);
  sourceContext.putImageData(pixel, 0, 0);
  const output = Canvas.createCanvas(width, height);
  drawLayerWithEffects(output.getContext('2d'), [{ kind: 'blur_motion', params: { intensity: 1, angle: 45, samples: 64 } }], ctx => ctx.drawImage(source, 0, 0));
  const data = output.getContext('2d').getImageData(0, 0, width, height).data;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] <= 0) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { x: maxX - minX + 1, y: maxY - minY + 1 };
}
const portraitDirectionalBlur = directionalBlurBounds(40, 100);
assert.ok(Math.abs(portraitDirectionalBlur.x - portraitDirectionalBlur.y) <= 2,
  `45 degree CPU motion blur keeps equal pixel travel in portrait frames, got ${JSON.stringify(portraitDirectionalBlur)}`);
const radialGradient = Canvas.createCanvas(101, 5);
const radialGradientCtx = radialGradient.getContext('2d');
const radialPixels = radialGradientCtx.createImageData(101, 5);
for (let y = 0; y < 5; y++) for (let x = 0; x < 101; x++) {
  const i = (y * 101 + x) * 4;
  radialPixels.data[i] = x * 2;
  radialPixels.data[i + 1] = x * 2;
  radialPixels.data[i + 2] = x * 2;
  radialPixels.data[i + 3] = 255;
}
radialGradientCtx.putImageData(radialPixels, 0, 0);
const radialSoftware = Canvas.createCanvas(101, 5);
drawLayerWithEffects(radialSoftware.getContext('2d'), [{ kind: 'blur_radial', params: {
  intensity: 1, centerX: 0.5, centerY: 0.5, samples: 8,
} }], drawCtx => drawCtx.drawImage(radialGradient, 0, 0));
const radialActual = radialSoftware.getContext('2d').getImageData(75, 2, 1, 1).data[0];
const radialExpectedX = Array.from({ length: 8 }, (_, sample) =>
  Math.round(75 + (50 - 75) * (sample / 8) * 0.5));
const radialExpected = radialExpectedX.reduce((sum, x) => sum + x * 2, 0) / radialExpectedX.length;
assert.ok(Math.abs(radialActual - radialExpected) <= 1,
  'software radial blur matches the GPU sample travel and includes every texture sample');
assert.notDeepEqual(
  render([{ kind: 'blur_radial', params: { intensity: 0.8, centerX: 0.1, centerY: 0.2, samples: 8 } }]),
  render([{ kind: 'blur_radial', params: { intensity: 0.8, centerX: 0.1, centerY: 0.2, samples: 64 } }]),
  'radial blur export honors its authored sample count through the supported 8–64 range',
);
assert.notDeepEqual(render([]), render([{ kind: 'blur_gaussian', params: { radius: 5 } }]), 'Gaussian blur alias renders on graphic layers');
const graphicMediaEffects = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
  id: 'graphic-media-effects', duration: 1, vector: { kind: 'circle', w: 120, h: 120, fill: '#FFFFFF' },
  effects: [{ kind: 'color_grade' }, { kind: 'vignette' }, { kind: 'glitch' }, { kind: 'blur_radial' }, { kind: 'blur_gaussian' }, { kind: 'blur_motion' }],
})] });
assert.equal(validateScene(graphicMediaEffects).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_EFFECT), false,
  'color grade, vignette and glitch are supported on graphic layers as they are on footage');
assert.deepEqual(
  render([{ kind: 'brightness', params: { amount: { value: 1.15 } } }]),
  render([{ kind: 'brightness', params: { amount: 1.15 } }]),
  'canvas preview resolves EffectRegistry { value } parameters the same as scalar parameters',
);
assert.deepEqual(
  render([{ kind: 'blur', params: { radius: { value: 3 } } }]),
  render([{ kind: 'blur', params: { radius: 3 } }]),
  'canvas preview resolves wrapped blur radius values',
);
const movedClipExpression = [{ kind: 'brightness', params: { amount: { value: 1, expression: 'progress' } } }];
function renderExpression(stack, time, context) {
  const canvas = Canvas.createCanvas(160, 160);
  drawLayerWithEffects(canvas.getContext('2d'), stack, drawCtx => {
    drawCtx.fillStyle = '#FF355E'; drawCtx.fillRect(20, 20, 120, 120);
  }, null, time, context);
  return canvas.toBuffer('image/png');
}
assert.deepEqual(renderExpression(movedClipExpression, 11, { clipStart: 10, clipDuration: 2 }),
  renderExpression([{ kind: 'brightness', params: { amount: 0.5 } }], 0, { clipStart: 10, clipDuration: 2 }),
  'graphic effect expressions use clip-local progress after the clip is moved on the timeline');
const grain = [{ kind: 'grain', params: { amount: 28, seed: 17 } }];
assert.deepEqual(render(grain, 0), render(grain, 0), 'grain stays deterministic for the same frame time');
assert.notDeepEqual(render(grain, 0), render(grain, 0.1), 'preview grain changes over time instead of sticking to one seeded pattern');
const stillFilmGrain = [{ kind: 'film_grain', params: { intensity: 0.4, size: 1, animated: false, seed: 4 } }];
assert.deepEqual(render(stillFilmGrain, 0), render(stillFilmGrain, 0.5), 'film grain with animation disabled is frame-stable');
assert.notDeepEqual(
  render([{ kind: 'film_grain', params: { intensity: 0.4, size: 0.5, seed: 4 } }]),
  render([{ kind: 'film_grain', params: { intensity: 0.4, size: 5, seed: 4 } }]),
  'film grain size changes the spatial grain pattern',
);
const expandedAliases = [
  { kind: 'film_grain', params: { intensity: 0.8 } },
  { kind: 'rgb_split', params: { amount: 5 } },
];
assert.notDeepEqual(render([]), render(expandedAliases), 'film-grain and RGB-split aliases render on graphic layers');
const aliasScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
  id: 'alias-effects', duration: 1, vector: { kind: 'circle', w: 120, h: 120, fill: '#FFFFFF' }, effects: expandedAliases,
})] });
assert.equal(validateScene(aliasScene).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_EFFECT), false,
  'the validator recognizes graphic effect aliases that the shared renderer executes');

for (const kind of GRAPHIC_EFFECT_KINDS) {
  const declaredScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
    id: `declared-effect-${kind}`, duration: 1, vector: { kind: 'circle', w: 40, h: 40, fill: '#FFFFFF' },
    effects: [{ kind, params: {} }],
  })] });
  assert.equal(validateScene(declaredScene).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_EFFECT), false,
    `the validator recognizes executable graphic effect: ${kind}`);
}

const shakeScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
  id: 'shake-scene-layer', duration: 1, vector: { kind: 'rect', w: 80, h: 40, fill: '#FFFFFF' },
  effects: [{ kind: 'shake', params: { intensity: 32, frequency: 4, randomSeed: 3, rotationAmount: 4 } }],
})] });
assert.equal(validateScene(shakeScene).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_EFFECT), false,
  'Camera Shake is recognized as a supported scene-layer effect');
assert.equal(autoFixScene(shakeScene).scene.nodes[0].effects[0].kind, 'shake',
  'scene auto-fix preserves Camera Shake instead of silently removing it');
function shakePoint(time) {
  const canvas = Canvas.createCanvas(128, 128), ctx = canvas.getContext('2d');
  drawLayerWithEffects(ctx, [{ kind: 'shake', params: { intensity: 50, frequency: 4, randomSeed: 3, rotationAmount: 4 } }], drawCtx => {
    drawCtx.fillStyle = '#FFFFFF'; drawCtx.fillRect(48, 48, 32, 32);
  }, null, time);
  return Buffer.from(ctx.getImageData(0, 0, 128, 128).data);
}
assert.deepEqual(shakePoint(0.25), shakePoint(0.25), 'Camera Shake is deterministic at a fixed render time');
assert.notDeepEqual(shakePoint(0), shakePoint(0.25), 'Camera Shake moves and rotates isolated graphic layers over time');

function alphaPlane(withDistortion) {
  const canvas = Canvas.createCanvas(64, 64);
  drawLayerWithEffects(canvas.getContext('2d'), withDistortion ? [{ kind: 'distortion', params: { amount: 0.08, phase: 0.4 } }] : [], drawCtx => {
    drawCtx.fillStyle = '#FFFFFF'; drawCtx.fillRect(18, 16, 20, 30);
  });
  const rgba = canvas.getContext('2d').getImageData(0, 0, 64, 64).data;
  return Array.from({ length: 64 * 64 }, (_, index) => rgba[index * 4 + 3]);
}
assert.notDeepEqual(alphaPlane(false), alphaPlane(true), 'distortion moves the alpha silhouette along with its sampled color pixels');
function motionBlurAlphaPlane(withMotionBlur) {
  const canvas = Canvas.createCanvas(64, 64);
  drawLayerWithEffects(canvas.getContext('2d'), withMotionBlur ? [{ kind: 'motion-blur', params: { amount: 5, angle: 0 } }] : [], drawCtx => {
    drawCtx.fillStyle = '#FFFFFF'; drawCtx.fillRect(18, 16, 20, 30);
  });
  const rgba = canvas.getContext('2d').getImageData(0, 0, 64, 64).data;
  return Array.from({ length: 64 * 64 }, (_, index) => rgba[index * 4 + 3]);
}
assert.notDeepEqual(motionBlurAlphaPlane(false), motionBlurAlphaPlane(true), 'directional motion blur softens transparent layer edges as well as color');
function registryMotionBlurPixels(params) {
  const canvas = Canvas.createCanvas(64, 64);
  drawLayerWithEffects(canvas.getContext('2d'), [{ kind: 'blur_motion', params }], drawCtx => {
    drawCtx.fillStyle = '#FFFFFF'; drawCtx.fillRect(28, 28, 8, 8);
  });
  return Buffer.from(canvas.getContext('2d').getImageData(0, 0, 64, 64).data);
}
const motionBlurNeutral = registryMotionBlurPixels({ intensity: 0, samples: 16, angle: 0 });
const motionBlurStrong = registryMotionBlurPixels({ intensity: 1, samples: 32, angle: 0 });
const motionBlurVertical = registryMotionBlurPixels({ intensity: 1, samples: 32, angle: 90 });
assert.notDeepEqual(motionBlurStrong, motionBlurNeutral, 'registry motion blur intensity controls its pixel-space streak length');
assert.notDeepEqual(motionBlurStrong, motionBlurVertical, 'registry motion blur angle changes the streak direction');
function rgbSplitLayerPixels(params) {
  const canvas = Canvas.createCanvas(64, 64);
  drawLayerWithEffects(canvas.getContext('2d'), [{ kind: 'rgb_split', params }], drawCtx => {
    drawCtx.fillStyle = '#FF0000'; drawCtx.fillRect(8, 10, 18, 40);
    drawCtx.fillStyle = '#00FF00'; drawCtx.fillRect(26, 10, 18, 40);
    drawCtx.fillStyle = '#0000FF'; drawCtx.fillRect(44, 10, 12, 40);
  });
  return Buffer.from(canvas.getContext('2d').getImageData(0, 0, 64, 64).data);
}
const rgbSplitHorizontal = rgbSplitLayerPixels({ amount: 24, angle: 0, centerX: 0.2, centerY: 0.8 });
const rgbSplitVertical = rgbSplitLayerPixels({ amount: 24, angle: 90, centerX: 0.2, centerY: 0.8 });
assert.notDeepEqual(rgbSplitHorizontal, rgbSplitVertical, 'software RGB split honors angle and off-center origin');

const maskedCanvas = Canvas.createCanvas(100, 100);
const maskedCtx = maskedCanvas.getContext('2d');
drawLayerWithEffects(maskedCtx, [], drawCtx => {
  drawCtx.fillStyle = '#FFFFFF';
  drawCtx.fillRect(0, 0, 100, 100);
}, { kind: 'shape', shape: 'ellipse', x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
const alphaAt = (x, y) => maskedCtx.getImageData(x, y, 1, 1).data[3];
assert.equal(alphaAt(25, 40), 255, 'offset ellipse mask reveals its configured center');
assert.equal(alphaAt(50, 50), 0, 'offset ellipse mask clips outside the configured bounds');

function maskedAlpha(mask, x, y) {
  const canvas = Canvas.createCanvas(100, 100);
  const ctx = canvas.getContext('2d');
  drawLayerWithEffects(ctx, [], drawCtx => {
    drawCtx.fillStyle = '#FFFFFF'; drawCtx.fillRect(0, 0, 100, 100);
  }, mask);
  return ctx.getImageData(x, y, 1, 1).data[3];
}
for (const shape of ['polygon', 'star', 'arrow', 'capsule']) {
  assert.equal(maskedAlpha({ kind: 'shape', shape, x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 50, 50), 255,
    `${shape} masks reveal their center in the shared canvas renderer`);
  assert.equal(maskedAlpha({ kind: 'shape', shape, x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 5, 5), 0,
    `${shape} masks clip outside their configured bounds`);
}
assert.ok(maskedAlpha({ kind: 'shape', shape: 'capsule', x: 0.1, y: 0.1, w: 0.8, h: 0.8, feather: 0.04 }, 12, 12) < 255,
  'capsule masks keep their rounded end geometry when feathering is enabled');
assert.equal(maskedAlpha({ kind: 'shape', shape: 'polygon', sides: 4, invert: true }, 50, 50), 0,
  'inverted polygon masks preserve the exterior and remove the interior');
assert.equal(maskedAlpha({ kind: 'shape', shape: 'rectangle', x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 20, 50), 0,
  'unfeathered canvas masks keep their authored hard edge');
const featheredEdge = maskedAlpha({ kind: 'shape', shape: 'rectangle', x: 0.25, y: 0.25, w: 0.5, h: 0.5, feather: 0.1 }, 20, 50);
assert.ok(featheredEdge > 0 && featheredEdge < 255,
  'canvas mask feather creates a soft alpha edge outside the authored shape');
assert.ok(maskedAlpha({ kind: 'shape', shape: 'rectangle', x: 0.25, y: 0.25, w: 0.5, h: 0.5, feather: 0.1 }, 50, 50) >= 250,
  'feathering preserves an almost fully opaque mask interior');

const partialMaskCanvas = Canvas.createCanvas(100, 100);
const partialMaskCtx = partialMaskCanvas.getContext('2d');
drawLayerWithEffects(partialMaskCtx, [], drawCtx => {
  drawCtx.fillStyle = '#FFFFFF'; drawCtx.fillRect(0, 0, 100, 100);
}, { kind: 'shape', shape: 'rectangle', inset: 0.1, x: null, y: null, w: null, h: null });
assert.equal(partialMaskCtx.getImageData(50, 50, 1, 1).data[3], 255, 'null optional mask bounds use the default inset rectangle');
assert.equal(partialMaskCtx.getImageData(5, 50, 1, 1).data[3], 0, 'null optional mask bounds do not collapse the mask to a zero-width rectangle');

const insetCanvas = Canvas.createCanvas(100, 100);
const insetCtx = insetCanvas.getContext('2d');
drawLayerWithEffects(insetCtx, [], drawCtx => {
  drawCtx.fillStyle = '#FFFFFF';
  drawCtx.fillRect(0, 0, 100, 100);
}, { kind: 'shape', shape: 'rectangle', inset: 0.1 });
assert.equal(insetCtx.getImageData(50, 50, 1, 1).data[3], 255, 'default inset rectangle fills its center');
assert.equal(insetCtx.getImageData(5, 50, 1, 1).data[3], 0, 'default inset is symmetric on both horizontal sides');

const strokeCanvas = Canvas.createCanvas(40, 40);
drawLayerWithEffects(strokeCanvas.getContext('2d'), [{ kind: 'stroke', params: { width: 3, color: '#FF0000' } }], drawCtx => {
  drawCtx.fillStyle = '#FFFFFF'; drawCtx.fillRect(12, 12, 16, 16);
});
const strokeOutside = strokeCanvas.getContext('2d').getImageData(10, 20, 1, 1).data;
assert.ok(strokeOutside[0] > 240 && strokeOutside[1] < 10 && strokeOutside[3] > 0, 'stroke expands the layer alpha and paints its configured color outside the shape');
assert.equal(strokeCanvas.getContext('2d').getImageData(5, 20, 1, 1).data[3], 0, 'stroke remains limited to the requested width');

const gradientCanvas = Canvas.createCanvas(40, 20);
drawLayerWithEffects(gradientCanvas.getContext('2d'), [{ kind: 'gradient-fill', params: { colors: ['#FF0000', '#0000FF'], angle: 0 } }], drawCtx => {
  drawCtx.fillStyle = '#FFFFFF'; drawCtx.fillRect(5, 5, 30, 10);
});
const gradientCtx = gradientCanvas.getContext('2d');
const gradientLeft = gradientCtx.getImageData(7, 10, 1, 1).data, gradientRight = gradientCtx.getImageData(32, 10, 1, 1).data;
assert.ok(gradientLeft[0] > gradientLeft[2] && gradientRight[2] > gradientRight[0], 'gradient fill follows the configured color stops and angle');
assert.equal(gradientCtx.getImageData(2, 10, 1, 1).data[3], 0, 'gradient fill preserves transparent pixels');

const innerShadowCanvas = Canvas.createCanvas(40, 40);
drawLayerWithEffects(innerShadowCanvas.getContext('2d'), [{ kind: 'inner-shadow', params: { x: 3, opacity: 1, color: '#000000' } }], drawCtx => {
  drawCtx.fillStyle = '#FFFFFF'; drawCtx.fillRect(12, 12, 16, 16);
});
const innerShadowCtx = innerShadowCanvas.getContext('2d');
assert.ok(innerShadowCtx.getImageData(12, 20, 1, 1).data[0] < innerShadowCtx.getImageData(20, 20, 1, 1).data[0], 'inner shadow darkens the configured edge while preserving layer alpha');
assert.equal(innerShadowCtx.getImageData(12, 20, 1, 1).data[3], 255, 'inner shadow preserves the original shape alpha');

function renderOrderedEffects(stack) {
  const canvas = Canvas.createCanvas(48, 48);
  drawLayerWithEffects(canvas.getContext('2d'), stack, drawCtx => {
    drawCtx.fillStyle = '#FFFFFF'; drawCtx.fillRect(16, 16, 16, 16);
  });
  return canvas.getContext('2d').getImageData(0, 0, 48, 48).data;
}
const strokeThenBlur = renderOrderedEffects([
  { kind: 'stroke', params: { width: 3, color: '#FF0000' } },
  { kind: 'blur', params: { radius: 2 } },
]);
const blurThenStroke = renderOrderedEffects([
  { kind: 'blur', params: { radius: 2 } },
  { kind: 'stroke', params: { width: 3, color: '#FF0000' } },
]);
assert.notDeepEqual(strokeThenBlur, blurThenStroke, 'effects run in declared stack order instead of fixed implementation order');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibed-layer-effects-'));
try {
  const exported = await renderVectorFrames({ kind: 'circle', w: 120, h: 120, fill: '#FF355E' }, {
    durationSec: 0.5, fps: 2, widthPx: 120, tmpDir, canvasModule: Canvas, effects,
  });
  const plain = await renderVectorFrames({ kind: 'circle', w: 120, h: 120, fill: '#FF355E' }, {
    durationSec: 0.5, fps: 2, widthPx: 120, tmpDir, name: 'plain', canvasModule: Canvas,
  });
  assert.notDeepEqual(fs.readFileSync(exported.files[0]), fs.readFileSync(plain.files[0]), 'server export applies the same effect stack');
  const animatedGrain = await renderVectorFrames({ kind: 'circle', w: 120, h: 120, fill: '#FF355E' }, {
    durationSec: 1, fps: 2, widthPx: 120, tmpDir, name: 'animated-grain', canvasModule: Canvas,
    effects: [{ kind: 'grain', params: { amount: 28, seed: 17 } }],
  });
  assert.equal(animatedGrain.files.length, 2);
  assert.notDeepEqual(fs.readFileSync(animatedGrain.files[0]), fs.readFileSync(animatedGrain.files[1]), 'exported grain changes between frames');
  const animatedExpression = await renderVectorFrames({ kind: 'circle', w: 120, h: 120, fill: '#FF355E' }, {
    durationSec: 1, fps: 2, widthPx: 120, tmpDir, name: 'animated-effect-expression', canvasModule: Canvas,
    effects: [{ kind: 'brightness', params: { amount: { value: 0, expression: 'progress' } } }],
  });
  assert.notDeepEqual(fs.readFileSync(animatedExpression.files[0]), fs.readFileSync(animatedExpression.files[1]),
    'vector export evaluates clip-duration progress expressions over its frame sequence');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
console.log('Layer effects passed: scene effects survive compilation and shared canvas rendering applies filters, masks, gradient fill, stroke and inner shadow.');
