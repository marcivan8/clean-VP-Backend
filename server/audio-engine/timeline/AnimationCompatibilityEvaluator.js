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
            'underline', 'data-counter', 'price-pop', 'kpi-stat-callout', 'comparison-card',
        ],
        cautionTemplates: [
            'bar-chart', 'circular-meter', 'progress-bar', 'code-window', 'location-badge',
            'social-notification', 'comment-bubble', 'search-bar', 'newspaper-headline',
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
        backgroundTreatment: {
            recommendedMode: 'blur',
            defaultBlur: 16,
            reveal: 'rack-focus',
            revealDuration: 0.65,
            allowSandwichText: true,
            sandwichDescription: 'Sandwich bold kinetic titles and KPI badges behind the speaker to establish authority and depth.',
        },
    },

    reel: {
        name: 'Reel / Short-Form Retention',
        description: 'High-energy 9:16 vertical video (TikTok, Reels, Shorts). Prioritizes hook retention, pattern interrupts every 2-3s, and kinetic typography.',
        pacing: 'rapid',
        safeZoneConstraint: { top: 0.14, bottom: 0.76, horizontal: 0.10 },
        idealTemplates: [
            'retention-progress-bar', 'data-counter', 'price-pop', 'burst',
            'light-leak', 'arrow', 'progress-bar', 'counter',
            'social-notification', 'comment-bubble', 'search-bar', 'kpi-stat-callout', 'comparison-card',
        ],
        cautionTemplates: [
            'line-graph', 'circular-meter', 'vhs-glitch', 'lower-third-minimal', 'newspaper-headline',
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
        backgroundTreatment: {
            recommendedMode: 'dim',
            defaultDim: 0.45,
            reveal: 'dim-spotlight',
            revealDuration: 0.45,
            allowSandwichText: true,
            sandwichDescription: 'Sandwich large high-impact hook words behind the creator on opening beats.',
        },
    },

    vlog: {
        name: 'Vlog / Narrative Lifestyle',
        description: 'Chronological personal travel and storytelling. Emphasizes organic, authentic atmosphere and relaxed rhythmic flow.',
        pacing: 'organic',
        safeZoneConstraint: { top: 0.10, bottom: 0.82, horizontal: 0.06 },
        idealTemplates: [
            'location-badge', 'film-grain', 'circle-callout', 'underline',
            'arrow', 'counter', 'social-notification',
        ],
        cautionTemplates: [
            'price-pop', 'retention-progress-bar', 'data-counter', 'progress-bar',
            'comment-bubble', 'search-bar', 'comparison-card',
        ],
        incompatibleTemplates: [
            'code-window', 'circular-meter', 'line-graph', 'newspaper-headline',
        ],
        idealCaptionPacks: ['mrbeast', 'clean-modern', 'soft-rounded'],
        cautionCaptionPacks: ['vox-highlighter', 'ali-abdaal'],
        incompatibleCaptionPacks: ['typewriter-terminal', 'gaming'],
        idealCameraMotion: ['subtle'],
        incompatibleCameraMotion: [],
        idealTransitions: ['speed-lines', 'whip-left', 'whip-right'],
        incompatibleTransitions: ['glitch'],
        palette: { primary: '#FF3B5C', accent: '#FFE500', background: 'rgba(14, 18, 28, 0.92)' },
        backgroundTreatment: {
            recommendedMode: 'blur',
            defaultBlur: 10,
            reveal: 'focus-pull',
            revealDuration: 0.8,
            allowSandwichText: false,
            sandwichDescription: 'Vlogs favor natural environmental framing without intrusive text sandwiching.',
        },
    },

    repurposing: {
        name: 'Repurposed Social Clip',
        description: 'Long-form podcast or interview reframed into punchy standalone vertical video. Focuses on thesis highlights and social proof.',
        pacing: 'structured',
        safeZoneConstraint: { top: 0.14, bottom: 0.78, horizontal: 0.10 },
        idealTemplates: [
            'quote-card', 'data-counter', 'retention-progress-bar', 'lower-third-minimal',
            'line-graph', 'price-pop', 'comment-bubble', 'social-notification', 'comparison-card', 'kpi-stat-callout',
        ],
        cautionTemplates: [
            'arrow', 'burst', 'progress-bar', 'light-leak', 'search-bar', 'newspaper-headline',
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
        backgroundTreatment: {
            recommendedMode: 'dim',
            defaultDim: 0.55,
            reveal: 'dim-spotlight',
            revealDuration: 0.6,
            allowSandwichText: true,
            sandwichDescription: 'Sandwich quote cards or key timestamps behind guest speakers.',
        },
    },

    podcast: {
        name: 'Podcast & Long-Form Discussion',
        description: 'In-depth conversational exchange. Audio fidelity and speaker comfort take priority over hyperactive visuals.',
        pacing: 'calm',
        safeZoneConstraint: { top: 0.10, bottom: 0.84, horizontal: 0.06 },
        idealTemplates: [
            'lower-third-minimal', 'quote-card', 'price-pop', 'underline', 'comment-bubble',
        ],
        cautionTemplates: [
            'data-counter', 'line-graph', 'highlight-box', 'comparison-card', 'social-notification',
            'kpi-stat-callout', 'newspaper-headline',
        ],
        incompatibleTemplates: [
            'vhs-glitch', 'burst', 'retention-progress-bar', 'search-bar',
        ],
        idealCaptionPacks: ['podcast', 'ali-abdaal', 'documentary'],
        cautionCaptionPacks: ['clean-modern'],
        incompatibleCaptionPacks: ['hormozi-bounce', 'neon-punch', 'gaming'],
        idealCameraMotion: ['subtle'],
        incompatibleCameraMotion: ['dynamic'],
        idealTransitions: ['dip', 'crossfade'],
        incompatibleTransitions: ['flash', 'whip-left', 'whip-right', 'zoom-punch'],
        palette: { primary: '#E8C27A', accent: '#00E5FF', background: 'rgba(15, 18, 26, 0.94)' },
        backgroundTreatment: {
            recommendedMode: 'blur',
            defaultBlur: 14,
            reveal: 'none',
            revealDuration: 0.5,
            allowSandwichText: true,
            sandwichDescription: 'Subtle lens bokeh with guest lower-third and topic titles placed with slight depth.',
        },
    },

    explainer: {
        name: 'Explainer & Educational Deep-Dive',
        description: 'Information-dense journalism (Vox-style). Visuals must provide data clarity and substantiate spoken claims.',
        pacing: 'deliberate',
        safeZoneConstraint: { top: 0.12, bottom: 0.80, horizontal: 0.08 },
        idealTemplates: [
            'line-graph', 'bar-chart', 'circular-meter', 'code-window',
            'progress-bar', 'underline', 'highlight-box', 'circle-callout',
            'newspaper-headline', 'comparison-card', 'kpi-stat-callout', 'search-bar',
        ],
        cautionTemplates: [
            'data-counter', 'lower-third-minimal', 'film-grain', 'comment-bubble', 'social-notification',
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
        backgroundTreatment: {
            recommendedMode: 'dim',
            defaultDim: 0.60,
            reveal: 'rack-focus',
            revealDuration: 0.75,
            allowSandwichText: true,
            sandwichDescription: 'Dim background and sandwich evidence charts or newspaper headlines behind the speaker.',
        },
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

        case 'background': {
            const bg = rules.backgroundTreatment || {};
            const isRec = itemKey === bg.recommendedMode;
            if (isRec) {
                score = 0.96;
                verdict = 'ideal';
                reason = `'${itemKey}' background perfectly reinforces the ${rules.name} look. ${bg.sandwichDescription || ''}`;
            } else if (itemKey === 'color' && normalizedStyle === 'vlog') {
                score = 0.35;
                verdict = 'incompatible';
                reason = 'Solid backdrops clash with natural lifestyle vlog aesthetics.';
                alternatives.push({ key: bg.recommendedMode || 'blur', name: bg.recommendedMode || 'blur', reason: `Natural fit for ${rules.name}` });
            } else {
                score = 0.75;
                verdict = 'compatible';
                reason = `'${itemKey}' background is compatible with ${rules.name}.`;
            }
            if (bg.reveal && !adaptedParams.reveal) {
                adaptedParams.reveal = bg.reveal;
                adaptedParams.revealDuration = bg.revealDuration;
            }
            break;
        }

        case 'depth': {
            const bg = rules.backgroundTreatment || {};
            if (itemKey === 'behind_subject') {
                if (bg.allowSandwichText) {
                    score = 0.98;
                    verdict = 'ideal';
                    reason = `Sandwiching text behind the subject creates immersive authority and depth in ${rules.name}.`;
                } else {
                    score = 0.40;
                    verdict = 'caution';
                    reason = `${rules.name} favors clean environmental framing over 3D text sandwiching.`;
                    alternatives.push({ key: 'front', name: 'Standard Foreground', reason: `Maintains authentic natural framing` });
                }
            } else {
                score = 0.85;
                verdict = 'compatible';
                reason = 'Standard foreground layering is clean and universally readable.';
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
        backgroundTreatment: rules.backgroundTreatment,
        safeZones: rules.safeZoneConstraint,
    };
}

/**
 * Complete Semantic Ontology Catalog of all Platform Motion Elements.
 * Classifies templates by cognitive category, screen zone anchor, semantic triggers,
 * and editing style suitability.
 */
const MOTION_ELEMENT_CATALOG = Object.freeze({
    // --- EDITORIAL & IDENTITY ---
    'lower-third-minimal': {
        id: 'lower-third-minimal',
        name: 'Lower Third Minimalist',
        category: 'editorial',
        screenZone: 'lower_third',
        defaultAlignment: { x: 0.50, y: 0.82 },
        semanticTriggers: ['speaker name', 'guest intro', 'role', 'title', 'credits', 'identity'],
        idealStyles: ['talking_head', 'podcast', 'explainer', 'repurposing'],
        cautionStyles: ['vlog'],
        incompatibleStyles: ['reel'],
        recommendedDuration: 4.0,
        recommendedScale: 0.75,
    },
    'quote-card': {
        id: 'quote-card',
        name: 'Editorial Quote Card',
        category: 'editorial',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.48 },
        semanticTriggers: ['citation', 'famous quote', 'tweet', 'thesis', 'key takeaway', 'philosophy'],
        idealStyles: ['repurposing', 'podcast', 'talking_head'],
        cautionStyles: ['explainer', 'vlog'],
        incompatibleStyles: ['reel'],
        recommendedDuration: 4.5,
        recommendedScale: 0.82,
    },
    'newspaper-headline': {
        id: 'newspaper-headline',
        name: 'Newspaper Print Headline',
        category: 'editorial',
        screenZone: 'top_header',
        defaultAlignment: { x: 0.50, y: 0.18 },
        semanticTriggers: ['breaking news', 'press article', 'journalism', 'report', 'media headline', 'scandal', 'investigation'],
        idealStyles: ['explainer', 'talking_head'],
        cautionStyles: ['repurposing', 'reel', 'podcast'],
        incompatibleStyles: ['vlog'],
        recommendedDuration: 3.5,
        recommendedScale: 0.86,
    },
    'logo-card': {
        id: 'logo-card',
        name: 'Brand Logo Badge',
        category: 'identification',
        screenZone: 'lower_third',
        defaultAlignment: { x: 0.50, y: 0.82 },
        semanticTriggers: ['branding', 'sponsor', 'logo', 'channel intro', 'outro'],
        idealStyles: ['talking_head', 'podcast', 'repurposing'],
        cautionStyles: ['reel', 'vlog', 'explainer'],
        incompatibleStyles: [],
        recommendedDuration: 3.0,
        recommendedScale: 0.72,
    },

    // --- DATA VISUALIZATION & METRICS ---
    'line-graph': {
        id: 'line-graph',
        name: 'Kinetic Trend Line Graph',
        category: 'data_viz',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.52 },
        semanticTriggers: ['trend', 'trajectory', 'growth over time', 'market rise', 'historical chart', 'projection'],
        idealStyles: ['explainer', 'talking_head', 'repurposing'],
        cautionStyles: ['reel'],
        incompatibleStyles: ['vlog'],
        recommendedDuration: 3.8,
        recommendedScale: 0.85,
    },
    'bar-chart': {
        id: 'bar-chart',
        name: 'Comparative Bar Chart',
        category: 'data_viz',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.52 },
        semanticTriggers: ['comparison', 'benchmark', 'ranking', 'breakdown', 'histogram'],
        idealStyles: ['explainer'],
        cautionStyles: ['talking_head', 'repurposing'],
        incompatibleStyles: ['reel', 'vlog'],
        recommendedDuration: 3.5,
        recommendedScale: 0.80,
    },
    'circular-meter': {
        id: 'circular-meter',
        name: 'Radial Percentage Meter',
        category: 'data_viz',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.50 },
        semanticTriggers: ['completion rate', 'share', 'percentage', 'capacity', 'score out of 100'],
        idealStyles: ['explainer'],
        cautionStyles: ['talking_head', 'reel'],
        incompatibleStyles: ['vlog'],
        recommendedDuration: 3.0,
        recommendedScale: 0.50,
    },
    'data-counter': {
        id: 'data-counter',
        name: 'Live Ticking Data Counter',
        category: 'data_viz',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.48 },
        semanticTriggers: ['revenue', 'views', 'subscribers', 'exact dollar amount', 'large metric', 'counting up'],
        idealStyles: ['reel', 'repurposing', 'talking_head'],
        cautionStyles: ['explainer', 'podcast', 'vlog'],
        incompatibleStyles: [],
        recommendedDuration: 3.2,
        recommendedScale: 0.60,
    },
    'kpi-stat-callout': {
        id: 'kpi-stat-callout',
        name: 'High-Impact KPI Stat Callout',
        category: 'data_viz',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.48 },
        semanticTriggers: ['delta percentage', 'roi', 'multiplier 10x', 'key metric', 'breakthrough stat'],
        idealStyles: ['talking_head', 'reel', 'repurposing', 'explainer'],
        cautionStyles: ['podcast'],
        incompatibleStyles: ['vlog'],
        recommendedDuration: 3.2,
        recommendedScale: 0.78,
    },
    'price-pop': {
        id: 'price-pop',
        name: 'Punchy Price/Number Pop',
        category: 'data_viz',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.50 },
        semanticTriggers: ['cost', 'price', 'fee', 'dollar amount', 'discount', 'quick number'],
        idealStyles: ['reel', 'talking_head', 'podcast', 'repurposing'],
        cautionStyles: ['vlog', 'explainer'],
        incompatibleStyles: [],
        recommendedDuration: 2.5,
        recommendedScale: 0.62,
    },
    'counter': {
        id: 'counter',
        name: 'Day/Episode Sequence Flip Counter',
        category: 'data_viz',
        screenZone: 'side_rail',
        defaultAlignment: { x: 0.82, y: 0.18 },
        semanticTriggers: ['challenge day', 'episode number', 'step in sequence', 'part 1 of 3'],
        idealStyles: ['reel', 'vlog'],
        cautionStyles: ['talking_head', 'explainer', 'repurposing'],
        incompatibleStyles: [],
        recommendedDuration: 2.8,
        recommendedScale: 0.50,
    },

    // --- SOCIAL PROOF & ENGAGEMENT ---
    'comparison-card': {
        id: 'comparison-card',
        name: 'Before vs After Comparison Card',
        category: 'social_proof',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.50 },
        semanticTriggers: ['before after', 'before vs after', 'vs', 'contrast', 'efficiency gain', 'transformation', 'results'],
        idealStyles: ['talking_head', 'reel', 'repurposing', 'explainer'],
        cautionStyles: ['vlog', 'podcast'],
        incompatibleStyles: [],
        recommendedDuration: 4.0,
        recommendedScale: 0.85,
    },
    'social-notification': {
        id: 'social-notification',
        name: 'Push Notification Pop-Up',
        category: 'social_proof',
        screenZone: 'top_header',
        defaultAlignment: { x: 0.50, y: 0.14 },
        semanticTriggers: ['new subscriber', 'new sale', 'phone alert', 'social proof', 'direct message'],
        idealStyles: ['reel', 'vlog', 'repurposing'],
        cautionStyles: ['talking_head', 'explainer', 'podcast'],
        incompatibleStyles: [],
        recommendedDuration: 3.2,
        recommendedScale: 0.72,
    },
    'comment-bubble': {
        id: 'comment-bubble',
        name: 'Viewer Comment Speech Bubble',
        category: 'social_proof',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.46 },
        semanticTriggers: ['audience question', 'user comment', 'testimonial', 'objection handling', 'community reply'],
        idealStyles: ['reel', 'repurposing', 'podcast'],
        cautionStyles: ['talking_head', 'explainer', 'vlog'],
        incompatibleStyles: [],
        recommendedDuration: 3.8,
        recommendedScale: 0.82,
    },

    // --- ATTENTION HOOKS & RETENTION ---
    'search-bar': {
        id: 'search-bar',
        name: 'Interactive Search Query Bar',
        category: 'attention_hook',
        screenZone: 'top_header',
        defaultAlignment: { x: 0.50, y: 0.18 },
        semanticTriggers: ['google search', 'how to query', 'internet question', 'problem hook', 'inquiry'],
        idealStyles: ['reel', 'explainer'],
        cautionStyles: ['talking_head', 'repurposing', 'vlog'],
        incompatibleStyles: ['podcast'],
        recommendedDuration: 3.0,
        recommendedScale: 0.80,
    },
    'retention-progress-bar': {
        id: 'retention-progress-bar',
        name: 'Viewer Retention Watch Bar',
        category: 'attention_hook',
        screenZone: 'top_header',
        defaultAlignment: { x: 0.50, y: 0.08 },
        semanticTriggers: ['keep watching', 'don’t scroll', 'retention hack', 'watch until the end', 'video progress'],
        idealStyles: ['reel', 'repurposing'],
        cautionStyles: ['vlog'],
        incompatibleStyles: ['podcast'],
        recommendedDuration: 5.0,
        recommendedScale: 0.88,
    },
    'burst': {
        id: 'burst',
        name: 'Vector Energy Starburst',
        category: 'attention_hook',
        screenZone: 'floating_corner',
        defaultAlignment: { x: 0.80, y: 0.25 },
        semanticTriggers: ['emphasis', 'shock', 'accent pop', 'excitement', 'instant reaction'],
        idealStyles: ['reel'],
        cautionStyles: ['repurposing'],
        incompatibleStyles: ['talking_head', 'podcast', 'explainer'],
        recommendedDuration: 1.5,
        recommendedScale: 0.35,
    },

    // --- LOCATION & CONTEXT ---
    'location-badge': {
        id: 'location-badge',
        name: 'Travel & Location Geo Badge',
        category: 'location_context',
        screenZone: 'top_header',
        defaultAlignment: { x: 0.50, y: 0.12 },
        semanticTriggers: ['city name', 'travel destination', 'geo pin', 'place', 'arrival', 'time stamp'],
        idealStyles: ['vlog'],
        cautionStyles: ['talking_head'],
        incompatibleStyles: [],
        recommendedDuration: 3.5,
        recommendedScale: 0.55,
    },

    // --- TECHNICAL & CODE ---
    'code-window': {
        id: 'code-window',
        name: 'Syntax-Highlighted Code Window',
        category: 'technical',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.50 },
        semanticTriggers: ['coding', 'developer snippet', 'javascript', 'terminal command', 'software architecture'],
        idealStyles: ['explainer'],
        cautionStyles: ['talking_head'],
        incompatibleStyles: ['reel', 'vlog'],
        recommendedDuration: 4.5,
        recommendedScale: 0.86,
    },

    // --- VECTOR EMPHASIS ACCENTS ---
    'highlight-box': {
        id: 'highlight-box',
        name: 'Bounding Focus Box',
        category: 'vector_accent',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.50 },
        semanticTriggers: ['framing', 'inspect this', 'look here', 'bounding box'],
        idealStyles: ['talking_head', 'explainer'],
        cautionStyles: ['podcast', 'repurposing'],
        incompatibleStyles: [],
        recommendedDuration: 2.5,
        recommendedScale: 0.70,
    },
    'underline': {
        id: 'underline',
        name: 'Animated Text Underline Stroke',
        category: 'vector_accent',
        screenZone: 'lower_third',
        defaultAlignment: { x: 0.50, y: 0.75 },
        semanticTriggers: ['underline phrase', 'stress word', 'emphasis stroke'],
        idealStyles: ['talking_head', 'vlog', 'podcast', 'explainer'],
        cautionStyles: [],
        incompatibleStyles: [],
        recommendedDuration: 2.2,
        recommendedScale: 0.60,
    },
    'circle-callout': {
        id: 'circle-callout',
        name: 'Hand-Drawn Focus Circle',
        category: 'vector_accent',
        screenZone: 'center_hero',
        defaultAlignment: { x: 0.50, y: 0.50 },
        semanticTriggers: ['circle this', 'spotlight detail', 'notice this'],
        idealStyles: ['talking_head', 'vlog', 'explainer'],
        cautionStyles: [],
        incompatibleStyles: [],
        recommendedDuration: 2.2,
        recommendedScale: 0.45,
    },
    'arrow': {
        id: 'arrow',
        name: 'Dynamic Pointer Arrow',
        category: 'vector_accent',
        screenZone: 'floating_corner',
        defaultAlignment: { x: 0.75, y: 0.45 },
        semanticTriggers: ['point here', 'look at that', 'directional indicator'],
        idealStyles: ['reel', 'vlog'],
        cautionStyles: ['repurposing'],
        incompatibleStyles: [],
        recommendedDuration: 2.0,
        recommendedScale: 0.40,
    },
    'progress-bar': {
        id: 'progress-bar',
        name: 'Horizontal Process Bar',
        category: 'vector_accent',
        screenZone: 'lower_third',
        defaultAlignment: { x: 0.50, y: 0.85 },
        semanticTriggers: ['phase complete', 'pipeline status', 'loading bar'],
        idealStyles: ['explainer', 'reel'],
        cautionStyles: ['talking_head', 'repurposing', 'vlog'],
        incompatibleStyles: [],
        recommendedDuration: 3.0,
        recommendedScale: 0.80,
    },

    // --- AMBIENT TEXTURE OVERLAYS ---
    'film-grain': {
        id: 'film-grain',
        name: '35mm Cinematic Film Grain',
        category: 'ambient_texture',
        screenZone: 'fullscreen_overlay',
        defaultAlignment: { x: 0.50, y: 0.50 },
        semanticTriggers: ['film texture', 'organic feel', '35mm aesthetic', 'nostalgia', 'cinema atmosphere'],
        idealStyles: ['vlog'],
        cautionStyles: ['explainer'],
        incompatibleStyles: [],
        recommendedDuration: 6.0,
        recommendedScale: 1.0,
    },
    'vhs-glitch': {
        id: 'vhs-glitch',
        name: 'Analog Tape Glitch & Scanline',
        category: 'ambient_texture',
        screenZone: 'fullscreen_overlay',
        defaultAlignment: { x: 0.50, y: 0.50 },
        semanticTriggers: ['cyberpunk', 'retro 90s', 'digital distortion', 'system error', 'glitch interruption'],
        idealStyles: [],
        cautionStyles: ['reel'],
        incompatibleStyles: ['talking_head', 'vlog', 'podcast', 'explainer', 'repurposing'],
        recommendedDuration: 1.2,
        recommendedScale: 1.0,
    },
    'light-leak': {
        id: 'light-leak',
        name: 'Warm Lens Flare & Light Leak',
        category: 'ambient_texture',
        screenZone: 'fullscreen_overlay',
        defaultAlignment: { x: 0.50, y: 0.50 },
        semanticTriggers: ['golden hour', 'sun flare', 'warmth', 'cinematic transition atmosphere'],
        idealStyles: ['reel'],
        cautionStyles: ['repurposing'],
        incompatibleStyles: [],
        recommendedDuration: 2.5,
        recommendedScale: 1.0,
    },
});

/**
 * Curated Sets of Combinations for Each Editing Style.
 * Provides Set A, Set B, and Set C so the AI engine can rotate recipes
 * between consecutive edits while remaining true to the style's identity.
 */
const STYLE_VARIATION_PRESETS = Object.freeze({
    talking_head: [
        {
            id: 'th_set_a_executive',
            name: 'Executive Authority (Set A)',
            theme: 'Clean corporate leadership and polished intellectual authority.',
            pacingIntervalSec: 5.0,
            captionPack: 'vox-highlighter',
            cameraMotion: 'subtle',
            transition: 'dip',
            colorPalette: { primary: '#00E5FF', accent: '#FFE500', background: 'rgba(12, 16, 26, 0.94)' },
            motionElements: [
                { kind: 'lower-third-minimal', screenZone: 'lower_third', role: 'primary' },
                { kind: 'kpi-stat-callout', screenZone: 'center_hero', role: 'secondary' },
                { kind: 'underline', screenZone: 'lower_third', role: 'accent' },
            ],
            screenPlacementRecipe: 'Keep lower 25% clear for captions; place speaker badge at y: 0.82; KPI callout centers during key moments.',
        },
        {
            id: 'th_set_b_data_analyst',
            name: 'Data Analyst & Insights (Set B)',
            theme: 'Quantitative breakdown with visual metrics and contrast evidence.',
            pacingIntervalSec: 4.5,
            captionPack: 'ali-abdaal',
            cameraMotion: 'cinematic',
            transition: 'crossfade',
            colorPalette: { primary: '#10B981', accent: '#38BDF8', background: 'rgba(10, 18, 30, 0.95)' },
            motionElements: [
                { kind: 'line-graph', screenZone: 'center_hero', role: 'primary' },
                { kind: 'comparison-card', screenZone: 'center_hero', role: 'secondary' },
                { kind: 'highlight-box', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Hero graph occupies center 45%; comparison card alternates when highlighting transformation.',
        },
        {
            id: 'th_set_c_editorial_profile',
            name: 'Editorial Feature (Set C)',
            theme: 'Long-form journalistic integrity, quote highlights, and news credibility.',
            pacingIntervalSec: 5.5,
            captionPack: 'documentary',
            cameraMotion: 'subtle',
            transition: 'dip',
            colorPalette: { primary: '#E2E8F0', accent: '#F59E0B', background: 'rgba(18, 20, 28, 0.95)' },
            motionElements: [
                { kind: 'newspaper-headline', screenZone: 'top_header', role: 'primary' },
                { kind: 'quote-card', screenZone: 'center_hero', role: 'secondary' },
                { kind: 'circle-callout', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Headline anchors top 20% like a news bulletin; quote cards animate in middle 50% with low opacity backdrop.',
        },
    ],

    reel: [
        {
            id: 'reel_set_a_retention_power',
            name: 'Retention Maximum (Set A)',
            theme: 'Ultra-fast kinetic pattern interrupts engineered for sub-2s retention spikes.',
            pacingIntervalSec: 2.2,
            captionPack: 'hormozi-bounce',
            cameraMotion: 'dynamic',
            transition: 'whip-left',
            colorPalette: { primary: '#FFE500', accent: '#00E5FF', background: 'rgba(10, 10, 15, 0.95)' },
            motionElements: [
                { kind: 'retention-progress-bar', screenZone: 'top_header', role: 'primary' },
                { kind: 'burst', screenZone: 'floating_corner', role: 'secondary' },
                { kind: 'data-counter', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Retention progress bar locked at top y: 0.08; rapid bursts flank words in mid screen.',
        },
        {
            id: 'reel_set_b_social_viral',
            name: 'Viral Community & Proof (Set B)',
            theme: 'Relatable online hooks, incoming notifications, and user commentary.',
            pacingIntervalSec: 2.5,
            captionPack: 'neon-punch',
            cameraMotion: 'dynamic',
            transition: 'zoom-punch',
            colorPalette: { primary: '#FF3B5C', accent: '#38BDF8', background: 'rgba(16, 12, 28, 0.96)' },
            motionElements: [
                { kind: 'social-notification', screenZone: 'top_header', role: 'primary' },
                { kind: 'search-bar', screenZone: 'top_header', role: 'secondary' },
                { kind: 'price-pop', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Top alert drops from ceiling to y: 0.14; search bar types viral problem at the hook.',
        },
        {
            id: 'reel_set_c_proof_transformation',
            name: 'Transformation & Showdown (Set C)',
            theme: 'Visual before-and-after proof and punchy upward metric spikes.',
            pacingIntervalSec: 2.8,
            captionPack: 'mrbeast',
            cameraMotion: 'dynamic',
            transition: 'flash',
            colorPalette: { primary: '#10B981', accent: '#FFE500', background: 'rgba(12, 16, 24, 0.96)' },
            motionElements: [
                { kind: 'comparison-card', screenZone: 'center_hero', role: 'primary' },
                { kind: 'kpi-stat-callout', screenZone: 'center_hero', role: 'secondary' },
                { kind: 'arrow', screenZone: 'floating_corner', role: 'accent' },
            ],
            screenPlacementRecipe: 'Comparison card dominates center hero; arrows spotlight key differences.',
        },
    ],

    vlog: [
        {
            id: 'vlog_set_a_travel_diarist',
            name: 'Travel Diarist (Set A)',
            theme: 'Warm geo-located storytelling with soft film aesthetics.',
            pacingIntervalSec: 4.5,
            captionPack: 'clean-modern',
            cameraMotion: 'subtle',
            transition: 'speed-lines',
            colorPalette: { primary: '#FF3B5C', accent: '#FFE500', background: 'rgba(14, 18, 28, 0.92)' },
            motionElements: [
                { kind: 'location-badge', screenZone: 'top_header', role: 'primary' },
                { kind: 'film-grain', screenZone: 'fullscreen_overlay', role: 'secondary' },
                { kind: 'underline', screenZone: 'lower_third', role: 'accent' },
            ],
            screenPlacementRecipe: 'Location badge at top y: 0.12; 35mm grain provides subtle analog depth.',
        },
        {
            id: 'vlog_set_b_social_daily',
            name: 'Daily Vlog Connection (Set B)',
            theme: 'Personal day-in-the-life with subscriber connection points.',
            pacingIntervalSec: 3.8,
            captionPack: 'soft-rounded',
            cameraMotion: 'subtle',
            transition: 'whip-right',
            colorPalette: { primary: '#38BDF8', accent: '#10B981', background: 'rgba(15, 23, 42, 0.94)' },
            motionElements: [
                { kind: 'social-notification', screenZone: 'top_header', role: 'primary' },
                { kind: 'counter', screenZone: 'side_rail', role: 'secondary' },
                { kind: 'circle-callout', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Day counter in top right corner (x: 0.82, y: 0.18); notification drops on subscriber milestones.',
        },
        {
            id: 'vlog_set_c_cinematic_mood',
            name: 'Cinematic Mood & Memory (Set C)',
            theme: 'Reflective personal cinema with lens flares and quotes.',
            pacingIntervalSec: 5.2,
            captionPack: 'clean-modern',
            cameraMotion: 'subtle',
            transition: 'crossfade',
            colorPalette: { primary: '#FFA500', accent: '#F8FAFC', background: 'rgba(16, 16, 24, 0.92)' },
            motionElements: [
                { kind: 'light-leak', screenZone: 'fullscreen_overlay', role: 'primary' },
                { kind: 'quote-card', screenZone: 'center_hero', role: 'secondary' },
                { kind: 'film-grain', screenZone: 'fullscreen_overlay', role: 'accent' },
            ],
            screenPlacementRecipe: 'Light leaks burst over transitions; quote card lingers gently during reflective voiceovers.',
        },
    ],

    repurposing: [
        {
            id: 'rep_set_a_social_proof',
            name: 'Social Proof Clip (Set A)',
            theme: 'Audience comments answered by authority figures.',
            pacingIntervalSec: 3.5,
            captionPack: 'vox-highlighter',
            cameraMotion: 'subtle',
            transition: 'dip',
            colorPalette: { primary: '#00E5FF', accent: '#FFE500', background: 'rgba(12, 16, 24, 0.94)' },
            motionElements: [
                { kind: 'comment-bubble', screenZone: 'center_hero', role: 'primary' },
                { kind: 'retention-progress-bar', screenZone: 'top_header', role: 'secondary' },
                { kind: 'lower-third-minimal', screenZone: 'lower_third', role: 'accent' },
            ],
            screenPlacementRecipe: 'Viewer question card appears in first 2 seconds; speaker badge affirms credentials.',
        },
        {
            id: 'rep_set_b_metric_hook',
            name: 'Metric Hook & Punch (Set B)',
            theme: 'High energy stat disclosure from podcast interviews.',
            pacingIntervalSec: 3.0,
            captionPack: 'hormozi-bounce',
            cameraMotion: 'dynamic',
            transition: 'whip-left',
            colorPalette: { primary: '#10B981', accent: '#FF3B5C', background: 'rgba(14, 18, 30, 0.95)' },
            motionElements: [
                { kind: 'kpi-stat-callout', screenZone: 'center_hero', role: 'primary' },
                { kind: 'social-notification', screenZone: 'top_header', role: 'secondary' },
                { kind: 'data-counter', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Massive KPI stat flashes at climax; notifications corroborate success.',
        },
        {
            id: 'rep_set_c_wisdom_drop',
            name: 'Wisdom Drop & Contrast (Set C)',
            theme: 'Core philosophy and transformative contrast excerpt.',
            pacingIntervalSec: 4.0,
            captionPack: 'ali-abdaal',
            cameraMotion: 'subtle',
            transition: 'crossfade',
            colorPalette: { primary: '#38BDF8', accent: '#10B981', background: 'rgba(15, 20, 32, 0.95)' },
            motionElements: [
                { kind: 'quote-card', screenZone: 'center_hero', role: 'primary' },
                { kind: 'comparison-card', screenZone: 'center_hero', role: 'secondary' },
                { kind: 'underline', screenZone: 'lower_third', role: 'accent' },
            ],
            screenPlacementRecipe: 'Quote card centers cleanly; transformation contrast clarifies the principle.',
        },
    ],

    podcast: [
        {
            id: 'pod_set_a_deep_conversation',
            name: 'Deep Conversation (Set A)',
            theme: 'Respectful long-form dialogue with discrete identification.',
            pacingIntervalSec: 6.0,
            captionPack: 'podcast',
            cameraMotion: 'subtle',
            transition: 'dip',
            colorPalette: { primary: '#E8C27A', accent: '#00E5FF', background: 'rgba(15, 18, 26, 0.94)' },
            motionElements: [
                { kind: 'lower-third-minimal', screenZone: 'lower_third', role: 'primary' },
                { kind: 'quote-card', screenZone: 'center_hero', role: 'secondary' },
                { kind: 'underline', screenZone: 'lower_third', role: 'accent' },
            ],
            screenPlacementRecipe: 'Unobtrusive lower third identifies speaker; quote card captures pivotal argument.',
        },
        {
            id: 'pod_set_b_interactive_qa',
            name: 'Listener Q&A (Set B)',
            theme: 'Community interaction addressing specific questions.',
            pacingIntervalSec: 5.0,
            captionPack: 'ali-abdaal',
            cameraMotion: 'subtle',
            transition: 'crossfade',
            colorPalette: { primary: '#38BDF8', accent: '#E8C27A', background: 'rgba(14, 20, 32, 0.95)' },
            motionElements: [
                { kind: 'comment-bubble', screenZone: 'center_hero', role: 'primary' },
                { kind: 'lower-third-minimal', screenZone: 'lower_third', role: 'secondary' },
                { kind: 'highlight-box', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Comment bubble introduces topic question before host answers.',
        },
        {
            id: 'pod_set_c_historic_archive',
            name: 'Historic & Editorial Dispatch (Set C)',
            theme: 'Documentary depth referring to literature and public reports.',
            pacingIntervalSec: 5.5,
            captionPack: 'documentary',
            cameraMotion: 'subtle',
            transition: 'crossfade',
            colorPalette: { primary: '#F8FAFC', accent: '#F59E0B', background: 'rgba(20, 22, 30, 0.96)' },
            motionElements: [
                { kind: 'quote-card', screenZone: 'center_hero', role: 'primary' },
                { kind: 'newspaper-headline', screenZone: 'top_header', role: 'secondary' },
                { kind: 'circle-callout', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Newspaper headline cites news origin; quote card pulls key citation.',
        },
    ],

    explainer: [
        {
            id: 'exp_set_a_vox_journalism',
            name: 'Vox-Style Journalism (Set A)',
            theme: 'Investigative reporting with headlines, data trends, and highlighter focus.',
            pacingIntervalSec: 4.2,
            captionPack: 'vox-highlighter',
            cameraMotion: 'subtle',
            transition: 'crossfade',
            colorPalette: { primary: '#00E5FF', accent: '#FFE500', background: 'rgba(12, 16, 26, 0.94)' },
            motionElements: [
                { kind: 'newspaper-headline', screenZone: 'top_header', role: 'primary' },
                { kind: 'line-graph', screenZone: 'center_hero', role: 'secondary' },
                { kind: 'highlight-box', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Masthead headline establishes context; kinetic trendline validates data claim.',
        },
        {
            id: 'exp_set_b_technical_deep_dive',
            name: 'Technical & Engineering Deep Dive (Set B)',
            theme: 'Interactive code inspection, system architecture, and search inquiry.',
            pacingIntervalSec: 4.0,
            captionPack: 'typewriter-terminal',
            cameraMotion: 'cinematic',
            transition: 'dip',
            colorPalette: { primary: '#00E5FF', accent: '#10B981', background: 'rgba(10, 14, 24, 0.96)' },
            motionElements: [
                { kind: 'code-window', screenZone: 'center_hero', role: 'primary' },
                { kind: 'search-bar', screenZone: 'top_header', role: 'secondary' },
                { kind: 'circular-meter', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Search bar types the engineering challenge; code window demonstrates solution.',
        },
        {
            id: 'exp_set_c_comparative_benchmark',
            name: 'Comparative Benchmark & KPI (Set C)',
            theme: 'Before/after efficiency contrast and definitive KPI metric.',
            pacingIntervalSec: 4.0,
            captionPack: 'ali-abdaal',
            cameraMotion: 'subtle',
            transition: 'crossfade',
            colorPalette: { primary: '#10B981', accent: '#38BDF8', background: 'rgba(12, 20, 32, 0.95)' },
            motionElements: [
                { kind: 'comparison-card', screenZone: 'center_hero', role: 'primary' },
                { kind: 'kpi-stat-callout', screenZone: 'center_hero', role: 'secondary' },
                { kind: 'bar-chart', screenZone: 'center_hero', role: 'accent' },
            ],
            screenPlacementRecipe: 'Comparison card contrasts old vs new method; KPI callout underscores percentage gain.',
        },
    ],
});

function queryMotionCatalog({ category, screenZone, styleId, intent, limit = 10 } = {}) {
    let results = Object.values(MOTION_ELEMENT_CATALOG);

    if (category) {
        results = results.filter(e => e.category === category);
    }
    if (screenZone) {
        results = results.filter(e => e.screenZone === screenZone);
    }
    if (styleId) {
        results = results.filter(e => !e.incompatibleStyles.includes(styleId));
        results.sort((a, b) => {
            const aIdeal = a.idealStyles.includes(styleId) ? 1 : 0;
            const bIdeal = b.idealStyles.includes(styleId) ? 1 : 0;
            return bIdeal - aIdeal;
        });
    }
    if (intent) {
        const intentClean = String(intent).toLowerCase().trim();
        const intentWords = intentClean.split(/\s+/).filter(Boolean);
        results = results.filter(e => {
            const trigs = e.semanticTriggers.map(t => t.toLowerCase());
            const hasExact = trigs.some(t => t.includes(intentClean) || intentClean.includes(t));
            const hasWords = intentWords.length > 0 && intentWords.every(w => trigs.some(t => t.includes(w)));
            return hasExact || hasWords ||
                   e.name.toLowerCase().includes(intentClean) ||
                   e.id.includes(intentClean);
        });
    }

    return results.slice(0, limit);
}

function selectStyleVariation(styleId, { seed, avoidVariationId, themePreference } = {}) {
    const normalized = STYLE_VARIATION_PRESETS[styleId] ? styleId : 'talking_head';
    const variations = STYLE_VARIATION_PRESETS[normalized];

    let candidates = variations;
    if (avoidVariationId && candidates.length > 1) {
        candidates = candidates.filter(v => v.id !== avoidVariationId);
    }

    if (themePreference) {
        const prefClean = String(themePreference).toLowerCase();
        const matched = candidates.find(v =>
            v.name.toLowerCase().includes(prefClean) ||
            v.theme.toLowerCase().includes(prefClean) ||
            v.id.toLowerCase().includes(prefClean)
        );
        if (matched) return matched;
    }

    if (seed !== undefined && seed !== null) {
        let hash = 0;
        const str = String(seed);
        for (let i = 0; i < str.length; i++) {
            hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
        }
        const index = Math.abs(hash) % candidates.length;
        return candidates[index];
    }

    return candidates[0];
}

module.exports = {
    EDITING_STYLES,
    STYLE_MOTION_RULES,
    MOTION_ELEMENT_CATALOG,
    STYLE_VARIATION_PRESETS,
    evaluateMotionCompatibility,
    getRecommendedMotionSuite,
    queryMotionCatalog,
    selectStyleVariation,
};
