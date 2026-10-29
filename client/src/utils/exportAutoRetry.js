/**
 * client/src/utils/exportAutoRetry.js
 *
 * R126/R127 QC loop, Slice 1 — jobs/exportProcessor.js already computes
 * `revideoWarning`/`compositorWarning` when the overlay/motion-graphics
 * compositing pass (or the whole Revideo path) failed outright: the export
 * still "succeeds" but ships WITHOUT captions/motion-graphics/stickers
 * entirely (see exportProcessor.js's own comment on revideoWarning). Those
 * two warnings were already surfaced to the user (ExportModal.jsx) and
 * counted in telemetry (IDELayout.jsx's `export.warning` metric) — this
 * module adds the one thing that was still missing: ONE automatic retry
 * before the user ever sees the warning, because on investigation these two
 * read as transient worker-health failures (a timeout, a cold Revideo
 * worker) far more often than a real content defect.
 *
 * Deliberately NOT retried: captionWarning, transitionWarning, clipWarning,
 * captionProgramWarning. Those usually mean something about THIS CONTENT
 * specifically (an unresolvable font, a clip whose source can't be found) —
 * an identical second render reproduces the exact same warning, so retrying
 * them would just waste a full render (minutes of worker time) for nothing.
 * That distinction is why this is a short, explicit list rather than "retry
 * on any warning."
 *
 * Pure orchestration: `runExport` is injected so this is testable without a
 * real export job, a real network call, or React at all.
 */

export const TRANSIENT_EXPORT_WARNING_KEYS = ['revideoWarning', 'compositorWarning'];

/**
 * @param {object|null|undefined} result - an export job result (same shape exportProcessor.js returns)
 * @returns {string|null} the first transient warning key present on `result`, or null
 */
export function firstTransientWarningKey(result) {
    if (!result) return null;
    return TRANSIENT_EXPORT_WARNING_KEYS.find((k) => !!result[k]) || null;
}

/**
 * Runs one export attempt via `runExport`. If the result carries a
 * transient warning (see TRANSIENT_EXPORT_WARNING_KEYS), runs it exactly
 * ONE more time and returns that second attempt's result regardless of
 * outcome — a bounded retry, never a loop. `opts.onRetry` fires once, right
 * before the retry attempt starts, with the warning key that triggered it
 * (for logging/telemetry — this module has no side effects of its own).
 *
 * @param {(settings: object) => Promise<object>} runExport - runs one export attempt, resolves to the job result object
 * @param {object} settings - export settings, passed through unchanged to runExport
 * @param {{onRetry?: (warningKey: string) => void}} [opts]
 * @returns {Promise<{result: object, retried: boolean, resolvedBy: string|null}>}
 *   result     - the result to actually use (the retry's result if a retry ran, otherwise the first attempt's)
 *   retried    - true if a second attempt was made
 *   resolvedBy - the warning key the retry cleared, or null if no retry ran OR the retry still carried the same (or another transient) warning
 */
export async function runExportWithAutoRetry(runExport, settings, opts = {}) {
    const first = await runExport(settings);
    const warningKey = firstTransientWarningKey(first);
    if (!warningKey) return { result: first, retried: false, resolvedBy: null };

    if (typeof opts.onRetry === 'function') opts.onRetry(warningKey);

    const retry = await runExport(settings);
    const stillWarning = firstTransientWarningKey(retry);
    return { result: retry, retried: true, resolvedBy: stillWarning ? null : warningKey };
}
