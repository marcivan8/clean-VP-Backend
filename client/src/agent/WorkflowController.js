import { createMachine, createActor, fromPromise } from 'xstate';
import { editJobManager } from './EditJobManager.js';
import useAIStore from '../store/useAIStore.js';
import useJobStore, { JOB_STATES, TERMINAL_STATES } from '../store/useJobStore.js';
import { EventBus, EVENT_TYPES } from './EventBus.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { trackEvent } from '../utils/trackEvent.js';

// Per-operation editorial descriptions and next-step suggestions
const OPERATION_META = {
    auto_captions:     { description: 'Captions generated from your spoken audio — each word is timed to the frame.', suggestion: 'Style your captions', suggestionPrompt: null, suggestionTab: 'captions' },
    dynamic_rhythm:    { description: 'Dynamic zoom keyframes applied — cuts punch in sync with your speech energy.', suggestion: 'Add captions', suggestionPrompt: 'Add captions' },
    silence_removal:   { description: 'Dead air trimmed out. Your video now flows without the awkward pauses.', suggestion: 'Make it more dynamic', suggestionPrompt: 'Make it more dynamic' },
    music:             { description: 'Background music added and ducked under your voice automatically.', suggestion: 'Export for YouTube', suggestionPrompt: 'Export for YouTube' },
    virtual_multicam:  { description: 'Virtual camera angles generated — the edit punches in on the active speaker.', suggestion: 'Add captions', suggestionPrompt: 'Add captions' },
    split_speakers:    { description: 'Speakers diarized onto separate tracks — each voice lives on its own layer.', suggestion: 'Apply virtual multicam', suggestionPrompt: 'Apply virtual multicam' },
    compound_split_speakers_virtual_multicam: { description: 'Speakers separated and virtual multicam angles applied. Your edit now feels like a professional two-camera interview.', suggestion: 'Add captions', suggestionPrompt: 'Add captions' },
    trim:              { description: 'Timeline trimmed to your specified range.', suggestion: 'Export for YouTube', suggestionPrompt: 'Export for YouTube' },
    export:            { description: 'Render queued. Your video will be ready to download shortly.', suggestion: null },
    color_grade:       { description: 'Color grade applied across all clips.', suggestion: 'Export for YouTube', suggestionPrompt: 'Export for YouTube' },
    remove_filler:     { description: 'Filler words and hesitations removed. Your delivery sounds sharper.', suggestion: 'Make it more dynamic', suggestionPrompt: 'Make it more dynamic' },
};

function getOperationMeta(operation) {
    return OPERATION_META[operation] || {
        description: null,
        suggestion: 'Export for YouTube',
        suggestionPrompt: 'Export for YouTube',
    };
}

/**
 * WorkflowController V2
 * Rewired to use the new EditJobManager pipeline.
 * 
 * Flow:
 * 1. User sends prompt via processUserPrompt()
 * 2. EditJobManager handles the full pipeline (intent → plan → compile → execute → validate)
 * 3. Job state updates are reflected in UI via useJobStore
 * 4. Results are added to AI logs for display
 */

// Must exceed JobStateMachine's EXECUTION_TIMEOUT_MS (7 min) plus startup overhead.
// Silence + filler on a 12-min video takes ~5 min combined; 15 min gives ample margin.
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

const workflowMachine = createMachine({
    id: 'videoAgent',
    initial: 'idle',
    context: {
        userPrompt: '',
        currentJobId: null,
        lastResult: null,
        initialHistoryLen: 0
    },
    states: {
        idle: {
            entry: () => {
                useAIStore.getState().setIsAnalyzing(false);
            },
            on: {
                START: {
                    target: 'processing',
                    actions: ({ context, event }) => {
                        console.log('[Workflow] Starting new job:', event.prompt);
                        useAIStore.getState().setIsAnalyzing(true);
                        context.userPrompt = event.prompt;
                        context.initialHistoryLen = useTimelineStore.getState().past.length;
                    }
                }
            }
        },

        processing: {
            invoke: {
                src: fromPromise(async ({ input }) => {
                    const { userPrompt } = input;
                    console.log('[Workflow] Processing via EditJobManager...');

                    // Use the new pipeline
                    const result = await editJobManager.processEditRequest(userPrompt);

                    console.log('[Workflow] Job completed:', result);
                    return result;
                }),
                input: ({ context }) => ({ userPrompt: context.userPrompt }),
                onDone: [
                    {
                        target: 'clarifying',
                        guard: ({ event }) => event.output.requiresClarification,
                        actions: ({ context, event }) => {
                            console.log('[Workflow] Clarification required:', event.output.message);
                            context.lastResult = event.output;
                            context.currentJobId = event.output.jobId;

                            // Emit first so any dialog subscriber can mount before the log appears
                            EventBus.emit(EVENT_TYPES.CLARIFICATION_NEEDED, {
                                jobId: event.output.jobId,
                                message: event.output.message,
                                questions: event.output.questions,
                                originalIntent: event.output.originalIntent
                            });

                            // Single authoritative log entry — type 'assistant' so it renders
                            // as an agent bubble, not a generic info line. ClarificationDialog
                            // must NOT add its own addLog for CLARIFICATION_NEEDED events.
                            useAIStore.getState().addLog({
                                id: 'clarification-' + Date.now(),
                                type: 'assistant',
                                message: event.output.message || 'Could you clarify a bit more?',
                                timestamp: new Date().toLocaleTimeString(),
                            });

                            useAIStore.getState().setIsAnalyzing(false); // Stop spinner, wait for user
                        }
                    },
                    {
                        target: 'completed',
                        actions: ({ context, event }) => {
                            console.log('[Workflow] Job finished:', event.output);
                            context.lastResult = event.output;
                            context.currentJobId = event.output.jobId;

                            useAIStore.getState().setIsAnalyzing(false);

                            const result = event.output;

                            if (result.success) {
                                // Track every successful AI edit (not chat replies)
                                if (result.operation && result.operation !== 'chat') {
                                    trackEvent(`ai_edit:${result.operation}`);
                                }

                                if (result.operation === 'chat') {
                                    useAIStore.getState().addLog({
                                        id: 'chat-' + Date.now(),
                                        type: 'assistant',
                                        message: result.message || 'Sure thing!',
                                        timestamp: new Date().toLocaleTimeString()
                                    });
                                } else {
                                    const stepsApplied = useTimelineStore.getState().past.length - context.initialHistoryLen;
                                    const opMeta = getOperationMeta(result.operation);
                                    useAIStore.getState().addLog({
                                        id: 'task-complete-' + Date.now(),
                                        type: 'task_complete',
                                        message: result.message || 'Edit completed successfully',
                                        data: {
                                            operation: result.operation,
                                            jobId: result.jobId,
                                            details: result.details,
                                            validation: result.validation,
                                            stepsApplied,
                                            preTaskHistoryLen: context.initialHistoryLen,
                                            editDescription: opMeta.description,
                                            nextSuggestion: opMeta.suggestion,
                                            nextSuggestionPrompt: opMeta.suggestionPrompt,
                                            nextSuggestionTab: opMeta.suggestionTab,
                                        },
                                        timestamp: new Date().toLocaleTimeString()
                                    });

                                    // Show font style picker immediately after caption generation
                                    if (result.operation === 'auto_captions') {
                                        useAIStore.getState().addLog({
                                            id: 'caption-styles-' + Date.now(),
                                            type: 'caption_styles',
                                            timestamp: new Date().toLocaleTimeString(),
                                        });
                                    }

                                    // P5: seek to the first edit point so the user immediately
                                    // sees the result without having to manually press play.
                                    setTimeout(() => {
                                        const ts = useTimelineStore.getState();
                                        const firstClipStart = ts.tracks
                                            ?.flatMap(t => t.clips || [])
                                            .sort((a, b) => a.start - b.start)[0]?.start ?? 0;
                                        ts.seek(firstClipStart);
                                        ts.setIsPlaying(true);
                                        setTimeout(() => useTimelineStore.getState().setIsPlaying(false), 4000);
                                    }, 300);
                                }

                                // Add suggestion for next actions
                                if (result.suggestions && result.suggestions.length > 0) {
                                    useAIStore.getState().addSuggestion({
                                        id: 'next-actions-' + Date.now(),
                                        type: 'next_actions',
                                        title: 'What would you like to do next?',
                                        description: result.suggestions.join(' • '),
                                        data: { suggestions: result.suggestions }
                                    });
                                }
                            } else {
                                useAIStore.getState().addLog({
                                    id: 'job-error-' + Date.now(),
                                    type: 'warning',
                                    message: result.message || 'Edit failed',
                                    timestamp: new Date().toLocaleTimeString()
                                });
                            }
                        }
                    }
                ],
                onError: {
                    target: 'idle',
                    actions: ({ context, event }) => {
                        console.error('[Workflow] Job failed:', event);
                        useAIStore.getState().setIsAnalyzing(false);

                        const errorMsg = event.error?.message || 'Unknown error occurred';

                        useAIStore.getState().addLog({
                            id: 'job-crash-' + Date.now(),
                            type: 'warning',
                            message: `Error: ${errorMsg}`,
                            timestamp: new Date().toLocaleTimeString()
                        });
                    }
                }
            },
            after: {
                [PROCESSING_TIMEOUT_MS]: {
                    target: 'idle',
                    actions: () => {
                        console.error('[Workflow] Processing timed out after 15 minutes');
                        useAIStore.getState().setIsAnalyzing(false);
                        useAIStore.getState().addLog({
                            id: 'timeout-' + Date.now(),
                            type: 'warning',
                            message: '⏱ The operation took too long and was stopped. ' +
                                     'This can happen with very long videos. Please try again, ' +
                                     'or try a more specific request.',
                            timestamp: new Date().toLocaleTimeString()
                        });
                    }
                }
            }
        },

        clarifying: {
            on: {
                RESUME: {
                    target: 'resuming',
                    actions: ({ context, event }) => {
                        console.log('[Workflow] Resuming with answers:', event.answers);
                        useAIStore.getState().setIsAnalyzing(true);
                        context.initialHistoryLen = useTimelineStore.getState().past.length;
                    }
                },
                // If the user sends a NEW prompt while we are waiting for clarification,
                // treat it as "abandon this clarification and start fresh". Transition back
                // to idle so the next START event is accepted.
                CANCEL: {
                    target: 'idle',
                    actions: () => {
                        console.log('[Workflow] Clarification cancelled — returning to idle');
                        useAIStore.getState().setIsAnalyzing(false);
                    }
                }
            }
        },

        resuming: {
            invoke: {
                src: fromPromise(async ({ input }) => {
                    const { jobId, originalIntent, answers } = input;
                    return await editJobManager.resumeJob(jobId, originalIntent, answers);
                }),
                input: ({ context, event }) => ({
                    jobId: context.currentJobId,
                    originalIntent: context.lastResult.originalIntent,
                    answers: event.answers
                }),
                onDone: [
                    {
                        target: 'clarifying',
                        guard: ({ event }) => event.output.requiresClarification,
                        actions: ({ context, event }) => {
                            // Handle subsequent clarification loops if needed
                            // Same logic as before
                            context.lastResult = event.output;
                            useAIStore.getState().addLog({
                                id: 'clarification-' + Date.now(),
                                type: 'info',
                                message: event.output.message,
                                data: { questions: event.output.questions }
                            });
                            useAIStore.getState().setIsAnalyzing(false);
                        }
                    },
                    {
                        target: 'completed',
                        actions: ({ context, event }) => {
                            // Same success logic
                            context.lastResult = event.output;
                            useAIStore.getState().setIsAnalyzing(false);

                            if (event.output.success) {
                                const stepsApplied = useTimelineStore.getState().past.length - context.initialHistoryLen;
                                useAIStore.getState().addLog({
                                    id: 'task-complete-' + Date.now(),
                                    type: 'task_complete',
                                    message: event.output.message,
                                    data: {
                                        jobId: event.output.jobId,
                                        stepsApplied,
                                        preTaskHistoryLen: context.initialHistoryLen,
                                    }
                                });
                            } else {
                                useAIStore.getState().addLog({
                                    id: 'job-error-' + Date.now(),
                                    type: 'warning',
                                    message: event.output.message
                                });
                            }
                        }
                    }
                ],
                onError: {
                    target: 'idle',
                    actions: ({ context, event }) => {
                        useAIStore.getState().setIsAnalyzing(false);
                        useAIStore.getState().addLog({
                            id: 'resume-error-' + Date.now(),
                            type: 'warning',
                            message: `Error: ${event.error?.message}`
                        });
                    }
                }
            },
            after: {
                [PROCESSING_TIMEOUT_MS]: {
                    target: 'idle',
                    actions: () => {
                        useAIStore.getState().setIsAnalyzing(false);
                        useAIStore.getState().addLog({
                            id: 'timeout-' + Date.now(),
                            type: 'warning',
                            message: '⏱ Operation timed out. Please try again.',
                            timestamp: new Date().toLocaleTimeString()
                        });
                    }
                }
            }
        },

        completed: {
            // Auto-transition back to idle after completion
            always: 'idle'
        }
    }
});

export class WorkflowController {
    constructor() {
        this.actor = createActor(workflowMachine);
        this.actor.start();

        // Subscribe to state changes for logging
        this.actor.subscribe(state => {
            const stateValue = typeof state.value === 'string'
                ? state.value
                : JSON.stringify(state.value);
            console.log(`[Workflow] State: ${stateValue}`);
        });

        // Also subscribe to job store for real-time updates
        useJobStore.subscribe((state) => {
            const activeJob = state.getActiveJob();
            if (activeJob) {
                console.log(`[Workflow] Job ${activeJob.id}: ${activeJob.state} (${activeJob.progress}%)`);
            }
        });
    }

    /**
     * Process a user prompt through the full pipeline
     * @param {string} prompt - User's edit request
     */
    processUserPrompt(prompt) {
        if (!prompt || prompt.trim() === '') {
            console.warn('[Workflow] Empty prompt ignored');
            return;
        }

        const currentState = this.getState();

        // If waiting for clarification, treat this as "user abandoned it and wants
        // a fresh start". Cancel the stale job and transition the machine back to idle
        // so it can accept the new START event.
        if (currentState === 'clarifying') {
            console.warn('[Workflow] processUserPrompt called while clarifying — cancelling stale job');
            this.cancelCurrentJob();
            this.actor.send({ type: 'CANCEL' }); // transition clarifying → idle
        }

        // Prevent double-tap / double-call duplicates while already running.
        if (currentState === 'processing' || currentState === 'resuming') {
            console.warn('[Workflow] Already processing — ignoring duplicate processUserPrompt call');
            return;
        }

        this.actor.send({ type: 'START', prompt: prompt.trim() });
    }

    /**
     * Submit clarification answers to resume a suspended job
     * @param {object} answers - Map of parameter keys to values
     */
    submitClarification(answers) {
        if (this.getState() !== 'clarifying') {
            console.warn('[Workflow] Not in clarifying state, ignoring answers');
            return;
        }
        this.actor.send({ type: 'RESUME', answers });
    }

    /**
     * Cancel the current job
     */
    cancelCurrentJob() {
        const activeJob = useJobStore.getState().getActiveJob();
        if (activeJob && !TERMINAL_STATES.includes(activeJob.state)) {
            editJobManager.cancelJob(activeJob.id);
        }
    }

    /**
     * Get current workflow state
     */
    getState() {
        return this.actor.getSnapshot().value;
    }

    /**
     * Check if currently processing
     */
    isProcessing() {
        const state = this.getState();
        return state === 'processing' || state === 'resuming';
    }

    // Legacy methods for backward compatibility
    approvePlan() {
        console.warn('[Workflow] approvePlan() is deprecated in V2 pipeline - edits execute automatically');
    }

    rejectPlan() {
        this.cancelCurrentJob();
    }
}

// Singleton instance
export const workflowController = new WorkflowController();
export default WorkflowController;
