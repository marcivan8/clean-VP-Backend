/**
 * planLimits.js
 *
 * Project quota per subscription plan.
 * Update here if pricing changes — enforced on both client (UX) and
 * server (Supabase RLS / edge function) sides.
 */

export const PLAN_LIMITS = {
    free:    2,
    creator: Infinity,
    pro:     Infinity,
};

/**
 * Human-readable cap string for upgrade prompts.
 * e.g. "1 project", "10 projects", "unlimited projects"
 */
export function planLimitLabel(plan) {
    const n = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    if (n === Infinity) return 'unlimited projects';
    return `${n} project${n !== 1 ? 's' : ''}`;
}

/**
 * Returns the numeric project limit for a given plan key.
 * Falls back to 'free' if the plan key is unknown.
 */
export function getProjectLimit(plan) {
    return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

/**
 * True when the user has reached or exceeded their plan quota.
 */
export function atLimit(plan, projectCount) {
    return projectCount >= getProjectLimit(plan);
}

// ── AI operations (mirrors middleware/usageGate.js PLAN_LIMITS.ai_ops) ───────
// The server is the gate; these only drive the mobile usage meter and the
// plan sheet copy. Keep in sync with usageGate.js and the pricing page.

export const AI_OPS_LIMITS = {
    free:    10,
    creator: 100,
    pro:     Infinity,
};

// Monthly prices shown on the pricing page (HomePage.jsx).
export const PLAN_PRICES = {
    creator: '€15',
    pro:     '€35',
};

export const PLAN_LABELS = { free: 'Free', creator: 'Creator', pro: 'Pro' };

export function getAiOpsLimit(plan) {
    return AI_OPS_LIMITS[plan] ?? AI_OPS_LIMITS.free;
}

/** The plan one step up, or null when already on the top plan. */
export function nextPlan(plan) {
    if (plan === 'pro') return null;
    if (plan === 'creator') return 'pro';
    return 'creator';
}

/** Start of the current usage month: the 1st at 00:00 UTC (same as usageGate). */
export function startOfUsageMonth(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** When the AI-operations count resets: the 1st of next month, 00:00 UTC. */
export function nextUsageReset(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * Meter values for "AI operations this month".
 * @returns {{ used: number, limit: number, unlimited: boolean, ratio: number, exhausted: boolean }}
 */
export function aiOpsMeter(used, plan) {
    const limit = getAiOpsLimit(plan);
    const safeUsed = Math.max(0, Number(used) || 0);
    if (limit === Infinity) return { used: safeUsed, limit, unlimited: true, ratio: 0, exhausted: false };
    return {
        used: safeUsed,
        limit,
        unlimited: false,
        ratio: limit > 0 ? Math.min(1, safeUsed / limit) : 1,
        exhausted: safeUsed >= limit,
    };
}

/** Project name from an uploaded file name: extension dropped, trimmed, max 80 chars. */
export function projectNameFromFile(fileName) {
    const base = String(fileName || '').trim().replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
    return base.slice(0, 80);
}
