/**
 * EffectNode.js
 * Base class for all effect nodes in the Viral Pilot effects pipeline.
 * 
 * Each effect node represents a single visual/audio processing operation
 * with parameters, timeline bounds, and optional keyframe animation.
 */

// ============================================================================
// EASING FUNCTIONS
// ============================================================================
import { resolveEasing } from '../motion/Easing.js';
import { resolveEffectParameter } from '../motion/EffectTiming.js';
import { sampleKeyframeTrack } from '../motion/MotionResolver.js';

// ============================================================================
// ENGINE TYPES
// ============================================================================

export const ENGINE_TYPES = {
    GPU: 'gpu',      // WebGL shader-based (real-time)
    CPU: 'cpu',      // FFmpeg filter-based (final render)
    AI: 'ai'         // AI API-driven (async analysis)
};

// ============================================================================
// PARAMETER TYPES
// ============================================================================

export const PARAM_TYPES = {
    FLOAT: 'float',
    INT: 'int',
    BOOL: 'bool',
    COLOR: 'color',      // [r, g, b] or [r, g, b, a]
    VEC2: 'vec2',        // [x, y]
    VEC3: 'vec3',        // [x, y, z]
    ANGLE: 'angle',      // Degrees
    SELECT: 'select',    // Enum options
    FILE: 'file',        // File path (e.g., LUT)
    CURVE: 'curve'       // Bezier curve points
};

function isFiniteEffectValue(value) {
    return (typeof value === 'number' && Number.isFinite(value))
        || typeof value === 'boolean'
        || typeof value === 'string'
        || (Array.isArray(value) && value.length > 0 && value.some(item => Number.isFinite(item)));
}

function isRecoverableEffectTrackValue(value) {
    // Keep a vector key if it has at least one usable channel. The shared
    // sampler recovers missing components from the nearest finite authored
    // channel, so one damaged component does not discard the rest of a key.
    return isFiniteEffectValue(value);
}

// ============================================================================
// EFFECT NODE CLASS
// ============================================================================

export class EffectNode {
    constructor(config = {}) {
        // === Identity ===
        this.id = config.id || `fx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        this.type = config.type || 'unknown';
        this.name = config.name || this.type;

        // === Engine ===
        this.engine = config.engine || ENGINE_TYPES.GPU;

        // === Target ===
        this.targetId = config.targetId || null;
        this.targetType = config.targetType || 'placement';  // 'clip' | 'placement' | 'layer'

        // === State ===
        this.enabled = config.enabled ?? true;
        this.order = config.order ?? 0;

        // === Timeline Bounds ===
        // null means inherit from target (placement duration)
        this.startTime = config.startTime ?? null;
        this.endTime = config.endTime ?? null;

        // === Parameters ===
        // Format: { paramName: { value, min, max, type, options?, step? } }
        this.params = this._normalizeParams(config.params || {});
        this.expressions = { ...(config.expressions || {}) };
        for (const [key, param] of Object.entries(this.params)) {
            if (typeof param.expression === 'string' && !this.expressions[key]) {
                this.expressions[key] = param.expression;
            }
        }

        // === Keyframes ===
        // Format: { paramName: [{ time, value, easing }] }
        this.keyframes = config.keyframes || {};

        // === Metadata ===
        this.createdAt = config.createdAt || Date.now();
        this.metadata = config.metadata || {};
    }

    // ========================================================================
    // PARAMETER HANDLING
    // ========================================================================

    /**
     * Normalize params to consistent format
     */
    _normalizeParams(params) {
        const normalized = {};

        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'object' && value !== null && 'value' in value) {
                // Already in proper format
                normalized[key] = {
                    value: value.value,
                    min: value.min ?? 0,
                    max: value.max ?? 1,
                    type: value.type || PARAM_TYPES.FLOAT,
                    options: value.options || null,
                    step: value.step || null,
                    label: value.label || key,
                    ...(typeof value.expression === 'string' ? { expression: value.expression } : {})
                };
            } else {
                // Simple value, wrap it
                normalized[key] = {
                    value: value,
                    min: 0,
                    max: 1,
                    type: typeof value === 'boolean' ? PARAM_TYPES.BOOL : PARAM_TYPES.FLOAT,
                    label: key
                };
            }
        }

        return normalized;
    }

    /**
     * Get raw param value (no interpolation)
     */
    getParam(paramName) {
        const param = this.params[paramName];
        return param ? param.value : undefined;
    }

    /**
     * Set param value
     */
    setParam(paramName, value) {
        if (!isFiniteEffectValue(value)) return false;
        if (this.params[paramName]) {
            const param = this.params[paramName];
            // Clamp to min/max if numeric
            if (typeof value === 'number' && param.min !== undefined && param.max !== undefined) {
                value = Math.max(param.min, Math.min(param.max, value));
            }
            this.params[paramName].value = value;
            return true;
        }
        return false;
    }

    /**
     * Get all params as simple key-value object
     */
    getParamsSnapshot() {
        const snapshot = {};
        for (const [key, param] of Object.entries(this.params)) {
            snapshot[key] = param.value;
        }
        return snapshot;
    }

    // ========================================================================
    // KEYFRAME INTERPOLATION
    // ========================================================================

    /**
     * Get interpolated param value at specific time
     * @param {string} paramName - Parameter name
     * @param {number} time - Timeline time in seconds
     * @returns {*} Interpolated value
     */
    getParamAt(paramName, time) {
        const keyframes = this.keyframes[paramName];
        const baseValue = this.getParam(paramName);
        const paramType = this.params[paramName]?.type;

        // No keyframes, return base value
        if (!keyframes || keyframes.length === 0) {
            return baseValue;
        }

        // Ignore malformed keys and keep author order stable. When multiple
        // keys share a timestamp, the later-authored key wins, matching the
        // canonical motion resolver and avoiding zero-width interpolation.
        const sorted = keyframes.map((keyframe, index) => {
            // Older scene/timeline serializers stored sparse effect tracks as
            // `{ time, properties: { [paramName]: value } }`. The shared
            // resolver still accepts that shape, so GPU preview must as well.
            const rawValue = keyframe?.value ?? keyframe?.properties?.[paramName];
            const numericType = [PARAM_TYPES.FLOAT, PARAM_TYPES.INT, PARAM_TYPES.ANGLE].includes(paramType);
            const value = numericType && typeof rawValue === 'string' && rawValue.trim() !== ''
                ? Number(rawValue)
                : rawValue;
            return { keyframe, value, index, time: Number(keyframe?.time) };
        })
            .filter(entry => Number.isFinite(entry.time) && isRecoverableEffectTrackValue(entry.value))
            .sort((a, b) => a.time - b.time || a.index - b.index)
            .reduce((unique, entry) => {
                if (unique.at(-1)?.time === entry.time) unique[unique.length - 1] = entry;
                else unique.push(entry);
                return unique;
            }, []);
        const normalized = sorted.map(entry => ({ ...entry.keyframe, value: entry.value, time: entry.time }));
        if (!normalized.length) return baseValue;

        const sampleTime = Number(time);
        if (!Number.isFinite(sampleTime)) return baseValue;

        // Motion vectors and effect vectors share the same interpolation and
        // malformed-channel recovery rules, keeping preview/export in parity.
        if (normalized.some(entry => Array.isArray(entry.value))) {
            return sampleKeyframeTrack(normalized, sampleTime, baseValue);
        }

        // Before first keyframe
        if (sampleTime <= normalized[0].time) {
            return normalized[0].value;
        }

        // After last keyframe
        if (sampleTime >= normalized[normalized.length - 1].time) {
            return normalized[normalized.length - 1].value;
        }

        // Find surrounding keyframes
        let fromKf = normalized[0];
        let toKf = normalized[1];

        for (let i = 0; i < normalized.length - 1; i++) {
            if (sampleTime >= normalized[i].time && sampleTime < normalized[i + 1].time) {
                fromKf = normalized[i];
                toKf = normalized[i + 1];
                break;
            }
        }

        // Calculate progress between keyframes
        const duration = toKf.time - fromKf.time;
        const progress = duration > 0 ? (sampleTime - fromKf.time) / duration : 0;

        // Apply easing
        const easing = resolveEasing(toKf.easing || 'linear');
        const easedProgress = easing(progress);

        // Interpolate value
        return this._interpolateValue(fromKf.value, toKf.value, easedProgress);
    }

    /**
     * Interpolate between two values
     */
    _interpolateValue(from, to, t) {
        // Interpolate only finite numeric scalars. Malformed values should not
        // turn a valid effect into NaN and disappear from the preview/export.
        if (typeof from === 'number' && Number.isFinite(from)
            && typeof to === 'number' && Number.isFinite(to)) {
            return from + (to - from) * t;
        }

        // Array interpolation (colors, vectors) is only meaningful when both
        // keyframes describe the same dimensional value. For example, a
        // 3-channel color cannot be interpolated against a 4-channel color
        // without inventing alpha semantics; use the nearer authored value.
        if (Array.isArray(from) && Array.isArray(to)) {
            if (from.length === to.length && from.every(Number.isFinite) && to.every(Number.isFinite)) {
                return from.map((value, index) => value + (to[index] - value) * t);
            }
            // The shared motion sampler holds the nearest authored vector
            // when dimensions differ. Do the same here: padding a shorter
            // color/vector with channels from the other keyframe invents a
            // value that exists nowhere in the authored track.
            if (from.every(Number.isFinite) && to.every(Number.isFinite) && from.length !== to.length) {
                return t < 0.5 ? from : to;
            }
            // Malformed vectors have no safe channel mapping. Hold the
            // nearest authored value rather than synthesizing a hybrid.
            return t < 0.5 ? from : to;
        }

        // Boolean - just switch at 0.5
        if (typeof from === 'boolean') {
            return t < 0.5 ? from : to;
        }

        // Default - no interpolation
        return t < 0.5 ? from : to;
    }

    /**
     * Get all params interpolated at time
     */
    getParamsAt(time, context = {}) {
        const result = {};
        for (const paramName of Object.keys(this.params)) {
            const keyed = this.getParamAt(paramName, time);
            const expression = this.expressions[paramName] || this.params[paramName]?.expression;
            if (typeof expression !== 'string' || !expression.trim()) {
                result[paramName] = keyed;
                continue;
            }
            result[paramName] = resolveEffectParameter({
                startTime: this.startTime,
                endTime: this.endTime,
                params: { [paramName]: { value: this.getParam(paramName), expression } },
                expressions: { [paramName]: expression },
                keyframes: { [paramName]: this.keyframes[paramName] || [] },
            }, paramName, this.getParam(paramName), time, {
                ...context,
                clipStart: context.clipStart ?? context.placement?.startTime ?? context.placement?.start ?? 0,
                clipDuration: context.clipDuration ?? context.placement?.duration,
            });
        }
        return result;
    }

    // ========================================================================
    // KEYFRAME MANAGEMENT
    // ========================================================================

    /**
     * Add a keyframe
     */
    addKeyframe(paramName, time, value, easing = 'linear') {
        const normalizedTime = Number(time);
        if (!paramName || !Number.isFinite(normalizedTime) || normalizedTime < 0 || !isFiniteEffectValue(value)) {
            return false;
        }

        if (!this.keyframes[paramName]) {
            this.keyframes[paramName] = [];
        }

        // Normalize timestamps before comparing so imported numeric strings and
        // editor-authored numbers replace the same point in the track.
        this.keyframes[paramName] = this.keyframes[paramName]
            .filter(kf => Number.isFinite(Number(kf?.time)) && Number(kf.time) !== normalizedTime)
            .map(kf => ({ ...kf, time: Number(kf.time) }));

        this.keyframes[paramName].push({ time: normalizedTime, value, easing });

        this.keyframes[paramName].sort((a, b) => a.time - b.time);
        return true;
    }

    /**
     * Remove a keyframe
     */
    removeKeyframe(paramName, time) {
        if (this.keyframes[paramName]) {
            const normalizedTime = Number(time);
            if (!Number.isFinite(normalizedTime)) return false;
            this.keyframes[paramName] = this.keyframes[paramName]
                .filter(kf => Number(kf?.time) !== normalizedTime);
            return true;
        }
        return false;
    }

    /**
     * Remove all keyframes for a param
     */
    clearKeyframes(paramName) {
        delete this.keyframes[paramName];
    }

    /**
     * Check if param has keyframes
     */
    hasKeyframes(paramName) {
        return this.keyframes[paramName] && this.keyframes[paramName].length > 0;
    }

    // ========================================================================
    // TIMELINE OPERATIONS
    // ========================================================================

    /**
     * Check if effect is active at given time
     * @param {number} time - Timeline time
     * @param {object} placement - Optional placement for bounds
     */
    isActiveAt(time, placement = null) {
        if (!this.enabled) return false;

        // Get effective bounds
        let effectStart = this.startTime;
        let effectEnd = this.endTime;

        // Inherit from placement if not set
        if (placement) {
            if (effectStart === null) effectStart = placement.startTime || 0;
            if (effectEnd === null) effectEnd = (placement.startTime || 0) + (placement.duration || 0);
        }

        // Default to always active if no bounds
        if (effectStart === null) effectStart = 0;
        if (effectEnd === null) effectEnd = Infinity;

        return time >= effectStart && time < effectEnd;
    }

    /**
     * Get effect duration
     */
    getDuration(placement = null) {
        let start = this.startTime;
        let end = this.endTime;

        if (placement) {
            if (start === null) start = placement.startTime || 0;
            if (end === null) end = (placement.startTime || 0) + (placement.duration || 0);
        }

        if (start === null || end === null) return Infinity;
        return end - start;
    }

    // ========================================================================
    // PROCESSING (Override in subclasses)
    // ========================================================================

    /**
     * Process the effect (override in engine-specific implementations)
     * @param {*} input - Input data (texture, path, etc.)
     * @param {object} context - Processing context
     * @returns {Promise<*>} Processed output
     */
    async process(_input, _context) {
        throw new Error(`process() not implemented for effect type: ${this.type}`);
    }

    /**
     * Get shader code (for GPU effects)
     */
    getShaderCode() {
        return null;
    }

    /**
     * Get FFmpeg filter string (for CPU effects)
     */
    getFFmpegFilter(_context) {
        return null;
    }

    // ========================================================================
    // SERIALIZATION
    // ========================================================================

    /**
     * Serialize effect to plain object
     */
    serialize() {
        return {
            id: this.id,
            type: this.type,
            name: this.name,
            engine: this.engine,
            targetId: this.targetId,
            targetType: this.targetType,
            enabled: this.enabled,
            order: this.order,
            startTime: this.startTime,
            endTime: this.endTime,
            params: this.params,
            expressions: this.expressions,
            keyframes: this.keyframes,
            createdAt: this.createdAt,
            metadata: this.metadata
        };
    }

    /**
     * Create effect from serialized data
     */
    static deserialize(data) {
        return new EffectNode(data);
    }

    /**
     * Clone the effect node
     */
    clone(overrides = {}) {
        const data = this.serialize();
        return new EffectNode({
            ...data,
            id: `fx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            createdAt: Date.now(),
            ...overrides
        });
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new effect node with defaults
 */
export function createEffectNode(config) {
    return new EffectNode(config);
}

export default EffectNode;
