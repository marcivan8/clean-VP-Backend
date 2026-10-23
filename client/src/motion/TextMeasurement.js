/**
 * client/src/motion/TextMeasurement.js
 *
 * Text Auto-Fit & Dynamic Accent Bounding Box Measurement.
 *
 * Computes exact typographic dimensions and auto-fits text into target bounds
 * across preview canvas, layout systems, and export compositor.
 *
 * PURE and ISOMORPHIC:
 * - Runs seamlessly in browser (OffscreenCanvas / HTMLCanvasElement)
 * - Runs in Node.js test suites and worker tasks (@napi-rs/canvas if available, or deterministic font metrics)
 * - Zero network, zero React, zero store side effects
 */

import { SWAP_SLOT_PAD, widestIndex } from './TextCraft.js';

// Approximate character width factors per font family classification
// Used as deterministic fallback when no canvas context is available.
const FONT_WIDTH_FACTORS = {
    'Anton': 0.42,
    'Bebas Neue': 0.40,
    'Barlow Condensed': 0.44,
    'Montserrat': 0.62,
    'Poppins': 0.60,
    'Outfit': 0.58,
    'Inter': 0.55,
    'Roboto': 0.54,
    'JetBrains Mono': 0.60,
    'Playfair Display': 0.58,
    'default': 0.56,
};

let _cachedCtx = null;

/**
 * Obtain a reusable 2D canvas context for text measurement if available.
 */
function getMeasurementContext() {
    if (_cachedCtx) return _cachedCtx;

    // 1. Browser OffscreenCanvas
    if (typeof OffscreenCanvas !== 'undefined') {
        try {
            const oc = new OffscreenCanvas(256, 256);
            _cachedCtx = oc.getContext('2d');
            if (_cachedCtx) return _cachedCtx;
        } catch { /* next measuring method */ }
    }

    // 2. Browser DOM canvas
    if (typeof document !== 'undefined' && document.createElement) {
        try {
            const c = document.createElement('canvas');
            _cachedCtx = c.getContext('2d');
            if (_cachedCtx) return _cachedCtx;
        } catch { /* next measuring method */ }
    }

    // 3. Node.js @napi-rs/canvas
    // Only where a CommonJS require exists (server code); browsers and the ESM
    // tests fall through to the deterministic estimate below.
    const nodeRequire = typeof globalThis.require === 'function' ? globalThis.require : null;
    if (nodeRequire && globalThis.process?.versions?.node) {
        try {
            const napi = nodeRequire('@napi-rs/canvas');
            if (napi && napi.createCanvas) {
                const c = napi.createCanvas(256, 256);
                _cachedCtx = c.getContext('2d');
                if (_cachedCtx) return _cachedCtx;
            }
        } catch { /* next measuring method */ }
    }

    return null;
}

/**
 * Measure a single line of text with given font parameters.
 *
 * @param {string} text
 * @param {object} opts
 * @returns {number} width in pixels
 */
export function measureSingleLineWidth(text, opts = {}) {
    const str = String(text ?? '');
    if (!str) return 0;

    const fontSize = Number(opts.fontSize) > 0 ? Number(opts.fontSize) : 56;
    const fontFamily = opts.fontFamily || 'Inter';
    const fontWeight = opts.fontWeight || 'normal';
    const ctx = getMeasurementContext();

    if (ctx) {
        try {
            ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
            const m = ctx.measureText(str);
            if (m && Number.isFinite(m.width)) {
                return m.width;
            }
        } catch { /* next measuring method */ }
    }

    // Fallback: character-based typographic estimation
    const factor = FONT_WIDTH_FACTORS[fontFamily] || FONT_WIDTH_FACTORS.default;
    let width = 0;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === ' ' || ch === '\t') {
            width += fontSize * 0.28;
        } else if (/[ijlI1.,!':;|]/.test(ch)) {
            width += fontSize * factor * 0.55;
        } else if (/[mwMW@#%&]/.test(ch)) {
            width += fontSize * factor * 1.35;
        } else if (/[A-Z0-9]/.test(ch)) {
            width += fontSize * factor * 1.1;
        } else {
            width += fontSize * factor;
        }
    }
    return Math.round(width);
}

/**
 * Measure multi-line text bounds and line wrapping.
 *
 * @param {string|string[]} text
 * @param {object} opts
 * @returns {{ width: number, height: number, lines: string[], lineWidths: number[], fontSize: number }}
 */
export function measureTextBounds(text, opts = {}) {
    const fontSize = Number(opts.fontSize) > 0 ? Number(opts.fontSize) : 56;
    const lineHeight = Number(opts.lineHeight) > 0 ? Number(opts.lineHeight) : 1.2;
    const maxWidth = Number(opts.maxWidth) > 0 ? Number(opts.maxWidth) : Infinity;

    const rawStr = Array.isArray(text) ? text.join('\n') : String(text ?? '');
    const paragraphs = rawStr.split(/\r?\n/);
    const lines = [];
    const lineWidths = [];

    for (const para of paragraphs) {
        if (!para.trim()) {
            lines.push('');
            lineWidths.push(0);
            continue;
        }

        const words = para.split(/\s+/);
        let curLine = '';
        let curWidth = 0;

        for (const word of words) {
            const testLine = curLine ? `${curLine} ${word}` : word;
            const testWidth = measureSingleLineWidth(testLine, { ...opts, fontSize });

            if (curLine && testWidth > maxWidth) {
                lines.push(curLine);
                lineWidths.push(curWidth);
                curLine = word;
                curWidth = measureSingleLineWidth(word, { ...opts, fontSize });
            } else {
                curLine = testLine;
                curWidth = testWidth;
            }
        }

        if (curLine) {
            lines.push(curLine);
            lineWidths.push(curWidth);
        }
    }

    const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
    const totalHeight = lines.length > 0
        ? Math.round((lines.length - 1) * fontSize * lineHeight + fontSize)
        : fontSize;

    return {
        width: Math.round(maxLineWidth),
        height: Math.round(totalHeight),
        lines,
        lineWidths,
        fontSize,
    };
}

/**
 * Auto-fit text into a bounded box by calculating the optimal font size.
 *
 * @param {string} text
 * @param {object} box target boundaries { maxWidth, maxHeight }
 * @param {object} [opts]
 * @returns {{ fontSize: number, width: number, height: number, lines: string[], isScaledDown: boolean, scaleFactor: number }}
 */
export function fitTextToBox(text, box = {}, opts = {}) {
    const initialFontSize = Number(opts.initialFontSize) > 0 ? Number(opts.initialFontSize) : 56;
    const minFontSize = Number(opts.minFontSize) > 0 ? Number(opts.minFontSize) : 22;
    const maxFontSize = Number(opts.maxFontSize) > 0
        ? Number(opts.maxFontSize)
        : (opts.canScaleUp ? Math.max(initialFontSize, 84) : initialFontSize);
    const maxWidth = Number(box.maxWidth) > 0 ? Number(box.maxWidth) : 860;
    const maxHeight = Number(box.maxHeight) > 0 ? Number(box.maxHeight) : 240;
    const allowWrap = opts.allowWrap !== false;

    // Fast-path: if text already fits at initialFontSize and scaling up is not requested
    const initialBounds = measureTextBounds(text, {
        ...opts,
        fontSize: initialFontSize,
        maxWidth: allowWrap ? maxWidth : Infinity,
    });

    if (!opts.canScaleUp && initialBounds.width <= maxWidth && initialBounds.height <= maxHeight) {
        return {
            fontSize: initialFontSize,
            width: initialBounds.width,
            height: initialBounds.height,
            lines: initialBounds.lines,
            isScaledDown: false,
            scaleFactor: 1,
        };
    }

    let low = minFontSize;
    let high = maxFontSize;
    let bestSize = minFontSize;
    let bestBounds = initialBounds;

    // Binary search for optimal integer fontSize fitting both width and height
    for (let step = 0; step < 8; step++) {
        const mid = Math.round((low + high) / 2);
        const bounds = measureTextBounds(text, {
            ...opts,
            fontSize: mid,
            maxWidth: allowWrap ? maxWidth : Infinity,
        });

        const fits = bounds.width <= maxWidth && bounds.height <= maxHeight;
        if (fits) {
            bestSize = mid;
            bestBounds = bounds;
            low = mid + 1; // Try larger
        } else {
            high = mid - 1; // Scale down
        }
    }

    // Fallback if binary search didn't resolve cleanly
    if (!bestBounds) {
        bestSize = minFontSize;
        bestBounds = measureTextBounds(text, {
            ...opts,
            fontSize: minFontSize,
            maxWidth: allowWrap ? maxWidth : Infinity,
        });
    }

    return {
        fontSize: bestSize,
        width: bestBounds.width,
        height: bestBounds.height,
        lines: bestBounds.lines,
        isScaledDown: bestSize < initialFontSize,
        scaleFactor: Number((bestSize / initialFontSize).toFixed(3)),
    };
}

/**
 * Compute fitted dimensions and overlay placement scale for procedural accent shapes
 * (highlight-box, underline, circle-callout) to snugly wrap text content.
 *
 * `frameWidth` matters: the renderers draw an overlay at a fraction of the
 * FRAME WIDTH times `clip.scale`, so the scale returned here depends on which
 * frame the shape will be drawn in. It used to be hard-coded to 1080, so an
 * accent sized for a widescreen edit came out 1.78x too wide — an underline
 * 83% of the width of a vertical frame, reaching into the caption bar. Pass
 * the real frame width (SceneLayout does); 1080 stays the default so existing
 * callers keep the numbers they were written against.
 *
 * @param {string} text
 * @param {object} opts
 * @param {number} [opts.frameWidth=1080] reference width of the frame it is drawn in
 * @returns {{ w: number, h: number, scale: number, thickness: number, bounds: object, fittedFontSize: number }}
 */
export function computeAccentBounds(text, opts = {}) {
    const shapeKind = opts.shapeKind || 'underline';
    const baseFontSize = Number(opts.fontSize) > 0 ? Number(opts.fontSize) : 56;
    const maxWidth = Number(opts.maxWidth) > 0 ? Number(opts.maxWidth) : 880;
    const maxHeight = Number(opts.maxHeight) > 0 ? Number(opts.maxHeight) : 220;

    // 1. Auto-fit text if requested or if text exceeds maxWidth
    const fitted = fitTextToBox(text, { maxWidth, maxHeight }, {
        ...opts,
        initialFontSize: baseFontSize,
    });

    const fontSize = fitted.fontSize;
    const bounds = measureTextBounds(text, {
        ...opts,
        fontSize,
        maxWidth,
    });

    let w = 800;
    let h = 300;
    let thickness = Number(opts.thickness) || 12;

    switch (shapeKind) {
        case 'underline': {
            const padX = Number(opts.paddingX) >= 0 ? Number(opts.paddingX) : Math.round(fontSize * 0.35);
            w = Math.max(120, bounds.width + padX * 2);
            h = Math.max(48, Math.round(fontSize * 0.95));
            thickness = Math.max(8, Math.min(26, Math.round(fontSize * 0.22)));
            break;
        }

        case 'highlight-box': {
            const padX = Number(opts.paddingX) >= 0 ? Number(opts.paddingX) : Math.round(fontSize * 0.45);
            const padY = Number(opts.paddingY) >= 0 ? Number(opts.paddingY) : Math.round(fontSize * 0.28);
            w = Math.max(140, bounds.width + padX * 2);
            h = Math.max(64, bounds.height + padY * 2);
            thickness = Math.max(6, Math.min(20, Math.round(fontSize * 0.12)));
            break;
        }

        case 'circle-callout': {
            const pad = Number(opts.padding) >= 0 ? Number(opts.padding) : Math.round(fontSize * 0.45);
            w = Math.max(160, Math.round((bounds.width + pad * 2) * 1.15));
            h = Math.max(120, Math.round((bounds.height + pad * 1.8) * 1.1));
            thickness = Math.max(8, Math.min(22, Math.round(fontSize * 0.14)));
            break;
        }

        default:
            w = Math.max(140, bounds.width + 40);
            h = Math.max(60, bounds.height + 30);
            break;
    }

    // Reference pixel width to the scale GraphicOverlay / Compositor apply:
    // they draw at OVERLAY_WIDTH_FRACTION (0.25) of the frame width times
    // clip.scale, so scale = w / (frameWidth * 0.25).
    const frameWidth = Number(opts.frameWidth) > 0 ? Number(opts.frameWidth) : 1080;
    const scale = Number((w / (frameWidth * 0.25)).toFixed(3));

    return {
        w: Math.round(w),
        h: Math.round(h),
        scale,
        thickness,
        bounds,
        fittedFontSize: fontSize,
    };
}

/**
 * R107 — the width a slot must reserve to hold any of its alternatives.
 *
 * Measured from the WIDEST alternative, never the current one: a slot sized by
 * whichever word is in it makes everything beside it jump on every swap. The
 * rule and the pad live in TextCraft.js; the measuring lives here.
 *
 * @param {string[]} alternatives
 * @param {object} opts fontSize, fontFamily, fontWeight — as measureSingleLineWidth
 * @returns {{ width:number, widest:string, widths:number[] }}
 */
export function reserveSlotWidth(alternatives, opts = {}) {
    const words = (Array.isArray(alternatives) ? alternatives : [])
        .map(w => String(w == null ? '' : w))
        .filter(w => w.trim().length > 0);
    if (words.length === 0) return { width: 0, widest: '', widths: [] };
    const widths = words.map(w => {
        const n = Number(measureSingleLineWidth(w, opts));
        return Number.isFinite(n) ? n : 0;
    });
    const best = widestIndex(widths);
    if (best < 0) return { width: 0, widest: '', widths };
    return {
        width: widths[best] * (1 + SWAP_SLOT_PAD),
        widest: words[best],
        widths,
    };
}

export default {
    measureSingleLineWidth,
    measureTextBounds,
    fitTextToBox,
    computeAccentBounds,
    reserveSlotWidth,
};
