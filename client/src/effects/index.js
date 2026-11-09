/**
 * Effects Engine Index
 * Exports all effects engine components for Viral Pilot.
 */

import { EffectPipeline as RuntimeEffectPipeline } from './EffectPipeline.js';
import { EffectRenderer as RuntimeEffectRenderer } from './EffectRenderer.js';
import { GPUEffectEngine as RuntimeGPUEffectEngine } from './engines/GPUEffects.js';
import { CPUEffectEngine as RuntimeCPUEffectEngine } from './engines/CPUEffects.js';
import { AIEffectEngine as RuntimeAIEffectEngine } from './engines/AIEffects.js';
import { presetLibrary as runtimePresetLibrary } from './presets/PresetLibrary.js';

// === Core ===
export {
    EffectNode,
    createEffectNode,
    ENGINE_TYPES,
    PARAM_TYPES
} from './EffectNode.js';

export {
    EffectGraph,
    createEffectGraph
} from './EffectGraph.js';

export {
    effectRegistry,
    EFFECT_DEFINITIONS,
    EFFECT_CATEGORIES
} from './EffectRegistry.js';

// === Pipeline & Rendering ===
export {
    EffectPipeline,
    createEffectPipeline
} from './EffectPipeline.js';

export {
    EffectRenderer,
    createEffectRenderer,
    RENDER_MODE
} from './EffectRenderer.js';

// === Engines ===
export { GPUEffectEngine } from './engines/GPUEffects.js';
export { CPUEffectEngine } from './engines/CPUEffects.js';
export { AIEffectEngine } from './engines/AIEffects.js';

// === Presets ===
export {
    EffectPreset,
    createPreset,
    PRESET_CATEGORIES
} from './presets/EffectPreset.js';

export {
    presetLibrary,
    PresetLibrary,
    BUILTIN_PRESETS
} from './presets/PresetLibrary.js';

// ============================================================================
// CONVENIENCE FACTORY
// ============================================================================

/**
 * Initialize the complete effects engine
 * @param {object} options - Initialization options
 * @returns {object} Initialized engine components
 */
export function initEffectsEngine(options = {}) {
    // Create engine instances
    const gpuEngine = options.gl ? new RuntimeGPUEffectEngine(options.gl) : null;
    const cpuEngine = new RuntimeCPUEffectEngine(options.cpu);
    const aiEngine = new RuntimeAIEffectEngine(options.ai);

    // Create pipeline with engines
    const pipeline = new RuntimeEffectPipeline({
        gpuEngine,
        cpuEngine,
        aiEngine,
        onEffectChange: options.onEffectChange
    });

    // Create renderer
    const renderer = new RuntimeEffectRenderer({
        gl: options.gl,
        pipeline,
        onProgress: options.onProgress,
        onComplete: options.onComplete,
        onError: options.onError
    });

    // Load user presets
    runtimePresetLibrary.loadUserPresets();

    return {
        pipeline,
        renderer,
        gpuEngine,
        cpuEngine,
        aiEngine,
        presetLibrary: runtimePresetLibrary,

        // Convenience methods
        addEffect: (config) => pipeline.addEffect(config),
        removeEffect: (id) => pipeline.removeEffect(id),
        applyPreset: (presetId, targetId, options) => {
            const preset = runtimePresetLibrary.getPreset(presetId);
            if (preset) {
                return renderer.applyPreset(preset, targetId, options);
            }
            return [];
        },
        getActiveEffects: (targetId, time) => pipeline.getActiveEffects(targetId, time),
        renderPreview: (texture, placements, time, ctx) =>
            renderer.renderPreview(texture, placements, time, ctx),
        renderFinal: (timeline, outputPath, options) =>
            renderer.renderFinal(timeline, outputPath, options)
    };
}
