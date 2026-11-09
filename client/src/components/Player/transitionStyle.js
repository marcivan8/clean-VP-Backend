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

/**
 * CSS filter list for the base video: the LUT first (applied at clip level in
 * export), then the transition.
 *
 * `cheap` (phones) swaps the SVG filter for a plain CSS blur. The SVG chain is
 * a Gaussian blur plus four colour matrices, two offsets and two blends over a
 * live video, re-evaluated every frame with changing attributes — on a phone
 * GPU that is the single most expensive thing in the preview, and it is why
 * playback stutters through a cut. CSS blur() composites on the GPU and keeps
 * the directional feel; what is lost is the red/blue split, in the preview
 * only. The export samples motion/TransitionFX.js directly and is unchanged.
 */
export function transitionFilter(fx, lutFilter, { cheap = false, frameWidth = 0 } = {}) {
    const lut = lutFilter && lutFilter !== 'none' ? lutFilter : '';
    const active = fx && (fx.blurX > 1e-6 || fx.blurY > 1e-6 || Math.abs(fx.chroma) > 1e-6);
    // blurX/blurY are fractions of the frame width — the same convention the
    // SVG chain uses when it scales them for stdDeviation.
    const px = Math.max(Number(fx?.blurX) || 0, Number(fx?.blurY) || 0) * (Number(frameWidth) || 0);
    const effect = !active ? ''
        : cheap
            ? (px > 0.05 ? `blur(${px.toFixed(2)}px)` : '')
            : `url(#${TFX_FILTER_ID})`;
    const parts = [lut, effect].filter(Boolean);
    return parts.length ? parts.join(' ') : 'none';
}

