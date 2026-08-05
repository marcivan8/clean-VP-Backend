/**
 * services/AIProvider.js
 *
 * The ONE place an OpenAI-compatible client is constructed.
 *
 * WHY THIS EXISTS: there were 15 separate `new OpenAI({ apiKey: ... })` calls
 * across routes/, controllers/, jobs/ and server/brain/, none of which set a
 * baseURL. Pointing the app at anything other than api.openai.com — a local
 * Ollama in staging, a deterministic mock in CI — meant editing every one of
 * them, and missing one would silently keep calling (and billing) the real API.
 * Same lesson as server/brain/media/analysisStatus.js: a value duplicated
 * across files with no compile-time link between them will drift.
 *
 * ── Providers ────────────────────────────────────────────────────────────────
 *   openai  (default) — the real API. Unchanged behaviour.
 *   ollama            — a local OpenAI-compatible /v1 endpoint. For exercising
 *                       plumbing without spending credits.
 *   mock              — deterministic canned responses. No network at all.
 *
 * ── WHAT NON-OPENAI PROVIDERS CANNOT DO ──────────────────────────────────────
 * This is a partial substitution and the boundaries are load-bearing:
 *   • AUDIO (`whisper-1`, openai.audio.transcriptions) — Ollama has no audio
 *     API whatsoever. Transcription ALWAYS uses the real client unless the
 *     provider is 'mock'. See resolveClient({ capability: 'audio' }).
 *   • EMBEDDINGS — nomic-embed-text is 768-dimensional; text-embedding-3-small
 *     is 1536, and the pgvector columns are fixed-width. Swapping providers
 *     mid-project would write vectors that can never be compared with the
 *     existing ones. Embeddings ALSO always use the real client outside 'mock'.
 *   • VISION — Ollama can do it with a multimodal model, but quality on the
 *     coordinate work in detectSceneLayout/VisualAnalyzer is materially worse.
 *     Allowed, but treat the output as "did the pipeline run", not "is the
 *     answer right".
 *
 * ── PRODUCTION SAFETY ────────────────────────────────────────────────────────
 * A non-openai provider is REFUSED when NODE_ENV === 'production'. Shipping a
 * mocked Brain to real users would be worse than an outage: it would answer
 * confidently and wrongly, which is the exact failure class R30/R43/R44 exist
 * to prevent. The refusal warns loudly and falls back to the real client rather
 * than throwing, so a misconfigured env var degrades to correct-but-costly
 * instead of taking the API down.
 */

'use strict';

const VALID_PROVIDERS = ['openai', 'ollama', 'mock'];

/** Capabilities that only the real OpenAI API can serve (see header). */
const REAL_ONLY_CAPABILITIES = ['audio', 'embeddings'];

let _warnedProduction = false;
let _clientCache = new Map();

/**
 * Which provider is configured, after production safety is applied.
 * PURE apart from reading env — exported so the regression can execute it.
 */
function resolveProvider(env = process.env) {
    const raw = String(env.AI_PROVIDER || 'openai').toLowerCase().trim();
    const requested = VALID_PROVIDERS.includes(raw) ? raw : 'openai';

    if (raw && !VALID_PROVIDERS.includes(raw)) {
        console.warn(
            `[AIProvider] Unknown AI_PROVIDER "${raw}" — falling back to "openai". ` +
            `Valid values: ${VALID_PROVIDERS.join(', ')}`
        );
    }

    if (requested !== 'openai' && env.NODE_ENV === 'production') {
        if (!_warnedProduction) {
            console.error(
                `[AIProvider] AI_PROVIDER="${requested}" is set in PRODUCTION and has been ignored. ` +
                'A mocked or local model would answer users confidently and wrongly. ' +
                'Using the real OpenAI API.'
            );
            _warnedProduction = true;
        }
        return 'openai';
    }

    return requested;
}

/**
 * Build (or return a cached) OpenAI-compatible client.
 *
 * @param {Object}  [opts]
 * @param {number}  [opts.timeout]     - per-request timeout, ms
 * @param {number}  [opts.maxRetries]
 * @param {string}  [opts.capability]  - 'chat' | 'vision' | 'audio' | 'embeddings'
 * @returns {Object|null} client, or null when no API key is configured
 */
function getAIClient(opts = {}) {
    const { timeout, maxRetries, capability = 'chat' } = opts;
    const env = process.env;
    let provider = resolveProvider(env);

    // Audio and embeddings cannot be served by Ollama at all (no audio API;
    // incompatible embedding dimensions). Silently using it would produce
    // either a hard failure or — worse — vectors that are subtly incomparable
    // with everything already stored. Fall back to the real client, and say so.
    if (provider === 'ollama' && REAL_ONLY_CAPABILITIES.includes(capability)) {
        console.warn(
            `[AIProvider] capability "${capability}" cannot be served by ollama — ` +
            'using the real OpenAI API for this call.'
        );
        provider = 'openai';
    }

    if (provider === 'mock') {
        return createMockClient();
    }

    const cacheKey = `${provider}:${capability}:${timeout || ''}:${maxRetries ?? ''}`;
    if (_clientCache.has(cacheKey)) return _clientCache.get(cacheKey);

    const config = {};
    if (timeout !== undefined)    config.timeout    = timeout;
    if (maxRetries !== undefined) config.maxRetries = maxRetries;

    if (provider === 'ollama') {
        // Ollama exposes an OpenAI-compatible surface at /v1 and ignores the
        // key, but the SDK requires a non-empty string.
        config.baseURL = env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
        config.apiKey  = 'ollama';
    } else {
        if (!env.OPENAI_API_KEY) return null;
        config.apiKey = env.OPENAI_API_KEY;
        if (env.OPENAI_BASE_URL) config.baseURL = env.OPENAI_BASE_URL;
    }

    const OpenAI = require('openai');
    const client = new OpenAI(config);
    _clientCache.set(cacheKey, client);
    return client;
}

/**
 * Map a requested OpenAI model onto the configured provider's equivalent.
 * A no-op for the real API; for Ollama it reads from env so the model can be
 * swapped without touching any call site.
 */
function resolveModel(requestedModel) {
    if (resolveProvider() !== 'ollama') return requestedModel;

    const isVision = /vision/i.test(requestedModel) || requestedModel === 'gpt-4o-mini';
    return isVision
        ? (process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_MODEL || 'llama3.2-vision')
        : (process.env.OLLAMA_MODEL || 'llama3.1');
}

/**
 * Deterministic stand-in for the API. No network, no cost, same shape.
 *
 * The response body is chosen from the prompt so each caller gets JSON that
 * satisfies its own parser — a single generic blob would make every consumer
 * throw on a missing key and prove nothing about the pipeline. It is
 * deliberately BLAND and obviously synthetic: mock output must never be
 * mistaken for a real editorial judgement.
 */
function createMockClient() {
    return {
        _mock: true,
        chat: {
            completions: {
                create: async ({ messages = [], model } = {}) => {
                    const prompt = messages
                        .map(m => typeof m.content === 'string'
                            ? m.content
                            : (m.content || []).map(c => c.text || '').join(' '))
                        .join('\n');

                    return {
                        choices: [{
                            message: { content: JSON.stringify(mockBodyFor(prompt)) },
                            finish_reason: 'stop',
                        }],
                        model: model || 'mock',
                        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                    };
                },
            },
        },
        audio: {
            transcriptions: {
                create: async () => ({ text: 'Mock transcript. This text is synthetic.', words: [] }),
            },
        },
        embeddings: {
            // 1536 dims to match text-embedding-3-small, so a mocked vector can
            // still be written to the same pgvector column without erroring.
            create: async ({ input }) => ({
                data: (Array.isArray(input) ? input : [input]).map(() => ({
                    embedding: new Array(1536).fill(0),
                })),
            }),
        },
    };
}

/**
 * Pick a canned body matching the caller's expected schema.
 * PURE — exported for the regression, which asserts each shape parses.
 */
function mockBodyFor(prompt = '') {
    const p = String(prompt);

    // ProjectIntelligence.buildDerivationPrompt (R44)
    if (/PROJECT|through_line|coverage_gaps/.test(p)) {
        return {
            project_type: 'unknown',
            through_line: 'Mock project map — synthetic response, not a real analysis.',
            target_audience: null,
            tone: null,
            asset_roles: [],
            coverage_gaps: [],
        };
    }

    // organize-clips ordering (R43)
    if (/narrative order|orderedIds/.test(p)) {
        const ids = [...p.matchAll(/\[id:\s*([^\]]+)\]/g)].map(m => m[1].trim());
        return {
            orderedIds: ids,
            clipMeta: ids.map(id => ({
                id, narrative_role: 'supporting', summary: 'Mock clip description.',
            })),
            rationale: 'Mock ordering — clips left in their existing order. Not a real editorial decision.',
        };
    }

    // Pause classification (R17)
    if (/classify|pause/i.test(p)) {
        return { pauses: [] };
    }

    // VisualAnalyzer / scene layout
    if (/scene|framing|camera|faces/i.test(p)) {
        return {
            sceneType: 'unknown', cameraAngle: 'unknown', subjectCount: 0,
            hasMainSpeaker: false, hasFaces: false, isBroll: false,
            isScreenRecording: false, locationType: 'unknown',
            lightingQuality: 'unknown', stability: 'unknown',
            emotionalTone: 'neutral',
            contentDescription: 'Mock visual analysis — synthetic, not a real description.',
            suggestedLabel: 'Mock clip',
        };
    }

    // EditorialBrain advisory
    if (/editor|advice|suggest/i.test(p)) {
        return {
            message: 'Mock Brain response. This environment is running a stubbed AI provider.',
            suggestions: [],
        };
    }

    // Intent parsing / generic
    return { intent: 'unknown', operation: null, constraints: {}, confidence: 0 };
}

/**
 * Can an AI call be made at all?
 *
 * Call sites used to test `process.env.OPENAI_API_KEY` directly, which is the
 * wrong question once a provider can be something other than OpenAI: mock and
 * ollama need no key, and gating on one would 503 every AI route in exactly the
 * environments this factory exists to enable.
 */
function isAIConfigured() {
    const provider = resolveProvider();
    if (provider === 'mock' || provider === 'ollama') return true;
    return !!process.env.OPENAI_API_KEY;
}

/** Test seam — clears the memoised clients so env changes take effect. */
function _resetForTests() {
    _clientCache = new Map();
    _warnedProduction = false;
}

module.exports = {
    getAIClient,
    isAIConfigured,
    resolveProvider,
    resolveModel,
    mockBodyFor,
    VALID_PROVIDERS,
    REAL_ONLY_CAPABILITIES,
    _resetForTests,
};
