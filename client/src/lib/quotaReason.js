/**
 * quotaReason.js
 *
 * Which wall a 402 from the usage gate represents, for the shared
 * QUOTA_EXCEEDED channel.
 *
 *   'auto_trial' — a free account has used the Auto runs its trial grants.
 *                  The published free plan locks styles and Auto, so this is
 *                  the end of the trial, not the end of the month.
 *   'ai_ops'     — the monthly operations cap.
 *
 * Telling them apart matters because the remedy differs: waiting for the
 * month to roll over fixes one and never fixes the other, and showing a
 * beginner the wrong one is how an upgrade prompt loses its credibility.
 * See middleware/usageGate.js (AUTO_TRIAL_SPENT / AI_OPS_LIMIT). R148.
 */
export function quotaReason(body) {
    return body?.error === 'AUTO_TRIAL_SPENT' ? 'auto_trial' : 'ai_ops';
}

export default quotaReason;
