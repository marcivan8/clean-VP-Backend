/**
 * queue/workerConcurrency.js — how many jobs each worker runs at once (R98).
 *
 * The values used to be hard-coded in worker.js. They are deliberately small
 * (R24: two proxy encodes plus two analyses OOM'd a small instance and took
 * the whole process down), but that also meant a bigger machine could never
 * use its extra memory without a code change. Each one can now be raised per
 * deployment with an env var, and the DEFAULTS below are exactly the old
 * hard-coded values, so a deployment that sets nothing behaves as before.
 *
 *   WORKER_CONCURRENCY_VIDEO                proxy encode (CPU + memory heavy)
 *   WORKER_CONCURRENCY_AUDIO                transcription, diarize, silence, filler…
 *   WORKER_CONCURRENCY_ANALYSIS             virality analysis
 *   WORKER_CONCURRENCY_EXPORT               final render (CPU + disk heavy)
 *   WORKER_CONCURRENCY_ASSET_ANALYSIS       per-clip vision/audio analysis
 *   WORKER_CONCURRENCY_EMBEDDING            pgvector embeddings (I/O)
 *   WORKER_CONCURRENCY_OBJECT_SEGMENTATION  SAM2 via Replicate (I/O)
 *
 * WHAT TO RAISE FIRST: the I/O-bound ones (AUDIO, ASSET_ANALYSIS) spend most
 * of their time waiting on OpenAI, so they gain the most from a second slot.
 * VIDEO and EXPORT already use every CPU core for ONE job (`-threads 0`), so
 * raising them on the same machine mostly adds memory pressure, not speed —
 * for those, add worker REPLICAS on more machines instead.
 *
 * Memory is additive: every slot can hold a job's working set at the same
 * time, and when the worker runs INLINE (index.js, local storage or
 * WORKER_INLINE=true) that is on top of the API server's own memory.
 */

const DEFAULT_CONCURRENCY = Object.freeze({
    video:              1,
    audio:              1,
    analysis:           2,
    export:             1,
    assetAnalysis:      1,
    embedding:          3,
    objectSegmentation: 2,
});

const ENV_NAMES = Object.freeze({
    video:              'WORKER_CONCURRENCY_VIDEO',
    audio:              'WORKER_CONCURRENCY_AUDIO',
    analysis:           'WORKER_CONCURRENCY_ANALYSIS',
    export:             'WORKER_CONCURRENCY_EXPORT',
    assetAnalysis:      'WORKER_CONCURRENCY_ASSET_ANALYSIS',
    embedding:          'WORKER_CONCURRENCY_EMBEDDING',
    objectSegmentation: 'WORKER_CONCURRENCY_OBJECT_SEGMENTATION',
});

// A typo like "40" instead of "4" must not start forty 4K encodes in one
// process; values above this are clamped, with a warning.
const MAX_CONCURRENCY = 16;

/**
 * Resolve one worker's concurrency from the environment. Invalid values
 * (non-integer, below 1) fall back to the default with a warning instead of
 * throwing: a bad env var must never stop the worker from starting.
 */
function concurrencyFor(key, env = process.env, log = console) {
    const fallback = DEFAULT_CONCURRENCY[key];
    if (fallback === undefined) throw new Error(`Unknown worker "${key}"`);
    const name = ENV_NAMES[key];
    const raw = env[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;

    const n = Number(String(raw).trim());
    if (!Number.isInteger(n) || n < 1) {
        log.warn?.(`[worker] ${name}="${raw}" is not a whole number ≥ 1 — using the default ${fallback}`);
        return fallback;
    }
    if (n > MAX_CONCURRENCY) {
        log.warn?.(`[worker] ${name}=${n} is above the ${MAX_CONCURRENCY} limit — using ${MAX_CONCURRENCY}`);
        return MAX_CONCURRENCY;
    }
    return n;
}

/** Every worker's resolved concurrency, e.g. for logs and the heartbeat. */
function resolveAllConcurrency(env = process.env, log = console) {
    const out = {};
    for (const key of Object.keys(DEFAULT_CONCURRENCY)) out[key] = concurrencyFor(key, env, log);
    return out;
}

module.exports = { DEFAULT_CONCURRENCY, ENV_NAMES, MAX_CONCURRENCY, concurrencyFor, resolveAllConcurrency };
