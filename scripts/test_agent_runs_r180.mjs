// scripts/test_agent_runs_r180.mjs — R180: run budgets, learning across runs,
// evaluation in Langfuse, runs in the data export. Executes the REAL modules
// and the REAL run router against an in-memory database.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

const C = await import('../client/src/agent/runs/goalContract.js');
const R = await import('../client/src/agent/runs/runState.js');
const LRN = await import('../client/src/agent/runs/runLearning.js');

// Usage the "server" counted per run, controlled by the test.
const usage = new Map();
const realLangfuse = require('../services/tracing/langfuse.js');
stub('../services/tracing/langfuse.js', { ...realLangfuse, usageFor: (id) => usage.get(id) || null, recordRunChange: () => {} });

console.log('\n§1 budgets (server)');
const B = require('../services/agentRunBudget.js');
{
    ok(B.limits().maxAiCalls === 150 && B.limits().maxExportMinutes === 15 && B.limits().monthlyAiCalls === 3000, 'defaults when nothing is set');
    process.env.AGENT_RUN_MAX_AI_CALLS = '12'; process.env.AGENT_RUN_MAX_EXPORT_MINUTES = 'lots';
    ok(B.limits().maxAiCalls === 12 && B.limits().maxExportMinutes === 15, 'a setting is read, a bad one falls back to the default');
    delete process.env.AGENT_RUN_MAX_EXPORT_MINUTES;
    ok(B.mergeCost({ aiCalls: 40, inputTokens: 5 }, { aiCalls: 3, inputTokens: 9 }).aiCalls === 40 && B.mergeCost({ aiCalls: 40, inputTokens: 5 }, { aiCalls: 3, inputTokens: 9 }).inputTokens === 9, 'a restart never lowers a saved count');
    ok(B.monthStart(Date.parse('2026-11-28T10:00:00Z')) === '2026-11-01T00:00:00.000Z', 'the month starts on the 1st, UTC');
    const guard = B.runBudgetGuard((req) => (req.headers['x-vibed-agent-run'] ? { runId: req.headers['x-vibed-agent-run'] } : null));
    const tryGuard = (p, run) => new Promise((resolve) => {
        const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
        guard({ path: p, headers: run ? { 'x-vibed-agent-run': run } : {} }, res, () => resolve({ code: 'next' }));
    });
    usage.set('run-a', { aiCalls: 12 }); usage.set('run-b', { aiCalls: 3 });
    ok((await tryGuard('/api/ai/parse-intent', 'run-a')).body?.code === 'RUN_BUDGET', 'a run step past its budget is refused (429 RUN_BUDGET)');
    ok((await tryGuard('/api/ai/parse-intent', 'run-b')).code === 'next', 'under budget it goes through');
    ok((await tryGuard('/api/agent-runs/x', 'run-a')).code === 'next', "the run's own save always passes, so it can record why it stopped");
    ok((await tryGuard('/api/ai/parse-intent', null)).code === 'next', 'a request that is not a run step is never touched');
}

console.log('\n§2 the router: monthly budget, history, reset');
const db = { agent_runs: [], projects: [{ id: '22222222-2222-4222-8222-222222222222', user_id: 'u1' }] };
let seq = 0;
function builder(table) {
    const st = { filters: [], op: 'select', patch: null, single: false, limit: null, asc: true };
    const rows = () => db[table].filter(r => st.filters.every(fn => fn(r)));
    const run = () => {
        if (st.op === 'insert') {
            const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;
            const row = { id, created_at: new Date(Date.now() + seq * 1000).toISOString(), updated_at: new Date().toISOString(), cost: {}, learning_excluded: false, ...st.patch };
            db[table].push(row);
            return { data: st.single ? { ...row } : [{ ...row }], error: null };
        }
        if (st.op === 'update') { const hit = rows(); for (const r of hit) Object.assign(r, st.patch); return { data: hit.map(r => ({ ...r })), error: null }; }
        let data = rows().map(r => ({ ...r }));
        data.sort((a, b) => (st.asc ? 1 : -1) * String(a.created_at).localeCompare(String(b.created_at)));
        if (st.limit) data = data.slice(0, st.limit);
        return { data: st.single ? (data[0] || null) : data, error: null };
    };
    const b = {
        select() { return b; }, limit(n) { st.limit = n; return b; }, order(c, o) { st.asc = o?.ascending !== false; return b; },
        insert(row) { st.op = 'insert'; st.patch = row; return b; }, update(p) { st.op = 'update'; st.patch = p; return b; },
        eq(c, v) { st.filters.push(r => r[c] === v); return b; }, in(c, vs) { st.filters.push(r => vs.includes(r[c])); return b; },
        gte(c, v) { st.filters.push(r => String(r[c]) >= String(v)); return b; },
        not(c, op, list) { const vals = String(list).replace(/[()]/g, '').split(','); st.filters.push(r => !vals.includes(r[c])); return b; },
        maybeSingle() { st.single = true; return Promise.resolve(run()); }, single() { st.single = true; return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
}
stub('../config/database.js', { supabaseAdmin: { from: builder } });
stub('../middleware/auth.js', { authenticateUser: (req, res, next) => { const id = req.headers['x-user']; if (!id) return res.status(401).end(); req.user = { id }; next(); } });
const evaluated = [];
stub('../services/tracing/langfuseEval.js', { evaluateRun: (row) => { evaluated.push(row.id); return Promise.resolve(true); } });
const express = require('express');
const app = express(); app.use(express.json()); app.use('/api/agent-runs', require('../routes/agentRunRoutes.js'));
const server = http.createServer(app);
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/api/agent-runs`;
const call = async (method, p, user, body) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
};
try {
    const goal = C.createGoal(C.GOAL_KINDS.SHORTS_FROM_LONG_VIDEO, { count: 2 }).goal;
    process.env.AGENT_RUN_MONTHLY_AI_CALLS = '100';
    const created = await call('POST', '/', 'u1', { goal, status: 'awaiting_plan_approval', state: {} });
    ok(created.status === 201 && created.body.budget?.maxAiCalls === 12 && created.body.budget?.monthlyAiCalls === 100 && created.body.budget.usedThisMonth === 0, 'a new run is told its budget and this month\'s use');
    const id = created.body.run.id;
    db.agent_runs.find(r => r.id === id).cost = { aiCalls: 100 };
    B._resetForTests();
    const refused = await call('POST', '/', 'u1', { goal, status: 'awaiting_plan_approval', state: {} });
    ok(refused.status === 402 && refused.body.code === 'AGENT_MONTHLY_BUDGET' && /resets on the 1st/.test(refused.body.message), "once this month's budget is used, a new run is refused and told when it resets");
    db.agent_runs.find(r => r.id === id).cost = {};
    B._resetForTests();

    // History: ended runs only, the user's own, not excluded.
    db.agent_runs.push(
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-100000000001', user_id: 'u1', status: 'done', goal, learning_excluded: false, created_at: '2026-11-20T00:00:00Z', state: { decisions: { s1: { decision: 'kept' } }, shortFacts: { s1: { seconds: 30 } }, posts: [{ shortId: 's1', provider: 'youtube', publicationId: 'p1', caption: 'secret copy' }, { shortId: 's2', provider: 'youtube' }] } },
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-100000000002', user_id: 'u1', status: 'finding', goal, learning_excluded: false, created_at: '2026-11-21T00:00:00Z', state: {} },
        { id: 'aaaaaaaa-aaaa-4aaa-8aaa-100000000003', user_id: 'u2', status: 'done', goal, learning_excluded: false, created_at: '2026-11-21T00:00:00Z', state: {} },
    );
    const h = await call('GET', '/history', 'u1');
    ok(h.status === 200 && h.body.runs.length === 1 && h.body.runs[0].id.endsWith('100000000001'), 'history is the user\'s own ended runs only');
    ok(h.body.runs[0].posts.length === 1 && !('caption' in h.body.runs[0].posts[0]) && h.body.runs[0].shortFacts.s1.seconds === 30, 'only what learning reads: decisions, facts, scheduled posts (no copy)');
    const reset = await call('POST', '/history/reset', 'u1');
    ok(reset.status === 200 && reset.body.excluded >= 1 && db.agent_runs.find(r => r.user_id === 'u2').learning_excluded === false, 'reset excludes the user\'s runs, nobody else\'s');
    ok((await call('GET', '/history', 'u1')).body.runs.length === 0, 'after a reset, nothing teaches');
    ok(db.agent_runs.filter(r => r.user_id === 'u1').length >= 3, 'the runs themselves are kept');

    // Ending a run sends it to evaluation.
    await call('PATCH', `/${id}`, 'u1', { status: 'stopped', state: {} });
    ok(evaluated.includes(id), 'a run that ends is scored and added to the dataset');
} finally { server.close(); }

console.log('\n§3 the run respects its budget');
{
    const goal = C.createGoal(C.GOAL_KINDS.SHORTS_TO_POSTS, { count: 1 }).goal;
    let run = R.createRun(goal, { id: 'r1' });
    run = R.applyRunEvent(run, { type: 'set_budget', budget: { maxAiCalls: 10, maxExportMinutes: 2, monthlyAiCalls: 3000, usedThisMonth: 5 } }).run;
    ok(run.budget.maxAiCalls === 10 && R.overBudget(run) === null, 'a run under budget may go on');
    ok(/10 AI calls/.test(R.overBudget({ ...run, cost: { aiCalls: 10 } })), 'at its AI-call budget it must stop');
    ok(/2 minutes/.test(R.overBudget({ ...run, spent: { exportSeconds: 100 } }, { nextExportSeconds: 30 })), 'an export that would pass the video budget is not started');
    ok(R.overBudget({ ...run, budget: null, cost: { aiCalls: 999 } }) === null, 'a run that was never given a budget (unsaved) is not stopped by one');
}

console.log('\n§4 learning across runs');
{
    const mkRun = (shorts) => ({
        decisions: Object.fromEntries(shorts.map(([id, , kept]) => [id, { decision: kept ? 'kept' : 'dropped' }])),
        shortFacts: Object.fromEntries(shorts.map(([id, seconds, , hook]) => [id, { seconds, hook: hook || null }])),
        posts: [],
    });
    const little = LRN.learnFromRuns([mkRun([['a', 30, true], ['b', 70, false]])]);
    ok(!little.usable && little.count === null && little.maxSeconds === null, 'one run and two decisions teach nothing yet');
    const history = [
        mkRun([['a1', 28, true, 'question'], ['a2', 32, true], ['a3', 70, false], ['a4', 65, false]]),
        mkRun([['b1', 30, true, 'question'], ['b2', 25, true], ['b3', 80, false]]),
        mkRun([['c1', 33, true], ['c2', 60, false], ['c3', 29, true, 'question']]),
    ];
    const L = LRN.learnFromRuns(history);
    ok(L.usable && L.runs === 3 && L.decided === 10 && L.kept === 6, 'three runs, ten decisions: usable');
    ok(L.preferredBucket === 's' && L.byBucket.s.kept === 6 && L.byBucket.s.total === 6, 'the length the user keeps most is found (20-35 s, 6 of 6)');
    ok(L.count === 2 && L.maxSeconds === 40, 'the usual number kept and a length cap that covers what was kept');
    const goal = C.createGoal(C.GOAL_KINDS.SHORTS_FROM_LONG_VIDEO, { count: 3 }).goal;
    const applied = LRN.applyLearning(goal, L);
    ok(applied.plan.count === 2 && applied.plan.maxSeconds === 40 && applied.adjusted.join() === 'count,maxSeconds', 'what the request left open follows the learning');
    const asked = C.createGoal(C.GOAL_KINDS.SHORTS_FROM_LONG_VIDEO, { count: 5, maxSeconds: 90, criteria: { count: 5, maxSeconds: 90 } }).goal;
    const kept = LRN.applyLearning(asked, L);
    ok(kept.plan.count === 5 && kept.plan.maxSeconds === 90 && kept.adjusted.length === 0, 'a count or length the user asked for is never overridden');
    const found = [{ id: 'long', start: 0, end: 70, score: 80 }, { id: 'mid', start: 0, end: 30, score: 70 }, { id: 'mid2', start: 0, end: 31, score: 60, hookEvent: 'question' }, { id: 'xl', start: 0, end: 90, score: 75 }];
    ok(LRN.pickWithLearning(found, 2, LRN.learnedSummary(L)).join() === 'mid,mid2', 'from extra candidates it keeps the lengths and hooks the user keeps');
    ok(LRN.pickWithLearning(found, 2, null).join() === 'long,xl', 'with nothing learned, the picker\'s own score decides');
    // Views of posted shorts nudge the preferred length.
    const withPosts = history.map((r, i) => ({ ...r, posts: [{ shortId: Object.keys(r.decisions)[0], publicationId: `p${i}` }] }));
    const L2 = LRN.learnFromRuns(withPosts, [{ id: 'p0', metrics: { views: 900 } }, { id: 'p1', metrics: { views: 1200 } }, { id: 'p2', metrics: { views: 700 } }]);
    ok(L2.posted === 3 && L2.viewsByBucket.s.medianViews === 900, 'posted shorts\' views are matched to their length');
    const sum = LRN.learnedSummary(L, applied.adjusted);
    ok(sum && sum.preferredLabel === '20-35 s' && JSON.stringify(sum).length < 4000, 'the summary kept with the run is small');

    let run = R.createRun(goal, { id: 'r2' });
    run = R.applyRunEvent(run, { type: 'apply_learning', learned: sum, plan: applied.plan }).run;
    ok(run.plan.count === 2 && run.learned?.runs === 3, 'the plan shows the learned values');
    run = R.applyRunEvent(run, { type: 'apply_learning', learned: null, plan: run.goal.params }).run;
    ok(run.plan.count === 3 && run.learned === null, 'reset puts the request\'s own defaults back');
    run = R.applyRunEvent(run, { type: 'approve_plan' }).run;
    run = R.applyRunEvent(run, { type: 'shorts_found', shortIds: ['x'], facts: { x: { seconds: 31.2, platform: 'reels', hook: 'question', score: 70.4 } } }).run;
    ok(run.shortFacts.x.seconds === 31.2 && run.shortFacts.x.score === 70, 'each found short\'s facts are recorded for the next runs');
    ok(!R.applyRunEvent(run, { type: 'apply_learning', learned: null }).ok, 'learning can only change a plan still waiting for approval');
}

console.log('\n§5 evaluation in Langfuse');
{
    const E = (delete require.cache[require.resolve('../services/tracing/langfuseEval.js')], require('../services/tracing/langfuseEval.js'));
    const row = {
        id: '12345678-1234-4234-8234-123456789abc', status: 'done', goal: { kind: 'shorts_to_posts', params: { count: 2 } }, cost: { aiCalls: 17 },
        state: {
            decisions: { a: { decision: 'kept' }, b: { decision: 'dropped' }, c: { decision: 'kept' } },
            verification: { met: false, checks: [] },
            posts: [{ key: 'a', publicationId: 'p1' }, { key: 'c', publicationId: null }, { key: 'd', skip: true }],
            approvals: [{ kind: 'schedule', decision: 'approved' }],
            plan: { count: 2 }, criteria: { scheduled: true },
        },
    };
    const scores = E.runScores(row);
    const by = Object.fromEntries(scores.map(s => [s.name, s]));
    ok(by.keep_rate.value === 0.667 && by.criteria_met.value === 0 && by.criteria_met.dataType === 'BOOLEAN' && by.scheduled_rate.value === 0.5 && by.ai_calls.value === 17, 'keep rate, criteria met, scheduled rate and AI calls');
    ok(scores.every(s => s.traceId === '12345678123442348234123456789abc' && s.id.startsWith(s.traceId)), 'scores land on the run\'s own trace, with stable ids');
    const item = E.datasetItemFor(row);
    ok(item.datasetName === 'agent-runs' && item.id === `agent-run-${row.id}` && item.sourceTraceId === scores[0].traceId && item.metadata.scheduled === 1, 'the run becomes a dataset item linked to its trace');
    ok(!JSON.stringify(item).includes('caption') && !JSON.stringify(scores).includes('caption'), 'no copy or captions are sent');
    const sent = [];
    const fetchImpl = async (url, opts) => { sent.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: true, text: async () => '' }; };
    const env = { LANGFUSE_PUBLIC_KEY: 'pk-lf-x', LANGFUSE_SECRET_KEY: 'sk-lf-y', LANGFUSE_TRACING_ENVIRONMENT: 'production' };
    await E.evaluateRun(row, { fetchImpl, env });
    ok(sent.map(s => s.url.replace('https://cloud.langfuse.com', '')).join() === '/api/public/scores,/api/public/v2/datasets,/api/public/dataset-items', 'scores, the dataset (once), then the item');
    ok(sent[0].opts.headers.Authorization === `Basic ${Buffer.from('pk-lf-x:sk-lf-y').toString('base64')}` && Array.isArray(sent[0].body) && sent[0].body[0].environment === 'production', 'Basic auth, an array of scores, with the environment');
    await E.evaluateRun(row, { fetchImpl, env });
    ok(sent.filter(s => s.url.endsWith('/v2/datasets')).length === 1, 'the dataset is created once per process');
    sent.length = 0;
    ok((await E.evaluateRun(row, { fetchImpl, env: {} })) === false && sent.length === 0, 'without keys nothing is sent');
    const failing = async () => ({ ok: false, status: 400, text: async () => 'bad' });
    ok((await E.evaluateRun(row, { fetchImpl: failing, env })) === true, 'a refusal is logged and never breaks anything');
    await E.scorePostViews(row.id, 'p1', 1234, { provider: 'youtube', fetchImpl, env });
    ok(sent[0]?.body[0].name === 'post_views_7d' && sent[0].body[0].value === 1234, 'seven-day views of a scheduled post score the run');
}

console.log('\n§6 wiring');
{
    const idx = read('index.js');
    const g = idx.indexOf('runBudgetGuard'), ctx = idx.indexOf("agentRunContext);"), ai = idx.indexOf("'/api/ai'");
    ok(g > ctx && (ai === -1 || g < ai), 'the budget guard runs after the run context and before the AI routes');
    const brain = read('server/routes/brainRoutes.js');
    ok(/from\('agent_runs'\)\.select\('\*'\)\.eq\('user_id', userId\)/.test(brain) && /agent_runs:\s+agentRunsRes\.data/.test(brain), 'agent runs are in the account data export');
    ok(/from\('agent_runs'\)\.update\(\{ learning_excluded: true \}\)\.eq\('user_id', userId\)/.test(brain), 'resetting the learned style also stops runs from teaching');
    ok(/agentRunId/.test(read('routes/socialRoutes.js')) && /scorePostViews\(runId/.test(read('services/social/analytics.js')), 'a scheduled post carries its run, and its 7-day views score it');
    const store = read('client/src/store/useAgentRunStore.js');
    ok(/runHistoryRemote\(\)/.test(store) && /pickWithLearning\(/.test(store) && /AGENT_MONTHLY_BUDGET/.test(store) && /_stopIfOverBudget\(\{ nextExportSeconds/.test(store), 'the store learns at plan time, ranks at find time, and stops before going over budget');
    const card = read('client/src/components/AgentRunCard.jsx');
    ok(/store\.resetLearning\(\)/.test(card) && /<BudgetLine/.test(card), 'the plan shows what was learned (with a reset) and the budget');
    const mig = read('supabase/migrations/20240016_agent_run_learning.sql');
    ok(/add column if not exists learning_excluded boolean not null default false/.test(mig), 'the learning flag migration');
    for (const l of ['en', 'fr']) {
        const a = JSON.parse(read(`client/src/locales/${l}/editor.json`)).agentRun;
        ok(['budget', 'learnedFrom', 'learnedReset', 'bucket_s'].every(k => a[k]), `${l}: copy exists`);
    }
}

console.log(`\n${'─'.repeat(60)}\nAgent runs R180: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
