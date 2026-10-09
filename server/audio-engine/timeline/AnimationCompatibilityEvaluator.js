/**
 * server/audio-engine/timeline/AnimationCompatibilityEvaluator.js
 * Server-side mirror of the Style-Aware Motion Compatibility Engine.
 */

const EDITING_STYLES = Object.freeze({
    TALKING_HEAD: 'talking_head',
    REEL: 'reel',
    VLOG: 'vlog',
    REPURPOSING: 'repurposing',
    PODCAST: 'podcast',
    EXPLAINER: 'explainer',
});

const STYLE_MOTION_RULES = Object.freeze({
    talking_head: {
        name: 'Talking Head / Direct Address',
        description: 'Single speaker addressing the audience. Prioritizes authority, subject visibility, clean typography, and low cognitive fatigue.',
        pacing: 'balanced',
        safeZoneConstraint: { top: 0.12, bottom: 0.78, horizontal: 0.08 },
        idealTemplates: [
            'lower-third-minimal', 'line-graph', 'highlight-box', 'circle-callout',
            'underline', 'data-counter', 'price-pop',
        ],
        cautionTemplates: [
            'bar-chart', 'circular-meter', 'progress-bar', 'code-window', 'location-badge',
        ],
        incompatibleTemplates: [
            'vhs-glitch', 'burst',
        ],
        idealCaptionPacks: ['vox-highlighter', 'ali-abdaal', 'documentary', 'apple'],
        cautionCaptionPacks: ['typewriter-terminal', 'gaming', 'bold-impact'],
        incompatibleCaptionPacks: ['hormozi-bounce'],
        idealCameraMotion: ['subtle', 'cinematic'],
        incompatibleCameraMotion: ['dynamic'],
        idealTransitions: ['dip', 'crossfade'],
        incompatibleTransitions: ['flash', 'glitch'],
        palette: { primary: '#00E5FF', accent: '#FFE500', background: 'rgba(12, 16, 26, 0.94)' },
    },

    reel: {
        name: 'Reel / Short-Form Retention',
        description: 'High-energy 9:16 vertical video (TikTok, Reels, Shorts). Prioritizes hook retention, pattern interrupts every 2-3s, and kinetic typography.',
        pacing: 'rapid',
        safeZoneConstraint: { top: 0.14, bottom: 0.76, horizontal: 0.10 },
        idealTemplates: [
            'retention-progress-bar', 'data-counter', 'price-pop', 'burst',
            'light-leak', 'arrow', 'progress-bar', 'counter',
        ],
        cautionTemplates: [
            'line-graph', 'circular-meter', 'vhs-glitch', 'lower-third-minimal',
        ],
        incompatibleTemplates: [
            'code-window',
        ],
        idealCaptionPacks: ['hormozi-bounce', 'neon-punch', 'mrbeast', 'bold-impact'],
        cautionCaptionPacks: ['vox-highlighter', 'ali-abdaal'],
        incompatibleCaptionPacks: ['luxury'],
        idealCameraMotion: ['dynamic'],
        incompatibleCameraMotion: [],
        idealTransitions: ['whip-left', 'whip-right', 'flash', 'zoom-punch'],
        incompatibleTransitions: ['dip'],
        palette: { primary: '#FFE500', accent: '#00E5FF', background: 'rgba(10, 10, 15, 0.95)' },
    },

    vlog: {
        name: 'Vlog / Narrative Lifestyle',
        description: 'Chronological personal travel and storytelling. Emphasizes organic, authentic atmosphere and relaxed rhythmic flow.',
        pacing: 'organic',
        safeZoneConstraint: { top: 0.10, bottom: 0.82, horizontal: 0.06 },
        idealTemplates: [
            'location-badge', 'film-grain', 'circle-callout', 'underline',
            'arrow', 'counter',
        ],
        cautionTemplates: [
            'price-pop', 'retention-progress-bar', 'data-counter', 'progress-bar',
        ],
        incompatibleTemplates: [
            'code-window', 'circular-meter', 'line-graph',
        ],
        idealCaptionPacks: ['mrbeast', 'clean-modern', 'soft-rounded'],
        cautionCaptionPacks: ['vox-highlighter', 'ali-abdaal'],
        incompatibleCaptionPacks: ['typewriter-terminal', 'gaming'],
        idealCameraMotion: ['subtle'],
        incompatibleCameraMotion: [],
        idealTransitions: ['speed-lines', 'whip-left', 'whip-right'],
        incompatibleTransitions: ['glitch'],
        palette: { primary: '#FF3B5C', accent: '#FFE500', background: 'rgba(14, 18, 28, 0.92)' },
    },

    repurposing: {
        name: 'Repurposed Social Clip',
        description: 'Long-form podcast or interview reframed into punchy standalone vertical video. Focuses on thesis highlights and social proof.',
        pacing: 'structured',
        safeZoneConstraint: { top: 0.14, bottom: 0.78, horizontal: 0.10 },
        idealTemplates: [
            'quote-card', 'data-counter', 'retention-progress-bar', 'lower-third-minimal',
            'line-graph', 'price-pop',
        ],
        cautionTemplates: [
            'arrow', 'burst', 'progress-bar', 'light-leak',
        ],
        incompatibleTemplates: [
            'vhs-glitch',
        ],
        idealCaptionPacks: ['vox-highlighter', 'hormozi-bounce', 'ali-abdaal'],
        cautionCaptionPacks: ['neon-punch', 'documentary'],
        incompatibleCaptionPacks: ['gaming'],
        idealCameraMotion: ['subtle', 'dynamic'],
        incompatibleCameraMotion: [],
        idealTransitions: ['whip-left', 'flash', 'dip'],
        incompatibleTransitions: [],
        palette: { primary: '#00E5FF', accent: '#FFE500', background: 'rgba(12, 16, 24, 0.94)' },
    },

    podcast: {
        name: 'Podcast & Long-Form Discussion',
        description: 'In-depth conversational exchange. Audio fidelity and speaker comfort take priority over hyperactive visuals.',
        pacing: 'calm',
        safeZoneConstraint: { top: 0.10, bottom: 0.84, horizontal: 0.06 },
        idealTemplates: [
            'lower-third-minimal', 'quote-card', 'price-pop', 'underline',
        ],
        cautionTemplates: [
            'data-counter', 'line-graph', 'highlight-box',
        ],
        incompatibleTemplates: [
            'vhs-glitch', 'burst', 'retention-progress-bar',
        ],
        idealCaptionPacks: ['podcast', 'ali-abdaal', 'documentary'],
        cautionCaptionPacks: ['clean-modern'],
        incompatibleCaptionPacks: ['hormozi-bounce', 'neon-punch', 'gaming'],
        idealCameraMotion: ['subtle'],
        incompatibleCameraMotion: ['dynamic'],
        idealTransitions: ['dip', 'crossfade'],
        incompatibleTransitions: ['flash', 'whip-left', 'whip-right', 'zoom-punch'],
        palette: { primary: '#E8C27A', accent: '#00E5FF', background: 'rgba(15, 18, 26, 0.94)' },
    },

    explainer: {
        name: 'Explainer & Educational Deep-Dive',
        description: 'Information-dense journalism (Vox-style). Visuals must provide data clarity and substantiate spoken claims.',
        pacing: 'deliberate',
        safeZoneConstraint: { top: 0.12, bottom: 0.80, horizontal: 0.08 },
        idealTemplates: [
            'line-graph', 'bar-chart', 'circular-meter', 'code-window',
            'progress-bar', 'underline', 'highlight-box', 'circle-callout',
        ],
        cautionTemplates: [
            'data-counter', 'lower-third-minimal', 'film-grain',
        ],
        incompatibleTemplates: [
            'vhs-glitch', 'burst',
        ],
        idealCaptionPacks: ['vox-highlighter', 'ali-abdaal', 'typewriter-terminal'],
        cautionCaptionPacks: ['mrbeast'],
        incompatibleCaptionPacks: ['hormozi-bounce', 'neon-punch'],
        idealCameraMotion: ['subtle', 'cinematic'],
        incompatibleCameraMotion: ['dynamic'],
        idealTransitions: ['dip', 'crossfade'],
        incompatibleTransitions: ['flash', 'glitch'],
        palette: { primary: '#00E5FF', accent: '#FFE500', background: 'rgba(12, 16, 26, 0.94)' },
    },
});

function evaluateMotionCompatibility(styleId, category, itemKey, currentParams = {}) {
    const normalizedStyle = STYLE_MOTION_RULES[styleId] ? styleId : 'talking_head';
    const rules = STYLE_MOTION_RULES[normalizedStyle];

    let score = 0.75;
    let verdict = 'compatible';
    let reason = '';
    const alternatives = [];
    let adaptedParams = { ...currentParams };

    switch (category) {
        case 'template': {
            if (rules.idealTemplates.includes(itemKey)) {
                score = 0.95;
                verdict = 'ideal';
                reason = `'${itemKey}' perfectly reinforces the ${rules.name} aesthetic.`;
            } else if (rules.incompatibleTemplates.includes(itemKey)) {
                score = 0.25;
                verdict = 'incompatible';
                reason = `'${itemKey}' clashes with ${rules.name}. ${rules.description}`;
                rules.idealTemplates.slice(0, 3).forEach(alt => {
                    alternatives.push({ key: alt, name: alt, reason: `Native fit for ${rules.name}` });
                });
            } else if (rules.cautionTemplates.includes(itemKey)) {
                score = 0.55;
                verdict = 'caution';
                reason = `'${itemKey}' can be used in ${rules.name}, but may distract if not carefully positioned.`;
            } else {
                score = 0.70;
                verdict = 'compatible';
                reason = `'${itemKey}' is acceptable in ${rules.name}.`;
            }
            if (rules.palette) {
                if (!adaptedParams.color || adaptedParams.color === '#000000') {
                    adaptedParams.color = rules.palette.primary;
                }
                if (!adaptedParams.accent) {
                    adaptedParams.accent = rules.palette.accent;
                }
            }
            break;
        }

        case 'caption': {
            if (rules.idealCaptionPacks.includes(itemKey)) {
                score = 0.98;
                verdict = 'ideal';
                reason = `'${itemKey}' captions match the pacing and audience expectation for ${rules.name}.`;
            } else if (rules.incompatibleCaptionPacks.includes(itemKey)) {
                score = 0.30;
                verdict = 'incompatible';
                reason = `'${itemKey}' kinetic captions introduce cognitive clash in ${rules.name}.`;
                rules.idealCaptionPacks.slice(0, 2).forEach(alt => {
                    alternatives.push({ key: alt, name: alt, reason: `Engineered for ${rules.name}` });
                });
            } else {
                score = 0.72;
                verdict = 'compatible';
                reason = `'${itemKey}' captions are compatible.`;
            }
            break;
        }

        case 'camera': {
            if (rules.idealCameraMotion.includes(itemKey)) {
                score = 0.95;
                verdict = 'ideal';
                reason = `${itemKey} camera motion supports the natural rhythm of ${rules.name}.`;
            } else if (rules.incompatibleCameraMotion.includes(itemKey)) {
                score = 0.20;
                verdict = 'incompatible';
                reason = `${itemKey} camera movement is too aggressive for ${rules.name}.`;
                rules.idealCameraMotion.forEach(alt => {
                    alternatives.push({ key: alt, name: alt, reason: `Recommended for ${rules.name}` });
                });
            } else {
                score = 0.70;
                verdict = 'compatible';
                reason = `${itemKey} camera motion is acceptable.`;
            }
            break;
        }

        case 'transition': {
            if (rules.idealTransitions.includes(itemKey)) {
                score = 0.95;
                verdict = 'ideal';
                reason = `'${itemKey}' transition fits the cut cadence of ${rules.name}.`;
            } else if (rules.incompatibleTransitions.includes(itemKey)) {
                score = 0.25;
                verdict = 'incompatible';
                reason = `'${itemKey}' transitions cause visual disruption in ${rules.name}.`;
                rules.idealTransitions.forEach(alt => {
                    alternatives.push({ key: alt, name: alt, reason: `Recommended cut transition for ${rules.name}` });
                });
            } else {
                score = 0.70;
                verdict = 'compatible';
                reason = `'${itemKey}' transition is acceptable.`;
            }
            break;
        }

        default:
            score = 0.70;
            verdict = 'compatible';
            reason = 'Category has no explicit constraints.';
    }

    return {
        score,
        compatible: score >= 0.65,
        verdict,
        reason,
        alternatives,
        adaptedParams,
    };
}

function getRecommendedMotionSuite(styleId) {
    const normalized = STYLE_MOTION_RULES[styleId] ? styleId : 'talking_head';
    const rules = STYLE_MOTION_RULES[normalized];
    return {
        styleId: normalized,
        name: rules.name,
        description: rules.description,
        recommendedTemplates: rules.idealTemplates,
        recommendedCaptionPack: rules.idealCaptionPacks[0],
        recommendedCameraMotion: rules.idealCameraMotion[0],
        recommendedTransition: rules.idealTransitions[0],
        palette: rules.palette,
        safeZones: rules.safeZoneConstraint,
    };
}

module.exports = {
    EDITING_STYLES,
    STYLE_MOTION_RULES,
    evaluateMotionCompatibility,
    getRecommendedMotionSuite,
};
