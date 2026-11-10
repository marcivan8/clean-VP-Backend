import assert from 'node:assert/strict';
import Canvas from '@napi-rs/canvas';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplateFrames } from '../server/compositor/TemplateRenderer.js';
import { drawScene3D, remapSceneObjectTime, resolveSceneVideoSourceTime, maxSceneObjectSourceTime, getSceneShutterSampleTimes, sampleAudioEnvelope, composeSceneRotation, composeSceneTransform, normalizeScene3D, normalizeSceneMesh, MAX_MESH_TRIANGLES, MAX_SCENE_TRIANGLES, getScene3DRenderLimitWarnings, getScene3DCompatibilityWarnings, resolveParticleSeed, SCENE3D_CAMERA_DEFAULTS, SCENE3D_PRIMITIVES, SCENE3D_BLEND_MODES } from '../client/src/motion/Scene3D.js';
import { evaluateMotionExpression } from '../client/src/motion/MotionExpression.js';
import { sampleProceduralParticle, sampleProceduralParticles } from '../client/src/motion/ProceduralParticles.js';

function countGroundShadowPixels(enabled, forcePainterFallback = false, lights = [{ type: 'point', position: { x: -3, y: 5, z: 4 }, intensity: 1,
  color: '#FFFFFF', range: 50, decay: 0.1 }]) {
  const canvas = Canvas.createCanvas(320, 320);
  const context = canvas.getContext('2d');
  const targetContext = forcePainterFallback ? new Proxy(context, {
    get(target, property) {
      if (property === 'getImageData' || property === 'putImageData') return undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); },
  }) : context;
  drawScene3D(targetContext, {
    camera: { z: 7, fov: 780 }, ambient: 1,
    shadows: { enabled, groundY: -1.8, opacity: 0.75, blur: 4, color: '#000000' },
    lights,
    objects: [
      { id: 'ground', type: 'plane', position: { x: 0, y: -1.8, z: 0 },
        rotation: { x: -90 }, size: { x: 8, y: 8, z: 0.1 }, color: '#FFFFFF',
        material: { side: 'double', roughness: 1 }, castsShadow: false },
      { id: 'shadow-caster', type: 'box', position: { x: 0, y: 0, z: 0 },
        size: { x: 1, y: 1, z: 1 }, color: '#FF0000', castsShadow: true },
    ],
  }, 0, 1, 320, 320, {});
  const pixels = canvas.getContext('2d').getImageData(0, 0, 320, 320).data;
  let darkPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 240 && pixels[i] < 230 && pixels[i + 1] < 230 && pixels[i + 2] < 230) darkPixels++;
  }
  return darkPixels;
}

assert.equal(countGroundShadowPixels(false), 0, 'the ground fixture is unshadowed when shadow rendering is disabled');
assert.ok(countGroundShadowPixels(true) > 100, 'cast shadows remain visible on an opaque 3D ground plane');
assert.ok(countGroundShadowPixels(true, true) > 100,
  'painter fallback draws cast shadows after the ground plane when pixel readback is unavailable');
const spotLight = { type: 'spot', position: { x: -3, y: 5, z: 4 }, target: { x: 0, y: 0, z: 0 },
  angle: 70, intensity: 1, castsShadow: true, color: '#FFFFFF', range: 50, decay: 0.1 };
assert.ok(countGroundShadowPixels(true, false, [spotLight]) > 100,
  'a spotlight aimed at the caster produces a ground shadow');
assert.ok(countGroundShadowPixels(true, true, [spotLight]) > 100,
  'spotlight shadows respect the authored cone in the painter fallback');

const oversizedPolygonMesh = normalizeSceneMesh({
  type: 'mesh',
  vertices: Array.from({ length: 64 }, (_, index) => ({ x: index % 8, y: Math.floor(index / 8), z: 0 })),
  faces: Array.from({ length: 5000 }, () => Array.from({ length: 64 }, (_, index) => index)),
});
assert.ok(oversizedPolygonMesh.faces.reduce((sum, face) => sum + face.length - 2, 0) <= MAX_MESH_TRIANGLES,
  'polygon meshes are capped by triangulated work, not only authored face count');
assert.equal(MAX_SCENE_TRIANGLES, 50_000, 'the scene rasterizer has a finite aggregate triangle budget');
assert.deepEqual(getScene3DRenderLimitWarnings({
  objects: Array.from({ length: 81 }, (_, id) => ({ id, type: 'box' })),
  lights: Array.from({ length: 9 }, () => ({ type: 'point' })),
  particles: { count: 501 },
}), [
  { label: 'objects', actual: 81, limit: 80, message: 'This 3D scene has 81 objects; the renderer supports 80, so the extra content will not appear.' },
  { label: 'lights', actual: 9, limit: 8, message: 'This 3D scene has 9 lights; the renderer supports 8, so the extra content will not appear.' },
  { label: 'particles', actual: 501, limit: 500, message: 'This 3D scene has 501 particles; the renderer supports 500, so the extra content will not appear.' },
], 'export preflight warnings match the renderer truncation limits');
assert.deepEqual(getScene3DRenderLimitWarnings({ particles: { count: 500.4 } }), [],
  'particle validation rounds with the same rule as the renderer before deciding if content will be dropped');
assert.deepEqual(getScene3DCompatibilityWarnings({
  objects: [{ id: 'bad-primitive', name: 'Authored shape', type: 'star-poly', material: { side: 'both' }, blendMode: 'linear-dodge' }],
  lights: [{ type: 'area' }],
}).map(warning => warning.message), [
  '3D object “Authored shape” uses unsupported type “star-poly”; it will render as a box.',
  '3D object “Authored shape” uses unsupported material side “both”; it will render as front-sided.',
  '3D object “Authored shape” uses unsupported blend mode “linear-dodge”; it will render as source-over.',
  '3D light 1 uses unsupported type “area”; it will render as a point light.',
], '3D compatibility checks disclose renderer substitutions');
assert.deepEqual(getScene3DCompatibilityWarnings({ objects: [{ type: 'box', material: { side: 'double' }, blendMode: 'multiply' }], lights: [{ type: 'spot' }] }), [],
  'supported 3D authored values do not produce compatibility warnings');
assert.equal(getScene3DCompatibilityWarnings({
  objects: [{ type: '', material: { side: null }, blendMode: '' }], lights: [{ type: null }],
}).length, 4, 'explicit empty and null 3D values are warned while omitted properties retain defaults');
const clampedSceneWarnings = getScene3DCompatibilityWarnings({
  objects: [{ id: 'out-of-range-material', type: 'sphere', material: { opacity: 1.5, roughness: 'bad', metalness: -0.2, emissiveIntensity: 12 } }],
  lights: [{ type: 'point', intensity: 5, range: 0, decay: 9, angle: 180 }],
});
assert.equal(clampedSceneWarnings.length, 8, 'all clamped material and light controls are surfaced to validation and export');
assert.ok(clampedSceneWarnings.some(warning => /Material roughness.*invalid.*use 0\.62/.test(warning.message)));
assert.ok(clampedSceneWarnings.some(warning => /Intensity.*outside the supported range 0–4.*clamp/.test(warning.message)));
const denseMesh = {
  id: 'dense-mesh', type: 'mesh',
  vertices: Array.from({ length: 64 }, (_, index) => ({ x: index, y: 0, z: 0 })),
  faces: Array.from({ length: 5000 }, () => Array.from({ length: 64 }, (_, index) => index)),
};
const meshLimitWarnings = getScene3DRenderLimitWarnings({ objects: Array.from({ length: 6 }, () => denseMesh) });
assert.ok(meshLimitWarnings.some(warning => warning.label === 'triangles on mesh “dense-mesh”' && warning.actual === 310_000 && warning.limit === MAX_MESH_TRIANGLES),
  'export preflight reports actual triangulated work when a single mesh exceeds its triangle budget');
assert.ok(meshLimitWarnings.some(warning => warning.label === 'triangles in the 3D scene' && warning.actual === 60_000 && warning.limit === MAX_SCENE_TRIANGLES),
  'export preflight reports aggregate mesh triangle truncation across the scene');
assert.equal(countGroundShadowPixels(true, false, [{ ...spotLight, target: { x: -6, y: 10, z: 8 } }]), 0,
  'a spotlight aimed away from the caster does not produce a ground shadow');
assert.equal(countGroundShadowPixels(true, true, [{ ...spotLight, target: { x: -6, y: 10, z: 8 } }]), 0,
  'the painter fallback also suppresses spotlight shadows outside the cone');
assert.ok(countGroundShadowPixels(true, false, [
  { type: 'point', position: { x: -3, y: 5, z: 4 }, intensity: 1, castsShadow: false, color: '#FFFFFF', range: 50, decay: 0.1 },
  { type: 'point', position: { x: 3, y: 5, z: 4 }, intensity: 1, castsShadow: true, color: '#FFFFFF', range: 50, decay: 0.1 },
]) > 100, 'a secondary light can cast shadows when the key light shadow switch is off');
assert.equal(countGroundShadowPixels(true, false, [
  { type: 'point', position: { x: -3, y: 5, z: 4 }, intensity: 1, castsShadow: false, color: '#FFFFFF', range: 50, decay: 0.1 },
  { type: 'point', position: { x: 3, y: 5, z: 4 }, intensity: 1, castsShadow: false, color: '#FFFFFF', range: 50, decay: 0.1 },
]), 0, 'lights marked not to cast shadows contribute no ground shadow');

function countReceiverPlaneShadowPixels(enabled, receiverPlane, forcePainterFallback = false, light = {
  type: 'point', position: { x: 0, y: 0, z: 3 }, intensity: 1,
  color: '#FFFFFF', range: 50, decay: 0,
}, receiverSize = 8, casterX = 0, receiverRotation = {}) {
  const canvas = Canvas.createCanvas(320, 320);
  const ctx = canvas.getContext('2d');
  const targetContext = forcePainterFallback ? new Proxy(ctx, {
    get(target, property) {
      if (property === 'getImageData' || property === 'putImageData') return undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); },
  }) : ctx;
  drawScene3D(targetContext, {
    camera: { z: 7, fov: 780 }, ambient: 1,
    shadows: { enabled, receiverPlane, opacity: 0.8, blur: 1, color: '#000000' },
    lights: [light],
    objects: [
      { id: 'wall-catcher', type: 'plane', position: { x: 0, y: 0, z: -1.5 },
        size: { x: receiverSize, y: receiverSize }, color: '#FFFFFF', material: { side: 'double' }, castsShadow: false,
        rotation: receiverRotation,
        ...(receiverPlane ? {} : { receivesShadow: true }) },
      { id: 'wall-shadow-caster', type: 'box', position: { x: casterX, y: 0, z: 0 },
        size: { x: 1, y: 1, z: 1 }, color: '#FF0000', castsShadow: true },
    ],
  }, 0, 1, 320, 320, {});
  const data = ctx.getImageData(0, 0, 320, 320).data;
  let darkPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 240 && data[i] < 235 && data[i + 1] < 235 && data[i + 2] < 235) darkPixels++;
  }
  return darkPixels;
}
function countMarkedFloorAndWallShadows(forcePainterFallback = false) {
  const canvas = Canvas.createCanvas(320, 320);
  const ctx = canvas.getContext('2d');
  const targetContext = forcePainterFallback ? new Proxy(ctx, {
    get(target, property) {
      if (property === 'getImageData' || property === 'putImageData') return undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); },
  }) : ctx;
  drawScene3D(targetContext, {
    camera: { z: 7, pitch: 8, fov: 780 }, ambient: 1,
    shadows: { enabled: true, opacity: 0.8, blur: 1, color: '#000000' },
    lights: [{ type: 'point', position: { x: -3, y: 4, z: 3 }, intensity: 1, color: '#FFFFFF', range: 50, decay: 0 }],
    objects: [
      { id: 'wall-catcher', type: 'plane', position: { x: 0, y: 0, z: -1.5 }, size: { x: 8, y: 8 },
        color: '#FFFFFF', material: { side: 'double' }, castsShadow: false, receivesShadow: true },
      { id: 'floor-catcher', type: 'plane', position: { x: 0, y: -1.5, z: 0 }, rotation: { x: -90 }, size: { x: 8, y: 8 },
        color: '#FFFFFF', material: { side: 'double' }, castsShadow: false, receivesShadow: true },
      { id: 'two-surface-caster', type: 'box', position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, color: '#FF0000' },
    ],
  }, 0, 1, 320, 320, {});
  const { data } = ctx.getImageData(0, 0, 320, 320);
  const count = (x0, y0, x1, y1) => {
    let pixels = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const offset = (y * 320 + x) * 4;
      if (data[offset + 3] > 240 && data[offset] < 235 && data[offset + 1] < 235 && data[offset + 2] < 235) pixels++;
    }
    return pixels;
  };
  return { wall: count(0, 0, 320, 180), floor: count(140, 180, 320, 260) };
}
const wallReceiver = { point: { x: 0, y: 0, z: -1.5 }, normal: { x: 0, y: 0, z: 1 } };
assert.equal(countReceiverPlaneShadowPixels(false, wallReceiver), 0,
  'an arbitrary receiver plane stays unshadowed when the scene shadow switch is off');
assert.ok(countReceiverPlaneShadowPixels(true, wallReceiver) > 100,
  'point-light shadows project onto a vertical receiver plane as well as the default ground');
assert.ok(countReceiverPlaneShadowPixels(true, wallReceiver, true) > 100,
  'the painter fallback also draws cast shadows onto vertical receiver planes');
assert.ok(countReceiverPlaneShadowPixels(true, wallReceiver, false, {
  type: 'directional', direction: { x: -0.4, y: 0, z: -1 }, intensity: 1, color: '#FFFFFF', castsShadow: true,
}) > 100, 'directional lights also project shadows onto vertical receiver planes');
assert.ok(countReceiverPlaneShadowPixels(true, null) > 100,
  'a scene plane marked receivesShadow derives its own world position and normal');
const broadReceiverShadow = countReceiverPlaneShadowPixels(true, null, false, undefined, 8, 0.8);
const finiteReceiverShadow = countReceiverPlaneShadowPixels(true, null, false, undefined, 0.8, 0.8);
assert.ok(finiteReceiverShadow < broadReceiverShadow,
  'a marked plane clips cast shadows to its finite bounds instead of drawing beyond its edges');
const broadRotatedReceiverShadow = countReceiverPlaneShadowPixels(true, null, false, undefined, 8, 0.8, { y: 32, x: 18 });
const finiteRotatedReceiverShadow = countReceiverPlaneShadowPixels(true, null, false, undefined, 0.8, 0.8, { y: 32, x: 18 });
assert.ok(finiteRotatedReceiverShadow < broadRotatedReceiverShadow,
  'finite receiver clipping also follows the transformed bounds of a rotated plane');
const broadPainterReceiverShadow = countReceiverPlaneShadowPixels(true, null, true, undefined, 8, 0.8);
const finitePainterReceiverShadow = countReceiverPlaneShadowPixels(true, null, true, undefined, 0.8, 0.8);
assert.ok(finitePainterReceiverShadow < broadPainterReceiverShadow,
  'finite receiver clipping is preserved by the painter fallback without depth-buffer readback');
const multipleReceiverShadows = countMarkedFloorAndWallShadows();
assert.ok(multipleReceiverShadows.wall > 100 && multipleReceiverShadows.floor > 100,
  `multiple marked planes receive shadows in their respective orientations (wall ${multipleReceiverShadows.wall}, floor ${multipleReceiverShadows.floor})`);
const painterMultipleReceiverShadows = countMarkedFloorAndWallShadows(true);
assert.ok(painterMultipleReceiverShadows.wall > 100 && painterMultipleReceiverShadows.floor > 100,
  `the painter fallback casts shadows onto multiple receiver planes (wall ${painterMultipleReceiverShadows.wall}, floor ${painterMultipleReceiverShadows.floor})`);

function concaveShadowScene(enabled) {
  return {
    camera: { z: 7, pitch: 20, fov: 780 }, ambient: 1,
    shadows: { enabled, groundY: -1.8, opacity: 0.75, blur: 4, color: '#000000' },
    lights: [{ type: 'point', position: { x: 0, y: 5, z: 0 }, intensity: 1, range: 50, decay: 0 }],
    objects: [
      { id: 'ground', type: 'plane', position: { x: 0, y: -1.8, z: 0 }, rotation: { x: -90 },
        size: { x: 8, y: 8 }, color: '#FFFFFF', material: { side: 'double' }, castsShadow: false },
      { id: 'concave-logo', type: 'mesh', material: { side: 'double' }, color: '#FF0000',
        vertices: [
          { x: -1, y: 0, z: -1 }, { x: 1, y: 0, z: -1 }, { x: 1, y: 0, z: -0.5 },
          { x: -0.5, y: 0, z: -0.5 }, { x: -0.5, y: 0, z: 1 }, { x: -1, y: 0, z: 1 },
          { x: -1, y: 0.5, z: -1 }, { x: 1, y: 0.5, z: -1 }, { x: 1, y: 0.5, z: -0.5 },
          { x: -0.5, y: 0.5, z: -0.5 }, { x: -0.5, y: 0.5, z: 1 }, { x: -1, y: 0.5, z: 1 },
        ], faces: [
          [0, 1, 2, 3, 4, 5], [11, 10, 9, 8, 7, 6],
          [1, 0, 6, 7], [2, 1, 7, 8], [3, 2, 8, 9],
          [4, 3, 9, 10], [5, 4, 10, 11], [0, 5, 11, 6],
        ], castsShadow: true },
    ],
  };
}
function concaveShadowPixels(enabled) {
  const canvas = Canvas.createCanvas(320, 320);
  drawScene3D(canvas.getContext('2d'), concaveShadowScene(enabled), 0, 1, 320, 320, {});
  return canvas.getContext('2d').getImageData(0, 0, 320, 320).data;
}
const concaveOn = concaveShadowPixels(true), concaveOff = concaveShadowPixels(false);
const notchOffset = (107 * 320 + 160) * 4;
assert.deepEqual(Array.from(concaveOn.slice(notchOffset, notchOffset + 3)),
  Array.from(concaveOff.slice(notchOffset, notchOffset + 3)),
  'a concave custom mesh preserves its notch instead of filling it with a convex-hull shadow');
const solidShadowOffset = (56 * 320 + 160) * 4;
assert.ok(concaveOn[solidShadowOffset] < concaveOff[solidShadowOffset] - 20,
  'the same custom mesh still casts a visible shadow beneath its solid section');
function renderTextScene(textZ, includeOccluder, far = 1000) {
  const canvas = Canvas.createCanvas(320, 320);
  const ctx = canvas.getContext('2d');
  const objects = [];
  if (includeOccluder) objects.push({
    id: 'occluder', type: 'box', position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 1 },
    color: '#D92424', castsShadow: false,
  });
  objects.push({
    id: 'title', type: 'text', content: 'X', position: { x: 0, y: 0, z: textZ },
    fontSize: 0.65, color: '#FFFFFF', depth: 0, castsShadow: false,
  });
  drawScene3D(ctx, {
    camera: { z: 7, fov: 780, far }, ambient: 0.5, shadows: { enabled: false },
    lights: [{ type: 'directional', direction: { x: 0, y: 0, z: 1 }, intensity: 1 }], objects,
  }, 0, 1, 320, 320, {});
  const pixels = ctx.getImageData(0, 0, 320, 320).data;
  let white = 0;
  for (let y = 80; y < 240; y++) for (let x = 80; x < 240; x++) {
    const i = (y * 320 + x) * 4;
    if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240 && pixels[i + 3] > 0) white++;
  }
  return white;
}

assert.ok(renderTextScene(2, true) > 100, 'text in front of opaque geometry remains visible');
assert.equal(renderTextScene(-2, true), 0, 'opaque geometry occludes text behind it');
assert.ok(renderTextScene(-2, false) > 100, 'the occluded text is present when the geometry is removed');
assert.equal(renderTextScene(-2, false, 8), 0, 'text beyond the camera far plane is clipped');

function frameFor3dText(rotation = {}, depth = 0, style = {}) {
  const canvas = Canvas.createCanvas(320, 320);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
    objects: [{ id: 'rotated-title', type: 'text', content: 'AXIS', fontSize: 0.9,
      position: { x: 0, y: 0, z: 0 }, rotation, depth, color: '#FFFFFF', castsShadow: false, ...style }],
  }, 0, 1, 320, 320, {});
  return Array.from(canvas.getContext('2d').getImageData(0, 0, 320, 320).data);
}
function textCentroidX(pixels) {
  let sum = 0, count = 0;
  for (let y = 0; y < 320; y++) for (let x = 0; x < 320; x++) {
    if (pixels[(y * 320 + x) * 4 + 3] > 0) { sum += x; count++; }
  }
  return sum / count;
}
assert.ok(textCentroidX(frameFor3dText({ y: 45 }, 20)) < textCentroidX(frameFor3dText({ y: 45 }, 0)) - 1,
  '3D text extrusion follows the rotated local depth axis in perspective');
function alphaBoundsX(pixels) {
  let min = 320, max = -1;
  for (let y = 0; y < 320; y++) for (let x = 0; x < 320; x++) {
    if (pixels[(y * 320 + x) * 4 + 3] > 0) { min = Math.min(min, x); max = Math.max(max, x); }
  }
  return { min, max };
}
const centeredTextBounds = alphaBoundsX(frameFor3dText());
const leftTextBounds = alphaBoundsX(frameFor3dText({}, 0, { textAlign: 'left', fontFamily: 'Georgia', fontWeight: 400 }));
const rightTextBounds = alphaBoundsX(frameFor3dText({}, 0, { textAlign: 'right' }));
assert.ok(leftTextBounds.min > centeredTextBounds.min + 10 && leftTextBounds.max > centeredTextBounds.max + 10,
  'left aligned text anchors its left edge at the projected object origin');
assert.ok(rightTextBounds.min < centeredTextBounds.min - 10 && rightTextBounds.max < centeredTextBounds.max - 10,
  'right aligned text anchors its right edge at the projected object origin');
assert.ok(leftTextBounds.max - leftTextBounds.min < centeredTextBounds.max - centeredTextBounds.min,
  'font family and weight settings affect the rendered glyph metrics');

function opaquePixelCentroidX(scene) {
  const canvas = Canvas.createCanvas(320, 320);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780, ...scene.camera }, ambient: 1,
    shadows: { enabled: false },
    objects: [{ id: 'look-at-target', type: 'box', position: { x: 1, y: 0, z: 0 },
      size: { x: 0.7, y: 0.7, z: 0.7 }, color: '#FFFFFF', castsShadow: false }],
  }, scene.time || 0, 2, 320, 320, {});
  const data = canvas.getContext('2d').getImageData(0, 0, 320, 320).data;
  let totalX = 0, count = 0;
  for (let y = 0; y < 320; y++) for (let x = 0; x < 320; x++) {
    if (data[(y * 320 + x) * 4 + 3] > 0) { totalX += x; count++; }
  }
  return count ? totalX / count : NaN;
}
assert.ok(Math.abs(opaquePixelCentroidX({ camera: { lookAt: { x: 1, y: 0, z: 0 } } }) - 160) < 4,
  'look-at aims the camera at an off-axis world-space target');
assert.ok(opaquePixelCentroidX({ camera: { lookAt: { x: 1, y: 0, z: 0 }, yaw: 0 } }) > 200,
  'explicit camera yaw takes precedence over look-at');
assert.ok(Math.abs(opaquePixelCentroidX({ camera: {
  lookAt: { x: 1, y: 0, z: 0 },
  animations: [{ startTime: 1, keyframes: [
    { time: 0, properties: { yaw: 0 } }, { time: 1, properties: { yaw: 0 } },
  ] }],
} }) - 160) < 4,
  'look-at remains active until a delayed camera rotation animation starts');
assert.ok(opaquePixelCentroidX({ time: 1, camera: {
  lookAt: { x: 1, y: 0, z: 0 },
  animations: [{ startTime: 1, keyframes: [
    { time: 0, properties: { yaw: 0 } }, { time: 1, properties: { yaw: 0 } },
  ] }],
} }) > 200,
  'an active camera rotation animation overrides the derived look-at angle');
const unrotatedTextFrame = frameFor3dText();
assert.ok(unrotatedTextFrame.some((channel, index) => index % 4 === 3 && channel > 0), '3D text is visible without rotation');
assert.notDeepEqual(frameFor3dText({ x: 50, y: 35, z: 0 }), unrotatedTextFrame,
  '3D text X and Y rotations change its projected plane');

function countWhiteTextPixels(withOccluder) {
  const canvas = Canvas.createCanvas(320, 320);
  const objects = [];
  if (withOccluder) objects.push({ id: 'text-occluder', type: 'box',
    position: { x: 0, y: 0, z: 0.5 }, size: { x: 0.7, y: 0.7, z: 0.3 }, color: '#D92424', castsShadow: false });
  objects.push({ id: 'tilted-title', type: 'text', content: 'AXIS', fontSize: 0.9,
    position: { x: 0, y: 0, z: 0 }, rotation: { y: 55 }, depth: 0, color: '#FFFFFF', castsShadow: false });
  drawScene3D(canvas.getContext('2d'), { camera: { z: 7, fov: 780 }, ambient: 1,
    shadows: { enabled: false }, objects }, 0, 1, 320, 320, {});
  const pixels = canvas.getContext('2d').getImageData(0, 0, 320, 320).data;
  let white = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240 && pixels[i + 3] > 0) white++;
  }
  return white;
}
const unoccludedTiltedText = countWhiteTextPixels(false);
const partiallyOccludedTiltedText = countWhiteTextPixels(true);
assert.ok(partiallyOccludedTiltedText > 0 && partiallyOccludedTiltedText < unoccludedTiltedText,
  'tilted 3D text uses per-pixel plane depth, so a foreground mesh occludes only the covered part');

function frameForAnimatedTextRotation(time) {
  const canvas = Canvas.createCanvas(320, 320);
  drawScene3D(canvas.getContext('2d'), { camera: { z: 7, fov: 780 }, ambient: 1,
    shadows: { enabled: false }, objects: [{ id: 'keyframed-title', type: 'text', content: 'AXIS',
      fontSize: 0.9, depth: 0, color: '#FFFFFF', castsShadow: false,
      animations: [{ duration: 1, keyframes: [
        { time: 0, properties: { rotationY: 0 } },
        { time: 1, properties: { rotationY: 55 } },
      ] }],
    }] }, time, 1, 320, 320, {});
  return Array.from(canvas.getContext('2d').getImageData(0, 0, 320, 320).data);
}
assert.notDeepEqual(frameForAnimatedTextRotation(1), frameForAnimatedTextRotation(0),
  'keyframed 3D text rotation affects the rendered frame');

function renderBoxAlpha(boxZ, far) {
  const canvas = Canvas.createCanvas(240, 240);
  const ctx = canvas.getContext('2d');
  drawScene3D(ctx, {
    camera: { z: 7, fov: 780, far }, ambient: 1, shadows: { enabled: false },
    objects: [{ id: 'box', type: 'box', position: { x: 0, y: 0, z: boxZ }, size: { x: 1, y: 1, z: 1 }, color: '#FFFFFF', castsShadow: false }],
  }, 0, 1, 240, 240, {});
  const pixels = ctx.getImageData(0, 0, 240, 240).data;
  let alpha = 0;
  for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i];
  return alpha;
}
assert.ok(renderBoxAlpha(0, 1000) > 0, 'mesh geometry inside the camera depth range renders');
assert.equal(renderBoxAlpha(-3, 8), 0, 'mesh geometry beyond the camera far plane is clipped');

function materialPixel(material = {}, time = 0, animations = [], expressions = undefined) {
  const canvas = Canvas.createCanvas(120, 120);
  drawScene3D(canvas.getContext('2d'), { camera: { z: 7 }, ambient: 0, shadows: { enabled: false }, lights: [],
    objects: [{ id: 'emissive-box', type: 'box', position: { x: 0, y: 0, z: 0 },
      size: { x: 2, y: 2, z: 1 }, color: '#101010', material, animations,
      ...(expressions ? { expressions } : {}), castsShadow: false }],
  }, time, 1, 120, 120, {});
  return Array.from(canvas.getContext('2d').getImageData(60, 60, 1, 1).data);
}
const unlitMaterialPixel = materialPixel();
const emissiveMaterialPixel = materialPixel({ emissive: '#00FF00', emissiveIntensity: 0.5 });
assert.ok(emissiveMaterialPixel[1] > unlitMaterialPixel[1] + 100,
  'emissive material color and intensity add light independently from scene lights');
const animatedEmissiveMaterialPixel = materialPixel({ emissiveColor: '#00FF00', emissiveIntensity: 0 }, 1, [{
  id: 'emissive-animation', duration: 1, keyframes: [
    { time: 0, properties: { emissiveIntensity: 0 } },
    { time: 1, properties: { emissiveIntensity: 0.5 } },
  ],
}]);
assert.ok(animatedEmissiveMaterialPixel[1] > unlitMaterialPixel[1] + 100,
  '3D object keyframes animate material emissive intensity');
const expressedEmissiveMaterialPixel = materialPixel({ emissiveColor: '#00FF00', emissiveIntensity: 0 }, 0, [], { emissiveIntensity: 'value + 0.5' });
assert.ok(expressedEmissiveMaterialPixel[1] > unlitMaterialPixel[1] + 100,
  '3D object expressions animate material emissive intensity');

function texturedMaterialPixel(material, time = 0, animations = [], expressions = undefined, lightColor = '#FFFFFF') {
  const texture = Canvas.createCanvas(4, 4);
  texture.getContext('2d').fillRect(0, 0, 4, 4);
  texture.getContext('2d').fillStyle = '#FF2020';
  texture.getContext('2d').fillRect(0, 0, 4, 4);
  const canvas = Canvas.createCanvas(120, 120);
  drawScene3D(canvas.getContext('2d'), { camera: { z: 7 }, ambient: 0.05,
    shadows: { enabled: false }, lights: [{ type: 'point', position: { x: 0, y: 0, z: 4 },
      intensity: 1, color: lightColor, range: 24, decay: 0 }], objects: [{
      id: 'lit-image-plane', type: 'image', imageUrl: 'lit-texture', position: { x: 0, y: 0, z: 0 },
      size: { x: 2, y: 2 }, material, animations,
      ...(expressions ? { expressions } : {}), castsShadow: false,
    }] }, time, 1, 120, 120, { 'lit-texture': texture });
  return [...canvas.getContext('2d').getImageData(60, 60, 1, 1).data];
}
const roughTextureBefore = texturedMaterialPixel({ roughness: 1, metalness: 0 });
const roughTextureAfter = texturedMaterialPixel({ roughness: 1, metalness: 0 }, 1, [{ duration: 1, keyframes: [
  { time: 0, properties: { roughness: 0 } }, { time: 1, properties: { roughness: -0.96 } },
] }]);
assert.ok(roughTextureAfter[0] > roughTextureBefore[0] + 5,
  `3D roughness keyframes change specular lighting on image and video textures: ${roughTextureBefore} -> ${roughTextureAfter}`);
const dielectricTexture = texturedMaterialPixel({ roughness: 0.04, metalness: 0 });
const metallicTexture = texturedMaterialPixel({ roughness: 0.04, metalness: 0 }, 1, [{ duration: 1, keyframes: [
  { time: 0, properties: { metalness: 0 } }, { time: 1, properties: { metalness: 0.92 } },
] }]);
assert.notDeepEqual(metallicTexture.slice(0, 3), dielectricTexture.slice(0, 3),
  '3D metalness keyframes change specular response on image and video textures');
const expressedTexture = texturedMaterialPixel({ roughness: 1, metalness: 0 }, 0, [], { roughness: '0.04' });
assert.ok(expressedTexture[0] > roughTextureBefore[0] + 5,
  '3D material expressions change texture lighting');

function renderMaterialOpacity(opacity, sampleX = 58, sampleY = 60) {
  const canvas = Canvas.createCanvas(120, 120);
  drawScene3D(canvas.getContext('2d'), { camera: { z: 7 }, ambient: 1,
    shadows: { enabled: false }, objects: [
      { id: 'opacity-backdrop', type: 'box', position: { x: 0, y: 0, z: 0 },
        size: { x: 3, y: 3, z: 0.2 }, color: '#FF0000', castsShadow: false },
      { id: 'opacity-foreground', type: 'box', position: { x: 0, y: 0, z: 1 },
        size: { x: 2, y: 2, z: 0.2 }, color: '#0000FF', material: { opacity }, castsShadow: false },
    ] }, 0, 1, 120, 120, {});
  return Array.from(canvas.getContext('2d').getImageData(sampleX, sampleY, 1, 1).data);
}
const opaqueMaterialPixel = renderMaterialOpacity(1);
const translucentMaterialPixel = renderMaterialOpacity(0.5);
assert.ok(opaqueMaterialPixel[2] > opaqueMaterialPixel[0]
  && translucentMaterialPixel[0] > 100
  && translucentMaterialPixel[2] > 100
  && translucentMaterialPixel[0] < 160
  && translucentMaterialPixel[2] < 160,
  '3D material opacity alpha-composites in front of geometry and does not write opaque depth');
const translucentMaterialSeamPixel = renderMaterialOpacity(0.5, 60, 60);
assert.ok(translucentMaterialSeamPixel[0] > 100 && translucentMaterialSeamPixel[2] > 100
  && translucentMaterialSeamPixel[0] < 160 && translucentMaterialSeamPixel[2] < 160,
  'a shared triangle edge composites translucent material exactly once');

function render3dBlend(mode) {
  const canvas = Canvas.createCanvas(120, 120);
  drawScene3D(canvas.getContext('2d'), { camera: { z: 7 }, ambient: 1,
    shadows: { enabled: false }, lights: [], objects: [
      { id: 'blend-backdrop', type: 'box', position: { x: 0, y: 0, z: 0 },
        size: { x: 3, y: 3, z: 0.2 }, color: '#808080', castsShadow: false },
      { id: 'blend-foreground', type: 'box', position: { x: 0, y: 0, z: 1 },
        size: { x: 2, y: 2, z: 0.2 }, color: '#FF0000', blendMode: mode, castsShadow: false },
    ] }, 0, 1, 120, 120, {});
  return [...canvas.getContext('2d').getImageData(60, 60, 1, 1).data];
}
const expected3dBlend = {
  'color-dodge': [255, 204, 204], 'color-burn': [202, 0, 0],
  'hard-light': [255, 5, 5], 'soft-light': [227, 161, 161], 'exclusion': [53, 200, 200],
};
for (const [mode, expected] of Object.entries(expected3dBlend)) {
  const actual = render3dBlend(mode);
  assert.ok(expected.every((channel, index) => Math.abs(actual[index] - channel) <= 8),
    `3D ${mode} blend matches its expected RGB result; got ${actual.slice(0, 3).join(',')}`);
}
const hslModes = ['hue', 'saturation', 'color', 'luminosity'];
assert.ok(hslModes.every(mode => SCENE3D_BLEND_MODES.includes(mode)),
  '3D renderer exposes the four non-separable HSL blend modes');
function referenceCanvasBlend(mode) {
  const sampleLayer = objectIndex => {
    const layer = Canvas.createCanvas(120, 120);
    drawScene3D(layer.getContext('2d'), { camera: { z: 7 }, ambient: 1,
      shadows: { enabled: false }, lights: [], objects: [
        { id: 'blend-backdrop', type: 'box', position: { x: 0, y: 0, z: 0 },
          size: { x: 3, y: 3, z: 0.2 }, color: '#808080', castsShadow: false },
        { id: 'blend-foreground', type: 'box', position: { x: 0, y: 0, z: 1 },
          size: { x: 2, y: 2, z: 0.2 }, color: '#FF0000', castsShadow: false },
      ].filter((_, index) => index === objectIndex) }, 0, 1, 120, 120, {});
    return [...layer.getContext('2d').getImageData(60, 60, 1, 1).data];
  };
  const backdrop = sampleLayer(0), source = sampleLayer(1);
  const canvas = Canvas.createCanvas(2, 2), context = canvas.getContext('2d');
  context.fillStyle = `rgba(${backdrop[0]},${backdrop[1]},${backdrop[2]},${backdrop[3] / 255})`;
  context.fillRect(0, 0, 2, 2);
  context.globalCompositeOperation = mode;
  assert.equal(context.globalCompositeOperation, mode, `Canvas reference supports ${mode}`);
  context.fillStyle = `rgba(${source[0]},${source[1]},${source[2]},${source[3] / 255})`;
  context.fillRect(0, 0, 2, 2);
  return [...context.getImageData(1, 1, 1, 1).data];
}
for (const mode of hslModes) {
  const actual = render3dBlend(mode), expected = referenceCanvasBlend(mode);
  assert.ok(expected.slice(0, 3).every((channel, index) => Math.abs(actual[index] - channel) <= 8),
    `3D ${mode} blend matches the Canvas reference; expected ${expected.slice(0, 3)}, got ${actual.slice(0, 3)}`);
}

function crossedTransparentPlanesFrame(reverseOrder = false) {
  const canvas = Canvas.createCanvas(320, 320);
  const leftToRight = { id: 'left-to-right', type: 'mesh', color: '#FF0000',
    material: { opacity: 0.55, side: 'double' }, castsShadow: false,
    vertices: [{ x: -2, y: -2, z: -1 }, { x: 2, y: -2, z: 1 },
      { x: 2, y: 2, z: 1 }, { x: -2, y: 2, z: -1 }], faces: [[0, 1, 2, 3]] };
  const rightToLeft = { id: 'right-to-left', type: 'mesh', color: '#0000FF',
    material: { opacity: 0.55, side: 'double' }, castsShadow: false,
    vertices: [{ x: -2, y: -2, z: 1 }, { x: 2, y: -2, z: -1 },
      { x: 2, y: 2, z: -1 }, { x: -2, y: 2, z: 1 }], faces: [[0, 1, 2, 3]] };
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
    objects: reverseOrder ? [rightToLeft, leftToRight] : [leftToRight, rightToLeft],
  }, 0, 1, 320, 320, {});
  return canvas.getContext('2d').getImageData(0, 0, 320, 320).data;
}
const crossedTransparentForward = crossedTransparentPlanesFrame();
const crossedTransparentReverse = crossedTransparentPlanesFrame(true);
let crossedOrderDifferences = 0;
for (let i = 0; i < crossedTransparentForward.length; i += 4) {
  if (Math.abs(crossedTransparentForward[i] - crossedTransparentReverse[i]) > 2
    || Math.abs(crossedTransparentForward[i + 2] - crossedTransparentReverse[i + 2]) > 2) crossedOrderDifferences++;
}
assert.ok(crossedOrderDifferences < 3000,
  `crossing transparent surfaces follow per-pixel depth rather than object order (${crossedOrderDifferences} differing pixels)`);

function centerColorForSameDepthOrder() {
  const canvas = Canvas.createCanvas(120, 120);
  drawScene3D(canvas.getContext('2d'), { camera: { z: 7 }, ambient: 1, shadows: { enabled: false }, objects: [
    { id: 'first', type: 'box', position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 1 }, color: '#FF0000', castsShadow: false },
    { id: 'second', type: 'box', position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 1 }, color: '#00FF00', castsShadow: false },
  ] }, 0, 1, 120, 120, {});
  return Array.from(canvas.getContext('2d').getImageData(60, 60, 1, 1).data);
}
const sameDepthColor = centerColorForSameDepthOrder();
assert.ok(sameDepthColor[1] > sameDepthColor[0], 'same-depth surfaces preserve deterministic frontmost layer ordering');

const uhdCanvas = Canvas.createCanvas(3840, 2160);
drawScene3D(uhdCanvas.getContext('2d'), {
  camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
  objects: [
    { id: 'uhd-box', type: 'box', position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, color: '#FFFFFF', castsShadow: false },
    { id: 'uhd-glass', type: 'box', position: { x: 0, y: 0, z: 1 }, size: { x: 2.4, y: 2.4, z: 0.2 }, color: '#FF0000', material: { opacity: 0.4 }, castsShadow: false },
  ],
}, 0, 1, 3840, 2160, {});
const uhdPixels = uhdCanvas.getContext('2d').getImageData(0, 0, 3840, 2160).data;
const uhdCenter = (1080 * 3840 + 1920) * 4;
assert.ok(uhdPixels[uhdCenter + 3] > 0 && uhdPixels[uhdCenter] > 20,
  '4K scenes keep opaque depth and tile-sorted transparent rendering above two megapixels');

function frameWithParticleOccluder(includeParticles, boxZ = 0) {
  const canvas = Canvas.createCanvas(240, 240);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
    ...(includeParticles ? { particles: { count: 32, spread: 0.2, size: 14, speed: 0, color: '#FF00FF', seed: 3 } } : {}),
    objects: [{ id: 'foreground', type: 'box', position: { x: 0, y: 0, z: boxZ }, size: { x: 10, y: 10, z: 1 }, color: '#2457C5', castsShadow: false }],
  }, 0, 1, 240, 240, {});
  return Array.from(canvas.getContext('2d').getImageData(0, 0, 240, 240).data);
}
assert.deepEqual(frameWithParticleOccluder(true), frameWithParticleOccluder(false),
  'particles behind opaque geometry are hidden by the shared 3D depth buffer');
assert.notDeepEqual(frameWithParticleOccluder(true, -1), frameWithParticleOccluder(false, -1),
  'particles in front of opaque geometry remain visible');

function particleAlphaAtDepth(plane) {
  const canvas = Canvas.createCanvas(240, 240);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780, ...plane }, shadows: { enabled: false },
    particles: { count: 24, spread: 0.2, size: 12, speed: 0, color: '#FFFFFF', seed: 9 },
    objects: [],
  }, 0, 1, 240, 240, {});
  const pixels = canvas.getContext('2d').getImageData(0, 0, 240, 240).data;
  return pixels.some((channel, index) => index % 4 === 3 && channel > 0);
}
assert.equal(resolveParticleSeed({ seed: 0 }), 0, 'an explicit zero particle seed is preserved');
assert.equal(resolveParticleSeed({}), 17, 'unconfigured particles retain the stable default seed');
assert.equal(particleAlphaAtDepth({ near: 7.1 }), false, 'particles in front of the near plane are clipped');
assert.equal(particleAlphaAtDepth({ far: 6 }), false, 'particles beyond the far plane are clipped');

const proceduralConfig = {
  count: 16, seed: 123, size: 3, speed: 1, lifetime: 2, fadeIn: 0.1, fadeOut: 0.2,
  emitter: { shape: 'sphere', position: { x: 1, y: 2, z: 3 }, size: { x: 2, y: 1, z: 3 } },
  velocity: { x: 0.5, y: 1, z: -0.25 }, gravity: { x: 0, y: -1, z: 0 }, turbulence: 0.15,
};
assert.deepEqual(sampleProceduralParticles(proceduralConfig, 0.7), sampleProceduralParticles(proceduralConfig, 0.7),
  'particle layouts are deterministic when scrubbing and rendering the same frame');
assert.equal(sampleProceduralParticles(proceduralConfig, 0.7).length, proceduralConfig.count,
  'the continuous emitter maintains the authored particle count');
assert.deepEqual(sampleProceduralParticle({ ...proceduralConfig, emitter: { shape: 'point', position: { x: 1, y: 2, z: 3 } }, velocity: {}, gravity: {}, turbulence: 0 }, 0, 0).position,
  { x: 1, y: 2, z: 3 }, 'point emitters start at their authored world-space position');
const ballisticConfig = { ...proceduralConfig, emitter: { shape: 'point', mode: 'burst' }, velocity: { y: 1 }, gravity: { y: -2 }, turbulence: 0, loop: false };
const ballisticStart = sampleProceduralParticle(ballisticConfig, 0, 0.5);
const ballisticLater = sampleProceduralParticle(ballisticConfig, 0, 1);
assert.ok(ballisticLater.position.y < ballisticStart.position.y,
  'gravity changes the trajectory of emitted particles over time');
const burst = { count: 4, seed: 4, lifetime: 1, loop: false, emitter: { shape: 'point', mode: 'burst' } };
assert.equal(sampleProceduralParticles(burst, 0.5).length, 4, 'a one-shot burst remains alive inside its lifetime');
assert.equal(sampleProceduralParticles(burst, 1).length, 0, 'a one-shot burst expires after its lifetime');
const loopingBurst = { ...burst, loop: true };
assert.equal(sampleProceduralParticles(loopingBurst, 1.25).length, 4,
  'a looping burst emits a new batch after each lifetime');
assert.deepEqual(sampleProceduralParticles(loopingBurst, 1.25), sampleProceduralParticles(loopingBurst, 1.25),
  'looping burst cycles remain deterministic when scrubbing and rendering');
assert.ok(sampleProceduralParticles(loopingBurst, 1.25).every(particle => particle.age === 0.25),
  'looping burst particles restart their lifecycle age at each emission cycle');
const continuousOneShot = { count: 1, seed: 21, lifetime: 2, loop: false, fadeIn: 0.5,
  emitter: { shape: 'point', mode: 'continuous' }, velocity: { x: 1 }, gravity: {}, turbulence: 0 };
const continuousAtStart = sampleProceduralParticle(continuousOneShot, 0, 0);
const continuousLater = sampleProceduralParticle(continuousOneShot, 0, 0.1);
assert.ok(continuousAtStart.age > 0 && continuousAtStart.age < continuousOneShot.lifetime,
  'continuous one-shot particles retain their deterministic initial age');
assert.equal(Number((continuousLater.age - continuousAtStart.age).toFixed(6)), 0.1,
  'continuous one-shot particle age advances from its seeded phase');
assert.ok(continuousLater.position.x > continuousAtStart.position.x,
  'continuous one-shot particle travel uses the same seeded lifecycle clock');
const ringSamples = sampleProceduralParticles({ ...proceduralConfig, count: 32, emitter: { shape: 'ring', size: { x: 2, z: 2 }, innerRatio: 0.8 }, velocity: {}, gravity: {}, turbulence: 0 }, 0);
assert.ok(ringSamples.every(particle => Math.hypot(particle.position.x, particle.position.z) >= 1.55),
  'ring emitters preserve their authored inner radius');
function renderedProceduralParticleFrame(time, loop = true) {
  const canvas = Canvas.createCanvas(240, 240);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780 }, shadows: { enabled: false },
    particles: { count: 1, seed: 12, size: 0.06, speed: 1, lifetime: 2, fadeIn: 0, fadeOut: 0,
      loop, emitter: { shape: 'point', mode: 'burst' }, velocity: { x: 1, y: 0.5, z: 0 } },
    objects: [],
  }, time, 2, 240, 240, {});
  return canvas.getContext('2d').getImageData(0, 0, 240, 240).data;
}
assert.notDeepEqual(renderedProceduralParticleFrame(0.25), renderedProceduralParticleFrame(0.75),
  'procedural emitter motion changes the rendered scene pixels over time');
assert.deepEqual(renderedProceduralParticleFrame(0.25), renderedProceduralParticleFrame(2.25),
  'a looping burst remains visible and repeats its trajectory after a full particle lifetime');
const expiredOneShotFrame = renderedProceduralParticleFrame(2.25, false);
assert.ok(!expiredOneShotFrame.some((channel, index) => index % 4 === 3 && channel > 0),
  'a one-shot burst remains expired after its authored lifetime in the scene renderer');

function audioReactiveFrame(envelope) {
  const canvas = Canvas.createCanvas(240, 240);
  const context = canvas.getContext('2d');
  drawScene3D(context, {
    camera: { z: 7, fov: 780 }, ambient: 1,
    audioWaveformsByAsset: envelope ? { music: { peaks: envelope, duration: 1 } } : {},
    objects: [{ id: 'reactive-cube', type: 'box', position: { x: 0, y: 0, z: 0 },
      size: { x: 1, y: 1, z: 1 }, color: '#3578FF',
      audioReactive: { assetId: 'music', target: 'scale', amount: 1 } }],
  }, 0.5, 1, 240, 240, {});
  return context.getImageData(0, 0, 240, 240).data;
}
const silentReactiveFrame = audioReactiveFrame([0, 0, 0]);
const loudReactiveFrame = audioReactiveFrame([1, 1, 1]);
assert.notDeepEqual(silentReactiveFrame, loudReactiveFrame,
  'audio waveform data changes rendered 3D scene pixels through the reactive transform');
assert.deepEqual(audioReactiveFrame(null), silentReactiveFrame,
  'missing waveform data leaves audio-reactive objects at their authored transform');

function audioReactiveParticles(envelope, target = 'size') {
  const canvas = Canvas.createCanvas(240, 240);
  const context = canvas.getContext('2d');
  drawScene3D(context, {
    camera: { z: 7, fov: 80 }, shadows: { enabled: false },
    audioWaveformsByAsset: envelope ? { music: { peaks: envelope, duration: 1 } } : {},
    particles: { count: 24, seed: 9, spread: 3, size: 0.5, speed: 0.2, color: '#000000',
      audioReactive: { assetId: 'music', target, amount: 2 } },
    objects: [],
  }, 0.5, 1, 240, 240, {});
  return context.getImageData(0, 0, 240, 240).data;
}
const silentParticles = audioReactiveParticles([0, 0, 0]);
const loudParticles = audioReactiveParticles([1, 1, 1]);
assert.notDeepEqual(silentParticles, loudParticles,
  'audio waveform data changes deterministic 3D particle size');
assert.deepEqual(audioReactiveParticles(null), audioReactiveParticles([0, 0, 0]),
  'missing waveform data leaves audio-reactive particles at their authored settings');

function renderWireframeBox() {
  const canvas = Canvas.createCanvas(240, 240);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
    objects: [{ id: 'wire-box', type: 'box', position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 1 }, color: '#FFFFFF', wireframe: true, wireColor: '#FF0000', castsShadow: false }],
  }, 0, 1, 240, 240, {});
  return canvas.getContext('2d').getImageData(0, 0, 240, 240).data;
}
const wireframePixels = renderWireframeBox();
assert.ok(Array.from(wireframePixels).some((channel, index) => index % 4 === 3 && channel > 0), 'wireframe edges render through the depth-buffer path');
assert.equal(wireframePixels[(120 * 240 + 120) * 4 + 3], 0, 'wireframe faces remain transparent inside their edges');

function renderWireframeOverBackground() {
  const canvas = Canvas.createCanvas(240, 240);
  drawScene3D(canvas.getContext('2d'), { camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false }, objects: [
    { id: 'background-solid', type: 'box', position: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 0.4 }, color: '#00FF00', castsShadow: false },
    { id: 'foreground-frame', type: 'box', position: { x: 0, y: 0, z: 1 }, size: { x: 1.4, y: 1.4, z: 0.4 }, color: '#FFFFFF', wireframe: true, wireColor: '#FF0000', castsShadow: false },
  ] }, 0, 1, 240, 240, {});
  return canvas.getContext('2d').getImageData(120, 120, 1, 1).data;
}
const wireframeInterior = renderWireframeOverBackground();
assert.ok(wireframeInterior[1] > wireframeInterior[0], 'background geometry remains visible through a wireframe mesh interior');

function renderClippedTexturedPlane() {
  const texture = Canvas.createCanvas(4, 4);
  const textureCtx = texture.getContext('2d');
  textureCtx.fillStyle = '#00FF00';
  textureCtx.fillRect(0, 0, 4, 4);
  const canvas = Canvas.createCanvas(240, 240);
  const ctx = canvas.getContext('2d');
  drawScene3D(ctx, {
    camera: { z: 7, fov: 780, near: 6.5 }, ambient: 1, shadows: { enabled: false },
    objects: [{ id: 'clipped-image', type: 'image', imageUrl: 'test-texture', position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4 }, rotation: { x: 30, y: 0, z: 0 }, color: '#FF00FF', castsShadow: false }],
  }, 0, 1, 240, 240, { 'test-texture': texture });
  return ctx.getImageData(0, 0, 240, 240).data;
}
const clippedTexture = renderClippedTexturedPlane();
const clippedTextureCenter = (120 * 240 + 120) * 4;
assert.ok(clippedTexture[clippedTextureCenter + 1] > 220 && clippedTexture[clippedTextureCenter] < 40, 'image texture UVs survive partial near-plane clipping');

const translucentTexture = Canvas.createCanvas(4, 4);
const translucentTextureCtx = translucentTexture.getContext('2d');
translucentTextureCtx.fillStyle = 'rgba(0, 255, 0, 0.5)';
translucentTextureCtx.fillRect(0, 0, 4, 4);
const translucentTextureCanvas = Canvas.createCanvas(240, 240);
const translucentTextureCtx2D = translucentTextureCanvas.getContext('2d');
translucentTextureCtx2D.fillStyle = '#FF0000';
translucentTextureCtx2D.fillRect(0, 0, 240, 240);
drawScene3D(translucentTextureCtx2D, {
  camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
  objects: [{ id: 'alpha-texture', type: 'image', imageUrl: 'alpha-texture',
    position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4 }, castsShadow: false }],
}, 0, 1, 240, 240, { 'alpha-texture': translucentTexture });
const translucentTextureCenter = translucentTextureCtx2D.getImageData(120, 120, 1, 1).data;
assert.ok(translucentTextureCenter[0] >= 120 && translucentTextureCenter[0] <= 136
  && translucentTextureCenter[1] >= 120 && translucentTextureCenter[1] <= 136,
'partially transparent 3D texture pixels composite once over the existing background');

function renderPlaneMask(maskShape, forcePainterFallback = false, maskInvert = false) {
  const texture = Canvas.createCanvas(8, 8);
  const textureCtx = texture.getContext('2d');
  textureCtx.fillStyle = '#00FF00';
  textureCtx.fillRect(0, 0, 8, 8);
  const canvas = Canvas.createCanvas(240, 240);
  const ctx = canvas.getContext('2d');
  const target = forcePainterFallback ? new Proxy(ctx, {
    get(object, property) {
      if (property === 'getImageData' || property === 'putImageData') return undefined;
      const value = Reflect.get(object, property, object);
      return typeof value === 'function' ? value.bind(object) : value;
    },
    set(object, property, value) { return Reflect.set(object, property, value, object); },
  }) : ctx;
  drawScene3D(target, { camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false }, objects: [
    { id: `mask-${maskShape}`, type: 'image', imageUrl: 'mask-texture', maskShape, maskInvert,
      position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2 }, castsShadow: false },
  ] }, 0, 1, 240, 240, { 'mask-texture': texture });
  return ctx.getImageData(0, 0, 240, 240).data;
}
const unmaskedPlanePixels = renderPlaneMask('none');
const unmaskedPlaneAlpha = Array.from({ length: 240 * 240 }, (_, index) => unmaskedPlanePixels[index * 4 + 3]).reduce((sum, alpha) => sum + alpha, 0);
for (const shape of ['ellipse', 'circle', 'rounded-rectangle', 'rectangle', 'capsule', 'polygon', 'star', 'arrow']) {
  const pixels = renderPlaneMask(shape);
  const alpha = Array.from({ length: 240 * 240 }, (_, index) => pixels[index * 4 + 3]).reduce((sum, value) => sum + value, 0);
  assert.ok(pixels[(120 * 240 + 120) * 4 + 3] > 0, `${shape} keeps the image plane center visible`);
  if (shape !== 'rectangle') assert.ok(alpha < unmaskedPlaneAlpha * 0.995, `${shape} clips the textured plane (${alpha} vs ${unmaskedPlaneAlpha})`);
  if (shape !== 'rectangle') {
    const fallbackPixels = renderPlaneMask(shape, true);
    const fallbackAlpha = Array.from({ length: 240 * 240 }, (_, index) => fallbackPixels[index * 4 + 3]).reduce((sum, value) => sum + value, 0);
    assert.ok(fallbackAlpha < unmaskedPlaneAlpha * 0.995, `${shape} is also clipped when pixel-readback rendering is unavailable`);

    for (const fallback of [false, true]) {
      const inversePixels = renderPlaneMask(shape, fallback, true);
      const inverseAlpha = Array.from({ length: 240 * 240 }, (_, index) => inversePixels[index * 4 + 3]).reduce((sum, value) => sum + value, 0);
      assert.equal(inversePixels[(120 * 240 + 120) * 4 + 3], 0, `${shape} inverse removes the center in ${fallback ? 'painter' : 'depth'} rendering`);
      assert.ok(inverseAlpha > 1000, `${shape} inverse reveals the outside area in ${fallback ? 'painter' : 'depth'} rendering`);
    }
  }
}

const meshTexture = Canvas.createCanvas(8, 4);
const meshTextureCtx = meshTexture.getContext('2d');
meshTextureCtx.fillStyle = '#FF0000'; meshTextureCtx.fillRect(0, 0, 4, 4);
meshTextureCtx.fillStyle = '#00FF00'; meshTextureCtx.fillRect(4, 0, 4, 4);
const customMeshCanvas = Canvas.createCanvas(320, 320);
drawScene3D(customMeshCanvas.getContext('2d'), {
  camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
  objects: [{ id: 'uv-mesh', type: 'mesh', imageUrl: 'mesh-texture', castsShadow: false,
    vertices: [{ x: -1.5, y: -1.5, z: 0 }, { x: 1.5, y: -1.5, z: 0 },
      { x: 1.5, y: 1.5, z: 0 }, { x: -1.5, y: 1.5, z: 0 }],
    faces: [[0, 1, 2, 3]], uvs: [[0, 1], [1, 1], [1, 0], [0, 0]],
  }],
}, 0, 1, 320, 320, { 'mesh-texture': meshTexture });
const meshTexturePixels = customMeshCanvas.getContext('2d');
const meshLeft = meshTexturePixels.getImageData(100, 160, 1, 1).data;
const meshRight = meshTexturePixels.getImageData(220, 160, 1, 1).data;
assert.ok(meshLeft[0] > 220 && meshLeft[1] < 40 && meshRight[1] > 220 && meshRight[0] < 40,
  'custom 3D meshes preserve authored UVs and draw image textures across triangulated faces');

const perspectiveTexture = Canvas.createCanvas(64, 8);
const perspectiveTextureContext = perspectiveTexture.getContext('2d');
for (let x = 0; x < 64; x++) {
  perspectiveTextureContext.fillStyle = `rgb(${Math.round(x / 63 * 255)}, 40, ${255 - Math.round(x / 63 * 255)})`;
  perspectiveTextureContext.fillRect(x, 0, 1, 8);
}
const perspectiveTextureScene = { camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false }, objects: [
  { id: 'perspective-texture', type: 'image', imageUrl: 'perspective-texture',
    position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4 }, rotation: { y: 55 }, castsShadow: false },
] };
const renderPerspectiveTexture = (forcePainterFallback) => {
  const canvas = Canvas.createCanvas(320, 320);
  const context = canvas.getContext('2d');
  const target = forcePainterFallback ? new Proxy(context, {
    get(object, property) {
      if (property === 'getImageData' || property === 'putImageData') return undefined;
      const value = Reflect.get(object, property, object);
      return typeof value === 'function' ? value.bind(object) : value;
    },
    set(object, property, value) { return Reflect.set(object, property, value, object); },
  }) : context;
  drawScene3D(target, perspectiveTextureScene, 0, 1, 320, 320, { 'perspective-texture': perspectiveTexture });
  return context.getImageData(0, 0, 320, 320).data;
};
const perspectivePrimary = renderPerspectiveTexture(false);
const perspectiveFallback = renderPerspectiveTexture(true);
let perspectiveError = 0, perspectiveSamples = 0;
for (let y = 100; y <= 220; y += 12) {
  for (let x = 100; x <= 220; x += 12) {
    const offset = (y * 320 + x) * 4;
    if (perspectivePrimary[offset + 3] < 240) continue;
    perspectiveError += Math.abs(perspectivePrimary[offset] - perspectiveFallback[offset])
      + Math.abs(perspectivePrimary[offset + 1] - perspectiveFallback[offset + 1])
      + Math.abs(perspectivePrimary[offset + 2] - perspectiveFallback[offset + 2]);
    perspectiveSamples++;
  }
}
assert.ok(perspectiveSamples > 40 && perspectiveError / perspectiveSamples < 45,
  'painter fallback texture mapping remains close to perspective-correct depth rendering on a tilted plane');

function frameForDelayedAnimation(time, { objectAnimation = true, cameraAnimation = false, cameraExpression = null } = {}) {
  const canvas = Canvas.createCanvas(240, 240);
  const object = {
    id: 'animated-box', type: 'box', position: { x: 0, y: 0, z: 0 }, size: { x: 0.9, y: 0.9, z: 0.9 },
    color: '#FFFFFF', castsShadow: false,
    ...(objectAnimation ? { animations: [{ startTime: 1, duration: 1, keyframes: [
      { time: 0, properties: { x: 3 } }, { time: 1, properties: { x: 3 } },
    ] }] } : {}),
  };
  const camera = {
    z: 7,
    ...(cameraExpression ? { expressions: typeof cameraExpression === 'string' ? { x: cameraExpression } : cameraExpression } : {}),
    ...(cameraAnimation ? { animations: [{ startTime: 1, duration: 1, keyframes: [
      { time: 0, properties: { x: 3 } }, { time: 1, properties: { x: 3 } },
    ] }] } : {}),
  };
  drawScene3D(canvas.getContext('2d'), { camera, ambient: 0.8, shadows: { enabled: false }, objects: [object] }, time, 2, 240, 240, {});
  return Array.from(canvas.getContext('2d').getImageData(0, 0, 240, 240).data);
}
const staticFrame = frameForDelayedAnimation(0, { objectAnimation: false, cameraAnimation: false });
assert.deepEqual(frameForDelayedAnimation(0), staticFrame, '3D object animation leaves its base transform intact before its start time');
assert.notDeepEqual(frameForDelayedAnimation(1), staticFrame, '3D object animation applies its first keyframe at the configured start time');
assert.deepEqual(frameForDelayedAnimation(0, { objectAnimation: false, cameraAnimation: true }), staticFrame, '3D camera animation leaves the base camera intact before its start time');
assert.notDeepEqual(frameForDelayedAnimation(1, { objectAnimation: false, cameraAnimation: true }), staticFrame, '3D camera animation applies at the configured start time');
assert.notDeepEqual(frameForDelayedAnimation(0, { objectAnimation: false, cameraExpression: '3' }), staticFrame,
  '3D camera expressions procedurally change camera position in the shared renderer');
assert.ok(frameForDelayedAnimation(0, { objectAnimation: false, cameraExpression: { near: '8' } })
  .every((channel, index) => index % 4 !== 3 || channel === 0),
  '3D camera expressions can animate near clipping and remove objects outside the resulting frustum');

function renderExpressionValueScene(scene) {
  const canvas = Canvas.createCanvas(160, 160);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780, ...(scene.camera || {}) },
    ambient: 0.8, shadows: { enabled: false },
    lights: scene.lights || [],
    objects: scene.objects || [{ id: 'value-expression-box', type: 'box', position: { x: 0, y: 0, z: 0 },
      size: { x: 1.2, y: 1.2, z: 1 }, color: '#D83838', castsShadow: false }],
  }, 0, 2, 160, 160, {});
  return Array.from(canvas.getContext('2d').getImageData(0, 0, 160, 160).data);
}
const keyedObjectPosition = { id: 'value-expression-box', type: 'box', position: { x: 0, y: 0, z: 0 },
  size: { x: 1.2, y: 1.2, z: 1 }, color: '#D83838', castsShadow: false,
  animations: [{ startTime: 0, duration: 1, keyframes: [{ time: 0, properties: { x: 1 } }] }],
  expressions: { x: 'value + 1' } };
assert.deepEqual(renderExpressionValueScene({ objects: [keyedObjectPosition] }),
  renderExpressionValueScene({ objects: [{ ...keyedObjectPosition, position: { x: 2, y: 0, z: 0 }, animations: [], expressions: {} }] }),
  '3D object expressions compose on the resolved keyframed property value');
const keyedCamera = { x: 1, z: 7, fov: 780,
  animations: [{ startTime: 0, duration: 1, keyframes: [{ time: 0, properties: { x: 1 } }] }],
  expressions: { x: 'value + 1' } };
assert.deepEqual(renderExpressionValueScene({ camera: keyedCamera }),
  renderExpressionValueScene({ camera: { x: 2, z: 7, fov: 780 } }),
  '3D camera expressions compose on the resolved keyframed property value');
const lookAtYaw = Math.atan2(1, 7) * 180 / Math.PI;
assert.deepEqual(renderExpressionValueScene({ camera: { lookAt: { x: 1, y: 0, z: 0 }, expressions: { yaw: 'value + 10' } } }),
  renderExpressionValueScene({ camera: { yaw: lookAtYaw + 10 } }),
  'camera angle expressions build on the orientation derived from look-at when no angle track is authored');
const keyedLight = { type: 'point', position: { x: 0, y: 2, z: 4 }, intensity: 0.2, range: 24, decay: 0.3,
  animations: [{ startTime: 0, duration: 1, keyframes: [{ time: 0, properties: { intensity: 0.5 } }] }],
  expressions: { intensity: 'value + 0.5' } };
assert.deepEqual(renderExpressionValueScene({ lights: [keyedLight] }), renderExpressionValueScene({
  lights: [{ type: 'point', position: { x: 0, y: 2, z: 4 }, intensity: 1, range: 24, decay: 0.3 }],
}), '3D light expressions compose on the resolved keyframed property value');

function frameForAnimatedLight(time, animated = true) {
  const canvas = Canvas.createCanvas(160, 160);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780 }, ambient: 0.02, shadows: { enabled: false },
    lights: [{ type: 'point', position: { x: -2, y: 2, z: 4 }, intensity: 0.2, range: 24, decay: 0.3,
      ...(animated ? { animations: [{ startTime: 1, duration: 1, keyframes: [
        { time: 0, properties: { intensity: 0.2, positionX: -2 } },
        { time: 1, properties: { intensity: 4, positionX: 2 } },
      ] }] } : {}) }],
    objects: [{ id: 'light-test-box', type: 'box', position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 1 }, color: '#888888', castsShadow: false }],
  }, time, 2, 160, 160, {});
  return Array.from(canvas.getContext('2d').getImageData(0, 0, 160, 160).data);
}
assert.deepEqual(frameForAnimatedLight(0), frameForAnimatedLight(0, false), '3D light animation preserves its base values before its start time');
assert.notDeepEqual(frameForAnimatedLight(2), frameForAnimatedLight(0, false), '3D light intensity and position keyframes affect rendered scene frames');

assert.deepEqual(Object.keys(SCENE3D_PRIMITIVES), ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'image', 'video', 'text', 'mesh']);
assert.deepEqual(SCENE3D_CAMERA_DEFAULTS, {
  x: 0, y: 0, z: 7, yaw: 0, pitch: 0, roll: 0, fov: 780, orthoScale: 180, near: 0.05, far: 1000,
}, '3D camera defaults include every animatable camera channel and match renderer fallbacks');
const malformedMeshCanvas = Canvas.createCanvas(120, 120);
assert.doesNotThrow(() => drawScene3D(malformedMeshCanvas.getContext('2d'), {
  camera: { z: 7 }, ambient: 1, shadows: { enabled: false },
  objects: [{ id: 'bad-mesh', type: 'mesh', vertices: [
    { x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 },
  ], faces: [[0, 1, 2, 99]], castsShadow: false }],
}, 0, 1, 120, 120), 'malformed custom mesh indices are discarded before polygon triangulation');
assert.equal(remapSceneObjectTime({ speed: 1, duration: 2, mode: 'ping-pong' }, 2.5, 4), 1.5);
assert.equal(remapSceneObjectTime({ speed: -1, duration: 3 }, 0.5, 3), 2.5);
assert.equal(remapSceneObjectTime({ speed: 2, duration: 3, offset: 1, mode: 'loop' }, 2, 3), 2);
const reverseLoopStart = remapSceneObjectTime({ speed: -1, duration: 3, mode: 'loop' }, 0, 3);
assert.ok(reverseLoopStart < 3 && reverseLoopStart > 2.999,
  'reverse loop starts at the final valid source instant instead of wrapping to zero');
assert.ok(Math.abs(remapSceneObjectTime({ speed: -1, duration: 3, mode: 'loop' }, 0.5, 3) - 2.5) < 2e-6,
  'reverse loop advances backward smoothly from its final source instant');
assert.equal(remapSceneObjectTime({ speed: -1, duration: 3, mode: 'ping-pong' }, 4, 3), 1);
assert.equal(remapSceneObjectTime({ speed: 1, duration: 3, offset: 100, mode: 'clamp' }, 1, 3), 3);
assert.equal(remapSceneObjectTime({ duration: 8, keyframes: [{ time: 2, value: 6 }, { time: 0, value: 0 }] }, 1, 8), 3,
  'time-remap keyframes interpolate in composition-local time and are sorted before sampling');
assert.equal(remapSceneObjectTime({ duration: 4, mode: 'loop', keyframes: [{ time: 0, value: 0 }, { time: 1, value: 5 }] }, 1, 4), 1,
  'loop mode wraps a keyframed source time into the remap span');
assert.equal(remapSceneObjectTime({ duration: 4, keyframes: [{ time: 0, value: 9 }, { time: 1, value: 1 }] }, 0, 4), 4,
  'clamp mode bounds keyframed source time to the remap span');
assert.equal(remapSceneObjectTime({ duration: 10, speed: 4, offset: 7, keyframes: [
  { time: 0, value: 2 }, { time: 1, value: 4 },
] }, 0.5, 10), 3, 'an authored source-time curve takes precedence over speed and offset values');
assert.equal(resolveSceneVideoSourceTime({ videoStart: 1.25, videoSpeed: 2, timeRemap: { duration: 4, speed: 0.5 } }, 2, 4), 3.25,
  '3D video playback applies remapping, then source offset, then playback speed consistently');
assert.equal(resolveSceneVideoSourceTime({ videoStart: -2, videoSpeed: 0, timeRemap: { duration: 4, keyframes: [{ time: 0, value: 1 }] } }, 0, 4), 1,
  '3D video source time clamps invalid offsets and preserves normal speed for zero-valued defaults');
assert.equal(resolveSceneVideoSourceTime({ videoStart: 0, videoSpeed: -2, timeRemap: { duration: 4, keyframes: [{ time: 0, value: 1 }] } }, 0, 4), 0.05,
  'negative 3D video playback speed is clamped to the supported minimum');
const easedRemap = { duration: 4, keyframes: [
  { time: 0, value: 0 }, { time: 1, value: 2, easing: 'backOut' },
] };
assert.ok(maxSceneObjectSourceTime(easedRemap, 1, 20) > 2,
  'source extraction range includes eased remap overshoot between keyframe endpoints');
assert.equal(maxSceneObjectSourceTime({ duration: 4, speed: 1, mode: 'loop' }, 1, 20), 4,
  'looping remaps extract a full source span even when output duration is shorter');
const linearRemap = { duration: 10, keyframes: [{ time: 0, value: 0 }, { time: 2, value: 10 }] };
assert.equal(maxSceneObjectSourceTime(linearRemap, 1, 1), 5,
  'the regular source bound follows rendered frame times');
assert.equal(maxSceneObjectSourceTime(linearRemap, 1, 1, [1.4]), 7,
  'extra shutter timestamps extend source extraction through motion-blur samples');
assert.deepEqual(getSceneShutterSampleTimes(2, 1, 2, { enabled: false }), [1],
  'a scene without motion blur samples only the regular output frame time');
assert.deepEqual(getSceneShutterSampleTimes(2, 1, 2, { enabled: true, samples: 3, frameRate: 30, shutterAngle: 180 }), [
  1 - 1 / 180, 1, 1 + 1 / 180,
], 'preview and export share deterministic shutter sample timestamps');
assert.deepEqual(getSceneShutterSampleTimes(2, 1, 2, { enabled: true, samples: null, frameRate: 0, shutterAngle: null }), [
  1 - 1 / 180, 1, 1 + 1 / 180,
], 'missing shutter values retain the renderer defaults');

const malformedHierarchy = { objects: [
  { id: 'cycle-a', parentId: 'cycle-b', position: { x: 2 } },
  { id: 'cycle-b', parentId: 'cycle-a', position: { x: 3 } },
  { id: 'orphan', parentId: 'missing-parent' },
] };
const duplicateObjectIds = normalizeScene3D({ objects: [
  { id: 'shared', position: { x: 1 } },
  { id: 'shared', position: { x: 8 } },
  { position: { x: 12 } },
] });
assert.deepEqual(duplicateObjectIds.scene.objects.map(object => object.id), [
  'shared', 'shared-duplicate-2', 'scene-object-3',
], '3D normalization assigns stable unique IDs before hierarchy lookup');
assert.equal(new Set(duplicateObjectIds.scene.objects.map(object => object.id)).size, 3,
  'normalized 3D scene object IDs are unique');
assert.equal(duplicateObjectIds.scene.objects[1].position.x, 8,
  'renaming a duplicate preserves its independently authored transform');
assert.ok(duplicateObjectIds.issues.some(issue => issue.includes('missing id')),
  '3D normalization reports repaired missing IDs');
const normalizedHierarchy = normalizeScene3D(malformedHierarchy);
assert.ok(normalizedHierarchy.issues.some(issue => issue.includes('cyclic parent chain')),
  '3D hierarchy validation reports parent cycles');
assert.ok(normalizedHierarchy.issues.some(issue => issue.includes('missing parent')),
  '3D hierarchy validation reports missing parents');
assert.ok(normalizedHierarchy.scene.objects.every(object => !object.parentId || ['cycle-a', 'cycle-b'].includes(object.parentId)),
  'invalid 3D parent edges are detached instead of creating partial transforms');
const normalizedHierarchyById = new Map(normalizedHierarchy.scene.objects.map(object => [object.id, object]));
assert.equal(normalizedHierarchyById.get('cycle-a').parentId, 'cycle-b', 'cycle recovery retains the first parent edge');
assert.equal(normalizedHierarchyById.get('cycle-b').parentId, undefined, 'cycle recovery removes the actual closing parent edge');
for (const object of normalizedHierarchy.scene.objects) {
  const chain = new Set();
  let cursor = object;
  while (cursor?.parentId) {
    assert.ok(!chain.has(cursor.id), `normalized 3D parent links are acyclic at ${cursor.id}`);
    chain.add(cursor.id);
    cursor = normalizedHierarchyById.get(cursor.parentId);
  }
}
assert.equal(malformedHierarchy.objects[0].parentId, 'cycle-b', '3D hierarchy normalization does not mutate persisted scene data');

function renderNestedHierarchy(objects) {
  const canvas = Canvas.createCanvas(160, 160);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false }, objects,
  }, 0, 1, 160, 160, {});
  return canvas.getContext('2d').getImageData(0, 0, 160, 160).data;
}
const deepObjects = [];
for (let index = 0; index < 20; index++) deepObjects.push({
  id: `deep-parent-${index}`, ...(index ? { parentId: `deep-parent-${index - 1}` } : {}),
  type: 'box', position: { x: 0.1, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 }, castsShadow: false,
});
deepObjects.push({ id: 'deep-leaf', parentId: 'deep-parent-19', type: 'sphere', position: { x: 0, y: 0, z: 0 },
  radius: 0.35, color: '#FFFFFF', castsShadow: false });
assert.deepEqual(renderNestedHierarchy(deepObjects), renderNestedHierarchy([
  { id: 'flat-leaf', type: 'sphere', position: { x: 2, y: 0, z: 0 }, radius: 0.35, color: '#FFFFFF', castsShadow: false },
]), 'all transforms in a 20-level hierarchy reach the rendered leaf');
const excessiveHierarchy = normalizeScene3D({ objects: Array.from({ length: 132 }, (_, index) => ({
  id: `excessive-${index}`, ...(index ? { parentId: `excessive-${index - 1}` } : {}),
})) });
assert.ok(excessiveHierarchy.issues.some(issue => issue.includes('parent chain exceeds 128 levels')),
  'pathological 3D nesting is explicitly reported when the safety limit repairs it');

function renderPrimitive(type, radius, size = { x: 1, y: 1, z: 1 }) {
  const canvas = Canvas.createCanvas(96, 96);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7 }, ambient: 0.8, shadows: { enabled: false },
    objects: [{ id: 'cached-primitive', type, radius, size, castsShadow: false }],
  }, 0, 1, 96, 96);
  return canvas.toBuffer('image/png');
}
assert.deepEqual(renderPrimitive('sphere', 0.65), renderPrimitive('sphere', 0.65),
  'cached primitive geometry preserves deterministic frame output');
assert.notDeepEqual(renderPrimitive('sphere', 0.35), renderPrimitive('sphere', 0.9),
  'primitive cache keys include geometry dimensions so edits never reuse stale meshes');
assert.notDeepEqual(renderPrimitive('box', 0.65, { x: 0.5, y: 1, z: 1 }), renderPrimitive('box', 0.65, { x: 1.5, y: 1, z: 1 }),
  'primitive cache keys include box dimensions');

function renderConcaveMesh() {
  const canvas = Canvas.createCanvas(240, 240);
  drawScene3D(canvas.getContext('2d'), { camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
    objects: [{ id: 'concave-l', type: 'mesh', color: '#00FF00', castsShadow: false,
      vertices: [
        { x: -1, y: -1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 1, y: -1, z: 0 },
        { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: -1, y: 1, z: 0 },
      ], faces: [[0, 1, 2, 3, 4, 5, 6]],
    }],
  }, 0, 1, 240, 240, {});
  const pixels = canvas.getContext('2d').getImageData(0, 0, 240, 240).data;
  return {
    inside: pixels[(64 * 240 + 64) * 4 + 3],
    concavity: pixels[(64 * 240 + 176) * 4 + 3],
  };
}
const concaveMeshPixels = renderConcaveMesh();
assert.ok(concaveMeshPixels.inside > 0, 'ear-clipped custom polygons render their concave arms');
assert.equal(concaveMeshPixels.concavity, 0, 'ear-clipped custom polygons leave concave cutouts empty');
assert.equal(sampleAudioEnvelope([0, 1, 0], 0.5, 1), 1);
assert.equal(sampleAudioEnvelope([0, 1, 0], 2, 1), 0);
assert.equal(evaluateMotionExpression('1 + 0.12 * sin(2 * pi * t)', { t: 0.25 }), 1.12);
assert.equal(evaluateMotionExpression('clamp(progress * 2, 0, 1)', { progress: 0.75 }), 1);
assert.equal(evaluateMotionExpression('globalThis.process.exit()', {}), null, 'expressions cannot access JavaScript globals');
assert.equal(evaluateMotionExpression('progres * 2', { progress: 0.5 }), null, 'unknown variables fail instead of silently becoming zero');
assert.equal(evaluateMotionExpression('1 / 0', {}), null, 'non-finite expression results are rejected');
assert.equal(evaluateMotionExpression('-2^2'), -4, 'exponentiation binds more tightly than unary signs');
assert.equal(evaluateMotionExpression('2^-2'), 0.25, 'signed exponents evaluate correctly');
assert.equal(evaluateMotionExpression('2^3^2'), 512, 'exponentiation remains right-associative');
function frameWithExpression(time) {
  const canvas = Canvas.createCanvas(240, 240);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
    objects: [{ id: 'procedural-box', type: 'box', position: { x: 0, y: 0, z: 0 },
      size: { x: 1, y: 1, z: 1 }, color: '#FFFFFF', castsShadow: false,
      expressions: { x: '2 * t' } }],
  }, time, 2, 240, 240, {});
  return Array.from(canvas.getContext('2d').getImageData(0, 0, 240, 240).data);
}
assert.notDeepEqual(frameWithExpression(0), frameWithExpression(1), 'procedural expressions change actual rendered frames over time');
const parentRotation = { x: 0, y: 90, z: 0 };
const childRotation = { x: 90, y: 0, z: 0 };
const combinedRotation = composeSceneRotation(parentRotation, childRotation);
const probe = { x: 0.3, y: -0.4, z: 0.8 };
const sequentiallyRotated = (() => {
  const local = { ...probe };
  const localX = childRotation.x * Math.PI / 180;
  const afterX = { x: local.x, y: local.y * Math.cos(localX) - local.z * Math.sin(localX), z: local.y * Math.sin(localX) + local.z * Math.cos(localX) };
  const parentY = parentRotation.y * Math.PI / 180;
  const afterY = { x: afterX.x * Math.cos(parentY) + afterX.z * Math.sin(parentY), y: afterX.y, z: -afterX.x * Math.sin(parentY) + afterX.z * Math.cos(parentY) };
  return afterY;
})();
const composedProbe = (() => {
  const x = combinedRotation.x * Math.PI / 180, y = combinedRotation.y * Math.PI / 180, z = combinedRotation.z * Math.PI / 180;
  let { x: px, y: py, z: pz } = probe;
  [py, pz] = [py * Math.cos(x) - pz * Math.sin(x), py * Math.sin(x) + pz * Math.cos(x)];
  [px, pz] = [px * Math.cos(y) + pz * Math.sin(y), -px * Math.sin(y) + pz * Math.cos(y)];
  [px, py] = [px * Math.cos(z) - py * Math.sin(z), px * Math.sin(z) + py * Math.cos(z)];
  return { x: px, y: py, z: pz };
})();
assert.ok(Math.hypot(composedProbe.x - sequentiallyRotated.x, composedProbe.y - sequentiallyRotated.y, composedProbe.z - sequentiallyRotated.z) < 1e-6,
  'mixed-axis parent and child rotations compose in the same order as hierarchical transforms');
const parentAffine = composeSceneTransform({}, {}, {}, { x: 2, y: 1, z: 1 });
const childAffine = composeSceneTransform(parentAffine, { x: 1, y: 0, z: 0 }, { z: 45 }, { x: 1, y: 1, z: 1 });
const transformedChildPoint = {
  x: childAffine.position.x + childAffine.matrix[0],
  y: childAffine.position.y + childAffine.matrix[3],
  z: childAffine.position.z + childAffine.matrix[6],
};
assert.ok(Math.abs(childAffine.position.x - 2) < 1e-6 && Math.abs(childAffine.position.y) < 1e-6,
  'child position follows the parent non-uniform scale');
assert.ok(Math.abs(transformedChildPoint.x - (2 + Math.SQRT1_2 * 2)) < 1e-6
  && Math.abs(transformedChildPoint.y - Math.SQRT1_2) < 1e-6,
  'nested rotation preserves the affine shear induced by a non-uniformly scaled parent');

const videoFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene3d-video-start-'));
try {
  const meshTexturePath = path.join(videoFixtureDir, 'custom-mesh-texture.png');
  fs.writeFileSync(meshTexturePath, meshTexture.toBuffer('image/png'));
  const customMeshExport = await renderTemplateFrames({ kind: '3d-scene', params: { scene: {
    camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
    objects: [{ id: 'export-uv-mesh', type: 'mesh', imageUrl: 'custom-mesh-texture', castsShadow: false,
      vertices: [{ x: -1.5, y: -1.5, z: 0 }, { x: 1.5, y: -1.5, z: 0 },
        { x: 1.5, y: 1.5, z: 0 }, { x: -1.5, y: 1.5, z: 0 }],
      faces: [[0, 1, 2, 3]], uvs: [[0, 1], [1, 1], [1, 0], [0, 0]],
    }],
  } } }, { durationSec: 1, fps: 1, widthPx: 320, tmpDir: videoFixtureDir,
    name: 'custom-mesh-texture', imageFiles: { 'custom-mesh-texture': meshTexturePath } });
  const customMeshExportFrame = await Canvas.loadImage(fs.readFileSync(customMeshExport.files[0]));
  const customMeshExportCanvas = Canvas.createCanvas(customMeshExportFrame.width, customMeshExportFrame.height);
  const customMeshExportCtx = customMeshExportCanvas.getContext('2d');
  customMeshExportCtx.drawImage(customMeshExportFrame, 0, 0);
  const exportLeft = customMeshExportCtx.getImageData(130, Math.floor(customMeshExportFrame.height / 2), 1, 1).data;
  const exportRight = customMeshExportCtx.getImageData(190, Math.floor(customMeshExportFrame.height / 2), 1, 1).data;
  assert.ok(exportLeft[0] > 220 && exportLeft[1] < 40 && exportRight[1] > 220 && exportRight[0] < 40,
    'custom mesh UV texture mapping is preserved in exported 3D frames');

  async function exportConcaveShadow(enabled) {
    const result = await renderTemplateFrames({ kind: '3d-scene', params: {
      scene: concaveShadowScene(enabled), w: 320, h: 320,
    } }, { durationSec: 1, fps: 1, widthPx: 320, tmpDir: videoFixtureDir,
      name: `concave-shadow-${enabled ? 'on' : 'off'}` });
    const image = await Canvas.loadImage(fs.readFileSync(result.files[0]));
    const canvas = Canvas.createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 320, 320);
    return context.getImageData(0, 0, 320, 320).data;
  }
  const concaveExportOn = await exportConcaveShadow(true);
  const concaveExportOff = await exportConcaveShadow(false);
  assert.deepEqual(Array.from(concaveExportOn.slice(notchOffset, notchOffset + 3)),
    Array.from(concaveExportOff.slice(notchOffset, notchOffset + 3)),
    'exported concave-mesh shadows preserve the authored notch');
  assert.ok(concaveExportOn[solidShadowOffset] < concaveExportOff[solidShadowOffset] - 20,
    'exported custom meshes still cast shadows beneath solid sections');

  const videoFrame = color => {
    const frame = Canvas.createCanvas(16, 16);
    const frameCtx = frame.getContext('2d');
    frameCtx.fillStyle = color;
    frameCtx.fillRect(0, 0, 16, 16);
    const framePath = path.join(videoFixtureDir, `${color.slice(1)}.png`);
    fs.writeFileSync(framePath, frame.toBuffer('image/png'));
    return framePath;
  };
  const sourceFrames = [videoFrame('#FF0000'), videoFrame('#00FF00')];
  const scene = {
    camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
    objects: [{ id: 'texture-video', type: 'video', videoTextureKey: 'texture-video', videoUrl: 'fixture', videoStart: 1,
      position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4 }, castsShadow: false }],
  };
  const sequence = await renderTemplateFrames({ kind: '3d-scene', params: { scene } }, {
    durationSec: 1, fps: 1, widthPx: 108, tmpDir: videoFixtureDir, name: 'video-start',
    videoFrameFiles: { 'texture-video': sourceFrames },
  });
  const rendered = await Canvas.loadImage(fs.readFileSync(sequence.files[0]));
  const renderedCanvas = Canvas.createCanvas(rendered.width, rendered.height);
  const renderedCtx = renderedCanvas.getContext('2d');
  renderedCtx.drawImage(rendered, 0, 0);
  const center = renderedCtx.getImageData(Math.floor(rendered.width / 2), Math.floor(rendered.height / 2), 1, 1).data;
  assert.ok(center[1] > 220 && center[0] < 40, '3D video texture export starts at videoStart, matching editor preview');
  const shutterScene = {
    ...scene,
    motionBlur: { enabled: true, samples: 3, shutterAngle: 360, frameRate: 4 },
    objects: [{ ...scene.objects[0], videoStart: 0 }],
  };
  const shutterSequence = await renderTemplateFrames({ kind: '3d-scene', params: { scene: shutterScene } }, {
    durationSec: 1, fps: 4, widthPx: 108, tmpDir: videoFixtureDir, name: 'video-texture-shutter',
    videoFrameFiles: { 'texture-video': sourceFrames },
  });
  const shutterFrame = await Canvas.loadImage(fs.readFileSync(shutterSequence.files[1]));
  const shutterCanvas = Canvas.createCanvas(shutterFrame.width, shutterFrame.height);
  const shutterCtx = shutterCanvas.getContext('2d');
  shutterCtx.drawImage(shutterFrame, 0, 0);
  const shutterCenter = shutterCtx.getImageData(Math.floor(shutterFrame.width / 2), Math.floor(shutterFrame.height / 2), 1, 1).data;
  assert.ok(shutterCenter[0] > 45 && shutterCenter[1] > 120,
    `3D shutter samples fetch their own video texture frames and blend them (${[...shutterCenter]})`);
  const extractedSequence = await renderTemplateFrames({ kind: '3d-scene', params: { scene } }, {
    durationSec: 1, fps: 1, widthPx: 108, tmpDir: videoFixtureDir, name: 'video-start-offset-sequence',
    videoFrameFiles: { 'texture-video': { frames: sourceFrames.slice(1), startTime: 1 } },
  });
  const extractedRender = await Canvas.loadImage(fs.readFileSync(extractedSequence.files[0]));
  const extractedCanvas = Canvas.createCanvas(extractedRender.width, extractedRender.height);
  const extractedCtx = extractedCanvas.getContext('2d');
  extractedCtx.drawImage(extractedRender, 0, 0);
  const extractedCenter = extractedCtx.getImageData(Math.floor(extractedRender.width / 2), Math.floor(extractedRender.height / 2), 1, 1).data;
  assert.ok(extractedCenter[1] > 220 && extractedCenter[0] < 40, 'bounded frame sequences subtract their extraction start instead of applying videoStart twice');
  const remappedScene = { ...scene, objects: [{ ...scene.objects[0], videoStart: 0,
    timeRemap: { duration: 3, keyframes: [{ time: 0, value: 2 }, { time: 1, value: 0 }] } }] };
  const remappedSequence = await renderTemplateFrames({ kind: '3d-scene', params: { scene: remappedScene } }, {
    durationSec: 2, fps: 1, widthPx: 108, tmpDir: videoFixtureDir, name: 'video-time-remap',
    videoFrameFiles: { 'texture-video': [videoFrame('#0000FF'), videoFrame('#00FF00'), videoFrame('#FF0000')] },
  });
  const remappedFirst = await Canvas.loadImage(fs.readFileSync(remappedSequence.files[0]));
  const remappedCanvas = Canvas.createCanvas(remappedFirst.width, remappedFirst.height);
  const remappedCtx = remappedCanvas.getContext('2d');
  remappedCtx.drawImage(remappedFirst, 0, 0);
  const remappedCenter = remappedCtx.getImageData(Math.floor(remappedFirst.width / 2), Math.floor(remappedFirst.height / 2), 1, 1).data;
  assert.ok(remappedCenter[0] > 220 && remappedCenter[2] < 40, 'exported 3D video textures follow authored time-remap keyframes');
  const speedScene = { ...scene, objects: [{ ...scene.objects[0], videoStart: 0, videoSpeed: 2, videoLoop: false }] };
  const speedSequence = await renderTemplateFrames({ kind: '3d-scene', params: { scene: speedScene } }, {
    durationSec: 2, fps: 1, widthPx: 108, tmpDir: videoFixtureDir, name: 'video-playback-speed',
    videoFrameFiles: { 'texture-video': [videoFrame('#0000FF'), videoFrame('#00FF00'), videoFrame('#FF0000')] },
  });
  const speedFrame = await Canvas.loadImage(fs.readFileSync(speedSequence.files[1]));
  const speedCanvas = Canvas.createCanvas(speedFrame.width, speedFrame.height);
  const speedCtx = speedCanvas.getContext('2d');
  speedCtx.drawImage(speedFrame, 0, 0);
  const speedCenter = speedCtx.getImageData(Math.floor(speedFrame.width / 2), Math.floor(speedFrame.height / 2), 1, 1).data;
  assert.ok(speedCenter[0] > 220 && speedCenter[1] < 40,
    'exported 3D video textures advance according to the authored playback speed');
  const animatedLightScene = {
    camera: { z: 7, fov: 780 }, ambient: 0.02, shadows: { enabled: false },
    lights: [{ type: 'point', position: { x: -2, y: 2, z: 4 }, intensity: 0.1,
      animations: [{ startTime: 0, duration: 1, keyframes: [
        { time: 0, properties: { intensity: 0.1, positionX: -2 } },
        { time: 1, properties: { intensity: 4, positionX: 2 } },
      ] }] }],
    objects: [{ id: 'export-light-box', type: 'box', position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 1 }, color: '#888888', castsShadow: false }],
  };
  const lightSequence = await renderTemplateFrames({ kind: '3d-scene', params: { scene: animatedLightScene } }, {
    durationSec: 1, fps: 2, widthPx: 108, tmpDir: videoFixtureDir, name: 'animated-light',
  });
  assert.notDeepEqual(fs.readFileSync(lightSequence.files[0]), fs.readFileSync(lightSequence.files[1]),
    '3D light keyframes change actual exported frame pixels');
  const expressiveLightScene = {
    ...animatedLightScene,
    lights: [{ type: 'point', position: { x: -2, y: 2, z: 4 }, intensity: 0.1,
      expressions: { intensity: '0.1 + 3.9 * t', positionX: '-2 + 4 * progress' } }],
  };
  const expressiveLightSequence = await renderTemplateFrames({ kind: '3d-scene', params: { scene: expressiveLightScene } }, {
    durationSec: 1, fps: 2, widthPx: 108, tmpDir: videoFixtureDir, name: 'expression-light',
  });
  assert.notDeepEqual(fs.readFileSync(expressiveLightSequence.files[0]), fs.readFileSync(expressiveLightSequence.files[1]),
    'procedural light expressions change actual exported 3D frame pixels');
  const audioScene = {
    camera: { z: 7, fov: 780 }, ambient: 1, shadows: { enabled: false },
    audioWaveformsByAsset: { music: { peaks: [0, 1], duration: 1 } },
    objects: [{ id: 'export-audio-cube', type: 'box', position: { x: 0, y: 0, z: 0 },
      size: { x: 1, y: 1, z: 1 }, color: '#3578FF', castsShadow: false,
      audioReactive: { assetId: 'music', target: 'scale', amount: 1 } }],
  };
  const audioSequence = await renderTemplateFrames({ kind: '3d-scene', params: { scene: audioScene } }, {
    durationSec: 1, fps: 2, widthPx: 240, tmpDir: videoFixtureDir, name: 'audio-reactive-export',
  });
  const audioFrames = await Promise.all(audioSequence.files.map(file => Canvas.loadImage(fs.readFileSync(file))));
  const audioPixels = await Promise.all(audioFrames.map(image => {
    const canvas = Canvas.createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  }));
  assert.notDeepEqual(audioPixels[0], audioPixels[1],
    'audio-reactive waveform data changes actual exported 3D frame pixels');
} finally {
  fs.rmSync(videoFixtureDir, { recursive: true, force: true });
}
const exportSource = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../jobs/exportProcessor.js'), 'utf8');
assert.match(exportSource, /object\?\.type !== 'video' \|\| \(!object\.videoUrl && !object\.videoAssetId\)/,
  'video textures selected by asset ID must be exported even when the asset has no direct URL');
assert.match(exportSource, /const videoAsset = object\.videoAssetId \? assetMap\[object\.videoAssetId\] : null/,
  'video texture export must resolve a selected asset URL through the export asset manifest');
for (const [width, height] of [[96, 96], [128, 96], [96, 128], [160, 96], [96, 160], [192, 96], [96, 192]]) {
  const canvas = Canvas.createCanvas(width, height);
  drawScene3D(canvas.getContext('2d'), {
    camera: { z: 7 }, motionBlur: { enabled: true, samples: 5, shutterAngle: 180 },
    objects: [{ id: 'blur-sphere', type: 'sphere', position: { x: 0, y: 0, z: 0 }, castsShadow: false }],
  }, 0.5, 1, width, height);
  const alpha = canvas.getContext('2d').getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data[3];
  assert.ok(alpha > 0, `five-sample motion blur renders at ${width}x${height}`);
}
{
  const objects = [
    { id: 'focused-near-object', type: 'box', position: { x: -1.3, y: 0, z: 2 }, size: { x: 1.2, y: 1.2, z: 0.8 }, color: '#FF0000', castsShadow: false },
    { id: 'defocused-far-object', type: 'box', position: { x: 1.3, y: 0, z: -2 }, size: { x: 1.2, y: 1.2, z: 0.8 }, color: '#0000FF', castsShadow: false },
  ];
  function renderDepthOfField(enabled) {
    const canvas = Canvas.createCanvas(240, 160);
    drawScene3D(canvas.getContext('2d'), {
      camera: { z: 10, fov: 780, depthOfField: enabled ? { enabled: true, focusDistance: 8, focusRange: 0.2, maxBlur: 8 } : { enabled: false } },
      ambient: 1, shadows: { enabled: false }, lights: [], objects,
    }, 0, 1, 240, 160);
    return canvas.getContext('2d').getImageData(0, 0, 240, 160).data;
  }
  const sharp = renderDepthOfField(false), defocused = renderDepthOfField(true);
  let focusedPlaneChanges = 0, farPlaneChanges = 0;
  for (let y = 0; y < 160; y++) for (let x = 0; x < 240; x++) {
    const i = (y * 240 + x) * 4;
    if (sharp[i] === defocused[i] && sharp[i + 1] === defocused[i + 1]
      && sharp[i + 2] === defocused[i + 2] && sharp[i + 3] === defocused[i + 3]) continue;
    if (x < 120 && sharp[i] > sharp[i + 2]) focusedPlaneChanges++;
    if (x >= 120 && (sharp[i + 2] > sharp[i] || defocused[i + 2] > defocused[i])) farPlaneChanges++;
  }
  assert.equal(focusedPlaneChanges, 0, 'depth of field leaves the configured focus plane sharp');
  assert.ok(farPlaneChanges > 0, 'depth of field visibly softens geometry outside the focus range');
  const renderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene3d-depth-of-field-'));
  try {
    const exportScene = dof => ({ camera: { z: 10, fov: 780, depthOfField: dof }, ambient: 1,
      shadows: { enabled: false }, lights: [], objects });
    const plainExport = await renderTemplateFrames({ kind: '3d-scene', params: { scene: exportScene({ enabled: false }), w: 240, h: 160 } }, {
      durationSec: 1, fps: 1, widthPx: 240, tmpDir: renderDir, name: 'sharp',
    });
    const defocusedExport = await renderTemplateFrames({ kind: '3d-scene', params: { scene: exportScene({ enabled: true, focusDistance: 8, focusRange: 0.2, maxBlur: 8 }), w: 240, h: 160 } }, {
      durationSec: 1, fps: 1, widthPx: 240, tmpDir: renderDir, name: 'defocused',
    });
    assert.notDeepEqual(fs.readFileSync(plainExport.files[0]), fs.readFileSync(defocusedExport.files[0]),
      'the server frame renderer exports the same depth-of-field treatment as preview');
  } finally {
    fs.rmSync(renderDir, { recursive: true, force: true });
  }
}
{
  function renderTransformedBlur(enabled) {
    const canvas = Canvas.createCanvas(320, 240);
    const ctx = canvas.getContext('2d');
    ctx.translate(24, 18);
    ctx.scale(1.5, 1.25);
    ctx.globalAlpha = 0.5;
    drawScene3D(ctx, {
      camera: { z: 7 }, motionBlur: { enabled, samples: 3, shutterAngle: 180 },
      objects: [{ id: 'transformed-blur-sphere', type: 'sphere', position: { x: 0, y: 0, z: 0 }, castsShadow: false }],
    }, 0.5, 1, 160, 160);
    const pixels = ctx.getImageData(0, 0, 320, 240).data;
    let alphaSum = 0, alphaMax = 0, weightedX = 0, weightedY = 0;
    for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) {
      const alpha = pixels[(y * 320 + x) * 4 + 3];
      alphaSum += alpha;
      alphaMax = Math.max(alphaMax, alpha);
      weightedX += x * alpha;
      weightedY += y * alpha;
    }
    return { alphaSum, alphaMax, x: weightedX / alphaSum, y: weightedY / alphaSum };
  }
  const blurred = renderTransformedBlur(true);
  const sharp = renderTransformedBlur(false);
  assert.ok(blurred.alphaSum > 0, 'motion-blurred 3D scene renders through a parent transform');
  assert.ok(blurred.alphaMax <= 128, 'motion-blurred 3D scene preserves parent opacity');
  assert.ok(Math.abs(blurred.x - sharp.x) < 5 && Math.abs(blurred.y - sharp.y) < 5,
    `motion-blurred 3D samples use the same active parent transform as the sharp render (${blurred.x.toFixed(1)}, ${blurred.y.toFixed(1)} vs ${sharp.x.toFixed(1)}, ${sharp.y.toFixed(1)})`);
}
{
  const canvas = Canvas.createCanvas(160, 160);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 160, 160);
  ctx.globalCompositeOperation = 'destination-out';
  drawScene3D(ctx, {
    camera: { z: 7 }, motionBlur: { enabled: true, samples: 3, shutterAngle: 180 },
    objects: [{ id: 'blended-blur-sphere', type: 'sphere', position: { x: 0, y: 0, z: 0 }, castsShadow: false }],
  }, 0.5, 1, 160, 160);
  const centerAlpha = ctx.getImageData(80, 80, 1, 1).data[3];
  assert.ok(centerAlpha < 255, 'motion-blurred 3D composite preserves the caller blend operation');
}
console.log('3D scene checks passed: clipping, depth occlusion, emissive and transparent materials, primitives, remapping, and audio envelope sampling are consistent.');
