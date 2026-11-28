'use strict';

/**
 * services/tracing/langfuseEval.js — scores and a dataset for agent runs
 * (R180), so a change to the run (picker, finishing, copy) can be judged on
 * whether runs get better or worse.
 *
 * When a run ends, its trace (id = run id without dashes, R176b) gets scores:
 *   keep_rate        NUMERIC 0..1   shorts kept / shorts decided
 *   criteria_met     BOOLEAN        the verify step's verdict (only when checked)
 *   scheduled_rate   NUMERIC 0..1   approved posts actually scheduled (posting runs)
 *   ai_calls         NUMERIC        AI calls the run made
 * and the run becomes an item of the dataset "agent-runs" (id = run id, so a
 * re-send updates it), input = the goal and plan, expected output = the
 * criteria, metadata = the outcome.
 * Seven days after a run's post went out, its views are added as
 * `post_views_7d` (services/social/analytics.js calls scorePostViews).
 *
 * REST, not the tracing SDK: POST /api/public/scores (array body, `id` as the
 * idempotency key with name and day), POST /api/public/v2/datasets,
 * POST /api/public/dataset-items (upsert on id). Checked against the docs on
 * 2026-11-28, not yet against a live project: every call is fire-and-forget,
 * logs a refusal with its status, and never affects the run.
 * Off with tracing (no keys, or LANGFUSE_TRACING=off). Only ids and numbers
 * are sent: no prompts, captions or titles.
 */

const { config, traceIdFor } = require('./langfuse');

const DATASET = 'agent-runs';
let datasetReady = null; // a promise, so the dataset is created once per process

function authHeader(cfg) {
    return `Basic ${Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString('base64')}`;
}

async function post(cfg, path, body, fetchImpl) {
    const res = await fetchImpl(`${cfg.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: authHeader(cfg), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(`[langfuse-eval] ${path} refused (${res.status}): ${text.slice(0, 200)}`);
    }
    return res.ok;
}

/** The scores a finished run earns. Pure. */
function runScores(row) {
    const state = row?.state || {};
    const traceId = traceIdFor(row?.id);
    if (!traceId) return [];
    const decisions = Object.values(state.decisions || {});
    const kept = decisions.filter(d => d?.decision === 'kept').length;
    const scores = [];
    const add = (name, value, dataType, comment) => scores.push({ id: `${traceId}-${name}`, traceId, name, value, dataType, ...(comment ? { comment } : {}) });
    if (decisions.length) add('keep_rate', Math.round((kept / decisions.length) * 1000) / 1000, 'NUMERIC', `${kept} of ${decisions.length} kept`);
    if (state.verification && typeof state.verification.met === 'boolean') add('criteria_met', state.verification.met ? 1 : 0, 'BOOLEAN');
    const approved = (state.posts || []).filter(p => !p.skip);
    const scheduled = approved.filter(p => p.publicationId).length;
    if (approved.length && (state.approvals || []).some(a => a.kind === 'schedule' && a.decision === 'approved')) {
        add('scheduled_rate', Math.round((scheduled / approved.length) * 1000) / 1000, 'NUMERIC', `${scheduled} of ${approved.length} scheduled`);
    }
    const calls = Number(row?.cost?.aiCalls);
    if (Number.isFinite(calls)) add('ai_calls', calls, 'NUMERIC');
    return scores;
}

/** The dataset item for a finished run. Pure. */
function datasetItemFor(row) {
    const state = row?.state || {};
    const traceId = traceIdFor(row?.id);
    if (!traceId) return null;
    const decisions = Object.values(state.decisions || {});
    return {
        datasetName: DATASET,
        id: `agent-run-${row.id}`,
        sourceTraceId: traceId,
        input: { kind: row.goal?.kind || null, params: row.goal?.params || null, plan: state.plan || null },
        expectedOutput: { criteria: state.criteria || row.goal?.criteria || null },
        metadata: {
            status: row.status,
            found: (state.shortIds || []).length,
            kept: decisions.filter(d => d?.decision === 'kept').length,
            criteriaMet: state.verification ? !!state.verification.met : null,
            scheduled: (state.posts || []).filter(p => p.publicationId).length,
            learned: !!state.learned,
        },
    };
}

/** Send the scores and dataset item of a run that just ended. Never throws. */
function evaluateRun(row, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
    const cfg = config(env);
    if (!cfg.enabled || typeof fetchImpl !== 'function') return Promise.resolve(false);
    const scores = runScores(row).map(s => ({ ...s, environment: cfg.environment }));
    const item = datasetItemFor(row);
    return (async () => {
        try {
            if (scores.length) await post(cfg, '/api/public/scores', scores, fetchImpl);
            if (item) {
                datasetReady = datasetReady || post(cfg, '/api/public/v2/datasets', {
                    name: DATASET, description: 'Ended agent runs: goal and plan in, criteria expected, outcome in metadata (R180).',
                }, fetchImpl).catch(() => false);
                await datasetReady;
                await post(cfg, '/api/public/dataset-items', item, fetchImpl);
            }
            return true;
        } catch (err) {
            console.warn('[langfuse-eval] run not evaluated:', err.message);
            return false;
        }
    })();
}

/** Seven-day views of a post a run scheduled. Never throws. */
function scorePostViews(runId, publicationId, views, { provider = null, fetchImpl = globalThis.fetch, env = process.env } = {}) {
    const cfg = config(env);
    const traceId = traceIdFor(runId);
    const n = Number(views);
    if (!cfg.enabled || !traceId || !Number.isFinite(n) || typeof fetchImpl !== 'function') return Promise.resolve(false);
    const score = {
        id: `${traceId}-post_views_7d-${String(publicationId).slice(0, 60)}`, traceId, name: 'post_views_7d',
        value: n, dataType: 'NUMERIC', environment: cfg.environment,
        comment: `${provider || 'post'} ${String(publicationId).slice(0, 60)}`,
    };
    return post(cfg, '/api/public/scores', [score], fetchImpl).catch((err) => {
        console.warn('[langfuse-eval] views not scored:', err.message);
        return false;
    });
}

function _resetForTests() { datasetReady = null; }

module.exports = { DATASET, runScores, datasetItemFor, evaluateRun, scorePostViews, _resetForTests };
