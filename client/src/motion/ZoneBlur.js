/**
 * client/src/motion/ZoneBlur.js
 *
 * R99 — freeform zone blur (stickers were R97, generic shadows R98; this is
 * the third and last of the three missing editing features Marc picked).
 * Blurs a STATIC rectangle of a clip's own frame for its full on-screen
 * duration — a logo, a phone screen, a license plate, a piece of on-screen
 * text, anything MatteBaker.js's person segmentation was never built to
 * find. Deliberately NOT a tracked region: Marc explicitly did not pick
 * "object tracking beyond people" among the options he approved, so this
 * is a fixed box, not a region that follows a moving subject.
 *
 * clip.blurZone = { x, y, w, h, blur } — x/y/w/h are FRAME FRACTIONS (0..1,
 * top-left origin), the same convention LayoutPresets.js uses for
 * clip.frame. `blur` is a blur radius in px of a 1080-wide reference frame,
 * the same convention clip.shadow's dx/dy/blur (R98) already established:
 * raw CSS px in the preview (BlurZoneOverlay.jsx's backdrop-filter), scaled
 * by frame.width/1080 in the export (jobs/exportProcessor.js) so a blur
 * reads the same visual size whether exporting at 720p or 4K — "the same
 * 'one place the plan meets a pixel' rule this file's header documents for
 * geometry" (CompositorCompiler.js's own phrase for the identical rule).
 *
 * Pure module: no DOM, no network, no ffmpeg invocation. The export side
 * loads this with a dynamic import() of this exact file, the same trick
 * jobs/exportProcessor.js already uses for MatteSettings.js (loadMatteSettings).
 */

const clampFrac = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d;
};

/** Normalise a possibly-partial/garbage zone. Never throws. */
export function normalizeZone(zone) {
    const z = zone && typeof zone === 'object' ? zone : {};
    const x = clampFrac(z.x, 0.6);
    const y = clampFrac(z.y, 0);
    // w/h are clamped against their own axis's remaining room so the box
    // never runs off the right/bottom edge of the frame.
    const w = Math.max(0.02, Math.min(1 - x, clampFrac(z.w, 0.35)));
    const h = Math.max(0.02, Math.min(1 - y, clampFrac(z.h, 0.35)));
    const blurN = Number(z.blur);
    return { x, y, w, h, blur: Number.isFinite(blurN) ? Math.max(1, blurN) : 24 };
}

/** True when a clip carries a usable zone (guards the preview + export call sites). */
export function hasBlurZone(clip) {
    const z = clip?.blurZone;
    return !!(z && [z.x, z.y, z.w, z.h].every(Number.isFinite) && z.w > 0 && z.h > 0);
}

/**
 * FFmpeg filter_complex lines for one zone-blurred clip: split the already-
 * composed frame into two copies, crop+blur one of them to the zone's own
 * box, then overlay it back at the same position over the untouched copy.
 * Pure, stateless — same split/crop/blur/overlay-back shape
 * CompositorCompiler.js's compileShadowSource uses for drop shadows, just
 * keyed by a fixed rectangle instead of a sprite's own alpha silhouette.
 *
 * @param {object} zone   a (possibly raw) zone descriptor — normalized here
 * @param {{width:number, height:number, inLabel:string, outLabel:string}} opts
 *   inLabel  an EXISTING labeled stream (e.g. after scale/crop/lut — the
 *            zone's x/y/w/h fractions are of THIS frame, already at the
 *            export's target resolution)
 *   outLabel the label this graph's final statement produces
 * @returns {string[]} filter_complex statement lines, ending in `[outLabel]`
 */
export function zoneBlurFilterGraph(zone, { width, height, inLabel, outLabel }) {
    const z = normalizeZone(zone);
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    const REFERENCE_WIDTH = 1080;
    const scale = w / REFERENCE_WIDTH;
    // A touch softer floor than a razor-sharp crop edge, same reasoning as
    // compileShadowSource's own sigma floor.
    const sigma = Math.max(0.5, (z.blur * scale) / 2);
    const bx = Math.max(0, Math.min(w - 2, Math.round(z.x * w)));
    const by = Math.max(0, Math.min(h - 2, Math.round(z.y * h)));
    const bw = Math.max(2, Math.min(w - bx, Math.round(z.w * w)));
    const bh = Math.max(2, Math.min(h - by, Math.round(z.h * h)));
    return [
        `[${inLabel}]split[zb_a][zb_b]`,
        `[zb_a]crop=${bw}:${bh}:${bx}:${by},gblur=sigma=${sigma.toFixed(2)}[zb_blur]`,
        `[zb_b][zb_blur]overlay=${bx}:${by}[${outLabel}]`,
    ];
}

export default { normalizeZone, hasBlurZone, zoneBlurFilterGraph };
