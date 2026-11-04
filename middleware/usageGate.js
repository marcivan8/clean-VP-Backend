// middleware/usageGate.js
// One checkpoint for all AI-powered routes.
// -1 means unlimited.

const { supabaseAdmin } = require('../config/database');

const PLAN_LIMITS = {
    free:    { ai_ops: 3,   max_duration: 1200,  projects: 2,  storage_days: 7  },
    creator: { ai_ops: 100, max_duration: 5400,  projects: -1, storage_days: 30 },
    // storage_days is informational: services/retentionJob.js applies it.
    // Pro (null) keeps projects while the subscription is active.
    pro:     { ai_ops: -1,  max_duration: 14400, projects: -1, storage_days: null },
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

// Billable operations this UTC month. One Auto run is ONE operation however
// many gated requests it makes, and only rows the server gate wrote are
// counted -- see migrations/008_usage_run_ids.sql for why both of those
// matter. excludeRunId is the run being gated right now: a run's id is
// recorded by its first request, so counting it would make the run count
// against itself and refuse its own later steps.
async function getMonthlyOpsCount(userId, excludeRunId = null) {
    const { data, error } = await supabaseAdmin
        .rpc('count_monthly_ops', { p_user: userId, p_exclude: excludeRunId });

    if (error) {
        console.error('[usageGate] count error:', error.message);
        return 0;
    }
    return Number(data) || 0;
}

// Auto runs this account has ever made, for the one-time trial grant.
async function getLifetimeAutoRuns(userId, excludeRunId = null) {
    const { data, error } = await supabaseAdmin
        .rpc('count_lifetime_auto_runs', { p_user: userId, p_exclude: excludeRunId });

    if (error) {
        console.error('[usageGate] trial count error:', error.message);
        // Fail open: a DB hiccup must not spend someone's trial.
        return 0;
    }
    return Number(data) || 0;
}

async function recordUsageEvent(userId, operation, runId = null) {
    const { error } = await supabaseAdmin
        .from('usage_events')
        .insert({ user_id: userId, operation, run_id: runId });
    if (error) console.error('[usageGate] insert error:', error.message);
}

// How many Auto runs a brand new free account gets with styles and Auto
// unlocked. The published free plan locks both; this is a one-time trial so a
// beginner sees a finished short before the wall, not a plan change.
// Marc's decision, 2026-11-04.
const FREE_TRIAL_AUTO_RUNS = 3;

// A run groups the 3-5 gated requests one Auto run makes. The id comes from
// the client, so it is bounded on both sides: a replayed constant id would
// otherwise collapse every operation into one and hand out unlimited AI.
const RUN_MAX_REQUESTS = 12;
const RUN_MAX_AGE_MS   = 20 * 60 * 1000;

// Opaque to us. Bound the alphabet and length so nothing can be smuggled into
// the ledger and a row cannot grow without limit.
function readRunId(req) {
    const raw = (typeof req.get === 'function' && req.get('x-vibed-run-id'))
        || req.body?.runId
        || req.body?.ProjectContext?.runId
        || null;
    if (!raw) return null;
    const id = String(raw).trim();
    return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

// Decides whether this request may join the run it names. A run that is too
// old or too long stops collapsing, which caps what a replayed id can win at
// roughly one legitimate Auto run.
async function resolveRun(userId, runId) {
    if (!runId) return null;

    const { data, error } = await supabaseAdmin
        .from('usage_events')
        .select('created_at')
        .eq('user_id', userId)
        .eq('run_id', runId)
        .order('created_at', { ascending: true })
        .limit(RUN_MAX_REQUESTS + 1);

    // Fail open, as everywhere else here: a hiccup mid-run must not split the
    // run and charge it twice.
    if (error) {
        console.error('[usageGate] run lookup error:', error.message);
        return runId;
    }

    if (!data || data.length === 0) return runId;          // opens the run
    if (data.length >= RUN_MAX_REQUESTS) return null;      // too many requests
    const ageMs = Date.now() - new Date(data[0].created_at).getTime();
    if (ageMs > RUN_MAX_AGE_MS) return null;               // too old
    return runId;
}

// Whether this request is asking for something the published free plan locks.
function asksForStyleOrAuto(body) {
    if (!body) return false;
    const mode  = body.editingMode  || body.ProjectContext?.editingMode;
    const style = body.editingStyle || body.ProjectContext?.editingStyle;
    return mode === 'auto' || Boolean(style);
}

// Checks AI op limit, records the event, then calls next().
// Fails open on internal errors so a DB hiccup never blocks a paying user.
//
// Set BYPASS_USAGE_GATE=true in .env to skip quota checks during local dev/testing.
// Never set this in production.
const aiGate = async (req, res, next) => {
    if (process.env.BYPASS_USAGE_GATE === 'true') {
        return next();
    }

    if (!req.user?.id) {
        return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }
    const userId = req.user.id;

    try {
        const plan   = await getUserPlan(userId);
        const limits = PLAN_LIMITS[plan];

        // Which run, if any, this request belongs to.
        const runId = await resolveRun(userId, readRunId(req));

        // Volume. Counted "besides this run", so a run is admitted or refused
        // as a whole rather than dying partway through its own steps.
        if (limits.ai_ops !== -1) {
            const used = await getMonthlyOpsCount(userId, runId);
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

        req.userPlan    = plan;
        req.usageRunId  = runId;

        // Capability. The published free plan locks editing styles and Auto
        // mode, and it still does once the trial is spent. What changed on
        // 2026-11-04 is that a new account gets FREE_TRIAL_AUTO_RUNS runs with
        // both unlocked, because a beginner has to see a finished short before
        // meeting the wall.
        //
        // This used to silently rewrite editingMode 'auto' to 'normal' and
        // blank editingStyle. That is the one thing not to do: the request
        // succeeded, so the client believed Auto had run while the server had
        // quietly downgraded it to a different product. Out of trial we refuse
        // the request and say so, and the client shows the upgrade screen.
        req.autoTrialActive    = false;
        req.autoTrialRemaining = 0;

        if (plan === 'free') {
            const spent = await getLifetimeAutoRuns(userId, runId);
            req.autoTrialActive    = spent < FREE_TRIAL_AUTO_RUNS;
            req.autoTrialRemaining = Math.max(0, FREE_TRIAL_AUTO_RUNS - spent);

            if (!req.autoTrialActive && asksForStyleOrAuto(req.body)) {
                return res.status(402).json({
                    error:           'AUTO_TRIAL_SPENT',
                    message:         `You've used your ${FREE_TRIAL_AUTO_RUNS} free Auto edits.`,
                    used:            spent,
                    limit:           FREE_TRIAL_AUTO_RUNS,
                    plan,
                    upgradeRequired: 'creator',
                });
            }
        }

        // Record before forwarding so the count is accurate even if the
        // downstream handler errors: a failed job still consumed a slot.
        await recordUsageEvent(userId, req.path, runId);
        next();
    } catch (err) {
        console.error('[usageGate] aiGate error:', err.message);
        next(); // fail open
    }
};


// Blocks stock media searches and B-roll suggestions for free-tier users.
const stockGate = async (req, res, next) => {
    if (process.env.BYPASS_USAGE_GATE === 'true') {
        return next();
    }

    if (!req.user?.id) {
        if (process.env.NODE_ENV === 'production') {
            return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
        }
        return next();
    }

    try {
        const plan = await getUserPlan(req.user.id);
        if (plan === 'free') {
            return res.status(402).json({
                error:           'STOCK_MEDIA_PAID',
                message:         'Stock media is available on the Creator plan and above.',
                plan,
                upgradeRequired: 'creator',
            });
        }
        next();
    } catch (err) {
        console.error('[usageGate] stockGate error:', err.message);
        next(); // fail open
    }
};

module.exports = {
    aiGate,
    stockGate,
    PLAN_LIMITS,
    getUserPlan,
    FREE_TRIAL_AUTO_RUNS,
    RUN_MAX_REQUESTS,
    RUN_MAX_AGE_MS,
    readRunId,
    asksForStyleOrAuto,
};

