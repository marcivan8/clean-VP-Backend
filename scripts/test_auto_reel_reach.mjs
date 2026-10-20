// scripts/test_auto_reel_reach.mjs
//
// R104 — why the Reel/Auto edit appeared to use none of the motion knowledge
// base, and none of the Pexels stock b-roll.
//
// Both reports turned out to be the same shape of problem, and neither was a
// bug in the thing being reported:
//
//   TECHNIQUES. `/api/motion/scene-plan` answers **200** with
//   `{ source: 'rules', plan: null, techniques: [...] }` whenever the motion
//   model is unconfigured or the call fails — by design, so a missing model
//   never breaks an export. The client then did
//   `return res.ok ? (data.plan || null) : null`, throwing `source` and
//   `techniques` away, and `polishShort` silently fell back to a single
//   title. So "the model chose no technique" and "there was no model at all"
//   were indistinguishable — to the caller AND to the user, who was told the
//   finish succeeded. A non-OK status was worse: `null` with no log at all.
//
//   PEXELS. `PEXELS_API_KEY` was never documented in .env.example. Without
//   it the route answers 503 NOT_CONFIGURED and every Auto-mode b-roll step
//   finds nothing to place — reported in the step's message, not as an error.
//
// These checks pin the observability, not the model: a plan that cannot be
// fetched is still a fallback, but it is no longer a SILENT one.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;

let nextResponse = { ok: true, status: 200, body: {} };
globalThis.fetch = async () => ({
    ok: nextResponse.ok, status: nextResponse.status,
    json: async () => nextResponse.body, text: async () => '',
});

const log = console.log;
const quiet = () => { console.warn = () => {}; console.log = () => {}; console.error = () => {}; };
const loud = () => { console.warn = () => {}; console.log = log; console.error = () => {}; };
quiet(); loud();

let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

const SF = await import('../client/src/agent/shortFinisher.js');

log('\n── 1. A missing scene plan is no longer silent ──');

await check('the rules fallback is reported, with the techniques it could not use', async () => {
    // The exact shape the route returns when the motion model is unconfigured:
    // 200 OK, no plan, and a knowledge-base shortlist that went unused.
    nextResponse = { ok: true, status: 200, body: { source: 'rules', plan: null, techniques: ['hook-slam-headline', 'stat-count-up'] } };
    const r = await SF.fetchScenePlanResult('some transcript words', 'reels', 20);
    assert.equal(r.plan, null);
    assert.equal(r.source, 'rules', 'the source was dropped — the caller cannot tell why there is no plan');
    assert.deepEqual(r.techniques, ['hook-slam-headline', 'stat-count-up'], 'the shortlist was dropped');
    assert.match(r.reason, /not answering/i, `reason was ${JSON.stringify(r.reason)}`);
});

await check('a 5xx is reported with its status instead of vanishing', async () => {
    // This was the worst case: `res.ok` false returned null outside the
    // try/catch, so nothing was logged and nothing was raised.
    for (const status of [500, 502, 503]) {
        nextResponse = { ok: false, status, body: {} };
        const r = await SF.fetchScenePlanResult('some transcript words', 'reels', 20);
        assert.equal(r.plan, null);
        assert.equal(r.source, 'error');
        assert.match(r.reason, new RegExp(String(status)), `a ${status} produced "${r.reason}"`);
    }
});

await check('a network failure is reported too', async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('Failed to fetch'); };
    const r = await SF.fetchScenePlanResult('some transcript words', 'reels', 20);
    globalThis.fetch = saved;
    assert.equal(r.plan, null);
    assert.match(r.reason, /could not be reached/i);
});

await check('no transcript is its own reason, not a pretend model failure', async () => {
    const r = await SF.fetchScenePlanResult('', 'reels', 20);
    assert.equal(r.plan, null);
    assert.match(r.reason, /transcript/i);
});

await check('a real plan comes back clean, with no reason attached', async () => {
    nextResponse = { ok: true, status: 200, body: {
        source: 'ai',
        plan: { title: 'This Changes Everything', beats: [{ kind: 'intro', text: 'This changes everything', technique: 'hook-slam-headline' }] },
        techniques: ['hook-slam-headline'],
    } };
    const r = await SF.fetchScenePlanResult('some transcript words', 'reels', 20);
    assert.ok(r.plan, 'the plan was lost');
    assert.equal(r.source, 'ai');
    assert.equal(r.reason, null, 'a successful plan should carry no excuse');
});

await check('the plain fetchScenePlan contract is unchanged', async () => {
    // Every existing caller and every injected test double still gets a plan
    // or null — the envelope is additive, not a breaking change.
    nextResponse = { ok: true, status: 200, body: { source: 'ai', plan: { title: 'A Title Here', beats: [] }, techniques: [] } };
    const plan = await SF.fetchScenePlan('some transcript words', 'reels', 20);
    assert.equal(plan.title, 'A Title Here');
    nextResponse = { ok: false, status: 502, body: {} };
    assert.equal(await SF.fetchScenePlan('some transcript words', 'reels', 20), null);
});

log('\n── 2. Pro Finish says which techniques it used, or why it used none ──');

await check('the executor takes the full result, not just the plan', () => {
    const src = read('client/src/agent/MediaExecutionEngine.js');
    assert.match(src, /fetchScenePlanResult/, 'polish_short still fetches the bare plan and cannot explain itself');
    assert.ok(!/fetchShortPlan, fetchScenePlan \}/.test(src), 'the old plan-only import is still there');
});

await check('the finish message names the techniques, or the reason there are none', () => {
    const src = read('client/src/agent/MediaExecutionEngine.js');
    const at = src.indexOf("case 'polish_short'");
    assert.ok(at > 0, 'the polish_short case is gone');
    const block = src.slice(at, at + 9000);
    assert.match(block, /Motion techniques: /, 'a successful technique run is still invisible to the user');
    assert.match(block, /The AI scene direction was skipped/, 'a skipped scene plan is still invisible to the user');
    assert.match(block, /sceneSource/, 'the result carries no machine-readable source');
});

log('\n── 3. Stock b-roll: the key that was never documented ──');

await check('PEXELS_API_KEY is in .env.example, with what breaks without it', () => {
    // It was missing entirely, so an operator had no way to know the variable
    // existed — and its absence is silent by design (503 → "nothing placed").
    const env = read('.env.example');
    assert.match(env, /PEXELS_API_KEY/, 'the key is still undocumented');
    assert.match(env, /503|NOT_CONFIGURED/, 'the consequence of leaving it unset is not stated');
});

await check('the route really does refuse without it, rather than failing oddly', () => {
    const route = read('routes/stockMediaRoutes.js');
    assert.match(route, /pexelsService\.isConfigured\(\)/);
    assert.match(route, /status\(503\)[\s\S]{0,200}NOT_CONFIGURED/, 'the 503 contract changed');
});

await check('the client turns that 503 into a reason, never into a crash', () => {
    const tools = read('client/src/agent/VideoEditorTools.js');
    const at = tools.indexOf('async _fetchStockBrollFallback(');
    assert.ok(at > 0, 'the fallback method is gone');
    const block = tools.slice(at, at + 2500);
    assert.match(block, /status === 503/, 'a 503 is no longer special-cased');
    assert.match(block, /not configured/, 'the 503 reason is not phrased for a human');
});

await check('stock is a FALLBACK, not the Reel default — worth knowing before blaming it', () => {
    // It only runs when local b-roll matching produced nothing, so a bin with
    // analysed footage never reaches Pexels at all. That is by design, and it
    // is the second reason a Reel edit can legitimately show no stock b-roll.
    const tools = read('client/src/agent/VideoEditorTools.js');
    const calls = [...tools.matchAll(/this\._fetchStockBrollFallback\(/g)];
    assert.ok(calls.length >= 2, `expected the fallback at both no-candidate branches, found ${calls.length}`);
    for (const m of calls) {
        const before = tools.slice(Math.max(0, m.index - 800), m.index);
        assert.match(before, /length === 0/, 'the fallback is no longer gated on having found nothing locally');
    }
});

await check('the Reel auto playbook really does ask for b-roll', () => {
    const styles = read('client/src/agent/EditingStyles.js');
    assert.match(styles, /key: 'broll'/, 'the playbook no longer has a b-roll step');
    assert.match(styles, /style\.id === 'vlog' \|\| style\.id === 'reel'/, 'reel no longer reaches the b-roll step');
});

log(failures === 0 ? '\n✅ auto/reel reachability: all checks passed\n' : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
