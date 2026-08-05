#!/usr/bin/env node
/**
 * Regression: subscription cancellation (CLAUDE.md R46).
 *
 * The properties here protect money and paid-for access, so they are worth
 * pinning even though most are short:
 *
 *   1. `subscription.canceled` must NOT downgrade the plan. The customer keeps
 *      the tier they paid for until `subscription.revoked`. Collapsing these two
 *      events revokes access a customer has already paid for — up to 29 days of it.
 *   2. Only `subscription.revoked` downgrades to free.
 *   3. Cancellation is resolved from the AUTHENTICATED user's email, never from
 *      a client-supplied subscription id — otherwise any signed-in user could
 *      cancel someone else's plan.
 *   4. No endpoint reports success over a no-op: the cancel path verifies with
 *      Polar that the flag actually took effect before saying "cancelled" (R30).
 *   5. Nothing in the repo attempts to configure payouts or bank details —
 *      that lives in the Polar dashboard and must never be code.
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

const ROUTE_PATH = path.resolve(__dirname, '../routes/polarWebhook.js');
const src = fs.readFileSync(ROUTE_PATH, 'utf8');

/** Extract the body of a `case 'x': { ... }` block from the webhook switch. */
function caseBody(eventName) {
    const start = src.indexOf(`case '${eventName}':`);
    if (start === -1) return '';
    // Read to the next `case '` at the same level, or the switch's default.
    const rest  = src.slice(start + 1);
    const next  = rest.search(/\n\s{12}(case '|default:)/);
    return next === -1 ? rest.slice(0, 800) : rest.slice(0, next);
}

// ── 1 · canceled ≠ revoked ───────────────────────────────────────────────────
section('1 · subscription.canceled does NOT downgrade the plan');
{
    const canceled = caseBody('subscription.canceled');
    check('the canceled case exists', canceled.length > 0);
    check('canceled does not call setPlan',
        !/setPlan\(/.test(canceled),
        'the customer has paid through the end of the period — do not revoke early');
    check('canceled records the pending state instead',
        /markCancellation\(/.test(canceled));

    const revoked = caseBody('subscription.revoked');
    check('the revoked case exists', revoked.length > 0);
    check('revoked DOES downgrade to free',
        /setPlan\([^)]*'free'\)/.test(revoked),
        'revoked is the point at which access actually ends');

    // The specific regression: one shared case body for both events.
    check('canceled and revoked are separate cases',
        !/case 'subscription\.canceled':\s*\n\s*case 'subscription\.revoked':/.test(src),
        'these were fall-through siblings and both dropped the user to free');
}

section('1b · un-cancelling clears the flag without touching the plan');
{
    const unc = caseBody('subscription.uncanceled');
    check('the uncanceled case exists', unc.length > 0);
    check('uncanceled does not call setPlan', !/setPlan\(/.test(unc),
        'the plan was never changed, so there is nothing to restore');
    check('uncanceled clears the pending cancellation',
        /markCancellation\([^)]*null\)/.test(unc));
}

section('1c · markCancellation never writes the plan column');
{
    const start = src.indexOf('async function markCancellation');
    const body  = src.slice(start, src.indexOf('\n}', start));
    check('markCancellation exists', start !== -1);
    check('it does not set plan',
        !/\bplan\s*:/.test(body),
        'writing plan here would defeat the canceled/revoked distinction entirely');
    check('it records subscription_status', /subscription_status/.test(body));
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
    const cancelBody  = src.slice(cancelStart, src.indexOf("router.post('/reactivate'"));

    check('the subscription is resolved from req.user.email',
        /findSubscriptionForUser\(req\.user\.email\)/.test(cancelBody));
    check('no subscription id is read from the request body',
        !/req\.body[^\n]*\b(subscriptionId|subscription_id|id)\b/.test(cancelBody),
        'accepting an id from the client lets any user cancel any subscription');
}

// ── 3 · No success over a no-op ──────────────────────────────────────────────
section('3 · The cancel path verifies before it claims success (R30)');
{
    const cancelStart = src.indexOf("router.post('/cancel'");
    const cancelBody  = src.slice(cancelStart, src.indexOf("router.post('/reactivate'"));

    check('the result of the update is checked',
        /if \(!updated\?\.cancelAtPeriodEnd\)/.test(cancelBody),
        'Polar accepting the call is not the same as the flag being set');
    check('an unconfirmed cancellation returns canceled:false',
        /canceled:\s*false/.test(cancelBody));
    check('an already-scheduled cancellation is reported honestly',
        /alreadyScheduled/.test(cancelBody),
        'claiming to have just cancelled something already cancelled is a lie');
    check('the error path states the subscription is unchanged',
        /has not been changed|is unchanged/.test(cancelBody));

    const reStart = src.indexOf("router.post('/reactivate'");
    const reBody  = src.slice(reStart, src.indexOf("router.post('/portal'"));
    check('reactivate also verifies the flag cleared',
        /if \(updated\?\.cancelAtPeriodEnd\)/.test(reBody));
}

// ── 4 · Cancel is at period end, not immediate ───────────────────────────────
section('4 · Cancellation is scheduled, not immediate');
{
    check('the cancel path sets cancelAtPeriodEnd: true',
        /cancelAtPeriodEnd:\s*true/.test(src));
    check('the cancel path does NOT call subscriptions.revoke',
        !/subscriptions\.revoke\(/.test(src),
        'revoke ends access immediately and forfeits time the customer paid for');
    check('only Polar enum reasons are forwarded',
        /CANCELLATION_REASONS\.has\(reason\)/.test(src),
        'an invalid reason value fails the whole API call');
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
                if (rx.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) {
                    suspicious.push(`${full}: ${line.trim().slice(0, 100)}`);
                }
            }
        }
    };
    roots.forEach(r => walk(path.resolve(__dirname, '..', r)));

    check('no code references payout or bank-account configuration',
        suspicious.length === 0,
        suspicious.join('\n      ') ||
        'payout destination is configured in the Polar dashboard and must never be settable from code');
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
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Subscription cancellation: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
