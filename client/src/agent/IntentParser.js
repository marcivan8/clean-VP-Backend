/**
 * IntentParser
 *
 * FIX: parseViaAPI() was calling fetch('/api/ai/parse-intent', ...) without an
 *      Authorization header. In production all /api/* routes require a Supabase
 *      JWT Bearer token. The 401 response caused the parser to fall through to
 *      FallbackParser → localParse, which mis-classified many prompts and started
 *      the clarification loop with no way out.
 *
 *      All fetch() calls replaced with authFetch().
 */

import { authFetch } from '../utils/authFetch.js';
import { ContextGenerator } from './ContextGenerator.js';
import { FallbackParser } from './FallbackParser.js';
import { EventBus, EVENT_TYPES } from './EventBus.js';
import { IntentValidator } from './IntentValidator.js';
import { INTENT_TYPES, OPERATIONS } from './CommandConstants.js';
import { extractEditIntent } from '../utils/nlpFallback.js';
import useAIStore from '../store/useAIStore.js';

export { INTENT_TYPES, OPERATIONS };

const NLP_MAP = {
    split: [
        'split', 'divide', 'cut in half', 'cut in two', 'cut into two',
        'chop in half', 'break in half', 'break apart', 'separate',
        'slice', 'bisect', 'split it', 'split the clip', 'split this clip',
        'split the video', 'cut this in half', 'cut it in half',
        'cut down the middle', 'halve it', 'halve the clip',
    ],
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
    speed: [
        'speed', 'speed up', 'faster', 'fast forward', 'slow down',
        'slower', 'slow motion', 'slowmo', 'slo-mo', 'timelapse',
        'time lapse', 'speed change', 'change speed', 'set speed',
        'make it faster', 'make it slower', 'double speed', 'half speed',
        'speed it up', 'slow it down', '2x', '0.5x', '1.5x',
        'make faster', 'make slower', 'play faster', 'play slower',
        'speed this up', 'slow this down',
    ],
    silence: [
        'silence', 'remove silence', 'cut silence', 'delete silence',
        'remove silences', 'remove dead air', 'cut dead air',
        'remove pauses', 'cut pauses', 'remove quiet parts',
        'clean up audio', 'tighten audio', 'remove gaps',
        'no silence', 'without silence', 'kill the silence',
        'eliminate silence', 'trim silence', 'auto trim',
    ],
    aspect: [
        'vertical', 'horizontal', 'square', 'portrait', 'landscape',
        'aspect ratio', 'aspect', '9:16', '16:9', '1:1', '4:3', '21:9',
        'tiktok format', 'reels format', 'youtube format', 'widescreen',
        'change format', 'format for', 'resize for', 'convert to vertical',
        'convert to horizontal', 'make it vertical', 'make it horizontal',
        'instagram format', 'twitter format', 'cinematic',
    ],
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
    undo: [
        'undo', 'go back', 'revert', 'take that back', 'undo that',
        'undo last', 'undo the last', 'undo action', 'ctrl z',
    ],
    redo: [
        'redo', 'redo that', 'redo last', 'redo action', 'ctrl y',
    ],
    export: [
        'export', 'render', 'save', 'save as', 'download', 'finish',
        'export video', 'render video', 'finalize', 'publish',
        'save the video', 'export the video', 'create the video',
        'generate the video', 'output', 'produce',
    ],
    duplicate: [
        'duplicate', 'copy', 'clone', 'repeat', 'copy clip',
        'duplicate clip', 'make a copy', 'copy this clip',
    ],
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
        // Generic clip cleaning (most common user phrasing)
        'clean this clip', 'clean the clip', 'clean this video', 'clean the video',
        'clean it up', 'clean it', 'clean up this clip', 'clean up the clip',
        'make it clean', 'clean up my clip', 'clean up the video',
        // Podcast / interview context
        'clean this podcast', 'clean the podcast', 'edit the podcast',
        'clean up the interview', 'edit this interview', 'clean up the recording',
        'tighten up the interview', 'tighten the podcast', 'clean up this recording',
        'clean the recording', 'edit my podcast',
    ],
    rhythmZoom: [
        // Direct phrasing users actually say
        'make it more dynamic', 'more dynamic', 'make it dynamic',
        'make this clip more dynamic', 'make this more dynamic', 'make the clip more dynamic',
        // Multi-camera / zoom rhythm vocabulary
        'zoom rhythm', 'rhythm zoom', 'add zoom rhythm', 'camera rhythm', 'add rhythm',
        'multi camera', 'multi-camera', 'multicam', 'multi-cam',
        'make it feel multi', 'simulate multi', 'fake multi',
        'make it feel like multi-camera', 'make it feel like multi camera',
        // Engagement / style
        'vlog style', 'dynamic style', 'talking head style',
        'make it more engaging', 'more engaging', 'keep viewers', 'hold attention',
        'boost engagement',
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
    reorderClips: [
        'reorder clips', 'reorder the clips', 'rearrange clips', 'rearrange the clips',
        'put the best', 'put the hook', 'put the most important',
        'move the strongest', 'lead with', 'start with',
    ],
    reorganize: [
        'reorganize', 're-organize', 'reorganise', 'reorganize the',
        'restructure', 'restructure the', 'rearrange', 'rearrange the',
        'reorder by', 'order by topic', 'group by topic', 'order by theme',
    ],
    reorderSegments: [
        'reorder segments', 'rearrange segments', 'reorder the segments',
        'change the order', 'swap the order', 'flip the order',
        'put this first', 'put that first', 'move to front',
    ],
    fillerWords: [
        'filler', 'filler words', 'um', 'uh', 'ums', 'uhs', 'stutter',
        'clean up speech', 'remove hesitations', 'remove filler',
    ],
    extractHighlights: [
        'extract', 'pull out', 'find stories', 'personal stories', 'anecdotes',
        'best parts', 'best moments', 'best clips', 'highlight', 'highlights',
        'highlight reel', 'quotable', 'quotable moments', 'key moments',
        'extract segments', 'find segments', 'extract clips',
        'short video', 'short form', 'repurpose', 'clips for social',
        'most engaging', 'impactful moments', 'memorable parts',
    ],
    conversational: [
        'what is this', "what's this", 'what is the', 'tell me about',
        'what did', 'what does', 'who is', 'who are', 'where is', 'where does',
        'how does', 'why does', 'explain', 'describe',
        'what are the', 'how many', 'show me', 'give me a summary',
    ],
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
    nleExport: [
        'export for premiere', 'export for premiere pro', 'export to premiere',
        'premiere pro format', 'premiere export', 'send to premiere',
        'export for final cut', 'export for fcpx', 'export to final cut',
        'final cut format', 'fcpx format', 'final cut pro',
        'export for davinci', 'export for davinci resolve', 'export to davinci',
        'davinci format', 'davinci resolve format', 'resolve format',
        'export for resolve', 'export xml', 'export fcpxml',
        'export project file', 'export to nle', 'nle export',
        'export otio', 'export as otio', 'export to otio',
        'opentimelineio', 'open timeline io', 'otio format',
        'universal export', 'export universal',
    ],
    ripple: [
        'ripple delete', 'close gap', 'ripple cut', 'delete and close',
        'ripple', 'remove gap', 'collapse', 'shift delete'
    ],
    normalizeAudio: [
        'normalize', 'normalize audio', 'level audio', 'audio level',
        'match volume', 'standardize audio'
    ],
    // ── Auto-captions: must be a dedicated category so it is caught BEFORE
    // the generic 'text' category, which maps to add_text_overlay.
    autoCaptions: [
        'add captions', 'add caption', 'auto captions', 'auto caption',
        'captions', 'generate captions', 'add subtitles', 'subtitles',
        'transcribe', 'transcription', 'closed captions', 'cc captions',
        'burn in captions', 'burn captions', 'caption the video',
        'subtitle the video', 'add closed captions', 'create captions',
        'transcript', 'generate transcript', 'generate the transcript',
        'create transcript', 'make transcript', 'run transcript',
        'get transcript', 'show transcript', 'extract transcript',
    ],
};

// System prompt lives server-side in controllers/aiAgentController.js (parseIntentHandler).
// It is never sent from the client — only { prompt, context, conversationHistory } are posted.

export class IntentParser {
    static async parse(userPrompt, signal = null) {
        console.log('[IntentParser] Parsing:', userPrompt);

        if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
            return this.needsClarification('Empty or invalid input');
        }

        const prompt = userPrompt.trim();
        const structuredContext = ContextGenerator.getStructuredContext();

        // ── Fast local-first check ───────────────────────────────────────────────────────────────
        // For deterministic single-operation commands (captions, silence, filler
        // words, undo/redo, export) we skip the API entirely. This avoids GPT
        // conversation-history pollution that can misclassify clear commands
        // (e.g. "add captions" being returned as "remove_filler_words" when the
        // prior turn involved filler detection).
        const localFirst = this.tryLocalFirst(prompt);
        if (localFirst) {
            console.log('[IntentParser] Local-first match (skipped API):', localFirst.operation);
            return this.validateAndNormalize(localFirst);
        }

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

    /**
     * Deterministic local-first parser for unambiguous single-operation commands.
     * Returns a result if the prompt clearly maps to one operation, null otherwise.
     * Runs BEFORE the API call to prevent conversation-history contamination.
     */
    static tryLocalFirst(prompt) {
        const lower = prompt.toLowerCase().trim();
        const matches = (category) =>
            NLP_MAP[category]?.some(phrase => lower === phrase || lower.startsWith(phrase + ' ') || lower.endsWith(' ' + phrase) || lower.includes(' ' + phrase + ' ')) ?? false;

        // ── Caption / transcription (highest priority — most misclassified) ──
        if (matches('autoCaptions')) {
            return {
                intent: 'edit',
                operation: 'auto_captions',
                parameters: {},
                confidence: 'HIGH',
                missingParameters: []
            };
        }

        // ── Undo / Redo (always deterministic) ──
        if (matches('undo')) return { intent: 'undo', operation: 'undo_action', parameters: {}, confidence: 'HIGH', missingParameters: [] };
        if (matches('redo')) return { intent: 'redo', operation: 'redo_action', parameters: {}, confidence: 'HIGH', missingParameters: [] };

        // ── Silence removal (unambiguous verb + object) ──
        if (lower.match(/^(remove|cut|delete|trim)\s+(silence|silences|dead\s*air|pauses|quiet\s*parts|gaps)$/)) {
            return { intent: 'edit', operation: 'silence_removal', parameters: { threshold: '-30dB' }, confidence: 'HIGH', missingParameters: [] };
        }

        // ── Filler words (unambiguous) ──
        if (lower.match(/^(remove|cut|delete)\s+(filler|filler\s*words?|ums?|uhs?|hesitations?)$/)) {
            return { intent: 'edit', operation: 'remove_filler_words', parameters: {}, confidence: 'HIGH', missingParameters: [] };
        }

        // ── Compound: "clean AND dynamic" — run both ops in one plan ──────────
        // Detect presence of both a cleaning intent and a dynamic/zoom-rhythm intent.
        const hasCleanToken  = /\b(clean|remove\s+silence|filler)\b/.test(lower);
        const hasDynamicToken = /\b(dynamic|zoom\s*rhythm|multi[\s-]?cam(era)?|multicam|make\s+it\s+(more\s+)?engaging)\b/.test(lower);
        if (hasCleanToken && hasDynamicToken) {
            return {
                intent: 'edit',
                operation: 'compound_clean_dynamic',
                parameters: { style: 'dynamic' },
                confidence: 'HIGH',
                missingParameters: []
            };
        }

        // ── Rhythm zoom / multi-camera feel (unambiguous dynamic commands) ────
        if (matches('rhythmZoom')) {
            return {
                intent: 'edit',
                operation: 'rhythm_zoom',
                parameters: { style: 'dynamic' },
                confidence: 'HIGH',
                missingParameters: []
            };
        }

        // ── Generic clip cleaning (clean it up / clean this clip / etc.) ──────
        if (matches('cleanEdit')) {
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

        return null; // let the API handle it
    }

    static async parseViaAPI(prompt, context, signal) {
        const controller = new AbortController();
        // Default timeout — must be long enough for Whisper + GPT on a 30-min video.
        // Previous value (30s) was too short: heavy jobs like caption/filler-detect
        // take 60-120s on large files, causing TIMEOUT → invalid-transition spam.
        const DEFAULT_TIMEOUT_MS = 180000; // 3 minutes
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
        if (signal) signal.addEventListener('abort', () => controller.abort());

        // Build conversation history from the AI log so the model understands
        // prior exchanges in the same session. We include the last 10 entries
        // (5 turns) of user ↔ assistant pairs — excluding step/warning noise.
        const conversationHistory = (() => {
            const logs = useAIStore.getState().logs;
            const relevant = logs.filter(l =>
                (l.type === 'info' && l.message?.startsWith('You: ')) ||
                l.type === 'assistant' ||
                l.type === 'success'
            );
            // Drop the last entry if it IS the current prompt (just added before this call)
            const withoutCurrent = relevant.length > 0 &&
                relevant[relevant.length - 1].message === `You: ${prompt}`
                    ? relevant.slice(0, -1)
                    : relevant;
            return withoutCurrent.slice(-10).map(l => ({
                role: (l.type === 'info') ? 'user' : 'assistant',
                content: (l.type === 'info') ? l.message.replace(/^You:\s*/, '') : l.message
            }));
        })();

        try {
            // FIX: was fetch('/api/ai/parse-intent', ...) — no auth → 401 in production
            const response = await authFetch('/api/ai/parse-intent', {
                method: 'POST',
                body: JSON.stringify({ prompt, context, conversationHistory }),
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
                    intentDraft: result.intentDraft || null,
                    originalPrompt: prompt
                };
            }
            return result;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    static localParse(prompt, context) {
        const lower = prompt.toLowerCase().trim();
        const clips = context?.clips || [];
        const activeClip = clips.find(c => c.isActive);
        
        const nlpParsed = extractEditIntent(prompt);
        if (nlpParsed.verbs.length > 0) {
            console.log('[IntentParser] localParse (compromise nlp fallback) detected:', nlpParsed);
        }

        const matches = (category) =>
            NLP_MAP[category]?.some(phrase => lower.includes(phrase)) ?? false;

        if (matches('nleExport')) return this.parseNLEExportIntent(lower);

        // ── Caption / transcription — highest priority in localParse too.
        // tryLocalFirst handles the direct case; this covers re-parses that come
        // through resumeJob (where the prompt is a combined string like
        // "generate the transcript. Clarification answers: {...}").
        if (matches('autoCaptions')) {
            return this.createIntent(INTENT_TYPES.EDIT, 'auto_captions', { constraints: {} });
        }

        // Pure conversational questions → route directly to CHAT, never spin up the pipeline.
        if (matches('conversational') && !matches('extractHighlights') && !matches('silence')
            && !matches('fillerWords') && !matches('analyze') && !matches('buildFromRushes')) {
            return { ...this.createIntent(INTENT_TYPES.CHAT, OPERATIONS.CHAT, {}), message: null };
        }

        // "extract personal stories" / "best parts for social" etc.
        // Maps to long_form_edit so clips are actually cut onto the timeline.
        // analyze_structure only summarises — it never changes the timeline.
        if (matches('extractHighlights')) {
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.LONG_FORM_EDIT, {
                constraints: {
                    editMode: 'CLEAN_EDIT',
                    focus: 'highlights',
                    platform: this.inferPlatform(lower),
                    targetDuration: this._extractTargetDuration(lower),
                }
            });
        }

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
                constraints: { editMode: 'CLEAN_EDIT', platform: this.inferPlatform(lower) || 'podcast' }
            });
        }

        // ── Rhythm zoom / dynamic multi-camera feel ────────────────────────────
        if (matches('rhythmZoom')) {
            return {
                intent: 'edit',
                operation: 'rhythm_zoom',
                parameters: { style: 'dynamic' },
                targets: [],
                constraints: { style: 'dynamic' },
                confidence: 'HIGH',
                missingParameters: [],
                needs_clarification: false,
            };
        }

        // ── Compound clean + dynamic ───────────────────────────────────────────
        {
            const hasClean   = lower.includes('clean') || lower.includes('remove silence');
            const hasDynamic = lower.includes('dynamic') || lower.includes('zoom rhythm')
                            || lower.includes('multi-camera') || lower.includes('multicam');
            if (hasClean && hasDynamic) {
                return {
                    intent: 'edit',
                    operation: 'compound_clean_dynamic',
                    parameters: { style: 'dynamic' },
                    targets: [],
                    constraints: { style: 'dynamic' },
                    confidence: 'HIGH',
                    missingParameters: [],
                    needs_clarification: false,
                };
            }
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
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.LONG_FORM_EDIT, { constraints: { editMode: 'SMART_CLEANUP' } });
        }

        if (matches('reorderClips') || matches('reorganize') || matches('reorderSegments')) {
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.REORDER_CLIPS, { constraints: { prompt: lower } });
        }

        if (matches('undo')) return this.createIntent(INTENT_TYPES.UNDO, 'undo_action');
        if (matches('redo')) return this.createIntent(INTENT_TYPES.REDO, 'redo_action');

        if (matches('export')) {
            const format = this.extractExportFormat(lower);
            const quality = this.extractQuality(lower);
            return this.createIntent(INTENT_TYPES.EXPORT, OPERATIONS.EXPORT_VIDEO, {
                constraints: { format, quality }
            });
        }

        if (matches('speed')) {
            const speed = this.extractSpeed(lower);
            if (speed !== null) {
                return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SET_CLIP_SPEED, {
                    targets: activeClip ? [activeClip.id] : [],
                    constraints: { speed }
                });
            }
            return this.needsClarification('What speed? (e.g., "2x faster", "half speed", "0.5x")');
        }

        if (matches('silence')) {
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SILENCE_REMOVAL, {
                constraints: { threshold: this.extractSilenceThreshold(lower) }
            });
        }

        if (matches('fillerWords')) {
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.REMOVE_FILLER_WORDS, {
                targets: activeClip ? [activeClip.id] : [],
                constraints: {}
            });
        }

        if (matches('aspect')) {
            const ratio = this.extractAspectRatio(lower);
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SET_ASPECT_RATIO, {
                constraints: { ratio }
            });
        }

        if (matches('split')) return this.parseSplitIntent(lower, activeClip, context);
        if (matches('cut')) return this.parseCutIntent(lower, activeClip, context);

        if (matches('trim')) {
            if (!activeClip && clips.length === 1) return this.parseTrimIntent(lower, clips[0], context);
            if (!activeClip) return this.needsClarification('Which clip should I trim? Please select a clip first.');
            return this.parseTrimIntent(lower, activeClip, context);
        }

        if (matches('remove')) {
            const clip = activeClip || (clips.length === 1 ? clips[0] : null);
            if (!clip) return this.needsClarification('Which clip should I remove? Please select one.');
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.REMOVE_CLIP, {
                targets: [clip.id],
                target_track_id: clip.trackId
            });
        }

        if (matches('transition')) return this.parseTransitionIntent(lower, activeClip);
        if (matches('filter')) return this.parseFilterIntent(lower, activeClip);
        if (matches('color')) return this.parseColorIntent(lower, activeClip);
        if (matches('text')) return this.parseTextIntent(lower);
        if (matches('volume')) return this.parseVolumeIntent(lower, activeClip);

        if (matches('duplicate')) {
            const clip = activeClip || (clips.length === 1 ? clips[0] : null);
            if (!clip) return this.needsClarification('Which clip should I duplicate?');
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.DUPLICATE_CLIP, { targets: [clip.id] });
        }

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

        if (/what did you|what have you|show me what|what changed|summarize.*(edit|change)|recap/.test(lower)) {
            return this.createIntent(INTENT_TYPES.QUERY, 'query_session_summary', { constraints: {} });
        }

        if (/ease\s*up|less\s*aggressive|too\s*tight|cut\s*too\s*much|breathing\s*room|too\s*fast.*edit|lighten\s*up|back\s*off\s*the\s*cuts/.test(lower)) {
            return {
                intent: INTENT_TYPES.EDIT,
                operation: 'adjust_last_edit',
                targets: [],
                target_track_id: null,
                constraints: { direction: 'softer', referenceJobId: null },
                needs_clarification: false,
                confidence: 'MEDIUM',
                missingParameters: [],
            };
        }

        if (/restore\s+the|put\s+back|bring\s+back|undo\s+(what\s+you|the\s+last|that\s+edit)/.test(lower)) {
            return this.createIntent(INTENT_TYPES.UNDO, 'undo_action', {
                constraints: { scope: 'last_ai_edit' }
            });
        }

        // ── Smart contextual fallback — understand what the user is hinting at ──
        const smart = this._buildContextualSuggestion(lower, context);
        if (smart) return smart;

        return this.needsClarification(
            `Not sure I understood that. Here are some things you can try:\n• "make it more dynamic" — zoom rhythm for engagement\n• "clean this clip" — remove silences and filler words\n• "add captions" — auto-generate subtitles\n• "make it vertical" — convert to 9:16\n• "trim to 60 seconds" — shorten the clip\n• "export the video" — render the final cut`
        );
    }

    /**
     * Returns a conversational chat response when the prompt is a high-level or
     * ambiguous intent that we understood contextually but can't execute blindly.
     * The response tells the user what we detected and asks what they want to do.
     */
    static _buildContextualSuggestion(lower, context) {
        const hasTalkingHead  = /\b(talking[\s-]?head|selfie|on[\s-]?camera|to[\s-]?camera|face[\s-]?cam|presenter|solo|speaker)\b/.test(lower);
        const hasPodcast      = /\b(podcast|interview|conversation|discussion|guest|host)\b/.test(lower);
        const hasVlog         = /\b(vlog|vlogger|daily|lifestyle|travel|diary)\b/.test(lower);
        const hasTutorial     = /\b(tutorial|how[\s-]?to|explainer|lesson|training|course)\b/.test(lower);
        const hasGenericVideo = /\b(clip|video|footage|recording|take)\b/.test(lower);
        const hasEditIntent   = /\b(edit|improve|fix|make|help|work\s+on|do\s+(something|anything)|what\s+can|what\s+should|give\s+me|show\s+me|produce|process)\b/.test(lower);

        const chat = (message) => ({
            intent: INTENT_TYPES.CHAT,
            operation: OPERATIONS.CHAT,
            targets: [],
            constraints: {},
            confidence: 'HIGH',
            missingParameters: [],
            needs_clarification: false,
            message,
        });

        if (hasTalkingHead && hasEditIntent) {
            return chat(
                `I can see this is a talking head clip. Here's what I can do with it:\n\n` +
                `• "make it more dynamic" — adds zoom rhythm for a multi-camera feel\n` +
                `• "clean this clip" — removes silences and filler words\n` +
                `• "add captions" — auto-generates subtitles\n` +
                `• "make it vertical" — converts to 9:16 for TikTok/Reels\n\n` +
                `What would you like to focus on?`
            );
        }

        if (hasPodcast && hasEditIntent) {
            return chat(
                `Got it — a podcast or interview clip. Here's what works best:\n\n` +
                `• "clean this clip" — removes silences and filler words\n` +
                `• "split speakers" — separates host and guest onto different tracks\n` +
                `• "add captions" — auto-generates subtitles\n` +
                `• "make it more dynamic" — adds zoom rhythm between shots\n\n` +
                `Where do you want to start?`
            );
        }

        if (hasVlog && hasEditIntent) {
            return chat(
                `A vlog — nice! Here's what I can do:\n\n` +
                `• "make it more dynamic" — zoom rhythm for energy\n` +
                `• "clean this clip" — silences and filler words removed\n` +
                `• "add captions" — auto-generates subtitles\n` +
                `• "make it vertical" — converts to 9:16 for Reels/TikTok\n\n` +
                `What's the goal?`
            );
        }

        if (hasTutorial && hasEditIntent) {
            return chat(
                `Tutorial content — I can help polish it:\n\n` +
                `• "clean this clip" — removes silences and filler words\n` +
                `• "add captions" — auto-generates subtitles for accessibility\n` +
                `• "make it more dynamic" — zoom rhythm to keep attention\n` +
                `• "trim to 10 minutes" — shorten to a target length\n\n` +
                `What do you want to do?`
            );
        }

        // Generic "edit this video/clip" with no content-type context
        if (hasEditIntent && hasGenericVideo) {
            return chat(
                `Ready to edit! What would you like to focus on?\n\n` +
                `• "make it more dynamic" — zoom rhythm for engagement\n` +
                `• "clean this clip" — silence + filler word removal\n` +
                `• "add captions" — auto-subtitles\n` +
                `• "make it vertical" — convert to 9:16\n` +
                `• "trim to 60 seconds" — shorten the clip\n` +
                `• "export" — render the final video`
            );
        }

        return null; // no context detected — use the generic fallback message
    }

    static parseTrimIntent(prompt, clip, context) {
        const duration = this.extractDuration(prompt);
        const targetDuration = this.extractTargetDuration(prompt);

        if (targetDuration !== null) {
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                targets: [clip.id],
                target_track_id: clip.trackId,
                constraints: { targetDuration, from: 'end' }
            });
        }

        if (duration !== null) {
            const from = this.extractTrimFrom(prompt);
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                targets: [clip.id],
                target_track_id: clip.trackId,
                constraints: { duration, from }
            });
        }

        if (/shorter|shorten|trim|tighten/i.test(prompt) && duration === null) {
            const defaultTrim = clip.duration ? clip.duration * 0.2 : 2;
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                targets: [clip.id],
                target_track_id: clip.trackId,
                constraints: { duration: defaultTrim, from: 'end' }
            });
        }

        return this.needsClarification('How much should I trim? (e.g., "trim 5 seconds from the end")');
    }

    static parseNLEExportIntent(prompt) {
        let nleTarget = null;

        if (/premiere/i.test(prompt)) nleTarget = 'premiere';
        else if (/final.?cut|fcpx/i.test(prompt)) nleTarget = 'fcpx';
        else if (/davinci|resolve/i.test(prompt)) nleTarget = 'resolve';
        else if (/otio|opentimelineio|universal/i.test(prompt)) nleTarget = 'otio';

        if (!nleTarget) {
            return {
                needs_clarification: true,
                reason: `Which software should I export for?\n1️⃣ Premiere Pro\n2️⃣ Final Cut Pro\n3️⃣ DaVinci Resolve\n4️⃣ OpenTimelineIO (universal)`,
                intent: INTENT_TYPES.EXPORT,
                operation: 'nle_export',
                targets: [],
                constraints: {},
                confidence: 'LOW',
                missingParameters: ['nleTarget']
            };
        }

        return this.createIntent(INTENT_TYPES.EXPORT, 'nle_export', { constraints: { nleTarget } });
    }

    static parseSplitIntent(prompt, activeClip, context) {
        const clip = activeClip || (context?.clips?.length === 1 ? context.clips[0] : null);
        if (!clip) return this.needsClarification('Which clip should I split? Please select a clip first.');

        let mode = null;
        if (/half|middle|midpoint|in\s?2|in two|50[%]?/.test(prompt)) mode = 'midpoint';
        else if (/third|in\s?3|in three|33[%]?/.test(prompt)) mode = 'thirds';
        else if (/quarter|in\s?4|in four|25[%]?/.test(prompt)) mode = 'quarters';
        else if (/playhead|current position|here|at this point/.test(prompt)) mode = 'playhead';
        else mode = 'midpoint';

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

        if (/out|remove|delete/.test(prompt)) {
            const range = this.extractTimeRange(prompt);
            if (range) {
                return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_SEGMENT, {
                    constraints: { start: range.start, end: range.end }
                });
            }
        }

        if (/here|playhead|current/.test(prompt)) {
            return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_AT_PLAYHEAD, {
                targets: clip ? [clip.id] : []
            });
        }

        const timestamp = this.extractExplicitTimestamp(prompt);
        if (timestamp !== null) {
            return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_AT_TIMESTAMP, {
                targets: clip ? [clip.id] : [],
                constraints: { timestamp }
            });
        }

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

    // ── Extractors ────────────────────────────────────────────────────────────

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
        const toMatch = prompt.match(/(?:to|at|=)\s*(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        if (toMatch) return parseFloat(toMatch[1]);
        const clipMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:second|sec)\s*(?:clip|long|video)/i);
        if (clipMatch) return parseFloat(clipMatch[1]);
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
        if (/speed up|faster|make.+faster|make.+quicker/.test(prompt)) return 2.0;
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
            message: result.message || null,
            confidence: result.confidence || (result.needs_clarification ? 'LOW' : 'HIGH'),
            missingParameters: result.missingParameters || [],
            originalPrompt: result.originalPrompt || null,
            intentDraft: result.intentDraft || null
        };
    }
}

export default IntentParser;