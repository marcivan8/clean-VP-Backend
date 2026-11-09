import { authFetch } from '../utils/authFetch.js';

// Upload and edit can request the same reference profile concurrently. Keep a
// single in-flight request per asset so upload-time analysis is reused by the
// edit rather than sampled twice.
const inFlight = new Map();

export function getReferenceStyleProfile(assetId, signal) {
    const id = String(assetId || '').trim();
    if (!id) return Promise.resolve(null);
    if (inFlight.has(id)) return inFlight.get(id);

    const request = (async () => {
        const response = await authFetch('/api/brain/analyze-style-reference', {
            method: 'POST',
            body: JSON.stringify({ assetId: id }),
            ...(signal ? { signal } : {}),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error || `Reference analysis failed (${response.status})`);
        return result?.profile || null;
    })();
    inFlight.set(id, request);
    request.finally(() => {
        if (inFlight.get(id) === request) inFlight.delete(id);
    }).catch(() => {});
    return request;
}

/** Start upload-time analysis without making chat attachment wait for vision. */
export function warmReferenceStyleProfile(assetId, { onReady, onError } = {}) {
    const request = getReferenceStyleProfile(assetId);
    request.then(profile => onReady?.(profile)).catch(error => onError?.(error));
    return request;
}

