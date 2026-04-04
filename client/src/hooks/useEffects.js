/**
 * useEffects.js
 * React hook for integrating the effects engine with components.
 * 
 * Provides a simple API for managing effects in the timeline.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    timelineManager,
    TimelineActions,
    ACTION_TYPES
} from '../timeline/TimelineStateManager.js';
import {
    presetLibrary,
    effectRegistry,
    EFFECT_CATEGORIES
} from '../effects';
import { TIMELINE_EVENTS } from '../timeline/TimelineEvents.js';

// ============================================================================
// HOOK: useEffects
// ============================================================================

/**
 * Hook for managing effects on a target placement
 * @param {string} targetId - Placement ID to manage effects for
 * @param {object} options - Hook options
 */
export function useEffects(targetId, options = {}) {
    const { playbackEngine } = options;

    const [effects, setEffects] = useState([]);
    const [loading, setLoading] = useState(false);

    // Sync effects from state manager
    const syncEffects = useCallback(() => {
        if (!targetId) {
            setEffects([]);
            return;
        }

        const targetEffects = timelineManager.getEffectsForTarget(targetId);
        setEffects(targetEffects);
    }, [targetId]);

    // Subscribe to effect changes
    useEffect(() => {
        syncEffects();

        const handleEffectAdded = (e) => {
            if (e.effect?.targetId === targetId) syncEffects();
        };
        const handleEffectRemoved = (e) => {
            if (e.effectId) syncEffects();
        };

        timelineManager.subscribe(TIMELINE_EVENTS.EFFECT_ADDED, handleEffectAdded);
        timelineManager.subscribe(TIMELINE_EVENTS.EFFECT_REMOVED, handleEffectRemoved);

        return () => {
            timelineManager.unsubscribe(TIMELINE_EVENTS.EFFECT_ADDED, handleEffectAdded);
            timelineManager.unsubscribe(TIMELINE_EVENTS.EFFECT_REMOVED, handleEffectRemoved);
        };
    }, [targetId, syncEffects]);

    // Add effect
    const addEffect = useCallback((effectType, params = {}) => {
        const definition = effectRegistry.get(effectType);
        const config = effectRegistry.createConfig(effectType, {
            targetId,
            targetType: 'placement',
            params,
            ...params
        });

        timelineManager.dispatch(TimelineActions.addEffect(config));

        // Sync with playback engine
        if (playbackEngine) {
            timelineManager.syncEffectsToPlaybackEngine(playbackEngine);
        }

        syncEffects();
        return config;
    }, [targetId, playbackEngine, syncEffects]);

    // Remove effect
    const removeEffect = useCallback((effectId) => {
        timelineManager.dispatch(TimelineActions.removeEffect(effectId));

        if (playbackEngine) {
            timelineManager.syncEffectsToPlaybackEngine(playbackEngine);
        }

        syncEffects();
    }, [playbackEngine, syncEffects]);

    // Update effect params
    const updateEffectParams = useCallback((effectId, params) => {
        timelineManager.dispatch(TimelineActions.setEffectParams(effectId, params));

        if (playbackEngine) {
            timelineManager.syncEffectsToPlaybackEngine(playbackEngine);
        }

        syncEffects();
    }, [playbackEngine, syncEffects]);

    // Toggle effect enabled
    const toggleEffect = useCallback((effectId, enabled) => {
        timelineManager.dispatch(TimelineActions.toggleEffect(effectId, enabled));

        if (playbackEngine) {
            timelineManager.syncEffectsToPlaybackEngine(playbackEngine);
        }

        syncEffects();
    }, [playbackEngine, syncEffects]);

    // Add keyframe
    const addKeyframe = useCallback((effectId, paramName, time, value, easing = 'linear') => {
        timelineManager.dispatch(
            TimelineActions.addEffectKeyframe(effectId, paramName, time, value, easing)
        );
        syncEffects();
    }, [syncEffects]);

    // Remove keyframe
    const removeKeyframe = useCallback((effectId, paramName, time) => {
        timelineManager.dispatch(
            TimelineActions.removeEffectKeyframe(effectId, paramName, time)
        );
        syncEffects();
    }, [syncEffects]);

    // Reorder effects
    const reorderEffects = useCallback((effectIds) => {
        timelineManager.dispatch(TimelineActions.reorderEffects(effectIds));

        if (playbackEngine) {
            timelineManager.syncEffectsToPlaybackEngine(playbackEngine);
        }

        syncEffects();
    }, [playbackEngine, syncEffects]);

    // Clear all effects
    const clearEffects = useCallback(() => {
        effects.forEach(effect => {
            timelineManager.dispatch(TimelineActions.removeEffect(effect.id));
        });

        if (playbackEngine) {
            timelineManager.syncEffectsToPlaybackEngine(playbackEngine);
        }

        syncEffects();
    }, [effects, playbackEngine, syncEffects]);

    return {
        effects,
        loading,
        addEffect,
        removeEffect,
        updateEffectParams,
        toggleEffect,
        addKeyframe,
        removeKeyframe,
        reorderEffects,
        clearEffects
    };
}

// ============================================================================
// HOOK: usePresets
// ============================================================================

/**
 * Hook for browsing and applying presets
 */
export function usePresets() {
    const [presets, setPresets] = useState([]);
    const [categories, setCategories] = useState({});
    const [searchResults, setSearchResults] = useState(null);

    // Load presets on mount
    useEffect(() => {
        setPresets(presetLibrary.getAllPresets());
        setCategories(presetLibrary.getCategorized());
    }, []);

    // Search presets
    const search = useCallback((query) => {
        if (!query || query.trim() === '') {
            setSearchResults(null);
            return;
        }

        const results = presetLibrary.search(query);
        setSearchResults(results);
    }, []);

    // Get presets by category
    const getByCategory = useCallback((category) => {
        return presetLibrary.getByCategory(category);
    }, []);

    // Apply preset to target
    const applyPreset = useCallback((presetId, targetId, options = {}) => {
        const preset = presetLibrary.getPreset(presetId);
        if (!preset) {
            console.error(`[usePresets] Preset not found: ${presetId}`);
            return null;
        }

        // Create effect configs
        const effectConfigs = preset.createEffects({
            targetId,
            targetType: 'placement',
            controlValues: options.controlValues,
            startTime: options.startTime,
            endTime: options.endTime
        });

        // Add via timeline action
        timelineManager.dispatch(TimelineActions.applyPreset(
            presetId,
            targetId,
            'placement',
            effectConfigs.map(e => e.serialize ? e.serialize() : e),
            options
        ));

        return effectConfigs;
    }, []);

    // Save user preset
    const saveUserPreset = useCallback((preset) => {
        presetLibrary.saveUserPreset(preset);
        setPresets(presetLibrary.getAllPresets());
        setCategories(presetLibrary.getCategorized());
    }, []);

    // Delete user preset
    const deleteUserPreset = useCallback((presetId) => {
        presetLibrary.deleteUserPreset(presetId);
        setPresets(presetLibrary.getAllPresets());
        setCategories(presetLibrary.getCategorized());
    }, []);

    return {
        presets,
        categories,
        searchResults,
        search,
        getByCategory,
        applyPreset,
        saveUserPreset,
        deleteUserPreset
    };
}

// ============================================================================
// HOOK: useEffectRegistry
// ============================================================================

/**
 * Hook for browsing available effect types
 */
export function useEffectRegistry() {
    const allEffects = useMemo(() => effectRegistry.getAll(), []);
    const categories = useMemo(() => effectRegistry.getCategories(), []);

    const getByCategory = useCallback((category) => {
        return effectRegistry.getByCategory(category);
    }, []);

    const getByEngine = useCallback((engine) => {
        return effectRegistry.getByEngine(engine);
    }, []);

    const search = useCallback((query) => {
        return effectRegistry.search(query);
    }, []);

    const getDefinition = useCallback((effectType) => {
        return effectRegistry.get(effectType);
    }, []);

    return {
        allEffects,
        categories,
        getByCategory,
        getByEngine,
        search,
        getDefinition,
        EFFECT_CATEGORIES
    };
}

// ============================================================================
// HOOK: useEffectsPlayback
// ============================================================================

/**
 * Hook for connecting effects to playback timing
 * Updates active placements based on playhead position
 */
export function useEffectsPlayback(playbackEngine, playhead) {
    const lastUpdateRef = useRef(0);
    const UPDATE_INTERVAL = 1000 / 30; // 30fps update rate

    useEffect(() => {
        if (!playbackEngine) return;

        const now = performance.now();
        if (now - lastUpdateRef.current < UPDATE_INTERVAL) return;

        lastUpdateRef.current = now;

        // Update active placements in playback engine
        timelineManager.updateActivePlacements(playbackEngine, playhead);
    }, [playbackEngine, playhead]);

    // Initial sync
    useEffect(() => {
        if (!playbackEngine) return;

        // Sync all effects to engine
        timelineManager.syncEffectsToPlaybackEngine(playbackEngine);
    }, [playbackEngine]);

    // Get active effects at current time
    const getActiveEffects = useCallback((targetId) => {
        return timelineManager.getActiveEffectsAt(targetId, playhead);
    }, [playhead]);

    return {
        getActiveEffects
    };
}

export default useEffects;
