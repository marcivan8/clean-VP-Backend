/**
 * jobPoller.js
 * Replaces the SSE EventSource approach with reliable interval-polling.
 *
 * Why: EventSource (SSE) is brittle behind some reverse-proxies (Railway,
 * Vercel, Cloudflare Workers) which buffer or kill long-lived streaming
 * connections. Regular GET requests with auth headers are always safe.
 */

import { authFetch } from './authFetch.js';

const MIN_POLL_INTERVAL_MS  = 1500;   // start polling every 1.5s
const MAX_POLL_INTERVAL_MS  = 5000;   // back off to every 5s for long jobs
const BACKOFF_FACTOR        = 1.3;    // multiply interval by this after each poll
const DEFAULT_TIMEOUT_MS    = 300_000; // give up after 5 minutes
                                       // (Whisper on a 30-min video can take 3+ min)

/**
 * Poll /api/jobs/:jobId/status until state is 'completed' or 'failed'.
 *
 * Uses exponential back-off: starts at 1.5 s and climbs to 5 s so we
 * don't hammer the API for long-running jobs (transcription, silence detect).
 *
 * @param {string}      jobId
 * @param {AbortSignal} [signal]     – optional cancellation token
 * @param {number}      [timeoutMs] – override the default 300s budget. Callers whose
 *   job type can legitimately queue behind others (e.g. proxy generation during a
 *   multi-file upload, now competing with the parallel asset-analysis pass — see
 *   CLAUDE.md R24) should pass a larger value instead of the default.
 * @returns {Promise<any>}         – resolves with the job's returnValue
 */
// onProgress (optional): called with the job's reported progress (0-100)
// while it runs. Existing callers pass three arguments and are unaffected.
//
// options.countQueueTime (default true = the old behaviour): when false, time
// the job spends WAITING in its BullMQ queue does not consume `timeoutMs` —
// only time it is actually being worked on does. The worker queues run one job
// at a time (R24), so in a 25-file upload the 20th transcription can sit in
// line for an hour; counting that wait as "the job took too long" made every
// late file time out while it was still queued, and callers then fell back to
// queuing a SECOND job for the same file, doubling the backlog. Queue waiting
// is still bounded by options.maxQueueWaitMs (default 3h) so a dead worker
// (R48 `no_consumer`) cannot make a caller poll forever.
//
// A timeout error carries `code: 'POLL_TIMEOUT'` so callers can tell "we gave
// up waiting" (the job may still finish) from "the job failed".
export const QUEUED_STATES = new Set(['waiting', 'delayed', 'prioritized', 'waiting-children', 'paused']);

export async function pollJobResult(jobId, signal = null, timeoutMs = DEFAULT_TIMEOUT_MS, onProgress = null, options = {}) {
    const countQueueTime = options.countQueueTime !== false;
    const maxQueueWaitMs = Number.isFinite(options.maxQueueWaitMs) ? options.maxQueueWaitMs : 3 * 60 * 60 * 1000;
    const startedAt   = Date.now();
    let   deadline    = startedAt + timeoutMs;
    let   lastCheck   = startedAt;
    let   queuedMs    = 0;
    let   lastQueued  = false;
    let   intervalMs  = MIN_POLL_INTERVAL_MS;

    // Queue-aware budget: time since the previous check is credited back to
    // the deadline while the job is known to be waiting in line. Credited both
    // before the deadline check (the job was queued at the last look, so the
    // gap since then is queue time) and after each status read.
    const creditQueueTime = () => {
        const now = Date.now();
        if (!countQueueTime && queuedMs < maxQueueWaitMs) {
            const waited = Math.min(now - lastCheck, maxQueueWaitMs - queuedMs);
            queuedMs += waited;
            deadline += waited;
        }
        lastCheck = now;
    };

    while (true) {
        // Respect external abort
        if (signal?.aborted) {
            throw new Error('Polling cancelled');
        }

        if (lastQueued) creditQueueTime();
        if (Date.now() > deadline) {
            const err = new Error(`Job ${jobId} timed out after ${Math.round((Date.now() - startedAt) / 1000)}s`);
            err.code = 'POLL_TIMEOUT';
            err.jobId = jobId;
            throw err;
        }

        // Fetch current job state (shared batch — see nextJobStatus below)
        let data;
        try {
            data = await nextJobStatus(jobId, signal);
        } catch (fetchErr) {
            if (fetchErr.name === 'AbortError' || fetchErr.message === 'Polling cancelled') throw new Error('Polling cancelled');
            // Network blip – wait and retry (don't back off further on errors)
            console.warn(`[jobPoller] Fetch failed for job ${jobId}:`, fetchErr.message);
            await sleep(intervalMs, signal);
            continue;
        }

        const state = data.state || data.status;

        lastQueued = QUEUED_STATES.has(state);
        if (lastQueued) creditQueueTime();
        else lastCheck = Date.now();

        if (state === 'completed') {
            return data.result ?? data.returnValue ?? data;
        }

        if (state === 'failed') {
            throw new Error(data.error || data.failedReason || `Job ${jobId} failed`);
        }

        if (typeof onProgress === 'function' && Number.isFinite(Number(data.progress))) {
            try { onProgress(Number(data.progress)); } catch { /* UI callback must never break polling */ }
        }

        // Still running – apply exponential back-off then wait
        await sleep(intervalMs, signal);
        intervalMs = Math.min(intervalMs * BACKOFF_FACTOR, MAX_POLL_INTERVAL_MS);
    }
}

// ─── Shared status batching ─────────────────────────────────────────────────
// Every pollJobResult loop asks for its job's status through this one queue.
// Requests are gathered and sent as ONE POST /api/jobs/status-batch at most
// every BATCH_TICK_MS, however many jobs are pending. Before this, each loop
// made its own request: a 25-file upload ran ~50 loops, blew through the
// server's 120 req/min per-IP limit, and from then on every request from that
// browser (saves, waveforms, the assistant) got 429 — the editor froze.
const BATCH_TICK_MS  = 2000;   // => at most 30 status requests per minute
const BATCH_MAX_IDS  = 100;    // matches routes/jobRoutes.js
const statusWaiters  = new Map();  // jobId -> Set<{ resolve, reject }>
let   batchTimer     = null;
let   lastFlushAt    = 0;
let   batchUnsupported = false; // older backend without the batch route

function scheduleFlush() {
    if (batchTimer || statusWaiters.size === 0) return;
    const wait = Math.max(0, lastFlushAt + BATCH_TICK_MS - Date.now());
    batchTimer = setTimeout(flushStatuses, wait);
}

async function fetchSingle(id) {
    const res = await authFetch(`/api/jobs/${id}/status`);
    if (res.status === 404) return { state: 'not_found' };
    if (!res.ok) throw new Error(`Status endpoint returned ${res.status}`);
    return res.json();
}

async function fetchStatuses(ids) {
    if (batchUnsupported) {
        const out = {};
        await Promise.all(ids.map(async id => { out[id] = await fetchSingle(id); }));
        return out;
    }
    const out = {};
    for (let i = 0; i < ids.length; i += BATCH_MAX_IDS) {
        const chunk = ids.slice(i, i + BATCH_MAX_IDS);
        const res = await authFetch('/api/jobs/status-batch', {
            method: 'POST',
            body: JSON.stringify({ ids: chunk }),
        });
        if (res.status === 404 || res.status === 405) {
            console.warn('[jobPoller] Batch status route not available — polling jobs one by one');
            batchUnsupported = true;
            return fetchStatuses(ids);
        }
        if (!res.ok) throw new Error(`Status batch endpoint returned ${res.status}`);
        const body = await res.json();
        Object.assign(out, body?.jobs || {});
    }
    return out;
}

async function flushStatuses() {
    batchTimer = null;
    lastFlushAt = Date.now();
    const batch = new Map(statusWaiters);
    statusWaiters.clear();
    const ids = [...batch.keys()];
    try {
        const results = await fetchStatuses(ids);
        for (const [id, waiters] of batch) {
            const data = results[id] ?? { state: 'not_found' };
            waiters.forEach(w => w.resolve(data));
        }
    } catch (err) {
        for (const waiters of batch.values()) waiters.forEach(w => w.reject(err));
    } finally {
        scheduleFlush(); // waiters that arrived during the request
    }
}

/** Resolve with the job's status at the next shared tick. */
function nextJobStatus(jobId, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('Polling cancelled')); return; }
        const id = String(jobId);
        let set = statusWaiters.get(id);
        if (!set) { set = new Set(); statusWaiters.set(id, set); }
        const onAbort = () => {
            const current = statusWaiters.get(id);
            if (current) {
                current.delete(waiter);
                if (current.size === 0) statusWaiters.delete(id);
            }
            reject(new Error('Polling cancelled'));
        };
        const waiter = {
            resolve: (v) => { signal?.removeEventListener('abort', onAbort); resolve(v); },
            reject:  (e) => { signal?.removeEventListener('abort', onAbort); reject(e); },
        };
        set.add(waiter);
        signal?.addEventListener('abort', onAbort, { once: true });
        scheduleFlush();
    });
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        // The abort listener is removed when the timer fires: a long poll
        // calls sleep() hundreds of times on the same signal, and leaving
        // every listener attached piled them up for the life of the signal.
        const onAbort = () => {
            clearTimeout(id);
            reject(new Error('Polling cancelled'));
        };
        const id = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export default pollJobResult;
