'use strict';

/**
 * server/presets-engine/library/PresetExecutor.js
 *
 * Executes preset command sequences via PipelineAdapter.
 *
 * FULL_EDIT presets ALWAYS require user approval before execution.
 * Non-FULL_EDIT presets (COLOR_GRADE, CAPTION_STYLE, etc.) execute immediately.
 *
 * Rules:
 * - Execution is sequential per PresetCommand.order
 * - skipIfFailed=true: log error, continue
 * - skipIfFailed=false: halt sequence on failure
 * - Results are logged to asset_usage_log (async, non-blocking)
 * - Never modifies existing routes or stores
 */

const { supabaseAdmin } = require('../../../config/database.js');
const { TaxonomyService } = require('../../audio-engine/search/TaxonomyService.js');
const { PresetType }    = require('../../audio-engine/types.js');

class PresetExecutor {
    constructor() {
        this.taxonomy = new TaxonomyService();
    }

    /**
     * Execute a preset for a project.
     * For FULL_EDIT presets, `approved` MUST be true or execution is rejected.
     *
     * @param {string}  presetId     — asset UUID
     * @param {string}  projectId
     * @param {string}  userId
     * @param {boolean} approved     — user has approved (required for FULL_EDIT)
     * @param {Object}  [pipelineAdapter] — injectable for testing
     * @returns {Promise<{success: boolean, executed: string[], skipped: string[], error: string|null}>}
     */
    async execute(presetId, projectId, userId, approved, pipelineAdapter = null) {
        const result = { success: false, executed: [], skipped: [], error: null };

        try {
            // Fetch preset
            const preset = await this.taxonomy.getPresetByName(presetId)
                || await this._getPresetById(presetId);

            if (!preset) {
                result.error = `Preset ${presetId} not found`;
                return result;
            }

            const isFullEdit = (preset.preset_type || preset.presetType) === PresetType.FULL_EDIT;

            // Guard: FULL_EDIT requires explicit approval
            if (isFullEdit && !approved) {
                result.error = 'FULL_EDIT preset requires user approval';
                return result;
            }

            const commandSequence = preset.command_sequence || preset.commandSequence;

            // Non-FULL_EDIT presets have settings only (no commandSequence)
            if (!commandSequence || commandSequence.length === 0) {
                // Settings-only preset — caller applies directly (no pipeline dispatch)
                result.success = true;
                result.executed.push('settings_applied');
                this._logUsage(userId, preset.id, projectId, true);
                return result;
            }

            // Sort commands by order
            const commands = [...commandSequence].sort((a, b) => a.order - b.order);

            for (const cmd of commands) {
                try {
                    if (pipelineAdapter) {
                        await pipelineAdapter.executeCommand(cmd.action, cmd.args, projectId, userId);
                    }
                    result.executed.push(cmd.label || cmd.action);
                } catch (cmdErr) {
                    if (cmd.skipIfFailed) {
                        console.warn(`[PresetExecutor] Skipping failed command "${cmd.label}":`, cmdErr.message);
                        result.skipped.push(cmd.label || cmd.action);
                    } else {
                        result.error = `Command "${cmd.label}" failed: ${cmdErr.message}`;
                        this._logUsage(userId, preset.id, projectId, false);
                        return result;
                    }
                }
            }

            result.success = true;
            this._logUsage(userId, preset.id, projectId, true);
            return result;

        } catch (err) {
            console.error('[PresetExecutor.execute]', err.message);
            result.error = err.message;
            return result;
        }
    }

    /**
     * Fetch a preset by its UUID from the DB.
     * @private
     */
    async _getPresetById(presetId) {
        try {
            const { data, error } = await supabaseAdmin
                .from('assets')
                .select('*, presets (*)')
                .eq('id', presetId)
                .single();

            if (error || !data) return null;

            const preset = Array.isArray(data.presets) ? data.presets[0] : data.presets;
            return { ...data, ...(preset || {}) };
        } catch (err) {
            console.error('[PresetExecutor._getPresetById]', err.message);
            return null;
        }
    }

    /**
     * Log preset usage — fire-and-forget.
     * @private
     */
    _logUsage(userId, assetId, projectId, accepted) {
        if (!userId || !assetId) return;
        supabaseAdmin
            .from('asset_usage_log')
            .insert({
                user_id:    userId,
                asset_id:   assetId,
                project_id: projectId,
                accepted,
                event_type: 'preset_applied',
            })
            .then(() => {})
            .catch(err => {
                console.warn('[PresetExecutor._logUsage] non-fatal:', err.message);
            });
    }
}

// Singleton
const presetExecutor = new PresetExecutor();
module.exports = { PresetExecutor, presetExecutor };
