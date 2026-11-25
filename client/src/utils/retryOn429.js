/**
 * retryOn429.js — wait out a rate limit instead of failing.
 *
 * Several per-file requests made during an upload sit behind per-IP rate
 * limits on the server (index.js / routes/proxyRoutes.js). A large multi-file
 * import used to hit them, and a 429 was treated as a permanent failure: the
 * file never uploaded, or its transcription was marked failed with no retry.
 * A 429 only means "not right now", so wait the time the server asks for and
 * try again.
 *
 * @param {() => Promise<Response>} doFetch  called once per attempt (rebuild
 *        headers inside it so a refreshed auth token is picked up)
 * @param {{ maxRetries?: number, label?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<Response>} the first non-429 response, or the last 429
 */
export async function fetchWithRateLimitRetry(doFetch, opts = {}) {
    const { maxRetries = 8, label = 'request', signal = null } = opts;
    let attempt = 0;
    while (true) {
        const res = await doFetch();
        if (res.status !== 429 || attempt >= maxRetries) return res;
        attempt++;
        const waitMs = retryDelayMs(res, attempt);
        console.warn(`[rateLimit] ${label} rate-limited — retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${maxRetries})`);
        await wait(waitMs, signal);
    }
}

/** Retry-After (seconds or date), then RateLimit-Reset, then backoff. Capped at 60s. */
export function retryDelayMs(res, attempt = 1) {
    const header = (name) => res?.headers?.get?.(name);
    const retryAfter = header('Retry-After');
    let ms = null;
    if (retryAfter) {
        const secs = Number(retryAfter);
        if (Number.isFinite(secs)) ms = secs * 1000;
        else {
            const at = Date.parse(retryAfter);
            if (Number.isFinite(at)) ms = at - Date.now();
        }
    }
    if (ms == null) {
        const reset = Number(header('RateLimit-Reset'));
        if (Number.isFinite(reset)) ms = reset * 1000;
    }
    if (ms == null || ms <= 0) ms = Math.min(5000 * attempt, 30000);
    // Small jitter so files that were throttled together don't retry together.
    return Math.min(ms, 60000) + Math.floor(Math.random() * 1000);
}

function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('Polling cancelled')); return; }
        const onAbort = () => { clearTimeout(id); reject(new Error('Polling cancelled')); };
        const id = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
