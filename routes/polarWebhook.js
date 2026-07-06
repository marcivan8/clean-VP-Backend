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

const PLAN_TO_PRODUCT = {
    creator: process.env.POLAR_PRODUCT_CREATOR,
    pro:     process.env.POLAR_PRODUCT_PRO,
};

// Product ID → plan key mapping (mirrors PolarService.js)
const PRODUCT_TO_PLAN = Object.fromEntries([
    [process.env.POLAR_PRODUCT_PRO,     'pro'],
    [process.env.POLAR_PRODUCT_CREATOR, 'creator'],
].filter(([k]) => k));

async function setPlan(customerEmail, plan) {
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

    const { error } = await supabaseAdmin
        .from('profiles')
        .update({ plan })
        .eq('id', userId);

    if (error) console.error(`[PolarWebhook] Failed to set plan=${plan} for ${customerEmail}:`, error.message);
    else console.log(`[PolarWebhook] ${customerEmail} (id=${userId}) → plan=${plan}`);
}

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
                if (plan && email) await setPlan(email, plan);
                break;
            }
            case 'subscription.canceled':
            case 'subscription.revoked':
            case 'subscription.uncanceled': {
                // uncanceled = user re-subscribed before period ended — keep the plan
                if (type !== 'subscription.uncanceled' && email) {
                    await setPlan(email, 'free');
                }
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
