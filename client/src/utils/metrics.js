/**
 * metrics.js
 *
 * Thin, fail-safe wrapper around Sentry's metrics API
 * (Sentry.metrics.count / distribution, @sentry/react >= 10.25.0).
 * Sentry itself is initialised once in main.jsx; this module never calls init.
 *
 * Rules, same spirit as utils/trackEvent.js:
 *  - never throws: a metrics failure must never break an export or an edit;
 *  - silently no-ops when the new API isn't present (e.g. a stale local
 *    node_modules still on @sentry/react 8.x, where `metrics.count` doesn't
 *    exist and the old beta metrics are dead);
 *  - attribute values are kept low-cardinality (enums/buckets, never ids,
 *    prompts or free text) so dashboards stay groupable.
 *
 * Usage:
 *   countMetric('export.started', { resolution: '1080p' });
 *   distributionMetric('export.duration', 353600, 'millisecond', { outcome: 'success' });
 */

import * as Sentry from '@sentry/react';

const api = () => {
    const m = Sentry?.metrics;
    return m && typeof m.count === 'function' && typeof m.distribution === 'function' ? m : null;
};

const clean = (attributes) => {
    const out = {};
    for (const [k, v] of Object.entries(attributes || {})) {
        if (v === undefined || v === null) continue;
        out[k] = typeof v === 'number' || typeof v === 'boolean' ? v : String(v).slice(0, 64);
    }
    return out;
};

export function countMetric(name, attributes = {}, value = 1) {
    try {
        api()?.count(name, value, { attributes: clean(attributes) });
    } catch (err) {
        console.warn('[metrics] count failed:', name, err?.message);
    }
}

export function distributionMetric(name, value, unit, attributes = {}) {
    try {
        if (!Number.isFinite(value)) return;
        api()?.distribution(name, value, { unit, attributes: clean(attributes) });
    } catch (err) {
        console.warn('[metrics] distribution failed:', name, err?.message);
    }
}

/** Monotonic ms clock for durations. */
export const nowMs = () =>
    (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();

/** Low-cardinality bucket for a timeline length in seconds. */
export function timelineBucket(seconds) {
    const s = Number(seconds) || 0;
    if (s < 60) return '<1m';
    if (s < 180) return '1-3m';
    if (s < 600) return '3-10m';
    if (s < 1800) return '10-30m';
    return '30m+';
}

/** Timeline length (s) from legacy tracks: the latest clip end on any track. */
export function timelineSecondsFromTracks(tracks) {
    let end = 0;
    for (const t of Array.isArray(tracks) ? tracks : []) {
        for (const c of t?.clips || []) {
            end = Math.max(end, (Number(c.start) || 0) + (Number(c.duration) || 0));
        }
    }
    return end;
}
