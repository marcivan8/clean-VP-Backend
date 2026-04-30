import { ContextGenerator } from './ContextGenerator.js';
import { FallbackParser } from './FallbackParser.js';
import { EventBus, EVENT_TYPES } from './EventBus.js';
import { IntentValidator } from './IntentValidator.js';
import { INTENT_TYPES, OPERATIONS } from './CommandConstants.js';

export { INTENT_TYPES, OPERATIONS };

// ─────────────────────────────────────────────────────────────────────────────
// NLP SYNONYM MAP — the heart of natural language understanding
// Add any phrase a real user might say for each operation.
// ─────────────────────────────────────────────────────────────────────────────
const NLP_MAP = {
    // ── SPLIT ──────────────────────────────────────────────────────────────
    split: [
        'split', 'divide', 'cut in half', 'cut in two', 'cut into two',
        'chop in half', 'break in half', 'break apart', 'separate',
        'slice', 'bisect', 'split it', 'split the clip', 'split this clip',
        'split the video', 'cut this in half', 'cut it in half',
        'cut down the middle', 'halve it', 'halve the clip',
    ],
    // ── CUT / TRIM ─────────────────────────────────────────────────────────
    cut: [
        'cut', 'cut at', 'cut here', 'cut it', 'snip', 'slice at',
        'cut at playhead', 'cut at this point', 'make a cut',
    ],
    remove: [
        'remove', 'delete', 'erase', 'get rid of', 'trash', 'drop',
        'ditch', 'wipe out', 'take out', 'cut out', 'cut away',
        'eliminate', 'clear', 'purge', 'strip', 'exclude',
        'remove this clip', 'delete this clip', 'remove the clip',
    ],
    trim: [
        'trim', 'shorten', 'cut to', 'make it shorter', 'shrink',
        'tighten', 'tighten up', 'crop', 'truncate', 'clip it to',
        'reduce the length', 'make shorter', 'shorter',
        'trim the start', 'trim the end', 'trim the beginning',
        'trim from the start', 'trim from the end',
        'remove the beginning', 'remove the start', 'remove the end',
        'cut the beginning', 'cut the end', 'cut the start',
        'chop the beginning', 'chop the end', 'chop off',
    ],
    // ── SPEED ──────────────────────────────────────────────────────────────
    speed: [
        'speed', 'speed up', 'faster', 'fast forward', 'slow down',
        'slower', 'slow motion', 'slowmo', 'slo-mo', 'timelapse',
        'time lapse', 'speed change', 'change speed', 'set speed',
        'make it faster', 'make it slower', 'double speed', 'half speed',
        'speed it up', 'slow it down', '2x', '0.5x', '1.5x',
        'make faster', 'make slower', 'play faster', 'play slower',
        'speed this up', 'slow this down',
    ],
    // ── SILENCE ────────────────────────────────────────────────────────────
    silence: [
        'silence', 'remove silence', 'cut silence', 'delete silence',
        'remove silences', 'remove dead air', 'cut dead air',
        'remove pauses', 'cut pauses', 'remove quiet parts',
        'clean up audio', 'tighten audio', 'remove gaps',
        'no silence', 'without silence', 'kill the silence',
        'eliminate silence', 'trim silence', 'auto trim',
    ],
    // ── ASPECT RATIO ───────────────────────────────────────────────────────
    aspect: [
        'vertical', 'horizontal', 'square', 'portrait', 'landscape',
        'aspect ratio', 'aspect', '9:16', '16:9', '1:1', '4:3', '21:9',
        'tiktok format', 'reels format', 'youtube format', 'widescreen',
        'change format', 'format for', 'resize for', 'convert to vertical',
        'convert to horizontal', 'make it vertical', 'make it horizontal',
        'instagram format', 'twitter format', 'cinematic',
    ],
    // ── EFFECTS ────────────────────────────────────────────────────────────
    transition: [
        'transition', 'add transition', 'fade', 'dissolve', 'wipe',
        'slide transition', 'zoom transition', 'add fade', 'add dissolve',
        'smooth cut', 'add a fade', 'fade in', 'fade out',
        'cross dissolve', 'crossfade',
    ],
    filter: [
        'filter', 'effect', 'blur', 'sharpen', 'vignette',
        'black and white', 'b&w', 'grayscale', 'sepia', 'add filter',
        'apply filter', 'add effect', 'apply effect',
        'make it black and white', 'desaturate',
    ],
    color: [
        'color', 'grade', 'color grade', 'color grading', 'lut',
        'saturation', 'brightness', 'contrast', 'warm', 'cool',
        'adjust color', 'fix color', 'color correct', 'exposure',
        'highlights', 'shadows', 'tone',
    ],
    text: [
        'text', 'title', 'caption', 'subtitle', 'add text', 'add title',
        'add caption', 'put text', 'overlay text', 'text overlay',
        'add a title', 'add a caption', 'write on screen',
        'add subtitles', 'burn in captions',
    ],
    volume: [
        'volume', 'audio', 'louder', 'quieter', 'mute', 'unmute',
        'turn up', 'turn down', 'lower the volume', 'raise the volume',
        'increase volume', 'decrease volume', 'boost audio',
        'lower audio', 'adjust volume', 'audio level',
        'make it louder', 'make it quieter', 'silence the audio',
    ],
    // ── UNDO / REDO ────────────────────────────────────────────────────────
    undo: [
        'undo', 'go back', 'revert', 'take that back', 'undo that',
        'undo last', 'undo the last', 'undo action', 'ctrl z',
    ],
    redo: [
        'redo', 'redo that', 'redo last', 'redo action', 'ctrl y',
    ],
    // ── EXPORT ─────────────────────────────────────────────────────────────
    export: [
        'export', 'render', 'save', 'save as', 'download', 'finish',
        'export video', 'render video', 'finalize', 'publish',
        'save the video', 'export the video', 'create the video',
        'generate the video', 'output', 'produce',
    ],
    // ── DUPLICATE ─────────────────────────────────────────────────────────
    duplicate: [
        'duplicate', 'copy', 'clone', 'repeat', 'copy clip',
        'duplicate clip', 'make a copy', 'copy this clip',
    ],
    // ── LONG-FORM ──────────────────────────────────────────────────────────
    analyze: [
        'analyze', 'analyse', 'analyze my video', 'analyze this video',
        'analyze the content', 'analyze structure', 'segment',
        'what is in this video', 'understand this content',
        'break down the video', 'scan the video', 'review the content',
        'check the video', 'inspect the video',
    ],
    hook: [
        'find the hook', 'find hook', 'best opening', 'strongest moment',
        'most engaging part', 'best hook', 'what should i use as hook',
        'find the best part', 'find the opener',
    ],
    buildFromRushes: [
        'build a full video', 'build from rushes', 'build from raw',
        'assemble the video', 'edit my rushes', 'edit the rushes',
        'compile the footage', 'put together a video', 'build me a video',
        'create a video from', 'make a video from', 'assemble footage',
        'create from raw', 'edit the raw footage',
    ],
    cleanEdit: [
        'clean this podcast', 'clean the podcast', 'edit the podcast',
        'clean up the interview', 'edit this interview', 'clean up the recording',
        'tighten up the interview', 'tighten the podcast', 'clean up this recording',
        'clean the recording', 'edit my podcast',
    ],
    youtubeOptimize: [
        'optimize for youtube', 'make a youtube video', 'edit for youtube',
        'youtube long form', 'make it youtube ready', 'build a youtube video',
        'create a youtube video', 'make a full youtube video',
        'format for youtube',
    ],
    removeRepetition: [
        'remove repetition', 'remove repetitions', 'cut out repetitions',
        'remove duplicate parts', 'cut repeated content', 'remove repeats',
        'no repetition', 'clean up repetition', 'deduplicate',
    ],
    // ── CREATIVE / OPTIMIZE ────────────────────────────────────────────────
    improve: [
        'make it better', 'improve', 'enhance', 'polish', 'fix this',
        'clean up', 'make it look good', 'optimize', 'refine',
        'make it professional', 'look more professional', 'upgrade',
        'fix it up', 'tune up', 'tune it',
    ],
    viral: [
        'make it viral', 'viral', 'go viral', 'optimize for social',
        'social media', 'edit for social', 'make it pop',
        'make it engaging', 'hook people', 'attention grabbing',
        'make it shareable', 'boost engagement',
    ],
    // ── NLE EXPORT ─────────────────────────────────────────────────────────
    nleExport: [
        'export for premiere', 'export for premiere pro', 'export to premiere',
        'premiere pro format', 'premiere export', 'send to premiere',
        'export for final cut', 'export for fcpx', 'export to final cut',
        'final cut format', 'fcpx format', 'final cut pro',
        'export for davinci', 'export for davinci resolve', 'export to davinci',
        'davinci format', 'davinci resolve format', 'resolve format',
        'export for capcut', 'export to capcut', 'capcut format',
        'export for resolve', 'export xml', 'export edl', 'export fcpxml',
        'export project file', 'export to nle', 'nle export',
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT for the AI backend — injected for parse-intent calls
// ─────────────────────────────────────────────────────────────────────────────
export const INTENT_SYSTEM_PROMPT = `You are a video editing assistant that converts natural language into structured JSON intents.

Your job is to understand ANY phrasing a real video editor might use — including casual, abbreviated, slang, or domain-specific language.

OPERATIONS you must recognize:
- split_clip: "cut in half", "divide", "chop", "bisect", "split at X"
- remove_clip: "delete", "remove", "get rid of", "trash", "cut out"
- trim_clip: "shorten", "make shorter", "trim to X seconds", "cut to X", "remove the beginning/end"
- set_clip_speed: "speed up", "slow down", "2x", "0.5x", "timelapse", "slow motion"
- set_aspect_ratio: "vertical", "for TikTok", "9:16", "make it square"
- silence_removal: "remove silence", "remove pauses", "clean up audio"
- remove_filler_words: "remove ums", "remove ahs", "clean up speech"
- add_transition: "add a fade", "crossfade", "dissolve"
- add_filter: "blur", "black and white", "add filter"
- color_grade: "color grade", "add warmth", "fix the colors"
- add_text: "add a title", "add text", "put a caption"
- adjust_volume: "louder", "quieter", "mute", "boost audio"
- export_video: "export", "render", "finish", "save"
- undo_action: "undo", "go back", "revert"
- analyze_structure: "analyze", "understand the video", "segment it"
- find_hook: "find the hook", "best part", "strongest opening"
- long_form_edit: "edit the podcast", "clean up the interview", "optimize for YouTube"
- build_from_rushes: "build from rushes", "assemble footage", "make a video from raw clips"
- nle_export: "export for Premiere", "export for DaVinci", "export for Final Cut", "export for CapCut"

Always return valid JSON with this structure:
{
  "intent": "<INTENT_TYPE>",
  "operation": "<OPERATION>",
  "targets": [],
  "target_track_id": null,
  "constraints": {},
  "needs_clarification": false,
  "confidence": "HIGH|MEDIUM|LOW",
  "missingParameters": []
}

Be liberal in interpretation. When in doubt, make a reasonable assumption rather than asking for clarification.
If the user says "make it faster" without specifying how much, default to 2x speed.
If the user says "make it vertical", default to 9:16.
If the user says "clean it up", assume silence_removal.
NEVER return an error when you can make a reasonable assumption.`;

export class IntentParser {
    /**
     * Parse user prompt into structured intent JSON.
     * Primary path: API → FallbackParser → Enhanced localParse
     */
    static async parse(userPrompt, signal = null) {
        console.log('[IntentParser] Parsing:', userPrompt);

        if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
            return this.needsClarification('Empty or invalid input');
        }

        const prompt = userPrompt.trim();
        const structuredContext = ContextGenerator.getStructuredContext();

        try {
            console.log('[IntentParser] Attempting API parse...');
            const apiResult = await this.parseViaAPI(prompt, structuredContext, signal);
            if (apiResult) {
                console.log('[IntentParser] API parse successful:', apiResult.operation);
                return this.validateAndNormalize(apiResult);
            }
        } catch (error) {
            if (signal && signal.aborted) throw error;
            console.warn('[IntentParser] API unavailable, using local parsers. Error:', error.message);
            EventBus.emit(EVENT_TYPES.AI_UNAVAILABLE, { error: error.message, prompt });

            const fallbackResult = FallbackParser.parse(prompt);
            if (fallbackResult) {
                console.log('[IntentParser] FallbackParser matched:', fallbackResult.action);
                return this.validateAndNormalize({
                    success: true,
                    intent: {
                        type: fallbackResult.type,
                        operation: fallbackResult.action,
                        ...fallbackResult,
                        parsedBy: 'fallback',
                        confidence: fallbackResult.confidence || 'medium'
                    }
                });
            }
        }

        console.log('[IntentParser] Using enhanced localParse...');
        return this.localParse(prompt, ContextGenerator.getTimelineContext());
    }

    static async parseViaAPI(prompt, context, signal) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        if (signal) signal.addEventListener('abort', () => controller.abort());

        try {
            const response = await fetch('/api/ai/parse-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, context, systemPrompt: INTENT_SYSTEM_PROMPT }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) return null;
            const result = await response.json();

            if (result.intent === 'clarification_required') {
                return {
                    needs_clarification: true,
                    reason: result.message,
                    intent: null,
                    operation: null,
                    targets: [],
                    constraints: {},
                    intentDraft: result.intentDraft || null
                };
            }
            return result;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ENHANCED LOCAL PARSE — uses NLP_MAP for synonym matching
    // ─────────────────────────────────────────────────────────────────────
    static localParse(prompt, context) {
        const lower = prompt.toLowerCase().trim();
        const clips = context?.clips || [];
        const activeClip = clips.find(c => c.isActive);

        // Helper: check if prompt contains any synonym from a category
        const matches = (category) =>
            NLP_MAP[category]?.some(phrase => lower.includes(phrase)) ?? false;

        // ── NLE export (check first — very specific) ──────────────────────
        if (matches('nleExport')) {
            return this.parseNLEExportIntent(lower);
        }

        // ── Long-form intelligence (check before generic operations) ──────
        if (matches('analyze')) {
            return this.createIntent(INTENT_TYPES.ANALYZE, OPERATIONS.ANALYZE_STRUCTURE, {
                constraints: {
                    platform: this.inferPlatform(lower),
                    targetDuration: this._extractTargetDuration(lower)
                }
            });
        }

        if (matches('hook')) {
            return this.createIntent(INTENT_TYPES.ANALYZE, OPERATIONS.FIND_HOOK, { constraints: {} });
        }

        if (matches('buildFromRushes')) {
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.BUILD_FROM_RUSHES, {
                constraints: {
                    platform: this.inferPlatform(lower),
                    targetDuration: this._extractTargetDuration(lower),
                    editMode: 'FULL_BUILD'
                }
            });
        }

        if (matches('cleanEdit')) {
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.LONG_FORM_EDIT, {
                constraints: {
                    editMode: 'CLEAN_EDIT',
                    platform: this.inferPlatform(lower) || 'podcast'
                }
            });
        }

        if (matches('youtubeOptimize')) {
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.LONG_FORM_EDIT, {
                constraints: {
                    editMode: 'YOUTUBE_OPTIMIZED',
                    platform: 'youtube',
                    targetDuration: this._extractTargetDuration(lower)
                }
            });
        }

        if (matches('removeRepetition')) {
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.REMOVE_REPETITION, {
                constraints: {}
            });
        }

        // ── Undo / Redo ───────────────────────────────────────────────────
        if (matches('undo')) {
            return this.createIntent(INTENT_TYPES.UNDO, 'undo_action');
        }
        if (matches('redo')) {
            return this.createIntent(INTENT_TYPES.REDO, 'redo_action');
        }

        // ── Export ────────────────────────────────────────────────────────
        if (matches('export')) {
            const format = this.extractExportFormat(lower);
            const quality = this.extractQuality(lower);
            return this.createIntent(INTENT_TYPES.EXPORT, OPERATIONS.EXPORT_VIDEO, {
                constraints: { format, quality }
            });
        }

        // ── Speed (before trim to catch "slow down" etc.) ─────────────────
        if (matches('speed')) {
            const speed = this.extractSpeed(lower);
            if (speed !== null) {
                return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SET_CLIP_SPEED, {
                    targets: activeClip ? [activeClip.id] : [],
                    constraints: { speed }
                });
            }
            // Speed matched but no value — ask
            return this.needsClarification('What speed? (e.g., "2x faster", "half speed", "0.5x")');
        }

        // ── Silence removal ───────────────────────────────────────────────
        if (matches('silence')) {
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SILENCE_REMOVAL, {
                constraints: { threshold: this.extractSilenceThreshold(lower) }
            });
        }

        // ── Aspect ratio ──────────────────────────────────────────────────
        if (matches('aspect')) {
            const ratio = this.extractAspectRatio(lower);
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SET_ASPECT_RATIO, {
                constraints: { ratio }
            });
        }

        // ── Split ─────────────────────────────────────────────────────────
        if (matches('split')) {
            return this.parseSplitIntent(lower, activeClip, context);
        }

        // ── Cut (can mean split at playhead OR trim) ──────────────────────
        if (matches('cut')) {
            return this.parseCutIntent(lower, activeClip, context);
        }

        // ── Trim ──────────────────────────────────────────────────────────
        if (matches('trim')) {
            if (!activeClip && clips.length === 1) {
                // Auto-select the only clip
                const onlyClip = clips[0];
                return this.parseTrimIntent(lower, onlyClip, context);
            }
            if (!activeClip) {
                return this.needsClarification('Which clip should I trim? Please select a clip first.');
            }
            return this.parseTrimIntent(lower, activeClip, context);
        }

        // ── Remove / Delete ───────────────────────────────────────────────
        if (matches('remove')) {
            const clip = activeClip || (clips.length === 1 ? clips[0] : null);
            if (!clip) {
                return this.needsClarification('Which clip should I remove? Please select one.');
            }
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.REMOVE_CLIP, {
                targets: [clip.id],
                target_track_id: clip.trackId
            });
        }

        // ── Transitions ───────────────────────────────────────────────────
        if (matches('transition')) {
            return this.parseTransitionIntent(lower, activeClip);
        }

        // ── Filter / Effects ──────────────────────────────────────────────
        if (matches('filter')) {
            return this.parseFilterIntent(lower, activeClip);
        }

        // ── Color grading ─────────────────────────────────────────────────
        if (matches('color')) {
            return this.parseColorIntent(lower, activeClip);
        }

        // ── Text overlays ─────────────────────────────────────────────────
        if (matches('text')) {
            return this.parseTextIntent(lower);
        }

        // ── Volume ────────────────────────────────────────────────────────
        if (matches('volume')) {
            return this.parseVolumeIntent(lower, activeClip);
        }

        // ── Duplicate ─────────────────────────────────────────────────────
        if (matches('duplicate')) {
            const clip = activeClip || (clips.length === 1 ? clips[0] : null);
            if (!clip) {
                return this.needsClarification('Which clip should I duplicate?');
            }
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.DUPLICATE_CLIP, {
                targets: [clip.id]
            });
        }

        // ── Creative / Viral / Improve ────────────────────────────────────
        if (matches('viral')) {
            const platform = this.inferPlatform(lower);
            if (platform) {
                return {
                    needs_clarification: true,
                    reason: `Making it viral for ${platform}. Should we keep the same duration, or shorten it for higher retention?`,
                    intent: INTENT_TYPES.OPTIMIZE,
                    operation: OPERATIONS.PLATFORM_OPTIMIZE,
                    targets: [],
                    constraints: { platform },
                    confidence: 'MEDIUM',
                    missingParameters: ['targetDuration', 'style']
                };
            }
            return {
                needs_clarification: true,
                reason: `Which platform is this for?\n1️⃣ TikTok / Reels\n2️⃣ YouTube Shorts\n3️⃣ YouTube (long-form)`,
                intent: INTENT_TYPES.OPTIMIZE,
                operation: OPERATIONS.PLATFORM_OPTIMIZE,
                targets: [],
                constraints: {},
                confidence: 'LOW',
                missingParameters: ['platform', 'targetDuration', 'style']
            };
        }

        if (matches('improve')) {
            return {
                needs_clarification: true,
                reason: `I can improve this! Is this primarily for:\n1️⃣ TikTok / Reels\n2️⃣ YouTube Shorts\n3️⃣ Regular YouTube`,
                intent: INTENT_TYPES.CREATIVE_EDIT,
                operation: OPERATIONS.CREATIVE_ENHANCE,
                targets: [],
                constraints: {},
                confidence: 'LOW',
                missingParameters: ['platform', 'style', 'strategies']
            };
        }

        // ── Could not parse ────────────────────────────────────────────────
        return this.needsClarification(
            `I didn't quite understand that. Try something like:\n• "split the clip in half"\n• "remove silence"\n• "speed up 2x"\n• "make it vertical (9:16)"\n• "trim to 30 seconds"\n• "export the video"`
        );
    }

    // ─────────────────────────────────────────────────────────────────────
    // TRIM INTENT ─ handles "make it shorter", "remove the beginning", etc.
    // ─────────────────────────────────────────────────────────────────────
    static parseTrimIntent(prompt, clip, context) {
        const duration = this.extractDuration(prompt);
        const targetDuration = this.extractTargetDuration(prompt);

        // "trim to X seconds" or "cut to X seconds"
        if (targetDuration !== null) {
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                targets: [clip.id],
                target_track_id: clip.trackId,
                constraints: { targetDuration, from: 'end' }
            });
        }

        // "trim X seconds from the start/end"
        if (duration !== null) {
            const from = this.extractTrimFrom(prompt);
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                targets: [clip.id],
                target_track_id: clip.trackId,
                constraints: { duration, from }
            });
        }

        // "make it shorter" — ask how much
        if (/shorter|shorten|trim|tighten/i.test(prompt) && duration === null) {
            // Default: trim 20% from end
            const defaultTrim = clip.duration ? clip.duration * 0.2 : 2;
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                targets: [clip.id],
                target_track_id: clip.trackId,
                constraints: { duration: defaultTrim, from: 'end' }
            });
        }

        return this.needsClarification('How much should I trim? (e.g., "trim 5 seconds from the end")');
    }

    // ─────────────────────────────────────────────────────────────────────
    // NLE EXPORT INTENT
    // ─────────────────────────────────────────────────────────────────────
    static parseNLEExportIntent(prompt) {
        let nleTarget = null;

        if (/premiere/i.test(prompt)) nleTarget = 'premiere';
        else if (/final.?cut|fcpx/i.test(prompt)) nleTarget = 'finalcut';
        else if (/davinci|resolve/i.test(prompt)) nleTarget = 'davinci';
        else if (/capcut/i.test(prompt)) nleTarget = 'capcut';

        if (!nleTarget) {
            return {
                needs_clarification: true,
                reason: `Which software should I export for?\n1️⃣ Premiere Pro\n2️⃣ Final Cut Pro\n3️⃣ DaVinci Resolve\n4️⃣ CapCut`,
                intent: INTENT_TYPES.EXPORT,
                operation: 'nle_export',
                targets: [],
                constraints: {},
                confidence: 'LOW',
                missingParameters: ['nleTarget']
            };
        }

        return this.createIntent(INTENT_TYPES.EXPORT, 'nle_export', {
            constraints: { nleTarget }
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // INTENT PARSERS (kept & enhanced from original)
    // ─────────────────────────────────────────────────────────────────────
    static parseSplitIntent(prompt, activeClip, context) {
        const clip = activeClip || (context?.clips?.length === 1 ? context.clips[0] : null);
        if (!clip) {
            return this.needsClarification('Which clip should I split? Please select a clip first.');
        }

        let mode = null;
        if (/half|middle|midpoint|in\s?2|in two|50[%]?/.test(prompt)) mode = 'midpoint';
        else if (/third|in\s?3|in three|33[%]?/.test(prompt)) mode = 'thirds';
        else if (/quarter|in\s?4|in four|25[%]?/.test(prompt)) mode = 'quarters';
        else if (/playhead|current position|here|at this point/.test(prompt)) mode = 'playhead';
        else mode = 'midpoint'; // Default to midpoint if unspecified

        const timestamp = this.extractExplicitTimestamp(prompt);
        if (timestamp !== null) mode = 'timestamp';

        return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SPLIT_CLIP, {
            targets: [clip.id],
            target_track_id: clip.trackId,
            constraints: { mode, ...(timestamp !== null && { timestamp }) }
        });
    }

    static parseCutIntent(prompt, activeClip, context) {
        const clip = activeClip || (context?.clips?.length === 1 ? context.clips[0] : null);

        // "cut to X seconds" = trim
        if (/\bto\b/.test(prompt)) {
            const targetDuration = this.extractTargetDuration(prompt);
            if (targetDuration !== null && clip) {
                return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                    targets: [clip.id],
                    target_track_id: clip?.trackId,
                    constraints: { targetDuration, from: 'end' }
                });
            }
        }

        // "cut out [range]"
        if (/out|remove|delete/.test(prompt)) {
            const range = this.extractTimeRange(prompt);
            if (range) {
                return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_SEGMENT, {
                    constraints: { start: range.start, end: range.end }
                });
            }
        }

        // Cut at playhead
        if (/here|playhead|current/.test(prompt)) {
            return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_AT_PLAYHEAD, {
                targets: clip ? [clip.id] : []
            });
        }

        // Cut at timestamp
        const timestamp = this.extractExplicitTimestamp(prompt);
        if (timestamp !== null) {
            return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_AT_TIMESTAMP, {
                targets: clip ? [clip.id] : [],
                constraints: { timestamp }
            });
        }

        // Default: split at midpoint
        if (clip) {
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SPLIT_CLIP, {
                targets: [clip.id],
                target_track_id: clip.trackId,
                constraints: { mode: 'playhead' }
            });
        }

        return this.needsClarification('How should I cut? (e.g., "cut at playhead", "cut at 0:30", "cut to 3 seconds")');
    }

    static parseTransitionIntent(prompt, activeClip) {
        const type = this.extractTransitionType(prompt);
        const duration = this.extractDuration(prompt) || 0.5;
        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADD_TRANSITION, {
            targets: activeClip ? [activeClip.id] : [],
            constraints: { type, duration }
        });
    }

    static parseFilterIntent(prompt, activeClip) {
        const filterType = this.extractFilterType(prompt);
        const intensity = this.extractIntensity(prompt);
        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADD_FILTER, {
            targets: activeClip ? [activeClip.id] : [],
            constraints: { type: filterType, intensity }
        });
    }

    static parseTextIntent(prompt) {
        const textMatch = prompt.match(/["']([^"']+)["']/);
        if (textMatch) {
            return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADD_TEXT, {
                constraints: { text: textMatch[1] }
            });
        }
        // Extract text after "add text/caption/title"
        const textAfterKeyword = prompt.replace(/add\s+(text|title|caption|subtitle)[:\-]?\s*/i, '').trim();
        if (textAfterKeyword && textAfterKeyword.length > 0 && textAfterKeyword !== prompt.toLowerCase()) {
            return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADD_TEXT, {
                constraints: { text: textAfterKeyword }
            });
        }
        return this.needsClarification('What text should I add? (e.g., \'add title "Hello World"\')');
    }

    static parseVolumeIntent(prompt, activeClip) {
        if (/mute|silence the audio|no audio/.test(prompt)) {
            return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADJUST_VOLUME, {
                targets: activeClip ? [activeClip.id] : [],
                constraints: { volume: 0 }
            });
        }
        const volume = this.extractVolume(prompt);
        if (volume !== null) {
            return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADJUST_VOLUME, {
                targets: activeClip ? [activeClip.id] : [],
                constraints: { volume }
            });
        }
        return this.needsClarification('What volume level? (e.g., "50%", "louder", "mute")');
    }

    static parseColorIntent(prompt, activeClip) {
        const adjustments = {};
        if (/saturation/.test(prompt)) adjustments.saturation = this.extractPercentage(prompt) || 100;
        if (/brightness/.test(prompt)) adjustments.brightness = this.extractPercentage(prompt) || 100;
        if (/contrast/.test(prompt)) adjustments.contrast = this.extractPercentage(prompt) || 100;
        if (/warm/.test(prompt)) adjustments.temperature = 30;
        if (/cool/.test(prompt)) adjustments.temperature = -30;

        if (Object.keys(adjustments).length === 0) {
            return this.needsClarification('What color adjustments? (e.g., "increase saturation", "add warmth")');
        }
        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.COLOR_GRADE, {
            targets: activeClip ? [activeClip.id] : [],
            constraints: adjustments
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // EXTRACTORS
    // ─────────────────────────────────────────────────────────────────────
    static extractExplicitTimestamp(prompt) {
        const timeMatch = prompt.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (timeMatch) {
            const h = timeMatch[3] ? parseInt(timeMatch[1]) : 0;
            const m = timeMatch[3] ? parseInt(timeMatch[2]) : parseInt(timeMatch[1]);
            const s = timeMatch[3] ? parseInt(timeMatch[3]) : parseInt(timeMatch[2]);
            return h * 3600 + m * 60 + s;
        }
        const secMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        if (secMatch) return parseFloat(secMatch[1]);
        return null;
    }

    static extractTargetDuration(prompt) {
        // "to X seconds" / "cut to X" / "trim to X"
        const toMatch = prompt.match(/(?:to|at|=)\s*(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        if (toMatch) return parseFloat(toMatch[1]);
        // "X second clip"
        const clipMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:second|sec)\s*(?:clip|long|video)/i);
        if (clipMatch) return parseFloat(clipMatch[1]);
        // "X min"
        const minMatch = prompt.match(/(?:to|at)\s*(\d+(?:\.\d+)?)\s*(?:minute|min)/i);
        if (minMatch) return parseFloat(minMatch[1]) * 60;
        return null;
    }

    static extractTrimFrom(prompt) {
        if (/start|beginning|front|head/.test(prompt)) return 'start';
        return 'end';
    }

    static extractTimeRange(prompt) {
        const rangeMatch = prompt.match(/(?:from\s+)?(\d{1,2}:\d{2})\s+(?:to|until|-)\s+(\d{1,2}:\d{2})/);
        if (rangeMatch) {
            return {
                start: this.parseTimeString(rangeMatch[1]),
                end: this.parseTimeString(rangeMatch[2])
            };
        }
        return null;
    }

    static parseTimeString(timeStr) {
        const parts = timeStr.split(':').map(Number);
        return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    static extractDuration(prompt) {
        const match = prompt.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        return match ? parseFloat(match[1]) : null;
    }

    static extractSpeed(prompt) {
        if (/double|2x speed/.test(prompt)) return 2.0;
        if (/half speed|50%\s*speed|0\.5x/.test(prompt)) return 0.5;
        if (/triple|3x/.test(prompt)) return 3.0;
        if (/quarter speed|0\.25x/.test(prompt)) return 0.25;
        if (/slow.?motion|slo.?mo/.test(prompt)) return 0.5;
        if (/timelapse|time.?lapse/.test(prompt)) return 4.0;
        if (/1\.5x/.test(prompt)) return 1.5;
        if (/4x/.test(prompt)) return 4.0;
        // Generic "faster" / "speed up" without value → 2x
        if (/speed up|faster|make.+faster|make.+quicker/.test(prompt)) return 2.0;
        // Generic "slower" / "slow down" → 0.5x
        if (/slow down|slower|make.+slower/.test(prompt)) return 0.5;

        const match = prompt.match(/(\d+(?:\.\d+)?)\s*x/);
        return match ? parseFloat(match[1]) : null;
    }

    static extractAspectRatio(prompt) {
        if (/9[:\s]?16|vertical|portrait|tiktok|reel|shorts/.test(prompt)) return '9:16';
        if (/16[:\s]?9|horizontal|landscape|youtube|widescreen/.test(prompt)) return '16:9';
        if (/1[:\s]?1|square|instagram/.test(prompt)) return '1:1';
        if (/4[:\s]?3/.test(prompt)) return '4:3';
        if (/21[:\s]?9|ultrawide|cinematic/.test(prompt)) return '21:9';
        return '16:9';
    }

    static extractSilenceThreshold(prompt) {
        const match = prompt.match(/-?\d+\s*dB/i);
        return match ? match[0] : '-30dB';
    }

    static extractExportFormat(prompt) {
        if (/mp4/.test(prompt)) return 'mp4';
        if (/mov/.test(prompt)) return 'mov';
        if (/webm/.test(prompt)) return 'webm';
        if (/gif/.test(prompt)) return 'gif';
        return 'mp4';
    }

    static extractQuality(prompt) {
        if (/4k|2160/.test(prompt)) return '4k';
        if (/1080|full hd/.test(prompt)) return '1080p';
        if (/720|hd/.test(prompt)) return '720p';
        if (/480/.test(prompt)) return '480p';
        return '1080p';
    }

    static extractTransitionType(prompt) {
        if (/dissolve|crossfade|cross.?fade/.test(prompt)) return 'dissolve';
        if (/wipe/.test(prompt)) return 'wipe';
        if (/slide/.test(prompt)) return 'slide';
        if (/zoom/.test(prompt)) return 'zoom';
        if (/fade/.test(prompt)) return 'fade';
        return 'fade';
    }

    static extractFilterType(prompt) {
        if (/blur/.test(prompt)) return 'blur';
        if (/sharpen/.test(prompt)) return 'sharpen';
        if (/vignette/.test(prompt)) return 'vignette';
        if (/black.?and.?white|b.?&.?w|grayscale|desaturate/.test(prompt)) return 'grayscale';
        if (/sepia/.test(prompt)) return 'sepia';
        return 'none';
    }

    static extractIntensity(prompt) {
        const match = prompt.match(/(\d+)\s*%/);
        return match ? parseInt(match[1]) / 100 : 0.5;
    }

    static extractVolume(prompt) {
        if (/louder|turn up|boost|increase|raise/.test(prompt)) return 1.5;
        if (/quieter|softer|turn down|lower|decrease/.test(prompt)) return 0.5;
        const match = prompt.match(/(\d+)\s*%/);
        return match ? parseInt(match[1]) / 100 : null;
    }

    static extractPercentage(prompt) {
        const match = prompt.match(/(\d+)\s*%/);
        return match ? parseInt(match[1]) : null;
    }

    static inferPlatform(prompt) {
        if (/tiktok|tik.?tok/.test(prompt)) return 'TikTok';
        if (/reel|reels/.test(prompt)) return 'Instagram Reels';
        if (/shorts|youtube.?short/.test(prompt)) return 'YouTube Shorts';
        if (/youtube/.test(prompt)) return 'YouTube';
        if (/instagram|insta/.test(prompt)) return 'Instagram';
        if (/twitter|x\.com/.test(prompt)) return 'Twitter/X';
        if (/podcast/.test(prompt)) return 'Podcast';
        return null;
    }

    static _extractTargetDuration(prompt) {
        const minMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:minute|min)/i);
        if (minMatch) return parseFloat(minMatch[1]) * 60;
        const secMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        if (secMatch) return parseFloat(secMatch[1]);
        const hourMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hr)/i);
        if (hourMatch) return parseFloat(hourMatch[1]) * 3600;
        return null;
    }

    // ─────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────
    static matchesPattern(text, patterns) {
        return patterns.some(p => text.includes(p));
    }

    static createIntent(intent, operation, extras = {}) {
        const baseIntent = {
            intent,
            operation,
            targets: extras.targets || [],
            target_track_id: extras.target_track_id || null,
            constraints: extras.constraints || {},
            needs_clarification: false
        };

        const validation = IntentValidator.validate({
            operation,
            parameters: {
                ...baseIntent.constraints,
                targets: baseIntent.targets,
                clipId: baseIntent.targets[0],
                trimType: baseIntent.constraints.from
            }
        });

        return {
            ...baseIntent,
            confidence: validation.confidence,
            missingParameters: validation.missingParameters
        };
    }

    static needsClarification(reason) {
        return {
            needs_clarification: true,
            reason,
            intent: null,
            operation: null,
            targets: [],
            constraints: {}
        };
    }

    static validateAndNormalize(result) {
        return {
            intent: result.intent || null,
            operation: result.operation || null,
            targets: result.targets || [],
            target_track_id: result.target_track_id || null,
            constraints: result.constraints || {},
            needs_clarification: result.needs_clarification || false,
            reason: result.reason || null,
            confidence: result.confidence || (result.needs_clarification ? 'LOW' : 'HIGH'),
            missingParameters: result.missingParameters || []
        };
    }
}

export default IntentParser;