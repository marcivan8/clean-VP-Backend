import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Canvas from '@napi-rs/canvas';
import { createNode, createScene, flattenScene, NODE_TYPES } from '../client/src/motion/SceneSchema.js';
import { drawVectorFrame, drawVectorGraphic, drawSvgPath, estimateSvgPathLength, interpolateSvgPaths, parseSvgPath, validateSvgPathData, MAX_VECTOR_PATH_CHARS, vectorMatteDataUrl } from '../client/src/motion/VectorGraphics.js';
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
const arcFallbackLines = [];
drawSvgPath({
  beginPath() {}, moveTo() {}, lineTo(x, y) { arcFallbackLines.push([x, y]); }, closePath() {},
}, 'M 0 0 A 10 10 0 0 1 10 10');
assert.ok(arcFallbackLines.length > 2, 'SVG arcs stay curved when the Canvas runtime has no ellipse() method');
assert.ok(Math.abs(arcFallbackLines.at(-1)[0] - 10) < 1e-6 && Math.abs(arcFallbackLines.at(-1)[1] - 10) < 1e-6,
  'the sampled arc fallback lands exactly on the authored endpoint');
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
const calloutMatte = decodeURIComponent(vectorMatteDataUrl({ kind: 'callout', w: 100, h: 80, tailSize: 16, tailPosition: 0.7 }).split(',')[1]);
assert.match(calloutMatte, /<path d="M 7\.68 0 H 92\.32/, 'callout mask produces a rounded speech bubble body');
assert.match(calloutMatte, /L 70 80 L 61\.2 64/, 'callout matte includes an authored adjustable tail');
for (const shape of ['capsule', 'callout', 'polygon', 'star', 'arrow']) {
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
function morphFrame(time, morphStartTime = 0) {
  const canvas = Canvas.createCanvas(32, 32);
  drawVectorFrame(canvas.getContext('2d'), {
    kind: 'path', x: 0, y: 0, w: 32, h: 32, pathData: 'M 2 2 L 30 2 L 30 30 Z', fill: '#FFFFFF',
    motion: { pathFrom: 'M 2 2 L 30 2 L 30 30 Z', pathTo: 'M 2 2 C 2 30 30 30 30 2 Z', morphStartTime, morphDuration: 0.5, easing: 'linear' },
  }, time, 1);
  return canvas.toBuffer('image/png');
}
assert.notDeepEqual(morphFrame(0), morphFrame(0.5), 'normalized contour morphs are visible in rendered preview frames');
assert.deepEqual(morphFrame(0.2, 0.25), morphFrame(0), 'delayed path morph holds the source shape until its authored start time');
assert.notDeepEqual(morphFrame(0.5, 0.25), morphFrame(0.2, 0.25), 'delayed path morph animates after its authored start time');
function openClosedMorphPixels(time) {
  const canvas = Canvas.createCanvas(32, 32);
  drawVectorFrame(canvas.getContext('2d'), {
    kind: 'path', x: 0, y: 0, w: 32, h: 32, pathData: 'M 3 3 L 29 3 L 16 29 Z', fill: '#FFFFFF', stroke: '#000000', strokeWidth: 2,
    motion: { pathFrom: 'M 3 3 L 29 3 L 16 29 Z', pathTo: 'M 3 3 L 29 3 L 16 29', morphDuration: 1, easing: 'linear' },
  }, time, 1);
  return canvas.getContext('2d').getImageData(0, 0, 32, 32).data;
}
const openClosedStart = openClosedMorphPixels(0);
const openClosedMiddle = openClosedMorphPixels(0.5);
const openClosedEnd = openClosedMorphPixels(1);
assert.notDeepEqual(openClosedMiddle, openClosedStart, 'open/closed transition changes actual preview pixels during the morph');
assert.notDeepEqual(openClosedEnd, openClosedMiddle, 'open/closed transition reaches a distinct destination frame');
function reorderedContourMorphPixels(time) {
  const canvas = Canvas.createCanvas(100, 100);
  drawVectorFrame(canvas.getContext('2d'), {
    kind: 'path', x: 0, y: 0, w: 100, h: 100, fill: '#FFFFFF',
    pathData: 'M 10 10 H 30 V 30 H 10 Z M 70 70 H 90 V 90 H 70 Z',
    motion: {
      pathFrom: 'M 10 10 H 30 V 30 H 10 Z M 70 70 H 90 V 90 H 70 Z',
      pathTo: 'M 70 70 L 90 70 L 90 90 L 70 90 Z M 10 10 L 30 10 L 30 30 L 10 30 Z',
      morphDuration: 1, easing: 'linear',
    },
  }, time, 1);
  return canvas.getContext('2d').getImageData(0, 0, 100, 100).data;
}
assert.deepEqual(reorderedContourMorphPixels(0.5), reorderedContourMorphPixels(1),
  'reordering equivalent contours does not make shapes cross-morph through the composition center');
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
const ellipseCanvas = Canvas.createCanvas(100, 60);
drawVectorGraphic(ellipseCanvas.getContext('2d'), { kind: 'ellipse', x: 10, y: 10, w: 80, h: 40, fill: '#FFFFFF' });
const ellipsePixels = ellipseCanvas.getContext('2d').getImageData(0, 0, 100, 60).data;
assert.equal(ellipsePixels[(10 * 100 + 10) * 4 + 3], 0, 'ellipse graphics keep transparent bounding-box corners');
assert.equal(ellipsePixels[(30 * 100 + 50) * 4 + 3], 255, 'ellipse graphics fill their center');
const calloutCanvas = Canvas.createCanvas(100, 80);
drawVectorGraphic(calloutCanvas.getContext('2d'), { kind: 'callout', x: 0, y: 0, w: 100, h: 80, fill: '#FFFFFF', tailSize: 16, tailPosition: 0.7 });
const calloutPixels = calloutCanvas.getContext('2d').getImageData(0, 0, 100, 80).data;
assert.equal(calloutPixels[(70 * 100 + 70) * 4 + 3], 255, 'callout renderer fills the speech tail');
assert.equal(calloutPixels[(79 * 100 + 20) * 4 + 3], 0, 'callout renderer leaves pixels outside the speech tail transparent');
const ellipseFallbackCanvas = Canvas.createCanvas(100, 60);
const ellipseFallbackContext = ellipseFallbackCanvas.getContext('2d');
drawVectorGraphic(new Proxy(ellipseFallbackContext, {
  get(target, property) {
    if (property === 'ellipse') return undefined;
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
  set(target, property, value) { return Reflect.set(target, property, value, target); },
}), { kind: 'ellipse', x: 10, y: 10, w: 80, h: 40, fill: '#FFFFFF' });
assert.deepEqual(ellipseFallbackContext.getImageData(0, 0, 100, 60).data, ellipsePixels,
  'ellipse path construction remains correct on Canvas implementations without ellipse()');
const vectorPanelSource = fs.readFileSync(new URL('../client/src/components/TemplatePanel.jsx', import.meta.url), 'utf8');
assert.match(vectorPanelSource, /\['path', 'rect', 'circle', 'ellipse', 'capsule', 'callout'/,
  'callout is exposed in the vector shape authoring menu');
const closingMorph = interpolateSvgPaths('M 0 0 L 10 0', 'M 0 0 L 10 0 Z', 0.5);
assert.ok(closingMorph?.every(command => command.args.every(Number.isFinite)),
  'open and closed paths animate their closing edge with finite coordinates');
assert.equal(closingMorph.at(-1).type, 'L', 'an open-to-closed morph keeps its closing edge open during interpolation');
assert.equal(interpolateSvgPaths('M 0 0 L 10 0', 'M 0 0 L 10 0 Z', 0).at(-1).type, 'L',
  'the open source topology is preserved at morph start');
assert.equal(interpolateSvgPaths('M 0 0 L 10 0', 'M 0 0 L 10 0 Z', 1).at(-1).type, 'Z',
  'the destination closes exactly when the morph completes');
assert.ok(interpolateSvgPaths('M 0 0 L 10 0 Z', 'M 0 0 L 10 0', 0.5),
  'closed-to-open path morphs are supported as well');
const expandingContourMorph = interpolateSvgPaths(
  'M 5 5 L 25 5 L 15 25 Z',
  'M 5 5 L 25 5 L 15 25 Z M 35 35 L 55 35 L 45 55 Z',
  0.5,
);
assert.ok(expandingContourMorph?.length >= 8 && expandingContourMorph.every(command => command.args.every(Number.isFinite)),
  'different closed contour counts morph by growing the additional contour from a degenerate point');
assert.ok(interpolateSvgPaths(
  'M 5 5 L 25 5 L 15 25 Z M 35 35 L 55 35 L 45 55 Z',
  'M 5 5 L 25 5 L 15 25 Z',
  0.5,
), 'an extra contour can collapse into a point while the remaining contour continues to morph');
const compatibleMorphScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
  duration: 1, vector: { kind: 'path', pathData: 'M 0 0 L 10 0 Z', motion: { pathFrom: 'M 0 0 L 10 0 Z', pathTo: 'M 0 0 C 2 8 8 8 10 0 Z' } },
})] });
assert.ok(!validateScene(compatibleMorphScene, { skipCollisions: true }).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_VECTOR_MORPH),
  'compatible vector morphs pass scene validation');
const incompatibleMorphScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
  duration: 1, vector: { kind: 'path', pathData: 'M 0 0 L 10 0 Z', motion: { pathFrom: 'M 0 0 L 10 0 Z', pathTo: 'M 0 0 L 10 0' } },
})] });
assert.ok(!validateScene(incompatibleMorphScene, { skipCollisions: true }).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_VECTOR_MORPH),
  'open and closed topology morphs pass scene validation');
const multiContourMorphScene = createScene({ duration: 1, nodes: [createNode(NODE_TYPES.SHAPE, {
  duration: 1, vector: { kind: 'path', pathData: 'M 0 0 L 10 0 Z', motion: {
    pathFrom: 'M 0 0 L 10 0 Z', pathTo: 'M 0 0 L 10 0 Z M 20 20 L 30 20 Z',
  } },
})] });
assert.ok(!validateScene(multiContourMorphScene, { skipCollisions: true }).issues.some(issue => issue.code === ISSUE_CODES.UNSUPPORTED_VECTOR_MORPH),
  'different closed contour counts now pass vector morph validation');
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
  const ellipseExport = await renderVectorFrames({ kind: 'ellipse', x: 10, y: 10, w: 80, h: 40, fill: '#FFFFFF' }, {
    durationSec: 0.2, fps: 1, widthPx: 100, tmpDir, name: 'ellipse-export', canvasModule: Canvas,
  });
  const ellipseImage = await Canvas.loadImage(fs.readFileSync(ellipseExport.files[0]));
  const ellipseExportCanvas = Canvas.createCanvas(ellipseImage.width, ellipseImage.height);
  ellipseExportCanvas.getContext('2d').drawImage(ellipseImage, 0, 0);
  const ellipseExportPixels = ellipseExportCanvas.getContext('2d').getImageData(0, 0, ellipseImage.width, ellipseImage.height).data;
  assert.equal(ellipseExportPixels[3], 0, 'ellipse export preserves transparent corners');
  assert.equal(ellipseExportPixels[(25 * ellipseImage.width + 50) * 4 + 3], 255, 'ellipse export matches the preview silhouette');
  const morphVector = {
    kind: 'path', w: 96, h: 96, x: 0, y: 0,
    pathData: 'M 10 10 L 86 10 L 86 86 L 10 86 Z',
    fill: '#FFFFFF', stroke: 'none',
    motion: {
      pathFrom: 'M 10 10 L 86 10 L 86 86 L 10 86 Z',
      pathTo: 'M 48 8 C 96 24 72 96 48 86 C 24 96 0 24 48 8 Z',
      morphStartTime: 0.25, morphDuration: 0.5, easing: 'linear',
    },
  };
  const morphExport = await renderVectorFrames(morphVector, {
    durationSec: 1, fps: 4, widthPx: 96, tmpDir, name: 'path-morph-export', canvasModule: Canvas,
  });
  const morphPixels = await Promise.all(morphExport.files.map(async file => {
    const image = await Canvas.loadImage(fs.readFileSync(file));
    const canvas = Canvas.createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  }));
  assert.deepEqual(morphPixels[0], morphPixels[1], 'export keeps the source SVG path before the delayed morph begins');
  assert.notDeepEqual(morphPixels[1], morphPixels[2], 'exported SVG path morph changes actual frame pixels after its authored start time');

  const contourCountExport = await renderVectorFrames({
    kind: 'path', x: 0, y: 0, w: 96, h: 96,
    pathData: 'M 10 10 L 40 10 L 25 40 Z', fill: '#FFFFFF', stroke: 'none',
    motion: {
      pathFrom: 'M 10 10 L 40 10 L 25 40 Z',
      pathTo: 'M 10 10 L 40 10 L 25 40 Z M 55 55 L 85 55 L 70 85 Z',
      morphStartTime: 0, morphDuration: 1, easing: 'linear',
    },
  }, { durationSec: 1, fps: 2, widthPx: 96, tmpDir, name: 'path-contour-count-morph-export', canvasModule: Canvas });
  const contourCountPixels = await Promise.all(contourCountExport.files.map(async file => {
    const image = await Canvas.loadImage(fs.readFileSync(file));
    const canvas = Canvas.createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  }));
  assert.notDeepEqual(contourCountPixels[0], contourCountPixels[1],
    'exported path with a changing contour count renders visibly different morph frames');
  const openClosedExport = await renderVectorFrames({
    kind: 'path', x: 0, y: 0, w: 96, h: 96,
    pathData: 'M 10 10 L 86 10 L 48 86 Z', fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3,
    motion: {
      pathFrom: 'M 10 10 L 86 10 L 48 86 Z',
      pathTo: 'M 10 10 L 86 10 L 48 86',
      morphStartTime: 0, morphDuration: 1, easing: 'linear',
    },
  }, { durationSec: 1, fps: 4, widthPx: 96, tmpDir, name: 'open-closed-path-morph-export', canvasModule: Canvas });
  const openClosedExportPixels = await Promise.all(openClosedExport.files.slice(0, 3).map(async file => {
    const image = await Canvas.loadImage(fs.readFileSync(file));
    const canvas = Canvas.createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  }));
  assert.notDeepEqual(openClosedExportPixels[0], openClosedExportPixels[1],
    'export renders the animated closing edge instead of holding the source topology');
  assert.notDeepEqual(openClosedExportPixels[1], openClosedExportPixels[2],
    'export continues the open/closed morph across subsequent frames');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
console.log('Vector motion passed: draw-on animation survives scene compilation and renders consistently for preview/export.');
