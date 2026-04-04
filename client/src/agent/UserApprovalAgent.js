/**
 * UserApprovalAgent - Gatekeeper for Viral Pilot
 * 
 * Manages human-in-the-loop approval workflows.
 * 
 * Responsibilities:
 * - Intercept plans requiring user approval
 * - Hold execution until approval granted
 * - Provide clear context for approval decisions
 * - Track approval history
 * 
 * This agent NEVER executes. It only gates.
 */

import { EventBus, EVENT_TYPES, PRIORITY } from './EventBus.js';

// Actions that require approval by default
const APPROVAL_REQUIRED_ACTIONS = [
    'delete_clip',
    'delete_track',
    'clear_timeline',
    'export',
    'batch_operation'
];

// Thresholds that trigger approval
const APPROVAL_THRESHOLDS = {
    // If plan affects more than N clips, require approval
    MAX_CLIPS_WITHOUT_APPROVAL: 5,

    // If export duration > N minutes, require approval
    MAX_EXPORT_DURATION_MINUTES: 10,

    // If estimated processing time > N seconds, require approval
    MAX_PROCESSING_TIME_SECONDS: 60
};

class UserApprovalAgentClass {
    constructor() {
        this.isActive = false;

        // Pending approvals: jobId -> { resolve, reject, approval object }
        this.pendingApprovals = new Map();

        // Approval history
        this.approvalHistory = [];
        this.maxHistory = 100;

        // Custom approval rules
        this.customRules = [];
    }

    /**
     * Activate the approval agent
     */
    activate() {
        if (this.isActive) return;

        console.log('[UserApprovalAgent] Activating...');

        this.unsubscribers = [
            EventBus.on(EVENT_TYPES.PLAN_READY, this.onPlanReady.bind(this), { priority: PRIORITY.HIGH }),
            EventBus.on(EVENT_TYPES.APPROVAL_GRANTED, this.onApprovalGranted.bind(this)),
            EventBus.on(EVENT_TYPES.APPROVAL_DENIED, this.onApprovalDenied.bind(this)),
            EventBus.on(EVENT_TYPES.JOB_CANCELLED, this.onJobCancelled.bind(this))
        ];

        this.isActive = true;
        console.log('[UserApprovalAgent] Active');
    }

    /**
     * Deactivate the approval agent
     */
    deactivate() {
        if (!this.isActive) return;

        this.unsubscribers?.forEach(unsub => unsub());
        this.unsubscribers = [];

        // Reject all pending approvals
        for (const [jobId, pending] of this.pendingApprovals) {
            pending.reject(new Error('Approval agent deactivated'));
        }
        this.pendingApprovals.clear();

        this.isActive = false;
        console.log('[UserApprovalAgent] Deactivated');
    }

    /**
     * Check if a plan requires approval
     * @param {object} plan - Edit plan
     * @returns {object|null} Approval reason or null if not required
     */
    checkApprovalRequired(plan) {
        const reasons = [];
        const steps = plan.steps || plan.actions || [];

        // Check for dangerous actions
        for (const step of steps) {
            const action = step.action || step.name;
            if (APPROVAL_REQUIRED_ACTIONS.includes(action)) {
                reasons.push({
                    type: 'dangerous_action',
                    action,
                    message: `Action "${action}" requires confirmation`
                });
            }
        }

        // Check for batch operations exceeding threshold
        if (steps.length > APPROVAL_THRESHOLDS.MAX_CLIPS_WITHOUT_APPROVAL) {
            reasons.push({
                type: 'batch_size',
                count: steps.length,
                threshold: APPROVAL_THRESHOLDS.MAX_CLIPS_WITHOUT_APPROVAL,
                message: `This plan affects ${steps.length} items (>${APPROVAL_THRESHOLDS.MAX_CLIPS_WITHOUT_APPROVAL})`
            });
        }

        // Check custom rules
        for (const rule of this.customRules) {
            const result = rule.check(plan);
            if (result) {
                reasons.push({
                    type: 'custom_rule',
                    rule: rule.name,
                    message: result.message || `Custom rule "${rule.name}" triggered`
                });
            }
        }

        if (reasons.length > 0) {
            return {
                required: true,
                reasons,
                summary: this.generateApprovalSummary(plan, reasons)
            };
        }

        return null;
    }

    /**
     * Generate user-friendly approval summary
     */
    generateApprovalSummary(plan, reasons) {
        const steps = plan.steps || plan.actions || [];
        const actionList = steps.map(s => s.action || s.name).join(', ');

        return {
            title: 'Approval Required',
            description: `The following plan requires your approval before execution.`,
            actions: actionList,
            stepCount: steps.length,
            reasons: reasons.map(r => r.message)
        };
    }

    /**
     * Handle plan ready event
     */
    async onPlanReady(payload) {
        const { jobId, plan } = payload;

        const approvalCheck = this.checkApprovalRequired(plan);

        if (!approvalCheck) {
            // No approval needed, let it proceed
            console.log(`[UserApprovalAgent] Job ${jobId}: No approval required`);
            return;
        }

        console.log(`[UserApprovalAgent] Job ${jobId}: Approval required`, approvalCheck.reasons);

        // Emit approval required event
        EventBus.emit(EVENT_TYPES.APPROVAL_REQUIRED, {
            jobId,
            plan,
            ...approvalCheck.summary,
            reasons: approvalCheck.reasons,
            timestamp: Date.now()
        });
    }

    /**
     * Request approval (programmatic, returns Promise)
     * @param {string} jobId
     * @param {object} plan
     * @returns {Promise<boolean>} Resolves to true if approved
     */
    requestApproval(jobId, plan) {
        return new Promise((resolve, reject) => {
            const approvalCheck = this.checkApprovalRequired(plan);

            if (!approvalCheck) {
                resolve(true);
                return;
            }

            this.pendingApprovals.set(jobId, {
                resolve,
                reject,
                plan,
                reasons: approvalCheck.reasons,
                requestedAt: Date.now()
            });

            EventBus.emit(EVENT_TYPES.APPROVAL_REQUIRED, {
                jobId,
                plan,
                ...approvalCheck.summary,
                reasons: approvalCheck.reasons,
                timestamp: Date.now()
            });
        });
    }

    /**
     * Handle approval granted event
     */
    onApprovalGranted(payload) {
        const { jobId } = payload;
        const pending = this.pendingApprovals.get(jobId);

        if (pending) {
            this.recordApproval(jobId, 'granted', pending);
            pending.resolve(true);
            this.pendingApprovals.delete(jobId);
            console.log(`[UserApprovalAgent] Job ${jobId}: Approval granted`);
        }
    }

    /**
     * Handle approval denied event
     */
    onApprovalDenied(payload) {
        const { jobId, reason } = payload;
        const pending = this.pendingApprovals.get(jobId);

        if (pending) {
            this.recordApproval(jobId, 'denied', pending, reason);
            pending.reject(new Error(reason || 'User denied approval'));
            this.pendingApprovals.delete(jobId);
            console.log(`[UserApprovalAgent] Job ${jobId}: Approval denied`);
        }
    }

    /**
     * Handle job cancelled event
     */
    onJobCancelled(payload) {
        const { jobId } = payload;
        const pending = this.pendingApprovals.get(jobId);

        if (pending) {
            pending.reject(new Error('Job cancelled'));
            this.pendingApprovals.delete(jobId);
        }
    }

    /**
     * Record approval decision in history
     */
    recordApproval(jobId, decision, pending, reason = null) {
        this.approvalHistory.push({
            jobId,
            decision,
            reasons: pending.reasons,
            reason,
            requestedAt: pending.requestedAt,
            decidedAt: Date.now()
        });

        if (this.approvalHistory.length > this.maxHistory) {
            this.approvalHistory.shift();
        }
    }

    /**
     * Add custom approval rule
     * @param {string} name - Rule name
     * @param {function} checkFn - (plan) => { required: boolean, message: string } | null
     */
    addRule(name, checkFn) {
        this.customRules.push({ name, check: checkFn });
        console.log(`[UserApprovalAgent] Added rule: ${name}`);
    }

    /**
     * Remove custom rule
     */
    removeRule(name) {
        this.customRules = this.customRules.filter(r => r.name !== name);
    }

    /**
     * Get pending approvals
     */
    getPendingApprovals() {
        const pending = [];
        for (const [jobId, data] of this.pendingApprovals) {
            pending.push({
                jobId,
                reasons: data.reasons,
                requestedAt: data.requestedAt
            });
        }
        return pending;
    }

    /**
     * Get approval history
     */
    getHistory(jobId = null) {
        if (jobId) {
            return this.approvalHistory.filter(a => a.jobId === jobId);
        }
        return [...this.approvalHistory];
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            isActive: this.isActive,
            pendingCount: this.pendingApprovals.size,
            rulesCount: this.customRules.length + APPROVAL_REQUIRED_ACTIONS.length,
            historyCount: this.approvalHistory.length
        };
    }
}

// Singleton instance
export const UserApprovalAgent = new UserApprovalAgentClass();

export default UserApprovalAgent;
