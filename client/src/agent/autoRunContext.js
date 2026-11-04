/**
 * autoRunContext.js
 *
 * The id of the Auto run in progress, if any.
 *
 * One Auto run makes 3 to 5 separately gated requests (captions/generate,
 * audio/filler/detect, audio/enhance, audio/search,
 * ai/detect-repeated-takes). Before R148 each one was metered as its own AI
 * operation, so "3 AI operations / month" was less than a single Auto edit
 * and Creator's "100" was really 20 to 30. Tagging every request a run makes
 * with one id lets the server collapse them into one billable operation, and
 * is also how it recognises a new account's trial Auto runs. See
 * middleware/usageGate.js and migrations/008_usage_run_ids.sql.
 *
 * Module level rather than threaded through every call site: the requests are
 * made deep inside editJobManager and MediaExecutionEngine, far from here.
 * The tradeoff is that an unrelated request issued while a run is in flight
 * also carries the id and folds into it. The server bounds that (a run stops
 * collapsing after RUN_MAX_REQUESTS or RUN_MAX_AGE_MS), and only one Auto run
 * can be in flight at a time, so the exposure is small and finite.
 */

let currentRunId = null;

function mintRunId() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `run_${crypto.randomUUID()}`;
        }
    } catch {
        // fall through to the arithmetic id below
    }
    const rand = Math.random().toString(36).slice(2, 12);
    return `run_${Date.now().toString(36)}${rand}`;
}

/** Starts a run and returns its id. */
export function beginAutoRun() {
    currentRunId = mintRunId();
    return currentRunId;
}

/** Ends the current run. Safe to call when none is active. */
export function endAutoRun() {
    currentRunId = null;
}

/** The run in flight, or null. */
export function currentAutoRunId() {
    return currentRunId;
}

export default { beginAutoRun, endAutoRun, currentAutoRunId };
