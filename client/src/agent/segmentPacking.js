/**
 * segmentPacking.js (R91): where the kept parts of a cut land on the timeline.
 * Pure, no imports. Used by MediaExecutionEngine._applySegmentsToTimeline.
 *
 * The server's silence / filler segments cover the WHOLE source file. The
 * clips being re-cut may already be cut (an earlier silence pass, a short
 * extracted for a reel), so only the parts of a segment that the clips still
 * show may take timeline space. Packing whole segments gave every range an
 * earlier cut removed its length back, as a black gap.
 */

/** Merged source ranges [from, to] shown by these clips (source seconds). */
export function sourceCoverage(clips) {
    const ranges = (Array.isArray(clips) ? clips : [])
        .map(c => {
            const from = Number(c?.offset) || 0;
            const speed = Number(c?.speed) > 0 ? Number(c.speed) : 1;
            return [from, from + (Number(c?.duration) || 0) * speed];
        })
        .filter(([a, b]) => b - a > 1e-3)
        .sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const r of ranges) {
        const last = out[out.length - 1];
        if (last && r[0] <= last[1] + 0.02) last[1] = Math.max(last[1], r[1]);
        else out.push([r[0], r[1]]);
    }
    return out;
}

/**
 * @param {Array<{start:number, duration:number}>} segments kept source ranges
 * @param {Array} baseClips the clips being replaced (offset, duration, speed)
 * @param {number} startAt timeline second where the first piece goes
 * @returns {{pieces: Array<{start,duration,srcEnd,outStart,speed}>, end: number}}
 */
export function packSegments(segments, baseClips, startAt = 0) {
    const clips = Array.isArray(baseClips) ? baseClips : [];
    const speedAtSource = (t) => {
        const c = clips.find(bc => {
            const from = Number(bc.offset) || 0;
            return t >= from - 0.01 && t < from + (Number(bc.duration) || 0) * (Number(bc.speed) || 1);
        });
        return (c && Number(c.speed) > 0) ? Number(c.speed) : 1;
    };
    const covered = sourceCoverage(clips);
    const ordered = (Array.isArray(segments) ? segments : []).slice().sort((a, b) => a.start - b.start);
    let acc = startAt;
    const pieces = [];
    for (const seg of ordered) {
        const segEnd = seg.start + seg.duration;
        for (const [cFrom, cTo] of covered) {
            const from = Math.max(seg.start, cFrom);
            const to = Math.min(segEnd, cTo);
            if (to - from < 0.05) continue;
            const speed = speedAtSource(from);
            pieces.push({ ...seg, start: from, duration: to - from, srcEnd: to, outStart: acc, speed });
            acc += (to - from) / speed;
        }
    }
    return { pieces, end: acc };
}

export default { sourceCoverage, packSegments };
