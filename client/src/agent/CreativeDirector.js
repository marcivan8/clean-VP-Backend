import { ContextGenerator } from './ContextGenerator.js';
import useTimelineStore from '../store/useTimelineStore.js';

/**
 * Creative Director Agent for Viral Pilot
 * 
 * Suggests creative improvements - NEVER executes edits.
 * 
 * Responsibilities:
 * - Propose alternative pacing
 * - Suggest effects, transitions, hooks
 * - Generate multiple creative variants
 * - Rank alternatives with reasoning
 * 
 * Constraints:
 * - NEVER modify timeline directly
 * - ALWAYS request user validation
 * - Output suggestions only, no execution
 */

// Suggestion categories
export const SUGGESTION_TYPES = {
    PACING: 'pacing',
    TRANSITION: 'transition',
    EFFECT: 'effect',
    HOOK: 'hook',
    AUDIO: 'audio',
    TEXT: 'text',
    COLOR: 'color',
    STRUCTURE: 'structure'
};

// Confidence levels
export const CONFIDENCE = {
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low'
};

// Platform presets
const PLATFORM_STYLES = {
    tiktok: {
        idealDuration: 15,
        minHookTime: 0.5,
        maxHookTime: 3,
        preferredTransitions: ['jump_cut', 'whip_pan', 'zoom'],
        preferredPacing: 'fast',
        avgCutDuration: 2.5
    },
    youtube_shorts: {
        idealDuration: 30,
        minHookTime: 1,
        maxHookTime: 5,
        preferredTransitions: ['fade', 'zoom', 'slide'],
        preferredPacing: 'medium',
        avgCutDuration: 4
    },
    instagram_reels: {
        idealDuration: 30,
        minHookTime: 1,
        maxHookTime: 3,
        preferredTransitions: ['dissolve', 'zoom', 'slide'],
        preferredPacing: 'medium',
        avgCutDuration: 3
    },
    youtube: {
        idealDuration: 480,
        minHookTime: 5,
        maxHookTime: 30,
        preferredTransitions: ['fade', 'dissolve', 'wipe'],
        preferredPacing: 'varied',
        avgCutDuration: 6
    }
};

export class CreativeDirector {
    constructor() {
        this.suggestions = [];
        this.onSuggestionReady = null;
    }

    /**
     * Analyze timeline and generate creative suggestions
     * @param {object} options - Analysis options
     * @returns {Promise<object>} Suggestions with rankings
     */
    async analyze(options = {}) {
        console.log('[CreativeDirector] Analyzing timeline for creative suggestions');

        const state = useTimelineStore.getState();
        const context = ContextGenerator.getTimelineContext();
        const platform = options.platform || this.detectPlatform(state);

        const suggestions = [];

        // 1. Analyze pacing
        const pacingSuggestions = this.analyzePacing(state, context, platform);
        suggestions.push(...pacingSuggestions);

        // 2. Suggest transitions
        const transitionSuggestions = this.suggestTransitions(state, context, platform);
        suggestions.push(...transitionSuggestions);

        // 3. Suggest hooks
        const hookSuggestions = this.suggestHooks(state, context, platform);
        suggestions.push(...hookSuggestions);

        // 4. Suggest effects
        const effectSuggestions = this.suggestEffects(state, context, platform);
        suggestions.push(...effectSuggestions);

        // 5. Suggest audio enhancements
        const audioSuggestions = this.suggestAudioEnhancements(state, context);
        suggestions.push(...audioSuggestions);

        // 6. Suggest text/captions
        const textSuggestions = this.suggestTextOverlays(state, context, platform);
        suggestions.push(...textSuggestions);

        // 7. Suggest color grading
        const colorSuggestions = this.suggestColorGrading(state, context);
        suggestions.push(...colorSuggestions);

        // Rank suggestions
        const rankedSuggestions = this.rankSuggestions(suggestions, platform);

        this.suggestions = rankedSuggestions;

        // Notify if callback set
        if (this.onSuggestionReady) {
            this.onSuggestionReady(rankedSuggestions);
        }

        return {
            success: true,
            platform,
            suggestion_count: rankedSuggestions.length,
            suggestions: rankedSuggestions,
            summary: this.generateSummary(rankedSuggestions)
        };
    }

    // ==================== PACING ANALYSIS ====================

    analyzePacing(state, context, platform) {
        const suggestions = [];
        const clips = this.getAllClips(state);
        const style = PLATFORM_STYLES[platform] || PLATFORM_STYLES.youtube;

        if (clips.length === 0) return suggestions;

        // Calculate current metrics
        const totalDuration = this.getTotalDuration(state);
        const avgClipDuration = totalDuration / clips.length;
        const clipDurations = clips.map(c => c.duration);

        // Check if pacing is too slow for platform
        if (avgClipDuration > style.avgCutDuration * 1.5) {
            suggestions.push({
                id: `pacing_${Date.now()}_1`,
                type: SUGGESTION_TYPES.PACING,
                title: 'Speed Up Pacing',
                description: `Average clip duration is ${avgClipDuration.toFixed(1)}s. For ${platform}, consider ${style.avgCutDuration}s average for better engagement.`,
                reasoning: 'Shorter clips maintain viewer attention and match platform expectations.',
                action: {
                    operation: 'split_long_clips',
                    target_duration: style.avgCutDuration,
                    affected_clips: clips.filter(c => c.duration > style.avgCutDuration * 2).map(c => c.id)
                },
                confidence: CONFIDENCE.HIGH,
                impact: 'high',
                requires_user_approval: true
            });
        }

        // Check if pacing is too fast
        if (avgClipDuration < style.avgCutDuration * 0.5) {
            suggestions.push({
                id: `pacing_${Date.now()}_2`,
                type: SUGGESTION_TYPES.PACING,
                title: 'Slow Down Pacing',
                description: `Cuts are very rapid (${avgClipDuration.toFixed(1)}s avg). Consider holding key moments longer.`,
                reasoning: 'Very rapid cuts can feel jarring and prevent emotional connection.',
                action: {
                    operation: 'extend_key_clips',
                    target_duration: style.avgCutDuration
                },
                confidence: CONFIDENCE.MEDIUM,
                impact: 'medium',
                requires_user_approval: true
            });
        }

        // Suggest varied pacing
        const durationVariance = this.calculateVariance(clipDurations);
        if (durationVariance < 0.5 && clips.length > 3) {
            suggestions.push({
                id: `pacing_${Date.now()}_3`,
                type: SUGGESTION_TYPES.PACING,
                title: 'Add Pacing Variety',
                description: 'All clips have similar length. Varying timing creates better rhythm.',
                reasoning: 'Dynamic pacing keeps viewers engaged and emphasizes important moments.',
                action: {
                    operation: 'vary_clip_durations',
                    suggestion: 'Create contrast with 1 long clip for every 3-4 short clips'
                },
                confidence: CONFIDENCE.MEDIUM,
                impact: 'medium',
                requires_user_approval: true
            });
        }

        return suggestions;
    }

    // ==================== TRANSITION SUGGESTIONS ====================

    suggestTransitions(state, context, platform) {
        const suggestions = [];
        const clips = this.getAllClips(state);
        const style = PLATFORM_STYLES[platform] || PLATFORM_STYLES.youtube;

        if (clips.length < 2) return suggestions;

        // Count current transitions
        const transitionCount = clips.filter(c => c.transition).length;
        const cutPoints = clips.length - 1;

        // Suggest adding transitions if none exist
        if (transitionCount === 0) {
            suggestions.push({
                id: `transition_${Date.now()}_1`,
                type: SUGGESTION_TYPES.TRANSITION,
                title: 'Add Transitions',
                description: `Your video has ${cutPoints} cuts with no transitions. Consider adding some for polish.`,
                reasoning: 'Transitions can smooth cuts and add professional quality.',
                variants: style.preferredTransitions.map((t, i) => ({
                    name: t,
                    description: this.getTransitionDescription(t),
                    recommended: i === 0
                })),
                action: {
                    operation: 'add_transition',
                    type: style.preferredTransitions[0],
                    apply_to: 'key_cuts'
                },
                confidence: CONFIDENCE.HIGH,
                impact: 'medium',
                requires_user_approval: true
            });
        }

        // Suggest transition variety
        if (transitionCount > 0 && transitionCount < cutPoints / 2) {
            suggestions.push({
                id: `transition_${Date.now()}_2`,
                type: SUGGESTION_TYPES.TRANSITION,
                title: 'Strategic Transition Placement',
                description: 'Consider transitions at scene changes or emotional shifts.',
                reasoning: 'Transitions work best when marking significant content changes.',
                action: {
                    operation: 'suggest_transition_points'
                },
                confidence: CONFIDENCE.MEDIUM,
                impact: 'low',
                requires_user_approval: true
            });
        }

        return suggestions;
    }

    // ==================== HOOK SUGGESTIONS ====================

    suggestHooks(state, context, platform) {
        const suggestions = [];
        const clips = this.getAllClips(state);
        const style = PLATFORM_STYLES[platform] || PLATFORM_STYLES.youtube;
        const totalDuration = this.getTotalDuration(state);

        if (clips.length === 0) return suggestions;

        const firstClip = clips[0];

        // Check if opening hook is strong enough
        if (firstClip && firstClip.duration > style.maxHookTime) {
            suggestions.push({
                id: `hook_${Date.now()}_1`,
                type: SUGGESTION_TYPES.HOOK,
                title: 'Shorten Opening Hook',
                description: `First clip is ${firstClip.duration.toFixed(1)}s. For ${platform}, hook viewers within ${style.maxHookTime}s.`,
                reasoning: 'Short-form platforms require immediate engagement to prevent scroll-away.',
                action: {
                    operation: 'trim_opening',
                    target_duration: style.minHookTime + (style.maxHookTime - style.minHookTime) / 2,
                    clip_id: firstClip.id
                },
                confidence: CONFIDENCE.HIGH,
                impact: 'high',
                requires_user_approval: true
            });
        }

        // Suggest moving best content to front
        if (clips.length > 3) {
            suggestions.push({
                id: `hook_${Date.now()}_2`,
                type: SUGGESTION_TYPES.HOOK,
                title: 'Best Content First',
                description: 'Consider placing your most engaging moment in the first 3 seconds.',
                reasoning: 'The "bury the lede" mistake loses viewers who won\'t wait for the payoff.',
                variants: [
                    { name: 'Teaser Hook', description: 'Show a preview of the best moment, then build to it' },
                    { name: 'Cold Open', description: 'Start mid-action, add context later' },
                    { name: 'Question Hook', description: 'Open with intriguing text question' }
                ],
                action: {
                    operation: 'reorder_for_hook'
                },
                confidence: CONFIDENCE.MEDIUM,
                impact: 'high',
                requires_user_approval: true
            });
        }

        return suggestions;
    }

    // ==================== EFFECT SUGGESTIONS ====================

    suggestEffects(state, context, platform) {
        const suggestions = [];
        const clips = this.getAllClips(state);
        const style = PLATFORM_STYLES[platform] || PLATFORM_STYLES.youtube;

        // Suggest zoom for emphasis
        if (clips.length > 0 && style.preferredPacing === 'fast') {
            suggestions.push({
                id: `effect_${Date.now()}_1`,
                type: SUGGESTION_TYPES.EFFECT,
                title: 'Add Zoom Punches',
                description: 'Quick zoom effects add energy and emphasize key moments.',
                reasoning: 'Zoom punches are signature to TikTok/Reels style and boost engagement.',
                action: {
                    operation: 'add_zoom_punch',
                    intensity: 1.2,
                    duration: 0.2
                },
                confidence: CONFIDENCE.MEDIUM,
                impact: 'medium',
                requires_user_approval: true
            });
        }

        // Suggest motion if static
        const hasMotion = clips.some(c => c.effects?.includes('motion') || c.effects?.includes('ken_burns'));
        if (!hasMotion && clips.length > 0) {
            suggestions.push({
                id: `effect_${Date.now()}_2`,
                type: SUGGESTION_TYPES.EFFECT,
                title: 'Add Subtle Motion',
                description: 'Add Ken Burns effect or slow zoom to static shots.',
                reasoning: 'Subtle motion prevents "slideshow" feel and adds visual interest.',
                action: {
                    operation: 'add_ken_burns',
                    scale: 1.05,
                    apply_to: 'static_clips'
                },
                confidence: CONFIDENCE.LOW,
                impact: 'low',
                requires_user_approval: true
            });
        }

        return suggestions;
    }

    // ==================== AUDIO SUGGESTIONS ====================

    suggestAudioEnhancements(state, context) {
        const suggestions = [];

        // Check for audio track
        const audioTracks = state.tracks?.filter(t => t.type === 'audio') || [];
        const hasBackgroundMusic = audioTracks.some(t => t.clips?.length > 0);

        if (!hasBackgroundMusic) {
            suggestions.push({
                id: `audio_${Date.now()}_1`,
                type: SUGGESTION_TYPES.AUDIO,
                title: 'Add Background Music',
                description: 'Consider adding music to enhance emotional impact.',
                reasoning: 'Music drives pacing and emotional connection in short-form content.',
                variants: [
                    { name: 'Upbeat/Energetic', description: 'For tutorials, comedy, fast content' },
                    { name: 'Chill/Lo-fi', description: 'For vlogs, aesthetic content' },
                    { name: 'Dramatic/Cinematic', description: 'For storytelling, reveals' }
                ],
                action: {
                    operation: 'add_background_music'
                },
                confidence: CONFIDENCE.HIGH,
                impact: 'high',
                requires_user_approval: true
            });
        }

        // Suggest sound effects
        suggestions.push({
            id: `audio_${Date.now()}_2`,
            type: SUGGESTION_TYPES.AUDIO,
            title: 'Add Sound Effects',
            description: 'Consider whooshes on transitions and impact sounds on key moments.',
            reasoning: 'Sound effects add polish and make edits feel more intentional.',
            action: {
                operation: 'add_sfx'
            },
            confidence: CONFIDENCE.LOW,
            impact: 'medium',
            requires_user_approval: true
        });

        return suggestions;
    }

    // ==================== TEXT SUGGESTIONS ====================

    suggestTextOverlays(state, context, platform) {
        const suggestions = [];
        const textTracks = state.tracks?.filter(t => t.type === 'text') || [];
        const hasText = textTracks.some(t => t.clips?.length > 0);
        const totalDuration = this.getTotalDuration(state);

        if (!hasText && totalDuration > 5) {
            suggestions.push({
                id: `text_${Date.now()}_1`,
                type: SUGGESTION_TYPES.TEXT,
                title: 'Add Captions',
                description: '80% of social media videos are watched on mute. Add captions for accessibility.',
                reasoning: 'Captions dramatically increase watch time and accessibility.',
                variants: [
                    { name: 'Word-by-word', description: 'Dynamic, engaging, TikTok style' },
                    { name: 'Sentence', description: 'Clean, professional, YouTube style' },
                    { name: 'Key phrases only', description: 'Minimal, for emphasis' }
                ],
                action: {
                    operation: 'generate_captions'
                },
                confidence: CONFIDENCE.HIGH,
                impact: 'high',
                requires_user_approval: true
            });
        }

        // Suggest hook text
        suggestions.push({
            id: `text_${Date.now()}_2`,
            type: SUGGESTION_TYPES.TEXT,
            title: 'Add Text Hook',
            description: 'Consider adding attention-grabbing text in the first 2 seconds.',
            reasoning: 'Text hooks stop scrollers and set expectations.',
            variants: [
                { name: 'Question', example: '"Did you know...?"' },
                { name: 'Bold Statement', example: '"This changed everything"' },
                { name: 'List Tease', example: '"3 tips you need..."' }
            ],
            action: {
                operation: 'add_hook_text'
            },
            confidence: CONFIDENCE.MEDIUM,
            impact: 'high',
            requires_user_approval: true
        });

        return suggestions;
    }

    // ==================== COLOR SUGGESTIONS ====================

    suggestColorGrading(state, context) {
        const suggestions = [];
        const clips = this.getAllClips(state);
        const hasColorGrade = clips.some(c => c.colorGrade && c.colorGrade !== 'none');

        if (!hasColorGrade && clips.length > 0) {
            suggestions.push({
                id: `color_${Date.now()}_1`,
                type: SUGGESTION_TYPES.COLOR,
                title: 'Apply Color Grade',
                description: 'A consistent color grade gives your video a polished, cohesive look.',
                reasoning: 'Color grading establishes mood and makes content look professional.',
                variants: [
                    { name: 'Warm', description: 'Cozy, nostalgic feel', settings: { temperature: 15, saturation: 110 } },
                    { name: 'Cool', description: 'Modern, tech feel', settings: { temperature: -10, saturation: 95 } },
                    { name: 'Moody', description: 'Cinematic, dramatic', settings: { contrast: 120, saturation: 85 } },
                    { name: 'Vibrant', description: 'Eye-catching, energetic', settings: { saturation: 130, contrast: 105 } }
                ],
                action: {
                    operation: 'apply_color_grade'
                },
                confidence: CONFIDENCE.MEDIUM,
                impact: 'medium',
                requires_user_approval: true
            });
        }

        return suggestions;
    }

    // ==================== RANKING & OUTPUT ====================

    rankSuggestions(suggestions, platform) {
        // Score each suggestion
        const scored = suggestions.map(s => {
            let score = 0;

            // Impact score
            if (s.impact === 'high') score += 30;
            else if (s.impact === 'medium') score += 20;
            else score += 10;

            // Confidence score
            if (s.confidence === CONFIDENCE.HIGH) score += 30;
            else if (s.confidence === CONFIDENCE.MEDIUM) score += 20;
            else score += 10;

            // Platform-specific boosts
            if (platform === 'tiktok' || platform === 'instagram_reels') {
                if (s.type === SUGGESTION_TYPES.HOOK) score += 15;
                if (s.type === SUGGESTION_TYPES.PACING) score += 10;
            }
            if (platform === 'youtube') {
                if (s.type === SUGGESTION_TYPES.STRUCTURE) score += 10;
            }

            return { ...s, score, rank: 0 };
        });

        // Sort by score
        scored.sort((a, b) => b.score - a.score);

        // Assign ranks
        return scored.map((s, i) => ({ ...s, rank: i + 1 }));
    }

    generateSummary(suggestions) {
        const highImpact = suggestions.filter(s => s.impact === 'high').length;
        const types = [...new Set(suggestions.map(s => s.type))];

        return {
            total_suggestions: suggestions.length,
            high_impact_count: highImpact,
            categories: types,
            top_suggestion: suggestions[0]?.title || null
        };
    }

    // ==================== HELPERS ====================

    detectPlatform(state) {
        const aspectRatio = state.aspectRatio || '16:9';
        const duration = this.getTotalDuration(state);

        if (aspectRatio === '9:16') {
            if (duration <= 60) return 'tiktok';
            return 'instagram_reels';
        }
        if (aspectRatio === '1:1') return 'instagram_reels';
        return 'youtube';
    }

    getAllClips(state) {
        const clips = [];
        for (const track of state.tracks || []) {
            if (track.type === 'video' && track.clips) {
                clips.push(...track.clips.map(c => ({ ...c, trackId: track.id })));
            }
        }
        return clips.sort((a, b) => a.start - b.start);
    }

    getTotalDuration(state) {
        let maxEnd = 0;
        for (const track of state.tracks || []) {
            for (const clip of track.clips || []) {
                const end = clip.start + clip.duration;
                if (end > maxEnd) maxEnd = end;
            }
        }
        return maxEnd;
    }

    calculateVariance(values) {
        if (values.length === 0) return 0;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length) / mean;
    }

    getTransitionDescription(type) {
        const descriptions = {
            fade: 'Smooth fade to black or next clip',
            dissolve: 'Crossfade between clips',
            wipe: 'Geometric wipe transition',
            slide: 'Slide one clip over another',
            zoom: 'Zoom into or out of next clip',
            jump_cut: 'Hard cut with slight zoom',
            whip_pan: 'Fast pan motion blur'
        };
        return descriptions[type] || type;
    }

    /**
     * Get current suggestions (for UI)
     */
    getSuggestions() {
        return this.suggestions;
    }

    /**
     * Accept a suggestion (returns action for orchestrator)
     */
    acceptSuggestion(suggestionId) {
        const suggestion = this.suggestions.find(s => s.id === suggestionId);
        if (!suggestion) return null;

        return {
            accepted: true,
            suggestion_id: suggestionId,
            action: suggestion.action,
            requires_user_approval: suggestion.requires_user_approval
        };
    }

    /**
     * Dismiss a suggestion
     */
    dismissSuggestion(suggestionId) {
        this.suggestions = this.suggestions.filter(s => s.id !== suggestionId);
        return { dismissed: true, suggestion_id: suggestionId };
    }
}

// Singleton instance
export const creativeDirector = new CreativeDirector();

export default CreativeDirector;
