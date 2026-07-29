import { create } from 'zustand';

/**
 * Job States - Every edit job transitions through these states
 * No state can be skipped. Jobs MUST reach a terminal state.
 */
export const JOB_STATES = {
    IDLE: 'IDLE',
    PLANNING: 'PLANNING',
    CLARIFYING: 'CLARIFYING',
    WAITING_APPROVAL: 'WAITING_APPROVAL',
    EXECUTING: 'EXECUTING',
    VERIFYING: 'VERIFYING',
    DONE: 'DONE',
    FAILED: 'FAILED',
    TIMEOUT: 'TIMEOUT'
};

// Terminal states - job is complete
export const TERMINAL_STATES = [JOB_STATES.DONE, JOB_STATES.FAILED, JOB_STATES.TIMEOUT];

// Timeout for the EXECUTING state — must cover the worst case: Whisper transcription
// + GPT-4o filler analysis on a 30-minute raw iPhone video (~2–3 min total).
// The previous 30s value caused valid long-running jobs to fire TIMEOUT → invalid
// transition spam as execution completed after the timer.
//
// Raised 180s → 420s: this store is a UI-facing status mirror, separate from the
// actual execution engine's own timeout budgets — JobStateMachine.js's
// EXECUTION_TIMEOUT_MS (420s) and ExecutionSupervisor's PHASE_TIMEOUTS.executing
// (600s) are what actually govern whether a job gets cut off. At 180s this mirror
// fired FIRST and marked the job TIMEOUT in the UI while the real engine kept
// working underneath it — the job would go on to finish successfully seconds or
// minutes later, but every progress update in between logged
// "[Job] Invalid transition: TIMEOUT → EXECUTING" and the user saw a false
// "timed out" status on a job that was actually still running.
// This became reliably reachable once per-asset silence/filler cleanup started
// running N sequential steps per job (Whisper + GPT pause classification + the
// frame-check pass, once per asset — see R25) — a 5-asset batch's total
// EXECUTING time is the SUM across all 5, not one asset's worst case, so a
// budget sized for a single 30-min video is too tight for a multi-asset job.
// 420s matches JobStateMachine's own ceiling so this mirror can't fire before
// the system whose state it's mirroring would.
const DEFAULT_TIMEOUT_MS = 420_000; // 7 minutes

/**
 * Job Store
 * Centralized state management for all edit jobs.
 * UI subscribes to state changes for progress updates.
 */
const useJobStore = create((set, get) => ({
    // Map of jobId -> JobState
    jobs: {},

    // Currently active job
    activeJobId: null,

    // Timeout handles for cleanup
    timeoutHandles: {},

    /**
     * Create a new job
     * @param {string} userPrompt - The user's edit request
     * @returns {string} jobId
     */
    createJob: (userPrompt) => {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();

        const job = {
            id: jobId,
            userPrompt,
            state: JOB_STATES.IDLE,
            progress: 0,
            error: null,
            result: null,
            createdAt: now,
            updatedAt: now,
            stateHistory: [{ state: JOB_STATES.IDLE, timestamp: now }],
            plan: null,
            intent: null
        };

        set((state) => ({
            jobs: { ...state.jobs, [jobId]: job },
            activeJobId: jobId
        }));

        console.log(`[Job] Created: ${jobId}`);
        return jobId;
    },

    /**
     * Transition job to a new state
     * Enforces state machine rules (no skipping states)
     */
    transitionTo: (jobId, newState, payload = {}) => {
        const { jobs } = get();
        const job = jobs[jobId];

        if (!job) {
            console.error(`[Job] Not found: ${jobId}`);
            return false;
        }

        const currentState = job.state;

        // Allow updates to payload without changing state
        if (currentState === newState) {
            set((state) => ({
                jobs: {
                    ...state.jobs,
                    [jobId]: {
                        ...state.jobs[jobId],
                        ...payload,
                        updatedAt: Date.now()
                    }
                }
            }));
            return true;
        }

        // Validate transition
        if (!isValidTransition(currentState, newState)) {
            console.error(`[Job] Invalid transition: ${currentState} → ${newState}`);
            return false;
        }

        const now = Date.now();

        console.log(`[Job] ${jobId}: ${currentState} → ${newState}`);

        set((state) => ({
            jobs: {
                ...state.jobs,
                [jobId]: {
                    ...state.jobs[jobId],
                    state: newState,
                    updatedAt: now,
                    stateHistory: [
                        ...state.jobs[jobId].stateHistory,
                        { state: newState, timestamp: now }
                    ],
                    ...payload
                }
            }
        }));

        // Handle timeout logic
        const store = get();

        // Clear existing timeout if transitioning away from EXECUTING
        if (currentState === JOB_STATES.EXECUTING && store.timeoutHandles[jobId]) {
            clearTimeout(store.timeoutHandles[jobId]);
            delete store.timeoutHandles[jobId];
        }

        // Set timeout when entering EXECUTING
        if (newState === JOB_STATES.EXECUTING) {
            const timeoutHandle = setTimeout(() => {
                const currentJob = get().jobs[jobId];
                if (currentJob && currentJob.state === JOB_STATES.EXECUTING) {
                    console.warn(`[Job] ${jobId}: TIMEOUT after ${DEFAULT_TIMEOUT_MS}ms`);
                    get().transitionTo(jobId, JOB_STATES.TIMEOUT, {
                        error: `Job timed out after ${DEFAULT_TIMEOUT_MS / 1000} seconds`
                    });
                }
            }, DEFAULT_TIMEOUT_MS);

            set((state) => ({
                timeoutHandles: { ...state.timeoutHandles, [jobId]: timeoutHandle }
            }));
        }

        return true;
    },

    /**
     * Update job progress (0-100)
     */
    updateProgress: (jobId, progress) => {
        const { jobs } = get();
        if (!jobs[jobId]) return;

        console.log(`[Job] ${jobId}: Progress ${progress}%`);

        set((state) => ({
            jobs: {
                ...state.jobs,
                [jobId]: {
                    ...state.jobs[jobId],
                    progress: Math.min(100, Math.max(0, progress)),
                    updatedAt: Date.now()
                }
            }
        }));
    },

    /**
     * Store intent parsing result
     */
    setJobIntent: (jobId, intent) => {
        set((state) => ({
            jobs: {
                ...state.jobs,
                [jobId]: {
                    ...state.jobs[jobId],
                    intent,
                    updatedAt: Date.now()
                }
            }
        }));
    },

    /**
     * Store edit plan
     */
    setJobPlan: (jobId, plan) => {
        set((state) => ({
            jobs: {
                ...state.jobs,
                [jobId]: {
                    ...state.jobs[jobId],
                    plan,
                    updatedAt: Date.now()
                }
            }
        }));
    },

    /**
     * Set job result (for terminal states)
     */
    setJobResult: (jobId, result) => {
        set((state) => ({
            jobs: {
                ...state.jobs,
                [jobId]: {
                    ...state.jobs[jobId],
                    result,
                    updatedAt: Date.now()
                }
            }
        }));
    },

    /**
     * Get job by ID
     */
    getJob: (jobId) => {
        return get().jobs[jobId] || null;
    },

    /**
     * Get active job
     */
    getActiveJob: () => {
        const { activeJobId, jobs } = get();
        return activeJobId ? jobs[activeJobId] : null;
    },

    /**
     * Cancel a job (if cancelable)
     */
    cancelJob: (jobId) => {
        const job = get().jobs[jobId];
        if (!job) return false;

        // Can only cancel non-terminal states
        if (TERMINAL_STATES.includes(job.state)) {
            console.warn(`[Job] Cannot cancel job in terminal state: ${job.state}`);
            return false;
        }

        return get().transitionTo(jobId, JOB_STATES.FAILED, {
            error: 'Cancelled by user'
        });
    },

    /**
     * Clear completed jobs
     */
    clearCompletedJobs: () => {
        set((state) => {
            const jobs = { ...state.jobs };
            Object.keys(jobs).forEach(jobId => {
                if (TERMINAL_STATES.includes(jobs[jobId].state)) {
                    delete jobs[jobId];
                }
            });
            return { jobs };
        });
    }
}));

/**
 * Valid state transitions
 */
function isValidTransition(from, to) {
    const validTransitions = {
        [JOB_STATES.IDLE]: [JOB_STATES.PLANNING, JOB_STATES.FAILED],
        [JOB_STATES.PLANNING]: [JOB_STATES.CLARIFYING, JOB_STATES.WAITING_APPROVAL, JOB_STATES.EXECUTING, JOB_STATES.FAILED],
        [JOB_STATES.CLARIFYING]: [JOB_STATES.PLANNING, JOB_STATES.FAILED],
        [JOB_STATES.WAITING_APPROVAL]: [JOB_STATES.EXECUTING, JOB_STATES.IDLE, JOB_STATES.FAILED],
        [JOB_STATES.EXECUTING]: [JOB_STATES.VERIFYING, JOB_STATES.FAILED, JOB_STATES.TIMEOUT],
        [JOB_STATES.VERIFYING]: [JOB_STATES.DONE, JOB_STATES.FAILED],
        // Terminal states cannot transition
        [JOB_STATES.DONE]: [],
        [JOB_STATES.FAILED]: [],
        [JOB_STATES.TIMEOUT]: []
    };

    return validTransitions[from]?.includes(to) ?? false;
}

export default useJobStore;
