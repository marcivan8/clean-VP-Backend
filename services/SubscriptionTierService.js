// services/SubscriptionTierService.js
//
// Resolves a user's subscription tier from `profiles.plan` — the authoritative
// column, written by routes/stripeWebhook.js and read by middleware/usageGate.js.
//
// Replaces services/PolarService.js, which asked the Polar API over the network
// on every call. Polar is gone, so that service resolved EVERY user to the
// free tier; and because it fell back to free on any error it did so silently.
//
// WHY THIS READS THE DB AND NOT STRIPE: `profiles.plan` is already the single
// gate the whole app enforces against (R9). Asking Stripe here would add a
// second source of truth for entitlement that could disagree with the gate —
// the exact failure R46 and R98 are about. The live-from-Stripe read belongs in
// the billing UI (GET /api/stripe/subscription), where showing a stale "active"
// is the thing being avoided; it does not belong on a usage-stats hot path.
//
// SCOPE NOTE: the tier catalogue below is carried over from PolarService
// unchanged, including its limits. Those numbers look stale (they predate the
// current Free/Creator/Pro pricing, and ranked creator ABOVE pro) but they are a
// product decision, not a mechanical port, so they are left exactly as they
// were. The only thing that changed is where the tier comes FROM.

const { supabaseAdmin } = require('../config/database');

// Feature gate definitions keyed by tier name.
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

// profiles.plan → tier key. 'free' keeps the legacy 'explorer' key because
// routes/auth.js reads `tiers.explorer` by name.
const PLAN_TO_TIER = {
    free:    'explorer',
    creator: 'creator',
    pro:     'pro',
};

class SubscriptionTierService {
    /**
     * The user's tier, from profiles.plan.
     *
     * Resolution order: the user id (an exact primary-key read) then the email
     * (via the get_user_id_by_email RPC, since auth.users is not reachable
     * through PostgREST). Falls back to explorer when neither identifies a row.
     *
     * @param {string|null} userId
     * @param {string|null} userEmail
     * @returns {{ tier: object, source: string }}
     */
    async getUserTier(userId = null, userEmail = null) {
        try {
            let id = userId;

            if (!id && userEmail) {
                const { data: rpcId, error } = await supabaseAdmin
                    .rpc('get_user_id_by_email', { email_param: userEmail });
                if (error) {
                    console.error('[SubscriptionTierService] email lookup failed:', error.message);
                    return { tier: TIERS.explorer, source: 'fallback' };
                }
                id = rpcId ?? null;
            }

            if (!id) return { tier: TIERS.explorer, source: 'default' };

            const { data, error } = await supabaseAdmin
                .from('profiles')
                .select('plan')
                .eq('id', id)
                .maybeSingle();

            if (error) {
                console.error('[SubscriptionTierService] plan lookup failed:', error.message);
                return { tier: TIERS.explorer, source: 'fallback' };
            }
            if (!data) return { tier: TIERS.explorer, source: 'no_profile' };

            const tierKey = PLAN_TO_TIER[data.plan];
            if (!tierKey) {
                // An unrecognised plan value must not hand out a paid tier.
                return { tier: TIERS.explorer, source: 'unknown_plan' };
            }

            return { tier: TIERS[tierKey], source: 'profile' };
        } catch (err) {
            console.error('[SubscriptionTierService] getUserTier threw:', err.message);
            return { tier: TIERS.explorer, source: 'fallback' };
        }
    }

    /** The full tier catalogue (for UI display / seeding profiles). */
    getTiers() {
        return TIERS;
    }
}

module.exports = new SubscriptionTierService();
