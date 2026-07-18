/**
 * client/src/hooks/useAudioEngine.js
 *
 * React hook for the Creative Asset Intelligence System.
 * Wraps AudioEngineAPI + exposes search, recommend, apply, and export actions.
 *
 * All state is local to the hook — use at the panel level.
 * applyLUT / clearLUT write directly to Zustand timeline state
 * (projectLUTId + projectLUTFilter) without requiring a new store action.
 */

import { useState, useCallback } from 'react';
import { audioEngineAPI } from '../audio-engine/AudioEngineAPI.js';
import useTimelineStore from '../store/useTimelineStore.js';

export function useAudioEngine() {
    const [sfxResults,    setSfxResults]    = useState([]);
    const [lutResults,    setLutResults]    = useState([]);
    const [presetResults, setPresetResults] = useState([]);
    const [loading,       setLoading]       = useState(false);
    const [error,         setError]         = useState(null);

    const projectId = useTimelineStore(s => s.projectId);

    // ── Search ────────────────────────────────────────────────────────────────

    const searchSFX = useCallback(async (query, { limit = 10 } = {}) => {
        setLoading(true); setError(null);
        try {
            const data = await audioEngineAPI.searchAssets(query, { assetTypes: ['SOUND_EFFECT'], limit });
            const results = data.results || [];
            setSfxResults(results);
            return results;
        } catch (e) {
            console.error('[useAudioEngine] searchSFX:', e.message);
            setError(e.message);
            return [];
        } finally { setLoading(false); }
    }, []);

    const searchLUTs = useCallback(async (query, { cinematicOnly = false, limit = 10 } = {}) => {
        setLoading(true); setError(null);
        try {
            const data = await audioEngineAPI.searchLUTs(query, { cinematicOnly, limit });
            const results = data.luts || [];
            setLutResults(results);
            return results;
        } catch (e) {
            console.error('[useAudioEngine] searchLUTs:', e.message);
            setError(e.message);
            return [];
        } finally { setLoading(false); }
    }, []);

    const searchPresets = useCallback(async (presetType = null, limit = 20) => {
        setLoading(true); setError(null);
        try {
            const data = await audioEngineAPI.listPresets(presetType, limit);
            const results = data.presets || [];
            setPresetResults(results);
            return results;
        } catch (e) {
            console.error('[useAudioEngine] searchPresets:', e.message);
            setError(e.message);
            return [];
        } finally { setLoading(false); }
    }, []);

    // ── Recommendations ───────────────────────────────────────────────────────

    const recommendAll = useCallback(async (projectState) => {
        try {
            const all = await audioEngineAPI.recommendAll(projectState, { limit: 5 });
            if (all.sfx?.length)     setSfxResults(all.sfx);
            if (all.luts?.length)    setLutResults(all.luts);
            if (all.presets?.length) setPresetResults(all.presets);
            return all;
        } catch (e) {
            console.warn('[useAudioEngine] recommendAll non-fatal:', e.message);
            return { sfx: [], luts: [], presets: [] };
        }
    }, []);

    // ── LUT ───────────────────────────────────────────────────────────────────

    /**
     * Apply a LUT: fetches CSS filter preview and stores both in timeline state.
     * CSS filter is used in the editor (immediate); FFmpeg lut3d used at export.
     */
    const applyLUT = useCallback(async (lutId) => {
        const cssFilter = await audioEngineAPI.getLUTPreview(lutId);
        useTimelineStore.setState({ projectLUTId: lutId, projectLUTFilter: cssFilter });
        return cssFilter;
    }, []);

    const clearLUT = useCallback(() => {
        useTimelineStore.setState({ projectLUTId: null, projectLUTFilter: 'none' });
    }, []);

    // ── Presets ───────────────────────────────────────────────────────────────

    const applyPreset = useCallback(async (presetId, { approved = false } = {}) => {
        if (!projectId) throw new Error('No active project');
        return audioEngineAPI.applyPreset(presetId, projectId, approved);
    }, [projectId]);

    // ── Audio Export ──────────────────────────────────────────────────────────

    const exportAudio = useCallback(async (opts = {}) => {
        return audioEngineAPI.requestAudioExport({ projectId, ...opts });
    }, [projectId]);

    return {
        // State
        sfxResults,
        lutResults,
        presetResults,
        loading,
        error,
        // Search
        searchSFX,
        searchLUTs,
        searchPresets,
        // Recommendations
        recommendAll,
        // LUT
        applyLUT,
        clearLUT,
        // Presets
        applyPreset,
        // Export
        exportAudio,
    };
}
