import { evaluateMotionExpression } from './MotionExpression.js';
import { sampleKeyframeTrack } from './MotionResolver.js';

function numeric(value, fallback) {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.value : value;
    const number = Number(raw);
    return Number.isFinite(number) ? number : fallback;
}

/** Resolve one scalar effect control on the clip-local clock. */
export function resolveRevideoEffectParameter(effect, key, fallback, clipStart = 0, time = 0, clipDuration = 0) {
    const start = Number(clipStart) || 0;
    const localTime = Number(time) - start;
    const raw = effect?.params?.[key];
    const base = numeric(raw, fallback);
    const source = effect?.keyframes?.[key] || raw?.keyframes;
    let value = base;
    if (Array.isArray(source) && source.length) {
        const track = source.map(frame => ({
            ...frame,
            time: Number(frame?.time) - start,
            value: frame?.value ?? frame?.properties?.[key],
        }));
        value = numeric(sampleKeyframeTrack(track, localTime, base), base);
    }

    const expression = effect?.expressions?.[key] ?? raw?.expression;
    if (typeof expression !== 'string' || !expression.trim()) return value;
    const rawStart = Number(effect?.startTime);
    const rawEnd = Number(effect?.endTime);
    const effectStart = Number.isFinite(rawStart) ? rawStart - start : 0;
    const effectEnd = Number.isFinite(rawEnd) ? rawEnd - start : Number(clipDuration);
    const duration = Number.isFinite(effectStart) && Number.isFinite(effectEnd) && effectEnd > effectStart
        ? effectEnd - effectStart
        : Math.max(0, Number(clipDuration) || 0);
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
