/**
 * editChangeCheck.js — R105: an edit command that reports success must have
 * changed the project (CLAUDE.md R30). R30 fixed this command by command; this
 * is the safety net for every command at once. It compares the project state
 * before and after execution, by reference (the stores are immutable, so any
 * real write produces a new reference) and ignores what playback, selection
 * and history move on their own.
 *
 * Pure: the caller passes the two state objects.
 */

// Moved by playback, selection, undo bookkeeping and live meters, not by an edit.
export const VOLATILE_KEYS = new Set([
    '_timelineState', '_lastEvent', 'currentTime', 'isPlaying', 'activeClipId', 'selectedClipIds',
    'selectedTimelineRange', 'past', 'future', 'clipboard', 'copiedAttributes', 'audioLevels',
    'playerRef', 'manager', 'previewQuality', 'videoWidth', 'videoHeight', 'zoomLevel',
    'targetFindings', 'assetTargetFindings', 'editHistory',
    '_historyGroupDepth', '_historyGroupBase', '_historyGroupPast',
]);

// Commands whose job is to look, recommend, navigate or open something. Nothing
// changing is the correct outcome for them.
// Matched on the snake_case form, so 'recommendLUTs' and 'recommend_luts' agree.
const READ_ONLY = /^(detect_|recommend_|search_|locate_|analy[sz]e_|query_|explain|preview|seek|play|pause|open_|show_|switch_|export|queue_export|render|list_|describe|recap|chat)/;

export function isReadOnlyAction(action) {
    const snake = String(action || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    return READ_ONLY.test(snake);
}

/** The keys whose value changed between two state snapshots (functions ignored). */
export function changedKeys(before, after) {
    const out = [];
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    for (const k of keys) {
        if (VOLATILE_KEYS.has(k)) continue;
        const a = before?.[k], b = after?.[k];
        if (typeof a === 'function' || typeof b === 'function') continue;
        if (a !== b) out.push(k);
    }
    return out;
}

/**
 * Whether a "successful" run should be reported as having done nothing.
 * @param {Array} commands  compiled commands ({ action } or { operation })
 * @param {object} before   useTimelineStore state before execution
 * @param {object} after    useTimelineStore state after execution
 */
export function isSilentNoop(commands, before, after) {
    const actions = (Array.isArray(commands) ? commands : []).map(c => c?.action || c?.operation || c?.args?.action);
    // A plan made only of read-only steps is allowed to change nothing.
    if (!actions.length || actions.every(isReadOnlyAction)) return false;
    return changedKeys(before, after).length === 0;
}
