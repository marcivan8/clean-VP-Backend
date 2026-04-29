import { ContextGenerator } from './ContextGenerator.js';
import { FallbackParser } from './FallbackParser.js';
import { EventBus, EVENT_TYPES } from './EventBus.js';
import { IntentValidator } from './IntentValidator.js';

/**
 * IntentParser Agent for Viral Pilot
 * 
 * Parses natural language editing instructions into STRICT, VALID JSON.
 * 
 * Responsibilities:
 * - Parse prompts via AI API (primary)
 * - Fall back to FallbackParser regex engine (when AI unavailable)
 * - Emit events for AI availability status
 * - Extract explicit parameters
 * - Request clarification for ambiguous requests
 * 
 * This agent NEVER executes any actions.
 */

import { INTENT_TYPES, OPERATIONS } from './CommandConstants.js';

export { INTENT_TYPES, OPERATIONS };

export class IntentParser {
    /**
     * Parse user prompt into structured intent JSON
     * @param {string} userPrompt - Natural language request
     * @param {AbortSignal} signal - For cancellation
     * @returns {Promise<object>} Strict JSON intent object
     */
    static async parse(userPrompt, signal = null) {
        console.log('[AG_DEBUG] [IntentParser] Parsing:', userPrompt);

        // Validate input
        if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
            return this.needsClarification('Empty or invalid input');
        }

        const prompt = userPrompt.trim();
        const context = ContextGenerator.getTimelineContext();
        // Grounded Agent: Build structured context for API calls
        const structuredContext = ContextGenerator.getStructuredContext();

        try {
            // Try API-based parsing first (more accurate)
            console.log('[AG_DEBUG] [IntentParser] Attempting API parse...');
            const apiResult = await this.parseViaAPI(prompt, structuredContext, signal);
            if (apiResult) {
                console.log('[AG_DEBUG] [IntentParser] API parse successful:', apiResult.intent);
                return this.validateAndNormalize(apiResult);
            }
        } catch (error) {
            // Only throw if the user actively cancelled the operation via the provided signal
            if (signal && signal.aborted) {
                throw error;
            }
            console.warn('[AG_DEBUG] [IntentParser] API unavailable or timed out, trying FallbackParser. Error:', error.message);

            // Emit AI unavailable event
            EventBus.emit(EVENT_TYPES.AI_UNAVAILABLE, {
                error: error.message,
                prompt
            });

            // Try the regex-based FallbackParser
            const fallbackResult = FallbackParser.parse(prompt);
            if (fallbackResult) {
                console.log('[AG_DEBUG] [IntentParser] FallbackParser matched:', fallbackResult.action);
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

        // Last resort: local pattern matching
        console.log('[AG_DEBUG] [IntentParser] Trying localParse pattern matching...');
        return this.localParse(prompt, context);
    }

    /**
     * Call backend API for intent parsing
     */
    static async parseViaAPI(prompt, context, signal) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        if (signal) {
            signal.addEventListener('abort', () => controller.abort());
        }

        try {
            const response = await fetch('/api/ai/parse-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, context }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return null;
            }

            const result = await response.json();

            // Handle CRL clarification_required (already normalized by backend)
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

    /**
     * Local parser - strict pattern matching, no inference
     */
    static localParse(prompt, context) {
        const lowerPrompt = prompt.toLowerCase();
        const clips = context?.clips || [];
        const activeClip = clips.find(c => c.isActive);
        const duration = context?.duration || 0;

        // === LONG-FORM INTELLIGENCE ENGINE (checked first — specific compound intents) ===

        // ANALYZE STRUCTURE / CONTENT
        if (this.matchesPattern(lowerPrompt, [
            'analyze my video', 'analyze this video', 'analyze the content', 'analyze structure',
            'analyse', 'segment the video', 'what is in this video',
            'understand this content', 'break down the video'
        ])) {
            const platform = this.inferPlatform(lowerPrompt);
            return this.createIntent(INTENT_TYPES.ANALYZE, OPERATIONS.ANALYZE_STRUCTURE, {
                constraints: { platform, targetDuration: this._extractTargetDuration(lowerPrompt) }
            });
        }

        // FIND HOOK
        if (this.matchesPattern(lowerPrompt, [
            'find the hook', 'find hook', 'best opening', 'strongest moment',
            'most engaging part', 'what should i use as hook'
        ])) {
            return this.createIntent(INTENT_TYPES.ANALYZE, OPERATIONS.FIND_HOOK, {
                constraints: {}
            });
        }

        // FULL BUILD — from raw rushes
        if (this.matchesPattern(lowerPrompt, [
            'build a full video', 'build from rushes', 'build from raw',
            'assemble the video', 'edit my rushes', 'edit the rushes',
            'compile the footage', 'put together a video', 'build me a video'
        ])) {
            const platform = this.inferPlatform(lowerPrompt);
            const targetDuration = this._extractTargetDuration(lowerPrompt);
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.BUILD_FROM_RUSHES, {
                constraints: { platform, targetDuration, editMode: 'FULL_BUILD' }
            });
        }

        // CLEAN EDIT — podcast/interview
        if (this.matchesPattern(lowerPrompt, [
            'clean this podcast', 'clean the podcast', 'edit the podcast',
            'clean up the interview', 'edit this interview', 'clean up the recording',
            'tighten up the interview', 'tighten the podcast', 'clean up this recording'
        ])) {
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.LONG_FORM_EDIT, {
                constraints: { editMode: 'CLEAN_EDIT', platform: this.inferPlatform(lowerPrompt) || 'podcast' }
            });
        }

        // YOUTUBE OPTIMIZED — long-form YouTube
        if (this.matchesPattern(lowerPrompt, [
            'optimize for youtube', 'make a youtube video', 'edit for youtube',
            'youtube long form', 'make it youtube ready', 'build a youtube video',
            'create a youtube video', 'make a full youtube video'
        ])) {
            const targetDuration = this._extractTargetDuration(lowerPrompt);
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.LONG_FORM_EDIT, {
                constraints: { editMode: 'YOUTUBE_OPTIMIZED', platform: 'youtube', targetDuration }
            });
        }

        // REMOVE REPETITION
        if (this.matchesPattern(lowerPrompt, [
            'remove repetition', 'remove repetitions', 'cut out repetitions',
            'remove duplicate parts', 'cut repeated content'
        ])) {
            return this.createIntent(INTENT_TYPES.LONG_FORM_BUILD, OPERATIONS.REMOVE_REPETITION, {
                constraints: {}
            });
        }

        // === UNDO / REDO ===
        if (this.matchesPattern(lowerPrompt, ['undo'])) {
            return this.createIntent(INTENT_TYPES.UNDO, 'undo_action');
        }
        if (this.matchesPattern(lowerPrompt, ['redo'])) {
            return this.createIntent(INTENT_TYPES.REDO, 'redo_action');
        }


        // === EXPORT ===
        if (this.matchesPattern(lowerPrompt, ['export', 'render', 'save as', 'download'])) {
            const format = this.extractExportFormat(lowerPrompt);
            const quality = this.extractQuality(lowerPrompt);

            return this.createIntent(INTENT_TYPES.EXPORT, OPERATIONS.EXPORT_VIDEO, {
                constraints: { format, quality }
            });
        }

        // === COMPARE ===
        if (this.matchesPattern(lowerPrompt, ['compare', 'difference', 'before and after', 'side by side'])) {
            return this.createIntent(INTENT_TYPES.COMPARE, OPERATIONS.COMPARE_VERSIONS);
        }

        // === SPLIT / CUT ===
        if (this.matchesPattern(lowerPrompt, ['split', 'divide'])) {
            return this.parseSplitIntent(lowerPrompt, activeClip, context);
        }

        if (this.matchesPattern(lowerPrompt, ['cut'])) {
            return this.parseCutIntent(lowerPrompt, activeClip, context);
        }

        // === REMOVE / DELETE ===
        if (this.matchesPattern(lowerPrompt, ['remove', 'delete', 'erase'])) {
            if (!activeClip) {
                return this.needsClarification('No clip selected. Which clip should I remove?');
            }
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.REMOVE_CLIP, {
                targets: [activeClip.id],
                target_track_id: activeClip.trackId
            });
        }

        // === TRIM ===
        if (this.matchesPattern(lowerPrompt, ['trim', 'shorten'])) {
            if (!activeClip) {
                return this.needsClarification('No clip selected. Which clip should I trim?');
            }

            // Check for explicit duration
            const duration = this.extractDuration(lowerPrompt);
            if (!duration) {
                return this.needsClarification('How much should I trim? Please specify duration.');
            }

            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                targets: [activeClip.id],
                constraints: { duration }
            });
        }

        // === SPEED ===
        if (this.matchesPattern(lowerPrompt, ['speed', 'faster', 'slower', 'slow motion', 'timelapse'])) {
            const speed = this.extractSpeed(lowerPrompt);
            if (!speed) {
                return this.needsClarification('What speed? (e.g., 2x, 0.5x, half speed)');
            }

            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SET_CLIP_SPEED, {
                targets: activeClip ? [activeClip.id] : [],
                constraints: { speed }
            });
        }

        // === ASPECT RATIO ===
        if (this.matchesPattern(lowerPrompt, ['vertical', 'horizontal', 'square', 'portrait', 'landscape', 'aspect', '9:16', '16:9', '1:1', '4:3'])) {
            const ratio = this.extractAspectRatio(lowerPrompt);
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SET_ASPECT_RATIO, {
                constraints: { ratio }
            });
        }

        // === SILENCE REMOVAL ===
        if (this.matchesPattern(lowerPrompt, ['silence', 'quiet', 'dead air', 'pauses', 'gaps'])) {
            const threshold = this.extractSilenceThreshold(lowerPrompt);
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SILENCE_REMOVAL, {
                constraints: { threshold }
            });
        }

        // === EFFECTS ===
        if (this.matchesPattern(lowerPrompt, ['transition', 'fade', 'dissolve', 'wipe'])) {
            return this.parseTransitionIntent(lowerPrompt, activeClip);
        }

        if (this.matchesPattern(lowerPrompt, ['filter', 'effect', 'blur', 'sharpen', 'vignette'])) {
            return this.parseFilterIntent(lowerPrompt, activeClip);
        }

        if (this.matchesPattern(lowerPrompt, ['text', 'title', 'caption', 'subtitle'])) {
            return this.parseTextIntent(lowerPrompt);
        }

        if (this.matchesPattern(lowerPrompt, ['volume', 'audio', 'louder', 'quieter', 'mute'])) {
            return this.parseVolumeIntent(lowerPrompt, activeClip);
        }

        if (this.matchesPattern(lowerPrompt, ['color', 'grade', 'lut', 'saturation', 'brightness', 'contrast'])) {
            return this.parseColorIntent(lowerPrompt, activeClip);
        }

        // === DUPLICATE ===
        if (this.matchesPattern(lowerPrompt, ['duplicate', 'copy', 'clone'])) {
            if (!activeClip) {
                return this.needsClarification('No clip selected. Which clip should I duplicate?');
            }
            return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.DUPLICATE_CLIP, {
                targets: [activeClip.id]
            });
        }

        // === CREATIVE / VAGUE PROMPTS (CRL) ===
        if (this.matchesPattern(lowerPrompt, ['make it better', 'improve', 'enhance', 'polish', 'fix this', 'clean up', 'make it look good'])) {
            return {
                needs_clarification: true,
                reason: `Got it — you want to improve the video. Is this primarily for:\n1️⃣ TikTok / Reels\n2️⃣ YouTube Shorts\n3️⃣ Regular YouTube\n\nThis will help me choose the right strategy.`,
                intent: INTENT_TYPES.CREATIVE_EDIT,
                operation: OPERATIONS.CREATIVE_ENHANCE,
                targets: [],
                constraints: {},
                confidence: 'LOW',
                missingParameters: ['platform', 'style', 'strategies']
            };
        }

        if (this.matchesPattern(lowerPrompt, ['make it viral', 'viral', 'go viral', 'optimize for social', 'social media', 'edit for social'])) {
            // Check if platform can be inferred
            const platform = this.inferPlatform(lowerPrompt);
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
                reason: `You want to make it viral — great! Which platform is this for?\n1️⃣ TikTok / Reels (vertical, fast-paced)\n2️⃣ YouTube Shorts (vertical, 60s max)\n3️⃣ YouTube (landscape, longer form)`,
                intent: INTENT_TYPES.OPTIMIZE,
                operation: OPERATIONS.PLATFORM_OPTIMIZE,
                targets: [],
                constraints: {},
                confidence: 'LOW',
                missingParameters: ['platform', 'targetDuration', 'style']
            };
        }

        // === COULD NOT PARSE ===
        return this.needsClarification(`Could not parse: "${prompt}"`);
    }

    // ==================== INTENT PARSERS ====================

    static parseSplitIntent(prompt, activeClip, context) {
        if (!activeClip) {
            return this.needsClarification('No clip selected. Which clip should I split?');
        }

        // Check for explicit mode
        let mode = null;
        if (this.matchesPattern(prompt, ['half', 'middle', 'midpoint', 'in 2', 'in two'])) {
            mode = 'midpoint';
        } else if (this.matchesPattern(prompt, ['third', 'in 3', 'in three'])) {
            mode = 'thirds';
        } else if (this.matchesPattern(prompt, ['quarter', 'in 4', 'in four'])) {
            mode = 'quarters';
        } else if (this.matchesPattern(prompt, ['playhead', 'current position', 'here'])) {
            mode = 'playhead';
        }

        // Check for explicit timestamp - ONLY if user provides it
        const timestamp = this.extractExplicitTimestamp(prompt);
        if (timestamp !== null) {
            mode = 'timestamp';
        }

        // If no mode detected, request clarification
        if (!mode) {
            return this.needsClarification('Where should I split? (e.g., "in half", "at playhead", "at 0:30")');
        }

        return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.SPLIT_CLIP, {
            targets: [activeClip.id],
            target_track_id: activeClip.trackId,
            constraints: {
                mode,
                ...(timestamp !== null && { timestamp })
            }
        });
    }

    static parseCutIntent(prompt, activeClip, context) {
        // Auto-select clip if there's only one and none is selected
        if (!activeClip && context?.clips?.length === 1) {
            activeClip = context.clips[0];
        }

        // "Cut to X seconds" = trim to target duration
        if (this.matchesPattern(prompt, ['to']) && !this.matchesPattern(prompt, ['to the'])) {
            const targetDuration = this.extractDuration(prompt);
            if (targetDuration !== null) {
                if (!activeClip) {
                    return this.needsClarification('No clip selected. Which clip should I trim?');
                }
                return this.createIntent(INTENT_TYPES.EDIT, OPERATIONS.TRIM_CLIP, {
                    targets: [activeClip.id],
                    target_track_id: activeClip.trackId,
                    constraints: {
                        targetDuration: targetDuration,
                        from: 'end'
                    }
                });
            }
        }

        // "Cut" can mean split at playhead or remove segment
        if (this.matchesPattern(prompt, ['out', 'remove', 'delete'])) {
            // Cut out = remove segment
            const range = this.extractTimeRange(prompt);
            if (!range) {
                return this.needsClarification('What time range should I cut out? (e.g., "cut from 0:10 to 0:20")');
            }
            return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_SEGMENT, {
                constraints: { start: range.start, end: range.end }
            });
        }

        // Simple cut at playhead
        if (this.matchesPattern(prompt, ['here', 'playhead', 'current'])) {
            return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_AT_PLAYHEAD, {
                targets: activeClip ? [activeClip.id] : []
            });
        }

        // Cut at specific timestamp (uses "at" keyword)
        if (this.matchesPattern(prompt, ['at'])) {
            const timestamp = this.extractExplicitTimestamp(prompt);
            if (timestamp !== null) {
                return this.createIntent(INTENT_TYPES.CUT, OPERATIONS.CUT_AT_TIMESTAMP, {
                    targets: activeClip ? [activeClip.id] : [],
                    constraints: { timestamp }
                });
            }
        }

        return this.needsClarification('How should I cut? (e.g., "cut to 3 seconds", "cut at 0:30", "cut at playhead")');
    }

    static parseTransitionIntent(prompt, activeClip) {
        const transitionType = this.extractTransitionType(prompt);
        const duration = this.extractDuration(prompt) || 0.5;

        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADD_TRANSITION, {
            targets: activeClip ? [activeClip.id] : [],
            constraints: { type: transitionType, duration }
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
        // Text requires explicit content
        const textMatch = prompt.match(/["']([^"']+)["']/);
        if (!textMatch) {
            return this.needsClarification('What text should I add? Put it in quotes, e.g., "Hello World"');
        }

        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADD_TEXT, {
            constraints: { text: textMatch[1] }
        });
    }

    static parseVolumeIntent(prompt, activeClip) {
        if (this.matchesPattern(prompt, ['mute'])) {
            return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADJUST_VOLUME, {
                targets: activeClip ? [activeClip.id] : [],
                constraints: { volume: 0 }
            });
        }

        const volume = this.extractVolume(prompt);
        if (volume === null) {
            return this.needsClarification('What volume level? (e.g., "50%", "louder", "mute")');
        }

        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.ADJUST_VOLUME, {
            targets: activeClip ? [activeClip.id] : [],
            constraints: { volume }
        });
    }

    static parseColorIntent(prompt, activeClip) {
        const adjustments = {};

        if (prompt.includes('saturation')) {
            adjustments.saturation = this.extractPercentage(prompt) || 100;
        }
        if (prompt.includes('brightness')) {
            adjustments.brightness = this.extractPercentage(prompt) || 100;
        }
        if (prompt.includes('contrast')) {
            adjustments.contrast = this.extractPercentage(prompt) || 100;
        }

        if (Object.keys(adjustments).length === 0) {
            return this.needsClarification('What color adjustments? (e.g., "increase saturation", "brightness 80%")');
        }

        return this.createIntent(INTENT_TYPES.APPLY_EFFECT, OPERATIONS.COLOR_GRADE, {
            targets: activeClip ? [activeClip.id] : [],
            constraints: adjustments
        });
    }

    // ==================== EXTRACTORS ====================

    static extractExplicitTimestamp(prompt) {
        // Match MM:SS or HH:MM:SS or seconds
        const timeMatch = prompt.match(/(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (timeMatch) {
            const hours = timeMatch[3] ? parseInt(timeMatch[1]) : 0;
            const minutes = timeMatch[3] ? parseInt(timeMatch[2]) : parseInt(timeMatch[1]);
            const seconds = timeMatch[3] ? parseInt(timeMatch[3]) : parseInt(timeMatch[2]);
            return hours * 3600 + minutes * 60 + seconds;
        }

        // Match "X seconds" or "Xs"
        const secMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        if (secMatch) {
            return parseFloat(secMatch[1]);
        }

        return null;
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
        if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        }
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    static extractDuration(prompt) {
        const match = prompt.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        return match ? parseFloat(match[1]) : null;
    }

    static extractSpeed(prompt) {
        if (prompt.includes('2x') || prompt.includes('double')) return 2.0;
        if (prompt.includes('1.5x') || prompt.includes('1.5')) return 1.5;
        if (prompt.includes('0.5x') || prompt.includes('half')) return 0.5;
        if (prompt.includes('0.25x') || prompt.includes('quarter')) return 0.25;
        if (prompt.includes('slow motion')) return 0.5;
        if (prompt.includes('timelapse')) return 4.0;

        const match = prompt.match(/(\d+(?:\.\d+)?)\s*x/);
        return match ? parseFloat(match[1]) : null;
    }

    static extractAspectRatio(prompt) {
        if (prompt.includes('9:16') || prompt.includes('vertical') || prompt.includes('portrait') ||
            prompt.includes('tiktok') || prompt.includes('reel') || prompt.includes('shorts')) {
            return '9:16';
        }
        if (prompt.includes('16:9') || prompt.includes('horizontal') || prompt.includes('landscape') ||
            prompt.includes('youtube') || prompt.includes('widescreen')) {
            return '16:9';
        }
        if (prompt.includes('1:1') || prompt.includes('square') || prompt.includes('instagram')) {
            return '1:1';
        }
        if (prompt.includes('4:3')) return '4:3';
        if (prompt.includes('21:9') || prompt.includes('ultrawide') || prompt.includes('cinematic')) {
            return '21:9';
        }
        return '16:9'; // Default
    }

    static extractSilenceThreshold(prompt) {
        const match = prompt.match(/-?\d+\s*dB/i);
        return match ? match[0] : '-30dB';
    }

    static extractExportFormat(prompt) {
        if (prompt.includes('mp4')) return 'mp4';
        if (prompt.includes('mov')) return 'mov';
        if (prompt.includes('webm')) return 'webm';
        if (prompt.includes('gif')) return 'gif';
        return 'mp4';
    }

    static extractQuality(prompt) {
        if (prompt.includes('4k') || prompt.includes('2160')) return '4k';
        if (prompt.includes('1080') || prompt.includes('full hd')) return '1080p';
        if (prompt.includes('720') || prompt.includes('hd')) return '720p';
        if (prompt.includes('480')) return '480p';
        return '1080p';
    }

    static extractTransitionType(prompt) {
        if (prompt.includes('fade')) return 'fade';
        if (prompt.includes('dissolve')) return 'dissolve';
        if (prompt.includes('wipe')) return 'wipe';
        if (prompt.includes('slide')) return 'slide';
        if (prompt.includes('zoom')) return 'zoom';
        return 'fade';
    }

    static extractFilterType(prompt) {
        if (prompt.includes('blur')) return 'blur';
        if (prompt.includes('sharpen')) return 'sharpen';
        if (prompt.includes('vignette')) return 'vignette';
        if (prompt.includes('black and white') || prompt.includes('b&w') || prompt.includes('grayscale')) {
            return 'grayscale';
        }
        if (prompt.includes('sepia')) return 'sepia';
        return 'none';
    }

    static extractIntensity(prompt) {
        const match = prompt.match(/(\d+)\s*%/);
        return match ? parseInt(match[1]) / 100 : 0.5;
    }

    static extractVolume(prompt) {
        if (prompt.includes('louder')) return 1.5;
        if (prompt.includes('quieter') || prompt.includes('softer')) return 0.5;

        const match = prompt.match(/(\d+)\s*%/);
        return match ? parseInt(match[1]) / 100 : null;
    }

    static extractPercentage(prompt) {
        const match = prompt.match(/(\d+)\s*%/);
        return match ? parseInt(match[1]) : null;
    }

    // ==================== HELPERS ====================

    /**
     * Infer target platform from prompt text (CRL)
     * @param {string} prompt - lowercased prompt
     * @returns {string|null} Platform name or null
     */
    static inferPlatform(prompt) {
        if (prompt.includes('tiktok') || prompt.includes('tik tok')) return 'TikTok';
        if (prompt.includes('reel') || prompt.includes('reels')) return 'Instagram Reels';
        if (prompt.includes('shorts') || prompt.includes('youtube short')) return 'YouTube Shorts';
        if (prompt.includes('youtube')) return 'YouTube';
        if (prompt.includes('instagram') || prompt.includes('insta')) return 'Instagram';
        if (prompt.includes('twitter') || prompt.includes('x.com')) return 'Twitter/X';
        if (prompt.includes('podcast')) return 'Podcast';
        return null;
    }

    static matchesPattern(text, patterns) {
        return patterns.some(p => text.includes(p));
    }

    /**
     * Extracts a target output duration from natural language.
     * e.g. "make a 10 minute video" → 600, "cut to 5 min" → 300
     * @param {string} prompt
     * @returns {number|null}
     */
    static _extractTargetDuration(prompt) {
        // Match "X minutes" or "X min"
        const minMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:minute|min|minutes|mins)/i);
        if (minMatch) return parseFloat(minMatch[1]) * 60;

        // Match "X seconds" or "Xs"
        const secMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|sec|s\b)/i);
        if (secMatch) return parseFloat(secMatch[1]);

        // Match "X hours"
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

        // Create a validation proxy that maps constraints/targets to parameters
        const validationProxy = {
            operation,
            parameters: {
                ...baseIntent.constraints,
                targets: baseIntent.targets, // Some validators might check targets (e.g. remove_clip)
                // Map common constraint names to validator expectations if needed
                clipId: baseIntent.targets[0], // For validators checking 'clipId'
                trimType: baseIntent.constraints.from // For trim validator
            }
        };

        const validation = IntentValidator.validate(validationProxy);

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
        // Ensure all required fields exist
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
