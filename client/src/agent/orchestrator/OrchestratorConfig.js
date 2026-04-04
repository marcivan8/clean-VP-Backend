/**
 * OrchestratorConfig
 * Configuration constants for the Orchestrator agent.
 * All timeouts, retry limits, and guards configured here.
 */

// Phase Timeouts (milliseconds)
export const PLANNING_TIMEOUT_MS = 30000;     // 30s for intent parsing + plan generation
export const EXECUTING_TIMEOUT_MS = 60000;    // 60s for command execution
export const VALIDATING_TIMEOUT_MS = 10000;   // 10s for validation
export const GLOBAL_TIMEOUT_MS = 120000;      // 2min max for entire request

// Retry Configuration
export const MAX_RETRIES = 3;
export const RETRY_BACKOFF_BASE_MS = 1000;    // 1s base delay
export const RETRY_BACKOFF_MULTIPLIER = 2;    // Exponential backoff

// Loop Prevention
export const MAX_ITERATIONS = 10;             // Max state transitions before forced error

// Progress Weights (for UI progress bar)
export const PROGRESS_WEIGHTS = {
    IDLE: 0,
    PLANNING: 25,
    CLARIFYING: 25,
    WAITING_APPROVAL: 30,
    EXECUTING: 70,
    VALIDATING: 90,
    DONE: 100,
    ERROR: 100,
    TIMEOUT: 100,
    CANCELLED: 100
};

// State Definitions
export const STATES = {
    IDLE: 'IDLE',
    PLANNING: 'PLANNING',
    CLARIFYING: 'CLARIFYING',
    WAITING_APPROVAL: 'WAITING_APPROVAL',
    EXECUTING: 'EXECUTING',
    VALIDATING: 'VALIDATING',
    DONE: 'DONE',
    ERROR: 'ERROR',
    TIMEOUT: 'TIMEOUT',
    CANCELLED: 'CANCELLED'
};

// Terminal states (job complete, no further transitions)
export const TERMINAL_STATES = [
    STATES.DONE,
    STATES.ERROR,
    STATES.TIMEOUT,
    STATES.CANCELLED
];

// Events that trigger state transitions
export const EVENTS = {
    START: 'START',
    PLAN_READY: 'PLAN_READY',
    PLAN_FAILED: 'PLAN_FAILED',
    CLARIFICATION_NEEDED: 'CLARIFICATION_NEEDED',
    DECISION_PROVIDED: 'DECISION_PROVIDED',
    EXECUTION_COMPLETE: 'EXECUTION_COMPLETE',
    EXECUTION_FAILED: 'EXECUTION_FAILED',
    VALIDATION_PASSED: 'VALIDATION_PASSED',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    TIMEOUT: 'TIMEOUT',
    CANCEL: 'CANCEL',
    ERROR: 'ERROR',
    RETRY: 'RETRY'
};

export default {
    PLANNING_TIMEOUT_MS,
    EXECUTING_TIMEOUT_MS,
    VALIDATING_TIMEOUT_MS,
    GLOBAL_TIMEOUT_MS,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE_MS,
    RETRY_BACKOFF_MULTIPLIER,
    MAX_ITERATIONS,
    PROGRESS_WEIGHTS,
    STATES,
    TERMINAL_STATES,
    EVENTS
};
