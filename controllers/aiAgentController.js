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
2. "remove_filler_words" -> Remove um, ah, and filler words.
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
            model: "gpt-4o",
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

DIRECT EDITING COMMANDS — parse them directly. You MUST understand professional video editing jargon.

══════════════════════════════════════════════════
🎬 HIGH-LEVEL / PRODUCTION COMMANDS
══════════════════════════════════════════════════

These commands mean the user wants a FULL EDIT of their video. Map them to operation: "long_form_edit":
- "fully edit this", "edit this clip", "edit my video", "edit this for me"
- "you're a pro editor / act like a pro editor / be a pro editor"
- "make it professional", "make it look professional", "put it together"
- "make it a banger", "make it cinematic", "cinematic edit"
- "make it like MrBeast / Casey Neistat / MKBHD"
- "vlog edit", "documentary style", "film it", "final cut"
- "assemble this", "do a full edit", "complete edit"
→ editMode: infer from platform (TikTok→"CLEAN_EDIT", YouTube→"YOUTUBE_OPTIMIZED", raw rushes→"FULL_BUILD")

══════════════════════════════════════════════════
📱 PLATFORM / FORMAT COMMANDS
══════════════════════════════════════════════════

- "make it vertical / portrait / for TikTok / for Reels / for Instagram" → set_aspect_ratio ratio:"9:16"
- "make it horizontal / landscape / for YouTube / widescreen" → set_aspect_ratio ratio:"16:9"
- "make it square / for Instagram feed" → set_aspect_ratio ratio:"1:1"
- "optimize for YouTube", "YouTube long form", "build a YouTube video" → long_form_edit, editMode:"YOUTUBE_OPTIMIZED"
- "TikTok version / make a TikTok / short form / shorts" → long_form_edit, editMode:"CLEAN_EDIT", targetDuration:60
- "podcast edit / interview edit / clean the podcast / clean the interview / tighten it up" → long_form_edit, editMode:"CLEAN_EDIT", platform:"podcast"

══════════════════════════════════════════════════
✂️ PRO CUTTING JARGON
══════════════════════════════════════════════════

- "J-cut / audio lead / let the audio run first" → add_transition, type:"j_cut"
- "L-cut / audio tail / continue the audio" → add_transition, type:"l_cut"
- "jump cut / YouTube jump cuts / quick cuts / rapid cuts" → silence_removal, style:"jump_cut", threshold:"-25dB"
- "match cut / smash cut" → add_transition, type:"match_cut"
- "cutaway / B-roll / insert shot / reaction shot / overlay footage" → add_clip, clipType:"broll"
- "montage / highlight reel / best moments / compilation / recap" → long_form_edit, editMode:"FULL_BUILD", style:"montage"
- "split / cut / divide / chop" → split_clip
- "trim / shorten / cut the end / cut the beginning" → trim_clip

══════════════════════════════════════════════════
🔊 AUDIO JARGON
══════════════════════════════════════════════════

- "denoise / de-noise / clean audio / remove hiss / background noise / room noise / hum" → audio_denoise
- "normalize / level the audio / fix the volume / balance audio / even out the audio / loudness" → normalize_audio
- "duck the music / audio ducking / lower background music / fade music under voice" → adjust_volume, target:"music_track", volume:0.2
- "sync to beat / beat sync / cut to the beat / edit to the music / match the beat" → sync_clips_to_beat
- "voiceover / narration / add a voice" → add_clip, clipType:"voiceover"
- "remove filler / remove ums / take out the ums / clean up speech" → remove_filler_words
- "remove silences / remove dead air / remove pauses / cut out the pauses" → silence_removal

══════════════════════════════════════════════════
🎨 COLOR / VISUAL JARGON
══════════════════════════════════════════════════

- "color grade / colour grade / grade the footage / apply a LUT" → color_grade
  - "cinematic / moody / dark" → preset:"cinematic"
  - "warm / golden hour / vintage / retro / film grain" → preset:"warm"
  - "cool / cold / blue tone" → preset:"cool"
  - "vibrant / saturated / pop / punchy colors" → preset:"vibrant"
  - "black and white / B&W / desaturate" → preset:"bw"

══════════════════════════════════════════════════
📝 TEXT / GRAPHICS JARGON
══════════════════════════════════════════════════

- "add captions / add subtitles / auto captions / transcribe / closed captions / CC" → auto_captions
- "lower third / name tag / title card / credit" → add_text_overlay, position:"lower_third"
- "add title / add text / overlay text" → add_text_overlay

══════════════════════════════════════════════════
⏱ PACING JARGON
══════════════════════════════════════════════════

- "improve pacing / fix pacing / too slow / snappier / more dynamic / more energy" → long_form_edit, actions:["remove_silences","improve_pacing"]
- "let it breathe / slower pacing / more relaxed / more natural" → set_clip_speed, speed:0.85
- "speed up / faster / time-lapse / timelapse" → set_clip_speed, speed:2.0
- "slow down / slo-mo / slow motion" → set_clip_speed, speed:0.5

══════════════════════════════════════════════════
🔍 ANALYSIS COMMANDS
══════════════════════════════════════════════════

- "analyze / analyse / understand the video / segment / structure / what's in this" → analyze_structure
- "find the hook / best opening / strongest moment / hook me" → find_hook
- "remove repetition / cut out duplicates / it repeats itself" → remove_repetition
- "build from rushes / assemble from raw footage / build from raw" → build_from_rushes

══════════════════════════════════════════════════
📋 STANDARD OPERATIONS
══════════════════════════════════════════════════

OPERATIONS:
- split_clip: Split a clip. Params: { mode: "midpoint" | "playhead" | "timestamp", timestamp?: number }
- remove_clip: Delete a clip
- trim_clip: Trim a clip. Params: { trimFrom: "start" | "end", amount: number }
- set_clip_speed: Change playback speed. Params: { speed: number }
- set_aspect_ratio: Change canvas ratio. Params: { ratio: "16:9" | "9:16" | "1:1" }
- silence_removal: Remove silent parts. Params: { threshold: string }
- remove_filler_words: Remove ums, uhs, and filler words. Params: {}
- audio_denoise: Clean background noise. Params: {}
- normalize_audio: Fix volume levels. Params: {}
- sync_clips_to_beat: Sync to music beats. Params: {}
- color_grade: Apply color look. Params: { preset: "cinematic"|"warm"|"cool"|"vibrant"|"bw" }
- add_text_overlay: Add text. Params: { text, position, duration }
- add_transition: Add a cut transition. Params: { type: "fade"|"dissolve"|"j_cut"|"l_cut"|"match_cut" }
- auto_captions: Generate captions. Params: {}
- adjust_volume: Volume adjustment. Params: { volume: 0.0-1.0, target?: string }
- export_video: Export. Params: { format: string, quality: string }
- undo_action: Undo last action
- long_form_edit: Full video edit. Params: { editMode: "FULL_BUILD"|"CLEAN_EDIT"|"YOUTUBE_OPTIMIZED", platform?, targetDuration? }
- analyze_structure: Analyze content semantically. Params: { platform?, targetDuration? }
- find_hook: Find best hook moment. Params: {}
- remove_repetition: Remove repeated segments. Params: {}
- build_from_rushes: Build video from raw rushes. Params: { platform?, targetDuration? }

For direct commands with valid duration logic, return:
{
  "type": "READY",
  "intent": {
    "intent": "edit" | "apply_effect" | "export" | "analyze" | "long_form_build" | "undo" | "redo",
    "operation": "operation_name",
    "target_clip_id": "clip_id or null",
    "target_track_id": "track_id or null",
    "parameters": { ... },
    "confidence": "HIGH",
    "missingParameters": []
  }
}

TONE: Professional, calm, helpful, concise. Understand creative direction and production language.
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


        const tools = [
            {
                type: "function",
                function: {
                    name: "execute_video_edit",
                    description: "Processes a user's video editing request into a structured intent.",
                    parameters: {
                        type: "object",
                        properties: {
                            type: {
                                type: "string",
                                enum: ["READY", "CLARIFICATION"],
                                description: "Whether the intent is fully understood (READY) or requires follow-up (CLARIFICATION)."
                            },
                            message: {
                                type: "string",
                                description: "Optional friendly response to the user, or the clarification question."
                            },
                            intent: {
                                type: "object",
                                description: "The structured intent object (Required if type is READY)",
                                properties: {
                                    intent: {
                                        type: "string",
                                        enum: ["edit", "cut", "apply_effect", "export", "creative_edit", "optimize", "undo", "redo", "analyze", "long_form_build"]
                                    },
                                    operation: {
                                        type: "string",
                                        enum: [
                                            // Standard editing
                                            "split_clip", "remove_clip", "trim_clip", "set_clip_speed",
                                            "set_aspect_ratio", "silence_removal", "remove_filler_words",
                                            "export_video", "undo_action", "redo_action",
                                            // Transitions & effects
                                            "add_transition", "add_filter", "add_text_overlay",
                                            "color_grade", "adjust_volume", "mute_clip", "add_clip",
                                            // Audio processing
                                            "audio_denoise", "normalize_audio", "sync_clips_to_beat",
                                            "auto_captions",
                                            // Long-form intelligence engine
                                            "long_form_edit", "analyze_structure", "find_hook",
                                            "remove_repetition", "build_from_rushes", "reorder_segment"
                                        ]
                                    },
                                    target_clip_id: { type: ["string", "null"] },
                                    target_track_id: { type: ["string", "null"] },
                                    parameters: {
                                        type: "object",
                                        description: "Action-specific parameters (e.g. { ratio: '9:16' }, { editMode: 'YOUTUBE_OPTIMIZED' }, { preset: 'cinematic' })"
                                    },
                                    confidence: {
                                        type: "string",
                                        enum: ["LOW", "MEDIUM", "HIGH"]
                                    },
                                    missingParameters: {
                                        type: "array",
                                        items: { type: "string" }
                                    }
                                },
                                required: ["intent", "operation", "parameters"]
                            },
                            intentDraft: {
                                type: "object",
                                description: "A draft of the intent when clarifying (Required if type is CLARIFICATION)."
                            }
                        },
                        required: ["type"]
                    }
                }
            }
        ];

        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            model: "gpt-4o",
            tools: tools,
            tool_choice: { type: "function", function: { name: "execute_video_edit" } },
            temperature: 0.15
        }, { timeout: 15000 }); // 15s strict timeout to trigger fallback fast on network errors

        const toolCall = completion.choices[0].message.tool_calls?.[0];
        if (!toolCall) {
            throw new Error("Model failed to call the execute_video_edit function.");
        }

        const raw = JSON.parse(toolCall.function.arguments);
        console.log("✅ [CRL] Structured Function Call response:", raw);

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

        // Fallback catch-all
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
 * Local intent parser fallback — Production-grade jargon engine
 *
 * Handles pro editor vocabulary, high-level commands, platform jargon,
 * and natural language aliases so the AI never says "I don't understand"
 * for a legitimate editing command.
 */
function localParseIntent(prompt, context) {
    try {
        const cmd = (prompt || '').toLowerCase().trim();
        const clips = context?.clips || [];
        const activeClip = clips.find(c => c.isActive) || clips[0];
        const duration = context?.MediaMetadata?.sourceDuration ||
                         context?.TimelineState?.totalTimelineDuration || 0;

        // ── Helper: multi-keyword match ──────────────────────────────────────
        const has = (...words) => words.some(w => cmd.includes(w));

        // ──────────────────────────────────────────────────────────────────────
        // 1. HIGH-LEVEL PRODUCTION COMMANDS
        //    "fully edit this", "you're a pro editor", "edit this clip", etc.
        // ──────────────────────────────────────────────────────────────────────
        const highLevelEditPhrases = [
            'fully edit', 'edit this clip', 'edit the clip', 'edit my clip',
            'edit it', 'edit this video', 'edit my video', 'you\'re a pro editor',
            'you are a pro editor', 'be a pro editor', 'act like a pro editor',
            'act as a pro editor', 'act as an editor', 'edit this for me',
            'edit this professionally', 'make it professional', 'make it look professional',
            'put it together', 'assemble this', 'make it a final cut',
            'final cut', 'do a full edit', 'full edit', 'complete edit',
            'make it cinematic', 'cinematic edit', 'make it a banger',
            'like a movie', 'movie edit', 'cinematic video',
            'make it like mrbeast', 'mrbeast style', 'like casey neistat',
            'neistat style', 'vlog edit', 'documentary style',
        ];
        if (has(...highLevelEditPhrases)) {
            return {
                intent: 'long_form_build',
                operation: 'long_form_edit',
                target_clip_id: activeClip?.id || null,
                target_track_id: activeClip?.trackId || null,
                parameters: {
                    editMode: 'YOUTUBE_OPTIMIZED',
                    platform: has('tiktok', 'reel', 'reels', 'shorts') ? 'tiktok' :
                               has('youtube') ? 'youtube' : null,
                    targetDuration: null,
                    reason: 'High-level edit command — ContentAnalyzer will structure the clip',
                },
                confidence: 'HIGH',
                missingParameters: []
            };
        }

        // ──────────────────────────────────────────────────────────────────────
        // 2. PLATFORM / FORMAT COMMANDS
        // ──────────────────────────────────────────────────────────────────────
        if (has('tiktok', 'make it vertical', 'reels', 'for reels', 'for instagram',
                'make it short', 'short form', 'shorts')) {
            return {
                intent: 'long_form_build',
                operation: 'long_form_edit',
                parameters: {
                    editMode: 'CLEAN_EDIT',
                    platform: has('youtube', 'shorts') ? 'tiktok' : 'tiktok',
                    targetDuration: 60,
                },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('youtube video', 'youtube long', 'long form youtube',
                'optimize for youtube', 'youtube edit', 'build a youtube')) {
            return {
                intent: 'long_form_build',
                operation: 'long_form_edit',
                parameters: { editMode: 'YOUTUBE_OPTIMIZED', platform: 'youtube' },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        // ── "Clean this clip" / "clean up" → combined silence + filler removal ──
        // This is a VERY common generic command that should always resolve to a
        // deterministic editing action — never ask the user for more info.
        if (has('clean this clip', 'clean this video', 'clean the clip',
                'clean the video', 'clean up this clip', 'clean it up',
                'clean it', 'clean up the clip', 'make it clean')) {
            return {
                intent: 'long_form_build',
                operation: 'long_form_edit',
                parameters: {
                    editMode: 'CLEAN_EDIT',
                    actions: ['silence_removal', 'remove_filler_words'],
                    reason: 'Generic "clean" command — removing silences and filler words',
                },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        // ── Compound: "remove silences AND filler words" ──────────────────────
        const wantsSilence = has('silence', 'dead air', 'pauses', 'quiet parts');
        const wantsFiller  = has('filler', 'um', 'uh', 'ums', 'uhs');
        if (wantsSilence && wantsFiller) {
            return {
                intent: 'long_form_build',
                operation: 'long_form_edit',
                parameters: {
                    editMode: 'CLEAN_EDIT',
                    actions: ['silence_removal', 'remove_filler_words'],
                    reason: 'Compound: silence removal + filler word removal',
                },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('podcast', 'interview', 'clean the podcast', 'clean the interview',
                'tighten', 'tighten up', 'clean up the audio')) {
            return {
                intent: 'long_form_build',
                operation: 'long_form_edit',
                parameters: { editMode: 'CLEAN_EDIT', platform: 'podcast' },
                confidence: 'HIGH',
                missingParameters: []
            };
        }

        // ── Basic Editing: Zoom and Cut ──────────────────────────────────────
        if (has('zoom in', 'zoom out', 'zoom')) {
            return {
                intent: 'apply_effect',
                operation: 'apply_zoom',
                parameters: { direction: has('zoom out') ? 'out' : 'in' },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('cut the video', 'make a cut', 'split the video', 'cut it', 'cut this', 'cut at')) {
            return {
                intent: 'edit',
                operation: 'split_clip',
                parameters: { mode: 'playhead' },
                confidence: 'MEDIUM',
                missingParameters: []
            };
        }

        // ──────────────────────────────────────────────────────────────────────
        // 3. PRO CUTTING JARGON
        // ──────────────────────────────────────────────────────────────────────

        // J-cut: audio from next clip starts before the video cuts
        if (has('j-cut', 'j cut', 'audio lead', 'audio first', 'let the audio run')) {
            return {
                intent: 'apply_effect',
                operation: 'add_transition',
                parameters: { type: 'j_cut', reason: 'J-cut: audio precedes video transition' },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        // L-cut: audio from current clip continues over next video
        if (has('l-cut', 'l cut', 'audio tail', 'let the audio breathe', 'continue audio')) {
            return {
                intent: 'apply_effect',
                operation: 'add_transition',
                parameters: { type: 'l_cut', reason: 'L-cut: audio continues over next clip' },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        // Jump cut
        if (has('jump cut', 'jump cuts', 'youtube jump', 'quick cut', 'rapid cut')) {
            return {
                intent: 'edit',
                operation: 'silence_removal',
                parameters: { threshold: '-25dB', min_duration: 0.3, style: 'jump_cut' },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        // Match cut
        if (has('match cut', 'smash cut')) {
            return {
                intent: 'apply_effect',
                operation: 'add_transition',
                parameters: { type: 'match_cut' },
                confidence: 'MEDIUM',
                missingParameters: []
            };
        }
        // Cutaway / B-roll
        if (has('cutaway', 'b-roll', 'b roll', 'broll', 'insert shot', 'reaction shot',
                'overlay footage', 'overlay clip')) {
            return {
                intent: 'edit',
                operation: 'add_clip',
                parameters: { clipType: 'broll', reason: 'B-roll / cutaway insert requested' },
                confidence: 'MEDIUM',
                missingParameters: ['clipSource']
            };
        }
        // Montage
        if (has('montage', 'highlight reel', 'best moments', 'compilation',
                'make a montage', 'recap')) {
            return {
                intent: 'long_form_build',
                operation: 'long_form_edit',
                parameters: {
                    editMode: 'FULL_BUILD',
                    style: 'montage',
                    reason: 'Montage / highlight reel',
                },
                confidence: 'HIGH',
                missingParameters: []
            };
        }

        // ──────────────────────────────────────────────────────────────────────
        // 4. AUDIO / SOUND JARGON
        // ──────────────────────────────────────────────────────────────────────
        if (has('room tone', 'room noise', 'background hiss', 'hiss', 'hum',
                'background noise', 'denoise', 'de-noise', 'clean audio', 'audio cleanup')) {
            return { intent: 'edit', operation: 'audio_denoise', parameters: {}, confidence: 'HIGH', missingParameters: [] };
        }
        if (has('normalize', 'level the audio', 'fix the volume', 'even out',
                'balance audio', 'master volume', 'loudness')) {
            return { intent: 'edit', operation: 'normalize_audio', parameters: {}, confidence: 'HIGH', missingParameters: [] };
        }
        if (has('voice over', 'voiceover', 'narration', 'record a voice')) {
            return {
                intent: 'edit',
                operation: 'add_clip',
                parameters: { clipType: 'voiceover' },
                confidence: 'MEDIUM',
                missingParameters: ['audioSource']
            };
        }
        if (has('duck the music', 'duck music', 'audio ducking', 'lower the music',
                'lower background music', 'fade music under voice')) {
            return {
                intent: 'edit',
                operation: 'adjust_volume',
                parameters: { target: 'music_track', volume: 0.2, reason: 'Ducking music under voice' },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('sync to beat', 'sync to music', 'beat sync', 'cut to the beat',
                'edit to the music', 'match the beat')) {
            return { intent: 'edit', operation: 'sync_clips_to_beat', parameters: {}, confidence: 'HIGH', missingParameters: [] };
        }

        // ──────────────────────────────────────────────────────────────────────
        // 5. PACING / FLOW JARGON
        // ──────────────────────────────────────────────────────────────────────
        if (has('pacing', 'too slow', 'too fast', 'speed up the edit', 'faster edit',
                'tighten the pacing', 'improve pacing', 'fix pacing', 'snappier',
                'punchy', 'more dynamic', 'more energy')) {
            return {
                intent: 'long_form_build',
                operation: 'long_form_edit',
                parameters: {
                    editMode: 'CLEAN_EDIT',
                    actions: ['remove_silences', 'improve_pacing'],
                    reason: 'Pacing improvement requested'
                },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('breathing room', 'let it breathe', 'slow it down', 'more natural',
                'more relaxed', 'slower pacing', 'slow edit')) {
            return {
                intent: 'edit',
                operation: 'set_clip_speed',
                parameters: { speed: 0.85, reason: 'Relaxed pacing requested' },
                confidence: 'MEDIUM',
                missingParameters: []
            };
        }

        // ──────────────────────────────────────────────────────────────────────
        // 6. COLOR / VISUAL JARGON
        // ──────────────────────────────────────────────────────────────────────
        if (has('color grade', 'colour grade', 'grade this', 'grade the footage',
                'color correct', 'colour correct', 'lut', 'apply a lut')) {
            const preset = has('cinematic') ? 'cinematic' :
                           has('warm') ? 'warm' :
                           has('cool', 'cold') ? 'cool' :
                           has('vibrant', 'saturated', 'pop') ? 'vibrant' :
                           has('black and white', 'bw', 'b&w', 'desaturate') ? 'bw' : 'cinematic';
            return {
                intent: 'apply_effect',
                operation: 'color_grade',
                target_clip_id: activeClip?.id || null,
                parameters: { preset },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('moody', 'dark and moody', 'dark mood', 'dark tone')) {
            return {
                intent: 'apply_effect', operation: 'color_grade',
                target_clip_id: activeClip?.id || null,
                parameters: { preset: 'cinematic' }, confidence: 'HIGH', missingParameters: []
            };
        }
        if (has('vintage', 'retro', 'film grain', 'old school', '70s', '80s', '90s')) {
            return {
                intent: 'apply_effect', operation: 'color_grade',
                target_clip_id: activeClip?.id || null,
                parameters: { preset: 'warm', style: 'vintage' }, confidence: 'MEDIUM', missingParameters: []
            };
        }

        // ──────────────────────────────────────────────────────────────────────
        // 7. TEXT / CAPTION JARGON
        // ──────────────────────────────────────────────────────────────────────
        if (has('caption', 'captions', 'auto caption', 'transcribe', 'subtitle', 'subtitles',
                'add subtitles', 'add captions', 'closed captions', 'cc')) {
            return { intent: 'edit', operation: 'auto_captions', parameters: {}, confidence: 'HIGH', missingParameters: [] };
        }
        if (has('lower third', 'name tag', 'title card', 'title text', 'credit')) {
            return {
                intent: 'apply_effect',
                operation: 'add_text_overlay',
                parameters: { position: 'lower_third', style: 'lower_third' },
                confidence: 'MEDIUM',
                missingParameters: ['text']
            };
        }

        // ──────────────────────────────────────────────────────────────────────
        // 8. STANDARD OPERATIONS (kept from original, extended)
        // ──────────────────────────────────────────────────────────────────────
        if (has('split', 'cut in ', 'divide', 'chop')) {
            let mode = 'midpoint';
            if (has('half', 'middle', 'in 2', 'in two')) mode = 'midpoint';
            else if (has('third', 'in 3')) mode = 'thirds';
            else if (has('quarter', 'in 4')) mode = 'quarters';
            else if (has('playhead', 'current', 'here')) mode = 'playhead';
            return {
                intent: 'edit',
                operation: 'split_clip',
                target_clip_id: activeClip?.id || null,
                target_track_id: activeClip?.trackId || null,
                parameters: { mode },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('filler', 'um ', 'uh ', 'remove filler', 'remove ums',
                'take out the ums', 'clean up speech')) {
            return {
                intent: 'edit',
                operation: 'remove_filler_words',
                target_clip_id: activeClip?.id || null,
                parameters: {},
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('remove', 'delete', 'trash', 'get rid of', 'cut out', 'erase', 'drop')) {
            if (has('silence', 'dead air', 'quiet parts', 'gaps')) {
                return {
                    intent: 'edit',
                    operation: 'silence_removal',
                    parameters: { threshold: '-30dB' },
                    confidence: 'HIGH',
                    missingParameters: []
                };
            }
            if (has('repetition', 'repeated', 'duplicate', 'says it twice', 'repeats')) {
                return {
                    intent: 'long_form_build',
                    operation: 'remove_repetition',
                    parameters: {},
                    confidence: 'HIGH',
                    missingParameters: []
                };
            }
            return {
                intent: 'edit',
                operation: 'remove_clip',
                target_clip_id: activeClip?.id || null,
                target_track_id: activeClip?.trackId || null,
                parameters: {},
                confidence: activeClip ? 'HIGH' : 'MEDIUM',
                missingParameters: activeClip ? [] : ['clipId']
            };
        }
        if (has('speed', 'faster', 'slower', '2x', '0.5x', '1.5x', 'time-lapse', 'timelapse', 'slo-mo', 'slow motion', 'slow-mo')) {
            let speed = 1.0;
            if (has('2x', 'double', 'twice as fast')) speed = 2.0;
            else if (has('0.5', 'half speed')) speed = 0.5;
            else if (has('1.5')) speed = 1.5;
            else if (has('4x')) speed = 4.0;
            else if (has('0.25')) speed = 0.25;
            else if (has('time-lapse', 'timelapse')) speed = 8.0;
            else if (has('slo-mo', 'slow motion', 'slow-mo', 'slower')) speed = 0.5;
            else if (has('faster', 'speed up')) speed = 2.0;
            return {
                intent: 'edit',
                operation: 'set_clip_speed',
                target_clip_id: activeClip?.id || null,
                parameters: { speed },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('vertical', '9:16', 'portrait', 'tiktok', 'reel')) {
            return { intent: 'edit', operation: 'set_aspect_ratio', parameters: { ratio: '9:16' }, confidence: 'HIGH', missingParameters: [] };
        }
        if (has('horizontal', '16:9', 'landscape', 'widescreen')) {
            return { intent: 'edit', operation: 'set_aspect_ratio', parameters: { ratio: '16:9' }, confidence: 'HIGH', missingParameters: [] };
        }
        if (has('square', '1:1', 'instagram')) {
            return { intent: 'edit', operation: 'set_aspect_ratio', parameters: { ratio: '1:1' }, confidence: 'HIGH', missingParameters: [] };
        }
        if (has('undo', 'go back', 'revert', 'take that back')) {
            return { intent: 'undo', operation: 'undo_action', parameters: {}, confidence: 'HIGH', missingParameters: [] };
        }
        if (has('redo', 'redo that', 'do it again', 'put it back')) {
            return { intent: 'redo', operation: 'redo_action', parameters: {}, confidence: 'HIGH', missingParameters: [] };
        }
        if (has('silence', 'silent', 'dead air', 'quiet parts', 'remove pauses', 'cut out pauses')) {
            return {
                intent: 'edit',
                operation: 'silence_removal',
                parameters: { threshold: '-30dB' },
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('export', 'render', 'download', 'save', 'output')) {
            return { intent: 'export', operation: 'export_video', parameters: { format: 'mp4', quality: '1080p' }, confidence: 'HIGH', missingParameters: [] };
        }
        if (has('analyze', 'analyse', 'understand the video', 'what\'s in this',
                'break it down', 'segment', 'structure')) {
            return {
                intent: 'analyze',
                operation: 'analyze_structure',
                parameters: {},
                confidence: 'HIGH',
                missingParameters: []
            };
        }
        if (has('hook', 'find the hook', 'best opening', 'strongest moment')) {
            return {
                intent: 'analyze',
                operation: 'find_hook',
                parameters: {},
                confidence: 'HIGH',
                missingParameters: []
            };
        }

        // ──────────────────────────────────────────────────────────────────────
        // 9. SMART FALLBACK — contextual, never generic
        // ──────────────────────────────────────────────────────────────────────
        const durationStr = duration > 0 ? `${Math.round(duration / 60)}m ${Math.round(duration % 60)}s` : null;
        const clipHint = activeClip ? `I can see clip "${activeClip.name || 'your clip'}"${durationStr ? ` (${durationStr})` : ''} on the timeline.` : '';

        return {
            intent: 'clarification_required',
            message: [
                `Got it — you want to work on this clip. ${clipHint}`,
                `As your AI editor, I can:`,
                `🎬 **Full edit** — Analyze + structure the video for YouTube, TikTok, or Podcast`,
                `✂️ **Cut & trim** — Split, trim, remove silences, cut out filler words`,
                `🎨 **Style** — Color grade (cinematic, warm, cool, B&W), transitions (J-cut, L-cut, match cut)`,
                `🔊 **Audio** — Denoise, normalize, duck music, sync to beat`,
                `📐 **Format** — 16:9, 9:16 (TikTok), 1:1 (Instagram)`,
                `\nWhat do you want to do? You can describe it naturally — I understand pro editing language.`
            ].join('\n')
        };
    } catch (e) {
        console.error('❌ [LocalParser] Crash prevented:', e);
        return {
            intent: 'clarification_required',
            message: 'Something went wrong parsing that. Could you try rephrasing?'
        };
    }
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

        case 'remove_filler_words':
            steps = [{ step_id: 'filler', action: 'remove_filler_words' }];
            break;

        case 'undo_action':
            steps = [{ step_id: 'undo', action: 'undo_action' }];
            break;

        case 'trim_clip': {
            const trimFrom = params.trimFrom || params.trim_from || 'end';
            const amount = params.amount || params.targetDuration || 5;
            steps = [{ step_id: 'trim', action: 'trim_clip', clip_id: clipId, track_id: trackId, trim_from: trimFrom, trim_amount: amount }];
            break;
        }

        case 'export_video': {
            const format = params.format || 'mp4';
            const quality = params.quality || '1080p';
            steps = [
                { step_id: 'validate_export', action: 'validate_export_settings', format, quality },
                { step_id: 'prepare', action: 'prepare_export', format, quality, codec: params.codec || 'h264', audio_codec: 'aac' },
            ];
            break;
        }

        case 'normalize_audio':
            steps = [{ step_id: 'normalize', action: 'normalize_audio', target_lufs: params.targetLUFS || -14 }];
            break;

        case 'audio_denoise':
        case 'denoise_audio':
            steps = [{ step_id: 'denoise', action: 'audio_denoise', strength: params.strength || 0.7 }];
            break;

        case 'color_grade': {
            const presetMap = {
                cinematic: { contrast: 1.2, saturation: 0.85, brightness: -0.05, shadows: -0.1 },
                warm:      { temperature: 0.2, saturation: 1.1, brightness: 0.05 },
                cool:      { temperature: -0.2, saturation: 0.95, brightness: 0.0 },
                vibrant:   { saturation: 1.4, contrast: 1.1 },
                bw:        { saturation: 0.0 },
            };
            const preset = params.preset || 'cinematic';
            const adjustments = presetMap[preset] || presetMap.cinematic;
            steps = [{ step_id: 'grade', action: 'color_grade', clip_id: clipId, adjustments }];
            break;
        }

        case 'add_transition':
            steps = [{ step_id: 'transition', action: 'add_transition', clip_id: clipId, type: params.type || 'fade', duration: params.duration || 0.5 }];
            break;

        case 'auto_captions':
            steps = [{ step_id: 'captions', action: 'auto_captions', language: params.language || 'en', style: params.style || 'default' }];
            break;

        case 'apply_zoom':
            steps = [{ step_id: 'zoom', action: 'apply_zoom', direction: params.direction || 'in' }];
            break;

        case 'long_form_edit':
            steps = [
                { step_id: 'silence', action: 'silence_removal', threshold: params.threshold || '-25dB' },
                { step_id: 'filler', action: 'remove_filler_words' }
            ];
            break;

        case 'analyze_structure':
            steps = [{ step_id: 'analyze', action: 'analyze_structure' }];
            break;

        case 'adjust_volume':
            steps = [{ step_id: 'volume', action: 'adjust_volume', clip_id: clipId, volume: params.volume ?? 0.8 }];
            break;

        case 'redo_action':
            steps = [{ step_id: 'redo', action: 'redo_action' }];
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

/**
 * Analyze Content Handler — Long-Form Intelligence Engine
 *
 * POST /api/ai/analyze-content
 * Body: {
 *   transcript: { text: string, segments: Array<{id,start,end,text,words}> },
 *   clips: Array<{id,name,start,duration,trackId}>,
 *   duration: number,
 *   platform?: string,
 *   targetDuration?: number
 * }
 *
 * Returns: {
 *   contentType, editMode, segments[], structure, editPlan, requiresApproval: true
 * }
 */
const analyzeContentHandler = async (req, res) => {
    try {
        const { transcript = { text: '', segments: [] }, clips = [], duration = 0, platform = null, targetDuration = null } = req.body;

        console.log(`🧠 [ContentAnalysis] Analyzing ${duration.toFixed(1)}s of content. Segments: ${transcript.segments?.length || 0}`);

        // ── Step 1: Detect content type from heuristics ────────────────────
        const contentType = _detectContentType(transcript.text, clips, duration);
        const editMode = _selectEditMode(contentType, duration, platform);

        // ── Step 2: Ask GPT-4 to semantically cluster segments ─────────────
        let gptAnalysis = null;

        if (openai && transcript.segments && transcript.segments.length > 0) {
            gptAnalysis = await _gptAnalyzeSegments(transcript, duration, contentType, platform, targetDuration);
        }

        // ── Step 3: Build structural output ───────────────────────────────
        const { analyzeStructure } = require('../viralEngine/structure.js');
        const structureAnalysis = analyzeStructure({
            duration,
            transcript: transcript.text,
            segments: transcript.segments || []
        });

        // ── Step 4: Merge GPT analysis with heuristic structure ────────────
        const segments = gptAnalysis?.segments || _buildFallbackSegments(transcript.segments || [], duration);
        const structure = {
            ...structureAnalysis,
            hookCandidate: structureAnalysis.hookCandidate,
            sections: gptAnalysis?.structure?.sections || structureAnalysis.detectedSections || []
        };

        const editPlan = gptAnalysis?.editPlan || _buildFallbackEditPlan(contentType, editMode, duration, targetDuration);

        const response = {
            success: true,
            contentType,
            editMode,
            duration,
            platform: platform || _inferPlatformFromMode(editMode, duration),
            segments,
            structure,
            editPlan,
            requiresApproval: true,  // Always require user approval before execution
            summary: _buildSummary(contentType, editMode, segments, structure, editPlan)
        };

        console.log(`✅ [ContentAnalysis] Done. Mode: ${editMode}, Segments: ${segments.length}, Hook: ${structure.hookCandidate ? 'found' : 'not found'}`);
        res.json(response);

    } catch (error) {
        console.error('❌ [ContentAnalysis] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// ── Content Analysis Helpers ─────────────────────────────────────────────────

function _detectContentType(text, clips, duration) {
    const lower = text.toLowerCase();
    const clipNames = clips.map(c => (c.name || '').toLowerCase()).join(' ');

    if (lower.includes('podcast') || clipNames.includes('podcast')) return 'podcast';
    if (lower.includes('interview') || lower.includes('guest') || lower.includes('host')) return 'interview';
    if (duration > 600 && clips.length <= 2) return 'long_form_raw';
    if (clips.length > 5) return 'rushes';
    if (duration < 180) return 'short_form';
    return 'youtube_long';
}

function _selectEditMode(contentType, duration, platform) {
    if (contentType === 'rushes' || contentType === 'long_form_raw') return 'FULL_BUILD';
    if (contentType === 'podcast' || contentType === 'interview') return 'CLEAN_EDIT';
    if (platform === 'youtube' || (duration > 300 && contentType === 'youtube_long')) return 'YOUTUBE_OPTIMIZED';
    return 'CLEAN_EDIT';
}

function _inferPlatformFromMode(editMode, duration) {
    if (editMode === 'CLEAN_EDIT') return 'podcast';
    if (editMode === 'YOUTUBE_OPTIMIZED') return 'youtube';
    if (duration < 60) return 'tiktok';
    return 'youtube';
}

async function _gptAnalyzeSegments(transcript, duration, contentType, platform, targetDuration) {
    // Build a condensed segment list for GPT (max 50 segments to stay within token limits)
    const whisperSegs = (transcript.segments || []).slice(0, 50).map(s => ({
        id: s.id,
        start: parseFloat(s.start.toFixed(1)),
        end: parseFloat(s.end.toFixed(1)),
        text: s.text.slice(0, 200) // Truncate to save tokens
    }));

    const systemPrompt = `You are an expert long-form video editor and content strategist.
Your job is to analyze video transcript segments and produce a professional edit plan.

Content type: ${contentType}
Total duration: ${duration.toFixed(0)} seconds
Target platform: ${platform || 'unspecified'}
Target output duration: ${targetDuration ? targetDuration + 's' : 'unspecified (keep coherent)'}

You MUST respond with valid JSON only. No markdown, no explanation.`;

    const userMessage = `Transcript segments:
${JSON.stringify(whisperSegs, null, 2)}

Tasks:
1. Group segments into 20-90 second logical chunks (topic-based)
2. Assign each chunk: topic, type (value|intro|hook|filler|transition|outro), energy (low|medium|high), importance_score (0.0-1.0)
3. Identify the best hook candidate (most engaging 15-30s window in first 40% of video)
4. Detect main sections by topic
5. Generate an edit plan

Respond with this exact JSON structure:
{
  "segments": [
    { "start": 0, "end": 45, "topic": "Introduction", "type": "intro", "energy": "medium", "importance_score": 0.6 }
  ],
  "structure": {
    "hook": { "start": 0, "end": 25, "reason": "strong opening statement" },
    "sections": [
      { "start": 0, "end": 120, "topic": "Opening", "type": "intro" }
    ]
  },
  "editPlan": {
    "videoType": "${contentType}",
    "duration_target": ${targetDuration || Math.min(duration, 600)},
    "editMode": "CLEAN_EDIT",
    "structure": [
      { "type": "hook", "source_range": [0, 25] },
      { "type": "intro", "source_range": [0, 45] }
    ],
    "actions": ["remove_silences", "remove_repetition", "improve_pacing"]
  }
}`;

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            model: 'gpt-4-1106-preview',
            response_format: { type: 'json_object' },
            temperature: 0.2
        }, { timeout: 30000 });

        const result = JSON.parse(completion.choices[0].message.content);
        console.log(`🤖 [GPT] Segments: ${result.segments?.length}, Sections: ${result.structure?.sections?.length}`);
        return result;
    } catch (err) {
        console.warn('⚠️ [GPT] Content analysis failed, using fallback:', err.message);
        return null;
    }
}

function _buildFallbackSegments(whisperSegments, duration) {
    if (whisperSegments.length === 0) {
        return [{ start: 0, end: duration, topic: 'Full Video', type: 'value', energy: 'medium', importance_score: 0.5 }];
    }

    // Group whisper segments into ~45s chunks
    const chunks = [];
    let chunkStart = whisperSegments[0].start;
    let chunkText = '';
    let chunkWords = 0;

    for (const seg of whisperSegments) {
        chunkText += ' ' + seg.text;
        chunkWords += (seg.words || []).length || seg.text.split(' ').length;
        const chunkDuration = seg.end - chunkStart;

        if (chunkDuration >= 45 || seg === whisperSegments[whisperSegments.length - 1]) {
            const energy = chunkWords / chunkDuration > 2.5 ? 'high' : chunkWords / chunkDuration > 1.5 ? 'medium' : 'low';
            chunks.push({
                start: parseFloat(chunkStart.toFixed(2)),
                end: parseFloat(seg.end.toFixed(2)),
                topic: 'Content',
                type: 'value',
                energy,
                importance_score: parseFloat(Math.min(1, (chunkWords / chunkDuration) / 3).toFixed(2))
            });
            chunkStart = seg.end;
            chunkText = '';
            chunkWords = 0;
        }
    }

    return chunks;
}

function _buildFallbackEditPlan(contentType, editMode, duration, targetDuration) {
    const actions = ['remove_silences'];
    if (editMode === 'CLEAN_EDIT') actions.push('remove_filler_words', 'improve_pacing');
    if (editMode === 'YOUTUBE_OPTIMIZED') actions.push('remove_repetition', 'add_transitions', 'improve_pacing');
    if (editMode === 'FULL_BUILD') actions.push('remove_repetition', 'reorder_for_narrative', 'add_transitions');

    return {
        videoType: contentType,
        duration_target: targetDuration || Math.min(duration, 600),
        editMode,
        structure: [
            { type: 'hook', source_range: [0, Math.min(30, duration * 0.1)] },
            { type: 'intro', source_range: [0, Math.min(60, duration * 0.15)] },
            { type: 'main', source_range: [duration * 0.15, duration * 0.85] },
            { type: 'outro', source_range: [duration * 0.85, duration] }
        ],
        actions
    };
}

function _buildSummary(contentType, editMode, segments, structure, editPlan) {
    const fillerSegments = segments.filter(s => s.type === 'filler').length;
    const highValueSegments = segments.filter(s => s.importance_score >= 0.7).length;
    return {
        contentType,
        editMode,
        totalSegments: segments.length,
        fillerSegments,
        highValueSegments,
        hookFound: !!structure.hookCandidate,
        hookTimestamp: structure.hookCandidate?.start,
        plannedActions: editPlan.actions,
        estimatedOutputDuration: editPlan.duration_target
    };
}

module.exports = {
    chatAgentHandler,
    agentPlanHandler,
    parseIntentHandler,
    generatePlanHandler,
    analyzeContentHandler
};
