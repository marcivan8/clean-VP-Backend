/**
 * planLimits.js
 *
 * Project quota per subscription plan.
 * Update here if pricing changes — enforced on both client (UX) and
 * server (Supabase RLS / edge function) sides.
 */

export const PLAN_LIMITS = {
    free:    1,
    creator: 10,
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
