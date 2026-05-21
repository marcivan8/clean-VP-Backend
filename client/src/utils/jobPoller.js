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
 * @param {AbortSignal} [signal]   – optional cancellation token
 * @returns {Promise<any>}         – resolves with the job's returnValue
 */
export async function pollJobResult(jobId, signal = null) {
    const deadline    = Date.now() + DEFAULT_TIMEOUT_MS;
    let   intervalMs  = MIN_POLL_INTERVAL_MS;

    while (true) {
        // Respect external abort
        if (signal?.aborted) {
            throw new Error('Polling cancelled');
        }

        if (Date.now() > deadline) {
            throw new Error(`Job ${jobId} timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
        }

        // Fetch current job state
        let data;
        try {
            const res = await authFetch(`/api/jobs/${jobId}/status`, { signal });
            if (!res.ok) {
                throw new Error(`Status endpoint returned ${res.status}`);
            }
            data = await res.json();
        } catch (fetchErr) {
            if (fetchErr.name === 'AbortError') throw new Error('Polling cancelled');
            // Network blip – wait and retry (don't back off further on errors)
            console.warn(`[jobPoller] Fetch failed for job ${jobId}:`, fetchErr.message);
            await sleep(intervalMs, signal);
            continue;
        }

        const state = data.state || data.status;

        if (state === 'completed') {
            return data.result ?? data.returnValue ?? data;
        }

        if (state === 'failed') {
            throw new Error(data.error || data.failedReason || `Job ${jobId} failed`);
        }

        // Still running – apply exponential back-off then wait
        await sleep(intervalMs, signal);
        intervalMs = Math.min(intervalMs * BACKOFF_FACTOR, MAX_POLL_INTERVAL_MS);
    }
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const id = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(id);
            reject(new Error('Polling cancelled'));
        });
    });
}

export default pollJobResult;
