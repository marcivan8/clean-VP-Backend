#!/usr/bin/env node
/**
 * Regression: subscription cancellation (CLAUDE.md R46, ported to Stripe).
 *
 * The properties here protect money and paid-for access, so they are worth
 * pinning even though most are short:
 *
 *   1. A REQUESTED cancellation must NOT downgrade the plan. The customer keeps
 *      the tier they paid for until access actually ends. Collapsing those two
 *      states revokes access a customer has already paid for — up to 29 days.
 *   2. Only `customer.subscription.deleted` downgrades to free.
 *   3. Cancellation is resolved from the AUTHENTICATED user, never from a
 *      client-supplied subscription id — otherwise any signed-in user could
 *      cancel someone else's plan.
 *   4. No endpoint reports success over a no-op: the cancel path verifies with
 *      Stripe that the flag actually took effect before saying "cancelled" (R30).
 *   5. Nothing in the repo attempts to configure payouts or bank details —
 *      that lives in the Stripe dashboard and must never be code.
 *
 * STRIPE MAKES (1) HARDER THAN POLAR DID, which is why §1 looks different from
 * the version this replaced. Polar emitted a dedicated `subscription.canceled`
 * event. Stripe has no such event: a requested cancellation arrives as
 * `customer.subscription.updated` with `cancel_at_period_end === true` — the
 * SAME event type as a plan change, an un-cancel, and a card update. The branch
 * therefore has to be explicit in code, and §1 pins the branch rather than a
 * case label.
 *
 * §8 pins the raw-body mount. Stripe's constructEvent verifies a signature over
 * the exact request bytes, and `express.raw()` on a router mounted after the
 * global `express.json()` is a silent no-op (body-parser sets `req._body` and
 * raw returns early). The Polar webhook had precisely that defect, so its
 * signature check could never have passed against a real delivery.
 *
 * Run: node scripts/test_subscription_cancel.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}`); if (detail) console.log(`      ${detail}`); }
}
function section(t) { console.log(`\n${t}`); }

const ROUTE_PATH = path.resolve(__dirname, '../routes/stripeWebhook.js');
const src = fs.readFileSync(ROUTE_PATH, 'utf8');

/**
 * STRIP COMMENTS. The comments explaining these branches legitimately mention
 * setPlan() — the renewal note says the first charge is "already covered by the
 * plan-confirmation email that setPlan() sends" — and a naive grep then reports
 * the explanation as the violation. Fourth time this exact trap has bitten in
 * this codebase; strip first, always.
 */
function stripComments(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
}

/** Extract the body of a `case 'x': { ... }` block from the webhook switch. */
function caseBody(eventName) {
    const start = src.indexOf(`case '${eventName}':`);
    if (start === -1) return '';
    const rest = src.slice(start + 1);
    const next = rest.search(/\n\s{12}(case '|default:)/);
    return stripComments(next === -1 ? rest.slice(0, 1200) : rest.slice(0, next));
}

/** Extract a top-level function body, from its signature to the closing brace. */
function fnBody(signature) {
    const start = src.indexOf(signature);
    if (start === -1) return '';
    const end = src.indexOf('\n}', start);
    return stripComments(src.slice(start, end === -1 ? undefined : end));
}

// ── 1 · requested cancellation ≠ access ended ────────────────────────────────
section('1 · A requested cancellation does NOT downgrade the plan');
{
    const updated = caseBody('customer.subscription.updated');
    check('the subscription.updated case exists', updated.length > 0);
    check('subscription.updated does not call setPlan inline',
        !/setPlan\(/.test(updated),
        'the cancel/active branch must be explicit, not a bare setPlan on every update');
    check('it delegates to the explicit branch handler',
        /handleSubscriptionUpdated\(/.test(updated));

    const handler = fnBody('async function handleSubscriptionUpdated');
    check('handleSubscriptionUpdated exists', handler.length > 0);

    // The cancel branch specifically. The function DOES call setPlan further
    // down for an ordinary active update, so a whole-function grep would pass
    // vacuously — the branch is what matters.
    const i = handler.indexOf('if (sub.cancel_at_period_end)');
    const branch = i === -1 ? '' : (() => {
        const rest = handler.slice(i);
        const end  = rest.indexOf('\n    }');
        return end === -1 ? rest : rest.slice(0, end);
    })();

    check('there is a cancel_at_period_end branch', branch.length > 0,
        'Stripe sends one event type for cancel, un-cancel and plan change');
    check('the cancel branch does not call setPlan',
        branch.length > 0 && !/setPlan\(/.test(branch),
        'the customer has paid through the end of the period — do not revoke early');
    check('the cancel branch records the pending state instead',
        /markCancellation\(/.test(branch));
    check('the cancel branch returns before the active path',
        /\breturn;/.test(branch),
        'falling through would reach setPlan and undo the whole distinction');

    const deleted = caseBody('customer.subscription.deleted');
    check('the subscription.deleted case exists', deleted.length > 0);
    check('deleted DOES downgrade to free',
        /plan:\s*'free'/.test(deleted),
        'deleted is the point at which access actually ends');

    // The specific regression shape: one shared body for both outcomes.
    check('updated and deleted are separate cases',
        !/case 'customer\.subscription\.updated':\s*\n\s*case 'customer\.subscription\.deleted':/.test(src),
        'as fall-through siblings, a mere cancellation request would drop the user to free');
}

section('1b · un-cancelling restores without re-mailing the customer');
{
    const handler = fnBody('async function handleSubscriptionUpdated');
    check('the active path calls setPlan', /setPlan\(/.test(handler),
        'an un-cancel or plan change still has to write the tier');

    const setPlanBody = fnBody('async function setPlan');
    check('setPlan reads the previous plan first',
        /previousPlan/.test(setPlanBody));
    check('setPlan only mails when the plan actually changed',
        /plan === previousPlan/.test(setPlanBody),
        'Stripe re-delivers events and fires updated for card changes — mailing on every call spams paying customers');
}

section('1c · markCancellation never writes the plan column');
{
    const body = fnBody('async function markCancellation');
    check('markCancellation exists', body.length > 0);
    check('it does not set plan',
        !/\bplan\s*:/.test(body),
        'writing plan here would defeat the requested/ended distinction entirely');
    check('it records subscription_status', /subscription_status/.test(body));
}

section('1d · a failed payment does not take access away');
{
    const body = fnBody('async function recordPaymentIssue');
    check('recordPaymentIssue exists', body.length > 0);
    check('it does not set plan', !/\bplan\s*:/.test(body),
        'Stripe is still retrying the card; downgrading on the first failure punishes an expired card');
    check('invoice.payment_failed is handled', /case 'invoice\.payment_failed':/.test(src));
}

// ── 2 · Ownership ────────────────────────────────────────────────────────────
section('2 · Cancellation is scoped to the authenticated user');
{
    for (const route of ['/cancel', '/reactivate', '/portal', '/subscription']) {
        const idx = src.indexOf(`'${route}'`);
        check(`${route} requires authentication`,
            idx !== -1 && /authenticateUser/.test(src.slice(idx, idx + 120)),
            'an unauthenticated billing mutation is not survivable');
    }

    const cancelStart = src.indexOf("router.post('/cancel'");
    const cancelBody  = stripComments(src.slice(cancelStart, src.indexOf("router.post('/reactivate'")));

    check('the subscription is resolved from req.user',
        /findSubscriptionForUser\(req\.user\)/.test(cancelBody));
    check('no subscription id is read from the request body',
        !/req\.body[^\n]*\b(subscriptionId|subscription_id|id)\b/.test(cancelBody),
        'accepting an id from the client lets any user cancel any subscription');
}

// ── 3 · No success over a no-op ──────────────────────────────────────────────
section('3 · The cancel path verifies before it claims success (R30)');
{
    const cancelStart = src.indexOf("router.post('/cancel'");
    const cancelBody  = stripComments(src.slice(cancelStart, src.indexOf("router.post('/reactivate'")));

    check('the result of the update is checked',
        /if \(!updated\?\.cancel_at_period_end\)/.test(cancelBody),
        'Stripe accepting the call is not the same as the flag being set');
    check('an unconfirmed cancellation returns canceled:false',
        /canceled:\s*false/.test(cancelBody));
    check('an already-scheduled cancellation is reported honestly',
        /alreadyScheduled/.test(cancelBody),
        'claiming to have just cancelled something already cancelled is a lie');
    check('the error path states the subscription is unchanged',
        /has not been changed|is unchanged/.test(cancelBody));

    const reStart = src.indexOf("router.post('/reactivate'");
    const reBody  = stripComments(src.slice(reStart, src.indexOf("router.post('/portal'")));
    check('reactivate also verifies the flag cleared',
        /if \(updated\?\.cancel_at_period_end\)/.test(reBody));
}

// ── 4 · Cancel is at period end, not immediate ───────────────────────────────
section('4 · Cancellation is scheduled, not immediate');
{
    check('the cancel path sets cancel_at_period_end: true',
        /cancel_at_period_end:\s*true/.test(src));
    check('the cancel path does NOT delete the subscription outright',
        !/subscriptions\.del\(|subscriptions\.cancel\(/.test(src),
        'cancelling immediately ends access and forfeits time the customer paid for');
    check('only Stripe enum feedback values are forwarded',
        /CANCELLATION_REASONS\.has\(reason\)/.test(src),
        'an invalid feedback value fails the whole API call');
}

// ── 5 · Payouts are not configured in code ───────────────────────────────────
section('5 · Nothing in the repo routes payouts (that is dashboard-only)');
{
    const roots = ['routes', 'services', 'controllers', 'middleware', 'jobs'];
    const suspicious = [];
    const rx = /(payout|bank_account|bankAccount|iban|routing_number|sort_code)/i;

    const walk = (dir) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); continue; }
            if (!e.name.endsWith('.js')) continue;
            // Defensive: the workspace mount can expose entries that look like
            // regular files but fail to read. An unreadable file is not a
            // finding — skip it rather than crashing the whole suite.
            let text;
            try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
            for (const line of text.split('\n')) {
                // Comments explaining that payouts are NOT handled here are fine.
                // So is READING the market's Connect status (R102: whether
                // Stripe says a talent's payouts are enabled, shown as a
                // checklist item). It names no destination and changes none.
                const readsConnectStatus = /^\s*payoutsConnected:\s*o\.payouts_enabled === true,\s*$/.test(line);
                if (rx.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line) && !readsConnectStatus) {
                    suspicious.push(`${full}: ${line.trim().slice(0, 100)}`);
                }
            }
        }
    };
    roots.forEach(r => walk(path.resolve(__dirname, '..', r)));

    check('no code references payout or bank-account configuration',
        suspicious.length === 0,
        suspicious.join('\n      ') ||
        'payout destination is configured in the Stripe dashboard and must never be settable from code');
}

// ── 6 · The /account route exists ────────────────────────────────────────────
section('6 · The page emails link to actually exists');
{
    const appSrc = fs.readFileSync(
        path.resolve(__dirname, '../client/src/App.jsx'), 'utf8');
    check('/account is routed',
        /path="\/account"/.test(appSrc),
        'plan-confirmation emails send every paying customer to /account');
    check('AccountPage is imported', /AccountPage/.test(appSrc));

    check('the email still points at /account',
        /account_url:\s*`\$\{PUBLIC_URL\}\/account`/.test(src),
        'if this changed, update the route to match');

    const dashSrc = fs.readFileSync(
        path.resolve(__dirname, '../client/src/pages/DashboardPage.jsx'), 'utf8');
    check('the dashboard links to it',
        /navigate\('\/account'\)/.test(dashSrc),
        'a route with no in-app entry point is barely better than no route');

    const acctSrc = fs.readFileSync(
        path.resolve(__dirname, '../client/src/pages/AccountPage.jsx'), 'utf8');
    check('AccountPage calls the Stripe endpoints, not Polar',
        !/\/api\/polar\//.test(acctSrc) && /\/api\/stripe\/subscription/.test(acctSrc),
        'the Polar routes are gone — a stale path 404s with no visible error');
}

// ── 7 · Renewal receipts (R54) ───────────────────────────────────────────────
// Stripe emits invoice.paid on every successful charge INCLUDING renewals.
// Nothing listening means a customer is billed monthly and only ever hears from
// us once — at signup.
section('7 · A renewal charge produces a receipt');
{
    check('invoice.paid is handled', /case 'invoice\.paid':/.test(src));
    check('only renewal charges are announced',
        /cycle\|renewal\|recurring/.test(src),
        'the first charge is already covered by the plan email — both would double-mail');
    check('it sends the renewal email type',
        /sendEmail\('renewal'/.test(src));
    check('the receipt never changes the plan',
        (() => {
            const body = fnBody('async function sendRenewalReceipt');
            return body.length > 0 && !/setPlan\(/.test(body);
        })(),
        'a renewal is a charge, not a tier transition (R46)');
    check('the amount comes from the invoice, not a hardcoded price',
        /amount_paid/.test(src),
        'a receipt showing the wrong number is worse than showing none');
    check('a failed email cannot fail the webhook',
        /renewal receipt failed \(non-blocking\)/.test(src),
        'a non-2xx makes Stripe retry the whole billing event');
    check('a throwing handler is acknowledged, not retried forever',
        /handler for \$\{event\.type\} threw/.test(src),
        'a 5xx makes Stripe redeliver; a handler bug would loop');

    const edge = fs.readFileSync(
        path.resolve(__dirname, '../supabase/functions/send-email/index.ts'), 'utf8');
    check('the edge function knows the renewal type', /case 'renewal':/.test(edge));
    check('its subject says renewed, not live',
        /has renewed/.test(edge),
        'telling a returning customer their plan "is live" reads like a new signup');
}

// ── 8 · The webhook receives the RAW body ────────────────────────────────────
// This is the defect the Polar implementation shipped with: express.raw() on a
// router mounted after the global express.json() never runs, because body-parser
// sets req._body and raw returns early. The signature check then sees a parsed
// object and can never pass.
section('8 · The webhook is mounted so it gets the raw signed bytes');
{
    const idx = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');

    const webhookAt = idx.indexOf("app.post('/api/stripe/webhook'");
    const jsonAt    = idx.indexOf('app.use(express.json(');

    check('the webhook is mounted in index.js', webhookAt !== -1);
    check('it uses express.raw for application/json',
        /app\.post\('\/api\/stripe\/webhook',\s*\n?\s*express\.raw\(\{\s*type:\s*'application\/json'\s*\}\)/.test(idx));
    check('it is mounted BEFORE the global express.json()',
        webhookAt !== -1 && jsonAt !== -1 && webhookAt < jsonAt,
        'mounted after the json parser, express.raw() is a silent no-op and the signature can never verify');
    check('the billing router is mounted at /api/stripe',
        /app\.use\('\/api\/stripe',\s*require\('\.\/routes\/stripeWebhook'\)\.router\)/.test(idx));
    check('the /api/checkout alias still exists',
        /app\.use\('\/api\/checkout',\s*require\('\.\/routes\/stripeWebhook'\)\.router\)/.test(idx),
        'client/src/lib/checkout.js posts to /api/checkout/create');
    check('nothing still requires polarWebhook', !/polarWebhook/.test(idx));
    check('routes/polarWebhook.js is gone',
        !fs.existsSync(path.resolve(__dirname, '../routes/polarWebhook.js')),
        'an unmounted billing route is dead code with live credentials in its comments');

    // The handler must refuse rather than trust a parsed body, so a future
    // re-mount below the json parser fails loudly instead of silently.
    check('the handler refuses a non-Buffer body when verifying',
        /!Buffer\.isBuffer\(req\.body\)/.test(src),
        'without this, moving the mount would downgrade to no signature check at all');
    check('the webhook is exported separately from the router',
        /module\.exports\.webhookHandler\s*=\s*webhookHandler/.test(src));
    check('production refuses an unsigned webhook',
        /STRIPE_WEBHOOK_SECRET not set: webhook refused/.test(src),
        'never accept unsigned plan changes in production');
}

// ── 9 · The pure helpers, EXECUTED ───────────────────────────────────────────
// Static analysis cannot see an off-by-one in the plan resolution chain or a
// field that moved between Stripe API versions. These run the real code.
section('9 · Plan/price resolution and date handling (executed)');
{
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';

    let I = null;
    try {
        I = require(ROUTE_PATH)._internals;
    } catch (err) {
        check('the route module loads', false, err.message);
    }

    if (I) {
        check('the route module loads and exports its internals', !!I.planForPrice);

        // Resolution chain: lookup_key, then price metadata, then nothing.
        check('a price resolves by lookup_key',
            I.planForPrice({ id: 'price_x', lookup_key: 'vibed_creator_monthly' }) === 'creator');
        check('the pro lookup_key resolves too',
            I.planForPrice({ id: 'price_y', lookup_key: 'vibed_pro_monthly' }) === 'pro');
        check('a price resolves by metadata.plan_key',
            I.planForPrice({ id: 'price_z', metadata: { plan_key: 'pro' } }) === 'pro');
        check('an unknown price resolves to null, not a default plan',
            I.planForPrice({ id: 'price_unknown' }) === null,
            'defaulting to creator would hand out a paid tier for an unrecognised price');
        check('a junk metadata plan is rejected',
            I.planForPrice({ id: 'p', metadata: { plan_key: 'enterprise' } }) === null);
        check('null is handled', I.planForPrice(null) === null);

        check('a subscription resolves through its first item',
            I.planForSubscription({
                items: { data: [{ price: { id: 'p', lookup_key: 'vibed_pro_monthly' } }] },
            }) === 'pro');
        check('a subscription with no resolvable item falls back to metadata',
            I.planForSubscription({ items: { data: [] }, metadata: { plan_key: 'creator' } }) === 'creator');

        // current_period_end moved from Subscription to SubscriptionItem in the
        // 2025 API versions. Reading only the old location returns null, which
        // retentionJob.js reads as "active forever" — silent, not loud.
        const T = 1800000000; // a fixed epoch second
        const iso = new Date(T * 1000).toISOString();
        check('periodEndIso reads the legacy top-level field',
            I.periodEndIso({ current_period_end: T }) === iso);
        check('periodEndIso reads the current item-level field',
            I.periodEndIso({ items: { data: [{ current_period_end: T }] } }) === iso,
            'this is the shape a current Stripe API version actually sends');
        check('periodEndIso returns null when absent',
            I.periodEndIso({}) === null);
        check('periodEndIso ignores a non-numeric value',
            I.periodEndIso({ current_period_end: 'soon' }) === null);

        check('accessEndsIso prefers cancel_at over the period end',
            I.accessEndsIso({ cancel_at: T, current_period_end: T + 99999 }) === iso,
            'once a cancellation is scheduled, cancel_at is the date access ends');
        check('accessEndsIso falls back to the period end',
            I.accessEndsIso({ current_period_end: T }) === iso);

        // Dunning: past_due must not entitle, but must not downgrade either.
        check('active entitles', I.ENTITLED_STATUSES.has('active') === true);
        check('trialing entitles', I.ENTITLED_STATUSES.has('trialing') === true);
        check('past_due does NOT entitle',
            I.ENTITLED_STATUSES.has('past_due') === false,
            'but the plan is still not downgraded — see recordPaymentIssue');
        check('canceled does not entitle',
            I.ENTITLED_STATUSES.has('canceled') === false);

        check('priceLabelFor formats the real charged amount',
            /19/.test(I.priceLabelFor({ items: { data: [{ price: { unit_amount: 1900, currency: 'eur' } }] } })));
        check('priceLabelFor degrades to empty, never a wrong number',
            I.priceLabelFor({ items: { data: [{ price: {} }] } }) === '' &&
            I.priceLabelFor(null) === '');

        check('refId accepts both an id string and an expanded object',
            I.refId('cus_123') === 'cus_123' && I.refId({ id: 'cus_123' }) === 'cus_123' &&
            I.refId(null) === null);

        // line.price moved to line.pricing.price_details.price in 2025 versions.
        check('an invoice line price is read from both shapes',
            I.priceRefFromInvoiceLine({ price: { id: 'p1' } })?.id === 'p1' &&
            I.priceRefFromInvoiceLine({ pricing: { price_details: { price: 'p2' } } }) === 'p2',
            'reading one shape only degrades the renewal receipt to a generic plan name');

        // Stripe's cancellation_details.feedback enum, which the client sends.
        const expected = ['too_expensive', 'missing_features', 'switched_service', 'unused',
            'customer_service', 'low_quality', 'too_complex', 'other'];
        check('the cancellation feedback enum matches Stripe exactly',
            expected.every(r => I.CANCELLATION_REASONS.has(r)) &&
            I.CANCELLATION_REASONS.size === expected.length,
            'an invalid feedback value fails the whole update call');
    }
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Subscription cancellation: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
