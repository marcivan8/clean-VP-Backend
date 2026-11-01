/**
 * Split one timeline clip at source-time speaker-angle boundaries.
 *
 * Analysis segments are expressed in source-media seconds. Clip start/duration
 * are timeline seconds, while offset and segment ranges are source seconds.
 * Keep those clocks aligned, hold the current angle through brief pauses, and
 * use a wide shot for longer gaps so applying multicam never trims or
 * time-compresses the underlying footage.
 */
const EPS = 1e-4;
const HOLD_ANGLE_GAP = 1.25;

const wideCamera = () => ({
    angle: 'wide', scale: 1, x: 0, y: 0,
    cropX: 0, cropY: 0, cropW: 1, cropH: 1,
    speaker: null,
});

/**
 * @returns {Array<{clip:object, segment:object|null}>} [] when no segments
 * overlap this clip's source range.
 */
export function splitClipAtSpeakerSegments(clip, segments) {
    const timelineStart = Number(clip?.start) || 0;
    const timelineDuration = Number(clip?.duration) || 0;
    const speed = Number(clip?.speed) > 0 ? Number(clip.speed) : 1;
    const sourceStart = Number(clip?.offset) || 0;
    const sourceEnd = sourceStart + timelineDuration * speed;
    if (!(timelineDuration > 0) || !(sourceEnd > sourceStart)) return [];

    const overlapping = (Array.isArray(segments) ? segments : [])
        .filter(segment => Number.isFinite(Number(segment?.start))
            && Number.isFinite(Number(segment?.end))
            && Number(segment.end) > sourceStart + EPS
            && Number(segment.start) < sourceEnd - EPS)
        .slice()
        .sort((a, b) => Number(a.start) - Number(b.start));
    if (!overlapping.length) return [];

    const spans = [];
    let cursor = sourceStart;
    for (const segment of overlapping) {
        const start = Math.max(sourceStart, cursor, Number(segment.start));
        const end = Math.min(sourceEnd, Number(segment.end));
        if (end <= start + EPS) continue;
        if (start > cursor + EPS) {
            const previous = spans[spans.length - 1]?.segment;
            const gapSegment = start - cursor <= HOLD_ANGLE_GAP ? (previous || segment) : null;
            spans.push({ start: cursor, end: start, segment: gapSegment });
        }
        spans.push({ start, end, segment });
        cursor = end;
    }
    if (cursor < sourceEnd - EPS) {
        // Return to the wide composition at the clip tail. The short-gap hold
        // applies between detected turns, where it avoids a flash to wide;
        // extending a close-up through the trailing silence changes the
        // established timeline contract and can leave the final frame cropped.
        spans.push({ start: cursor, end: sourceEnd, segment: null });
    }
    if (!spans.length) return [];

    const isWholeClip = spans.length === 1
        && Math.abs(spans[0].start - sourceStart) <= EPS
        && Math.abs(spans[0].end - sourceEnd) <= EPS;

    return spans.map((span, index) => {
        const start = timelineStart + (span.start - sourceStart) / speed;
        const duration = (span.end - span.start) / speed;
        const segment = span.segment;
        const virtualCam = segment ? {
            angle: segment.angle || 'wide',
            scale: segment.scale ?? 1,
            x: segment.x ?? 0,
            y: segment.y ?? 0,
            cropX: segment.cropX ?? 0,
            cropY: segment.cropY ?? 0,
            cropW: segment.cropW ?? 1,
            cropH: segment.cropH ?? 1,
            speaker: segment.speaker || null,
        } : wideCamera();

        return {
            segment,
            clip: {
                ...clip,
                id: isWholeClip ? clip.id : `${clip.id}_vm${Math.round(span.start * 1000)}_${index}`,
                offset: span.start,
                start,
                duration,
                end: start + duration,
                virtualCam,
                // Existing zoom keyframes refer to the unsplit clip's local
                // clock. Drop them only when the original clip was divided.
                ...(isWholeClip ? {} : {
                    keyframes: clip.keyframes
                        ? { ...clip.keyframes, scale: [] }
                        : clip.keyframes,
                }),
            },
        };
    });
}

export default { splitClipAtSpeakerSegments };
