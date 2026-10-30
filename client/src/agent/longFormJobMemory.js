/**
 * client/src/agent/longFormJobMemory.js
 *
 * R131 — "the brain loses the flow after each task done": a long-form edit
 * (or any multi-step plan run through MediaExecutionEngine) that fails
 * partway — a bug like R130's "Unknown tool", a timeout, a transient
 * network error — left NOTHING behind. ExecutionJob's state lived only in
 * MediaExecutionEngine's in-memory instance; useJobStore has no persist
 * middleware at all; the plan itself was a local variable inside
 * VideoEditorTools.longFormEdit(). A reload, or simply the next chat
 * message starting a fresh parse, had no way to know a job had failed or
 * what was left to do — "continue" meant nothing, there was nothing to
 * continue.
 *
 * This module is the durable memory that makes "continue" mean something:
 * when a batch of compiled commands finishes with anything still
 * unresolved (never attempted, or attempted and reported failure), the
 * exact remaining COMPILED commands — not the original plan, not the
 * source prompt — are saved here, keyed by project, so a later
 * resumeFailedJob() call can hand them straight back to
 * MediaExecutionEngine.execute() with no re-planning, no re-running of
 * work that already succeeded, and no dependency on ContentAnalyzer/the
 * server still agreeing with whatever it said the first time.
 *
 * Deliberately NOT a general "undo history" or "job log" — one record per
 * project, overwritten on every save, cleared on success. This is scoped
 * to exactly the problem reported: pick up THE most recent stopped edit
 * when asked, nothing more.
 */

const STORAGE_PREFIX = 'vibed:resumableJob:';

function keyFor(projectId) {
    return `${STORAGE_PREFIX}${projectId || 'default'}`;
}

/**
 * @param {{projectId: string|null, planId: string|null, remainingCommands: object[], failedMessage: string|null, totalSteps: number}} record
 */
export function saveResumableJob(record) {
    try {
        if (!record || !Array.isArray(record.remainingCommands) || record.remainingCommands.length === 0) return;
        const payload = {
            planId: record.planId || null,
            remainingCommands: record.remainingCommands,
            failedMessage: record.failedMessage || null,
            totalSteps: Number(record.totalSteps) || record.remainingCommands.length,
            savedAt: Date.now(),
        };
        localStorage.setItem(keyFor(record.projectId), JSON.stringify(payload));
    } catch (err) {
        // Best-effort — a quota error or disabled storage must not break the
        // edit that triggered this save. The user just won't get "continue"
        // for this one failure.
        console.warn('[longFormJobMemory] Could not save resumable job:', err.message);
    }
}

/**
 * @param {string|null} projectId
 * @returns {{planId: string|null, remainingCommands: object[], failedMessage: string|null, totalSteps: number, savedAt: number}|null}
 */
export function getResumableJob(projectId) {
    try {
        const raw = localStorage.getItem(keyFor(projectId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.remainingCommands) || parsed.remainingCommands.length === 0) return null;
        return parsed;
    } catch (err) {
        console.warn('[longFormJobMemory] Could not read resumable job:', err.message);
        return null;
    }
}

export function clearResumableJob(projectId) {
    try {
        localStorage.removeItem(keyFor(projectId));
    } catch (err) {
        console.warn('[longFormJobMemory] Could not clear resumable job:', err.message);
    }
}

/**
 * Given the full set of commands a job attempted and the results it
 * collected, returns the commands whose effect never successfully
 * applied — in original order, preserving both:
 *   - commands with no result at all (the loop stopped before reaching
 *     them — an uncaught exception from one command, like R130's "Unknown
 *     tool", aborts MediaExecutionEngine's executeCommands loop entirely)
 *   - commands that DID run but reported `success: false` (a "soft"
 *     failure a tool caught and returned cleanly — execution continued
 *     past it, but the step's own effect still never applied)
 *
 * @param {object[]} commands - the full commands array a job was given
 * @param {object[]} results - job.results (or executionResult.results) from running it
 * @returns {object[]}
 */
export function remainingCommandsFrom(commands, results) {
    const list = Array.isArray(commands) ? commands : [];
    const res = Array.isArray(results) ? results : [];
    return list.filter((c, i) => {
        const r = res[i];
        if (r === undefined) return true;
        return r.success === false;
    });
}
