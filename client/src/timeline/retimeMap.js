import { resolveEasing } from '../motion/Easing.js';

const MIN_RATE = 0.1;
const MAX_RATE = 4;
const RETIME_SAMPLES_PER_SECOND = 8;
const clampRate = value => Math.max(MIN_RATE, Math.min(MAX_RATE, Number.isFinite(Number(value)) ? Number(value) : 1));

function findTimelineSegment(segments, localTime) {
    let low = 0, high = segments.length - 1;
    while (low < high) {
        const mid = (low + high) >> 1;
        // Segment windows are [start, end), except for the final endpoint.
        // At a retime boundary the next segment owns the timestamp, otherwise
        // playback holds the prior rate for one frame at every speed change.
        if (segments[mid].end <= localTime) low = mid + 1;
        else high = mid;
    }
    return segments[low];
}

function readSpeed(effect) {
    const value = effect?.params?.speed;
    return Number(value?.value ?? value ?? effect?.speed);
}

/** Build a monotonic map between clip-local timeline seconds and source seconds. */
export function createTimelineRetimeMap(clip = {}) {
    const timelineStart = Number(clip.start) || 0;
    const duration = Math.max(0, Number(clip.duration) || 0);
    const sourceOffset = Math.max(0, Number(clip.offset) || 0);
    const effects = (Array.isArray(clip.effects) ? clip.effects : [])
        .filter(effect => effect && effect.enabled !== false && (effect.kind || effect.type) === 'speed_change')
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const effect = effects.at(-1);
    const maintainPitchValue = effect?.params?.maintainPitch?.value
        ?? effect?.params?.maintainPitch
        ?? effect?.maintainPitch;
    const maintainPitch = maintainPitchValue !== false;
    // Timeline speed effects replace the clip-level retime in the export
    // compiler. Match that contract: normal-rate regions around a partial
    // effect run at 1x; clip.speed applies only when no speed effect exists.
    const baseRate = clampRate(effect ? 1 : (clip.speed || 1));
    const effectStart = effect && effect.startTime != null && Number.isFinite(Number(effect.startTime))
        ? Math.max(timelineStart, Number(effect.startTime)) : timelineStart;
    const effectEnd = effect && effect.endTime != null && Number.isFinite(Number(effect.endTime))
        ? Math.min(timelineStart + duration, Number(effect.endTime)) : timelineStart + duration;
    if (effect && effectEnd <= effectStart) return createTimelineRetimeMap({ ...clip, effects: [] });
    const authoredTrack = (effect?.keyframes?.speed || effect?.params?.speed?.keyframes || [])
        .map((frame, index) => ({
            time: Number(frame?.time),
            value: Number(frame?.value ?? frame?.properties?.speed),
            easing: frame?.easing || 'linear', index,
        }))
        .filter(frame => Number.isFinite(frame.time) && Number.isFinite(frame.value))
        .sort((a, b) => a.time - b.time || a.index - b.index);
    const rawEffectSpeed = readSpeed(effect);
    const effectSpeed = clampRate(Number.isFinite(rawEffectSpeed) ? rawEffectSpeed : 1);
    const sampleTrack = absoluteTime => {
        if (!authoredTrack.length) return effectSpeed;
        if (absoluteTime <= authoredTrack[0].time) return clampRate(authoredTrack[0].value);
        if (absoluteTime >= authoredTrack.at(-1).time) return clampRate(authoredTrack.at(-1).value);
        for (let i = 0; i < authoredTrack.length - 1; i++) {
            const from = authoredTrack[i], to = authoredTrack[i + 1];
            if (absoluteTime < from.time || absoluteTime > to.time) continue;
            const p = (absoluteTime - from.time) / Math.max(1e-9, to.time - from.time);
            return clampRate(from.value + (to.value - from.value) * resolveEasing(to.easing)(p));
        }
        return effectSpeed;
    };
    const points = [];
    if (effect) {
        if (effectStart > timelineStart) {
            const epsilon = Math.min(1e-5, (effectStart - timelineStart) / 2, (effectEnd - effectStart) / 2);
            points.push({ time: timelineStart, value: 1, easing: 'linear' });
            points.push({ time: effectStart - epsilon, value: 1, easing: 'linear' });
        }
        points.push({ time: effectStart, value: sampleTrack(effectStart), easing: 'linear' });
        points.push(...authoredTrack.filter(frame => frame.time > effectStart && frame.time < effectEnd));
        points.push({ time: effectEnd, value: sampleTrack(effectEnd), easing: 'linear' });
        if (effectEnd < timelineStart + duration) {
            const epsilon = Math.min(1e-5, (timelineStart + duration - effectEnd) / 2, (effectEnd - effectStart) / 2);
            points.push({ time: effectEnd + epsilon, value: 1, easing: 'linear' });
            points.push({ time: timelineStart + duration, value: 1, easing: 'linear' });
        }
    } else {
        points.push({ time: timelineStart, value: baseRate, easing: 'linear' });
        points.push({ time: timelineStart + duration, value: baseRate, easing: 'linear' });
    }
    const uniquePoints = points
        .filter(point => Number.isFinite(point.time) && point.time >= timelineStart && point.time <= timelineStart + duration)
        .sort((a, b) => a.time - b.time)
        .reduce((unique, point) => {
            if (unique.at(-1)?.time === point.time) unique[unique.length - 1] = point;
            else unique.push(point);
            return unique;
        }, []);
    if (uniquePoints[0]?.time > timelineStart) uniquePoints.unshift({ time: timelineStart, value: baseRate, easing: 'linear' });
    if (uniquePoints.at(-1)?.time < timelineStart + duration) {
        uniquePoints.push({ time: timelineStart + duration, value: uniquePoints.at(-1)?.value ?? baseRate, easing: 'linear' });
    }
    const segments = [];
    let sourceTime = sourceOffset;
    for (let i = 0; i < uniquePoints.length - 1; i++) {
        const from = uniquePoints[i], to = uniquePoints[i + 1];
        const span = to.time - from.time;
        if (span <= 0) continue;
        const count = Math.max(1, Math.ceil(span * RETIME_SAMPLES_PER_SECOND));
        for (let j = 0; j < count; j++) {
            const p0 = j / count, p1 = (j + 1) / count;
            const eased0 = resolveEasing(to.easing)(p0);
            const eased1 = resolveEasing(to.easing)(p1);
            const speed0 = clampRate(from.value + (to.value - from.value) * eased0);
            const speed1 = clampRate(from.value + (to.value - from.value) * eased1);
            const rate = (speed0 + speed1) / 2;
            const start = from.time - timelineStart + span * p0;
            const end = from.time - timelineStart + span * p1;
            const sourceEnd = sourceTime + (end - start) * rate;
            segments.push({ start, end, sourceStart: sourceTime, sourceEnd, rate });
            sourceTime = sourceEnd;
        }
    }
    const timelineToSource = time => {
        const requested = Number(time);
        const t = Math.max(0, Math.min(duration, Number.isFinite(requested) ? requested - timelineStart : 0));
        const segment = findTimelineSegment(segments, t);
        return segment ? segment.sourceStart + (t - segment.start) * segment.rate : sourceOffset;
    };
    const sourceToTimeline = time => {
        if (!segments.length) return timelineStart;
        const requested = Number(time);
        const source = Math.max(sourceOffset, Math.min(sourceTime, Number.isFinite(requested) ? requested : sourceOffset));
        let low = 0, high = segments.length - 1;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (segments[mid].sourceEnd <= source) low = mid + 1;
            else high = mid;
        }
        const segment = segments[low];
        return timelineStart + segment.start + (source - segment.sourceStart) / segment.rate;
    };
    return { timelineStart, duration, sourceOffset, sourceDuration: sourceTime - sourceOffset, maintainPitch, segments, timelineToSource, sourceToTimeline };
}

/** Serialize a map for the playback engine; functions stay on the UI thread. */
export function serializeTimelineRetimeMap(map) {
    return map ? {
        timelineStart: map.timelineStart,
        duration: map.duration,
        sourceOffset: map.sourceOffset,
        maintainPitch: map.maintainPitch,
        segments: map.segments,
    } : null;
}

export function mapSourceTimeToTimeline(map, sourceTime) {
    const segments = map?.segments || [];
    const requested = Number(sourceTime);
    if (!segments.length) return Number.isFinite(requested) ? requested : Number(map?.timelineStart) || 0;
    const source = Math.max(map.sourceOffset, Math.min(segments.at(-1).sourceEnd, Number.isFinite(requested) ? requested : map.sourceOffset));
    let low = 0, high = segments.length - 1;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (segments[mid].sourceEnd <= source) low = mid + 1;
        else high = mid;
    }
    const segment = segments[low];
    return map.timelineStart + segment.start + (source - segment.sourceStart) / segment.rate;
}

export function mapTimelineTimeToSource(map, timelineTime) {
    const segments = map?.segments || [];
    const requested = Number(timelineTime);
    if (!segments.length) return Number.isFinite(requested) ? requested : Number(map?.sourceOffset) || 0;
    const t = Math.max(0, Math.min(map.duration, Number.isFinite(requested) ? requested - map.timelineStart : 0));
    const segment = findTimelineSegment(segments, t);
    return segment.sourceStart + (t - segment.start) * segment.rate;
}

export function mapTimelineTimeToRate(map, timelineTime) {
    const segments = map?.segments || [];
    if (!segments.length) return 1;
    const requested = Number(timelineTime);
    const t = Math.max(0, Math.min(map.duration, Number.isFinite(requested) ? requested - map.timelineStart : 0));
    return findTimelineSegment(segments, t).rate;
}

/** Split a source-time interval at retime boundaries for rate-correct audio feeding. */
export function mapSourceIntervalToTimelineSegments(map, sourceStart, sourceEnd) {
    const start = Number(sourceStart);
    const end = Number(sourceEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const segments = map?.segments || [];
    if (!segments.length) {
        return [{ sourceStart: start, sourceEnd: end, timelineStart: start, timelineEnd: end, rate: 1 }];
    }
    return segments
        .filter(segment => segment.sourceEnd > start && segment.sourceStart < end)
        .map(segment => {
            const clippedStart = Math.max(start, segment.sourceStart);
            const clippedEnd = Math.min(end, segment.sourceEnd);
            return {
                sourceStart: clippedStart,
                sourceEnd: clippedEnd,
                timelineStart: mapSourceTimeToTimeline(map, clippedStart),
                timelineEnd: mapSourceTimeToTimeline(map, clippedEnd),
                rate: segment.rate,
            };
        })
        .filter(segment => segment.sourceEnd > segment.sourceStart);
}
