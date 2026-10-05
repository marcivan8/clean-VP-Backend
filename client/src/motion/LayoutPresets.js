/**
 * client/src/motion/LayoutPresets.js
 *
 * R88 (to-do A1) — layout presets for a second visual (b-roll, screen
 * recording, image) placed on the overlay track over the speaker:
 *
 *   split       the speaker in the TOP half, the content in the BOTTOM half
 *   fullscreen  the content covers the whole frame (cutaway)
 *   pip         the content small in a corner, the speaker full frame
 *
 * Pure module like everything else in this directory: no store, no DOM.
 *
 * ─── THE MODEL ─────────────────────────────────────────────────────────────
 * An overlay clip in a layout carries `clip.frame`:
 *   { preset, x, y, w, h, fit: 'cover', focusX, focusY }
 * x/y/w/h are the box in FRAME fractions (top-left origin). The source is
 * scaled to COVER the box and cropped around (focusX, focusY) — CSS
 * `object-fit: cover; object-position: focusX% focusY%` in the preview, the
 * same arithmetic as FFmpeg `scale=…:force_original_aspect_ratio=increase,
 * crop=w:h:(iw-w)*focusX:(ih-h)*focusY` in the export. A framed overlay is
 * static in place; opacity animations still apply.
 *
 * The split layout also reframes the SPEAKER: the base clip's span under the
 * content gets a `virtualCam` crop with the frame's own aspect, positioned so
 * the speaker's head sits in the middle of the top half. That reuses the
 * existing virtualCam pipeline (R14), already identical in preview and export,
 * so the speaker side needs no new render code at all. The bottom half of
 * that crop is hidden under the content.
 */

export const LAYOUT_PRESETS = ['split', 'fullscreen', 'pip'];

/** Head position inside a SAM2 speaker box: the upper part of the body. */
const HEAD_FROM_TOP = 0.2;
/** Talking-head fallback anchor used across the codebase (zoom anchor, R85). */
const FALLBACK_HEAD = { x: 0.5, y: 0.28 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function median(values) {
    const s = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (s.length === 0) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The box for a preset, in frame fractions.
 *
 * @param {string} preset one of LAYOUT_PRESETS
 * @param {{frameAspect:number, sourceAspect?:number|null, corner?:'tr'|'tl'|'br'|'bl'}} opts
 *   frameAspect  width / height of the project frame (9/16 for vertical)
 *   sourceAspect width / height of the overlay's media, when known (PiP keeps it)
 */
export function frameForPreset(preset, { frameAspect, sourceAspect = null, corner = 'tr' } = {}) {
    const fa = Number(frameAspect) > 0 ? Number(frameAspect) : 9 / 16;
    if (preset === 'fullscreen') return { preset, x: 0, y: 0, w: 1, h: 1, fit: 'cover', focusX: 0.5, focusY: 0.5 };
    if (preset === 'split') return { preset, x: 0, y: 0.5, w: 1, h: 0.5, fit: 'cover', focusX: 0.5, focusY: 0.5 };
    if (preset === 'pip') {
        // A third of the frame width on vertical, a quarter on landscape; the
        // box keeps the media's own shape (falls back to the frame's).
        const w = fa < 1 ? 0.36 : 0.26;
        const sa = Number(sourceAspect) > 0 ? Number(sourceAspect) : fa;
        const h = clamp((w * fa) / sa, 0.08, 0.6);
        const margin = 0.04;
        const mx = margin;
        const my = margin * fa; // same margin in pixels on both axes
        const right = corner === 'tr' || corner === 'br';
        const bottom = corner === 'br' || corner === 'bl';
        return {
            preset, w, h, fit: 'cover', focusX: 0.5, focusY: 0.5, corner,
            x: right ? 1 - w - mx : mx,
            // Clear of the top UI and of bottom captions on vertical video.
            y: bottom ? 1 - h - Math.max(my, 0.2) : Math.max(my, fa < 1 ? 0.08 : my),
        };
    }
    return null;
}

/** True when a clip is laid out by a preset (and must be drawn as a cover box). */
export function hasLayoutFrame(clip) {
    const f = clip?.frame;
    return !!(f && LAYOUT_PRESETS.includes(f.preset)
        && [f.x, f.y, f.w, f.h].every(Number.isFinite) && f.w > 0 && f.h > 0);
}

/**
 * The speaker crop for the split layout's top half.
 *
 * @param {object} opts
 *   bboxTrack     SAM2 samples [{t,cx,cy,w,h}] in SOURCE fractions, or null
 *   sourceStart   source seconds where the reframed span starts
 *   duration      length of that span (source seconds)
 *   sourceAspect  width / height of the speaker video
 *   frameAspect   width / height of the project frame
 * @returns {{crop:{cropX,cropY,cropW,cropH}, faceAware:boolean}}
 */
export function splitSpeakerCrop({ bboxTrack = null, sourceStart = 0, duration = Infinity, sourceAspect, frameAspect } = {}) {
    const sa = Number(sourceAspect) > 0 ? Number(sourceAspect) : 9 / 16;
    const fa = Number(frameAspect) > 0 ? Number(frameAspect) : 9 / 16;
    // The crop must have the FRAME's pixel shape so it fills the frame with no
    // bars: (cropW * sa) / cropH = fa  →  cropW = cropH * fa / sa.
    const ratio = fa / sa;
    const maxH = Math.min(1, 1 / ratio); // largest cropH whose cropW still fits

    const end = sourceStart + (Number.isFinite(duration) ? duration : Infinity);
    const samples = Array.isArray(bboxTrack)
        ? bboxTrack.filter(s => s && s.t >= sourceStart && s.t <= end && [s.cx, s.cy, s.w, s.h].every(Number.isFinite))
        : [];

    let headX = FALLBACK_HEAD.x;
    let headY = FALLBACK_HEAD.y;
    let cropH = maxH;
    let faceAware = false;
    if (samples.length > 0) {
        const cx = median(samples.map(s => s.cx));
        const cy = median(samples.map(s => s.cy));
        const h = median(samples.map(s => s.h));
        if (cx != null && cy != null && h != null && h > 0) {
            headX = cx;
            headY = (cy - h / 2) + HEAD_FROM_TOP * h;
            // Head and shoulders (about half of the body box) fill most of the
            // visible top half (cropH / 2) of the frame.
            cropH = clamp((0.5 * h) / (0.8 * 0.5), 0.3, maxH);
            faceAware = true;
        }
    }
    const cropW = clamp(cropH * ratio, 0.05, 1);
    cropH = cropW / ratio;
    // Head at the centre of the TOP half → a quarter of the crop height down.
    const cropX = clamp(headX - cropW / 2, 0, 1 - cropW);
    const cropY = clamp(headY - cropH / 4, 0, Math.max(0, 1 - cropH));
    const r = (v) => Math.round(v * 10000) / 10000;
    return { crop: { cropX: r(cropX), cropY: r(cropY), cropW: r(cropW), cropH: r(cropH) }, faceAware };
}

/**
 * R91 — full-frame reframe when the project frame is narrower than the video
 * (a 16:9 talk set to 9:16 for a reel): the crop keeps the full height and is
 * centred on the speaker's head (SAM2 samples over the clip's span), or on
 * the centre when there is no face data. Null when no crop is needed (the
 * video is already as narrow as the frame).
 *
 * @returns {{crop:{cropX,cropY,cropW,cropH}, faceAware:boolean}|null}
 */
export function fillFrameCrop({ bboxTrack = null, sourceStart = 0, duration = Infinity, sourceAspect, frameAspect } = {}) {
    const sa = Number(sourceAspect);
    const fa = Number(frameAspect);
    if (!(sa > 0) || !(fa > 0)) return null;
    const cropW = fa / sa;
    if (cropW >= 0.999) return null;
    const end = sourceStart + (Number.isFinite(duration) ? duration : Infinity);
    const samples = Array.isArray(bboxTrack)
        ? bboxTrack.filter(s => s && s.t >= sourceStart && s.t <= end && Number.isFinite(s.cx))
        : [];
    const cx = samples.length > 0 ? median(samples.map(s => s.cx)) : null;
    const headX = cx != null ? cx : FALLBACK_HEAD.x;
    const cropX = clamp(headX - cropW / 2, 0, 1 - cropW);
    const r = (v) => Math.round(v * 10000) / 10000;
    return { crop: { cropX: r(cropX), cropY: 0, cropW: r(cropW), cropH: 1 }, faceAware: cx != null };
}

/**
 * CSS for a framed overlay (preview). Returns the box style and the media
 * style; GraphicOverlay renders <div style=box><img|video style=media/></div>.
 */
export function frameToCss(frame) {
    const pct = (v) => `${Math.round(v * 100000) / 1000}%`;
    return {
        box: { left: pct(frame.x), top: pct(frame.y), width: pct(frame.w), height: pct(frame.h), overflow: 'hidden' },
        media: {
            width: '100%', height: '100%', display: 'block',
            objectFit: 'cover',
            objectPosition: `${pct(clamp(Number(frame.focusX ?? 0.5), 0, 1))} ${pct(clamp(Number(frame.focusY ?? 0.5), 0, 1))}`,
        },
    };
}

export default { LAYOUT_PRESETS, frameForPreset, hasLayoutFrame, splitSpeakerCrop, frameToCss };
