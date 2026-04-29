/**
 * AutonomousEditingMode — Viral Pilot Phase 7
 *
 * Orchestrates a full step-by-step autonomous edit from a user prompt.
 *
 * Design decisions:
 * - Concurrent manual edits ARE allowed (editor is never locked)
 * - Each step emits an event and awaits user approval before proceeding
 * - In full-auto mode, all steps execute without waiting for approval
 * - Users can EDIT any step's parameters before execution
 */

import { EditPlanner }          from './EditPlanner.js';
import { IntentParser }         from './IntentParser.js';
import { CommandCompiler }      from './CommandCompiler.js';
import { mediaExecutionEngine } from './MediaExecutionEngine.js';
import { UserApprovalAgent }    from './UserApprovalAgent.js';
import { EventBus, EVENT_TYPES } from './EventBus.js';
import useAIStore               from '../store/useAIStore.js';

// ── Step States ────────────────────────────────────────────────────────
export const STEP_STATE = {
    PENDING:    'PENDING',
    AWAITING:   'AWAITING_APPROVAL',
    APPROVED:   'APPROVED',
    EXECUTING:  'EXECUTING',
    DONE:       'DONE',
    SKIPPED:    'SKIPPED',
    FAILED:     'FAILED'
};

// ── Autonomous Modes ───────────────────────────────────────────────────
export const AUTO_MODE = {
    STEP_BY_STEP: 'STEP_BY_STEP',  // Ask user to Continue/Edit/Skip at each step
    FULL_AUTO:    'FULL_AUTO'       // Execute all steps without interruption
};

class AutonomousEditingModeClass {
    constructor() {
        this.mode         = AUTO_MODE.STEP_BY_STEP;
        this.isActive     = false;
        this.steps        = [];          // Array of planned steps with state
        this.currentIndex = 0;
        this.sessionId    = null;
        this.abortController = null;

        // Pending step approval resolver
        this._stepResolver = null;
    }

    // ── Public API ─────────────────────────────────────────────────────

    /**
     * Start an autonomous editing session.
     * @param {string} prompt   - User's natural language edit request
     * @param {string} mode     - AUTO_MODE.STEP_BY_STEP | AUTO_MODE.FULL_AUTO
     */
    async start(prompt, mode = AUTO_MODE.STEP_BY_STEP) {
        if (this.isActive) {
            console.warn('[AutonomousMode] Session already active — aborting previous');
            this.abort();
        }

        this.sessionId       = `auto_${Date.now()}`;
        this.mode            = mode;
        this.isActive        = true;
        this.currentIndex    = 0;
        this.steps           = [];
        this.abortController = new AbortController();

        console.log(`[AutonomousMode] Starting session ${this.sessionId} (${mode})`);

        this._emitStatus('starting', `🤖 Autonomous mode starting: "${prompt}"`);

        try {
            // Phase 1: Parse intent
            this._emitStatus('analyzing', '🔍 Analysing your request…');
            const intent = await IntentParser.parse(prompt, this.abortController.signal);

            if (!intent || intent.error) {
                throw new Error(intent?.error || 'Could not parse intent');
            }

            // Phase 2: Generate plan
            this._emitStatus('planning', '📋 Building edit plan…');
            const planResult = await EditPlanner.generatePlan(intent, this.abortController.signal);

            if (!planResult?.success || !planResult.plan) {
                throw new Error(planResult?.error || 'Could not generate plan');
            }

            const plan = planResult.plan;
            this.steps = plan.steps.map((step, i) => ({
                ...step,
                index:       i,
                state:       STEP_STATE.PENDING,
                editedParams: null,   // User-modified params (if any)
                error:        null,
                result:       null
            }));

            EventBus.emit(EVENT_TYPES.AUTONOMOUS_PLAN_READY, {
                sessionId: this.sessionId,
                steps:     this.steps,
                mode:      this.mode
            });

            this._emitStatus('ready', `✅ Plan ready — ${this.steps.length} step(s) to execute`);

            // Phase 3: Execute steps
            await this._runSteps(plan);

        } catch (err) {
            if (err.name === 'AbortError') {
                this._emitStatus('aborted', '🛑 Autonomous session aborted');
            } else {
                console.error('[AutonomousMode] Session failed:', err);
                this._emitStatus('failed', `❌ Session failed: ${err.message}`);
            }
        } finally {
            this.isActive = false;
            EventBus.emit(EVENT_TYPES.AUTONOMOUS_SESSION_ENDED, { sessionId: this.sessionId });
        }
    }

    /**
     * Continue to the next step (user approval).
     * @param {object|null} editedParams - Optional modified step params from the user
     */
    continueStep(editedParams = null) {
        if (this._stepResolver) {
            this._stepResolver({ approved: true, editedParams });
            this._stepResolver = null;
        }
    }

    /**
     * Skip the current awaiting step.
     */
    skipStep() {
        if (this._stepResolver) {
            this._stepResolver({ approved: false, skip: true });
            this._stepResolver = null;
        }
    }

    /**
     * Abort the entire autonomous session.
     */
    abort() {
        if (this.abortController) {
            this.abortController.abort();
        }
        if (this._stepResolver) {
            this._stepResolver({ approved: false, abort: true });
            this._stepResolver = null;
        }
        this.isActive = false;
    }

    /**
     * Set the autonomous mode without starting a session.
     */
    setMode(mode) {
        this.mode = mode;
        console.log(`[AutonomousMode] Mode set to: ${mode}`);
    }

    /**
     * Get current session state for UI.
     */
    getStatus() {
        return {
            isActive:     this.isActive,
            sessionId:    this.sessionId,
            mode:         this.mode,
            totalSteps:   this.steps.length,
            currentIndex: this.currentIndex,
            steps:        this.steps,
            progress:     this.steps.length > 0
                ? Math.round((this.steps.filter(s => s.state === STEP_STATE.DONE || s.state === STEP_STATE.SKIPPED).length / this.steps.length) * 100)
                : 0
        };
    }

    // ── Internal ───────────────────────────────────────────────────────

    async _runSteps(plan) {
        // Compile all steps into executable commands
        const compiled = CommandCompiler.compile(plan);

        if (!compiled?.commands || compiled.commands.length === 0) {
            this._emitStatus('done', '✅ No executable commands in plan — nothing to do');
            return;
        }

        for (let i = 0; i < this.steps.length; i++) {
            if (this.abortController.signal.aborted) break;

            const step    = this.steps[i];
            const command = compiled.commands[i] || null;

            this.currentIndex = i;
            step.state = STEP_STATE.AWAITING;

            EventBus.emit(EVENT_TYPES.AUTONOMOUS_STEP_READY, {
                sessionId: this.sessionId,
                step,
                stepIndex: i,
                totalSteps: this.steps.length,
                command
            });

            // In STEP_BY_STEP mode, wait for user approval
            let editedParams = null;
            if (this.mode === AUTO_MODE.STEP_BY_STEP) {
                const decision = await this._waitForUserDecision(step);

                if (decision.abort) {
                    this.abort();
                    break;
                }

                if (decision.skip) {
                    step.state = STEP_STATE.SKIPPED;
                    this._emitStatus('step_skipped', `⏭ Skipped: ${this._stepLabel(step)}`);
                    this._updateStepInStore();
                    continue;
                }

                editedParams = decision.editedParams;
            }

            // Apply user-edited params if any
            const effectiveCommand = editedParams && command
                ? { ...command, args: { ...command.args, ...editedParams } }
                : command;

            step.state = STEP_STATE.EXECUTING;
            this._emitStatus('executing', `⚡ Executing: ${this._stepLabel(step)}`);
            this._updateStepInStore();

            try {
                if (effectiveCommand) {
                    const result = await mediaExecutionEngine.execute(
                        [effectiveCommand],
                        null,
                        this.abortController.signal
                    );
                    step.result = result;
                    step.state  = result.success ? STEP_STATE.DONE : STEP_STATE.FAILED;
                    step.error  = result.success ? null : (result.error || 'Execution failed');
                } else {
                    // No command (planning-only step) — mark done
                    step.state = STEP_STATE.DONE;
                }

                this._emitStatus(
                    step.state === STEP_STATE.DONE ? 'step_done' : 'step_failed',
                    step.state === STEP_STATE.DONE
                        ? `✅ Done: ${this._stepLabel(step)}`
                        : `❌ Failed: ${this._stepLabel(step)} — ${step.error}`
                );

            } catch (err) {
                step.state = STEP_STATE.FAILED;
                step.error = err.message;
                this._emitStatus('step_failed', `❌ Error in step ${i + 1}: ${err.message}`);
            }

            this._updateStepInStore();
        }

        const doneCount    = this.steps.filter(s => s.state === STEP_STATE.DONE).length;
        const skippedCount = this.steps.filter(s => s.state === STEP_STATE.SKIPPED).length;
        const failedCount  = this.steps.filter(s => s.state === STEP_STATE.FAILED).length;

        this._emitStatus(
            'complete',
            `🎉 Autonomous session complete — ${doneCount} done, ${skippedCount} skipped, ${failedCount} failed`
        );
    }

    /** Wait for user to click Continue/Skip/Abort */
    _waitForUserDecision(step) {
        return new Promise(resolve => {
            this._stepResolver = resolve;

            // In full-auto mode, auto-resolve immediately
            if (this.mode === AUTO_MODE.FULL_AUTO) {
                setTimeout(() => {
                    if (this._stepResolver === resolve) {
                        this._stepResolver = null;
                        resolve({ approved: true, editedParams: null });
                    }
                }, 100);
            }
        });
    }

    _emitStatus(status, message) {
        console.log(`[AutonomousMode] ${message}`);

        useAIStore.getState().addLog({
            id:        `auto-${status}-${Date.now()}`,
            type:      status.includes('fail') || status.includes('abort') ? 'warning'
                       : status === 'complete' || status.includes('done') ? 'success'
                       : 'info',
            message,
            timestamp: new Date().toLocaleTimeString()
        });

        EventBus.emit(EVENT_TYPES.AUTONOMOUS_STATUS, {
            sessionId: this.sessionId,
            status,
            message,
            state: this.getStatus()
        });
    }

    _updateStepInStore() {
        EventBus.emit(EVENT_TYPES.AUTONOMOUS_STEPS_UPDATED, {
            sessionId: this.sessionId,
            steps: this.steps
        });
    }

    _stepLabel(step) {
        return step.action?.replace(/_/g, ' ') || `Step ${step.index + 1}`;
    }
}

export const AutonomousEditingMode = new AutonomousEditingModeClass();
export default AutonomousEditingMode;
