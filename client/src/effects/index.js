/**
 * Effects Engine Index
 * Exports all effects engine components for Viral Pilot.
 */

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
    const { GPUEffectEngine } = require('./engines/GPUEffects.js');
    const { CPUEffectEngine } = require('./engines/CPUEffects.js');
    const { AIEffectEngine } = require('./engines/AIEffects.js');
    const { EffectPipeline } = require('./EffectPipeline.js');
    const { EffectRenderer } = require('./EffectRenderer.js');
    const { presetLibrary } = require('./presets/PresetLibrary.js');

    // Create engine instances
    const gpuEngine = options.gl ? new GPUEffectEngine(options.gl) : null;
    const cpuEngine = new CPUEffectEngine(options.cpu);
    const aiEngine = new AIEffectEngine(options.ai);

    // Create pipeline with engines
    const pipeline = new EffectPipeline({
        gpuEngine,
        cpuEngine,
        aiEngine,
        onEffectChange: options.onEffectChange
    });

    // Create renderer
    const renderer = new EffectRenderer({
        gl: options.gl,
        pipeline,
        onProgress: options.onProgress,
        onComplete: options.onComplete,
        onError: options.onError
    });

    // Load user presets
    presetLibrary.loadUserPresets();

    return {
        pipeline,
        renderer,
        gpuEngine,
        cpuEngine,
        aiEngine,
        presetLibrary,

        // Convenience methods
        addEffect: (config) => pipeline.addEffect(config),
        removeEffect: (id) => pipeline.removeEffect(id),
        applyPreset: (presetId, targetId, options) => {
            const preset = presetLibrary.getPreset(presetId);
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
