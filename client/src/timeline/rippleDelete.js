/**
 * rippleDelete.js — main-track magnet (CapCut-style gap closing on delete).
 *
 * Pure and dependency-free: takes the store's legacy `tracks` array and the
 * ids being deleted, and returns the edit to apply. The store action
 * (useTimelineStore.rippleDeleteClip) owns history, dispatch and cleanup.
 *
 * Rules:
 *  - Only clips deleted from the MAIN video track open a gap that gets closed.
 *    Deleting from any other track (b-roll video track, text, audio, overlay)
 *    is a plain delete: nothing else moves.
 *  - When main-track time is deleted, every remaining clip on the main track
 *    AND on text tracks (captions / text overlays) is remapped through the
 *    deletion: new start = old start − (deleted main-track time before it).
 *    Captions therefore stay synced to the speech they belong to.
 *    A text clip that started INSIDE a deleted range lands on the cut point
 *    (it is kept, never auto-deleted — undo restores everything anyway).
 *  - Audio and overlay tracks never move (music keeps its own timing).
 *
 * The main track is picked exactly the way the exporter picks its base track
 * (motion/Compositor.js sortedVisualTracks + baseTrack): the first
 * video/image track by `order`, falling back to array position.
 */

const EPS = 1e-3;

export function getMainVideoTrackId(tracks) {
    const visual = (Array.isArray(tracks) ? tracks : [])
        .map((t, idx) => ({ t, idx }))
        .filter(({ t }) => t && (t.type === 'video' || t.type === 'image') && Array.isArray(t.clips));
    if (visual.length === 0) return null;
    const orderOf = ({ t, idx }) => (Number.isFinite(Number(t.order)) ? Number(t.order) : idx);
    visual.sort((a, b) => orderOf(a) - orderOf(b));
    return visual[0].t.id;
}

/** Deleted main-track time strictly before timeline time t. */
function deletedTimeBefore(t, ranges) {
    return ranges.reduce((sum, [a, b]) => (t <= a + EPS ? sum : sum + (Math.min(t, b) - a)), 0);
}

function mergeRanges(ranges) {
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [a, b] of sorted) {
        const last = out[out.length - 1];
        if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
        else out.push([a, b]);
    }
    return out;
}

/**
 * @param {Array} tracks     legacy tracks ({ id, type, order?, clips: [{ id, start, duration }] })
 * @param {Array} targetIds  clip (placement) ids being deleted
 * @returns {{ mainTrackId: string|null,
 *             removeIds: Array<{trackId, clipId}>,
 *             removedRanges: Array<[number, number]>,   // merged main-track ranges
 *             moves: Array<{trackId, clipId, from, start}> }}
 */
export function computeRippleDelete(tracks, targetIds) {
    const list = Array.isArray(tracks) ? tracks : [];
    const ids = new Set(Array.isArray(targetIds) ? targetIds : []);
    const mainTrackId = getMainVideoTrackId(list);

    const removeIds = [];
    const rawRanges = [];
    for (const track of list) {
        for (const clip of track?.clips || []) {
            if (!ids.has(clip.id)) continue;
            removeIds.push({ trackId: track.id, clipId: clip.id });
            if (track.id === mainTrackId) {
                const start = Number(clip.start) || 0;
                const dur = Math.max(0, Number(clip.duration) || 0);
                if (dur > EPS) rawRanges.push([start, start + dur]);
            }
        }
    }

    const removedRanges = mergeRanges(rawRanges);
    const moves = [];
    if (removedRanges.length > 0) {
        const deletedBefore = (t) => deletedTimeBefore(t, removedRanges);

        for (const track of list) {
            const shifts = track?.id === mainTrackId || track?.type === 'text';
            if (!shifts) continue;
            for (const clip of track.clips || []) {
                if (ids.has(clip.id)) continue;
                const from = Number(clip.start) || 0;
                const shift = deletedBefore(from);
                if (shift > EPS) {
                    moves.push({ trackId: track.id, clipId: clip.id, from, start: Math.max(0, from - shift) });
                }
            }
        }
    }

    return { mainTrackId, removeIds, removedRanges, moves };
}

/**
 * Remap the store's word-level caption array (`captions`, timeline time —
 * what Player/CaptionOverlay reads against currentTime) through the same
 * deletion, so the preview captions stay in sync with the moved clips.
 * Words that were spoken entirely inside a deleted range are dropped, the
 * same rule cutSourceRange already applies to this array.
 */
export function remapTimelineWords(words, removedRanges) {
    if (!Array.isArray(words) || words.length === 0) return words;
    if (!Array.isArray(removedRanges) || removedRanges.length === 0) return words;
    const out = [];
    for (const w of words) {
        const start = Number(w?.start);
        const end = Number(w?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) { out.push(w); continue; }
        const inside = removedRanges.some(([a, b]) => start >= a - EPS && end <= b + EPS);
        if (inside) continue;
        const newStart = Math.max(0, start - deletedTimeBefore(start, removedRanges));
        const newEnd = Math.max(0, end - deletedTimeBefore(end, removedRanges));
        if (newEnd <= newStart) continue;
        out.push(newStart === start && newEnd === end ? w : { ...w, start: newStart, end: newEnd });
    }
    return out;
}

/**
 * The empty gap on a track at timeline time `time`: from the end of the clip
 * before it (or 0) to the start of the clip after it. Returns null when
 * `time` is on a clip, when there is no clip after it (nothing to pull in),
 * or when the gap is ~0.
 */
export function findGapAt(tracks, trackId, time) {
    const track = (Array.isArray(tracks) ? tracks : []).find(t => t?.id === trackId);
    if (!track) return null;
    const t = Number(time) || 0;
    let prevEnd = 0;
    let nextStart = null;
    for (const c of track.clips || []) {
        const s = Number(c.start) || 0;
        const e = s + (Number(c.duration) || 0);
        if (s < t - EPS && e > t + EPS) return null; // right-clicked on a clip
        if (e <= t + EPS) prevEnd = Math.max(prevEnd, e);
        if (s >= t - EPS) nextStart = nextStart === null ? s : Math.min(nextStart, s);
    }
    if (nextStart === null || nextStart - prevEnd <= EPS) return null;
    return [prevEnd, nextStart];
}

/**
 * Plan a ripple delete of the GAP at `time` on `trackId` (right-click on
 * empty timeline space → Ripple Delete).
 *  - Main video track: same remap as deleting a main-track clip — later
 *    main-track clips and text/caption clips slide left by the gap length
 *    (captions stay synced; `removedRanges` lets the store remap the
 *    word-level captions too).
 *  - Any other track: only that track's clips after the gap slide left.
 */
export function computeGapRipple(tracks, trackId, time) {
    const list = Array.isArray(tracks) ? tracks : [];
    const mainTrackId = getMainVideoTrackId(list);
    const isMainTrack = trackId === mainTrackId;
    const gap = findGapAt(list, trackId, time);
    if (!gap) return { gap: null, isMainTrack, removedRanges: [], moves: [] };

    const [a, b] = gap;
    const length = b - a;
    const moves = [];
    for (const track of list) {
        const shifts = isMainTrack
            ? (track?.id === mainTrackId || track?.type === 'text')
            : track?.id === trackId;
        if (!shifts) continue;
        for (const clip of track.clips || []) {
            const from = Number(clip.start) || 0;
            const shift = isMainTrack
                ? deletedTimeBefore(from, [gap])
                : (from >= b - EPS ? length : 0);
            if (shift > EPS) moves.push({ trackId: track.id, clipId: clip.id, from, start: Math.max(0, from - shift) });
        }
    }
    return { gap, isMainTrack, removedRanges: isMainTrack ? [gap] : [], moves };
}
