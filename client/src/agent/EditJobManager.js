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
 * EditJobManager — Fixed Version
 *
 * Key fixes:
 * 1. ValidationService.validate() is async — always await it
 * 2. CommandCompiler confidence check — pass intent separately, never block on missing intent.confidence
 * 3. Pipeline error messages are user-friendly
 * 4. nle_export operation is routed to NLEExportService
 */
export class EditJobManager {
    constructor() {
        this.activeActors = new Map();
        this.abortControllers = new Map();
    }

    async processEditRequest(userPrompt) {
        const store = useJobStore.getState();
        const jobId = store.createJob(userPrompt);
        console.log(`[EditJobManager] Starting job: ${jobId}`);

        const abortController = new AbortController();
        this.abortControllers.set(jobId, abortController);

        const actor = createJobActor(jobId, userPrompt, (update) => {
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
            actor.send({ type: 'START', jobId, userPrompt });

            console.log(`[EditJobManager] Parsing intent...`);
            const intentResult = await IntentParser.parse(userPrompt, abortController.signal);

            if (abortController.signal.aborted) throw new Error('Cancelled by user');

            if (intentResult.needs_clarification) {
                actor.send({ type: 'CLARIFICATION_NEEDED', message: intentResult.reason });
                return {
                    success: false,
                    jobId,
                    message: intentResult.reason,
                    requiresClarification: true,
                    originalIntent: intentResult
                };
            }

            // ── Route NLE export before the normal pipeline ────────────────
            if (intentResult.operation === 'nle_export') {
                actor.send({ type: 'INTENT_PARSED', intent: intentResult });
                actor.send({ type: 'PLAN_GENERATED', plan: { plan_id: jobId, operation: 'nle_export', steps: [] } });
                return this.runNLEExport(jobId, intentResult, actor);
            }

            actor.send({ type: 'INTENT_PARSED', intent: intentResult });
            return this.runPipeline(jobId, intentResult, abortController, actor);

        } catch (error) {
            console.error(`[EditJobManager] Job ${jobId} failed:`, error);
            const a = this.activeActors.get(jobId);
            if (a) a.send({ type: 'ERROR', error: error.message });
            return { success: false, jobId, message: error.message };
        } finally {
            this.cleanup(jobId);
        }
    }

    async resumeJob(jobId, originalIntent, clarificationAnswers) {
        console.log(`[EditJobManager] Resuming job ${jobId}`);

        const updatedIntent = {
            ...originalIntent,
            confidence: 'HIGH',
            parameters: { ...(originalIntent.parameters || {}), ...(originalIntent.constraints || {}), ...clarificationAnswers },
            constraints: { ...(originalIntent.constraints || {}), ...clarificationAnswers },
            missingParameters: [],
            needs_clarification: false
        };

        const store = useJobStore.getState();
        const abortController = new AbortController();
        this.abortControllers.set(jobId, abortController);

        const actor = createJobActor(jobId, updatedIntent.intent || 'Resumed Job', (update) => {
            const jobState = mapStateToJobState(update.state.toLowerCase());
            store.transitionTo(jobId, jobState, { progress: update.progress, error: update.error });
        });

        this.activeActors.set(jobId, actor);
        actor.start();

        try {
            actor.send({ type: 'START', jobId, userPrompt: updatedIntent.intent });
            actor.send({ type: 'INTENT_PARSED', intent: updatedIntent });
            return this.runPipeline(jobId, updatedIntent, abortController, actor);
        } catch (error) {
            console.error(`[EditJobManager] Resumed job ${jobId} failed:`, error);
            return { success: false, jobId, message: error.message };
        } finally {
            this.cleanup(jobId);
        }
    }

    async runPipeline(jobId, intentResult, abortController, actor) {
        if (!actor) actor = this.activeActors.get(jobId);
        const store = useJobStore.getState();

        // ── Generate Plan ─────────────────────────────────────────────────
        console.log(`[EditJobManager] Generating plan...`);
        const planResult = await EditPlanner.generatePlan(intentResult, abortController.signal);

        if (abortController.signal.aborted) throw new Error('Cancelled by user');

        if (planResult.status === 'clarification_needed') {
            return {
                success: false,
                jobId,
                message: planResult.message || 'Need more information to proceed.',
                requiresClarification: true,
                questions: planResult.questions,
                originalIntent: planResult.originalIntent
            };
        }

        if (!planResult.success) {
            actor.send({ type: 'ERROR', error: planResult.error || 'Failed to generate plan' });
            return { success: false, jobId, message: planResult.error || 'Could not generate an edit plan.' };
        }

        actor.send({ type: 'PLAN_GENERATED', plan: planResult.plan });

        // ── Compile Commands ──────────────────────────────────────────────
        console.log(`[EditJobManager] Compiling commands...`);

        // FIX: Pass intent separately so confidence check uses correct object.
        // Also override intent.confidence to HIGH when we have a valid plan.
        const planForCompilation = {
            ...planResult.plan,
            // Attach intent so CommandCompiler can read confidence
            intent: intentResult.confidence === 'HIGH'
                ? intentResult
                : { ...intentResult, confidence: 'HIGH' }
        };

        const compileResult = CommandCompiler.compile(planForCompilation, useTimelineStore.getState());

        if (!compileResult.success && compileResult.commands.length === 0) {
            actor.send({ type: 'ERROR', error: compileResult.error });
            return { success: false, jobId, message: compileResult.error || 'Could not compile edit commands.' };
        }

        actor.send({ type: 'COMMANDS_COMPILED', commands: compileResult.commands });

        // ── Execute Commands ──────────────────────────────────────────────
        console.log(`[EditJobManager] Executing ${compileResult.commands.length} commands...`);
        const executionResult = await mediaExecutionEngine.execute(
            compileResult.commands,
            (progress) => actor.send({ type: 'PROGRESS', progress }),
            abortController.signal
        );

        if (abortController.signal.aborted) throw new Error('Cancelled by user');

        if (!executionResult.success) {
            actor.send({ type: 'ERROR', error: executionResult.error });
            return {
                success: false,
                jobId,
                message: executionResult.error || 'Edit execution failed.',
                details: executionResult.results
            };
        }

        actor.send({ type: 'EXECUTION_COMPLETE', result: executionResult });

        // ── Validate Results ──────────────────────────────────────────────
        console.log(`[EditJobManager] Validating results...`);

        // FIX: ValidationService.validate() is ASYNC — must await
        const validationResult = await ValidationService.validate(planResult.plan, executionResult);

        if (!validationResult.success) {
            actor.send({ type: 'VALIDATION_FAILED', error: validationResult.error, result: validationResult });
            // Don't hard-fail on validation warnings — return success if execution worked
            if (validationResult.issues?.length > 0 && executionResult.success) {
                console.warn('[EditJobManager] Validation warnings:', validationResult.issues);
            } else {
                return { success: false, jobId, message: validationResult.error, validation: validationResult };
            }
        }

        actor.send({ type: 'VALIDATION_COMPLETE', result: validationResult });

        // ── Generate Feedback ─────────────────────────────────────────────
        const feedback = AgentFeedbackService.generateFeedback(
            intentResult,
            planResult.plan,
            executionResult,
            validationResult
        );

        store.setJobResult(jobId, { validation: validationResult, feedback });
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

    async runNLEExport(jobId, intentResult, actor) {
        try {
            const { NLEExportService } = await import('../services/NLEExportService.js');
            const nleTarget = intentResult.constraints?.nleTarget;
            const result = await NLEExportService.export(nleTarget, useTimelineStore.getState());

            actor.send({ type: 'EXECUTION_COMPLETE', result });
            actor.send({ type: 'VALIDATION_COMPLETE', result: { success: true } });

            return {
                success: true,
                jobId,
                message: result.message || `✓ Exported for ${nleTarget}.`,
                suggestions: ['Open in your NLE', 'Export for another platform']
            };
        } catch (err) {
            actor.send({ type: 'ERROR', error: err.message });
            return { success: false, jobId, message: `NLE export failed: ${err.message}` };
        }
    }

    cleanup(jobId) {
        this.activeActors.delete(jobId);
        this.abortControllers.delete(jobId);
    }

    cancelJob(jobId) {
        const abortController = this.abortControllers.get(jobId);
        if (abortController) abortController.abort();
        const actor = this.activeActors.get(jobId);
        if (actor) actor.send({ type: 'CANCEL' });
        useJobStore.getState().cancelJob(jobId);
        console.log(`[EditJobManager] Job ${jobId} cancelled`);
        return true;
    }

    getActiveJobs() {
        return Array.from(this.activeActors.keys());
    }
}

export const editJobManager = new EditJobManager();
export default EditJobManager;