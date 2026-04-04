import { createJobActor, mapStateToJobState, isTerminalState } from './JobStateMachine.js';
import { IntentParser } from './IntentParser.js';
import { EditPlanner } from './EditPlanner.js';
import { CommandCompiler } from './CommandCompiler.js';
import { mediaExecutionEngine } from './MediaExecutionEngine.js';
import { ValidationService } from './ValidationService.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { AgentFeedbackService } from './AgentFeedbackService.js';
import useJobStore from '../store/useJobStore.js';

/**
 * EditJobManager
 * Central coordinator for the entire edit pipeline.
 * 
 * Flow:
 * 1. User prompt → Create job → IDLE
 * 2. Parse intent → PLANNING
 * 3. Generate plan → EXECUTING
 * 4. Compile commands → Execute → VERIFYING
 * 5. Validate → DONE/FAILED
 * 6. Format feedback → Return to UI
 */
export class EditJobManager {
    constructor() {
        this.activeActors = new Map(); // jobId -> XState actor
        this.abortControllers = new Map(); // jobId -> AbortController
    }

    /**
     * Process a user edit request
     * @param {string} userPrompt - The user's edit request (e.g., "split the clip in 2")
     * @returns {Promise<object>} Result object with success, message, and details
     */
    async processEditRequest(userPrompt) {
        const store = useJobStore.getState();

        // 1. Create job
        const jobId = store.createJob(userPrompt);
        console.log(`[EditJobManager] Starting job: ${jobId}`);

        // Create abort controller for cancellation
        const abortController = new AbortController();
        this.abortControllers.set(jobId, abortController);

        // 2. Create state machine actor
        const actor = createJobActor(jobId, userPrompt, (update) => {
            // Sync XState state to Zustand store
            const jobState = mapStateToJobState(update.state.toLowerCase());
            store.transitionTo(jobId, jobState, {
                progress: update.progress,
                error: update.error
            });

            if (update.intent) store.setJobIntent(jobId, update.intent);
            if (update.plan) store.setJobPlan(jobId, update.plan);
        });

        this.activeActors.set(jobId, actor);
        actor.start();

        try {
            // 3. Start the pipeline
            actor.send({ type: 'START', jobId, userPrompt });

            // 4. Parse Intent
            console.log(`[EditJobManager] Parsing intent...`);
            const intentResult = await IntentParser.parse(userPrompt, abortController.signal);

            if (abortController.signal.aborted) {
                throw new Error('Cancelled by user');
            }

            if (intentResult.intent === 'clarification_required') {
                actor.send({ type: 'CLARIFICATION_NEEDED', message: intentResult.message });
                return {
                    success: false,
                    jobId,
                    message: intentResult.message,
                    requiresClarification: true,
                    originalIntent: intentResult
                };
            }

            actor.send({ type: 'INTENT_PARSED', intent: intentResult });

            // Hand off to pipeline
            return this.runPipeline(jobId, intentResult, abortController);

        } catch (error) {
            console.error(`[EditJobManager] Job ${jobId} failed:`, error);
            const actor = this.activeActors.get(jobId);
            if (actor) actor.send({ type: 'ERROR', error: error.message });

            return {
                success: false,
                jobId,
                message: error.message
            };

        } finally {
            // Only clean up if terminal (handled in runPipeline or here on error)
            // If clarification needed, we might want to keep it?
            // Actually, processEditRequest returns.
            // If we return requiresClarification, we should NOT clean up yet if we want to keep the actor?
            // But the actor is XState.
            // If we use resumeJob, we might re-create or retrieve.
            // For now, let's keep it simple: Clean up here, and resumeJob creates a NEW pipeline run or re-uses?
            // To keep context, we should probably keep the actor.
            // But the current architecture deletes it.
            // Let's rely on resumeJob re-initializing or just passing data.
            this.cleanup(jobId);
        }
    }

    /**
     * Resume a job with clarification
     */
    async resumeJob(jobId, originalIntent, clarificationAnswers) {
        console.log(`[EditJobManager] Resuming job ${jobId} with clarification`);

        // Merge clarification into intent
        // This is a naive merge. Actual logic depends on how IntentParser structures things.
        const updatedIntent = {
            ...originalIntent,
            confidence: 'HIGH', // Manually override since user clarified
            parameters: {
                ...originalIntent.parameters,
                ...clarificationAnswers
            },
            missingParameters: [] // Clear missing
            // We might need to map specific answers if they are complex
        };

        // Re-create actor/abortController if needed or assume new job flow?
        // Since processEditRequest cleaned up, we treat this almost like a new request 
        // but skipping intent parsing.

        // However, we need to register it in the system.
        // Let's re-use the setup logic but skip parsing.

        const store = useJobStore.getState();
        // Ensure job exists in store? It should from previous run.

        const abortController = new AbortController();
        this.abortControllers.set(jobId, abortController);

        const actor = createJobActor(jobId, updatedIntent.intent || 'Resumed Job', (update) => {
            const jobState = mapStateToJobState(update.state.toLowerCase());
            store.transitionTo(jobId, jobState, {
                progress: update.progress,
                error: update.error
            });
        });

        this.activeActors.set(jobId, actor);
        actor.start();

        try {
            actor.send({ type: 'START', jobId, userPrompt: updatedIntent.intent });
            actor.send({ type: 'INTENT_PARSED', intent: updatedIntent });

            return this.runPipeline(jobId, updatedIntent, abortController);

        } catch (error) {
            console.error(`[EditJobManager] Resumed job ${jobId} failed:`, error);
            return { success: false, jobId, message: error.message };
        } finally {
            this.cleanup(jobId);
        }
    }

    /**
     * Execute the pipeline from Planning -> Execution -> Validation
     */
    async runPipeline(jobId, intentResult, abortController) {
        const actor = this.activeActors.get(jobId);
        const store = useJobStore.getState();

        // 5. Generate Edit Plan
        console.log(`[EditJobManager] Generating plan...`);
        const planResult = await EditPlanner.generatePlan(intentResult, abortController.signal);

        if (abortController.signal.aborted) {
            throw new Error('Cancelled by user');
        }

        if (planResult.status === 'clarification_needed') {
            // This shouldn't happen in resumeJob (confidence HIGH), but possible if answer was vague
            return {
                success: false,
                jobId,
                message: 'Clarification needed',
                requiresClarification: true,
                questions: planResult.questions,
                originalIntent: planResult.originalIntent
            };
        }

        if (!planResult.success) {
            actor.send({ type: 'ERROR', error: planResult.error || 'Failed to generate plan' });
            return {
                success: false,
                jobId,
                message: planResult.error || 'Failed to generate plan'
            };
        }

        actor.send({ type: 'PLAN_GENERATED', plan: planResult.plan });

        // 6. Compile Commands
        console.log(`[EditJobManager] Compiling commands...`);
        const compileResult = CommandCompiler.compile(planResult.plan, useTimelineStore.getState());

        if (!compileResult.success) {
            actor.send({ type: 'ERROR', error: compileResult.error });
            return {
                success: false,
                jobId,
                message: compileResult.error
            };
        }

        actor.send({ type: 'COMMANDS_COMPILED', commands: compileResult.commands });

        // 7. Execute Commands
        console.log(`[EditJobManager] Executing commands...`);
        const executionResult = await mediaExecutionEngine.execute(
            compileResult.commands,
            (progress) => actor.send({ type: 'PROGRESS', progress }),
            abortController.signal
        );

        if (abortController.signal.aborted) {
            throw new Error('Cancelled by user');
        }

        if (!executionResult.success) {
            actor.send({ type: 'ERROR', error: executionResult.error });
            return {
                success: false,
                jobId,
                message: executionResult.error,
                details: executionResult.results
            };
        }

        actor.send({ type: 'EXECUTION_COMPLETE', result: executionResult });

        // 8. Validate Results
        console.log(`[EditJobManager] Validating results...`);
        const validationResult = ValidationService.validate(
            planResult.plan,
            executionResult
        );

        if (!validationResult.success) {
            actor.send({
                type: 'VALIDATION_FAILED',
                error: validationResult.error,
                result: validationResult
            });
            return {
                success: false,
                jobId,
                message: validationResult.error,
                validation: validationResult
            };
        }

        actor.send({ type: 'VALIDATION_COMPLETE', result: validationResult });

        // 9. Generate Feedback
        const feedback = AgentFeedbackService.generateFeedback(
            intentResult,
            planResult.plan,
            executionResult,
            validationResult
        );

        store.setJobResult(jobId, {
            validation: validationResult,
            feedback
        });

        console.log(`[EditJobManager] Job ${jobId} completed successfully`);

        return {
            success: true,
            jobId,
            message: feedback.message,
            suggestions: feedback.suggestions,
            details: executionResult.results,
            validation: validationResult
        };
    }

    cleanup(jobId) {
        this.activeActors.delete(jobId);
        this.abortControllers.delete(jobId);
    }

    /**
     * Cancel an active job
     */
    cancelJob(jobId) {
        const abortController = this.abortControllers.get(jobId);
        if (abortController) {
            abortController.abort();
        }

        const actor = this.activeActors.get(jobId);
        if (actor) {
            actor.send({ type: 'CANCEL' });
        }

        useJobStore.getState().cancelJob(jobId);

        console.log(`[EditJobManager] Job ${jobId} cancelled`);
        return true;
    }

    /**
     * Get active job IDs
     */
    getActiveJobs() {
        return Array.from(this.activeActors.keys());
    }
}

// Singleton instance
export const editJobManager = new EditJobManager();
export default EditJobManager;
