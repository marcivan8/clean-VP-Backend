/**
 * Map content findings in source-media time onto every matching timeline use.
 *
 * Locators can be transcript, speaker, language, object, or event analyzers;
 * they all return the same source-time shape and downstream edits can work
 * only with timeline ranges. Keeping this mapping in one place matters when
 * an asset is trimmed, sped up, moved, or reused more than once.
 */

/**
 * @param {Array<{assetId:string,sourceStart:number,sourceEnd:number,kind?:string,label?:string,evidence?:string,confidence?:number}>} findings
 * @param {Array<{type:string,clips:Array<Object>}>} tracks
 * @returns {Array<Object>} timeline-resolved findings, sorted by time
 */
export function mapFindingsToTimeline(findings = [], tracks = []) {
    const placements = (tracks || [])
        .filter(track => track?.type === 'video' || track?.type === 'overlay')
        .flatMap(track => (track.clips || []).map(clip => ({ trackId: track.id, clip })))
        .filter(({ clip }) => clip?.assetId && Number(clip.duration) > 0);

    const resolved = [];
    for (const finding of Array.isArray(findings) ? findings : []) {
        const sourceStart = Number(finding?.sourceStart);
        const sourceEnd = Number(finding?.sourceEnd);
        if (!finding?.assetId || !Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) continue;

        for (const { trackId, clip } of placements) {
            if (clip.assetId !== finding.assetId) continue;
            const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
            const clipSourceStart = Number(clip.offset) || 0;
            const clipSourceEnd = clipSourceStart + Number(clip.duration) * speed;
            const intersectionStart = Math.max(sourceStart, clipSourceStart);
            const intersectionEnd = Math.min(sourceEnd, clipSourceEnd);
            if (intersectionEnd <= intersectionStart) continue;

            const timelineStart = (Number(clip.start) || 0) + (intersectionStart - clipSourceStart) / speed;
            const timelineEnd = (Number(clip.start) || 0) + (intersectionEnd - clipSourceStart) / speed;
            resolved.push({
                ...finding,
                sourceStart: intersectionStart,
                sourceEnd: intersectionEnd,
                timelineStart,
                timelineEnd,
                clipId: clip.id,
                trackId,
                speed,
            });
        }
    }
    return resolved.sort((a, b) => a.timelineStart - b.timelineStart || a.timelineEnd - b.timelineEnd);
}

/** Compact source-to-timeline mapping for multimodal target locators. */
export function buildTimelineSourceMap(tracks = [], assets = []) {
    const byId = new Map((Array.isArray(assets) ? assets : []).filter(a => a?.id).map(a => [a.id, a]));
    return (Array.isArray(tracks) ? tracks : [])
        .filter(track => track?.type === 'video')
        .flatMap(track => (track.clips || []).filter(c => c?.assetId && Number(c.duration) > 0).map(clip => {
            const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
            const sourceStart = Number(clip.offset) || 0;
            return {
                assetId: clip.assetId,
                assetName: byId.get(clip.assetId)?.name || clip.name || null,
                clipId: clip.id,
                trackId: track.id,
                sourceStart,
                sourceEnd: sourceStart + Number(clip.duration) * speed,
                timelineStart: Number(clip.start) || 0,
                timelineEnd: (Number(clip.start) || 0) + Number(clip.duration),
                speed,
            };
        }))
        .sort((a, b) => a.timelineStart - b.timelineStart);
}

/** Keep timestamped transcript words that overlap a selected timeline interval. */
export function wordsInTimelineRange(words = [], range = null) {
    const start = Number(range?.start);
    const end = Number(range?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return Array.isArray(words) ? [...words] : [];
    return (Array.isArray(words) ? words : []).filter(word =>
        Number(word?.end) > start && Number(word?.start) < end
    );
}

/** Clamp a proposed timed overlay/cutaway to the user's selected interval. */
export function clampToTimelineRange(startValue, durationValue, range = null, minDuration = 0.1) {
    const start = Number(startValue);
    const duration = Number(durationValue);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return null;
    const rangeStart = Number(range?.start);
    const rangeEnd = Number(range?.end);
    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
        return { start, duration };
    }
    const clippedStart = Math.max(start, rangeStart);
    const clippedEnd = Math.min(start + duration, rangeEnd);
    return clippedEnd - clippedStart >= minDuration
        ? { start: clippedStart, duration: clippedEnd - clippedStart }
        : null;
}

/** Combine adjacent hits for one target on one timeline placement. */
export function mergeAdjacentFindings(findings = [], gapSeconds = 0.35) {
    const sorted = [...(Array.isArray(findings) ? findings : [])]
        .filter(item => Number.isFinite(Number(item?.timelineStart)) && Number.isFinite(Number(item?.timelineEnd)) && Number(item.timelineEnd) > Number(item.timelineStart))
        .sort((a, b) => a.timelineStart - b.timelineStart);
    const merged = [];
    for (const item of sorted) {
        const previous = merged[merged.length - 1];
        const sameTarget = previous
            && previous.assetId === item.assetId
            && previous.clipId === item.clipId
            && previous.kind === item.kind
            && String(previous.label || '').toLowerCase() === String(item.label || '').toLowerCase();
        if (sameTarget && Number(item.timelineStart) <= Number(previous.timelineEnd) + Math.max(0, Number(gapSeconds) || 0)) {
            previous.timelineEnd = Math.max(previous.timelineEnd, item.timelineEnd);
            previous.sourceStart = Math.min(previous.sourceStart, item.sourceStart);
            previous.sourceEnd = Math.max(previous.sourceEnd, item.sourceEnd);
            previous.confidence = Math.min(Number(previous.confidence) || 0, Number(item.confidence) || 0);
            previous.evidence = [previous.evidence, item.evidence].filter(Boolean).join(' · ');
        } else {
            merged.push({ ...item });
        }
    }
    return merged;
}
