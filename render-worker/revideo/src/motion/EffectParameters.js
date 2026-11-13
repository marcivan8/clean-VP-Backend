import { evaluateMotionExpression } from './MotionExpression.js';
import { sampleKeyframeTrack } from './MotionResolver.js';

function numeric(value, fallback) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) && 'value' in value ? value.value : value;
    if (raw === null || raw === undefined || typeof raw === 'boolean' || (typeof raw === 'string' && raw.trim() === '')) return fallback;
    const number = Number(raw);
    return Number.isFinite(number) ? number : fallback;
}

/** Resolve one scalar effect control on the clip-local clock. */
export function resolveRevideoEffectParameter(effect, key, fallback, clipStart = 0, time = 0, clipDuration = 0) {
    const start = numeric(clipStart, 0);
    const localTime = numeric(time, start) - start;
    const raw = effect?.params?.[key];
    const base = numeric(raw, fallback);
    const authoredTrack = effect?.keyframes?.[key];
    const parameterTrack = raw?.keyframes;
    // A serialized empty effect-level track is not an override. Older effect
    // projects can still keep their populated keyframes on the parameter.
    const source = (Array.isArray(authoredTrack) && authoredTrack.length ? authoredTrack : null)
        || (Array.isArray(parameterTrack) && parameterTrack.length ? parameterTrack : null)
        || (Array.isArray(authoredTrack) ? authoredTrack : parameterTrack);
    let value = base;
    if (Array.isArray(source) && source.length) {
        const track = source.map(frame => ({
            ...frame,
            time: numeric(frame?.time, NaN) - start,
            value: frame?.value ?? frame?.properties?.[key],
        }));
        value = numeric(sampleKeyframeTrack(track, localTime, base), base);
    }

    const expression = effect?.expressions?.[key] ?? raw?.expression;
    if (typeof expression !== 'string' || !expression.trim()) return value;
    const rawStart = numeric(effect?.startTime, NaN);
    const rawEnd = numeric(effect?.endTime, NaN);
    const effectStart = Number.isFinite(rawStart) ? rawStart - start : 0;
    const effectEnd = Number.isFinite(rawEnd) ? rawEnd - start : numeric(clipDuration, NaN);
    const duration = Number.isFinite(effectStart) && Number.isFinite(effectEnd) && effectEnd > effectStart
        ? effectEnd - effectStart
        : Math.max(0, numeric(clipDuration, 0));
    const expressed = evaluateMotionExpression(expression, {
        t: localTime,
        time: localTime,
        duration,
        progress: duration > 0 ? Math.max(0, Math.min(1, (localTime - effectStart) / duration)) : 0,
        value,
    });
    return Number.isFinite(expressed) ? expressed : value;
}

export default { resolveRevideoEffectParameter };
