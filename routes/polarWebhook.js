// routes/polarWebhook.js
// Receives Polar subscription lifecycle events and keeps profiles.plan in sync.
//
// Setup in Polar dashboard → Webhooks:
//   URL:    https://your-backend.up.railway.app/api/polar/webhook
//   Events: subscription.created, subscription.updated, subscription.active,
//           subscription.canceled, subscription.revoked
//   Secret: copy the generated secret → POLAR_WEBHOOK_SECRET env var
//
// The route must receive the raw body (not JSON-parsed) for signature verification,
// so it uses express.raw() instead of express.json().

const express = require('express');
const router  = express.Router();
const { Polar } = require('@polar-sh/sdk');
const { validateEvent, WebhookVerificationError } = require('@polar-sh/sdk/webhooks');
const { supabaseAdmin } = require('../config/database');
const { authenticateUser } = require('../middleware/auth');

const polar = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN });

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
const PUBLIC_URL    = process.env.PUBLIC_URL || 'https://www.viralpilot.fr';

// Fire-and-forget call to the send-email edge function.
async function sendEmail(type, to, data) {
    if (!SUPABASE_URL || !SUPABASE_ANON) return;
    try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON}`,
            },
            body: JSON.stringify({ type, to, data }),
        });
    } catch (err) {
        console.warn('[PolarWebhook] sendEmail failed (non-blocking):', err.message);
    }
}

const PLAN_TO_PRODUCT = {
    creator: process.env.POLAR_PRODUCT_CREATOR,
    pro:     process.env.POLAR_PRODUCT_PRO,
};

// Product ID → plan key mapping (mirrors PolarService.js)
const PRODUCT_TO_PLAN = Object.fromEntries([
    [process.env.POLAR_PRODUCT_PRO,     'pro'],
    [process.env.POLAR_PRODUCT_CREATOR, 'creator'],
].filter(([k]) => k));

async function setPlan(customerEmail, plan, subscription = null) {
    if (!customerEmail) return;

    // profiles is keyed by UUID (id), not email.
    // Resolve the user's UUID via the helper function in migrations/004_billing_helper.sql.
    const { data: userId, error: lookupErr } = await supabaseAdmin
        .rpc('get_user_id_by_email', { email_param: customerEmail });

    if (lookupErr) {
        console.error(`[PolarWebhook] Could not look up user for ${customerEmail}:`, lookupErr.message);
        return;
    }
    if (!userId) {
        console.warn(`[PolarWebhook] No Supabase user found for email=${customerEmail} — skipping plan update`);
        return;
    }

    // Backfill the Polar identifiers while we have them. These columns already
    // existed but were populated on 0 of 45 production rows — nothing had ever
    // written them (same shape as R21/R38). Nothing READS them yet either:
    // findSubscriptionForUser resolves by email precisely so cancellation works
    // for existing customers who have no id stored. Populate them now so a
    // future lookup can be a single indexed read instead of an API round-trip;
    // do not make anything depend on them until they're backfilled everywhere.
    const patch = { plan };
    if (subscription) {
        if (subscription.id)         patch.polar_subscription_id = subscription.id;
        if (subscription.customerId) patch.polar_customer_id     = subscription.customerId;
        patch.subscription_status = subscription.status ?? (plan === 'free' ? 'canceled' : 'active');
        const periodEnd = subscription.currentPeriodEnd ?? subscription.current_period_end ?? null;
        if (periodEnd) patch.plan_expires_at = new Date(periodEnd).toISOString();
    } else if (plan === 'free') {
        patch.subscription_status = 'canceled';
        patch.plan_expires_at     = null;
    }

    const { error } = await supabaseAdmin
        .from('profiles')
        .update(patch)
        .eq('id', userId);

    if (error) {
        console.error(`[PolarWebhook] Failed to set plan=${plan} for ${customerEmail}:`, error.message);
        return;
    }

    console.log(`[PolarWebhook] ${customerEmail} (id=${userId}) → plan=${plan}`);

    // Send plan confirmation email (non-blocking)
    if (plan !== 'free') {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
        const firstName = (authUser?.user?.user_metadata?.full_name ?? customerEmail).split(' ')[0];

        const renewalDate = new Date();
        renewalDate.setMonth(renewalDate.getMonth() + 1);
        const renewalStr = renewalDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        const planPriceMap = { creator: '€15', pro: '€35' };

        await sendEmail('plan', customerEmail, {
            first_name:      firstName,
            plan_name:       plan.charAt(0).toUpperCase() + plan.slice(1),
            renewal_date:    renewalStr,
            plan_price:      planPriceMap[plan] ?? '€15',
            cta_url:         `${PUBLIC_URL}/dashboard`,
            account_url:     `${PUBLIC_URL}/account`,
            unsubscribe_url: `${PUBLIC_URL}/unsubscribe?uid=${userId}`,
        });
    }
}

/**
 * Record a REQUESTED cancellation. Deliberately does NOT touch `plan` — the
 * customer keeps the tier they paid for until Polar sends `subscription.revoked`
 * (see the webhook switch below).
 *
 * Pass `data = null` to clear the flag (the un-cancel case).
 */
async function markCancellation(customerEmail, data) {
    if (!customerEmail) return;

    const { data: userId, error: lookupErr } = await supabaseAdmin
        .rpc('get_user_id_by_email', { email_param: customerEmail });

    if (lookupErr || !userId) {
        console.warn(`[PolarWebhook] markCancellation: no user for ${customerEmail}`);
        return;
    }

    const endsAt = data
        ? (data.endsAt ?? data.ends_at ?? data.currentPeriodEnd ?? data.current_period_end ?? null)
        : null;

    const { error } = await supabaseAdmin
        .from('profiles')
        .update({
            subscription_status: data ? 'canceled' : 'active',
            plan_expires_at:     endsAt ? new Date(endsAt).toISOString() : null,
        })
        .eq('id', userId);

    if (error) {
        console.error(`[PolarWebhook] markCancellation failed for ${customerEmail}:`, error.message);
        return;
    }

    console.log(
        data
            ? `[PolarWebhook] ${customerEmail} cancellation pending — access until ${endsAt || 'period end'}`
            : `[PolarWebhook] ${customerEmail} un-cancelled — subscription continues`
    );
}

/**
 * Find the caller's current Polar subscription.
 *
 * Looks up by customer EMAIL rather than `profiles.polar_subscription_id`,
 * because that column — although it exists — is populated on 0 of 45 rows in
 * production: nothing has ever written it (same shape as R21/R38). Building
 * cancellation on it would silently fail for every existing customer. The
 * webhook now backfills it opportunistically, but nothing here depends on that.
 *
 * Returns null when Polar is unconfigured or the user has no subscription.
 */
async function findSubscriptionForUser(email) {
    if (!email || !process.env.POLAR_ACCESS_TOKEN) return null;

    try {
        const result = await polar.subscriptions.list({ customerEmail: email, active: true });
        // The SDK returns a paginated iterator; the first page is enough — a
        // customer with more than one active subscription is already an edge
        // case we surface rather than guess at.
        const items = result?.result?.items ?? result?.items ?? [];
        if (!items.length) return null;

        // Prefer one that is not already scheduled for cancellation.
        return items.find(s => !s.cancelAtPeriodEnd) ?? items[0];
    } catch (err) {
        console.error('[PolarBilling] subscription lookup failed:', err?.message || err);
        return null;
    }
}

// ── GET /api/polar/subscription ──────────────────────────────────────────────
// Current billing state for the signed-in user. Read straight from Polar so the
// UI can never show a stale "active" for something already cancelled.
router.get('/subscription', authenticateUser, async (req, res) => {
    try {
        const sub = await findSubscriptionForUser(req.user.email);

        if (!sub) {
            return res.json({
                active: false, plan: 'free', cancelAtPeriodEnd: false,
                currentPeriodEnd: null, canCancel: false,
            });
        }

        return res.json({
            active:            sub.status === 'active',
            plan:              PRODUCT_TO_PLAN[sub.productId] ?? 'free',
            status:            sub.status,
            cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
            // The date access actually ends. What the UI should show as
            // "you keep <plan> until …" after a cancellation.
            currentPeriodEnd:  sub.endsAt ?? sub.currentPeriodEnd ?? null,
            canCancel:         sub.status === 'active' && !sub.cancelAtPeriodEnd,
        });
    } catch (err) {
        console.error('[PolarBilling] /subscription error:', err?.message || err);
        return res.status(500).json({ error: 'Could not load subscription status' });
    }
});

// ── POST /api/polar/cancel ───────────────────────────────────────────────────
// Schedules cancellation at the END of the paid period. The user keeps their
// tier until then; the downgrade happens when Polar sends subscription.revoked.
//
// Body (both optional): { reason, comment }
// `reason` must be one of Polar's enum values — anything else is dropped rather
// than passed through, since an invalid value fails the whole call.
const CANCELLATION_REASONS = new Set([
    'too_expensive', 'missing_features', 'switched_service', 'unused',
    'customer_service', 'low_quality', 'too_complex', 'other',
]);

router.post('/cancel', authenticateUser, async (req, res) => {
    const { reason, comment } = req.body || {};

    try {
        // Ownership: the subscription is resolved FROM the authenticated user's
        // email, never from a client-supplied id. A subscription id in the
        // request body is ignored entirely — otherwise any signed-in user could
        // cancel someone else's plan by guessing an id.
        const sub = await findSubscriptionForUser(req.user.email);

        if (!sub) {
            return res.status(404).json({
                error: 'No active subscription found for this account.',
                canceled: false,
            });
        }
        if (sub.cancelAtPeriodEnd) {
            // Already scheduled — report the real state, don't claim to have
            // done something (R30: never a success message over a no-op).
            return res.json({
                canceled: true, alreadyScheduled: true,
                currentPeriodEnd: sub.endsAt ?? sub.currentPeriodEnd ?? null,
                message: 'This subscription is already scheduled to cancel.',
            });
        }

        const updated = await polar.subscriptions.update({
            id: sub.id,
            subscriptionUpdate: {
                cancelAtPeriodEnd: true,
                ...(CANCELLATION_REASONS.has(reason) ? { customerCancellationReason: reason } : {}),
                ...(typeof comment === 'string' && comment.trim()
                    ? { customerCancellationComment: comment.trim().slice(0, 1000) }
                    : {}),
            },
        });

        // Verify rather than assume. If Polar accepted the call but did not set
        // the flag, saying "cancelled" would be the worst possible lie here.
        if (!updated?.cancelAtPeriodEnd) {
            console.error(`[PolarBilling] cancel did not take effect for ${req.user.email} (sub ${sub.id})`);
            return res.status(502).json({
                error: 'Polar did not confirm the cancellation. Your subscription is unchanged — please try again.',
                canceled: false,
            });
        }

        const endsAt = updated.endsAt ?? updated.currentPeriodEnd ?? null;
        console.log(`[PolarBilling] ${req.user.email} cancelled sub ${sub.id} — access until ${endsAt}`);

        // The subscription.canceled webhook will also fire and record this;
        // writing it here too means the UI is correct immediately rather than
        // after webhook round-trip latency.
        await markCancellation(req.user.email, updated).catch(() => {});

        return res.json({
            canceled:         true,
            currentPeriodEnd: endsAt,
            message:          'Your subscription will not renew. You keep full access until the end of your current billing period.',
        });
    } catch (err) {
        const detail = err?.body ?? err?.message ?? String(err);
        console.error('[PolarBilling] cancel failed:', JSON.stringify(detail, null, 2));
        return res.status(500).json({
            error: 'Could not cancel the subscription. It has not been changed.',
            canceled: false,
            detail: process.env.NODE_ENV !== 'production' ? detail : undefined,
        });
    }
});

// ── POST /api/polar/reactivate ───────────────────────────────────────────────
// Undo a scheduled cancellation, while the period is still running.
router.post('/reactivate', authenticateUser, async (req, res) => {
    try {
        const sub = await findSubscriptionForUser(req.user.email);

        if (!sub) {
            return res.status(404).json({ error: 'No subscription found for this account.', reactivated: false });
        }
        if (!sub.cancelAtPeriodEnd) {
            return res.json({
                reactivated: true, alreadyActive: true,
                message: 'This subscription was not scheduled to cancel.',
            });
        }

        const updated = await polar.subscriptions.update({
            id: sub.id,
            subscriptionUpdate: { cancelAtPeriodEnd: false },
        });

        if (updated?.cancelAtPeriodEnd) {
            return res.status(502).json({
                error: 'Polar did not confirm the change. Your subscription is still scheduled to cancel.',
                reactivated: false,
            });
        }

        console.log(`[PolarBilling] ${req.user.email} reactivated sub ${sub.id}`);
        await markCancellation(req.user.email, null).catch(() => {});

        return res.json({ reactivated: true, message: 'Your subscription will renew as normal.' });
    } catch (err) {
        console.error('[PolarBilling] reactivate failed:', err?.message || err);
        return res.status(500).json({ error: 'Could not reactivate the subscription.', reactivated: false });
    }
});

// ── POST /api/polar/portal ───────────────────────────────────────────────────
// Short-lived link to Polar's hosted customer portal: invoices, payment method,
// and cancellation. Card data never touches this server.
router.post('/portal', authenticateUser, async (req, res) => {
    try {
        const sub = await findSubscriptionForUser(req.user.email);
        const customerId = sub?.customerId
            ?? sub?.customer?.id
            ?? null;

        if (!customerId) {
            return res.status(404).json({
                error: 'No billing account found for this email. Subscribe first, then manage billing here.',
            });
        }

        const session = await polar.customerSessions.create({ customerId });

        if (!session?.customerPortalUrl) {
            return res.status(502).json({ error: 'Polar did not return a portal URL.' });
        }

        return res.json({ url: session.customerPortalUrl, expiresAt: session.expiresAt ?? null });
    } catch (err) {
        console.error('[PolarBilling] portal session failed:', err?.message || err);
        return res.status(500).json({ error: 'Could not open the billing portal.' });
    }
});

router.post(
    '/webhook',
    express.raw({ type: 'application/json' }), // must be raw for HMAC verification
    async (req, res) => {
        const secret = process.env.POLAR_WEBHOOK_SECRET;
        if (!secret) {
            console.warn('[PolarWebhook] POLAR_WEBHOOK_SECRET not set — skipping signature check');
        } else {
            try {
                validateEvent(req.body, req.headers, secret);
            } catch (err) {
                if (err instanceof WebhookVerificationError) {
                    console.warn('[PolarWebhook] Invalid signature:', err.message);
                    return res.status(403).json({ error: 'Invalid webhook signature' });
                }
                throw err;
            }
        }

        let event;
        try {
            event = JSON.parse(req.body.toString());
        } catch {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }

        const { type, data } = event;
        const email     = data?.customer?.email ?? data?.customerEmail ?? null;
        const productId = data?.productId ?? data?.product?.id ?? null;

        console.log(`[PolarWebhook] ${type} | email=${email} | product=${productId}`);

        switch (type) {
            case 'subscription.created':
            case 'subscription.updated':
            case 'subscription.active': {
                const plan = PRODUCT_TO_PLAN[productId];
                if (plan && email) await setPlan(email, plan, data);
                break;
            }
            // ── CANCELED ≠ REVOKED. Do not collapse these again. ──────────────
            // Polar sends `subscription.canceled` when the customer REQUESTS
            // cancellation. With cancel_at_period_end (what POST /cancel below
            // sets, and what the Polar portal sets), they keep full access until
            // the end of the period they have already paid for — which can be
            // 29 days away.
            //
            // This branch used to downgrade to 'free' on BOTH events. That was
            // harmless only because nothing could cancel yet; the moment a cancel
            // button exists it means a user who cancels on day 2 of a paid month
            // loses Creator/Pro instantly while still being paid up. Access the
            // customer has paid for must not be revoked early.
            case 'subscription.canceled': {
                // Record the pending cancellation for the UI; do NOT touch plan.
                if (email) await markCancellation(email, data);
                break;
            }

            // Access has actually ended (period elapsed, or an immediate revoke
            // from the Polar dashboard). THIS is the downgrade point.
            case 'subscription.revoked': {
                if (email) await setPlan(email, 'free');
                break;
            }

            // The customer un-cancelled before the period ended — clear the
            // pending flag. Their plan was never changed, so nothing to restore.
            case 'subscription.uncanceled': {
                if (email) await markCancellation(email, null);
                break;
            }
            default:
                // Ignore other event types (order.created, benefit.granted, etc.)
                break;
        }

        res.json({ received: true });
    }
);

// POST /api/polar/checkout  or  POST /api/checkout/create
// Creates a Polar checkout session and returns the URL.
// Body: { plan: 'creator' | 'pro' }
router.post('/create', authenticateUser, async (req, res) => handleCheckout(req, res));
router.post('/checkout', authenticateUser, async (req, res) => handleCheckout(req, res));

async function handleCheckout(req, res) {
    const { plan } = req.body;

    if (!PLAN_TO_PRODUCT[plan]) {
        return res.status(400).json({ error: `Invalid plan "${plan}". Must be "creator" or "pro".` });
    }

    const productId = PLAN_TO_PRODUCT[plan];
    if (!productId) {
        return res.status(503).json({ error: `Product ID for plan "${plan}" is not configured.` });
    }

    const baseUrl    = process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'https://www.viralpilot.fr';
    const successUrl = process.env.POLAR_SUCCESS_URL ||
        `${baseUrl}/success?checkout_id={CHECKOUT_ID}`;

    // Polar requires an absolute URL — catch relative fallbacks before the API call
    if (!successUrl.startsWith('http')) {
        console.error('[PolarCheckout] successUrl is not absolute:', successUrl);
        return res.status(500).json({ error: 'POLAR_SUCCESS_URL must be an absolute URL (https://...)' });
    }

    try {
        const checkout = await polar.checkouts.create({
            products:      [productId],
            successUrl,
            customerEmail: req.user.email ?? undefined,
        });

        console.log(`[PolarCheckout] Created checkout for ${req.user.email} → plan=${plan} url=${checkout.url}`);
        res.json({ url: checkout.url, checkoutUrl: checkout.url });
    } catch (err) {
        // Log the full Polar SDK error — it carries status + body, not just message
        const detail = err?.body ?? err?.rawResponse ?? err?.message ?? String(err);
        console.error('[PolarCheckout] Failed to create checkout:', JSON.stringify(detail, null, 2));
        res.status(500).json({
            error:  'Failed to create checkout session',
            detail: process.env.NODE_ENV !== 'production' ? detail : undefined,
        });
    }
}

module.exports = router;
