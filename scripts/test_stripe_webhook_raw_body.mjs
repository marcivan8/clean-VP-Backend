#!/usr/bin/env node
/**
 * Regression: the Stripe webhook actually receives the RAW signed bytes, and
 * actually verifies them.
 *
 * scripts/test_subscription_cancel.js §8 checks the MOUNT ORDER statically. This
 * file runs the real handler behind a real Express app and a real Stripe
 * signature, because the defect being guarded against is invisible in source:
 *
 *   express.json() is mounted globally in index.js. body-parser sets
 *   `req._body = true` once it has parsed, and express.raw() returns EARLY when
 *   it sees that flag. So a route-level express.raw() on a router mounted after
 *   the global json parser never runs — req.body arrives as a parsed OBJECT,
 *   constructEvent cannot verify an object, and the webhook rejects every real
 *   delivery. The Polar webhook this replaced shipped in exactly that state.
 *
 * Both orderings are exercised here: correct (raw first → verifies) and wrong
 * (json first → the handler must REFUSE rather than silently skip verification).
 *
 * Run: node scripts/test_stripe_webhook_raw_body.mjs
 */

import express from 'express';
import Stripe from 'stripe';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Stubs so config/database.js can be required. No network call is made: the
// event type used below falls through to the webhook's `default:` branch, so
// nothing touches Supabase or Stripe's API.
process.env.SUPABASE_URL              ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY         ||= 'test-anon-key';
process.env.STRIPE_SECRET_KEY         ||= 'sk_test_placeholder'; // not a key: the Stripe client only needs a string here
process.env.STRIPE_WEBHOOK_SECRET       = 'whsec_testsecret_for_regression_only';

const { webhookHandler } = require('../routes/stripeWebhook.js');

let passed = 0, failed = 0;
const check = (name, ok, detail) => {
    if (ok) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}`); if (detail) console.log(`      ${detail}`); }
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// An event type the handler does not act on, so this test stays hermetic.
const payload = JSON.stringify({
    id: 'evt_regression_1',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1' } },
});

function sign(body, secret = process.env.STRIPE_WEBHOOK_SECRET) {
    return stripe.webhooks.generateTestHeaderString({ payload: body, secret });
}

/** Boot a throwaway app, run one request against it, return { status, body, sawBuffer }. */
function request(app, { headers = {}, body = payload } = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, async () => {
            const { port } = server.address();
            try {
                const res = await fetch(`http://127.0.0.1:${port}/api/stripe/webhook`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...headers },
                    body,
                });
                const text = await res.text();
                server.close(() => resolve({ status: res.status, body: text }));
            } catch (err) {
                server.close(() => reject(err));
            }
        });
    });
}

/** index.js's ordering: the raw webhook mount ABOVE the global json parser. */
function correctOrderApp(spy) {
    const app = express();
    app.post('/api/stripe/webhook',
        express.raw({ type: 'application/json' }),
        (req, res, next) => { spy.sawBuffer = Buffer.isBuffer(req.body); next(); },
        webhookHandler);
    app.use(express.json({ limit: '50mb' }));
    return app;
}

/** The defect: the global json parser runs first, so raw is a no-op. */
function wrongOrderApp(spy) {
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.post('/api/stripe/webhook',
        express.raw({ type: 'application/json' }),
        (req, res, next) => { spy.sawBuffer = Buffer.isBuffer(req.body); next(); },
        webhookHandler);
    return app;
}

console.log('\n1 · Correct mount order: the body arrives raw and verifies');
{
    const spy = {};
    const res = await request(correctOrderApp(spy), { headers: { 'stripe-signature': sign(payload) } });

    check('the handler sees a Buffer, not a parsed object', spy.sawBuffer === true,
        'express.raw() did not run — check the mount order');
    check('a correctly signed delivery is accepted (200)', res.status === 200,
        `got ${res.status}: ${res.body}`);
    check('it acknowledges with received:true', /"received"\s*:\s*true/.test(res.body));
}

console.log('\n2 · A forged or stale signature is rejected');
{
    const spy = {};
    const bad = await request(correctOrderApp(spy), {
        headers: { 'stripe-signature': sign(payload, 'whsec_a_different_secret') },
    });
    check('a signature from the wrong secret is refused (403)', bad.status === 403,
        `got ${bad.status}: ${bad.body}`);

    const none = await request(correctOrderApp({}));
    check('a missing stripe-signature header is refused (403)', none.status === 403,
        `got ${none.status}: ${none.body}`);

    // Same signature, different body — the classic replay/tamper case.
    const tampered = await request(correctOrderApp({}), {
        headers: { 'stripe-signature': sign(payload) },
        body: payload.replace('pi_1', 'pi_TAMPERED'),
    });
    check('a tampered body with a valid-looking signature is refused (403)',
        tampered.status === 403, `got ${tampered.status}: ${tampered.body}`);
}

console.log('\n3 · Wrong mount order FAILS LOUDLY instead of skipping verification');
{
    const spy = {};
    const res = await request(wrongOrderApp(spy), { headers: { 'stripe-signature': sign(payload) } });

    check('express.raw() is indeed a no-op after express.json()', spy.sawBuffer === false,
        'if this is true, body-parser stopped setting req._body and the whole hazard changed');
    check('the handler refuses a non-Buffer body rather than trusting it',
        res.status === 500, `got ${res.status}: ${res.body}`);
    check('the error names the misconfiguration',
        /misconfigured/i.test(res.body), res.body);
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Stripe webhook raw body: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
