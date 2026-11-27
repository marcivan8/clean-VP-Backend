/**
 * client/src/agent/runs/agentRunContext.js — the agent run and step in
 * progress, sent as X-Vibed-Agent-Run / X-Vibed-Agent-Step on every authFetch
 * request (R176b). The server only uses them to file the AI calls a run makes
 * under its trace in Langfuse; they never change billing (that is the separate
 * X-Vibed-Run-Id of Auto runs, R148) or what a request is allowed to do.
 *
 * Module level for the same reason as autoRunContext.js: the requests are made
 * deep inside the shorts pipeline. An unrelated request made while a step runs
 * is tagged too; the cost is a stray span in a trace, nothing more.
 */
let current = null;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mark a step of a persisted run as in progress. Ids that are not UUIDs are ignored. */
export function enterAgentStep(runId, stepId) {
    current = ID.test(String(runId || '')) && /^[a-z_]{2,24}$/.test(String(stepId || '')) ? { runId, stepId } : null;
}

export function leaveAgentStep() {
    current = null;
}

/** Headers for the step in progress, or {}. */
export function agentRunHeaders() {
    return current ? { 'X-Vibed-Agent-Run': current.runId, 'X-Vibed-Agent-Step': current.stepId } : {};
}

export default { enterAgentStep, leaveAgentStep, agentRunHeaders };
