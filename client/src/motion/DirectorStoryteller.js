/**
 * client/src/motion/DirectorStoryteller.js
 *
 * Level 3 — Director-Driven Visual Storytelling Engine.
 *
 * Elevates footage selection from manual placement into VIBED's broader creative intelligence:
 *   1. Pacing Intelligence: Identifies talking-head monotony and derives optimal cutaway
 *      durations from speech cadence (Rapid, Measured, Deliberate).
 *   2. Treatment Differentiation: Decides whether a moment deserves Stock Footage,
 *      Motion Graphics (metrics, titles), a Hybrid combination, or Speaker Focus.
 *   3. Speaker Visibility & Depth Sandwiching: Decides where to keep the speaker visible
 *      (Behind-the-speaker depth sandwich, Picture-in-Picture, or Full Cutaway).
 *   4. Transition Styling: Designs intelligent entrance and exit transitions (zoom cut,
 *      matte reveal, directional whip) back into the interview.
 */

import { VISUAL_PURPOSES, CADENCE_TIERS, classifyVisualPurpose, deriveCadenceTier } from './ArtDirector.js';

export const VISUAL_TREATMENTS = Object.freeze({
    FOOTAGE:        'footage',         // B-roll video or photo
    MOTION_GRAPHIC: 'motion_graphic',  // Kinetic typography, metrics card, lower-third
    HYBRID:         'hybrid',          // Footage background with motion graphic overlay
    SPEAKER_FOCUS:  'speaker_focus',   // Retain 100% visual focus on speaker (no cutaway)
});

export const SPEAKER_LAYOUTS = Object.freeze({
    FULL_CUTAWAY:       'full_cutaway',       // Covers 100% of canvas (scale: 4, x: 50, y: 50)
    BEHIND_SPEAKER:     'behind_speaker',     // Depth sandwiching behind segmented speaker
    PICTURE_IN_PICTURE: 'picture_in_picture', // Speaker in corner PiP, footage in main area
    SPLIT_SCREEN:       'split_screen',       // Side-by-side or dual-frame split
});

export const TRANSITION_PRESETS = Object.freeze({
    ZOOM_CUT:       'zoom_cut',       // Punchy dynamic scale zoom
    SMOOTH_SLIDE:   'smooth_slide',   // Elegant directional slide with spring damping
    MATTE_REVEAL:   'matte_reveal',   // Geometric mask/matte reveal
    CROSS_DISSOLVE: 'cross_dissolve', // Film-style optical dissolve
    WHIP_PAN:       'whip_pan',       // High-velocity whip pan transition
});

// Emotional / personal confessions where cutting away damages narrative impact
const CONFESSION_REGEX = /\b(i almost quit|the honest truth|my biggest mistake|i was so scared|broke down|confess|the hardest part|listen closely|don't give up|never forget)\b/i;

// Metric / numerical data regex (better served by motion graphics)
const METRIC_REGEX = /\b\d+(\.\d+)?%|\b\d+x\b|[\$€£¥]\d+|\b(\d+ (steps?|rules?|tips?|principles?|secrets?))\b/i;

/**
 * 1. Pacing Analysis: Identifies talking-head monotony and calculates required relief.
 *
 * @param {Array<{start:number, end?:number, word?:string, text?:string}>} words
 * @param {Array<{start:number, duration:number}>} [existingOverlays=[]]
 * @param {object} [options={}]
 * @returns {{ cadence: string, wpm: number, pacingSpans: Array<object>, requiresPacingRelief: boolean }}
 */
export function analyzePacingNeed(words = [], existingOverlays = [], options = {}) {
    if (!Array.isArray(words) || words.length === 0) {
        return { cadence: CADENCE_TIERS.MEASURED, wpm: 145, pacingSpans: [], requiresPacingRelief: false };
    }

    const firstWordStart = words[0].start || 0;
    const lastWordEnd = words[words.length - 1].end || (firstWordStart + 10);
    const totalDurationSec = Math.max(1, lastWordEnd - firstWordStart);
    const wpm = Math.round((words.length / (totalDurationSec / 60)) || 145);
    const cadence = deriveCadenceTier(wpm);

    // Monotony threshold (maximum allowed continuous talking-head without visual break)
    let maxContinuousMonotonyS = 8.5;
    let targetCutawayDuration = 3.5;

    if (cadence === CADENCE_TIERS.RAPID) {
        maxContinuousMonotonyS = 6.0;
        targetCutawayDuration = 2.2;
    } else if (cadence === CADENCE_TIERS.DELIBERATE) {
        maxContinuousMonotonyS = 11.0;
        targetCutawayDuration = 5.0;
    }

    const overlays = (existingOverlays || []).map(o => ({
        start: Number(o.start) || 0,
        end: (Number(o.start) || 0) + (Number(o.duration) || 3),
    })).sort((a, b) => a.start - b.start);

    const pacingSpans = [];
    let currentSpanStart = firstWordStart;

    for (const ov of overlays) {
        if (ov.start > currentSpanStart) {
            const gap = ov.start - currentSpanStart;
            if (gap >= maxContinuousMonotonyS) {
                pacingSpans.push({
                    start: currentSpanStart,
                    end: ov.start,
                    duration: gap,
                    recommendedCutawayDuration: targetCutawayDuration,
                    reason: `Talking-head monotony (${gap.toFixed(1)}s > ${maxContinuousMonotonyS}s threshold for ${cadence} cadence)`,
                });
            }
        }
        currentSpanStart = Math.max(currentSpanStart, ov.end);
    }

    if (lastWordEnd - currentSpanStart >= maxContinuousMonotonyS) {
        const gap = lastWordEnd - currentSpanStart;
        pacingSpans.push({
            start: currentSpanStart,
            end: lastWordEnd,
            duration: gap,
            recommendedCutawayDuration: targetCutawayDuration,
            reason: `Talking-head monotony (${gap.toFixed(1)}s > ${maxContinuousMonotonyS}s threshold for ${cadence} cadence)`,
        });
    }

    return {
        cadence,
        wpm,
        pacingSpans,
        requiresPacingRelief: pacingSpans.length > 0,
        targetCutawayDuration,
    };
}

/**
 * 2. Visual Treatment Decision: Classifies whether a moment deserves Footage, Motion Graphic,
 * Hybrid, or pure Speaker Focus.
 *
 * @param {string} text Spoken dialogue or concept text
 * @param {object} [context={}]
 * @returns {{ treatment: string, reason: string, confidence: number }}
 */
export function decideVisualTreatment(text = '', context = {}) {
    const cleanText = String(text || '').trim();

    // 1. Emotional confessions / high-vulnerability punchlines -> retain speaker focus
    if (CONFESSION_REGEX.test(cleanText)) {
        return {
            treatment: VISUAL_TREATMENTS.SPEAKER_FOCUS,
            reason: 'High emotional/vulnerability dialogue — preserve speaker eye contact',
            confidence: 0.95,
        };
    }

    // 2. Statistics, metrics, numbers, step numbers -> Motion Graphics or Hybrid
    if (METRIC_REGEX.test(cleanText)) {
        if (/\b(city|world|market|country|office|street|paris|tokyo|subway)\b/i.test(cleanText)) {
            return {
                treatment: VISUAL_TREATMENTS.HYBRID,
                reason: 'Data metric combined with environmental location — B-roll background with animated graphic card',
                confidence: 0.9,
            };
        }
        return {
            treatment: VISUAL_TREATMENTS.MOTION_GRAPHIC,
            reason: 'Numeric statistic or metric — animated data card conveys insight clearer than footage',
            confidence: 0.92,
        };
    }

    const start = context.start !== undefined ? context.start : 10.0;
    const purpose = classifyVisualPurpose({ text: cleanText, start }, context);

    // 3. Chapter title or intro hook -> Motion Graphic
    if (purpose === VISUAL_PURPOSES.CHAPTER || (purpose === VISUAL_PURPOSES.INTRO && (context.isFirstClip || context.start < 3.0))) {
        return {
            treatment: VISUAL_TREATMENTS.MOTION_GRAPHIC,
            reason: 'Structural transition or hook title — motion graphics title card',
            confidence: 0.88,
        };
    }

    // 4. Default for narrative / descriptive content -> Footage B-roll
    return {
        treatment: VISUAL_TREATMENTS.FOOTAGE,
        reason: 'Descriptive narrative moment — illustrate with context-aware stock footage',
        confidence: 0.85,
    };
}

/**
 * 3. Speaker Visibility & Layout Decision: Chooses Full Cutaway, Behind Speaker Depth Sandwich,
 * Picture-in-Picture, or Split Screen.
 *
 * @param {string} treatment One of VISUAL_TREATMENTS
 * @param {object} [options={}] { hasSubjectMask, isInstructional, isInterview }
 * @returns {{ layout: string, behindSubject: boolean, reason: string }}
 */
export function decideSpeakerLayout(treatment, options = {}) {
    if (treatment === VISUAL_TREATMENTS.SPEAKER_FOCUS) {
        return {
            layout: 'none',
            behindSubject: false,
            reason: 'Speaker remains 100% full screen with no visual occlusion',
        };
    }

    // If subject segmentation/depth mask is available, depth sandwiching is the premier choice!
    if (options.hasSubjectMask || options.preferDepthSandwich) {
        return {
            layout: SPEAKER_LAYOUTS.BEHIND_SPEAKER,
            behindSubject: true,
            reason: 'Subject segmentation active — sandwich B-roll behind the speaker for maximum depth and connection',
        };
    }

    // Instructional or reaction-heavy interview -> PiP keeps host present
    if (options.isInstructional) {
        return {
            layout: SPEAKER_LAYOUTS.PICTURE_IN_PICTURE,
            behindSubject: false,
            reason: 'Instructional walkthrough — pin speaker in corner PiP while footage illustrates action',
        };
    }

    // Standard high-production cutaway
    return {
        layout: SPEAKER_LAYOUTS.FULL_CUTAWAY,
        behindSubject: false,
        reason: 'Full-frame cutaway overlay (scale: 4, x: 50, y: 50)',
    };
}

/**
 * 4. Transition Dynamics Planning: Designs entrance and exit curves back into interview.
 *
 * @param {string} treatment
 * @param {string} layout One of SPEAKER_LAYOUTS
 * @param {string} [cadence=CADENCE_TIERS.MEASURED]
 * @param {string} [style='modern']
 * @returns {{ inTransition: object, outTransition: object }}
 */
export function planTransitionStyling(treatment, layout, cadence = CADENCE_TIERS.MEASURED, style = 'modern') {
    const isRapid = cadence === CADENCE_TIERS.RAPID;
    const isDeliberate = cadence === CADENCE_TIERS.DELIBERATE;

    let inType = TRANSITION_PRESETS.SMOOTH_SLIDE;
    let outType = TRANSITION_PRESETS.CROSS_DISSOLVE;
    let inDuration = isRapid ? 0.25 : (isDeliberate ? 0.45 : 0.35);
    let outDuration = isRapid ? 0.25 : (isDeliberate ? 0.45 : 0.35);
    let springPreset = isRapid ? 'bouncy' : 'smooth';

    if (layout === SPEAKER_LAYOUTS.BEHIND_SPEAKER) {
        // Behind speaker depth sandwiching looks best with smooth matte reveal or dissolve
        inType = TRANSITION_PRESETS.MATTE_REVEAL;
        outType = TRANSITION_PRESETS.CROSS_DISSOLVE;
        inDuration = 0.4;
        outDuration = 0.4;
    } else if (layout === SPEAKER_LAYOUTS.PICTURE_IN_PICTURE) {
        inType = TRANSITION_PRESETS.ZOOM_CUT;
        outType = TRANSITION_PRESETS.SMOOTH_SLIDE;
    } else if (layout === SPEAKER_LAYOUTS.FULL_CUTAWAY) {
        if (isRapid) {
            inType = TRANSITION_PRESETS.ZOOM_CUT;
            outType = TRANSITION_PRESETS.WHIP_PAN;
        } else if (isDeliberate) {
            inType = TRANSITION_PRESETS.CROSS_DISSOLVE;
            outType = TRANSITION_PRESETS.CROSS_DISSOLVE;
        } else {
            inType = TRANSITION_PRESETS.SMOOTH_SLIDE;
            outType = TRANSITION_PRESETS.CROSS_DISSOLVE;
        }
    }

    return {
        inTransition: {
            type: inType,
            duration: inDuration,
            easing: 'spring_smooth',
            springPreset,
        },
        outTransition: {
            type: outType,
            duration: outDuration,
            easing: 'spring_smooth',
            springPreset: 'smooth',
        },
    };
}

/**
 * Comprehensive Director Visual Storytelling Plan Generator.
 *
 * @param {object} params
 * @param {Array} params.words Dialogue transcript
 * @param {Array} [params.overlays=[]] Existing overlays on timeline
 * @param {boolean} [params.hasSubjectMask=false] Whether depth/subject segmentation is ready
 * @param {string} [params.style='modern']
 * @returns {object} Storytelling plan with pacing diagnostics and moment-by-moment decisions
 */
export function generateStorytellingPlan({
    words = [],
    overlays = [],
    hasSubjectMask = false,
    style = 'modern',
} = {}) {
    const pacing = analyzePacingNeed(words, overlays);
    const recommendations = [];

    for (let i = 0; i < pacing.pacingSpans.length; i++) {
        const span = pacing.pacingSpans[i];
        // Sample words within this pacing span
        const spanWords = words.filter(w => (w.start || 0) >= span.start && (w.start || 0) <= span.end);
        const snippetText = spanWords.map(w => w.word || w.text || '').join(' ');

        const treatmentDecision = decideVisualTreatment(snippetText);
        const layoutDecision = decideSpeakerLayout(treatmentDecision.treatment, {
            hasSubjectMask,
            preferDepthSandwich: hasSubjectMask,
        });
        const transitionPlan = planTransitionStyling(
            treatmentDecision.treatment,
            layoutDecision.layout,
            pacing.cadence,
            style
        );

        recommendations.push({
            id: `story_rec_${Math.round(span.start)}_${i}`,
            timelineTime: Math.round(span.start * 10) / 10,
            duration: span.recommendedCutawayDuration,
            snippet: snippetText.slice(0, 100),
            treatment: treatmentDecision.treatment,
            treatmentReason: treatmentDecision.reason,
            speakerLayout: layoutDecision.layout,
            behindSubject: layoutDecision.behindSubject,
            transitions: transitionPlan,
        });
    }

    return {
        cadence: pacing.cadence,
        wpm: pacing.wpm,
        pacingSpansCount: pacing.pacingSpans.length,
        recommendations,
    };
}

export default {
    VISUAL_TREATMENTS,
    SPEAKER_LAYOUTS,
    TRANSITION_PRESETS,
    analyzePacingNeed,
    decideVisualTreatment,
    decideSpeakerLayout,
    planTransitionStyling,
    generateStorytellingPlan,
};
