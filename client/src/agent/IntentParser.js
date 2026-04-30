/**
 * IntentParser — Natural Language → Structured Intent
 *
 * IMPROVEMENTS IN THIS VERSION:
 * - 100+ new natural language patterns across all operation types
 * - "split in half", "cut it in half", "cut in 2" all map to SPLIT MIDPOINT
 * - "slow it down", "slow mo", "timelapse" map to speed changes with sensible defaults
 * - "portrait / vertical / tiktok / reels / shorts" all map to 9:16 ratio
 * - "cut to 30s", "trim to 1 minute", "make it shorter" properly handled
 * - "clean up audio", "fix the sound", "denoise" → audio_denoise
 * - "normalize", "fix audio levels" → normalize_audio
 * - "add captions", "subtitle", "auto-caption" → auto_captions
 * - "remove fillers", "cut out ums" → remove_filler_words
 * - Platform-aware shortcuts ("make it a reel", "format for youtube")
 * - Graceful fallback: never returns null for a recognisable intent
 */

import { ContextGenerator } from './ContextGenerator.js';
import { FallbackParser } from './FallbackParser.js';
import { EventBus, EVENT_TYPES } from './EventBus.js';
import { IntentValidator } from './IntentValidator.js';
import { INTENT_TYPES, OPERATIONS } from './CommandConstants.js';

export { INTENT_TYPES, OPERATIONS };

export class IntentParser {
    /**
     * Parse user prompt into structured intent JSON.
     * @param {string} userPrompt
     * @param {AbortSignal} signal
     * @returns {Promise<object>}
     */
    static async parse(userPrompt, signal = null) {
        console.log('[AG_DEBUG] [IntentParser] Parsing:', userPrompt);

        if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
            return this.needsClarification('Empty or invalid input');
        }

        const prompt = userPrompt.trim();
        const context = ContextGenerator.getTimelineContext();
        const structuredContext = ContextGenerator.getStructuredContext();

        try {
            console.log('[AG_DEBUG] [IntentParser] Attempting API parse...');
            const apiResult = await this.parseViaAPI(prompt, structuredContext, signal);
            if (apiResult) {
                console.log('[AG_DEBUG] [IntentParser] API parse successful:', apiResult.intent);
                return this.validateAndNormalize(apiResult);
            }
        } catch (error) {
            if (signal && signal.aborted) throw error;
            console.warn('[AG_DEBUG] [IntentParser] API unavailable, using local parse. Error:', error.message);
            EventBus.emit(EVENT_TYPES.AI_UNAVAILABLE, { error: error.message, prompt });

            const fallbackResult = FallbackParser.parse(prompt);
            if (fallbackResult) {
                console.log('[AG_DEBUG] [IntentParser] FallbackParser matched:', fallbackResult.action);
                return this.validateAndNormalize({
                    intent: fallbackResult.type,
                    operation: fallbackResult.action,
                    ...fallbackResult,
                    parsedBy: 'fallback',
                    confidence: fallbackResult.confidence === 'high' ? 'HIGH' : 'MEDIUM',
                });
            }
        }

        console.log('[AG_DEBUG] [IntentParser] Trying localParse...');
        return this.localParse(prompt, context);
    }

    // ─────────────────────────────────────────────────────────
    // §1  API PARSING
    // ─────────────────────────────────────────────────────────
    static async parseViaAPI(prompt, context, signal) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        if (signal) signal.addEventListener('abort', () => controller.abort());

        try {
            const response = await fetch('/api/ai/parse-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, context }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) return null;
            const result = await response.json();
            if (result.intent === 'clarification_required') {
                return {
                    needs_clarification: true,
                    reason: result.message,
                    intent: null, operation: null,
                    targets: [], constraints: {},
                    intentDraft: result.intentDraft || null,
                };
            }
            return result;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    // ─────────────────────────────────────────────────────────
    // §2  LOCAL PARSER — the real NLP engine when API is down
    // ─────────────────────────────────────────────────────────
    static localParse(prompt, context) {
        const lp = prompt.toLowerCase().trim();
        const clips = context?.clips || [];
        const activeClip = clips.find(c => c.isActive) || clips[0] || null;

        // ── Long-Form / Structural (checked first — compound intents) ──────

        if (this.matchesAny(lp, [
            'analyze my video', 'analyze this video', 'analyze the content', 'analyze structure',
            'analyse', 'segment the video', 'what is in this video', 'understand this content',
            'break down the video', 'scan the video', 'content analysis',
        ])) {
            const platform = this.inferPlatform(lp);
            return this.createIntent(INTENT_TYPES.ANALYZE, OPERATIONS.ANALYZE_STRUCTURE, {
                constraints: { platform, targetDuration: this.extractTargetDuration(lp) },
            });
        }

        if (this.matchesAny(lp, [
            'find the hook', 'find hook', 'best opening', 'strongest moment',
            'most engaging part', 'what should i use as hook', 'find the best clip',
            'best part', 'most viral moment',
        ])) {
            return this.createIntent(INTENT_TYPES.ANALYZE, OPERATIONS.FIND_HOOK, { constraints: {} });
        }

        if (this.matchesAny(lp, [
            'build a full video', 'build from rushes', 'build from raw', 'assemble the video',
            'edit my rushes', 'edit the rushes', 'compile the footage', 'put together a video',
            'build me a video', 'cut this into a video', 'make a video from this',
        ])) {
            const platform = this.inferPlatform(lp);
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.BUILD_FROM_RUSHES, {
                constraints: { platform, targetDuration: this.extractTargetDuration(lp), editMode: 'FULL_BUILD' },
            });
        }

        if (this.matchesAny(lp, [
            'clean this podcast', 'clean the podcast', 'edit the podcast', 'clean up the interview',
            'edit this interview', 'clean up the recording', 'tighten up the interview',
            'tighten the podcast', 'clean up this recording', 'polish the interview',
        ])) {
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.LONG_FORM_EDIT, {
                constraints: { editMode: 'CLEAN_EDIT', platform: this.inferPlatform(lp) || 'podcast' },
            });
        }

        if (this.matchesAny(lp, [
            'optimize for youtube', 'make a youtube video', 'edit for youtube',
            'youtube long form', 'make it youtube ready', 'build a youtube video',
            'create a youtube video', 'make a full youtube video', 'youtube format',
        ])) {
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.LONG_FORM_EDIT, {
                constraints: {
                    editMode: 'YOUTUBE_OPTIMIZED',
                    platform: 'youtube',
                    targetDuration: this.extractTargetDuration(lp),
                },
            });
        }

        if (this.matchesAny(lp, [
            'remove repetition', 'remove repetitions', 'cut out repetitions',
            'remove duplicate parts', 'cut repeated content', 'remove duplicates',
            'no repeated parts',
        ])) {
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.REMOVE_REPETITION, {
                constraints: {},
            });
        }

        // ── Undo / Redo ────────────────────────────────────────────────────
        if (this.matchesAny(lp, ['undo', 'go back', 'revert last', 'undo that'])) {
            return this.createIntent(INTENT_TYPES.UNDO, 'undo_action');
        }
        if (this.matchesAny(lp, ['redo', 'redo that', 'do it again'])) {
            return this.createIntent(INTENT_TYPES.REDO, 'redo_action');
        }

        // ── Export ─────────────────────────────────────────────────────────
        if (this.matchesAny(lp, [
            'export', 'render', 'save as', 'download', 'export the video',
            'save video', 'output', 'produce', 'generate mp4',
        ])) {
            const format = this.extractExportFormat(lp);
            const quality = this.extractQuality(lp);
            return this.createIntent(INTENT_TYPES.EXPORT, OPERATIONS.EXPORT_VIDEO, {
                constraints: { format, quality },
            });
        }

        // ── Aspect Ratio (checked BEFORE split/cut to catch "crop for tiktok") ──
        if (this.matchesAny(lp, [
            'vertical', 'horizontal', 'square', 'portrait', 'landscape',
            '9:16', '16:9', '1:1', '4:3', '4:5', '21:9',
            'tiktok format', 'reels format', 'shorts format', 'instagram format',
            'make it a reel', 'make it a short', 'convert to tiktok',
            'format for tiktok', 'format for instagram', 'format for youtube',
            'crop for tiktok', 'crop for reels', 'change ratio', 'change aspect',
            'set aspect', 'aspect ratio', 'ultrawide', 'cinematic ratio',
            'widescreen', 'portrait mode', 'landscape mode',
        ])) {
            const ratio = this.extractAspectRatio(lp);
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SET_ASPECT_RATIO, {
                constraints: { ratio },
            });
        }

        // ── Split / Cut ────────────────────────────────────────────────────
        if (this.matchesAny(lp, ['split', 'divide', 'cut in', 'cut it in', 'chop'])) {
            return this.parseSplitIntent(lp, activeClip, context);
        }

        if (lp.includes('cut')) {
            return this.parseCutIntent(lp, activeClip, context);
        }

        // ── Remove / Delete ────────────────────────────────────────────────
        if (this.matchesAny(lp, ['remove clip', 'delete clip', 'erase clip', 'get rid of', 'delete this clip', 'remove this clip'])) {
            if (!activeClip) {
                return this.needsClarification('No clip selected. Which clip should I remove?');
            }
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.REMOVE_CLIP, {
                targets: [activeClip.id],
                target_track_id: activeClip.trackId,
            });
        }

        // ── Silence & Filler Removal ───────────────────────────────────────
        if (this.matchesAny(lp, [
            'silence', 'remove silence', 'cut silence', 'silences', 'dead air',
            'quiet parts', 'gaps in speech', 'pauses', 'remove pauses',
            'cut dead air', 'cut quiet', 'remove gaps',
        ])) {
            const threshold = this.extractSilenceThreshold(lp);
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SILENCE_REMOVAL, {
                constraints: { threshold },
            });
        }

        if (this.matchesAny(lp, [
            'filler words', 'remove fillers', 'cut out ums', 'remove ums',
            'cut the uhs', 'remove uhs', 'filler removal', 'remove filler',
            'ums and uhs', 'cut filler words', 'remove stutters', 'stutter removal',
        ])) {
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.REMOVE_FILLER_WORDS, {
                constraints: {},
            });
        }

        // ── Trim ───────────────────────────────────────────────────────────
        if (this.matchesAny(lp, [
            'trim', 'shorten', 'make it shorter', 'cut it down', 'reduce length',
            'make shorter', 'truncate', 'clip the end', 'clip the start',
        ])) {
            if (!activeClip) {
                return this.needsClarification('No clip selected. Which clip should I trim?');
            }
            const targetDuration = this.extractTargetDuration(lp);
            const duration = this.extractDuration(lp);
            if (!targetDuration && !duration) {
                return this.needsClarification('How much should I trim? (e.g., "trim to 30 seconds", "trim 5 seconds off")');
            }
            const from = lp.includes('start') || lp.includes('beginning') || lp.includes('front') ? 'start' : 'end';
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                targets: [activeClip.id],
                constraints: { duration, targetDuration, from },
            });
        }

        // ── Speed ──────────────────────────────────────────────────────────
        if (this.matchesAny(lp, [
            'speed', 'faster', 'slower', 'slow motion', 'slow mo', 'slomo',
            'slo mo', 'timelapse', 'time lapse', 'speed up', 'slow down',
            'fast forward', 'slow it down', 'speed it up', 'make it faster',
            'make it slower', 'double speed', 'half speed', 'quarter speed',
            'fast cut', 'play faster', 'play slower',
        ])) {
            const speed = this.extractSpeed(lp);
            if (!speed) {
                return this.needsClarification('What speed? (e.g., 2x, 0.5x, slow motion, half speed)');
            }
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SET_CLIP_SPEED, {
                targets: activeClip ? [activeClip.id] : [],
                constraints: { speed },
            });
        }

        // ── Audio Operations ────────────────────────────────────────────────
        if (this.matchesAny(lp, [
            'denoise', 'noise removal', 'remove noise', 'reduce noise', 'background noise',
            'clean up audio', 'clean audio', 'fix the sound', 'fix audio', 'remove hiss',
            'clear up audio', 'audio cleanup', 'clear background noise',
        ])) {
            return this.createIntent(INTENT_TYPES.EDIT, 'audio_denoise', { constraints: {} });
        }

        if (this.matchesAny(lp, [
            'normalize audio', 'normalise audio', 'fix audio levels', 'fix the levels',
            'audio levels', 'level the audio', 'even out audio', 'balance audio',
            'loudness', 'fix volume', 'consistent volume',
        ])) {
            return this.createIntent(INTENT_TYPES.EDIT, 'normalize_audio', { constraints: {} });
        }

        if (this.matchesAny(lp, [
            'volume', 'louder', 'quieter', 'mute', 'audio', 'turn up', 'turn down',
            'increase volume', 'decrease volume', 'boost audio', 'lower audio',
        ])) {
            return this.parseVolumeIntent(lp, activeClip);
        }

        // ── Captions / Subtitles ───────────────────────────────────────────
        if (this.matchesAny(lp, [
            'captions', 'subtitles', 'add captions', 'add subtitles', 'auto captions',
            'auto-caption', 'generate captions', 'transcribe', 'word-by-word',
            'closed captions', 'subtitle the video', 'caption this',
        ])) {
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.AUTO_CAPTIONS, { constraints: {} });
        }

        // ── Effects ─────────────────────────────────────────────────────────
        if (this.matchesAny(lp, ['transition', 'fade', 'dissolve', 'wipe', 'slide transition'])) {
            return this.parseTransitionIntent(lp, activeClip);
        }

        if (this.matchesAny(lp, [
            'filter', 'effect', 'blur', 'sharpen', 'vignette', 'grayscale',
            'black and white', 'b&w', 'sepia', 'vintage',
        ])) {
            return this.parseFilterIntent(lp, activeClip);
        }

        if (this.matchesAny(lp, ['text', 'title', 'caption', 'subtitle', 'overlay', 'add text'])) {
            return this.parseTextIntent(lp);
        }

        if (this.matchesAny(lp, [
            'color', 'colour', 'grade', 'grading', 'lut', 'saturation',
            'brightness', 'contrast', 'warm', 'cool', 'cinematic look',
            'color correct', 'colour correct', 'vibrant', 'moody',
        ])) {
            return this.parseColorIntent(lp, activeClip);
        }

        // ── Duplicate ──────────────────────────────────────────────────────
        if (this.matchesAny(lp, ['duplicate', 'copy clip', 'clone', 'copy this clip'])) {
            if (!activeClip) {
                return this.needsClarification('No clip selected. Which clip should I duplicate?');
            }
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.DUPLICATE_CLIP, {
                targets: [activeClip.id],
            });
        }

        // ── Creative / Vague ───────────────────────────────────────────────
        if (this.matchesAny(lp, [
            'make it better', 'improve', 'enhance', 'polish', 'fix this', 'clean up',
            'make it look good', 'make it pop', 'make it professional', 'spice it up',
        ])) {
            return {
                needs_clarification: true,
                reason: `Got it — you want to improve the video. Is this primarily for:\n1️⃣ TikTok / Reels\n2️⃣ YouTube Shorts\n3️⃣ Regular YouTube\n\nThis will help me choose the right strategy.`,
                intent: INTENT_TYPES.CREATIVE_EDIT,
                operation: OPERATIONS.CREATIVE_ENHANCE,
                targets: [],
                constraints: {},
                confidence: 'LOW',
                missingParameters: ['platform', 'style', 'strategies'],
            };
        }

        if (this.matchesAny(lp, [
            'make it viral', 'viral', 'go viral', 'optimize for social', 'social media',
            'edit for social', 'make it trend', 'trending style',
        ])) {
            const platform = this.inferPlatform(lp);
            if (platform) {
                return {
                    needs_clarification: true,
                    reason: `Making it viral for ${platform}. Should we keep the same duration, or shorten it for higher retention?`,
                    intent: INTENT_TYPES.OPTIMIZE,
                    operation: OPERATIONS.PLATFORM_OPTIMIZE,
                    targets: [],
                    constraints: { platform },
                    confidence: 'MEDIUM',
                    missingParameters: ['targetDuration'],
                };
            }
            return {
                needs_clarification: true,
                reason: `You want to make it viral — great! Which platform is this for?\n1️⃣ TikTok / Reels (vertical, fast-paced)\n2️⃣ YouTube Shorts (vertical, 60s max)\n3️⃣ YouTube (landscape, longer form)`,
                intent: INTENT_TYPES.OPTIMIZE,
                operation: OPERATIONS.PLATFORM_OPTIMIZE,
                targets: [],
                constraints: {},
                confidence: 'LOW',
                missingParameters: ['platform'],
            };
        }

        // ── Compare ────────────────────────────────────────────────────────
        if (this.matchesAny(lp, ['compare', 'difference', 'before and after', 'side by side'])) {
            return this.createIntent(INTENT_TYPES.COMPARE, OPERATIONS.COMPARE_VERSIONS);
        }

        // Nothing matched
        return this.needsClarification(
            `I'm not sure what you'd like to do. Try something like:\n• "split in half"\n• "remove silence"\n• "make it 9:16"\n• "trim to 30 seconds"\n• "slow it down to 0.5x"\n• "analyze the content"`
        );
    }

    // ─────────────────────────────────────────────────────────
    // §3  INTENT-SPECIFIC PARSERS
    // ─────────────────────────────────────────────────────────

    static parseSplitIntent(lp, activeClip, context) {
        if (!activeClip) {
            // If there's exactly one clip anywhere, use it
            const allClips = context?.clips || [];
            if (allClips.length === 1) {
                activeClip = allClips[0];
            } else {
                return this.needsClarification('No clip selected. Which clip should I split?');
            }
        }

        // Detect mode from natural language
        let mode = null;
        let timestamp = null;

        if (this.matchesAny(lp, ['half', 'middle', 'midpoint', 'in 2', 'in two', 'in half', 'equally', 'equal parts', '50%'])) {
            mode = 'midpoint';
        } else if (this.matchesAny(lp, ['third', 'thirds', 'in 3', 'in three', '3 parts', 'three parts'])) {
            mode = 'thirds';
        } else if (this.matchesAny(lp, ['quarter', 'quarters', 'in 4', 'in four', '4 parts'])) {
            mode = 'quarters';
        } else if (this.matchesAny(lp, ['playhead', 'current position', 'here', 'at cursor', 'right here'])) {
            mode = 'playhead';
        } else {
            timestamp = this.extractExplicitTimestamp(lp);
            if (timestamp !== null) {
                mode = 'timestamp';
            }
        }

        if (!mode) {
            return this.needsClarification('Where should I split? (e.g., "in half", "at playhead", "at 0:30", "in thirds")');
        }

        return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SPLIT_CLIP, {
            targets: [activeClip.id],
            target_track_id: activeClip.trackId,
            constraints: {
                mode,
                ...(timestamp !== null && { timestamp }),
            },
        });
    }

    static parseCutIntent(lp, activeClip, context) {
        // Auto-select single clip
        if (!activeClip && context?.clips?.length === 1) {
            activeClip = context.clips[0];
        }

        // "cut in half" / "cut it in 2" → split midpoint
        if (this.matchesAny(lp, ['in half', 'in 2', 'in two', 'in thirds', 'in 3', 'in quarters', 'in 4'])) {
            return this.parseSplitIntent(lp, activeClip, context);
        }

        // "cut to X seconds" = trim to target duration
        if (lp.match(/cut\s+(?:it\s+)?(?:down\s+)?to\s+[\d]/)) {
            const targetDuration = this.extractTargetDuration(lp) || this.extractDuration(lp);
            if (targetDuration !== null) {
                if (!activeClip) {
                    return this.needsClarification('No clip selected. Which clip should I trim?');
                }
                return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                    targets: [activeClip.id],
                    target_track_id: activeClip.trackId,
                    constraints: { targetDuration, from: 'end' },
                });
            }
        }

        // "cut out from X to Y" = remove segment
        if (this.matchesAny(lp, ['cut out', 'remove from', 'delete from'])) {
            const range = this.extractTimeRange(lp);
            if (range) {
                return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_SEGMENT, {
                    constraints: { start: range.start, end: range.end },
                });
            }
            return this.needsClarification('What time range should I cut out? (e.g., "cut from 0:10 to 0:20")');
        }

        // "cut here" / "cut at playhead"
        if (this.matchesAny(lp, ['here', 'playhead', 'current', 'now', 'this point'])) {
            return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_AT_PLAYHEAD, {
                targets: activeClip ? [activeClip.id] : [],
            });
        }

        // "cut at 0:30"
        const timestamp = this.extractExplicitTimestamp(lp);
        if (timestamp !== null) {
            return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_AT_TIMESTAMP, {
                targets: activeClip ? [activeClip.id] : [],
                constraints: { timestamp },
            });
        }

        return this.needsClarification('How should I cut? (e.g., "cut to 3 seconds", "cut at 0:30", "cut in half")');
    }

    static parseTransitionIntent(lp, activeClip) {
        const transitionType = this.extractTransitionType(lp);
        const duration = this.extractDuration(lp) || 0.5;
        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADD_TRANSITION, {
            targets: activeClip ? [activeClip.id] : [],
            constraints: { type: transitionType, duration },
        });
    }

    static parseFilterIntent(lp, activeClip) {
        const filterType = this.extractFilterType(lp);
        const intensity = this.extractIntensity(lp);
        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADD_FILTER, {
            targets: activeClip ? [activeClip.id] : [],
            constraints: { type: filterType, intensity },
        });
    }

    static parseTextIntent(lp) {
        const textMatch = lp.match(/["']([^"']+)["']/) || lp.match(/(?:add|overlay|insert)\s+(?:text|caption|title)\s+(.+)$/i);
        if (!textMatch) {
            return this.needsClarification('What text should I add? Put it in quotes, e.g., "Hello World"');
        }
        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADD_TEXT, {
            constraints: { text: textMatch[1].trim() },
        });
    }

    static parseVolumeIntent(lp, activeClip) {
        if (this.matchesAny(lp, ['mute', 'silence the audio', 'no sound', 'kill the audio'])) {
            return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADJUST_VOLUME, {
                targets: activeClip ? [activeClip.id] : [],
                constraints: { volume: 0 },
            });
        }
        const volume = this.extractVolume(lp);
        if (volume === null) {
            return this.needsClarification('What volume level? (e.g., "50%", "louder", "mute")');
        }
        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADJUST_VOLUME, {
            targets: activeClip ? [activeClip.id] : [],
            constraints: { volume },
        });
    }

    static parseColorIntent(lp, activeClip) {
        const adjustments = {};
        if (lp.includes('warm') || lp.includes('warmer')) adjustments.temperature = 15;
        if (lp.includes('cool') || lp.includes('cooler')) adjustments.temperature = -15;
        if (lp.includes('bright') || lp.includes('brighter')) adjustments.brightness = 110;
        if (lp.includes('dark') || lp.includes('darker')) adjustments.brightness = 85;
        if (lp.includes('contrast')) adjustments.contrast = this.extractPercentage(lp) || 115;
        if (lp.includes('saturat')) adjustments.saturation = this.extractPercentage(lp) || 120;
        if (lp.includes('moody') || lp.includes('cinematic')) {
            adjustments.contrast = 120;
            adjustments.saturation = 85;
            adjustments.brightness = 92;
        }
        if (lp.includes('vibrant')) {
            adjustments.saturation = 135;
            adjustments.contrast = 105;
        }
        if (Object.keys(adjustments).length === 0) {
            return this.needsClarification('What color adjustments? (e.g., "warmer", "more contrast", "cinematic look", "vibrant")');
        }
        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.COLOR_GRADE, {
            targets: activeClip ? [activeClip.id] : [],
            constraints: adjustments,
        });
    }

    // ─────────────────────────────────────────────────────────
    // §4  EXTRACTORS
    // ─────────────────────────────────────────────────────────

    static extractExplicitTimestamp(lp) {
        const timeColonMatch = lp.match(/(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (timeColonMatch) {
            const h = timeColonMatch[3] ? parseInt(timeColonMatch[1]) : 0;
            const m = timeColonMatch[3] ? parseInt(timeColonMatch[2]) : parseInt(timeColonMatch[1]);
            const s = timeColonMatch[3] ? parseInt(timeColonMatch[3]) : parseInt(timeColonMatch[2]);
            return h * 3600 + m * 60 + s;
        }
        const secMatch = lp.match(/at\s+(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        if (secMatch) return parseFloat(secMatch[1]);
        return null;
    }

    static extractTimeRange(lp) {
        const m = lp.match(/(?:from\s+)?(\d{1,2}:\d{2})\s+(?:to|until|-)\s+(\d{1,2}:\d{2})/);
        if (m) return { start: this.parseTimeString(m[1]), end: this.parseTimeString(m[2]) };
        const mSec = lp.match(/(?:from\s+)?(\d+(?:\.\d+)?)\s*s(?:ec)?s?\s+(?:to|until|-)\s+(\d+(?:\.\d+)?)\s*s/i);
        if (mSec) return { start: parseFloat(mSec[1]), end: parseFloat(mSec[2]) };
        return null;
    }

    static parseTimeString(str) {
        const parts = str.split(':').map(Number);
        return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    static extractDuration(lp) {
        const m = lp.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        return m ? parseFloat(m[1]) : null;
    }

    static extractTargetDuration(lp) {
        const minMatch = lp.match(/(\d+(?:\.\d+)?)\s*(?:minute|min|minutes|mins)/i);
        if (minMatch) return parseFloat(minMatch[1]) * 60;
        const secMatch = lp.match(/to\s+(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        if (secMatch) return parseFloat(secMatch[1]);
        const hrMatch = lp.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hr)/i);
        if (hrMatch) return parseFloat(hrMatch[1]) * 3600;
        return null;
    }

    static extractSpeed(lp) {
        if (lp.includes('double speed') || lp.includes('2x') || lp.includes('twice as fast')) return 2.0;
        if (lp.includes('1.5x') || lp.includes('one and a half')) return 1.5;
        if (lp.includes('half speed') || lp.includes('0.5x') || lp.includes('half the speed')) return 0.5;
        if (lp.includes('0.25x') || lp.includes('quarter speed')) return 0.25;
        if (lp.includes('slow motion') || lp.includes('slow mo') || lp.includes('slomo') || lp.includes('slo mo') || lp.includes('slow it down')) return 0.5;
        if (lp.includes('timelapse') || lp.includes('time lapse')) return 4.0;
        if (lp.includes('make it faster') || lp.includes('speed it up') || lp.includes('faster')) return 2.0;
        if (lp.includes('make it slower') || lp.includes('slow down') || lp.includes('slower')) return 0.5;
        const match = lp.match(/(\d+(?:\.\d+)?)\s*x\b/i);
        if (match) return parseFloat(match[1]);
        return null;
    }

    static extractAspectRatio(lp) {
        if (lp.match(/9\s*:\s*16/) || this.matchesAny(lp, ['vertical', 'portrait', 'tiktok', 'reel', 'reels', 'shorts', 'short', 'instagram story', 'stories', 'portrait mode', 'snap'])) return '9:16';
        if (lp.match(/16\s*:\s*9/) || this.matchesAny(lp, ['horizontal', 'landscape', 'youtube', 'widescreen', 'tv', 'wide'])) return '16:9';
        if (lp.match(/1\s*:\s*1/) || this.matchesAny(lp, ['square', 'instagram post', 'facebook post'])) return '1:1';
        if (lp.match(/4\s*:\s*5/) || lp.includes('4:5')) return '4:5';
        if (lp.match(/4\s*:\s*3/) || lp.includes('4:3')) return '4:3';
        if (lp.match(/21\s*:\s*9/) || this.matchesAny(lp, ['ultrawide', 'cinematic', 'anamorphic'])) return '21:9';
        return '16:9'; // default
    }

    static extractSilenceThreshold(lp) {
        const m = lp.match(/-?\d+\s*dB/i);
        return m ? m[0] : '-30dB';
    }

    static extractExportFormat(lp) {
        if (lp.includes('mp4')) return 'mp4';
        if (lp.includes('mov')) return 'mov';
        if (lp.includes('webm')) return 'webm';
        if (lp.includes('gif')) return 'gif';
        if (lp.includes('mp3') || lp.includes('audio only')) return 'mp3';
        return 'mp4';
    }

    static extractQuality(lp) {
        if (lp.includes('4k') || lp.includes('2160')) return '4k';
        if (lp.includes('1080') || lp.includes('full hd')) return '1080p';
        if (lp.includes('720') || lp.includes('hd')) return '720p';
        if (lp.includes('480') || lp.includes('sd')) return '480p';
        return '1080p';
    }

    static extractTransitionType(lp) {
        if (lp.includes('fade')) return 'fade';
        if (lp.includes('dissolve') || lp.includes('crossfade')) return 'dissolve';
        if (lp.includes('wipe')) return 'wipe';
        if (lp.includes('slide')) return 'slide';
        if (lp.includes('zoom')) return 'zoom';
        return 'fade';
    }

    static extractFilterType(lp) {
        if (lp.includes('blur')) return 'blur';
        if (lp.includes('sharpen')) return 'sharpen';
        if (lp.includes('vignette')) return 'vignette';
        if (this.matchesAny(lp, ['black and white', 'b&w', 'grayscale', 'grey'])) return 'grayscale';
        if (lp.includes('sepia')) return 'sepia';
        if (lp.includes('vintage')) return 'sepia';
        return 'none';
    }

    static extractIntensity(lp) {
        const m = lp.match(/(\d+)\s*%/);
        return m ? parseInt(m[1]) / 100 : 0.5;
    }

    static extractVolume(lp) {
        if (this.matchesAny(lp, ['louder', 'turn up', 'increase volume', 'boost'])) return 1.5;
        if (this.matchesAny(lp, ['quieter', 'softer', 'turn down', 'lower', 'decrease volume'])) return 0.5;
        const m = lp.match(/(\d+)\s*%/);
        return m ? parseInt(m[1]) / 100 : null;
    }

    static extractPercentage(lp) {
        const m = lp.match(/(\d+)\s*%/);
        return m ? parseInt(m[1]) : null;
    }

    // ─────────────────────────────────────────────────────────
    // §5  HELPERS
    // ─────────────────────────────────────────────────────────

    /** Match any of an array of substrings against a lowercased prompt */
    static matchesAny(lp, patterns) {
        return patterns.some(p => lp.includes(p));
    }

    /** Infer target platform from prompt text */
    static inferPlatform(lp) {
        if (this.matchesAny(lp, ['tiktok', 'tik tok'])) return 'TikTok';
        if (this.matchesAny(lp, ['reel', 'reels', 'instagram reels'])) return 'Instagram Reels';
        if (this.matchesAny(lp, ['shorts', 'youtube short'])) return 'YouTube Shorts';
        if (lp.includes('youtube')) return 'YouTube';
        if (this.matchesAny(lp, ['instagram', 'insta'])) return 'Instagram';
        if (this.matchesAny(lp, ['twitter', 'x.com', 'tweet'])) return 'Twitter/X';
        if (lp.includes('podcast')) return 'Podcast';
        return null;
    }

    static createIntent(intent, operation, extras = {}) {
        const baseIntent = {
            intent,
            operation,
            targets: extras.targets || [],
            target_track_id: extras.target_track_id || null,
            constraints: extras.constraints || {},
            needs_clarification: false,
        };

        const validationProxy = {
            operation,
            parameters: {
                ...baseIntent.constraints,
                clipId: baseIntent.targets[0],
                trimType: baseIntent.constraints.from,
            },
        };

        const validation = IntentValidator.validate(validationProxy);
        return { ...baseIntent, confidence: validation.confidence, missingParameters: validation.missingParameters };
    }

    static needsClarification(reason) {
        return { needs_clarification: true, reason, intent: null, operation: null, targets: [], constraints: {} };
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
            missingParameters: result.missingParameters || [],
        };
    }
}

export default IntentParser;