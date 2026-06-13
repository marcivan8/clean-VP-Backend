// middleware/usageGate.js
// One checkpoint for all AI-powered routes.
// -1 means unlimited.

const { supabaseAdmin } = require('../config/database');

const PLAN_LIMITS = {
    free:    { ai_ops: 10,  max_duration: 1200,  projects: 2,  storage_days: 7  },
    creator: { ai_ops: 100, max_duration: 5400,  projects: -1, storage_days: 30 },
    pro:     { ai_ops: -1,  max_duration: 14400, projects: -1, storage_days: 90 },
};

async function getUserPlan(userId) {
    try {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('plan')
            .eq('id', userId)
            .single();
        if (error || !data?.plan) return 'free';
        return PLAN_LIMITS[data.plan] ? data.plan : 'free';
    } catch {
        return 'free';
    }
}

async function getMonthlyOpsCount(userId) {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const { count, error } = await supabaseAdmin
        .from('usage_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', startOfMonth.toISOString());

    if (error) {
        console.error('[usageGate] count error:', error.message);
        return 0;
    }
    return count ?? 0;
}

async function recordUsageEvent(userId, operation) {
    const { error } = await supabaseAdmin
        .from('usage_events')
        .insert({ user_id: userId, operation });
    if (error) console.error('[usageGate] insert error:', error.message);
}

// Checks AI op limit, records the event, then calls next().
// Fails open on internal errors so a DB hiccup never blocks a paying user.
const aiGate = async (req, res, next) => {
    if (!req.user?.id) {
        return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }
    const userId = req.user.id;

    try {
        const plan   = await getUserPlan(userId);
        const limits = PLAN_LIMITS[plan];

        if (limits.ai_ops !== -1) {
            const used = await getMonthlyOpsCount(userId);
            if (used >= limits.ai_ops) {
                return res.status(402).json({
                    error:           'AI_OPS_LIMIT',
                    message:         `You've used all ${limits.ai_ops} AI operations this month.`,
                    used,
                    limit:           limits.ai_ops,
                    plan,
                    upgradeRequired: plan === 'free' ? 'creator' : 'pro',
                });
            }
        }

        // Record before forwarding so the count is accurate even if the
        // downstream handler errors — a failed job still consumed a slot.
        await recordUsageEvent(userId, req.path);
        next();
    } catch (err) {
        console.error('[usageGate] aiGate error:', err.message);
        next(); // fail open
    }
};

// Blocks NLE export for free-tier users.
const nleGate = async (req, res, next) => {
    if (!req.user?.id) {
        return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }

    try {
        const plan = await getUserPlan(req.user.id);
        if (plan === 'free') {
            return res.status(402).json({
                error:           'NLE_EXPORT_PAID',
                message:         'NLE export is available on the Creator plan and above.',
                plan,
                upgradeRequired: 'creator',
            });
        }
        next();
    } catch (err) {
        console.error('[usageGate] nleGate error:', err.message);
        next(); // fail open
    }
};

module.exports = { aiGate, nleGate, PLAN_LIMITS, getUserPlan };
