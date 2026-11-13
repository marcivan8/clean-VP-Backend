/**
 * Native Revideo preview adapter for authored footage effect stacks.
 *
 * The editor preview is Revideo, not the older WebCodecs player. Keeping this
 * tiny adapter at that boundary means an effect is never accidentally treated
 * as previewed just because another renderer knows how to draw it. The export
 * compositor remains authoritative for the full effect catalogue; this module
 * only maps Revideo's documented CSS-filter subset and preserves timing,
 * keyframes and expressions through the shared motion resolver.
 */

import { blur, brightness, contrast, grayscale, hue, invert, saturate, sepia } from '@revideo/2d';
import { resolveEffectParameter } from '../motion/EffectTiming.js';
import { resolveTimelineEffectGraphPreview } from '../motion/TimelineVisualEffects.js';

const REVIDEO_FILTER_KINDS = new Set([
    'blur', 'blur_gaussian', 'brightness', 'contrast', 'saturation', 'saturate',
    'hue', 'hue-rotate', 'grayscale', 'sepia', 'invert', 'color_grade',
]);

function numeric(value, fallback) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) && 'value' in value ? value.value : value;
    if (raw === null || raw === undefined || typeof raw === 'boolean' || (typeof raw === 'string' && raw.trim() === '')) return fallback;
    const result = Number(raw);
    return Number.isFinite(result) ? result : fallback;
}

/** Whether an effect is inside its authored project-time/output window. */
export function isRevideoEffectActive(effect, clipStart = 0, duration = 0, time = 0) {
    if (!effect || effect.enabled === false) return false;
    const currentTime = numeric(time, NaN);
    if (!Number.isFinite(currentTime)) return false;
    const start = numeric(clipStart, 0);
    if (Array.isArray(effect.outputWindows)) {
        const localTime = currentTime - start;
        return effect.outputWindows.some(window => {
            const from = numeric(window?.start, NaN);
            const to = numeric(window?.end, NaN);
            return Number.isFinite(from) && Number.isFinite(to) && from <= localTime && localTime < to;
        });
    }
    const effectStart = numeric(effect.startTime, start);
    const effectEnd = numeric(effect.endTime, start + (numeric(duration, 0) || Infinity));
    return currentTime >= effectStart && currentTime < effectEnd;
}

/** Return active effect kinds that must stay export-only in the Revideo player. */
export function getUnsupportedRevideoEffectKinds(effects = [], clipStart = 0, duration = 0, time = null) {
    return [...new Set((Array.isArray(effects) ? effects : [])
        .filter(effect => effect && effect.enabled !== false
            && (time === null || time === undefined || isRevideoEffectActive(effect, clipStart, duration, time)))
        .map(effect => effect.kind || effect.type || effect.id)
        .filter(kind => kind && !REVIDEO_FILTER_KINDS.has(kind)))];
}

/**
 * Resolve exactly the authored effects that the Revideo preview may show for a
 * clip. Effect graphs are executable DAGs in export, not cosmetic metadata:
 * a graph is only folded into the preview when the shared compatibility gate
 * proves that it is an unambiguous linear chain. This keeps the mounted player
 * from silently dropping a branch or inventing an order for a composite.
 */
export function resolveRevideoPreviewEffects(clip = {}) {
    const graph = resolveTimelineEffectGraphPreview(clip?.effectGraph);
    const effects = [
        ...graph.effects,
        ...(Array.isArray(clip?.effects) ? clip.effects : []),
    ];
    return {
        effects,
        warning: graph.warning,
        unsupportedKinds: getUnsupportedRevideoEffectKinds(effects),
    };
}

function valueAt(effect, key, fallback, identity, min, max, clipStart, duration, getTime) {
    return () => {
        const time = numeric(getTime(), 0);
        if (!isRevideoEffectActive(effect, clipStart, duration, time)) return identity;
        const value = resolveEffectParameter(effect, key, fallback, time, { clipStart, clipDuration: duration });
        return Math.max(min, Math.min(max, numeric(value, fallback)));
    };
}

function percentageAt(effect, key, fallback, identity, min, max, clipStart, duration, getTime) {
    return () => {
        const time = numeric(getTime(), 0);
        if (!isRevideoEffectActive(effect, clipStart, duration, time)) return identity;
        const value = resolveEffectParameter(effect, key, fallback, time, { clipStart, clipDuration: duration });
        return Math.max(min, Math.min(max, numeric(value, fallback) / 100));
    };
}

/**
 * Resolve the native CSS-compatible portion of a clip effect stack. Every
 * resolver is a Revideo signal, so changes from playback time, keyframes and
 * procedural expressions are evaluated without rebuilding the scene.
 */
export function createRevideoEffectFilters(effects = [], clipStart = 0, duration = 0, getTime = () => 0) {
    const filters = [];
    for (const effect of Array.isArray(effects) ? effects : []) {
        if (!effect || effect.enabled === false) continue;
        const kind = effect.kind || effect.type || effect.id;
        const params = effect.params || {};
        const read = (key, fallback) => numeric(params[key], fallback);
        const active = (key, fallback, identity, min, max) => valueAt(
            effect, key, fallback, identity, min, max, clipStart, duration, getTime,
        );
        const activePercent = (key, fallback, identity, min, max) => percentageAt(
            effect, key, fallback, identity, min, max, clipStart, duration, getTime,
        );
        switch (kind) {
            case 'blur': case 'blur_gaussian':
                filters.push(blur(active('radius', read('amount', 0), 0, 0, 50)));
                break;
            case 'brightness':
                filters.push(brightness(active('amount', read('value', 1), 1, 0, 2)));
                break;
            case 'contrast':
                filters.push(contrast(active('amount', read('value', 1), 1, 0, 4)));
                break;
            case 'saturation': case 'saturate':
                filters.push(saturate(active('amount', read('value', 1), 1, 0, 5)));
                break;
            case 'hue': case 'hue-rotate':
                filters.push(hue(active('degrees', read('amount', 0), 0, -360, 360)));
                break;
            case 'grayscale':
                filters.push(grayscale(active('amount', read('value', 1), 0, 0, 1)));
                break;
            case 'sepia':
                filters.push(sepia(active('amount', read('value', 1), 0, 0, 1)));
                break;
            case 'invert':
                filters.push(invert(active('amount', read('value', 1), 0, 0, 1)));
                break;
            case 'color_grade':
                filters.push(
                    brightness(activePercent('brightness', 100, 1, 0, 2)),
                    contrast(activePercent('contrast', 100, 1, 0, 4)),
                    saturate(activePercent('saturation', 100, 1, 0, 5)),
                    hue(active('hueRotate', 0, 0, -360, 360)),
                );
                break;
            default:
                break;
        }
    }
    return filters;
}

export default {
    createRevideoEffectFilters,
    getUnsupportedRevideoEffectKinds,
    isRevideoEffectActive,
    resolveRevideoPreviewEffects,
};
