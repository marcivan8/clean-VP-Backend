import { createMachine, createActor, assign } from 'xstate';
import { JOB_STATES } from '../store/useJobStore.js';

/**
 * Job State Machine
 * XState-based state machine enforcing strict state transitions.
 * No state can be skipped. All jobs MUST reach a terminal state.
 * 
 * Flow:
 * IDLE → PLANNING ⇄ CLARIFYING
 *          ↓
 *        WAITING_APPROVAL → EXECUTING → VERIFYING → DONE
 *                                         ↘ FAILED
 *                                         ↘ TIMEOUT
 */

// Timeout configuration
const EXECUTION_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Create the job state machine definition
 */
export const jobStateMachine = createMachine({
    id: 'editJob',
    initial: 'idle',
    context: {
        jobId: null,
        userPrompt: '',
        intent: null,
        plan: null,
        commands: null,
        executionResult: null,
        validationResult: null,
        error: null,
        progress: 0,
        startTime: null,
        abortController: null
    },
    states: {
        idle: {
            entry: assign({ progress: 0 }),
            on: {
                START: {
                    target: 'planning',
                    actions: assign({
                        jobId: ({ event }) => event.jobId,
                        userPrompt: ({ event }) => event.userPrompt,
                        startTime: () => Date.now(),
                        error: null
                    })
                }
            }
        },

        planning: {
            entry: assign({ progress: 10 }),
            on: {
                INTENT_PARSED: {
                    actions: assign({
                        intent: ({ event }) => event.intent,
                        progress: 20
                    })
                },
                PLAN_GENERATED: {
                    target: 'executing',
                    actions: assign({
                        plan: ({ event }) => event.plan,
                        progress: 30
                    })
                },
                CLARIFICATION_NEEDED: {
                    target: 'clarifying',
                    actions: assign({
                        error: null, // Clear error, just need info
                        // Store the clarification request in context if needed
                    })
                },
                APPROVAL_NEEDED: {
                    target: 'waiting_approval',
                    actions: assign({
                        plan: ({ event }) => event.plan,
                        progress: 30
                    })
                },
                ERROR: {
                    target: 'failed',
                    actions: assign({
                        error: ({ event }) => event.error
                    })
                }
            }
        },

        clarifying: {
            entry: assign({ progress: 25 }),
            on: {
                PROVIDE_CLARIFICATION: {
                    target: 'planning',
                    actions: assign({
                        // Merge clarification into existing intent or prompt
                        // This logic might be handled by the caller before sending the event
                        progress: 15
                    })
                },
                CANCEL: {
                    target: 'failed',
                    actions: assign({
                        error: 'Clarification cancelled by user'
                    })
                }
            }
        },

        waiting_approval: {
            entry: assign({ progress: 35 }),
            on: {
                APPROVE: {
                    target: 'executing',
                    actions: assign({
                        progress: 40
                    })
                },
                REJECT: {
                    target: 'idle', // Reset to idle to allow fresh start? Or failed?
                    // Going to idle allows user to try a different prompt easily
                    actions: assign({
                        error: null,
                        plan: null,
                        intent: null,
                        progress: 0
                    })
                },
                CANCEL: {
                    target: 'failed',
                    actions: assign({
                        error: 'Approval cancelled by user'
                    })
                }
            }
        },

        executing: {
            entry: assign({
                progress: 40,
                abortController: () => new AbortController()
            }),
            on: {
                PROGRESS: {
                    actions: assign({
                        progress: ({ event }) => 40 + Math.floor(event.progress * 0.4) // 40-80%
                    })
                },
                COMMANDS_COMPILED: {
                    actions: assign({
                        commands: ({ event }) => event.commands,
                        progress: 50
                    })
                },
                EXECUTION_COMPLETE: {
                    target: 'verifying',
                    actions: assign({
                        executionResult: ({ event }) => event.result,
                        progress: 80
                    })
                },
                CANCEL: {
                    target: 'failed',
                    actions: assign({
                        error: 'Cancelled by user'
                    })
                },
                TIMEOUT: {
                    target: 'timeout',
                    actions: assign({
                        error: `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds`
                    })
                },
                ERROR: {
                    target: 'failed',
                    actions: assign({
                        error: ({ event }) => event.error
                    })
                }
            },
            after: {
                [EXECUTION_TIMEOUT_MS]: {
                    target: 'timeout',
                    actions: assign({
                        error: `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds`
                    })
                }
            }
        },

        verifying: {
            entry: assign({ progress: 85 }),
            on: {
                VALIDATION_COMPLETE: {
                    target: 'done',
                    actions: assign({
                        validationResult: ({ event }) => event.result,
                        progress: 100
                    })
                },
                VALIDATION_FAILED: {
                    target: 'failed',
                    actions: assign({
                        error: ({ event }) => event.error,
                        validationResult: ({ event }) => event.result
                    })
                },
                ERROR: {
                    target: 'failed',
                    actions: assign({
                        error: ({ event }) => event.error
                    })
                }
            }
        },

        // Terminal States
        done: {
            entry: assign({ progress: 100 }),
            type: 'final'
        },

        failed: {
            type: 'final'
        },

        timeout: {
            type: 'final'
        }
    }
});

/**
 * Create a new job actor for a specific job
 * @param {string} jobId - Unique job identifier
 * @param {string} userPrompt - The user's edit request
 * @param {function} onStateChange - Callback for state changes
 * @returns {Actor} XState actor instance
 */
export function createJobActor(jobId, userPrompt, onStateChange) {
    const actor = createActor(jobStateMachine, {
        input: { jobId, userPrompt }
    });

    // Subscribe to state changes
    actor.subscribe((snapshot) => {
        const stateValue = snapshot.value;
        const context = snapshot.context;

        console.log(`[JobStateMachine] ${jobId}: State=${stateValue}, Progress=${context.progress}%`);

        if (onStateChange) {
            onStateChange({
                jobId,
                state: stateValue.toUpperCase(),
                progress: context.progress,
                error: context.error,
                intent: context.intent,
                plan: context.plan,
                result: context.executionResult,
                validation: context.validationResult
            });
        }
    });

    return actor;
}

/**
 * Map XState state to JOB_STATES
 */
export function mapStateToJobState(xstateValue) {
    const mapping = {
        'idle': JOB_STATES.IDLE,
        'planning': JOB_STATES.PLANNING,
        'clarifying': JOB_STATES.CLARIFYING,
        'waiting_approval': JOB_STATES.WAITING_APPROVAL,
        'executing': JOB_STATES.EXECUTING,
        'verifying': JOB_STATES.VERIFYING,
        'done': JOB_STATES.DONE,
        'failed': JOB_STATES.FAILED,
        'timeout': JOB_STATES.TIMEOUT
    };
    return mapping[xstateValue] || JOB_STATES.IDLE;
}

/**
 * Check if a state is terminal (job complete)
 */
export function isTerminalState(state) {
    return ['done', 'failed', 'timeout', JOB_STATES.DONE, JOB_STATES.FAILED, JOB_STATES.TIMEOUT].includes(state);
}

export default jobStateMachine;
