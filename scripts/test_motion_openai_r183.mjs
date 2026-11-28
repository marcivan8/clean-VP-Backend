// scripts/test_motion_openai_r183.mjs — R183: OpenAI is the motion provider
// (gpt-4o-mini by default), Gemini the backup, rules last. Runs the REAL
// AIProvider model mapping and the REAL motion failover against fake clients.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const ENV = { ...process.env };
const setEnv = (e) => { for (const k of ['AI_PROVIDER', 'AI_MOTION_PROVIDER', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_MOTION_MODEL', 'NODE_ENV', 'GEMINI_MOTION_MODEL', 'GEMINI_MODEL']) delete process.env[k]; Object.assign(process.env, e); };

console.log('\n§1 the model');
{
    setEnv({ AI_MOTION_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' });
    const A = require('../services/AIProvider.js');
    A._resetForTests?.();
    ok(A.resolveProvider({ capability: 'motion' }) === 'openai', 'AI_MOTION_PROVIDER=openai makes motion use OpenAI');
    ok(A.resolveModel('gpt-4o', 'motion') === 'gpt-4o-mini', 'motion on OpenAI defaults to gpt-4o-mini');
    process.env.OPENAI_MOTION_MODEL = 'gpt-4o';
    ok(A.resolveModel('gpt-4o', 'motion') === 'gpt-4o', 'OPENAI_MOTION_MODEL overrides it');
    delete process.env.OPENAI_MOTION_MODEL;
    ok(A.resolveModel('gpt-4o', 'chat') === 'gpt-4o', 'other capabilities keep the model they ask for');
    process.env.NODE_ENV = 'production';
    A._resetForTests?.();
    ok(A.resolveProvider({ capability: 'motion' }) === 'openai', 'and it is allowed in production');
}

console.log('\n§2 OpenAI first, Gemini as the backup, rules last');
{
    setEnv({ AI_MOTION_PROVIDER: 'openai', AI_PROVIDER: 'groq', OPENAI_API_KEY: 'sk-test', GEMINI_API_KEY: 'g-test', GROQ_API_KEY: 'q-test' });
    const calls = [];
    const fake = (name, behaviour) => ({ chat: { completions: { create: async (params) => {
        calls.push(`${name}:${params.model}`);
        return behaviour(params);
    } } } });
    let openaiBehaviour = () => ({ choices: [{ message: { content: '{"ok":true}' } }] });
    const geminiBehaviour = () => ({ choices: [{ message: { content: '{"from":"gemini"}' } }] });
    const realA = require('../services/AIProvider.js');
    const p = require.resolve('../services/AIProvider.js');
    require.cache[p].exports = {
        ...realA,
        getAIClient: ({ provider } = {}) => (provider === 'gemini' ? fake('gemini', geminiBehaviour) : provider === 'groq' ? fake('groq', () => ({ choices: [{ message: { content: '{"from":"groq"}' } }] })) : fake('openai', (prm) => openaiBehaviour(prm))),
    };
    delete require.cache[require.resolve('../services/motionProvider.js')];
    const M = require('../services/motionProvider.js');
    const run = () => M.executeChatCompletionWithFailover({
        ai: fake('openai', (prm) => openaiBehaviour(prm)), requestParams: { model: 'gpt-4o-mini', messages: [] },
        provider: 'openai', model: 'gpt-4o-mini', timeout: 30_000,
    });
    let r = await run();
    ok(r.activeProvider === 'openai' && r.activeModel === 'gpt-4o-mini' && calls.join() === 'openai:gpt-4o-mini', 'a healthy OpenAI answers on its own');
    calls.length = 0;
    openaiBehaviour = () => { const e = new Error('429 You exceeded your current quota'); e.status = 429; throw e; };
    r = await run();
    ok(r.activeProvider === 'gemini' && /gemini/.test(r.activeModel) && JSON.parse(r.completion.choices[0].message.content).from === 'gemini', 'OpenAI out of quota: Gemini answers (not the chat provider, groq)');
    calls.length = 0;
    openaiBehaviour = () => { const e = new Error('503 overloaded'); e.status = 503; throw e; };
    r = await run();
    ok(r.activeProvider === 'gemini', 'OpenAI overloaded: Gemini answers');
    openaiBehaviour = () => { const e = new Error('invalid api key'); e.status = 401; throw e; };
    let threw = null;
    try { await run(); } catch (e) { threw = e; }
    ok(threw && threw.status === 401, 'a non-retryable error (bad key) is raised, so the route falls back to rules and logs why');
    // Without Gemini configured, the chat provider is the backup as before.
    delete process.env.GEMINI_API_KEY;
    calls.length = 0;
    openaiBehaviour = () => { const e = new Error('503'); e.status = 503; throw e; };
    r = await run();
    ok(r.activeProvider === 'groq', 'without a Gemini key, the chat provider is the backup as before');
    require.cache[p].exports = realA;
}

console.log('\n§3 wiring');
{
    const src = fs.readFileSync(new URL('../services/motionProvider.js', import.meta.url), 'utf8');
    ok(/provider === 'openai' && isAIConfigured\(\{ provider: 'gemini' \}\)/.test(src), 'the failover names Gemini as OpenAI\'s backup');
}

process.env = ENV;
console.log(`\n${'─'.repeat(60)}\nMotion on OpenAI: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
