/**
 * undoTask.js — undo every timeline step an AI edit made, back to the history
 * length recorded when the job started (task_complete log: data.preTaskHistoryLen).
 * Same loop as ReasoningPanel's TaskCompletionCard (re-reads state each pass:
 * undo() returns a new store state). Used by the mobile Roka bar and toast.
 * @returns {number} steps undone
 */
import useTimelineStore from '../store/useTimelineStore.js';

export function undoTaskEdits(preTaskHistoryLen) {
    const target = Math.max(0, Number(preTaskHistoryLen) || 0);
    let guard = 0;
    while (useTimelineStore.getState().past.length > target && guard < 1000) {
        useTimelineStore.getState().undo();
        guard++;
    }
    return guard;
}
