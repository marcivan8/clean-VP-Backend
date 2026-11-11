/**
 * EffectPipeline.js
 * Orchestrates multi-engine effect rendering for Viral Pilot.
 * 
 * Manages effect chains, coordinates between GPU/CPU/AI engines,
 * and provides timeline-aware rendering.
 */

import { EffectNode, ENGINE_TYPES } from './EffectNode.js';
import { EffectGraph } from './EffectGraph.js';
import { effectRegistry } from './EffectRegistry.js';
import { GPUEffectEngine } from './engines/GPUEffects.js';
import { CPUEffectEngine } from './engines/CPUEffects.js';
import { AIEffectEngine } from './engines/AIEffects.js';
import { resolveEffectParameter } from '../motion/EffectTiming.js';
import { cssFilterToColorMatrix } from './lutPreview.js';

const MAX_EFFECT_EXPRESSION_SAMPLES = 60;

function boundExpressionSamples(samples, max = MAX_EFFECT_EXPRESSION_SAMPLES) {
    if (!Array.isArray(samples) || samples.length <= max || max < 2) return samples;
    const retained = new Set([0, samples.length - 1]);
    while (retained.size < max) {
        const anchors = [...retained].sort((a, b) => a - b);
        let worstError = 0.002;
        let worstIndex = -1;
        for (let span = 0; span < anchors.length - 1; span++) {
            const lo = anchors[span], hi = anchors[span + 1];
            const a = samples[lo], b = samples[hi];
            const range = Number(b.t) - Number(a.t);
            for (let index = lo + 1; index < hi; index++) {
                const point = samples[index];
                const t = range > 0 ? (Number(point.t) - Number(a.t)) / range : (index - lo) / (hi - lo);
                const av = Array.isArray(a.value) ? a.value : [a.value];
                const bv = Array.isArray(b.value) ? b.value : [b.value];
                const pv = Array.isArray(point.value) ? point.value : [point.value];
                const length = Math.max(av.length, bv.length, pv.length);
                let error = 0;
                for (let channel = 0; channel < length; channel++) {
                    const from = Number(av[channel]), to = Number(bv[channel]), actual = Number(pv[channel]);
                    if (![from, to, actual].every(Number.isFinite)) continue;
                    const projected = from + (to - from) * t;
                    error = Math.max(error, Math.abs(actual - projected) / Math.max(1, Math.abs(actual), Math.abs(projected)));
                }
                if (error > worstError) { worstError = error; worstIndex = index; }
            }
        }
        if (worstIndex < 0) break;
        retained.add(worstIndex);
    }
    return [...retained].sort((a, b) => a - b).map(index => samples[index]);
}

function sampleEffectExpressions(effect, clip, fps) {
    const expressions = effect?.expressions || {};
    const keys = Object.keys(expressions).filter(key => typeof expressions[key] === 'string' && expressions[key].trim());
    if (!keys.length) return null;
    const duration = Math.max(0, Number(clip?.duration) || 0);
    if (!duration) return null;
    const clipStart = Number(clip?.start) || 0;
    const requestedRate = Math.max(1, Math.min(120, Number(fps) || 30));
    // Effect expressions are executable JavaScript-free formulas in the
    // browser. The worker's FFmpeg graph consumes numeric samples, so bake the
    // shared resolver's output at the target frame cadence before serialization.
    const requestedCount = Math.ceil(duration * requestedRate);
    const count = Math.max(1, Math.min(18000, requestedCount));
    const sampleInterval = requestedCount > count ? duration / count : 1 / requestedRate;
    const samples = {};
    for (const key of keys) {
        const raw = effect.params?.[key];
        const fallbackValue = raw?.value ?? raw;
        const fallback = Array.isArray(fallbackValue) ? fallbackValue
            : Number.isFinite(Number(fallbackValue)) ? Number(fallbackValue) : 0;
        const denseSamples = Array.from({ length: count + 1 }, (_, index) => {
            const localTime = index === count ? duration : Math.min(duration, index * sampleInterval);
            const value = resolveEffectParameter(effect, key, fallback, clipStart + localTime, {
                clipStart,
                clipDuration: duration,
            });
            const sampled = Array.isArray(value) ? value.map(Number) : Number(value);
            return { t: localTime, value: sampled };
        }).filter(point => Array.isArray(point.value)
            ? point.value.length > 0 && point.value.every(Number.isFinite)
            : Number.isFinite(point.value));
        samples[key] = boundExpressionSamples(denseSamples);
    }
    return samples;
}

function appendKeyframes(track, values) {
    const byTime = new Map((Array.isArray(track) ? track : [])
        .filter(k => Number.isFinite(Number(k?.time)))
        .map(k => [Number(k.time), k]));
    for (const keyframe of values) {
        if (!Number.isFinite(Number(keyframe?.time)) || !Number.isFinite(Number(keyframe?.value))) continue;
        byTime.set(Number(keyframe.time), keyframe);
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function normalizeFramingFrame(frame) {
    const x = Number(frame?.x ?? 0.5);
    const y = Number(frame?.y ?? 0.28);
    const scale = Number(frame?.scale ?? 1);
    const time = Number(frame?.time);
    if (![x, y, scale, time].every(Number.isFinite)) return null;
    return {
        time,
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        scale: Math.max(1, Math.min(3, scale)),
        easing: frame.easing || 'easeInOut'
    };
}

function isTextureMap(value) {
    if (value instanceof Map) return true;
    if (!value || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    // WebGLTexture and other browser media objects are host objects, not plain
    // records. They commonly have no `type` property, so testing for that
    // property misclassifies a shared GPU texture as an ID-to-texture map.
    return prototype === null || prototype === Object.prototype
        || (Object.prototype.toString.call(value) === '[object Object]'
            && prototype?.constructor?.name === 'Object');
}

function applyAIAnalysisToClip(clip, effect, analysis) {
    if (!analysis || analysis.error || analysis.fallback || analysis.success === false) {
        throw new Error(`${effect.name || effect.type} analysis failed: ${analysis?.error || 'no verified result returned'}`);
    }
    const clipDuration = Number(clip.duration) || 0;
    const sourceOffset = Number(clip.offset) || 0;
    const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    const toLocalTime = time => Math.max(0, Math.min(clipDuration, (Number(time) - sourceOffset) / speed));
    const tracks = { ...(clip.keyframes || {}) };

    if (effect.type === 'smart_zoom') {
        const frames = (Array.isArray(analysis.keyframes) ? analysis.keyframes : []).map(normalizeFramingFrame).filter(Boolean);
        tracks.scale = appendKeyframes(tracks.scale, frames.map(frame => ({
            time: toLocalTime(frame.time), value: frame.scale, easing: frame.easing
        })));
        tracks.panX = appendKeyframes(tracks.panX, frames.map(frame => ({
            time: toLocalTime(frame.time), value: 0.5 - frame.x, easing: frame.easing
        })));
        tracks.panY = appendKeyframes(tracks.panY, frames.map(frame => ({
            time: toLocalTime(frame.time), value: 0.28 - frame.y, easing: frame.easing
        })));
        if (!frames.length) throw new Error('Smart zoom analysis returned no framing keyframes');
    } else if (effect.type === 'emotion_frame') {
        const segments = (Array.isArray(analysis.segments) ? analysis.segments : [])
            .filter(segment => segment?.framing && Number.isFinite(Number(segment.startTime)) && Number.isFinite(Number(segment.endTime)))
            .sort((a, b) => Number(a.startTime) - Number(b.startTime));
        const scaleFrames = [];
        const panXFrames = [];
        const panYFrames = [];
        let previous = { x: 0.5, y: 0.28, scale: 1 };
        const transitionDuration = Math.max(0.05, Number(effect.getParam('transitionSpeed')) || 0.5) / speed;
        for (const segment of segments) {
            const framing = segment?.framing;
            if (!framing) continue;
            const start = toLocalTime(segment.startTime);
            const end = toLocalTime(segment.endTime);
            const moveEnd = Math.min(end, start + transitionDuration);
            const targetFrame = normalizeFramingFrame({ ...framing, time: start });
            if (!targetFrame) continue;
            const target = { x: targetFrame.x, y: targetFrame.y, scale: targetFrame.scale };
            scaleFrames.push(
                { time: start, value: previous.scale, easing: 'easeInOut' },
                { time: moveEnd, value: target.scale, easing: 'easeInOut' },
                { time: end, value: target.scale, easing: 'easeInOut' }
            );
            panXFrames.push(
                { time: start, value: 0.5 - previous.x, easing: 'easeInOut' },
                { time: moveEnd, value: 0.5 - target.x, easing: 'easeInOut' },
                { time: end, value: 0.5 - target.x, easing: 'easeInOut' }
            );
            panYFrames.push(
                { time: start, value: 0.28 - previous.y, easing: 'easeInOut' },
                { time: moveEnd, value: 0.28 - target.y, easing: 'easeInOut' },
                { time: end, value: 0.28 - target.y, easing: 'easeInOut' }
            );
            previous = target;
        }
        if (!scaleFrames.length) throw new Error('Emotion framing analysis returned no framing segments');
        tracks.scale = appendKeyframes(tracks.scale, scaleFrames);
        tracks.panX = appendKeyframes(tracks.panX, panXFrames);
        tracks.panY = appendKeyframes(tracks.panY, panYFrames);
    } else if (effect.type === 'beat_sync') {
        const keyframes = Array.isArray(analysis.effectKeyframes) ? analysis.effectKeyframes : [];
        const mode = effect.getParam('effectType') || 'zoom_pulse';
        if (mode === 'zoom_pulse') {
            tracks.scale = appendKeyframes(tracks.scale, keyframes.filter(frame => Number.isFinite(Number(frame.scale))).map(frame => ({
                time: toLocalTime(frame.time), value: Number(frame.scale), easing: frame.easing || 'linear'
            })));
        } else if (mode === 'flash') {
            const amountFrames = keyframes.filter(frame => Number.isFinite(Number(frame.brightness))).map(frame => ({
                time: toLocalTime(frame.time), value: Number(frame.brightness) / 100, easing: frame.easing || 'linear'
            }));
            if (!amountFrames.length) throw new Error('Beat flash analysis returned no brightness keyframes');
            clip.effects = [...(clip.effects || []), {
                id: `${effect.id}-generated-flash`, kind: 'brightness', type: 'brightness', enabled: true,
                order: effect.order, params: { amount: 1 }, keyframes: { amount: amountFrames }
            }];
        } else if (mode === 'shake') {
            const intensityFrames = [];
            const rotationFrames = [];
            const timelineStart = Number(clip.start) || 0;
            for (const frame of keyframes.filter(item => Number(item.intensity) > 0)) {
                const time = toLocalTime(frame.time);
                const peak = Math.max(0, Math.min(50, Number(frame.intensity ?? effect.getParam('intensity') ?? 0.5)));
                const rotationPeak = Math.min(0.4, peak * 0.08);
                const releaseTime = Math.min(clipDuration, time + 0.08 / speed);
                intensityFrames.push(
                    // Footage effect keyframes use project time; the exporter
                    // converts them back to clip-local time when compiling.
                    { time: timelineStart + time, value: peak, easing: 'linear' },
                    { time: timelineStart + releaseTime, value: 0, easing: 'easeOut' }
                );
                rotationFrames.push(
                    { time: timelineStart + time, value: rotationPeak, easing: 'linear' },
                    { time: timelineStart + releaseTime, value: 0, easing: 'easeOut' }
                );
            }
            if (!intensityFrames.length) throw new Error('Beat shake analysis returned no effect keyframes');
            clip.effects = [...(clip.effects || []), {
                id: `${effect.id}-generated-shake`, kind: 'shake', type: 'shake', enabled: true,
                order: effect.order, params: { intensity: 0, frequency: 16, randomSeed: 0, rotationAmount: 0 },
                keyframes: { intensity: intensityFrames, rotationAmount: rotationFrames }
            }];
        } else {
            throw new Error(`Beat sync mode "${mode}" is unavailable. Choose zoom_pulse, flash, or shake.`);
        }
        if (mode === 'zoom_pulse' && !keyframes.some(frame => Number.isFinite(Number(frame.scale)))) {
            throw new Error('Beat zoom analysis returned no scale keyframes');
        }
    }
    clip.keyframes = tracks;
    clip.metadata = { ...(clip.metadata || {}), aiEffectAnalysis: { ...(clip.metadata?.aiEffectAnalysis || {}), [effect.id]: analysis } };
}

function detachEffectFromGraph(graphsByTarget, targetId, effectId) {
    if (!targetId) return;
    const graph = graphsByTarget.get(targetId);
    if (!graph) return;

    // Removing a node from a supported linear chain should splice its
    // neighbours together. EffectGraph.removeNode correctly removes incident
    // edges, but without this splice the remaining stack becomes disconnected.
    const incoming = graph.connections.filter(edge => edge.to === effectId);
    const outgoing = graph.connections.filter(edge => edge.from === effectId);
    graph.removeNode(effectId);
    if (incoming.length === 1 && outgoing.length === 1
        && graph.nodes.has(incoming[0].from) && graph.nodes.has(outgoing[0].to)) {
        // The port belongs to the destination node. Preserve it when a
        // regular effect is removed from a branch feeding an explicit join.
        graph.connect(incoming[0].from, outgoing[0].to, outgoing[0].port || 'default');
    }
    if (graph.isEmpty) graphsByTarget.delete(targetId);
}

function attachEffectToGraph(graphsByTarget, effect) {
    if (!effect.targetId) return;
    let graph = graphsByTarget.get(effect.targetId);
    if (!graph) {
        graph = new EffectGraph();
        graphsByTarget.set(effect.targetId, graph);
    }

    // Replacing a node already in this graph keeps its edges. For a new node,
    // insert it into an existing executable chain according to authored order
    // and rebuild that chain; an unconnected stack stays unconnected.
    if (graph.nodes.has(effect.id)) {
        graph.addNode(effect);
        return;
    }
    let chain = null;
    let appendAfterDagSink = null;
    if (graph.connections.length) {
        const plan = graph.getExecutionPlan();
        if (plan.branches.length || plan.joins.length) {
            // Ordinary effects-panel additions remain useful after a user has
            // authored a DAG: append them after its explicit output, preserving
            // every branch and join instead of flattening or rejecting it.
            appendAfterDagSink = plan.sinks[0]?.id || null;
        } else {
            chain = graph.getExecutionOrder();
        }
    }
    graph.addNode(effect);
    if (appendAfterDagSink) {
        graph.connect(appendAfterDagSink, effect.id);
    } else if (chain) {
        let insertionIndex = chain.findIndex(node => Number(node.order) > Number(effect.order));
        if (insertionIndex < 0) insertionIndex = chain.length;
        chain.splice(insertionIndex, 0, effect);
        graph.connections = [];
        for (let i = 1; i < chain.length; i++) graph.connect(chain[i - 1].id, chain[i].id);
    }
}

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
        this.onPreviewWarning = options.onPreviewWarning || null;
        this.lutPreviewProvider = options.lutPreviewProvider || null;
        this._lutPreviewFilters = new Map();
        this._lutPreviewRequests = new Map();
        this._previewWarnings = new Set();
    }

    _lutId(effect) {
        const value = effect?.getParam?.('lutId') ?? effect?.params?.lutId;
        return String(value && typeof value === 'object' && 'value' in value ? value.value : value || '');
    }

    _ensureLutPreview(effect) {
        const lutId = this._lutId(effect);
        if (!lutId || this._lutPreviewFilters.has(lutId) || this._lutPreviewRequests.has(lutId)) return;
        if (typeof this.lutPreviewProvider !== 'function') {
            this._lutPreviewFilters.set(lutId, 'none');
            return;
        }
        const request = Promise.resolve().then(() => this.lutPreviewProvider(lutId)).then(filter => {
            this._lutPreviewFilters.set(lutId, typeof filter === 'string' ? filter : 'none');
            this._previewWarnings.clear();
            this.onEffectChange?.({ type: 'preview_ready', effectId: effect.id, lutId });
        }).catch(() => {
            this._lutPreviewFilters.set(lutId, 'none');
            this.onEffectChange?.({ type: 'preview_ready', effectId: effect.id, lutId });
        }).finally(() => this._lutPreviewRequests.delete(lutId));
        this._lutPreviewRequests.set(lutId, request);
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

        // Re-adding an existing ID is an edit. Remove its prior graph
        // membership first when the target changes (or is cleared), otherwise
        // the old target retains a stale node while the flat list points at
        // the replacement. That makes preview/export disagree about which
        // placement owns the effect.
        const previous = this.allEffects.get(effect.id);
        if (previous?.targetId && previous.targetId !== effect.targetId) {
            detachEffectFromGraph(this.effectsByTarget, previous.targetId, effect.id);
        }

        // Store in flat list
        this.allEffects.set(effect.id, effect);

        // Add to target graph
        attachEffectToGraph(this.effectsByTarget, effect);

        this._notifyChange(previous ? 'update' : 'add', effect);

        return effect;
    }

    /**
     * Remove an effect from the pipeline
     */
    removeEffect(effectId) {
        const effect = this.allEffects.get(effectId);
        if (!effect) return false;

        // Remove from target graph
        detachEffectFromGraph(this.effectsByTarget, effect.targetId, effectId);

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

        // Target changes must move graph membership as well as mutate the
        // flat node. Otherwise the editor can show an effect on one clip while
        // preview/export continue applying it to the original clip.
        const previousTargetId = effect.targetId;
        const targetWasUpdated = Object.prototype.hasOwnProperty.call(updates, 'targetId');

        // Apply updates
        if (updates.params) {
            for (const [key, value] of Object.entries(updates.params)) {
                const isWrapped = value && typeof value === 'object' && !Array.isArray(value);
                if (!isWrapped || Object.prototype.hasOwnProperty.call(value, 'value')) {
                    effect.setParam(key, isWrapped ? value.value : value);
                }
                if (isWrapped && Object.prototype.hasOwnProperty.call(value, 'expression')) {
                    const expression = typeof value.expression === 'string' ? value.expression.trim() : '';
                    if (expression) effect.expressions[key] = expression;
                    else delete effect.expressions[key];
                    if (effect.params[key]) {
                        if (expression) effect.params[key].expression = expression;
                        else delete effect.params[key].expression;
                    }
                }
            }
        }

        if (updates.enabled !== undefined) effect.enabled = updates.enabled;
        if (updates.order !== undefined) effect.order = updates.order;
        if (updates.startTime !== undefined) effect.startTime = updates.startTime;
        if (updates.endTime !== undefined) effect.endTime = updates.endTime;
        if (targetWasUpdated) effect.targetId = updates.targetId || null;

        if (targetWasUpdated && previousTargetId !== effect.targetId) {
            detachEffectFromGraph(this.effectsByTarget, previousTargetId, effectId);
            attachEffectToGraph(this.effectsByTarget, effect);
        }

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
        try {
            return graph.getActiveEffectsAt(time, placement);
        } catch (error) {
            // Invalid authored graphs (for example unsupported branches) must
            // not tear down playback. Keep the source frame visible and tell
            // the editor why this target's effects were skipped. Export stays
            // strict and rejects the graph before rendering.
            const reason = error instanceof Error ? error.message : String(error || 'invalid effect graph');
            const key = `invalid-effect-graph:${targetId}:${reason}`;
            if (!this._previewWarnings.has(key)) {
                this._previewWarnings.add(key);
                const warning = {
                    type: 'effect_graph_preview_unavailable',
                    targetId,
                    message: `This effect graph cannot be previewed, so its effects were skipped: ${reason}`,
                    recoverable: true,
                };
                console.warn('[EffectPipeline]', warning.message, warning);
                this.onPreviewWarning?.(warning);
            }
            return [];
        }
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

    _warnCpuEffectsUnavailable(targetId, effects) {
        const cpuEffects = (effects || []).filter(effect => effect.engine === ENGINE_TYPES.CPU && (
            effect.type === 'lut_apply'
                ? !this._lutId(effect) || (this._lutPreviewFilters.has(this._lutId(effect))
                    && (this._lutPreviewFilters.get(this._lutId(effect)) === 'none'
                        || !cssFilterToColorMatrix(this._lutPreviewFilters.get(this._lutId(effect)))))
                : !this.gpuEngine?.supportsPreviewEffect?.(effect)
        ));
        if (!cpuEffects.length) return;
        const effectIds = cpuEffects.map(effect => effect.id);
        const key = `cpu-effect-preview-unavailable:${targetId}:${effectIds.join(',')}`;
        if (this._previewWarnings.has(key)) return;
        this._previewWarnings.add(key);
        const names = cpuEffects.map(effect => effect.name || effect.type).join(', ');
        const warning = {
            type: 'cpu_effect_preview_unavailable',
            targetId,
            effectIds,
            message: `These CPU effects are applied during export but are not rendered in real-time preview: ${names}.`,
            recoverable: true,
        };
        console.warn('[EffectPipeline]', warning.message, warning);
        this.onPreviewWarning?.(warning);
    }

    /**
     * Process effects for real-time preview
     * @param {WebGLTexture} texture - Input texture
     * @param {string} targetId - Target placement ID
     * @param {number} time - Current timeline time
     * @param {object} context - Rendering context
     * @returns {WebGLTexture} Processed texture
     */
    processPreview(texture, targetId, time, context = {}) {
        const activeAtTime = this.getActiveEffects(targetId, time, context.placement);
        activeAtTime.filter(effect => effect.type === 'lut_apply').forEach(effect => this._ensureLutPreview(effect));
        this._warnCpuEffectsUnavailable(targetId, activeAtTime);
        // Most CPU effects are export-only. Fade in/out also have equivalent
        // shaders, so route those through the live renderer to keep preview and
        // export in sync without changing their canonical export engine.
        const lutAvailable = effect => effect.type !== 'lut_apply'
            || (Boolean(this._lutId(effect)) && this._lutPreviewFilters.has(this._lutId(effect))
                && this._lutPreviewFilters.get(this._lutId(effect)) !== 'none'
                && Boolean(cssFilterToColorMatrix(this._lutPreviewFilters.get(this._lutId(effect)))));
        const activeEffects = activeAtTime.filter(effect => (effect.engine === ENGINE_TYPES.GPU
            || this.gpuEngine?.supportsPreviewEffect?.(effect)) && lutAvailable(effect));

        if (activeEffects.length === 0) {
            return texture;
        }

        if (!this.gpuEngine) {
            const key = `${targetId}:${activeEffects.map(effect => effect.id).join(',')}`;
            if (!this._previewWarnings.has(key)) {
                this._previewWarnings.add(key);
                const warning = {
                    type: 'gpu_effect_preview_unavailable',
                    targetId,
                    effectIds: activeEffects.map(effect => effect.id),
                    message: 'GPU effects are active, but this preview has no GPU effect renderer.',
                    recoverable: true,
                };
                console.warn('[EffectPipeline]', warning.message, warning);
                this.onPreviewWarning?.(warning);
            }
            return texture;
        }

        const supportsPreviewEffect = typeof this.gpuEngine.supportsPreviewEffect === 'function'
            ? effect => this.gpuEngine.supportsPreviewEffect(effect)
            : typeof this.gpuEngine.supportsEffect === 'function'
                ? effect => effect.engine === ENGINE_TYPES.GPU && this.gpuEngine.supportsEffect(effect.type)
                : () => true;
        const unsupportedEffects = activeEffects.filter(effect => !supportsPreviewEffect(effect));
        if (unsupportedEffects.length) {
            const effectIds = unsupportedEffects.map(effect => effect.id);
            const key = `unsupported-gpu-effects:${targetId}:${effectIds.join(',')}`;
            if (!this._previewWarnings.has(key)) {
                this._previewWarnings.add(key);
                const names = unsupportedEffects.map(effect => effect.name || effect.type).join(', ');
                const warning = {
                    type: 'gpu_effect_unsupported',
                    targetId,
                    effectIds,
                    message: `These effects have no GPU preview renderer and were skipped: ${names}.`,
                    recoverable: true,
                };
                console.warn('[EffectPipeline]', warning.message, warning);
                this.onPreviewWarning?.(warning);
            }
        }
        const renderableEffects = unsupportedEffects.length
            ? activeEffects.filter(effect => !unsupportedEffects.includes(effect))
            : activeEffects;
        if (!renderableEffects.length) return texture;

        // Process through GPU engine
        const lutPreviewFilters = Object.fromEntries(this._lutPreviewFilters);
        const graph = this.effectsByTarget.get(targetId);
        const topology = graph?.getTopologyPlan();
        if (graph?.connections.length && (topology?.branches.length || topology?.joins.length)) {
            const renderableIds = new Set(renderableEffects.map(effect => effect.id));
            if (typeof this.gpuEngine.processGraph === 'function') {
                return this.gpuEngine.processGraph(graph, texture, time,
                    { ...context, lutPreviewFilters }, effect => renderableIds.has(effect.id));
            }
            const key = `effect-graph-renderer-unavailable:${targetId}`;
            if (!this._previewWarnings.has(key)) {
                this._previewWarnings.add(key);
                const warning = {
                    type: 'effect_graph_preview_unavailable',
                    targetId,
                    message: 'This effect graph needs a renderer that supports parallel branches and explicit composite joins.',
                    recoverable: true,
                };
                this.onPreviewWarning?.(warning);
            }
            return texture;
        }
        return this.gpuEngine.processChain(renderableEffects, texture, time, { ...context, lutPreviewFilters });
    }

    /**
     * Process active placements independently for preview.
     *
     * `inputTextures` may be a Map/object keyed by placement ID, or a single
     * texture shared by every placement. A timeline's layers are composited
     * later; applying each layer's effects to the previous layer's output
     * would incorrectly bake overlay effects into the base footage.
     * @returns {Map<string, WebGLTexture>} Rendered textures by placement ID
     */
    processAllPreviews(inputTextures, placements, time, context = {}) {
        const outputs = new Map();
        const textureMap = isTextureMap(inputTextures);
        const inputFor = placement => inputTextures instanceof Map
            ? inputTextures.get(placement.id)
            : (textureMap ? inputTextures[placement.id] : inputTextures);

        for (const placement of placements || []) {
            const texture = inputFor(placement);
            if (!texture) continue;
            const output = this.hasActiveEffectsAt(placement.id, time, placement)
                ? this.processPreview(texture, placement.id, time, { ...context, placement })
                : texture;
            outputs.set(placement.id, output);
        }
        return outputs;
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
        const graph = this.effectsByTarget.get(targetId);
        const effects = (graph ? graph.getExecutionOrder() : [])
            .filter(effect => effect.enabled);

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
            warnings: cpuResult.warnings || [],
            aiData: Object.fromEntries(this.aiAnalysisCache)
        };

        return pipeline;
    }

    /**
     * Build complete render job for export
     */
    async buildRenderJob(timeline, outputPath, context = {}) {
        const sourceTracks = Array.isArray(timeline?.tracks)
            ? timeline.tracks
            : (typeof timeline?.toLegacyTracks === 'function' ? timeline.toLegacyTracks() : null);
        if (!sourceTracks) throw new Error('Effect render requires a timeline with tracks');

        // The export worker consumes the canonical /api/render timeline schema.
        // Compile the effect graph onto clips here so preview and export use the
        // same effect stack instead of posting a separate, unconsumed job shape.
        const tracks = sourceTracks.map(track => ({
            ...track,
            clips: Array.isArray(track?.clips) ? track.clips.map(clip => ({ ...clip, effects: [...(clip.effects || [])] })) : track?.clips
        }));
        const job = {
            timeline: {
                tracks,
                duration: timeline.duration ?? timeline.getDuration?.(),
                aspectRatio: timeline.aspectRatio || timeline.settings?.aspectRatio,
                captions: timeline.captions || [],
                assets: timeline.assets || context.assets || []
            },
            settings: context.settings || context.exportSettings || {}
        };

        // Process each placement/layer. AI results are compiled into native
        // clip keyframes before export; storing analysis JSON alone would not
        // affect the rendered picture.
        for (const [targetId, graph] of this.effectsByTarget) {
            const executionPlan = graph.getExecutionPlan();
            const effects = executionPlan.orderedNodes.filter(e => e.enabled);
            const isBranchedGraph = executionPlan.branches.length > 0 || executionPlan.joins.length > 0;

            if (effects.length === 0) continue;
            const aiEffects = effects.filter(e => e.engine === ENGINE_TYPES.AI);
            const matches = [];
            for (const track of tracks) {
                for (const clip of track.clips || []) {
                    const targetsClip = clip.id === targetId || clip.clipId === targetId || clip.placementId === targetId;
                    const targetsTrack = track.id === targetId || track.layerId === targetId;
                    if (!targetsClip && !targetsTrack) continue;
                    matches.push({ track, clip });
                }
            }
            if (!matches.length) throw new Error(`Cannot export effects: target "${targetId}" is not present in the timeline`);

            for (const { clip } of matches) {
                if (aiEffects.length) {
                    const offset = Number(clip.offset) || 0;
                    const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
                    const duration = Number(clip.duration) || 0;
                    const clipStart = Number(clip.start) || 0;
                    const assets = context.assets || timeline.assets || [];
                    const asset = Array.isArray(assets)
                        ? assets.find(item => item?.id === clip.assetId || item?.assetId === clip.assetId)
                        : assets?.[clip.assetId];
                    const videoUrl = context.getVideoUrl?.(clip.id || targetId)
                        || asset?.sourceUrl || asset?.proxyUrl || asset?.url
                        || clip.sourceUrl || clip.videoUrl || clip.proxyUrl || clip.url || clip.src;
                    const audioUrl = clip.audioUrl || asset?.audioUrl || videoUrl;
                    const analysisEffects = aiEffects.map(effect => {
                        const mapped = Object.create(effect);
                        if (effect.startTime != null) {
                            mapped.startTime = offset + Math.max(0, Math.min(duration, Number(effect.startTime) - clipStart)) * speed;
                        }
                        if (effect.endTime != null) {
                            mapped.endTime = offset + Math.max(0, Math.min(duration, Number(effect.endTime) - clipStart)) * speed;
                        }
                        return mapped;
                    });
                    const aiResults = await this.aiEngine.preAnalyzeChain(analysisEffects, {
                        videoUrl,
                        audioUrl,
                        startTime: offset,
                        endTime: offset + duration * speed
                    });
                    for (const effect of aiEffects) {
                        const result = aiResults[effect.id];
                        this.aiAnalysisCache.set(effect.id, result);
                        applyAIAnalysisToClip(clip, effect, result);
                    }
                }

                // AI nodes are planning/analysis instructions, not compositor
                // effects. Their verified results are already compiled into
                // native keyframes or concrete effects above; serializing the
                // AI directive itself leaves an unknown no-op in the export.
                const outputFps = context.settings?.fps || context.exportSettings?.fps || 30;
                const compiledEffects = (isBranchedGraph ? [] : effects.filter(effect => effect.engine !== ENGINE_TYPES.AI)).map((effect, executionOrder) => ({
                    id: effect.id,
                    kind: effect.type,
                    type: effect.type,
                    name: effect.name,
                    enabled: effect.enabled,
                    // Export compilers sort by order, so serialize the graph's
                    // actual execution order rather than a potentially stale UI order.
                    order: executionOrder,
                    startTime: effect.startTime,
                    endTime: effect.endTime,
                    params: effect.getParamsSnapshot(),
                    keyframes: effect.keyframes,
                    expressions: { ...effect.expressions },
                    samples: sampleEffectExpressions(effect, clip, outputFps) || undefined,
                    metadata: { ...effect.metadata, aiData: this.aiAnalysisCache.get(effect.id) }
                }));
                const graphEffectIds = new Set(compiledEffects.map(effect => effect.id));
                if (isBranchedGraph) {
                    for (const effect of executionPlan.orderedNodes) graphEffectIds.add(effect.id);
                    // Preserve graph connections for the export worker. A DAG
                    // cannot be represented by clip.effects' ordered array;
                    // flattening it would change its visual meaning.
                    clip.effectGraph = {
                        nodes: executionPlan.orderedNodes.map(effect => ({
                            ...effect.serialize(),
                            params: effect.params,
                            metadata: { ...effect.metadata, aiData: this.aiAnalysisCache.get(effect.id) },
                            samples: sampleEffectExpressions(effect, clip, outputFps) || undefined,
                        })),
                        connections: executionPlan.connections.map(edge => ({ ...edge })),
                    };
                }
                // PlaybackEngine routes clip effects into the target graph
                // after the graph's existing nodes. With a connected stack,
                // newly added nodes are inserted by authored order; equal or
                // larger orders land after the existing chain. Export must
                // keep that same order or the editor preview and rendered
                // pixels disagree. Preserve the connected graph first, then
                // append clip effects in their stable authored order.
                const mergedEffects = [];
                for (const effect of compiledEffects.map(effect => ({
                    ...effect,
                    params: { ...effect.params },
                    keyframes: { ...effect.keyframes },
                    expressions: { ...effect.expressions },
                    samples: effect.samples ? { ...effect.samples } : effect.samples,
                }))) {
                    mergedEffects.push(effect);
                }
                mergedEffects.push(...clip.effects
                    .filter(effect => !graphEffectIds.has(effect?.id))
                    .sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0))
                    .map(effect => ({ ...effect })));
                clip.effects = mergedEffects.map((effect, order) => ({ ...effect, order }));
            }
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
        if (!graph || !Array.isArray(effectIds)) return false;

        let current;
        try {
            current = graph.getExecutionOrder();
        } catch {
            // An invalid branching/disconnected graph cannot be reordered as
            // one stack; leave its authored connections intact for repair.
            return false;
        }
        const currentIds = current.map(effect => effect.id);
        const requested = effectIds.map(id => String(id));
        if (requested.length !== currentIds.length
            || new Set(requested).size !== requested.length
            || requested.some(id => !graph.nodes.has(id))) return false;

        const reordered = requested.map(id => graph.nodes.get(id));
        reordered.forEach((effect, index) => { effect.order = index; });
        if (graph.connections.length) {
            graph.connections = reordered.slice(1).map((effect, index) => ({
                from: reordered[index].id,
                to: effect.id,
                port: 'default',
            }));
            graph._orderDirty = true;
            graph._processingOrder = null;
        }

        this._notifyChange('reorder', { targetId, effectIds });
        return true;
    }

    /**
     * Move effect up in order
     */
    moveEffectUp(effectId) {
        const effect = this.allEffects.get(effectId);
        if (!effect || !effect.targetId) return;

        const effects = this.effectsByTarget.get(effect.targetId)?.getExecutionOrder() || [];

        const index = effects.findIndex(e => e.id === effectId);
        if (index > 0) {
            const reordered = effects.map(item => item.id);
            [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
            this.reorderEffects(effect.targetId, reordered);
        }
    }

    /**
     * Move effect down in order
     */
    moveEffectDown(effectId) {
        const effect = this.allEffects.get(effectId);
        if (!effect || !effect.targetId) return;

        const effects = this.effectsByTarget.get(effect.targetId)?.getExecutionOrder() || [];

        const index = effects.findIndex(e => e.id === effectId);
        if (index < effects.length - 1) {
            const reordered = effects.map(item => item.id);
            [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
            this.reorderEffects(effect.targetId, reordered);
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
            // The serialized flat index and graph contain the same logical
            // nodes. Rebind graph entries to the canonical instances in
            // allEffects so updates through the public ID APIs are visible to
            // preview, execution ordering, and export after a project reload.
            for (const [effectId, graphEffect] of graph.nodes) {
                const canonical = pipeline.allEffects.get(effectId) || graphEffect;
                pipeline.allEffects.set(effectId, canonical);
                graph.nodes.set(effectId, canonical);
            }
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
        if (engine) this._previewWarnings.clear();
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
