'use strict';

/**
 * server/presets-engine/library/PresetLearner.js
 *
 * Learns which presets a user applies repeatedly and promotes them
 * to their personalised preset list (user_presets table).
 *
 * Observe pattern:
 *   recordApplication(userId, presetId, projectId, accepted)
 *     → writes to asset_usage_log
 *     → if accepted >= AUTO_PROMOTE_THRESHOLD times → upsert to user_presets
 *
 * All writes are async fire-and-forget.
 */

const { supabaseAdmin }   = require('../../../config/database.js');

// After this many accepted applications of the same preset, auto-promote
const AUTO_PROMOTE_THRESHOLD = 3;

class PresetLearner {
    /**
     * Record that a preset was applied (or rejected) by a user.
     * Updates usage_log and potentially promotes to user_presets.
     * Fire-and-forget — never throws.
     *
     * @param {string}  userId
     * @param {string}  presetId   — asset UUID
     * @param {string}  projectId
     * @param {boolean} accepted
     */
    recordApplication(userId, presetId, projectId, accepted) {
        if (!userId || !presetId) return;
        this._process(userId, presetId, projectId, accepted).catch(err => {
            console.warn('[PresetLearner.recordApplication] non-fatal:', err.message);
        });
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /** @private */
    async _process(userId, presetId, projectId, accepted) {
        // 1. Log the application event
        await supabaseAdmin
            .from('asset_usage_log')
            .insert({
                user_id:    userId,
                asset_id:   presetId,
                project_id: projectId,
                accepted,
                event_type: 'preset_applied',
            });

        if (!accepted) return; // Only learn from accepted applications

        // 2. Count how many times this user has accepted this preset
        const { count, error: countErr } = await supabaseAdmin
            .from('asset_usage_log')
            .select('id', { count: 'exact', head: true })
            .eq('user_id',  userId)
            .eq('asset_id', presetId)
            .eq('accepted', true);

        if (countErr) return;

        // 3. Auto-promote if threshold reached
        if ((count || 0) >= AUTO_PROMOTE_THRESHOLD) {
            await this._promoteToUserPresets(userId, presetId);
        }
    }

    /**
     * Upsert a system preset into the user's personal preset list.
     * Idempotent — uses unique (user_id, name) constraint.
     * @private
     */
    async _promoteToUserPresets(userId, presetId) {
        try {
            // Fetch the source preset
            const { data: assetRow, error: assetErr } = await supabaseAdmin
                .from('assets')
                .select('*, presets (*)')
                .eq('id', presetId)
                .single();

            if (assetErr || !assetRow) return;

            const preset = Array.isArray(assetRow.presets)
                ? assetRow.presets[0]
                : assetRow.presets;

            if (!preset) return;

            const name = `My ${assetRow.display_name}`;

            const { error: upsertErr } = await supabaseAdmin
                .from('user_presets')
                .upsert(
                    {
                        user_id:          userId,
                        name,
                        preset_type:      preset.preset_type,
                        settings:         preset.settings || {},
                        command_sequence: preset.command_sequence || null,
                        is_public:        false,
                        source_preset_id: presetId,
                        use_count:        1,
                    },
                    { onConflict: 'user_id,name', ignoreDuplicates: true }
                );

            if (upsertErr) {
                console.warn('[PresetLearner._promoteToUserPresets] upsert error:', upsertErr.message);
            } else {
                console.log(`[PresetLearner] Auto-promoted preset "${name}" for user ${userId}`);
            }
        } catch (err) {
            console.warn('[PresetLearner._promoteToUserPresets] error:', err.message);
        }
    }
}

// Singleton
const presetLearner = new PresetLearner();
module.exports = { PresetLearner, presetLearner };
