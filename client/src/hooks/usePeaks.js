/**
 * hooks/usePeaks.js
 *
 * READ-ONLY view onto WaveformEngine.
 *
 * This hook deliberately contains no fetch, no cache, no retry and no dedupe
 * logic. All of that lives in services/WaveformEngine.js, which is the single
 * owner of extraction — see the header comment there for why that separation
 * exists (short version: rendering a clip used to trigger a network request,
 * and that coupling is what made waveforms disappear intermittently).
 *
 * The hook's only jobs are: ask the engine for peaks, track the mounted
 * component's loading/error state, and cancel cleanly on unmount.
 *
 * Usage:
 *   const { peaks, duration, loading, error } = usePeaks(clip.assetId, asset?.gcsPath, asset?.proxyUrl);
 */

import { useState, useEffect } from 'react';
import WaveformEngine from '../services/WaveformEngine.js';

export function usePeaks(assetId, gcsPath, proxyUrl) {
    // Seed synchronously from cache so a clip that already has peaks (same
    // session, or restored from a previous one) renders them on first paint
    // instead of flashing a skeleton.
    const [state, setState] = useState(() => {
        const hit = assetId ? WaveformEngine.peek(assetId) : null;
        if (hit) return { peaks: hit.peaks, duration: hit.duration, loading: false, error: null };
        return { peaks: null, duration: null, loading: !!assetId, error: null };
    });

    useEffect(() => {
        if (!assetId) {
            setState({ peaks: null, duration: null, loading: false, error: null });
            return;
        }

        const hit = WaveformEngine.peek(assetId);
        if (hit) {
            setState({ peaks: hit.peaks, duration: hit.duration, loading: false, error: null });
            return;
        }

        let cancelled = false;
        const controller = new AbortController();

        // A proxyUrl arriving (proxy job finished) is new information — clear
        // any prior "gave up" state for this asset so the engine will try again
        // rather than staying failed for the rest of the session.
        if (proxyUrl) WaveformEngine.reset(assetId);

        setState(s => ({ ...s, loading: true, error: null }));

        WaveformEngine.getPeaks(assetId, { gcsPath, proxyUrl, signal: controller.signal })
            .then(data => {
                if (cancelled) return;
                if (data?.peaks?.length) {
                    setState({ peaks: data.peaks, duration: data.duration, loading: false, error: null });
                } else {
                    // null is the engine's "not available" answer — either it has
                    // nothing fetchable yet (no resolvable URL) or it exhausted
                    // its attempts. Neither is an exception.
                    setState({ peaks: null, duration: null, loading: false, error: 'unavailable' });
                }
            })
            .catch(err => {
                if (cancelled || err?.name === 'AbortError') return;
                setState({ peaks: null, duration: null, loading: false, error: err.message });
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    // proxyUrl is a dependency so the hook re-asks once the proxy job completes
    // and a server-resolvable URL finally exists — a clip is placed on the
    // timeline before its proxy is ready, so the first pass has nothing usable.
    }, [assetId, gcsPath, proxyUrl]);

    return state;
}

export default usePeaks;
