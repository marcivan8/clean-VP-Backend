import { sampleKeyframeTrack } from './MotionResolver.js';
import { evaluateMotionExpression } from './MotionExpression.js';

const isNumericValue = value => Number.isFinite(Number(value))
    || (Array.isArray(value) && value.length > 0 && value.every(Number.isFinite));

/** Resolve a numeric effect property from its expression or keyframe track. */
export function resolveEffectParameter(effect, key, fallback, projectTime = 0, context = {}) {
    const time = Number.isFinite(Number(projectTime)) ? Number(projectTime) : 0;
    const raw = effect?.params?.[key];
    const rawBase = raw?.value ?? raw ?? fallback;
    const base = Array.isArray(rawBase) ? [...rawBase] : Number(rawBase);
    const fallbackValue = Array.isArray(fallback) ? [...fallback] : Number(fallback) || 0;
    const safeBase = isNumericValue(base) ? base : fallbackValue;
    const track = effect?.keyframes?.[key] || raw?.keyframes;
    const normalizedTrack = Array.isArray(track) ? track.map(frame => ({
        time: frame?.time,
        value: frame?.value ?? frame?.properties?.[key],
        easing: frame?.easing,
    })) : track;
    const keyed = sampleKeyframeTrack(normalizedTrack, time, safeBase);
    const expression = effect?.expressions?.[key] ?? raw?.expression;
    if (typeof expression !== 'string' || !expression.trim()) return keyed;
    // Expressions currently evaluate one scalar channel. Preserve vector
    // keyframe results until vector expressions have explicit channel syntax.
    if (Array.isArray(keyed)) return keyed;
    const clipStart = Number.isFinite(Number(context.clipStart)) ? Number(context.clipStart) : 0;
    const localTime = time - clipStart;
    const clipDuration = Number(context.clipDuration);
    const rawStart = Number(effect?.startTime);
    const rawEnd = Number(effect?.endTime);
    const start = Number.isFinite(rawStart) ? rawStart - clipStart : 0;
    const end = Number.isFinite(rawEnd) ? rawEnd - clipStart : clipDuration;
    const duration = Number.isFinite(start) && Number.isFinite(end) && end > start
        ? end - start
        : (Number.isFinite(clipDuration) && clipDuration > 0 ? clipDuration : 0);
    const expressed = evaluateMotionExpression(expression, {
        t: localTime,
        time: localTime,
        duration,
        progress: duration > 0 ? Math.max(0, Math.min(1, (localTime - start) / duration)) : 0,
        value: Number.isFinite(Number(keyed)) ? Number(keyed) : (Number(safeBase) || 0),
    });
    return Number.isFinite(expressed) ? expressed : keyed;
}

/** Resolve a timeline effect's active window and animated parameters at project time. */
export function resolveEffectAtTime(effect, projectTime = 0, context = {}) {
    if (!effect || effect.enabled === false) return null;
    const time = Number.isFinite(Number(projectTime)) ? Number(projectTime) : 0;
    const start = effect.startTime === null || effect.startTime === undefined || effect.startTime === ''
        ? -Infinity : Number(effect.startTime);
    const end = effect.endTime === null || effect.endTime === undefined || effect.endTime === ''
        ? Infinity : Number(effect.endTime);
    if ((Number.isFinite(start) && time < start) || (Number.isFinite(end) && time >= end)) return null;

    const params = { ...(effect.params || {}) };
    for (const [key, raw] of Object.entries(params)) {
        const track = effect.keyframes?.[key] || raw?.keyframes;
        const expression = effect.expressions?.[key] ?? raw?.expression;
        if ((!Array.isArray(track) || !track.length) && typeof expression !== 'string') continue;
        const fallback = raw?.value ?? raw;
        const value = resolveEffectParameter(effect, key, isNumericValue(fallback) ? fallback : 0, time, context);
        params[key] = raw && typeof raw === 'object' && !Array.isArray(raw)
            ? { ...raw, value }
            : value;
    }
    for (const [key, track] of Object.entries(effect.keyframes || {})) {
        if (Object.prototype.hasOwnProperty.call(params, key) || !Array.isArray(track) || !track.length) continue;
        params[key] = resolveEffectParameter(effect, key, 0, time, context);
    }
    return { ...effect, params };
}

