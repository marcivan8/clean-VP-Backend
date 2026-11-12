import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Canvas from '@napi-rs/canvas';
import { createNode, createScene, flattenScene, nodeFromClip, NODE_TYPES } from '../client/src/motion/SceneSchema.js';
import { drawMaskedGradient, drawTemporalMotionBlur, relativeMotionTransform } from '../client/src/motion/TemporalMotionBlur.js';
import { MAX_MOTION_BLUR_SAMPLES } from '../client/src/motion/MotionLimits.js';
import { buildCompositionPlan } from '../client/src/motion/Compositor.js';
import { renderVectorFrames } from '../server/compositor/TemplateRenderer.js';

const settings = { enabled: true, samples: 9, shutterAngle: 360, frameRate: 1 };
function frame(blur) {
  const canvas = Canvas.createCanvas(96, 32);
  const ctx = canvas.getContext('2d');
  const paint = (drawCtx, time) => {
    drawCtx.fillStyle = '#FFFFFF';
    drawCtx.fillRect(18 + time * 40, 12, 4, 8);
  };
  if (blur) drawTemporalMotionBlur(ctx, settings, 0.5, 1, paint);
  else paint(ctx, 0.5);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}
const sharp = frame(false);
const blurred = frame(true);
assert.notDeepEqual(blurred, sharp, 'temporal sampling changes rendered pixels for a moving graphic');
const alphaAt = (pixels, x, y) => pixels[(y * 96 + x) * 4 + 3];
assert.equal(alphaAt(sharp, 39, 15), 255, 'the sharp sample keeps the graphic at its current position');
assert.ok(alphaAt(blurred, 20, 15) > 0 && alphaAt(blurred, 54, 15) > 0,
  'shutter samples leave visible coverage before and after the current graphic position');
assert.ok(alphaAt(blurred, 20, 15) <= Math.ceil(255 / settings.samples),
  'each shutter sample contributes only one equal-exposure slice');
const staticCanvas = Canvas.createCanvas(16, 16);
const staticCtx = staticCanvas.getContext('2d');
drawTemporalMotionBlur(staticCtx, settings, 0.5, 1, drawCtx => {
  drawCtx.fillStyle = '#FFFFFF';
  drawCtx.fillRect(4, 4, 8, 8);
});
assert.ok(staticCtx.getImageData(8, 8, 1, 1).data[3] >= 250,
  'equal-exposure accumulation preserves near-full opacity for a stationary graphic');
assert.deepEqual(frame(false), sharp, 'disabled temporal blur leaves direct rendering unchanged');
let cappedSampleCount = 0;
drawTemporalMotionBlur(staticCtx, { enabled: true, samples: MAX_MOTION_BLUR_SAMPLES * 4,
  shutterAngle: 360, frameRate: 30 }, 0.5, 1, () => { cappedSampleCount++; });
assert.equal(cappedSampleCount, MAX_MOTION_BLUR_SAMPLES,
  'preview temporal blur uses the shared render limit when oversized settings are loaded');

const rendererCaps = [
  ['client spatial blur', '../client/src/motion/SpatialMotion.js', /Math\.min\((\d+), num\(options\.samples, 5\)\)/],
  ['Revideo spatial blur', '../render-worker/revideo/src/motion/SpatialMotion.js', /Math\.min\((\d+), num\(options\.samples, 5\)\)/],
  ['FFmpeg compositor blur', '../server/compositor/CompositorCompiler.js', /Math\.min\((\d+), Math\.round\(Number\(overlay\.motionBlur\.samples\)/],
];
for (const [renderer, file, pattern] of rendererCaps) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const cap = Number(source.match(pattern)?.[1]);
  assert.equal(cap, MAX_MOTION_BLUR_SAMPLES,
    `${renderer} sample cap stays aligned with the shared preview and 3D renderer limit`);
}

const transformCanvas = Canvas.createCanvas(96, 32);
const transformCtx = transformCanvas.getContext('2d');
drawTemporalMotionBlur(transformCtx, settings, 0.5, 1, drawCtx => {
  drawCtx.fillStyle = '#FFFFFF';
  drawCtx.fillRect(44, 12, 8, 8);
}, sampleTime => ({ x: (sampleTime - 0.5) * 40, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));
const transformPixels = transformCtx.getImageData(0, 0, 96, 32).data;
assert.ok(alphaAt(transformPixels, 30, 15) > 0 && alphaAt(transformPixels, 65, 15) > 0,
  'preview shutter sampling applies animated layer position to otherwise static graphic content');
const relative = relativeMotionTransform(
  { x: 50, y: 50, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 },
  { x: 55, y: 50, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 },
  16 / 9, 100,
);
assert.equal(relative.x, 20, 'layer position delta is converted into canvas-local pixels at the default quarter-frame overlay scale');
const collapsedSample = relativeMotionTransform(
  { x: 50, y: 50, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 },
  { x: 50, y: 50, scale: 1, scaleX: 0, scaleY: 0, rotation: 0 },
  16 / 9, 100,
);
assert.equal(collapsedSample.a, 0, 'a sampled zero scale remains collapsed instead of defaulting to full scale');
assert.equal(collapsedSample.d, 0, 'zero scale is preserved on both transform axes');
assert.equal(relativeMotionTransform(
  { x: 50, y: 50, scale: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  { x: 55, y: 50, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 },
  16 / 9, 100,
), null, 'a collapsed playhead transform does not generate a non-finite inverse matrix');

const opacityCanvas = Canvas.createCanvas(16, 16);
const opacityCtx = opacityCanvas.getContext('2d');
drawTemporalMotionBlur(opacityCtx, { enabled: true, samples: 5, shutterAngle: 0, frameRate: 30 }, 0.5, 1, drawCtx => {
  drawCtx.fillStyle = '#FFFFFF';
  drawCtx.fillRect(4, 4, 8, 8);
}, () => ({ x: 0, y: 0, a: 1, b: 0, c: 0, d: 1, opacity: 0.4 }));
assert.ok(Math.abs(opacityCtx.getImageData(8, 8, 1, 1).data[3] - 102) <= 1,
  'a zero shutter still draws the current frame with its resolved layer opacity');

const gradientMask = Canvas.createCanvas(16, 8);
const maskCtx = gradientMask.getContext('2d');
maskCtx.fillStyle = '#FFFFFF';
maskCtx.fillRect(0, 0, 8, 8);
const gradientCanvas = Canvas.createCanvas(16, 8);
const gradientCtx = gradientCanvas.getContext('2d');
drawMaskedGradient(gradientCtx, gradientMask, { params: { angle: 0, colors: ['#FF0000', '#0000FF'] } }, 16, 8);
const leftGradientPixel = gradientCtx.getImageData(1, 4, 1, 1).data;
assert.ok(leftGradientPixel[0] > leftGradientPixel[2], 'the gradient begins with its authored first color');
assert.equal(gradientCtx.getImageData(13, 4, 1, 1).data[3], 0, 'gradient fill remains clipped to the media alpha silhouette');

const motionBlur = { enabled: true, samples: 7, shutterAngle: 240, frameRate: 30 };
const scene = createScene({ duration: 2, nodes: [createNode(NODE_TYPES.TEXT, {
  id: 'temporal-title', content: 'Shutter sampled title', duration: 2, motionBlur,
})] });
const flattened = flattenScene(scene);
assert.equal(flattened.placements[0].trackType, 'overlay', 'temporal blur routes editable text through the graphic renderer');
assert.deepEqual(flattened.placements[0].clip.motionBlur, motionBlur, 'scene flattening preserves temporal blur controls');
assert.deepEqual(nodeFromClip(flattened.placements[0].clip).motionBlur, motionBlur,
  'lifting an edited timeline clip back into a scene preserves temporal blur controls');
const plan = buildCompositionPlan([
  { id: 'base', type: 'video', order: 0, clips: [{ id: 'base-clip', type: 'video', start: 0, duration: 2, url: 'base.mp4' }] },
  { id: 'graphics', type: 'video', order: 1, clips: [flattened.placements[0].clip] },
], { width: 96, height: 32, fps: 30 });
assert.deepEqual(plan.overlays[0].motionBlur, motionBlur, 'the client composition plan carries shutter settings to the export worker');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibed-temporal-blur-'));
try {
  const vector = {
    kind: 'rect', x: 10, y: 10, w: 36, h: 24, fill: '#FFFFFF', stroke: 'none',
    motion: { preset: 'rise', duration: 2, easing: 'linear' },
  };
  const [sharpExport, blurredExport] = await Promise.all([
    renderVectorFrames(vector, { durationSec: 2, fps: 2, widthPx: 96, tmpDir, name: 'sharp', canvasModule: Canvas }),
    renderVectorFrames(vector, { durationSec: 2, fps: 2, widthPx: 96, tmpDir, name: 'blurred', canvasModule: Canvas,
      motionBlur: { enabled: true, samples: 7, shutterAngle: 360, frameRate: 2 } }),
  ]);
  const readPixels = async file => {
    const image = await Canvas.loadImage(fs.readFileSync(file));
    const output = Canvas.createCanvas(image.width, image.height);
    const context = output.getContext('2d');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  };
  const [sharpPixels, blurPixels] = await Promise.all([
    readPixels(sharpExport.files[1]), readPixels(blurredExport.files[1]),
  ]);
  assert.notDeepEqual(blurPixels, sharpPixels, 'exported vector frames include temporal shutter sampling');
  const exportAlphaAt = (pixels, x, y) => pixels[(y * 96 + x) * 4 + 3];
  assert.ok(exportAlphaAt(blurPixels, 15, 9) > exportAlphaAt(sharpPixels, 15, 9),
    'the exported blur exposes coverage just outside the sharp graphic bounds');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('Temporal motion blur passed: scene controls survive flattening and planning, and preview/export render shutter samples.');
