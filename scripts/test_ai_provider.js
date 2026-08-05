#!/usr/bin/env node
/**
 * Regression: AI provider factory (CLAUDE.md R45).
 *
 * The properties worth pinning here are safety properties — the cost of getting
 * them wrong is either a real user receiving mocked editorial advice, or a
 * staging run silently billing the production OpenAI account.
 *
 *   1. The DEFAULT is openai. An unset AI_PROVIDER must not change prod behaviour.
 *   2. A non-openai provider is REFUSED in production, loudly, without throwing.
 *   3. Audio and embeddings never route to ollama — it has no audio API, and its
 *      embedding dimensions are incompatible with the stored pgvector columns.
 *   4. Mock responses parse, and satisfy the schema each caller expects.
 *   5. No call site constructs `new OpenAI(...)` directly any more — one bypass
 *      would keep billing the real API in the environments this exists to avoid.
 *   6. Nothing gates AI availability on OPENAI_API_KEY directly; that question
 *      is now "is a provider configured", which mock/ollama answer yes to.
 *
 * Run: node scripts/test_ai_provider.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}`); if (detail) console.log(`      ${detail}`); }
}
function section(t) { console.log(`\n${t}`); }

const provider = require(path.resolve(__dirname, '../services/AIProvider.js'));
const {
    getAIClient, isAIConfigured, resolveProvider, resolveModel,
    mockBodyFor, VALID_PROVIDERS, REAL_ONLY_CAPABILITIES, _resetForTests,
} = provider;

/** Run fn with a temporary env, always restoring afterwards. */
function withEnv(vars, fn) {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    _resetForTests();
    try { return fn(); }
    finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        _resetForTests();
    }
}

// Silence the intentional console.error/warn during the production-refusal
// cases so a passing run stays readable. Restored immediately after.
function quiet(fn) {
    const e = console.error, w = console.warn;
    console.error = () => {}; console.warn = () => {};
    try { return fn(); } finally { console.error = e; console.warn = w; }
}

async function main() {

    // ── 1 · Default ──────────────────────────────────────────────────────────
    section('1 · The default provider is openai');
    {
        withEnv({ AI_PROVIDER: undefined, NODE_ENV: undefined }, () => {
            check('unset AI_PROVIDER resolves to openai', resolveProvider() === 'openai');
        });
        withEnv({ AI_PROVIDER: '', NODE_ENV: undefined }, () => {
            check('empty AI_PROVIDER resolves to openai', resolveProvider() === 'openai');
        });
        quiet(() => withEnv({ AI_PROVIDER: 'llamafile', NODE_ENV: undefined }, () => {
            check('an unrecognised provider falls back to openai', resolveProvider() === 'openai');
        }));
        check('the valid set is exactly openai/ollama/mock',
            VALID_PROVIDERS.join(',') === 'openai,ollama,mock', VALID_PROVIDERS.join(','));
    }

    // ── 2 · Production safety ────────────────────────────────────────────────
    section('2 · Non-openai providers are refused in production');
    {
        for (const p of ['mock', 'ollama']) {
            quiet(() => withEnv({ AI_PROVIDER: p, NODE_ENV: 'production' }, () => {
                check(`AI_PROVIDER=${p} is ignored in production`,
                    resolveProvider() === 'openai',
                    'a mocked or local model would answer real users confidently and wrongly');
            }));
        }
        withEnv({ AI_PROVIDER: 'mock', NODE_ENV: 'staging' }, () => {
            check('mock IS allowed outside production', resolveProvider() === 'mock');
        });
        withEnv({ AI_PROVIDER: 'ollama', NODE_ENV: undefined }, () => {
            check('ollama IS allowed when NODE_ENV is unset', resolveProvider() === 'ollama');
        });

        // Must warn rather than throw: a misconfigured env var should degrade to
        // correct-but-costly, never take the API down.
        let threw = false;
        quiet(() => withEnv({ AI_PROVIDER: 'mock', NODE_ENV: 'production', OPENAI_API_KEY: 'sk-test' }, () => {
            try { getAIClient(); } catch { threw = true; }
        }));
        check('production refusal does not throw', !threw);
    }

    // ── 3 · Capability routing ───────────────────────────────────────────────
    section('3 · Audio and embeddings never route to ollama');
    {
        check('the real-only list names audio and embeddings',
            REAL_ONLY_CAPABILITIES.includes('audio') && REAL_ONLY_CAPABILITIES.includes('embeddings'),
            REAL_ONLY_CAPABILITIES.join(','));

        quiet(() => withEnv({
            AI_PROVIDER: 'ollama', NODE_ENV: undefined, OPENAI_API_KEY: 'sk-test',
        }, () => {
            const audio = getAIClient({ capability: 'audio' });
            check('audio under ollama returns a real client, not a mock',
                audio && !audio._mock, 'Ollama has no audio API at all');
            check('audio client points at the real API',
                !String(audio?.baseURL || '').includes('11434'),
                `baseURL was ${audio?.baseURL}`);

            const emb = getAIClient({ capability: 'embeddings' });
            check('embeddings under ollama return a real client',
                emb && !emb._mock,
                'nomic-embed-text is 768-dim; the pgvector columns are 1536');

            const chat = getAIClient({ capability: 'chat' });
            check('chat under ollama DOES use the local endpoint',
                String(chat?.baseURL || '').includes('11434'), `baseURL was ${chat?.baseURL}`);
        }));

        // Under mock, everything is stubbed including audio — that is the point.
        withEnv({ AI_PROVIDER: 'mock', NODE_ENV: undefined }, () => {
            check('mock stubs audio too', getAIClient({ capability: 'audio' })._mock === true);
        });
    }

    // ── 4 · Configuration questions ──────────────────────────────────────────
    section('4 · Availability is a provider question, not a key question');
    {
        withEnv({ AI_PROVIDER: 'mock', NODE_ENV: undefined, OPENAI_API_KEY: undefined }, () => {
            check('mock is configured without any API key', isAIConfigured() === true);
            check('mock returns a client without a key', !!getAIClient());
        });
        withEnv({ AI_PROVIDER: 'ollama', NODE_ENV: undefined, OPENAI_API_KEY: undefined }, () => {
            check('ollama is configured without an API key', isAIConfigured() === true);
        });
        withEnv({ AI_PROVIDER: 'openai', NODE_ENV: undefined, OPENAI_API_KEY: undefined }, () => {
            check('openai without a key is NOT configured', isAIConfigured() === false);
            check('openai without a key returns null', getAIClient() === null,
                'callers treat null as "no AI available" and fall back');
        });
        withEnv({ AI_PROVIDER: 'openai', NODE_ENV: undefined, OPENAI_API_KEY: 'sk-test' }, () => {
            check('openai with a key is configured', isAIConfigured() === true);
        });
    }

    // ── 5 · Model mapping ────────────────────────────────────────────────────
    section('5 · Model names map per provider');
    {
        withEnv({ AI_PROVIDER: 'openai', NODE_ENV: undefined }, () => {
            check('openai passes the model through unchanged',
                resolveModel('gpt-4o') === 'gpt-4o');
        });
        withEnv({
            AI_PROVIDER: 'ollama', NODE_ENV: undefined,
            OLLAMA_MODEL: 'llama3.1', OLLAMA_VISION_MODEL: 'llava',
        }, () => {
            check('ollama maps a text model', resolveModel('gpt-4o') === 'llama3.1');
            check('ollama maps a vision model', resolveModel('gpt-4o-mini') === 'llava');
        });
    }

    // ── 6 · Mock bodies satisfy each caller's parser ─────────────────────────
    section('6 · Mock responses parse into the shape each caller expects');
    {
        const projectBody = mockBodyFor('PROJECT map through_line coverage_gaps');
        check('project map body has the required keys',
            'project_type' in projectBody && Array.isArray(projectBody.asset_roles)
            && Array.isArray(projectBody.coverage_gaps));
        check('mock project map claims nothing — type is "unknown"',
            projectBody.project_type === 'unknown',
            'a mock must never look like a real editorial judgement');
        check('mock gaps are empty rather than invented',
            projectBody.coverage_gaps.length === 0);

        const organizeBody = mockBodyFor(
            'narrative order orderedIds\nClip 1 [id: c1]\nClip 2 [id: c2]');
        check('organize body echoes the real clip ids',
            organizeBody.orderedIds.join(',') === 'c1,c2', organizeBody.orderedIds.join(','));
        check('organize body preserves the existing order',
            organizeBody.rationale.toLowerCase().includes('mock'),
            'the rationale must announce itself as synthetic');

        const visualBody = mockBodyFor('scene framing camera faces');
        check('visual body has sceneType', 'sceneType' in visualBody);
        check('mock visual analysis asserts nothing',
            visualBody.sceneType === 'unknown' && visualBody.subjectCount === 0);

        // Everything must be JSON-serialisable — the clients JSON.parse it back.
        let allParse = true;
        for (const p of ['PROJECT through_line', 'orderedIds narrative order',
                         'classify pause', 'scene camera', 'editor advice', 'anything else']) {
            try { JSON.parse(JSON.stringify(mockBodyFor(p))); } catch { allParse = false; }
        }
        check('every mock body round-trips through JSON', allParse);
    }

    section('6b · The mock client returns an OpenAI-shaped response');
    {
        await withEnv({ AI_PROVIDER: 'mock', NODE_ENV: undefined }, async () => {
            const client = getAIClient();
            const res = await client.chat.completions.create({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'PROJECT through_line coverage_gaps' }],
            });
            check('response has choices[0].message.content',
                typeof res?.choices?.[0]?.message?.content === 'string');
            check('content is valid JSON', (() => {
                try { JSON.parse(res.choices[0].message.content); return true; } catch { return false; }
            })());

            // Vision-shaped input (content as an array of blocks) must not crash
            // the prompt flattening.
            const vision = await client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: [
                    { type: 'text', text: 'scene camera faces' },
                    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
                ]}],
            });
            check('array-form (vision) messages are handled',
                typeof vision?.choices?.[0]?.message?.content === 'string');

            const emb = await client.embeddings.create({ input: ['a', 'b'] });
            check('mock embeddings return 1536 dims (matches the pgvector column)',
                emb.data.length === 2 && emb.data[0].embedding.length === 1536,
                `${emb.data[0]?.embedding?.length} dims`);

            const tr = await client.audio.transcriptions.create({});
            check('mock transcription announces itself as synthetic',
                /synthetic/i.test(tr.text));
        });
    }

    // ── 7 · No call site bypasses the factory ────────────────────────────────
    section('7 · Every call site goes through the factory');
    {
        const files = [
            'routes/interviewRoutes.js',
            'controllers/aiAgentController.js',
            'jobs/audioProcessor.js',
            'server/brain/EditorialBrain.js',
            'server/brain/PipelineAdapter.js',
            'server/brain/ProjectIntelligence.js',
            'server/brain/media/MediaIntelligencePipeline.js',
            'server/brain/media/VisualAnalyzer.js',
            'server/brain/media/ContentClassifier.js',
            'server/audio-engine/embeddings/EmbeddingService.js',
        ];

        for (const rel of files) {
            const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
            const label = rel.split('/').pop();
            check(`${label} does not construct OpenAI directly`,
                !/new OpenAI\(/.test(src),
                'one bypass keeps billing the real API in staging/CI');
            check(`${label} imports the factory`,
                /require\((['"]).*services\/AIProvider\1\)/.test(src));
        }

        // The factory itself is the ONE legitimate construction site.
        const factorySrc = fs.readFileSync(
            path.resolve(__dirname, '../services/AIProvider.js'), 'utf8');
        const constructions = (factorySrc.match(/^\s*const client = new OpenAI\(/gm) || []).length;
        check('the factory constructs a client exactly once', constructions === 1, `${constructions}`);
    }

    section('7b · Nothing gates AI availability on the raw env var');
    {
        const files = [
            'routes/interviewRoutes.js', 'controllers/aiAgentController.js',
            'server/brain/EditorialBrain.js', 'server/brain/PipelineAdapter.js',
            'server/brain/ProjectIntelligence.js',
            'server/brain/media/MediaIntelligencePipeline.js',
            'server/brain/media/VisualAnalyzer.js', 'server/brain/media/ContentClassifier.js',
        ];
        for (const rel of files) {
            const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
            check(`${rel.split('/').pop()} has no !process.env.OPENAI_API_KEY gate`,
                !/!process\.env\.OPENAI_API_KEY/.test(src),
                'that gate 503s every AI route under mock/ollama, which need no key');
        }
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`AI provider: ${passed} passed, ${failed} failed`);
    console.log('─'.repeat(60));
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('\nTest harness crashed:', err);
    process.exit(1);
});
