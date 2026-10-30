/**
 * resizeGesture.js — shared maths for the on-canvas resize handles, for any
 * draggable clip: overlay stickers (GraphicOverlay.jsx), captions
 * (TextOverlay.jsx) and, as of R100, base video/image layers too
 * (BaseClipOverlay.jsx).
 *
 * Resize is stored on the clip as `clip.scale`. As of R119 the corner
 * handles (ResizeHandle.jsx renders all four — nw/ne/sw/se) are the ONLY
 * way to resize; the two-finger pinch gesture that used to also write
 * `clip.scale` at each call site was removed so there is exactly one
 * resize affordance. Distance-from-centre is what drives the ratio, not
 * which corner was grabbed, so the same gesture serves every corner
 * unchanged — the wrapper is always rendered with
 * `transform: translate(-50%, -50%) ...`, so dragging any corner never
 * moves clip.x/clip.y.
 */

export function clampScale(scale, { min = 0.1, max = 5 } = {}) {
    const n = Number(scale);
    if (!Number.isFinite(n)) return 1;
    return Math.min(max, Math.max(min, n));
}

export function scaleFromDistanceRatio(initialScale, startDistance, currentDistance, { min = 0.1, max = 5 } = {}) {
    if (!(Number(startDistance) > 0) || !Number.isFinite(Number(currentDistance))) {
        return clampScale(initialScale, { min, max });
    }
    return clampScale(Number(initialScale) * (Number(currentDistance) / Number(startDistance)), { min, max });
}

function distance(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay);
}

/**
 * Start a corner-drag resize. `getCenter()` returns the clip element's centre
 * in client pixels. The pointer-down distance from that centre is the "1x"
 * reference distance; dragging further out scales up, dragging in scales
 * down — the same distRatio idea the existing pinch gesture uses, driven by
 * one pointer instead of two.
 *
 * `onChange(scale)` fires on every move (live, no history); `onCommit(scale)`
 * fires once on release. Listeners are on window so the pointer may leave the
 * handle without dropping the gesture.
 */
export function startResizeGesture(e, { getCenter, initialScale = 1, minScale = 0.1, maxScale = 5, onChange, onCommit }) {
    const center = getCenter();
    if (!center) return;
    const startDist = distance(center.x, center.y, e.clientX, e.clientY);
    if (!(startDist > 0)) return;
    const base = clampScale(initialScale, { min: minScale, max: maxScale });
    let last = base;

    const onMove = (ev) => {
        const liveDist = distance(center.x, center.y, ev.clientX, ev.clientY);
        const next = scaleFromDistanceRatio(base, startDist, liveDist, { min: minScale, max: maxScale });
        if (next === last) return;
        last = next;
        try { onChange?.(next); } catch (err) { console.error('[resizeGesture] onChange failed:', err); }
    };
    const onUp = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        try { onCommit?.(last); } catch (err) { console.error('[resizeGesture] onCommit failed:', err); }
    };
    // Capture before React's clip-level onPointerMove/onPointerUp handlers.
    // Those handlers stop propagation so their drag gesture cannot also move
    // the clip, but doing that in the bubble phase used to swallow these
    // window listeners whenever the pointer remained inside the preview.
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
}
