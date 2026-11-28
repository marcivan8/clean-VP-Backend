// scripts/test_brain_failover_r184.mjs — R184: the Editorial Brain's model
// calls. Runs the REAL EditorialBrain.process against fake Groq / Gemini /
// OpenAI clients: the Groq answer budget, the Gemini model ladder without the
// retired models, and OpenAI as the last backup.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

process.env.AI_PROVIDER = 'groq';
process.env.GROQ_API_KEY = 'q';
process.env.GEMINI_API_KEY = 'g';
process.env.OPENAI_API_KEY = 'o';
delete process.env.GEMINI_MODEL;
stub('../config/database.js', { supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } });

const ANSWER = JSON.stringify({ intent: { type: 'advise' }, response: { message: 'Looks good.' }, learning: { patternObserved: null, profileUpdates: {} } });
const calls = [];
const behaviours = { groq: () => ({ choices: [{ message: { content: ANSWER } }] }), gemini: () => ({ choices: [{ message: { content: ANSWER } }] }), openai: () => ({ choices: [{ message: { content: ANSWER } }] }) };
const client = (name) => ({ chat: { completions: { create: async (params) => { calls.push({ name, model: params.model, max_tokens: params.max_tokens }); return behaviours[name](params); } } } });
const real = require('../services/AIProvider.js');
stub('../services/AIProvider.js', { ...real, getAIClient: ({ provider } = {}) => client(provider || 'groq') });
const { EditorialBrain } = require('../server/brain/EditorialBrain.js');
const brain = new EditorialBrain();
brain.profileEngine = { getProfile: async () => ({}) };
const input = { userId: 'u1', trigger: 'project_opened', context: { builtContext: brain.contextEngine.build({}), profile: {} } };
const err = (status, message) => { const e = new Error(message); e.status = status; return e; };

console.log('\n§1 Groq has room for the whole answer');
{
    calls.length = 0;
    const out = await brain.process(input, null);
    ok(calls[0]?.name === 'groq' && calls[0].max_tokens === 1400, `the Brain asks Groq for up to 1400 tokens (was 500, cut the JSON off): ${calls[0]?.max_tokens}`);
    ok(out?.response?.message === 'Looks good.', 'and gets a real answer');
}

console.log('\n§2 Gemini backup skips the retired models');
{
    calls.length = 0;
    behaviours.groq = () => { throw err(400, "max completion tokens reached before generating a valid document ... missing properties: 'learning'"); };
    behaviours.gemini = (p) => { if (p.model === 'gemini-3.8-flash') throw err(429, 'rate limit'); return { choices: [{ message: { content: ANSWER } }] }; };
    const out = await brain.process(input, null);
    const geminiModels = calls.filter(c => c.name === 'gemini').map(c => c.model);
    ok(geminiModels.join() === 'gemini-3.8-flash,gemini-3.1-flash-lite', `rate-limited 3.8-flash goes straight to 3.1-flash-lite: ${geminiModels.join(' > ')}`);
    ok(!calls.some(c => /gemini-(2\.0|1\.5)/.test(c.model)), 'no retired 2.0 / 1.5 model is tried');
    ok(out?.response?.message === 'Looks good.', 'and the user gets the answer');
}

console.log('\n§3 OpenAI is the last backup');
{
    calls.length = 0;
    behaviours.gemini = () => { throw err(429, 'rate limit'); };
    const out = await brain.process(input, null);
    const last = calls[calls.length - 1];
    ok(last?.name === 'openai' && last.model === 'gpt-4o-mini', `Groq and Gemini both failing: OpenAI gpt-4o-mini answers (${calls.map(c => c.name).join(' > ')})`);
    ok(calls.findIndex(c => c.name === 'openai') > calls.findLastIndex(c => c.name === 'gemini'), 'only after every Gemini model was tried');
    ok(out?.response?.message === 'Looks good.', 'and the user still gets an answer');
    calls.length = 0;
    behaviours.groq = () => ({ choices: [{ message: { content: ANSWER } }] });
    await brain.process(input, null);
    ok(!calls.some(c => c.name === 'openai'), 'when Groq works, OpenAI is never called');
}

console.log(`\n${'─'.repeat(60)}\nBrain failover: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
