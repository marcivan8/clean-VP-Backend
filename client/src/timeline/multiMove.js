/**
 * multiMove.js — move several selected clips together (desktop multi-drag).
 *
 * Pure and dependency-free: takes the store's legacy `tracks`, the selected
 * clip ids and a time delta (seconds), returns the new start of every clip
 * that has to move. The store action (useTimelineStore.moveSelectedClips)
 * owns history and dispatch.
 *
 * Rules (agreed behaviour):
 *  - Time only: every clip keeps its own track.
 *  - All selected clips shift by the same delta; the delta is clamped so the
 *    earliest selected clip never goes below 0 (relative spacing is kept).
 *  - Handled per track. If the moved clips don't land on anything on that
 *    track, it's a plain move.
 *  - If they land on other clips, CapCut-style swap: the clips they passed
 *    slide into the space the selection left, and the selection snaps into
 *    the slot right after them (moving right) or right before them (moving
 *    left). A clip only counts as "passed" once the selection crosses its
 *    midpoint; otherwise the selection snaps up against it instead.
 *    Example (moving B+C right onto D):  A B C D  →  A D B C
 *  - The only case refused is when a track's selection has an unselected
 *    clip sitting BETWEEN selected clips: there is no unambiguous swap, so
 *    the whole move is cancelled ({ ok: false, reason: 'interleaved' }).
 * No clip ever ends up overlapping another on the same track.
 */

const EPS = 1e-3;
const num = (v) => Number(v) || 0;
const endOf = (c) => num(c.start) + num(c.duration);
const midOf = (c) => num(c.start) + num(c.duration) / 2;
const overlaps = (aStart, aEnd, c) => aStart < endOf(c) - EPS && aEnd > num(c.start) + EPS;

/**
 * @param {Array} tracks        legacy tracks ({ id, clips: [{ id, start, duration }] })
 * @param {Array} selectedIds   clip ids being moved
 * @param {number} delta        requested time shift in seconds (+ right, − left)
 * @returns {{ ok: true, delta: number, updates: Array<{trackId, clipId, from, start}> }
 *          | { ok: false, reason: string, trackId?: string }}
 */
export function computeMultiMove(tracks, selectedIds, delta) {
    const list = Array.isArray(tracks) ? tracks : [];
    const ids = new Set(Array.isArray(selectedIds) ? selectedIds : []);
    let d = num(delta);

    const perTrack = [];
    let minStart = Infinity;
    for (const track of list) {
        const clips = (track?.clips || []).slice().sort((a, b) => num(a.start) - num(b.start));
        const sel = clips.filter(c => ids.has(c.id));
        if (sel.length === 0) continue;
        const others = clips.filter(c => !ids.has(c.id));
        perTrack.push({ track, sel, others });
        for (const c of sel) minStart = Math.min(minStart, num(c.start));
    }
    if (perTrack.length === 0) return { ok: false, reason: 'empty' };

    // Clamp so the whole selection keeps its spacing and never goes below 0.
    if (minStart + d < 0) d = -minStart;
    if (Math.abs(d) < EPS) return { ok: true, delta: 0, updates: [] };

    const updates = [];
    for (const { track, sel, others } of perTrack) {
        const s0 = num(sel[0].start);
        const e0 = Math.max(...sel.map(endOf));
        const L = e0 - s0; // span of the selection on this track, internal gaps included

        // An unselected clip between selected ones → no clean swap exists.
        if (others.some(o => num(o.start) >= s0 - EPS && endOf(o) <= e0 + EPS)) {
            return { ok: false, reason: 'interleaved', trackId: track.id };
        }

        const ns = s0 + d;
        const ne = e0 + d;
        const lands = sel.some(c => {
            const cs = num(c.start) + d, ce = endOf(c) + d;
            return others.some(o => overlaps(cs, ce, o));
        });

        let newStart; // new start of the selection's span on this track
        const moves = [];
        if (!lands) {
            newStart = ns;
        } else if (d > 0) {
            const after = others.filter(o => num(o.start) >= e0 - EPS); // already sorted
            const passed = after.filter(o => midOf(o) < ne);            // a prefix of `after`
            if (passed.length > 0) {
                const regionEnd = Math.max(...passed.map(endOf));
                passed.forEach(o => moves.push({ clip: o, start: num(o.start) - L }));
                newStart = regionEnd - L;
            } else {
                newStart = num(after[0].start) - L; // snap up against the next clip
            }
        } else {
            const before = others.filter(o => endOf(o) <= s0 + EPS).reverse(); // nearest first
            const passed = before.filter(o => midOf(o) > ns);
            if (passed.length > 0) {
                const regionStart = Math.min(...passed.map(o => num(o.start)));
                passed.forEach(o => moves.push({ clip: o, start: num(o.start) + L }));
                newStart = regionStart;
            } else {
                newStart = endOf(before[0]); // snap up against the previous clip
            }
        }

        const shift = newStart - s0;
        for (const c of sel) {
            updates.push({ trackId: track.id, clipId: c.id, from: num(c.start), start: Math.max(0, num(c.start) + shift) });
        }
        for (const m of moves) {
            updates.push({ trackId: track.id, clipId: m.clip.id, from: num(m.clip.start), start: Math.max(0, m.start) });
        }
    }

    return { ok: true, delta: d, updates: updates.filter(u => Math.abs(u.start - u.from) > EPS) };
}
