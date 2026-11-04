// scripts/test_usage_runs.mjs
// R148. Verifies the usage gate after three changes:
//
//  1. An AI operation means one Auto RUN, not one HTTP request. A run makes
//     3 to 5 gated requests, so before this "3 AI operations" was less than a
//     single Auto edit.
//  2. usage_events is the server's ledger only. Client trackEvent() rows
//     (video_uploaded, video_exported) were being metered as AI usage.
//  3. The published free plan still locks styles and Auto, but a new account
//     gets FREE_TRIAL_AUTO_RUNS runs with both unlocked, and when that is
//     spent the request is REFUSED rather than silently downgraded to a
//     different edit.
//
// Mostly behavioural: aiGate is driven with a fake req/res and a stubbed
// database, so these check what the gate does, not how it reads.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'mock-anon-key';
delete process.env.BYPASS_USAGE_GATE;

import assert from 'assert/strict';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

// ── stub the database ─────────────────────────────────────────────────────
// The project URL above is a placeholder, not a test database, and must never
// trigger a real request.
const db = {
    plan: 'free',
    monthlyOps: 0,
    lifetimeRuns: 0,
    runRows: [],
    inserted: [],
    rpc: [],
    reset() {
        this.plan = 'free';
        this.monthlyOps = 0;
        this.lifetimeRuns = 0;
        this.runRows = [];
        this.inserted = [];
        this.rpc = [];
    },
};

const testDatabase = {
    supabaseAdmin: {
        from() {
            const chain = {
                select: () => chain,
                eq: () => chain,
                order: () => chain,
                limit: async () => ({ data: db.runRows, error: null }),
                single: async () => ({ data: { plan: db.plan }, error: null }),
            };
            return {
                select: chain.select,
                insert: async (row) => { db.inserted.push(row); return { error: null }; },
            };
        },
        rpc: async (fn, args) => {
            db.rpc.push({ fn, args });
            if (fn === 'count_monthly_ops')         return { data: db.monthlyOps,   error: null };
            if (fn === 'count_lifetime_auto_runs')  return { data: db.lifetimeRuns, error: null };
            return { data: 0, error: null };
        },
    },
};
const databasePath = require.resolve('../config/database.js');
require.cache[databasePath] = {
    id: databasePath, filename: databasePath, loaded: true, exports: testDatabase,
};

const {
    aiGate, PLAN_LIMITS, FREE_TRIAL_AUTO_RUNS, RUN_MAX_REQUESTS, RUN_MAX_AGE_MS,
    readRunId, asksForStyleOrAuto,
} = require('../middleware/usageGate.js');

// ── fakes ─────────────────────────────────────────────────────────────────
const VALID_RUN = 'run_11111111-2222-3333-4444-555555555555';

function mkReq(body = {}, headers = {}) {
    const lower = {};
    for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
    return {
        user: { id: 'u1' },
        path: '/chat',
        body,
        get: (h) => lower[String(h).toLowerCase()],
    };
}
function mkRes() {
    const r = { statusCode: null, payload: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json   = (p) => { r.payload = p; return r; };
    return r;
}
async function run(req) {
    const res = mkRes();
    let nexted = false;
    await aiGate(req, res, () => { nexted = true; });
    return { res, nexted, req };
}

let passed = 0;
const ok = (label) => { console.log(`  ok  ${label}`); passed += 1; };

// ──────────────────────────────────────────────────────────────────────────
console.log('── 1. An operation is a run, not a request ──');

db.reset();
db.lifetimeRuns = 0;
{
    const { nexted, req } = await run(mkReq({ editingMode: 'auto' }, { 'X-Vibed-Run-Id': VALID_RUN }));
    assert.ok(nexted, 'a trial Auto run must be allowed through');
    assert.equal(db.inserted.length, 1, 'exactly one ledger row per request');
    assert.equal(db.inserted[0].run_id, VALID_RUN, 'the row carries the run id, which is what collapses the run into one op');
    assert.equal(req.usageRunId, VALID_RUN);
    ok('a request in a run is recorded against that run');

    // Both counting questions must be asked "besides this run", or a run's own
    // first request would make its later steps look like new operations.
    const monthly = db.rpc.find(c => c.fn === 'count_monthly_ops');
    const trial   = db.rpc.find(c => c.fn === 'count_lifetime_auto_runs');
    assert.equal(monthly.args.p_exclude, VALID_RUN, 'monthly count must exclude the run being gated');
    assert.equal(trial.args.p_exclude, VALID_RUN, 'trial count must exclude the run being gated');
    ok('both counts exclude the run in flight, so a run cannot refuse its own steps');
}

db.reset();
{
    // Four requests of one run, with the ledger growing as a real run would.
    for (let i = 0; i < 4; i++) {
        db.runRows = db.inserted
            .filter(r => r.run_id === VALID_RUN)
            .map(() => ({ created_at: new Date().toISOString() }));
        const { nexted } = await run(mkReq({ editingMode: 'auto' }, { 'X-Vibed-Run-Id': VALID_RUN }));
        assert.ok(nexted, `request ${i + 1} of the run must pass`);
    }
    assert.equal(db.inserted.length, 4, 'four requests were made');
    assert.equal(new Set(db.inserted.map(r => r.run_id)).size, 1, 'all four belong to ONE run, so they bill as one operation');
    ok('a 4 request Auto run is one billable operation, not four');
}

// ──────────────────────────────────────────────────────────────────────────
console.log('── 2. The trial grants capability, and the wall is explicit ──');

db.reset();
db.lifetimeRuns = 0;
{
    const body = { editingMode: 'auto', editingStyle: { id: 'reel' }, ProjectContext: { editingMode: 'auto' } };
    const { nexted, req } = await run(mkReq(body, { 'X-Vibed-Run-Id': VALID_RUN }));
    assert.ok(nexted);
    assert.equal(body.editingMode, 'auto', 'the gate must NOT rewrite auto to normal during the trial');
    assert.equal(body.ProjectContext.editingMode, 'auto');
    assert.deepEqual(body.editingStyle, { id: 'reel' }, 'the gate must NOT blank the style during the trial');
    assert.equal(req.autoTrialActive, true);
    assert.equal(req.autoTrialRemaining, FREE_TRIAL_AUTO_RUNS);
    ok('a free account inside its trial keeps Auto and its style, untouched');
}

db.reset();
db.lifetimeRuns = FREE_TRIAL_AUTO_RUNS;
{
    const body = { editingMode: 'auto' };
    const { res, nexted } = await run(mkReq(body, { 'X-Vibed-Run-Id': VALID_RUN }));
    assert.ok(!nexted, 'a spent trial must not reach the handler');
    assert.equal(res.statusCode, 402);
    assert.equal(res.payload.error, 'AUTO_TRIAL_SPENT');
    assert.equal(res.payload.limit, FREE_TRIAL_AUTO_RUNS);
    assert.equal(res.payload.upgradeRequired, 'creator');
    assert.equal(db.inserted.length, 0, 'a refused request must not be billed');
    // The point of the whole change: it must REFUSE, not quietly hand back a
    // different edit than the one that was asked for.
    assert.equal(body.editingMode, 'auto', 'the refused body must not be silently downgraded');
    ok('a spent trial is refused with AUTO_TRIAL_SPENT, never silently downgraded');
}

db.reset();
db.lifetimeRuns = FREE_TRIAL_AUTO_RUNS;
{
    const { nexted, res } = await run(mkReq({ prompt: 'remove the silences' }));
    assert.ok(nexted, 'manual AI work stays available on the published free plan after the trial');
    assert.equal(res.statusCode, null);
    ok('after the trial a free user still gets their plain AI operations');
}

// ──────────────────────────────────────────────────────────────────────────
console.log('── 3. Volume still applies ──');

db.reset();
db.monthlyOps = PLAN_LIMITS.free.ai_ops;
{
    const { res, nexted } = await run(mkReq({ prompt: 'hello' }));
    assert.ok(!nexted);
    assert.equal(res.statusCode, 402);
    assert.equal(res.payload.error, 'AI_OPS_LIMIT');
    assert.equal(res.payload.limit, PLAN_LIMITS.free.ai_ops);
    assert.equal(db.inserted.length, 0, 'a refused request must not be billed');
    ok('the monthly cap still refuses once the runs are spent');
}

db.reset();
db.plan = 'pro';
db.monthlyOps = 9999;
{
    const { nexted } = await run(mkReq({ editingMode: 'auto' }));
    assert.ok(nexted, 'pro is unlimited (ai_ops -1) so the count must not gate it');
    ok('an unlimited plan is never refused on volume');
}

db.reset();
db.plan = 'creator';
db.lifetimeRuns = 99;
{
    const body = { editingMode: 'auto', editingStyle: { id: 'reel' } };
    const { nexted, req } = await run(mkReq(body));
    assert.ok(nexted);
    assert.equal(body.editingMode, 'auto', 'a paid plan was never stripped and still is not');
    assert.deepEqual(body.editingStyle, { id: 'reel' });
    assert.equal(req.autoTrialActive, false, 'the trial flag is for free accounts only');
    ok('a paid account is untouched and needs no trial');
}

// ──────────────────────────────────────────────────────────────────────────
console.log('── 4. A client supplied run id cannot buy unlimited AI ──');

// The id comes from the browser. Replaying one constant id would otherwise
// collapse every operation into a single billable run forever.
db.reset();
db.lifetimeRuns = 0;
db.runRows = Array.from({ length: RUN_MAX_REQUESTS }, () => ({ created_at: new Date().toISOString() }));
{
    await run(mkReq({ prompt: 'x' }, { 'X-Vibed-Run-Id': VALID_RUN }));
    assert.equal(db.inserted[0].run_id, null, 'a run past RUN_MAX_REQUESTS stops collapsing');
    ok(`a run stops collapsing after ${RUN_MAX_REQUESTS} requests`);
}

db.reset();
db.runRows = [{ created_at: new Date(Date.now() - RUN_MAX_AGE_MS - 60_000).toISOString() }];
{
    await run(mkReq({ prompt: 'x' }, { 'X-Vibed-Run-Id': VALID_RUN }));
    assert.equal(db.inserted[0].run_id, null, 'a run older than RUN_MAX_AGE_MS stops collapsing');
    ok('a stale run id stops collapsing');
}

db.reset();
db.runRows = [{ created_at: new Date().toISOString() }];
{
    await run(mkReq({ prompt: 'x' }, { 'X-Vibed-Run-Id': VALID_RUN }));
    assert.equal(db.inserted[0].run_id, VALID_RUN, 'a fresh, short run still groups');
    ok('a fresh run keeps grouping');
}

// readRunId is the only thing that trusts the client, so it is checked directly.
assert.equal(readRunId(mkReq({}, { 'X-Vibed-Run-Id': VALID_RUN })), VALID_RUN);
assert.equal(readRunId(mkReq({ runId: VALID_RUN })), VALID_RUN, 'body is accepted too');
assert.equal(readRunId(mkReq({ ProjectContext: { runId: VALID_RUN } })), VALID_RUN);
assert.equal(readRunId(mkReq({}, {})), null, 'absent means no run');
assert.equal(readRunId(mkReq({ runId: 'short' })), null, 'too short is rejected');
assert.equal(readRunId(mkReq({ runId: 'a'.repeat(65) })), null, 'too long is rejected');
assert.equal(readRunId(mkReq({ runId: "run_'; drop table usage_events;--" })), null, 'anything outside [A-Za-z0-9_-] is rejected');
assert.equal(readRunId(mkReq({ runId: 'run with spaces' })), null);
ok('the run id is validated before it reaches the ledger');

// ──────────────────────────────────────────────────────────────────────────
console.log('── 5. What counts as asking for a locked capability ──');

assert.equal(asksForStyleOrAuto({ editingMode: 'auto' }), true);
assert.equal(asksForStyleOrAuto({ ProjectContext: { editingMode: 'auto' } }), true);
assert.equal(asksForStyleOrAuto({ editingStyle: { id: 'reel' } }), true);
assert.equal(asksForStyleOrAuto({ ProjectContext: { editingStyle: { id: 'vlog' } } }), true);
assert.equal(asksForStyleOrAuto({ editingMode: 'normal' }), false);
assert.equal(asksForStyleOrAuto({ prompt: 'trim this' }), false);
assert.equal(asksForStyleOrAuto(null), false);
assert.equal(asksForStyleOrAuto(undefined), false);
ok('auto mode and any editing style count, plain requests do not');

// ──────────────────────────────────────────────────────────────────────────
console.log('── 6. The silent downgrade is gone for good ──');

const gateCode = read('../middleware/usageGate.js');
// Comments explain WHY the downgrade was removed, so match assignments only.
const gateNoComments = gateCode.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(!/editingMode\s*=\s*'normal'/.test(gateNoComments), 'usageGate must not rewrite editingMode');
assert.ok(!/editingStyle\s*=\s*null/.test(gateNoComments), 'usageGate must not blank editingStyle');
assert.ok(/AUTO_TRIAL_SPENT/.test(gateCode), 'it refuses explicitly instead');
ok('the gate no longer rewrites what the client asked for');

// The controller strips independently, so the trial has to reach it too.
const ctrl = read('../controllers/aiAgentController.js');
assert.ok(/req\.autoTrialActive/.test(ctrl), 'aiAgentController must honour the trial flag');
assert.ok(!/editingMode:\s*req\.userPlan === 'free' \? 'normal'/.test(ctrl), 'the old unconditional strip must be gone');
ok('aiAgentController treats a trial run like a paid one');

// ──────────────────────────────────────────────────────────────────────────
console.log('── 7. The ledger is the server’s alone ──');

const track = read('../client/src/utils/trackEvent.js');
assert.ok(!/usage_events/.test(track.replace(/\/\*[\s\S]*?\*\//g, '')), 'trackEvent must not write to the billing ledger');
assert.ok(/captureEvent/.test(track), 'the analytics still go to PostHog');
ok('client analytics cannot consume AI quota any more');

const migration = read('../migrations/008_usage_run_ids.sql');
assert.ok(/add column if not exists run_id/.test(migration), 'run_id column');
assert.ok(/drop policy if exists "Users insert own usage"/.test(migration), 'the client INSERT policy is dropped');
assert.ok(/create or replace function public\.count_monthly_ops/.test(migration));
assert.ok(/create or replace function public\.count_lifetime_auto_runs/.test(migration));
assert.ok(/operation like '\/%'/.test(migration), 'only server written rows are billable');
ok('migration 008 carries the column, the counts and the policy drop');

// A custom header missing from the CORS allow list makes the browser block the
// whole request, so the run id would take every Auto request down with it.
const indexCode = read('../index.js');
const allowed = indexCode.match(/allowedHeaders:\s*\[([^\]]*)\]/);
assert.ok(allowed, 'allowedHeaders must still be configured');
assert.ok(/X-Vibed-Run-Id/i.test(allowed[1]), 'X-Vibed-Run-Id must be allowed through CORS');
assert.ok(/X-Session-Id/i.test(allowed[1]), 'X-Session-Id must be allowed through CORS');
ok('both custom headers clear the CORS preflight');

// ──────────────────────────────────────────────────────────────────────────
console.log('── 8. The client opens and closes a run ──');

const autopilot = read('../client/src/agent/StyleAutopilot.js');
assert.ok(/beginAutoRun\(\)/.test(autopilot), 'a run is opened');
assert.ok(/endAutoRun\(\)/.test(autopilot), 'and closed');
// Closing must be in the finally block, or a thrown step leaves the id set and
// the NEXT edit silently joins the dead run and bills as part of it.
const finallyBlock = autopilot.slice(autopilot.indexOf('} finally {'));
assert.ok(/endAutoRun\(\)/.test(finallyBlock.slice(0, 400)), 'endAutoRun must be in the finally block, so a failed step cannot leak the run id');
ok('the run is closed in finally, so a failed step cannot leak it into the next edit');

const fetchCode = read('../client/src/utils/authFetch.js');
assert.ok(/currentAutoRunId\(\)/.test(fetchCode));
assert.ok(/'X-Vibed-Run-Id'/.test(fetchCode));
// buildHeaders is used for the first attempt AND the 401 retry; adding the
// header anywhere else would drop it on the retry.
assert.ok(fetchCode.indexOf("'X-Vibed-Run-Id'") < fetchCode.indexOf('export async function authFetch'),
    'the header must be set in buildHeaders so the 401 retry keeps it');
ok('every request of a run carries the id, including a token refresh retry');

console.log(`\n${passed} checks passed.`);
