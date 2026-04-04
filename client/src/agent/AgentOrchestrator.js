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
        console.log("🤖 Agent Planning...", userPrompt);
        const timelineContext = ContextGenerator.getTimelineContext();
        const plan = await this.getAgentPlan(userPrompt, timelineContext);

        if (!plan || !plan.actions) {
            return { success: false, message: "Agent could not generate a plan." };
        }

        return {
            success: true,
            thought: plan.thought,
            actions: plan.actions,
            message: "Plan generated successfully. Waiting for approval."
        };
    }

    /**
     * Step 2: Execute the Plan
     */
    async executePlan(planActions) {
        console.log("🤖 Agent Executing Plan...", planActions);
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

        // Verification
        const verification = this.verifyTimeline();

        return {
            success: true,
            message: "Plan executed.",
            results, // Mapped to 'details' in UI
            issues: verification.issues
        };
    }

    // Legacy/Auto-Mode Wrapper
    async processUserRequest(userPrompt) {
        console.log("🤖 Agent Started. Prompt:", userPrompt);
        // ... (can fallback to generate + execute)
        const planResult = await this.generatePlan(userPrompt);
        if (!planResult.success) return planResult;

        console.log("🤖 Agent Plan:", { thought: planResult.thought, actions: planResult.actions });

        const executionResult = await this.executePlan(planResult.actions);

        // 4. Verification (The "Secret Sauce") - already done in executePlan
        if (executionResult.issues && executionResult.issues.length > 0) {
            console.warn("⚠️ Verification Issues Found:", executionResult.issues);
            // TODO: Feedback loop - Send issues back to LLM to fix (Recursive)
            // For MVP: Just report them.
            return {
                success: true,
                message: "Edits applied but issues found.",
                details: executionResult.results,
                issues: executionResult.issues
            };
        }

        return {
            success: true,
            message: "Edits applied successfully.",
            thought: planResult.thought || "Executed actions.",
            details: executionResult.results
        };
    }

    // Internal API Call
    async getAgentPlan(prompt, context) {
        // Call Backend API
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for GPT-4

            const response = await fetch('/api/ai/agent-plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    context,
                    tools: TOOL_DEFINITIONS
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorMsg = "Backend API Failed";
                let errText = "";
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
            console.error("Agent API Error:", err);
            return null;
        }
    }

    verifyTimeline() {
        // Check for gaps in Video Track (0)
        // Assume single video track for now
        const state = useTimelineStore.getState();
        const videoTrack = state.tracks.find(t => t.type === 'video');

        const issues = [];
        if (!videoTrack) return { hasIssues: false };

        const clips = [...videoTrack.clips].sort((a, b) => a.start - b.start);

        // Check for gaps
        let lastEnd = 0;
        const GAP_THRESHOLD = 0.1; // 100ms

        clips.forEach(clip => {
            const gap = clip.start - lastEnd;
            if (gap > GAP_THRESHOLD) {
                issues.push(`Gap detected at ${lastEnd.toFixed(2)}s (Duration: ${gap.toFixed(2)}s)`);
            }
            // Check for overlaps (simplified)
            if (clip.start < lastEnd - 0.01) { // Tolerance
                issues.push(`Overlap detected at ${clip.start.toFixed(2)}s`);
            }
            lastEnd = clip.start + clip.duration;
        });

        // Check for empty timeline
        if (clips.length === 0) issues.push("Timeline is empty.");

        return {
            hasIssues: issues.length > 0,
            issues
        };
    }
}
