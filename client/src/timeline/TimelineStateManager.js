/**
 * TimelineStateManager.js
 * The single source of truth for Viral Pilot's video editing state.
 * 
 * Features:
 * - Normalized entity-based state structure
 * - Immutable state updates with action dispatch
 * - Event-driven architecture for UI/agent consumers
 * - Undo/redo with history management
 * - Versioned timeline with named checkpoints
 * - Persistence support
 */

import {
    createTimelineState,
    createClip,
    createLayer,
    createEffect,
    createTransition,
    createPlacement,
    ENTITY_TYPES,
    LAYER_TYPES,
    validateTimelineState,
    getLayerPlacements,
    getSortedLayers,
    calculateTimelineDuration
} from './TimelineSchema.js';

import {
    deepFreeze,
    deepClone,
    addEntity,
    updateEntity,
    removeEntity,
    getEntity,
    getEntitiesByType,
    getEntitiesArray,
    setIn,
    batchUpdate
} from './ImmutableUtils.js';

import {
    TIMELINE_EVENTS,
    EVENT_SOURCES,
    timelineEvents,
    createClipEvent,
    createLayerEvent,
    createPlacementEvent,
    createEffectEvent,
    createSelectionEvent,
    createErrorEvent
} from './TimelineEvents.js';

import { TimelineHistory, timelineHistory } from './TimelineHistory.js';

// ============================================================================
// ACTION TYPES
// ============================================================================

export const ACTION_TYPES = {
    // Clips
    CLIP_ADD: 'CLIP_ADD',
    CLIP_UPDATE: 'CLIP_UPDATE',
    CLIP_REMOVE: 'CLIP_REMOVE',

    // Layers
    LAYER_ADD: 'LAYER_ADD',
    LAYER_UPDATE: 'LAYER_UPDATE',
    LAYER_REMOVE: 'LAYER_REMOVE',
    LAYER_REORDER: 'LAYER_REORDER',
    LAYER_MUTE: 'LAYER_MUTE',
    LAYER_SOLO: 'LAYER_SOLO',

    // Placements
    PLACEMENT_ADD: 'PLACEMENT_ADD',
    PLACEMENT_UPDATE: 'PLACEMENT_UPDATE',
    PLACEMENT_REMOVE: 'PLACEMENT_REMOVE',
    PLACEMENT_MOVE: 'PLACEMENT_MOVE',
    PLACEMENT_TRIM: 'PLACEMENT_TRIM',
    PLACEMENT_SPLIT: 'PLACEMENT_SPLIT',
    PLACEMENT_SPEED: 'PLACEMENT_SPEED',

    // Effects
    EFFECT_ADD: 'EFFECT_ADD',
    EFFECT_UPDATE: 'EFFECT_UPDATE',
    EFFECT_REMOVE: 'EFFECT_REMOVE',
    EFFECT_TOGGLE: 'EFFECT_TOGGLE',
    EFFECT_ADD_KEYFRAME: 'EFFECT_ADD_KEYFRAME',
    EFFECT_REMOVE_KEYFRAME: 'EFFECT_REMOVE_KEYFRAME',
    EFFECT_SET_PARAMS: 'EFFECT_SET_PARAMS',
    EFFECT_REORDER: 'EFFECT_REORDER',
    EFFECT_APPLY_PRESET: 'EFFECT_APPLY_PRESET',

    // Transitions
    TRANSITION_ADD: 'TRANSITION_ADD',
    TRANSITION_UPDATE: 'TRANSITION_UPDATE',
    TRANSITION_REMOVE: 'TRANSITION_REMOVE',

    // UI State
    SELECT: 'SELECT',
    SET_ACTIVE: 'SET_ACTIVE',
    SET_PLAYHEAD: 'SET_PLAYHEAD',
    SET_ZOOM: 'SET_ZOOM',
    SET_PLAYING: 'SET_PLAYING',

    // Metadata
    SET_ASPECT_RATIO: 'SET_ASPECT_RATIO',
    SET_DURATION: 'SET_DURATION',
    SET_RESOLUTION: 'SET_RESOLUTION',

    // Batch
    BATCH: 'BATCH',

    // State
    LOAD_STATE: 'LOAD_STATE',
    RESET_STATE: 'RESET_STATE'
};

// ============================================================================
// TIMELINE STATE MANAGER CLASS
// ============================================================================

export class TimelineStateManager {
    constructor(initialState = null, options = {}) {
        // Initialize state
        this.state = initialState || createTimelineState();

        // History manager
        this.history = options.history || timelineHistory;
        this.history.initialize(this.state);

        // Event emitter
        this.events = options.events || timelineEvents;

        // Options
        this.options = {
            freezeState: process.env.NODE_ENV !== 'production',
            validateOnDispatch: true,
            ...options
        };

        // Transaction state
        this.transactionDepth = 0;
        this.transactionQueue = [];

        // Seed default layers if state has none
        const hasLayers = Object.keys(this.state.entities.layers).length > 0;
        if (!hasLayers && !initialState) {
            const videoLayer = createLayer({
                id: 'track-1',
                name: 'Video Track 1',
                type: LAYER_TYPES.VIDEO,
                order: 0
            });
            const audioLayer = createLayer({
                id: 'track-2',
                name: 'Audio Track 1',
                type: LAYER_TYPES.AUDIO,
                order: 1
            });
            this.state = addEntity(this.state, ENTITY_TYPES.LAYER, videoLayer);
            this.state = addEntity(this.state, ENTITY_TYPES.LAYER, audioLayer);
            // Re-initialize history with seeded state
            this.history.initialize(this.state);
        }

        // Freeze initial state in dev
        if (this.options.freezeState) {
            this.state = deepFreeze(this.state);
        }

        // Emit initialization event
        this.events.emit(TIMELINE_EVENTS.STATE_INITIALIZED, {
            source: EVENT_SOURCES.INTERNAL
        });
    }

    // ========================================================================
    // STATE ACCESS
    // ========================================================================

    /**
     * Get the current state (frozen in dev)
     */
    getState() {
        return this.state;
    }

    /**
     * Get a single entity
     */
    getEntity(entityType, entityId) {
        return getEntity(this.state, entityType, entityId);
    }

    /**
     * Get all entities of a type (as object map)
     */
    getEntitiesByType(entityType) {
        return getEntitiesByType(this.state, entityType);
    }

    /**
     * Get all entities of a type (as array)
     */
    getEntitiesArray(entityType) {
        return getEntitiesArray(this.state, entityType);
    }

    /**
     * Get UI state
     */
    getUIState() {
        return this.state.ui;
    }

    /**
     * Get metadata
     */
    getMetadata() {
        return this.state.metadata;
    }

    // ========================================================================
    // ACTION DISPATCH
    // ========================================================================

    /**
     * Dispatch an action to update state
     * @param {object} action - Action object with type and payload
     * @param {object} options - Dispatch options
     * @returns {object} New state
     */
    dispatch(action, options = {}) {
        const { skipHistory = false, source = EVENT_SOURCES.USER } = options;

        // Handle batch actions during transaction
        if (this.transactionDepth > 0) {
            this.transactionQueue.push({ action, options });
            return this.state;
        }

        try {
            // Reduce the action
            const newState = this._reduce(this.state, action, source);

            // If state unchanged, return early
            if (newState === this.state) {
                return this.state;
            }

            // Validate if enabled
            if (this.options.validateOnDispatch) {
                const validation = validateTimelineState(newState);
                if (!validation.valid) {
                    console.warn('[TimelineStateManager] Validation errors:', validation.errors);
                    this.events.emit(TIMELINE_EVENTS.VALIDATION_ERROR, {
                        errors: validation.errors,
                        action
                    });
                }
            }

            // Record to history (unless skipped)
            if (!skipHistory && !this._isUIOnlyAction(action.type)) {
                this.history.record(newState, action, { source });
            }

            // Update state
            const oldState = this.state;
            this.state = this.options.freezeState ? deepFreeze(newState) : newState;

            // Update timestamp
            this.state = setIn(this.state, ['updatedAt'], Date.now());

            // Emit action-specific events
            this._emitActionEvents(action, newState, oldState, source);

            return this.state;

        } catch (error) {
            console.error('[TimelineStateManager] Dispatch error:', error);
            this.events.emit(TIMELINE_EVENTS.ERROR, createErrorEvent(error, { action }));
            throw error;
        }
    }

    /**
     * Check if action only affects UI state (don't record to history)
     */
    _isUIOnlyAction(actionType) {
        const uiOnlyActions = [
            ACTION_TYPES.SELECT,
            ACTION_TYPES.SET_ACTIVE,
            ACTION_TYPES.SET_PLAYHEAD,
            ACTION_TYPES.SET_ZOOM,
            ACTION_TYPES.SET_PLAYING
        ];
        return uiOnlyActions.includes(actionType);
    }

    // ========================================================================
    // REDUCER
    // ========================================================================

    /**
     * Main reducer function
     */
    _reduce(state, action, source) {
        const { type, payload } = action;

        switch (type) {
            // === CLIPS ===
            case ACTION_TYPES.CLIP_ADD: {
                const clip = createClip(payload.clip);
                return addEntity(state, ENTITY_TYPES.CLIP, clip);
            }

            case ACTION_TYPES.CLIP_UPDATE: {
                return updateEntity(state, ENTITY_TYPES.CLIP, payload.clipId, payload.updates);
            }

            case ACTION_TYPES.CLIP_REMOVE: {
                // Also remove associated placements
                let newState = removeEntity(state, ENTITY_TYPES.CLIP, payload.clipId);
                const placements = Object.values(state.entities.placements)
                    .filter(p => p.clipId === payload.clipId);
                placements.forEach(p => {
                    newState = removeEntity(newState, ENTITY_TYPES.PLACEMENT, p.id);
                });
                return newState;
            }

            // === LAYERS ===
            case ACTION_TYPES.LAYER_ADD: {
                const layer = createLayer(payload.layer);
                return addEntity(state, ENTITY_TYPES.LAYER, layer);
            }

            case ACTION_TYPES.LAYER_UPDATE: {
                return updateEntity(state, ENTITY_TYPES.LAYER, payload.layerId, payload.updates);
            }

            case ACTION_TYPES.LAYER_REMOVE: {
                // Also remove associated placements
                let newState = removeEntity(state, ENTITY_TYPES.LAYER, payload.layerId);
                const placements = Object.values(state.entities.placements)
                    .filter(p => p.layerId === payload.layerId);
                placements.forEach(p => {
                    newState = removeEntity(newState, ENTITY_TYPES.PLACEMENT, p.id);
                });
                return newState;
            }

            case ACTION_TYPES.LAYER_REORDER: {
                const { layerIds } = payload;
                let newState = state;
                layerIds.forEach((layerId, index) => {
                    newState = updateEntity(newState, ENTITY_TYPES.LAYER, layerId, { order: index });
                });
                return newState;
            }

            case ACTION_TYPES.LAYER_MUTE: {
                return updateEntity(state, ENTITY_TYPES.LAYER, payload.layerId, {
                    muted: payload.muted ?? !state.entities.layers[payload.layerId]?.muted
                });
            }

            case ACTION_TYPES.LAYER_SOLO: {
                return updateEntity(state, ENTITY_TYPES.LAYER, payload.layerId, {
                    solo: payload.solo ?? !state.entities.layers[payload.layerId]?.solo
                });
            }

            // === PLACEMENTS ===
            case ACTION_TYPES.PLACEMENT_ADD: {
                const placement = createPlacement(payload.placement);
                return addEntity(state, ENTITY_TYPES.PLACEMENT, placement);
            }

            case ACTION_TYPES.PLACEMENT_UPDATE: {
                return updateEntity(state, ENTITY_TYPES.PLACEMENT, payload.placementId, payload.updates);
            }

            case ACTION_TYPES.PLACEMENT_REMOVE: {
                return removeEntity(state, ENTITY_TYPES.PLACEMENT, payload.placementId);
            }

            case ACTION_TYPES.PLACEMENT_MOVE: {
                return updateEntity(state, ENTITY_TYPES.PLACEMENT, payload.placementId, {
                    startTime: payload.startTime,
                    layerId: payload.layerId || state.entities.placements[payload.placementId]?.layerId
                });
            }

            case ACTION_TYPES.PLACEMENT_TRIM: {
                const placement = state.entities.placements[payload.placementId];
                if (!placement) return state;

                const updates = {};
                if (payload.trimStart !== undefined) {
                    updates.offset = (placement.offset || 0) + payload.trimStart;
                    updates.startTime = placement.startTime + payload.trimStart;
                    updates.duration = placement.duration - payload.trimStart;
                }
                if (payload.trimEnd !== undefined) {
                    updates.duration = (updates.duration || placement.duration) - payload.trimEnd;
                }

                return updateEntity(state, ENTITY_TYPES.PLACEMENT, payload.placementId, updates);
            }

            case ACTION_TYPES.PLACEMENT_SPLIT: {
                const placement = state.entities.placements[payload.placementId];
                if (!placement) return state;

                const splitTime = payload.splitTime;
                if (splitTime <= placement.startTime || splitTime >= placement.startTime + placement.duration) {
                    console.warn('[TimelineStateManager] Split time outside placement range');
                    return state;
                }

                const relativeSplit = splitTime - placement.startTime;

                // Update original placement (left part)
                let newState = updateEntity(state, ENTITY_TYPES.PLACEMENT, payload.placementId, {
                    duration: relativeSplit
                });

                // Create new placement (right part)
                const newPlacement = createPlacement({
                    clipId: placement.clipId,
                    layerId: placement.layerId,
                    startTime: splitTime,
                    duration: placement.duration - relativeSplit,
                    offset: (placement.offset || 0) + relativeSplit,
                    speed: placement.speed,
                    volume: placement.volume
                });

                newState = addEntity(newState, ENTITY_TYPES.PLACEMENT, newPlacement);

                return newState;
            }

            case ACTION_TYPES.PLACEMENT_SPEED: {
                const placement = state.entities.placements[payload.placementId];
                if (!placement) return state;

                const clip = state.entities.clips[placement.clipId];
                const sourceDuration = clip?.sourceDuration || placement.duration;
                const newDuration = sourceDuration / payload.speed;

                return updateEntity(state, ENTITY_TYPES.PLACEMENT, payload.placementId, {
                    speed: payload.speed,
                    duration: newDuration
                });
            }

            // === EFFECTS ===
            case ACTION_TYPES.EFFECT_ADD: {
                const effect = createEffect(payload.effect);
                return addEntity(state, ENTITY_TYPES.EFFECT, effect);
            }

            case ACTION_TYPES.EFFECT_UPDATE: {
                return updateEntity(state, ENTITY_TYPES.EFFECT, payload.effectId, payload.updates);
            }

            case ACTION_TYPES.EFFECT_REMOVE: {
                return removeEntity(state, ENTITY_TYPES.EFFECT, payload.effectId);
            }

            case ACTION_TYPES.EFFECT_TOGGLE: {
                const effect = state.entities.effects[payload.effectId];
                if (!effect) return state;
                return updateEntity(state, ENTITY_TYPES.EFFECT, payload.effectId, {
                    enabled: payload.enabled ?? !effect.enabled
                });
            }

            case ACTION_TYPES.EFFECT_ADD_KEYFRAME: {
                const effect = state.entities.effects[payload.effectId];
                if (!effect) return state;

                const keyframes = { ...effect.keyframes };
                if (!keyframes[payload.paramName]) {
                    keyframes[payload.paramName] = [];
                }

                // Add or update keyframe at time
                const existing = keyframes[payload.paramName].findIndex(k => k.time === payload.time);
                if (existing !== -1) {
                    keyframes[payload.paramName][existing] = {
                        time: payload.time,
                        value: payload.value,
                        easing: payload.easing || 'linear'
                    };
                } else {
                    keyframes[payload.paramName].push({
                        time: payload.time,
                        value: payload.value,
                        easing: payload.easing || 'linear'
                    });
                    // Sort by time
                    keyframes[payload.paramName].sort((a, b) => a.time - b.time);
                }

                return updateEntity(state, ENTITY_TYPES.EFFECT, payload.effectId, { keyframes });
            }

            case ACTION_TYPES.EFFECT_REMOVE_KEYFRAME: {
                const effect = state.entities.effects[payload.effectId];
                if (!effect || !effect.keyframes?.[payload.paramName]) return state;

                const keyframes = { ...effect.keyframes };
                keyframes[payload.paramName] = keyframes[payload.paramName]
                    .filter(k => k.time !== payload.time);

                if (keyframes[payload.paramName].length === 0) {
                    delete keyframes[payload.paramName];
                }

                return updateEntity(state, ENTITY_TYPES.EFFECT, payload.effectId, { keyframes });
            }

            case ACTION_TYPES.EFFECT_SET_PARAMS: {
                const effect = state.entities.effects[payload.effectId];
                if (!effect) return state;

                const params = { ...effect.params };
                for (const [key, value] of Object.entries(payload.params)) {
                    params[key] = typeof value === 'object' ? value : { value };
                }

                return updateEntity(state, ENTITY_TYPES.EFFECT, payload.effectId, { params });
            }

            case ACTION_TYPES.EFFECT_REORDER: {
                const { effectIds } = payload;
                let newState = state;
                effectIds.forEach((effectId, index) => {
                    newState = updateEntity(newState, ENTITY_TYPES.EFFECT, effectId, { order: index });
                });
                return newState;
            }

            case ACTION_TYPES.EFFECT_APPLY_PRESET: {
                // Bulk add effects from a preset
                let newState = state;
                for (const effectConfig of payload.effects || []) {
                    const effect = createEffect({
                        ...effectConfig,
                        targetId: payload.targetId,
                        targetType: payload.targetType,
                        presetId: payload.presetId,
                        startTime: payload.startTime,
                        endTime: payload.endTime
                    });
                    newState = addEntity(newState, ENTITY_TYPES.EFFECT, effect);
                }
                return newState;
            }

            // === TRANSITIONS ===
            case ACTION_TYPES.TRANSITION_ADD: {
                const transition = createTransition(payload.transition);
                return addEntity(state, ENTITY_TYPES.TRANSITION, transition);
            }

            case ACTION_TYPES.TRANSITION_UPDATE: {
                return updateEntity(state, ENTITY_TYPES.TRANSITION, payload.transitionId, payload.updates);
            }

            case ACTION_TYPES.TRANSITION_REMOVE: {
                return removeEntity(state, ENTITY_TYPES.TRANSITION, payload.transitionId);
            }

            // === UI STATE ===
            case ACTION_TYPES.SELECT: {
                return setIn(state, ['ui', 'selectedIds'], payload.selectedIds || []);
            }

            case ACTION_TYPES.SET_ACTIVE: {
                return setIn(state, ['ui', 'activeClipId'], payload.clipId);
            }

            case ACTION_TYPES.SET_PLAYHEAD: {
                return setIn(state, ['ui', 'playhead'], payload.time);
            }

            case ACTION_TYPES.SET_ZOOM: {
                return setIn(state, ['ui', 'zoomLevel'], payload.zoomLevel);
            }

            case ACTION_TYPES.SET_PLAYING: {
                return setIn(state, ['ui', 'isPlaying'], payload.isPlaying);
            }

            // === METADATA ===
            case ACTION_TYPES.SET_ASPECT_RATIO: {
                return setIn(state, ['metadata', 'aspectRatio'], payload.aspectRatio);
            }

            case ACTION_TYPES.SET_DURATION: {
                return setIn(state, ['metadata', 'duration'], payload.duration);
            }

            case ACTION_TYPES.SET_RESOLUTION: {
                return setIn(state, ['metadata', 'resolution'], payload.resolution);
            }

            // === BATCH ===
            case ACTION_TYPES.BATCH: {
                let newState = state;
                for (const subAction of payload.actions) {
                    newState = this._reduce(newState, subAction, source);
                }
                return newState;
            }

            // === STATE ===
            case ACTION_TYPES.LOAD_STATE: {
                return payload.state;
            }

            case ACTION_TYPES.RESET_STATE: {
                return createTimelineState(payload.options);
            }

            default:
                console.warn(`[TimelineStateManager] Unknown action type: ${type}`);
                return state;
        }
    }

    // ========================================================================
    // EVENT EMISSION
    // ========================================================================

    /**
     * Emit events based on action type
     */
    _emitActionEvents(action, newState, oldState, source) {
        const { type, payload } = action;

        const eventMap = {
            [ACTION_TYPES.CLIP_ADD]: TIMELINE_EVENTS.CLIP_ADDED,
            [ACTION_TYPES.CLIP_UPDATE]: TIMELINE_EVENTS.CLIP_UPDATED,
            [ACTION_TYPES.CLIP_REMOVE]: TIMELINE_EVENTS.CLIP_REMOVED,
            [ACTION_TYPES.LAYER_ADD]: TIMELINE_EVENTS.LAYER_ADDED,
            [ACTION_TYPES.LAYER_UPDATE]: TIMELINE_EVENTS.LAYER_UPDATED,
            [ACTION_TYPES.LAYER_REMOVE]: TIMELINE_EVENTS.LAYER_REMOVED,
            [ACTION_TYPES.PLACEMENT_ADD]: TIMELINE_EVENTS.PLACEMENT_ADDED,
            [ACTION_TYPES.PLACEMENT_UPDATE]: TIMELINE_EVENTS.PLACEMENT_UPDATED,
            [ACTION_TYPES.PLACEMENT_REMOVE]: TIMELINE_EVENTS.PLACEMENT_REMOVED,
            [ACTION_TYPES.PLACEMENT_MOVE]: TIMELINE_EVENTS.PLACEMENT_MOVED,
            [ACTION_TYPES.PLACEMENT_SPLIT]: TIMELINE_EVENTS.PLACEMENT_SPLIT,
            [ACTION_TYPES.EFFECT_ADD]: TIMELINE_EVENTS.EFFECT_ADDED,
            [ACTION_TYPES.EFFECT_REMOVE]: TIMELINE_EVENTS.EFFECT_REMOVED,
            [ACTION_TYPES.SELECT]: TIMELINE_EVENTS.SELECTION_CHANGED,
            [ACTION_TYPES.SET_ACTIVE]: TIMELINE_EVENTS.ACTIVE_CLIP_CHANGED,
            [ACTION_TYPES.SET_PLAYHEAD]: TIMELINE_EVENTS.PLAYHEAD_MOVED,
            [ACTION_TYPES.SET_ASPECT_RATIO]: TIMELINE_EVENTS.ASPECT_RATIO_CHANGED
        };

        const eventType = eventMap[type];
        if (eventType) {
            this.events.emit(eventType, { ...payload, source });
        }
    }

    // ========================================================================
    // TRANSACTIONS
    // ========================================================================

    /**
     * Begin a transaction (batch multiple dispatches)
     */
    beginTransaction() {
        if (this.transactionDepth === 0) {
            this.history.beginTransaction();
            this.events.pause();
        }
        this.transactionDepth++;
    }

    /**
     * Commit the current transaction
     */
    commitTransaction(label) {
        this.transactionDepth--;

        if (this.transactionDepth === 0) {
            // Process queued actions
            const queue = [...this.transactionQueue];
            this.transactionQueue = [];

            for (const { action, options } of queue) {
                const newState = this._reduce(this.state, action, options.source || EVENT_SOURCES.USER);
                if (newState !== this.state) {
                    this.state = this.options.freezeState ? deepFreeze(newState) : newState;
                }
            }

            // Commit history transaction
            this.history.commitTransaction(label);

            // Resume and flush events
            this.events.resume();

            // Emit batch complete
            this.events.emit(TIMELINE_EVENTS.BATCH_COMPLETE, {
                actionCount: queue.length,
                source: EVENT_SOURCES.INTERNAL
            });
        }

        return this.state;
    }

    /**
     * Rollback the current transaction
     */
    rollbackTransaction() {
        this.transactionDepth = 0;
        this.transactionQueue = [];

        const originalState = this.history.rollbackTransaction();
        if (originalState) {
            this.state = this.options.freezeState ? deepFreeze(originalState) : originalState;
        }

        this.events.clearQueue();
        this.events.resume();

        return this.state;
    }

    // ========================================================================
    // UNDO / REDO
    // ========================================================================

    /**
     * Undo the last action
     */
    undo() {
        const previousState = this.history.undo();
        if (previousState) {
            this.state = this.options.freezeState ? deepFreeze(previousState) : previousState;
        }
        return this.state;
    }

    /**
     * Redo the last undone action
     */
    redo() {
        const nextState = this.history.redo();
        if (nextState) {
            this.state = this.options.freezeState ? deepFreeze(nextState) : nextState;
        }
        return this.state;
    }

    /**
     * Check if undo is possible
     */
    canUndo() {
        return this.history.canUndo();
    }

    /**
     * Check if redo is possible
     */
    canRedo() {
        return this.history.canRedo();
    }

    // ========================================================================
    // VERSIONING
    // ========================================================================

    /**
     * Create a named version
     */
    createVersion(label) {
        return this.history.createVersion(label);
    }

    /**
     * List all versions
     */
    listVersions() {
        return this.history.listVersions();
    }

    /**
     * Load a version
     */
    loadVersion(versionId) {
        const loadedState = this.history.loadVersion(versionId);
        if (loadedState) {
            this.state = this.options.freezeState ? deepFreeze(loadedState) : loadedState;
        }
        return this.state;
    }

    // ========================================================================
    // PERSISTENCE
    // ========================================================================

    /**
     * Save current state
     */
    save() {
        this.history.persist();
        return this.state;
    }

    /**
     * Load state from storage
     */
    load() {
        const loaded = this.history.loadFromStorage();
        if (loaded) {
            const currentState = this.history.getCurrentState();
            if (currentState) {
                this.state = this.options.freezeState ? deepFreeze(currentState) : currentState;
                this.events.emit(TIMELINE_EVENTS.STATE_LOADED, { source: EVENT_SOURCES.LOAD });
            }
        }
        return this.state;
    }

    // ========================================================================
    // SUBSCRIPTIONS
    // ========================================================================

    /**
     * Subscribe to timeline events
     */
    subscribe(eventType, callback) {
        return this.events.on(eventType, callback);
    }

    /**
     * Unsubscribe from timeline events
     */
    unsubscribe(eventType, callback) {
        this.events.off(eventType, callback);
    }

    // ========================================================================
    // LEGACY COMPATIBILITY
    // ========================================================================

    /**
     * Convert normalized state to legacy track-based structure
     * For backward compatibility with existing useTimelineStore consumers
     */
    toLegacyTracks() {
        const layers = getSortedLayers(this.state);

        return layers.map(layer => {
            const placements = getLayerPlacements(this.state, layer.id);

            return {
                id: layer.id,
                type: layer.type,
                name: layer.name,
                volume: layer.volume,
                muted: layer.muted,
                solo: layer.solo,
                clips: placements.map(placement => {
                    const clip = this.state.entities.clips[placement.clipId] || {};
                    return {
                        id: placement.id,  // Use placement ID for timeline operations
                        clipId: placement.clipId,
                        name: clip.name || 'Untitled',
                        type: clip.type,
                        sourceUrl: clip.sourceUrl,
                        start: placement.startTime,
                        duration: placement.duration,
                        offset: placement.offset,
                        speed: placement.speed,
                        volume: placement.volume,
                        sourceDuration: clip.sourceDuration
                    };
                })
            };
        });
    }

    /**
     * Import from legacy track-based structure
     */
    fromLegacyTracks(tracks) {
        this.beginTransaction();

        try {
            // Reset entities
            this.dispatch({ type: ACTION_TYPES.RESET_STATE, payload: {} }, { skipHistory: true });

            tracks.forEach((track, trackIndex) => {
                // Create layer
                this.dispatch({
                    type: ACTION_TYPES.LAYER_ADD,
                    payload: {
                        layer: {
                            id: track.id,
                            name: track.name,
                            type: track.type,
                            order: trackIndex,
                            volume: track.volume,
                            muted: track.muted,
                            solo: track.solo
                        }
                    }
                });

                // Create clips and placements
                track.clips?.forEach(legacyClip => {
                    // Create clip entity
                    const clipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
                    this.dispatch({
                        type: ACTION_TYPES.CLIP_ADD,
                        payload: {
                            clip: {
                                id: clipId,
                                name: legacyClip.name,
                                type: legacyClip.type || track.type,
                                sourceUrl: legacyClip.sourceUrl,
                                sourceDuration: legacyClip.sourceDuration || legacyClip.duration
                            }
                        }
                    });

                    // Create placement
                    this.dispatch({
                        type: ACTION_TYPES.PLACEMENT_ADD,
                        payload: {
                            placement: {
                                id: legacyClip.id,
                                clipId,
                                layerId: track.id,
                                startTime: legacyClip.start,
                                duration: legacyClip.duration,
                                offset: legacyClip.offset || 0,
                                speed: legacyClip.speed || 1.0,
                                volume: legacyClip.volume || 1.0
                            }
                        }
                    });
                });
            });

            this.commitTransaction('Import Legacy Tracks');

        } catch (error) {
            this.rollbackTransaction();
            throw error;
        }

        return this.state;
    }

    // ========================================================================
    // EFFECTS HELPERS
    // ========================================================================

    /**
     * Get all effects for a specific target (placement, clip, or layer)
     * @param {string} targetId - Target entity ID
     * @param {string} targetType - 'placement', 'clip', or 'layer'
     * @returns {object[]} Array of effect entities
     */
    getEffectsForTarget(targetId, targetType = 'placement') {
        const effects = this.getEntitiesArray(ENTITY_TYPES.EFFECT);
        return effects
            .filter(e => e.targetId === targetId && e.targetType === targetType)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    /**
     * Get effects active at a specific time for a target
     * @param {string} targetId - Target entity ID
     * @param {number} time - Timeline time in seconds
     * @returns {object[]} Array of active effect entities
     */
    getActiveEffectsAt(targetId, time) {
        const effects = this.getEffectsForTarget(targetId);
        const placement = this.getEntity(ENTITY_TYPES.PLACEMENT, targetId);

        if (!placement) return effects.filter(e => e.enabled);

        // Filter effects by time bounds
        return effects.filter(effect => {
            if (!effect.enabled) return false;

            // If effect has explicit time bounds, use those
            if (effect.startTime !== null && effect.endTime !== null) {
                return time >= effect.startTime && time <= effect.endTime;
            }

            // Otherwise inherit from placement bounds
            const effectStart = effect.startTime ?? placement.startTime;
            const effectEnd = effect.endTime ?? (placement.startTime + placement.duration);

            return time >= effectStart && time <= effectEnd;
        });
    }

    /**
     * Get all placements active at a specific time
     * Used by PlaybackEngine for effect rendering
     * @param {number} time - Timeline time in seconds
     * @returns {object[]} Array of placement entities with their clip info
     */
    getActivePlacements(time) {
        const placements = this.getEntitiesArray(ENTITY_TYPES.PLACEMENT);

        return placements
            .filter(p => {
                const start = p.startTime;
                const end = p.startTime + p.duration;
                return time >= start && time < end;
            })
            .map(p => {
                const clip = this.getEntity(ENTITY_TYPES.CLIP, p.clipId);
                const layer = this.getEntity(ENTITY_TYPES.LAYER, p.layerId);
                return {
                    ...p,
                    clip,
                    layer,
                    effects: this.getActiveEffectsAt(p.id, time)
                };
            })
            .sort((a, b) => (a.layer?.order || 0) - (b.layer?.order || 0));
    }

    /**
     * Sync effects with PlaybackEngine pipeline
     * @param {object} playbackEngine - PlaybackEngine instance
     */
    syncEffectsToPlaybackEngine(playbackEngine) {
        if (!playbackEngine?.getEffectsPipeline) return;

        const pipeline = playbackEngine.getEffectsPipeline();
        if (!pipeline) return;

        // Clear existing effects in pipeline
        pipeline.clear();

        // Add all effects from state
        const effects = this.getEntitiesArray(ENTITY_TYPES.EFFECT);
        for (const effect of effects) {
            pipeline.addEffect(effect);
        }

        console.log(`[TimelineStateManager] Synced ${effects.length} effects to PlaybackEngine`);
    }

    /**
     * Update active placements in PlaybackEngine
     * Call this on playhead change or timeline updates
     * @param {object} playbackEngine - PlaybackEngine instance
     * @param {number} time - Current timeline time
     */
    updateActivePlacements(playbackEngine, time) {
        if (!playbackEngine?.setActivePlacements) return;

        const activePlacements = this.getActivePlacements(time);
        playbackEngine.setActivePlacements(activePlacements);
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const timelineManager = new TimelineStateManager();

// ============================================================================
// CONVENIENCE ACTION CREATORS
// ============================================================================

export const TimelineActions = {
    // Clips
    addClip: (clip) => ({ type: ACTION_TYPES.CLIP_ADD, payload: { clip } }),
    updateClip: (clipId, updates) => ({ type: ACTION_TYPES.CLIP_UPDATE, payload: { clipId, updates } }),
    removeClip: (clipId) => ({ type: ACTION_TYPES.CLIP_REMOVE, payload: { clipId } }),

    // Layers
    addLayer: (layer) => ({ type: ACTION_TYPES.LAYER_ADD, payload: { layer } }),
    updateLayer: (layerId, updates) => ({ type: ACTION_TYPES.LAYER_UPDATE, payload: { layerId, updates } }),
    removeLayer: (layerId) => ({ type: ACTION_TYPES.LAYER_REMOVE, payload: { layerId } }),
    reorderLayers: (layerIds) => ({ type: ACTION_TYPES.LAYER_REORDER, payload: { layerIds } }),
    muteLayer: (layerId, muted) => ({ type: ACTION_TYPES.LAYER_MUTE, payload: { layerId, muted } }),
    soloLayer: (layerId, solo) => ({ type: ACTION_TYPES.LAYER_SOLO, payload: { layerId, solo } }),

    // Placements
    addPlacement: (placement) => ({ type: ACTION_TYPES.PLACEMENT_ADD, payload: { placement } }),
    updatePlacement: (placementId, updates) => ({ type: ACTION_TYPES.PLACEMENT_UPDATE, payload: { placementId, updates } }),
    removePlacement: (placementId) => ({ type: ACTION_TYPES.PLACEMENT_REMOVE, payload: { placementId } }),
    movePlacement: (placementId, startTime, layerId) => ({ type: ACTION_TYPES.PLACEMENT_MOVE, payload: { placementId, startTime, layerId } }),
    trimPlacement: (placementId, trimStart, trimEnd) => ({ type: ACTION_TYPES.PLACEMENT_TRIM, payload: { placementId, trimStart, trimEnd } }),
    splitPlacement: (placementId, splitTime) => ({ type: ACTION_TYPES.PLACEMENT_SPLIT, payload: { placementId, splitTime } }),
    setPlacementSpeed: (placementId, speed) => ({ type: ACTION_TYPES.PLACEMENT_SPEED, payload: { placementId, speed } }),

    // Effects
    addEffect: (effect) => ({ type: ACTION_TYPES.EFFECT_ADD, payload: { effect } }),
    updateEffect: (effectId, updates) => ({ type: ACTION_TYPES.EFFECT_UPDATE, payload: { effectId, updates } }),
    removeEffect: (effectId) => ({ type: ACTION_TYPES.EFFECT_REMOVE, payload: { effectId } }),
    toggleEffect: (effectId, enabled) => ({ type: ACTION_TYPES.EFFECT_TOGGLE, payload: { effectId, enabled } }),
    addEffectKeyframe: (effectId, paramName, time, value, easing) => ({
        type: ACTION_TYPES.EFFECT_ADD_KEYFRAME,
        payload: { effectId, paramName, time, value, easing }
    }),
    removeEffectKeyframe: (effectId, paramName, time) => ({
        type: ACTION_TYPES.EFFECT_REMOVE_KEYFRAME,
        payload: { effectId, paramName, time }
    }),
    setEffectParams: (effectId, params) => ({
        type: ACTION_TYPES.EFFECT_SET_PARAMS,
        payload: { effectId, params }
    }),
    reorderEffects: (effectIds) => ({
        type: ACTION_TYPES.EFFECT_REORDER,
        payload: { effectIds }
    }),
    applyPreset: (presetId, targetId, targetType, effects, options = {}) => ({
        type: ACTION_TYPES.EFFECT_APPLY_PRESET,
        payload: {
            presetId,
            targetId,
            targetType,
            effects,
            startTime: options.startTime,
            endTime: options.endTime
        }
    }),

    // Transitions
    addTransition: (transition) => ({ type: ACTION_TYPES.TRANSITION_ADD, payload: { transition } }),
    updateTransition: (transitionId, updates) => ({ type: ACTION_TYPES.TRANSITION_UPDATE, payload: { transitionId, updates } }),
    removeTransition: (transitionId) => ({ type: ACTION_TYPES.TRANSITION_REMOVE, payload: { transitionId } }),

    // UI
    select: (selectedIds) => ({ type: ACTION_TYPES.SELECT, payload: { selectedIds } }),
    setActive: (clipId) => ({ type: ACTION_TYPES.SET_ACTIVE, payload: { clipId } }),
    setPlayhead: (time) => ({ type: ACTION_TYPES.SET_PLAYHEAD, payload: { time } }),
    setZoom: (zoomLevel) => ({ type: ACTION_TYPES.SET_ZOOM, payload: { zoomLevel } }),
    setPlaying: (isPlaying) => ({ type: ACTION_TYPES.SET_PLAYING, payload: { isPlaying } }),

    // Metadata
    setAspectRatio: (aspectRatio) => ({ type: ACTION_TYPES.SET_ASPECT_RATIO, payload: { aspectRatio } }),
    setDuration: (duration) => ({ type: ACTION_TYPES.SET_DURATION, payload: { duration } }),
    setResolution: (resolution) => ({ type: ACTION_TYPES.SET_RESOLUTION, payload: { resolution } }),

    // Batch
    batch: (actions) => ({ type: ACTION_TYPES.BATCH, payload: { actions } })
};

export default TimelineStateManager;
