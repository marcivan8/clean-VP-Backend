/**
 * Helpers for waiting on the async media-vision jobs before the Brain's first
 * project advisory. Jobs stay asynchronous; this only coordinates when their
 * finished summaries are read.
 */

import { authFetch } from '../utils/authFetch.js';

// Status is a cheap DB read, but several Brain triggers can wait at once.
// Five seconds still notices uploads promptly without producing a request
// burst during a slow vision job.
export const ASSET_ANALYSIS_POLL_MS = 5000;
export const INITIAL_ASSET_ANALYSIS_WAIT_MS = 30_000;
export const LATE_ASSET_ANALYSIS_WAIT_MS = 120_000;

const isVisualAsset = (asset) => {
    const type = String(asset?.type || asset?.contentType || '').toLowerCase();
    return type === 'video' || type.startsWith('video/') || type === 'image' || type.startsWith('image/');
};

/** Visual assets queued for Gemini analysis (oversized/unsupported uploads opt out). */
export function visualAnalysisAssetIds(mediaBin = []) {
    return [...new Set((Array.isArray(mediaBin) ? mediaBin : [])
        .filter(asset => asset?.id && isVisualAsset(asset) && asset.assistantReference !== true
            && asset.isReference !== true && asset.role !== 'reference' && asset.visualAnalysisRequested !== false)
        .map(asset => String(asset.id)))];
}

/** Fetch all visual-analysis states, chunking the Brain route's 200-id limit. */
export async function fetchProjectAssetAnalysisStatuses(projectId, assetIds, { timeoutMs = 5_000 } = {}) {
    const ids = [...new Set((assetIds || []).map(String).filter(Boolean))];
    const batches = [];
    for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200));
    const responses = await Promise.all(batches.map(async batch => {
        const params = new URLSearchParams({ projectId: String(projectId), assetIds: batch.join(',') });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await authFetch(`/api/brain/analysis-status?${params}`, { signal: controller.signal });
            if (!response.ok) {
                const error = new Error(`Asset analysis status failed (${response.status})`);
                const retryAfterSeconds = Number(response.headers?.get?.('Retry-After'));
                if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) error.retryAfterMs = retryAfterSeconds * 1000;
                throw error;
            }
            const data = await response.json();
            return data.statuses || [];
        } finally {
            clearTimeout(timeout);
        }
    }));
    return Object.fromEntries(responses.flat().map(item => [String(item.assetId), item.status]));
}

/**
 * Poll status until all jobs have settled or the bounded deadline expires.
 * A missing row is terminal/unknown: analyze-asset creates a `pending` row
 * before enqueueing, so a queued job is always visible to this poller.
 */
export async function waitForAssetAnalysisStatus(
    assetIds,
    getStatuses,
    {
        timeoutMs = INITIAL_ASSET_ANALYSIS_WAIT_MS,
        intervalMs = ASSET_ANALYSIS_POLL_MS,
        retryOnError = false,
        sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
        now = () => Date.now(),
    } = {},
) {
    const ids = [...new Set((assetIds || []).map(String).filter(Boolean))];
    if (ids.length === 0) return { settled: true, pendingAssetIds: [], checkFailed: false };

    const deadline = now() + Math.max(0, timeoutMs);
    let pendingAssetIds = ids;
    let nextPollMs = Math.max(250, intervalMs);

    while (true) {
        try {
            const statuses = await getStatuses(ids);
            nextPollMs = Math.max(250, intervalMs);
            pendingAssetIds = ids.filter(id => {
                const status = statuses instanceof Map ? statuses.get(id) : statuses?.[id];
                return status === 'pending' || status === 'processing';
            });
        } catch (err) {
            if (!retryOnError) return { settled: false, pendingAssetIds, checkFailed: true };
            pendingAssetIds = ids;
            const retryAfterMs = Number(err?.retryAfterMs);
            nextPollMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0
                ? Math.min(30_000, retryAfterMs)
                : Math.min(30_000, Math.max(intervalMs, nextPollMs * 2));
        }

        if (pendingAssetIds.length === 0) {
            return { settled: true, pendingAssetIds: [], checkFailed: false };
        }

        const remainingMs = deadline - now();
        if (remainingMs <= 0) {
            return { settled: false, pendingAssetIds, checkFailed: false };
        }
        await sleep(Math.min(nextPollMs, remainingMs));
    }
}
