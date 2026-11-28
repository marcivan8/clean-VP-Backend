'use strict';

/**
 * services/agentRunBudget.js — how much one agent run, and all of a user's
 * runs in a month, may spend (R180).
 *
 * What a budget protects: the user's own plan and money from a run that loops
 * or keeps retrying. It is NOT the abuse limit: plan quotas stay with aiGate
 * (R9) and the rate limiters. That is why the per-request guard keys on the
 * X-Vibed-Agent-Run header: a client that drops the header is no longer a run,
 * and the ordinary limits apply to it.
 *
 * Counts: AI calls the server counted for the run (services/tracing/langfuse
 * usageFor, in memory per instance) merged with what was saved on the run row
 * (`cost`), whichever is higher. A restart therefore never lowers a count, but
 * calls made on another instance since the last save are not seen until the
 * run saves again (it saves on every step change). Best effort, stated.
 *
 * Limits come from env so they can be tuned without a deploy:
 *   AGENT_RUN_MAX_AI_CALLS        per run        (default 150)
 *   AGENT_RUN_MAX_EXPORT_MINUTES  per run, minutes of video exported (default 15)
 *   AGENT_RUN_MONTHLY_AI_CALLS    per user per calendar month (UTC), all runs (default 3000)
 */

const langfuse = require('./tracing/langfuse');

const DEFAULTS = { maxAiCalls: 150, maxExportMinutes: 15, monthlyAiCalls: 3000 };

function intFromEnv(name, fallback, { min = 1, max = 100000 } = {}) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
        console.warn(`[agentBudget] ${name}="${raw}" is not a whole number between ${min} and ${max}; using ${fallback}.`);
        return fallback;
    }
    return n;
}

function limits() {
    return {
        maxAiCalls: intFromEnv('AGENT_RUN_MAX_AI_CALLS', DEFAULTS.maxAiCalls),
        maxExportMinutes: intFromEnv('AGENT_RUN_MAX_EXPORT_MINUTES', DEFAULTS.maxExportMinutes, { max: 600 }),
        monthlyAiCalls: intFromEnv('AGENT_RUN_MONTHLY_AI_CALLS', DEFAULTS.monthlyAiCalls, { max: 1000000 }),
    };
}

/** Merge a stored cost with this instance's count, never lowering a field. */
function mergeCost(stored, counted) {
    const out = { ...(stored || {}) };
    for (const [k, v] of Object.entries(counted || {})) {
        const n = Number(v) || 0;
        out[k] = Math.max(Number(out[k]) || 0, n);
    }
    return out;
}

/** The first day of the current month, UTC, as ISO. */
function monthStart(now = Date.now()) {
    const d = new Date(now);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

const MONTH_CACHE_MS = 60 * 1000;
const monthCache = new Map(); // userId -> { at, used }

/** AI calls the user's runs made this month. Throws on a database error. */
async function monthlyUsed(supabaseAdmin, userId, now = Date.now()) {
    const hit = monthCache.get(userId);
    if (hit && now - hit.at < MONTH_CACHE_MS) return hit.used;
    const { data, error } = await supabaseAdmin
        .from('agent_runs').select('id,cost')
        .eq('user_id', userId).gte('created_at', monthStart(now)).limit(1000);
    if (error) throw error;
    const used = (data || []).reduce((sum, row) => sum + (Number(mergeCost(row.cost, langfuse.usageFor(row.id)).aiCalls) || 0), 0);
    monthCache.set(userId, { at: now, used });
    return used;
}

/** The budget a new run is given, with this month's use so far. */
function budgetFor(used) {
    const l = limits();
    return { ...l, usedThisMonth: used };
}

/**
 * Express middleware: a request made by a run step (X-Vibed-Agent-Run) is
 * refused once that run has used its AI-call budget. The run's own saves
 * (/api/agent-runs) always pass, so the run can still record why it stopped.
 */
function runBudgetGuard(readContext) {
    return (req, res, next) => {
        try {
            if (req.path.startsWith('/api/agent-runs')) return next();
            const run = readContext(req);
            if (!run) return next();
            const used = Number(langfuse.usageFor(run.runId)?.aiCalls) || 0;
            const { maxAiCalls } = limits();
            if (used >= maxAiCalls) {
                return res.status(429).json({
                    error: 'RUN_BUDGET',
                    code: 'RUN_BUDGET',
                    message: `This run used its budget of ${maxAiCalls} AI calls, so it stopped. Nothing past this point was done.`,
                });
            }
            return next();
        } catch (err) {
            console.error('[agentBudget] guard failed, letting the request through:', err.message);
            return next();
        }
    };
}

function _resetForTests() { monthCache.clear(); }

module.exports = { DEFAULTS, limits, mergeCost, monthStart, monthlyUsed, budgetFor, runBudgetGuard, _resetForTests };
