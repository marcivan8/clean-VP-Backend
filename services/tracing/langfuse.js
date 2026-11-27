// services/tracing/langfuse.js
// Traces agent runs in Langfuse (R176b): one trace per run, a span per step,
// an event per approval or kept/dropped decision, and a generation for every
// AI call made while a run step is in progress.
//
// Sent as OpenTelemetry (OTLP/HTTP JSON) to /api/public/otel/v1/traces:
// Langfuse retired its older /api/public/ingestion endpoint for traces on
// 2026-11-16. Basic auth with the public key as user and the secret key as
// password; `x-langfuse-ingestion-version: 4` avoids a delay of up to
// 10 minutes before traces show up.
//
// OFF unless LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are both set (and
// LANGFUSE_TRACING is not 'off'). Never throws and never blocks a request:
// spans are queued and sent in the background; a failed send is logged and
// dropped. LANGFUSE_BASE_URL defaults to the EU cloud.
//
// What leaves the app: run goals and plans, step notes, approval reasons,
// and for AI calls a TRUNCATED copy of the prompt and answer (transcript
// excerpts included). Langfuse is listed as a processor in the privacy pages.

'use strict';

const crypto = require('crypto');

const MAX_QUEUE = 500;
const FLUSH_AT = 50;
const FLUSH_MS = 2000;
const MAX_FIELD = 8000;

let queue = [];
let timer = null;
let sending = null;

function config(env = process.env) {
    const publicKey = env.LANGFUSE_PUBLIC_KEY || '';
    const secretKey = env.LANGFUSE_SECRET_KEY || '';
    const enabled = !!(publicKey && secretKey) && String(env.LANGFUSE_TRACING || '').toLowerCase() !== 'off';
    const base = String(env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com').replace(/\/+$/, '');
    return { enabled, publicKey, secretKey, endpoint: `${base}/api/public/otel/v1/traces` };
}

function isEnabled() { return config().enabled; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** OTLP trace id (32 hex) for a run: the run's own UUID without dashes. */
function traceIdFor(runId) {
    return UUID.test(String(runId)) ? String(runId).replace(/-/g, '').toLowerCase() : null;
}

/** Stable 16-hex span id, so a span can be named before it is sent. */
function spanIdFor(runId, key) {
    return crypto.createHash('sha256').update(`${runId}:${key}`).digest('hex').slice(0, 16);
}

function clip(value) {
    if (value === undefined || value === null) return null;
    let s;
    try { s = typeof value === 'string' ? value : JSON.stringify(value); } catch { s = String(value); }
    return s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD)}…[truncated]` : s;
}

function attr(key, value) {
    if (value === undefined || value === null || value === '') return null;
    if (Array.isArray(value)) return { key, value: { arrayValue: { values: value.map(v => ({ stringValue: String(v) })) } } };
    if (typeof value === 'boolean') return { key, value: { boolValue: value } };
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number.isInteger(value) ? { key, value: { intValue: String(value) } } : { key, value: { doubleValue: value } };
    }
    return { key, value: { stringValue: String(value) } };
}

function nanos(ms) {
    const n = Number(ms);
    return String(BigInt(Math.max(0, Math.round(Number.isFinite(n) ? n : Date.now()))) * 1000000n);
}

/** Trace-level attributes; Langfuse asks for them on every span. */
function traceAttrs(trace) {
    return [
        attr('langfuse.trace.name', trace.name),
        attr('langfuse.user.id', trace.userId),
        attr('langfuse.session.id', trace.sessionId),
        attr('langfuse.trace.tags', trace.tags),
        attr('langfuse.environment', process.env.NODE_ENV || 'development'),
    ];
}

/**
 * Build one OTLP span. Pure (exported for the regression test).
 * @param {object} s { runId, key, parentKey, name, type, start, end, input, output, level, statusMessage, metadata, model, usage, trace }
 */
function buildSpan(s) {
    const traceId = traceIdFor(s.runId);
    if (!traceId) return null;
    const attributes = [
        ...traceAttrs(s.trace || {}),
        attr('langfuse.observation.type', s.type || 'span'),
        attr('langfuse.observation.input', clip(s.input)),
        attr('langfuse.observation.output', clip(s.output)),
        attr('langfuse.observation.level', s.level),
        attr('langfuse.observation.status_message', s.statusMessage ? String(s.statusMessage).slice(0, 500) : null),
        attr('langfuse.observation.model.name', s.model),
        s.usage ? attr('gen_ai.usage.input_tokens', s.usage.input) : null,
        s.usage ? attr('gen_ai.usage.output_tokens', s.usage.output) : null,
        s.usage ? attr('langfuse.observation.usage_details', JSON.stringify({ input: s.usage.input || 0, output: s.usage.output || 0, total: (s.usage.input || 0) + (s.usage.output || 0) })) : null,
        ...Object.entries(s.metadata || {}).map(([k, v]) => attr(`langfuse.observation.metadata.${k}`, typeof v === 'object' ? clip(v) : v)),
        s.traceOutput !== undefined ? attr('langfuse.trace.output', clip(s.traceOutput)) : null,
        s.traceInput !== undefined ? attr('langfuse.trace.input', clip(s.traceInput)) : null,
    ].filter(Boolean);
    const start = s.start ?? Date.now();
    const end = s.end ?? start;
    return {
        traceId,
        spanId: spanIdFor(s.runId, s.key),
        ...(s.parentKey ? { parentSpanId: spanIdFor(s.runId, s.parentKey) } : {}),
        name: String(s.name || s.key).slice(0, 120),
        kind: 1,
        startTimeUnixNano: nanos(start),
        endTimeUnixNano: nanos(Math.max(Number(end) || 0, Number(start) || 0)),
        attributes,
        status: s.level === 'ERROR' ? { code: 2, message: String(s.statusMessage || '').slice(0, 300) } : { code: 1 },
    };
}

/** Wrap spans in an OTLP export request. Pure. */
function exportBody(spans) {
    return {
        resourceSpans: [{
            resource: { attributes: [attr('service.name', 'vibed-backend')] },
            scopeSpans: [{ scope: { name: 'vibed.agent-runs', version: '1' }, spans }],
        }],
    };
}

function enqueue(span) {
    if (!span || !isEnabled()) return;
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push(span);
    if (queue.length >= FLUSH_AT) { flush(); return; }
    if (!timer) {
        timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
        if (typeof timer.unref === 'function') timer.unref();
    }
}

async function flush(fetchImpl = globalThis.fetch) {
    if (sending) return sending;
    const cfg = config();
    if (!cfg.enabled || queue.length === 0 || typeof fetchImpl !== 'function') return null;
    const batch = queue.splice(0, queue.length);
    const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString('base64');
    sending = (async () => {
        try {
            const res = await fetchImpl(cfg.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Basic ${auth}`,
                    'x-langfuse-ingestion-version': '4',
                },
                body: JSON.stringify(exportBody(batch)),
            });
            if (!res.ok) console.warn(`[langfuse] ${batch.length} span(s) refused: HTTP ${res.status}`);
            return res.status;
        } catch (err) {
            console.warn(`[langfuse] could not send ${batch.length} span(s):`, err.message);
            return null;
        } finally {
            sending = null;
        }
    })();
    return sending;
}

// ── Runs ─────────────────────────────────────────────────────────────────────

function traceOf(run, userId) {
    const kind = run?.goal?.kind || 'agent_run';
    return { name: kind, userId: userId || null, sessionId: run?.projectId || run?.project_id || null, tags: ['agent-run', kind] };
}

/**
 * Turn a state change of a run into spans: finished steps, new approvals,
 * new kept/dropped decisions, and the run itself once it ends.
 * Pure (returns the spans); `recordRunChange` sends them.
 * @param {object|null} prev previous run (null for a new run)
 * @param {object} next current run: { id, projectId, goal, status, state, cost }
 */
function spansForRunChange(prev, next, { userId = null, now = Date.now() } = {}) {
    const runId = next?.id;
    if (!traceIdFor(runId)) return [];
    const trace = traceOf(next, userId);
    const spans = [];
    const ps = prev?.state || {};
    const ns = next.state || {};
    const stepKey = (st) => `step:${st.id}:${st.startedAt || 0}`;

    const prevEnded = new Set((ps.steps || []).filter(st => st.status !== 'running').map(stepKey));
    for (const st of ns.steps || []) {
        if (st.status === 'running' || prevEnded.has(stepKey(st))) continue;
        spans.push(buildSpan({
            runId, key: stepKey(st), parentKey: 'root', name: `step: ${st.id}`, type: 'span', trace,
            start: st.startedAt, end: st.endedAt || now,
            output: { status: st.status, note: st.note || null, found: st.found, finished: st.finished },
            level: st.status === 'failed' ? 'ERROR' : (st.status === 'stopped' || st.status === 'interrupted') ? 'WARNING' : 'DEFAULT',
            statusMessage: st.status === 'done' ? null : st.note,
        }));
    }

    const prevApprovals = (ps.approvals || []).length;
    (ns.approvals || []).slice(prevApprovals).forEach((a, i) => {
        spans.push(buildSpan({
            runId, key: `approval:${prevApprovals + i}`, parentKey: 'root', name: `approval: ${a.kind} ${a.decision}`, type: 'event', trace,
            start: a.at || now, end: a.at || now, input: a,
            metadata: { kind: a.kind, decision: a.decision, reason: a.reason || '' },
        }));
    });

    const prevDecisions = ps.decisions || {};
    for (const [shortId, d] of Object.entries(ns.decisions || {})) {
        const before = prevDecisions[shortId];
        if (before && before.decision === d.decision && before.at === d.at) continue;
        spans.push(buildSpan({
            runId, key: `decision:${shortId}:${d.at || 0}`, parentKey: 'root', name: `short ${d.decision}`, type: 'event', trace,
            start: d.at || now, end: d.at || now, input: { shortId, ...d },
            metadata: { shortId, decision: d.decision, reason: d.reason || '' },
        }));
    }

    const TERMINAL = ['done', 'stopped', 'failed'];
    if (TERMINAL.includes(next.status) && !(prev && TERMINAL.includes(prev.status))) {
        const output = {
            status: next.status,
            stopReason: ns.stopReason || null,
            shortsFound: (ns.shortIds || []).length,
            shortsFinished: Object.keys(ns.finished || {}).length,
            verification: ns.verification || null,
            cost: next.cost || null,
        };
        spans.push(buildSpan({
            runId, key: 'root', name: next.goal?.label || trace.name, type: 'agent', trace,
            start: ns.createdAt || now, end: now,
            input: { goal: next.goal, plan: ns.plan, criteria: ns.criteria || null }, output,
            traceInput: { request: next.goal?.request || null, goal: next.goal, plan: ns.plan, criteria: ns.criteria || null }, traceOutput: output,
            level: next.status === 'failed' ? 'ERROR' : next.status === 'stopped' ? 'WARNING' : 'DEFAULT',
            statusMessage: ns.stopReason || null,
            metadata: { status: next.status, criteria_met: ns.verification ? String(!!ns.verification.met) : 'not_checked' },
        }));
    }
    return spans.filter(Boolean);
}

function recordRunChange(prev, next, opts = {}) {
    if (!isEnabled()) return;
    try {
        for (const span of spansForRunChange(prev, next, opts)) enqueue(span);
    } catch (err) {
        console.warn('[langfuse] run change not traced:', err.message);
    }
}

// ── AI calls made inside a run step ──────────────────────────────────────────

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

/** What this server has counted for a run so far ({} when nothing). */
function usageFor(runId) {
    const u = usageByRun.get(runId);
    if (!u) return null;
    return { aiCalls: u.aiCalls, inputTokens: u.inputTokens, outputTokens: u.outputTokens, failedCalls: u.failedCalls };
}

function recordGeneration(ctx, g) {
    if (!ctx?.runId) return;
    const usage = { input: Number(g.usage?.prompt_tokens ?? g.usage?.input_tokens) || 0, output: Number(g.usage?.completion_tokens ?? g.usage?.output_tokens) || 0 };
    addUsage(ctx.runId, { ...usage, error: !!g.error });
    if (!isEnabled()) return;
    enqueue(buildSpan({
        runId: ctx.runId,
        key: `gen:${crypto.randomUUID()}`,
        parentKey: 'root',
        name: `ai: ${g.provider || 'model'}`,
        type: 'generation',
        trace: { tags: ['agent-run'] },
        start: g.start, end: g.end,
        model: g.model,
        input: g.messages,
        output: g.output,
        usage,
        level: g.error ? 'ERROR' : 'DEFAULT',
        statusMessage: g.error || null,
        metadata: { step: ctx.stepId || '', provider: g.provider || '' },
    }));
}

/**
 * Record every chat completion this client makes while a run step is in
 * progress. Returns the SDK's own promise untouched (so .withResponse() and
 * the like keep working); outside a run it adds nothing but a lookup.
 */
function instrumentClient(client, provider, currentContext) {
    const completions = client?.chat?.completions;
    if (!completions || typeof completions.create !== 'function' || completions.__vibedTraced) return client;
    const original = completions.create;
    completions.create = function tracedCreate(body, options) {
        const ctx = currentContext();
        const result = original.call(this, body, options);
        if (!ctx || !result || typeof result.then !== 'function') return result;
        const start = Date.now();
        const base = { provider, model: body?.model, start, messages: body?.messages };
        if (body?.stream) {
            recordGeneration(ctx, { ...base, end: Date.now(), output: '[streamed]' });
            return result;
        }
        result.then(
            (res) => recordGeneration(ctx, { ...base, end: Date.now(), output: res?.choices?.[0]?.message?.content ?? null, usage: res?.usage }),
            (err) => recordGeneration(ctx, { ...base, end: Date.now(), error: err?.message || 'AI call failed' }),
        );
        return result;
    };
    completions.__vibedTraced = true;
    return client;
}

function _resetForTests() {
    queue = [];
    if (timer) clearTimeout(timer);
    timer = null;
    sending = null;
    usageByRun.clear();
}

module.exports = {
    config, isEnabled, traceIdFor, spanIdFor, buildSpan, exportBody,
    spansForRunChange, recordRunChange, recordGeneration, instrumentClient,
    usageFor, flush, _resetForTests, _queue: () => queue,
};
