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
import { getToolExecutionStatus, summarizeToolExecutionResults } from './ToolExecutionResults.js';

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
        let planningContext = timelineContext;
        let plan = null;
        const searchedQueries = new Set();
        const searchFindings = [];
        let searchBlocked = false;

        // Large-bin planning is deliberately split into retrieval and editing.
        // The model may only see a prompt-sized shortlist, while the local
        // search tool can inspect every uploaded asset. Resolve its read-only
        // searches here, feed the evidence back into a fresh plan, and never
        // mix a search pass with edits that were planned before seeing results.
        for (let pass = 0; pass < 3; pass += 1) {
            plan = await this.getAgentPlan(userPrompt, planningContext);
            if (!plan || !Array.isArray(plan.actions)) break;

            const searches = plan.actions.filter(action => action?.name === 'search_uploaded_assets');
            if (!searches.length) break;

            let madeProgress = false;
            for (const action of searches.slice(0, 2)) {
                const query = String(action.args?.query || '').trim();
                const requestedOffset = Math.max(0, Math.floor(Number(action.args?.offset) || 0));
                const normalizedQuery = `${query.toLocaleLowerCase()}|${requestedOffset}`;
                if (!query || searchedQueries.has(normalizedQuery)) continue;
                searchedQueries.add(normalizedQuery);
                const result = await this.tools.execute({
                    ...action,
                    args: { ...action.args, offset: requestedOffset, limit: 30 },
                });
                if (result?.success !== true) {
                    searchFindings.push({ query, success: false, message: result?.message || 'Search could not be completed.' });
                    continue;
                }

                const details = result.details || {};
                const results = (details.results || []).slice(0, 30).map(asset => ({
                    id: asset.id,
                    name: asset.name,
                    type: asset.type,
                    role: asset.role,
                    editable: asset.editable,
                    analysisStatus: asset.analysisStatus,
                    confidence: asset.confidence,
                    duration: asset.duration,
                    evidence: String(asset.evidence || '').slice(0, 140) || null,
                    matchedTerms: (asset.matchedTerms || []).slice(0, 8),
                }));

                searchFindings.push({
                    query,
                    success: true,
                    totalAssetsScanned: details.totalAssetsScanned ?? null,
                    totalMatches: details.totalMatches ?? results.length,
                    offset: requestedOffset,
                    returned: results.length,
                    hasMore: details.hasMore === true,
                    nextOffset: details.nextOffset ?? null,
                    results,
                });
                madeProgress = true;
            }

            if (!madeProgress) {
                // A repeated/unusable search cannot safely justify edits based
                // on an incomplete bin. Return no edit actions for this pass.
                searchBlocked = true;
                plan = {
                    ...plan,
                    actions: [],
                    thought: 'Asset discovery did not return new usable evidence; no edit was planned from an incomplete inventory.',
                };
                break;
            }

            planningContext = {
                ...planningContext,
                assetSearchQueries: [...searchedQueries],
                assetSearchFindings: searchFindings,
            };
        }

        if (plan?.actions?.some(action => action?.name === 'search_uploaded_assets')) {
            searchBlocked = true;
            plan = {
                ...plan,
                actions: [],
                thought: 'Asset discovery reached its bounded planning budget before a complete edit plan was ready; no partial edit was produced.',
            };
        }

        if (searchBlocked) {
            return {
                success: false,
                message: 'I could not finish discovering the required footage within the planning limit, so I did not create a partial edit. Try a more specific subject or filename.',
                details: searchFindings,
            };
        }

        if (!plan || !plan.actions) {
            return { success: false, message: 'Agent could not generate a plan.' };
        }

        return {
            success: true,
            thought: plan.thought,
            actions: plan.actions,
            message: searchFindings.length
                ? `Plan generated after searching ${searchFindings.reduce((sum, item) => sum + (Number(item.returned) || 0), 0)} matching asset(s). Waiting for approval.`
                : 'Plan generated successfully. Waiting for approval.'
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
                // Tool execution may return success:false without throwing.
                // An absent success flag is unverified, not a verified edit.
                const status = getToolExecutionStatus(result);
                if (status === 'success') {
                    console.log(`✅ Action Succeeded: ${action.name} (${duration}ms)`, result);
                } else {
                    console.warn(`⚠️ Action ${status}: ${action.name} (${duration}ms)`, result);
                }
                results.push({ action: action.name, status, result, duration });
            } catch (err) {
                const duration = (performance.now() - startTime).toFixed(2);
                console.error(`❌ Action Failed: ${action.name} (${duration}ms)`, err);
                results.push({ action: action.name, status: 'error', error: err.message, duration });
            }
        }

        const verification = this.verifyTimeline();
        const summary = summarizeToolExecutionResults(results);

        return {
            success: summary.success,
            message: summary.message,
            results,
            failedActions: summary.failedActions,
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

        if (!executionResult.success) {
            const failedNames = (executionResult.failedActions || []).map(item => item.action).join(', ');
            return {
                success: false,
                partial: executionResult.results.some(item => item.status === 'success'),
                message: failedNames
                    ? `Some requested edits were not completed or verified: ${failedNames}.`
                    : 'No edit actions were verified as successful.',
                details: executionResult.results,
                issues: executionResult.issues || []
            };
        }

        if (executionResult.issues && executionResult.issues.length > 0) {
            console.warn('⚠️ Verification Issues Found:', executionResult.issues);
            return {
                success: false,
                partial: true,
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
