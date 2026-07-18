'use strict';

/**
 * server/lut-engine/library/LUTService.js
 *
 * LUT management service.
 *
 * Preview: always CSS filter (cssFilterPreview field) — zero FFmpeg.
 * Export:  always FFmpeg lut3d filter — never CSS.
 *
 * Methods:
 *   getLUTById(id)              → LUTAsset | null
 *   getLUTByName(name)          → LUTAsset | null
 *   listLUTs(opts)              → LUTAsset[]
 *   searchLUTs(query)           → LUTAsset[]
 *   getPreviewFilter(id)        → string (CSS filter, never null)
 *   buildFFmpegFilter(id, path) → string (ffmpeg lut3d filter string)
 *   applyToExport(jobConfig)    → updated jobConfig with lut3d filter
 */

const { supabaseAdmin }   = require('../../../config/database.js');
const { TaxonomyService } = require('../../audio-engine/search/TaxonomyService.js');
const { AssetType }       = require('../../audio-engine/types.js');

// Fallback CSS filter for when a LUT has no cssFilterPreview (should never happen with our seeder)
const FALLBACK_CSS_FILTER = 'none';

class LUTService {
    constructor() {
        this.taxonomy = new TaxonomyService();
    }

    // ── Lookup ────────────────────────────────────────────────────────────────

    /**
     * Fetch a LUT asset by UUID.
     *
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async getLUTById(id) {
        if (!id) return null;

        try {
            const { data, error } = await supabaseAdmin
                .from('assets')
                .select('*, luts (*)')
                .eq('id', id)
                .eq('type', AssetType.LUT)
                .single();

            if (error || !data) return null;
            return this._merge(data);
        } catch (err) {
            console.error('[LUTService.getLUTById]', err.message);
            return null;
        }
    }

    /**
     * Fetch a LUT asset by slug name.
     *
     * @param {string} name
     * @returns {Promise<Object|null>}
     */
    async getLUTByName(name) {
        return this.taxonomy.getLUTByName(name);
    }

    /**
     * List all active LUTs, optionally filtered by cinematic or category.
     *
     * @param {Object}  [opts]
     * @param {boolean} [opts.cinematicOnly]
     * @param {string}  [opts.category]
     * @param {number}  [opts.limit=20]
     * @returns {Promise<Object[]>}
     */
    async listLUTs(opts = {}) {
        const limit = opts.limit || 20;

        try {
            let query = supabaseAdmin
                .from('assets')
                .select('*, luts (*)')
                .eq('type', AssetType.LUT)
                .eq('is_active', true);

            if (opts.category) {
                query = query.eq('category', opts.category);
            }

            const { data, error } = await query
                .order('use_count', { ascending: false })
                .limit(limit);

            if (error) throw error;
            let results = (data || []).map(row => this._merge(row));

            if (opts.cinematicOnly) {
                results = results.filter(l => l.cinematic);
            }

            return results;
        } catch (err) {
            console.error('[LUTService.listLUTs]', err.message);
            return [];
        }
    }

    /**
     * Search LUTs by visual profile (warmth/contrast/saturation ranges).
     *
     * @param {Object} profileQuery — parsed SemanticSearchQuery or raw profile
     * @param {number} [limit=10]
     * @returns {Promise<Object[]>}
     */
    async searchLUTs(profileQuery, limit = 10) {
        try {
            if (profileQuery.warmthRange || profileQuery.warmth_min !== undefined) {
                const profile = {
                    warmthMin:    profileQuery.warmthRange?.min  ?? profileQuery.warmth_min    ?? -5,
                    warmthMax:    profileQuery.warmthRange?.max  ?? profileQuery.warmth_max    ??  5,
                    contrastMin:  profileQuery.contrast_min  ?? -5,
                    contrastMax:  profileQuery.contrast_max  ??  5,
                    saturationMin: profileQuery.saturation_min ?? -5,
                    saturationMax: profileQuery.saturation_max ??  5,
                    cinematicOnly: profileQuery.cinematicOnly ?? false,
                };
                return this.taxonomy.getLUTsByProfile(profile, limit);
            }

            // Fallback: intent-based search
            const intents = profileQuery._allIntents || [];
            return this.taxonomy.getLUTsByIntents(intents, limit);
        } catch (err) {
            console.error('[LUTService.searchLUTs]', err.message);
            return [];
        }
    }

    // ── Preview (CSS only) ────────────────────────────────────────────────────

    /**
     * Return the CSS filter string for in-editor preview.
     * NEVER invokes FFmpeg.
     * NEVER returns null.
     *
     * @param {string} lutIdOrName  — UUID or slug name
     * @returns {Promise<string>}   CSS filter string
     */
    async getPreviewFilter(lutIdOrName) {
        if (!lutIdOrName) return FALLBACK_CSS_FILTER;

        try {
            // Try by ID first (UUID pattern)
            const isUUID = /^[0-9a-f-]{36}$/i.test(lutIdOrName);
            const lut    = isUUID
                ? await this.getLUTById(lutIdOrName)
                : await this.getLUTByName(lutIdOrName);

            return lut?.css_filter_preview || lut?.cssFilterPreview || FALLBACK_CSS_FILTER;
        } catch {
            return FALLBACK_CSS_FILTER;
        }
    }

    // ── Export (FFmpeg only) ──────────────────────────────────────────────────

    /**
     * Build the FFmpeg lut3d filter string for export.
     * Returns null if the LUT file path is not available (GCS not yet populated).
     *
     * @param {string} lutId   — UUID
     * @param {string} lutPath — local or GCS-mounted absolute path to .cube file
     * @returns {string|null}  e.g. "lut3d=/path/to/file.cube"
     */
    buildFFmpegFilter(lutId, lutPath) {
        if (!lutPath) return null;
        // Escape colons in Windows paths (not needed on Linux but defensive)
        const escaped = lutPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        return `lut3d='${escaped}'`;
    }

    /**
     * Inject lut3d filter into an export job config.
     * The job config is the payload passed to exportProcessor.js.
     *
     * @param {Object} jobConfig   — mutable export job config
     * @param {string} lutId       — UUID
     * @param {string} lutFilePath — absolute path to .cube file on the worker host
     * @returns {Object}  updated jobConfig (mutated + returned)
     */
    applyToExport(jobConfig, lutId, lutFilePath) {
        if (!lutId || !lutFilePath) return jobConfig;

        const filter = this.buildFFmpegFilter(lutId, lutFilePath);
        if (!filter) return jobConfig;

        // Append to existing FFmpeg video filter chain
        if (!jobConfig.ffmpegVideoFilters) {
            jobConfig.ffmpegVideoFilters = [];
        }
        jobConfig.ffmpegVideoFilters.push(filter);
        jobConfig.appliedLutId   = lutId;
        jobConfig.appliedLutPath = lutFilePath;

        return jobConfig;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /** @private */
    _merge(row) {
        if (!row) return null;
        const lut = Array.isArray(row.luts) ? row.luts[0] : row.luts;
        const { luts: _ignored, ...base } = row;
        return {
            ...base,
            ...(lut || {}),
            cssFilterPreview: lut?.css_filter_preview || FALLBACK_CSS_FILTER,
        };
    }
}

// Singleton
const lutService = new LUTService();
module.exports = { LUTService, lutService };
