/**
 * server/brain/PlatformKnowledge.js
 *
 * Static knowledge base of platform-specific editing rules and standards.
 * Used by EditorialBrain to validate projects and generate contextual advice.
 */

'use strict';

/** @type {Object.<string, PlatformSpec>} */
const PLATFORM_KNOWLEDGE = {

    youtube_long: {
        name: 'YouTube (Long-form)',
        idealDuration: { min: 480, max: 1800 },   // 8–30 min
        hookDuration: { max: 30 },                 // hook must land in first 30s
        cutRate: { min: 0.5, max: 4 },             // cuts per minute
        captionsRequired: false,
        paceStyle: 'moderate',
        loudnessStandard: -14,                     // LUFS target
        retentionRules: [
            'Open with a strong hook — state the value prop in first 30s',
            'Use pattern interrupts every 60–90 seconds to reset attention',
            'Add B-roll cutaways when speaking for >30s without action',
            'End screen or CTA placement in final 20 seconds',
            'Chapters help with Watch Time on longer content',
            'Avoid long silence gaps — cut to <0.3s between speakers',
        ],
        editingStyle: 'Structured storytelling with clear segments. Moderate pacing with deliberate cuts. B-roll to illustrate concepts. Color grading to match channel brand.',
    },

    tiktok: {
        name: 'TikTok',
        idealDuration: { min: 15, max: 60 },       // 15–60s sweet spot
        hookDuration: { max: 3 },                  // hook within first 3s
        cutRate: { min: 6, max: 20 },              // fast cuts
        captionsRequired: true,                    // 85% of TikTok watched muted
        paceStyle: 'fast',
        loudnessStandard: -14,
        retentionRules: [
            'Hook must be in the first 1–3 seconds — text overlay or action',
            'Captions are mandatory — 85% of TikTok is watched without sound',
            'Keep cuts fast — dead air kills retention',
            'Vertical format (9:16) required',
            'End with a loop or CTA that encourages replay',
            'Text overlays should summarise the spoken point',
            'Trending audio increases organic reach',
        ],
        editingStyle: 'Ultra-fast, punchy editing. Frequent cuts. Text overlays on every key point. Jump cuts acceptable. Energetic audio. Trending sounds.',
    },

    instagram_reels: {
        name: 'Instagram Reels',
        idealDuration: { min: 15, max: 90 },       // 15–90s
        hookDuration: { max: 3 },
        cutRate: { min: 4, max: 15 },
        captionsRequired: true,
        paceStyle: 'fast',
        loudnessStandard: -14,
        retentionRules: [
            'Hook in first 3 seconds — visual or text',
            'Captions required for accessibility and silent viewing',
            'Vertical 9:16 preferred; 4:5 acceptable',
            'Transitions should feel intentional and on-beat',
            'Cover frame matters — first frame is the thumbnail',
            'Keep text in the safe zone — avoid edges (overlaid by UI)',
        ],
        editingStyle: 'Visually polished, aesthetic editing. Beat-matched transitions. Consistent color grading. Strong cover frame. Lifestyle or aspirational framing.',
    },

    youtube_shorts: {
        name: 'YouTube Shorts',
        idealDuration: { min: 15, max: 60 },
        hookDuration: { max: 3 },
        cutRate: { min: 4, max: 15 },
        captionsRequired: false,
        paceStyle: 'fast',
        loudnessStandard: -14,
        retentionRules: [
            'Hook in first 3 seconds',
            'Vertical format (9:16) required',
            'Loop-able content performs better',
            'Subscribe prompt visible mid-video outperforms end-screen only',
            'Avoid black bars — fill the frame',
        ],
        editingStyle: 'Fast-paced, punchy. Repurpose long-form content by extracting the highest-value moment. Add captions for silent viewing.',
    },

    podcast: {
        name: 'Podcast (Video)',
        idealDuration: { min: 900, max: 5400 },    // 15–90 min
        hookDuration: { max: 60 },
        cutRate: { min: 0.2, max: 1.5 },
        captionsRequired: false,
        paceStyle: 'slow',
        loudnessStandard: -16,                     // Podcast standard is -16 LUFS
        retentionRules: [
            'Remove silence gaps and filler words (um, uh, like)',
            'Audio quality is paramount — denoise and normalize',
            'Lower third name cards for guest introductions',
            'Chapter markers help listeners navigate',
            'Trim awkward pauses between speakers',
            'B-roll of screen share or references helps visual engagement',
        ],
        editingStyle: 'Minimal cuts, natural conversation flow. Clean audio is the priority. Multicam switching on speaker change. Subtle color grade. Clean, professional look.',
    },

    linkedin: {
        name: 'LinkedIn',
        idealDuration: { min: 30, max: 180 },      // 30s–3 min
        hookDuration: { max: 5 },
        cutRate: { min: 1, max: 6 },
        captionsRequired: true,                    // LinkedIn is 80%+ muted
        paceStyle: 'moderate',
        loudnessStandard: -14,
        retentionRules: [
            'Captions required — LinkedIn feed is predominantly muted',
            'Professional framing — good lighting, clean background',
            'Lead with a bold claim or insight in the first 5 seconds',
            'Deliver value before the pitch',
            'Square (1:1) or vertical (4:5) perform better in feed',
            'Keep it focused — one idea per video',
        ],
        editingStyle: 'Professional, authoritative tone. Clean cuts. Talking-head style with good lighting. Text overlay for key stats or quotes. Subtle, professional color grade.',
    },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return a platform spec by key, or null if unknown.
 * @param {string} platformKey
 * @returns {Object|null}
 */
function getPlatform(platformKey) {
    if (!platformKey) return null;
    return PLATFORM_KNOWLEDGE[platformKey] ?? null;
}

/**
 * Evaluate a project context against a platform's rules.
 * @param {Object} context       - Built context from ContextEngine
 * @param {Object} platform      - Platform spec from PLATFORM_KNOWLEDGE
 * @returns {{ rule: string, passing: boolean, severity: string, suggestion: string }[]}
 */
function evaluateAgainstPlatform(context, platform) {
    if (!platform || !context) return [];

    const results = [];

    // Duration check
    if (context.duration > 0) {
        const tooLong  = context.duration > platform.idealDuration.max;
        const tooShort = context.duration < platform.idealDuration.min;
        if (tooLong) {
            results.push({
                rule: 'duration_too_long',
                passing: false,
                severity: 'warning',
                suggestion: `Trim to under ${Math.round(platform.idealDuration.max / 60)}m for ${platform.name}. Current: ${Math.round(context.duration / 60)}m.`,
            });
        } else if (tooShort) {
            results.push({
                rule: 'duration_too_short',
                passing: false,
                severity: 'info',
                suggestion: `Content may be too short for ${platform.name} (minimum ${Math.round(platform.idealDuration.min)}s).`,
            });
        } else {
            results.push({ rule: 'duration', passing: true, severity: 'info', suggestion: '' });
        }
    }

    // Captions check
    if (platform.captionsRequired && !context.hasCaptions) {
        results.push({
            rule: 'captions_required',
            passing: false,
            severity: 'critical',
            suggestion: `Captions are required for ${platform.name} — most viewers watch without sound.`,
        });
    } else if (platform.captionsRequired) {
        results.push({ rule: 'captions_required', passing: true, severity: 'info', suggestion: '' });
    }

    // Aspect ratio check (TikTok, Reels, Shorts require 9:16)
    const verticalPlatforms = ['tiktok', 'instagram_reels', 'youtube_shorts'];
    const platformKey = Object.keys(PLATFORM_KNOWLEDGE).find(k => PLATFORM_KNOWLEDGE[k] === platform);
    if (verticalPlatforms.includes(platformKey) && context.aspectRatio && context.aspectRatio !== '9:16') {
        results.push({
            rule: 'aspect_ratio',
            passing: false,
            severity: 'critical',
            suggestion: `${platform.name} requires vertical (9:16) format. Current: ${context.aspectRatio}.`,
        });
    }

    // Cut rate check
    if (context.cutRate !== undefined && context.cutRate > 0) {
        const cutRateTooSlow = context.cutRate < platform.cutRate.min;
        const cutRateTooFast = context.cutRate > platform.cutRate.max;
        if (cutRateTooSlow) {
            results.push({
                rule: 'cut_rate_too_slow',
                passing: false,
                severity: 'info',
                suggestion: `Pacing may feel slow for ${platform.name}. Consider more cuts (current: ${context.cutRate.toFixed(1)}/min, target: >${platform.cutRate.min}/min).`,
            });
        } else if (cutRateTooFast) {
            results.push({
                rule: 'cut_rate_too_fast',
                passing: false,
                severity: 'info',
                suggestion: `Pacing may feel frenetic. Current cut rate ${context.cutRate.toFixed(1)}/min exceeds ${platform.name} max of ${platform.cutRate.max}/min.`,
            });
        } else {
            results.push({ rule: 'cut_rate', passing: true, severity: 'info', suggestion: '' });
        }
    }

    return results;
}

module.exports = { PLATFORM_KNOWLEDGE, getPlatform, evaluateAgainstPlatform };
