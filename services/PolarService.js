// services/PolarService.js
// Wraps Polar.sh to resolve a user's active subscription tier.
//
// Environment variables required (set in Railway):
//   POLAR_ACCESS_TOKEN   — server-side API token from Polar dashboard
//
// Polar product slug → internal tier name mapping:
//   POLAR_PRODUCT_PRO    — e.g. "prod_abc123" — maps to 'pro'
//   POLAR_PRODUCT_CREATOR — e.g. "prod_def456" — maps to 'creator'
//
// If Polar is not configured (no POLAR_ACCESS_TOKEN), every user falls
// back to the 'explorer' tier with the hardcoded 20-analysis limit.

const { Polar } = require('@polar-sh/sdk');

// Feature gate definitions keyed by tier name.
// Add new tiers/limits here as you create Polar products.
const TIERS = {
    explorer: {
        name:   'Explorer',
        limits: { videoAnalyses: 20 },
        period: 'monthly',
    },
    pro: {
        name:   'Pro',
        limits: { videoAnalyses: 200 },
        period: 'monthly',
    },
    creator: {
        name:   'Creator',
        limits: { videoAnalyses: Infinity },
        period: 'monthly',
    },
};

// Map Polar product IDs → tier keys.
// Set these env vars to the product IDs shown in your Polar dashboard.
const PRODUCT_TO_TIER = Object.fromEntries([
    [process.env.POLAR_PRODUCT_PRO,     'pro'],
    [process.env.POLAR_PRODUCT_CREATOR, 'creator'],
].filter(([k]) => k));

class PolarService {
    constructor() {
        this._client = process.env.POLAR_ACCESS_TOKEN
            ? new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN })
            : null;

        if (!this._client) {
            console.warn('[PolarService] POLAR_ACCESS_TOKEN not set — all users default to explorer tier');
        }
    }

    /**
     * Returns the tier definition for a given user based on their active
     * Polar subscription. Falls back to explorer if Polar is unconfigured,
     * the user has no subscription, or the API call fails.
     *
     * @param {string} userEmail - The user's email address (used to look up their Polar customer record)
     * @returns {{ tier: object, source: string }}
     */
    async getUserTier(userEmail) {
        if (!this._client || !userEmail) {
            return { tier: TIERS.explorer, source: 'default' };
        }

        try {
            // List active subscriptions for this customer email.
            const result = await this._client.subscriptions.list({
                customerEmail: userEmail,
                active: true,
            });

            const subscriptions = result?.items ?? [];
            if (subscriptions.length === 0) {
                return { tier: TIERS.explorer, source: 'no_subscription' };
            }

            // Pick the highest tier the user is subscribed to.
            const tierPriority = ['creator', 'pro', 'explorer'];
            let resolved = 'explorer';

            for (const sub of subscriptions) {
                const tierKey = PRODUCT_TO_TIER[sub.productId];
                if (tierKey && tierPriority.indexOf(tierKey) < tierPriority.indexOf(resolved)) {
                    resolved = tierKey;
                }
            }

            return { tier: TIERS[resolved], source: 'polar' };
        } catch (err) {
            console.error('[PolarService] Failed to fetch subscription, defaulting to explorer:', err.message);
            return { tier: TIERS.explorer, source: 'fallback' };
        }
    }

    /**
     * Returns the full tier catalogue (for UI display / seeding profiles).
     */
    getTiers() {
        return TIERS;
    }
}

module.exports = new PolarService();
