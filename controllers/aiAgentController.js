const OpenAI = require('openai');
const SpacyService = require('../services/SpacyService');

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
}) : null;

const chatAgentHandler = async (req, res) => {
    try {
        const { command, context } = req.body; // context includes filename, duration, etc.

        if (!openai) {
            // Mock Fallback if no key
            console.warn("⚠️ No OpenAI Key. Using Mock Agent.");
            return res.json({
                success: true,
                message: "Mock Agent Response (No API Key)",
                actions: mockParse(command)
            });
        }

        const systemPrompt = `You are an expert AI Video Editor Agent. 
Your goal is to parse user commands into structured JSON actions that the video editor engine can execute.

AVAILABLE ACTIONS:
1. "silence_removal" -> Remove silent parts.
2. "set_aspect_ratio" -> Params: ratio ("16:9", "9:16", "1:1").
3. "cut_clip" -> Params: clipId, time, trackId.
4. "remove_clip" -> Params: clipId, trackId.
5. "move_clip" -> Params: clipId, trackId, newStart.
6. "set_clip_speed" -> Params: clipId, trackId, speed.
7. "color_grade_clip" -> Params: clipId, trackId, preset (cinematic, vibrant, bw, warm, cool).
8. "denoise_audio" -> Clean audio.
9. "normalize_audio" -> Fix volume levels.
10. "sync_clips_to_beat" -> Sync cuts to music beats.
11. "set_track_volume" -> Params: trackId, volume.
12. "mute_track" -> Params: trackId, muted (boolean).
13. "seek_to" -> Params: time.
14. "undo_action" -> Undo last.
15. "add_text_overlay" -> Params: text, start, duration.

OUTPUT FORMAT:
Return a JSON object with:
- "message": A friendly response to the user.
- "actions": An integer array of action objects. Example:
[
  { "type": "set_aspect_ratio", "params": { "ratio": "9:16" } },
  { "type": "set_clip_speed", "params": { "clipId": "clip-1", "trackId": "video-1", "speed": 2.0 } }
]

Keep responses concise. If the command is unclear, return an empty actions array and ask for clarification in "message".`;

        const userPrompt = `Context: ${JSON.stringify(context || {})}
User Command: "${command}"`;

        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            model: "gpt-4-1106-preview",
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(completion.choices[0].message.content);

        res.json({
            success: true,
            message: result.message,
            actions: result.actions || []
        });

    } catch (error) {
        console.error("❌ Agent Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Simple Mock Parser for fallback
function mockParse(cmd) {
    cmd = cmd.toLowerCase();
    const actions = [];
    if (cmd.includes('silence')) actions.push({ type: 'silence_removal', params: {} });
    if (cmd.includes('vertical')) actions.push({ type: 'set_aspect_ratio', params: { ratio: '9:16' } });
    if (cmd.includes('horizontal')) actions.push({ type: 'set_aspect_ratio', params: { ratio: '16:9' } });
    if (cmd.includes('square')) actions.push({ type: 'set_aspect_ratio', params: { ratio: '1:1' } });
    if (cmd.includes('cinematic')) actions.push({ type: 'color_grade', params: { preset: 'cinematic' } });
    return actions;
}

/**
 * Parse Intent Handler (NEW)
 * Parses user prompt into strict JSON intent.
 * NO natural language output - only structured data.
 */
const parseIntentHandler = async (req, res) => {
    try {
        const { prompt, context } = req.body;
        console.log("📝 [CRL] Parsing intent:", prompt);

        // ── spaCy Pre-Analysis ──────────────────────────────────────
        const videoDuration = context?.MediaMetadata?.sourceDuration || null;
        const spacyAnalysis = await SpacyService.analyzePrompt(prompt, videoDuration);

        if (spacyAnalysis) {
            console.log(`🔬 [SpaCy] Clarity: ${spacyAnalysis.clarity_score}`);

            // Timeline exceeds video duration → block execution
            if (spacyAnalysis.timeline_error) {
                return res.json({
                    intent: 'clarification_required',
                    message: spacyAnalysis.message,
                    timeline_error: true,
                    video_duration: spacyAnalysis.video_duration,
                });
            }

            // Low clarity → return clarification questions to frontend
            if (spacyAnalysis.needs_clarification) {
                return res.json({
                    intent: 'clarification_required',
                    message: 'I need a bit more detail to proceed accurately.',
                    spacy_analysis: spacyAnalysis,
                    questions: spacyAnalysis.clarification_questions.map((q, i) => ({
                        question: q,
                        parameter: `clarify_${i}`,
                        type: 'text',
                    })),
                });
            }
        }
        // ── End spaCy Pre-Analysis ──────────────────────────────────

        if (!openai) {
            console.warn("⚠️ No OpenAI Key. Using local intent parser.");
            return res.json(localParseIntent(prompt, context));
        }

        const systemPrompt = `You are the Conversational Reasoning Layer of Viral Pilot, an AI-powered video editing IDE.
You are NOT a generic chatbot. You are an AI video editor.
You transform user prompts into structured, executable editing intent — safely and deterministically.

You are NOT the executor.
You MUST NOT generate FFmpeg commands or timeline operations.
You only interpret, clarify, and structure intent.

═══════════════════════════════════════════════════
🔎 GROUNDING RULES (NON-NEGOTIABLE)
═══════════════════════════════════════════════════

Before responding, you MUST read the injected context:
- Read MediaMetadata.sourceDuration
- Read TimelineState.totalTimelineDuration
- Read TimelineState.selectedClipDuration
- Detect editing mode from ProjectContext.editingMode
- Detect if the request is logically possible

If ANY duration mismatch is detected (sourceDuration >> timelineDuration, or vice versa, or unit inconsistency), you MUST say:
"There appears to be a duration mismatch between the source media and the timeline. I need clarification before proceeding."

═══════════════════════════════════════════════════
🎬 EDITING MODE AWARENESS
═══════════════════════════════════════════════════

The context includes editingMode = "CREATION" | "REPURPOSE".
- CREATION: Single long raw clip, no cuts, no structure. Goal: build a new edit.
- REPURPOSE: Multiple clips arranged, existing structure. Goal: adapt existing edit.
Your suggestions MUST differ based on mode.

═══════════════════════════════════════════════════
⏱ DURATION LOGIC RULES
═══════════════════════════════════════════════════

You MUST obey strict temporal logic:
- You CANNOT trim a clip to a duration LONGER than its current length.
- You CANNOT extend a clip without explicitly stating how (loop, slow motion, additional footage).
- You MUST distinguish: sourceDuration vs timelineDuration vs selectedClipDuration.
- If user says "Trim to 60 seconds" and selectedClipDuration < 60, respond:
  "The selected clip is currently X seconds long, so it cannot be trimmed to 60 seconds. Would you like to extend it or select a different segment?"
- All durations are in SECONDS internally. Flag suspicious values.

═══════════════════════════════════════════════════
🧠 CONTEXTUAL INTELLIGENCE
═══════════════════════════════════════════════════

Use MediaMetadata semantically:
- clipType (talking_head, broll, podcast, generic_video)
- transcriptSummary (actual words spoken)
- energyProfile (high_energy, mixed, calm, unknown)
- aspectRatio, hasTranscript, hasBeatMarkers

If user says "Create a TikTok from this clip" and source is > 3 minutes:
- Propose extracting best 45-60 sec segment
- Mention vertical reframing (9:16)
- Mention captions if speech detected
- Mention hook optimization
Do NOT ask irrelevant duration math questions.

═══════════════════════════════════════════════════
❓ CLARIFICATION RULES
═══════════════════════════════════════════════════

- Ask bounded, specific questions with numbered options
- Reference what the user already said
- NEVER ask illogical questions (e.g. "extend to 60s?" when clip is 10 minutes)
- Maximum 2-3 clarification rounds
- Reference actual durations and clip counts from the context

═══════════════════════════════════════════════════
📋 STRUCTURED INTENT STATE
═══════════════════════════════════════════════════

{
  "goal": "string describing creative goal",
  "platform": "tiktok" | "youtube_shorts" | "youtube" | "instagram" | null,
  "targetDuration": "string or null",
  "strategies": ["array of editing strategies"] | null,
  "style": "fast_paced" | "cinematic" | "clean" | "energetic" | null,
  "audience": "string or null",
  "missingParameters": ["array of missing param names"],
  "confidence": "LOW" | "MEDIUM" | "HIGH"
}

Never mark confidence HIGH unless execution would be deterministic and missingParameters is empty.

═══════════════════════════════════════════════════
📤 OUTPUT FORMAT
═══════════════════════════════════════════════════

When still clarifying (confidence not HIGH):
{
  "type": "CLARIFICATION",
  "message": "Conversational follow-up question here (referencing actual media state)",
  "intentDraft": { ...current structured intent state... }
}

When intent is complete and safe:
{
  "type": "READY",
  "intent": { ...fully structured intent with all fields populated... }
}

DIRECT EDITING COMMANDS — parse them directly:

OPERATIONS:
- split_clip: Split a clip. Params: { mode: "midpoint" | "playhead" | "timestamp", timestamp?: number }
- remove_clip: Delete a clip
- trim_clip: Trim a clip. Params: { trimFrom: "start" | "end", amount: number }
- set_clip_speed: Change playback speed. Params: { speed: number }
- set_aspect_ratio: Change canvas ratio. Params: { ratio: "16:9" | "9:16" | "1:1" }
- silence_removal: Remove silent parts. Params: { threshold: string }
- export_video: Export. Params: { format: string, quality: string }
- undo_action: Undo last action

For direct commands with valid duration logic, return:
{
  "type": "READY",
  "intent": {
    "intent": "edit",
    "operation": "operation_name",
    "target_clip_id": "clip_id or null",
    "target_track_id": "track_id or null",
    "parameters": { ... },
    "confidence": "HIGH",
    "missingParameters": []
  }
}

TONE: Professional, calm, helpful, concise. No jargon, no overconfidence.
STRICT: Never generate FFmpeg commands. Never modify timeline state. Never skip clarification for destructive edits. Never assume durations.
Your job is to converge toward execution grounded in real media state.
Output ONLY valid JSON. Include the word "json" in your response.`;

        // Attach spaCy analysis to the context for better LLM grounding
        const enrichedContext = {
            ...context,
            spacyAnalysis: spacyAnalysis || undefined,
        };

        const userMessage = `STRUCTURED CONTEXT:
${JSON.stringify(enrichedContext || {}, null, 2)}

USER REQUEST:
"${prompt}"`;


        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            model: "gpt-4-1106-preview",
            response_format: { type: "json_object" },
            temperature: 0.15
        }, { timeout: 15000 }); // 15s strict timeout to trigger fallback fast on network errors

        const raw = JSON.parse(completion.choices[0].message.content);
        console.log("✅ [CRL] Raw response:", raw);

        // Normalize CRL envelope to existing pipeline format
        if (raw.type === 'CLARIFICATION') {
            return res.json({
                intent: 'clarification_required',
                message: raw.message,
                intentDraft: raw.intentDraft || null
            });
        }

        if (raw.type === 'READY' && raw.intent) {
            return res.json(raw.intent);
        }

        // Legacy fallback: if the model returns flat intent (no envelope)
        res.json(raw);

    } catch (error) {
        console.error("❌ [CRL] Parse Intent Error:", error);

        try {
            const localResult = localParseIntent(req.body.prompt, req.body.context);
            return res.json(localResult);
        } catch (e) {
            res.status(500).json({
                intent: 'clarification_required',
                message: 'Failed to parse your request. Please try again.'
            });
        }
    }
};

/**
 * Local intent parser fallback
 */
function localParseIntent(prompt, context) {
    const cmd = (prompt || '').toLowerCase().trim();
    const clips = context?.clips || [];
    const activeClip = clips.find(c => c.isActive) || clips[0];

    // Split detection
    if (cmd.includes('split') || cmd.includes('cut in ')) {
        let mode = 'midpoint';
        if (cmd.includes('half') || cmd.includes('middle') || cmd.includes('in 2')) {
            mode = 'midpoint';
        } else if (cmd.includes('playhead') || cmd.includes('current')) {
            mode = 'playhead';
        }

        return {
            intent: 'edit',
            operation: 'split_clip',
            target_clip_id: activeClip?.id || null,
            target_track_id: activeClip?.trackId || null,
            parameters: { mode }
        };
    }

    // Remove detection
    if (cmd.includes('remove') || cmd.includes('delete')) {
        return {
            intent: 'edit',
            operation: 'remove_clip',
            target_clip_id: activeClip?.id || null,
            target_track_id: activeClip?.trackId || null,
            parameters: {}
        };
    }

    // Speed detection
    if (cmd.includes('speed') || cmd.includes('faster') || cmd.includes('slower')) {
        let speed = 1.0;
        if (cmd.includes('2x') || cmd.includes('double')) speed = 2.0;
        else if (cmd.includes('0.5') || cmd.includes('half')) speed = 0.5;
        else if (cmd.includes('1.5')) speed = 1.5;

        return {
            intent: 'edit',
            operation: 'set_clip_speed',
            target_clip_id: activeClip?.id || null,
            target_track_id: activeClip?.trackId || null,
            parameters: { speed }
        };
    }

    // Aspect ratio
    if (cmd.includes('vertical') || cmd.includes('9:16') || cmd.includes('tiktok')) {
        return { intent: 'edit', operation: 'set_aspect_ratio', parameters: { ratio: '9:16' } };
    }
    if (cmd.includes('horizontal') || cmd.includes('16:9') || cmd.includes('youtube')) {
        return { intent: 'edit', operation: 'set_aspect_ratio', parameters: { ratio: '16:9' } };
    }
    if (cmd.includes('square') || cmd.includes('1:1')) {
        return { intent: 'edit', operation: 'set_aspect_ratio', parameters: { ratio: '1:1' } };
    }

    // Undo
    if (cmd.includes('undo')) {
        return { intent: 'edit', operation: 'undo_action', parameters: {} };
    }

    // Silence
    if (cmd.includes('silence')) {
        return { intent: 'edit', operation: 'silence_removal', parameters: { threshold: '-30dB' } };
    }

    return {
        intent: 'clarification_required',
        message: `I didn't understand "${prompt}". Try: "split the clip in 2", "remove this clip", or "make it vertical".`
    };
}

/**
 * Generate Plan Handler (NEW)
 * Converts parsed intent into an ordered edit plan.
 */
const generatePlanHandler = async (req, res) => {
    try {
        const { intent, context } = req.body;
        console.log("📋 Generating plan for:", intent?.operation);

        const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        // For simple operations, generate plan locally
        const localPlan = generateLocalPlan(intent, context, planId);
        if (localPlan) {
            console.log("✅ Generated local plan:", planId);
            return res.json({ success: true, plan: localPlan });
        }

        if (!openai) {
            return res.status(400).json({
                success: false,
                error: 'Cannot generate plan: Operation not supported locally and no API key'
            });
        }

        // Complex operations - use LLM
        const systemPrompt = `You are an Edit Planner for a video editing system.
Convert the parsed intent into an ordered sequence of execution steps.
DO NOT execute anything - only generate the plan.

OUTPUT FORMAT:
{
  "plan_id": "${planId}",
  "steps": [
    { "step_id": "step_1", "action": "action_name", ...params }
  ]
}

Keep steps atomic and ordered. Include all necessary parameters.`;

        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify({ intent, context }) }
            ],
            model: "gpt-3.5-turbo-1106",
            response_format: { type: "json_object" },
            temperature: 0.1
        });

        const result = JSON.parse(completion.choices[0].message.content);
        result.plan_id = planId; // Ensure plan_id is set

        console.log("✅ Generated plan:", planId);
        res.json({ success: true, plan: result });

    } catch (error) {
        console.error("❌ Generate Plan Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Generate plan locally for simple operations
 */
function generateLocalPlan(intent, context, planId) {
    if (!intent || !intent.operation) return null;

    const operation = intent.operation;
    const clipId = intent.target_clip_id;
    const trackId = intent.target_track_id;
    const params = intent.parameters || {};

    // Get clip info from context if available
    const clips = context?.clips || [];
    const clip = clips.find(c => c.id === clipId);

    let steps = [];

    switch (operation) {
        case 'split_clip': {
            let splitTime;
            if (params.mode === 'midpoint' && clip) {
                splitTime = clip.start + (clip.duration / 2);
            } else if (params.mode === 'playhead') {
                splitTime = context?.currentTime || 0;
            } else if (params.timestamp) {
                splitTime = params.timestamp;
            } else if (clip) {
                splitTime = clip.start + (clip.duration / 2);
            }

            steps = [
                { step_id: 'calc', action: 'calculate_split_point', clip_id: clipId, track_id: trackId },
                { step_id: 'split', action: 'split_clip', clip_id: clipId, track_id: trackId, timestamp: splitTime }
            ];
            break;
        }

        case 'remove_clip':
            steps = [{ step_id: 'remove', action: 'remove_clip', clip_id: clipId, track_id: trackId }];
            break;

        case 'set_clip_speed':
            steps = [{ step_id: 'speed', action: 'set_clip_speed', clip_id: clipId, track_id: trackId, speed: params.speed }];
            break;

        case 'set_aspect_ratio':
            steps = [{ step_id: 'aspect', action: 'set_aspect_ratio', ratio: params.ratio }];
            break;

        case 'silence_removal':
            steps = [{ step_id: 'silence', action: 'silence_removal', threshold: params.threshold }];
            break;

        case 'undo_action':
            steps = [{ step_id: 'undo', action: 'undo_action' }];
            break;

        default:
            return null;
    }

    return {
        plan_id: planId,
        intent_operation: operation,
        steps
    };
}

const agentPlanHandler = async (req, res) => {
    try {
        const { prompt, context, tools } = req.body;

        if (!openai) {
            // Mock Fallback
            console.warn("⚠️ No OpenAI Key. Using Mock Plan.");
            return res.json({
                actions: [],
                message: "Mock Agent: API Key missing. Cannot generate plan."
            });
        }

        const systemPrompt = `You are an Autonomous Video Editor Agent. 
You will receive a description of the current timeline (Context) and a User Prompt.
You have access to a set of TOOLS.

GOAL:
Generate a PLAN (sequence of actions) to fulfill the User Prompt.

RULES:
1. ONLY use the tools provided in the tool definitions.
2. If the user asks for something impossible, return an empty action list.
3. Be precise with timestamps.
4. Return a JSON object with:
   - "thought": Your reasoning.
   - "actions": Array of tool calls. Each call has "name" (tool name) and "args" (parameters).

TOOLS DEFINITIONS:
${JSON.stringify(tools, null, 2)}`;

        const userMsg = `CONTEXT:
${context}

USER PROMPT:
"${prompt}"`;

        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMsg }
            ],
            model: "gpt-3.5-turbo-1106",
            response_format: { type: "json_object" },
            temperature: 0.2 // Low temperature for precision
        }, { timeout: 15000 });

        const result = JSON.parse(completion.choices[0].message.content);

        res.json(result);

    } catch (error) {
        console.error("❌ Agent Plan Error:", error);

        // Fallback to Mock if API Key is invalid or quota exceeded
        if (error.code === 'invalid_api_key' || error.code === 'insufficient_quota' || error.status === 429) {
            console.warn("⚠️ OpenAI API Issue. Falling back to Mock Plan.");
            res.json({
                message: "Agent (Offline Mode): API Key invalid or quota exceeded.",
                actions: [],
                thought: "API Call failed."
            });
            return;
        }

        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    chatAgentHandler,
    agentPlanHandler,
    parseIntentHandler,
    generatePlanHandler
};

