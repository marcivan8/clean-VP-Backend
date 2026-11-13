import assert from 'node:assert/strict';
import { EFFECT_DEFINITIONS, effectRegistry } from '../client/src/effects/EffectRegistry.js';
import { ENGINE_TYPES } from '../client/src/effects/EffectNode.js';
import { GPU_SHADER_TYPES } from '../client/src/effects/engines/GPUEffects.js';
import { CPUEffectEngine } from '../client/src/effects/engines/CPUEffects.js';
import { AIEffectEngine } from '../client/src/effects/engines/AIEffects.js';
import { createGpuClipEffectConfigs, resolveGpuClipEffectType } from '../client/src/effects/ClipEffectAdapter.js';
import { resolveTimelineEffectTransform, resolveTimelineFadeOverlays } from '../client/src/motion/TimelineVisualEffects.js';
import { createTimelineRetimeMap } from '../client/src/timeline/retimeMap.js';
import { GRAPHIC_EFFECT_KINDS } from '../client/src/motion/LayerEffects.js';
import { EFFECT_KINDS } from '../client/src/motion/SceneSchema.js';

const cpu = new CPUEffectEngine();
const ai = new AIEffectEngine({ fallbackEnabled: false });
const specialGpuRoutes = new Set(['shake', 'fade_in', 'fade_out']);
const specialCpuRoutes = new Set(['speed_change', 'lut_apply', 'audio_normalize', 'audio_denoise']);

// Registry entries are broader than graphic effects: audio, retiming, and AI
// tools intentionally use their own pipelines. Every visual GPU effect,
// however, must survive scene normalization and have a canvas-layer route.
for (const [type, definition] of Object.entries(EFFECT_DEFINITIONS)) {
  if (definition.engine !== ENGINE_TYPES.GPU) continue;
  assert.ok(EFFECT_KINDS.includes(type), `${type} is accepted by the motion scene schema`);
  assert.ok(GRAPHIC_EFFECT_KINDS.includes(type), `${type} has an executable graphic-layer renderer`);
}

for (const [type, definition] of Object.entries(EFFECT_DEFINITIONS)) {
  assert.equal(effectRegistry.get(type)?.type, type, `${type} is registered in the live effect registry`);

  if (definition.engine === ENGINE_TYPES.GPU) {
    assert.ok(definition.shader, `${type} declares its preview shader`);
    assert.ok(GPU_SHADER_TYPES.includes(definition.shader), `${type} shader ${definition.shader} is compiled by the GPU engine`);

    if (!specialGpuRoutes.has(type)) {
      assert.equal(resolveGpuClipEffectType(type), definition.shader,
        `${type} maps footage preview to the registry shader`);
      const params = Object.fromEntries(Object.entries(definition.params || {}).map(([key, spec]) => [key, spec.value]));
      assert.equal(createGpuClipEffectConfigs('catalog-check', [{ type, params }]).length, 1,
        `${type} builds a clip preview effect config`);
    }
  } else if (definition.engine === ENGINE_TYPES.CPU) {
    assert.ok(cpu.supportsEffect(type), `${type} has a CPU/export engine route`);
    assert.ok(definition.ffmpegFilter || specialCpuRoutes.has(type),
      `${type} has either a declared FFmpeg filter or a dedicated export route`);
  } else if (definition.engine === ENGINE_TYPES.AI) {
    assert.ok(ai.supportsEffect(type), `${type} has an AI analysis implementation`);
  } else {
    assert.fail(`${type} declares unknown engine ${definition.engine}`);
  }
}

const shake = [{ kind: 'shake', params: { intensity: 4, frequency: 10 } }];
assert.notEqual(resolveTimelineEffectTransform(shake, 0.1, 1080), '',
  'shake reaches the dedicated footage transform preview');

for (const type of ['fade_in', 'fade_out']) {
  const time = type === 'fade_in' ? 0.1 : 1.9;
  assert.ok(resolveTimelineFadeOverlays(
    [{ kind: type, params: { duration: 0.5 } }],
    time,
    { clipStart: 0, clipDuration: 2 },
  ).length,
    `${type} reaches the dedicated transition renderer`);
}

const retime = createTimelineRetimeMap({
  start: 0,
  duration: 2,
  effects: [{ kind: 'speed_change', params: { speed: 2, maintainPitch: true } }],
});
assert.ok(retime.timelineToSource(1) > retime.timelineToSource(0),
  'speed_change reaches the shared footage retime map');
assert.equal(retime.maintainPitch, true, 'speed_change preserves its audio pitch setting');

console.log(`Effect catalog wiring passed: ${Object.keys(EFFECT_DEFINITIONS).length} effects have a live render, export, or analysis route.`);
