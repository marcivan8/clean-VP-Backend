/**
 * speedChange.js — what a clip speed change does to the timeline. Pure; the
 * store action (useTimelineStore.setClipSpeed) owns history and dispatch.
 *
 * Model: a clip's `duration` is its TIMELINE length and it shows
 * `duration × speed` seconds of source starting at `offset`. A speed change
 * keeps that same piece of source, so the clip's length becomes
 * duration × oldSpeed / newSpeed.
 *
 * Rules (same spirit as rippleDelete.js):
 *  - Later clips on the SAME track move by the length change, so slowing a
 *    clip down never runs it over the next one and speeding it up leaves no
 *    gap.
 *  - On the MAIN video track, text tracks (captions / titles) follow: a text
 *    clip inside the changed clip is stretched/squeezed with it, one after it
 *    moves by the length change. Word-level captions (store.captions) are
 *    remapped the same way (mapTime).
 *  - Audio and overlay tracks never move (music keeps its own timing).
 */
import { getMainVideoTrackId } from './rippleDelete.js';

const EPS = 1e-3;

/**
 * @returns null when the clip is not found, else
 *   { newSpeed, newDuration, delta, factor, isMain,
 *     moves: [{ clipId, start, duration? }],   // other placements to update
 *     mapTime: (t) => t' }                      // timeline time remap (main track only)
 */
export function computeSpeedChange(tracks, trackId, clipId, speed) {
    const list = Array.isArray(tracks) ? tracks : [];
    const track = list.find(t => t?.id === trackId) || list.find(t => (t?.clips || []).some(c => c.id === clipId));
    const clip = (track?.clips || []).find(c => c.id === clipId);
    if (!clip) return null;

    const oldSpeed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    const newSpeed = Number(speed) > 0 ? Number(speed) : 1;
    const start = Number(clip.start) || 0;
    const dur = Number(clip.duration) || 0;
    const oldEnd = start + dur;
    const factor = oldSpeed / newSpeed;
    const newDuration = dur * factor;
    const delta = newDuration - dur;
    const isMain = getMainVideoTrackId(list) === track.id;

    const mapTime = (t) => {
        const x = Number(t);
        if (!Number.isFinite(x) || x < start - EPS) return x;
        if (x < oldEnd - EPS) return start + (x - start) * factor;
        return x + delta;
    };

    const moves = [];
    if (Math.abs(delta) > EPS) {
        for (const c of track.clips || []) {
            if (c.id === clipId) continue;
            const s = Number(c.start) || 0;
            if (s >= oldEnd - EPS) moves.push({ clipId: c.id, start: Math.max(0, s + delta) });
        }
        if (isMain) {
            for (const t of list) {
                if (t?.type !== 'text') continue;
                for (const c of t.clips || []) {
                    const s = Number(c.start) || 0;
                    if (s >= oldEnd - EPS) moves.push({ clipId: c.id, start: Math.max(0, s + delta) });
                    else if (s >= start - EPS) {
                        moves.push({ clipId: c.id, start: start + (s - start) * factor, duration: Math.max(0.05, (Number(c.duration) || 0) * factor) });
                    }
                }
            }
        }
    }

    return { newSpeed, newDuration, delta, factor, isMain, moves, mapTime };
}

/** Word-level timeline captions through a speed change (main track only). */
export function remapWordsForSpeed(words, plan) {
    if (!plan?.isMain || !Array.isArray(words) || Math.abs(plan.delta) <= EPS) return words;
    return words.map(w => ({ ...w, start: plan.mapTime(w.start), end: plan.mapTime(w.end) }));
}
