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

// Keep in step with client/src/agent/runs/goalContract.js and runState.js
// (scripts/test_agent_runs.mjs checks they agree).
const GOAL_KINDS = ['shorts_from_long_video'];
const STATUSES = ['awaiting_plan_approval', 'finding', 'awaiting_short_review', 'finishing', 'interrupted', 'done', 'stopped', 'failed'];
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

function costFor(row) {
    const counted = langfuse.usageFor(row.id);
    return counted ? { ...(row.cost || {}), ...counted } : (row.cost || {});
}

router.post('/', async (req, res) => {
    try {
        const v = validateRunBody(req.body);
        if (v.error) return res.status(400).json({ error: v.error });
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
        return res.status(201).json({ run: data });
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
