// scripts/test_auto_reel_reach.mjs
//
// R104 — regression checks for locally planned short edits, executable motion
// techniques, and the contextual-stock fallback used by Reel/Auto editing.
// Scene structure and timing are produced locally; this suite ensures the
// workflow does not call the generative scene-plan route and remains useful
// when retrieval or stock providers are unavailable.
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

log('\n── 1. Local scene planning is primary; the Motion KB is retrieval-only ──');

await check('the short scene planner retrieves techniques without calling scene generation', async () => {
    const saved = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options = {}) => {
        requests.push({ url: String(url), options });
        return { ok: true, status: 200, json: async () => ({ techniques: [{
            name: 'hook-slam-headline', beatKinds: ['intro'], tones: ['viral'],
            searchKeywords: ['hook', 'headline'], bestUseCases: ['opening title'],
            motion: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out', energy: 0.9 },
        }] }) };
    };
    try {
        const techniques = await SF.fetchShortMotionTechniques('a useful short transcript', 'tiktok');
        assert.equal(techniques[0]?.name, 'hook-slam-headline');
        assert.equal(requests.length, 1);
        assert.match(requests[0].url, /\/api\/motion\/techniques$/);
        assert.ok(!requests.some(r => r.url.includes('/api/motion/scene-plan')), 'a generative scene-planner request was made');
        const body = JSON.parse(requests[0].options.body);
        assert.equal(body.query, 'a useful short transcript');
        assert.equal(body.limit, 24);
    } finally { globalThis.fetch = saved; }
});

await check('a failed KB lookup degrades to built-in motion recipes', async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    try { assert.deepEqual(await SF.fetchShortMotionTechniques('spoken words', 'reels'), []); }
    finally { globalThis.fetch = saved; }
});

await check('Pro Finish always builds its scene plan locally from words, visuals and events', () => {
    const src = read('client/src/agent/MediaExecutionEngine.js');
    const at = src.indexOf("case 'polish_short'");
    const block = src.slice(at, at + 10000);
    assert.match(block, /fetchShortMotionTechniques/);
    assert.match(block, /fallbackShortScenePlan\(words/);
    assert.match(block, /visualContext/);
    assert.match(block, /events,/);
    assert.ok(!block.includes('fetchScenePlanResult'), 'Pro Finish still fetches a generated scene plan');
    const finisher = read('client/src/agent/shortFinisher.js');
    assert.ok(!finisher.includes('/api/motion/scene-plan'), 'short finisher still calls the generative scene-plan route');
});

await check('the Motion KB endpoint exposes searchable, executable technique metadata', () => {
    const route = read('server/routes/motionRoutes.js');
    const at = route.indexOf("router.post('/techniques'");
    const block = route.slice(at, at + 2200);
    for (const field of ['searchKeywords', 'bestUseCases', 'tones', 'beatKinds', 'motion']) {
        assert.ok(block.includes(`${field}: technique.${field}`), `the fallback cannot use ${field}`);
    }
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

await check('failed local technique retrieval remains bounded and falls back honestly', async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    try {
        assert.deepEqual(await SF.fetchShortMotionTechniques('transcript words', 'reels'), []);
    } finally { globalThis.fetch = saved; }
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

await check('the independent motion API still classifies truncated output', () => {
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
});

await check('gemini unrolls array error bodies and motion falls back on 404 model errors', () => {
    const ai = read('services/AIProvider.js');
    assert.match(ai, /config\.fetch = async \(url, fetchOpts\)/, 'AIProvider does not unwrap Gemini array errors');
    assert.match(ai, /gemini-3\.8-flash/, 'AIProvider does not default to gemini-3.8-flash');
    const motion = read('services/motionProvider.js');
    assert.match(motion, /gemini-3\.8-flash/, 'motionProvider has no fallback model when Gemini 404s');
});

await check('gemini 503 capacity spikes recover via flash-lite and secondary provider failover', () => {
    const motion = read('services/motionProvider.js');
    assert.match(motion, /gemini-3\.1-flash-lite/, 'motionProvider has no flash-lite fallback for 503 capacity spikes');
    assert.match(motion, /503/, 'motionProvider does not handle 503 errors');
    assert.match(motion, /executeChatCompletionWithFailover/, 'motionProvider does not wrap completion in failover');
    assert.match(motion, /baseProvider/, 'motionProvider does not fall back to secondary AI provider');
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
