/**
 * client/src/agent/runs/runsApi.js — saving agent runs (R176b).
 * Every call resolves to { ok, run?, error? } and never throws: a run keeps
 * working in the browser when saving fails, and says it was not saved.
 */
import { authFetch } from '../../utils/authFetch.js';

/** The parts of a run the server stores (and Langfuse traces). */
export function runPayload(run) {
    return {
        projectId: run.projectId || null,
        goal: run.goal,
        status: run.status,
        state: {
            plan: run.plan,
            criteria: run.criteria,
            verification: run.verification,
            steps: run.steps,
            approvals: run.approvals,
            decisions: run.decisions,
            shortIds: run.shortIds,
            finished: run.finished,
            stopReason: run.stopReason,
            resumeFrom: run.resumeFrom,
            createdAt: run.createdAt,
        },
    };
}

/** Server row -> run object. */
export function runFromRow(row) {
    if (!row || typeof row !== 'object') return null;
    const s = row.state || {};
    return {
        id: row.id,
        projectId: row.project_id || null,
        goal: row.goal,
        status: row.status,
        plan: s.plan || row.goal?.params || {},
        criteria: s.criteria || row.goal?.criteria || {},
        verification: s.verification || null,
        steps: Array.isArray(s.steps) ? s.steps : [],
        approvals: Array.isArray(s.approvals) ? s.approvals : [],
        decisions: s.decisions && typeof s.decisions === 'object' ? s.decisions : {},
        shortIds: Array.isArray(s.shortIds) ? s.shortIds : [],
        finished: s.finished && typeof s.finished === 'object' ? s.finished : {},
        stopReason: s.stopReason || null,
        resumeFrom: s.resumeFrom || null,
        cost: row.cost || null,
        createdAt: s.createdAt || Date.parse(row.created_at) || Date.now(),
        updatedAt: Date.parse(row.updated_at) || Date.now(),
    };
}

async function call(url, options) {
    try {
        const res = await authFetch(url, options);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, status: res.status, error: body?.error || `Saving the run failed (${res.status}).` };
        return { ok: true, run: body?.run ? runFromRow(body.run) : null };
    } catch (err) {
        return { ok: false, error: err?.message || 'Saving the run failed.' };
    }
}

export const createRunRemote = (run) => call('/api/agent-runs', { method: 'POST', body: JSON.stringify(runPayload(run)) });
export const saveRunRemote = (run) => call(`/api/agent-runs/${encodeURIComponent(run.id)}`, { method: 'PATCH', body: JSON.stringify(runPayload(run)) });
export const latestRunRemote = (projectId) => call(`/api/agent-runs/latest?projectId=${encodeURIComponent(projectId)}`, { method: 'GET' });

export default { runPayload, runFromRow, createRunRemote, saveRunRemote, latestRunRemote };
