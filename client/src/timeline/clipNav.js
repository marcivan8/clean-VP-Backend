/**
 * clipNav.js — previous / next clip boundary on the MAIN track, for the
 * mobile transport row's ⏮ / ⏭ buttons. Pure.
 *
 * Previous: the start of the clip under the playhead, or of the clip before it
 * when the playhead is already (almost) at a clip start, so repeated taps walk
 * backwards like a music player. Next: the next clip start, else the end of
 * the last clip.
 */
import { getMainVideoTrackId } from './rippleDelete.js';

const NEAR = 0.25; // s — "already at this boundary"

function boundaries(tracks) {
    const list = Array.isArray(tracks) ? tracks : [];
    const main = list.find(t => t?.id === getMainVideoTrackId(list));
    const clips = (main?.clips || []).filter(c => Number(c?.duration) > 0);
    const starts = clips.map(c => Number(c.start) || 0);
    const ends = clips.map(c => (Number(c.start) || 0) + Number(c.duration));
    return {
        starts: [...new Set(starts)].sort((a, b) => a - b),
        end: ends.length ? Math.max(...ends) : 0,
    };
}

export function prevClipBoundary(tracks, time) {
    const t = Number(time) || 0;
    const { starts } = boundaries(tracks);
    let best = 0;
    for (const s of starts) if (s < t - NEAR) best = s;
    return best;
}

export function nextClipBoundary(tracks, time) {
    const t = Number(time) || 0;
    const { starts, end } = boundaries(tracks);
    for (const s of starts) if (s > t + 0.01) return s;
    return Math.max(t, end);
}
