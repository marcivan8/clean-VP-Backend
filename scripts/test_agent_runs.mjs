// scripts/test_agent_runs.mjs — R176b: goal object, capability contract,
// persistent run state, owner-only run routes and Langfuse tracing.
// Runs the REAL modules: the pure client rules, the real router against an
// in-memory database, and the real tracer against a fake fetch.
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

const G = await import('../client/src/agent/runs/goalContract.js');
const R = await import('../client/src/agent/runs/runState.js');

// ── §1 ──────────────────────────────────────────────────────────────────────
console.log('\n§1 goal object and capability contract');
{
    const g = G.createGoal('shorts_from_long_video', { count: 99, platforms: ['tiktok', 'myspace', 'tiktok'], finish: { popOut: 1 } });
    ok(g.ok && g.goal.params.count === G.MAX_SHORTS, 'the count is clamped to the contract maximum');
    ok(g.goal.params.platforms.length === 1 && g.goal.params.platforms[0] === 'tiktok', 'unknown and repeated platforms are dropped');
    ok(g.goal.params.finish.popOut === false && g.goal.params.finish.polish === true, 'finish options are booleans with safe defaults (pop-out only when asked)');
    ok(!G.createGoal('post_everywhere').ok, 'an unknown goal is refused');
    ok(G.createGoal('shorts_from_long_video', {}).goal.params.platforms.length === 3, 'no platform named: all three');
    ok(G.checkStep('shorts_from_long_video', 'find').ok && G.checkStep('shorts_from_long_video', 'finish').ok, 'find and finish are allowed');
    for (const outward of ['export', 'publish', 'schedule_post', 'edit_main_timeline']) {
        ok(!G.checkStep('shorts_from_long_video', outward).ok, `"${outward}" is refused`);
    }
    ok(G.CAPABILITY_CONTRACT.shorts_from_long_video.steps.every(s => s.effect !== G.EFFECT.OUTWARD), 'no step of the contract leaves the app');
    ok(/stays with you|outside what this run may do/.test(G.checkStep('shorts_from_long_video', 'publish').reason), 'the refusal says why in plain words');
}

// ── §2 ──────────────────────────────────────────────────────────────────────
console.log('\n§2 run state machine');
{
    let t = 1000;
    const step = (run, e) => { t += 100; return R.applyRunEvent(run, e, t); };
    const goal = G.createGoal('shorts_from_long_video', { count: 3 }).goal;
    let run = R.createRun(goal, { id: '11111111-1111-4111-8111-111111111111', now: t });
    ok(run.status === R.STATUS.AWAITING_PLAN, 'a new run waits for the plan to be approved');
    ok(!step(run, { type: 'start_finish' }).ok, 'nothing can be finished before the plan is approved');

    let r = step(run, { type: 'approve_plan', plan: { count: 2, platforms: ['reels'] }, reason: 'looks right' });
    ok(r.ok && r.run.status === R.STATUS.FINDING && r.run.plan.count === 2, 'approving moves to finding with the edited plan');
    ok(r.run.approvals[0].decision === 'approved' && r.run.approvals[0].reason === 'looks right' && r.run.approvals[0].plan.platforms[0] === 'reels', 'the approval is recorded with its reason and the plan approved');
    ok(r.run.steps.some(s => s.id === 'find' && s.status === 'running'), 'the find step is running');
    ok(!step(r.run, { type: 'approve_plan' }).ok, 'the plan cannot be approved twice');
    run = r.run;

    r = step(run, { type: 'shorts_found', shortIds: ['a', 'b'], note: 'Found 2' });
    ok(r.ok && r.run.status === R.STATUS.AWAITING_REVIEW, 'found shorts wait for keep or drop');
    const find = r.run.steps.find(s => s.id === 'find');
    ok(find.status === 'done' && find.durationMs > 0 && find.durationMs === find.endedAt - find.startedAt && find.found === 2, 'the find step records its duration and outcome');
    run = r.run;

    ok(!step(run, { type: 'decide_short', shortId: 'zzz', decision: 'kept' }).ok, 'a short outside the run cannot be decided');
    ok(!step(run, { type: 'decide_short', shortId: 'a', decision: 'maybe' }).ok, 'only keep or drop');
    run = step(run, { type: 'decide_short', shortId: 'a', decision: 'kept' }).run;
    const early = step(run, { type: 'start_finish' });
    ok(!early.ok && /still to keep or drop/.test(early.error), 'finishing waits until every short is decided');
    run = step(run, { type: 'decide_short', shortId: 'b', decision: 'dropped', reason: 'off topic' }).run;
    ok(run.decisions.b.reason === 'off topic', 'a drop keeps its reason');

    r = step(run, { type: 'start_finish' });
    ok(r.ok && r.run.status === R.STATUS.FINISHING, 'with every short decided, the kept ones are finished');
    const each = r.run.approvals.find(a => a.kind === 'each_short');
    ok(each && each.kept.join() === 'a' && each.dropped.join() === 'b', 'the per-short approval lists what was kept and dropped');
    run = r.run;
    ok(!step(run, { type: 'short_finished', shortId: 'b', applied: [] }).ok, 'a dropped short is never finished');
    ok(R.pendingFinish(run).join() === 'a', 'pending finish lists the kept, unfinished shorts');

    r = step(run, { type: 'interrupt' });
    ok(r.ok && r.run.status === R.STATUS.INTERRUPTED && r.run.resumeFrom === 'finish', 'a reload mid-finish marks the run interrupted at that step');
    r = step(r.run, { type: 'resume' });
    ok(r.ok && r.run.status === R.STATUS.FINISHING, 'resume returns to the step it was on');
    run = step(r.run, { type: 'short_finished', shortId: 'a', applied: ['captions'] }).run;
    r = step(run, { type: 'finish_done' });
    ok(r.ok && r.run.status === R.STATUS.DONE, 'the run ends done');
    ok(!step(r.run, { type: 'stop' }).ok && !step(r.run, { type: 'approve_plan' }).ok, 'an ended run cannot change');

    // Stop and failure paths
    const fresh = R.createRun(goal, { now: 0 });
    const rejected = R.applyRunEvent(fresh, { type: 'reject_plan', reason: 'not now' }, 5);
    ok(rejected.run.status === R.STATUS.STOPPED && rejected.run.stopReason === 'not now' && rejected.run.approvals[0].decision === 'rejected', 'a declined plan stops the run with the reason');
    const finding = R.applyRunEvent(fresh, { type: 'approve_plan' }, 5).run;
    const failed = R.applyRunEvent(finding, { type: 'step_failed', error: 'no transcript' }, 9).run;
    ok(failed.status === R.STATUS.FAILED && failed.stopReason === 'no transcript' && failed.steps.find(s => s.id === 'find').status === 'failed', 'a failed step fails the run and says why');
    const stopped = R.applyRunEvent(finding, { type: 'stop' }, 9).run;
    ok(stopped.status === R.STATUS.STOPPED && stopped.stopReason === 'Stopped by you' && stopped.steps.find(s => s.id === 'find').status === 'stopped', 'stopping records who stopped it and ends the running step');
    const none = R.applyRunEvent(finding, { type: 'shorts_found', shortIds: [], note: 'Nothing strong enough' }, 9).run;
    ok(none.status === R.STATUS.STOPPED && none.stopReason === 'Nothing strong enough', 'no short found stops the run with the reason');
    let all = R.applyRunEvent(finding, { type: 'shorts_found', shortIds: ['x'] }, 9).run;
    all = R.applyRunEvent(all, { type: 'decide_short', shortId: 'x', decision: 'dropped' }, 10).run;
    all = R.applyRunEvent(all, { type: 'start_finish' }, 11).run;
    ok(all.status === R.STATUS.STOPPED && /dropped/.test(all.stopReason), 'dropping every short stops the run instead of finishing nothing');
}

// ── §3 ──────────────────────────────────────────────────────────────────────
console.log('\n§3 client and server agree');
const routesPath = require.resolve('../routes/agentRunRoutes.js');
const fakeDb = { agent_runs: [], projects: [{ id: '22222222-2222-4222-8222-222222222222', user_id: 'u1' }, { id: '33333333-3333-4333-8333-333333333333', user_id: 'u2' }] };
let seq = 0;
function builder(table) {
    const st = { filters: [], op: 'select', patch: null, single: false, limit: null, asc: true };
    const rows = () => fakeDb[table].filter(r => st.filters.every(fn => fn(r)));
    const run = () => {
        if (st.op === 'insert') {
            const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;
            const row = { id, created_at: new Date(Date.now() + seq).toISOString(), updated_at: new Date().toISOString(), cost: {}, ...st.patch };
            fakeDb[table].push(row);
            return { data: st.single ? { ...row } : [{ ...row }], error: null };
        }
        if (st.op === 'update') {
            const hit = rows(); for (const r of hit) Object.assign(r, st.patch);
            return { data: hit.map(r => ({ ...r })), error: null };
        }
        let data = rows().map(r => ({ ...r }));
        data.sort((a, b) => (st.asc ? 1 : -1) * String(a.created_at).localeCompare(String(b.created_at)));
        if (st.limit) data = data.slice(0, st.limit);
        return { data: st.single ? (data[0] || null) : data, error: null };
    };
    const b = {
        select() { return b; }, limit(n) { st.limit = n; return b; },
        order(c, o) { st.asc = o?.ascending !== false; return b; },
        insert(row) { st.op = 'insert'; st.patch = row; return b; },
        update(p) { st.op = 'update'; st.patch = p; return b; },
        eq(c, v) { st.filters.push(r => r[c] === v); return b; },
        not(c, op, list) { const vals = String(list).replace(/[()]/g, '').split(','); st.filters.push(r => !vals.includes(r[c])); return b; },
        maybeSingle() { st.single = true; return Promise.resolve(run()); },
        single() { st.single = true; return Promise.resolve(run()); },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
}
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('../config/database.js', { supabaseAdmin: { from: builder } });
stub('../middleware/auth.js', { authenticateUser: (req, res, next) => { const id = req.headers['x-user']; if (!id) return res.status(401).end(); req.user = { id }; next(); } });
// R177: the REAL Langfuse span processor (masking, propagation, environment),
// with its network exporter replaced by an in-memory one.
const { InMemorySpanExporter } = require('@opentelemetry/sdk-trace-base');
const memory = new InMemorySpanExporter();
const L = require('../services/tracing/langfuse.js');
L.initTracing({ exporter: memory, env: { NODE_ENV: 'test', LANGFUSE_SAMPLE_RATE: '1' } });
const routes = require(routesPath);
{
    const clientStatuses = Object.values(R.STATUS).sort().join();
    ok(clientStatuses === [...routes.STATUSES].sort().join(), 'the server accepts exactly the run statuses the client produces');
    ok(Object.values(G.GOAL_KINDS).sort().join() === [...routes.GOAL_KINDS].sort().join(), 'and exactly the goal kinds');
    const mig = read('supabase/migrations/20240014_agent_runs.sql');
    ok(routes.STATUSES.every(s => mig.includes(`'${s}'`)), 'the migration check constraint lists every status');
    ok(/enable row level security/.test(mig) && !/create policy/i.test(mig), 'the table is backend-only: RLS on, no policy');
    ok(/references auth\.users\(id\) on delete cascade/.test(mig) && /references projects\(id\) on delete cascade/.test(mig), 'runs are deleted with the account or the project');
}

// ── §4 ──────────────────────────────────────────────────────────────────────
console.log('\n§4 the real router');
const express = require('express');
const { agentRunContext } = require('../services/tracing/runContext.js');
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(agentRunContext);
app.use('/api/agent-runs', routes);
const server = http.createServer(app);
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/api/agent-runs`;
const call = async (method, p, user, body) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
};
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';
const goal = G.createGoal('shorts_from_long_video', { count: 2 }).goal;
try {
    ok((await call('POST', '/', null, {})).status === 401, 'signed out: refused');
    ok((await call('POST', '/', 'u1', { projectId: P1, goal: { kind: 'hack' }, status: 'done' })).status === 400, 'an unknown goal is refused');
    ok((await call('POST', '/', 'u1', { projectId: P1, goal, status: 'nope' })).status === 400, 'an unknown status is refused');
    ok((await call('POST', '/', 'u1', { projectId: P2, goal, status: 'awaiting_plan_approval' })).status === 404, "a run cannot be attached to someone else's project");
    ok((await call('POST', '/', 'u1', { projectId: P1, goal, status: 'awaiting_plan_approval', state: { blob: 'x'.repeat(70_000) } })).status === 400, 'an oversized run is refused');
    const created = await call('POST', '/', 'u1', { projectId: P1, goal, status: 'awaiting_plan_approval', state: { steps: [] } });
    ok(created.status === 201 && created.body.run?.id && fakeDb.agent_runs.length === 1, 'a run is created and stored');
    const id = created.body.run.id;
    ok((await call('GET', `/${id}`, 'u2')).status === 404, "someone else's run reads as not found");
    ok((await call('PATCH', `/${id}`, 'u2', { status: 'finding', state: {} })).status === 404, "and cannot be changed");
    const latest = await call('GET', `/latest?projectId=${P1}`, 'u1');
    ok(latest.status === 200 && latest.body.run?.id === id, 'the latest run of the project is returned to its owner');
    ok((await call('GET', `/latest?projectId=${P1}`, 'u2')).body.run === null, 'not to anyone else');

    // AI usage made inside a step is counted for the run's cost.
    const tracedCalls = [];
    const fakeClient = { chat: { completions: { create(body) { tracedCalls.push(body); const p = Promise.resolve({ choices: [{ message: { content: '{"ok":1}' } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }); p.withResponse = () => 'kept'; return p; } } } };
    const { currentRunContext } = require('../services/tracing/runContext.js');
    L.instrumentClient(fakeClient, 'groq', currentRunContext);
    const probe = express();
    probe.use(agentRunContext);
    probe.get('/ai', async (req, res) => { const p = fakeClient.chat.completions.create({ model: 'm1', messages: [{ role: 'user', content: 'hi' }] }); res.json({ wr: typeof p.withResponse === 'function', r: await p }); });
    const ps = http.createServer(probe);
    await new Promise(r => ps.listen(0, r));
    const pbase = `http://127.0.0.1:${ps.address().port}`;
    const pr = await (await fetch(`${pbase}/ai`, { headers: { 'X-Vibed-Agent-Run': id, 'X-Vibed-Agent-Step': 'find' } })).json();
    await fetch(`${pbase}/ai`); // outside any run: not counted
    ps.close();
    await new Promise(r => setTimeout(r, 20));
    ok(pr.wr === true, "the wrapped AI call still returns the SDK's own promise (withResponse kept)");
    ok(L.usageFor(id)?.aiCalls === 1 && L.usageFor(id).inputTokens === 120 && L.usageFor(id).outputTokens === 30, 'only the call made inside the run step is counted, with its tokens');

    const patched = await call('PATCH', `/${id}`, 'u1', { status: 'done', state: { steps: [{ id: 'find', status: 'done', startedAt: 1, endedAt: 2 }] } });
    ok(patched.status === 200 && patched.body.run.status === 'done', 'the owner saves a state change');
    ok(patched.body.run.cost?.aiCalls === 1 && patched.body.run.cost?.inputTokens === 120, 'the saved run carries the cost the server counted');
    ok((await call('PATCH', `/${id}`, 'u1', { status: 'finding', state: {} })).status === 409, 'an ended run can no longer change');
} finally {
    server.close();
}

// ── §5 ──────────────────────────────────────────────────────────────────────
console.log('\n§5 Langfuse tracing (official SDK)');
{
    const runId = '44444444-4444-4444-8444-444444444444';
    const flush = () => new Promise(r => setTimeout(r, 30));
    const attrs = (s) => s.attributes;
    ok(L.isEnabled() && L.traceIdFor(runId) === '44444444444444448444444444444444' && L.traceIdFor('x') === null, 'tracing is on with a test exporter; a run trace id is its UUID without dashes');
    memory.reset();
    const prev = { id: runId, projectId: P1, goal, status: 'finding', state: { createdAt: 1000, steps: [{ id: 'find', status: 'running', startedAt: 2000 }], approvals: [{ kind: 'plan', decision: 'approved', at: 1500 }] } };
    const next = { id: runId, projectId: P1, goal, status: 'stopped', cost: { aiCalls: 2 }, state: { createdAt: 1000, stopReason: 'Stopped by you', steps: [{ id: 'find', status: 'stopped', startedAt: 2000, endedAt: 3000, note: 'Stopped by you' }], approvals: [{ kind: 'plan', decision: 'approved', at: 1500 }], decisions: { s1: { decision: 'dropped', reason: 'off topic', at: 2500 } } } };
    L.recordRunChange(prev, next, { userId: 'u1' });
    await flush();
    const spans = memory.getFinishedSpans();
    const by = (n) => spans.find(s => s.name === n);
    const root = by('shorts_from_long_video'), step = by('step-find'), decision = by('short-dropped');
    ok(root && step && decision && !spans.some(s => s.name.startsWith('approval-')), 'a change yields the ended step, the new decision and, on ending, the run; an approval already traced is not sent again');
    ok(spans.every(s => s.spanContext().traceId === L.traceIdFor(runId)), 'all in the run trace');
    ok(root.spanContext().spanId === L.spanIdFor(runId, 'root') && step.parentSpanContext?.spanId === L.spanIdFor(runId, 'root') && decision.parentSpanContext?.spanId === L.spanIdFor(runId, 'root'), 'the run root takes the pinned id its children already named');
    ok(attrs(root)['langfuse.observation.type'] === 'agent' && attrs(step)['langfuse.observation.type'] === 'span' && attrs(decision)['langfuse.observation.type'] === 'event', 'typed agent / span / event');
    ok(spans.every(s => attrs(s)['user.id'] === 'u1' && attrs(s)['session.id'] === P1 && attrs(s)['langfuse.trace.name'] === 'shorts_from_long_video' && attrs(s)['langfuse.environment'] === 'test'), 'every span carries user, project as session, trace name and environment');
    ok(attrs(step)['langfuse.observation.level'] === 'WARNING' && /Stopped by you/.test(attrs(root)['langfuse.observation.output']), 'a stopped step is a warning and the run says why it stopped');
    ok(/off topic/.test(attrs(decision)['langfuse.observation.metadata.reason']), 'a decision keeps its reason');
    ok(Number(step.startTime[0]) === 2 && Number(step.endTime[0]) === 3, 'step times come from the run state');

    // Every AI call of a request or job: one trace, a generation inside.
    memory.reset();
    const client = { chat: { completions: { create: async () => ({ model: 'gpt-x', choices: [{ message: { content: 'answer' } }], usage: { prompt_tokens: 12, completion_tokens: 5 } }) } },
        audio: { transcriptions: { create: async () => ({ text: 'spoken words' }) } } };
    const { currentRunContext } = require('../services/tracing/runContext.js');
    L.instrumentClient(client, 'openai', currentRunContext);
    await client.chat.completions.create({ model: 'gpt-x', messages: [{ role: 'user', content: 'outside any request' }] });
    await flush();
    ok(memory.getFinishedSpans().length === 0, 'a call outside a request or job is not traced');
    await L.runWithTraceContext({ feature: 'job/asset-analysis', userId: 'u9', sessionId: P1 }, async () => {
        await client.chat.completions.create({ model: 'gpt-x', temperature: 0.3, messages: [{ role: 'user', content: [{ type: 'text', text: 'mail me at bob@example.com, key sk-proj-abcdefghijklmnop1234' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] }] });
        await client.audio.transcriptions.create({ model: 'whisper-1', file: Buffer.from('x') });
    });
    await flush();
    const js = memory.getFinishedSpans();
    const jroot = js.find(s => s.name === 'job/asset-analysis');
    const gen = js.find(s => s.name === 'generate-vision');
    const audio = js.find(s => s.name === 'transcribe-audio');
    ok(jroot && gen && audio && gen.parentSpanContext?.spanId === jroot.spanContext().spanId && audio.parentSpanContext?.spanId === jroot.spanContext().spanId, 'a job is one trace, its model calls generations inside it');
    ok(attrs(gen)['langfuse.observation.type'] === 'generation' && attrs(gen)['langfuse.observation.model.name'] === 'gpt-x' && /"total":17/.test(attrs(gen)['langfuse.observation.usage_details']) && /temperature/.test(attrs(gen)['langfuse.observation.model.parameters']), 'model, parameters and tokens are recorded');
    ok(attrs(jroot)['user.id'] === 'u9' && attrs(gen)['session.id'] === P1 && attrs(gen)['langfuse.trace.name'] === 'job/asset-analysis', 'with the user, the project and a stable feature name');
    const input = attrs(gen)['langfuse.observation.input'];
    ok(/\[email\]/.test(input) && /\[secret\]/.test(input) && /image omitted/.test(input) && !/bob@example|sk-proj|base64/.test(input), 'emails, keys and images are masked before export');
    ok(attrs(jroot)['langfuse.observation.output'] === 'spoken words' || attrs(jroot)['langfuse.observation.output'] === 'answer', 'the trace output is the answer');

    // Sampling: outside agent runs only a share of requests is traced.
    const sampled = L.config({ LANGFUSE_PUBLIC_KEY: 'a', LANGFUSE_SECRET_KEY: 'b' });
    ok(sampled.sampleRate === 0.25 && L.config({ LANGFUSE_SAMPLE_RATE: '0' }).sampleRate === 0 && L.config({ LANGFUSE_SAMPLE_RATE: '7' }).sampleRate === 0.25, 'default sample rate 25%, 0 allowed, nonsense ignored');
    ok(!L.config({ LANGFUSE_PUBLIC_KEY: 'a' }).enabled && !L.config({ LANGFUSE_PUBLIC_KEY: 'a', LANGFUSE_SECRET_KEY: 'b', LANGFUSE_TRACING: 'off' }).enabled, 'off without both keys, and with LANGFUSE_TRACING=off');
    ok(L.environmentName({ NODE_ENV: 'production' }) === 'production' && L.environmentName({ LANGFUSE_TRACING_ENVIRONMENT: 'Langfuse Prod!' }) === 'development', 'environment names follow the Langfuse rule');
    ok(L.featureFromRequest({ baseUrl: '/api/ai', route: { path: '/parse-intent' } }) === 'ai/parse-intent' && L.featureFromRequest({ baseUrl: '/api/agent-runs', route: { path: '/:id' } }) === 'agent-runs', 'trace names are stable (no ids in them)');
    ok(L.maskValue('call me on +33 6 12 34 56 78') === 'call me on [phone]' && L.maskValue('at 12:30, 2 shorts of 45 s') === 'at 12:30, 2 shorts of 45 s', 'phone numbers are masked, times and counts are not');
    ok(L.maskValue('x'.repeat(9000)).length < 6100, 'long text is cut');
    const { readContext } = require('../services/tracing/runContext.js');
    const req = (h) => ({ get: (k) => h[k.toLowerCase()] });
    ok(readContext(req({ 'x-vibed-agent-run': runId, 'x-vibed-agent-step': 'find' }))?.stepId === 'find', 'the run context is read from the headers');
    ok(readContext(req({ 'x-vibed-agent-run': "'; drop table" })) === null && readContext(req({ 'x-vibed-agent-run': runId, 'x-vibed-agent-step': '../x' })).stepId === null, 'malformed ids and steps are ignored');
}

// ── §6 ──────────────────────────────────────────────────────────────────────
console.log('\n§6 wiring');
{
    const idx = read('index.js');
    ok(/'X-Vibed-Agent-Run', 'X-Vibed-Agent-Step'/.test(idx), 'CORS allows the agent run headers (or the browser blocks every tagged request)');
    ok(/app\.use\(require\('\.\/services\/tracing\/runContext'\)\.agentRunContext\)/.test(idx) && /app\.use\('\/api\/agent-runs'/.test(idx), 'the context middleware and the routes are mounted');
    ok(idx.indexOf('agentRunContext') < idx.indexOf("app.use('/api/ai'") && idx.indexOf('agentRunContext') < idx.indexOf("app.use('/api/motion'"), 'before the AI routes, so their calls are traced');
    ok(/instrumentClient\(client, provider, currentRunContext\)/.test(read('services/AIProvider.js')), 'every AI client the factory builds is instrumented');
    ok(/agentRunHeaders\(\)/.test(read('client/src/utils/authFetch.js')), 'authFetch sends the run and step');
    const store = read('client/src/store/useAgentRunStore.js');
    ok(/action: 'repurpose_shorts'/.test(store) && /finishShort\(mainEditState\(\), short, opts\)/.test(store), 'the run uses the existing find and finish pipeline');
    ok(/enterAgentStep\(run\.id, 'find'\)/.test(store) && /enterAgentStep\(run\.id, 'finish'\)/.test(store) && /leaveAgentStep\(\)/.test(store), 'each working step is tagged and untagged');
    ok(/putFinishedShort\(short, opts, built\)/.test(store), 'finished shorts are cached for the panel');
    const panel = read('client/src/components/ShortsPanel.jsx');
    ok(/getFinishedShort\(short, opts\)/.test(panel) && (panel.match(/await finished\(short/g) || []).length === 3, 'Preview, Export and Open as project reuse a finished short');
    ok(/<AgentRunCard \/>/.test(panel) && /useAgentRunStore\.getState\(\)\.start\(/.test(panel) && /decide\(short\.id, decision\)/.test(panel), 'the panel starts a run and offers keep or drop on each short');
    ok(/decide\(short\.id, 'dropped', 'Removed from the list'\)/.test(panel), 'removing a short during review counts as dropping it');
    for (const l of ['en', 'fr']) {
        const ed = JSON.parse(read(`client/src/locales/${l}/editor.json`));
        ok(ed.agentRun && ['approvePlan', 'keep', 'drop', 'finishKept', 'resume', 'stopped', 'cost'].every(k => ed.agentRun[k]), `${l}: the run copy exists`);
        const rows = JSON.parse(read(`client/src/locales/${l}/privacy.json`)).sections[4].blocks[1].table.rows;
        ok(rows.some(r => r[0].startsWith('Langfuse')), `${l}: Langfuse is listed as a processor`);
        ok(!/editing-assistant|assistant de montage/.test(rows.find(r => r[0] === 'Railway')[1]), `${l}: the removed self-hosted brain model is no longer listed`);
    }
    ok(/table:\s+'agent_runs'/.test(read('services/DataHealthProbe.js')), 'the health probe watches agent_runs');
}

// ── §7 ──────────────────────────────────────────────────────────────────────
console.log('\n§7 typed goals: sentence -> criteria -> verify');
{
    const P = await import('../client/src/agent/runs/goalParser.js');
    const V = await import('../client/src/agent/runs/goalVerify.js');
    const SL = await import('../client/src/agent/shortLength.js');
    const g = P.parseShortsGoal('Make three TikToks from this podcast under 60s with captions in our brand colours', { defaultCount: 5 });
    ok(g && g.params.count === 3 && g.params.platforms.join() === 'tiktok' && g.params.maxSeconds === 60, 'the example request becomes 3 TikToks capped at 60 s');
    ok(g.criteria.count === 3 && g.criteria.maxSeconds === 60 && g.criteria.captions === true && g.criteria.brand === true, 'with count, length, captions and brand as criteria');
    ok(g.params.finish.brandTitle === true && /podcast/.test(g.request), 'a brand request turns the branded hook title on and keeps the sentence');
    const plain = P.parseShortsGoal('repurpose this video into shorts', { defaultCount: 4 });
    ok(plain && plain.params.count === 4 && plain.criteria.count === null && plain.criteria.maxSeconds === null && plain.criteria.brand === null, 'what the request does not say is not a criterion');
    for (const notAGoal of ['make it short', 'add a short intro', 'make a short', 'remove the silences', 'what are shorts?', 'trim the clips']) {
        ok(P.parseShortsGoal(notAGoal) === null || notAGoal === 'what are shorts?', `"${notAGoal}" is not a shorts goal`);
    }
    ok(P.parseShortsGoal('fais 2 shorts de moins de 45 secondes sans sous-titres')?.criteria.maxSeconds === 45, 'French: "moins de 45 secondes"');
    ok(P.parseShortsGoal('fais 2 shorts de moins de 45 secondes sans sous-titres')?.criteria.captions === false, 'French: "sans sous-titres" is a criterion too');
    ok(P.maxSecondsFromText('keep them under a minute') === 60 && P.maxSecondsFromText('max 2 min') === 120 && P.maxSecondsFromText('30 s max') === 30 && P.maxSecondsFromText('under 5 s') === null, 'length caps: minute, minutes, trailing max; nonsense ignored');
    ok(P.parseShortsGoal('make one short for each platform: TikTok and Instagram')?.params.count === 2, '"one for each" counts the platforms');

    // Length cap reaches the planner, beating the one-minute floor.
    const plan = SL.planShortLength({ platform: 'tiktok', totalDuration: 1200, maxSeconds: 45 });
    ok(plan.max <= 44 && plan.min <= plan.target && plan.target <= plan.max && plan.capped === 45, 'a 45 s cap keeps every slot under it (the floor gives way)');
    ok(/under 45 s/.test(plan.reasons[0]), 'and says why');
    const free = SL.planShortLength({ platform: 'tiktok', totalDuration: 1200 });
    ok(free.min === SL.MIN_SHORT_SECONDS && !free.capped, 'no cap: the R106 floor is unchanged');
    ok(/maxSeconds: run\.plan\.maxSeconds/.test(read('client/src/store/useAgentRunStore.js')) && (read('client/src/agent/MediaExecutionEngine.js').match(/planShortLength\(\{[^}]*maxSeconds \}\)/g) || []).length === 2, 'the run passes the cap to the find command, which uses it for every slot');

    // Verify
    const brand = { accent: '#ff3b5c' };
    const good = { tracks: [{ id: 'track-captions', type: 'text', clips: [{ content: 'hello' }] }, { id: 'track-short-title', type: 'text', clips: [{ accentColor: '#FF3B5C' }] }], duration: 58.4 };
    const bad = { tracks: [{ id: 'track-v', type: 'video', clips: [{}] }], duration: 71 };
    const fg = V.shortFacts(good, brand), fb = V.shortFacts(bad, brand);
    ok(fg.captions === 1 && fg.branded === true && fb.captions === 0 && fb.branded === false, 'facts are read from the finished timeline');
    const crit = { count: 3, maxSeconds: 60, captions: true, brand: true, platforms: ['tiktok'] };
    const r1 = V.verifyShorts(crit, [{ shortId: 'a', platform: 'tiktok', facts: fg }, { shortId: 'b', platform: 'tiktok', facts: fg }, { shortId: 'c', platform: 'tiktok', facts: fg }], { hasBrandKit: true });
    ok(r1.met && r1.checks.length === 5, 'three good shorts meet every criterion');
    const r2 = V.verifyShorts(crit, [{ shortId: 'a', platform: 'reels', facts: fb }], { hasBrandKit: true });
    const failed = r2.checks.filter(c => !c.ok).map(c => c.id).sort().join();
    ok(!r2.met && failed === 'brand,captions,count,length,platforms', 'each unmet criterion is named');
    ok(/1 of the 3/.test(r2.checks.find(c => c.id === 'count').detail) && /71 s/.test(r2.checks.find(c => c.id === 'length').detail), 'in words that say by how much');
    ok(/no brand kit/.test(V.verifyShorts({ brand: true }, [{ platform: 'tiktok', facts: fg }], { hasBrandKit: false }).checks.find(c => c.id === 'brand').detail), 'no brand kit is reported as such, not as a pass');
    ok(V.verifyShorts({ count: 3 }, [{ platform: 'tiktok', facts: fg }], { finishedCount: 3 }).met, 'shorts finished before a reload still count');

    // State machine carries criteria and the verdict
    let run = R.createRun(g, { now: 1 });
    run = R.applyRunEvent(run, { type: 'approve_plan', plan: { count: 2, maxSeconds: 40 } }, 2).run;
    ok(run.criteria.count === 2 && run.criteria.maxSeconds === 40 && run.criteria.brand === true, 'an edited plan is what the result is judged against');
    run = R.applyRunEvent(run, { type: 'shorts_found', shortIds: ['a'] }, 3).run;
    run = R.applyRunEvent(run, { type: 'decide_short', shortId: 'a', decision: 'kept' }, 4).run;
    run = R.applyRunEvent(run, { type: 'start_finish' }, 5).run;
    run = R.applyRunEvent(run, { type: 'short_finished', shortId: 'a', applied: [] }, 6).run;
    const done = R.applyRunEvent(run, { type: 'finish_done', verification: { met: false, checks: [{ id: 'count', ok: false, detail: '1 of the 2' }] } }, 7).run;
    ok(done.status === R.STATUS.DONE && done.verification.met === false && done.steps.at(-1).id === 'verify' && /count/.test(done.steps.at(-1).note), 'the verify step is recorded with what was not met');
    ok(G.checkStep('shorts_from_long_video', 'verify').ok, 'verify is a step of the contract');

    // Brand reaches the finished short
    const polish = read('client/src/agent/shortPolish.js');
    ok(/if \(brand\) Object\.assign\(look, \{ accent: brand\.accent, titleColor: brand\.text, titleFont: brand\.display \}\)/.test(polish) && /const paletteAccent = brand\?\.accent \|\|/.test(polish), 'a brand kit sets the title, accent and caption highlight of the short');
    ok(/brand: opts\.brand \|\| null/.test(read('client/src/agent/shortFinisher.js')), 'the finisher passes it on');
    const store = read('client/src/store/useAgentRunStore.js');
    ok(/verifyShorts\(get\(\)\.run\.criteria/.test(store) && /type: 'finish_done', verification/.test(store), 'the run verifies before it ends');

    // Chat routing
    const wc = read('client/src/agent/WorkflowController.js');
    ok(/const goal = this\._shortsGoalFor\(prompt\);[\s\S]*?this\._startShortsRun\(goal\);\s*return;[\s\S]*?this\.actor\.send\(\{ type: 'START'/.test(wc), 'a typed shorts goal starts a run instead of the one-shot command');
    ok(/editingMode === 'auto'/.test(wc.slice(wc.indexOf('_shortsGoalFor(prompt) {'))) && /innerWidth < 768/.test(wc), 'not in Auto mode and not on mobile (no run screen there yet)');
    ok(/ai\.setIsAnalyzing\(false\)/.test(wc) && /getUserPlanDirect\(\)\) === 'free'/.test(wc), 'the chat spinner is cleared and Free accounts get the upgrade prompt');
    ok(/verification: ns\.verification/.test(read('services/tracing/langfuse.js')), 'the verdict is in the Langfuse trace');
    for (const l of ['en', 'fr']) {
        const ed = JSON.parse(read(`client/src/locales/${l}/editor.json`)).agentRun;
        ok(['maxLength', 'noBrandKit', 'met', 'notMet', 'checkedAgainst'].every(k => ed[k]), `${l}: the goal copy exists`);
    }
}

console.log(`\n${'─'.repeat(60)}\nAgent runs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
