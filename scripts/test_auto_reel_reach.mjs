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
    nextResponse = { ok: true, status: 200, body: {
        source: 'rules', plan: null,
        techniques: ['hook-slam-headline', 'stat-count-up'],
        motionTechniques: [{ name: 'hook-slam-headline', beatKinds: ['intro'], motion: { enter: 'slam-in' } }],
    } };
    const r = await SF.fetchScenePlanResult('some transcript words', 'reels', 20);
    assert.equal(r.plan, null);
    assert.equal(r.source, 'rules', 'the source was dropped — the caller cannot tell why there is no plan');
    assert.deepEqual(r.techniques, ['hook-slam-headline', 'stat-count-up'], 'the shortlist was dropped');
    assert.deepEqual(r.motionTechniques[0], { name: 'hook-slam-headline', beatKinds: ['intro'], motion: { enter: 'slam-in' } }, 'executable technique data was dropped');
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
    // R109 — successful plans are cached for the session (same transcript,
    // platform and duration cannot produce a different answer in
    // production). Each case mocks its own response, so each starts clean.
    SF.clearPlanCache();
    nextResponse = { ok: true, status: 200, body: { source: 'ai', plan: { title: 'A Title Here', beats: [] }, techniques: [] } };
    const plan = await SF.fetchScenePlan('some transcript words', 'reels', 20);
    assert.equal(plan.title, 'A Title Here');
    SF.clearPlanCache();
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
    const block = src.slice(at, at + 18000);
    assert.match(block, /Motion techniques: /, 'a successful technique run is still invisible to the user');
    assert.match(block, /The AI scene direction was skipped/, 'a skipped scene plan is still invisible to the user');
    assert.match(block, /sceneSource/, 'the result carries no machine-readable source');
});

await check('short scene plans expose executable KB motions and use a bounded fast timeout', () => {
    const route = read('server/routes/motionRoutes.js');
    assert.match(route, /motionTechniques = techniques\.map\(\(\{ technique \}\) => \(\{/,
        'the failure response still exposes only technique names, not executable motions');
    assert.match(route, /searchKeywords: technique\.searchKeywords/,
        'the fallback cannot rank knowledge-base techniques from their search keywords');
    assert.match(route, /bestUseCases: technique\.bestUseCases/,
        'the fallback cannot use the knowledge-base technique fit descriptions');
    assert.match(route, /Math\.min\(30_000, Math\.max\(1_000, Number\(requestedTimeoutMs\)\)\)/,
        'scene-plan lets clients extend its model deadline without a cap');
    assert.match(route, /timeoutMs: sceneTimeoutMs/,
        'the bounded short timeout is not passed to the motion model');
    const finisher = read('client/src/agent/shortFinisher.js');
    assert.match(finisher, /SHORT_SCENE_PLAN_TIMEOUT_MS = 28000/);
    assert.match(finisher, /timeoutMs: SHORT_SCENE_PLAN_TIMEOUT_MS/);
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

await check('stock fills dialogue gaps that local b-roll does not cover', () => {
    const tools = read('client/src/agent/VideoEditorTools.js');
    const calls = [...tools.matchAll(/this\._fetchStockBrollFallback\(/g)];
    assert.ok(calls.length >= 2, `expected no-local-candidate and local-gap stock paths, found ${calls.length}`);
    const localGapCall = calls.find(m => tools.slice(Math.max(0, m.index - 800), m.index).includes('matches'));
    assert.ok(localGapCall, 'stock is no longer offered to dialogue moments local matches missed');
    assert.match(tools.slice(Math.max(0, localGapCall.index - 800), localGapCall.index), /matches/);
});

await check('Auto style recipes route supported styles through contextual b-roll', () => {
    const engine = read('client/src/agent/MediaExecutionEngine.js');
    const recipe = engine.slice(engine.indexOf("case 'apply_style_recipe':"), engine.indexOf("case '", engine.indexOf("case 'apply_style_recipe':") + 20));
    assert.match(recipe, /recipe\.broll/);
    assert.match(recipe, /tools\.placeContextualBroll/);
    assert.match(recipe, /layout: recipe\.broll\.layout/);
});

log('\n── 4. "The provider IS set and it still says rules" ──');

await check('the route reports WHICH kind of failure, not just "rules"', () => {
    // Three completely different operator problems used to arrive as one
    // indistinguishable `source: 'rules'`: the provider is deliberately
    // deterministic, the provider names a real model but has no working
    // credentials, or the model was called and failed.
    const provider = read('services/motionProvider.js');
    const rulesReturns = [...provider.matchAll(/return \{ source: 'rules', plan: null[^}]*\}/g)];
    assert.ok(rulesReturns.length >= 3, `expected several rules-fallback returns, found ${rulesReturns.length}`);
    for (const m of rulesReturns) {
        assert.match(m[0], /failureCategory/, `a rules fallback still reports no category:\n${m[0]}`);
    }
    const route = read('server/routes/motionRoutes.js');
    assert.match(route, /failureCategory: result\.failureCategory/, 'the route drops the category');
    assert.match(route, /failureCategory: 'route_error'/, 'the route\'s own catch reports no category');
});

await check('the category becomes a sentence an operator can act on', async () => {
    const cases = [
        ['rules_requested', /AI_MOTION_PROVIDER=rules/],
        ['provider_unconfigured', /no working credentials/],
        ['timeout', /timed out/],
        ['api_error', /returned an error/],
    ];
    for (const [failureCategory, expect] of cases) {
        SF.clearPlanCache();
        nextResponse = { ok: true, status: 200, body: { source: 'rules', plan: null, techniques: ['a'], failureCategory, provider: 'openai' } };
        const r = await SF.fetchScenePlanResult('some transcript words', 'reels', 20);
        assert.match(r.reason, expect, `${failureCategory} produced "${r.reason}"`);
    }
    // A category this client has never heard of still says something true.
    nextResponse = { ok: true, status: 200, body: { source: 'rules', plan: null, techniques: [], failureCategory: 'brand_new_thing' } };
    const r = await SF.fetchScenePlanResult('some transcript words', 'reels', 20);
    assert.match(r.reason, /brand_new_thing/, `an unknown category was swallowed: "${r.reason}"`);
});

await check('no credentials or prompts ride along with the category', () => {
    const route = read('server/routes/motionRoutes.js');
    const at = route.indexOf('failureCategory: result.failureCategory');
    const block = route.slice(Math.max(0, at - 600), at + 400);
    for (const leak of ['apiKey', 'api_key', 'OPENAI_API_KEY', 'prompt:', 'transcript:']) {
        assert.ok(!block.includes(leak), `the failure payload carries ${leak}`);
    }
});

await check('no hardcoded model default is a known-dead model', () => {
    // The whole knowledge base sat unused because `gemma2-9b-it` — Groq's
    // default for the motion capability — had been decommissioned. Every
    // motion call 400'd, the route fell back to rules, and the app reported
    // success. A hardcoded model name is a dated assertion about someone
    // else's service, so motion now tracks the chat model: ONE name to keep
    // current, and one that is exercised on every other request.
    const ai = read('services/AIProvider.js');
    const motionLine = /capability === 'motion'\)\s*\{[\s\S]{0,300}?\}/.exec(ai);
    assert.ok(motionLine, 'the motion model branch is gone');
    assert.ok(!/return[^;]*'gemma2-9b-it'/.test(ai), 'a decommissioned model is still a default');
    assert.match(motionLine[0], /GROQ_MOTION_MODEL \|\| process\.env\.GROQ_CHAT_MODEL/,
        'the motion model no longer tracks the chat model');
});

await check('gemini can serve motion, and is documented as the way to', () => {
    const ai = read('services/AIProvider.js');
    assert.match(ai, /motion:\s*\[[^\]]*'gemini'/, 'gemini is not an allowed motion provider');
    assert.match(ai, /if \(provider === 'gemini'\) return !!process\.env\.GEMINI_API_KEY;/,
        'gemini motion has no configuration check');
    const motion = read('services/motionProvider.js');
    assert.match(motion, /MOTION_PROVIDERS = \[[^\]]*'gemini'/, 'gemini is not a valid AI_MOTION_PROVIDER');
    const env = read('.env.example');
    assert.match(env, /AI_MOTION_PROVIDER=gemini/, '.env.example does not show the gemini setup');
    assert.ok(!/^# GROQ_MOTION_MODEL=gemma2-9b-it/m.test(env), '.env.example still recommends the dead model');
});

await check('a truncated answer is its own reason, not "returned nothing"', () => {
    // A reasoning model spends part of max_tokens thinking, so a budget that
    // was fine for a small instruct model can finish with
    // `finish_reason: 'length'` and an empty string — which looks exactly
    // like "no model configured" unless it is named.
    const motion = read('services/motionProvider.js');
    assert.match(motion, /finish_reason === 'length'/, 'truncation is not detected');
    assert.match(motion, /output_truncated/, 'truncation has no category');
    assert.match(motion, /MOTION_AI_MAX_TOKENS/, 'the budget is not overridable');
    assert.match(motion, /effectiveProvider === 'gemini'\) requestParams\.reasoning_effort = 'low'/,
        'Gemini motion planning does not request low thinking for this constrained JSON task');
    const sf = read('client/src/agent/shortFinisher.js');
    assert.match(sf, /output_truncated:.*MOTION_AI_MAX_TOKENS/, 'the client cannot explain a truncated answer');
});

await check('gemini unrolls array error bodies and motion falls back on 404 model errors', () => {
    const ai = read('services/AIProvider.js');
    assert.match(ai, /config\.fetch = async \(url, fetchOpts\)/, 'AIProvider does not unwrap Gemini array errors');
    assert.match(ai, /gemini-3\.8-flash/, 'AIProvider does not default to gemini-3.8-flash');
    const motion = read('services/motionProvider.js');
    assert.match(motion, /gemini-3\.8-flash/, 'motionProvider has no fallback model when Gemini 404s');
    const sf = read('client/src/agent/shortFinisher.js');
    assert.match(sf, /is404/, 'shortFinisher does not explain 404 model errors');
});

await check('gemini 503 capacity spikes recover via flash-lite and secondary provider failover', () => {
    const motion = read('services/motionProvider.js');
    assert.match(motion, /gemini-3\.1-flash-lite/, 'motionProvider has no flash-lite fallback for 503 capacity spikes');
    assert.match(motion, /503/, 'motionProvider does not handle 503 errors');
    assert.match(motion, /executeChatCompletionWithFailover/, 'motionProvider does not wrap completion in failover');
    assert.match(motion, /baseProvider/, 'motionProvider does not fall back to secondary AI provider');
    const sf = read('client/src/agent/shortFinisher.js');
    assert.match(sf, /is503/, 'shortFinisher does not explain 503 capacity spikes');
});

log('\n── 5. Stock media is allowed past the Content Security Policy ──');

await check('every stock provider wired into services/ is in the CSP', () => {
    // The search works, the key is valid, and the browser blocks every
    // thumbnail and every preview: "Loading the image '<URL>' violates the
    // following Content Security Policy directive: img-src ...". That reads
    // exactly like "the provider doesn't work".
    const index = read('index.js');
    assert.match(index, /const STOCK_MEDIA_HOSTS = \[/, 'there is no single list of provider hosts');
    const list = /const STOCK_MEDIA_HOSTS = \[([\s\S]*?)\];/.exec(index)[1];
    for (const host of ['pexels.com', 'vecteezy.com']) {
        assert.ok(list.includes(host), `${host} is not allowed by the CSP`);
    }
});

await check('the hosts are allowed for MEDIA as well as images', () => {
    // A thumbnail that loads over a <video> that does not is a worse failure
    // than neither working: the panel looks fine and nothing plays.
    const index = read('index.js');
    assert.match(index, /imgSrc:[^\n]*\.\.\.STOCK_MEDIA_HOSTS/, 'imgSrc does not include the providers');
    assert.match(index, /mediaSrc:[^\n]*\.\.\.STOCK_MEDIA_HOSTS/, 'mediaSrc does not include the providers');
});

await check('a provider service with no CSP entry is a visible omission', () => {
    // The guard that keeps this from rotting: every *Service.js that talks to
    // a stock provider must have its host allowed.
    const index = read('index.js');
    const list = /const STOCK_MEDIA_HOSTS = \[([\s\S]*?)\];/.exec(index)[1];
    const services = ['VecteezyService.js', 'PexelsService.js'];
    const missing = services
        .map(s => s.replace('Service.js', '').toLowerCase())
        .filter(name => !list.toLowerCase().includes(name));
    assert.deepEqual(missing, [], `provider service(s) with no CSP host: ${missing.join(', ')}`);
});

log(failures === 0 ? '\n✅ auto/reel reachability: all checks passed\n' : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
