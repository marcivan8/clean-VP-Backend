/**
 * server/brain/PatternLearner.js
 *
 * Observes editing sessions and infers what the user should do next.
 * All persistence is fire-and-forget — observe() is always synchronous
 * from the caller's perspective.
 *
 * SAFETY CONTRACT:
 * - observe() must NEVER throw
 * - persistAsync() must NEVER propagate errors to the caller
 * - inferNextSuggestions() is pure and synchronous
 */

'use strict';

const { supabaseAdmin } = require('../../config/database');
const { UserProfileEngine } = require('./UserProfileEngine');
const { getPlatform } = require('./PlatformKnowledge');

class PatternLearner {

    constructor() {
        this.profileEngine = new UserProfileEngine();
    }

    /**
     * Observe the result of a brain cycle and kick off async learning.
     * Returns next suggestions SYNCHRONOUSLY (no await).
     *
     * @param {import('./types').BrainInput}   input
     * @param {import('./types').BrainOutput}  brainOutput
     * @param {import('./types').EngineResult|null} engineResult
     * @param {import('./Session').EditingSession} session
     * @returns {import('./types').BrainObservation}
     */
    observe(input, brainOutput, engineResult, session) {
        // Fire-and-forget — intentionally NOT awaited
        this.persistAsync(input, brainOutput, engineResult, session);

        const context = (input && input.context && input.context.builtContext) || {};
        const profile = (input && input.context && input.context.profile) || { permanently_hidden: [] };

        const nextSuggestions = this.inferNextSuggestions(context, engineResult, session, profile);

        return { nextSuggestions };
    }

    /**
     * Persist the session event and update the user profile.
     * Wrapped in try/catch — NEVER throws to caller.
     *
     * @param {import('./types').BrainInput}   input
     * @param {import('./types').BrainOutput}  brainOutput
     * @param {import('./types').EngineResult|null} engineResult
     * @param {import('./Session').EditingSession} session
     */
    async persistAsync(input, brainOutput, engineResult, session) {
        try {
            const userId    = input?.userId;
            const projectId = input?.context?.projectId || input?.context?.timeline?.projectId;
            const sessionId = session?.id;

            if (!userId) return;

            // Insert editing session log row
            await supabaseAdmin
                .from('editing_sessions')
                .insert({
                    user_id:          userId,
                    project_id:       projectId || null,
                    session_id:       sessionId || 'unknown',
                    trigger:          input?.trigger || null,
                    raw_input:        input?.rawInput || null,
                    resolved_command: brainOutput?.intent?.command || null,
                    executed:         engineResult?.success === true,
                    platform:         input?.context?.platform || null,
                    content_type:     input?.context?.builtContext?.contentType || null,
                });

            // Update user profile if command was executed successfully
            if (engineResult?.success && brainOutput?.intent?.command) {
                // Fire-and-forget inside fire-and-forget — still safe
                this.profileEngine
                    .updateFromCommand(userId, brainOutput.intent.command, true)
                    .catch(err => console.error('[PatternLearner] profile update error:', err.message));
            }

        } catch (err) {
            // MUST NOT throw — only log
            console.error('[PatternLearner] persistAsync error:', err.message);
        }
    }

    /**
     * Record user feedback on a suggestion chip (accept or dismiss).
     * Permanently hides a suggestion after 3 rejections.
     * Always returns { ok: true } — never throws.
     *
     * @param {string}  userId
     * @param {string}  suggestionType
     * @param {boolean} accepted
     * @param {string}  sessionId
     * @returns {Promise<{ ok: true }>}
     */
    async recordFeedback(userId, suggestionType, accepted, sessionId) {
        try {
            await supabaseAdmin
                .from('suggestion_feedback')
                .insert({
                    user_id:         userId,
                    session_id:      sessionId || 'unknown',
                    suggestion_type: suggestionType,
                    accepted,
                });

            if (!accepted) {
                const rejections = await this.profileEngine.getRejectionCount(userId, suggestionType);
                if (rejections >= 3) {
                    await this.profileEngine.permanentlyHide(userId, suggestionType);
                    console.log(`[PatternLearner] Permanently hidden "${suggestionType}" for user ${userId} after ${rejections} rejections`);
                }
            }
        } catch (err) {
            // Never throw — feedback loss is acceptable
            console.error('[PatternLearner] recordFeedback error:', err.message);
        }

        return { ok: true };
    }

    /**
     * Infer what the user should do next based on what they just did.
     * Pure, synchronous, and safe.
     *
     * @param {Object} context      - Built context from ContextEngine
     * @param {import('./types').EngineResult|null} engineResult
     * @param {import('./Session').EditingSession} session
     * @param {import('./types').UserProfile} profile
     * @returns {import('./types').Suggestion[]}
     */
    inferNextSuggestions(context, engineResult, session, profile) {
        if (!session) return [];

        const commandsRun = session.commandsRun || [];
        const shown = session.shownSuggestions || new Set();
        const hidden = Array.isArray(profile?.permanently_hidden) ? profile.permanently_hidden : [];

        const hasCaptions   = context.hasCaptions || false;
        const hasMusic      = context.hasMusic || false;
        const aspectRatio   = context.aspectRatio || null;
        const duration      = context.duration || 0;
        const completionScore = context.completionScore || 0;
        const platform      = context.platform || null;
        const platformSpec  = getPlatform(platform);

        const suggestions = [];

        const add = (type, text, command, reason, priority) => {
            if (suggestions.some(s => s.type === type)) return; // no dupes
            if (shown.has(type)) return;
            if (hidden.includes(type)) return;
            suggestions.push({ type, text, command, reason, priority });
        };

        // Rule 1: After remove_silence → suggest generate_captions
        const didRemoveSilence = commandsRun.some(c =>
            String(c).toLowerCase().includes('silence')
        );
        if (didRemoveSilence && !hasCaptions) {
            add(
                'generate_captions',
                'Add captions',
                'generate_captions',
                'Captions are the single highest-impact edit for retention and accessibility.',
                'high'
            );
        }

        // Rule 2: After generate_captions → suggest apply_smart_zoom
        const didAddCaptions = commandsRun.some(c =>
            String(c).toLowerCase().includes('caption')
        );
        const didZoom = commandsRun.some(c =>
            String(c).toLowerCase().includes('zoom')
        );
        if ((didAddCaptions || hasCaptions) && !didZoom) {
            add(
                'apply_smart_zoom',
                'Smart zoom',
                'apply_smart_zoom',
                'Ken Burns-style zoom keeps static talking-head shots engaging.',
                'medium'
            );
        }

        // Rule 3: After zoom, if completionScore > 70 → suggest export
        const didExport = commandsRun.some(c =>
            String(c).toLowerCase().includes('export')
        );
        if ((didAddCaptions || hasCaptions) && (didZoom) && completionScore > 70 && !didExport) {
            add(
                'export_video',
                'Export video',
                'export_video',
                `Your project looks ready (${completionScore}% complete).`,
                'high'
            );
        }

        // Rule 4: TikTok but wrong aspect ratio
        if (platform === 'tiktok' && aspectRatio && aspectRatio !== '9:16') {
            add(
                'convert_vertical',
                'Convert to vertical',
                'set_aspect_ratio 9:16',
                'TikTok requires 9:16 vertical format.',
                'critical'
            );
        }

        // Rule 5: Duration exceeds platform max
        if (platformSpec && duration > platformSpec.idealDuration.max) {
            add(
                'trim_to_platform',
                `Trim for ${platformSpec.name}`,
                `trim_to_duration ${platformSpec.idealDuration.max}`,
                `Content is ${Math.round(duration / 60)}m — ideal max for ${platformSpec.name} is ${Math.round(platformSpec.idealDuration.max / 60)}m.`,
                'high'
            );
        }

        // Rule 6: No LUT applied and project has meaningful completion — suggest color grade
        const hasColorGrade = context.hasColorGrade || false;
        if (!hasColorGrade && completionScore > 60 && !shown.has('recommend_luts')) {
            add(
                'recommend_luts',
                'Add a color grade',
                'recommend_luts',
                'No color grade applied — a LUT can significantly elevate the look.',
                'medium'
            );
        }

        // Rule 7: Hard cuts present but no SFX — suggest search_sfx
        const hasSFX  = context.hasSFX || false;
        const cutRate = context.cutRate || 0;
        if (!hasSFX && cutRate > 1 && !shown.has('search_sfx')) {
            add(
                'search_sfx',
                'Add SFX to cuts',
                'search_sfx "impact cut"',
                'High cut rate detected — SFX at hard cuts improves energy.',
                'medium'
            );
        }

        // Rule 8: Very high completion, no color grade → escalate to high priority
        if (completionScore > 85 && !hasColorGrade && !shown.has('recommend_luts_final')) {
            add(
                'recommend_luts_final',
                'Color grade before export',
                'recommend_luts',
                'Project is nearly export-ready — color grade is the last step.',
                'high'
            );
        }

        // Mark all returned suggestions as shown
        for (const s of suggestions) {
            session.markSuggestionShown(s.type);
        }

        return suggestions.slice(0, 4);
    }
}

module.exports = { PatternLearner };
