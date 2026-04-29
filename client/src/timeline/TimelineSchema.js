/**
 * TimelineSchema.js
 * Defines the normalized timeline state structure and validation utilities.
 * This is the canonical schema for Viral Pilot's timeline state.
 */

// ============================================================================
// SCHEMA VERSION - Increment when structure changes require migration
// ============================================================================
export const SCHEMA_VERSION = '1';

// ============================================================================
// ENTITY TYPES
// ============================================================================
export const ENTITY_TYPES = {
    CLIP: 'clips',
    LAYER: 'layers',
    EFFECT: 'effects',
    TRANSITION: 'transitions',
    PLACEMENT: 'placements'
};

// ============================================================================
// CLIP TYPES
// ============================================================================
export const CLIP_TYPES = {
    VIDEO: 'video',
    AUDIO: 'audio',
    IMAGE: 'image',
    TEXT: 'text'
};

// ============================================================================
// LAYER TYPES
// ============================================================================
export const LAYER_TYPES = {
    VIDEO: 'video',
    AUDIO: 'audio',
    TEXT: 'text',
    OVERLAY: 'overlay'
};

// ============================================================================
// EFFECT TYPES
// ============================================================================
export const EFFECT_TYPES = {
    // Color (GPU)
    COLOR_GRADE: 'color_grade',
    BRIGHTNESS: 'brightness',
    CONTRAST: 'contrast',
    SATURATION: 'saturation',
    HUE_ROTATE: 'hue_rotate',
    GRAYSCALE: 'grayscale',
    SEPIA: 'sepia',

    // Blur (GPU)
    BLUR_GAUSSIAN: 'blur_gaussian',
    BLUR_MOTION: 'blur_motion',
    BLUR_RADIAL: 'blur_radial',

    // Light (GPU)
    GLOW: 'glow',
    VIGNETTE: 'vignette',

    // Distortion (GPU)
    SHAKE: 'shake',
    RGB_SPLIT: 'rgb_split',

    // Stylize (GPU)
    FILM_GRAIN: 'film_grain',
    GLITCH: 'glitch',

    // Audio (CPU)
    VOLUME: 'volume',
    FADE_IN: 'fade_in',
    FADE_OUT: 'fade_out',
    DENOISE: 'audio_denoise',
    NORMALIZE: 'audio_normalize',

    // Transform (CPU)
    SCALE: 'scale',
    ROTATE: 'rotate',
    CROP: 'crop',

    // Speed (CPU)
    SPEED: 'speed_change',
    REVERSE: 'reverse',

    // LUT (CPU)
    LUT_APPLY: 'lut_apply',

    // AI Effects
    SMART_ZOOM: 'smart_zoom',
    BEAT_SYNC: 'beat_sync',
    EMOTION_FRAME: 'emotion_frame'
};

// ============================================================================
// ENGINE TYPES (for effect processing)
// ============================================================================
export const ENGINE_TYPES = {
    GPU: 'gpu',      // WebGL shader-based (real-time)
    CPU: 'cpu',      // FFmpeg filter-based (final render)
    AI: 'ai'         // AI API-driven (async analysis)
};

// ============================================================================
// TRANSITION TYPES
// ============================================================================
export const TRANSITION_TYPES = {
    CUT: 'cut',
    FADE: 'fade',
    DISSOLVE: 'dissolve',
    WIPE: 'wipe',
    SLIDE: 'slide',
    ZOOM: 'zoom'
};

// ============================================================================
// DEFAULT ENTITY FACTORIES
// ============================================================================

/**
 * Create a new clip entity
 */
export function createClip(overrides = {}) {
    return {
        id: overrides.id || `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: overrides.name || 'Untitled Clip',
        type: overrides.type || CLIP_TYPES.VIDEO,
        sourceUrl: overrides.sourceUrl || null,
        sourceDuration: overrides.sourceDuration || 0,
        thumbnail: overrides.thumbnail || null,
        metadata: overrides.metadata || {},
        createdAt: Date.now(),
        ...overrides
    };
}

/**
 * Create a new layer entity
 */
export function createLayer(overrides = {}) {
    return {
        id: overrides.id || `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: overrides.name || 'Untitled Layer',
        type: overrides.type || LAYER_TYPES.VIDEO,
        order: overrides.order ?? 0,
        locked: overrides.locked ?? false,
        visible: overrides.visible ?? true,
        muted: overrides.muted ?? false,
        solo: overrides.solo ?? false,
        volume: overrides.volume ?? 1.0,
        createdAt: Date.now(),
        ...overrides
    };
}

/**
 * Create a new effect entity (extended for node-based architecture)
 */
export function createEffect(overrides = {}) {
    return {
        id: overrides.id || `effect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: overrides.type || EFFECT_TYPES.COLOR_GRADE,
        engine: overrides.engine || ENGINE_TYPES.GPU,  // 'gpu' | 'cpu' | 'ai'
        targetId: overrides.targetId || null, // Clip or Placement ID
        targetType: overrides.targetType || 'placement', // 'clip' or 'placement' or 'layer'
        enabled: overrides.enabled ?? true,
        params: overrides.params || {},
        order: overrides.order ?? 0,
        startTime: overrides.startTime ?? null,  // null = inherit from placement
        endTime: overrides.endTime ?? null,
        keyframes: overrides.keyframes || {},   // { paramName: [{ time, value, easing }] }
        presetId: overrides.presetId || null,   // Source preset ID if applied
        createdAt: Date.now(),
        ...overrides
    };
}

/**
 * Create a new transition entity
 */
export function createTransition(overrides = {}) {
    return {
        id: overrides.id || `trans-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: overrides.type || TRANSITION_TYPES.CUT,
        placementAId: overrides.placementAId || null, // Outgoing placement
        placementBId: overrides.placementBId || null, // Incoming placement
        duration: overrides.duration ?? 0.5,
        params: overrides.params || {},
        createdAt: Date.now(),
        ...overrides
    };
}

/**
 * Create a new placement entity (clip instance on timeline)
 */
export function createPlacement(overrides = {}) {
    return {
        id: overrides.id || `placement-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        clipId: overrides.clipId || null,
        layerId: overrides.layerId || null,
        startTime: overrides.startTime ?? 0,
        duration: overrides.duration ?? 0,
        offset: overrides.offset ?? 0, // Trim offset from source start
        speed: overrides.speed ?? 1.0,
        volume: overrides.volume ?? 1.0,
        createdAt: Date.now(),
        ...overrides
    };
}

// ============================================================================
// DEFAULT TIMELINE STATE
// ============================================================================

/**
 * Create a new empty timeline state
 */
export function createTimelineState(overrides = {}) {
    const now = Date.now();

    return {
        // Identity & Versioning
        id: overrides.id || `timeline-${now}`,
        version: overrides.version || '1.0.0',
        schemaVersion: SCHEMA_VERSION,
        createdAt: now,
        updatedAt: now,

        // Normalized Entities
        entities: {
            clips: {},
            layers: {},
            effects: {},
            transitions: {},
            placements: {}
        },

        // Timeline Metadata
        metadata: {
            duration: overrides.duration || 60,
            aspectRatio: overrides.aspectRatio || '16:9',
            framerate: overrides.framerate || 30,
            resolution: overrides.resolution || { width: 1920, height: 1080 }
        },

        // UI State (transient, not persisted in history)
        ui: {
            selectedIds: [],
            activeClipId: null,
            zoomLevel: 10,
            playhead: 0,
            isPlaying: false
        },

        // Override with any provided values
        ...overrides
    };
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate a clip entity
 */
export function validateClip(clip) {
    const errors = [];

    if (!clip.id) errors.push('Clip must have an id');
    if (!clip.type || !Object.values(CLIP_TYPES).includes(clip.type)) {
        errors.push(`Invalid clip type: ${clip.type}`);
    }
    if (typeof clip.sourceDuration !== 'number' || clip.sourceDuration < 0) {
        errors.push('Clip sourceDuration must be a non-negative number');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate a layer entity
 */
export function validateLayer(layer) {
    const errors = [];

    if (!layer.id) errors.push('Layer must have an id');
    if (!layer.type || !Object.values(LAYER_TYPES).includes(layer.type)) {
        errors.push(`Invalid layer type: ${layer.type}`);
    }
    if (typeof layer.order !== 'number') {
        errors.push('Layer order must be a number');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate a placement entity
 */
export function validatePlacement(placement, state) {
    const errors = [];

    if (!placement.id) errors.push('Placement must have an id');
    if (!placement.clipId) errors.push('Placement must reference a clipId');
    if (!placement.layerId) errors.push('Placement must reference a layerId');

    if (state) {
        if (!state.entities.clips[placement.clipId]) {
            errors.push(`Placement references non-existent clip: ${placement.clipId}`);
        }
        if (!state.entities.layers[placement.layerId]) {
            errors.push(`Placement references non-existent layer: ${placement.layerId}`);
        }
    }

    if (typeof placement.startTime !== 'number' || placement.startTime < 0) {
        errors.push('Placement startTime must be a non-negative number');
    }
    if (typeof placement.duration !== 'number' || placement.duration <= 0) {
        errors.push('Placement duration must be a positive number');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate entire timeline state
 */
export function validateTimelineState(state) {
    const errors = [];

    // Check schema version
    if (state.schemaVersion !== SCHEMA_VERSION) {
        errors.push(`Schema version mismatch: expected ${SCHEMA_VERSION}, got ${state.schemaVersion}`);
    }

    // Check entities exist
    if (!state.entities) {
        errors.push('State must have entities object');
        return { valid: false, errors };
    }

    // Validate all placements reference valid clips and layers
    Object.values(state.entities.placements || {}).forEach(placement => {
        const result = validatePlacement(placement, state);
        errors.push(...result.errors);
    });

    // Validate all effects reference valid targets
    Object.values(state.entities.effects || {}).forEach(effect => {
        if (effect.targetType === 'clip' && !state.entities.clips[effect.targetId]) {
            errors.push(`Effect ${effect.id} references non-existent clip: ${effect.targetId}`);
        }
        if (effect.targetType === 'placement' && !state.entities.placements[effect.targetId]) {
            errors.push(`Effect ${effect.id} references non-existent placement: ${effect.targetId}`);
        }
    });

    return { valid: errors.length === 0, errors };
}

// ============================================================================
// QUERY UTILITIES
// ============================================================================

/**
 * Get all placements for a specific layer, sorted by start time
 */
export function getLayerPlacements(state, layerId) {
    return Object.values(state.entities.placements)
        .filter(p => p.layerId === layerId)
        .sort((a, b) => a.startTime - b.startTime);
}

/**
 * Get all effects for a specific target
 */
export function getTargetEffects(state, targetId, targetType = 'placement') {
    return Object.values(state.entities.effects)
        .filter(e => e.targetId === targetId && e.targetType === targetType)
        .sort((a, b) => a.order - b.order);
}

/**
 * Get the clip data for a placement
 */
export function getPlacementClip(state, placementId) {
    const placement = state.entities.placements[placementId];
    if (!placement) return null;
    return state.entities.clips[placement.clipId];
}

/**
 * Get all layers sorted by order
 */
export function getSortedLayers(state) {
    const TYPE_ORDER = {
        'text': 0,
        'video': 1,
        'audio': 2
    };

    return Object.values(state.entities.layers)
        .sort((a, b) => {
            const typeA = TYPE_ORDER[a.type] !== undefined ? TYPE_ORDER[a.type] : 99;
            const typeB = TYPE_ORDER[b.type] !== undefined ? TYPE_ORDER[b.type] : 99;
            
            if (typeA !== typeB) {
                return typeA - typeB;
            }
            return a.order - b.order;
        });
}

/**
 * Calculate the total timeline duration based on placements
 */
export function calculateTimelineDuration(state) {
    const placements = Object.values(state.entities.placements);
    if (placements.length === 0) return 0;

    return Math.max(...placements.map(p => p.startTime + p.duration));
}

export default {
    SCHEMA_VERSION,
    ENTITY_TYPES,
    CLIP_TYPES,
    LAYER_TYPES,
    EFFECT_TYPES,
    TRANSITION_TYPES,
    createClip,
    createLayer,
    createEffect,
    createTransition,
    createPlacement,
    createTimelineState,
    validateClip,
    validateLayer,
    validatePlacement,
    validateTimelineState,
    getLayerPlacements,
    getTargetEffects,
    getPlacementClip,
    getSortedLayers,
    calculateTimelineDuration
};
