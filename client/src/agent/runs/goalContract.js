/**
 * client/src/agent/runs/goalContract.js — what a goal is, and what a run
 * working toward it is allowed to do (R176b). Pure: no store, no DOM, no fetch.
 *
 * A goal names an outcome ("turn this long video into shorts"), its
 * parameters, and where the run must stop. The capability contract lists,
 * per goal kind, the ONLY steps a run may take, what each one touches and
 * whether it needs the user's approval first. Anything not listed is refused,
 * and every step that leaves the app (export, publish) is refused outright in
 * this first slice: the run stops with the shorts finished in the Shorts panel.
 *
 * The server keeps its own copy of the goal kinds and statuses it accepts
 * (routes/agentRunRoutes.js); scripts/test_agent_runs.mjs checks they agree.
 */

/** What a step touches. 'outward' means it reaches something outside the app. */
export const EFFECT = Object.freeze({
    READ: 'read',         // looks at the project, changes nothing
    PROJECT: 'project',   // changes this project (its shorts list, never the main edit)
    OUTWARD: 'outward',   // export to a file, publish, send: never allowed here
});

export const GOAL_KINDS = Object.freeze({
    SHORTS_FROM_LONG_VIDEO: 'shorts_from_long_video',
});

/**
 * Per goal kind: the steps, in order. `approval` names the user decision the
 * step waits for BEFORE it runs.
 */
export const CAPABILITY_CONTRACT = Object.freeze({
    [GOAL_KINDS.SHORTS_FROM_LONG_VIDEO]: Object.freeze({
        label: 'Turn this video into shorts',
        stopAt: 'finished',
        steps: Object.freeze([
            Object.freeze({ id: 'plan',   effect: EFFECT.READ,    approval: null,   label: 'Plan the shorts' }),
            Object.freeze({ id: 'find',   effect: EFFECT.PROJECT, approval: 'plan', label: 'Find the strongest passages' }),
            Object.freeze({ id: 'review', effect: EFFECT.READ,    approval: null,   label: 'You keep or drop each short' }),
            Object.freeze({ id: 'finish', effect: EFFECT.PROJECT, approval: 'each_short', label: 'Finish the kept shorts' }),
            Object.freeze({ id: 'verify', effect: EFFECT.READ,    approval: null,   label: 'Check the result against the goal' }),
        ]),
        // Named so a later slice has to ADD them here deliberately.
        refused: Object.freeze(['export', 'publish', 'schedule_post', 'edit_main_timeline']),
    }),
});

export const PLATFORMS = Object.freeze(['tiktok', 'reels', 'shorts']);
export const MAX_SHORTS = 10;

/** The contract for a goal kind, or null. */
export function contractFor(kind) {
    return CAPABILITY_CONTRACT[kind] || null;
}

/**
 * Is `stepId` something a run of `kind` may do? Returns { ok, reason }.
 * Outward steps are refused even if someone adds them to `steps` by mistake.
 */
export function checkStep(kind, stepId) {
    const contract = contractFor(kind);
    if (!contract) return { ok: false, reason: `Unknown goal "${kind}".` };
    const step = contract.steps.find(s => s.id === stepId);
    if (!step) {
        return {
            ok: false,
            reason: contract.refused.includes(stepId)
                ? `"${stepId}" is outside what this run may do. It stops with the shorts finished; exporting and posting stay with you.`
                : `"${stepId}" is not a step of "${contract.label}".`,
        };
    }
    if (step.effect === EFFECT.OUTWARD) return { ok: false, reason: `"${stepId}" would leave the app, which this run may not do.` };
    return { ok: true, step };
}

function cleanFinish(finish = {}) {
    return {
        polish: finish.polish !== false,
        sfx: finish.sfx !== false,
        duo: finish.duo !== false,
        popOut: finish.popOut === true,
        brandTitle: finish.brandTitle === true,
    };
}

/** A user length cap in seconds (10..180), or null. */
function cleanMaxSeconds(v) {
    const n = Math.round(Number(v));
    return n >= 10 && n <= 180 ? n : null;
}

/**
 * The success criteria the verify step checks. Only what the request asked
 * for is set; null means "not asked, not judged".
 */
function cleanCriteria(c = {}, params) {
    const out = {
        count: Number(c.count) >= 1 ? Math.min(MAX_SHORTS, Math.round(Number(c.count))) : null,
        maxSeconds: cleanMaxSeconds(c.maxSeconds),
        captions: typeof c.captions === 'boolean' ? c.captions : null,
        brand: c.brand === true ? true : null,
        platforms: Array.isArray(c.platforms) ? c.platforms.filter(p => PLATFORMS.includes(p)) : null,
    };
    if (out.platforms && out.platforms.length === 0) out.platforms = null;
    // A criterion the plan itself contradicts is the plan's, kept in step.
    if (out.maxSeconds && params.maxSeconds !== out.maxSeconds) out.maxSeconds = params.maxSeconds;
    return out;
}

/**
 * Build a goal, clamping everything to what the contract allows.
 * Returns { ok, goal } or { ok: false, error }.
 */
export function createGoal(kind, params = {}) {
    const contract = contractFor(kind);
    if (!contract) return { ok: false, error: `Unknown goal "${kind}".` };
    const count = Math.max(1, Math.min(MAX_SHORTS, Math.round(Number(params.count) || 3)));
    const platforms = (Array.isArray(params.platforms) ? params.platforms : [])
        .filter((p, i, a) => PLATFORMS.includes(p) && a.indexOf(p) === i);
    const cleanParams = {
        count,
        platforms: platforms.length ? platforms : [...PLATFORMS],
        maxSeconds: cleanMaxSeconds(params.maxSeconds),
        finish: cleanFinish(params.finish),
    };
    return {
        ok: true,
        goal: {
            kind,
            label: contract.label,
            stopAt: contract.stopAt,
            request: typeof params.request === 'string' ? params.request.slice(0, 300) : null,
            params: cleanParams,
            criteria: cleanCriteria(params.criteria || {}, cleanParams),
        },
    };
}

/** The plan the user approves: same shape as goal.params, re-clamped. */
export function cleanPlan(goal, edits = {}) {
    const merged = { ...goal.params, ...edits, finish: { ...goal.params.finish, ...(edits.finish || {}) } };
    const built = createGoal(goal.kind, merged);
    return built.ok ? built.goal.params : goal.params;
}

/**
 * The criteria after the user edited the plan: an edited count or length is
 * what the result is now judged against.
 */
export function criteriaForPlan(goal, plan) {
    const c = goal.criteria || {};
    return {
        ...c,
        count: c.count != null ? plan.count : null,
        maxSeconds: plan.maxSeconds || null,
        platforms: c.platforms ? plan.platforms : null,
    };
}

export default { EFFECT, GOAL_KINDS, CAPABILITY_CONTRACT, PLATFORMS, MAX_SHORTS, contractFor, checkStep, createGoal, cleanPlan, criteriaForPlan };
