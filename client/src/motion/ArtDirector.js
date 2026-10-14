/**
 * client/src/motion/ArtDirector.js
 *
 * Intelligent Art Direction Engine (Pillar E).
 *
 * Provides:
 *   1. Visual Purpose Classification (intro/hook, explain, emphasize/metric, cta/outro, chapter).
 *   2. Contextual Adaptation to footage pacing, speaker cadence, and editing styles.
 *   3. Motion Fatigue Detection & Gratuitous Motion Suppression (enforces readability hold,
 *      hierarchy restraint, and motion density limits).
 */

export const VISUAL_PURPOSES = Object.freeze({
    INTRO:      'intro',
    EXPLAIN:    'explain',
    EMPHASIZE:  'emphasize',
    CTA:        'cta',
    CHAPTER:    'chapter',
});

export const CADENCE_TIERS = Object.freeze({
    RAPID:      'rapid',      // > 165 WPM
    MEASURED:   'measured',   // 130 - 165 WPM
    DELIBERATE: 'deliberate', // < 130 WPM
});

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Classifies the visual purpose of a graphic based on its text, timeline placement, and role.
 *
 * @param {object} item { text, start, duration, type, role, kind }
 * @param {object} [context] { totalDuration, isFirstClip, isLastClip }
 * @returns {string} One of VISUAL_PURPOSES
 */
export function classifyVisualPurpose(item = {}, context = {}) {
    const text = String(item.text || item.content || item.name || '').toLowerCase();
    const start = num(item.start, 0);
    const duration = num(item.duration, 3);
    const totalDuration = num(context.totalDuration, 60);

    // 1. Hook / Intro check (first 3 seconds or explicit intro keywords)
    if (context.isFirstClip || (start < 3.0 && totalDuration > 10) || /\b(intro|hook|presents?|welcome|title|episode|launch)\b/.test(text)) {
        return VISUAL_PURPOSES.INTRO;
    }

    // 2. CTA / Outro check (end of video or explicit action verbs)
    if (context.isLastClip || (start + duration >= totalDuration - 4.0 && totalDuration > 15) || /\b(subscribe|follow|sign ?up|link in bio|download|cta|order|shop now|visit|learn more)\b/.test(text)) {
        return VISUAL_PURPOSES.CTA;
    }

    // 3. Chapter / Transition check
    if (/\b(chapter|part \d|step \d|phase|topic|section|rule \d)\b/.test(text)) {
        return VISUAL_PURPOSES.CHAPTER;
    }

    // 4. Emphasize / Metric check (numbers with %, $, multiples like 10x, large metrics, or emphasis keywords)
    if (/\b\d+(\.\d+)?%|\b\d+x\b|[\$€£¥]|\b(growth|record|x\d+|roi|revenue|profit|scale|massive|huge|secret|key)\b/.test(text)) {
        return VISUAL_PURPOSES.EMPHASIZE;
    }

    // 5. Default: Explanatory / Clarification content
    return VISUAL_PURPOSES.EXPLAIN;
}

/**
 * Derives speaker cadence tier from words-per-minute (WPM) or speech timestamps.
 * @param {number|Array<{start:number, end:number, word:string}>} wpmOrWords
 */
export function deriveCadenceTier(wpmOrWords) {
    let wpm = 145; // Default measured cadence
    if (typeof wpmOrWords === 'number' && Number.isFinite(wpmOrWords)) {
        wpm = wpmOrWords;
    } else if (Array.isArray(wpmOrWords) && wpmOrWords.length > 0) {
        const first = wpmOrWords[0].start || 0;
        const last = wpmOrWords[wpmOrWords.length - 1].end || (first + 1);
        const durationSec = Math.max(0.1, last - first);
        const durationMin = durationSec / 60;
        wpm = wpmOrWords.length / durationMin;
    }

    if (wpm > 165) return CADENCE_TIERS.RAPID;
    if (wpm < 130) return CADENCE_TIERS.DELIBERATE;
    return CADENCE_TIERS.MEASURED;
}

/**
 * Adapts art direction, spring dynamics, and timing to footage cadence, editing style, and visual purpose.
 *
 * @param {string} purpose One of VISUAL_PURPOSES
 * @param {object} [context] { cadence, style, brandPalette }
 * @returns {object} Concrete motion parameters and art direction settings
 */
export function adaptArtDirection(purpose, context = {}) {
    const cadence = context.cadence || CADENCE_TIERS.MEASURED;
    const style = String(context.style || 'modern').toLowerCase();
    const isCalmStyle = style.includes('podcast') || style.includes('documentary') || style.includes('calm');
    const isPunchyStyle = style.includes('punchy') || style.includes('hype') || style.includes('viral');

    // 1. Entrance duration & spring stiffness adapted to cadence
    let entranceDuration = 0.45;
    let springPreset = 'snappy';
    let energy = 0.7;

    if (cadence === CADENCE_TIERS.RAPID || isPunchyStyle) {
        entranceDuration = 0.28;
        springPreset = isCalmStyle ? 'smooth' : 'bouncy';
        energy = 0.9;
    } else if (cadence === CADENCE_TIERS.DELIBERATE || isCalmStyle) {
        entranceDuration = 0.65;
        springPreset = 'smooth';
        energy = 0.45;
    }

    // 2. Adjust by Visual Purpose
    let motionVerb = 'slide-in';
    let allowLoopHold = false;
    let minHoldDuration = 1.2;

    switch (purpose) {
        case VISUAL_PURPOSES.INTRO:
            motionVerb = isCalmStyle ? 'fade-in' : (isPunchyStyle ? 'slam-in' : 'pop');
            energy = Math.min(1.0, energy * 1.2);
            minHoldDuration = 1.8;
            break;
        case VISUAL_PURPOSES.EMPHASIZE:
            motionVerb = isCalmStyle ? 'scale-up' : 'pop';
            springPreset = isCalmStyle ? 'smooth' : 'bouncy';
            energy = Math.min(1.0, energy * 1.15);
            minHoldDuration = 0.9;
            break;
        case VISUAL_PURPOSES.CTA:
            motionVerb = 'slide-in';
            allowLoopHold = !isCalmStyle; // subtle pulse on button CTA
            minHoldDuration = 2.0;
            break;
        case VISUAL_PURPOSES.CHAPTER:
            motionVerb = 'wipe';
            minHoldDuration = 1.5;
            break;
        case VISUAL_PURPOSES.EXPLAIN:
        default:
            motionVerb = 'slide-in';
            springPreset = 'smooth'; // High legibility, zero wobble
            energy = Math.max(0.3, energy * 0.85);
            minHoldDuration = 1.5;
            break;
    }

    return {
        purpose,
        motionVerb,
        springPreset,
        entranceDuration,
        energy,
        allowLoopHold,
        minHoldDuration,
        suppressSecondaryMotion: isCalmStyle,
    };
}

/**
 * Audits a sequence of scenes / graphics to detect motion fatigue, overlapping bursts,
 * and gratuitous motion. Returns issues and automatic adjustments.
 *
 * @param {Array<object>} graphics [{ id, start, duration, purpose, animations }]
 * @returns {{ isCoherent: boolean, issues: Array<string>, adjustments: Map<string, object> }}
 */
export function auditMotionCoherence(graphics = []) {
    const list = Array.isArray(graphics) ? [...graphics].sort((a, b) => (a.start || 0) - (b.start || 0)) : [];
    const issues = [];
    const adjustments = new Map();

    for (let i = 0; i < list.length; i++) {
        const curr = list[i];
        const dur = num(curr.duration, 0);

        // Rule 1: Readability hold duration (must not vanish before viewer can read)
        if (dur < 0.6) {
            issues.push(`Graphic "${curr.id || i}" duration (${dur}s) is too short to be readable.`);
            adjustments.set(curr.id, { extendDuration: 1.0 });
        }

        // Rule 2: Temporal crowding / motion fatigue check
        if (i > 0) {
            const prev = list[i - 1];
            const gap = num(curr.start, 0) - (num(prev.start, 0) + num(prev.duration, 0));
            // Two graphics popping within < 0.3s of each other causes visual exhaustion
            if (gap >= -0.1 && gap < 0.3) {
                issues.push(`Crowded transition between "${prev.id || i - 1}" and "${curr.id || i}" (gap ${gap.toFixed(2)}s).`);
                adjustments.set(curr.id, { softenEntrance: true, replaceWithFade: true });
            }
        }

        // Rule 3: Gratuitous continuous wobble on explanatory text
        const hasContinuousWobble = (curr.animations || []).some(a =>
            a.repeat && (a.presetId?.includes('wobble') || a.presetId?.includes('shake'))
        );
        if (hasContinuousWobble && curr.purpose === VISUAL_PURPOSES.EXPLAIN) {
            issues.push(`Explanatory graphic "${curr.id || i}" has continuous shaking, degrading reading comfort.`);
            adjustments.set(curr.id, { removeContinuousWobble: true });
        }
    }

    return {
        isCoherent: issues.length === 0,
        issues,
        adjustments,
    };
}

export default {
    VISUAL_PURPOSES,
    CADENCE_TIERS,
    classifyVisualPurpose,
    deriveCadenceTier,
    adaptArtDirection,
    auditMotionCoherence,
};
