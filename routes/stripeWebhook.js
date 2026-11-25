// routes/stripeWebhook.js
// Stripe subscription lifecycle + the authenticated billing endpoints.
//
// Replaces routes/polarWebhook.js. Every property R46 / R54 / R30 pinned for the
// Polar implementation is preserved here, mapped onto Stripe's event names:
//
//   Polar                          Stripe
//   ─────────────────────────────  ──────────────────────────────────────────────
//   subscription.created/active    checkout.session.completed
//                                  customer.subscription.created
//   subscription.canceled          customer.subscription.updated
//     (requested, keep access)       with cancel_at_period_end === true
//   subscription.uncanceled        customer.subscription.updated
//                                    with cancel_at_period_end === false
//   subscription.revoked           customer.subscription.deleted   ← THE downgrade
//   order.created (renewal)        invoice.paid, billing_reason subscription_cycle
//
// Setup in the Stripe dashboard → Developers → Webhooks:
//   URL:    https://<this backend>/api/stripe/webhook
//   Events: checkout.session.completed, customer.subscription.created,
//           customer.subscription.updated, customer.subscription.deleted,
//           invoice.paid, invoice.payment_failed
//   Secret: copy the signing secret → STRIPE_WEBHOOK_SECRET
//
// ── THE RAW BODY IS NOT OPTIONAL, AND A ROUTE-LEVEL express.raw() DOES NOT WORK ──
// index.js mounts `express.json()` globally well before any router. body-parser
// sets `req._body = true` once it has parsed, and `express.raw()` returns early
// when it sees that flag — so a route-level raw parser on a router mounted after
// the global json parser is a silent no-op and `req.body` arrives as a parsed
// OBJECT. Stripe's constructEvent needs the exact bytes that were signed, so the
// webhook is exported SEPARATELY from the router and index.js mounts it, with its
// own express.raw(), BEFORE the global json parser. Do not fold it back into the
// router. (The Polar webhook this replaced had exactly that bug: its signature
// check could never have passed against a real delivery.)

const express = require('express');
const Stripe  = require('stripe');
const router  = express.Router();
const { supabaseAdmin } = require('../config/database');
const { authenticateUser } = require('../middleware/auth');
const { sendTransactionalEmail } = require('../services/emailClient');

const PUBLIC_URL = process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'https://www.viralpilot.fr';

// Lazily constructed so the module can be required (and unit-tested) with no key
// configured. Returns null when unconfigured; every caller must handle that.
let _stripe = null;
function stripeClient() {
    if (_stripe) return _stripe;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    _stripe = new Stripe(key);
    return _stripe;
}
function isStripeConfigured() { return Boolean(process.env.STRIPE_SECRET_KEY); }

// Fire-and-forget call to the send-email edge function (service role auth).
async function sendEmail(type, to, data) {
    await sendTransactionalEmail(type, to, data);
}

// ── Plan ↔ price resolution ──────────────────────────────────────────────────
// Three tiers, cheapest first, so this keeps working when the env vars are not
// set (a fresh deploy, a new Stripe account) instead of silently resolving every
// subscription to "no plan" and leaving profiles.plan untouched.
//   1. STRIPE_PRICE_CREATOR / STRIPE_PRICE_PRO     (exact price id)
//   2. the price's lookup_key                       (stable across price swaps)
//   3. the price's own metadata.plan_key            (set on the price in Stripe)
const PLAN_KEYS = new Set(['creator', 'pro']);

const PLAN_TO_PRICE_ENV = {
    creator: process.env.STRIPE_PRICE_CREATOR,
    pro:     process.env.STRIPE_PRICE_PRO,
};

const PRICE_TO_PLAN = Object.fromEntries(
    Object.entries(PLAN_TO_PRICE_ENV)
        .filter(([, priceId]) => priceId)
        .map(([plan, priceId]) => [priceId, plan])
);

// The lookup keys set on the live prices. Prefer these over raw ids when wiring
// a new environment: a price can be archived and replaced while the lookup key
// is transferred to its successor.
const LOOKUP_TO_PLAN = {
    vibed_creator_monthly: 'creator',
    vibed_pro_monthly:     'pro',
};
const PLAN_TO_LOOKUP = {
    creator: 'vibed_creator_monthly',
    pro:     'vibed_pro_monthly',
};

function planForPrice(price) {
    if (!price) return null;
    const id = typeof price === 'string' ? price : price.id;
    if (id && PRICE_TO_PLAN[id]) return PRICE_TO_PLAN[id];
    if (price && typeof price === 'object') {
        const byLookup = price.lookup_key ? LOOKUP_TO_PLAN[price.lookup_key] : null;
        if (byLookup) return byLookup;
        const byMeta = price.metadata?.plan_key;
        if (PLAN_KEYS.has(byMeta)) return byMeta;
    }
    return null;
}

function planForSubscription(sub) {
    const items = sub?.items?.data ?? [];
    for (const item of items) {
        const plan = planForPrice(item?.price);
        if (plan) return plan;
    }
    // A subscription created outside our checkout may carry the plan in metadata.
    const metaPlan = sub?.metadata?.plan_key ?? sub?.metadata?.plan;
    return PLAN_KEYS.has(metaPlan) ? metaPlan : null;
}

// Resolve a plan's price id, caching what the API tells us so a checkout does
// not cost an extra round-trip per request.
const _priceIdCache = new Map();
async function priceIdForPlan(plan) {
    if (PLAN_TO_PRICE_ENV[plan]) return PLAN_TO_PRICE_ENV[plan];
    if (_priceIdCache.has(plan)) return _priceIdCache.get(plan);

    const stripe = stripeClient();
    const lookupKey = PLAN_TO_LOOKUP[plan];
    if (!stripe || !lookupKey) return null;

    try {
        const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
        const id = found?.data?.[0]?.id ?? null;
        if (id) _priceIdCache.set(plan, id);
        return id;
    } catch (err) {
        console.error(`[StripeBilling] price lookup failed for plan=${plan}:`, err?.message || err);
        return null;
    }
}

// A subscription in one of these states entitles the customer to their tier.
// `past_due` deliberately is NOT here: Stripe is still retrying the card, and
// downgrading mid-dunning takes away access the customer is likely to keep.
const ENTITLED_STATUSES = new Set(['active', 'trialing']);

/**
 * The id of a Stripe reference that may arrive either expanded (an object) or
 * as a bare id string. Webhook payloads mix both shapes depending on the event
 * and on what the dashboard was configured to expand.
 */
function refId(ref) {
    if (!ref) return null;
    return typeof ref === 'string' ? ref : (ref.id ?? null);
}
const customerIdOf = refId;

/**
 * The price reference on an invoice line.
 *
 * `line.price` was moved to `line.pricing.price_details.price` in the 2025 API
 * versions. Reading only one shape silently yields null on the other, which
 * degrades the renewal receipt to a generic "Your plan" — cosmetic, but exactly
 * the kind of version drift that is invisible until someone reads an email.
 */
function priceRefFromInvoiceLine(line) {
    return line?.price
        ?? line?.pricing?.price_details?.price
        ?? null;
}

/**
 * Resolve the plan an invoice is for. Retrieves the price only when the line
 * carries a bare id and the env price map cannot resolve it.
 */
async function planForInvoice(invoice) {
    const line = invoice?.lines?.data?.[0];
    const priceRef = priceRefFromInvoiceLine(line);

    const direct = planForPrice(priceRef);
    if (direct) return direct;

    const id = refId(priceRef);
    const stripe = stripeClient();
    if (!id || !stripe) return null;
    try {
        return planForPrice(await stripe.prices.retrieve(id));
    } catch {
        return null;
    }
}

/** The customer's email. Retrieves the customer only when it is not expanded. */
async function customerEmailFor(customerRef) {
    if (!customerRef) return null;
    if (typeof customerRef === 'object') return customerRef.email ?? null;

    const stripe = stripeClient();
    if (!stripe) return null;
    try {
        const customer = await stripe.customers.retrieve(customerRef);
        return customer?.deleted ? null : (customer?.email ?? null);
    } catch (err) {
        console.error('[StripeBilling] customer lookup failed:', err?.message || err);
        return null;
    }
}

/**
 * When the period the customer has paid for ends, as an ISO string.
 *
 * `current_period_end` lives on the Subscription in older API versions and on
 * each SubscriptionItem in newer ones, so BOTH are read. Reading only the top
 * level returns undefined on a current API version, which lands as a null
 * `plan_expires_at` — and services/retentionJob.js treats a null expiry as
 * "active forever", so the error is silent rather than loud.
 */
function periodEndIso(sub) {
    const seconds = sub?.current_period_end
        ?? sub?.items?.data?.[0]?.current_period_end
        ?? null;
    if (!Number.isFinite(seconds)) return null;
    const d = new Date(seconds * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The date access actually ends once a cancellation is scheduled. */
function accessEndsIso(sub) {
    const cancelAt = Number.isFinite(sub?.cancel_at) ? new Date(sub.cancel_at * 1000).toISOString() : null;
    return cancelAt ?? periodEndIso(sub);
}

/** The price actually charged, formatted — never a hardcoded price list (R54). */
function priceLabelFor(sub) {
    const price = sub?.items?.data?.[0]?.price;
    const amount = price?.unit_amount;
    if (!Number.isFinite(amount)) return '';
    const currency = (price?.currency || 'eur').toUpperCase();
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
    } catch {
        return '';
    }
}

// ── User resolution ──────────────────────────────────────────────────────────
/**
 * Find the Supabase user a Stripe event belongs to.
 *
 * Order matters. `userId` comes from our own checkout (`client_reference_id`)
 * and is the only identifier that cannot drift; `stripe_customer_id` is an exact
 * indexed match; email is last because a customer can change it in Stripe's
 * portal, at which point an email-only lookup stops finding the account.
 *
 * Returns { userId, email } or null.
 */
async function resolveUser({ userId = null, stripeCustomerId = null, email = null }) {
    if (userId) {
        let resolvedEmail = email;
        if (!resolvedEmail) {
            try {
                const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
                resolvedEmail = data?.user?.email ?? null;
            } catch { /* email is only needed for the receipt */ }
        }
        return { userId, email: resolvedEmail };
    }

    if (stripeCustomerId) {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('id, email')
            .eq('stripe_customer_id', stripeCustomerId)
            .maybeSingle();
        if (!error && data?.id) return { userId: data.id, email: data.email ?? email };
    }

    if (email) {
        const { data: rpcId, error: lookupErr } = await supabaseAdmin
            .rpc('get_user_id_by_email', { email_param: email });
        if (lookupErr) {
            console.error(`[StripeWebhook] Could not look up user for ${email}:`, lookupErr.message);
            return null;
        }
        if (rpcId) return { userId: rpcId, email };
    }

    console.warn(
        `[StripeWebhook] No Supabase user for customer=${stripeCustomerId || 'n/a'} email=${email || 'n/a'} — skipping`
    );
    return null;
}

// ── Plan writes ──────────────────────────────────────────────────────────────
/**
 * Set a user's plan, and record the Stripe identifiers alongside it.
 *
 * The confirmation email fires ONLY when the plan actually changed. Stripe sends
 * customer.subscription.updated for many things (an un-cancel, a card update, a
 * proration) and also re-delivers events on retry; mailing on every call would
 * spam a paying customer with "your plan is live" for changes they did not make.
 */
async function setPlan({ userId = null, email = null, plan, subscription = null, stripeCustomerId = null }) {
    const customerId = stripeCustomerId ?? customerIdOf(subscription?.customer);
    const who = await resolveUser({ userId, stripeCustomerId: customerId, email });
    if (!who) return;

    const { data: before } = await supabaseAdmin
        .from('profiles')
        .select('plan')
        .eq('id', who.userId)
        .maybeSingle();
    const previousPlan = before?.plan ?? null;

    const patch = { plan };
    if (customerId) patch.stripe_customer_id = customerId;

    if (subscription) {
        if (subscription.id) patch.stripe_subscription_id = subscription.id;
        patch.subscription_status = subscription.status ?? (plan === 'free' ? 'canceled' : 'active');
        const endsAt = periodEndIso(subscription);
        if (endsAt) patch.plan_expires_at = endsAt;
    } else if (plan === 'free') {
        patch.subscription_status = 'canceled';
        patch.plan_expires_at     = null;
    }

    const { error } = await supabaseAdmin
        .from('profiles')
        .update(patch)
        .eq('id', who.userId);

    if (error) {
        console.error(`[StripeWebhook] Failed to set plan=${plan} for ${who.userId}:`, error.message);
        return;
    }

    console.log(`[StripeWebhook] ${who.email || who.userId} → plan=${plan} (was ${previousPlan ?? 'unknown'})`);

    if (plan === 'free' || plan === previousPlan || !who.email) return;

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(who.userId);
    const firstName = (authUser?.user?.user_metadata?.full_name ?? who.email).split(' ')[0];

    const renewalIso = periodEndIso(subscription);
    const renewalStr = renewalIso
        ? new Date(renewalIso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : 'your next billing date';

    await sendEmail('plan', who.email, {
        first_name:      firstName,
        plan_name:       plan.charAt(0).toUpperCase() + plan.slice(1),
        renewal_date:    renewalStr,
        plan_price:      priceLabelFor(subscription),
        cta_url:         `${PUBLIC_URL}/dashboard`,
        account_url:     `${PUBLIC_URL}/account`,
        unsubscribe_url: `${PUBLIC_URL}/unsubscribe?uid=${who.userId}`,
    });
}

/**
 * Record a REQUESTED cancellation. Deliberately does NOT touch `plan` — the
 * customer keeps the tier they paid for until Stripe sends
 * customer.subscription.deleted (see the webhook switch below).
 *
 * Pass `subscription = null` to clear the flag (the un-cancel case).
 */
async function markCancellation({ email = null, stripeCustomerId = null, subscription = null }) {
    const who = await resolveUser({ stripeCustomerId, email });
    if (!who) return;

    const endsAt = subscription ? accessEndsIso(subscription) : null;

    const { error } = await supabaseAdmin
        .from('profiles')
        .update({
            subscription_status: subscription ? 'canceled' : 'active',
            plan_expires_at:     endsAt,
        })
        .eq('id', who.userId);

    if (error) {
        console.error(`[StripeWebhook] markCancellation failed for ${who.userId}:`, error.message);
        return;
    }

    console.log(
        subscription
            ? `[StripeWebhook] ${who.email || who.userId} cancellation pending — access until ${endsAt || 'period end'}`
            : `[StripeWebhook] ${who.email || who.userId} un-cancelled — subscription continues`
    );
}

/**
 * Record a payment problem WITHOUT changing the tier. Stripe keeps retrying the
 * card for the whole dunning window; taking access away on the first failure
 * punishes a customer whose card simply expired. The downgrade still happens at
 * customer.subscription.deleted, once Stripe has actually given up.
 */
async function recordPaymentIssue({ email = null, stripeCustomerId = null, status = 'past_due' }) {
    const who = await resolveUser({ stripeCustomerId, email });
    if (!who) return;

    const { error } = await supabaseAdmin
        .from('profiles')
        .update({ subscription_status: status })
        .eq('id', who.userId);

    if (error) {
        console.error(`[StripeWebhook] recordPaymentIssue failed for ${who.userId}:`, error.message);
        return;
    }
    console.warn(`[StripeWebhook] ${who.email || who.userId} payment issue — status=${status}, plan unchanged`);
}

// ── Subscription lookup ──────────────────────────────────────────────────────
/**
 * Find the caller's current Stripe subscription.
 *
 * Resolves the Stripe customer from `profiles.stripe_customer_id` first and
 * falls back to an email search, because the column is empty for anyone who
 * subscribed before it was written (the same shape as R46's polar_* columns:
 * building cancellation on a column nothing had populated would have failed
 * silently for every existing customer).
 *
 * Returns null when Stripe is unconfigured or the user has no subscription.
 */
async function findSubscriptionForUser(user) {
    const stripe = stripeClient();
    if (!stripe || !user) return null;

    try {
        let customerId = null;

        if (user.id) {
            const { data } = await supabaseAdmin
                .from('profiles')
                .select('stripe_customer_id')
                .eq('id', user.id)
                .maybeSingle();
            customerId = data?.stripe_customer_id ?? null;
        }

        if (!customerId && user.email) {
            const found = await stripe.customers.list({ email: user.email, limit: 1 });
            customerId = found?.data?.[0]?.id ?? null;
        }
        if (!customerId) return null;

        const subs = await stripe.subscriptions.list({
            customer: customerId,
            status: 'all',
            limit: 10,
        });
        const items = (subs?.data ?? []).filter(s => ENTITLED_STATUSES.has(s.status) || s.status === 'past_due');
        if (!items.length) return null;

        // Prefer one that is not already scheduled for cancellation.
        return items.find(s => !s.cancel_at_period_end) ?? items[0];
    } catch (err) {
        console.error('[StripeBilling] subscription lookup failed:', err?.message || err);
        return null;
    }
}

/** The Stripe customer for this user, creating one if needed. */
async function ensureCustomerForUser(user) {
    const stripe = stripeClient();
    if (!stripe || !user?.id) return null;

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .maybeSingle();

    if (profile?.stripe_customer_id) return profile.stripe_customer_id;

    let customerId = null;
    if (user.email) {
        const found = await stripe.customers.list({ email: user.email, limit: 1 });
        customerId = found?.data?.[0]?.id ?? null;
    }
    if (!customerId) {
        const created = await stripe.customers.create({
            email: user.email ?? undefined,
            metadata: { user_id: user.id },
        });
        customerId = created.id;
    }

    await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);

    return customerId;
}

// ── GET /api/stripe/subscription ─────────────────────────────────────────────
// Current billing state for the signed-in user. Read straight from Stripe so the
// UI can never show a stale "active" for something already cancelled.
router.get('/subscription', authenticateUser, async (req, res) => {
    try {
        const sub = await findSubscriptionForUser(req.user);

        if (!sub) {
            return res.json({
                active: false, plan: 'free', cancelAtPeriodEnd: false,
                currentPeriodEnd: null, canCancel: false,
            });
        }

        return res.json({
            active:            ENTITLED_STATUSES.has(sub.status),
            plan:              planForSubscription(sub) ?? 'free',
            status:            sub.status,
            cancelAtPeriodEnd: !!sub.cancel_at_period_end,
            // The date access actually ends. What the UI should show as
            // "you keep <plan> until …" after a cancellation.
            currentPeriodEnd:  accessEndsIso(sub),
            canCancel:         ENTITLED_STATUSES.has(sub.status) && !sub.cancel_at_period_end,
        });
    } catch (err) {
        console.error('[StripeBilling] /subscription error:', err?.message || err);
        return res.status(500).json({ error: 'Could not load subscription status' });
    }
});

// ── POST /api/stripe/cancel ──────────────────────────────────────────────────
// Schedules cancellation at the END of the paid period. The user keeps their
// tier until then; the downgrade happens when Stripe sends
// customer.subscription.deleted.
//
// Body (both optional): { reason, comment }
// `reason` must be one of Stripe's cancellation_details.feedback enum values —
// anything else is dropped rather than passed through, since an invalid value
// fails the whole call.
const CANCELLATION_REASONS = new Set([
    'too_expensive', 'missing_features', 'switched_service', 'unused',
    'customer_service', 'low_quality', 'too_complex', 'other',
]);

router.post('/cancel', authenticateUser, async (req, res) => {
    const { reason, comment } = req.body || {};

    if (!isStripeConfigured()) {
        return res.status(503).json({ error: 'Billing is not configured.', canceled: false });
    }

    try {
        // Ownership: the subscription is resolved FROM the authenticated user,
        // never from a client-supplied id. A subscription id in the request body
        // is ignored entirely — otherwise any signed-in user could cancel
        // someone else's plan by guessing an id.
        const sub = await findSubscriptionForUser(req.user);

        if (!sub) {
            return res.status(404).json({
                error: 'No active subscription found for this account.',
                canceled: false,
            });
        }
        if (sub.cancel_at_period_end) {
            // Already scheduled — report the real state, don't claim to have
            // done something (R30: never a success message over a no-op).
            return res.json({
                canceled: true, alreadyScheduled: true,
                currentPeriodEnd: accessEndsIso(sub),
                message: 'This subscription is already scheduled to cancel.',
            });
        }

        const updated = await stripeClient().subscriptions.update(sub.id, {
            cancel_at_period_end: true,
            cancellation_details: {
                ...(CANCELLATION_REASONS.has(reason) ? { feedback: reason } : {}),
                ...(typeof comment === 'string' && comment.trim()
                    ? { comment: comment.trim().slice(0, 1000) }
                    : {}),
            },
        });

        // Verify rather than assume. If Stripe accepted the call but did not set
        // the flag, saying "cancelled" would be the worst possible lie here.
        if (!updated?.cancel_at_period_end) {
            console.error(`[StripeBilling] cancel did not take effect for ${req.user.id} (sub ${sub.id})`);
            return res.status(502).json({
                error: 'Stripe did not confirm the cancellation. Your subscription is unchanged — please try again.',
                canceled: false,
            });
        }

        const endsAt = accessEndsIso(updated);
        console.log(`[StripeBilling] ${req.user.email} cancelled sub ${sub.id} — access until ${endsAt}`);

        // The customer.subscription.updated webhook will also record this;
        // writing it here too means the UI is correct immediately rather than
        // after webhook round-trip latency.
        await markCancellation({
            email: req.user.email,
            stripeCustomerId: customerIdOf(updated.customer),
            subscription: updated,
        }).catch(() => {});

        return res.json({
            canceled:         true,
            currentPeriodEnd: endsAt,
            message:          'Your subscription will not renew. You keep full access until the end of your current billing period.',
        });
    } catch (err) {
        const detail = err?.raw ?? err?.message ?? String(err);
        console.error('[StripeBilling] cancel failed:', JSON.stringify(detail, null, 2));
        return res.status(500).json({
            error: 'Could not cancel the subscription. It has not been changed.',
            canceled: false,
            detail: process.env.NODE_ENV !== 'production' ? detail : undefined,
        });
    }
});

// ── POST /api/stripe/reactivate ──────────────────────────────────────────────
// Undo a scheduled cancellation, while the period is still running.
router.post('/reactivate', authenticateUser, async (req, res) => {
    if (!isStripeConfigured()) {
        return res.status(503).json({ error: 'Billing is not configured.', reactivated: false });
    }

    try {
        const sub = await findSubscriptionForUser(req.user);

        if (!sub) {
            return res.status(404).json({ error: 'No subscription found for this account.', reactivated: false });
        }
        if (!sub.cancel_at_period_end) {
            return res.json({
                reactivated: true, alreadyActive: true,
                message: 'This subscription was not scheduled to cancel.',
            });
        }

        const updated = await stripeClient().subscriptions.update(sub.id, {
            cancel_at_period_end: false,
        });

        if (updated?.cancel_at_period_end) {
            return res.status(502).json({
                error: 'Stripe did not confirm the change. Your subscription is still scheduled to cancel.',
                reactivated: false,
            });
        }

        console.log(`[StripeBilling] ${req.user.email} reactivated sub ${sub.id}`);
        await markCancellation({
            email: req.user.email,
            stripeCustomerId: customerIdOf(updated.customer),
            subscription: null,
        }).catch(() => {});

        return res.json({ reactivated: true, message: 'Your subscription will renew as normal.' });
    } catch (err) {
        console.error('[StripeBilling] reactivate failed:', err?.message || err);
        return res.status(500).json({ error: 'Could not reactivate the subscription.', reactivated: false });
    }
});

// ── POST /api/stripe/portal ──────────────────────────────────────────────────
// Short-lived link to Stripe's hosted customer portal: invoices, payment method,
// and cancellation. Card data never touches this server.
//
// NOTE: payout destination and bank details are configured in the Stripe
// dashboard only (Settings → Payouts) and must never be settable from code —
// see R46's reasoning, which applies here unchanged.
router.post('/portal', authenticateUser, async (req, res) => {
    if (!isStripeConfigured()) {
        return res.status(503).json({ error: 'Billing is not configured.' });
    }

    try {
        const customerId = await ensureCustomerForUser(req.user);

        if (!customerId) {
            return res.status(404).json({
                error: 'No billing account found for this email. Subscribe first, then manage billing here.',
            });
        }

        const session = await stripeClient().billingPortal.sessions.create({
            customer:   customerId,
            return_url: `${PUBLIC_URL}/account`,
        });

        if (!session?.url) {
            return res.status(502).json({ error: 'Stripe did not return a portal URL.' });
        }

        return res.json({ url: session.url, expiresAt: null });
    } catch (err) {
        console.error('[StripeBilling] portal session failed:', err?.message || err);
        return res.status(500).json({
            error: 'Could not open the billing portal. If this is the first time, enable the customer portal in the Stripe dashboard.',
        });
    }
});

// ── POST /api/stripe/checkout  ·  POST /api/checkout/create ──────────────────
// Creates a Stripe Checkout session and returns the URL.
// Body: { plan: 'creator' | 'pro' }
router.post('/create',   authenticateUser, (req, res) => handleCheckout(req, res));
router.post('/checkout', authenticateUser, (req, res) => handleCheckout(req, res));

async function handleCheckout(req, res) {
    const { plan } = req.body || {};

    if (!PLAN_KEYS.has(plan)) {
        return res.status(400).json({ error: `Invalid plan "${plan}". Must be "creator" or "pro".` });
    }
    if (!isStripeConfigured()) {
        return res.status(503).json({ error: 'Billing is not configured (STRIPE_SECRET_KEY missing).' });
    }

    const priceId = await priceIdForPlan(plan);
    if (!priceId) {
        return res.status(503).json({ error: `Price for plan "${plan}" is not configured in Stripe.` });
    }

    const baseUrl = PUBLIC_URL;
    if (!baseUrl.startsWith('http')) {
        console.error('[StripeCheckout] PUBLIC_URL is not absolute:', baseUrl);
        return res.status(500).json({ error: 'PUBLIC_URL must be an absolute URL (https://...)' });
    }

    try {
        const customerId = await ensureCustomerForUser(req.user);

        const session = await stripeClient().checkout.sessions.create({
            mode:       'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            ...(customerId ? { customer: customerId } : { customer_email: req.user.email ?? undefined }),
            // client_reference_id is the only identifier that cannot drift: a
            // customer can change their email in the portal, after which an
            // email-keyed webhook lookup stops finding the account.
            client_reference_id: req.user.id,
            success_url:  process.env.STRIPE_SUCCESS_URL || `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url:   process.env.STRIPE_CANCEL_URL  || `${baseUrl}/pricing`,
            allow_promotion_codes: true,
            subscription_data: { metadata: { user_id: req.user.id, plan_key: plan } },
            // automatic_tax is deliberately NOT enabled. The prices carry
            // tax_behavior: 'inclusive', so the advertised €19/€39 is what the
            // customer pays either way, and Stripe Tax collects nothing until a
            // tax registration exists. Turn this on (and add the registration)
            // once the VAT position is confirmed.
        });

        console.log(`[StripeCheckout] ${req.user.email} → plan=${plan} session=${session.id}`);
        return res.json({ url: session.url, checkoutUrl: session.url });
    } catch (err) {
        const detail = err?.raw ?? err?.message ?? String(err);
        console.error('[StripeCheckout] Failed to create checkout:', JSON.stringify(detail, null, 2));
        return res.status(500).json({
            error:  'Failed to create checkout session',
            detail: process.env.NODE_ENV !== 'production' ? detail : undefined,
        });
    }
}

/**
 * Tell a paying customer their subscription just renewed.
 *
 * Deliberately NOT a plan change: this never touches `profiles.plan`. A renewal
 * is a charge, not a tier transition — conflating them is the same class of
 * mistake as R46's canceled/revoked collapse.
 *
 * Best-effort and non-blocking: a failed email must never make the webhook
 * return non-2xx, or Stripe will retry the whole event and we risk double-
 * charging semantics on a purely cosmetic failure.
 */
async function sendRenewalReceipt(invoice, plan) {
    try {
        const email = invoice?.customer_email
            ?? await customerEmailFor(invoice?.customer);
        if (!email) return;

        const who = await resolveUser({
            stripeCustomerId: customerIdOf(invoice?.customer),
            email,
        });

        let firstName = email.split('@')[0];
        if (who?.userId) {
            const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(who.userId);
            firstName = (authUser?.user?.user_metadata?.full_name ?? email).split(' ')[0];
        }

        // Next renewal date, straight from the invoice's own period when Stripe
        // provides it — computing "one month from now" locally drifts from the
        // real billing date and is exactly the sort of small lie a billing email
        // must not tell.
        const periodEndSec = invoice?.lines?.data?.[0]?.period?.end ?? null;
        const nextDate = Number.isFinite(periodEndSec) ? new Date(periodEndSec * 1000) : null;
        const renewalStr = nextDate && !Number.isNaN(nextDate.getTime())
            ? nextDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            : 'your next billing date';

        // Real amount charged, not a hardcoded price list — plans change and a
        // receipt showing the wrong number is worse than showing none.
        const amountCents = invoice?.amount_paid ?? invoice?.total_amount ?? null;
        const currency    = (invoice?.currency || 'eur').toUpperCase();
        const amountStr   = Number.isFinite(amountCents)
            ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountCents / 100)
            : '';

        await sendEmail('renewal', email, {
            first_name:      firstName,
            plan_name:       plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Your',
            renewal_date:    renewalStr,
            plan_price:      amountStr,
            cta_url:         `${PUBLIC_URL}/dashboard`,
            account_url:     `${PUBLIC_URL}/account`,
            unsubscribe_url: who?.userId ? `${PUBLIC_URL}/unsubscribe?uid=${who.userId}` : `${PUBLIC_URL}/account`,
        });

        console.log(`[StripeWebhook] renewal receipt sent to ${email} (${plan || 'unknown plan'}, ${amountStr || 'amount n/a'})`);
    } catch (err) {
        console.warn('[StripeWebhook] renewal receipt failed (non-blocking):', err.message);
    }
}

/**
 * customer.subscription.updated carries BOTH a requested cancellation and an
 * ordinary change (plan swap, un-cancel, card update, proration) — Stripe does
 * not split them the way Polar did. The branch is therefore explicit here
 * rather than inline in the switch, so the distinction is readable and testable.
 */
async function handleSubscriptionUpdated(sub) {
    const stripeCustomerId = customerIdOf(sub.customer);
    const email = await customerEmailFor(sub.customer);

    // ── CANCELLATION REQUESTED. Record it; do NOT touch plan. ────────────────
    if (sub.cancel_at_period_end) {
        await markCancellation({ email, stripeCustomerId, subscription: sub });
        return;
    }

    // Payment trouble: record the status, keep the tier (Stripe is still
    // retrying). The downgrade happens at customer.subscription.deleted.
    if (!ENTITLED_STATUSES.has(sub.status)) {
        await recordPaymentIssue({ email, stripeCustomerId, status: sub.status || 'past_due' });
        return;
    }

    // An ordinary active update: a plan change, or an un-cancel. setPlan clears
    // the pending flag via subscription_status and only mails on a real change.
    const plan = planForSubscription(sub);
    if (plan) await setPlan({ email, stripeCustomerId, plan, subscription: sub });
}

// ── POST /api/stripe/webhook ─────────────────────────────────────────────────
// Exported separately from the router; index.js mounts it with express.raw()
// BEFORE the global express.json(). See the header note.
async function webhookHandler(req, res) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripe = stripeClient();

    if (!stripe) {
        console.error('[StripeWebhook] STRIPE_SECRET_KEY not set: webhook refused');
        return res.status(503).json({ error: 'Webhook not configured' });
    }

    let event;
    if (!secret) {
        // Never accept unsigned plan changes in production.
        if (process.env.NODE_ENV === 'production') {
            console.error('[StripeWebhook] STRIPE_WEBHOOK_SECRET not set: webhook refused');
            return res.status(503).json({ error: 'Webhook not configured' });
        }
        console.warn('[StripeWebhook] STRIPE_WEBHOOK_SECRET not set: skipping signature check (dev only)');
        try {
            event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body));
        } catch {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
    } else {
        // constructEvent needs the exact signed bytes. A parsed object here means
        // the raw-body mount in index.js was moved after express.json().
        if (!Buffer.isBuffer(req.body)) {
            console.error('[StripeWebhook] req.body is not a Buffer — the raw-body mount is misconfigured');
            return res.status(500).json({ error: 'Webhook body parsing misconfigured' });
        }
        try {
            event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
        } catch (err) {
            console.warn('[StripeWebhook] Invalid signature:', err.message);
            return res.status(403).json({ error: 'Invalid webhook signature' });
        }
    }

    const data = event?.data?.object ?? {};
    console.log(`[StripeWebhook] ${event.type} | id=${event.id}`);

    try {
        switch (event.type) {
            // First subscribe. The only event that carries client_reference_id,
            // so it is the one place the Supabase user id is certain.
            case 'checkout.session.completed': {
                if (data.mode !== 'subscription' || !data.subscription) break;
                const sub = await stripe.subscriptions.retrieve(refId(data.subscription));
                const plan = planForSubscription(sub);
                if (!plan) {
                    console.warn(`[StripeWebhook] checkout completed but no plan resolved for sub ${sub?.id}`);
                    break;
                }
                await setPlan({
                    userId:           data.client_reference_id || null,
                    email:            data.customer_details?.email ?? data.customer_email ?? null,
                    stripeCustomerId: customerIdOf(data.customer),
                    plan,
                    subscription:     sub,
                });
                break;
            }

            case 'customer.subscription.created': {
                const plan = planForSubscription(data);
                if (plan && ENTITLED_STATUSES.has(data.status)) {
                    await setPlan({
                        email:            await customerEmailFor(data.customer),
                        stripeCustomerId: customerIdOf(data.customer),
                        plan,
                        subscription:     data,
                    });
                }
                break;
            }

            // ── REQUESTED CANCELLATION ≠ ACCESS ENDED. Do not collapse these. ──
            // Stripe sets cancel_at_period_end when the customer REQUESTS
            // cancellation (what POST /cancel above sets, and what the Stripe
            // portal sets). They keep full access until the end of the period
            // they have already paid for — which can be 29 days away.
            //
            // Downgrading here means a user who cancels on day 2 of a paid month
            // loses Creator/Pro instantly while still being paid up. Access the
            // customer has paid for must not be revoked early.
            case 'customer.subscription.updated': {
                await handleSubscriptionUpdated(data);
                break;
            }

            // Access has actually ended (period elapsed, or an immediate cancel
            // from the Stripe dashboard). THIS is the downgrade point.
            case 'customer.subscription.deleted': {
                await setPlan({
                    email:            await customerEmailFor(data.customer),
                    stripeCustomerId: customerIdOf(data.customer),
                    plan:             'free',
                });
                break;
            }

            // ── RENEWAL RECEIPT ──────────────────────────────────────────────
            // Stripe emits invoice.paid for every successful charge, including
            // each recurring renewal.
            //
            // Only the RENEWAL charges are announced here: the first charge is
            // already covered by the plan-confirmation email that setPlan()
            // sends, and sending both would double-mail every new subscriber.
            // Stripe marks recurring charges billing_reason=subscription_cycle;
            // anything that is not clearly a renewal is skipped, not guessed at.
            case 'invoice.paid': {
                const reason = data?.billing_reason ?? null;
                const isRenewal = typeof reason === 'string'
                    && /cycle|renewal|recurring/i.test(reason);

                if (!isRenewal) {
                    console.log(`[StripeWebhook] invoice.paid (${reason || 'no billing reason'}) — not a renewal, no email`);
                    break;
                }

                const plan = await planForInvoice(data);
                await sendRenewalReceipt(data, plan);
                break;
            }

            case 'invoice.payment_failed': {
                await recordPaymentIssue({
                    email:            data?.customer_email ?? await customerEmailFor(data?.customer),
                    stripeCustomerId: customerIdOf(data?.customer),
                    status:           'past_due',
                });
                break;
            }

            default:
                // Ignore other event types (payment_intent.*, charge.*, etc.)
                break;
        }
    } catch (err) {
        // A 5xx makes Stripe retry the whole event. Handler bugs are logged and
        // acknowledged rather than retried forever; a signature failure above is
        // the only thing that should ever refuse a delivery.
        console.error(`[StripeWebhook] handler for ${event.type} threw:`, err?.message || err);
    }

    return res.json({ received: true });
}

module.exports = router;
module.exports.router         = router;
module.exports.webhookHandler = webhookHandler;

// Exported for the regression suite and for reuse by other billing surfaces.
module.exports._internals = {
    planForPrice,
    planForSubscription,
    priceRefFromInvoiceLine,
    refId,
    periodEndIso,
    accessEndsIso,
    priceLabelFor,
    customerIdOf,
    ENTITLED_STATUSES,
    CANCELLATION_REASONS,
    LOOKUP_TO_PLAN,
};
