/**
 * hooks/usePeaks.js
 *
 * Fetches pre-computed audio peaks for a given asset from the server.
 * On first call for an assetId it POSTs to /api/waveform/extract, which either
 * returns a cached peaksUrl or runs ffmpeg and stores the result in GCS.
 * The JSON is then fetched and the peaks array is returned.
 *
 * A module-level Map prevents duplicate in-flight requests across clip instances
 * that share the same asset (e.g. the same file placed on multiple tracks).
 *
 * Usage:
 *   const { peaks, duration, loading, error } = usePeaks(clip.assetId, asset?.gcsPath);
 */

import { useState, useEffect } from 'react';

/** Module-level cache: assetId → { peaks: number[], duration: number } */
const _cache = new Map();

/** In-flight promises to deduplicate concurrent requests for the same asset */
const _inflight = new Map();

export function usePeaks(assetId, gcsPath, proxyUrl) {
    const [state, setState] = useState(() => {
        if (!assetId) return { peaks: null, duration: null, loading: false, error: null };
        const hit = _cache.get(assetId);
        return hit
            ? { peaks: hit.peaks, duration: hit.duration, loading: false, error: null }
            : { peaks: null, duration: null, loading: true,  error: null };
    });

    useEffect(() => {
        if (!assetId) return;

        // Already in local cache — set state immediately and bail
        if (_cache.has(assetId)) {
            const { peaks, duration } = _cache.get(assetId);
            setState({ peaks, duration, loading: false, error: null });
            return;
        }

        // Without a proxyUrl the server has no file to read — skip this run.
        // The effect will re-fire when proxyUrl becomes available (it's in deps).
        if (!proxyUrl && !gcsPath) return;

        let cancelled = false;
        setState(s => ({ ...s, loading: true, error: null }));

        // Key inflight by assetId+proxyUrl so that a null-proxyUrl failure
        // (fired on clip mount before proxy is ready) doesn't block the valid
        // retry that fires once proxyUrl is set by the proxy job completion.
        const inflightKey = `${assetId}|${proxyUrl || ''}`;
        let promise = _inflight.get(inflightKey);

        if (!promise) {
            promise = (async () => {
                // 1. Trigger extraction (backend checks GCS cache before running ffmpeg)
                const extractRes = await fetch('/api/waveform/extract', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ assetId, gcsPath, proxyUrl }),
                });

                if (!extractRes.ok) {
                    throw new Error(`Waveform extract failed: ${extractRes.status}`);
                }

                const { peaksUrl } = await extractRes.json();

                // 2. Fetch the peaks JSON from the returned URL
                const peaksRes = await fetch(peaksUrl);
                if (!peaksRes.ok) {
                    throw new Error(`Peaks fetch failed: ${peaksRes.status}`);
                }

                const data = await peaksRes.json();
                _cache.set(assetId, data); // populate cache for future callers
                return data;
            })()
            .finally(() => _inflight.delete(inflightKey));

            _inflight.set(inflightKey, promise);
        }

        promise
            .then(({ peaks, duration }) => {
                if (!cancelled) setState({ peaks, duration, loading: false, error: null });
            })
            .catch(err => {
                if (!cancelled) setState({ peaks: null, duration: null, loading: false, error: err.message });
            });

        return () => { cancelled = true; };
    // proxyUrl is in deps so the hook retries once the proxy job completes and
    // the asset's proxyUrl is set (clip is placed before proxy is ready → first
    // call fires with proxyUrl=null → 400 → never retried without this dep).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assetId, proxyUrl]);

    return state;
}
