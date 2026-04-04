/**
 * OrchestratorFSM
 * Deterministic finite state machine for edit request lifecycle.
 * 
 * Features:
 * - Explicit state transitions (no skipping)
 * - Entry/Exit hooks per state
 * - Iteration guard to prevent infinite loops
 * - Context storage for job data
 */

import { STATES, TERMINAL_STATES, EVENTS, MAX_ITERATIONS, PROGRESS_WEIGHTS } from './OrchestratorConfig.js';
import { orchestratorEvents } from './OrchestratorEvents.js';

/**
 * Valid state transitions map
 * Key: Current state
 * Value: Array of valid next states
 */
const TRANSITION_MAP = {
    [STATES.IDLE]: [STATES.PLANNING, STATES.ERROR],
    [STATES.PLANNING]: [
        STATES.EXECUTING,
        STATES.ERROR,
        STATES.TIMEOUT,
        STATES.CANCELLED,
        STATES.CLARIFYING,      // New transition
        STATES.WAITING_APPROVAL // New transition
    ],
    [STATES.CLARIFYING]: [
        STATES.PLANNING, // Loop back to planning with new info
        STATES.ERROR,
        STATES.TIMEOUT,
        STATES.CANCELLED
    ],
    [STATES.WAITING_APPROVAL]: [
        STATES.EXECUTING,
        STATES.PLANNING,
        STATES.ERROR,
        STATES.TIMEOUT,
        STATES.CANCELLED
    ],
    [STATES.EXECUTING]: [STATES.VALIDATING, STATES.ERROR, STATES.TIMEOUT, STATES.CANCELLED],
    [STATES.VALIDATING]: [STATES.DONE, STATES.ERROR, STATES.TIMEOUT, STATES.CANCELLED],
    // Terminal states have no outgoing transitions
    [STATES.DONE]: [],
    [STATES.ERROR]: [],
    [STATES.TIMEOUT]: [],
    [STATES.CANCELLED]: []
};

/**
 * Event to target state mapping
 */
const EVENT_TO_STATE = {
    [EVENTS.START]: STATES.PLANNING,
    [EVENTS.PLAN_READY]: STATES.EXECUTING,
    [EVENTS.PLAN_FAILED]: STATES.ERROR,
    [EVENTS.CLARIFICATION_NEEDED]: STATES.CLARIFYING,
    [EVENTS.DECISION_PROVIDED]: STATES.PLANNING,
    [EVENTS.EXECUTION_COMPLETE]: STATES.VALIDATING,
    [EVENTS.EXECUTION_FAILED]: STATES.ERROR,
    [EVENTS.VALIDATION_PASSED]: STATES.DONE,
    [EVENTS.VALIDATION_FAILED]: STATES.ERROR,
    [EVENTS.TIMEOUT]: STATES.TIMEOUT,
    [EVENTS.CANCEL]: STATES.CANCELLED,
    [EVENTS.ERROR]: STATES.ERROR
};

export class OrchestratorFSM {
    /**
     * Create a new FSM instance
     * @param {string} jobId - Unique job identifier
     * @param {object} initialContext - Initial context data
     */
    constructor(jobId, initialContext = {}) {
        this.jobId = jobId;
        this.currentState = STATES.IDLE;
        this.iterationCount = 0;
        this.stateHistory = [];
        this.context = {
            jobId,
            userPrompt: '',
            intent: null,
            plan: null,
            commands: null,
            executionResult: null,
            validationResult: null,
            error: null,
            progress: 0,
            startTime: null,
            ...initialContext
        };

        // Entry/Exit hooks
        this.entryHooks = new Map();
        this.exitHooks = new Map();

        // Record initial state
        this.recordState(STATES.IDLE);
    }

    /**
     * Get current state
     */
    getState() {
        return this.currentState;
    }

    /**
     * Get current context
     */
    getContext() {
        return { ...this.context };
    }

    /**
     * Get state history
     */
    getHistory() {
        return [...this.stateHistory];
    }

    /**
     * Check if FSM is in a terminal state
     */
    isTerminal() {
        return TERMINAL_STATES.includes(this.currentState);
    }

    /**
     * Check if a transition is valid
     * @param {string} fromState - Current state
     * @param {string} toState - Target state
     */
    canTransition(fromState, toState) {
        const validTargets = TRANSITION_MAP[fromState] || [];
        return validTargets.includes(toState);
    }

    /**
     * Process an event and transition if valid
     * @param {string} event - Event from EVENTS
     * @param {object} payload - Optional data to merge into context
     * @returns {boolean} Whether transition occurred
     */
    send(event, payload = {}) {
        // Check iteration guard
        if (this.iterationCount >= MAX_ITERATIONS) {
            console.error(`[FSM] Max iterations (${MAX_ITERATIONS}) exceeded for job ${this.jobId}`);
            this.forceError('Max iterations exceeded - possible infinite loop');
            return false;
        }

        // Check if already terminal
        if (this.isTerminal()) {
            console.warn(`[FSM] Ignoring event ${event} - already in terminal state ${this.currentState}`);
            return false;
        }

        // Get target state for this event
        const targetState = EVENT_TO_STATE[event];
        if (!targetState) {
            console.error(`[FSM] Unknown event: ${event}`);
            return false;
        }

        // Validate transition
        if (!this.canTransition(this.currentState, targetState)) {
            console.error(`[FSM] Invalid transition: ${this.currentState} → ${targetState} (event: ${event})`);
            return false;
        }

        // Perform transition
        return this.transition(targetState, payload);
    }

    /**
     * Directly transition to a new state (for internal use)
     * @param {string} toState - Target state
     * @param {object} payload - Context updates
     * @returns {boolean} Whether transition occurred
     */
    transition(toState, payload = {}) {
        const fromState = this.currentState;

        // Validate
        if (!this.canTransition(fromState, toState)) {
            console.error(`[FSM] Cannot transition: ${fromState} → ${toState}`);
            return false;
        }

        this.iterationCount++;
        console.log(`[FSM] ${this.jobId}: ${fromState} → ${toState} (iteration ${this.iterationCount})`);

        // Execute exit hook
        this.executeExitHook(fromState);

        // Update state
        const previousState = this.currentState;
        this.currentState = toState;

        // Update context
        this.context = {
            ...this.context,
            ...payload,
            progress: PROGRESS_WEIGHTS[toState] || this.context.progress
        };

        // Record in history
        this.recordState(toState);

        // Emit state change event
        orchestratorEvents.emitStateChange(this.jobId, previousState, toState, {
            progress: this.context.progress,
            iteration: this.iterationCount
        });

        // Execute entry hook
        this.executeEntryHook(toState);

        return true;
    }

    /**
     * Force transition to ERROR state (emergency use)
     * @param {string} errorMessage - Error description
     */
    forceError(errorMessage) {
        const fromState = this.currentState;

        if (this.isTerminal()) {
            console.warn(`[FSM] Already terminal, cannot force error`);
            return;
        }

        console.error(`[FSM] Force error: ${errorMessage}`);

        this.currentState = STATES.ERROR;
        this.context.error = errorMessage;
        this.recordState(STATES.ERROR);

        orchestratorEvents.emitError(this.jobId, errorMessage, fromState);
        orchestratorEvents.emitStateChange(this.jobId, fromState, STATES.ERROR, {
            progress: 100,
            error: errorMessage
        });
    }

    /**
     * Cancel the job
     * @param {string} reason - Cancellation reason
     */
    cancel(reason = 'User cancelled') {
        if (this.isTerminal()) {
            console.warn(`[FSM] Cannot cancel - already in terminal state`);
            return false;
        }

        const fromState = this.currentState;
        this.currentState = STATES.CANCELLED;
        this.context.error = reason;
        this.recordState(STATES.CANCELLED);

        orchestratorEvents.emitCancelled(this.jobId, reason);
        orchestratorEvents.emitStateChange(this.jobId, fromState, STATES.CANCELLED, {
            progress: 100,
            error: reason
        });

        return true;
    }

    /**
     * Register an entry hook for a state
     * @param {string} state - State to hook
     * @param {function} callback - Function to call on state entry
     */
    onEntry(state, callback) {
        if (!this.entryHooks.has(state)) {
            this.entryHooks.set(state, []);
        }
        this.entryHooks.get(state).push(callback);
    }

    /**
     * Register an exit hook for a state
     * @param {string} state - State to hook
     * @param {function} callback - Function to call on state exit
     */
    onExit(state, callback) {
        if (!this.exitHooks.has(state)) {
            this.exitHooks.set(state, []);
        }
        this.exitHooks.get(state).push(callback);
    }

    /**
     * Execute entry hooks for a state
     */
    executeEntryHook(state) {
        const hooks = this.entryHooks.get(state) || [];
        hooks.forEach(hook => {
            try {
                hook(this.context);
            } catch (err) {
                console.error(`[FSM] Entry hook error for ${state}:`, err);
            }
        });
    }

    /**
     * Execute exit hooks for a state
     */
    executeExitHook(state) {
        const hooks = this.exitHooks.get(state) || [];
        hooks.forEach(hook => {
            try {
                hook(this.context);
            } catch (err) {
                console.error(`[FSM] Exit hook error for ${state}:`, err);
            }
        });
    }

    /**
     * Record state in history
     */
    recordState(state) {
        this.stateHistory.push({
            state,
            timestamp: Date.now(),
            iteration: this.iterationCount
        });
    }

    /**
     * Get elapsed time since job started
     */
    getElapsedTime() {
        if (!this.context.startTime) return 0;
        return Date.now() - this.context.startTime;
    }

    /**
     * Create a snapshot of current FSM state
     */
    snapshot() {
        return {
            jobId: this.jobId,
            state: this.currentState,
            context: this.getContext(),
            history: this.getHistory(),
            iterationCount: this.iterationCount,
            isTerminal: this.isTerminal(),
            elapsedTime: this.getElapsedTime()
        };
    }
}

export default OrchestratorFSM;
