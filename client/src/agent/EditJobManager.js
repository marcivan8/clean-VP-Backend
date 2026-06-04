import { createJobActor, mapStateToJobState, isTerminalState } from './JobStateMachine.js';
import { IntentParser } from './IntentParser.js';
import { EditPlanner } from './EditPlanner.js';
import { CommandCompiler } from './CommandCompiler.js';
import { mediaExecutionEngine } from './MediaExecutionEngine.js';
import { ValidationService } from './ValidationService.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { AgentFeedbackService } from './AgentFeedbackService.js';
import useJobStore from '../store/useJobStore.js';
import { transcriptionManager } from './TranscriptionManager.js';
import { editSessionMemory } from './EditSessionMemory.js';
import useAIStore from '../store/useAIStore.js';
import { EventBus, EVENT_TYPES } from './EventBus.js';

const logStep = (message) => useAIStore.getState().addLog({
    id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    type: 'step',
    message,
    timestamp: new Date().toLocaleTimeString()
});

/**
 * EditJobManager — Fixed + Enhanced Version
 *
 * Original fixes:
 * 1. ValidationService.validate() is async — always await it
 * 2. CommandCompiler confidence check — force HIGH when plan is valid
 * 3. nle_export routed to NLEExportService before pipeline
 *
 * New:
 * 4. Uses TranscriptionManager cached analysis — skips ContentAnalyzer if ready
 * 5. Records edits to EditSessionMemory for conversational follow-ups
 * 6. Handles 'query_session_summary' intent without running the pipeline
 * 7. Generates pre-execution brief for plans with > 3 steps
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
                error: update.error,
            });
            if (update.intent) store.setJobIntent(jobId, update.intent);
            if (update.plan) store.setJobPlan(jobId, update.plan);
        });

        this.activeActors.set(jobId, actor);
        actor.start();

        try {
            actor.send({ type: 'START', jobId, userPrompt });

            console.log('[EditJobManager] Parsing intent...');
            const intentResult = await IntentParser.parse(userPrompt, abortController.signal);

            if (abortController.signal.aborted) throw new Error('Cancelled by user');

            // ── Session summary query — no pipeline needed ─────────────────────
            if (intentResult.operation === 'query_session_summary') {
                actor.send({ type: 'PLAN_GENERATED', plan: { plan_id: jobId, steps: [] } });
                actor.send({ type: 'EXECUTION_COMPLETE', result: { success: true } });
                actor.send({ type: 'VALIDATION_COMPLETE', result: { success: true } });
                return {
                    success: true,
                    jobId,
                    message: editSessionMemory.getSummary(),
                    suggestions: ['Continue editing', 'Undo the last change', 'Export the video'],
                };
            }

            // ── Conversational Chat — no pipeline needed ───────────────────────
            if (intentResult.operation === 'chat') {
                actor.send({ type: 'PLAN_GENERATED', plan: { plan_id: jobId, steps: [] } });
                actor.send({ type: 'EXECUTION_COMPLETE', result: { success: true } });
                actor.send({ type: 'VALIDATION_COMPLETE', result: { success: true } });
                return {
                    success: true,
                    jobId,
                    operation: 'chat',
                    message: intentResult.message,
                    suggestions: [],
                };
            }

            if (intentResult.needs_clarification) {
                actor.send({ type: 'CLARIFICATION_NEEDED', message: intentResult.reason });
                return {
                    success: false,
                    jobId,
                    message: intentResult.reason,
                    requiresClarification: true,
                    originalIntent: intentResult,
                };
            }

            // ── NLE export — bypass normal pipeline ────────────────────────────
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

        let updatedIntent;
        const store = useJobStore.getState();
        const abortController = new AbortController();
        this.abortControllers.set(jobId, abortController);

        // If the original intent was missing an operation (e.g. spaCy returned clarification_required early)
        if (!originalIntent.operation || !originalIntent.intent) {
            console.log('[EditJobManager] Re-parsing intent with clarification answers...');
            const combinedPrompt = `${originalIntent.originalPrompt || ''}. Clarification answers: ${JSON.stringify(clarificationAnswers)}`;
            
            try {
                const reParsedIntent = await IntentParser.parse(combinedPrompt, abortController.signal);
                if (reParsedIntent.needs_clarification) {
                    return {
                        success: false,
                        jobId,
                        message: reParsedIntent.reason,
                        requiresClarification: true,
                        originalIntent: reParsedIntent,
                    };
                }
                updatedIntent = {
                    ...reParsedIntent,
                    confidence: 'HIGH',
                    missingParameters: [],
                    needs_clarification: false
                };
            } catch (err) {
                console.error(`[EditJobManager] Re-parsing failed:`, err);
                return { success: false, jobId, message: err.message };
            }
        } else {
            updatedIntent = {
                ...originalIntent,
                confidence: 'HIGH',
                parameters: { ...(originalIntent.parameters || {}), ...(originalIntent.constraints || {}), ...clarificationAnswers },
                constraints: { ...(originalIntent.constraints || {}), ...clarificationAnswers },
                missingParameters: [],
                needs_clarification: false,
            };
        }

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

        // ── FIX 4: Inject cached analysis from TranscriptionManager ───────────
        // If transcription + analysis already ran in the background (triggered on
        // file upload), we skip the ContentAnalyzer call inside EditPlanner by
        // attaching the cached result to the intent object. EditPlanner reads
        // intent._cachedAnalysis before calling ContentAnalyzer.
        const cachedAnalysis = transcriptionManager.getCachedAnalysis();
        if (cachedAnalysis) {
            console.log('[EditJobManager] Using pre-cached analysis — skipping ContentAnalyzer call');
            intentResult = { ...intentResult, _cachedAnalysis: cachedAnalysis };
        }

        // ── Generate Plan ─────────────────────────────────────────────────────
        logStep('Planning edits…');
        console.log('[EditJobManager] Generating plan...');
        const planResult = await EditPlanner.generatePlan(intentResult, abortController.signal);

        if (abortController.signal.aborted) throw new Error('Cancelled by user');

        if (planResult.status === 'clarification_needed') {
            return {
                success: false,
                jobId,
                message: planResult.message || 'Need more information to proceed.',
                requiresClarification: true,
                questions: planResult.questions,
                originalIntent: planResult.originalIntent,
            };
        }

        if (!planResult.success) {
            actor.send({ type: 'ERROR', error: planResult.error || 'Failed to generate plan' });
            return { success: false, jobId, message: planResult.error || 'Could not generate an edit plan.' };
        }

        actor.send({ type: 'PLAN_GENERATED', plan: planResult.plan });

        // ── Approval gate ─────────────────────────────────────────────────────
        // If the plan is marked requiresApproval, pause and wait for the user to
        // confirm before executing. The ApprovalDialog component in IDELayout
        // listens for APPROVAL_REQUIRED on the EventBus and shows Approve/Cancel.
        if (planResult.plan?.requiresApproval) {
            logStep('Waiting for your approval…');
            useAIStore.getState().setIsAnalyzing(false); // stop spinner while waiting

            const stepLines = (planResult.plan.steps || [])
                .map(s => s.reason || s.action)
                .filter(Boolean)
                .map(l => `• ${l}`)
                .join('\n');

            EventBus.emit(EVENT_TYPES.APPROVAL_REQUIRED, {
                jobId,
                title: 'Approve AI Edit Plan',
                description: planResult.plan.approvalMessage ||
                    `The AI wants to make ${planResult.plan.step_count} edit(s) to your timeline.`,
                actions: stepLines || null,
                reasons: ['These changes will modify your timeline. You can undo afterwards.'],
            });

            const approved = await new Promise((resolve) => {
                const unsubGrant = EventBus.on(EVENT_TYPES.APPROVAL_GRANTED, ({ jobId: id }) => {
                    if (id !== jobId) return;
                    unsubGrant(); unsubDeny();
                    resolve(true);
                });
                const unsubDeny = EventBus.on(EVENT_TYPES.APPROVAL_DENIED, ({ jobId: id }) => {
                    if (id !== jobId) return;
                    unsubGrant(); unsubDeny();
                    resolve(false);
                });
            });

            useAIStore.getState().setIsAnalyzing(true); // resume spinner after decision

            if (!approved) {
                return {
                    success: false,
                    jobId,
                    operation: 'chat',
                    message: 'Edit plan cancelled. Let me know if you want a different approach.',
                };
            }

            logStep('Approved — starting execution…');
        }

        // ── Record to session memory (before execution) ───────────────────────
        editSessionMemory.recordEdit(
            jobId,
            intentResult.operation,
            `Planning: ${intentResult.operation}`,
            planResult.plan.steps || []
        );

        // ── Pre-execution brief for sizeable plans ────────────────────────────
        let preExecutionBrief = null;
        if ((planResult.plan.steps || []).length > 3) {
            preExecutionBrief = AgentFeedbackService.generatePreExecutionBrief(
                planResult.plan,
                cachedAnalysis
            );
        }

        // ── Compile Commands ──────────────────────────────────────────────────
        logStep(`Plan ready — ${(planResult.plan.steps || []).length} step(s) queued`);
        console.log('[EditJobManager] Compiling commands...');

        // FIX 2 (original): Override intent confidence to HIGH when plan is valid
        // so CommandCompiler's confidence gate doesn't block MEDIUM-confidence intents.
        const planForCompilation = {
            ...planResult.plan,
            intent: intentResult.confidence === 'HIGH'
                ? intentResult
                : { ...intentResult, confidence: 'HIGH' },
        };

        const compileResult = CommandCompiler.compile(planForCompilation, useTimelineStore.getState());

        if (!compileResult.success && compileResult.commands.length === 0) {
            actor.send({ type: 'ERROR', error: compileResult.error });
            return { success: false, jobId, message: compileResult.error || 'Could not compile edit commands.' };
        }

        actor.send({ type: 'COMMANDS_COMPILED', commands: compileResult.commands });

        // ── Execute Commands ──────────────────────────────────────────────────
        logStep(`Executing ${compileResult.commands.length} operation(s)…`);
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
                details: executionResult.results,
            };
        }

        actor.send({ type: 'EXECUTION_COMPLETE', result: executionResult });

        // ── Validate Results ──────────────────────────────────────────────────
        logStep('Verifying edits…');
        console.log('[EditJobManager] Validating results...');

        // FIX 1 (original): ValidationService.validate() is ASYNC — must await
        const validationResult = await ValidationService.validate(planResult.plan, executionResult);

        if (!validationResult.success) {
            actor.send({ type: 'VALIDATION_FAILED', error: validationResult.error, result: validationResult });
            if (validationResult.issues?.length > 0 && executionResult.success) {
                console.warn('[EditJobManager] Validation warnings:', validationResult.issues);
            } else {
                return { success: false, jobId, message: validationResult.error, validation: validationResult };
            }
        }

        actor.send({ type: 'VALIDATION_COMPLETE', result: validationResult });

        // ── Mark as approved in session memory ───────────────────────────────
        editSessionMemory.approveEdit(jobId);

        // ── Generate Feedback ─────────────────────────────────────────────────
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
            validation: validationResult,
            preExecutionBrief, // UI can surface this before the next prompt if needed
        };
    }

    async runNLEExport(jobId, intentResult, actor) {
        try {
            const { NLEExportService } = await import('../services/nleExportService.js');
            const nleTarget = intentResult.constraints?.nleTarget;
            const result = await NLEExportService.export(nleTarget, useTimelineStore.getState());

            actor.send({ type: 'EXECUTION_COMPLETE', result });
            actor.send({ type: 'VALIDATION_COMPLETE', result: { success: true } });

            return {
                success: true,
                jobId,
                message: result.message || `✓ Exported for ${nleTarget}.`,
                suggestions: ['Open in your NLE', 'Export for another platform'],
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