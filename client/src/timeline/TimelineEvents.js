/**
 * TimelineEvents.js
 * Event emitter and event type definitions for timeline state changes.
 * Provides a pub/sub system for UI and agent consumers.
 */

// ============================================================================
// EVENT TYPES
// ============================================================================

export const TIMELINE_EVENTS = {
    // === State Lifecycle ===
    STATE_INITIALIZED: 'timeline:state:initialized',
    STATE_LOADED: 'timeline:state:loaded',
    STATE_RESET: 'timeline:state:reset',

    // === Clip Events ===
    CLIP_ADDED: 'timeline:clip:added',
    CLIP_UPDATED: 'timeline:clip:updated',
    CLIP_REMOVED: 'timeline:clip:removed',

    // === Layer Events ===
    LAYER_ADDED: 'timeline:layer:added',
    LAYER_UPDATED: 'timeline:layer:updated',
    LAYER_REMOVED: 'timeline:layer:removed',
    LAYER_REORDERED: 'timeline:layer:reordered',
    LAYER_MUTED: 'timeline:layer:muted',
    LAYER_SOLOED: 'timeline:layer:soloed',

    // === Placement Events ===
    PLACEMENT_ADDED: 'timeline:placement:added',
    PLACEMENT_UPDATED: 'timeline:placement:updated',
    PLACEMENT_REMOVED: 'timeline:placement:removed',
    PLACEMENT_MOVED: 'timeline:placement:moved',
    PLACEMENT_TRIMMED: 'timeline:placement:trimmed',
    PLACEMENT_SPEED_CHANGED: 'timeline:placement:speed',
    PLACEMENT_SPLIT: 'timeline:placement:split',

    // === Effect Events ===
    EFFECT_ADDED: 'timeline:effect:added',
    EFFECT_UPDATED: 'timeline:effect:updated',
    EFFECT_REMOVED: 'timeline:effect:removed',
    EFFECT_TOGGLED: 'timeline:effect:toggled',

    // === Transition Events ===
    TRANSITION_ADDED: 'timeline:transition:added',
    TRANSITION_UPDATED: 'timeline:transition:updated',
    TRANSITION_REMOVED: 'timeline:transition:removed',

    // === History Events ===
    HISTORY_PUSH: 'timeline:history:push',
    HISTORY_UNDO: 'timeline:history:undo',
    HISTORY_REDO: 'timeline:history:redo',
    HISTORY_CLEAR: 'timeline:history:clear',

    // === Version Events ===
    VERSION_CREATED: 'timeline:version:created',
    VERSION_LOADED: 'timeline:version:loaded',
    VERSION_DELETED: 'timeline:version:deleted',

    // === Transaction Events ===
    TRANSACTION_BEGIN: 'timeline:transaction:begin',
    TRANSACTION_COMMIT: 'timeline:transaction:commit',
    TRANSACTION_ROLLBACK: 'timeline:transaction:rollback',

    // === Selection Events ===
    SELECTION_CHANGED: 'timeline:selection:changed',
    ACTIVE_CLIP_CHANGED: 'timeline:active:changed',

    // === Playback Events ===
    PLAYHEAD_MOVED: 'timeline:playhead:moved',
    PLAYBACK_STARTED: 'timeline:playback:started',
    PLAYBACK_STOPPED: 'timeline:playback:stopped',

    // === Metadata Events ===
    DURATION_CHANGED: 'timeline:duration:changed',
    ASPECT_RATIO_CHANGED: 'timeline:aspect:changed',

    // === Batch Events ===
    BATCH_START: 'timeline:batch:start',
    BATCH_COMPLETE: 'timeline:batch:complete',

    // === Error Events ===
    ERROR: 'timeline:error',
    VALIDATION_ERROR: 'timeline:validation:error'
};

// ============================================================================
// EVENT SOURCES
// ============================================================================

export const EVENT_SOURCES = {
    USER: 'user',           // Direct user interaction
    AGENT: 'agent',         // AI agent action
    UNDO: 'undo',           // Undo operation
    REDO: 'redo',           // Redo operation
    LOAD: 'load',           // State load/restore
    SYNC: 'sync',           // External sync (collab)
    INTERNAL: 'internal'    // Internal state update
};

// ============================================================================
// EVENT EMITTER
// ============================================================================

/**
 * TimelineEventEmitter
 * A lightweight event emitter for timeline state changes.
 */
export class TimelineEventEmitter {
    constructor() {
        this.listeners = new Map();
        this.onceListeners = new Map();
        this.eventHistory = [];
        this.maxHistorySize = 100;
        this.paused = false;
        this.eventQueue = [];
    }

    /**
     * Subscribe to an event
     * @param {string} eventType - Event type from TIMELINE_EVENTS
     * @param {function} callback - Handler function (event) => void
     * @returns {function} Unsubscribe function
     */
    on(eventType, callback) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType).add(callback);

        // Return unsubscribe function
        return () => this.off(eventType, callback);
    }

    /**
     * Subscribe to an event (one-time)
     * @param {string} eventType - Event type
     * @param {function} callback - Handler function
     */
    once(eventType, callback) {
        if (!this.onceListeners.has(eventType)) {
            this.onceListeners.set(eventType, new Set());
        }
        this.onceListeners.get(eventType).add(callback);
    }

    /**
     * Unsubscribe from an event
     * @param {string} eventType - Event type
     * @param {function} callback - Handler to remove
     */
    off(eventType, callback) {
        if (this.listeners.has(eventType)) {
            this.listeners.get(eventType).delete(callback);
        }
        if (this.onceListeners.has(eventType)) {
            this.onceListeners.get(eventType).delete(callback);
        }
    }

    /**
     * Emit an event
     * @param {string} eventType - Event type
     * @param {object} data - Event payload
     */
    emit(eventType, data = {}) {
        const event = this._createEvent(eventType, data);

        if (this.paused) {
            this.eventQueue.push(event);
            return;
        }

        this._dispatch(event);
    }

    /**
     * Create a standardized event object
     */
    _createEvent(eventType, data) {
        return {
            type: eventType,
            timestamp: Date.now(),
            source: data.source || EVENT_SOURCES.INTERNAL,
            data: {
                ...data,
                source: undefined // Remove from nested data
            }
        };
    }

    /**
     * Dispatch an event to all listeners
     */
    _dispatch(event) {
        // Record in history
        this._recordEvent(event);

        // Log for debugging
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[Timeline Event] ${event.type}`, event.data);
        }

        // Notify regular listeners
        if (this.listeners.has(event.type)) {
            this.listeners.get(event.type).forEach(callback => {
                try {
                    callback(event);
                } catch (err) {
                    console.error(`[Timeline Event] Handler error for ${event.type}:`, err);
                }
            });
        }

        // Notify once listeners and remove them
        if (this.onceListeners.has(event.type)) {
            this.onceListeners.get(event.type).forEach(callback => {
                try {
                    callback(event);
                } catch (err) {
                    console.error(`[Timeline Event] Once handler error for ${event.type}:`, err);
                }
            });
            this.onceListeners.delete(event.type);
        }

        // Notify wildcard listeners
        if (this.listeners.has('*')) {
            this.listeners.get('*').forEach(callback => {
                try {
                    callback(event);
                } catch (err) {
                    console.error(`[Timeline Event] Wildcard handler error:`, err);
                }
            });
        }
    }

    /**
     * Record event in history for debugging/replay
     */
    _recordEvent(event) {
        this.eventHistory.push(event);

        // Trim history if too long
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Pause event emission (queue events)
     */
    pause() {
        this.paused = true;
    }

    /**
     * Resume event emission and flush queue
     */
    resume() {
        this.paused = false;

        // Dispatch queued events
        while (this.eventQueue.length > 0) {
            const event = this.eventQueue.shift();
            this._dispatch(event);
        }
    }

    /**
     * Clear all queued events without dispatching
     */
    clearQueue() {
        this.eventQueue = [];
    }

    /**
     * Remove all listeners
     */
    removeAllListeners() {
        this.listeners.clear();
        this.onceListeners.clear();
    }

    /**
     * Get event history for debugging
     */
    getHistory() {
        return [...this.eventHistory];
    }

    /**
     * Clear event history
     */
    clearHistory() {
        this.eventHistory = [];
    }

    /**
     * Get listener count for an event type
     */
    listenerCount(eventType) {
        const regular = this.listeners.get(eventType)?.size || 0;
        const once = this.onceListeners.get(eventType)?.size || 0;
        return regular + once;
    }
}

// ============================================================================
// HELPER FUNCTIONS FOR COMMON EVENTS
// ============================================================================

/**
 * Create a clip event payload
 */
export function createClipEvent(clipId, clip, prevClip = null, source = EVENT_SOURCES.USER) {
    return {
        entityType: 'clip',
        entityId: clipId,
        entity: clip,
        prevEntity: prevClip,
        source
    };
}

/**
 * Create a layer event payload
 */
export function createLayerEvent(layerId, layer, prevLayer = null, source = EVENT_SOURCES.USER) {
    return {
        entityType: 'layer',
        entityId: layerId,
        entity: layer,
        prevEntity: prevLayer,
        source
    };
}

/**
 * Create a placement event payload
 */
export function createPlacementEvent(placementId, placement, prevPlacement = null, source = EVENT_SOURCES.USER) {
    return {
        entityType: 'placement',
        entityId: placementId,
        entity: placement,
        prevEntity: prevPlacement,
        source
    };
}

/**
 * Create an effect event payload
 */
export function createEffectEvent(effectId, effect, prevEffect = null, source = EVENT_SOURCES.USER) {
    return {
        entityType: 'effect',
        entityId: effectId,
        entity: effect,
        prevEntity: prevEffect,
        source
    };
}

/**
 * Create a selection event payload
 */
export function createSelectionEvent(selectedIds, prevSelectedIds, source = EVENT_SOURCES.USER) {
    return {
        selectedIds,
        prevSelectedIds,
        source
    };
}

/**
 * Create an error event payload
 */
export function createErrorEvent(error, context = {}) {
    return {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        context,
        source: EVENT_SOURCES.INTERNAL
    };
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const timelineEvents = new TimelineEventEmitter();

export default TimelineEventEmitter;
