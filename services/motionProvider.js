/**
 * services/motionProvider.js
 *
 * Provider-independent motion generation service for VIBED.
 *
 * Coordinates motion-script and scene-plan generation across:
 *   - 'current': currently configured AI provider (OpenAI / Groq / Gemini)
 *   - 'gemma-local': locally hosted Google Gemma model (via Ollama or OpenAI-compatible server)
 *   - 'rules': deterministic rule-based generator (planMotionFromBrief / planFromBrief)
 *   - 'mock': deterministic synthetic test responses
 *
 * Features:
 *   - Normalized request ingestion (brief, context, timing, style)
 *   - Server-side provider selection via AI_MOTION_PROVIDER or AI_PROVIDER
 *   - Explicit JSON prompting tuned for open-weight models (like Gemma 2B/9B)
 *   - Timeout management and cancellation support via AbortSignal
 *   - Robust JSON extraction and bounded single-pass repair
 *   - Strict validation against VIBED's MotionSchema and SceneSchema
 *   - Zero eval / zero dynamic execution of model output
 *   - Sanitized telemetry logging (provider, model, latency, failure category)
 *   - Seamless fallback to deterministic rules on any failure or invalid data
 */

'use strict';

const {
    getAIClient,
    isAIConfigured,
    resolveProvider,
    resolveModel,
    describeAIError,
} = require('./AIProvider.js');

const DEFAULT_SCENE_TIMEOUT_MS = 30_000;
const DEFAULT_MOTION_TIMEOUT_MS = 45_000;

/** Supported motion providers */
const MOTION_PROVIDERS = ['current', 'gemma-local', 'rules', 'mock', 'openai', 'groq', 'gemini', 'ollama'];

/**
 * Resolve the active motion provider.
 * Respects AI_MOTION_PROVIDER, falling back to AI_PROVIDER, defaulting to 'current'.
 *
 * @param {Object} [env] - process.env override
 * @returns {string} - 'gemma-local' | 'rules' | 'mock' | 'current' | 'openai' | 'groq' | 'gemini' | 'ollama'
 */
function resolveMotionProvider(env = process.env) {
    let raw = env.AI_MOTION_PROVIDER;
    if (!raw && env.AI_PROVIDER) {
        raw = env.AI_PROVIDER;
    }
    raw = String(raw || 'current').toLowerCase().trim();

    if (raw === 'gemma' || raw === 'gemma2' || raw === 'gemma-local') return 'gemma-local';
    if (raw === 'gemma-groq' || raw === 'groq-gemma') return 'groq';
    if (raw === 'rules' || raw === 'none' || raw === 'deterministic') return 'rules';
    if (raw === 'mock') return 'mock';
    if (MOTION_PROVIDERS.includes(raw)) return raw;

    return 'current';
}

/**
 * Robust JSON extraction and single-pass syntax repair.
 * Strips markdown code blocks, extracts outermost JSON bounds, and fixes trailing commas.
 * PURE — exported for test harness and verification.
 *
 * @param {string} raw - raw model output
 * @returns {{ data: any|null, error: string|null }}
 */
function repairAndParseJSON(raw) {
    if (typeof raw !== 'string' || !raw.trim()) {
        return { data: null, error: 'empty_input' };
    }

    const trimmed = raw.trim();

    // 1. Direct parse attempt
    try {
        return { data: JSON.parse(trimmed), error: null };
    } catch {
        // Continue to repair attempts
    }

    // 2. Strip markdown fences: ```json ... ``` or ``` ... ```
    let cleaned = trimmed;
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
        cleaned = fenceMatch[1].trim();
        try {
            return { data: JSON.parse(cleaned), error: null };
        } catch {
            // Continue to boundary extraction
        }
    }

    // 3. Extract outermost { ... } or [ ... ]
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');

    let candidate = null;
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        candidate = cleaned.slice(firstBrace, lastBrace + 1);
    } else if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        candidate = cleaned.slice(firstBracket, lastBracket + 1);
    }

    if (candidate) {
        try {
            return { data: JSON.parse(candidate), error: null };
        } catch {
            // 4. Bounded repair: remove illegal trailing commas before closing braces/brackets
            const trailingCommaCleaned = candidate.replace(/,\s*([}\]])/g, '$1');
            try {
                return { data: JSON.parse(trailingCommaCleaned), error: null };
            } catch (err) {
                return { data: null, error: `syntax_error: ${err.message}` };
            }
        }
    }

    return { data: null, error: 'no_json_structure_found' };
}

/**
 * Log sanitized telemetry without leaking user text, prompts, or secrets.
 */
function logMotionTelemetry({ operation, provider, model, latencyMs, status, failureCategory }) {
    const safeProvider = String(provider || 'unknown').slice(0, 30);
    const safeModel = String(model || 'unknown').slice(0, 40);
    const safeStatus = String(status || 'unknown').slice(0, 20);
    const safeCategory = failureCategory ? String(failureCategory).slice(0, 40) : 'none';

    console.log(
        `[MotionProvider] op=${operation} provider=${safeProvider} model=${safeModel} ` +
        `latencyMs=${Math.round(latencyMs)} status=${safeStatus} failureCategory=${safeCategory}`
    );
}

/**
 * Execute a chat completion with automatic failover for capacity spikes (503),
 * rate limits (429), or missing models (404).
 *
 * If Gemini experiences high demand (503) or rate limits (429), cascades across
 * Google's high-capacity flash-lite models (gemini-3.1-flash-lite,
 * gemini-flash-lite-latest, gemini-flash-latest).
 * If all Gemini models fail and a secondary provider (e.g. Groq or OpenAI via
 * AI_PROVIDER) is configured, falls back to the secondary provider before
 * giving up to deterministic rules.
 */
async function executeChatCompletionWithFailover({
    ai,
    requestParams,
    provider,
    model,
    timeout,
    signal,
}) {
    let completion = null;
    let activeProvider = provider;
    let activeModel = model;

    try {
        completion = await ai.chat.completions.create(requestParams, { signal });
        return { completion, activeProvider, activeModel };
    } catch (err) {
        const status = err.status ?? err.statusCode ?? err.response?.status;
        const msg = String(err.message || '');
        const isRetryable = status === 503 || status === 429 || status === 404 ||
            /503|429|404|demand|capacity|overloaded|rate limit|quota|not found/i.test(msg);

        if (!isRetryable) {
            throw err;
        }

        // 1. Try Gemini model fallbacks
        if (provider === 'gemini') {
            const is404 = status === 404 || /404|not found/i.test(msg);
            const geminiFallbacks = is404
                ? ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest']
                : ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.8-flash'];

            const candidateModels = geminiFallbacks.filter(m => m !== model);
            for (const fallbackModel of candidateModels) {
                if (signal?.aborted) break;
                console.warn(
                    `[motionProvider] Gemini model "${activeModel}" failed (${status || msg}); ` +
                    `retrying with fallback "${fallbackModel}"...`
                );
                try {
                    const fallbackParams = { ...requestParams, model: fallbackModel };
                    completion = await ai.chat.completions.create(fallbackParams, { signal });
                    if (completion?.choices?.[0]?.message?.content) {
                        return { completion, activeProvider: 'gemini', activeModel: fallbackModel };
                    }
                } catch (fbErr) {
                    console.warn(`[motionProvider] Fallback model "${fallbackModel}" failed: ${describeAIError(fbErr)}`);
                }
            }
        }

        // 2. Try secondary AI provider if configured (e.g. Groq, OpenAI)
        const baseProvider = resolveProvider({ capability: 'chat' });
        if (baseProvider !== provider && isAIConfigured({ capability: 'chat' })) {
            console.warn(
                `[motionProvider] Provider "${provider}" exhausted all models; ` +
                `failing over to secondary provider "${baseProvider}"...`
            );
            try {
                const secondaryAi = getAIClient({ timeout, provider: baseProvider });
                if (secondaryAi) {
                    const secondaryModel = resolveModel('gpt-4o', { provider: baseProvider, capability: 'motion' });
                    const secondaryParams = {
                        ...requestParams,
                        model: secondaryModel,
                        max_tokens: Number(process.env.MOTION_AI_MAX_TOKENS) > 0
                            ? Number(process.env.MOTION_AI_MAX_TOKENS)
                            : (/gemini|^o\d|gpt-5/i.test(secondaryModel) ? 2000 : 700),
                    };
                    if (/gemma/i.test(secondaryModel)) {
                        delete secondaryParams.response_format;
                    } else {
                        secondaryParams.response_format = { type: 'json_object' };
                    }
                    completion = await secondaryAi.chat.completions.create(secondaryParams, { signal });
                    if (completion?.choices?.[0]?.message?.content) {
                        return { completion, activeProvider: baseProvider, activeModel: secondaryModel };
                    }
                }
            } catch (secondaryErr) {
                console.warn(`[motionProvider] Secondary provider "${baseProvider}" failed: ${describeAIError(secondaryErr)}`);
            }
        }

        throw err;
    }
}

/**
 * Generate a high-level editorial/scene plan for a short video or sequence.
 *
 * Coordinates with the configured AI provider to produce:
 *   - visual hook headline and key animated terms
 *   - structured beats with recommended visual techniques
 *   - optional call to action
 *
 * @param {Object} opts
 * @param {string} opts.brief - creative brief
 * @param {string} [opts.transcript] - spoken transcript context
 * @param {string[]} [opts.beats] - requested beats
 * @param {string} [opts.tone] - requested tone
 * @param {string} [opts.platform] - target platform
 * @param {number} [opts.timeoutMs] - per-request timeout
 * @param {AbortSignal} [opts.signal] - optional cancellation signal
 * @param {Function} opts.buildPrompt - prompt builder function
 * @param {Function} opts.cleanPlan - plan validator function
 * @returns {Promise<{ source: 'llm'|'rules', plan: Object|null, provider: string, model: string, latencyMs: number }>}
 */
async function generateScenePlan({
    brief,
    transcript = '',
    beats = [],
    tone = '',
    platform = '',
    timeoutMs,
    signal,
    buildPrompt,
    cleanPlan,
}) {
    const startTime = Date.now();
    const cleanBrief = String(brief || '').trim().slice(0, 600);
    const cleanTranscript = String(transcript || '').trim().slice(0, 3000);
    const beatList = (Array.isArray(beats) ? beats : []).map(b => String(b || '').slice(0, 20)).filter(Boolean).slice(0, 8);

    const configuredProvider = resolveMotionProvider();

    // Deterministic rules fallback shortcut
    if (configuredProvider === 'rules' || !cleanBrief) {
        logMotionTelemetry({
            operation: 'scene-plan',
            provider: 'rules',
            model: 'deterministic',
            latencyMs: Date.now() - startTime,
            status: 'rules_fallback',
            failureCategory: 'rules_requested',
        });
        return { source: 'rules', plan: null, provider: 'rules', model: 'deterministic', latencyMs: 0, failureCategory: 'rules_requested' };
    }

    // Determine actual AI client
    const targetCapability = 'motion';
    // Always re-derive through AIProvider's own resolveProvider rather than
    // trusting `configuredProvider` (this module's own env read) directly
    // for anything but the 'rules' shortcut above. resolveProvider is where
    // the production safety net lives (AI_MOTION_PROVIDER="gemma-local" or
    // "mock" set in prod is overridden to "openai" there, by design -- see
    // services/AIProvider.js). Passing `configuredProvider` straight through
    // here meant the actual network call was still safely redirected (every
    // other call site goes through getAIClient/resolveModel, which call
    // resolveProvider too), but this function's own `effectiveProvider` --
    // returned to the caller and written to telemetry -- kept reporting the
    // requested-but-overridden provider (e.g. "gemma-local") instead of what
    // actually served the request (e.g. "openai"), which is what operators
    // read when diagnosing a production issue.
    const effectiveProvider = resolveProvider({ capability: targetCapability });

    const isAvailable = effectiveProvider === 'mock' || effectiveProvider === 'gemma-local' || isAIConfigured({ capability: targetCapability });
    if (!isAvailable) {
        logMotionTelemetry({
            operation: 'scene-plan',
            provider: effectiveProvider,
            model: 'none',
            latencyMs: Date.now() - startTime,
            status: 'rules_fallback',
            failureCategory: 'provider_unconfigured',
        });
        return { source: 'rules', plan: null, provider: effectiveProvider, model: 'none', latencyMs: Date.now() - startTime, failureCategory: 'provider_unconfigured' };
    }

    if (signal?.aborted) {
        logMotionTelemetry({
            operation: 'scene-plan',
            provider: effectiveProvider,
            model: 'none',
            latencyMs: Date.now() - startTime,
            status: 'rules_fallback',
            failureCategory: 'cancelled',
        });
        return { source: 'rules', plan: null, provider: effectiveProvider, model: 'none', latencyMs: Date.now() - startTime, failureCategory: 'cancelled' };
    }

    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : (Number(process.env.MOTION_AI_TIMEOUT_MS) || DEFAULT_SCENE_TIMEOUT_MS);
    const model = resolveModel('gpt-4o', targetCapability);

    let rawOutput = null;
    let failureCategory = null;

    let activeModel = model;
    let activeProvider = effectiveProvider;

    try {
        const ai = getAIClient({ timeout, capability: targetCapability });
        if (!ai) {
            failureCategory = 'client_initialization_failed';
            throw new Error('AI client unavailable');
        }

        const promptContent = buildPrompt({
            brief: cleanBrief,
            transcript: cleanTranscript,
            beats: beatList,
            tone: tone ? String(tone).slice(0, 40) : '',
            platform: platform ? String(platform).slice(0, 40) : '',
        });

        const requestParams = {
            model,
            messages: [{ role: 'user', content: promptContent }],
            temperature: 0.6,
            // A reasoning model spends part of this budget THINKING before it
            // writes anything, and those tokens count here. At 700 a scene
            // plan can finish with `finish_reason: 'length'` and an empty
            // string, which arrives as the same silent rules fallback as "no
            // model configured". Overridable, with more headroom for the
            // models that reason by default.
            max_tokens: Number(process.env.MOTION_AI_MAX_TOKENS) > 0
                ? Number(process.env.MOTION_AI_MAX_TOKENS)
                : (/gemini|^o\d|gpt-5/i.test(model) ? 2000 : 700),
        };
        if (!/gemma/i.test(model)) {
            requestParams.response_format = { type: 'json_object' };
        }

        const failoverResult = await executeChatCompletionWithFailover({
            ai,
            requestParams,
            provider: effectiveProvider,
            model,
            timeout,
            signal,
        });

        const completion = failoverResult.completion;
        activeProvider = failoverResult.activeProvider;
        activeModel = failoverResult.activeModel;

        rawOutput = completion?.choices?.[0]?.message?.content || null;
        // Distinguish "the model answered with nothing" from "the model ran
        // out of budget mid-answer". Both produce an empty string, and only
        // one of them is fixed by raising MOTION_AI_MAX_TOKENS.
        if (!rawOutput && completion?.choices?.[0]?.finish_reason === 'length') {
            failureCategory = 'output_truncated';
        }
    } catch (err) {
        if (err.name === 'AbortError' || signal?.aborted) {
            failureCategory = 'cancelled';
        } else if (/timeout/i.test(err.message)) {
            failureCategory = 'timeout';
        } else {
            failureCategory = describeAIError(err) || 'api_error';
        }
    }

    if (failureCategory || !rawOutput) {
        const latencyMs = Date.now() - startTime;
        logMotionTelemetry({
            operation: 'scene-plan',
            provider: activeProvider,
            model: activeModel,
            latencyMs,
            status: 'rules_fallback',
            failureCategory: failureCategory || 'no_output',
        });
        return { source: 'rules', plan: null, provider: activeProvider, model: activeModel, latencyMs, failureCategory: failureCategory || 'no_output' };
    }

    const parseResult = repairAndParseJSON(rawOutput);
    const validatedPlan = (parseResult.data && typeof cleanPlan === 'function')
        ? cleanPlan(parseResult.data)
        : null;

    const latencyMs = Date.now() - startTime;
    const isSuccess = !!validatedPlan;

    logMotionTelemetry({
        operation: 'scene-plan',
        provider: activeProvider,
        model: activeModel,
        latencyMs,
        status: isSuccess ? 'success' : 'rules_fallback',
        failureCategory: isSuccess ? null : (failureCategory || parseResult.error || 'validation_failed'),
    });

    return {
        source: isSuccess ? 'llm' : 'rules',
        plan: validatedPlan,
        provider: activeProvider,
        model: activeModel,
        latencyMs,
    };
}

/**
 * Generate a motion script for an array of timeline layers.
 *
 * @param {Object} opts
 * @param {string} opts.brief - creative motion brief
 * @param {Array} opts.layers - timeline layers
 * @param {string} [opts.editingStyle] - editorial pacing/style
 * @param {number} [opts.timeoutMs] - per-request timeout
 * @param {AbortSignal} [opts.signal] - optional cancellation signal
 * @param {Object} opts.composer - MotionComposer module instance
 * @param {Function} opts.buildPrompt - prompt builder function
 * @param {Function} opts.cleanLayers - layer sanitizer function
 * @returns {Promise<{ source: 'llm'|'mixed'|'rules', layers: Object, notes: string|null, provider: string, model: string, latencyMs: number }>}
 */
async function generateMotionScript({
    brief,
    layers,
    editingStyle,
    timeoutMs,
    signal,
    composer,
    buildPrompt,
    cleanLayers,
}) {
    const startTime = Date.now();
    const cleanBrief = String(brief || '').trim().slice(0, 600);
    const list = cleanLayers(layers);

    if (list.length === 0) {
        throw new Error('layers is required (at least one {id, kind, duration})');
    }

    const fallbackFor = l => composer.planMotionFromBrief(cleanBrief || 'animate it', { duration: l.duration });
    const rulesScripts = () => Object.fromEntries(list.map(l => [l.id, fallbackFor(l)]));

    const configuredProvider = resolveMotionProvider();

    // Deterministic rules fallback shortcut
    if (configuredProvider === 'rules' || !cleanBrief) {
        logMotionTelemetry({
            operation: 'motion-compose',
            provider: 'rules',
            model: 'deterministic',
            latencyMs: Date.now() - startTime,
            status: 'rules_fallback',
            failureCategory: 'rules_requested',
        });
        return {
            source: 'rules',
            layers: rulesScripts(),
            notes: null,
            provider: 'rules',
            model: 'deterministic',
            latencyMs: 0,
        };
    }

    const targetCapability = 'motion';
    // Always re-derive through AIProvider's own resolveProvider rather than
    // trusting `configuredProvider` (this module's own env read) directly
    // for anything but the 'rules' shortcut above. resolveProvider is where
    // the production safety net lives (AI_MOTION_PROVIDER="gemma-local" or
    // "mock" set in prod is overridden to "openai" there, by design -- see
    // services/AIProvider.js). Passing `configuredProvider` straight through
    // here meant the actual network call was still safely redirected (every
    // other call site goes through getAIClient/resolveModel, which call
    // resolveProvider too), but this function's own `effectiveProvider` --
    // returned to the caller and written to telemetry -- kept reporting the
    // requested-but-overridden provider (e.g. "gemma-local") instead of what
    // actually served the request (e.g. "openai"), which is what operators
    // read when diagnosing a production issue.
    const effectiveProvider = resolveProvider({ capability: targetCapability });

    const isAvailable = effectiveProvider === 'mock' || effectiveProvider === 'gemma-local' || isAIConfigured({ capability: targetCapability });
    if (!isAvailable) {
        logMotionTelemetry({
            operation: 'motion-compose',
            provider: effectiveProvider,
            model: 'none',
            latencyMs: Date.now() - startTime,
            status: 'rules_fallback',
            failureCategory: 'provider_unconfigured',
        });
        return {
            source: 'rules',
            layers: rulesScripts(),
            notes: null,
            provider: effectiveProvider,
            model: 'none',
            latencyMs: Date.now() - startTime,
        };
    }

    if (signal?.aborted) {
        logMotionTelemetry({
            operation: 'motion-compose',
            provider: effectiveProvider,
            model: 'none',
            latencyMs: Date.now() - startTime,
            status: 'rules_fallback',
            failureCategory: 'cancelled',
        });
        return {
            source: 'rules',
            layers: rulesScripts(),
            notes: null,
            provider: effectiveProvider,
            model: 'none',
            latencyMs: Date.now() - startTime,
        };
    }

    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : (Number(process.env.MOTION_AI_TIMEOUT_MS) || DEFAULT_MOTION_TIMEOUT_MS);
    const model = resolveModel('gpt-4o', targetCapability);

    let rawOutput = null;
    let failureCategory = null;

    let activeModel = model;
    let activeProvider = effectiveProvider;

    try {
        const ai = getAIClient({ timeout, capability: targetCapability });
        if (!ai) {
            failureCategory = 'client_initialization_failed';
            throw new Error('AI client unavailable');
        }

        const promptContent = buildPrompt({
            brief: cleanBrief,
            layers: list,
            catalog: composer.verbCatalog(),
            editingStyle,
        });

        const requestParams = {
            model,
            messages: [{ role: 'user', content: promptContent }],
            temperature: 0.6,
            max_tokens: 2500,
        };
        if (!/gemma/i.test(model)) {
            requestParams.response_format = { type: 'json_object' };
        }

        const failoverResult = await executeChatCompletionWithFailover({
            ai,
            requestParams,
            provider: effectiveProvider,
            model,
            timeout,
            signal,
        });

        const completion = failoverResult.completion;
        activeProvider = failoverResult.activeProvider;
        activeModel = failoverResult.activeModel;

        rawOutput = completion?.choices?.[0]?.message?.content || null;
    } catch (err) {
        if (err.name === 'AbortError' || signal?.aborted) {
            failureCategory = 'cancelled';
        } else if (/timeout/i.test(err.message)) {
            failureCategory = 'timeout';
        } else {
            failureCategory = describeAIError(err) || 'api_error';
        }
    }

    if (failureCategory || !rawOutput) {
        const latencyMs = Date.now() - startTime;
        logMotionTelemetry({
            operation: 'motion-compose',
            provider: activeProvider,
            model: activeModel,
            latencyMs,
            status: 'rules',
            failureCategory: failureCategory || 'no_output',
        });
        return {
            source: 'rules',
            layers: rulesScripts(),
            notes: null,
            provider: activeProvider,
            model: activeModel,
            latencyMs,
        };
    }

    const parseResult = repairAndParseJSON(rawOutput);
    const parsedData = parseResult.data;

    // Validate layers against MotionSchema via MotionComposer
    const out = {};
    let usedLLM = 0;
    for (const l of list) {
        const script = parsedData?.layers?.[l.id];
        const kind = l.kind === 'caption' ? 'caption' : l.kind;
        const check = script ? composer.composeMotion(script, { duration: l.duration, kind }) : null;
        if (check && check.animations && check.animations.length > 0) {
            out[l.id] = { beats: script.beats || [], animations: script.animations || [] };
            usedLLM += 1;
        } else {
            out[l.id] = fallbackFor(l);
        }
    }

    const latencyMs = Date.now() - startTime;
    const finalSource = usedLLM === list.length ? 'llm' : usedLLM > 0 ? 'mixed' : 'rules';

    logMotionTelemetry({
        operation: 'motion-compose',
        provider: activeProvider,
        model: activeModel,
        latencyMs,
        status: finalSource,
        failureCategory: usedLLM > 0 ? null : (failureCategory || parseResult.error || 'validation_failed'),
    });

    return {
        source: finalSource,
        layers: out,
        notes: typeof parsedData?.notes === 'string' ? parsedData.notes.slice(0, 200) : null,
        provider: activeProvider,
        model: activeModel,
        latencyMs,
    };
}

module.exports = {
    resolveMotionProvider,
    repairAndParseJSON,
    generateScenePlan,
    generateMotionScript,
    logMotionTelemetry,
    MOTION_PROVIDERS,
};
