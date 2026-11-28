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
import { checkStep, cleanPlan, criteriaForPlan, postsAfterFinish, POST_TITLE_MAX, POST_CAPTION_MAX } from './goalContract.js';
import { inPostWindow } from './postSchedule.js';

export const STATUS = Object.freeze({
    AWAITING_PLAN: 'awaiting_plan_approval',
    FINDING: 'finding',
    AWAITING_REVIEW: 'awaiting_short_review',
    FINISHING: 'finishing',
    // R179, shorts_to_posts only:
    PREPARING_POSTS: 'preparing_posts',
    AWAITING_SCHEDULE: 'awaiting_schedule_approval',
    POSTING: 'posting',
    INTERRUPTED: 'interrupted',
    DONE: 'done',
    STOPPED: 'stopped',
    FAILED: 'failed',
});

export const TERMINAL = Object.freeze([STATUS.DONE, STATUS.STOPPED, STATUS.FAILED]);
/** Statuses where work is happening; after a reload these become INTERRUPTED. */
export const RUNNING = Object.freeze([STATUS.FINDING, STATUS.FINISHING, STATUS.PREPARING_POSTS, STATUS.POSTING]);

/** The step a running status is on. */
const STEP_OF = { [STATUS.FINDING]: 'find', [STATUS.FINISHING]: 'finish', [STATUS.PREPARING_POSTS]: 'prepare_posts', [STATUS.POSTING]: 'post' };
const STATUS_OF = { find: STATUS.FINDING, finish: STATUS.FINISHING, prepare_posts: STATUS.PREPARING_POSTS, post: STATUS.POSTING };

const PROVIDERS = ['youtube', 'instagram'];
const PROBLEMS = ['unsupported', 'not_connected', 'reconnect', 'no_slot', 'no_export'];
const MAX_POSTS = 20;

/** One post of the schedule, with only the fields a run keeps. */
export function cleanPost(p) {
    if (!p || typeof p !== 'object' || typeof p.key !== 'string' || !p.key) return null;
    const iso = Number.isFinite(Date.parse(p.scheduledAt || '')) ? new Date(Date.parse(p.scheduledAt)).toISOString() : null;
    return {
        key: p.key.slice(0, 120),
        shortId: typeof p.shortId === 'string' ? p.shortId.slice(0, 100) : null,
        platform: typeof p.platform === 'string' ? p.platform.slice(0, 20) : null,
        provider: PROVIDERS.includes(p.provider) ? p.provider : null,
        title: typeof p.title === 'string' ? p.title.trim().slice(0, POST_TITLE_MAX) : '',
        caption: typeof p.caption === 'string' ? p.caption.trim().slice(0, POST_CAPTION_MAX) : '',
        scheduledAt: iso,
        timeFromData: p.timeFromData === true,
        copyFromAI: p.copyFromAI === true,
        skip: p.skip === true,
        problem: PROBLEMS.includes(p.problem) ? p.problem : null,
        publicationId: typeof p.publicationId === 'string' ? p.publicationId.slice(0, 100) : null,
        error: typeof p.error === 'string' ? p.error.slice(0, 300) : null,
    };
}

/** Why a post cannot be scheduled as it is, or null. */
export function postProblem(post, now = Date.now()) {
    if (!post.provider || post.problem === 'unsupported') return 'Posting to this platform is not supported yet.';
    if (post.problem === 'not_connected') return 'The account is not connected.';
    if (post.problem === 'reconnect') return 'The account needs to be reconnected.';
    if (!inPostWindow(post.scheduledAt, now)) return 'The time must be at least a minute from now and within the next 6 days.';
    if (post.provider === 'youtube' && !post.title) return 'YouTube needs a title.';
    return null;
}

/** The posts the user approved to go out. */
export function approvedPosts(run) {
    return (run?.posts || []).filter(p => !p.skip);
}

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
        posts: [],            // shorts_to_posts: the schedule (cleanPost shape)
        shortFacts: {},       // shortId -> { seconds, platform, hook, score } (R180, what learning reads)
        budget: null,         // { maxAiCalls, maxExportMinutes, monthlyAiCalls, usedThisMonth } from the server (R180)
        spent: { exportSeconds: 0 },
        learned: null,        // learnedSummary() when earlier runs shaped this plan (R180)
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
 *   finish_done  { note, verification }  FINISHING -> DONE (shorts_to_posts: -> PREPARING_POSTS)
 *   posts_prepared { posts, note }       PREPARING_POSTS -> AWAITING_SCHEDULE
 *   update_posts { posts }               while AWAITING_SCHEDULE (problems refreshed)
 *   approve_schedule { posts, reason? }  AWAITING_SCHEDULE -> POSTING (every kept post valid)
 *   reject_schedule { reason }           AWAITING_SCHEDULE -> STOPPED (shorts stay finished)
 *   post_result  { key, publicationId | error }   while POSTING
 *   posting_done {}                      POSTING -> DONE (or FAILED when nothing was scheduled)
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
        case 'apply_learning': {
            // R180: earlier runs shaped the proposed plan, or the user reset that.
            if (run.status !== STATUS.AWAITING_PLAN) return refuse('The plan is not waiting for approval.');
            const plan = cleanPlan(run.goal, event.plan || run.goal.params);
            return accept({ ...run, plan, criteria: criteriaForPlan(run.goal, plan), learned: event.learned && typeof event.learned === 'object' ? event.learned : null }, now);
        }
        case 'set_budget': {
            const b = event.budget || {};
            const n = (v, max) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(max, Math.round(Number(v))) : null);
            return accept({ ...run, budget: { maxAiCalls: n(b.maxAiCalls, 100000), maxExportMinutes: n(b.maxExportMinutes, 600), monthlyAiCalls: n(b.monthlyAiCalls, 1000000), usedThisMonth: n(b.usedThisMonth, 1000000) } }, now);
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
            const shortFacts = {};
            for (const id of shortIds) {
                const f = event.facts?.[id];
                if (f && typeof f === 'object') {
                    shortFacts[id] = {
                        seconds: Math.max(0, Math.min(600, Number(f.seconds) || 0)),
                        platform: typeof f.platform === 'string' ? f.platform.slice(0, 20) : null,
                        hook: typeof f.hook === 'string' ? f.hook.slice(0, 40) : null,
                        score: Number.isFinite(Number(f.score)) ? Math.round(Number(f.score)) : null,
                    };
                }
            }
            if (shortIds.length === 0) {
                return accept({ ...run, steps, shortIds, status: STATUS.STOPPED, stopReason: text(event.note) || 'No passage was strong enough for a short.' }, now);
            }
            return accept({ ...run, steps: [...steps, { id: 'review', status: 'running', startedAt: now, endedAt: null, note: null }], shortIds, shortFacts, decisions: {}, status: STATUS.AWAITING_REVIEW }, now);
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
            if (postsAfterFinish(run.goal.kind)) {
                const allowed = checkStep(run.goal.kind, 'prepare_posts');
                if (!allowed.ok) return refuse(allowed.reason);
                const withVerify = { ...run, steps: [...steps, ...verifyStep], verification: v };
                return accept({ ...withVerify, status: STATUS.PREPARING_POSTS, steps: startStep(withVerify, 'prepare_posts', now) }, now);
            }
            return accept({ ...run, steps: [...steps, ...verifyStep], verification: v, status: STATUS.DONE }, now);
        }
        case 'posts_prepared': {
            if (run.status !== STATUS.PREPARING_POSTS) return refuse('The run is not preparing posts.');
            const posts = (Array.isArray(event.posts) ? event.posts : []).map(cleanPost).filter(Boolean).slice(0, MAX_POSTS);
            const steps = endStep(run, 'prepare_posts', 'done', event.note || `${posts.length} post(s) drafted`, now, { drafted: posts.length });
            if (!steps) return refuse('The prepare step was not running.');
            if (!posts.length) return accept({ ...run, steps, posts, status: STATUS.STOPPED, stopReason: 'There was no finished short to schedule.' }, now);
            return accept({ ...run, steps, posts, status: STATUS.AWAITING_SCHEDULE }, now);
        }
        case 'update_posts': {
            // Problems refreshed (an account connected) while the schedule waits.
            if (run.status !== STATUS.AWAITING_SCHEDULE) return refuse('The schedule is not waiting for approval.');
            // Only the connection problem changes: the drafted time and copy stay.
            const byKey = new Map((event.posts || []).map(cleanPost).filter(Boolean).map(p => [p.key, p]));
            return accept({ ...run, posts: run.posts.map(p => (byKey.has(p.key) ? { ...p, problem: byKey.get(p.key).problem } : p)) }, now);
        }
        case 'approve_schedule': {
            if (run.status !== STATUS.AWAITING_SCHEDULE) return refuse('The schedule is not waiting for approval.');
            const allowed = checkStep(run.goal.kind, 'post');
            if (!allowed.ok) return refuse(allowed.reason);
            // The user's edits (time, copy, skip) on the posts the run drafted;
            // a key the run did not draft is ignored.
            const edits = new Map((event.posts || []).map(cleanPost).filter(Boolean).map(p => [p.key, p]));
            const posts = run.posts.map((p) => {
                const e = edits.get(p.key);
                return e ? { ...p, title: e.title, caption: e.caption, scheduledAt: e.scheduledAt, skip: e.skip } : p;
            });
            const going = posts.filter(p => !p.skip);
            if (!going.length) return refuse('Every post is unticked. Cancel the schedule instead.');
            const problems = going.map(p => [p, postProblem(p, now)]).filter(([, why]) => why);
            if (problems.length) return refuse(problems.map(([p, why]) => `${p.provider || p.platform}: ${why}`).join(' '));
            return accept({
                ...run,
                posts,
                status: STATUS.POSTING,
                approvals: [...run.approvals, {
                    kind: 'schedule', decision: 'approved', reason: text(event.reason) || null, at: now,
                    posts: going.map(p => ({ key: p.key, provider: p.provider, scheduledAt: p.scheduledAt })),
                    skipped: posts.filter(p => p.skip).map(p => p.key),
                }],
                steps: startStep(run, 'post', now),
            }, now);
        }
        case 'reject_schedule': {
            if (run.status !== STATUS.AWAITING_SCHEDULE) return refuse('The schedule is not waiting for approval.');
            const reason = text(event.reason) || 'Schedule declined';
            return accept({
                ...run,
                status: STATUS.STOPPED,
                stopReason: `Not scheduled (${reason}). The finished shorts stay in the Shorts panel.`,
                approvals: [...run.approvals, { kind: 'schedule', decision: 'rejected', reason, at: now }],
            }, now);
        }
        case 'post_result': {
            if (run.status !== STATUS.POSTING) return refuse('The run is not posting.');
            const target = run.posts.find(p => p.key === event.key);
            if (!target || target.skip) return refuse('That post was not approved.');
            if (target.publicationId) return refuse('That post is already scheduled.');
            const publicationId = typeof event.publicationId === 'string' && event.publicationId ? event.publicationId.slice(0, 100) : null;
            const error = publicationId ? null : (text(event.error) || 'Scheduling failed.');
            const exported = Math.max(0, Math.min(3600, Number(event.exportedSeconds) || 0));
            return accept({
                ...run,
                posts: run.posts.map(p => (p.key === event.key ? { ...p, publicationId, error } : p)),
                spent: { ...(run.spent || {}), exportSeconds: (Number(run.spent?.exportSeconds) || 0) + exported },
            }, now);
        }
        case 'posting_done': {
            if (run.status !== STATUS.POSTING) return refuse('The run is not posting.');
            const going = approvedPosts(run);
            const scheduled = going.filter(p => p.publicationId).length;
            const steps = endStep(run, 'post', scheduled ? 'done' : 'failed', `${scheduled} of ${going.length} scheduled`, now, { scheduled, approved: going.length });
            if (!steps) return refuse('The post step was not running.');
            const check = {
                id: 'scheduled', ok: scheduled === going.length,
                detail: scheduled === going.length
                    ? `${scheduled} post(s) scheduled; each can still be cancelled in the Planner`
                    : `${going.length - scheduled} of ${going.length} post(s) could not be scheduled`,
            };
            const prev = run.verification || { met: true, checks: [] };
            const verification = { met: prev.met && check.ok, checks: [...prev.checks.filter(c => c.id !== 'scheduled'), check].slice(0, 10) };
            if (!scheduled) return accept({ ...run, steps, verification, status: STATUS.FAILED, stopReason: 'No post could be scheduled.' }, now);
            return accept({ ...run, steps, verification, status: STATUS.DONE }, now);
        }
        case 'step_failed': {
            if (!RUNNING.includes(run.status)) return refuse('No step is running.');
            const stepId = STEP_OF[run.status];
            const reason = text(event.error) || 'The step failed.';
            const steps = endStep(run, stepId, 'failed', reason, now) || run.steps;
            return accept({ ...run, steps, status: STATUS.FAILED, stopReason: reason }, now);
        }
        case 'interrupt': {
            if (!RUNNING.includes(run.status)) return refuse('Nothing was running.');
            const stepId = STEP_OF[run.status];
            const steps = endStep(run, stepId, 'interrupted', 'The page closed while this step was running', now) || run.steps;
            return accept({ ...run, steps, status: STATUS.INTERRUPTED, resumeFrom: stepId }, now);
        }
        case 'resume': {
            if (run.status !== STATUS.INTERRUPTED) return refuse('The run was not interrupted.');
            const stepId = STATUS_OF[run.resumeFrom] ? run.resumeFrom : 'find';
            return accept({
                ...run,
                status: STATUS_OF[stepId],
                resumeFrom: null,
                steps: startStep(run, stepId, now),
            }, now);
        }
        case 'stop': {
            const reason = text(event.reason) || 'Stopped by you';
            const stepId = STEP_OF[run.status] || (run.status === STATUS.AWAITING_REVIEW ? 'review' : null);
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

/**
 * R180: why the run must stop before spending more, or null. `cost` is what
 * the server counted and returned on the last save; `nextExportSeconds` is
 * the length of the export about to start.
 */
export function overBudget(run, { nextExportSeconds = 0 } = {}) {
    const b = run?.budget;
    if (!b) return null;
    const calls = Number(run.cost?.aiCalls) || 0;
    if (b.maxAiCalls && calls >= b.maxAiCalls) return `This run used its budget of ${b.maxAiCalls} AI calls.`;
    const exported = (Number(run.spent?.exportSeconds) || 0) + (Number(nextExportSeconds) || 0);
    if (b.maxExportMinutes && exported > b.maxExportMinutes * 60) return `Exporting this would pass the run's budget of ${b.maxExportMinutes} minutes of exported video.`;
    return null;
}

/** Approved posts not scheduled yet (what a resumed post step still owes). */
export function pendingPosts(run) {
    return approvedPosts(run).filter(p => !p.publicationId);
}

export default { STATUS, TERMINAL, RUNNING, createRun, applyRunEvent, pendingFinish, pendingPosts, overBudget, cleanPost, postProblem, approvedPosts };
