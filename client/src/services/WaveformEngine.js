/**
 * services/WaveformEngine.js
 *
 * The single owner of audio-peak extraction.
 *
 * WHY THIS EXISTS
 * ---------------
 * Extraction used to live inside the `usePeaks` React hook, which meant
 * *rendering a clip* was what triggered a network request. That coupling caused
 * the recurring "the waveform vanished" class of bug in several distinct ways:
 *
 *   - A single asset re-segmented by a cleanup pass becomes N clips, so N hook
 *     instances mounted at once and raced. Dedupe was keyed on
 *     `assetId|proxyUrl`, so clips whose proxyUrl hydrated at slightly
 *     different moments each opened their own request.
 *   - The only cache was a module-level Map, discarded on every reload — so a
 *     refresh re-extracted every asset from scratch even though the server had
 *     already stored the result.
 *   - Retry logic was inlined in the hook and duplicated the whole fetch
 *     pipeline, so the two copies could (and did) drift.
 *   - Nothing bounded client-side concurrency. A multi-asset project fired
 *     every request simultaneously at a route that decodes audio through
 *     ffmpeg — see CLAUDE.md R24 for why that spikes a shared process.
 *
 * The rule this file enforces: **the editor reads, it never regenerates.**
 * Components ask for peaks; this service decides whether that means a cache
 * hit, an in-flight join, or a network call.
 *
 * Cache tiers, cheapest first:
 *   1. in-memory Map            — same session, instant
 *   2. useTimelineStore.waveformsByAsset — survives reload (persisted, R29)
 *   3. server cache             — /api/waveform/extract returns { cached: true }
 *                                 when the peaks JSON already exists in storage
 *   4. ffmpeg extraction        — the only genuinely expensive path
 */

import useTimelineStore from '../store/useTimelineStore.js';
import { authFetch } from '../utils/authFetch.js';

/** assetId → { peaks, duration } for this session. */
const _memCache = new Map();

/** assetId → Promise, so concurrent callers join rather than duplicate. */
const _inflight = new Map();

/** assetId → attempt count, so a permanently-broken asset stops retrying. */
const _attempts = new Map();

/**
 * Client-side concurrency cap.
 *
 * The server has its own gate (WAVEFORM_MAX_CONCURRENT in waveformRoutes.js),
 * but without a client cap we just queue up against it and wait — and a request
 * that sits in the server's queue too long is exactly what produced the
 * unattributable 502s (the platform edge gives up before the app responds).
 * Better to hold the requests here, where we can order them and cancel them,
 * than to open 20 sockets and hope.
 */
const MAX_CONCURRENT = 3;
let _active = 0;
const _queue = [];

/** Give up on an asset after this many failed attempts (not counting 503 backoff). */
const MAX_ATTEMPTS = 3;

function _pump() {
    while (_active < MAX_CONCURRENT && _queue.length > 0) {
        const task = _queue.shift();
        _active++;
        task().finally(() => {
            _active--;
            _pump();
        });
    }
}

function _schedule(fn) {
    return new Promise((resolve, reject) => {
        _queue.push(() => fn().then(resolve, reject));
        _pump();
    });
}

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * A URL is only useful to the server if the server can fetch it. `blob:` and
 * `data:` URLs exist only in this tab — the extract route's deriveGcsPath()
 * cannot resolve them to a storage object and answers 400 every time. Passing
 * one through burned an attempt and produced a permanently waveform-less clip.
 */
function isServerResolvable(url) {
    return !!url && !/^(blob|data):/i.test(url);
}

/** Read the reload-surviving cache written by a previous session. */
function _readPersisted(assetId) {
    try {
        const hit = useTimelineStore.getState().waveformsByAsset?.[assetId];
        if (hit?.peaks?.length) return hit;
    } catch { /* store not ready yet */ }
    return null;
}

function _writePersisted(assetId, data) {
    try {
        useTimelineStore.getState().setAssetWaveform?.(assetId, data);
    } catch { /* non-fatal — the in-memory cache still serves this session */ }
}

/**
 * Perform one extraction round-trip. Returns { peaks, duration }.
 * Throws on failure; the caller decides whether to retry.
 */
async function _fetchPeaks(assetId, gcsPath, proxyUrl, signal, force = false) {
    // authFetch, NOT bare fetch. The route runs on optionalAuth, so a missing
    // Authorization header does not fail — it silently yields `req.user ===
    // undefined`, and the route's `req.user?.id || 'anonymous'` then wrote every
    // user's peaks to a SHARED `waveforms/anonymous/` prefix. Two problems:
    // asset ids from different accounts collide in one namespace, and the path
    // diverges from the `waveforms/{userId}/{assetId}.json` contract in R41.
    // Exactly the trap TD3 warns about — a new fetch inside the client layer
    // that forgot authFetch.
    const res = await authFetch('/api/waveform/extract', {
        method: 'POST',
        body: JSON.stringify({ assetId, gcsPath, proxyUrl, force }),
        signal,
    });

    if (!res.ok) {
        const err = new Error(`Waveform extract failed: ${res.status}`);
        err.status = res.status;
        // 503 means the server's own queue is saturated and told us to come
        // back — that's backpressure, not breakage, and must not count against
        // MAX_ATTEMPTS or we'd give up on a healthy asset under load.
        err.retryAfterMs = res.status === 503
            ? (parseInt(res.headers.get('Retry-After'), 10) || 5) * 1000
            : null;
        throw err;
    }

    const {
        peaksUrl, peaks: inlinePeaks, duration: inlineDuration, hasAudio,
    } = await res.json();

    // When the server's storage upload fails it returns the peaks inline rather
    // than a URL, so the client isn't left empty-handed.
    if (!peaksUrl) {
        if (!inlinePeaks?.length) {
            // `hasAudio === false` is a DEFINITIVE answer, not a failure: the
            // source genuinely carries no audio (screen recording, muted export).
            // Treating it as an error made the engine burn all its attempts and
            // then mark the asset permanently failed, for a file that will never
            // have a waveform no matter how many times we ask.
            if (hasAudio === false) {
                return { peaks: [], duration: inlineDuration || 0, hasAudio: false };
            }
            throw new Error('No peaks data in server response');
        }
        return { peaks: inlinePeaks, duration: inlineDuration, hasAudio: true };
    }

    const peaksRes = await fetch(peaksUrl, { signal });
    if (!peaksRes.ok) throw new Error(`Peaks fetch failed: ${peaksRes.status}`);

    const data = await peaksRes.json();
    if (!data?.peaks?.length) {
        // A cached-but-empty peaks file. The server's cache check is an
        // exists() test that never inspects content, so this asset would return
        // the same empty file forever. Signal the caller to retry ONCE with
        // force=true, which bypasses the cache and re-extracts.
        const err = new Error('Peaks JSON contained no data');
        err.poisonedCache = !force;   // only worth forcing if we haven't already
        throw err;
    }
    return data;
}

export const WaveformEngine = {
    /**
     * Resolve peaks for an asset. Never throws — returns null when peaks cannot
     * be produced, so a caller can render an empty state without a try/catch.
     *
     * @param {string} assetId
     * @param {{ gcsPath?: string, proxyUrl?: string, signal?: AbortSignal }} opts
     * @returns {Promise<{peaks: number[], duration: number} | null>}
     */
    async getPeaks(assetId, { gcsPath = null, proxyUrl = null, signal = null } = {}) {
        if (!assetId) return null;

        // ── Tier 1: this session ──────────────────────────────────────────────
        if (_memCache.has(assetId)) return _memCache.get(assetId);

        // ── Tier 2: survived a reload ─────────────────────────────────────────
        const persisted = _readPersisted(assetId);
        if (persisted) {
            _memCache.set(assetId, persisted);
            return persisted;
        }

        // ── Join an in-flight request for the same asset ──────────────────────
        // Keyed on assetId ALONE. The old key included proxyUrl, so the same
        // asset resolving its proxy at slightly different times across clips
        // opened duplicate extractions of an identical file.
        if (_inflight.has(assetId)) return _inflight.get(assetId);

        // Nothing the server can read → don't spend an attempt. The caller will
        // ask again when the proxy job resolves and a real URL exists.
        const usableUrl = isServerResolvable(proxyUrl) ? proxyUrl : null;
        if (!usableUrl && !gcsPath) return null;

        if ((_attempts.get(assetId) ?? 0) >= MAX_ATTEMPTS) return null;

        const promise = _schedule(async () => {
            let lastErr = null;
            // Set once we've asked the server to bypass its cache, so a
            // genuinely-empty source can't put us in a force loop.
            let forceNext = false;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    const data = await _fetchPeaks(assetId, gcsPath, usableUrl, signal, forceNext);

                    // A source with no audio is a valid, final result. Cache it in
                    // memory so we stop asking, but do NOT persist it — if the
                    // asset later resolves to a different (real) file, a stored
                    // empty result would outlive the reason for it.
                    if (data.hasAudio === false) {
                        _memCache.set(assetId, data);
                        _attempts.delete(assetId);
                        return data;
                    }

                    _memCache.set(assetId, data);
                    _writePersisted(assetId, data);
                    _attempts.delete(assetId);
                    return data;
                } catch (err) {
                    if (err?.name === 'AbortError') throw err;
                    lastErr = err;

                    // Server backpressure: wait it out without consuming an attempt.
                    if (err.retryAfterMs) {
                        await _sleep(err.retryAfterMs);
                        attempt--; // this round doesn't count
                        continue;
                    }

                    // The server handed us a cached-but-empty peaks file. Retrying
                    // identically would hit the same cache entry, so re-ask with
                    // force=true to make it re-extract. Costs one attempt, and
                    // only ever happens once per asset per session.
                    if (err.poisonedCache && !forceNext) {
                        console.warn(`[WaveformEngine] empty cached peaks for ${assetId} — forcing re-extraction`);
                        forceNext = true;
                        attempt--; // recovery attempt shouldn't count against the budget
                        continue;
                    }

                    // A 4xx means the request itself is wrong (bad path, missing
                    // asset). Retrying identical input cannot fix it.
                    if (err.status && err.status >= 400 && err.status < 500) break;

                    if (attempt < MAX_ATTEMPTS) await _sleep(500 * attempt); // 500ms → 1s
                }
            }

            _attempts.set(assetId, (_attempts.get(assetId) ?? 0) + MAX_ATTEMPTS);
            console.warn(`[WaveformEngine] gave up on asset ${assetId}:`, lastErr?.message);
            return null;
        }).finally(() => _inflight.delete(assetId));

        _inflight.set(assetId, promise);
        return promise;
    },

    /** Synchronous cache peek — for render paths that must not await. */
    peek(assetId) {
        if (!assetId) return null;
        return _memCache.get(assetId) || _readPersisted(assetId);
    },

    /**
     * Clear the "gave up" state for an asset so the next request tries again.
     * Call this when something changed that could plausibly fix it — e.g. the
     * proxy job finally completed and the asset now has a real URL.
     */
    reset(assetId) {
        if (assetId) _attempts.delete(assetId);
        else _attempts.clear();
    },

    /** Test/debug visibility. */
    _stats() {
        return { cached: _memCache.size, inflight: _inflight.size, active: _active, queued: _queue.length };
    },
};

export default WaveformEngine;
