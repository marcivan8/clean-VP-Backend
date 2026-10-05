/**
 * R89 — CSS for the base video during a transition (used by VideoPlayer and
 * TransitionLayer). Parameters come from motion/TransitionFX.js.
 */
export const TFX_FILTER_ID = 'vibed-tfx-filter';

/** CSS transform for the base video: the transition about the frame centre, composed with the clip's own transform. */
export function transitionTransform(fx, clipTransform, transformOrigin) {
    const base = clipTransform || '';
    if (!fx || (Math.abs(fx.tx) < 1e-5 && Math.abs(fx.scale - 1) < 1e-5)) return base || undefined;
    // The element's origin may not be the centre (talking-head anchor 50% 28%):
    // move to the centre, apply the transition, move back, then the clip transform.
    const m = /(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/.exec(String(transformOrigin || ''));
    const ox = m ? Number(m[1]) : 50;
    const oy = m ? Number(m[2]) : 50;
    const fxPart = `translate(${50 - ox}%, ${50 - oy}%) translateX(${(fx.tx * 100).toFixed(3)}%) scale(${fx.scale.toFixed(4)}) translate(${ox - 50}%, ${oy - 50}%)`;
    return `${fxPart} ${base}`.trim();
}

/** CSS filter list for the base video: the LUT first (applied at clip level in export), then the transition. */
export function transitionFilter(fx, lutFilter) {
    const lut = lutFilter && lutFilter !== 'none' ? lutFilter : '';
    const active = fx && (fx.blurX > 1e-6 || fx.blurY > 1e-6 || Math.abs(fx.chroma) > 1e-6);
    const parts = [lut, active ? `url(#${TFX_FILTER_ID})` : ''].filter(Boolean);
    return parts.length ? parts.join(' ') : 'none';
}

