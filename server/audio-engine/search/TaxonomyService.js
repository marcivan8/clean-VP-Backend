'use strict';

/**
 * server/audio-engine/search/TaxonomyService.js
 *
 * Provides taxonomy-aware retrieval from the assets, sound_effects,
 * luts, and presets tables via Supabase.
 *
 * Methods are grouped by asset type:
 *   SFX    — getSFXByIntents, getSFXByEvent, getSFXByName
 *   LUT    — getLUTsByProfile, getLUTsByIntents, getLUTByName
 *   Preset — getPresetsByType, getPresetsByIntents, getPresetByName
 *   Generic — getAssetsByIds, incrementUseCount
 */

const { supabaseAdmin } = require('../../../config/database.js');
const { AssetType, PresetType } = require('../types.js');

class TaxonomyService {
    constructor() {
        this.db = supabaseAdmin;
    }

    // ── SFX ───────────────────────────────────────────────────────────────────

    /**
     * Fetch SFX assets that match one or more EditingIntent values.
     * Ordered by use_count desc (popularity).
     *
     * @param {string[]} intents  — EditingIntent values
     * @param {number}   [limit=10]
     * @returns {Promise<Object[]>}
     */
    async getSFXByIntents(intents, limit = 10) {
        if (!intents?.length) return [];

        try {
            const { data, error } = await this.db
                .from('assets')
                .select(`
                    *,
                    sound_effects (*)
                `)
                .eq('type', AssetType.SOUND_EFFECT)
                .eq('is_active', true)
                .overlaps('editing_intents', intents)
                .order('use_count', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return this._mergeSFX(data || []);
        } catch (err) {
            console.error('[TaxonomyService.getSFXByIntents]', err.message);
            return [];
        }
    }

    /**
     * Fetch SFX compatible with a specific TimelineEventType.
     *
     * @param {string}  eventType  — TimelineEventType value
     * @param {number}  [limit=5]
     * @returns {Promise<Object[]>}
     */
    async getSFXByEvent(eventType, limit = 5) {
        if (!eventType) return [];

        try {
            const { data, error } = await this.db
                .from('assets')
                .select(`
                    *,
                    sound_effects!inner (*)
                `)
                .eq('type', AssetType.SOUND_EFFECT)
                .eq('is_active', true)
                .contains('sound_effects.compatible_timeline_events', [eventType])
                .order('use_count', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return this._mergeSFX(data || []);
        } catch (err) {
            console.error('[TaxonomyService.getSFXByEvent]', err.message);
            return [];
        }
    }

    /**
     * Fetch a single SFX by its slug name.
     *
     * @param {string} name
     * @returns {Promise<Object|null>}
     */
    async getSFXByName(name) {
        if (!name) return null;

        try {
            const { data, error } = await this.db
                .from('assets')
                .select(`*, sound_effects (*)`)
                .eq('name', name)
                .eq('type', AssetType.SOUND_EFFECT)
                .single();

            if (error) return null;
            const merged = this._mergeSFX([data]);
            return merged[0] || null;
        } catch (err) {
            console.error('[TaxonomyService.getSFXByName]', err.message);
            return null;
        }
    }

    // ── LUTs ──────────────────────────────────────────────────────────────────

    /**
     * Fetch LUTs matching a warmth/contrast/saturation profile using the
     * search_luts_by_profile RPC.
     *
     * @param {{
     *   warmthMin?: number, warmthMax?: number,
     *   contrastMin?: number, contrastMax?: number,
     *   saturationMin?: number, saturationMax?: number,
     *   cinematicOnly?: boolean,
     * }} profile
     * @param {number} [limit=5]
     * @returns {Promise<Object[]>}
     */
    async getLUTsByProfile(profile = {}, limit = 5) {
        try {
            const { data, error } = await this.db.rpc('search_luts_by_profile', {
                warmth_min:      profile.warmthMin      ?? -5,
                warmth_max:      profile.warmthMax      ??  5,
                contrast_min:    profile.contrastMin    ?? -5,
                contrast_max:    profile.contrastMax    ??  5,
                saturation_min:  profile.saturationMin  ?? -5,
                saturation_max:  profile.saturationMax  ??  5,
                cinematic_only:  profile.cinematicOnly  ?? false,
                limit_count:     limit,
            });

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('[TaxonomyService.getLUTsByProfile]', err.message);
            return [];
        }
    }

    /**
     * Fetch LUTs matching EditingIntent values.
     *
     * @param {string[]} intents
     * @param {number}   [limit=5]
     * @returns {Promise<Object[]>}
     */
    async getLUTsByIntents(intents, limit = 5) {
        if (!intents?.length) return [];

        try {
            const { data, error } = await this.db
                .from('assets')
                .select(`*, luts (*)`)
                .eq('type', AssetType.LUT)
                .eq('is_active', true)
                .overlaps('editing_intents', intents)
                .order('use_count', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return this._mergeLUTs(data || []);
        } catch (err) {
            console.error('[TaxonomyService.getLUTsByIntents]', err.message);
            return [];
        }
    }

    /**
     * Fetch a single LUT by slug name.
     *
     * @param {string} name
     * @returns {Promise<Object|null>}
     */
    async getLUTByName(name) {
        if (!name) return null;

        try {
            const { data, error } = await this.db
                .from('assets')
                .select(`*, luts (*)`)
                .eq('name', name)
                .eq('type', AssetType.LUT)
                .single();

            if (error) return null;
            const merged = this._mergeLUTs([data]);
            return merged[0] || null;
        } catch (err) {
            console.error('[TaxonomyService.getLUTByName]', err.message);
            return null;
        }
    }

    // ── Presets ───────────────────────────────────────────────────────────────

    /**
     * Fetch presets filtered by PresetType.
     *
     * @param {string}  presetType — PresetType value
     * @param {number}  [limit=5]
     * @returns {Promise<Object[]>}
     */
    async getPresetsByType(presetType, limit = 5) {
        if (!presetType) return [];

        try {
            const { data, error } = await this.db
                .from('assets')
                .select(`*, presets!inner (*)`)
                .eq('is_active', true)
                .eq('presets.preset_type', presetType)
                .order('use_count', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return this._mergePresets(data || []);
        } catch (err) {
            console.error('[TaxonomyService.getPresetsByType]', err.message);
            return [];
        }
    }

    /**
     * Fetch presets matching EditingIntent values.
     *
     * @param {string[]} intents
     * @param {string|null} [presetTypeFilter]  — optional PresetType filter
     * @param {number}     [limit=5]
     * @returns {Promise<Object[]>}
     */
    async getPresetsByIntents(intents, presetTypeFilter = null, limit = 5) {
        if (!intents?.length) return [];

        try {
            let query = this.db
                .from('assets')
                .select(`*, presets (*)`)
                .eq('is_active', true)
                .overlaps('editing_intents', intents);

            if (presetTypeFilter) {
                query = query.eq('presets.preset_type', presetTypeFilter);
            }

            const { data, error } = await query
                .order('use_count', { ascending: false })
                .limit(limit);

            if (error) throw error;
            return this._mergePresets(data || []);
        } catch (err) {
            console.error('[TaxonomyService.getPresetsByIntents]', err.message);
            return [];
        }
    }

    /**
     * Fetch a single preset by slug name.
     *
     * @param {string} name
     * @returns {Promise<Object|null>}
     */
    async getPresetByName(name) {
        if (!name) return null;

        try {
            const { data, error } = await this.db
                .from('assets')
                .select(`*, presets (*)`)
                .eq('name', name)
                .single();

            if (error) return null;
            const merged = this._mergePresets([data]);
            return merged[0] || null;
        } catch (err) {
            console.error('[TaxonomyService.getPresetByName]', err.message);
            return null;
        }
    }

    // ── Generic ───────────────────────────────────────────────────────────────

    /**
     * Fetch multiple assets by their UUIDs.
     *
     * @param {string[]} ids
     * @returns {Promise<Object[]>}
     */
    async getAssetsByIds(ids) {
        if (!ids?.length) return [];

        try {
            const { data, error } = await this.db
                .from('assets')
                .select('*')
                .in('id', ids);

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('[TaxonomyService.getAssetsByIds]', err.message);
            return [];
        }
    }

    /**
     * Increment use_count for an asset.
     * Fire-and-forget — does not throw.
     *
     * @param {string} assetId
     */
    async incrementUseCount(assetId) {
        if (!assetId) return;
        this.db.rpc('increment_asset_use_count', { asset_id: assetId }).catch(err => {
            console.warn('[TaxonomyService.incrementUseCount]', err.message);
        });
    }

    // ── Private merge helpers ─────────────────────────────────────────────────

    /**
     * Flatten Supabase joined rows (assets + sound_effects sub-object) into flat objects.
     * @private
     */
    _mergeSFX(rows) {
        return rows.map(row => {
            const sfx = Array.isArray(row.sound_effects)
                ? row.sound_effects[0]
                : row.sound_effects;
            const { sound_effects: _ignored, ...base } = row;
            return { ...base, ...(sfx || {}) };
        });
    }

    /**
     * Flatten joined rows (assets + luts sub-object).
     * @private
     */
    _mergeLUTs(rows) {
        return rows.map(row => {
            const lut = Array.isArray(row.luts) ? row.luts[0] : row.luts;
            const { luts: _ignored, ...base } = row;
            return {
                ...base,
                ...(lut || {}),
                // Always expose cssFilterPreview at top level
                cssFilterPreview: lut?.css_filter_preview || null,
            };
        });
    }

    /**
     * Flatten joined rows (assets + presets sub-object).
     * @private
     */
    _mergePresets(rows) {
        return rows.map(row => {
            const preset = Array.isArray(row.presets) ? row.presets[0] : row.presets;
            const { presets: _ignored, ...base } = row;
            return { ...base, ...(preset || {}) };
        });
    }
}

module.exports = { TaxonomyService };
