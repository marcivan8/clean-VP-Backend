import assert from 'node:assert/strict';
import { EffectPipeline } from '../client/src/effects/EffectPipeline.js';
import { ENGINE_TYPES } from '../client/src/effects/EffectNode.js';
import { effectRegistry } from '../client/src/effects/EffectRegistry.js';
import { AIEffectEngine } from '../client/src/effects/engines/AIEffects.js';

const pipeline = new EffectPipeline({
  aiEngine: {
    async preAnalyzeChain(effects) {
      return Object.fromEntries(effects.map(effect => [effect.id, {
        success: true,
        effectKeyframes: [
          { time: 2, intensity: 7, easing: 'linear' },
          { time: 2.1, intensity: 0, easing: 'easeOut' },
        ],
      }]));
    },
  },
});
pipeline.addEffect({ id: 'beat-shake', type: 'beat_sync', engine: ENGINE_TYPES.AI, targetId: 'clip-a',
  params: { effectType: 'shake', intensity: 0.7, beatDivision: 1 } });

const job = await pipeline.buildRenderJob({
  duration: 4,
  tracks: [{ id: 'video', type: 'video', clips: [{ id: 'clip-a', assetId: 'asset-a', start: 0, duration: 4, offset: 0, speed: 1 }] }],
  assets: [{ id: 'asset-a', url: '/source.mp4' }],
}, '/output.mp4');
const clip = job.timeline.tracks[0].clips[0];
const shake = clip.effects.find(effect => effect.id === 'beat-shake-generated-shake');
assert.ok(shake, 'beat shake analysis compiles into a real footage shake effect');
assert.equal(shake.kind, 'shake');
assert.deepEqual(shake.keyframes.intensity.map(frame => [frame.time, frame.value]), [[2, 7], [2.08, 0]]);
assert.equal(clip.effects.some(effect => effect.id === 'beat-shake'), false,
  'the analysis directive itself is not sent to the compositor as a no-op effect');
assert.equal(clip.metadata.aiEffectAnalysis['beat-shake'].success, true,
  'the verified analysis remains available in clip metadata');
assert.equal(effectRegistry.get('beat_sync').params.effectType.options.includes('cut'), false,
  'unsupported beat cut mode is not selectable');

const persisted = new EffectPipeline();
persisted.addEffect({ id: 'restored-grade', type: 'color_grade', engine: ENGINE_TYPES.GPU, targetId: 'clip-restored',
  params: { brightness: 100, contrast: 100, saturation: 100 } });
const restored = EffectPipeline.deserialize(persisted.serialize());
const restoredGraphEffect = restored.getGraphForTarget('clip-restored').getNode('restored-grade');
assert.equal(restoredGraphEffect, restored.getEffect('restored-grade'),
  'deserialized ID lookup and target graph share one canonical EffectNode');
restored.updateEffect('restored-grade', { params: { brightness: 135 } });
assert.equal(restoredGraphEffect.getParam('brightness'), 135,
  'editing a deserialized effect updates the node consumed by preview and export');
assert.equal(restoredGraphEffect.params.brightness.max, 200,
  'registry parameter ranges survive creation and serialization so valid GPU values are not clamped to 1');

const aiEngine = new AIEffectEngine({ fallbackEnabled: false });
const zeroIntensity = aiEngine.generateBeatSyncKeyframes({ beats: [1] }, 'zoom_pulse', { intensity: 0 });
assert.deepEqual(zeroIntensity.map(frame => frame.scale), [1, 1],
  'explicit zero beat intensity must not be replaced with the default pulse');

const originalFetch = globalThis.fetch;
let zoomPayload;
globalThis.fetch = async (_url, init) => {
  zoomPayload = JSON.parse(init.body);
  return { ok: true, json: async () => ({ success: true, keyframes: [] }) };
};
try {
  await aiEngine.analyzeSmartZoom('/source.mp4', { zoomLevel: 1.25, smoothness: 0 });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(zoomPayload.smoothness, 0, 'explicit zero smart-zoom smoothness must reach analysis');

const previewCalls = [];
const previewPipeline = new EffectPipeline({ gpuEngine: {
  processChain(effects, texture, _time, context) {
    previewCalls.push({ texture, target: context.placement.id });
    return { renderedFrom: texture, target: context.placement.id };
  },
} });
for (const id of ['base', 'overlay']) previewPipeline.addEffect({
  id: `fx-${id}`, type: 'blur_gaussian', engine: ENGINE_TYPES.GPU, targetId: id,
});
const baseSource = { source: 'base' };
const overlaySource = { source: 'overlay' };
const previewLayers = previewPipeline.processAllPreviews(new Map([
  ['base', baseSource], ['overlay', overlaySource],
]), [{ id: 'base', duration: 10 }, { id: 'overlay', duration: 10 }], 0);
assert.equal(previewLayers.get('base').renderedFrom, baseSource,
  'base layer preview starts from its own source texture');
assert.equal(previewLayers.get('overlay').renderedFrom, overlaySource,
  'overlay effects render independently instead of inheriting the base output');
assert.deepEqual(previewCalls.map(call => call.texture), [baseSource, overlaySource]);
console.log('Effect pipeline AI checks passed: generated effects compile, unsupported modes stay hidden, and explicit zero parameters are preserved.');
