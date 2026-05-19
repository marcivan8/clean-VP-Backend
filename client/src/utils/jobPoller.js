/**
 * jobPoller.js
 * Replaces the SSE EventSource approach with reliable interval-polling.
 *
 * Why: EventSource (SSE) is brittle behind some reverse-proxies (Railway,
 * Vercel, Cloudflare Workers) which buffer or kill long-lived streaming
 * connections. Regular GET requests with auth headers are always safe.
 */

import { authFetch } from './authFetch.js';

const DEFAULT_POLL_INTERVAL_MS = 1500;   // poll every 1.5 s
const DEFAULT_TIMEOUT_MS       = 120_000; // give up after 2 min

/**
 * Poll /api/jobs/:jobId/progress until state is 'completed' or 'failed'.
 *
 * @param {string}      jobId
 * @param {AbortSignal} [signal]   – optional cancellation token
 * @returns {Promise<any>}         – resolves with the job's returnValue
 */
export async function pollJobResult(jobId, signal = null) {
    const deadline = Date.now() + DEFAULT_TIMEOUT_MS;

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
                // Fallback: try the SSE endpoint as a one-shot GET (some servers
                // return the current state immediately as the first event).
                throw new Error(`Status endpoint returned ${res.status}`);
            }
            data = await res.json();
        } catch (fetchErr) {
            if (fetchErr.name === 'AbortError') throw new Error('Polling cancelled');
            // Network blip – wait and retry
            console.warn(`[jobPoller] Fetch failed for job ${jobId}:`, fetchErr.message);
            await sleep(DEFAULT_POLL_INTERVAL_MS, signal);
            continue;
        }

        const state = data.state || data.status;

        if (state === 'completed') {
            return data.result ?? data.returnValue ?? data;
        }

        if (state === 'failed') {
            throw new Error(data.error || data.failedReason || `Job ${jobId} failed`);
        }

        // Still running – wait before next poll
        await sleep(DEFAULT_POLL_INTERVAL_MS, signal);
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
