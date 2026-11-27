// services/tracing/langfuse.js
// Langfuse tracing for every AI call the backend makes, and for agent runs,
// on the official Langfuse SDK v6 (@langfuse/tracing + @langfuse/otel), R177.
//
// WHAT A TRACE IS
//   - One HTTP request (or one background job) that calls a model = one trace,
//     named after the feature (`ai/parse-intent`, `brain/analyze`,
//     `job/asset-analysis`), with the user, the project as session, and every
//     model call inside it as a `generation` (model, parameters, tokens).
//     The root is created at the FIRST model call, so a request that never
//     calls a model costs nothing.
//   - One agent run = one trace, across all the requests it makes: an `agent`
//     root, a span per step, an event per approval or kept/dropped decision,
//     and the generations of its steps. Its ids are derived from the run id
//     so every request of the run lands in the same trace.
//
// SETUP (docs: langfuse.com/faq/all/existing-sentry-setup, "isolated provider")
//   Sentry keeps the global OpenTelemetry provider; Langfuse gets its OWN
//   NodeTracerProvider through setLangfuseTracerProvider, never registered
//   globally, so Express/HTTP spans never reach Langfuse and Sentry is not
//   affected. Requires Node >= 22 (the SDK's engines field).
//
// CONFIG
//   LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY   both required, else tracing is off
//   LANGFUSE_BASE_URL                           default https://cloud.langfuse.com (EU)
//   LANGFUSE_TRACING=off                        kill switch
//   LANGFUSE_SAMPLE_RATE                        share of non-run traces kept (default 0.25);
//                                               agent runs are always kept
//   LANGFUSE_TRACING_ENVIRONMENT                default from NODE_ENV
//
// PRIVACY: everything sent goes through `mask` (emails, phone numbers, API
// keys and tokens removed; images replaced by a placeholder; long text cut),
// and media upload is off, so frames of users' videos never leave.
//
// Never throws into the caller: a tracing failure is logged and the AI call
// goes ahead untouched. The SDK's own promise is returned unchanged.

'use strict';

const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 6000;
const DEFAULT_SAMPLE_RATE = 0.25;

// ── configuration ───────────────────────────────────────────────────────────

function config(env = process.env) {
    const publicKey = env.LANGFUSE_PUBLIC_KEY || '';
    const secretKey = env.LANGFUSE_SECRET_KEY || '';
    const enabled = !!(publicKey && secretKey) && String(env.LANGFUSE_TRACING || '').toLowerCase() !== 'off';
    const raw = env.LANGFUSE_SAMPLE_RATE;
    const rate = raw === undefined || raw === '' ? NaN : Number(raw);
    return {
        enabled,
        publicKey,
        secretKey,
        baseUrl: String(env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com').replace(/\/+$/, ''),
        sampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : DEFAULT_SAMPLE_RATE,
        environment: environmentName(env),
    };
}

/** Langfuse environment names: ^(?!langfuse)[a-z0-9-_]+$, max 40. */
function environmentName(env = process.env) {
    const raw = String(env.LANGFUSE_TRACING_ENVIRONMENT || env.NODE_ENV || 'development').toLowerCase();
    const clean = raw.replace(/[^a-z0-9-_]/g, '-').slice(0, 40);
    return !clean || clean.startsWith('langfuse') ? 'development' : clean;
}

// ── masking (pure, exported for the test) ──────────────────────────────────

const PATTERNS = [
    [/data:(image|video|audio)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[$1 omitted]'],
    [/\b(sk|pk|rk)-(lf-|proj-|live_|test_)?[a-z0-9_-]{16,}\b/gi, '[secret]'],
    [/\b(gsk|ghp|gho|github_pat|xox[bap])_[a-z0-9_]{16,}\b/gi, '[secret]'],
    [/\bAIza[0-9a-z_-]{30,}\b/gi, '[secret]'],
    [/\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/gi, '[token]'],
    [/\b(bearer|basic)\s+[a-z0-9._~+/=-]{16,}/gi, '$1 [secret]'],
    [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]'],
    [/(?<![\w.:])\+?\d[\d\s().-]{7,}\d(?![\w.:])/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[phone]' : m)],
];

function maskString(s) {
    let out = s;
    for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
    return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}… [truncated ${out.length - MAX_TEXT} chars]` : out;
}

/** Mask any value: strings are cleaned, objects walked (bounded). */
function maskValue(data, depth = 0) {
    if (typeof data === 'string') return maskString(data);
    if (data === null || typeof data !== 'object') return data;
    if (depth > 8) return '[nested]';
    if (Array.isArray(data)) return data.slice(0, 200).map(v => maskValue(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(data).slice(0, 200)) {
        // An OpenAI image part: keep that there was an image, never the image.
        if (k === 'image_url' && v && typeof v === 'object') { out[k] = { url: '[image omitted]' }; continue; }
        out[k] = maskValue(v, depth + 1);
    }
    return out;
}

// ── SDK setup ───────────────────────────────────────────────────────────────

/** Lets one span take ids we chose (an agent run's root), every other span random ids. */
class PinnableIdGenerator {
    constructor() { this.trace = null; this.span = null; }
    pin(traceId, spanId) { this.trace = traceId; this.span = spanId; }
    clear() { this.trace = null; this.span = null; }
    generateTraceId() { const t = this.trace; this.trace = null; return t || crypto.randomBytes(16).toString('hex'); }
    generateSpanId() { const s = this.span; this.span = null; return s || crypto.randomBytes(8).toString('hex'); }
}

let state = null; // { enabled, tracing, provider, processor, ids, cfg }

/**
 * Start tracing. Called once at boot (index.js, worker.js) AFTER Sentry.init.
 * `exporter` replaces the network exporter behind the Langfuse processor
 * (tests pass an in-memory one, so masking and propagation are still real).
 */
function initTracing({ exporter = null, env = process.env } = {}) {
    if (state) return state.enabled;
    const cfg = config(env);
    if (!cfg.enabled && !exporter) { state = { enabled: false, cfg }; return false; }
    try {
        const api = require('@opentelemetry/api');
        const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
        const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
        const tracing = require('@langfuse/tracing');
        // Sentry registers its own (ALS-based) context manager when it is on;
        // this one is only used when it is not. Either way, active spans flow
        // through async calls.
        api.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
        const { LangfuseSpanProcessor } = require('@langfuse/otel');
        let release;
        try { release = require('../buildInfo').getBuildId(); } catch { release = undefined; }
        const processor = new LangfuseSpanProcessor({
            publicKey: cfg.publicKey || 'pk-lf-test',
            secretKey: cfg.secretKey || 'sk-lf-test',
            baseUrl: cfg.baseUrl,
            environment: cfg.environment,
            release: release ? String(release) : undefined,
            mediaUploadEnabled: false,
            mask: ({ data }) => maskValue(data),
            ...(exporter ? { exporter, exportMode: 'immediate' } : {}),
        });
        const ids = new PinnableIdGenerator();
        const provider = new NodeTracerProvider({ idGenerator: ids, spanProcessors: [processor] });
        tracing.setLangfuseTracerProvider(provider);
        state = { enabled: true, tracing, provider, processor, ids, cfg };
        if (!exporter) {
            const stop = () => { shutdownTracing().catch(() => {}); };
            process.once('SIGTERM', stop);
            process.once('beforeExit', stop);
            console.log(`[langfuse] tracing on (${cfg.environment}, ${Math.round(cfg.sampleRate * 100)}% of requests, every agent run)`);
        }
        return true;
    } catch (err) {
        console.error('[langfuse] tracing could not start; continuing without it:', err.message);
        state = { enabled: false, cfg };
        return false;
    }
}

function isEnabled() { return !!state?.enabled; }

async function flushTracing() {
    if (!state?.enabled) return;
    try { await state.provider.forceFlush(); } catch (err) { console.warn('[langfuse] flush failed:', err.message); }
}

async function shutdownTracing() {
    if (!state?.enabled) return;
    try { await state.provider.shutdown(); } catch (err) { console.warn('[langfuse] shutdown failed:', err.message); }
}

// ── ids ─────────────────────────────────────────────────────────────────────

/** OTel trace id (32 hex) of an agent run: its UUID without dashes. */
function traceIdFor(runId) {
    return UUID.test(String(runId)) ? String(runId).replace(/-/g, '').toLowerCase() : null;
}

/** Stable 16-hex span id, so a span can be named as a parent before it is sent. */
function spanIdFor(runId, key) {
    return crypto.createHash('sha256').update(`${runId}:${key}`).digest('hex').slice(0, 16);
}

function runParent(runId) {
    return { traceId: traceIdFor(runId), spanId: spanIdFor(runId, 'root'), traceFlags: 1, isRemote: true };
}

// ── naming ──────────────────────────────────────────────────────────────────

/** Stable trace name from the route: '/api/ai/parse-intent' -> 'ai/parse-intent'. */
function featureFromRequest(req) {
    if (!req) return 'ai-call';
    const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : (req.originalUrl || req.url || '').split('?')[0];
    const name = String(route).replace(/^\/api\//, '').replace(/\/:[^/]+/g, '').replace(/\/[0-9a-f-]{16,}/gi, '').replace(/\/+$/, '');
    return (name || 'ai-call').slice(0, 80);
}

/** What the request asked, not all of its body (best practice: relevant input only). */
function requestInput(req) {
    const b = req?.body && typeof req.body === 'object' ? req.body : {};
    const pick = {};
    for (const k of ['prompt', 'userPrompt', 'message', 'query', 'brief', 'command', 'text', 'question', 'trigger']) {
        if (typeof b[k] === 'string' && b[k].trim()) pick[k] = b[k].slice(0, 2000);
    }
    return Object.keys(pick).length ? pick : { route: featureFromRequest(req) };
}

function traceAttributes(ctx) {
    const req = ctx.req;
    const userId = ctx.userId || req?.user?.id || null;
    const projectId = ctx.sessionId || req?.body?.projectId || req?.query?.projectId || req?.params?.projectId || null;
    const feature = ctx.feature || featureFromRequest(req);
    const attrs = {
        traceName: ctx.runId ? (ctx.runKind || 'agent-run') : feature,
        tags: ctx.runId ? ['agent-run'] : ['ai', String(feature).split('/')[0]],
    };
    if (userId) attrs.userId = String(userId).slice(0, 200);
    if (projectId && typeof projectId === 'string') attrs.sessionId = projectId.slice(0, 200);
    return attrs;
}

// ── per-request / per-job root ──────────────────────────────────────────────

function isSampled(ctx) {
    if (ctx.sampled === undefined) ctx.sampled = !!ctx.runId || Math.random() < (state?.cfg?.sampleRate ?? DEFAULT_SAMPLE_RATE);
    return ctx.sampled;
}

/** The request's root observation, created at its first model call. */
function rootFor(ctx) {
    if (ctx.root) return ctx.root;
    const { tracing } = state;
    const attrs = traceAttributes(ctx);
    ctx.root = tracing.propagateAttributes(attrs, () => tracing.startObservation(attrs.traceName,
        { input: ctx.req ? requestInput(ctx.req) : ctx.input || null, ...(ctx.metadata ? { metadata: ctx.metadata } : {}) },
        { asType: 'span', startTime: new Date(ctx.startedAt || Date.now()) }));
    const end = () => {
        if (!ctx.root || ctx.rootEnded) return;
        ctx.rootEnded = true;
        try {
            const status = ctx.req?.res?.statusCode;
            ctx.root.update({
                output: ctx.lastOutput ?? null,
                ...(status >= 400 ? { level: 'ERROR', statusMessage: `HTTP ${status}` } : {}),
                metadata: { aiCalls: ctx.aiCalls || 0, ...(status ? { status } : {}) },
            });
            ctx.root.end();
        } catch (err) { console.warn('[langfuse] could not close a trace:', err.message); }
    };
    ctx.endRoot = end;
    if (ctx.req?.res && typeof ctx.req.res.once === 'function') {
        ctx.req.res.once('finish', end);
        ctx.req.res.once('close', end);
    }
    return ctx.root;
}

/**
 * Run background work (a BullMQ job) as its own traced unit.
 * @param {{ feature: string, userId?: string, sessionId?: string, input?: object, metadata?: object }} info
 */
function runWithTraceContext(info, fn) {
    const { runInContext } = require('./runContext');
    const ctx = {
        feature: info.feature, userId: info.userId || null, sessionId: info.sessionId || null,
        input: info.input || null, metadata: info.metadata || null, startedAt: Date.now(),
    };
    return runInContext(ctx, async () => {
        try { return await fn(); } finally { if (ctx.endRoot) ctx.endRoot(); }
    });
}

// ── AI calls ────────────────────────────────────────────────────────────────

const USAGE_TTL_MS = 2 * 60 * 60 * 1000;
const usageByRun = new Map();

function addUsage(runId, { input = 0, output = 0, error = false } = {}) {
    const now = Date.now();
    for (const [id, u] of usageByRun) if (now - u.at > USAGE_TTL_MS) usageByRun.delete(id);
    const u = usageByRun.get(runId) || { aiCalls: 0, inputTokens: 0, outputTokens: 0, failedCalls: 0, at: now };
    u.aiCalls += 1;
    u.inputTokens += Number(input) || 0;
    u.outputTokens += Number(output) || 0;
    if (error) u.failedCalls += 1;
    u.at = now;
    usageByRun.set(runId, u);
}

/** What this server has counted for a run so far, or null. */
function usageFor(runId) {
    const u = usageByRun.get(runId);
    return u ? { aiCalls: u.aiCalls, inputTokens: u.inputTokens, outputTokens: u.outputTokens, failedCalls: u.failedCalls } : null;
}

function usageOf(res) {
    const u = res?.usage || {};
    const input = Number(u.prompt_tokens ?? u.input_tokens) || 0;
    const output = Number(u.completion_tokens ?? u.output_tokens) || 0;
    return { input, output, total: Number(u.total_tokens) || input + output };
}

function modelParameters(body) {
    const p = {};
    for (const k of ['temperature', 'max_tokens', 'max_completion_tokens', 'top_p', 'reasoning_effort']) {
        if (body?.[k] !== undefined && body[k] !== null) p[k] = typeof body[k] === 'number' ? body[k] : String(body[k]);
    }
    if (body?.response_format?.type) p.response_format = String(body.response_format.type);
    return p;
}

/** Start the generation for one model call, under the run or the request root. */
function startGeneration(ctx, name, attrs) {
    const { tracing } = state;
    const trace = traceAttributes(ctx);
    if (ctx.runId) {
        return tracing.propagateAttributes(trace, () => tracing.startObservation(name,
            { ...attrs, metadata: { ...(attrs.metadata || {}), step: ctx.stepId || 'unknown' } },
            { asType: 'generation', parentSpanContext: runParent(ctx.runId) }));
    }
    const root = rootFor(ctx);
    return tracing.propagateAttributes(trace, () => root.startObservation(name, attrs, { asType: 'generation' }));
}

function traceCall(ctx, kind, provider, body, run) {
    ctx.aiCalls = (ctx.aiCalls || 0) + 1;
    let gen = null;
    if (isEnabled() && isSampled(ctx)) {
        try {
            gen = startGeneration(ctx, kind === 'audio' ? 'transcribe-audio' : `generate-${kind}`, {
                model: body?.model,
                modelParameters: modelParameters(body),
                input: kind === 'audio' ? { file: '[audio omitted]', language: body?.language || null } : body?.messages,
                metadata: { provider: provider || 'unknown' },
            });
        } catch (err) { console.warn('[langfuse] generation not traced:', err.message); gen = null; }
    }
    const result = run();
    if (!result || typeof result.then !== 'function') return result;
    if (body?.stream) {
        if (ctx.runId) addUsage(ctx.runId, {});
        if (gen) { try { gen.update({ output: '[streamed]' }).end(); } catch { /* traced best effort */ } }
        return result;
    }
    result.then(
        (res) => {
            const usage = usageOf(res);
            if (ctx.runId) addUsage(ctx.runId, usage);
            const output = kind === 'audio' ? (typeof res === 'string' ? res : res?.text ?? null) : (res?.choices?.[0]?.message?.content ?? null);
            ctx.lastOutput = output;
            if (gen) {
                try {
                    gen.update({
                        output,
                        model: res?.model || body?.model,
                        ...(usage.total ? { usageDetails: { input: usage.input, output: usage.output, total: usage.total } } : {}),
                    }).end();
                } catch (err) { console.warn('[langfuse] generation not closed:', err.message); }
            }
        },
        (err) => {
            if (ctx.runId) addUsage(ctx.runId, { error: true });
            if (gen) {
                try { gen.update({ level: 'ERROR', statusMessage: String(err?.message || 'AI call failed').slice(0, 500) }).end(); } catch { /* best effort */ }
            }
        },
    );
    return result;
}

/**
 * Trace every chat completion (and audio transcription) this client makes.
 * Outside a request or job context, the call goes through untouched.
 * Returns the SDK's own promise, so `.withResponse()` and the like keep working.
 */
function instrumentClient(client, provider, currentContext) {
    const wrap = (holder, kindFor) => {
        if (!holder || typeof holder.create !== 'function' || holder.__vibedTraced) return;
        const original = holder.create;
        holder.create = function tracedCreate(body, options) {
            const ctx = currentContext();
            if (!ctx) return original.call(this, body, options);
            return traceCall(ctx, kindFor(body), provider, body, () => original.call(this, body, options));
        };
        holder.__vibedTraced = true;
    };
    const hasImage = (body) => Array.isArray(body?.messages) && body.messages.some(m => Array.isArray(m?.content) && m.content.some(p => p?.type === 'image_url'));
    wrap(client?.chat?.completions, (body) => (hasImage(body) ? 'vision' : 'chat'));
    wrap(client?.audio?.transcriptions, () => 'audio');
    return client;
}

// ── agent runs ──────────────────────────────────────────────────────────────

/** The observations a change of run state adds. Pure (exported for the test). */
function observationsForRunChange(prev, next, { now = Date.now() } = {}) {
    if (!traceIdFor(next?.id)) return [];
    const ps = prev?.state || {};
    const ns = next.state || {};
    const out = [];
    const stepKey = (st) => `step:${st.id}:${st.startedAt || 0}`;
    const prevEnded = new Set((ps.steps || []).filter(st => st.status !== 'running').map(stepKey));
    for (const st of ns.steps || []) {
        if (st.status === 'running' || prevEnded.has(stepKey(st))) continue;
        out.push({
            name: `step-${st.id}`, asType: st.id === 'verify' ? 'evaluator' : 'span',
            start: st.startedAt, end: st.endedAt || now,
            attrs: {
                output: { status: st.status, note: st.note || null, found: st.found, finished: st.finished, met: st.met },
                level: st.status === 'failed' ? 'ERROR' : (st.status === 'stopped' || st.status === 'interrupted') ? 'WARNING' : 'DEFAULT',
                ...(st.status === 'done' ? {} : { statusMessage: st.note || st.status }),
            },
        });
    }
    (ns.approvals || []).slice((ps.approvals || []).length).forEach((a) => {
        out.push({ name: `approval-${a.kind}`, asType: 'event', start: a.at || now,
            attrs: { input: a, metadata: { decision: a.decision, reason: a.reason || '' } } });
    });
    const prevDecisions = ps.decisions || {};
    for (const [shortId, d] of Object.entries(ns.decisions || {})) {
        const before = prevDecisions[shortId];
        if (before && before.decision === d.decision && before.at === d.at) continue;
        out.push({ name: `short-${d.decision}`, asType: 'event', start: d.at || now,
            attrs: { input: { shortId, ...d }, metadata: { shortId, decision: d.decision, reason: d.reason || '' } } });
    }
    const TERMINAL = ['done', 'stopped', 'failed'];
    if (TERMINAL.includes(next.status) && !(prev && TERMINAL.includes(prev.status))) {
        out.push({
            root: true, name: next.goal?.kind || 'agent-run', asType: 'agent',
            start: ns.createdAt || now, end: now,
            attrs: {
                input: { request: next.goal?.request || null, goal: next.goal, plan: ns.plan, criteria: ns.criteria || null },
                output: {
                    status: next.status,
                    stopReason: ns.stopReason || null,
                    shortsFound: (ns.shortIds || []).length,
                    shortsFinished: Object.keys(ns.finished || {}).length,
                    verification: ns.verification || null,
                    cost: next.cost || null,
                },
                level: next.status === 'failed' ? 'ERROR' : next.status === 'stopped' ? 'WARNING' : 'DEFAULT',
                ...(ns.stopReason ? { statusMessage: ns.stopReason } : {}),
                metadata: { status: next.status, criteria_met: ns.verification ? String(!!ns.verification.met) : 'not_checked' },
            },
        });
    }
    return out;
}

/** Send a run's state change to Langfuse. Never throws. */
function recordRunChange(prev, next, { userId = null } = {}) {
    if (!isEnabled()) return;
    try {
        const { tracing, ids } = state;
        const runId = next.id;
        const trace = {
            traceName: next.goal?.kind || 'agent-run',
            tags: ['agent-run', next.goal?.kind || 'agent-run'],
            ...(userId ? { userId: String(userId) } : {}),
            ...(next.projectId || next.project_id ? { sessionId: String(next.projectId || next.project_id) } : {}),
        };
        for (const o of observationsForRunChange(prev, next)) {
            tracing.propagateAttributes(trace, () => {
                if (o.root) {
                    // The root is sent last, when the run ends, with the ids every
                    // earlier step and generation already named as their parent.
                    ids.pin(traceIdFor(runId), spanIdFor(runId, 'root'));
                    try {
                        const root = tracing.startObservation(o.name, o.attrs, { asType: o.asType, startTime: new Date(o.start) });
                        root.end(new Date(o.end));
                    } finally { ids.clear(); }
                    return;
                }
                const obs = tracing.startObservation(o.name, o.attrs, { asType: o.asType, startTime: new Date(o.start), parentSpanContext: runParent(runId) });
                if (o.asType !== 'event') obs.end(new Date(o.end));
            });
        }
    } catch (err) {
        console.warn('[langfuse] run change not traced:', err.message);
    }
}

function _resetForTests() {
    usageByRun.clear();
    state = null;
}

module.exports = {
    config, environmentName, initTracing, isEnabled, flushTracing, shutdownTracing,
    maskValue, traceIdFor, spanIdFor, featureFromRequest, requestInput,
    instrumentClient, runWithTraceContext, recordRunChange, observationsForRunChange,
    usageFor, PinnableIdGenerator, _resetForTests,
};
