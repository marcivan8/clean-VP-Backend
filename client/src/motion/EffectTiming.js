import { sampleKeyframeTrack } from './MotionResolver.js';
import { evaluateMotionExpression } from './MotionExpression.js';

const finiteNumber = value => value !== null && value !== undefined
    && typeof value !== 'boolean' && !(typeof value === 'string' && value.trim() === '')
    && Number.isFinite(Number(value)) ? Number(value) : null;
const isNumericValue = value => finiteNumber(value) !== null
    || (Array.isArray(value) && value.length > 0 && value.every(channel => finiteNumber(channel) !== null));

function numericFallback(value) {
    if (Array.isArray(value) && isNumericValue(value)) return value.map(Number);
    return finiteNumber(value) ?? 0;
}

/** Prefer a populated effect-level track, then fall back to the legacy track
 * stored beside the parameter value. Empty/malformed effect tracks are not an
 * authored override and must not hide a usable parameter track. */
export function getEffectKeyframeTrack(effect, key, rawParam = effect?.params?.[key]) {
    const candidates = [effect?.keyframes?.[key], rawParam?.keyframes];
    return candidates.find(track => Array.isArray(track) && track.length > 0)
        || candidates.find(Array.isArray)
        || null;
}

/** Resolve a numeric effect property from its expression or keyframe track. */
export function resolveEffectParameter(effect, key, fallback, projectTime = 0, context = {}) {
    const time = finiteNumber(projectTime) ?? 0;
    const raw = effect?.params?.[key];
    const rawBase = raw?.value ?? raw ?? fallback;
    const base = Array.isArray(rawBase)
        ? (isNumericValue(rawBase) ? rawBase.map(Number) : null)
        : finiteNumber(rawBase);
    const fallbackValue = numericFallback(fallback);
    const safeBase = isNumericValue(base) ? base : fallbackValue;
    const track = getEffectKeyframeTrack(effect, key, raw);
    const normalizedTrack = Array.isArray(track) ? track.map(frame => ({
        time: frame?.time,
        value: frame?.value ?? frame?.properties?.[key],
        easing: frame?.easing,
    })) : track;
    const keyed = sampleKeyframeTrack(normalizedTrack, time, safeBase);
    const expression = effect?.expressions?.[key] ?? raw?.expression;
    if (typeof expression !== 'string' || !expression.trim()) return keyed;
    const clipStart = finiteNumber(context.clipStart) ?? 0;
    const localTime = time - clipStart;
    const clipDuration = finiteNumber(context.clipDuration) ?? NaN;
    const rawStart = finiteNumber(effect?.startTime) ?? NaN;
    const rawEnd = finiteNumber(effect?.endTime) ?? NaN;
    const start = Number.isFinite(rawStart) ? rawStart - clipStart : 0;
    const end = Number.isFinite(rawEnd) ? rawEnd - clipStart : clipDuration;
    const duration = Number.isFinite(start) && Number.isFinite(end) && end > start
        ? end - start
        : (Number.isFinite(clipDuration) && clipDuration > 0 ? clipDuration : 0);
    const variablesFor = value => ({
        t: localTime,
        time: localTime,
        duration,
        progress: duration > 0 ? Math.max(0, Math.min(1, (localTime - start) / duration)) : 0,
        value,
    });
    if (Array.isArray(keyed)) {
        // The formula runs once per channel; `value` is that channel's
        // interpolated value. This keeps vector controls deterministic while
        // allowing color and point controls to use the same safe grammar.
        return keyed.map(channel => {
            const numeric = Number(channel);
            const expressed = evaluateMotionExpression(expression, variablesFor(Number.isFinite(numeric) ? numeric : 0));
            return Number.isFinite(expressed) ? expressed : channel;
        });
    }
    const numericKeyed = Number(keyed);
    const expressed = evaluateMotionExpression(expression, variablesFor(Number.isFinite(numericKeyed) ? numericKeyed : (Number(safeBase) || 0)));
    return Number.isFinite(expressed) ? expressed : keyed;
}

/** Resolve a timeline effect's active window and animated parameters at project time. */
export function resolveEffectAtTime(effect, projectTime = 0, context = {}) {
    if (!effect || effect.enabled === false) return null;
    const time = finiteNumber(projectTime) ?? 0;
    const start = finiteNumber(effect.startTime) ?? -Infinity;
    const end = finiteNumber(effect.endTime) ?? Infinity;
    if ((Number.isFinite(start) && time < start) || (Number.isFinite(end) && time >= end)) return null;

    const params = { ...(effect.params || {}) };
    for (const [key, raw] of Object.entries(params)) {
        const track = getEffectKeyframeTrack(effect, key, raw);
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

