/**
 * client/src/motion/MatteSettings.js
 *
 * R92: background removal settings, shared by the preview and the export.
 *
 * The matte is a grayscale mask video (white = person) baked in the browser
 * by vision/MatteBaker.js with a free on-device model, then stored next to
 * the project. Preview (ObjectLayerOverlay.jsx) and export
 * (jobs/exportProcessor.js) read the SAME mask file and the SAME settings,
 * normalised here, so what is seen is what is exported.
 *
 * Pure module: no DOM, no network. The server loads it with import(), like
 * TemplateGraphics.js.
 */

export const MATTE_MODES = ['blur', 'color', 'image', 'dim'];

export const MATTE_DEFAULTS = Object.freeze({
    mode: 'blur',
    /** Background blur, in px of a 1080-wide frame. */
    blur: 18,
    /** Mask edge softness, in px of a 1080-wide frame. */
    feather: 4,
    /** Mask cut-off 0..1: higher keeps less of the edges (tighter cut). */
    threshold: 0.5,
    /** Edge contrast 0..1: how hard the transition is around the cut-off. */
    softness: 0.35,
    /** Replacement colour for mode "color". */
    color: '#101014',
    /** Replacement image for mode "image". */
    imageUrl: null,
    /** Background darkening for mode "dim", 0..1. */
    dim: 0.55,
});

const clamp = (v, lo, hi, d) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return n < lo ? lo : n > hi ? hi : n;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Normalise user or saved settings. Never throws. */
export function normalizeMatte(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const mode = MATTE_MODES.includes(s.mode) ? s.mode : MATTE_DEFAULTS.mode;
    return {
        mode: mode === 'image' && !s.imageUrl ? 'blur' : mode,
        blur: clamp(s.blur, 0, 60, MATTE_DEFAULTS.blur),
        feather: clamp(s.feather, 0, 30, MATTE_DEFAULTS.feather),
        threshold: clamp(s.threshold, 0.05, 0.95, MATTE_DEFAULTS.threshold),
        softness: clamp(s.softness, 0.02, 1, MATTE_DEFAULTS.softness),
        color: HEX.test(String(s.color || '')) ? s.color : MATTE_DEFAULTS.color,
        imageUrl: typeof s.imageUrl === 'string' && s.imageUrl ? s.imageUrl : null,
        dim: clamp(s.dim, 0, 1, MATTE_DEFAULTS.dim),
    };
}

/**
 * The luma ramp that turns mask confidence into alpha. Values below `lo` are
 * fully transparent, above `hi` fully opaque, linear between. Used per pixel
 * in the preview, and as an ffmpeg `lut` expression in the export.
 */
export function alphaRamp(settings) {
    const m = normalizeMatte(settings);
    const half = (m.softness * 0.5) / 2;
    const lo = Math.max(0, m.threshold - half);
    const hi = Math.min(1, m.threshold + half);
    return { lo: Math.round(lo * 255), hi: Math.max(Math.round(lo * 255) + 1, Math.round(hi * 255)) };
}

/** Map one mask luma (0..255) to alpha (0..255). */
export function lumaToAlpha(luma, ramp) {
    if (luma <= ramp.lo) return 0;
    if (luma >= ramp.hi) return 255;
    return Math.round(((luma - ramp.lo) * 255) / (ramp.hi - ramp.lo));
}

/** Blur / feather in px for a frame `width` wide (settings are for 1080 wide). */
export function scaledPx(px, width) {
    return Math.max(0, (Number(px) || 0) * (Math.max(1, Number(width) || 1080) / 1080));
}

/**
 * Where to read the mask for a clip at a timeline time: mask-local seconds.
 * The mask covers source time [sourceStart, sourceStart + duration].
 */
export function maskTimeFor(clip, timelineTime) {
    const speed = Number(clip?.speed) > 0 ? Number(clip.speed) : 1;
    const sourceTime = (Number(clip?.offset) || 0) + (timelineTime - (Number(clip?.start) || 0)) * speed;
    const start = Number(clip?.layerMask?.sourceStart) || 0;
    return Math.max(0, sourceTime - start);
}

/**
 * FFmpeg filter graph for one matted clip. Inputs: [0:v] source (already
 * trimmed to the clip), [1:v] mask (already seeked to the clip's offset),
 * and [2:v] the background image when mode is "image".
 * Returns the graph lines; the output label is "outv".
 */
export function matteFilterGraph(settings, { width, height, speed = 1 }) {
    const m = normalizeMatte(settings);
    const ramp = alphaRamp(m);
    const feather = scaledPx(m.feather, width);
    const blur = scaledPx(m.blur, width);
    const pts = speed && speed !== 1 ? `,setpts=PTS/${Number(speed).toFixed(4)}` : '';
    const fit = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    const lines = [
        `[0:v]${fit}${pts},format=yuv420p,split=2[base][base2]`,
        // Luma ramp (same numbers as the preview), then feather.
        // tpad: if the clip was trimmed longer after the mask was made, hold the
        // last mask frame instead of ending the picture early.
        `[1:v]${fit}${pts},tpad=stop_mode=clone:stop_duration=3600,format=gray,lut=y='clip((val-${ramp.lo})*255/${ramp.hi - ramp.lo},0,255)'${feather > 0.3 ? `,gblur=sigma=${(feather / 2).toFixed(2)}` : ''}[mask]`,
    ];
    if (m.mode === 'blur') {
        lines.push(`[base2]gblur=sigma=${Math.max(0.5, blur / 2).toFixed(2)}[bg]`);
    } else if (m.mode === 'dim') {
        lines.push(`[base2]gblur=sigma=${Math.max(0.5, blur / 4).toFixed(2)},colorchannelmixer=rr=${(1 - m.dim).toFixed(3)}:gg=${(1 - m.dim).toFixed(3)}:bb=${(1 - m.dim).toFixed(3)}[bg]`);
    } else if (m.mode === 'color') {
        lines.push(`[base2]drawbox=x=0:y=0:w=iw:h=ih:color=${m.color.replace('#', '0x')}@1:t=fill[bg]`);
    } else {
        lines.push(`[2:v]${fit},format=yuv420p[bgimg]`);
        lines.push(`[base2][bgimg]overlay=0:0[bg]`);
    }
    lines.push(`[base][mask]alphamerge[fg]`);
    lines.push(`[bg][fg]overlay=0:0:shortest=1,format=yuv420p[outv]`);
    return lines;
}

export default { MATTE_MODES, MATTE_DEFAULTS, normalizeMatte, alphaRamp, lumaToAlpha, scaledPx, maskTimeFor, matteFilterGraph };
