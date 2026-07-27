/**
 * revideoPoller.js
 *
 * Polls the Revideo/Lambda render pipeline (routes/revideoRenderRoutes.js)
 * to completion. This is a SEPARATE poller from jobPoller.js because the two
 * pipelines have different contracts:
 *
 *   - jobPoller.js hits    GET /api/jobs/:jobId/status
 *                          → { state: 'completed'|'failed'|..., result / returnValue }
 *                          (BullMQ job shape, used by the FFmpeg export path)
 *
 *   - revideoPoller.js hits GET /api/revideo/status/:jobId
 *                          → { status: 'rendering'|'success'|'error', url, renderId, error }
 *                          (in-memory job map set by the Lambda webhook, see
 *                          routes/revideoRenderRoutes.js's renderJobs Map)
 *
 * Reusing jobPoller.js here would silently misread `status` as `state` and
 * never terminate correctly — keep these separate rather than overloading
 * one poller for two different field names.
 */

import { authFetch } from './authFetch.js';

const MIN_POLL_INTERVAL_MS = 2000;   // Lambda cold starts + Chromium boot are slow
const MAX_POLL_INTERVAL_MS = 6000;
const BACKOFF_FACTOR       = 1.3;
const DEFAULT_TIMEOUT_MS   = 300_000; // 5 minutes — matches jobPoller.js's export budget

/**
 * Poll /api/revideo/status/:jobId until status is 'success' or 'error'.
 *
 * @param {string}      jobId
 * @param {AbortSignal} [signal]
 * @returns {Promise<{url: string, renderId: string}>}
 */
export async function pollRevideoResult(jobId, signal = null) {
    const deadline   = Date.now() + DEFAULT_TIMEOUT_MS;
    let   intervalMs = MIN_POLL_INTERVAL_MS;

    while (true) {
        if (signal?.aborted) {
            throw new Error('Polling cancelled');
        }

        if (Date.now() > deadline) {
            throw new Error(`Render ${jobId} timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
        }

        let data;
        try {
            const res = await authFetch(`/api/revideo/status/${jobId}`, { signal });
            if (!res.ok) {
                throw new Error(`Status endpoint returned ${res.status}`);
            }
            data = await res.json();
        } catch (fetchErr) {
            if (fetchErr.name === 'AbortError') throw new Error('Polling cancelled');
            console.warn(`[revideoPoller] Fetch failed for job ${jobId}:`, fetchErr.message);
            await sleep(intervalMs, signal);
            continue;
        }

        if (data.status === 'success') {
            if (!data.url) throw new Error('Render succeeded but no URL was returned');
            return { url: data.url, renderId: data.renderId };
        }

        if (data.status === 'error') {
            throw new Error(data.error || `Render ${jobId} failed`);
        }

        // Still rendering
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

export default pollRevideoResult;
