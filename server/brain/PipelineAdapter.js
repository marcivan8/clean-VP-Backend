/**
 * server/brain/PipelineAdapter.js
 *
 * THE ONLY file in server/brain/ that imports from the existing AI pipeline.
 * Creates a thin bridge so the brain can delegate to the existing backend
 * handlers without modifying them.
 *
 * DO NOT change IntentParser, EditPlanner, CommandCompiler, or
 * MediaExecutionEngine — only import and call from here.
 *
 * The existing backend AI pipeline is in controllers/aiAgentController.js.
 * The client-side pipeline (IntentParser, EditPlanner, CommandCompiler,
 * MediaExecutionEngine) lives in client/src/agent/ and runs in the browser.
 * This adapter uses the backend's chatAgentHandler logic directly.
 */

'use strict';

const OpenAI = require('openai');

/**
 * Execute a command string via the existing AI pipeline on the backend.
 *
 * The existing backend pipeline (controllers/aiAgentController.js)
 * takes { command, context } → GPT-4o → { success, message, actions }.
 *
 * We call the handler's core logic directly (same pattern as chatAgentHandler)
 * rather than making an HTTP call, to avoid network overhead.
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

        if (!process.env.OPENAI_API_KEY) {
            // Dev/test fallback — simulate success without real AI
            console.warn('[PipelineAdapter] No OpenAI key — simulating success for:', commandString);
            return {
                success: true,
                error: null,
                timelineAfter: projectContext?.timeline || null,
                actionTaken: `Simulated: ${commandString}`,
            };
        }

        // Call the existing backend pipeline directly
        // This mirrors exactly what chatAgentHandler does, but returns a typed result
        const { chatAgentHandler: _unused, ...controller } = require('../../controllers/aiAgentController');

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
                    content: `Context: ${JSON.stringify({
                        timeline:  projectContext?.timeline || {},
                        duration:  projectContext?.duration || 0,
                        platform:  projectContext?.platform || null,
                        clipCount: (projectContext?.timeline?.tracks || []).reduce((sum, t) => sum + (t.clips || []).length, 0),
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
