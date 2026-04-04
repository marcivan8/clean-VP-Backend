/**
 * Timeline State Manager Module
 * The single source of truth for Viral Pilot's video editing state.
 * 
 * @module timeline
 */

// Core State Manager
export {
    TimelineStateManager,
    timelineManager,
    TimelineActions,
    ACTION_TYPES
} from './TimelineStateManager.js';

// Schema & Entity Definitions
export {
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
} from './TimelineSchema.js';

// Immutable Utilities
export {
    deepFreeze,
    deepClone,
    getIn,
    setIn,
    updateIn,
    deleteIn,
    mergeDeep,
    addEntity,
    updateEntity,
    removeEntity,
    getEntity,
    getEntitiesByType,
    getEntitiesArray,
    batchUpdate
} from './ImmutableUtils.js';

// Event System
export {
    TIMELINE_EVENTS,
    EVENT_SOURCES,
    TimelineEventEmitter,
    timelineEvents,
    createClipEvent,
    createLayerEvent,
    createPlacementEvent,
    createEffectEvent,
    createSelectionEvent,
    createErrorEvent
} from './TimelineEvents.js';

// History & Versioning
export {
    TimelineHistory,
    timelineHistory
} from './TimelineHistory.js';

// Default export is the singleton manager instance
export { timelineManager as default } from './TimelineStateManager.js';
