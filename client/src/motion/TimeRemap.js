import { sampleKeyframeTrack } from './MotionResolver.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Map composition time into a layer's local source time. */
export function remapSceneObjectTime(remap = {}, time = 0, duration = 1) {
    const speed = clamp(number(remap.speed, 1), -8, 8);
    const span = Math.max(0, number(remap.duration, duration));
    // A loop is half-open [0, span): starting a reverse loop at exactly
    // `span` wraps it to zero before the first frame can be rendered. Start
    // one sub-microsecond inside the source instead so reverse playback begins
    // on its final valid instant and then moves backward continuously.
    const reverseLoopStart = span > 0 ? span - Math.min(1e-6, span / 2) : span;
    const defaultOffset = speed < 0 ? (remap.mode === 'loop' ? reverseLoopStart : span) : 0;
    // An authored curve maps composition-local time directly to source seconds
    // and takes precedence over the simpler speed and offset controls.
    const keyframes = Array.isArray(remap.keyframes) ? remap.keyframes : [];
    const hasTimeCurve = keyframes.some(point => Number.isFinite(Number(point?.time))
        && Number.isFinite(Number(point?.value)));
    let localTime = hasTimeCurve
        ? sampleKeyframeTrack(keyframes, number(time), number(keyframes.find(point => Number.isFinite(Number(point?.value)))?.value))
        : number(time) * speed + number(remap.offset, defaultOffset);
    if (span > 0 && remap.mode === 'loop') localTime = ((localTime % span) + span) % span;
    else if (span > 0 && remap.mode === 'ping-pong') {
        const cycle = ((localTime % (span * 2)) + span * 2) % (span * 2);
        localTime = cycle <= span ? cycle : span * 2 - cycle;
    } else if (span > 0) localTime = clamp(localTime, 0, span);
    return localTime;
}

/** Largest source time the renderer requests across its output frames. */
export function maxSceneObjectSourceTime(remap = {}, duration = 1, fps = 30) {
    const span = Math.max(0, number(remap.duration, duration));
    if (span > 0 && ['loop', 'ping-pong'].includes(remap.mode)) return span;
    const safeDuration = Math.max(0, number(duration));
    const safeFps = Math.max(1, number(fps, 30));
    const frameCount = Math.max(1, Math.ceil(safeDuration * safeFps));
    let maxTime = 0;
    for (let frame = 0; frame <= frameCount; frame++) {
        maxTime = Math.max(maxTime, remapSceneObjectTime(remap, Math.min(safeDuration, frame / safeFps), safeDuration));
    }
    return maxTime;
}
