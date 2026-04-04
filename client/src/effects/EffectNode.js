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

const EASING_FUNCTIONS = {
    linear: t => t,
    easeIn: t => t * t,
    easeOut: t => t * (2 - t),
    easeInOut: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    easeInCubic: t => t * t * t,
    easeOutCubic: t => (--t) * t * t + 1,
    easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
    easeInQuart: t => t * t * t * t,
    easeOutQuart: t => 1 - (--t) * t * t * t,
    easeInOutQuart: t => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,
    bounce: t => {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (t < 1 / d1) return n1 * t * t;
        if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
        if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
        return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
    elastic: t => {
        if (t === 0 || t === 1) return t;
        return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
    }
};

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
                    label: value.label || key
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
        if (this.params[paramName]) {
            const param = this.params[paramName];
            // Clamp to min/max if numeric
            if (typeof value === 'number' && param.min !== undefined && param.max !== undefined) {
                value = Math.max(param.min, Math.min(param.max, value));
            }
            this.params[paramName].value = value;
        }
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

        // No keyframes, return base value
        if (!keyframes || keyframes.length === 0) {
            return baseValue;
        }

        // Sort keyframes by time
        const sorted = [...keyframes].sort((a, b) => a.time - b.time);

        // Before first keyframe
        if (time <= sorted[0].time) {
            return sorted[0].value;
        }

        // After last keyframe
        if (time >= sorted[sorted.length - 1].time) {
            return sorted[sorted.length - 1].value;
        }

        // Find surrounding keyframes
        let fromKf = sorted[0];
        let toKf = sorted[1];

        for (let i = 0; i < sorted.length - 1; i++) {
            if (time >= sorted[i].time && time < sorted[i + 1].time) {
                fromKf = sorted[i];
                toKf = sorted[i + 1];
                break;
            }
        }

        // Calculate progress between keyframes
        const duration = toKf.time - fromKf.time;
        const progress = duration > 0 ? (time - fromKf.time) / duration : 0;

        // Apply easing
        const easing = EASING_FUNCTIONS[toKf.easing] || EASING_FUNCTIONS.linear;
        const easedProgress = easing(progress);

        // Interpolate value
        return this._interpolateValue(fromKf.value, toKf.value, easedProgress);
    }

    /**
     * Interpolate between two values
     */
    _interpolateValue(from, to, t) {
        // Number interpolation
        if (typeof from === 'number' && typeof to === 'number') {
            return from + (to - from) * t;
        }

        // Array interpolation (colors, vectors)
        if (Array.isArray(from) && Array.isArray(to)) {
            return from.map((v, i) => v + (to[i] - v) * t);
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
    getParamsAt(time) {
        const result = {};
        for (const paramName of Object.keys(this.params)) {
            result[paramName] = this.getParamAt(paramName, time);
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
        if (!this.keyframes[paramName]) {
            this.keyframes[paramName] = [];
        }

        // Remove existing keyframe at same time
        this.keyframes[paramName] = this.keyframes[paramName].filter(kf => kf.time !== time);

        // Add new keyframe
        this.keyframes[paramName].push({ time, value, easing });

        // Sort by time
        this.keyframes[paramName].sort((a, b) => a.time - b.time);
    }

    /**
     * Remove a keyframe
     */
    removeKeyframe(paramName, time) {
        if (this.keyframes[paramName]) {
            this.keyframes[paramName] = this.keyframes[paramName].filter(kf => kf.time !== time);
        }
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
    async process(input, context) {
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
    getFFmpegFilter(context) {
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
