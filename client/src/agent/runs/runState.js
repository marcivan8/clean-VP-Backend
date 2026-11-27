/**
 * client/src/agent/runs/runState.js — the state of one agent run (R176b).
 * Pure: every change goes through applyRunEvent(run, event), which returns a
 * NEW run or refuses the event with a reason. Nothing here talks to the store
 * or the network, so the rules are executable in a Node test.
 *
 * A run records, for whoever reads it later (the user, Langfuse, us):
 *   - the goal and the plan that was approved,
 *   - every step with its start, end, duration and outcome,
 *   - every approval and every short kept or dropped, with the reason given,
 *   - why it stopped, if it did not finish.
 */
import { checkStep, cleanPlan, criteriaForPlan } from './goalContract.js';

export const STATUS = Object.freeze({
    AWAITING_PLAN: 'awaiting_plan_approval',
    FINDING: 'finding',
    AWAITING_REVIEW: 'awaiting_short_review',
    FINISHING: 'finishing',
    INTERRUPTED: 'interrupted',
    DONE: 'done',
    STOPPED: 'stopped',
    FAILED: 'failed',
});

export const TERMINAL = Object.freeze([STATUS.DONE, STATUS.STOPPED, STATUS.FAILED]);
/** Statuses where work is happening; after a reload these become INTERRUPTED. */
export const RUNNING = Object.freeze([STATUS.FINDING, STATUS.FINISHING]);

const MAX_TEXT = 500;
const text = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');

/** A new run for an already-built goal. `now` is injectable for tests. */
export function createRun(goal, { id = null, projectId = null, now = Date.now() } = {}) {
    return {
        id,
        projectId,
        goal,
        plan: { ...goal.params },
        criteria: { ...(goal.criteria || {}) },
        verification: null,  // { met, checks[] } once the verify step ran
        status: STATUS.AWAITING_PLAN,
        steps: [{ id: 'plan', status: 'done', startedAt: now, endedAt: now, note: 'Plan proposed' }],
        approvals: [],
        decisions: {},        // shortId -> { decision: 'kept'|'dropped', reason, at }
        shortIds: [],
        finished: {},         // shortId -> { at, applied: string[] }
        stopReason: null,
        resumeFrom: null,
        createdAt: now,
        updatedAt: now,
    };
}

function refuse(error) { return { ok: false, error }; }
function accept(run, now) { return { ok: true, run: { ...run, updatedAt: now } }; }

function startStep(run, stepId, now) {
    const steps = run.steps.filter(s => !(s.id === stepId && s.status !== 'done'));
    return [...steps, { id: stepId, status: 'running', startedAt: now, endedAt: null, note: null }];
}

function endStep(run, stepId, status, note, now, extra = {}) {
    let found = false;
    const steps = run.steps.map((s) => {
        if (s.id !== stepId || s.status !== 'running') return s;
        found = true;
        return { ...s, status, endedAt: now, durationMs: Math.max(0, now - (s.startedAt || now)), note: text(note) || null, ...extra };
    });
    return found ? steps : null;
}

/**
 * Apply one event. Events:
 *   approve_plan { plan?, reason? }      AWAITING_PLAN -> FINDING
 *   reject_plan  { reason }              AWAITING_PLAN -> STOPPED
 *   shorts_found { shortIds, note }      FINDING -> AWAITING_REVIEW (or DONE with none)
 *   step_failed  { stepId, error }       FINDING/FINISHING -> FAILED
 *   decide_short { shortId, decision, reason? }   while AWAITING_REVIEW
 *   start_finish {}                      AWAITING_REVIEW -> FINISHING (needs every short decided)
 *   short_finished { shortId, applied }  while FINISHING
 *   finish_done  { note }                FINISHING -> DONE
 *   interrupt    {}                      FINDING/FINISHING -> INTERRUPTED (page reloaded)
 *   resume       {}                      INTERRUPTED -> the step it was on
 *   stop         { reason }              any non-terminal -> STOPPED
 */
export function applyRunEvent(run, event, now = Date.now()) {
    if (!run || typeof run !== 'object') return refuse('No run.');
    const type = event?.type;
    if (TERMINAL.includes(run.status)) return refuse(`This run has already ${run.status === STATUS.DONE ? 'finished' : run.status}.`);

    switch (type) {
        case 'approve_plan': {
            if (run.status !== STATUS.AWAITING_PLAN) return refuse('The plan is not waiting for approval.');
            const allowed = checkStep(run.goal.kind, 'find');
            if (!allowed.ok) return refuse(allowed.reason);
            const plan = cleanPlan(run.goal, event.plan || {});
            return accept({
                ...run,
                plan,
                criteria: criteriaForPlan(run.goal, plan),
                status: STATUS.FINDING,
                approvals: [...run.approvals, { kind: 'plan', decision: 'approved', reason: text(event.reason) || null, plan, at: now }],
                steps: startStep(run, 'find', now),
            }, now);
        }
        case 'reject_plan': {
            if (run.status !== STATUS.AWAITING_PLAN) return refuse('The plan is not waiting for approval.');
            const reason = text(event.reason) || 'Plan declined';
            return accept({
                ...run,
                status: STATUS.STOPPED,
                stopReason: reason,
                approvals: [...run.approvals, { kind: 'plan', decision: 'rejected', reason, at: now }],
            }, now);
        }
        case 'shorts_found': {
            if (run.status !== STATUS.FINDING) return refuse('The run is not finding shorts.');
            const shortIds = (Array.isArray(event.shortIds) ? event.shortIds : []).filter(id => typeof id === 'string' && id).slice(0, 20);
            const steps = endStep(run, 'find', 'done', event.note || `${shortIds.length} found`, now, { found: shortIds.length });
            if (!steps) return refuse('The find step was not running.');
            if (shortIds.length === 0) {
                return accept({ ...run, steps, shortIds, status: STATUS.STOPPED, stopReason: text(event.note) || 'No passage was strong enough for a short.' }, now);
            }
            return accept({ ...run, steps: [...steps, { id: 'review', status: 'running', startedAt: now, endedAt: null, note: null }], shortIds, decisions: {}, status: STATUS.AWAITING_REVIEW }, now);
        }
        case 'decide_short': {
            if (run.status !== STATUS.AWAITING_REVIEW) return refuse('The shorts are not waiting for review.');
            if (!run.shortIds.includes(event.shortId)) return refuse('That short is not part of this run.');
            if (event.decision !== 'kept' && event.decision !== 'dropped') return refuse('Keep or drop only.');
            return accept({
                ...run,
                decisions: { ...run.decisions, [event.shortId]: { decision: event.decision, reason: text(event.reason) || null, at: now } },
            }, now);
        }
        case 'start_finish': {
            if (run.status !== STATUS.AWAITING_REVIEW) return refuse('The shorts are not waiting for review.');
            const undecided = run.shortIds.filter(id => !run.decisions[id]);
            if (undecided.length) return refuse(`${undecided.length} short${undecided.length === 1 ? ' is' : 's are'} still to keep or drop.`);
            const kept = run.shortIds.filter(id => run.decisions[id].decision === 'kept');
            const reviewed = endStep(run, 'review', 'done', `${kept.length} kept, ${run.shortIds.length - kept.length} dropped`, now) || run.steps;
            const approval = { kind: 'each_short', decision: kept.length ? 'approved' : 'rejected', kept, dropped: run.shortIds.filter(id => !kept.includes(id)), at: now };
            if (!kept.length) {
                return accept({ ...run, steps: reviewed, approvals: [...run.approvals, approval], status: STATUS.STOPPED, stopReason: 'Every short was dropped.' }, now);
            }
            const allowed = checkStep(run.goal.kind, 'finish');
            if (!allowed.ok) return refuse(allowed.reason);
            return accept({ ...run, steps: startStep({ ...run, steps: reviewed }, 'finish', now), approvals: [...run.approvals, approval], status: STATUS.FINISHING }, now);
        }
        case 'short_finished': {
            if (run.status !== STATUS.FINISHING) return refuse('The run is not finishing shorts.');
            if (run.decisions[event.shortId]?.decision !== 'kept') return refuse('Only a kept short is finished.');
            const applied = (Array.isArray(event.applied) ? event.applied : []).map(String).slice(0, 20);
            return accept({ ...run, finished: { ...run.finished, [event.shortId]: { at: now, applied } } }, now);
        }
        case 'finish_done': {
            if (run.status !== STATUS.FINISHING) return refuse('The run is not finishing shorts.');
            const count = Object.keys(run.finished).length;
            const steps = endStep(run, 'finish', 'done', event.note || `${count} finished`, now, { finished: count });
            if (!steps) return refuse('The finish step was not running.');
            // The verify step: the result checked against the goal's criteria.
            const v = event.verification && Array.isArray(event.verification.checks) ? {
                met: !!event.verification.met,
                checks: event.verification.checks.slice(0, 10).map(c => ({ id: text(c.id), ok: !!c.ok, detail: text(c.detail) })),
            } : null;
            const verifyStep = v ? [{ id: 'verify', status: 'done', startedAt: now, endedAt: now, durationMs: 0,
                note: v.met ? 'Every criterion met' : `Not met: ${v.checks.filter(c => !c.ok).map(c => c.id).join(', ')}`, met: v.met }] : [];
            return accept({ ...run, steps: [...steps, ...verifyStep], verification: v, status: STATUS.DONE }, now);
        }
        case 'step_failed': {
            if (!RUNNING.includes(run.status)) return refuse('No step is running.');
            const stepId = run.status === STATUS.FINDING ? 'find' : 'finish';
            const reason = text(event.error) || 'The step failed.';
            const steps = endStep(run, stepId, 'failed', reason, now) || run.steps;
            return accept({ ...run, steps, status: STATUS.FAILED, stopReason: reason }, now);
        }
        case 'interrupt': {
            if (!RUNNING.includes(run.status)) return refuse('Nothing was running.');
            const stepId = run.status === STATUS.FINDING ? 'find' : 'finish';
            const steps = endStep(run, stepId, 'interrupted', 'The page closed while this step was running', now) || run.steps;
            return accept({ ...run, steps, status: STATUS.INTERRUPTED, resumeFrom: stepId }, now);
        }
        case 'resume': {
            if (run.status !== STATUS.INTERRUPTED) return refuse('The run was not interrupted.');
            const stepId = run.resumeFrom === 'finish' ? 'finish' : 'find';
            return accept({
                ...run,
                status: stepId === 'finish' ? STATUS.FINISHING : STATUS.FINDING,
                resumeFrom: null,
                steps: startStep(run, stepId, now),
            }, now);
        }
        case 'stop': {
            const reason = text(event.reason) || 'Stopped by you';
            const stepId = run.status === STATUS.FINDING ? 'find' : run.status === STATUS.FINISHING ? 'finish' : run.status === STATUS.AWAITING_REVIEW ? 'review' : null;
            const steps = (stepId && endStep(run, stepId, 'stopped', reason, now)) || run.steps;
            return accept({ ...run, steps, status: STATUS.STOPPED, stopReason: reason }, now);
        }
        default:
            return refuse(`Unknown run event "${type}".`);
    }
}

/** Shorts the user kept that are not finished yet (what a resumed finish still owes). */
export function pendingFinish(run) {
    return (run?.shortIds || []).filter(id => run.decisions?.[id]?.decision === 'kept' && !run.finished?.[id]);
}

export default { STATUS, TERMINAL, RUNNING, createRun, applyRunEvent, pendingFinish };
