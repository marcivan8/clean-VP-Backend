'use strict';

/**
 * server/audio-engine/search/UserPreferenceEngine.js
 *
 * Learns per-user asset preferences from usage_log events.
 * Results feed into RankingEngine._userPreferenceScore().
 *
 * Preference data is stored in the `user_asset_preferences` table
 * and updated asynchronously (never on the critical search path).
 *
 * Public API:
 *   getUserPrefs(userId, assetType)     — fetch current profile (cached)
 *   recordUsage(userId, assetId, accepted) — update prefs async (fire-and-forget)
 */

const { supabaseAdmin } = require('../../../config/database.js');
const { AssetType } = require('../types.js');

// In-memory cache: `${userId}:${assetType}` → { profile, cachedAt }
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class UserPreferenceEngine {
    // ── Public ────────────────────────────────────────────────────────────────

    /**
     * Fetch preference profile for a user × asset type.
     * Returns null if no preferences exist yet.
     *
     * @param {string} userId
     * @param {string} assetType — AssetType value
     * @returns {Promise<Object|null>}
     */
    async getUserPrefs(userId, assetType) {
        if (!userId || !assetType) return null;

        const cacheKey = `${userId}:${assetType}`;
        const cached   = _cache.get(cacheKey);
        if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
            return cached.profile;
        }

        try {
            const { data, error } = await supabaseAdmin
                .from('user_asset_preferences')
                .select('*')
                .eq('user_id', userId)
                .eq('asset_type', assetType)
                .single();

            if (error || !data) {
                _cache.set(cacheKey, { profile: null, cachedAt: Date.now() });
                return null;
            }

            _cache.set(cacheKey, { profile: data, cachedAt: Date.now() });
            return data;
        } catch (err) {
            console.error('[UserPreferenceEngine.getUserPrefs]', err.message);
            return null;
        }
    }

    /**
     * Record that a user accepted or rejected an asset (from usage or suggestion).
     * Updates the user_asset_preferences row asynchronously — fire-and-forget.
     *
     * @param {string}  userId
     * @param {string}  assetId
     * @param {boolean} accepted
     */
    recordUsage(userId, assetId, accepted) {
        if (!userId || !assetId) return;
        // Fire-and-forget — never awaited
        this._updatePreferences(userId, assetId, accepted).catch(err => {
            console.warn('[UserPreferenceEngine.recordUsage] non-fatal:', err.message);
        });
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Internal: fetch the asset's intents/emotions and update prefs table.
     * @private
     */
    async _updatePreferences(userId, assetId, accepted) {
        // Fetch the asset's taxonomy
        const { data: asset, error } = await supabaseAdmin
            .from('assets')
            .select('type, editing_intents, emotion_tags, energy_level')
            .eq('id', assetId)
            .single();

        if (error || !asset) return;

        const intents  = asset.editing_intents || [];
        const emotions = asset.emotion_tags    || [];
        const energy   = asset.energy_level    || 3;
        const type     = asset.type;

        // Invalidate cache for this user × type
        _cache.delete(`${userId}:${type}`);

        // Upsert preferences
        const { data: existing } = await supabaseAdmin
            .from('user_asset_preferences')
            .select('*')
            .eq('user_id', userId)
            .eq('asset_type', type)
            .single();

        if (existing) {
            await this._updateExisting(userId, type, existing, intents, emotions, energy, accepted);
        } else {
            await this._createNew(userId, type, intents, emotions, energy, accepted);
        }
    }

    /**
     * Update an existing preferences row.
     * Accepted intents/emotions are added to preferred_* list.
     * Rejected ones are added to avoided_* list.
     * @private
     */
    async _updateExisting(userId, assetType, existing, intents, emotions, energy, accepted) {
        const prefIntents  = new Set(existing.preferred_intents  || []);
        const prefEmotions = new Set(existing.preferred_emotions || []);
        const avoidIntents = new Set(existing.avoided_intents   || []);
        const avoidEmotions= new Set(existing.avoided_emotions  || []);

        let prefEnergy  = existing.preferred_energy || energy;

        if (accepted) {
            intents.forEach(i  => { prefIntents.add(i);  avoidIntents.delete(i); });
            emotions.forEach(e => { prefEmotions.add(e); avoidEmotions.delete(e); });
            // Blend energy preference
            prefEnergy = (prefEnergy * 0.8 + energy * 0.2);
        } else {
            intents.forEach(i  => { avoidIntents.add(i);  prefIntents.delete(i); });
            emotions.forEach(e => { avoidEmotions.add(e); prefEmotions.delete(e); });
        }

        // Cap lists at 20 items each
        const cap = arr => arr.slice(0, 20);

        await supabaseAdmin
            .from('user_asset_preferences')
            .update({
                preferred_intents:  cap([...prefIntents]),
                preferred_emotions: cap([...prefEmotions]),
                avoided_intents:    cap([...avoidIntents]),
                avoided_emotions:   cap([...avoidEmotions]),
                preferred_energy:   Math.round(prefEnergy * 10) / 10,
                total_uses:         (existing.total_uses || 0) + 1,
                last_updated_at:    new Date().toISOString(),
            })
            .eq('user_id', userId)
            .eq('asset_type', assetType);
    }

    /**
     * Create a new preferences row.
     * @private
     */
    async _createNew(userId, assetType, intents, emotions, energy, accepted) {
        await supabaseAdmin
            .from('user_asset_preferences')
            .insert({
                user_id:             userId,
                asset_type:          assetType,
                preferred_intents:   accepted ? intents  : [],
                preferred_emotions:  accepted ? emotions : [],
                avoided_intents:     accepted ? [] : intents,
                avoided_emotions:    accepted ? [] : emotions,
                preferred_energy:    energy,
                total_uses:          1,
                last_updated_at:     new Date().toISOString(),
            });
    }
}

// Singleton
const userPreferenceEngine = new UserPreferenceEngine();
module.exports = { UserPreferenceEngine, userPreferenceEngine };
