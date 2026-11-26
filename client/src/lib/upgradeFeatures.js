/**
 * client/src/lib/upgradeFeatures.js — which paid feature an upgrade prompt is
 * about (R172).
 *
 * Every refusal arrives on the shared QUOTA_EXCEEDED channel (or as a 402 from
 * the server) with a `reason` and, for plan-gated features, a code. The prompt
 * used to know only "paid_feature", so on mobile every one of them said
 * "Editing styles and Auto mode are available on Creator and Pro", including a
 * tap on Shorts or stock media. This module turns a payload into a feature key;
 * the copy for each key (what it does, what the plan adds, what you keep
 * without it) lives in locales/<lang>/common.json under `upgradeFeatures`.
 *
 * Pure: no React, no i18n.
 */

/** Feature key → the lowest plan that includes it. */
export const UPGRADE_FEATURES = {
    shorts: 'creator',
    stock: 'creator',
    editingStyles: 'creator',
    autoMode: 'creator',
    autoTrial: 'creator',
    aiOps: 'creator',
    projects: 'creator',
    designStudio: 'pro',
    social: 'pro',
    planner: 'pro',
};

/** Server 402 error codes (middleware/usageGate.js) → feature key. */
const CODE_TO_FEATURE = {
    AI_OPS_LIMIT: 'aiOps',
    AUTO_TRIAL_SPENT: 'autoTrial',
    STOCK_MEDIA_PAID: 'stock',
    DESIGN_STUDIO_PRO: 'designStudio',
    SOCIAL_PRO: 'social',
};

const REASON_TO_FEATURE = { ai_ops: 'aiOps', auto_trial: 'autoTrial', projects: 'projects' };

export function isUpgradeFeature(key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(UPGRADE_FEATURES, key);
}

/** The feature a refusal payload or a 402 body is about, or null. */
export function featureFromPayload(payload = {}) {
    if (!payload || typeof payload !== 'object') return null;
    if (isUpgradeFeature(payload.feature)) return payload.feature;
    const code = payload.code || payload.error;
    if (typeof code === 'string' && CODE_TO_FEATURE[code]) return CODE_TO_FEATURE[code];
    return REASON_TO_FEATURE[payload.reason] || null;
}

/**
 * The plan to offer: the one asked for if it is above the user's, else the
 * lowest plan that includes the feature, never a plan the user already has.
 */
export function planForFeature(feature, { upgradeTo, currentPlan = 'free' } = {}) {
    const rank = { free: 0, creator: 1, pro: 2 };
    const needed = UPGRADE_FEATURES[feature] || 'creator';
    const asked = rank[upgradeTo] ? upgradeTo : needed;
    const target = rank[asked] >= rank[needed] ? asked : needed;
    return rank[target] > (rank[currentPlan] ?? 0) ? target : (rank[currentPlan] < 2 ? 'pro' : null);
}

/**
 * The rest of the plan, without the lines the feature section already covers.
 * `overlap` is a list of words from the feature's copy (case-insensitive).
 */
export function otherPlanFeatures(planFeatures, overlap = [], limit = 3) {
    const words = (Array.isArray(overlap) ? overlap : []).map(w => String(w).toLowerCase()).filter(Boolean);
    return (Array.isArray(planFeatures) ? planFeatures : [])
        .filter(line => typeof line === 'string')
        .filter(line => !/^(everything in|tout dans)/i.test(line))
        .filter(line => !words.some(w => line.toLowerCase().includes(w)))
        .slice(0, limit);
}

export default { UPGRADE_FEATURES, featureFromPayload, planForFeature, otherPlanFeatures, isUpgradeFeature };
