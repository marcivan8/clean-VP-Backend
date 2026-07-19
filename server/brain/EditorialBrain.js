/**
 * server/brain/EditorialBrain.js
 *
 * The intelligence layer — translates user intent into a structured BrainOutput
 * via GPT-4o with a rich system prompt built from project context and user profile.
 *
 * Contract:
 * - process() NEVER throws — returns fallbackOutput on any error
 * - Temperature 0.2 for 'execute', 0.4 for advise/clarify
 * - max_tokens: 800
 * - response_format: json_object always
 */

'use strict';

const OpenAI = require('openai');
const { ContextEngine } = require('./ContextEngine');
const { UserProfileEngine } = require('./UserProfileEngine');

class EditorialBrain {

    constructor() {
        this.openai = process.env.OPENAI_API_KEY
            ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
            : null;
        this.contextEngine = new ContextEngine();
        this.profileEngine = new UserProfileEngine();
    }

    /**
     * Process a user input and return a structured BrainOutput.
     *
     * @param {import('./types').BrainInput} input
     * @param {import('./Session').EditingSession} session
     * @returns {Promise<import('./types').BrainOutput>}
     */
    async process(input, session) {
        try {
            if (!this.openai) {
                console.warn('[EditorialBrain] No OpenAI key — using fallback');
                return this.fallbackOutput(input?.rawInput);
            }

            const context = input?.context?.builtContext || this.contextEngine.build(input?.context || {});
            const profile = input?.context?.profile || await this.profileEngine.getProfile(input?.userId);
            const platform = input?.context?.platform || null;

            const systemPrompt = this.buildSystemPrompt(context, profile, platform, session);

            // Classify intent type for temperature selection
            // We use 0.2 for precise execution tasks, 0.4 for creative/advisory
            const isAdvise = input?.trigger === 'project_opened' || input?.trigger === 'asset_added';
            const temperature = isAdvise ? 0.4 : 0.2;

            const userMessage = input?.rawInput
                ? `User said: "${input.rawInput}"`
                : `Trigger: ${input?.trigger || 'unknown'}. Analyze the project and provide suggestions.`;

            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                temperature,
                max_tokens: 800,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userMessage },
                ],
            });

            const raw = completion.choices[0]?.message?.content;
            if (!raw) return this.fallbackOutput(input?.rawInput);

            const parsed = JSON.parse(raw);
            return this._normalizeBrainOutput(parsed, input?.rawInput);

        } catch (err) {
            console.error('[EditorialBrain] process error:', err.message);
            return this.fallbackOutput(input?.rawInput);
        }
    }

    /**
     * Build the rich system prompt that grounds GPT-4o in project reality.
     *
     * @param {Object} context  - Built context from ContextEngine
     * @param {Object} profile  - User profile from UserProfileEngine
     * @param {string|null} platformKey
     * @param {import('./Session').EditingSession} session
     * @returns {string}
     */
    buildSystemPrompt(context, profile, platformKey, session) {
        const ctx      = context  || {};
        const prof     = profile  || {};
        const summary  = session?.summarize() || { duration: 0, eventsCount: 0, commandsRun: [], recentEvents: [] };
        const platform = platformKey || ctx.platform || 'unknown';

        const permanentlyHidden = Array.isArray(prof.permanently_hidden) ? prof.permanently_hidden : [];
        const skillLevel        = prof.skill_level || 'beginner';
        const contentType       = prof.content_type || 'unknown';

        // Friendly LUFS note
        const loudnessNote = ctx.platform
            ? `(Platform loudness standard: ${_getLoudness(ctx.platform)} LUFS)`
            : '';

        const violationsText = (ctx.platformViolations || [])
            .filter(v => !v.passing && v.suggestion)
            .map(v => `  - [${v.severity.toUpperCase()}] ${v.suggestion}`)
            .join('\n') || '  - None detected';

        const recentEventsText = summary.recentEvents
            .map(e => `  - ${e.type}: ${e.summary}`)
            .join('\n') || '  - (no events yet)';

        const unusedAssetsText = ctx.unusedAssets?.length
            ? ctx.unusedAssets.slice(0, 5).join(', ') + (ctx.unusedAssets.length > 5 ? '…' : '')
            : 'none';

        const transcriptSnippet = ctx.transcriptPreview
            ? ctx.transcriptPreview          // already trimmed to 500 chars; includes speaker labels if multi-speaker
            : '(no captions/transcript yet)';

        const inferredContentType = ctx.inferredContentType || 'unknown';

        const hiddenNote = permanentlyHidden.length > 0
            ? `NEVER suggest these — user permanently dismissed them: ${permanentlyHidden.join(', ')}`
            : '(none permanently dismissed)';

        return `You are Vibed's Editorial Brain — an expert video editor and creative director with deep knowledge of content creation, platform algorithms, and editing craft. You understand what makes content perform on each platform.

═══════════════════════════════════════════════
PROJECT STATE
═══════════════════════════════════════════════
Duration:       ${ctx.duration || 0}s (original: ${ctx.originalDuration || 0}s, saved: ${ctx.timeSaved || 0}s)
Clips:          ${ctx.clipCount || 0} clips, cut rate ${ctx.cutRate || 0}/min, avg clip ${ctx.avgClipLength || 0}s
Captions:       ${ctx.hasCaptions ? 'yes' : 'no'}
Music:          ${ctx.hasMusic ? 'yes' : 'no'}
SFX:            ${ctx.hasSFX ? 'yes (SFX assets in bin)' : 'none'}
Color grade:    ${ctx.hasColorGrade ? `LUT applied (id: ${(ctx.projectLUTId || '').slice(0,8)}…)` : 'none — consider recommend_luts'}
Aspect ratio:   ${ctx.aspectRatio || 'unknown'}
Platform:       ${platform} ${loudnessNote}
Completion:     ${ctx.completionScore || 0}/100
Edits applied:  ${(ctx.editsDone || []).join(', ') || 'none'}

Edits run this session:
${summary.commandsRun.length ? summary.commandsRun.map(c => `  - ${c}`).join('\n') : '  - (none yet)'}

Platform violations:
${violationsText}

Recent session events:
${recentEventsText}

═══════════════════════════════════════════════
USER PROFILE
═══════════════════════════════════════════════
Skill level:    ${skillLevel} — ${_skillDescription(skillLevel)}
Content type:   ${contentType}
Patterns:       removes silences=${prof.typically_removes_silences ? 'yes' : 'no'}, adds captions=${prof.typically_adds_captions ? 'yes' : 'no'}, adds music=${prof.typically_adds_music ? 'yes' : 'no'}
Top commands:   ${_topCommands(prof.common_commands)}
Permanently hidden suggestions (${hiddenNote}):

═══════════════════════════════════════════════
PLATFORM RULES (${platform})
═══════════════════════════════════════════════
${_platformRulesText(platformKey)}

═══════════════════════════════════════════════
CONTENT FORMAT (derived from transcript + media)
═══════════════════════════════════════════════
Detected format: ${inferredContentType.toUpperCase()}
Speakers:        ${ctx.detectedSpeakers || 0}
Speaking pace:   ${ctx.speakingPace ? ctx.speakingPace + ' wpm' : 'unknown'}

IMPORTANT — use the detected format to drive your assessment and suggestions:
  • interview (2+ speakers): acknowledge it's a conversation/Q&A/podcast. Suggest
    cutting to best exchanges, trimming dead air between turns, adding reaction shots
    if B-roll is available, extracting the sharpest Q&A moments for Shorts/Reels,
    and pacing cuts to match speaking rhythm between speakers.
  • monologue (1 speaker): focus on silence removal, filler words, zoom rhythm to
    keep attention, and energy pacing — treat it as a talking-head or tutorial.
  • unknown (no transcript yet): acknowledge the format is unclear and ask the user
    to generate captions first so you can give a proper assessment.

Transcript preview (speaker-labelled if multiple speakers):
${transcriptSnippet}

═══════════════════════════════════════════════
MEDIA BIN
═══════════════════════════════════════════════
Total assets:   ${ctx.totalAssets || 0}
Types:          video=${ctx.assetTypes?.video || 0}, audio=${ctx.assetTypes?.audio || 0}, music=${ctx.assetTypes?.music || 0}, sfx=${ctx.assetTypes?.sfx || 0}
Unused assets:  ${unusedAssetsText}
Bin analyzed:   ${ctx.binReady ? 'yes' : 'no (still processing)'}

═══════════════════════════════════════════════
ASSET ENGINE — available creative tools
═══════════════════════════════════════════════
You can invoke these commands to access the Creative Asset Intelligence System:

search_sfx "<query>"          — find sound effects (whoosh, impact, comedy beat, etc.)
search_luts "<style>"         — find color grade LUTs (cinematic, warm, moody, etc.)
search_presets "<type>"       — find editing presets (COLOR_GRADE, CAPTION_STYLE, FULL_EDIT, etc.)
apply_lut <lutId>             — apply a LUT (CSS preview instantly; baked into export via FFmpeg)
clear_lut                     — remove current color grade
add_sfx <sfxId> at <time>    — add a sound effect to the audio track
apply_preset <presetId>       — apply a preset (FULL_EDIT requires user approval)
export_audio [format]         — export audio only (mp3/wav/aac/m4a) — triggers download
recommend_sfx                 — get AI SFX recommendations for this project
recommend_luts                — get AI LUT recommendations for this project
recommend_presets             — get AI preset recommendations for this project

IMPORTANT RULES for asset commands:
- NEVER suggest apply_lut without a real lutId from a search result
- NEVER suggest apply_preset with is_full_edit=true without setting requires_approval=true
- LUT preview is CSS-only in the editor — FFmpeg lut3d is only used at export time
- recommend_* commands are fire-and-forget and always non-blocking — safe to add to any plan

═══════════════════════════════════════════════
RESPONSE FORMAT — return ONLY valid JSON matching this exact schema:
═══════════════════════════════════════════════
{
  "intent": {
    "type": "execute|advise|clarify|learn_only",
    "confidence": 0.0,
    "command": "exact vibed command string or null",
    "reasoning": "one sentence"
  },
  "response": {
    "message": "conversational response to user — direct and expert, no filler phrases",
    "suggestions": [
      {
        "type": "remove_silences",
        "text": "Remove silences",
        "command": "exact vibed command string",
        "reason": "why this matters for their content",
        "priority": "critical|high|medium|low"
      }
    ],
    "warnings": [
      {
        "type": "no_audio",
        "text": "warning message shown to user",
        "severity": "critical|warning|info"
      }
    ],
    "insight": null
  },
  "learning": {
    "patternObserved": null,
    "profileUpdates": {}
  }
}

═══════════════════════════════════════════════
PERSONA RULES
═══════════════════════════════════════════════
- Direct and expert — no filler phrases like "Great question!" or "Absolutely!"
- Adapt language complexity to skill_level: beginner=simple, advanced=technical
- NEVER suggest anything in permanently_hidden
- NEVER suggest something already in commandsRun for this session unless state changed significantly
- If user prompt is ambiguous or you cannot determine intent: set intent.type = "clarify" and ask ONE specific clarifying question in response.message
- If request is impossible given current timeline state (e.g. "split clip" when no clips exist): explain why in response.message, set intent.type = "advise"
- For execute intents: command must be an exact, executable Vibed command string (not a description)
- Limit suggestions array to 3 items max
- Warnings should only surface issues that affect the final output
- ASSET ENGINE: If hasColorGrade=false and completionScore>60, include recommend_luts in suggestions
- ASSET ENGINE: If hasSFX=false and cutRate>4, include search_sfx "impact" in suggestions
- ASSET ENGINE: Never invent a lutId — only suggest apply_lut if you received a specific id from a prior search_luts result

CONTENT FORMAT RULES (critical — do not override with generic assessment):
- NEVER describe an interview/2-speaker video as a "talking head" or "vlog"
- When detected format is "interview": your response.message MUST acknowledge it's a conversation between ${ctx.detectedSpeakers || 'multiple'} people, and your suggestions MUST be interview-appropriate (extract highlights, clean dialogue pacing, Shorts-ready Q&A clips)
- When detected format is "monologue": your response.message may classify as talking head, tutorial, or vlog based on content and duration
- The transcript preview is speaker-labelled — use it to understand who is speaking and what the conversation is about before writing your assessment`;
    }

    /**
     * Return a valid BrainOutput when the AI is unavailable.
     * @param {string|null} rawInput
     * @returns {import('./types').BrainOutput}
     */
    fallbackOutput(rawInput) {
        return {
            intent: {
                type: 'execute',
                confidence: 0.5,
                command: rawInput || null,
                reasoning: 'Brain unavailable — passing through raw input',
            },
            response: {
                message: 'Processing your request…',
                suggestions: [],
                warnings: [],
                insight: null,
            },
            learning: {
                patternObserved: null,
                profileUpdates: {},
            },
        };
    }

    /**
     * Ensure the parsed GPT-4o output conforms to the BrainOutput shape.
     * @private
     */
    _normalizeBrainOutput(parsed, rawInput) {
        const validIntentTypes = ['execute', 'advise', 'clarify', 'learn_only'];

        const intent = parsed?.intent || {};
        const response = parsed?.response || {};

        return {
            intent: {
                type: validIntentTypes.includes(intent.type) ? intent.type : 'execute',
                confidence: typeof intent.confidence === 'number' ? intent.confidence : 0.5,
                command: intent.command || rawInput || null,
                reasoning: intent.reasoning || '',
            },
            response: {
                message: response.message || 'Done.',
                suggestions: Array.isArray(response.suggestions) ? response.suggestions.slice(0, 3) : [],
                warnings: Array.isArray(response.warnings) ? response.warnings : [],
                insight: response.insight || null,
            },
            learning: {
                patternObserved: parsed?.learning?.patternObserved || null,
                profileUpdates:  parsed?.learning?.profileUpdates  || {},
            },
        };
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _skillDescription(level) {
    const map = {
        beginner:     'use simple language, explain what each action does',
        intermediate: 'assume familiarity with editing concepts',
        advanced:     'use precise technical terminology',
    };
    return map[level] || map.beginner;
}

function _topCommands(commonCommands) {
    if (!commonCommands || typeof commonCommands !== 'object') return 'none';
    return Object.entries(commonCommands)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cmd, count]) => `${cmd}(${count})`)
        .join(', ') || 'none';
}

function _getLoudness(platform) {
    const map = { podcast: -16, youtube_long: -14, tiktok: -14, instagram_reels: -14, youtube_shorts: -14, linkedin: -14 };
    return map[platform] || -14;
}

function _platformRulesText(platformKey) {
    if (!platformKey) return '(no platform selected — advise user to choose a target platform)';
    try {
        const { PLATFORM_KNOWLEDGE } = require('./PlatformKnowledge');
        const p = PLATFORM_KNOWLEDGE[platformKey];
        if (!p) return `(unknown platform: ${platformKey})`;
        return [
            `Name: ${p.name}`,
            `Ideal duration: ${Math.round(p.idealDuration.min / 60)}–${Math.round(p.idealDuration.max / 60)} min`,
            `Hook: within first ${p.hookDuration.max}s`,
            `Captions required: ${p.captionsRequired ? 'YES' : 'no'}`,
            `Pace: ${p.paceStyle} (${p.cutRate.min}–${p.cutRate.max} cuts/min)`,
            `Loudness: ${p.loudnessStandard} LUFS`,
            '',
            'Retention rules:',
            ...(p.retentionRules || []).map(r => `  - ${r}`),
            '',
            `Editing style: ${p.editingStyle}`,
        ].join('\n');
    } catch {
        return '(platform knowledge unavailable)';
    }
}

module.exports = { EditorialBrain };
