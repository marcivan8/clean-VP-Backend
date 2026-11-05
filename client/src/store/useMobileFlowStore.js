import { create } from 'zustand';

/**
 * The guided mobile flow: pick an outcome, watch it edit, land on the result.
 *
 * It opens over the editor rather than replacing it, so the upload, project
 * and timeline plumbing is the one that already works (pendingNewVideo →
 * handleFileImport). What changes is what a beginner sees first.
 *
 * Steps:
 *   outcome  — what are you making
 *   working  — the edit running, narrated from useEditStepsStore
 *   result   — the finished short, with what to do next
 *   change   — a plain-language change, which starts another run
 *   versions — what has been made so far, and a way back to any of it
 *   limit    — the free Auto edits are used up (R148)
 */
const useMobileFlowStore = create((set, get) => ({
    active: false,
    step: 'outcome',
    outcomeId: null,
    returnToEditor: false,
    /** The user's own words, from the "something else" card. */
    request: '',
    error: null,
    /** Set when the server refuses on quota. { reason, message, upgradeRequired } */
    limitInfo: null,

    /** Open on a brand new project. A project that already has an edit never gets this. */
    open: () => set({ active: true, step: 'outcome', outcomeId: null, request: '', error: null, limitInfo: null, returnToEditor: false }),

    /** Leave the flow and show the editor. Used by Skip and by the end of a run. */
    close: () => set({ active: false, error: null, returnToEditor: false }),

    /** Reopen the saved variations over the editor, preserving the current project. */
    openVersionsFromEditor: () => set({ active: true, step: 'versions', error: null, returnToEditor: true }),

    choose: (outcomeId, request = '') => set({ outcomeId, request, step: 'working', error: null }),

    /** A run ended: land on the result rather than dumping the user in the editor. */
    finished: () => set({ step: 'result', error: null }),

    toChange: () => set({ step: 'change', error: null, returnToEditor: false }),
    toVersions: () => set({ step: 'versions', error: null, returnToEditor: false }),
    toResult: () => set({ step: 'result', error: null, returnToEditor: false }),

    /**
     * The server refused the run on quota. This is its own step rather than a
     * modal over the flow: the run did not happen, so there is nothing behind
     * the sheet to go back to, and a beginner needs to be told what they still
     * have rather than just what they have lost.
     *
     * It wins over `failed`, which the same 402 also triggers further down the
     * pipeline as a thrown error. Reaching this step first means the quota
     * message is the one the user sees, not "Something went wrong."
     */
    limited: (info = {}) => set({
        step: 'limit',
        error: null,
        limitInfo: {
            reason: info.reason || 'ai_ops',
            message: info.message || null,
            upgradeRequired: info.upgradeRequired || 'creator',
        },
    }),

    /**
     * A failed run goes back to a screen the user can act on: the question if
     * nothing has been made yet, otherwise the result they already have.
     * Dropping someone into an empty editor after a failure reads as a crash.
     */
    failed: (message) => set((s) => {
        // A quota refusal already routed to `limit` with a message worth
        // reading. The generic failure that follows it must not overwrite that.
        if (s.step === 'limit') return {};
        return {
            error: message || 'Something went wrong.',
            step: s.outcomeId ? 'result' : 'outcome',
        };
    }),

    isOpenAt: (step) => get().active && get().step === step,
}));

export default useMobileFlowStore;
