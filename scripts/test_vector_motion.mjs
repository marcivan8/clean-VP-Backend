import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Canvas from '@napi-rs/canvas';
import { createNode, createScene, flattenScene, NODE_TYPES } from '../client/src/motion/SceneSchema.js';
import { drawVectorFrame, drawVectorGraphic, estimateSvgPathLength, interpolateSvgPaths, parseSvgPath, validateSvgPathData, MAX_VECTOR_PATH_CHARS, vectorMatteDataUrl } from '../client/src/motion/VectorGraphics.js';
import { renderVectorFrames } from '../server/compositor/TemplateRenderer.js';
import { validateScene, ISSUE_CODES } from '../client/src/motion/SceneValidator.js';
const vectorPreviewSource = fs.readFileSync(new URL('../client/src/components/Player/TemplateCanvas.jsx', import.meta.url), 'utf8');
assert.match(vectorPreviewSource, /drawTemporalMotionBlur\([\s\S]*sampleCtx\.scale\(W \/ size\.w, H \/ size\.h\)[\s\S]*drawVectorFrame\(sampleCtx, \{ \.\.\.clip\.vector, w: size\.w, h: size\.h/,
  'vector preview scales authored path coordinates in the same logical space as export');

const vector = {
  kind: 'path', w: 400, h: 220,
  pathData: 'M 35 110 C 100 10 300 10 365 110',
  fill: 'none', stroke: '#2785FF', strokeWidth: 14,
  motion: { preset: 'draw', duration: 0.8, easing: 'easeOutCubic' },
};
const scene = createScene({ duration: 2, nodes: [createNode(NODE_TYPES.SHAPE, { duration: 2, vector })] });
const [placement] = flattenScene(scene).placements;
assert.equal(placement.clip.vector.motion.preset, 'draw', 'vector motion survives scene compilation');

const morphMidpoint = interpolateSvgPaths('M 0 0 C 0 10 10 10 10 0', 'M 2 4 C 2 14 12 14 12 4', 0.5);
assert.deepEqual(morphMidpoint, [
  { type: 'M', args: [1, 2] },
  { type: 'C', args: [1, 12, 11, 12, 11, 2] },
], 'matching path topologies interpolate every coordinate');
assert.deepEqual(validateSvgPathData('M0 0h10v10z'), { valid: true, commands: 4 },
  'compact SVG path syntax with implicit repeated commands validates');
assert.equal(validateSvgPathData('M0 0 A10 10 0 2 0 20 20').reason, 'invalid_arc_flag',
  'arc flags outside the SVG 0/1 contract are rejected');
assert.equal(validateSvgPathData('M0 0 L10').reason, 'incomplete_command',
  'truncated coordinate groups are rejected');
assert.equal(validateSvgPathData(`M0 0${'L1 1'.repeat(20_001)}`).reason, 'too_complex',
  'paths above the renderer command budget are rejected before drawing');
assert.equal(validateSvgPathData(`M0 0 ${' '.repeat(MAX_VECTOR_PATH_CHARS)}`).reason, 'too_large',
  'path strings above the input budget are rejected before tokenization');
assert.equal(validateSvgPathData('M0 0 L10').valid, false,
  'malformed SVG remains invalid for scene validation and rendering');
assert.deepEqual(parseSvgPath('M0 0 L10'), [{ type: 'M', args: [0, 0] }],
  'the recovery parser retains valid geometry for repair or inspection');
const normalizedMorph = interpolateSvgPaths('M 0 0 L 10 0 L 10 10 Z', 'M 0 0 C 0 10 10 10 10 0 Z', 0.5);
assert.ok(normalizedMorph?.length > 4 && normalizedMorph.at(-1).type === 'Z',
  'different line and Bézier command layouts morph through sampled matching contours');
const starMatte = vectorMatteDataUrl({ kind: 'star', w: 100, h: 100, points: 5, outerRadius: 48, innerRadius: 18, rotation: 12 });
assert.ok(starMatte?.startsWith('data:image/svg+xml,'), 'star vector mattes serialize to a browser-safe SVG alpha source');
const decodedStarMatte = decodeURIComponent(starMatte.split(',')[1]);
assert.match(decodedStarMatte, /<polygon points=/, 'star vector mattes contain a filled contour usable by preview masks');
assert.notEqual(decodedStarMatte, decodeURIComponent(vectorMatteDataUrl({ kind: 'star', w: 100, h: 100, points: 5, outerRadius: 48, innerRadius: 18 }).split(',')[1]),
  'vector matte rotation changes the generated silhouette');
const arrowMatte = decodeURIComponent(vectorMatteDataUrl({ kind: 'arrow', w: 100, h: 100, rotation: 24 }).split(',')[1]);
assert.match(arrowMatte, /<path[^>]*transform="rotate\(24 50 50\)"/, 'arrow vector mattes preserve rotation in the preview silhouette');
const featheredEllipse = decodeURIComponent(vectorMatteDataUrl({
  kind: 'ellipse', w: 100, h: 100, maskBounds: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 }, feather: 8,
}).split(',')[1]);
assert.match(featheredEllipse, /<ellipse cx="50" cy="50" rx="30" ry="40"/, 'feathered shape mask geometry respects its authored bounds');
assert.match(featheredEllipse, /<feGaussianBlur stdDeviation="8"\/>/, 'shape matte feather is rendered into its alpha source');
const fullRectMatte = decodeURIComponent(vectorMatteDataUrl({ kind: 'rect', w: 100, h: 100 }).split(',')[1]);
assert.match(fullRectMatte, /<rect x="0" y="0" width="100" height="100"/, 'ordinary vector mattes retain full-canvas defaults');
for (const shape of ['capsule', 'polygon', 'star', 'arrow']) {
  const maskedScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
    duration: 1, vector: { kind: 'rect', w: 100, h: 100, fill: '#fff' },
    mask: { kind: 'shape', shape, sides: 5, points: 5 },
  })] });
  assert.ok(!validateScene(maskedScene).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_MASK),
    `${shape} masks pass the scene validator before preview and export`);
}
const outOfRangeFeatherScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.VIDEO, {
  duration: 1, source: { url: 'matte-target.mp4' }, mask: { kind: 'shape', shape: 'ellipse', feather: 0.5 },
})] });
assert.ok(validateScene(outOfRangeFeatherScene).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_MASK),
  'scene validation warns when mask feather exceeds the preview and export contract');
function morphFrame(time) {
  const canvas = Canvas.createCanvas(32, 32);
  drawVectorFrame(canvas.getContext('2d'), {
    kind: 'path', x: 0, y: 0, w: 32, h: 32, pathData: 'M 2 2 L 30 2 L 30 30 Z', fill: '#FFFFFF',
    motion: { pathFrom: 'M 2 2 L 30 2 L 30 30 Z', pathTo: 'M 2 2 C 2 30 30 30 30 2 Z', morphDuration: 1, easing: 'linear' },
  }, time, 1);
  return canvas.toBuffer('image/png');
}
assert.notDeepEqual(morphFrame(0), morphFrame(0.5), 'normalized contour morphs are visible in rendered preview frames');
const compoundPathCanvas = Canvas.createCanvas(100, 100);
drawVectorGraphic(compoundPathCanvas.getContext('2d'), {
  kind: 'path', x: 0, y: 0, w: 100, h: 100,
  pathData: 'M 5 5 H 95 V 95 H 5 Z M 30 30 H 70 V 70 H 30 Z',
  fill: '#FFFFFF', fillRule: 'evenodd',
});
const compoundPixels = compoundPathCanvas.getContext('2d').getImageData(0, 0, 100, 100).data;
assert.equal(compoundPixels[(50 * 100 + 50) * 4 + 3], 0,
  'even-odd compound vector paths preserve transparent holes in Canvas preview/export');
assert.equal(compoundPixels[(15 * 100 + 15) * 4 + 3], 255,
  'even-odd compound vector paths still render their filled outer contour');
assert.equal(interpolateSvgPaths('M 0 0 L 10 0 Z', 'M 0 0 L 10 0', 0.5), null,
  'open and closed paths are rejected instead of morphing into invalid topology');
const compatibleMorphScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
  duration: 1, vector: { kind: 'path', pathData: 'M 0 0 L 10 0 Z', motion: { pathFrom: 'M 0 0 L 10 0 Z', pathTo: 'M 0 0 C 2 8 8 8 10 0 Z' } },
})] });
assert.ok(!validateScene(compatibleMorphScene, { skipCollisions: true }).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_VECTOR_MORPH),
  'compatible vector morphs pass scene validation');
const incompatibleMorphScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
  duration: 1, vector: { kind: 'path', pathData: 'M 0 0 L 10 0 Z', motion: { pathFrom: 'M 0 0 L 10 0 Z', pathTo: 'M 0 0 L 10 0 Z M 20 20 L 30 20 Z' } },
})] });
assert.ok(validateScene(incompatibleMorphScene, { skipCollisions: true }).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_VECTOR_MORPH),
  'incompatible contour counts produce a clear warning instead of a silently skipped morph');
assert.equal(interpolateSvgPaths([{ type: 'M', args: [0, NaN] }], [{ type: 'M', args: [0, 1] }], 0.5), null,
  'non-finite path coordinates are rejected');
const malformedPathScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
  duration: 1, vector: { kind: 'path', w: 100, h: 100, pathData: 'M0 0 A10 10 0 2 0 20 20', stroke: '#FFF' },
})] });
assert.ok(validateScene(malformedPathScene, { skipCollisions: true }).issues.some(issue => issue.code === ISSUE_CODES.INVALID_VECTOR_PATH),
  'scene validation reports malformed vector path data before export');
const arcMorph = interpolateSvgPaths('M 0 0 A 10 10 0 0 0 10 10', 'M 0 0 A 20 20 0 1 0 10 10', 0.5);
assert.ok(arcMorph?.length > 2 && arcMorph.every(command => command.type !== 'A'),
  'arc flag changes are converted to sampled contours rather than interpolated as fractional flags');

function frame(time) {
  const canvas = Canvas.createCanvas(vector.w, vector.h);
  drawVectorFrame(canvas.getContext('2d'), vector, time, 2);
  return canvas.toBuffer('image/png');
}
assert.notDeepEqual(frame(0.05), frame(1), 'the vector stroke reveal changes over time');
assert.ok(Math.abs(estimateSvgPathLength('M 0 0 L 100 0') - 100) < 0.001, 'SVG line length is measured from its actual geometry');
assert.ok(estimateSvgPathLength('M 0 0 C 0 100 100 100 100 0') > 190, 'cubic Bézier paths use sampled curve length');
assert.ok(Math.abs(estimateSvgPathLength('M 0 0 L 100 0 L 100 100 Z') - (200 + Math.sqrt(20000))) < 0.01, 'closed path length includes its closing segment');
assert.ok(Math.abs(estimateSvgPathLength('M 10 0 A 10 10 0 0 1 0 10') - (Math.PI * 5)) < 0.1, 'elliptical arc length follows its sweep angle');

function alphaForEasing(easing) {
  const canvas = Canvas.createCanvas(24, 24);
  drawVectorFrame(canvas.getContext('2d'), {
    kind: 'rect', x: 0, y: 0, w: 24, h: 24, fill: '#FFFFFF',
    motion: { preset: 'fade', duration: 1, easing },
  }, 0.25, 1);
  return canvas.getContext('2d').getImageData(12, 12, 1, 1).data[3];
}
assert.ok(Math.abs(alphaForEasing('easeInOutSine') - Math.round(255 * (1 - Math.cos(Math.PI * 0.25)) / 2)) <= 1,
  'vector motion must honor the canonical easing curve instead of forcing easeOutCubic');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibed-vector-motion-'));
try {
  const result = await renderVectorFrames(vector, { durationSec: 1, fps: 4, widthPx: vector.w, tmpDir, name: 'draw-on', canvasModule: Canvas });
  assert.equal(result.frames, 4);
  assert.ok(result.files.every(file => fs.statSync(file).size > 100));
  assert.notDeepEqual(fs.readFileSync(result.files[0]), fs.readFileSync(result.files[3]), 'export frames use the same animated vector renderer');
  const scaledPath = await renderVectorFrames({
    kind: 'path', w: 96, h: 96, pathData: 'M 10 10 L 86 10 L 86 86 L 10 86 Z',
    fill: '#FFFFFF', stroke: 'none',
  }, { durationSec: 0.2, fps: 1, widthPx: 192, tmpDir, name: 'scaled-path', canvasModule: Canvas });
  const scaledImage = await Canvas.loadImage(fs.readFileSync(scaledPath.files[0]));
  const scaledCanvas = Canvas.createCanvas(scaledImage.width, scaledImage.height);
  const scaledContext = scaledCanvas.getContext('2d');
  scaledContext.drawImage(scaledImage, 0, 0);
  const scaledData = scaledContext.getImageData(0, 0, scaledImage.width, scaledImage.height).data;
  let scaledMaxX = -1;
  for (let y = 0; y < scaledImage.height; y++) {
    for (let x = 0; x < scaledImage.width; x++) {
      if (scaledData[(y * scaledImage.width + x) * 4 + 3] > 0) scaledMaxX = Math.max(scaledMaxX, x);
    }
  }
  assert.equal(scaledImage.width, 192);
  assert.ok(scaledMaxX >= 171, 'SVG path geometry scales with high-resolution export dimensions');
  const morphVector = {
    kind: 'path', w: 96, h: 96, x: 0, y: 0,
    pathData: 'M 10 10 L 86 10 L 86 86 L 10 86 Z',
    fill: '#FFFFFF', stroke: 'none',
    motion: {
      pathFrom: 'M 10 10 L 86 10 L 86 86 L 10 86 Z',
      pathTo: 'M 48 8 C 96 24 72 96 48 86 C 24 96 0 24 48 8 Z',
      morphDuration: 1, easing: 'linear',
    },
  };
  const morphExport = await renderVectorFrames(morphVector, {
    durationSec: 1, fps: 2, widthPx: 96, tmpDir, name: 'path-morph-export', canvasModule: Canvas,
  });
  const morphPixels = await Promise.all(morphExport.files.map(async file => {
    const image = await Canvas.loadImage(fs.readFileSync(file));
    const canvas = Canvas.createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  }));
  assert.notDeepEqual(morphPixels[0], morphPixels[1], 'exported SVG path morph changes actual frame pixels');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
console.log('Vector motion passed: draw-on animation survives scene compilation and renders consistently for preview/export.');
