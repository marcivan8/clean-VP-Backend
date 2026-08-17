/**
 * server/brain/PipelineAdapter.js
 *
 * Executes a brain-resolved command when the caller doesn't have a real
 * command handler for it — a lightweight, independent fallback, NOT a call
 * into controllers/aiAgentController.js's chatAgentHandler.
 *
 * CORRECTION (found auditing "the other intelligences"): the header here used
 * to claim "this adapter uses the backend's chatAgentHandler logic directly"
 * and destructured `{ chatAgentHandler: _unused, ...controller }` from that
 * controller — but `controller` was never referenced anywhere below. It
 * doesn't call chatAgentHandler or anything else in that file; it runs its
 * own separate GPT-4o call against a hardcoded, independently-maintained
 * 18-action system prompt. That's a real drift hazard (the two action lists
 * have no compile-time link — the same class of hazard documented for
 * ASSET_ANALYSIS_QUEUE's name in brainRoutes.js), so leaving the comment
 * wrong was worse than leaving it undocumented. A full refactor to actually
 * route through the real controller is a larger, riskier change — out of
 * scope here. This comment is now honest about what the file does; the dead
 * import is removed below.
 *
 * DO NOT change IntentParser, EditPlanner, CommandCompiler, or
 * MediaExecutionEngine — those are the client-side pipeline in
 * client/src/agent/ and run in the browser; this file has never touched them.
 */

'use strict';

const OpenAI = require('openai');

const { getAIClient, isAIConfigured } = require('../../services/AIProvider');
/**
 * Execute a command string via an independent, lightweight GPT-4o call.
 *
 * This is NOT the existing backend pipeline (controllers/aiAgentController.js)
 * — see the file header for why that used to be claimed here and wasn't true.
 * It's a self-contained fallback: { command, context } → GPT-4o → { success,
 * message, actions }, using its own hardcoded action list.
 *
 * @param {string} commandString  - Resolved command from the brain
 * @param {Object} projectContext - Full project context
 * @param {string} userId
 * @returns {Promise<import('./types').EngineResult>}
 */
async function executeAICommand(commandString, projectContext, userId) {
    try {
        if (!commandString) {
            return { success: false, error: 'No command provided', timelineAfter: null, actionTaken: '' };
        }

        if (!isAIConfigured()) {
            // Dev/test fallback — simulate success without real AI
            console.warn('[PipelineAdapter] No OpenAI key — simulating success for:', commandString);
            return {
                success: true,
                error: null,
                timelineAfter: projectContext?.timeline || null,
                actionTaken: `Simulated: ${commandString}`,
            };
        }

        const openai = getAIClient();

        const systemPrompt = `You are an expert AI Video Editor Agent.
Your goal is to parse user commands into structured JSON actions that the video editor engine can execute.

AVAILABLE ACTIONS:
1. "silence_removal" -> Remove silent parts.
2. "remove_filler_words" -> Remove um, ah, and filler words.
3. "set_aspect_ratio" -> Params: ratio ("16:9", "9:16", "1:1").
4. "cut_clip" -> Params: clipId, time, trackId.
5. "remove_clip" -> Params: clipId, trackId.
6. "move_clip" -> Params: clipId, trackId, newStart.
7. "set_clip_speed" -> Params: clipId, trackId, speed.
8. "color_grade_clip" -> Params: clipId, trackId, preset.
9. "denoise_audio" -> Clean audio.
10. "normalize_audio" -> Fix volume levels.
11. "generate_captions" -> Generate captions/subtitles.
12. "apply_smart_zoom" -> Apply Ken Burns zoom effect.
13. "set_track_volume" -> Params: trackId, volume.
14. "mute_track" -> Params: trackId, muted (boolean).
15. "add_text_overlay" -> Params: text, start, duration.
16. "trim_clip" -> Params: clipId, start, end.
17. "export_video" -> Export the project.
18. "remove_silence" -> Alias for silence_removal.

OUTPUT FORMAT — return a JSON object with:
- "message": friendly response to the user
- "actions": array of action objects with "type" and "params"
- "success": boolean

Keep responses concise.`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            temperature: 0.1,
            max_tokens: 600,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    // Previously only timeline/duration/platform/clipCount were
                    // sent — this fallback path had no idea whether captions or
                    // a music track already existed, what was in the media bin,
                    // or what had already been done to the project, so it could
                    // (and did) re-propose or duplicate work the user had
                    // already completed. projectContext here is the SAME
                    // enriched context object the main advisory path builds
                    // (buildProjectState() on the client, or /analyze's
                    // enrichment on the server) — these fields were already
                    // available, just never read.
                    content: `Context: ${JSON.stringify({
                        timeline:      projectContext?.timeline || {},
                        duration:      projectContext?.duration || 0,
                        platform:      projectContext?.platform || null,
                        clipCount:     (projectContext?.timeline?.tracks || []).reduce((sum, t) => sum + (t.clips || []).length, 0),
                        hasCaptions:   !!projectContext?.hasCaptions,
                        hasMusicTrack: !!projectContext?.hasMusicTrack,
                        mediaBin:      (projectContext?.mediaBin || []).map(a => ({
                            name: a.name, type: a.type, analysis_status: a.analysis_status,
                        })),
                        editHistory:   (projectContext?.editHistory || []).slice(-15),
                    })}
Command: "${commandString}"`,
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: 'No response from AI pipeline', timelineAfter: null, actionTaken: commandString };
        }

        const parsed = JSON.parse(raw);

        return {
            success:      parsed.success !== false,
            error:        parsed.success === false ? (parsed.message || 'Command failed') : null,
            timelineAfter: projectContext?.timeline || null,
            actionTaken:  parsed.message || commandString,
            actions:      parsed.actions || [],
        };

    } catch (err) {
        console.error('[PipelineAdapter] executeAICommand error:', err.message);
        return {
            success: false,
            error: err.message,
            timelineAfter: null,
            actionTaken: commandString || '',
        };
    }
}

module.exports = { executeAICommand };
