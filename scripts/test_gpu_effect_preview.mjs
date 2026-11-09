import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GPUEffectEngine, GPU_SHADER_TYPES } from '../client/src/effects/engines/GPUEffects.js';
import { EFFECT_DEFINITIONS } from '../client/src/effects/EffectRegistry.js';
import { EffectRenderer } from '../client/src/effects/EffectRenderer.js';
import { EffectPipeline } from '../client/src/effects/EffectPipeline.js';
import { initEffectsEngine } from '../client/src/effects/index.js';
import { createGpuClipEffectConfigs, isGpuClipEffect } from '../client/src/effects/ClipEffectAdapter.js';
import { resolveTimelineEffectFilter, resolveTimelineVignetteStyle } from '../client/src/motion/TimelineVisualEffects.js';
import exportProcessor from '../jobs/exportProcessor.js';

const shaderDeletes = [], shaderDetaches = [], programDeletes = [], bufferDeletes = [], textureDeletes = [], framebufferDeletes = [];
const bootstrapGl = {
  VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
  ARRAY_BUFFER: 5, STATIC_DRAW: 6, TEXTURE_2D: 7, TEXTURE_WRAP_S: 8, TEXTURE_WRAP_T: 9,
  TEXTURE_MIN_FILTER: 10, TEXTURE_MAG_FILTER: 11, CLAMP_TO_EDGE: 12, LINEAR: 13,
  FRAMEBUFFER: 14, COLOR_ATTACHMENT0: 15,
  createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
  createTexture: () => ({}), bindTexture: () => {}, texParameteri: () => {},
  createFramebuffer: () => ({}), bindFramebuffer: () => {}, framebufferTexture2D: () => {},
  createShader: type => ({ type }), shaderSource: () => {}, compileShader: () => {},
  getShaderParameter: () => true, getShaderInfoLog: () => '', deleteShader: () => {},
  createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {},
  getProgramParameter: () => true, getProgramInfoLog: () => '', detachShader: () => {}, deleteProgram: () => {},
  getAttribLocation: () => 0, deleteBuffer: () => {}, deleteTexture: () => {}, deleteFramebuffer: () => {},
};
const initializedEffects = initEffectsEngine();
assert.ok(initializedEffects.pipeline && initializedEffects.renderer && initializedEffects.cpuEngine && initializedEffects.aiEngine,
  'the public effects engine factory initializes all browser modules without a CommonJS require');
let rendererGpu;
const attachedPipeline = { setGPUEngine: engine => { rendererGpu = engine; } };
const rendererBootstrap = new EffectRenderer({ pipeline: attachedPipeline });
rendererBootstrap.init(bootstrapGl);
assert.ok(rendererGpu instanceof GPUEffectEngine, 'renderer.init attaches a GPU engine from native ES modules');
rendererBootstrap.setPipeline({ setGPUEngine: engine => { rendererGpu = engine; } });
assert.ok(rendererGpu instanceof GPUEffectEngine, 'renderer.setPipeline reattaches the GPU engine from native ES modules');
rendererGpu.destroy();
initializedEffects.renderer.destroy();
const lifecycleGL = {
  VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
  createShader: type => ({ type }), shaderSource: () => {}, compileShader: () => {},
  getShaderParameter: () => true, getShaderInfoLog: () => '', deleteShader: shader => shaderDeletes.push(shader),
  createProgram: () => ({ id: 'program' }), attachShader: () => {}, linkProgram: () => {},
  getProgramParameter: () => true, getProgramInfoLog: () => '', detachShader: (_program, shader) => shaderDetaches.push(shader),
  deleteProgram: program => programDeletes.push(program), getAttribLocation: (_program, name) => name,
  deleteBuffer: buffer => bufferDeletes.push(buffer), deleteTexture: texture => textureDeletes.push(texture),
  deleteFramebuffer: framebuffer => framebufferDeletes.push(framebuffer),
};
const lifecycleEngine = Object.create(GPUEffectEngine.prototype);
Object.assign(lifecycleEngine, { gl: lifecycleGL, programs: new Map(), initialized: true,
  framebuffers: [{ id: 'fb0' }, { id: 'fb1' }], textures: [{ id: 'tex0' }, { id: 'tex1' }],
  positionBuffer: { id: 'positions' }, texCoordBuffer: { id: 'uvs' }, targetWidth: 1920, targetHeight: 1080 });
lifecycleEngine._compileShader('lifecycle', 'void main() {}');
assert.equal(lifecycleEngine.programs.size, 1, 'linked GPU shader program remains available for rendering');
assert.equal(shaderDeletes.length, 2, 'temporary shader objects are deleted after linking');
assert.equal(shaderDetaches.length, 2, 'temporary shaders are detached before deletion');
lifecycleEngine.destroy();
lifecycleEngine.destroy();
assert.equal(programDeletes.length, 1, 'GPU programs are released once and destroy is idempotent');
assert.equal(bufferDeletes.length, 2, 'GPU geometry buffers are released');
assert.equal(textureDeletes.length, 2, 'GPU render target textures are released');
assert.equal(framebufferDeletes.length, 2, 'GPU framebuffers are released');
assert.equal(lifecycleEngine.framebuffers.length, 0, 'destroy drops references to framebuffer handles');
assert.equal(lifecycleEngine.targetWidth, 0, 'destroy clears cached render target dimensions');

const source = fs.readFileSync(new URL('../client/src/engine/PlaybackEngine.js', import.meta.url), 'utf8');
const renderStart = source.indexOf('    render(frameItem) {');
const renderEnd = source.indexOf('\n    }', renderStart);
const renderSource = source.slice(renderStart, renderEnd);
assert.match(renderSource, /renderTexture\s*=\s*this\.effectsRenderer\.renderPreview/,
  'preview retains the GPU effects output');
assert.match(renderSource, /gl\.bindTexture\(gl\.TEXTURE_2D,\s*renderTexture\)/,
  'the visible frame shader samples the GPU effects output');
assert.match(renderSource, /renderTexture\s*=\s*this\.texture/,
  'effect failures fall back to the original source texture');
assert.match(renderSource, /sourceClipId:\s*this\.effectSourceClipId/,
  'the decoded source clip identity reaches the effect renderer');
assert.match(source, /setEffectSourceClipId\(clipId\)/,
  'PlaybackEngine exposes source-clip routing to the player');
assert.match(source, /setClipEffects\(clipId, effects = \[\], placement = \{\}\)/,
  'PlaybackEngine adapts direct clip effects into the shared GPU effect graph');
assert.match(source, /previewPlacements\.push\(this\.clipEffectPlacement\)/,
  'direct clip effects render even when no legacy timeline placement has been hydrated');
const playerSource = fs.readFileSync(new URL('../client/src/components/Player/VideoPlayer.jsx', import.meta.url), 'utf8');
assert.match(playerSource, /setEffectSourceClipId\?\.\(activeClip\?\.id\)/,
  'VideoPlayer tells the effect renderer which clip its decoded frame represents');
assert.match(playerSource, /setClipEffects\?\.\(activeClip\?\.id, activeClip\?\.effects \|\| \[\]/,
  'VideoPlayer routes direct footage effects to the decoded clip shader graph');

const calls = [];
const gl = {
  getUniformLocation: (_program, name) => name,
  uniform1f: (name, value) => calls.push([name, value]),
  uniform1i: (name, value) => calls.push([name, value]),
  uniform2f: (name, x, y) => calls.push([name, x, y]),
  uniform3f: (name, x, y, z) => calls.push([name, x, y, z]),
};
const engine = Object.create(GPUEffectEngine.prototype);
engine._setEffectUniforms(gl, {}, 'vignette', { intensity: 0, radius: 0, softness: 0, color: [0, 0, 0] });
assert.deepEqual(calls.filter(([name]) => ['u_intensity', 'u_radius', 'u_softness'].includes(name)), [
  ['u_intensity', 0], ['u_radius', 0], ['u_softness', 0],
], 'zero-valued GPU effect controls remain zero instead of being replaced by defaults');
assert.equal(EFFECT_DEFINITIONS.vignette.params.radius.max, 1.5, 'the vignette control allows its catalog maximum');
calls.length = 0;
engine._setEffectUniforms(gl, {}, 'vignette', { radius: 1.4 }, 0);
assert.deepEqual(calls.filter(([name]) => name === 'u_radius'), [['u_radius', 1.4]],
  'GPU vignette preview preserves radii above 1 instead of silently clamping them');
calls.length = 0;
engine._setEffectUniforms(gl, {}, 'vignette', {
  intensity: { value: 0.25 }, radius: { value: 1.2 }, softness: { value: 0.3 },
  color: { value: [0.2, 0.4, 0.6] },
});
assert.deepEqual(calls.filter(([name]) => ['u_intensity', 'u_radius', 'u_softness', 'u_color'].includes(name)), [
  ['u_intensity', 0.25], ['u_radius', 1.2], ['u_softness', 0.3], ['u_color', 0.2, 0.4, 0.6],
], 'GPU numeric and color controls honor serialized { value } parameters');
const radialShader = fs.readFileSync(new URL('../client/src/effects/engines/GPUEffects.js', import.meta.url), 'utf8');
const shaderBodies = [...radialShader.matchAll(/^\s{4}([a-z][a-z0-9_]*): `([\s\S]*?)`[,]?$/gm)];
assert.ok(shaderBodies.length >= GPU_SHADER_TYPES.length, 'shader source map can be inspected for uniform declarations');
for (const [, shaderName, body] of shaderBodies) {
  const declaredUniforms = new Set([...body.matchAll(/uniform\s+\w+\s+(u_[a-zA-Z0-9_]+)\s*;/g)].map(match => match[1]));
  const referencedUniforms = new Set([...body.matchAll(/\b(u_[a-zA-Z0-9_]+)\b/g)].map(match => match[1]));
  for (const uniformName of referencedUniforms) {
    assert.ok(declaredUniforms.has(uniformName), `${shaderName} references ${uniformName}, which must be declared`);
  }
}
assert.match(radialShader, /dist\s*>\s*0\.00001\s*\?\s*toCenter\s*\/\s*dist\s*:\s*vec2\(0\.0\)/,
  'radial blur uses a finite direction at its exact center pixel');
const radialStart = radialShader.indexOf('blur_radial: `');
const radialEnd = radialShader.indexOf('`,', radialStart);
const radialFragment = radialShader.slice(radialStart, radialEnd);
assert.match(radialFragment, /uniform\s+vec2\s+u_resolution\s*;/,
  'radial blur declares the resolution uniform used to calculate aspect-correct samples');
const gradeStart = radialShader.indexOf('color_grade: `');
const gradeEnd = radialShader.indexOf('`,', gradeStart);
const gradeShader = radialShader.slice(gradeStart, gradeEnd);
assert.match(gradeShader, /rgb\s*=\s*clamp\(rgb,\s*0\.0,\s*1\.0\);[\s\S]*vec3\s+hsl\s*=\s*rgb2hsl\(rgb\)/,
  'color grading clips out-of-range RGB values before the RGB-to-HSL conversion');
assert.match(gradeShader, /rgb\s*\*=\s*u_brightness\s*\/\s*100\.0;\s*rgb\s*=\s*clamp\(rgb,\s*0\.0,\s*1\.0\);[\s\S]*rgb\s*=\s*\(rgb\s*-\s*0\.5\)\s*\*\s*\(u_contrast\s*\/\s*100\.0\)\s*\+\s*0\.5;\s*rgb\s*=\s*clamp\(rgb,\s*0\.0,\s*1\.0\)/,
  'brightness and contrast stage outputs stay in range like the export filter stages');

calls.length = 0;
engine._setEffectUniforms(gl, {}, 'film_grain', { intensity: 0.4, size: 3, animated: false }, 2.5);
assert.deepEqual(calls.filter(([name]) => ['u_intensity', 'u_size', 'u_animated', 'u_time'].includes(name)), [
  ['u_intensity', 0.4], ['u_size', 3], ['u_animated', 0], ['u_time', 0],
], 'film grain preview honors size and can freeze its animation');
calls.length = 0;
engine._setEffectUniforms(gl, {}, 'film_grain', { animated: { value: true } }, 2.5);
assert.deepEqual(calls.filter(([name]) => ['u_animated', 'u_time'].includes(name)), [
  ['u_animated', 1], ['u_time', 2.5],
], 'wrapped animated controls enable time-varying grain');
const grainShader = fs.readFileSync(new URL('../client/src/effects/engines/GPUEffects.js', import.meta.url), 'utf8');
assert.match(grainShader, /floor\(v_texCoord \* u_resolution \/ max\(u_size/, 'grain size controls the spatial grain cell scale');
assert.match(grainShader, /floor\(u_time \* 30\.0\)/, 'animated grain advances in discrete frame steps');
const shakeShader = fs.readFileSync(new URL('../client/src/effects/engines/GPUEffects.js', import.meta.url), 'utf8');
assert.match(shakeShader, /float hash\(float x\)[\s\S]*float noise\(float x\)[\s\S]*mix\(hash\(cell\), hash\(cell \+ 1\.0\), blend\)/,
  'camera shake interpolates deterministic samples smoothly over time');
assert.equal(EFFECT_DEFINITIONS.shake.params.intensity.label, 'Intensity', 'camera shake labels displacement strength as intensity');
assert.equal(EFFECT_DEFINITIONS.shake.params.frequency.label, 'Frequency', 'camera shake exposes its actual frequency control');
calls.length = 0;
engine._setEffectUniforms(gl, {}, 'shake', { intensity: 12, frequency: 8, randomSeed: 12, rotationAmount: 1.5 }, 2.5);
assert.deepEqual(calls.filter(([name]) => ['u_intensity', 'u_frequency', 'u_seed', 'u_rotation'].includes(name)), [
  ['u_intensity', 12], ['u_frequency', 8], ['u_seed', 12], ['u_rotation', 1.5],
], 'camera shake preview applies its authored amplitude, frequency, seed, and rotation');

calls.length = 0;
engine._setEffectUniforms(gl, {}, 'blur_motion', { intensity: Number.NaN, angle: 999, samples: 1 });
assert.deepEqual(calls.filter(([name]) => ['u_intensity', 'u_angle', 'u_samples'].includes(name)), [
  ['u_intensity', 0.5], ['u_angle', 360], ['u_samples', 2],
], 'invalid motion blur values use finite defaults and a sample count that cannot divide by zero');
calls.length = 0;
engine._setEffectUniforms(gl, {}, 'blur_radial', { intensity: -2, centerX: Number.NaN, centerY: 2, samples: 0 });
assert.deepEqual(calls.filter(([name]) => ['u_intensity', 'u_center', 'u_samples'].includes(name)), [
  ['u_intensity', 0], ['u_center', 0.5, 1], ['u_samples', 1],
], 'radial blur always has a finite center and at least one sample');
calls.length = 0;
engine._setEffectUniforms(gl, {}, 'glow', { threshold: Number.NaN, intensity: 10, radius: 0, color: [Number.NaN, 2, -1] });
assert.ok(calls.every(call => call.slice(1).every(Number.isFinite)), 'malformed GPU effect values never reach uniforms as NaN');
calls.length = 0;
engine._setEffectUniforms(gl, {}, 'glitch', { colorShift: { value: false }, scanlines: { value: true } });
assert.deepEqual(calls.filter(([name]) => ['u_colorShift', 'u_scanlines'].includes(name)), [
  ['u_colorShift', 0], ['u_scanlines', 1],
], 'wrapped boolean glitch controls preserve false and true values when setting GPU uniforms');
assert.deepEqual(calls.filter(([name]) => name === 'u_time'), [['u_time', 0]],
  'glitch receives a finite zero-time fallback when the frame time is invalid');
calls.length = 0;
engine._setEffectUniforms(gl, {}, 'glitch', { colorShift: false, scanlines: true }, 2.5);
assert.deepEqual(calls.filter(([name]) => ['u_colorShift', 'u_scanlines'].includes(name)), [
  ['u_colorShift', 0], ['u_scanlines', 1],
], 'plain boolean glitch controls keep their authored values in GPU preview');
assert.deepEqual(calls.filter(([name]) => name === 'u_time'), [['u_time', 2.5]],
  'glitch block displacement advances from the current composition time');

const vignetteShader = fs.readFileSync(new URL('../client/src/effects/engines/GPUEffects.js', import.meta.url), 'utf8');
const glowShader = vignetteShader.match(/glow:\s*`([\s\S]*?)`,\s*\/\/ === Vignette ===/)?.[1] || '';
assert.match(glowShader, /vec3\(0\.2126,\s*0\.7152,\s*0\.0722\)/,
  'GPU glow extracts Rec. 709 luminance to match the SVG and export paths');
assert.match(glowShader, /clamp\(\(sampleLuminance\s*-\s*u_threshold\)\s*\/\s*thresholdWidth,\s*0\.0,\s*1\.0\)/,
  'GPU glow uses the same soft highlight threshold ramp as SVG and export');
assert.match(glowShader, /mix\(original\.rgb,\s*u_color,\s*glowAlpha\)/,
  'GPU glow composites its tint over the source rather than adding and clipping RGB');
assert.match(glowShader, /original\.a\s*\+\s*glowAlpha\s*\*\s*\(1\.0\s*-\s*original\.a\)/,
  'GPU glow preserves bloom alpha outside translucent source pixels');
assert.match(vignetteShader, /smoothstep\(u_radius\s*-\s*max\(u_softness,\s*0\.0001\),\s*u_radius,\s*dist\)/,
  'vignette uses an ordered, numerically safe falloff');
assert.match(vignetteShader, /float\(max\(u_samples\s*-\s*1,\s*1\)\)/,
  'motion blur shader protects its interpolation denominator');
assert.match(vignetteShader, /float\(max\(u_samples,\s*1\)\)/,
  'radial blur shader protects its interpolation denominator');
assert.match(vignetteShader, /total\s*>\s*0\.0\s*\?\s*result\s*\/\s*total\s*:/,
  'empty blur accumulations fall back to the source pixel');
assert.match(grainShader, /direction\s*\*\s*t\s*\*\s*u_intensity\s*\*\s*0\.1\s*\*\s*u_resolution\.x\s*\*\s*texelSize/,
  'motion blur samples its direction in pixel space so portrait and landscape angles match');
assert.match(grainShader, /\(u_center\s*-\s*v_texCoord\)\s*\*\s*u_resolution/,
  'radial blur computes its center vector in pixel space');
assert.match(grainShader, /dist\s*\*\s*0\.5\s*\/\s*u_resolution/,
  'radial blur converts its pixel-space sample distance back to UV coordinates');
assert.match(grainShader, /cos\(rad\)\s*\/\s*u_resolution\.x,\s*sin\(rad\)\s*\/\s*u_resolution\.y/,
  'RGB split applies equal pixel displacement at every angle and aspect ratio');

const textureA = { id: 'a' }, textureB = { id: 'b' }, sourceTexture = { id: 'source' };
const framebufferA = { texture: textureA }, framebufferB = { texture: textureB };
const drawRecords = [];
const radiusUniforms = [];
const qualityUniforms = [];
let targetAllocations = 0;
let boundFramebuffer = null;
let boundTexture = null;
let currentDirection;
let currentProgram;
let uniformLocationLookups = 0;
const blurProgram = {}, vignetteProgram = {};
const mockGL = {
  FRAMEBUFFER: 1, TEXTURE_2D: 2, COLOR_ATTACHMENT0: 3, TEXTURE0: 4,
  RGBA: 5, UNSIGNED_BYTE: 6, ARRAY_BUFFER: 7, FLOAT: 8, TRIANGLES: 9,
  bindTexture: (_target, texture) => { boundTexture = texture; },
  texImage2D: () => { targetAllocations++; },
  framebufferTexture2D: () => {},
  bindFramebuffer: (_target, framebuffer) => { boundFramebuffer = framebuffer; },
  viewport: () => {}, useProgram: program => { currentProgram = program; }, enableVertexAttribArray: () => {},
  bindBuffer: () => {}, vertexAttribPointer: () => {}, activeTexture: () => {},
  uniform1i: (name, value) => { if (name === 'u_quality' && currentProgram === blurProgram) qualityUniforms.push(value); },
  uniform1f: (name, value) => { if (name === 'u_radius' && currentProgram === blurProgram) radiusUniforms.push(value); }, uniform3f: () => {},
  uniform2f: (name, x, y) => { if (name === 'u_direction') currentDirection = [x, y]; },
  getUniformLocation: (_program, name) => { uniformLocationLookups++; return name; },
  drawArrays: () => {
    drawRecords.push({ direction: currentProgram === blurProgram ? currentDirection : undefined, input: boundTexture, output: boundFramebuffer?.texture });
    currentDirection = undefined;
  },
};
const gpu = Object.create(GPUEffectEngine.prototype);
Object.assign(gpu, {
  gl: mockGL, initialized: true, framebuffers: [framebufferA, framebufferB],
  textures: [textureA, textureB], positionBuffer: {}, texCoordBuffer: {},
  programs: new Map([['blur_gaussian', { program: blurProgram, attributes: { position: 0, texCoord: 1 } }],
    ['vignette', { program: vignetteProgram, attributes: { position: 0, texCoord: 1 } }]]),
});
const chain = [
  { type: 'blur_gaussian', engine: 'gpu', enabled: true, getParamsAt: () => ({ radius: { value: 4 }, quality: { value: 20 } }), isActiveAt: () => true },
  { type: 'vignette', engine: 'gpu', enabled: true, getParamsAt: () => ({ intensity: 0.4 }), isActiveAt: () => true },
];
const chainOutput = gpu.processChain(chain, sourceTexture, 0.5, { width: 320, height: 180 });
assert.equal(chainOutput, textureA, 'effects after a multipass blur continue through the ping-pong chain');
assert.deepEqual(drawRecords.map(({ direction }) => direction), [[1, 0], [0, 1], undefined],
  'Gaussian blur renders horizontal and vertical passes before the next effect');
assert.deepEqual(radiusUniforms, [4, 4], 'both Gaussian blur passes use the same radius');
assert.deepEqual(qualityUniforms, [20, 20], 'the authored Gaussian quality controls the tap count in both passes');
assert.ok(drawRecords.every(({ input, output }) => input !== output),
  'effect passes never sample from the texture attached as their render target');
assert.equal(targetAllocations, 2, 'render targets allocate once for a frame size, not once per effect pass');

const routedTargets = [];
const routingRenderer = new EffectRenderer({
  gl: { drawingBufferWidth: 320, drawingBufferHeight: 180 },
  pipeline: {
    hasActiveEffectsAt: () => true,
    processPreview: (texture, targetId) => { routedTargets.push(targetId); return texture; },
  },
});
const layeredPlacements = [
  { id: 'placement-main', clipId: 'clip-main', clip: { id: 'clip-main' } },
  { id: 'placement-overlay', clipId: 'clip-overlay', clip: { id: 'clip-overlay' } },
  { id: 'placement-audio', clipId: 'clip-audio', clip: { id: 'clip-audio' } },
];
routingRenderer.renderPreview(sourceTexture, layeredPlacements, 1, { sourceClipId: 'clip-main' });
assert.deepEqual(routedTargets, ['placement-main'],
  'a decoded source frame receives effects only from its own placement, never from overlay or audio placements');
routedTargets.length = 0;
routingRenderer.renderPreview(sourceTexture, layeredPlacements, 1, { sourceClipId: null });
assert.deepEqual(routedTargets, [], 'frames without an identified source clip do not inherit another placement\'s effects');

const firstFrameUniformLookups = uniformLocationLookups;
gpu.processChain(chain, sourceTexture, 0.6, { width: 320, height: 180 });
assert.equal(targetAllocations, 2, 'consecutive preview frames reuse allocated render targets');
assert.equal(uniformLocationLookups, firstFrameUniformLookups, 'consecutive preview frames reuse cached shader uniform locations');
gpu.processChain(chain, sourceTexture, 0.7, { width: 640, height: 360 });
assert.equal(targetAllocations, 4, 'render targets are reallocated when the preview resolution changes');
gpu.processChain([{ ...chain[0], getParamsAt: () => ({ radius: Number.NaN }) }], sourceTexture, 0.8, { width: 640, height: 360 });
assert.deepEqual(radiusUniforms.slice(-2), [5, 5], 'invalid Gaussian blur radius falls back consistently across both passes');
gpu.processChain([{ ...chain[0], getParamsAt: () => ({ radius: 5, quality: 99 }) }], sourceTexture, 0.9, { width: 640, height: 360 });
assert.deepEqual(qualityUniforms.slice(-2), [32, 32], 'Gaussian blur quality is clamped to the shader maximum');
assert.match(vignetteShader, /if\s*\(i\s*>=\s*u_quality\)\s*break/, 'Gaussian blur sampling count is driven by its quality control');

for (const [type, definition] of Object.entries(EFFECT_DEFINITIONS)) {
  if (definition.engine !== 'gpu') continue;
  assert.ok(GPU_SHADER_TYPES.includes(definition.shader), `${type} declares an implemented preview shader`);
  if (type !== 'shake') {
    assert.ok(isGpuClipEffect(type), `${type} footage control routes into the GPU clip preview`);
    const config = createGpuClipEffectConfigs('catalogue-clip', [{ kind: type, params: Object.fromEntries(
      Object.entries(definition.params || {}).map(([key, control]) => [key, control.value]),
    ) }])[0];
    assert.ok(config && config.type === definition.shader,
      `${type} footage control resolves to its declared ${definition.shader} shader`);
  }
  const params = Object.fromEntries(Object.entries(definition.params || {}).map(([key, value]) => [key, value.value]));
  assert.ok(exportProcessor.compileTimelineVisualEffects([{ kind: type, params }], { width: 1080, height: 1920 }).length > 0,
    `${type} has an export filter implementation`);
}
assert.equal(isGpuClipEffect('shake'), false,
  'camera shake stays on the timeline transform path instead of being double-applied as a pixel shader');
const previewableEffects = Object.keys(EFFECT_DEFINITIONS).filter(type => type !== 'shake' && isGpuClipEffect(type));
assert.equal(resolveTimelineEffectFilter(previewableEffects.map(kind => ({ kind })), 0, { gpuPreview: true }), '',
  'the WebGL preview does not stack duplicate CSS approximations on shader-backed footage effects');
assert.equal(resolveTimelineVignetteStyle([{ kind: 'vignette' }], 0, { gpuPreview: true }), null,
  'the WebGL vignette shader does not stack the CSS vignette overlay');

const routingPipeline = new EffectPipeline();
routingPipeline.hasActiveEffectsAt = () => false;
class WebGLTextureFixture {}
const sharedWebGLTexture = new WebGLTextureFixture();
const routedPlacements = [{ id: 'base-layer' }, { id: 'overlay-layer' }];
const sharedTextureOutputs = routingPipeline.processAllPreviews(sharedWebGLTexture, routedPlacements, 0);
assert.deepEqual([...sharedTextureOutputs], routedPlacements.map(placement => [placement.id, sharedWebGLTexture]),
  'a shared host texture without a type field is routed as one source for every placement, not mistaken for a texture map');
const keyedTextureOutputs = routingPipeline.processAllPreviews({ 'base-layer': 'base-texture', 'overlay-layer': 'overlay-texture' }, routedPlacements, 0);
assert.deepEqual([...keyedTextureOutputs], [['base-layer', 'base-texture'], ['overlay-layer', 'overlay-texture']],
  'plain records remain supported as placement-to-texture maps');
const mapTextureOutputs = routingPipeline.processAllPreviews(new Map([['base-layer', 'map-base']]), routedPlacements, 0);
assert.deepEqual([...mapTextureOutputs], [['base-layer', 'map-base']],
  'Map inputs only route layers with an explicitly supplied texture');
console.log('GPU effects checks passed: preview/export registry parity, visible processed textures, safe fallback, wrapped boolean controls, zero-valued controls, 2-pass blur without feedback, and valid vignette falloff.');
