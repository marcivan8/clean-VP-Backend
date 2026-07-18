/**
 * client/src/audio-engine/AudioEngineAPI.js
 *
 * Client-side API wrapper for the Creative Asset Intelligence System.
 * Covers: SFX search, LUT search/preview, preset execution, audio export,
 * and recommendation endpoints.
 *
 * All methods use authFetch (JWT-bearing).
 * requestAudioExport streams the response as a Blob and triggers a browser download.
 *
 * ESM — frontend only.
 */

import { authFetch } from '../utils/authFetch.js';

class AudioEngineAPI {
    // ── Asset Search ───────────────────────────────────────────────────────────

    /**
     * Universal asset search — SFX, LUTs, or presets in one call.
     *
     * @param {string} query           — natural language query
     * @param {{ assetTypes?: string[], limit?: number }} [opts]
     * @returns {Promise<{ results: import('./types').SearchResult[] }>}
     */
    async searchAssets(query, { assetTypes = null, limit = 10 } = {}) {
        const resp = await authFetch('/api/audio/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, assetTypes, limit }),
        });
        if (!resp.ok) throw new Error(`Asset search failed: ${resp.status}`);
        return resp.json();
    }

    /**
     * Search specifically for LUTs — supports numeric profile params OR NL query.
     *
     * @param {string|object} queryOrProfile
     * @param {{ cinematicOnly?: boolean, limit?: number }} [opts]
     * @returns {Promise<{ luts: object[] }>}
     */
    async searchLUTs(queryOrProfile, { cinematicOnly = false, limit = 10 } = {}) {
        const body = typeof queryOrProfile === 'string'
            ? { query: queryOrProfile, cinematicOnly, limit }
            : { ...queryOrProfile, limit };

        const resp = await authFetch('/api/luts/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`LUT search failed: ${resp.status}`);
        return resp.json();
    }

    // ── LUT Preview ───────────────────────────────────────────────────────────

    /**
     * Fetch the CSS filter string for a LUT — used by the editor for real-time preview.
     * NEVER null: falls back to 'none' if not found.
     *
     * @param {string} lutId — UUID
     * @returns {Promise<string>} CSS filter string e.g. "brightness(1.1) contrast(1.2)"
     */
    async getLUTPreview(lutId) {
        try {
            const resp = await authFetch(`/api/luts/${lutId}/preview`);
            if (!resp.ok) return 'none';
            const { cssFilter } = await resp.json();
            return cssFilter || 'none';
        } catch {
            return 'none';
        }
    }

    /**
     * List all available LUTs.
     *
     * @param {{ cinematicOnly?: boolean, category?: string, limit?: number }} [opts]
     * @returns {Promise<{ luts: object[] }>}
     */
    async listLUTs({ cinematicOnly = false, category = null, limit = 20 } = {}) {
        const params = new URLSearchParams();
        if (cinematicOnly) params.set('cinematic', 'true');
        if (category)      params.set('category', category);
        if (limit)         params.set('limit', String(limit));

        const resp = await authFetch(`/api/luts?${params}`);
        if (!resp.ok) throw new Error(`List LUTs failed: ${resp.status}`);
        return resp.json();
    }

    // ── Presets ───────────────────────────────────────────────────────────────

    /**
     * List system presets, optionally filtered by type.
     *
     * @param {string|null} presetType — e.g. 'COLOR_GRADE'
     * @param {number}      [limit]
     * @returns {Promise<{ presets: object[] }>}
     */
    async listPresets(presetType = null, limit = 20) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (presetType) params.set('type', presetType);

        const resp = await authFetch(`/api/presets?${params}`);
        if (!resp.ok) throw new Error(`List presets failed: ${resp.status}`);
        return resp.json();
    }

    /**
     * List the current user's personal presets.
     *
     * @returns {Promise<{ presets: object[] }>}
     */
    async getUserPresets() {
        const resp = await authFetch('/api/presets/user/mine');
        if (!resp.ok) throw new Error(`Get user presets failed: ${resp.status}`);
        return resp.json();
    }

    /**
     * Apply a preset to a project.
     * FULL_EDIT presets require approved=true — server returns 403 otherwise.
     *
     * @param {string}  presetId
     * @param {string}  projectId
     * @param {boolean} [approved] — must be true for FULL_EDIT type presets
     * @returns {Promise<{ success: boolean, executed: string[], skipped: string[] }>}
     */
    async applyPreset(presetId, projectId, approved = false) {
        const resp = await authFetch(`/api/presets/${presetId}/apply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, approved }),
        });
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            throw new Error(body.error || `Apply preset failed: ${resp.status}`);
        }
        return resp.json();
    }

    // ── Audio Export ──────────────────────────────────────────────────────────

    /**
     * Export audio from a project and trigger a browser download.
     * Streams the response as a Blob, creates an object URL, clicks it, then revokes.
     *
     * @param {import('../../../server/audio-engine/types').AudioExportOptions & { projectId?: string, videoUrl?: string }} opts
     * @returns {Promise<{ downloaded: true, filename: string }>}
     */
    async requestAudioExport(opts = {}) {
        const {
            projectId,
            videoUrl,
            format     = 'mp3',
            bitrate    = '192k',
            sampleRate,
            channels,
            normalize  = false,
            fadeIn,
            fadeOut,
            trimStart,
            trimEnd,
        } = opts;

        if (!projectId && !videoUrl) throw new Error('projectId or videoUrl is required');

        const resp = await authFetch('/api/audio/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, videoUrl, format, bitrate, sampleRate, channels, normalize, fadeIn, fadeOut, trimStart, trimEnd }),
        });

        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            throw new Error(body.error || `Audio export failed: ${resp.status}`);
        }

        const blob     = await resp.blob();
        const blobUrl  = URL.createObjectURL(blob);
        const filename = `audio_export.${format}`;

        const a    = document.createElement('a');
        a.href     = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Revoke after giving the browser time to start the download
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);

        return { downloaded: true, filename };
    }

    // ── Recommendations ───────────────────────────────────────────────────────

    /**
     * Recommend SFX for the current project state.
     *
     * @param {object} projectState
     * @param {{ limit?: number }} [opts]
     * @returns {Promise<{ results: object[] }>}
     */
    async recommendSFX(projectState, { limit = 5 } = {}) {
        const resp = await authFetch('/api/audio/recommend/sfx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectState, limit }),
        });
        if (!resp.ok) return { results: [] }; // graceful degradation
        return resp.json();
    }

    /**
     * Recommend LUTs for the current project state.
     *
     * @param {object} projectState
     * @param {{ limit?: number }} [opts]
     * @returns {Promise<{ luts: object[] }>}
     */
    async recommendLUTs(projectState, { limit = 3 } = {}) {
        const resp = await authFetch('/api/luts/recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectState, limit }),
        });
        if (!resp.ok) return { luts: [] };
        return resp.json();
    }

    /**
     * Recommend presets for the current project state.
     *
     * @param {object} projectState
     * @param {{ presetType?: string, limit?: number }} [opts]
     * @returns {Promise<{ presets: object[] }>}
     */
    async recommendPresets(projectState, { presetType = null, limit = 5 } = {}) {
        const resp = await authFetch('/api/presets/recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectState, presetType, limit }),
        });
        if (!resp.ok) return { presets: [] };
        return resp.json();
    }

    /**
     * Get all recommendations (SFX + LUTs + presets) concurrently.
     *
     * @param {object} projectState
     * @param {{ limit?: number }} [opts]
     * @returns {Promise<{ sfx: object[], luts: object[], presets: object[] }>}
     */
    async recommendAll(projectState, { limit = 5 } = {}) {
        const resp = await authFetch('/api/audio/recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectState, limit }),
        });
        if (!resp.ok) return { sfx: [], luts: [], presets: [] };
        return resp.json();
    }
}

// Singleton
export const audioEngineAPI = new AudioEngineAPI();
export default AudioEngineAPI;
