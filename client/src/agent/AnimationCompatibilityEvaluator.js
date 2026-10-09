/**
 * client/src/agent/AnimationCompatibilityEvaluator.js
 *
 * Style-Aware Motion Compatibility Engine.
 * Evaluates the aesthetic and cognitive compatibility of proposed animations,
 * kinetic caption packs, visual textures, camera motions, and transitions against
 * the video's active editing style (talking head, short form / reel, vlog, repurposing, podcast).
 *
 * Provides:
 *  - Quantitative compatibility scoring (0.0 - 1.0)
 *  - Architectural verdicts ('ideal', 'compatible', 'caution', 'incompatible')
 *  - Actionable reasoning explaining why an element fits or clashes
 *  - Automated parameter adaptation (tuning colors, thickness, pacing to match style)
 *  - Curated style recommendations
 */

export const EDITING_STYLES = Object.freeze({
    TALKING_HEAD: 'talking_head',
    REEL: 'reel',
    VLOG: 'vlog',
    REPURPOSING: 'repurposing',
    PODCAST: 'podcast',
    EXPLAINER: 'explainer',
});

export const STYLE_MOTION_RULES = Object.freeze({
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
            'code-window', // Too dense for fast-scrolling mobile feeds
        ],
        idealCaptionPacks: ['hormozi-bounce', 'neon-punch', 'mrbeast', 'bold-impact'],
        cautionCaptionPacks: ['vox-highlighter', 'ali-abdaal'],
        incompatibleCaptionPacks: ['luxury'], // Low contrast, unreadable on small screens
        idealCameraMotion: ['dynamic'],
        incompatibleCameraMotion: [],
        idealTransitions: ['whip-left', 'whip-right', 'flash', 'zoom-punch'],
        incompatibleTransitions: ['dip'], // Long dips kill short-form retention
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

/**
 * Evaluates the compatibility of a proposed motion element against a video editing style.
 *
 * @param {string} styleId - 'talking_head' | 'reel' | 'vlog' | 'repurposing' | 'podcast' | 'explainer'
 * @param {'template'|'caption'|'camera'|'transition'} category
 * @param {string} itemKey - e.g. 'line-graph', 'vox-highlighter', 'dynamic', 'whip-left'
 * @param {object} [currentParams]
 * @returns {{
 *   score: number,
 *   compatible: boolean,
 *   verdict: 'ideal'|'compatible'|'caution'|'incompatible',
 *   reason: string,
 *   alternatives: Array<{key: string, name: string, reason: string}>,
 *   adaptedParams?: object
 * }}
 */
export function evaluateMotionCompatibility(styleId, category, itemKey, currentParams = {}) {
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
                // Suggest ideal alternatives
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

            // Provide style-adapted palette if color is open
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
            } else if (rules.cautionCaptionPacks?.includes(itemKey)) {
                score = 0.60;
                verdict = 'caution';
                reason = `'${itemKey}' caption styling is atypical for ${rules.name}.`;
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

/**
 * Returns the recommended complete creative suite configuration for an editing style.
 *
 * @param {string} styleId
 */
export function getRecommendedMotionSuite(styleId) {
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

/**
 * Validates a proposed editing plan, scoring and adjusting actions for aesthetic compatibility.
 *
 * @param {string} styleId
 * @param {Array<{action: string, args?: object}>} planSteps
 * @returns {{
 *   valid: boolean,
 *   overallScore: number,
 *   evaluations: Array<object>,
 *   adaptedPlan: Array<{action: string, args?: object}>,
 *   warnings: string[]
 * }}
 */
export function validateAndAdaptPlan(styleId, planSteps = []) {
    const evaluations = [];
    const adaptedPlan = [];
    const warnings = [];
    let totalScore = 0;

    for (const step of planSteps) {
        let evalResult = { score: 1.0, compatible: true, verdict: 'ideal', reason: 'Non-motion action' };
        let adaptedArgs = { ...(step.args || {}) };

        if (step.action === 'add_template') {
            const kind = step.args?.kind || 'highlight-box';
            evalResult = evaluateMotionCompatibility(styleId, 'template', kind, step.args?.params);
            if (!evalResult.compatible) {
                warnings.push(`Step '${step.action}' (${kind}): ${evalResult.reason}`);
                // Auto-adapt to first alternative if available
                if (evalResult.alternatives.length > 0) {
                    adaptedArgs.kind = evalResult.alternatives[0].key;
                }
            }
            if (evalResult.adaptedParams) {
                adaptedArgs.params = { ...(adaptedArgs.params || {}), ...evalResult.adaptedParams };
            }
        } else if (step.action === 'set_caption_style' || step.action === 'apply_caption_pack') {
            const packId = step.args?.packId || 'vox-highlighter';
            evalResult = evaluateMotionCompatibility(styleId, 'caption', packId);
            if (!evalResult.compatible) {
                warnings.push(`Caption pack '${packId}': ${evalResult.reason}`);
                if (evalResult.alternatives.length > 0) {
                    adaptedArgs.packId = evalResult.alternatives[0].key;
                }
            }
        } else if (step.action === 'rhythm_zoom' || step.action === 'camera_motion') {
            const zoomStyle = step.args?.style || 'subtle';
            evalResult = evaluateMotionCompatibility(styleId, 'camera', zoomStyle);
            if (!evalResult.compatible) {
                warnings.push(`Camera motion '${zoomStyle}': ${evalResult.reason}`);
                if (evalResult.alternatives.length > 0) {
                    adaptedArgs.style = evalResult.alternatives[0].key;
                }
            }
        } else if (step.action === 'add_transition') {
            const transType = step.args?.type || 'dip';
            evalResult = evaluateMotionCompatibility(styleId, 'transition', transType);
            if (!evalResult.compatible) {
                warnings.push(`Transition '${transType}': ${evalResult.reason}`);
                if (evalResult.alternatives.length > 0) {
                    adaptedArgs.type = evalResult.alternatives[0].key;
                }
            }
        }

        totalScore += evalResult.score;
        evaluations.push({ action: step.action, ...evalResult });
        adaptedPlan.push({ ...step, args: adaptedArgs });
    }

    const overallScore = planSteps.length > 0 ? (totalScore / planSteps.length) : 1.0;

    return {
        valid: overallScore >= 0.65,
        overallScore,
        evaluations,
        adaptedPlan,
        warnings,
    };
}

export default {
    EDITING_STYLES,
    STYLE_MOTION_RULES,
    evaluateMotionCompatibility,
    getRecommendedMotionSuite,
    validateAndAdaptPlan,
};
