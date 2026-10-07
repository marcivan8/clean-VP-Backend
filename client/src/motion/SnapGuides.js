/**
 * client/src/motion/SnapGuides.js
 *
 * R92 round C: smart alignment while dragging text, captions, stickers,
 * templates and images on the player, like Figma, Canva or CapCut.
 *
 * Pure (no DOM, no store). Everything is in PERCENT of the frame, the same
 * units as clip.x / clip.y (which name the element's CENTRE).
 *
 * What snaps, in priority order when two are equally close:
 *   1. the frame centre lines (50 %);
 *   2. other elements' centres and edges;
 *   3. the frame's thirds;
 *   4. the safe margins (6 % in from each side; on a vertical frame also the
 *      top and bottom of the platform safe zone, where app buttons sit).
 * The element's centre AND its two edges are tested on each axis, so its
 * left edge can line up with another element's left edge, and so on.
 * Each axis snaps independently; holding Alt / Option disables snapping.
 */

/** Snap distance in screen pixels, converted to % with the frame size. */
export const SNAP_PX = 6;

const PRIORITY = { center: 0, element: 1, third: 2, margin: 3 };

/**
 * Lines on the frame itself.
 * @param {string} aspectRatio e.g. '9:16'
 * @returns {{x: Array<{pos:number, kind:string}>, y: Array<{pos:number, kind:string}>}}
 */
export function frameLines(aspectRatio = '16:9') {
    const vertical = String(aspectRatio) === '9:16' || String(aspectRatio) === '4:5';
    const x = [
        { pos: 50, kind: 'center' },
        { pos: 100 / 3, kind: 'third' }, { pos: 200 / 3, kind: 'third' },
        { pos: 6, kind: 'margin' }, { pos: 94, kind: 'margin' },
    ];
    const y = [
        { pos: 50, kind: 'center' },
        { pos: 100 / 3, kind: 'third' }, { pos: 200 / 3, kind: 'third' },
        { pos: vertical ? 12 : 6, kind: 'margin' }, { pos: vertical ? 72 : 94, kind: 'margin' },
    ];
    return { x, y };
}

/** Lines from other elements: their centre and both edges, per axis. */
export function elementLines(others = []) {
    const x = [];
    const y = [];
    for (const o of others) {
        if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
        const hw = (Number(o.w) || 0) / 2;
        const hh = (Number(o.h) || 0) / 2;
        x.push({ pos: o.x, kind: 'element', id: o.id }, { pos: o.x - hw, kind: 'element', id: o.id }, { pos: o.x + hw, kind: 'element', id: o.id });
        y.push({ pos: o.y, kind: 'element', id: o.id }, { pos: o.y - hh, kind: 'element', id: o.id }, { pos: o.y + hh, kind: 'element', id: o.id });
    }
    return { x, y };
}

function snapAxis(center, half, lines, threshold) {
    const probes = [{ off: 0, at: center }, { off: -half, at: center - half }, { off: half, at: center + half }];
    let best = null;
    for (const line of lines) {
        for (const p of probes) {
            const d = Math.abs(p.at - line.pos);
            if (d > threshold) continue;
            const score = d + (PRIORITY[line.kind] ?? 4) * 1e-3 + (p.off === 0 ? 0 : 5e-4);
            if (!best || score < best.score) best = { score, value: line.pos - p.off, line };
        }
    }
    return best;
}

/**
 * Snap a dragged box.
 * @param {{x:number, y:number, w?:number, h?:number}} box centre and size, % of frame
 * @param {{others?:Array, aspectRatio?:string, frameW?:number, frameH?:number, disabled?:boolean}} opts
 *   frameW / frameH are the frame's size in screen px (to turn SNAP_PX into %).
 * @returns {{x:number, y:number, guides:Array<{axis:'x'|'y', pos:number, kind:string}>}}
 */
export function computeSnap(box, opts = {}) {
    const x = Number(box?.x);
    const y = Number(box?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x, y, guides: [] };
    if (opts.disabled) return { x, y, guides: [] };
    const tx = (SNAP_PX / Math.max(1, Number(opts.frameW) || 600)) * 100;
    const ty = (SNAP_PX / Math.max(1, Number(opts.frameH) || 600)) * 100;
    const frame = frameLines(opts.aspectRatio);
    const els = elementLines(opts.others || []);
    const sx = snapAxis(x, (Number(box.w) || 0) / 2, [...frame.x, ...els.x], tx);
    const sy = snapAxis(y, (Number(box.h) || 0) / 2, [...frame.y, ...els.y], ty);
    const guides = [];
    if (sx) guides.push({ axis: 'x', pos: sx.line.pos, kind: sx.line.kind });
    if (sy) guides.push({ axis: 'y', pos: sy.line.pos, kind: sy.line.kind });
    return { x: sx ? sx.value : x, y: sy ? sy.value : y, guides };
}

/**
 * Where an element is drawn when x / y are not both set, the same rule as
 * TextOverlay and ClipAdapter ('top' 12 %, 'bottom' 85 %, else centre).
 * Used as the drag's starting point so the first drag never jumps.
 */
export function startPosition(clip) {
    const x = Number(clip?.x);
    const y = Number(clip?.y);
    if (Number.isFinite(x) && Number.isFinite(y) && clip?.x !== null && clip?.y !== null) return { x, y };
    if (clip?.position === 'top') return { x: 50, y: 12 };
    if (clip?.position === 'bottom') return { x: 50, y: 85 };
    return { x: 50, y: 50 };
}

/**
 * Measure the other draggable elements inside a frame element. Each one is
 * marked with data-snap-id. Returns boxes in % of the frame.
 */
export function measureOthers(frameEl, selfId) {
    if (!frameEl?.getBoundingClientRect) return [];
    const fr = frameEl.getBoundingClientRect();
    if (!(fr.width > 0) || !(fr.height > 0)) return [];
    const out = [];
    const nodes = frameEl.ownerDocument?.querySelectorAll?.('[data-snap-id]') || [];
    for (const n of nodes) {
        const id = n.getAttribute('data-snap-id');
        if (!id || id === selfId) continue;
        const r = n.getBoundingClientRect();
        if (!(r.width > 0)) continue;
        out.push({
            id,
            x: ((r.left + r.width / 2 - fr.left) / fr.width) * 100,
            y: ((r.top + r.height / 2 - fr.top) / fr.height) * 100,
            w: (r.width / fr.width) * 100,
            h: (r.height / fr.height) * 100,
        });
    }
    return out;
}

export default { SNAP_PX, frameLines, elementLines, computeSnap, startPosition, measureOthers };
