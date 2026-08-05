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

            const nextCommands = { ...currentCommands, [cmd]: count };

            const updates = {
                common_commands: nextCommands,
                // inferSkillLevel() existed with ZERO callers, so every profile sat
                // at the default 'beginner' forever no matter how advanced the
                // user's actual usage was — the field was written once at row
                // creation and never again. Recomputing it here, from the full
                // accumulated command vocabulary (not just the one command that
                // triggered this write), is what makes it mean anything. Derived
                // rather than stored-incrementally so a corrected/extended keyword
                // list in inferSkillLevel applies retroactively on the next write.
                skill_level: this.inferSkillLevel(Object.keys(nextCommands)),
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
     * Accepts EITHER registry operation ids (`silence_removal`, `color_grade` —
     * what the real pipeline emits via /observe-command) OR human phrasings
     * ("remove silence"). Both are normalised to space-separated words first.
     *
     * THE TRAP THIS AVOIDS: the keyword lists were originally written only in
     * human phrasing ('color grade', 'remove silence') and compared with
     * `String.includes` against whatever it was given. Fed the actual command
     * ids from `client/src/agent/CommandRegistry.js`, almost nothing matched —
     * `'color_grade'.includes('color grade')` is false on the underscore alone,
     * so the single most clearly-advanced command scored as not-advanced, and
     * `silence_removal` matched no beginner keyword either, which made the
     * `allBeginner` check fail and classified a pure beginner as
     * 'intermediate'. Normalising separators is what makes both vocabularies
     * comparable; keep it if you extend these lists.
     *
     * @param {string[]} commandHistory
     * @returns {'beginner'|'intermediate'|'advanced'}
     */
    inferSkillLevel(commandHistory) {
        if (!Array.isArray(commandHistory) || commandHistory.length === 0) return 'beginner';

        // Underscores/hyphens → spaces, so 'color_grade' and 'color grade' both
        // reduce to the same comparable string.
        const normalize = (s) => String(s).toLowerCase().replace(/[_-]+/g, ' ').trim();

        // Keywords are matched against the NORMALISED command, and are written
        // to cover both an operation id and its natural-language equivalent.
        const advanced = [
            'color grade', 'grading', 'lut',
            'multicam', 'angle',
            'keyframe', 'mask',
            'split by speaker', 'detect speaker',
            'rhythm zoom', 'crop clip',
        ];
        const beginnerOnly = [
            'silence removal', 'remove silence',
            'auto captions', 'add captions', 'caption',
            'trim', 'split clip', 'remove clip',
            'export', 'queue export',
            'zoom', 'undo action', 'set aspect ratio',
            'adjust volume',
        ];

        const cmds = commandHistory.map(normalize).filter(Boolean);
        if (cmds.length === 0) return 'beginner';

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
