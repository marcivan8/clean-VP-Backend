/**
 * client/src/motion/TransitionFX.js
 *
 * R89 (to-do A4) — the transition pack. ONE pure description of every
 * transition, read by BOTH renderers:
 *   - the preview (Player/TransitionLayer.jsx) turns it into CSS transforms,
 *     an SVG blur/chroma filter and a flash overlay, every frame;
 *   - the export (server/compositor/TransitionCompiler.js) imports this same
 *     file and samples it into FFmpeg filters around each cut.
 * No imports, no DOM: it must load in the browser and in Node.
 *
 * ─── HOW A TRANSITION SITS ON THE TIMELINE ─────────────────────────────────
 * `clip.transition = { type, duration }` on a clip of the base video track is
 * the transition at that clip's END, into whatever plays next. It is a CUT
 * EFFECT centred on the cut: the first half plays over the end of the outgoing
 * clip, the second half over the start of the incoming one. Nothing overlaps
 * and no clip changes length, so captions, audio and overlays keep their
 * timing. That is why there is no true crossfade or push here: both need two
 * clips on screen at once. The old 'fade' / 'crossfade' / 'slide' / 'zoom'
 * values (which were stored but never drawn, in preview or export) map onto
 * this pack through LEGACY_TRANSITIONS.
 *
 * ─── THE PARAMETERS ────────────────────────────────────────────────────────
 * fxAt(type, u) with u in [-1, 1] (-1 window start, 0 the cut, +1 window end):
 *   tx      horizontal shift, fraction of frame width (+ = right)
 *   scale   zoom about the frame centre (>= 1, so edges never show)
 *   blurX   horizontal gaussian sigma, fraction of frame width
 *   blurY   vertical gaussian sigma, fraction of frame width
 *   flash   0..1 blend toward white
 *   dip     0..1 blend toward black
 *   chroma  red/blue split, fraction of frame width (signed)
 *   lines   0..1 progress of the speed-line sweep, or null
 */

export const TRANSITION_TYPES = ['flash', 'dip', 'whip-left', 'whip-right', 'zoom-punch', 'glitch', 'speed-lines'];

export const TRANSITION_DEFAULT_DURATION = {
    'flash': 0.3,
    'dip': 0.6,
    'whip-left': 0.36,
    'whip-right': 0.36,
    'zoom-punch': 0.4,
    'glitch': 0.32,
    'speed-lines': 0.5,
};

/** Values written by the old timeline menu, never rendered until R89. */
export const LEGACY_TRANSITIONS = { fade: 'dip', crossfade: 'dip', slide: 'whip-left', zoom: 'zoom-punch' };

export const MAX_TRANSITION_DURATION = 1.5;

export const NEUTRAL_FX = Object.freeze({ tx: 0, scale: 1, blurX: 0, blurY: 0, flash: 0, dip: 0, chroma: 0, lines: null });

/**
 * The transition named in free text ("add a whip", "speed lines between the
 * clips", "un fondu au noir"), or null. Longest names are tested first so
 * "whip right" wins over "whip".
 */
export function transitionFromText(text) {
    const s = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const table = [
        [/speed[\s-]?lines?|lignes? de vitesse/, 'speed-lines'],
        [/whip[\s-]?right|file droite|filé droite/, 'whip-right'],
        [/whip[\s-]?left|file gauche/, 'whip-left'],
        [/\bwhip\b|whip[\s-]?pan|\bfile\b|\bswish\b/, 'whip-left'],
        [/zoom[\s-]?punch|\bzoom\b|zoom choc/, 'zoom-punch'],
        [/glitch|chromatic|rgb split/, 'glitch'],
        [/\bflash\b|white flash|flash blanc/, 'flash'],
        [/\bdip\b|fade to black|fondu au noir|\bfade\b|\bfondu\b|crossfade|cross fade|dissolve/, 'dip'],
        [/\bslide\b|\bwipe\b/, 'whip-left'],
    ];
    for (const [re, type] of table) if (re.test(s)) return type;
    return null;
}

/** Canonical type for a stored value, or null if unknown. */
export function normalizeTransitionType(type) {
    if (TRANSITION_TYPES.includes(type)) return type;
    return LEGACY_TRANSITIONS[type] || null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeIn = (x) => x * x * x;
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const smooth = (x) => x * x * (3 - 2 * x);

/** Deterministic 0..1 noise for a step index (glitch jitter). */
function noise(i) {
    const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
}

/**
 * Parameters of a transition at normalised position u.
 * @param {string} type canonical or legacy type
 * @param {number} u -1..1
 */
export function fxAt(type, u) {
    const t = normalizeTransitionType(type);
    if (!t || !Number.isFinite(u) || u < -1 || u > 1) return { ...NEUTRAL_FX };
    const a = Math.abs(u);
    const peak = 1 - a; // 1 at the cut, 0 at the edges
    const out = { ...NEUTRAL_FX };

    switch (t) {
        case 'flash': {
            out.flash = Math.pow(peak, 1.6);
            out.scale = 1 + 0.04 * smooth(peak);
            break;
        }
        case 'dip': {
            out.dip = smooth(peak);
            break;
        }
        case 'whip-left':
        case 'whip-right': {
            const dir = t === 'whip-left' ? -1 : 1;
            // Outgoing accelerates away, incoming decelerates into place.
            const travel = u < 0 ? easeIn(u + 1) : -(1 - easeOut(u));
            out.tx = dir * 0.12 * travel;
            // Scale up just enough that the shifted frame still covers the edges.
            out.scale = 1 + 2 * Math.abs(out.tx) + 0.02 * peak;
            out.blurX = 0.045 * Math.pow(peak, 0.8);
            break;
        }
        case 'zoom-punch': {
            const z = u < 0 ? easeIn(u + 1) : 1 - easeOut(u);
            out.scale = 1 + 0.32 * z;
            const b = 0.006 * Math.pow(peak, 1.2);
            out.blurX = b;
            out.blurY = b;
            break;
        }
        case 'glitch': {
            const step = Math.floor((u + 1) * 7);
            const j = noise(step) * 2 - 1;
            // Fast ramp in/out so the window edges are exactly neutral (no jump).
            const env = smooth(Math.min(1, peak * 3));
            out.tx = 0.018 * j * peak;
            out.scale = 1 + (0.04 + 2 * Math.abs(out.tx)) * env;
            out.chroma = 0.012 * (noise(step + 31) > 0.5 ? 1 : -1) * (0.4 + 0.6 * peak) * env;
            out.flash = noise(step + 7) > 0.82 ? 0.25 * peak : 0;
            break;
        }
        case 'speed-lines': {
            out.lines = (u + 1) / 2;
            const travel = u < 0 ? easeIn(u + 1) : -(1 - easeOut(u));
            out.tx = -0.05 * travel;
            out.scale = 1 + 2 * Math.abs(out.tx) + 0.01 * peak;
            out.blurX = 0.012 * Math.pow(peak, 1.2);
            break;
        }
        default:
            break;
    }
    return out;
}

/** True when fx changes nothing (the renderers skip work). */
export function fxIsNeutral(fx) {
    return !fx || (Math.abs(fx.tx) < 1e-5 && Math.abs(fx.scale - 1) < 1e-5 && fx.blurX < 1e-6 && fx.blurY < 1e-6
        && fx.flash < 1e-4 && fx.dip < 1e-4 && Math.abs(fx.chroma) < 1e-6 && fx.lines == null);
}

/**
 * Transition windows for a list of base-track clips, in the clips' own clock.
 * The transition belongs to the clip it is set on (its END). Each half is
 * clamped to the clip it plays over. When nothing follows (last clip, or a gap
 * after it), only the outgoing half plays, so a 'dip' becomes a fade to black.
 *
 * @param {Array<{id, start, duration, transition}>} clips
 * @returns {Array<{clipId, type, cut, from, to, half:number, before:number, after:number}>}
 *   before/after: seconds of the window on each side of the cut (≤ half).
 */
export function transitionWindows(clips) {
    const sorted = (Array.isArray(clips) ? clips : [])
        .filter(c => c && Number(c.duration) > 0)
        .slice()
        .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        const type = normalizeTransitionType(c.transition?.type);
        if (!type) continue;
        const dur = clamp(Number(c.transition.duration) || TRANSITION_DEFAULT_DURATION[type], 0.1, MAX_TRANSITION_DURATION);
        const half = dur / 2;
        const cut = (Number(c.start) || 0) + Number(c.duration);
        const next = sorted[i + 1];
        const adjacent = next && Math.abs((Number(next.start) || 0) - cut) < 0.05;
        const before = Math.min(half, Number(c.duration));
        const after = adjacent ? Math.min(half, Number(next.duration)) : 0;
        out.push({ clipId: c.id, type, cut, from: cut - before, to: cut + after, half, before, after });
    }
    return out;
}

/** The effect at time t, given windows from transitionWindows (first hit wins). */
export function fxAtTime(windows, t) {
    for (const w of (windows || [])) {
        if (t >= w.from && t < w.to) {
            const u = (t - w.cut) / w.half;
            return fxAt(w.type, clamp(u, -1, 1));
        }
    }
    return { ...NEUTRAL_FX };
}

// ─── Speed lines (drawn by preview canvas AND export) ──────────────────────

/**
 * Draw the speed-line sweep for progress p (0..1) onto a 2D context of size
 * w×h (transparent background). Same calls in Chrome and @napi-rs/canvas.
 */
export function drawSpeedLines(ctx, w, h, p, seed = 7) {
    if (!ctx || !(p >= 0 && p <= 1)) return;
    const count = 34;
    // Front edge sweeps from right (p=0) to left (p=1) across 1.6 widths.
    const front = w * (1.3 - 1.6 * p);
    const alpha = Math.sin(Math.PI * p);
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
        const r1 = noise(seed * 13 + i);
        const r2 = noise(seed * 29 + i * 3);
        const r3 = noise(seed * 47 + i * 7);
        const y = r1 * h;
        const len = w * (0.25 + 0.55 * r2);
        const x0 = front + r3 * w * 0.35;
        const thick = Math.max(1, h * (0.002 + 0.006 * r2));
        const grad = ctx.createLinearGradient(x0, y, x0 + len, y);
        grad.addColorStop(0, `rgba(255,255,255,${(0.95 * alpha).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = thick;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + len, y);
        ctx.stroke();
    }
    ctx.restore();
}

export default {
    TRANSITION_TYPES, TRANSITION_DEFAULT_DURATION, LEGACY_TRANSITIONS, NEUTRAL_FX,
    normalizeTransitionType, transitionFromText, fxAt, fxIsNeutral, transitionWindows, fxAtTime, drawSpeedLines,
};
