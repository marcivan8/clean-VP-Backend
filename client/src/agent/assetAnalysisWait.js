/**
 * Helpers for waiting on the async media-vision jobs before the Brain's first
 * project advisory. Jobs stay asynchronous; this only coordinates when their
 * finished summaries are read.
 */

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
        .filter(asset => asset?.id && isVisualAsset(asset) && asset.visualAnalysisRequested !== false)
        .map(asset => String(asset.id)))];
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
