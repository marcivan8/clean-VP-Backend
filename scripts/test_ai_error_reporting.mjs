// scripts/test_ai_error_reporting.mjs
//
// R152. What the user is told when a call to an AI route fails.
//
// EditPlanner turned every non-OK response into the string "API planning
// failed". That one sentence covered a 400 naming a missing provider key, a
// 401 expired session, a 402 quota refusal and a 500 crash, so the screen
// never said which and neither did the logs. Marc hit it on a phone and there
// was nothing in the message to act on.
//
// R148 wired 402 to the shared QUOTA_EXCEEDED channel in MediaExecutionEngine
// and TranscriptionManager, and missed the planner and the analyzer, so a
// quota refusal through those paths showed a generic failure instead of the
// upgrade sheet.

import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);

import assert from 'assert/strict';
import { readFileSync } from 'fs';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.error = () => {};

const { describeAiFailure } = await import('../client/src/lib/aiRequestError.js');
const { EventBus, EVENT_TYPES } = await import('../client/src/agent/EventBus.js');

let n = 0;
const check = async (name, fn) => { await fn(); n++; realLog(`  ok  ${name}`); };

const json = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
});

const captureQuota = (fn) => {
    const seen = [];
    const off = EventBus.on(EVENT_TYPES.QUOTA_EXCEEDED, (p) => seen.push(p));
    return Promise.resolve(fn()).then((out) => { off(); return { out, seen }; });
};

realLog('\nai error reporting\n');

await check('a missing provider key is reported in the server\'s own words', async () => {
    // This is the 400 that generate-plan returns when the configured
    // AI_PROVIDER has no key. It names the problem exactly; the old code
    // replaced it with "API planning failed".
    const msg = await describeAiFailure(
        json(400, { success: false, error: 'Cannot generate plan: Operation not supported locally and no API key' }),
        'The planner did not respond.',
    );
    assert.match(msg, /no API key/);
});

await check('an expired session says so, because waiting will not fix it', async () => {
    const msg = await describeAiFailure(json(401, { error: 'AUTH_REQUIRED' }), 'nope');
    assert.match(msg, /session/i);
    assert.match(msg, /sign in/i);
    const forbidden = await describeAiFailure(json(403, {}), 'nope');
    assert.match(forbidden, /session/i);
});

await check('a quota refusal opens the upgrade sheet instead of reading as a crash', async () => {
    const { out, seen } = await captureQuota(() => describeAiFailure(
        json(402, { error: 'AI_OPS_LIMIT', message: "You've used all 3 AI operations this month.", upgradeRequired: 'creator' }),
        'nope',
    ));
    assert.equal(seen.length, 1, 'exactly one QUOTA_EXCEEDED');
    assert.equal(seen[0].reason, 'ai_ops');
    assert.equal(seen[0].upgradeRequired, 'creator');
    assert.match(out, /all 3 AI operations/);
});

await check('a spent Auto trial is told apart from a spent month', async () => {
    const { seen } = await captureQuota(() => describeAiFailure(
        json(402, { error: 'AUTO_TRIAL_SPENT', message: "You've used your 3 free Auto edits.", upgradeRequired: 'creator' }),
        'nope',
    ));
    assert.equal(seen[0].reason, 'auto_trial', 'waiting for the month to roll over never fixes this one');
});

await check('a failure with nothing to say still carries its status', async () => {
    const msg = await describeAiFailure(new Response('<html>502</html>', { status: 502 }), 'The planner did not respond.');
    assert.match(msg, /planner did not respond/);
    assert.match(msg, /502/, 'the status is what makes it debuggable');
});

await check('reading the body does not consume it for the caller', async () => {
    const res = json(400, { error: 'boom' });
    await describeAiFailure(res, 'x');
    assert.equal(res.bodyUsed, false, 'the response is cloned, so a caller can still read it');
});

await check('a text body is reported, not swallowed', async () => {
    const msg = await describeAiFailure(new Response('upstream timeout', { status: 504 }), 'fallback');
    assert.match(msg, /504/);
});

await check('no user-facing string can come back undefined', async () => {
    // i18next is not initialised here, which is exactly when it returns the key
    // or nothing. Every branch must still produce real text.
    for (const res of [json(402, {}), json(401, {}), json(500, {}), new Response('', { status: 503 })]) {
        const msg = await describeAiFailure(res, 'Something went wrong.');
        assert.equal(typeof msg, 'string');
        assert.ok(msg.length > 0, 'empty message');
        assert.ok(!/^editor:/.test(msg), `an untranslated key reached the user: ${msg}`);
        assert.ok(!/undefined/.test(msg), `undefined reached the user: ${msg}`);
    }
});

await check('the planner and the analyzer both use it', async () => {
    const planner = read('../client/src/agent/EditPlanner.js');
    assert.ok(!/'API planning failed'/.test(planner), 'the opaque string is gone');
    assert.match(planner, /describeAiFailure\(response/);
    const analyzer = read('../client/src/agent/ContentAnalyzer.js');
    assert.match(analyzer, /describeAiFailure\(response/);
    // The raw body used to be handed straight to the user.
    assert.ok(!/const err = await response\.text\(\);\s*\n\s*console\.error\('\[ContentAnalyzer\]/.test(analyzer));
});

realLog(`\n${n} checks passed\n`);
