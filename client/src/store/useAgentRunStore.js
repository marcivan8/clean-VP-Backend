/**
 * client/src/store/useAgentRunStore.js — runs a goal ("turn this video into
 * shorts") step by step in the browser, with the user's approvals, and saves
 * every change of state (R176b).
 *
 * The rules (what may happen, when, and in what order) live in the pure
 * agent/runs/runState.js and goalContract.js. This store only does the work
 * each step names, using the existing pipeline unchanged:
 *   find   -> the repurpose_shorts command (MediaExecutionEngine), the same
 *             one the "Find shorts" button and the chat use;
 *   finish -> shortFinisher.finishShort for each kept short, cached in
 *             finishedShortCache so Preview and Export reuse it.
 * The main edit is never changed; dropped shorts are removed from the list.
 */
import { create } from 'zustand';
import useTimelineStore from './useTimelineStore';
import { GOAL_KINDS, createGoal } from '../agent/runs/goalContract.js';
import { STATUS, RUNNING, TERMINAL, createRun, applyRunEvent, pendingFinish } from '../agent/runs/runState.js';
import { createRunRemote, saveRunRemote, latestRunRemote } from '../agent/runs/runsApi.js';
import { enterAgentStep, leaveAgentStep } from '../agent/runs/agentRunContext.js';
import { putFinishedShort } from '../agent/finishedShortCache.js';
import { verifyShorts, shortFacts } from '../agent/runs/goalVerify.js';

const REMOVED_NOTE = 'removed from the list before it was finished';

/** The main edit, even while a short is being previewed. */
function mainEditState() {
    const st = useTimelineStore.getState();
    return st.shortPreview ? { ...st, ...st.shortPreview.saved } : st;
}

const useAgentRunStore = create((set, get) => ({
    run: null,
    saved: true,       // false when the last save to the server failed
    saveError: null,
    error: null,       // last refused action or failed step, in words
    loadedFor: null,   // projectId the latest run was loaded for

    /** Apply an event, keep the result and save it. Returns { ok, error }. */
    _apply: async (event) => {
        const current = get().run;
        const res = applyRunEvent(current, event);
        if (!res.ok) { set({ error: res.error }); return res; }
        set({ run: res.run, error: null });
        await get()._save();
        return res;
    },

    _save: async () => {
        const run = get().run;
        if (!run?.id) { set({ saved: false }); return; }
        const res = await saveRunRemote(run);
        if (res.ok) {
            // The server adds cost (AI calls, tokens) it counted for this run.
            set(s => ({ saved: true, saveError: null, run: s.run?.id === run.id && res.run ? { ...s.run, cost: res.run.cost } : s.run }));
        } else {
            set({ saved: false, saveError: res.error });
        }
    },

    /** The latest run of this project, for showing it and resuming after a reload. */
    loadLatest: async (projectId) => {
        if (!projectId || get().loadedFor === projectId) return;
        set({ loadedFor: projectId });
        if (get().run?.projectId === projectId) return;
        const res = await latestRunRemote(projectId);
        if (!res.ok || !res.run || get().run) return;
        let run = res.run;
        // A step that was running when the page closed did not finish.
        if (RUNNING.includes(run.status)) {
            const r = applyRunEvent(run, { type: 'interrupt' });
            if (r.ok) run = r.run;
            set({ run });
            await get()._save();
            return;
        }
        set({ run });
    },

    /**
     * Propose a plan. Nothing happens until it is approved.
     * Pass a ready goal (from goalParser, i.e. a typed request) or plain params.
     */
    start: async ({ goal = null, count, platforms, finish } = {}) => {
        const existing = get().run;
        if (existing && !TERMINAL.includes(existing.status)) {
            set({ error: 'A run is already in progress. Stop it first.' });
            return { ok: false };
        }
        const built = goal ? { ok: true, goal } : createGoal(GOAL_KINDS.SHORTS_FROM_LONG_VIDEO, { count, platforms, finish });
        if (!built.ok) { set({ error: built.error }); return { ok: false }; }
        const projectId = useTimelineStore.getState().projectId || null;
        let run = createRun(built.goal, { projectId });
        set({ run, error: null, saved: false });
        const res = projectId ? await createRunRemote(run) : { ok: false, error: 'Save the project first to keep this run.' };
        if (res.ok && res.run?.id) {
            run = { ...run, id: res.run.id };
            set({ run, saved: true, saveError: null });
        } else {
            set({ saveError: res.error });
        }
        return { ok: true };
    },

    approvePlan: async (edits = {}, reason = '') => {
        const res = await get()._apply({ type: 'approve_plan', plan: edits, reason });
        if (res.ok) await get()._runFind();
        return res;
    },

    rejectPlan: (reason = '') => get()._apply({ type: 'reject_plan', reason }),

    stop: (reason = '') => get()._apply({ type: 'stop', reason: reason || 'Stopped by you' }),

    decide: (shortId, decision, reason = '') => get()._apply({ type: 'decide_short', shortId, decision, reason }),

    /** Every short decided: remove the dropped ones and finish the kept ones. */
    finishKept: async () => {
        const res = await get()._apply({ type: 'start_finish' });
        if (!res.ok) return res;
        const run = get().run;
        const tl = useTimelineStore.getState();
        for (const id of run.shortIds) {
            if (run.decisions[id]?.decision === 'dropped') tl.removeShort?.(id);
        }
        if (run.status === STATUS.FINISHING) await get()._runFinish();
        return res;
    },

    resume: async () => {
        const res = await get()._apply({ type: 'resume' });
        if (!res.ok) return res;
        if (get().run.status === STATUS.FINDING) await get()._runFind();
        else if (get().run.status === STATUS.FINISHING) await get()._runFinish();
        return res;
    },

    dismiss: () => {
        const run = get().run;
        if (run && !TERMINAL.includes(run.status)) return;
        set({ run: null, error: null });
    },

    _runFind: async () => {
        const run = get().run;
        enterAgentStep(run.id, 'find');
        try {
            const { mediaExecutionEngine } = await import('../agent/MediaExecutionEngine.js');
            const execution = await mediaExecutionEngine.execute([{
                engine: 'STORE',
                action: 'repurpose_shorts',
                args: { count: run.plan.count, platforms: run.plan.platforms, maxSeconds: run.plan.maxSeconds || null, brief: run.goal.request || '' },
                meta: { source_step_id: 'find', description: 'Find shorts for an agent run' },
            }]);
            if (get().run?.status !== STATUS.FINDING) return; // stopped meanwhile
            const result = execution?.results?.[0]?.result || execution?.results?.[0] || {};
            if (!execution?.success || result.success === false) {
                await get()._apply({ type: 'step_failed', error: result.message || execution?.error || 'No shorts could be found.' });
                return;
            }
            const shorts = useTimelineStore.getState().shorts || [];
            const tl = useTimelineStore.getState();
            for (const s of shorts) tl.updateShort?.(s.id, { runId: run.id });
            await get()._apply({ type: 'shorts_found', shortIds: shorts.map(s => s.id), note: String(result.message || '').slice(0, 400) });
        } catch (err) {
            console.error('[agentRun] find failed:', err);
            await get()._apply({ type: 'step_failed', error: err?.message || 'Finding shorts failed.' });
        } finally {
            leaveAgentStep();
        }
    },

    _runFinish: async () => {
        const run = get().run;
        const tlState = useTimelineStore.getState();
        const brandKit = run.criteria?.brand ? (tlState.brandKit || null) : null;
        const { brandTitle, ...finishOpts } = run.plan.finish || {};
        const opts = {
            ...finishOpts,
            ...(brandKit ? { brand: brandKit } : {}),
            // The goal's own wishes override the defaults: a brand request
            // turns the hook title on (it carries the brand look), and
            // "no captions" turns captions off. Undefined keeps the defaults.
            ...((brandTitle && brandKit) || run.criteria?.captions === false ? {
                layers: {
                    title: !!(brandTitle && brandKit), cta: false, captions: run.criteria?.captions !== false,
                    camera: true, numbers: false, graphics: false, cuts: false,
                },
            } : {}),
        };
        const facts = [];
        enterAgentStep(run.id, 'finish');
        try {
            const { finishShort } = await import('../agent/shortFinisher.js');
            for (const id of pendingFinish(run)) {
                if (get().run?.status !== STATUS.FINISHING) return; // stopped meanwhile
                const short = (useTimelineStore.getState().shorts || []).find(s => s.id === id);
                if (!short) {
                    // Removed from the panel during the run: nothing left to finish.
                    await get()._apply({ type: 'short_finished', shortId: id, applied: [REMOVED_NOTE] });
                    continue;
                }
                if (opts.popOut) {
                    const { ensureMattesFor } = await import('../agent/shortMattes.js');
                    await ensureMattesFor(short);
                }
                const built = await finishShort(mainEditState(), short, opts);
                putFinishedShort(short, opts, built);
                facts.push({ shortId: id, platform: short.platform, facts: shortFacts(built, brandKit) });
                useTimelineStore.getState().updateShort?.(id, { finishedAt: Date.now(), finishedWith: built.applied || [] });
                await get()._apply({ type: 'short_finished', shortId: id, applied: built.applied || [] });
            }
            if (get().run?.status !== STATUS.FINISHING) return;
            // Shorts finished in an earlier attempt (before a reload) are judged
            // from what was recorded for them; their timelines are not kept.
            const finishedCount = Object.values(get().run.finished).filter(f => !(f.applied || []).includes(REMOVED_NOTE)).length;
            const verification = verifyShorts(get().run.criteria || {}, facts, { hasBrandKit: !!brandKit, finishedCount });
            const earlier = Object.entries(get().run.finished).filter(([id, f]) => !facts.some(x => x.shortId === id) && !(f.applied || []).includes(REMOVED_NOTE));
            if (earlier.length) verification.checks.push({ id: 'resumed', ok: true, detail: `${earlier.length} short(s) finished before the reload were not re-checked` });
            await get()._apply({ type: 'finish_done', verification });
        } catch (err) {
            console.error('[agentRun] finish failed:', err);
            if (get().run?.status === STATUS.FINISHING) await get()._apply({ type: 'step_failed', error: err?.message || 'Finishing a short failed.' });
        } finally {
            leaveAgentStep();
        }
    },
}));

export default useAgentRunStore;
