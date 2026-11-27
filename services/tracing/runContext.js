// services/tracing/runContext.js
// The tracing context of the current request or background job (R176b, R177).
//
// `agentRunContext` (mounted in index.js before every AI route) gives each
// request a small context object through AsyncLocalStorage: the request
// itself (for its route, user and project), when it started, and, when the
// browser sends X-Vibed-Agent-Run / X-Vibed-Agent-Step, the agent run and step
// it belongs to. The AI client wrapper in services/tracing/langfuse.js reads
// it to name and group the request's model calls into one trace.
//
// It never authorises anything: a forged header can at most add a span to a
// trace. Billing grouping is the separate X-Vibed-Run-Id (R148).

'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEP = /^[a-z_]{2,24}$/;

/** The agent run headers of a request, or null. */
function readContext(req) {
    const runId = typeof req.get === 'function' ? req.get('x-vibed-agent-run') : null;
    if (!runId || !UUID.test(String(runId).trim())) return null;
    const step = String(req.get('x-vibed-agent-step') || '').trim();
    return { runId: String(runId).trim().toLowerCase(), stepId: STEP.test(step) ? step : null };
}

function agentRunContext(req, res, next) {
    const run = readContext(req);
    return store.run({ req, startedAt: Date.now(), ...(run || {}) }, next);
}

/** Run `fn` inside a context built outside a request (a background job). */
function runInContext(ctx, fn) {
    return store.run(ctx, fn);
}

function currentRunContext() {
    return store.getStore() || null;
}

module.exports = { agentRunContext, currentRunContext, readContext, runInContext };
