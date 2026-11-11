import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GPUEffectEngine, GPU_SHADER_TYPES, resolveFadeProgress, resolveGpuCompositeModeId } from '../client/src/effects/engines/GPUEffects.js';
import { EFFECT_DEFINITIONS } from '../client/src/effects/EffectRegistry.js';
import { EffectRenderer } from '../client/src/effects/EffectRenderer.js';
import { EffectPipeline } from '../client/src/effects/EffectPipeline.js';
import { EffectGraph } from '../client/src/effects/EffectGraph.js';
import { initEffectsEngine } from '../client/src/effects/index.js';
import { handleWebGLContextLost, handleWebGLContextRestored } from '../client/src/engine/webglContextLifecycle.js';
import { createGpuClipEffectConfigs, isGpuClipEffect } from '../client/src/effects/ClipEffectAdapter.js';
import { resolveTimelineEffectFilter, resolveTimelineSvgEffectInstances, resolveTimelineSvgEffectParams, resolveTimelineVignetteStyle } from '../client/src/motion/TimelineVisualEffects.js';
import exportProcessor from '../jobs/exportProcessor.js';
import { cssFilterToColorMatrix, scaleCssFilterIntensity } from '../client/src/effects/lutPreview.js';
import { BLEND_MODE_KINDS } from '../client/src/motion/SceneSchema.js';

const identityLutMatrix = cssFilterToColorMatrix('none');
assert.deepEqual(identityLutMatrix, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
  'an empty LUT preview resolves to the neutral color matrix');
const lutMatrix = cssFilterToColorMatrix('brightness(1.1) contrast(1.2) saturate(0.9) hue-rotate(12deg)');
assert.ok(lutMatrix && lutMatrix.slice(0, 3).flat().every(Number.isFinite),
  'the LUT preview matrix composes supported color filters in their authored order');
assert.equal(cssFilterToColorMatrix('url(#unsupported) blur(2px)'), null,
  'unsupported LUT preview functions do not silently become a different color grade');
assert.equal(cssFilterToColorMatrix('brightness(1.1deg)'), null,
  'invalid CSS filter units are rejected instead of being interpreted as color values');
assert.equal(scaleCssFilterIntensity('brightness(1.2) hue-rotate(20deg)', 0.5),
  'brightness(1.1) hue-rotate(10deg)', 'animated LUT intensity follows the editor preview neutral interpolation');
assert.equal(scaleCssFilterIntensity('blur(2px)', 0.5), null,
  'unsupported LUT filters are not approximated at partial intensity');
assert.ok(GPU_SHADER_TYPES.includes('lut_apply'), 'the GPU renderer registers the LUT preview shader');

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
const reinitializedRendererGpu = rendererGpu;
rendererBootstrap.init(bootstrapGl);
assert.equal(reinitializedRendererGpu.initialized, false, 'reinitializing the renderer releases its previous GPU engine');
const replacedRendererGpu = rendererGpu;
const replacementPipeline = { gpuEngine: null, setGPUEngine(engine) { this.gpuEngine = engine; rendererGpu = engine; } };
rendererBootstrap.setPipeline(replacementPipeline);
assert.ok(rendererGpu instanceof GPUEffectEngine, 'renderer.setPipeline reattaches the GPU engine from native ES modules');
assert.equal(replacedRendererGpu.initialized, false, 'replacing a pipeline releases the renderer-owned GPU engine');
const contextReleasedGpu = rendererGpu;
rendererBootstrap.init(null);
assert.equal(contextReleasedGpu.initialized, false, 'initializing without a WebGL context releases the previous GPU engine');
assert.equal(replacementPipeline.gpuEngine, null, 'a pipeline no longer retains a destroyed GPU engine');
contextReleasedGpu.destroy();
let externallyOwnedDestroyCalls = 0;
const externallyOwnedGpu = { destroy: () => { externallyOwnedDestroyCalls += 1; } };
const externallyOwnedRenderer = new EffectRenderer({ pipeline: { gpuEngine: externallyOwnedGpu } });
externallyOwnedRenderer.destroy();
assert.equal(externallyOwnedDestroyCalls, 0, 'destroy only releases GPU engines created and owned by this renderer');
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
const gradingMethodStart = source.indexOf('    setGrading(params) {');
const gradingMethodEnd = source.indexOf('    // Deprecated but compatible', gradingMethodStart);
const gradingMethodSource = source.slice(gradingMethodStart, gradingMethodEnd).trim();
const setGrading = new Function(`return ({ ${gradingMethodSource} }).setGrading`)();
const gradingProbe = { gradingParams: { selectiveHue: [], selectiveSat: [], selectiveLum: [] } };
setGrading.call(gradingProbe, { brightness: 0, contrast: 0, saturate: 0, hueRotate: 0,
  selective: { reds: { hue: 0, sat: 0, lum: 0 }, blues: { hue: 180, sat: -50, lum: 25 } } });
assert.deepEqual([
  gradingProbe.gradingParams.brightness,
  gradingProbe.gradingParams.contrast,
  gradingProbe.gradingParams.saturation,
  gradingProbe.gradingParams.hueRotate,
], [0, 0, 0, 0], 'explicit zero color controls remain zero in the live preview shader uniforms');
assert.deepEqual([
  gradingProbe.gradingParams.selectiveHue[0], gradingProbe.gradingParams.selectiveSat[0], gradingProbe.gradingParams.selectiveLum[0],
  gradingProbe.gradingParams.selectiveHue[4], gradingProbe.gradingParams.selectiveSat[4], gradingProbe.gradingParams.selectiveLum[4],
], [0, 0, 0, 0.5, -0.5, 0.25], 'selective HSL controls preserve explicit zeros and normalize authored values');
const saturationAliasProbe = { gradingParams: { selectiveHue: [], selectiveSat: [], selectiveLum: [] } };
setGrading.call(saturationAliasProbe, { brightness: null, contrast: undefined, saturation: 0 });
assert.deepEqual([
  saturationAliasProbe.gradingParams.brightness,
  saturationAliasProbe.gradingParams.contrast,
  saturationAliasProbe.gradingParams.saturation,
], [1, 1, 0], 'null controls use neutral defaults while saturation alias honors zero');
const gradingBoundsProbe = { gradingParams: { selectiveHue: [], selectiveSat: [], selectiveLum: [] } };
setGrading.call(gradingBoundsProbe, { brightness: 500, contrast: -50, saturation: 350, hueRotate: -720 });
assert.deepEqual([
  gradingBoundsProbe.gradingParams.brightness,
  gradingBoundsProbe.gradingParams.contrast,
  gradingBoundsProbe.gradingParams.saturation,
  gradingBoundsProbe.gradingParams.hueRotate,
], [2, 0, 2, -180], 'preview grading limits match the export compiler for out-of-range controls');
const previewGradeStart = source.indexOf('// Fragment Shader (Color Grading)');
const previewGradeEnd = source.indexOf('        // Compile', previewGradeStart);
const previewGradeShader = source.slice(previewGradeStart, previewGradeEnd);
assert.match(previewGradeShader, /rgb\s*\*=\s*u_brightness;\s*rgb\s*=\s*clamp\(rgb,\s*0\.0,\s*1\.0\);[\s\S]*rgb\s*=\s*\(rgb\s*-\s*0\.5\)\s*\*\s*u_contrast\s*\+\s*0\.5;\s*rgb\s*=\s*clamp\(rgb,\s*0\.0,\s*1\.0\)/,
  'PlaybackEngine clamps brightness and contrast between stages to match the export color-grade pipeline');
assert.match(previewGradeShader, /uniform\s+float\s+u_hueRotate\s*;/,
  'the preview grading shader declares the global hue rotation control');
assert.match(previewGradeShader, /h\s*=\s*mod\(h\s*\+\s*dH\s*\+\s*u_hueRotate\s*\/\s*360\.0,\s*1\.0\)/,
  'global and selective hue shifts are applied together and wrapped into the hue range');
assert.match(source, /gl\.uniform1f\(this\.loc\.hueRotate,\s*this\.gradingParams\.hueRotate\)/,
  'the preview uploads the clip hue rotation to the shader');
const contextLifecycleSource = fs.readFileSync(new URL('../client/src/engine/webglContextLifecycle.js', import.meta.url), 'utf8');
const renderStart = source.indexOf('    render(frameItem) {');
const renderEnd = source.indexOf('\n    }', renderStart);
const renderSource = source.slice(renderStart, renderEnd);
assert.match(renderSource, /renderTexture\s*=\s*this\.effectsRenderer\.renderPreview/,
  'preview retains the GPU effects output');
assert.match(renderSource, /gl\.bindTexture\(gl\.TEXTURE_2D,\s*renderTexture\)/,
  'the visible frame shader samples the GPU effects output');
assert.match(renderSource, /renderTexture\s*=\s*this\.texture/,
  'effect failures fall back to the original source texture');
assert.match(renderSource, /type:\s*'gpu_effect_preview_failed'[\s\S]*?recoverable:\s*true/,
  'effect-render exceptions produce a recoverable player warning while preserving source playback');
assert.match(renderSource, /type:\s*'gpu_effect_preview_recovered'/,
  'the warning clears after effect preview rendering succeeds again');
assert.match(renderSource, /sourceClipId:\s*this\.effectSourceClipId/,
  'the decoded source clip identity reaches the effect renderer');
assert.match(source, /setEffectSourceClipId\(clipId\)/,
  'PlaybackEngine exposes source-clip routing to the player');
assert.match(source, /setClipEffects\(clipId, effects = \[\], placement = \{\}\)/,
  'PlaybackEngine adapts direct clip effects into the shared GPU effect graph');
assert.match(source, /previewPlacements\.push\(this\.clipEffectPlacement\)/,
  'direct clip effects render even when no legacy timeline placement has been hydrated');
assert.match(source, /addEventListener\?\.\('webglcontextlost',\s*this\._handleWebGLContextLost/,
  'PlaybackEngine listens for GPU context loss on its preview canvas');
assert.match(source, /addEventListener\?\.\('webglcontextrestored',\s*this\._handleWebGLContextRestored/,
  'PlaybackEngine listens for GPU context restoration on its preview canvas');
assert.match(contextLifecycleSource, /event\?\.preventDefault\?\.\(\)/,
  'context loss is marked recoverable so browser restoration remains possible');
assert.match(contextLifecycleSource, /type:\s*'webgl_context_lost'[\s\S]*?recoverable:\s*true/,
  'context loss reports a recoverable preview error');
assert.match(source, /async restoreWebGLContext\(\)[\s\S]*?this\.initGL\(\)[\s\S]*?this\.effectsPipeline\.setGPUEngine\(this\.gpuEffectEngine\)/,
  'restoration rebuilds base GPU resources and reconnects the existing effects pipeline');
const restoreMethodStart = source.indexOf('    async restoreWebGLContext() {');
const restoreMethodEnd = source.indexOf('\n    }', restoreMethodStart) + '\n    }'.length;
assert.ok(restoreMethodStart >= 0 && restoreMethodEnd > restoreMethodStart,
  'PlaybackEngine exposes its context restoration method');
const restoreWebGLContext = new Function(`return ({ ${source.slice(restoreMethodStart, restoreMethodEnd).trim()} }).restoreWebGLContext`)();
const replacementGl = { context: 'restored' };
let baseResourcesRebuilt = 0;
const recoveryProbe = {
  canvas: { getContext: name => name === 'webgl2' ? replacementGl : null },
  effectsEnabled: false,
  effectsPipeline: null,
  isDestroyed: false,
  initGL() { baseResourcesRebuilt += 1; },
};
await restoreWebGLContext.call(recoveryProbe);
assert.equal(recoveryProbe.gl, replacementGl, 'restoration installs the browser-provided context');
assert.equal(baseResourcesRebuilt, 1, 'restoration rebuilds base playback shader and geometry resources');
const noContextProbe = {
  canvas: { getContext: () => null },
  isDestroyed: false,
};
await assert.rejects(restoreWebGLContext.call(noContextProbe), /did not restore a WebGL context/,
  'restoration fails clearly if the browser still cannot provide a WebGL context');
const destroyedProbe = { canvas: null, isDestroyed: true };
await assert.rejects(restoreWebGLContext.call(destroyedProbe), /no longer available/,
  'restoration does not touch a destroyed playback canvas');
assert.match(renderSource, /this\._webglContextLost/,
  'the render loop stops issuing GPU draw calls after context loss');
assert.match(source, /removeEventListener\?\.\('webglcontextlost',\s*this\._handleWebGLContextLost/,
  'destroy removes the context-loss listener before releasing the context');
assert.match(source, /removeEventListener\?\.\('webglcontextrestored',\s*this\._handleWebGLContextRestored/,
  'destroy removes the context-restored listener before releasing the context');
const contextLossErrors = [];
let contextLossLoopStops = 0;
let contextLossState = null;
const contextLossEngine = {
  _webglContextLost: false,
  _webglContextErrorReported: false,
  isDestroyed: false,
  stopLoop: () => { contextLossLoopStops += 1; },
  setState: next => { contextLossState = next; },
  onError: error => contextLossErrors.push(error),
};
let preventedLossEvents = 0;
const lossEvent = { preventDefault: () => { preventedLossEvents += 1; } };
handleWebGLContextLost(contextLossEngine, lossEvent);
handleWebGLContextLost(contextLossEngine, lossEvent);
assert.equal(preventedLossEvents, 2, 'every loss event allows browser context restoration');
assert.equal(contextLossLoopStops, 1, 'context loss stops playback exactly once');
assert.equal(contextLossState, 'ERROR', 'context loss enters the playback error state');
assert.equal(contextLossErrors.length, 1, 'the player fallback receives one error notification');
assert.equal(contextLossErrors[0].type, 'webgl_context_lost', 'the notification identifies GPU context loss');
assert.equal(contextLossErrors[0].recoverable, true, 'context loss is reported as recoverable');
let restored = 0;
let recovered = 0;
let restoredLoopStarts = 0;
const restoreEngine = {
  _webglContextLost: true,
  _webglResumeState: 'PLAYING',
  _webglResumeTime: 12.5,
  _webglContextErrorReported: true,
  isDestroyed: false,
  state: 'ERROR',
  clock: { play: async time => { assert.equal(time, 12.5); } },
  restoreWebGLContext: async () => { restored += 1; },
  setState: next => { contextLossState = next; },
  startLoop: () => { restoredLoopStarts += 1; },
  onRecovered: () => { recovered += 1; },
};
assert.equal(await handleWebGLContextRestored(restoreEngine), true, 'a restored context rebuilds and resumes playback');
assert.equal(restored, 1, 'GPU resources are rebuilt once');
assert.equal(recovered, 1, 'the player is notified to clear its fallback state');
assert.equal(contextLossState, 'PLAYING', 'playback returns to its previous state');
assert.equal(restoredLoopStarts, 1, 'the render loop restarts after restoration');
assert.equal(restoreEngine._webglContextLost, false, 'rendering is re-enabled after successful restoration');
let preservedError = false;
const previouslyFailedEngine = {
  ...restoreEngine,
  _webglContextLost: true,
  _webglResumeState: 'ERROR',
  onRecovered: ({ preservePlaybackError } = {}) => { preservedError = preservePlaybackError; },
};
assert.equal(await handleWebGLContextRestored(previouslyFailedEngine), true, 'GPU resources can recover while playback remains failed');
assert.equal(contextLossState, 'ERROR', 'restoration preserves an error state that predated context loss');
assert.equal(preservedError, true, 'the player is told not to clear an earlier playback error');
const destroyedContextEngine = { ...contextLossEngine, _webglContextLost: false, isDestroyed: true };
handleWebGLContextLost(destroyedContextEngine, lossEvent);
assert.equal(contextLossLoopStops, 1, 'a late context-loss event after destroy is ignored');
const playerSource = fs.readFileSync(new URL('../client/src/components/Player/VideoPlayer.jsx', import.meta.url), 'utf8');
assert.match(playerSource, /setEffectSourceClipId\?\.\(activeClip\?\.id\)/,
  'VideoPlayer tells the effect renderer which clip its decoded frame represents');
assert.match(playerSource, /setClipEffects\?\.\(activeClip\?\.id, activeClip\?\.effects \|\| \[\]/,
  'VideoPlayer routes direct footage effects to the decoded clip shader graph');

const calls = [];
const previewCapabilities = Object.create(GPUEffectEngine.prototype);
Object.assign(previewCapabilities, {
  programs: new Map([['fade_in', {}], ['fade_out', {}], ['blur_gaussian', {}]]),
  textures: [{ id: 'preview-fb0' }, { id: 'preview-fb1' }],
  initialized: true,
});
assert.equal(previewCapabilities.supportsPreviewEffect({ type: 'fade_in', engine: 'cpu' }), true,
  'CPU-classified fade effects can use their existing live preview shader');
assert.equal(previewCapabilities.supportsPreviewEffect({ type: 'blur_gaussian', engine: 'cpu' }), false,
  'a shader with a matching name does not route unrelated CPU effects into GPU preview');
const processedFadeEffects = [];
previewCapabilities.processEffect = effect => {
  processedFadeEffects.push(effect.type);
  return { id: `preview-${effect.type}` };
};
const fadeTexture = previewCapabilities.processChain([
  { type: 'fade_in', engine: 'cpu', enabled: true, isActiveAt: () => true },
  { type: 'fade_out', engine: 'cpu', enabled: true, isActiveAt: () => true },
], { id: 'fade-source' }, 0);
assert.deepEqual(processedFadeEffects, ['fade_in', 'fade_out'],
  'the GPU preview chain executes both CPU-export fades using their shader implementations');
assert.equal(fadeTexture.id, 'preview-fade_out', 'consecutive fades retain graph execution order');

const fadePreviewWarnings = [];
let routedFadeEffects = [];
const fadePreviewPipeline = new EffectPipeline({
  gpuEngine: {
    supportsEffect: type => type.startsWith('fade_'),
    supportsPreviewEffect: effect => effect.engine === 'gpu' || ['fade_in', 'fade_out'].includes(effect.type),
    processChain: effects => { routedFadeEffects = effects; return { id: 'faded-preview' }; },
  },
  onPreviewWarning: warning => fadePreviewWarnings.push(warning),
});
fadePreviewPipeline.addEffect({ type: 'fade_in', targetId: 'fade-preview-clip', params: { duration: 0.5 } });
assert.equal(fadePreviewPipeline.processPreview({ id: 'source' }, 'fade-preview-clip', 0).id, 'faded-preview',
  'live preview renders a CPU-export fade through the supported shader path');
assert.deepEqual(routedFadeEffects.map(effect => effect.type), ['fade_in'],
  'the fade effect reaches the GPU preview chain');
assert.equal(fadePreviewWarnings.length, 0, 'a shader-backed fade does not report a false CPU-preview limitation');

const fadePlacement = { startTime: 4, duration: 2 };
assert.equal(resolveFadeProgress({ type: 'fade_in' }, 4, fadePlacement, { duration: 0.5 }), 0,
  'fade-in begins at the clip start when no authored start is set');
assert.equal(resolveFadeProgress({ type: 'fade_in' }, 4.25, fadePlacement, { duration: 0.5 }), 0.5,
  'fade-in progresses smoothly over its configured duration');
assert.equal(resolveFadeProgress({ type: 'fade_out' }, 5.5, fadePlacement, { duration: 0.5 }), 1,
  'fade-out stays fully visible before the default clip-end fade window');
assert.equal(resolveFadeProgress({ type: 'fade_out' }, 5.75, fadePlacement, { duration: 0.5 }), 0.5,
  'fade-out reaches its midpoint within the default clip-end fade window');
assert.equal(resolveFadeProgress({ type: 'fade_out', endTime: null }, 6, fadePlacement, { duration: 0.5 }), 0,
  'a null fade-out end defaults to the clip end rather than time zero');
assert.equal(resolveFadeProgress({ type: 'fade_out', endTime: 5.8 }, 5.8, fadePlacement, { duration: 0.5 }), 0,
  'an authored fade-out end is honored relative to the clip start');
const gl = {
  getUniformLocation: (_program, name) => name,
  uniform1f: (name, value) => calls.push([name, value]),
  uniform1i: (name, value) => calls.push([name, value]),
  uniform2f: (name, x, y) => calls.push([name, x, y]),
  uniform3f: (name, x, y, z) => calls.push([name, x, y, z]),
  uniform4f: (name, x, y, z, w) => calls.push([name, x, y, z, w]),
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
const gpuCompositeModes = [
  ['source-over', 0], ['multiply', 1], ['screen', 2], ['addition', 3],
  ['overlay', 4], ['darken', 5], ['lighten', 6], ['difference', 7], ['color-dodge', 8],
  ['color-burn', 9], ['hard-light', 10], ['soft-light', 11], ['exclusion', 12],
  ['hue', 13], ['saturation', 14], ['color', 15], ['luminosity', 16],
];
assert.deepEqual(gpuCompositeModes.map(([mode]) => mode).sort(), [...BLEND_MODE_KINDS].sort(),
  'GPU compositor modes stay aligned with the scene schema blend-mode catalog');
for (const [mode, expectedId] of gpuCompositeModes) {
  assert.equal(resolveGpuCompositeModeId(mode), expectedId, `GPU composition resolves ${mode} to its canonical shader branch`);
}
assert.equal(resolveGpuCompositeModeId(undefined), 0, 'an omitted blend mode defaults to canonical source-over');
for (const unsupportedMode of ['normal', 'add', 'plus-lighter', 'unrecognized-mode']) assert.equal(resolveGpuCompositeModeId(unsupportedMode), null,
  'unsupported GPU composite modes are detectable instead of being mistaken for a supported mode');
for (const modeId of Array.from({ length: 17 }, (_, index) => index)) {
  assert.match(radialShader, new RegExp(`u_mode == ${modeId}\\b`), `GPU composite shader implements blend mode ${modeId}`);
}
assert.match(radialShader, /vec3 setLum\([\s\S]*?vec3 setSat\([\s\S]*?u_mode == 16/,
  'GPU composite shader implements the component-based hue, saturation, color and luminosity modes');
assert.match(radialShader, /softLightChannel\([\s\S]*?u_mode == 11/,
  'GPU composite shader implements the W3C soft-light curve');
const shaderBodies = [...radialShader.matchAll(/^\s{4}([a-z][a-z0-9_]*): `([\s\S]*?)`[,]?$/gm)];
assert.ok(shaderBodies.length >= GPU_SHADER_TYPES.length, 'shader source map can be inspected for uniform declarations');
for (const [, shaderName, body] of shaderBodies) {
  const declaredUniforms = new Set([...body.matchAll(/uniform\s+\w+\s+(u_[a-zA-Z0-9_]+)\s*;/g)].map(match => match[1]));
  const referencedUniforms = new Set([...body.matchAll(/\b(u_[a-zA-Z0-9_]+)\b/g)].map(match => match[1]));
  for (const uniformName of referencedUniforms) {
    assert.ok(declaredUniforms.has(uniformName), `${shaderName} references ${uniformName}, which must be declared`);
  }
}
for (const shaderName of ['blur_gaussian', 'blur_motion', 'blur_radial']) {
  const match = shaderBodies.find(([, name]) => name === shaderName);
  assert.ok(match, `${shaderName} shader is registered`);
  assert.match(match[2], /sampleColor\.rgb\s*\*\s*sampleColor\.a/,
    `${shaderName} accumulates RGB premultiplied by alpha to avoid transparent-edge color fringes`);
  assert.match(match[2], /result\.rgb\s*\/\s*result\.a/,
    `${shaderName} returns straight RGB after its alpha-correct accumulation`);
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
assert.match(grainShader, /if\s*\(color\.a\s*>\s*0\.0\)\s*color\.rgb\s*\+=\s*grain\s*\*\s*u_intensity/,
  'film grain leaves fully transparent RGB untouched to prevent edge halos');
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
engine._setEffectUniforms(gl, {}, 'glow', { intensity: 2 });
assert.deepEqual(calls.filter(([name]) => name === 'u_intensity'), [['u_intensity', 2]],
  'GPU glow preserves the advertised 0–3 intensity range');
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
assert.match(glowShader, /dot\(sampleColor\.rgb,\s*vec3\(0\.2126,\s*0\.7152,\s*0\.0722\)\)\s*\*\s*sampleColor\.a/,
  'GPU glow ignores hidden RGB when extracting highlights from transparent texels');
assert.match(glowShader, /original\.rgb\s*\*\s*original\.a\s*\*\s*\(1\.0\s*-\s*glowAlpha\)\s*\+\s*u_color\s*\*\s*glowAlpha/,
  'GPU glow composites source and tint in premultiplied-alpha space');
assert.match(glowShader, /outputAlpha\s*>\s*0\.00001\s*\?\s*outputPremultiplied\s*\/\s*outputAlpha/,
  'GPU glow converts the premultiplied result back to straight RGBA safely');
assert.match(glowShader, /clamp\(bloom\s*\*\s*clamp\(u_intensity,\s*0\.0,\s*3\.0\)\s*\*\s*0\.7,\s*0\.0,\s*1\.0\)/,
  'GPU glow intensity above 1 increases bloom opacity until the composite reaches full opacity');
assert.match(glowShader, /original\.a\s*\+\s*glowAlpha\s*\*\s*\(1\.0\s*-\s*original\.a\)/,
  'GPU glow preserves bloom alpha outside translucent source pixels');
assert.match(vignetteShader, /smoothstep\(u_radius\s*-\s*max\(u_softness,\s*0\.0001\),\s*u_radius,\s*dist\)/,
  'vignette uses an ordered, numerically safe falloff');
assert.match(vignetteShader, /float\(max\(u_samples\s*-\s*1,\s*1\)\)/,
  'motion blur shader protects its interpolation denominator');
assert.match(vignetteShader, /float\(max\(u_samples,\s*1\)\)/,
  'radial blur shader protects its interpolation denominator');
assert.match(vignetteShader, /outColor\s*=\s*total\s*>\s*0\.0[\s\S]*:\s*texture\(u_image,\s*v_texCoord\)/,
  'empty directional and radial blur accumulations fall back to the source pixel');
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
const grainSeedUniforms = [];
const compositeModeUniforms = [];
let targetAllocations = 0;
let boundFramebuffer = null;
let boundTexture = null;
let currentDirection;
let currentProgram;
let uniformLocationLookups = 0;
const blurProgram = {}, vignetteProgram = {}, grainProgram = {}, compositeProgram = {};
const mockGL = {
  FRAMEBUFFER: 1, TEXTURE_2D: 2, COLOR_ATTACHMENT0: 3, TEXTURE0: 4,
  RGBA: 5, UNSIGNED_BYTE: 6, ARRAY_BUFFER: 7, FLOAT: 8, TRIANGLES: 9,
  bindTexture: (_target, texture) => { boundTexture = texture; },
  texImage2D: () => { targetAllocations++; },
  framebufferTexture2D: () => {},
  bindFramebuffer: (_target, framebuffer) => { boundFramebuffer = framebuffer; },
  viewport: () => {}, useProgram: program => { currentProgram = program; }, enableVertexAttribArray: () => {},
  bindBuffer: () => {}, vertexAttribPointer: () => {}, activeTexture: () => {},
  uniform1i: (name, value) => {
    if (name === 'u_quality' && currentProgram === blurProgram) qualityUniforms.push(value);
    if (name === 'u_mode' && currentProgram === compositeProgram) compositeModeUniforms.push(value);
  },
  uniform1f: (name, value) => {
    if (name === 'u_radius' && currentProgram === blurProgram) radiusUniforms.push(value);
    if (name === 'u_seed' && currentProgram === grainProgram) grainSeedUniforms.push(value);
  }, uniform3f: () => {}, uniform4f: (name, ...values) => { if (name.startsWith('u_lutRow')) calls.push([name, ...values]); },
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
    ['vignette', { program: vignetteProgram, attributes: { position: 0, texCoord: 1 } }],
    ['film_grain', { program: grainProgram, attributes: { position: 0, texCoord: 1 } }],
    ['composite', { program: compositeProgram, attributes: { position: 0, texCoord: 1 } }],
    ['lut_apply', { program: {}, attributes: { position: 0, texCoord: 1 } }]]),
});
for (const [mode, expectedId] of gpuCompositeModes) {
  gpu.processComposite({ getParamsAt: () => ({ mode, opacity: 1 }) }, textureA, textureB, 0);
}
assert.deepEqual(compositeModeUniforms, gpuCompositeModes.map(([, expectedId]) => expectedId),
  'the preview compositor sends every supported blend mode to its matching GPU shader branch');
const drawsBeforeUnsupportedMode = drawRecords.length;
assert.equal(gpu.processComposite({ getParamsAt: () => ({ mode: 'plus-lighter', opacity: 1 }) }, textureA, textureB, 0), textureA,
  'an unsupported blend mode preserves the base frame rather than silently rendering source-over');
assert.equal(drawRecords.length, drawsBeforeUnsupportedMode,
  'an unsupported blend mode does not execute a misleading composite pass');
drawRecords.length = 0;
const chain = [
  { type: 'blur_gaussian', engine: 'gpu', enabled: true, getParamsAt: () => ({ radius: { value: 4 }, quality: { value: 20 } }), isActiveAt: () => true },
  { type: 'vignette', engine: 'gpu', enabled: true, getParamsAt: () => ({ intensity: 0.4 }), isActiveAt: () => true },
];
const chainOutput = gpu.processChain(chain, sourceTexture, 0.5, { width: 320, height: 180 });
assert.equal(chainOutput, textureA, 'effects after a multipass blur continue through the ping-pong chain');
assert.deepEqual(drawRecords.map(({ direction }) => direction), [[1, 0], [0, 1], undefined],
  'Gaussian blur renders horizontal and vertical passes before the next effect');
const branchGraph = new EffectGraph();
branchGraph.addNode({ id: 'graph-source', type: 'glow', engine: 'gpu' });
branchGraph.addNode({ id: 'graph-base', type: 'color_grade', engine: 'gpu' });
branchGraph.addNode({ id: 'graph-overlay', type: 'vignette', engine: 'gpu' });
branchGraph.addNode({ id: 'graph-merge', type: 'composite', engine: 'gpu' });
branchGraph.connect('graph-source', 'graph-base')
  .connect('graph-source', 'graph-overlay')
  .connect('graph-base', 'graph-merge', 'base')
  .connect('graph-overlay', 'graph-merge', 'overlay');
const dagGpu = Object.create(GPUEffectEngine.prototype);
let graphTargetHighWater = 2;
Object.assign(dagGpu, { gl: { drawingBufferWidth: 320, drawingBufferHeight: 180 }, initialized: true,
  framebuffers: [{ id: 'graph-fb-0' }, { id: 'graph-fb-1' }],
  textures: [{ id: 'graph-texture-0' }, { id: 'graph-texture-1' }],
  _ensureRenderTargets: (_width, _height, count) => {
    graphTargetHighWater = Math.max(graphTargetHighWater, count);
    while (dagGpu.framebuffers.length < count) {
      dagGpu.framebuffers.push({ id: `graph-fb-${dagGpu.framebuffers.length}` });
      dagGpu.textures.push({ id: `graph-texture-${dagGpu.textures.length}` });
    }
  },
  processEffect: (effect, input, _time, renderContext) => ({ node: effect.id, input, fbIndex: renderContext.fbIndex }),
  processComposite: (_effect, base, overlay, _time, renderContext) => ({ node: 'merged', base, overlay, fbIndex: renderContext.fbIndex }),
});
const dagOutput = dagGpu.processGraph(branchGraph, sourceTexture, 0.5);
assert.equal(dagOutput.node, 'merged', 'the GPU DAG executor returns the explicit composite sink');
assert.equal(dagOutput.base.input.node, 'graph-source', 'the base fork receives the preserved parent output');
assert.equal(dagOutput.overlay.input.node, 'graph-source', 'the overlay fork receives the same preserved parent output');
assert.equal(graphTargetHighWater, 3,
  'parallel preview reuses a released root target at the join instead of allocating two targets per graph node');
const chainedDagOutput = dagGpu.processGraph(branchGraph, dagGpu.textures[0], 0.5);
assert.notEqual(chainedDagOutput.base.input.fbIndex, 0,
  'a DAG never renders its root into the framebuffer that contains its input texture');
const bypassedDagOutput = dagGpu.processGraph(branchGraph, dagGpu.textures[0], 0.5, {}, () => false);
assert.equal(bypassedDagOutput.base, dagGpu.textures[0],
  'bypassed root and branch nodes preserve a framebuffer-backed source through the composite');
assert.equal(bypassedDagOutput.overlay, dagGpu.textures[0],
  'all fork consumers retain a bypassed framebuffer-backed source until the join');
assert.notEqual(bypassedDagOutput.fbIndex, 0,
  'the composite join also avoids overwriting a framebuffer-backed source while reading it');
const blurBranchGraph = new EffectGraph();
blurBranchGraph.addNode({ id: 'blur-root', type: 'glow', engine: 'gpu' });
blurBranchGraph.addNode({ id: 'blur-branch', type: 'blur_gaussian', engine: 'gpu' });
blurBranchGraph.addNode({ id: 'clean-branch', type: 'vignette', engine: 'gpu' });
blurBranchGraph.addNode({ id: 'blur-merge', type: 'composite', engine: 'gpu' });
blurBranchGraph.connect('blur-root', 'blur-branch')
  .connect('blur-root', 'clean-branch')
  .connect('blur-branch', 'blur-merge', 'base')
  .connect('clean-branch', 'blur-merge', 'overlay');
let blurGraphTargetHighWater = 2;
const blurGraphPasses = [];
const recyclingGpu = Object.create(GPUEffectEngine.prototype);
Object.assign(recyclingGpu, {
  gl: { drawingBufferWidth: 320, drawingBufferHeight: 180 }, initialized: true,
  framebuffers: [{ id: 'recycle-fb-0' }, { id: 'recycle-fb-1' }],
  textures: [{ id: 'recycle-texture-0' }, { id: 'recycle-texture-1' }],
  _ensureRenderTargets: (_width, _height, count) => {
    blurGraphTargetHighWater = Math.max(blurGraphTargetHighWater, count);
    while (recyclingGpu.framebuffers.length < count) {
      recyclingGpu.framebuffers.push({ id: `recycle-fb-${recyclingGpu.framebuffers.length}` });
      recyclingGpu.textures.push({ id: `recycle-texture-${recyclingGpu.textures.length}` });
    }
  },
  processEffect: (effect, input, _time, renderContext) => {
    const outputIndex = renderContext.fbIndex + (effect.type === 'blur_gaussian' ? 1 : 0);
    const output = recyclingGpu.textures[outputIndex];
    blurGraphPasses.push({ effectId: effect.id, input, output, inputIndex: renderContext.fbIndex, outputIndex });
    return output;
  },
  processComposite: (_effect, _base, _overlay, _time, renderContext) => recyclingGpu.textures[renderContext.fbIndex],
});
const blurGraphOutput = recyclingGpu.processGraph(blurBranchGraph, sourceTexture, 0.5);
assert.ok(blurGraphOutput, 'a DAG with a two-pass blur reaches its explicit composite output');
assert.equal(blurGraphTargetHighWater, 3,
  'a Gaussian blur branch reserves its scratch/output pair and then recycles the scratch target');
assert.ok(blurGraphPasses.every(pass => pass.input !== pass.output),
  'recycled graph targets never create a same-texture input/output feedback pass');
assert.match(radialShader, /composite:[\s\S]*?uniform sampler2D u_overlay/,
  'the branch join shader samples an independent overlay texture');
assert.match(radialShader, /premultiplied \/ outAlpha/,
  'the branch join shader composites alpha-correctly');
let placementAwareTime;
const placementAwareEffect = {
  type: 'vignette', engine: 'gpu', enabled: true,
  getParamsAt: () => ({ intensity: 0.4 }),
  isActiveAt: (time, placement) => { placementAwareTime = [time, placement]; return Boolean(placement); },
};
const clipPlacement = { startTime: 12, duration: 5 };
gpu.processChain([placementAwareEffect], sourceTexture, 13, { width: 320, height: 180, placement: clipPlacement });
assert.deepEqual(placementAwareTime, [13, clipPlacement],
  'GPU preview activity checks use the same clip placement bounds as pipeline selection');
gpu.processChain([{ type: 'film_grain', engine: 'gpu', enabled: true,
  getParamsAt: () => ({ intensity: 0.2, size: 2, animated: true, seed: 17 }), isActiveAt: () => true }],
sourceTexture, 0.5, { width: 320, height: 180 });
const lutUniformStart = calls.length;
gpu.processChain([{ type: 'lut_apply', engine: 'cpu', enabled: true,
  getParamsAt: () => ({ lutId: 'warm', intensity: 0.5 }), isActiveAt: () => true }],
sourceTexture, 0.5, { width: 320, height: 180, lutPreviewFilters: { warm: 'brightness(1.2) contrast(1.1)' } });
assert.deepEqual(calls.slice(lutUniformStart).filter(([name]) => name.startsWith('u_lutRow'))
  .map(([name, ...values]) => [name, ...values.map(value => Number(value.toFixed(3)))]), [
  ['u_lutRow0', 1.155, 0, 0, -0.025],
  ['u_lutRow1', 0, 1.155, 0, -0.025],
  ['u_lutRow2', 0, 0, 1.155, -0.025],
], 'the real GPU pass applies per-effect LUT intensity to its color matrix uniforms');
assert.deepEqual(grainSeedUniforms, [17], 'the GPU preview receives the authored deterministic film-grain seed');
assert.deepEqual(radiusUniforms, [4, 4], 'both Gaussian blur passes use the same radius');
assert.deepEqual(qualityUniforms, [20, 20], 'the authored Gaussian quality controls the tap count in both passes');
assert.ok(drawRecords.every(({ input, output }) => input !== output),
  'effect passes never sample from the texture attached as their render target');
assert.equal(targetAllocations, 2, 'render targets allocate once for a frame size, not once per effect pass');
let addedTargetStorage = 0;
let addedRenderTargets = 0;
const growGl = {
  TEXTURE_2D: 2, TEXTURE_WRAP_S: 10, TEXTURE_WRAP_T: 11, TEXTURE_MIN_FILTER: 12,
  TEXTURE_MAG_FILTER: 13, CLAMP_TO_EDGE: 14, LINEAR: 15, FRAMEBUFFER: 1,
  COLOR_ATTACHMENT0: 3, RGBA: 5, UNSIGNED_BYTE: 6,
  createTexture: () => ({ id: `dag-texture-${addedRenderTargets++}` }),
  createFramebuffer: () => ({ id: `dag-framebuffer-${addedRenderTargets}` }),
  bindTexture: () => {}, texParameteri: () => {}, bindFramebuffer: () => {}, framebufferTexture2D: () => {},
  texImage2D: () => { addedTargetStorage++; },
};
const growingGpu = Object.create(GPUEffectEngine.prototype);
Object.assign(growingGpu, { gl: growGl, textures: [{}, {}], framebuffers: [{}, {}], targetWidth: 320, targetHeight: 180 });
growingGpu._ensureRenderTargets(320, 180, 6);
assert.equal(growingGpu.textures.length, 6, 'parallel graph preview allocates a retained render target per graph node');
assert.equal(addedTargetStorage, 4, 'new graph targets receive storage even when the preview size is already cached');

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
    if (type === 'fade_in' || type === 'fade_out') {
      assert.equal(config, undefined, `${type} uses the dedicated fade overlay once, without a duplicate GPU pass`);
    } else {
      assert.ok(config && config.type === definition.shader,
        `${type} footage control resolves to its declared ${definition.shader} shader`);
    }
  }
  const params = Object.fromEntries(Object.entries(definition.params || {}).map(([key, value]) => [key, value.value]));
  assert.ok(exportProcessor.compileTimelineVisualEffects([{ kind: type, params }], { width: 1080, height: 1920 }).length > 0,
    `${type} has an export filter implementation`);
}
assert.equal(EFFECT_DEFINITIONS.film_grain.params.seed.value, 941,
  'film grain exposes the same deterministic default seed in its editable controls and export renderer');
assert.match(fs.readFileSync(new URL('../client/src/effects/engines/GPUEffects.js', import.meta.url), 'utf8'),
  /u_seed.*?hash.*?grainCoord\.x/s,
  'the GPU film grain shader uses the authored seed in the same coordinate hash family as export');
assert.deepEqual(createGpuClipEffectConfigs('fade-test', [
  { kind: 'fade_in' }, { kind: 'fade_out' }, { kind: 'vignette' },
]).map(effect => effect.type), ['vignette'],
  'dedicated color/alpha fade overlays do not also enter the base clip GPU effect chain');
assert.equal(isGpuClipEffect('shake'), false,
  'camera shake stays on the timeline transform path instead of being double-applied as a pixel shader');
const previewableEffects = Object.keys(EFFECT_DEFINITIONS).filter(type => type !== 'shake' && isGpuClipEffect(type));
assert.equal(resolveTimelineEffectFilter(previewableEffects.map(kind => ({ kind })), 0, { gpuPreview: true }), '',
  'the WebGL preview does not stack duplicate CSS approximations on shader-backed footage effects');
assert.equal(resolveTimelineVignetteStyle([{ kind: 'vignette' }], 0, { gpuPreview: true }), null,
  'the WebGL vignette shader does not stack the CSS vignette overlay');
const grainFallback = [{ kind: 'film_grain', params: { intensity: 0.4, seed: 23 } }];
const fallbackContext = { gpuPreview: true, gpuSupportedEffectTypes: ['color_grade'] };
assert.match(resolveTimelineEffectFilter(grainFallback, 0, fallbackContext), /vibed-film-grain/,
  'an effect whose shader failed compilation remains visible through the SVG fallback');
assert.equal(resolveTimelineSvgEffectInstances(grainFallback, 0, fallbackContext).length, 1,
  'unsupported GPU effects keep their parameterized SVG filter definition');
assert.equal(resolveTimelineSvgEffectInstances(grainFallback, 0, {
  gpuPreview: true, gpuSupportedEffectTypes: ['film_grain'],
}).length, 0, 'a working shader suppresses the duplicate SVG filter');
assert.ok(resolveTimelineVignetteStyle([{ kind: 'vignette' }], 0, fallbackContext),
  'an unavailable GPU vignette falls back to the CSS edge tint');
assert.equal(resolveTimelineVignetteStyle([{ kind: 'vignette' }], 0, {
  gpuPreview: true, gpuSupportedEffectTypes: ['vignette'],
}), null, 'a working vignette shader suppresses its CSS overlay');
assert.equal(resolveTimelineSvgEffectParams(grainFallback, 0, {
  gpuPreview: true, gpuSupportedEffectTypes: ['film_grain'],
}).grain.intensity, 0.15,
  'SVG parameter resolution ignores effects that the GPU has already rendered');

const routingPipeline = new EffectPipeline();
routingPipeline.hasActiveEffectsAt = () => false;
const missingRendererWarnings = [];
const missingRendererPipeline = new EffectPipeline({ onPreviewWarning: warning => missingRendererWarnings.push(warning) });
missingRendererPipeline.getActiveEffects = () => [{ id: 'gpu-effect-without-renderer', engine: 'gpu' }];
const unprocessedPreviewTexture = { id: 'original-preview-texture' };
assert.equal(missingRendererPipeline.processPreview(unprocessedPreviewTexture, 'missing-renderer-target', 0), unprocessedPreviewTexture,
  'a missing GPU renderer keeps the source texture available for preview');
assert.equal(missingRendererPipeline.processPreview(unprocessedPreviewTexture, 'missing-renderer-target', 1), unprocessedPreviewTexture,
  'a missing GPU renderer does not interrupt later preview frames');
assert.equal(missingRendererWarnings.length, 1,
  'a missing GPU renderer emits one deduplicated preview warning for the active effect stack');
assert.equal(missingRendererWarnings[0].type, 'gpu_effect_preview_unavailable');
const cpuPreviewWarnings = [];
const cpuOnlyPreviewPipeline = new EffectPipeline({ onPreviewWarning: warning => cpuPreviewWarnings.push(warning) });
cpuOnlyPreviewPipeline.getActiveEffects = () => [{
  id: 'cpu-lut-effect', type: 'lut_apply', name: 'Custom LUT', engine: 'cpu', enabled: true,
}];
assert.equal(cpuOnlyPreviewPipeline.processPreview(unprocessedPreviewTexture, 'cpu-preview-target', 0), unprocessedPreviewTexture,
  'CPU-only effects keep playback running when real-time preview cannot render them');
assert.equal(cpuPreviewWarnings.length, 1, 'CPU-only effects report their preview limitation once');
assert.equal(cpuPreviewWarnings[0].type, 'cpu_effect_preview_unavailable');
assert.match(cpuPreviewWarnings[0].message, /not rendered in real-time preview: Custom LUT/);
assert.equal(cpuOnlyPreviewPipeline.processPreview(unprocessedPreviewTexture, 'cpu-preview-target', 1), unprocessedPreviewTexture);
assert.equal(cpuPreviewWarnings.length, 1, 'CPU preview limitation warnings are deduplicated for a stable stack');
let lutProviderCalls = 0;
let renderedLutContext = null;
const lutPreviewPipeline = new EffectPipeline({
  lutPreviewProvider: async lutId => { lutProviderCalls++; assert.equal(lutId, 'look-1'); return 'brightness(1.1) saturate(0.8)'; },
  gpuEngine: {
    supportsPreviewEffect: effect => effect.type === 'lut_apply',
    processChain: (_effects, _texture, _time, context) => { renderedLutContext = context; return { id: 'lut-preview' }; },
  },
});
lutPreviewPipeline.getActiveEffects = () => [{ id: 'lut-1', type: 'lut_apply', name: 'Look', engine: 'cpu', enabled: true, params: { lutId: 'look-1', intensity: 0.7 } }];
assert.equal(lutPreviewPipeline.processPreview(unprocessedPreviewTexture, 'lut-target', 0), unprocessedPreviewTexture,
  'the source frame remains available while the authenticated LUT preview is loading');
await Promise.all([...lutPreviewPipeline._lutPreviewRequests.values()]);
assert.equal(lutProviderCalls, 1, 'the authenticated LUT preview is fetched once and cached');
assert.equal(lutPreviewPipeline.processPreview(unprocessedPreviewTexture, 'lut-target', 0).id, 'lut-preview',
  'a supported LUT preview joins the GPU effect chain once its preview filter is ready');
assert.equal(renderedLutContext.lutPreviewFilters['look-1'], 'brightness(1.1) saturate(0.8)',
  'the GPU effect chain receives the fetched filter for LUT matrix conversion');
const noWebGLWarnings = [];
const noWebGLPipeline = new EffectPipeline({ onPreviewWarning: warning => noWebGLWarnings.push(warning) });
noWebGLPipeline.getActiveEffects = () => [{ id: 'webgl-lost-effect', engine: 'gpu', enabled: true }];
const noWebGLRenderer = new EffectRenderer({ pipeline: noWebGLPipeline });
const noWebGLTexture = { id: 'source-without-webgl' };
const noWebGLPlacement = { id: 'placement-with-gpu-effect' };
assert.equal(noWebGLRenderer.renderPreview(noWebGLTexture, [noWebGLPlacement], 0), noWebGLTexture,
  'missing WebGL preserves the source preview frame');
assert.equal(noWebGLRenderer.renderPreview(noWebGLTexture, [noWebGLPlacement], 1), noWebGLTexture,
  'missing WebGL does not interrupt subsequent preview frames');
assert.equal(noWebGLWarnings.length, 1,
  'missing WebGL reports the skipped GPU effect once per active stack');
assert.equal(noWebGLWarnings[0].type, 'gpu_effect_preview_unavailable');
const noWebGLCpuWarnings = [];
const noWebGLCpuPipeline = new EffectPipeline({ onPreviewWarning: warning => noWebGLCpuWarnings.push(warning) });
noWebGLCpuPipeline.getActiveEffects = () => [{ id: 'no-webgl-cpu-effect', engine: 'cpu', enabled: true }];
const noWebGLCpuRenderer = new EffectRenderer({ pipeline: noWebGLCpuPipeline });
assert.equal(noWebGLCpuRenderer.renderPreview(noWebGLTexture, [noWebGLPlacement], 0), noWebGLTexture,
  'CPU effects do not interrupt playback when the preview has no WebGL context');
assert.equal(noWebGLCpuWarnings.length, 1, 'the no-WebGL fallback also reports CPU effects omitted from preview');
assert.equal(noWebGLCpuWarnings[0].type, 'cpu_effect_preview_unavailable');
const placementNoWebGLWarnings = [];
const placementNoWebGLPipeline = new EffectPipeline({ onPreviewWarning: warning => placementNoWebGLWarnings.push(warning) });
placementNoWebGLPipeline.getActiveEffects = () => [{ id: 'placement-webgl-lost-effect', engine: 'gpu', enabled: true }];
const placementNoWebGLRenderer = new EffectRenderer({ pipeline: placementNoWebGLPipeline });
assert.equal(placementNoWebGLRenderer.renderPlacementPreview(noWebGLTexture, noWebGLPlacement, 0), noWebGLTexture,
  'per-placement preview preserves the source frame when WebGL is unavailable');
assert.equal(placementNoWebGLWarnings.length, 1,
  'per-placement preview reports active GPU effects when WebGL is unavailable');
const unsupportedGpuWarnings = [];
let processedGpuEffects = [];
const supportAwarePipeline = new EffectPipeline({
  gpuEngine: {
    supportsEffect: type => type === 'glow',
    processChain: effects => { processedGpuEffects = effects; return { id: 'processed-preview' }; },
  },
  onPreviewWarning: warning => unsupportedGpuWarnings.push(warning),
});
supportAwarePipeline.getActiveEffects = () => [
  { id: 'supported-glow', name: 'Glow', type: 'glow', engine: 'gpu' },
  { id: 'unsupported-shader', name: 'Missing shader', type: 'future-effect', engine: 'gpu' },
];
const supportedAndUnsupportedPreview = supportAwarePipeline.processPreview(unprocessedPreviewTexture, 'mixed-target', 0);
assert.equal(supportedAndUnsupportedPreview.id, 'processed-preview',
  'a missing shader does not prevent supported effects in the same chain from rendering');
assert.deepEqual(processedGpuEffects.map(effect => effect.id), ['supported-glow'],
  'only effects with an available GPU shader enter the preview render chain');
assert.equal(unsupportedGpuWarnings.length, 1);
assert.equal(unsupportedGpuWarnings[0].type, 'gpu_effect_unsupported',
  'an effect without a GPU shader is surfaced through the preview warning channel');
supportAwarePipeline.processPreview(unprocessedPreviewTexture, 'mixed-target', 1);
assert.equal(unsupportedGpuWarnings.length, 1, 'unsupported shader warnings are deduplicated across playback frames');
const invalidGraphWarnings = [];
const invalidGraphPipeline = new EffectPipeline({ onPreviewWarning: warning => invalidGraphWarnings.push(warning) });
const invalidPreviewGraph = new EffectGraph();
for (const id of ['branch-root', 'branch-left', 'branch-right']) {
  invalidPreviewGraph.addNode({ id, type: 'glow', engine: 'gpu' });
}
invalidPreviewGraph.connect('branch-root', 'branch-left').connect('branch-root', 'branch-right');
invalidGraphPipeline.effectsByTarget.set('branch-target', invalidPreviewGraph);
assert.equal(invalidGraphPipeline.processPreview(unprocessedPreviewTexture, 'branch-target', 0), unprocessedPreviewTexture,
  'an invalid effect graph leaves the source frame visible instead of crashing playback');
assert.equal(invalidGraphPipeline.processPreview(unprocessedPreviewTexture, 'branch-target', 1), unprocessedPreviewTexture,
  'subsequent frames remain playable while the graph is invalid');
assert.equal(invalidGraphWarnings.length, 1, 'invalid graph warnings are deduplicated per target and cause');
assert.equal(invalidGraphWarnings[0].type, 'effect_graph_preview_unavailable');
assert.match(invalidGraphWarnings[0].message, /one input and one output/);
const compositeGraphWarnings = [];
let processedGraphPlan = null;
const compositeGraphPipeline = new EffectPipeline({
  gpuEngine: {
    supportsPreviewEffect: () => true,
    processGraph: (graph, texture) => { processedGraphPlan = graph.getExecutionPlan(); return { id: 'composite-graph-preview', texture }; },
  },
  onPreviewWarning: warning => compositeGraphWarnings.push(warning),
});
compositeGraphPipeline.effectsByTarget.set('composite-graph-target', branchGraph);
const compositeGraphPreview = compositeGraphPipeline.processPreview(unprocessedPreviewTexture, 'composite-graph-target', 0.5);
assert.equal(compositeGraphPreview.id, 'composite-graph-preview',
  'a valid branched graph is sent to the DAG renderer instead of being skipped');
assert.equal(processedGraphPlan.joins[0].type, 'composite', 'the graph plan preserves its explicit merge operation');
assert.equal(compositeGraphWarnings.length, 0, 'supported branch preview does not emit an invalid-graph warning');
missingRendererPipeline.getActiveEffects = () => [];
assert.equal(missingRendererPipeline.processPreview(unprocessedPreviewTexture, 'no-effects-target', 2), unprocessedPreviewTexture);
assert.equal(missingRendererWarnings.length, 1, 'no warning is emitted when the target has no active GPU effects');
missingRendererPipeline.setGPUEngine({});
assert.equal(missingRendererPipeline._previewWarnings.size, 0, 'restoring a GPU renderer clears stale preview warnings');
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
