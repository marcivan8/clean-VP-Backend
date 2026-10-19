/**
 * client/src/motion/ColorTheory.js
 *
 * R103 round E — the colour half of the design knowledge.
 *
 * The engine already knew typography (a type scale), composition (a measured
 * layout, safe zones, subject avoidance), spacing (proportional gaps) and
 * hierarchy (roles). Colour was the gap: it had PALETTES — hand-picked per
 * look and per tone — and it could CHECK contrast in the validator, but it
 * could not reason about colour at all. Nothing could answer "this is the
 * brand's red, what accent goes with it" or "this accent came off the
 * footage, is the text on it still readable".
 *
 * That gap had already produced a real defect. CTAWidget draws a FILLED badge
 * and sets its label in the look's text colour, and nobody checked the pair:
 * the "follow" preset put white text on #00E5FF — a contrast ratio of 1.54:1,
 * where WCAG asks 4.5 for body text and 3.0 for large. It is close to
 * invisible, and it shipped because the only contrast check in the codebase
 * runs in the validator against an explicit `backdropColor`, which a filled
 * accent never sets.
 *
 * The footage path made it worse by construction: `paletteFromPixels` takes
 * the most saturated hue bin of a sampled frame as the accent, and the
 * director passed that straight through as `accentColor`. That accent can be
 * any hue at any lightness, so "is the text on it readable" was left to luck.
 *
 * WHAT THIS MODULE IS NOT: a palette generator that invents brand colours.
 * It adjusts LIGHTNESS to reach a contrast target and derives harmonies from
 * a hue the caller already chose. Hue is a brand decision and is preserved.
 */

/** Parse #rgb, #rrggbb or rgb()/rgba() into [r,g,b] 0-255, or null. */
export function parseColor(value) {
    const s = String(value || '').trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16));
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
        const parts = m[1].split(',').map(p => parseFloat(p));
        if (parts.length >= 3 && parts.every(p => Number.isFinite(p))) return parts.slice(0, 3);
    }
    return null;
}

const toHex = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

/** [r,g,b] 0-255 → '#rrggbb'. */
export function rgbToHex(r, g, b) {
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** [r,g,b] 0-255 → {h: 0-360, s: 0-1, l: 0-1}. */
export function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    return { h: h * 60, s, l };
}

/** {h,s,l} → '#rrggbb'. */
export function hslToHex(h, s, l) {
    const hn = ((h % 360) + 360) % 360 / 360;
    const sn = Math.min(1, Math.max(0, s));
    const ln = Math.min(1, Math.max(0, l));
    if (sn === 0) {
        const v = ln * 255;
        return rgbToHex(v, v, v);
    }
    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;
    const channel = (t) => {
        let tt = t;
        if (tt < 0) tt += 1;
        if (tt > 1) tt -= 1;
        if (tt < 1 / 6) return p + (q - p) * 6 * tt;
        if (tt < 1 / 2) return q;
        if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
        return p;
    };
    return rgbToHex(channel(hn + 1 / 3) * 255, channel(hn) * 255, channel(hn - 1 / 3) * 255);
}

/** '#rrggbb' → {h,s,l}, or null. */
export function toHsl(color) {
    const rgb = parseColor(color);
    if (!rgb) return null;
    return rgbToHsl(rgb[0], rgb[1], rgb[2]);
}

// ── WCAG ────────────────────────────────────────────────────────────────────
// These live here rather than in SceneValidator, which now re-exports them:
// colour maths belongs in the colour module, and a second copy of a formula
// is the drift class this codebase keeps counting.

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(color) {
    const rgb = parseColor(color);
    if (!rgb) return null;
    const [r, g, b] = rgb.map((c) => {
        const v = Math.min(1, Math.max(0, c / 255));
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. null when either colour cannot be read. */
export function contrastRatio(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    if (la === null || lb === null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Large on-screen type (the usual case here) needs 3.0; body text 4.5. */
export const CONTRAST = Object.freeze({ large: 3, body: 4.5, strong: 7 });

// ── Harmony ─────────────────────────────────────────────────────────────────

/**
 * The classic hue relationships, as hex, keeping the base's saturation and
 * lightness. Hue is the brand decision; these rotate it, nothing else.
 *
 * @param {string} base
 * @returns {{complementary:string, analogous:string[], triadic:string[], splitComplementary:string[]}|null}
 */
export function harmonies(base) {
    const hsl = toHsl(base);
    if (!hsl) return null;
    const at = (deg) => hslToHex(hsl.h + deg, hsl.s, hsl.l);
    return {
        complementary: at(180),
        analogous: [at(-30), at(30)],
        triadic: [at(120), at(240)],
        splitComplementary: [at(150), at(210)],
    };
}

/**
 * Is `accent` far enough from `base` in hue to read as a different colour
 * rather than a mistake? Two hues 12° apart look like one colour badly
 * reproduced; this is what stops a "harmonious" accent being invisible
 * against the thing it is meant to accent.
 */
export function hueDistance(a, b) {
    const ha = toHsl(a);
    const hb = toHsl(b);
    if (!ha || !hb) return null;
    const d = Math.abs(ha.h - hb.h) % 360;
    return d > 180 ? 360 - d : d;
}

// ── Legibility ──────────────────────────────────────────────────────────────

/**
 * The same colour, lightened or darkened just far enough to reach `minRatio`
 * against `background`. Hue and saturation are preserved, so a brand colour
 * stays recognisably itself.
 *
 * Walks lightness in both directions and takes the smaller move that works —
 * so white on a bright yellow badge darkens to a readable near-black of the
 * same family rather than flipping to an arbitrary colour. Returns the best
 * attempt when the target is unreachable (a mid-grey background cannot reach
 * 7:1 with anything), so a caller always gets its most readable option.
 *
 * @param {string} color the text/foreground colour to adjust
 * @param {string} background what it sits on
 * @param {number} [minRatio=CONTRAST.large]
 * @returns {string} hex
 */
export function ensureContrast(color, background, minRatio = CONTRAST.large) {
    const hsl = toHsl(color);
    if (!hsl || !parseColor(background)) return color;
    if ((contrastRatio(color, background) ?? 0) >= minRatio) return color;

    let best = color;
    let bestRatio = contrastRatio(color, background) ?? 0;

    // Achromatic text (white, grey, black) has no hue worth preserving, and
    // walking its lightness just slides down the greyscale: white on #00E5FF
    // reached the 3:1 target at a mid-grey, which passes the number and looks
    // washed out. On a filled badge the only sensible choices are near-black
    // or near-white, so take whichever reads better — the same call a
    // designer makes, and it lands at ~10:1 instead of scraping 3.08:1.
    if (hsl.s < 0.1) {
        const INK = '#0E0F11';
        const PAPER = '#ffffff';
        const inkRatio = contrastRatio(INK, background) ?? 0;
        const paperRatio = contrastRatio(PAPER, background) ?? 0;
        return inkRatio >= paperRatio ? INK : PAPER;
    }

    // Step through lightness from the original in both directions, nearest
    // first, so the smallest change that works is the one taken. Hue and
    // saturation are preserved, so a brand colour stays itself.
    for (let step = 1; step <= 20; step += 1) {
        const delta = step * 0.05;
        for (const l of [hsl.l - delta, hsl.l + delta]) {
            if (l < 0 || l > 1) continue;
            const candidate = hslToHex(hsl.h, hsl.s, l);
            const ratio = contrastRatio(candidate, background) ?? 0;
            if (ratio > bestRatio) { bestRatio = ratio; best = candidate; }
            if (ratio >= minRatio) return candidate;
        }
    }
    return best;
}

/**
 * Harmonise a suggested palette (typically sampled from the footage) with the
 * look's own, and guarantee the result is readable.
 *
 * The suggestion wins on HUE, because that is what makes a graphic feel like
 * it belongs to the shot it sits on. The look wins wherever the suggestion
 * would be illegible or so close to the text colour that the accent stops
 * reading as an accent.
 *
 * @param {{text?:string, sub?:string, accent?:string}|null} suggested
 * @param {{text:string, sub:string, accent:string}} fallback the look's palette
 * @param {{minRatio?:number, minHueDistance?:number}} [opts]
 * @returns {{text:string, sub:string, accent:string, notes:string[]}}
 */
/**
 * Below this contrast ratio two colours read as one colour reproduced badly
 * rather than as a pair. Above it, lightness alone separates them — which is
 * what makes a monochromatic palette work.
 */
const MIN_SEPARATION = 1.5;

export function harmonisePalette(suggested, fallback, opts = {}) {
    const minRatio = Number.isFinite(opts.minRatio) ? opts.minRatio : CONTRAST.large;
    const minHue = Number.isFinite(opts.minHueDistance) ? opts.minHueDistance : 25;
    const notes = [];
    const base = { text: fallback?.text || '#ffffff', sub: fallback?.sub || '#E2E8F0', accent: fallback?.accent || '#FFE500' };
    if (!suggested) return { ...base, notes: ['No colour was read from the shot, so the look keeps its own palette.'] };

    const text = parseColor(suggested.text) ? suggested.text : base.text;
    const sub = parseColor(suggested.sub) ? suggested.sub : base.sub;
    let accent = parseColor(suggested.accent) ? suggested.accent : base.accent;

    // An accent indistinguishable from the text reads as a mistake rather
    // than an accent. "Indistinguishable" needs both halves: hue alone is
    // not enough, because a legitimate monochromatic pairing — the editorial
    // look's gold accent under its cream type — is 0.2° apart in hue and
    // obviously two colours, separated by lightness. Hue is also meaningless
    // against achromatic type: white has no hue, so measuring from it just
    // returns whatever the accent's own hue happens to be. So: intervene
    // only when the two are close in hue AND so close in lightness that they
    // would read as one colour badly reproduced.
    const accentHsl = toHsl(accent);
    const textHsl = toHsl(text);
    const bothChromatic = (accentHsl?.s ?? 0) >= 0.1 && (textHsl?.s ?? 0) >= 0.1;
    const distance = hueDistance(accent, text);
    const separation = contrastRatio(accent, text) ?? 1;
    if (bothChromatic && distance !== null && distance < minHue && separation < MIN_SEPARATION) {
        const harmony = harmonies(accent);
        if (harmony) {
            accent = harmony.complementary;
            notes.push(`The shot's colour sat too close to the text, so the accent moved to its complementary.`);
        }
    }

    // Whatever the accent ended up as, text drawn ON it has to be readable.
    const onAccent = ensureContrast(text, accent, minRatio);
    if (onAccent !== text) {
        notes.push(`Text on the accent was adjusted to stay readable (${(contrastRatio(onAccent, accent) ?? 0).toFixed(1)}:1).`);
    }

    return { text, sub, accent, onAccent, notes };
}

export default {
    parseColor,
    rgbToHex,
    rgbToHsl,
    hslToHex,
    toHsl,
    luminance,
    contrastRatio,
    CONTRAST,
    harmonies,
    hueDistance,
    ensureContrast,
    harmonisePalette,
};
