/**
 * dragSnap.js — the "in-place magnet" while dragging clips (CapCut-style).
 *
 * Pure and dependency-free. Given the clips being dragged and the raw drag
 * offset, returns the offset adjusted so the nearest edge of the moving
 * clips sits exactly on the nearest snap point, when it is within the
 * threshold. Used live during the drag (a dnd-kit modifier in IDELayout.jsx,
 * so the clips visibly click into place) and again on drop, so what you see
 * while dragging is exactly where the clips land.
 *
 * Snap points: timeline start (0), the playhead, and the start/end of every
 * clip that isn't being moved, on any track. Every edge of every moving clip
 * is considered, so a multi-selection snaps by whichever of its clips is
 * closest to something — not only by the clip under the cursor.
 */

const num = (v) => Number(v) || 0;

/**
 * @param {object}  p
 * @param {Array}   p.tracks        legacy tracks ({ clips: [{ id, start, duration }] })
 * @param {Array}   p.movingIds     ids of the clips being dragged
 * @param {number}  p.deltaSec      raw drag offset in seconds
 * @param {number}  p.thresholdSec  snap distance in seconds (px / zoom)
 * @param {number} [p.currentTime]  playhead, also a snap point
 * @returns {{ deltaSec: number, snapTime: number|null }}
 */
export function computeDragSnap({ tracks, movingIds, deltaSec, thresholdSec, currentTime = null }) {
    const ids = new Set(Array.isArray(movingIds) ? movingIds : []);
    let delta = num(deltaSec);
    const moving = [];
    const points = [0];
    if (Number.isFinite(Number(currentTime))) points.push(Number(currentTime));

    for (const t of Array.isArray(tracks) ? tracks : []) {
        for (const c of t?.clips || []) {
            const s = num(c.start), e = s + num(c.duration);
            if (ids.has(c.id)) moving.push([s, e]);
            else points.push(s, e);
        }
    }
    if (moving.length === 0) return { deltaSec: delta, snapTime: null };

    // Never let the moving block start before 0.
    const minStart = Math.min(...moving.map(([s]) => s));
    if (minStart + delta < 0) delta = -minStart;

    const threshold = Math.max(0, num(thresholdSec));
    let best = null;
    for (const [s, e] of moving) {
        for (const edge of [s + delta, e + delta]) {
            for (const p of points) {
                const dist = Math.abs(p - edge);
                if (dist <= threshold && (best === null || dist < best.dist)) {
                    best = { dist, shift: p - edge, point: p };
                }
            }
        }
    }
    if (!best) return { deltaSec: delta, snapTime: null };

    const snapped = delta + best.shift;
    if (minStart + snapped < -1e-6) return { deltaSec: delta, snapTime: null };
    return { deltaSec: snapped, snapTime: best.point };
}
