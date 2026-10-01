/**
 * planFirst.js — which AI edits show a plan and wait for "Apply" first.
 *
 * Decision (Marc, 2026-10-01): on MOBILE, edits that REMOVE content (pauses,
 * filler words, repeated takes, cuts, a speaker) show what Roka will do and
 * wait for Apply. Quick, additive edits (captions, color, music, zoom) apply
 * right away and keep their one-tap Undo. Desktop is unchanged: it only gets
 * the existing plan.requiresApproval gate.
 *
 * Pure: no store, no DOM. EditJobManager passes isMobile in.
 */

export const PLAN_FIRST_OPERATIONS = Object.freeze([
    'silence_removal',
    'remove_filler_words',
    'remove_filler',
    'remove_repetition',
    'semantic_cut',
    'remove_speaker',
    'cut_source_range',
    'long_form_edit',
    'compound_clean_dynamic',
    'compound_clean_virtual_multicam',
]);

/** @returns {boolean} */
export function shouldPlanFirst(operation, isMobile) {
    return !!isMobile && typeof operation === 'string' && PLAN_FIRST_OPERATIONS.includes(operation);
}

/**
 * i18n keys (editor namespace, mobileRoka.*) for the plan sheet's bullet
 * lines. Written per operation on the client so the sheet is in the app's
 * language and never claims numbers we don't know before running it.
 */
const LINES = {
    silence_removal: ['planSilence'],
    remove_filler_words: ['planFillers'],
    remove_filler: ['planFillers'],
    remove_repetition: ['planRepetition'],
    semantic_cut: ['planCut'],
    cut_source_range: ['planCut'],
    remove_speaker: ['planSpeaker'],
    long_form_edit: ['planLongForm'],
    compound_clean_dynamic: ['planSilence', 'planZoom'],
    compound_clean_virtual_multicam: ['planSilence', 'planMulticam'],
};

export function planLineKeys(operation) {
    return LINES[operation] || ['planGeneric'];
}

/** "1:12" from seconds (for the "current length" line). */
export function formatLength(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** End of the last clip on any track, in seconds. */
export function timelineLength(tracks) {
    let end = 0;
    for (const t of Array.isArray(tracks) ? tracks : []) {
        for (const c of t?.clips || []) end = Math.max(end, (Number(c.start) || 0) + (Number(c.duration) || 0));
    }
    return end;
}
