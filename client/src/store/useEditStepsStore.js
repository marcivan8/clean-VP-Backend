import { create } from 'zustand';
import { EventBus, EVENT_TYPES } from '../agent/EventBus.js';

/**
 * The steps of the edit currently running, in the order the engine ran them.
 *
 * The engine emits one EDIT_STEP as a command starts and one as it finishes
 * (agent/MediaExecutionEngine.js). This turns that stream into a list a
 * progress screen can render: what is done, what is running, and the sentence
 * each finished step reported, which is where the real numbers come from
 * ("Removed 2:41 of silence").
 *
 * Steps are keyed by index within a job, so a re-emitted step updates in place
 * rather than appending a duplicate.
 */
const useEditStepsStore = create((set, get) => ({
    jobId: null,
    steps: [],          // [{ index, action, label, state, message, durationMs }]
    total: 0,
    startedAt: null,
    finishedAt: null,

    /** Called for every EDIT_STEP the engine emits. */
    ingest: (e) => set((s) => {
        // a new job replaces the list rather than growing it
        const fresh = s.jobId !== e.jobId;
        const steps = fresh ? [] : s.steps.slice();

        const at = steps.findIndex(x => x.index === e.index);
        const next = {
            index: e.index,
            action: e.action,
            label: e.label,
            state: e.state,
            message: e.message ?? (at >= 0 ? steps[at].message : null),
            durationMs: e.durationMs ?? (at >= 0 ? steps[at].durationMs : null),
        };
        if (at >= 0) steps[at] = next; else steps.push(next);
        steps.sort((a, b) => a.index - b.index);

        return {
            jobId: e.jobId,
            steps,
            total: e.total ?? s.total,
            startedAt: fresh ? Date.now() : (s.startedAt ?? Date.now()),
            finishedAt: null,
        };
    }),

    /** The run ended — nothing is running any more. */
    finish: () => set((s) => ({
        finishedAt: Date.now(),
        steps: s.steps.map(x => (x.state === 'running' ? { ...x, state: 'done' } : x)),
    })),

    clear: () => set({ jobId: null, steps: [], total: 0, startedAt: null, finishedAt: null }),

    /** What a progress screen needs without recomputing it in render. */
    summary: () => {
        const { steps, total, finishedAt } = get();
        const done = steps.filter(x => x.state === 'done').length;
        return {
            done,
            failed: steps.filter(x => x.state === 'failed').length,
            running: steps.find(x => x.state === 'running') || null,
            // `total` counts every command; steps only holds the ones worth
            // showing, so progress is measured against what the user can see.
            total: Math.max(total, steps.length),
            complete: Boolean(finishedAt),
        };
    },
}));

// One subscription for the app's lifetime. The engine is a singleton and the
// store is module-scoped, so this must not be inside a component.
let bound = false;
export function bindEditSteps() {
    if (bound) return () => {};
    bound = true;
    const offStep = EventBus.on(EVENT_TYPES.EDIT_STEP, (p) => useEditStepsStore.getState().ingest(p));
    const offDone = EventBus.on(EVENT_TYPES.EXECUTION_COMPLETE, () => useEditStepsStore.getState().finish());
    const offFail = EventBus.on(EVENT_TYPES.EXECUTION_FAILED,   () => useEditStepsStore.getState().finish());
    return () => { offStep?.(); offDone?.(); offFail?.(); bound = false; };
}

export default useEditStepsStore;
