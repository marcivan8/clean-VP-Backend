// services/tracing/runContext.js
// Which agent run (and step) the current request belongs to, for tracing only
// (R176b). Set from the X-Vibed-Agent-Run / X-Vibed-Agent-Step headers by
// `agentRunContext` middleware and read by the AI client wrapper in
// services/AIProvider.js through AsyncLocalStorage, so the AI calls a run
// makes are filed under its trace without threading an id through every route.
//
// It never authorises anything: a forged header can at most add a span to a
// trace. Billing grouping is the separate X-Vibed-Run-Id (R148).

'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const store = new AsyncLocalStorage();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEP = /^[a-z_]{2,24}$/;

function readContext(req) {
    const runId = typeof req.get === 'function' ? req.get('x-vibed-agent-run') : null;
    if (!runId || !UUID.test(String(runId).trim())) return null;
    const step = String(req.get('x-vibed-agent-step') || '').trim();
    return { runId: String(runId).trim().toLowerCase(), stepId: STEP.test(step) ? step : null };
}

function agentRunContext(req, res, next) {
    const ctx = readContext(req);
    if (!ctx) return next();
    return store.run(ctx, next);
}

function currentRunContext() {
    return store.getStore() || null;
}

module.exports = { agentRunContext, currentRunContext, readContext };
