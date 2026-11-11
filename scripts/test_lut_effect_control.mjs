import assert from 'node:assert/strict';
import fs from 'node:fs';
import { effectRegistry } from '../client/src/effects/EffectRegistry.js';
import { EffectPipeline } from '../client/src/effects/EffectPipeline.js';
import { resolveTimelineLutPreviewFilter } from '../client/src/motion/TimelineVisualEffects.js';

const definition = effectRegistry.get('lut_apply');
assert.equal(definition.params.lutId.type, 'select', 'LUT effects choose a trusted library asset ID');
assert.deepEqual(definition.params.lutId.options, [], 'the browser fills options from the authenticated LUT library');
assert.equal(Object.hasOwn(definition.params, 'lutFile'), false,
  'new LUT effects do not accept arbitrary worker filesystem paths');
assert.equal(definition.ffmpegFilter({ lutId: 'untrusted-id' }), null,
  'the registry never interpolates a LUT id into a raw FFmpeg filter');

const pipeline = new EffectPipeline();
pipeline.addEffect({
  id: 'selected-lut', type: 'lut_apply', engine: 'cpu', targetId: 'clip-1',
  params: { lutId: 'lut-library-id', intensity: 0.65 },
});
const job = await pipeline.buildRenderJob({
  tracks: [{ id: 'video', clips: [{ id: 'clip-1', duration: 4, effects: [] }] }],
  assets: [],
});
const serialized = job.timeline.tracks[0].clips[0].effects.find(effect => effect.type === 'lut_apply');
assert.equal(serialized.params.lutId, 'lut-library-id', 'the selected LUT ID survives timeline job compilation');
assert.equal(serialized.params.intensity, 0.65, 'LUT mix strength survives timeline job compilation');

const lutEffects = [{ type: 'lut_apply', enabled: true, params: { lutId: 'lut-a', intensity: 0.5 } }];
assert.equal(resolveTimelineLutPreviewFilter(lutEffects, { 'lut-a': 'brightness(1.2) saturate(1.4) hue-rotate(20deg)' }),
  'brightness(1.1) saturate(1.2) hue-rotate(10deg)',
  'clip LUT preview blends supported CSS grade values by the authored effect intensity');
assert.equal(resolveTimelineLutPreviewFilter(lutEffects, { 'lut-a': 'brightness(1.2)' }, 0, {
  gpuPreview: true, gpuSupportedEffectTypes: ['lut_apply'],
}), '', 'CSS LUT approximation is suppressed when the WebGL footage pipeline supports it');
assert.equal(resolveTimelineLutPreviewFilter([{ ...lutEffects[0], params: { lutId: 'lut-a', intensity: 1 } }], {
  'lut-a': 'blur(1px)',
}, 0, { gpuPreview: true, gpuSupportedEffectTypes: ['lut_apply'] }), 'blur(1px)',
  'unsupported LUT preview filters retain the CSS fallback even when the LUT shader is available');
assert.equal(resolveTimelineLutPreviewFilter(lutEffects, {}), '',
  'missing LUT previews do not leave stale or fabricated color filters');
assert.equal(resolveTimelineLutPreviewFilter([{ ...lutEffects[0], enabled: false }], { 'lut-a': 'brightness(1.2)' }), '',
  'disabled LUT effects do not affect the preview');

const controls = fs.readFileSync(new URL('../client/src/components/Effects/EffectControls.jsx', import.meta.url), 'utf8');
assert.match(controls, /audioEngineAPI\.listLUTs\(\{ limit: 100 \}\)/,
  'the effect control loads available LUT choices from the shared library API');
assert.match(controls, /value: String\(lut\.id\)/,
  'the effect control stores the trusted LUT ID rather than a local path');

const player = fs.readFileSync(new URL('../client/src/components/Player/VideoPlayer.jsx', import.meta.url), 'utf8');
assert.match(player, /audioEngineAPI\.getLUTPreview\(lutId\)/,
  'the active clip resolves LUT IDs through the authenticated LUT preview API');
assert.match(player, /canvasClipLutFilter/,
  'per-clip LUT previews are applied in the canvas and fallback preview paths');

console.log('LUT effect control checks passed: safe library selection, timeline serialization, and intensity persistence.');
