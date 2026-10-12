/**
 * BaseClipGeometry.js — pure geometry for the R100 base-clip (video/image)
 * drag + resize handles, shared by BaseClipOverlay.jsx (the DOM gesture
 * surface) and its tests.
 *
 * Base clips use a DIFFERENT coordinate convention than overlay-track clips:
 * - Overlay clips (GraphicOverlay.jsx): `clip.x`/`clip.y` are 0-100 PERCENT of
 *   the frame, top-left anchored.
 * - Base clips (this file / project.tsx): `clip.x`/`clip.y` are CANVAS PIXELS
 *   (the project's reference resolution from getPlayerDimensions()), offset
 *   from the CANVAS CENTRE — the exact same numbers Revideo's `<Video>`/`<Img>`
 *   node `x`/`y` props already consume in client/src/revideo/project.tsx.
 *   `clip.scale` is a unitless multiplier on the node's "fitted" (contain-fit)
 *   size, default 1 — same field and same meaning overlay clips already use.
 *
 * `fitContainSize` MUST mirror project.tsx's own `fitSize()` exactly (same
 * formula as the preview/export-parity constants elsewhere in this codebase,
 * e.g. GraphicOverlay's DEFAULT_WIDTH_FRACTION) — keep the two in sync.
 */

/** Contain-fit a source media box into the canvas, same as project.tsx's fitSize(). */
export function fitContainSize(mediaW, mediaH, canvasWidth, canvasHeight) {
    if (!mediaW || !mediaH || !canvasWidth || !canvasHeight) {
        return { w: canvasWidth || 0, h: canvasHeight || 0 };
    }
    const s = Math.min(canvasWidth / mediaW, canvasHeight / mediaH);
    return { w: Math.round(mediaW * s), h: Math.round(mediaH * s) };
}

/**
 * Where to draw the clip's drag/resize surface, as CSS percentages of the
 * player's own box (which is sized `inset-0` over the exact canvasWidth ×
 * canvasHeight frame — see IDELayout.jsx's Player mount) — NOT as absolute
 * screen pixels, so the box tracks correctly across window resizes without
 * needing a resize observer.
 *
 * @returns {{leftPct:number, topPct:number, widthPct:number}} centre-anchored:
 *   pair with `transform: translate(-50%, -50%)`, width in %, height left to
 *   the media element's own intrinsic aspect ratio (`height: 'auto'`) — same
 *   technique GraphicOverlay.jsx already uses for overlay clips.
 */
export function baseClipScreenBox({ clipX = 0, clipY = 0, scale = 1, srcW, srcH, canvasWidth, canvasHeight }) {
    const fitted = fitContainSize(srcW, srcH, canvasWidth, canvasHeight);
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const leftPct = 50 + (canvasWidth ? (Number(clipX) || 0) / canvasWidth * 100 : 0);
    const topPct = 50 + (canvasHeight ? (Number(clipY) || 0) / canvasHeight * 100 : 0);
    const widthPct = canvasWidth ? (fitted.w * safeScale) / canvasWidth * 100 : 0;
    return { leftPct, topPct, widthPct };
}

/**
 * Convert a drag's on-screen pixel delta (measured against the player
 * container's own bounding rect) into the canvas-pixel delta that
 * `clip.x`/`clip.y` are stored in.
 */
export function screenDeltaToCanvasDelta({ deltaScreenX, deltaScreenY, containerRect, canvasWidth, canvasHeight }) {
    if (!containerRect || !containerRect.width || !containerRect.height) return { dx: 0, dy: 0 };
    return {
        dx: (deltaScreenX / containerRect.width) * canvasWidth,
        dy: (deltaScreenY / containerRect.height) * canvasHeight,
    };
}
