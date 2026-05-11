/**
 * AgentOrchestrator
 *
 * FIX: getAgentPlan() was calling fetch('/api/ai/agent-plan', ...) without an
 *      Authorization header. In production this returned 401, so the orchestrator
 *      always returned { success: false, message: "Agent could not generate a plan." }
 *      and no edits were ever executed through the autonomous pipeline.
 *
 *      All fetch() calls replaced with authFetch().
 */

import { authFetch } from '../utils/authFetch.js';
import { VideoEditorTools, TOOL_DEFINITIONS } from './VideoEditorTools.js';
import { ContextGenerator } from './ContextGenerator.js';
import useTimelineStore from '../store/useTimelineStore.js';

export class AgentOrchestrator {
    constructor() {
        this.tools = new VideoEditorTools();
        this.maxIterations = 5;
    }

    /**
     * Step 1: Generate the Plan
     */
    async generatePlan(userPrompt) {
        console.log('🤖 Agent Planning...', userPrompt);
        const timelineContext = ContextGenerator.getTimelineContext();
        const plan = await this.getAgentPlan(userPrompt, timelineContext);

        if (!plan || !plan.actions) {
            return { success: false, message: 'Agent could not generate a plan.' };
        }

        return {
            success: true,
            thought: plan.thought,
            actions: plan.actions,
            message: 'Plan generated successfully. Waiting for approval.'
        };
    }

    /**
     * Step 2: Execute the Plan
     */
    async executePlan(planActions) {
        console.log('🤖 Agent Executing Plan...', planActions);
        const results = [];

        for (const action of planActions) {
            console.log(`▶️ Executing Action: ${action.name}`, action.args);
            const startTime = performance.now();
            try {
                const result = await this.tools.execute(action);
                const duration = (performance.now() - startTime).toFixed(2);
                console.log(`✅ Action Succeeded: ${action.name} (${duration}ms)`, result);
                results.push({ action: action.name, status: 'success', result, duration });
            } catch (err) {
                const duration = (performance.now() - startTime).toFixed(2);
                console.error(`❌ Action Failed: ${action.name} (${duration}ms)`, err);
                results.push({ action: action.name, status: 'error', error: err.message, duration });
            }
        }

        const verification = this.verifyTimeline();

        return {
            success: true,
            message: 'Plan executed.',
            results,
            issues: verification.issues
        };
    }

    /**
     * Legacy/Auto-Mode Wrapper
     */
    async processUserRequest(userPrompt) {
        console.log('🤖 Agent Started. Prompt:', userPrompt);

        const planResult = await this.generatePlan(userPrompt);
        if (!planResult.success) return planResult;

        console.log('🤖 Agent Plan:', { thought: planResult.thought, actions: planResult.actions });

        const executionResult = await this.executePlan(planResult.actions);

        if (executionResult.issues && executionResult.issues.length > 0) {
            console.warn('⚠️ Verification Issues Found:', executionResult.issues);
            return {
                success: true,
                message: 'Edits applied but issues found.',
                details: executionResult.results,
                issues: executionResult.issues
            };
        }

        return {
            success: true,
            message: 'Edits applied successfully.',
            thought: planResult.thought || 'Executed actions.',
            details: executionResult.results
        };
    }

    /**
     * Internal API Call to backend agent plan endpoint.
     * FIX: was fetch('/api/ai/agent-plan', ...) without auth — 401 in production.
     */
    async getAgentPlan(prompt, context) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            // FIX: replaced fetch() with authFetch()
            const response = await authFetch('/api/ai/agent-plan', {
                method: 'POST',
                body: JSON.stringify({
                    prompt,
                    context,
                    tools: TOOL_DEFINITIONS
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorMsg = 'Backend API Failed';
                let errText = '';
                try {
                    errText = await response.text();
                    const errData = JSON.parse(errText);
                    errorMsg = errData.error || errorMsg;
                } catch (parseErr) {
                    errorMsg = errText || `Backend Error (${response.status})`;
                }
                throw new Error(errorMsg);
            }
            return await response.json();

        } catch (err) {
            console.error('Agent API Error:', err);
            return null;
        }
    }

    verifyTimeline() {
        const state = useTimelineStore.getState();
        const videoTrack = state.tracks.find(t => t.type === 'video');

        const issues = [];
        if (!videoTrack) return { hasIssues: false };

        const clips = [...videoTrack.clips].sort((a, b) => a.start - b.start);

        let lastEnd = 0;
        const GAP_THRESHOLD = 0.1;

        clips.forEach(clip => {
            const gap = clip.start - lastEnd;
            if (gap > GAP_THRESHOLD) {
                issues.push(`Gap detected at ${lastEnd.toFixed(2)}s (Duration: ${gap.toFixed(2)}s)`);
            }
            if (clip.start < lastEnd - 0.01) {
                issues.push(`Overlap detected at ${clip.start.toFixed(2)}s`);
            }
            lastEnd = clip.start + clip.duration;
        });

        if (clips.length === 0) issues.push('Timeline is empty.');

        return { hasIssues: issues.length > 0, issues };
    }
}