/**
 * client/src/motion/DuoSplit.js
 *
 * Two-speaker stacked split screen for vertical shorts: the HOST in the top
 * half, the GUEST in the bottom half, both cut from ONE wide shot where the two
 * people sit side by side (a 16:9 interview).
 *
 * Pure: no store, no DOM.
 *
 * ─── THE MODEL ─────────────────────────────────────────────────────────────
 * Each half is an overlay copy of the base clip with a layout frame
 * (LayoutPresets.js): `{ preset: 'duo', x: 0, y: 0 | 0.5, w: 1, h: 0.5,
 * fit: 'cover', focusX, focusY, zoom }`. `zoom` scales the cover past the box
 * so one face fills a half instead of both people. Preview (frameToCss) and
 * export (CompositorCompiler) apply the same arithmetic, see frameToCss.
 *
 * Why two overlays and not a virtualCam crop on the base for the top half: a
 * crop must stay inside the source, and with half the source height visible a
 * face at cy 0.45 would be clamped down to the seam. An overlay box can aim
 * anywhere, so both halves use one formula and frame the faces identically.
 *
 * Face anchors come from the virtual-multicam scene analysis
 * (`sceneAnalysisByAsset[assetId]`, mode 'duo': `layout.anchors[].anchor =
 * {cx, cy, h}` in source fractions, `hostSide` 'left' | 'right').
 */

/** Face height as a share of a half's height. */
const FACE_SHARE = 0.32;
/** Face centre, from the top of its half. */
const FACE_FROM_TOP = 0.42;
/** Faces closer than this (source width) are the same person or unusable. */
const MIN_SEPARATION = 0.12;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * The host and guest face anchors of a duo scene analysis, or null.
 * @returns {{host:{cx,cy,h}, guest:{cx,cy,h}}|null}
 */
export function duoAnchorsFromScene(scene) {
    if (!scene || scene.mode !== 'duo') return null;
    const anchors = (scene.layout?.anchors || [])
        .map(f => f?.anchor)
        .filter(a => a && [a.cx, a.cy].every(Number.isFinite));
    if (anchors.length < 2) return null;
    const sorted = [...anchors].sort((a, b) => a.cx - b.cx);
    const left = sorted[0];
    const right = sorted[sorted.length - 1];
    if (right.cx - left.cx < MIN_SEPARATION) return null;
    const host = scene.hostSide === 'right' ? right : left;
    const guest = host === left ? right : left;
    return { host, guest };
}

/**
 * The two half frames.
 *
 * @param {{host:{cx,cy,h}, guest:{cx,cy,h}, sourceAspect:number, frameAspect:number}} opts
 *   sourceAspect  width / height of the video
 *   frameAspect   width / height of the short (9/16)
 * @returns {{top:object, bottom:object, zoom:number}|null} null when the
 *   source is not wider than a half box (nothing to cut two people out of)
 */
export function duoSplitFrames({ host, guest, sourceAspect, frameAspect } = {}) {
    const sa = Number(sourceAspect);
    const fa = Number(frameAspect) > 0 ? Number(frameAspect) : 9 / 16;
    if (!(sa > 0) || !host || !guest) return null;
    // Pixel aspect of one half box (full width, half height).
    const ba = fa * 2;
    if (sa <= ba) return null;

    // Visible share of the source height, the same in both halves so the two
    // people come out at the same size.
    const faceH = Math.max(Number(host.h) || 0, Number(guest.h) || 0) || 0.2;
    const vh = clamp(faceH / FACE_SHARE, 0.22, 0.5);
    const zoom = 1 / vh;
    // Cover by height (sa > ba), then zoom: the visible share of the width.
    const vw = ba / (sa * zoom);

    const frameFor = (anchor, y) => {
        const left = clamp(anchor.cx - vw / 2, 0, 1 - vw);
        const top = clamp(anchor.cy - FACE_FROM_TOP * vh, 0, 1 - vh);
        return {
            preset: 'duo', x: 0, y, w: 1, h: 0.5, fit: 'cover',
            focusX: r4(vw < 1 ? left / (1 - vw) : 0.5),
            focusY: r4(vh < 1 ? top / (1 - vh) : 0.5),
            zoom: r4(zoom),
        };
    };
    return { top: frameFor(host, 0), bottom: frameFor(guest, 0.5), zoom: r4(zoom) };
}

export default { duoAnchorsFromScene, duoSplitFrames };
