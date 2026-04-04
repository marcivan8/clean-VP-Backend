/**
 * EffectPipeline.js
 * Orchestrates multi-engine effect rendering for Viral Pilot.
 * 
 * Manages effect chains, coordinates between GPU/CPU/AI engines,
 * and provides timeline-aware rendering.
 */

import { EffectNode, ENGINE_TYPES } from './EffectNode.js';
import { EffectGraph, createEffectGraph } from './EffectGraph.js';
import { effectRegistry } from './EffectRegistry.js';
import { GPUEffectEngine } from './engines/GPUEffects.js';
import { CPUEffectEngine } from './engines/CPUEffects.js';
import { AIEffectEngine } from './engines/AIEffects.js';

// ============================================================================
// EFFECT PIPELINE CLASS
// ============================================================================

export class EffectPipeline {
    constructor(options = {}) {
        // Store effects by target
        this.effectsByTarget = new Map();  // targetId -> EffectGraph

        // All effects flat list
        this.allEffects = new Map();  // effectId -> EffectNode

        // Engine instances
        this.gpuEngine = options.gpuEngine || null;
        this.cpuEngine = options.cpuEngine || new CPUEffectEngine(options.cpu);
        this.aiEngine = options.aiEngine || new AIEffectEngine(options.ai);

        // Cached AI analysis results
        this.aiAnalysisCache = new Map();

        // Event handlers
        this.onEffectChange = options.onEffectChange || null;
    }

    // ========================================================================
    // EFFECT MANAGEMENT
    // ========================================================================

    /**
     * Add an effect to the pipeline
     * @param {EffectNode|object} effectOrConfig - Effect node or config
     * @returns {EffectNode} The added effect
     */
    addEffect(effectOrConfig) {
        // Create node if needed
        let effect;
        if (effectOrConfig instanceof EffectNode) {
            effect = effectOrConfig;
        } else {
            // Get definition from registry
            const def = effectRegistry.get(effectOrConfig.type);
            if (def) {
                const config = effectRegistry.createConfig(effectOrConfig.type, effectOrConfig);
                effect = new EffectNode(config);
            } else {
                effect = new EffectNode(effectOrConfig);
            }
        }

        // Store in flat list
        this.allEffects.set(effect.id, effect);

        // Add to target graph
        if (effect.targetId) {
            if (!this.effectsByTarget.has(effect.targetId)) {
                this.effectsByTarget.set(effect.targetId, new EffectGraph());
            }

            const graph = this.effectsByTarget.get(effect.targetId);
            graph.addNode(effect);
        }

        this._notifyChange('add', effect);

        return effect;
    }

    /**
     * Remove an effect from the pipeline
     */
    removeEffect(effectId) {
        const effect = this.allEffects.get(effectId);
        if (!effect) return false;

        // Remove from target graph
        if (effect.targetId) {
            const graph = this.effectsByTarget.get(effect.targetId);
            if (graph) {
                graph.removeNode(effectId);

                // Clean up empty graphs
                if (graph.isEmpty) {
                    this.effectsByTarget.delete(effect.targetId);
                }
            }
        }

        this.allEffects.delete(effectId);
        this._notifyChange('remove', effect);

        return true;
    }

    /**
     * Update effect parameters
     */
    updateEffect(effectId, updates) {
        const effect = this.allEffects.get(effectId);
        if (!effect) return null;

        // Apply updates
        if (updates.params) {
            for (const [key, value] of Object.entries(updates.params)) {
                effect.setParam(key, typeof value === 'object' ? value.value : value);
            }
        }

        if (updates.enabled !== undefined) effect.enabled = updates.enabled;
        if (updates.order !== undefined) effect.order = updates.order;
        if (updates.startTime !== undefined) effect.startTime = updates.startTime;
        if (updates.endTime !== undefined) effect.endTime = updates.endTime;

        this._notifyChange('update', effect);

        return effect;
    }

    /**
     * Get effect by ID
     */
    getEffect(effectId) {
        return this.allEffects.get(effectId);
    }

    /**
     * Get all effects
     */
    getAllEffects() {
        return Array.from(this.allEffects.values());
    }

    /**
     * Get effects for a specific target
     */
    getEffectsForTarget(targetId) {
        const graph = this.effectsByTarget.get(targetId);
        return graph ? graph.getAllNodes() : [];
    }

    /**
     * Get effect graph for target
     */
    getGraphForTarget(targetId) {
        return this.effectsByTarget.get(targetId);
    }

    // ========================================================================
    // TIMELINE QUERIES
    // ========================================================================

    /**
     * Get effects active at a specific time for a target
     */
    getActiveEffects(targetId, time, placement = null) {
        const graph = this.effectsByTarget.get(targetId);
        if (!graph) return [];

        return graph.getActiveEffectsAt(time, placement);
    }

    /**
     * Get effects by engine type
     */
    getEffectsByEngine(engine) {
        return this.getAllEffects().filter(e => e.engine === engine);
    }

    /**
     * Check if any effects are active at time
     */
    hasActiveEffectsAt(targetId, time, placement = null) {
        return this.getActiveEffects(targetId, time, placement).length > 0;
    }

    // ========================================================================
    // PREVIEW PROCESSING (GPU Only)
    // ========================================================================

    /**
     * Process effects for real-time preview
     * @param {WebGLTexture} texture - Input texture
     * @param {string} targetId - Target placement ID
     * @param {number} time - Current timeline time
     * @param {object} context - Rendering context
     * @returns {WebGLTexture} Processed texture
     */
    processPreview(texture, targetId, time, context = {}) {
        if (!this.gpuEngine) {
            console.warn('[EffectPipeline] No GPU engine available for preview');
            return texture;
        }

        // Get active GPU effects for this target
        const activeEffects = this.getActiveEffects(targetId, time, context.placement)
            .filter(e => e.engine === ENGINE_TYPES.GPU)
            .sort((a, b) => a.order - b.order);

        if (activeEffects.length === 0) {
            return texture;
        }

        // Process through GPU engine
        return this.gpuEngine.processChain(activeEffects, texture, time, context);
    }

    /**
     * Process all active placements for preview
     */
    processAllPreviews(texture, placements, time, context = {}) {
        let result = texture;

        for (const placement of placements) {
            if (this.hasActiveEffectsAt(placement.id, time, placement)) {
                result = this.processPreview(result, placement.id, time, {
                    ...context,
                    placement
                });
            }
        }

        return result;
    }

    // ========================================================================
    // FINAL RENDER PROCESSING
    // ========================================================================

    /**
     * Process effects for final render
     * @param {string} inputPath - Source video path
     * @param {string} targetId - Target placement ID
     * @param {string} outputPath - Output path
     * @param {object} context - Render context
     */
    async processFinal(inputPath, targetId, outputPath, context = {}) {
        const effects = this.getEffectsForTarget(targetId)
            .filter(e => e.enabled)
            .sort((a, b) => a.order - b.order);

        if (effects.length === 0) {
            return { success: true, skipped: true };
        }

        // 1. Pre-analyze AI effects
        const aiEffects = effects.filter(e => e.engine === ENGINE_TYPES.AI);
        if (aiEffects.length > 0) {
            const aiResults = await this.aiEngine.preAnalyzeChain(aiEffects, {
                videoUrl: inputPath,
                audioUrl: context.audioUrl
            });

            // Store AI results for GPU/CPU to use
            for (const [effectId, result] of Object.entries(aiResults)) {
                this.aiAnalysisCache.set(effectId, result);
            }
        }

        // 2. Get GPU effects (will be rendered to intermediate)
        const gpuEffects = effects.filter(e => e.engine === ENGINE_TYPES.GPU);

        // 3. Get CPU effects
        const cpuEffects = effects.filter(e => e.engine === ENGINE_TYPES.CPU);

        // 4. Compile FFmpeg command
        const cpuResult = this.cpuEngine.compileChain(cpuEffects, context);

        // 5. Build render pipeline
        const pipeline = {
            input: inputPath,
            output: outputPath,
            gpuEffects: gpuEffects.map(e => e.serialize()),
            cpuFilter: cpuResult.videoFilter,
            audioFilter: cpuResult.audioFilter,
            aiData: Object.fromEntries(this.aiAnalysisCache)
        };

        return pipeline;
    }

    /**
     * Build complete render job for export
     */
    async buildRenderJob(timeline, outputPath, context = {}) {
        const job = {
            outputPath,
            segments: [],
            globalEffects: [],
            context
        };

        // Process each placement
        for (const [targetId, graph] of this.effectsByTarget) {
            const effects = graph.getAllNodes().filter(e => e.enabled);

            if (effects.length === 0) continue;

            // Pre-analyze AI effects
            const aiEffects = effects.filter(e => e.engine === ENGINE_TYPES.AI);
            if (aiEffects.length > 0) {
                await this.aiEngine.preAnalyzeChain(aiEffects, {
                    videoUrl: context.getVideoUrl?.(targetId)
                });
            }

            job.segments.push({
                targetId,
                effects: effects.map(e => ({
                    ...e.serialize(),
                    aiData: this.aiAnalysisCache.get(e.id)
                }))
            });
        }

        return job;
    }

    // ========================================================================
    // EFFECT REORDERING
    // ========================================================================

    /**
     * Reorder effects for a target
     */
    reorderEffects(targetId, effectIds) {
        const graph = this.effectsByTarget.get(targetId);
        if (!graph) return;

        effectIds.forEach((id, index) => {
            const effect = graph.getNode(id);
            if (effect) {
                effect.order = index;
            }
        });

        this._notifyChange('reorder', { targetId, effectIds });
    }

    /**
     * Move effect up in order
     */
    moveEffectUp(effectId) {
        const effect = this.allEffects.get(effectId);
        if (!effect || !effect.targetId) return;

        const effects = this.getEffectsForTarget(effect.targetId)
            .sort((a, b) => a.order - b.order);

        const index = effects.findIndex(e => e.id === effectId);
        if (index > 0) {
            const prev = effects[index - 1];
            const tempOrder = effect.order;
            effect.order = prev.order;
            prev.order = tempOrder;

            this._notifyChange('reorder', { effectId });
        }
    }

    /**
     * Move effect down in order
     */
    moveEffectDown(effectId) {
        const effect = this.allEffects.get(effectId);
        if (!effect || !effect.targetId) return;

        const effects = this.getEffectsForTarget(effect.targetId)
            .sort((a, b) => a.order - b.order);

        const index = effects.findIndex(e => e.id === effectId);
        if (index < effects.length - 1) {
            const next = effects[index + 1];
            const tempOrder = effect.order;
            effect.order = next.order;
            next.order = tempOrder;

            this._notifyChange('reorder', { effectId });
        }
    }

    // ========================================================================
    // KEYFRAME OPERATIONS
    // ========================================================================

    /**
     * Add keyframe to effect
     */
    addKeyframe(effectId, paramName, time, value, easing = 'linear') {
        const effect = this.allEffects.get(effectId);
        if (!effect) return;

        effect.addKeyframe(paramName, time, value, easing);
        this._notifyChange('keyframe', { effectId, paramName });
    }

    /**
     * Remove keyframe from effect
     */
    removeKeyframe(effectId, paramName, time) {
        const effect = this.allEffects.get(effectId);
        if (!effect) return;

        effect.removeKeyframe(paramName, time);
        this._notifyChange('keyframe', { effectId, paramName });
    }

    /**
     * Get interpolated param value at time
     */
    getParamAt(effectId, paramName, time) {
        const effect = this.allEffects.get(effectId);
        return effect ? effect.getParamAt(paramName, time) : undefined;
    }

    // ========================================================================
    // SERIALIZATION
    // ========================================================================

    /**
     * Serialize pipeline state
     */
    serialize() {
        const graphs = {};

        for (const [targetId, graph] of this.effectsByTarget) {
            graphs[targetId] = graph.serialize();
        }

        return {
            effects: this.getAllEffects().map(e => e.serialize()),
            graphs
        };
    }

    /**
     * Load from serialized state
     */
    static deserialize(data, options = {}) {
        const pipeline = new EffectPipeline(options);

        // Restore effects
        for (const effectData of data.effects || []) {
            const effect = EffectNode.deserialize(effectData);
            pipeline.allEffects.set(effect.id, effect);
        }

        // Restore graphs
        for (const [targetId, graphData] of Object.entries(data.graphs || {})) {
            const graph = EffectGraph.deserialize(graphData);
            pipeline.effectsByTarget.set(targetId, graph);
        }

        return pipeline;
    }

    // ========================================================================
    // UTILITY
    // ========================================================================

    /**
     * Clear all effects
     */
    clear() {
        this.allEffects.clear();
        this.effectsByTarget.clear();
        this.aiAnalysisCache.clear();
        this._notifyChange('clear', null);
    }

    /**
     * Set GPU engine (after initialization)
     */
    setGPUEngine(engine) {
        this.gpuEngine = engine;
    }

    /**
     * Get statistics
     */
    getStats() {
        const effects = this.getAllEffects();

        return {
            totalEffects: effects.length,
            byEngine: {
                gpu: effects.filter(e => e.engine === ENGINE_TYPES.GPU).length,
                cpu: effects.filter(e => e.engine === ENGINE_TYPES.CPU).length,
                ai: effects.filter(e => e.engine === ENGINE_TYPES.AI).length
            },
            targets: this.effectsByTarget.size,
            cachedAnalyses: this.aiAnalysisCache.size
        };
    }

    _notifyChange(type, data) {
        if (this.onEffectChange) {
            this.onEffectChange({ type, data });
        }
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new effect pipeline
 */
export function createEffectPipeline(options = {}) {
    return new EffectPipeline(options);
}

export default EffectPipeline;
