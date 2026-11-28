'use strict';

/**
 * routes/agentRunRoutes.js — saving agent runs (R176b), mounted at
 * /api/agent-runs.
 *
 *   POST  /                     create a run   { projectId, goal, status, state }
 *   GET   /latest?projectId=    the user's latest run of that project, or null
 *   GET   /:id                  one run (owner only)
 *   PATCH /:id                  replace its status/state (owner only; a run
 *                               that has ended can no longer change)
 *   GET   /history              the user's last ended runs that still teach
 *                               (R180 learning), oldest first
 *   POST  /history/reset        stop every run so far from teaching (R180)
 *
 * A new run is refused (402 AGENT_MONTHLY_BUDGET) once the user's runs used
 * this month's AI-call budget, and is told its own budget (R180,
 * services/agentRunBudget.js).
 *
 * The run itself is driven in the browser (client/src/store/useAgentRunStore.js);
 * this stores it so it survives a reload, adds the AI usage the server counted
 * for it, and forwards every change to Langfuse (services/tracing/langfuse.js).
 * Someone else's run reads as not found (404), like every other owned
 * resource (R27/R97).
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { authenticateUser } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/database');
const langfuse = require('../services/tracing/langfuse');
const budget = require('../services/agentRunBudget');
const evaluation = require('../services/tracing/langfuseEval');

// Keep in step with client/src/agent/runs/goalContract.js and runState.js
// (scripts/test_agent_runs.mjs checks they agree).
const GOAL_KINDS = ['shorts_from_long_video', 'shorts_to_posts'];
const STATUSES = ['awaiting_plan_approval', 'finding', 'awaiting_short_review', 'finishing', 'preparing_posts', 'awaiting_schedule_approval', 'posting', 'interrupted', 'done', 'stopped', 'failed'];
const TERMINAL = ['done', 'stopped', 'failed'];
const MAX_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const runLimiter = rateLimit({
    windowMs: 60_000, max: 120,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many run updates. Please slow down.' },
});

router.use(runLimiter, authenticateUser);

/** Validate a body. Returns { error } or { value }. Pure, exported for tests. */
function validateRunBody(body, { requireGoal = true } = {}) {
    const b = body || {};
    let size = 0;
    try { size = Buffer.byteLength(JSON.stringify(b)); } catch { return { error: 'The run could not be read.' }; }
    if (size > MAX_BYTES) return { error: 'The run is too large to save.' };
    if (!STATUSES.includes(b.status)) return { error: 'Unknown run status.' };
    if (requireGoal && (!b.goal || typeof b.goal !== 'object' || !GOAL_KINDS.includes(b.goal.kind))) return { error: 'Unknown goal.' };
    if (b.state !== undefined && (typeof b.state !== 'object' || b.state === null || Array.isArray(b.state))) return { error: 'The run state must be an object.' };
    if (b.projectId != null && !UUID.test(String(b.projectId))) return { error: 'Unknown project.' };
    return { value: { goal: b.goal, status: b.status, state: b.state || {}, projectId: b.projectId || null } };
}

// Never lower a stored count (an instance restart starts its own count at 0).
function costFor(row) {
    return budget.mergeCost(row.cost, langfuse.usageFor(row.id));
}

router.post('/', async (req, res) => {
    try {
        const v = validateRunBody(req.body);
        if (v.error) return res.status(400).json({ error: v.error });
        const used = await budget.monthlyUsed(supabaseAdmin, req.user.id);
        const runBudget = budget.budgetFor(used);
        if (used >= runBudget.monthlyAiCalls) {
            return res.status(402).json({
                error: 'AGENT_MONTHLY_BUDGET', code: 'AGENT_MONTHLY_BUDGET', budget: runBudget,
                message: `Your runs used this month's budget of ${runBudget.monthlyAiCalls} AI calls. It resets on the 1st; the editor's own commands still work.`,
            });
        }
        if (v.value.projectId) {
            const { data: project, error: pErr } = await supabaseAdmin
                .from('projects').select('id').eq('id', v.value.projectId).eq('user_id', req.user.id).maybeSingle();
            if (pErr) throw pErr;
            if (!project) return res.status(404).json({ error: 'Project not found.' });
        }
        const { data, error } = await supabaseAdmin
            .from('agent_runs')
            .insert({ user_id: req.user.id, project_id: v.value.projectId, goal: v.value.goal, status: v.value.status, state: v.value.state })
            .select('*')
            .single();
        if (error) throw error;
        if (!data?.id) throw new Error('the run was not stored');
        langfuse.recordRunChange(null, { ...data, projectId: data.project_id }, { userId: req.user.id });
        return res.status(201).json({ run: data, budget: runBudget });
    } catch (err) {
        console.error('[agentRuns] create failed:', err.message);
        return res.status(503).json({ error: 'The run could not be saved. It still works in this tab.' });
    }
});

router.get('/latest', async (req, res) => {
    try {
        const projectId = String(req.query.projectId || '');
        if (!UUID.test(projectId)) return res.status(400).json({ error: 'Unknown project.' });
        const { data, error } = await supabaseAdmin
            .from('agent_runs').select('*')
            .eq('user_id', req.user.id).eq('project_id', projectId)
            .order('created_at', { ascending: false }).limit(1);
        if (error) throw error;
        const row = data?.[0] || null;
        return res.json({ run: row ? { ...row, cost: costFor(row) } : null });
    } catch (err) {
        console.error('[agentRuns] latest failed:', err.message);
        return res.status(503).json({ error: 'Runs could not be read.' });
    }
});

// R180: what the user kept, dropped and posted in earlier runs. Only the
// fields the learning reads; ended runs only (a run in progress has not
// decided yet). The client computes the preferences (agent/runs/runLearning.js).
const HISTORY_LIMIT = 20;
router.get('/history', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('agent_runs').select('id,goal,status,state,created_at')
            .eq('user_id', req.user.id).eq('learning_excluded', false)
            .in('status', TERMINAL)
            .order('created_at', { ascending: false }).limit(HISTORY_LIMIT);
        if (error) throw error;
        const runs = (data || []).reverse().map(row => ({
            id: row.id,
            kind: row.goal?.kind || null,
            status: row.status,
            createdAt: row.created_at,
            decisions: row.state?.decisions || {},
            shortFacts: row.state?.shortFacts || {},
            posts: (row.state?.posts || []).filter(p => p.publicationId).map(p => ({ shortId: p.shortId, provider: p.provider, publicationId: p.publicationId })),
        }));
        return res.json({ runs });
    } catch (err) {
        console.error('[agentRuns] history failed:', err.message);
        return res.status(503).json({ error: 'Past runs could not be read.' });
    }
});

router.post('/history/reset', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('agent_runs').update({ learning_excluded: true })
            .eq('user_id', req.user.id).eq('learning_excluded', false)
            .select('id');
        if (error) throw error;
        return res.json({ ok: true, excluded: (data || []).length });
    } catch (err) {
        console.error('[agentRuns] learning reset failed:', err.message);
        return res.status(503).json({ error: 'What the runs learned could not be reset. Try again.' });
    }
});

async function ownRun(id, userId) {
    if (!UUID.test(String(id))) return { row: null };
    const { data, error } = await supabaseAdmin
        .from('agent_runs').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return { row: data || null };
}

router.get('/:id', async (req, res) => {
    try {
        const { row } = await ownRun(req.params.id, req.user.id);
        if (!row) return res.status(404).json({ error: 'Run not found.' });
        return res.json({ run: { ...row, cost: costFor(row) } });
    } catch (err) {
        console.error('[agentRuns] read failed:', err.message);
        return res.status(503).json({ error: 'The run could not be read.' });
    }
});

router.patch('/:id', async (req, res) => {
    try {
        const v = validateRunBody(req.body, { requireGoal: false });
        if (v.error) return res.status(400).json({ error: v.error });
        const { row: prev } = await ownRun(req.params.id, req.user.id);
        if (!prev) return res.status(404).json({ error: 'Run not found.' });
        if (TERMINAL.includes(prev.status)) return res.status(409).json({ error: 'This run has ended and can no longer change.' });
        const cost = costFor(prev);
        const { data, error } = await supabaseAdmin
            .from('agent_runs')
            .update({ status: v.value.status, state: v.value.state, cost, updated_at: new Date().toISOString() })
            .eq('id', prev.id).eq('user_id', req.user.id)
            // Only if nobody ended it meanwhile (another tab).
            .not('status', 'in', `(${TERMINAL.join(',')})`)
            .select('*');
        if (error) throw error;
        const next = data?.[0];
        // An update that matched no row is not an error to PostgREST (R38).
        if (!next) return res.status(409).json({ error: 'This run has ended and can no longer change.' });
        langfuse.recordRunChange({ ...prev, projectId: prev.project_id }, { ...next, projectId: next.project_id }, { userId: req.user.id });
        // R180: the run just ended, so score it and add it to the dataset (fire and forget).
        if (TERMINAL.includes(next.status)) evaluation.evaluateRun(next);
        return res.json({ run: next });
    } catch (err) {
        console.error('[agentRuns] update failed:', err.message);
        return res.status(503).json({ error: 'The run could not be saved. It still works in this tab.' });
    }
});

module.exports = router;
module.exports.validateRunBody = validateRunBody;
module.exports.GOAL_KINDS = GOAL_KINDS;
module.exports.STATUSES = STATUSES;
