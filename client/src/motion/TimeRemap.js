import { sampleKeyframeTrack } from './MotionResolver.js';
import { clamp } from './Easing.js';
import { MAX_MOTION_BLUR_SAMPLES } from './MotionLimits.js';

const number = (value, fallback = 0) => value !== null && value !== undefined
    && typeof value !== 'boolean' && !(typeof value === 'string' && value.trim() === '')
    && Number.isFinite(Number(value)) ? Number(value) : fallback;
const validCurveNumber = value => value !== null && value !== undefined
    && typeof value !== 'boolean' && !(typeof value === 'string' && value.trim() === '')
    && Number.isFinite(Number(value));

/** Return the exact scene-owned shutter timestamps used for one output frame. */
export function getSceneShutterSampleTimes(frame, duration = 1, fps = 30, motionBlur = {}) {
    const safeFps = Math.max(1, number(fps, 30));
    const baseTime = Math.max(0, number(frame) / safeFps);
    if (!motionBlur?.enabled) return [baseTime];
    const setting = (value, fallback, zeroFallsBack = false) => {
        if (value == null || value === '') return fallback;
        const resolved = number(value, fallback);
        return zeroFallsBack && resolved === 0 ? fallback : resolved;
    };
    const samples = Math.round(clamp(setting(motionBlur.samples, 3, true), 2, MAX_MOTION_BLUR_SAMPLES));
    const shutterFps = clamp(setting(motionBlur.frameRate, 30, true), 1, 120);
    const angle = clamp(setting(motionBlur.shutterAngle, 180), 0, 360);
    const exposure = angle / (360 * shutterFps);
    const sceneDuration = Math.max(0, number(duration));
    return Array.from({ length: samples }, (_, index) => {
        const offset = ((index + 0.5) / samples - 0.5) * exposure;
        const sampleTime = Math.max(0, baseTime + offset);
        return sceneDuration > 0 ? Math.min(sceneDuration, sampleTime) : sampleTime;
    });
}

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
    const hasTimeCurve = keyframes.some(point => validCurveNumber(point?.time)
        && validCurveNumber(point?.value));
    let localTime = hasTimeCurve
        ? sampleKeyframeTrack(keyframes, number(time), number(keyframes.find(point => validCurveNumber(point?.time)
            && validCurveNumber(point?.value))?.value))
        : number(time) * speed + number(remap.offset, defaultOffset);
    if (span > 0 && remap.mode === 'loop') localTime = ((localTime % span) + span) % span;
    else if (span > 0 && remap.mode === 'ping-pong') {
        const cycle = ((localTime % (span * 2)) + span * 2) % (span * 2);
        localTime = cycle <= span ? cycle : span * 2 - cycle;
    } else if (span > 0) localTime = clamp(localTime, 0, span);
    return localTime;
}

/** Resolve the source time requested by a 3D video layer. Keep the remap,
 * source offset, and playback-rate order identical in preview and export. */
export function resolveSceneVideoSourceTime(object = {}, time = 0, duration = 1) {
    const mappedTime = remapSceneObjectTime(object.timeRemap, time, duration);
    const videoStart = Math.max(0, number(object.videoStart, 0));
    // Preserve the legacy/default behavior for absent, null, empty, or zero
    // speeds while still clamping negative authored rates to the UI minimum.
    const videoSpeed = Math.max(0.05, Number(object.videoSpeed) || 1);
    return videoStart + Math.max(0, mappedTime) * videoSpeed;
}

/**
 * Resolve an ordinary timeline video overlay's source clock. The legacy clip
 * offset/speed model remains byte-for-byte compatible unless a source-time
 * curve has been authored. Curve values are seconds relative to the clip's
 * source in-point, matching the 3D scene time-remap contract.
 */
export function resolveOverlayVideoSourceTime(clip = {}, timelineTime = 0) {
    const start = number(clip.start ?? clip.startTime, 0);
    const elapsed = Math.max(0, number(timelineTime) - start);
    const sourceOffset = Math.max(0, number(clip.offset, 0));
    const legacySpeed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    const remap = clip.timeRemap && typeof clip.timeRemap === 'object' ? clip.timeRemap : null;
    const hasCurve = Array.isArray(remap?.keyframes) && remap.keyframes.some(point =>
        validCurveNumber(point?.time) && validCurveNumber(point?.value));
    if (!hasCurve) return sourceOffset + elapsed * legacySpeed;

    const duration = Math.max(0, number(clip.duration, 0));
    const localSourceTime = remapSceneObjectTime(remap, elapsed, duration || 1);
    // Native video playback cannot represent a negative playback rate reliably
    // across browsers. Keep the mapped timestamp valid; callers resync it from
    // the timeline clock while playing.
    return sourceOffset + Math.max(0, localSourceTime);
}

/** Approximate the local playback rate for a keyframed overlay source clock. */
export function resolveOverlayVideoPlaybackRate(clip = {}, timelineTime = 0) {
    const remap = clip.timeRemap && typeof clip.timeRemap === 'object' ? clip.timeRemap : null;
    const hasCurve = Array.isArray(remap?.keyframes) && remap.keyframes.some(point =>
        validCurveNumber(point?.time) && validCurveNumber(point?.value));
    if (!hasCurve) return Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    const start = number(clip.start ?? clip.startTime, 0);
    const elapsed = Math.max(0, number(timelineTime) - start);
    const duration = Math.max(0, number(clip.duration, 0)) || 1;
    const step = 1 / 120;
    const current = remapSceneObjectTime(remap, elapsed, duration);
    let next = remapSceneObjectTime(remap, elapsed + step, duration);
    let slope = (next - current) / step;
    const span = Math.max(0, number(remap.duration, duration));
    // Modulo wraps create a large apparent jump with the opposite sign. Use
    // the two samples after the boundary to recover the authored local
    // direction, so forward and reverse loops remain smooth in preview.
    if (remap.mode === 'loop' && span > 0 && Math.abs(next - current) > span / 2) {
        const after = remapSceneObjectTime(remap, elapsed + step * 2, duration);
        slope = (after - next) / step;
    }
    // HTMLMediaElement cannot play backwards. Preserve the sign so preview
    // renderers can pause native playback and seek each timeline frame to the
    // authored source time instead of incorrectly playing a reverse curve
    // forwards. A true hold is zero speed; don't let the media creep at 0.05x.
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-4) return 0;
    return Math.sign(slope) * clamp(Math.abs(slope), 0.05, 8);
}

/** Largest source time the renderer requests across its output frames. */
export function maxSceneObjectSourceTime(remap = {}, duration = 1, fps = 30, extraSampleTimes = []) {
    const span = Math.max(0, number(remap.duration, duration));
    if (span > 0 && ['loop', 'ping-pong'].includes(remap.mode)) return span;
    const safeDuration = Math.max(0, number(duration));
    const safeFps = Math.max(1, number(fps, 30));
    const frameCount = Math.max(1, Math.ceil(safeDuration * safeFps));
    let maxTime = 0;
    for (let frame = 0; frame <= frameCount; frame++) {
        maxTime = Math.max(maxTime, remapSceneObjectTime(remap, Math.min(safeDuration, frame / safeFps), safeDuration));
    }
    // Scene motion blur can evaluate video textures at shutter sample times
    // beyond the final regular output frame. Include those exact timestamps
    // when export sizes its extracted source sequence.
    for (const sampleTime of Array.isArray(extraSampleTimes) ? extraSampleTimes : []) {
        const time = number(sampleTime, NaN);
        if (!Number.isFinite(time)) continue;
        maxTime = Math.max(maxTime, remapSceneObjectTime(remap, Math.max(0, time), safeDuration));
    }
    return maxTime;
}
