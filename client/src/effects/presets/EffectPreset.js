/**
 * EffectPreset.js
 * Preset definition and management for the Viral Pilot effects engine.
 * 
 * Supports saving, loading, and applying effect chain presets.
 */

import { createEffectNode } from '../EffectNode.js';
import { effectRegistry } from '../EffectRegistry.js';

// ============================================================================
// PRESET CATEGORIES
// ============================================================================

export const PRESET_CATEGORIES = {
    COLOR: 'color',
    BLUR: 'blur',
    GLITCH: 'glitch',
    LIGHT: 'light',
    TRANSFORM: 'transform',
    CINEMATIC: 'cinematic',
    SOCIAL: 'social',
    CUSTOM: 'custom'
};

// ============================================================================
// EFFECT PRESET CLASS
// ============================================================================

export class EffectPreset {
    constructor(config = {}) {
        // === Identity ===
        this.id = config.id || `preset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        this.name = config.name || 'Untitled Preset';
        this.description = config.description || '';
        this.category = config.category || PRESET_CATEGORIES.CUSTOM;

        // === Metadata ===
        this.author = config.author || 'User';
        this.version = config.version || '1.0.0';
        this.thumbnail = config.thumbnail || null;
        this.tags = config.tags || [];

        // === Effect Chain ===
        // Array of effect configs (not instances)
        this.effects = config.effects || [];

        // === User Controls ===
        // Exposed parameters for preset adjustment
        this.controls = config.controls || [];

        // === Timestamps ===
        this.createdAt = config.createdAt || Date.now();
        this.updatedAt = config.updatedAt || Date.now();
    }

    // ========================================================================
    // EFFECT GENERATION
    // ========================================================================

    /**
     * Generate effect nodes from this preset
     * @param {object} options - Override options
     * @returns {EffectNode[]} Array of effect nodes
     */
    createEffects(options = {}) {
        const effects = [];

        for (let i = 0; i < this.effects.length; i++) {
            const effectConfig = this.effects[i];

            // Merge with override options
            const config = {
                ...effectConfig,
                targetId: options.targetId,
                targetType: options.targetType || 'placement',
                order: options.orderOffset ? (effectConfig.order || i) + options.orderOffset : (effectConfig.order || i),
                startTime: options.startTime ?? effectConfig.startTime,
                endTime: options.endTime ?? effectConfig.endTime
            };

            // Apply control overrides
            if (options.controlValues) {
                this._applyControlValues(config, options.controlValues);
            }

            const effect = createEffectNode(config);
            effects.push(effect);
        }

        return effects;
    }

    _applyControlValues(effectConfig, controlValues) {
        for (const control of this.controls) {
            if (controlValues[control.id] !== undefined) {
                // Parse control path (e.g., "effects[0].params.intensity")
                const match = control.param.match(/effects\[(\d+)\]\.params\.(\w+)/);
                if (match) {
                    const [, effectIndex, paramName] = match;
                    const configIndex = parseInt(effectIndex);

                    if (configIndex === this.effects.indexOf(effectConfig)) {
                        if (!effectConfig.params) effectConfig.params = {};
                        effectConfig.params[paramName] = {
                            ...(effectConfig.params[paramName] || {}),
                            value: controlValues[control.id]
                        };
                    }
                }
            }
        }
    }

    // ========================================================================
    // PRESET MODIFICATION
    // ========================================================================

    /**
     * Add effect to preset
     */
    addEffect(effectConfig) {
        this.effects.push({
            ...effectConfig,
            order: this.effects.length
        });
        this.updatedAt = Date.now();
    }

    /**
     * Remove effect from preset
     */
    removeEffect(index) {
        this.effects.splice(index, 1);
        // Reorder remaining effects
        this.effects.forEach((e, i) => e.order = i);
        this.updatedAt = Date.now();
    }

    /**
     * Update effect in preset
     */
    updateEffect(index, updates) {
        if (this.effects[index]) {
            Object.assign(this.effects[index], updates);
            this.updatedAt = Date.now();
        }
    }

    /**
     * Add user control
     */
    addControl(control) {
        this.controls.push({
            id: control.id || `ctrl-${Date.now()}`,
            param: control.param,
            label: control.label || control.param,
            min: control.min,
            max: control.max,
            step: control.step,
            default: control.default
        });
        this.updatedAt = Date.now();
    }

    // ========================================================================
    // VALIDATION
    // ========================================================================

    /**
     * Validate preset
     */
    validate() {
        const errors = [];

        if (!this.name || this.name.trim() === '') {
            errors.push('Preset name is required');
        }

        if (!this.effects || this.effects.length === 0) {
            errors.push('Preset must have at least one effect');
        }

        for (let i = 0; i < this.effects.length; i++) {
            const effect = this.effects[i];
            if (!effect.type) {
                errors.push(`Effect at index ${i} is missing type`);
            } else if (!effectRegistry.has(effect.type)) {
                errors.push(`Unknown effect type: ${effect.type}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // ========================================================================
    // SERIALIZATION
    // ========================================================================

    /**
     * Serialize preset to JSON-compatible object
     */
    serialize() {
        return {
            id: this.id,
            name: this.name,
            description: this.description,
            category: this.category,
            author: this.author,
            version: this.version,
            thumbnail: this.thumbnail,
            tags: [...this.tags],
            effects: this.effects.map(e => ({ ...e })),
            controls: this.controls.map(c => ({ ...c })),
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Create preset from serialized data
     */
    static deserialize(data) {
        return new EffectPreset(data);
    }

    /**
     * Clone preset
     */
    clone(overrides = {}) {
        return new EffectPreset({
            ...this.serialize(),
            id: `preset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ...overrides
        });
    }

    /**
     * Export to JSON string
     */
    toJSON() {
        return JSON.stringify(this.serialize(), null, 2);
    }

    /**
     * Import from JSON string
     */
    static fromJSON(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            return EffectPreset.deserialize(data);
        } catch (error) {
            throw new Error(`Invalid preset JSON: ${error.message}`);
        }
    }

    // ========================================================================
    // STATIC BUILDERS
    // ========================================================================

    /**
     * Create preset from existing effects
     */
    static fromEffects(effects, metadata = {}) {
        const effectConfigs = effects.map((effect, index) => ({
            type: effect.type,
            engine: effect.engine,
            params: { ...effect.params },
            order: index,
            // Don't include target info, start/end times
        }));

        return new EffectPreset({
            ...metadata,
            effects: effectConfigs
        });
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new effect preset
 */
export function createPreset(config = {}) {
    return new EffectPreset(config);
}

export default EffectPreset;
