/**
 * captionFollow.js — after main-track clips are moved (mobile long-press
 * reorder), move the caption / text clips that sat over each moved clip by the
 * same amount, so the words stay on the speech they belong to.
 *
 * A text clip follows the main-track clip its START was over, before the move.
 * Text clips over clips that didn't move, or over empty space, stay put. Pure.
 */
import { getMainVideoTrackId } from './rippleDelete.js';

const EPS = 1e-3;

/**
 * @param {Array} prevTracks legacy tracks before the move
 * @param {Array} nextTracks legacy tracks after the move
 * @returns {Array<{ clipId: string, start: number }>} new starts for text clips
 */
export function computeCaptionFollow(prevTracks, nextTracks) {
    const prev = Array.isArray(prevTracks) ? prevTracks : [];
    const next = Array.isArray(nextTracks) ? nextTracks : [];
    const mainId = getMainVideoTrackId(prev);
    const prevMain = prev.find(t => t?.id === mainId)?.clips || [];
    const nextMain = next.find(t => t?.id === mainId)?.clips || [];
    const newStart = new Map(nextMain.map(c => [c.id, Number(c.start) || 0]));

    const moved = prevMain
        .map(c => ({ id: c.id, s: Number(c.start) || 0, e: (Number(c.start) || 0) + (Number(c.duration) || 0) }))
        .filter(c => newStart.has(c.id) && Math.abs(newStart.get(c.id) - c.s) > EPS);
    if (moved.length === 0) return [];

    const out = [];
    for (const track of prev) {
        if (track?.type !== 'text') continue;
        for (const clip of track.clips || []) {
            const s = Number(clip.start) || 0;
            const owner = moved.find(m => s >= m.s - EPS && s < m.e - EPS);
            if (!owner) continue;
            const start = Math.max(0, s + (newStart.get(owner.id) - owner.s));
            if (Math.abs(start - s) > EPS) out.push({ clipId: clip.id, start });
        }
    }
    return out;
}
