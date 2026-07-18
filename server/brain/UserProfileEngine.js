/**
 * server/brain/UserProfileEngine.js
 *
 * Reads and updates per-user editing profiles from Supabase.
 * All writes are fire-and-forget — never block the main response path.
 * All methods gracefully degrade on DB error, returning safe defaults.
 */

'use strict';

const { supabaseAdmin } = require('../../config/database');

/** @returns {import('./types').UserProfile} */
function defaultProfile(userId) {
    return {
        user_id:                   userId || null,
        avg_cut_rate:              0,
        preferred_pace:            'medium',
        preferred_fonts:           [],
        preferred_platforms:       [],
        accepted_suggestions:      {},
        rejected_suggestions:      {},
        permanently_hidden:        [],
        common_commands:           {},
        skill_level:               'beginner',
        content_type:              'talking_head',
        typically_removes_silences: false,
        typically_adds_captions:   false,
        typically_adds_music:      false,
        updated_at:                new Date().toISOString(),
    };
}

class UserProfileEngine {

    /**
     * Fetch (or create) the editing profile for a user.
     * Never throws — returns defaultProfile on any error.
     *
     * @param {string} userId
     * @returns {Promise<import('./types').UserProfile>}
     */
    async getProfile(userId) {
        if (!userId) return defaultProfile(userId);

        try {
            const { data, error } = await supabaseAdmin
                .from('user_editing_profiles')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error) {
                // PGRST116 = no row found — create one
                if (error.code === 'PGRST116') {
                    return await this._createDefaultProfile(userId);
                }
                console.error('[UserProfileEngine] getProfile error:', error.message);
                return defaultProfile(userId);
            }

            return data || defaultProfile(userId);
        } catch (err) {
            console.error('[UserProfileEngine] getProfile threw:', err.message);
            return defaultProfile(userId);
        }
    }

    /**
     * Insert a default profile row and return it.
     * @private
     */
    async _createDefaultProfile(userId) {
        try {
            const fresh = defaultProfile(userId);
            const { data, error } = await supabaseAdmin
                .from('user_editing_profiles')
                .insert({ user_id: userId })
                .select()
                .single();

            if (error) {
                console.error('[UserProfileEngine] _createDefaultProfile error:', error.message);
                return fresh;
            }
            return data || fresh;
        } catch (err) {
            console.error('[UserProfileEngine] _createDefaultProfile threw:', err.message);
            return defaultProfile(userId);
        }
    }

    /**
     * Update a user's profile based on a command they ran and whether it succeeded.
     * Fire-and-forget — wraps entire body in try/catch, only logs errors.
     *
     * @param {string} userId
     * @param {string} command
     * @param {boolean} accepted - Whether the command produced a positive result
     */
    async updateFromCommand(userId, command, accepted) {
        try {
            if (!userId || !command) return;

            const { data: existing } = await supabaseAdmin
                .from('user_editing_profiles')
                .select('common_commands, typically_removes_silences, typically_adds_captions, typically_adds_music')
                .eq('user_id', userId)
                .single();

            const currentCommands = existing?.common_commands || {};
            const cmd = String(command).toLowerCase();
            const count = (currentCommands[cmd] || 0) + 1;

            const updates = {
                common_commands: { ...currentCommands, [cmd]: count },
                updated_at: new Date().toISOString(),
            };

            // Update pattern flags
            if (cmd.includes('silence') || cmd.includes('silent')) {
                updates.typically_removes_silences = true;
            }
            if (cmd.includes('caption') || cmd.includes('subtitle')) {
                updates.typically_adds_captions = true;
            }
            if (cmd.includes('music') || cmd.includes('audio_track')) {
                updates.typically_adds_music = true;
            }

            await supabaseAdmin
                .from('user_editing_profiles')
                .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' });

        } catch (err) {
            // Fire-and-forget — only log, never throw
            console.error('[UserProfileEngine] updateFromCommand error:', err.message);
        }
    }

    /**
     * Infer skill level from the flat list of commands a user has run.
     *
     * @param {string[]} commandHistory
     * @returns {'beginner'|'intermediate'|'advanced'}
     */
    inferSkillLevel(commandHistory) {
        if (!Array.isArray(commandHistory) || commandHistory.length === 0) return 'beginner';

        const advanced = ['color grade', 'multicam', 'keyframe', 'lut', 'mask', 'grading'];
        const beginnerOnly = ['remove silence', 'add captions', 'trim', 'export', 'zoom'];

        const cmds = commandHistory.map(c => String(c).toLowerCase());

        if (cmds.some(c => advanced.some(kw => c.includes(kw)))) return 'advanced';

        const allBeginner = cmds.every(c =>
            beginnerOnly.some(kw => c.includes(kw))
        );
        if (allBeginner) return 'beginner';

        return 'intermediate';
    }

    /**
     * Count how many times a user has rejected a suggestion type.
     *
     * @param {string} userId
     * @param {string} suggestionType
     * @returns {Promise<number>}
     */
    async getRejectionCount(userId, suggestionType) {
        try {
            const { count, error } = await supabaseAdmin
                .from('suggestion_feedback')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('suggestion_type', suggestionType)
                .eq('accepted', false);

            if (error) {
                console.error('[UserProfileEngine] getRejectionCount error:', error.message);
                return 0;
            }
            return count ?? 0;
        } catch (err) {
            console.error('[UserProfileEngine] getRejectionCount threw:', err.message);
            return 0;
        }
    }

    /**
     * Add a suggestion type to the user's permanently_hidden list.
     * Future brain calls will never surface this suggestion again.
     *
     * @param {string} userId
     * @param {string} suggestionType
     */
    async permanentlyHide(userId, suggestionType) {
        try {
            const { data } = await supabaseAdmin
                .from('user_editing_profiles')
                .select('permanently_hidden')
                .eq('user_id', userId)
                .single();

            const current = (data?.permanently_hidden || []);
            if (current.includes(suggestionType)) return; // already hidden

            await supabaseAdmin
                .from('user_editing_profiles')
                .upsert(
                    {
                        user_id: userId,
                        permanently_hidden: [...current, suggestionType],
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'user_id' }
                );
        } catch (err) {
            console.error('[UserProfileEngine] permanentlyHide error:', err.message);
        }
    }
}

module.exports = { UserProfileEngine, defaultProfile };
