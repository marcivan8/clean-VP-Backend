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
 *   groq              — hosted, OpenAI-compatible, genuinely FREE tier for
 *                       chat (open-weight models) AND audio (whisper-large-v3
 *                       is served free). No vision model on the free tier.
 *   gemini            — hosted via Google's OpenAI-compatible endpoint
 *                       (generativelanguage.googleapis.com/v1beta/openai/).
 *                       Free tier, and DOES support vision (image_url content
 *                       parts) — this is what fills the gap groq leaves.
 *   ollama            — a local OpenAI-compatible /v1 endpoint. For exercising
 *                       plumbing without spending credits. NOT the same kind
 *                       of thing as groq/gemini — see PRODUCTION SAFETY below.
 *   mock              — deterministic canned responses. No network at all.
 *
 * ── WHY GROQ/GEMINI ARE TREATED DIFFERENTLY FROM OLLAMA ─────────────────────
 * Ollama was designed as a LOCAL, dev-only stand-in — its whole point is to
 * exercise plumbing without a real hosted model behind it, and its output
 * quality was never meant to be trusted (see PRODUCTION SAFETY). Groq and
 * Gemini are real hosted APIs with real (if smaller/open-weight) models
 * behind them — closer in kind to "a different real vendor" than to "a mock."
 * Refusing them in production would mean a team with no OpenAI budget simply
 * cannot run the app in production at all, which defeats the entire point of
 * adding them. They ARE allowed in production when explicitly configured.
 *
 * ── WHAT EACH NON-OPENAI PROVIDER CANNOT DO ──────────────────────────────────
 * This is a partial substitution per provider and the boundaries are
 * load-bearing — see CAPABILITY_PROVIDERS below for the exact matrix:
 *   • AUDIO (`whisper-1`, openai.audio.transcriptions) — groq serves this for
 *     free (`whisper-large-v3`, OpenAI-compatible shape). Ollama and gemini do
 *     NOT have an audio API reachable this way, so audio always falls back to
 *     openai (or groq, if that's the configured provider) — never to ollama
 *     or gemini.
 *   • EMBEDDINGS — nomic-embed-text is 768-dimensional, Gemini's embedding
 *     models are a different size again, and text-embedding-3-small is 1536 —
 *     the pgvector columns are fixed-width. Swapping providers mid-project
 *     would write vectors that can never be compared with the existing ones.
 *     Embeddings ALWAYS use the real openai client outside 'mock'. Not in
 *     scope for the groq/gemini migration — this stays exactly as R45 left it.
 *   • VISION — groq has no free vision model, so vision never routes to groq.
 *     Gemini's OpenAI-compatible endpoint DOES accept image_url content parts
 *     and is a real multimodal model (materially better than a small local
 *     Ollama vision model, though still not GPT-4o — treat coordinate-precise
 *     work like detectSceneLayout as "did the pipeline run", not "is the
 *     answer exactly right", same caution as before).
 *
 * ── HYBRID SETUP (the common case for a no-budget deploy) ───────────────────
 *   AI_PROVIDER=groq            → chat + audio served free by Groq
 *   AI_VISION_PROVIDER=gemini   → vision calls specifically go to Gemini
 *                                  instead of groq (which can't serve it)
 * AI_VISION_PROVIDER overrides AI_PROVIDER ONLY for capability:'vision' calls.
 * Every other capability (chat, audio) still follows AI_PROVIDER. Leaving
 * AI_VISION_PROVIDER unset means vision follows AI_PROVIDER like everything
 * else — and if AI_PROVIDER can't serve vision (e.g. groq), it safely falls
 * back to the real openai client rather than erroring or misrouting silently.
 *
 * ── PRODUCTION SAFETY ────────────────────────────────────────────────────────
 * ollama and mock are REFUSED when NODE_ENV === 'production' — shipping a
 * mocked Brain to real users would be worse than an outage: it would answer
 * confidently and wrongly, which is the exact failure class R30/R43/R44 exist
 * to prevent. groq and gemini are NOT refused in production — they are real
 * hosted APIs a team can deliberately choose to run production on, not a
 * plumbing-only stand-in. The refusal (for ollama/mock) warns loudly and
 * falls back to the real client rather than throwing, so a misconfigured env
 * var degrades to correct-but-costly instead of taking the API down.
 */

'use strict';

const VALID_PROVIDERS = ['openai', 'ollama', 'groq', 'gemini', 'mock'];

/** Providers refused in production — local/dev-only or non-real output. */
const PRODUCTION_REFUSED_PROVIDERS = ['ollama', 'mock'];

/**
 * Which providers can serve which capability. Anything not listed for a
 * given capability falls back to 'openai' (see getAIClient below) — this is
 * the single source of truth for every "X cannot do Y" boundary described
 * in the header comment above.
 */
const CAPABILITY_PROVIDERS = {
    chat:       ['openai', 'ollama', 'groq', 'gemini'],
    vision:     ['openai', 'ollama', 'gemini'],
    audio:      ['openai', 'groq'],
    embeddings: ['openai'],
};

/**
 * Capabilities that only a real, universally-available client (openai) can
 * be assumed to serve — kept for backward compatibility with existing
 * callers/tests that import this list directly. Audio is no longer
 * exclusively real-only (groq serves it for free); embeddings still is.
 */
const REAL_ONLY_CAPABILITIES = ['embeddings'];

let _warnedProduction = false;
let _warnedProdRealProvider = false;
let _clientCache = new Map();

/**
 * Which provider is configured for a given capability, after production
 * safety is applied. PURE apart from reading env — exported so the
 * regression can execute it.
 *
 * @param {Object}  [opts]
 * @param {string}  [opts.capability]  - when 'vision', AI_VISION_PROVIDER
 *                                       (if set and valid) wins over AI_PROVIDER
 * @param {Object}  [opts.env]         - defaults to process.env
 */
function resolveProvider(opts = {}) {
    const capability = opts.capability;
    const env = opts.env || process.env;

    let raw = env.AI_PROVIDER;
    let source = 'AI_PROVIDER';

    if (capability === 'vision' && env.AI_VISION_PROVIDER) {
        raw = env.AI_VISION_PROVIDER;
        source = 'AI_VISION_PROVIDER';
    }

    raw = String(raw || 'openai').toLowerCase().trim();
    let requested = VALID_PROVIDERS.includes(raw) ? raw : 'openai';

    if (raw && !VALID_PROVIDERS.includes(raw)) {
        console.warn(
            `[AIProvider] Unknown ${source} "${raw}" — falling back to "openai". ` +
            `Valid values: ${VALID_PROVIDERS.join(', ')}`
        );
    }

    if (PRODUCTION_REFUSED_PROVIDERS.includes(requested) && env.NODE_ENV === 'production') {
        if (!_warnedProduction) {
            console.error(
                `[AIProvider] ${source}="${requested}" is set in PRODUCTION and has been ignored. ` +
                'A mocked or local model would answer users confidently and wrongly. ' +
                'Using the real OpenAI API.'
            );
            _warnedProduction = true;
        }
        return 'openai';
    }

    if ((requested === 'groq' || requested === 'gemini') && env.NODE_ENV === 'production' && !_warnedProdRealProvider) {
        console.log(
            `[AIProvider] Running production on ${source}="${requested}" (a real hosted API, ` +
            'not a mock/local stand-in) — this is allowed by design. See services/AIProvider.js header.'
        );
        _warnedProdRealProvider = true;
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
    let provider = resolveProvider({ capability });

    // A provider that cannot serve this capability at all falls back to the
    // real openai client — see CAPABILITY_PROVIDERS above for the full matrix
    // (audio never reaches ollama/gemini, vision never reaches groq,
    // embeddings never reach anything but openai).
    const allowed = CAPABILITY_PROVIDERS[capability] || CAPABILITY_PROVIDERS.chat;
    if (provider !== 'mock' && !allowed.includes(provider)) {
        console.warn(
            `[AIProvider] capability "${capability}" cannot be served by ${provider} — ` +
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
    } else if (provider === 'groq') {
        if (!env.GROQ_API_KEY) return null;
        config.baseURL = env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
        config.apiKey  = env.GROQ_API_KEY;
    } else if (provider === 'gemini') {
        if (!env.GEMINI_API_KEY) return null;
        config.baseURL = env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/';
        config.apiKey  = env.GEMINI_API_KEY;
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
 * A no-op for the real API; for every other provider, reads from env so the
 * model can be swapped without touching any call site.
 *
 * @param {string} requestedModel  - the OpenAI model name the call site wants
 *                                   (e.g. 'gpt-4o', 'gpt-4o-mini', 'whisper-1')
 * @param {string} [capability]    - 'chat' | 'vision' | 'audio'. When omitted,
 *                                   ollama falls back to sniffing the model
 *                                   name (legacy behaviour, kept for callers
 *                                   that don't pass it).
 */
function resolveModel(requestedModel, capability) {
    const provider = resolveProvider({ capability });
    if (provider === 'openai') return requestedModel;

    if (provider === 'ollama') {
        const isVision = capability === 'vision'
            || (!capability && (/vision/i.test(requestedModel) || requestedModel === 'gpt-4o-mini'));
        return isVision
            ? (process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_MODEL || 'llama3.2-vision')
            : (process.env.OLLAMA_MODEL || 'llama3.1');
    }

    if (provider === 'groq') {
        if (capability === 'audio') return process.env.GROQ_AUDIO_MODEL || 'whisper-large-v3';
        return process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b';
    }

    if (provider === 'gemini') {
        return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    }

    return requestedModel;
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
    if (provider === 'groq') return !!process.env.GROQ_API_KEY;
    if (provider === 'gemini') return !!process.env.GEMINI_API_KEY;
    return !!process.env.OPENAI_API_KEY;
}

/** Test seam — clears the memoised clients so env changes take effect. */
function _resetForTests() {
    _clientCache = new Map();
    _warnedProduction = false;
    _warnedProdRealProvider = false;
}

/**
 * Extract a usable message out of an error thrown by an OpenAI-compatible
 * call, working around a real bug in Gemini's OpenAI-compatibility layer:
 * Gemini wraps its error body in a JSON ARRAY — `[{ "error": {...} }]` —
 * instead of the plain `{ "error": {...} }` object the `openai` npm SDK
 * expects (confirmed on Google's own AI Developer forum, "Issue with
 * OpenAI-Compatible API Error Response (Root Array)..."). The SDK can't
 * parse that shape, so every Gemini failure — an invalid/deprecated model
 * name, a bad GEMINI_API_KEY, an exhausted free-tier quota — surfaces
 * identically as `err.message === '404 status code (no body)'` with the
 * real cause thrown away. That's exactly what call sites like
 * VisualAnalyzer.analyzeWithVision were logging, which made this
 * undiagnosable from logs alone.
 *
 * Call this in a catch block instead of reading `err.message` directly for
 * any call built from getAIClient()/resolveModel() — it's harmless (falls
 * through to err.message) for the openai/groq/ollama providers, whose error
 * bodies are already shaped the way the SDK expects.
 *
 * @param {*} err - the error thrown by openai.chat.completions.create() etc.
 * @returns {string} a human-readable "[status] real message" string
 */
function describeAIError(err) {
    if (!err) return 'Unknown error';

    const status = err.status ?? err.statusCode ?? err.response?.status;

    // Where the SDK stashes the parsed (or unparsed) error body varies by
    // version/transport — check every shape it's been seen to use.
    let body = err.error ?? err.response?.data ?? err.body ?? null;

    // The actual Gemini bug: body is an array, real error is body[0].error.
    if (Array.isArray(body) && body.length > 0) {
        body = body[0]?.error ?? body[0];
    }

    const realMessage =
        body?.message ??
        body?.error?.message ??
        (typeof body === 'string' ? body : null) ??
        err.message ??
        'Unknown error';

    return `[${status ?? '?'}] ${realMessage}`;
}

module.exports = {
    getAIClient,
    isAIConfigured,
    resolveProvider,
    resolveModel,
    describeAIError,
    mockBodyFor,
    VALID_PROVIDERS,
    REAL_ONLY_CAPABILITIES,
    PRODUCTION_REFUSED_PROVIDERS,
    CAPABILITY_PROVIDERS,
    _resetForTests,
};
