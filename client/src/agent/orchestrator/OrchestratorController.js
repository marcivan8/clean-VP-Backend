/**
 * OrchestratorController
 * Main controller for edit request lifecycle management.
 * 
 * Responsibilities:
 * - Receive user prompts and create jobs
 * - Delegate to specialized agents in strict order
 * - Enforce timeouts per phase
 * - Handle retries with exponential backoff
 * - Support cancellation
 * - Rollback on failure (via VersionManager)
 * 
 * NEVER executes media operations directly.
 * NEVER generates FFmpeg commands.
 */

import { OrchestratorFSM } from './OrchestratorFSM.js';
import { orchestratorEvents, EVENT_TYPES } from './OrchestratorEvents.js';
import {
    STATES,
    EVENTS,
    PLANNING_TIMEOUT_MS,
    EXECUTING_TIMEOUT_MS,
    VALIDATING_TIMEOUT_MS,
    GLOBAL_TIMEOUT_MS,
    MAX_RETRIES,
    RETRY_BACKOFF_BASE_MS,
    RETRY_BACKOFF_MULTIPLIER
} from './OrchestratorConfig.js';

// Import specialized agents
import { IntentParser } from '../IntentParser.js';
import { EditPlanner } from '../EditPlanner.js';
import { CommandCompiler } from '../CommandCompiler.js';
import { MediaExecutionEngine, mediaExecutionEngine } from '../MediaExecutionEngine.js';
import { ValidationService } from '../ValidationService.js';
import { VersionManager } from '../VersionManager.js';
import useTimelineStore from '../../store/useTimelineStore.js';

// Import global EventBus for decoupled communication
import { EventBus, EVENT_TYPES as GLOBAL_EVENTS } from '../EventBus.js';

/**
 * Generate unique job ID
 */
function generateJobId() {
    return `orch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export class OrchestratorController {
    constructor() {
        // Active FSM instances
        this.activeFSMs = new Map();

        // Abort controllers for cancellation
        this.abortControllers = new Map();

        // Timeout handles for cleanup
        this.timeoutHandles = new Map();

        // Retry counters
        this.retryCounts = new Map();
    }

    /**
     * Process a user edit request
     * @param {string} userPrompt - Natural language edit request
     * @returns {Promise<object>} Result with jobId, success, and details
     */
    async processRequest(userPrompt) {
        if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
            return {
                success: false,
                error: 'Invalid prompt: must be a non-empty string'
            };
        }

        const jobId = generateJobId();
        console.log(`[AG_DEBUG] [Orchestrator] Starting job: ${jobId}, Prompt: "${userPrompt.trim()}"`);

        // Create FSM
        const fsm = new OrchestratorFSM(jobId, {
            userPrompt: userPrompt.trim(),
            startTime: Date.now()
        });
        this.activeFSMs.set(jobId, fsm);

        // Create abort controller
        const abortController = new AbortController();
        this.abortControllers.set(jobId, abortController);

        // Initialize retry counter
        this.retryCounts.set(jobId, 0);

        // Create version checkpoint for rollback
        VersionManager.checkpoint?.();

        // Set global timeout
        const globalTimeout = setTimeout(() => {
            this.handleTimeout(jobId, 'global');
        }, GLOBAL_TIMEOUT_MS);
        this.timeoutHandles.set(`${jobId}_global`, globalTimeout);

        try {
            // Execute the pipeline
            console.log(`[AG_DEBUG] [Orchestrator] Executing pipeline for job: ${jobId}`);
            const result = await this.executePipeline(jobId, fsm, abortController.signal);
            console.log(`[AG_DEBUG] [Orchestrator] Pipeline finished. Success: ${result.success}`);
            return result;

        } catch (error) {
            console.error(`[AG_DEBUG] [Orchestrator] Job ${jobId} failed:`, error);

            if (!fsm.isTerminal()) {
                fsm.forceError(error.message);
            }

            // Emit global failure event for error recovery
            EventBus.emit(GLOBAL_EVENTS.JOB_FAILED, {
                jobId,
                error: error.message,
                phase: fsm.getContext().phase || 'unknown'
            });

            return {
                success: false,
                jobId,
                error: error.message,
                state: fsm.getState()
            };

        } finally {
            // Cleanup
            this.cleanup(jobId);
        }
    }

    /**
     * Execute the full pipeline
     */
    async executePipeline(jobId, fsm, signal) {
        // Emit global event for job started
        EventBus.emit(GLOBAL_EVENTS.JOB_STARTED, {
            jobId,
            userPrompt: fsm.getContext().userPrompt
        });

        // === PHASE 1: PLANNING ===
        fsm.send(EVENTS.START, { phase: 'planning' });
        orchestratorEvents.emitProgress(jobId, 10, 'Parsing intent...');
        EventBus.emit(GLOBAL_EVENTS.PHASE_PLANNING, { jobId });

        const planningResult = await this.executePlanningPhase(jobId, fsm, signal);


        // Handle Clarification
        if (planningResult.status === 'clarification_needed') {
            fsm.send(EVENTS.CLARIFICATION_NEEDED, {
                questions: planningResult.questions
            });
            return {
                success: false,
                jobId,
                status: 'clarification_needed',
                state: fsm.getState(),
                questions: planningResult.questions
            };
        }

        if (!planningResult.success) {
            fsm.send(EVENTS.PLAN_FAILED, { error: planningResult.error });
            return {
                success: false,
                jobId,
                error: planningResult.error,
                state: STATES.ERROR,
                requiresClarification: planningResult.requiresClarification
            };
        }

        fsm.send(EVENTS.PLAN_READY, {
            intent: planningResult.intent,
            plan: planningResult.plan
        });

        // === PHASE 2: EXECUTING ===
        orchestratorEvents.emitProgress(jobId, 40, 'Executing commands...');
        EventBus.emit(GLOBAL_EVENTS.PHASE_EXECUTING, { jobId });

        const executionResult = await this.executeExecutionPhase(jobId, fsm, signal, planningResult);

        if (!executionResult.success) {
            // Attempt rollback
            this.attemptRollback(jobId);

            fsm.send(EVENTS.EXECUTION_FAILED, { error: executionResult.error });
            return {
                success: false,
                jobId,
                error: executionResult.error,
                state: STATES.ERROR
            };
        }

        fsm.send(EVENTS.EXECUTION_COMPLETE, {
            executionResult: executionResult.result
        });

        // === PHASE 3: VALIDATING ===
        orchestratorEvents.emitProgress(jobId, 85, 'Validating results...');
        EventBus.emit(GLOBAL_EVENTS.PHASE_VALIDATING, { jobId });

        const validationResult = await this.executeValidationPhase(jobId, fsm, planningResult.plan, executionResult.result);

        if (!validationResult.success) {
            fsm.send(EVENTS.VALIDATION_FAILED, { error: validationResult.error });
            return {
                success: false,
                jobId,
                error: validationResult.error,
                state: STATES.ERROR,
                validation: validationResult
            };
        }

        fsm.send(EVENTS.VALIDATION_PASSED, {
            validationResult
        });

        // === COMPLETE ===
        orchestratorEvents.emitProgress(jobId, 100, 'Complete');
        orchestratorEvents.emitComplete(jobId, {
            plan: planningResult.plan,
            result: executionResult.result,
            validation: validationResult
        });

        // Emit global completion event
        EventBus.emit(GLOBAL_EVENTS.JOB_COMPLETED, {
            jobId,
            plan: planningResult.plan,
            result: executionResult.result
        });

        return {
            success: true,
            jobId,
            state: STATES.DONE,
            intent: planningResult.intent,
            plan: planningResult.plan,
            result: executionResult.result,
            validation: validationResult
        };
    }

    /**
     * Execute Planning Phase (Intent Parsing + Plan Generation)
     */
    async executePlanningPhase(jobId, fsm, signal) {
        return this.withTimeout(
            async () => {
                // Step 1: Parse Intent
                orchestratorEvents.emitAgentStart(jobId, 'IntentParser', { prompt: fsm.context.userPrompt });
                console.log(`[AG_DEBUG] [Orchestrator] Sending prompt to IntentParser: "${fsm.context.userPrompt}"`);

                const intentResult = await IntentParser.parse(fsm.context.userPrompt, signal);
                console.log(`[AG_DEBUG] [Orchestrator] IntentParser result:`, intentResult);

                orchestratorEvents.emitAgentComplete(jobId, 'IntentParser', intentResult);

                if (this.checkAborted(signal)) {
                    throw new Error('Cancelled');
                }

                // Check for clarification needed
                if (intentResult.intent === 'clarification_required') {
                    console.log(`[AG_DEBUG] [Orchestrator] Clarification required: ${intentResult.message}`);
                    return {
                        success: false,
                        error: intentResult.message,
                        requiresClarification: true
                    };
                }

                orchestratorEvents.emitProgress(jobId, 20, 'Generating plan...');

                // Step 2: Generate Plan
                orchestratorEvents.emitAgentStart(jobId, 'EditPlanner', { intent: intentResult });
                console.log(`[AG_DEBUG] [Orchestrator] Sending intent to EditPlanner`);

                const planResult = await EditPlanner.generatePlan(intentResult, signal);
                console.log(`[AG_DEBUG] [Orchestrator] EditPlanner result success: ${planResult.success}`);

                orchestratorEvents.emitAgentComplete(jobId, 'EditPlanner', planResult);

                if (this.checkAborted(signal)) {
                    throw new Error('Cancelled');
                }

                // Handle Clarification Request from Planner
                if (planResult.status === 'clarification_needed') {
                    console.log(`[AG_DEBUG] [Orchestrator] EditPlanner requested clarification:`, planResult.questions);

                    orchestratorEvents.emit(EVENT_TYPES.CLARIFICATION_NEEDED, {
                        jobId,
                        questions: planResult.questions,
                        originalIntent: planResult.originalIntent
                    });

                    return {
                        success: true, // It's not a failure, it's a pause
                        status: 'clarification_needed',
                        questions: planResult.questions,
                        originalIntent: planResult.originalIntent
                    };
                }

                if (!planResult.success) {
                    console.error(`[AG_DEBUG] [Orchestrator] Planning failed: ${planResult.error}`);
                    return {
                        success: false,
                        error: planResult.error || 'Failed to generate plan'
                    };
                }

                return {
                    success: true,
                    intent: intentResult,
                    plan: planResult.plan
                };
            },
            PLANNING_TIMEOUT_MS,
            jobId,
            'planning'
        );
    }

    /**
     * Execute Execution Phase (Compile + Execute Commands)
     */
    async executeExecutionPhase(jobId, fsm, signal, planningResult) {
        return this.withTimeout(
            async () => {
                // Step 1: Compile Commands
                orchestratorEvents.emitAgentStart(jobId, 'CommandCompiler', { plan: planningResult.plan });
                console.log(`[AG_DEBUG] [Orchestrator] Compiling commands...`);

                const compileResult = CommandCompiler.compile(planningResult.plan, useTimelineStore.getState());
                console.log(`[AG_DEBUG] [Orchestrator] Compilation result success: ${compileResult.success}, commands: ${compileResult.commands?.length}`);

                orchestratorEvents.emitAgentComplete(jobId, 'CommandCompiler', compileResult);

                if (!compileResult.success) {
                    console.error(`[AG_DEBUG] [Orchestrator] Compilation failed: ${compileResult.error}`);
                    return {
                        success: false,
                        error: compileResult.error || 'Failed to compile commands'
                    };
                }

                orchestratorEvents.emitProgress(jobId, 50, 'Executing...');

                // Step 2: Execute Commands
                orchestratorEvents.emitAgentStart(jobId, 'MediaExecutionEngine', { commands: compileResult.commands });
                console.log(`[AG_DEBUG] [Orchestrator] Executing media commands`);

                const executionResult = await mediaExecutionEngine.execute(
                    compileResult.commands,
                    (progress) => {
                        // Map execution progress to 50-80% range
                        const mappedProgress = 50 + Math.floor(progress * 0.3);
                        orchestratorEvents.emitProgress(jobId, mappedProgress, 'Executing...');
                    },
                    signal
                );
                console.log(`[AG_DEBUG] [Orchestrator] Execution finished. Success: ${executionResult.success}`);

                orchestratorEvents.emitAgentComplete(jobId, 'MediaExecutionEngine', executionResult);

                if (this.checkAborted(signal)) {
                    throw new Error('Cancelled');
                }

                if (!executionResult.success) {
                    console.error(`[AG_DEBUG] [Orchestrator] Execution failed: ${executionResult.error}`);
                    return {
                        success: false,
                        error: executionResult.error || 'Execution failed'
                    };
                }

                return {
                    success: true,
                    result: executionResult
                };
            },
            EXECUTING_TIMEOUT_MS,
            jobId,
            'executing'
        );
    }

    /**
     * Execute Validation Phase
     */
    async executeValidationPhase(jobId, fsm, plan, executionResult) {
        return this.withTimeout(
            async () => {
                orchestratorEvents.emitAgentStart(jobId, 'ValidationService', { plan, result: executionResult });
                console.log(`[AG_DEBUG] [Orchestrator] Validating execution results...`);

                const validationResult = ValidationService.validate(plan, executionResult);
                console.log(`[AG_DEBUG] [Orchestrator] Validation result: success=${validationResult.success}`);

                orchestratorEvents.emitAgentComplete(jobId, 'ValidationService', validationResult);

                return validationResult;
            },
            VALIDATING_TIMEOUT_MS,
            jobId,
            'validating'
        );
    }

    /**
     * Wrap an async operation with timeout
     */
    async withTimeout(operation, timeoutMs, jobId, phase) {
        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                this.handleTimeout(jobId, phase);
                reject(new Error(`${phase} phase timed out after ${timeoutMs / 1000}s`));
            }, timeoutMs);

            this.timeoutHandles.set(`${jobId}_${phase}`, timeoutHandle);

            operation()
                .then(result => {
                    clearTimeout(timeoutHandle);
                    this.timeoutHandles.delete(`${jobId}_${phase}`);
                    resolve(result);
                })
                .catch(err => {
                    clearTimeout(timeoutHandle);
                    this.timeoutHandles.delete(`${jobId}_${phase}`);
                    reject(err);
                });
        });
    }

    /**
     * Handle timeout event
     */
    handleTimeout(jobId, phase) {
        console.warn(`[AG_DEBUG] [Orchestrator] Timeout in ${phase} phase for job ${jobId}`);

        const fsm = this.activeFSMs.get(jobId);
        if (fsm && !fsm.isTerminal()) {
            fsm.send(EVENTS.TIMEOUT, { phase });
            orchestratorEvents.emitTimeout(jobId, phase, fsm.getElapsedTime());
        }

        // Abort any ongoing operations
        const abortController = this.abortControllers.get(jobId);
        if (abortController) {
            abortController.abort();
        }
    }

    /**
     * Check if operation was aborted
     */
    checkAborted(signal) {
        return signal && signal.aborted;
    }

    /**
     * Cancel a job
     * @param {string} jobId - Job to cancel
     * @param {string} reason - Cancellation reason
     */
    cancel(jobId, reason = 'User cancelled') {
        console.log(`[Orchestrator] Cancelling job: ${jobId}`);

        const fsm = this.activeFSMs.get(jobId);
        if (!fsm) {
            console.warn(`[Orchestrator] Job not found: ${jobId}`);
            return false;
        }

        if (fsm.isTerminal()) {
            console.warn(`[Orchestrator] Cannot cancel - job already complete`);
            return false;
        }

        // Abort ongoing operations
        const abortController = this.abortControllers.get(jobId);
        if (abortController) {
            abortController.abort();
        }

        // Transition to cancelled
        fsm.cancel(reason);

        // Attempt rollback
        this.attemptRollback(jobId);

        return true;
    }

    /**
     * Attempt to rollback changes
     */
    attemptRollback(jobId) {
        console.log(`[Orchestrator] Attempting rollback for job: ${jobId}`);
        try {
            VersionManager.rollback?.();
            orchestratorEvents.emit('ORCHESTRATOR_ROLLBACK', { jobId, success: true });
        } catch (err) {
            console.error(`[Orchestrator] Rollback failed:`, err);
            orchestratorEvents.emit('ORCHESTRATOR_ROLLBACK', { jobId, success: false, error: err.message });
        }
    }

    /**
     * Retry a failed job
     * @param {string} jobId - Job to retry
     */
    async retry(jobId) {
        const fsm = this.activeFSMs.get(jobId);
        if (!fsm) {
            return { success: false, error: 'Job not found' };
        }

        const retryCount = this.retryCounts.get(jobId) || 0;
        if (retryCount >= MAX_RETRIES) {
            return { success: false, error: `Max retries (${MAX_RETRIES}) exceeded` };
        }

        // Calculate backoff delay
        const backoffMs = RETRY_BACKOFF_BASE_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, retryCount);
        console.log(`[Orchestrator] Retry ${retryCount + 1}/${MAX_RETRIES} after ${backoffMs}ms delay`);

        await this.delay(backoffMs);

        this.retryCounts.set(jobId, retryCount + 1);

        // Re-process with same prompt
        return this.processRequest(fsm.context.userPrompt);
    }

    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cleanup job resources
     */
    cleanup(jobId) {
        // Clear all timeouts for this job
        this.timeoutHandles.forEach((handle, key) => {
            if (key.startsWith(jobId)) {
                clearTimeout(handle);
            }
        });

        // Remove from maps
        this.activeFSMs.delete(jobId);
        this.abortControllers.delete(jobId);
        this.retryCounts.delete(jobId);

        // Clean up timeout handles
        [...this.timeoutHandles.keys()]
            .filter(k => k.startsWith(jobId))
            .forEach(k => this.timeoutHandles.delete(k));

        console.log(`[Orchestrator] Cleaned up job: ${jobId}`);
    }

    /**
     * Get job status
     */
    getJobStatus(jobId) {
        const fsm = this.activeFSMs.get(jobId);
        if (!fsm) {
            return null;
        }
        return fsm.snapshot();
    }

    /**
     * Get all active jobs
     */
    getActiveJobs() {
        return Array.from(this.activeFSMs.keys());
    }

    /**
     * Subscribe to orchestrator events
     * @param {string} eventType - Event type from EVENT_TYPES
     * @param {function} callback - Handler function
     * @returns {function} Unsubscribe function
     */
    on(eventType, callback) {
        return orchestratorEvents.on(eventType, callback);
    }

    /**
     * Subscribe to all events
     */
    onAll(callback) {
        return orchestratorEvents.on('*', callback);
    }
}

// Singleton instance
export const orchestratorController = new OrchestratorController();

export default OrchestratorController;
