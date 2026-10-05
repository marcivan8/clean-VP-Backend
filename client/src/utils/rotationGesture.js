/**
 * rotationGesture.js — shared maths for the on-canvas rotate handle
 * (TextOverlay captions and GraphicOverlay stickers).
 *
 * Rotation is stored on the clip as `clip.rotation`, in degrees, clockwise,
 * the same field `ClipAdapter.clipToMotionLayer` already reads as the layer's
 * base rotation. Animated presets add to it; the handle only edits the base.
 */

/** Normalise any angle to (-180, 180]. */
export function normaliseDegrees(deg) {
    const n = Number(deg);
    if (!Number.isFinite(n)) return 0;
    let d = ((n % 360) + 360) % 360;
    if (d > 180) d -= 360;
    return Math.round(d * 10) / 10;
}

/**
 * Snap behaviour:
 *  - fine === true (Shift held): round to the nearest 15°.
 *  - otherwise: snap to 0 / ±90 / 180 when within `magnet` degrees, so a
 *    caption that was nudged by hand can always be put back perfectly level.
 */
export function snapRotation(deg, { fine = false, magnet = 4 } = {}) {
    const d = normaliseDegrees(deg);
    if (fine) return normaliseDegrees(Math.round(d / 15) * 15);
    for (const target of [-180, -90, 0, 90, 180]) {
        if (Math.abs(d - target) <= magnet) return normaliseDegrees(target);
    }
    return d;
}

/** Angle (degrees, clockwise from "up") of a point around a centre. */
export function pointerAngle(center, clientX, clientY) {
    const dx = clientX - center.x;
    const dy = clientY - center.y;
    return (Math.atan2(dy, dx) * 180) / Math.PI + 90;
}

/**
 * Start a rotate drag. `getCenter()` returns the element centre in client
 * pixels. `onChange(deg)` fires on every move (live, no history); `onCommit(deg)`
 * fires once on release. Listeners are on window so the pointer may leave the
 * handle without dropping the gesture.
 */
export function startRotationGesture(e, { getCenter, initialRotation = 0, onChange, onCommit }) {
    const center = getCenter();
    if (!center) return;
    const startAngle = pointerAngle(center, e.clientX, e.clientY);
    const base = Number(initialRotation) || 0;
    let last = normaliseDegrees(base);

    const onMove = (ev) => {
        const raw = base + (pointerAngle(center, ev.clientX, ev.clientY) - startAngle);
        const next = snapRotation(raw, { fine: !!ev.shiftKey });
        if (next === last) return;
        last = next;
        try { onChange?.(next); } catch (err) { console.error('[rotationGesture] onChange failed:', err); }
    };
    const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try { onCommit?.(last); } catch (err) { console.error('[rotationGesture] onCommit failed:', err); }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
}
