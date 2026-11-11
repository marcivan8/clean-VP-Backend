/**
 * server/compositor/RasterCaptionCompiler.js
 *
 * R88 — captions that drawtext cannot draw: per-word HIGHLIGHT of the spoken
 * word, keyword EMPHASIS, and ROTATION. The client marks those caption-program
 * entries with a `raster` block (client/src/motion/CaptionCompiler.js). This
 * module draws each distinct state of such a caption into a transparent PNG
 * with node-canvas, then compiles one FFmpeg overlay chain per caption that
 * places, rotates, scales and fades the images over the video.
 *
 * ─── WHY IMAGES, NOT MORE drawtext ─────────────────────────────────────────
 * Per-word colour needs each word's pixel position inside the line, which
 * needs real font metrics. drawtext has none it can report, and it has no
 * rotation at all. @napi-rs/canvas is Skia, the engine Chrome draws the
 * preview with, and measures the actual font file, so the layout here
 * reproduces the preview's: an 80%-wide box, centred on (x, y), words as
 * inline blocks with a 0.25em right margin (CaptionWords in TextOverlay.jsx),
 * CSS "normal" line height from the font's own hhea/OS-2 metrics.
 *
 * Why not the `canvas` package already in package.json: on pango 1.48+ (our
 * Debian image ships 1.50) its registerFont() is silently ignored and every
 * caption falls back to a default serif. Verified, not assumed: "THIS CHANGED"
 * in Anton at 100px measures 516px (PIL, Skia) but 757px through `canvas`.
 *
 * ─── STATES ────────────────────────────────────────────────────────────────
 * `raster.wordStates` is a list of runs { from, to, shown, active, mix } in OUTPUT
 * time, computed client-side with the preview's own functions. Each distinct
 * (shown, active) pair is one PNG; an ffconcat list plays them back with the
 * right durations. A caption with no states (rotation only) is one image.
 * R107 added `mix`: the quantised strength of the active-word highlight, so a
 * highlight that blends in costs one image per step rather than per frame.
 *
 * ─── SAME CANVAS SIZE FOR EVERY STATE ──────────────────────────────────────
 * All images of one caption share one size and one anchor (the box centre at
 * the image centre), so the FFmpeg chain can treat the stream as one layer.
 *
 * ─── SCOPE ─────────────────────────────────────────────────────────────────
 * Glow is drawn at its PEAK value for the caption's whole life (the R63
 * drawtext path does the same). Animated opacity uses its full sampled curve,
 * including interior keyframes, static opacity exactly.
 * R92: bold and italic are SYNTHESISED (a fill-colour outline for bold, a
 * 12-degree slant for italic), the same thing a browser does when the font
 * has no bold or italic face, so the export matches the preview.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
    buildPiecewiseExpr, decimate, isAnimated, MAX_GEOMETRY_SAMPLES,
} = require('./CompositorCompiler.js');

const n4 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n * 10000) / 10000);
};

// Caption layers are rasterised before the FFmpeg overlay pass. Apply the
// common color/softness effects to that isolated RGBA stream so they affect
// caption pixels only, matching the preview's layer-scoped filter behavior.
function captionEffectFilters(effects) {
    const filters = [];
    const appendAnimatedIntervals = (samples, makeFilter) => {
        const valid = (Array.isArray(samples) ? samples : [])
            .filter(point => Number.isFinite(Number(point?.t)) && Number.isFinite(Number(point?.value)))
            .sort((a, b) => Number(a.t) - Number(b.t));
        if (valid.length < 2) return false;
        const maxSamples = 120;
        const bounded = valid.length > maxSamples
            ? Array.from({ length: maxSamples }, (_, i) => valid[Math.round(i * (valid.length - 1) / (maxSamples - 1))])
            : valid;
        for (let i = 0; i < bounded.length - 1; i++) {
            const from = Number(bounded[i].t), to = Number(bounded[i + 1].t);
            if (to > from) makeFilter(bounded[i].value, from, to);
        }
        return true;
    };
    for (const effect of Array.isArray(effects) ? effects : []) {
        if (!effect || effect.enabled === false) continue;
        const p = effect.params || {};
        const num = (key, fallback) => {
            const raw = p[key]?.value ?? p[key];
            const n = Number(raw);
            return Number.isFinite(n) ? n : fallback;
        };
        const expression = (key, fallback) => {
            const samples = Array.isArray(effect.samples?.[key])
                ? effect.samples[key].filter(point => Number.isFinite(Number(point?.t)) && Number.isFinite(Number(point?.value)))
                    .sort((a, b) => Number(a.t) - Number(b.t))
                : [];
            if (samples.length < 2) return n4(samples[0]?.value ?? num(key, fallback));
            let expr = n4(samples[samples.length - 1].value);
            for (let i = samples.length - 2; i >= 0; i--) {
                const from = samples[i], to = samples[i + 1];
                const span = Number(to.t) - Number(from.t);
                const segment = span > 0.001
                    ? `${n4(from.value)}+(${n4(Number(to.value) - Number(from.value))})*(t-${n4(from.t)})/${n4(span)}`
                    : n4(to.value);
                expr = `if(lt(t,${n4(to.t)}),${segment},${expr})`;
            }
            return `'${expr}'`;
        };
        const isAnimated = key => Array.isArray(effect.samples?.[key]) && effect.samples[key].length > 1;
        const kind = effect.kind || effect.type;
        if (kind === 'blur' || kind === 'blur_gaussian') {
            const blurSamples = Array.isArray(effect.samples?.radius) ? effect.samples.radius
                : Array.isArray(effect.samples?.amount) ? effect.samples.amount : [];
            if (blurSamples.length > 1) {
                // gblur exposes sigma as a runtime option but does not
                // implement sendcmd updates. Use time-gated instances instead:
                // exactly one fixed-radius filter is enabled for each sampled
                // interval, so the alpha/rgb blur is actually rendered rather
                // than silently accepting a no-op command.
                appendAnimatedIntervals(blurSamples, (value, from, to) => {
                    const sigma = Math.max(0, Math.min(40, Number(value) || 0));
                    if (!(to > from) || sigma <= 0.01) return;
                    filters.push(`gblur=sigma=${n4(sigma)}:enable='gte(t,${n4(from)})*lt(t,${n4(to)})'`);
                });
                continue;
            }
            const radius = Math.max(0, Math.min(40, num('radius', num('amount', 0))));
            if (radius > 0) filters.push(`gblur=sigma=${n4(radius)}`);
        } else if (kind === 'brightness') {
            if (isAnimated('amount')) {
                const amount = expression('amount', num('value', 1)).replace(/^'|'$/g, '');
                filters.push(`eq=brightness='clip((${amount}),0,2)-1':eval=frame`);
            } else {
                const amount = Math.max(0, Math.min(2, num('amount', num('value', 1))));
                filters.push(`eq=brightness=${n4(amount - 1)}`);
            }
        } else if (kind === 'contrast') {
            if (isAnimated('amount')) filters.push(`eq=contrast='clip(${expression('amount', num('value', 1)).replace(/^'|'$/g, '')},0,4)':eval=frame`);
            else filters.push(`eq=contrast=${n4(Math.max(0, Math.min(4, num('amount', num('value', 1)))))}`);
        } else if (kind === 'saturation' || kind === 'saturate') {
            if (isAnimated('amount')) filters.push(`eq=saturation='clip(${expression('amount', num('value', 1)).replace(/^'|'$/g, '')},0,5)':eval=frame`);
            else filters.push(`eq=saturation=${n4(Math.max(0, Math.min(5, num('amount', num('value', 1)))))}`);
        } else if (kind === 'hue' || kind === 'hue-rotate') {
            if (isAnimated('degrees')) filters.push(`hue=h='clip(${expression('degrees', num('amount', 0)).replace(/^'|'$/g, '')},-360,360)'`);
            else filters.push(`hue=h=${n4(num('degrees', num('amount', 0)))}`);
        } else if (kind === 'color_grade') {
            const contrast = expression('contrast', num('contrast', 100));
            const saturation = expression('saturation', num('saturation', 100));
            const hue = expression('hueRotate', num('hueRotate', 0));
            const mapPercent = value => `clip((${value})/100,0,2)`;
            const contrastValue = mapPercent(contrast.replace(/^'|'$/g, ''));
            const saturationValue = mapPercent(saturation.replace(/^'|'$/g, ''));
            const brightnessSamples = effect.samples?.brightness || [];
            if (brightnessSamples.length > 1) {
                appendAnimatedIntervals(brightnessSamples, (value, from, to) => {
                    const factor = Math.max(0, Math.min(2, Number(value) / 100));
                    filters.push(`colorchannelmixer=rr=${n4(factor)}:gg=${n4(factor)}:bb=${n4(factor)}:enable='gte(t,${n4(from)})*lt(t,${n4(to)})'`);
                });
            } else {
                const factor = Math.max(0, Math.min(2, num('brightness', 100) / 100));
                if (factor !== 1) filters.push(`colorchannelmixer=rr=${n4(factor)}:gg=${n4(factor)}:bb=${n4(factor)}`);
            }
            if (num('contrast', 100) !== 100 || isAnimated('contrast') || num('saturation', 100) !== 100 || isAnimated('saturation')) {
                filters.push(`eq=contrast='${contrastValue}':saturation='clip(${saturationValue},0,2)':eval=frame`);
            }
            if (isAnimated('hueRotate')) filters.push(`hue=h='clip(${hue.replace(/^'|'$/g, '')},-180,180)'`);
            else if (num('hueRotate', 0)) filters.push(`hue=h=${n4(Math.max(-180, Math.min(180, num('hueRotate', 0))))}`);
            const temperature = Math.max(-100, Math.min(100, num('temperature', 0))) * 0.003;
            const tint = Math.max(-100, Math.min(100, num('tint', 0))) * 0.003;
            if (temperature || tint) filters.push(`colorbalance=rs=${n4(temperature)}:bs=${n4(-temperature)}:gs=${n4(tint)}`);
        } else if (kind === 'grain' || kind === 'film_grain') {
            const rawIntensity = p.intensity?.value ?? p.intensity;
            const animatedSamples = kind === 'film_grain' || rawIntensity != null
                ? (effect.samples?.intensity || [])
                : (effect.samples?.amount || []);
            const animated = (samples, strengthOf) => appendAnimatedIntervals(samples, (value, from, to) => {
                const strength = Math.max(0, Math.min(48, strengthOf(Number(value) || 0)));
                if (strength <= 0) return;
                const animatedNoise = p.animated?.value ?? p.animated;
                const flags = kind === 'film_grain' && animatedNoise === false ? 'u' : 't+u';
                filters.push(`noise=c0s=${n4(strength)}:c1s=${n4(strength)}:c2s=${n4(strength)}:c3s=0:allf=${flags}:enable='gte(t,${n4(from)})*lt(t,${n4(to)})'`);
            });
            if (animatedSamples.length > 1) {
                animated(animatedSamples, value => kind === 'film_grain' ? value * 48 : value);
            } else {
                const strength = kind === 'film_grain'
                    ? Math.max(0, Math.min(48, num('intensity', 0.15) * 48))
                    : Math.max(0, Math.min(48, num('amount', 8)));
                if (strength > 0) {
                    const animatedNoise = p.animated?.value ?? p.animated;
                    const flags = kind === 'film_grain' && animatedNoise === false ? 'u' : 't+u';
                    filters.push(`noise=c0s=${n4(strength)}:c1s=${n4(strength)}:c2s=${n4(strength)}:c3s=0:allf=${flags}`);
                }
            }
        } else if (kind === 'chromatic-aberration' || kind === 'rgb_split') {
            const samples = effect.samples?.amount || [];
            const splitFilter = value => {
                if (kind === 'chromatic-aberration') {
                    const shift = Math.round(Math.max(0, Math.min(12, value)));
                    return shift ? `format=yuva444p,chromashift=cbh=${-shift}:crh=${shift}:edge=smear,format=rgba` : '';
                }
                const amount = Math.max(0, Math.min(50, value));
                if (!amount) return '';
                const angleValue = Number(p.angle?.value ?? p.angle);
                const angle = (Number.isFinite(angleValue) ? angleValue : 0) * Math.PI / 180;
                const centerXValue = Number(p.centerX?.value ?? p.centerX);
                const centerYValue = Number(p.centerY?.value ?? p.centerY);
                const centerX = Math.max(0, Math.min(1, Number.isFinite(centerXValue) ? centerXValue : 0.5));
                const centerY = Math.max(0, Math.min(1, Number.isFinite(centerYValue) ? centerYValue : 0.5));
                const dx = n4(Math.cos(angle) * amount), dy = n4(Math.sin(angle) * amount);
                const radial = `sqrt(pow(X/W-${n4(centerX)},2)+pow(Y/H-${n4(centerY)},2))`;
                const rx = `clip(X+(${dx})*(${radial}),0,W-1)`, ry = `clip(Y+(${dy})*(${radial}),0,H-1)`;
                const bx = `clip(X-(${dx})*(${radial}),0,W-1)`, by = `clip(Y-(${dy})*(${radial}),0,H-1)`;
                return `format=rgba,geq=r='r(${rx},${ry})':g='g(X,Y)':b='b(${bx},${by})':a='alpha(X,Y)'`;
            };
            if (samples.length > 1) {
                appendAnimatedIntervals(samples, (value, from, to) => {
                    const filter = splitFilter(Number(value) || 0);
                    if (filter) filters.push(`${filter}:enable='gte(t,${n4(from)})*lt(t,${n4(to)})'`);
                });
            } else {
                const filter = splitFilter(num('amount', kind === 'rgb_split' ? 5 : 1.5));
                if (filter) filters.push(filter);
            }
        } else if (kind === 'distortion') {
            const samples = effect.samples?.amount || [];
            if (samples.length > 1) {
                appendAnimatedIntervals(samples, (value, from, to) => {
                    const k1 = Math.max(-0.2, Math.min(0.2, Number(value) || 0));
                    if (!k1) return;
                    filters.push(`format=yuva444p,lenscorrection=cx=0.5:cy=0.5:k1=${n4(k1)}:k2=0:enable='gte(t,${n4(from)})*lt(t,${n4(to)})',format=rgba`);
                });
            } else {
                const k1 = Math.max(-0.2, Math.min(0.2, num('amount', 0)));
                if (k1) filters.push(`format=yuva444p,lenscorrection=cx=0.5:cy=0.5:k1=${n4(k1)}:k2=0,format=rgba`);
            }
        }
    }
    return filters;
}

// ─── Font metrics (CSS `line-height: normal`) ──────────────────────────────

const metricsCache = new Map();

/**
 * Read ascender/descender/lineGap from a TrueType/OpenType file, in em units.
 * Chrome uses OS/2 typo metrics when USE_TYPO_METRICS (fsSelection bit 7) is
 * set, hhea otherwise. Returns null for anything it cannot parse (.ttc, a
 * truncated file); callers fall back to 1.2em.
 */
function readFontMetrics(fontPath) {
    if (metricsCache.has(fontPath)) return metricsCache.get(fontPath);
    let result = null;
    try {
        const buf = fs.readFileSync(fontPath);
        const tag = buf.toString('latin1', 0, 4);
        if (tag === 'ttcf') throw new Error('collection');
        const numTables = buf.readUInt16BE(4);
        const tables = {};
        for (let i = 0; i < numTables; i++) {
            const rec = 12 + i * 16;
            tables[buf.toString('latin1', rec, rec + 4)] = buf.readUInt32BE(rec + 8);
        }
        if (tables.head === undefined || tables.hhea === undefined) throw new Error('missing head/hhea');
        const upm = buf.readUInt16BE(tables.head + 18) || 1000;
        let ascender = buf.readInt16BE(tables.hhea + 4);
        let descender = buf.readInt16BE(tables.hhea + 6);
        let lineGap = buf.readInt16BE(tables.hhea + 8);
        if (tables['OS/2'] !== undefined) {
            const os2 = tables['OS/2'];
            const fsSelection = buf.readUInt16BE(os2 + 62);
            if (fsSelection & (1 << 7)) {
                ascender = buf.readInt16BE(os2 + 68);
                descender = buf.readInt16BE(os2 + 70);
                lineGap = buf.readInt16BE(os2 + 72);
            }
        }
        result = { ascent: ascender / upm, descent: Math.abs(descender) / upm, lineGap: Math.max(0, lineGap) / upm };
    } catch (_) {
        result = null;
    }
    metricsCache.set(fontPath, result);
    return result;
}

// ─── Colours and CSS text-shadow ───────────────────────────────────────────

/** CSS colour string → canvas-safe colour string (hex/rgb/rgba pass through). */
function cssColor(value, fallback) {
    const s = String(value || '').trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(s) || /^rgba?\(/i.test(s) || /^[a-zA-Z]+$/.test(s)) return s;
    return fallback;
}

/** Every layer of a CSS text-shadow list, in paint order (last one drawn first). */
function parseAllTextShadows(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim() === 'none') return [];
    return value.split(/,(?![^(]*\))/g).map((raw) => {
        const s = raw.trim();
        const colorMatch = s.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/);
        const color = colorMatch ? colorMatch[0] : '#000000';
        const lengths = s.replace(colorMatch ? colorMatch[0] : '', '').trim().split(/\s+/)
            .filter(Boolean).map(v => parseFloat(v)).filter(v => Number.isFinite(v));
        const [x = 0, y = 0, blur = 0] = lengths;
        return { x, y, blur, color };
    }).filter(Boolean);
}

// ─── Layout ────────────────────────────────────────────────────────────────

/**
 * R107 — blend two colours, `p` of the way from `a` to `b`, in sRGB.
 *
 * A deliberate mirror of `ColorTheory.mixColor` / `withAlpha`: those are ESM
 * in client/src/motion and this file is CommonJS, so it cannot require them.
 * `scripts/test_text_craft.mjs` asserts the two agree on a table of inputs,
 * the same way `wordLook` below mirrors CaptionWords.
 */
function parseRgb(value) {
    const s = String(value || '').trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16));
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
        const parts = m[1].split(',').map(x => parseFloat(x));
        if (parts.length >= 3 && parts.every(x => Number.isFinite(x))) return parts.slice(0, 3);
    }
    return null;
}

function mixColor(a, b, p) {
    const t = Math.min(1, Math.max(0, Number(p)));
    const ca = parseRgb(a);
    const cb = parseRgb(b);
    if (!ca) return b;
    if (!cb) return a;
    if (t <= 0) return a;
    if (t >= 1) return b;
    const hex = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
    return `#${hex(ca[0] + (cb[0] - ca[0]) * t)}${hex(ca[1] + (cb[1] - ca[1]) * t)}${hex(ca[2] + (cb[2] - ca[2]) * t)}`;
}

function withAlpha(color, a) {
    const t = Math.min(1, Math.max(0, Number(a)));
    const c = parseRgb(color);
    if (!c) return null;
    return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${Number(t.toFixed(3))})`;
}

/**
 * Style of word `i` in a given state. Mirrors CaptionWords (TextOverlay.jsx):
 * emphasis first, then the active-word highlight on top.
 *
 * R107 — `state.mix` is the quantised strength of the active-word highlight,
 * computed client-side by CaptionCompiler with the preview's own function, so
 * the blend here reproduces the preview rather than approximating it. An older
 * program with no `mix` on its states is read as a fully-on highlight, which
 * is exactly what it used to render.
 */
function wordLook(i, state, raster, baseColor) {
    const look = { color: baseColor, background: null, scale: 1, opacity: 1, boxed: false };
    const visible = i < state.shown;
    look.opacity = visible ? 1 : 0;

    const em = raster.emphasis;
    if (em && Array.isArray(em.indices) && em.indices.includes(i) && em.style) {
        const st = em.style;
        if (st.scale && st.scale !== 1) look.scale = st.scale;
        if ((st.mode === 'color' || st.mode === 'box') && st.color) look.color = st.color;
        if (st.mode === 'box') { look.background = st.background || null; look.boxed = true; }
    }

    const hl = raster.highlight;
    const mode = hl?.mode || 'none';
    if (mode !== 'none' && i === state.active) {
        const mix = Number.isFinite(Number(state.mix)) ? Math.min(1, Math.max(0, Number(state.mix))) : 1;
        const blend = (c) => mixColor(look.color, c, mix);
        const box = (c) => withAlpha(c, mix) || c;
        const grow = (to) => Math.max(look.scale, 1 + (Number(to) - 1) * mix);
        if (hl.scale && hl.scale !== 1) look.scale = grow(hl.scale);
        if (mode === 'color' && hl.color) look.color = blend(hl.color);
        else if (mode === 'box') {
            if (hl.background) look.background = box(hl.background);
            if (hl.color) look.color = blend(hl.color);
            look.boxed = true;
        } else if (mode === 'vox-marker') {
            look.background = box(hl.background || '#FFE500');
            look.color = blend(hl.color || '#111827');
            look.boxed = true;
        } else if (mode === 'bounce-box') {
            look.background = box((i % 2 === 0 ? hl.background : hl.altBackground) || hl.background || '#FFE500');
            look.color = blend(hl.color || '#000000');
            look.boxed = true;
            look.scale = grow(hl.scale || 1.15);
        } else if (mode === 'terminal-cursor') {
            look.color = blend(hl.color || '#34D399');
        } else if (mode === 'neon-glow') {
            look.color = blend(hl.color || '#00E5FF');
        } else if (mode === 'opacity') look.opacity = 1;
    } else if (visible && mode === 'opacity' && state.active >= 0) {
        look.opacity = 0.55;
    }
    return look;
}

/**
 * Break words into lines inside `maxWidth`, like an 80%-wide pre-wrap box.
 * 'margin' gap: inline blocks with a 0.25em right margin, the margin counts
 * toward the line width (it does in CSS, and it shifts centred lines).
 * 'space' gap: a plain string; trailing spaces hang, so they do not count.
 */
function layoutLines(ctx, tokens, looks, fontPx, maxWidth, gapMode) {
    const em = fontPx;
    const items = tokens.map((tok, i) => {
        const w = ctx.measureText(tok).width;
        const pad = looks[i].boxed ? 0.24 * em : 0;
        return { i, tok, w, boxW: w + pad, pad };
    });
    const gap = gapMode === 'margin' ? 0.25 * em : ctx.measureText(' ').width;

    const lines = [];
    let cur = [];
    let curW = 0;
    for (const it of items) {
        const advance = it.boxW + gap;
        const fitsW = gapMode === 'margin' ? curW + advance : curW + it.boxW;
        if (cur.length > 0 && fitsW > maxWidth + 0.5) {
            lines.push(cur);
            cur = [];
            curW = 0;
        }
        cur.push(it);
        curW += advance;
    }
    if (cur.length > 0) lines.push(cur);

    return lines.map((line) => {
        let x = 0;
        const placed = line.map((it) => {
            const p = { ...it, x };
            x += it.boxW + gap;
            return p;
        });
        const width = gapMode === 'margin' ? x : x - gap; // hanging space in 'space' mode
        return { items: placed, width };
    });
}

/**
 * Draw one state of a caption.
 *
 * @returns {{canvas, width:number, height:number}}
 */
function drawState(Canvas, entry, state, opts) {
    const raster = entry.raster;
    const { fontAlias, metrics, renderScale, pxScale, boxWidth, padding } = opts;
    const fontPx = (Number(entry.style.fontSize) || 48) * renderScale;
    const fontSpec = `${fontPx}px "${fontAlias}"`;

    const tokens = Array.isArray(entry.tokens) && entry.tokens.length > 0
        ? entry.tokens
        : String(entry.text || '').split(' ').filter(Boolean);
    // R92: the preview's default is white (TextOverlay: clip.color || '#ffffff').
    const baseColor = cssColor(entry.style.color, '#FFFFFF');
    const looks = tokens.map((_, i) => wordLook(i, state, raster, baseColor));

    const measureCanvas = Canvas.createCanvas(4, 4);
    const mctx = measureCanvas.getContext('2d');
    mctx.font = fontSpec;

    const maxWidth = boxWidth * renderScale;
    const lines = layoutLines(mctx, tokens, looks, fontPx, maxWidth, raster.layout?.wordGap === 'margin' ? 'margin' : 'space');
    const lh = metrics
        ? (metrics.ascent + metrics.descent + metrics.lineGap) * fontPx
        : 1.2 * fontPx;
    const ascentPx = metrics ? metrics.ascent * fontPx : 0.8 * fontPx;
    const contentPx = metrics ? (metrics.ascent + metrics.descent) * fontPx : fontPx;
    const halfLeading = (lh - contentPx) / 2;

    const pad = Math.ceil(padding * renderScale);
    const width = Math.ceil(maxWidth + pad * 2);
    const height = Math.ceil(lines.length * lh + pad * 2);
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.font = fontSpec;
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';

    const align = raster.layout?.align || 'center';
    const strokeW = Number(entry.style.stroke?.width) > 0 ? Number(entry.style.stroke.width) * renderScale : 0;
    const strokeColor = cssColor(entry.style.stroke?.color, '#000000');
    const weight = String(raster.font?.weight || 'normal');
    const synthBold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
    const synthItalic = /italic|oblique/.test(String(raster.font?.style || ''));
    const boldW = synthBold ? Math.max(1, fontPx * 0.045) : 0;

    // Shadows: the preview's glow REPLACES clip.textShadow while it is active
    // (`glowShadow || clip.textShadow`); drawn at peak glow, see header.
    const glowPeak = Math.max(0, ...(entry.geometry || []).map(g => Number(g.glow) || 0));
    const shadows = glowPeak > 0.5
        ? [{ x: 0, y: 0, blur: glowPeak * 2, color: null }, { x: 0, y: 0, blur: glowPeak, color: null }]
        : parseAllTextShadows(raster.textShadow).reverse();

    const placedWords = [];
    const captionBackground = entry.style.backgroundColor
        ? cssColor(entry.style.backgroundColor, null)
        : null;
    const backgroundPadX = Math.max(0, Number(entry.style.backgroundPadding) || 0) * fontPx;
    const backgroundPadY = Math.max(0.04, (Number(entry.style.backgroundPadding) || 0) * 0.55) * fontPx;
    lines.forEach((line, li) => {
        let lineX;
        if (align === 'left') lineX = pad;
        else if (align === 'right') lineX = pad + maxWidth - line.width;
        else lineX = pad + (maxWidth - line.width) / 2;
        const top = pad + li * lh;
        const baseline = top + halfLeading + ascentPx;
        if (captionBackground && line.width > 0) {
            const bx = lineX - backgroundPadX;
            const by = top + halfLeading - backgroundPadY;
            const bw = line.width + backgroundPadX * 2;
            const bh = contentPx + backgroundPadY * 2;
            const radius = Math.min(fontPx * 0.06, bh / 2, bw / 2);
            ctx.fillStyle = captionBackground;
            if (typeof ctx.roundRect === 'function') {
                ctx.beginPath();
                ctx.roundRect(bx, by, bw, bh, radius);
                ctx.fill();
            } else {
                ctx.fillRect(bx, by, bw, bh);
            }
        }
        for (const it of line.items) {
            placedWords.push({
                ...it,
                look: looks[it.i],
                left: lineX + it.x,
                top,
                baseline,
                lineHeight: lh,
            });
        }
    });

    // Paint order per word, like CSS: background box, shadows, fill, stroke.
    const paintWord = (w, pass) => {
        if (w.look.opacity <= 0) return;
        const cx = w.left + w.boxW / 2;
        const cy = w.top + w.lineHeight / 2;
        ctx.save();
        ctx.globalAlpha = w.look.opacity;
        if (w.look.scale !== 1) {
            ctx.translate(cx, cy);
            ctx.scale(w.look.scale, w.look.scale);
            ctx.translate(-cx, -cy);
        }
        const textX = w.left + w.pad / 2;
        if (synthItalic) {
            // Slant around the baseline so the word stays on its line.
            ctx.transform(1, 0, -0.21, 1, 0.21 * w.baseline, 0);
        }
        if (pass === 'box' && w.look.background) {
            const r = 0.08 * fontPx;
            const bx = w.left, by = w.top + halfLeading, bw = w.boxW, bh = contentPx;
            ctx.fillStyle = cssColor(w.look.background, '#000000');
            ctx.beginPath();
            ctx.moveTo(bx + r, by);
            ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
            ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
            ctx.arcTo(bx, by + bh, bx, by, r);
            ctx.arcTo(bx, by, bx + bw, by, r);
            ctx.closePath();
            ctx.fill();
        } else if (pass === 'shadow') {
            for (const sh of shadows) {
                ctx.save();
                ctx.shadowColor = cssColor(sh.color, w.look.color);
                ctx.shadowBlur = sh.blur * pxScale * renderScale;
                ctx.shadowOffsetX = sh.x * pxScale * renderScale;
                ctx.shadowOffsetY = sh.y * pxScale * renderScale;
                ctx.fillStyle = cssColor(w.look.color, '#FFFFFF');
                ctx.fillText(w.tok, textX, w.baseline);
                if (boldW > 0) { ctx.lineWidth = boldW; ctx.strokeStyle = ctx.fillStyle; ctx.strokeText(w.tok, textX, w.baseline); }
                ctx.restore();
            }
        } else if (pass === 'fill') {
            ctx.fillStyle = cssColor(w.look.color, '#FFFFFF');
            ctx.fillText(w.tok, textX, w.baseline);
            if (boldW > 0) {
                // Synthetic bold: thicken the glyph with its own colour.
                ctx.lineWidth = boldW;
                ctx.strokeStyle = ctx.fillStyle;
                ctx.strokeText(w.tok, textX, w.baseline);
            }
            if (strokeW > 0) {
                // -webkit-text-stroke: centred on the outline, painted over the fill.
                ctx.lineWidth = strokeW;
                ctx.strokeStyle = strokeColor;
                ctx.strokeText(w.tok, textX, w.baseline);
            }
        }
        ctx.restore();
    };
    for (const pass of ['box', 'shadow', 'fill']) {
        for (const w of placedWords) paintWord(w, pass);
    }

    return { canvas, width, height };
}

// ─── Preparation: PNGs + ffconcat list per caption ─────────────────────────

/**
 * Render every raster entry's states to PNGs.
 *
 * @param {Array} entries caption-program entries carrying a `raster` block
 * @param {object} opts
 *   tmpDir, frameWidth, frameHeight
 *   resolveFont(family) → absolute font path | null
 *   fallbackFontPath
 *   pxScale  reference-resolution px → render px (exportProcessor's captionScaleFactor)
 *   canvasModule  injectable for tests (defaults to require('@napi-rs/canvas'))
 * @returns {{items:Array, tempFiles:string[], skipped:Array<{clipId,reason}>}}
 */
function prepareRasterCaptions(entries, opts) {
    const out = { items: [], tempFiles: [], skipped: [] };
    const list = (Array.isArray(entries) ? entries : []).filter(e => e && e.raster);
    if (list.length === 0) return out;

    const Canvas = opts.canvasModule || require('@napi-rs/canvas');
    const frameW = Number(opts.frameWidth) || 1080;
    const pxScale = Number(opts.pxScale) > 0 ? Number(opts.pxScale) : 1;

    // Register each font file once, under a private alias, BEFORE any canvas
    // that uses it is created (node-canvas requirement).
    const aliasByPath = new Map();
    const aliasFor = (fontPath) => {
        if (aliasByPath.has(fontPath)) return aliasByPath.get(fontPath);
        const alias = `VibedRaster${aliasByPath.size}`;
        if (!Canvas.GlobalFonts.registerFromPath(fontPath, alias)) {
            throw new Error(`font could not be loaded: ${path.basename(fontPath)}`);
        }
        aliasByPath.set(fontPath, alias);
        return alias;
    };
    const fontFor = (entry) => {
        const fam = entry.style?.fontFamily;
        return (fam && opts.resolveFont(fam)) || opts.fallbackFontPath || null;
    };
    // Register every font up front (node-canvas requires registration BEFORE a
    // canvas that uses it is created). One unregisterable file used to throw
    // straight out of this function, past the per-entry try/catch below — so a
    // single bad font file lost EVERY caption in the export, not one. With
    // PARITY_ALL_TEXT that is the whole look of the video: wrapping, the
    // keyword highlight, rotation, weight and alignment all revert to one
    // unwrapped drawtext line. The per-entry `skipped` list exists precisely so
    // one caption can fail alone; this loop defeated it.
    //
    // A font that will not register is recorded against the entries that wanted
    // it and they fall back individually, which is what the rest of this
    // function was already written to do.
    const unusableFonts = new Map();
    for (const e of list) {
        const f = fontFor(e);
        if (!f) continue;
        try {
            aliasFor(f);
        } catch (fontErr) {
            unusableFonts.set(f, fontErr.message);
        }
    }

    list.forEach((entry, idx) => {
        try {
            const fontPath = fontFor(entry);
            if (!fontPath) { out.skipped.push({ clipId: entry.clipId, reason: 'no font' }); return; }
            if (unusableFonts.has(fontPath)) {
                out.skipped.push({ clipId: entry.clipId, reason: unusableFonts.get(fontPath) });
                return;
            }
            const alias = aliasFor(fontPath);
            const metrics = readFontMetrics(fontPath);

            const geometry = Array.isArray(entry.geometry) ? entry.geometry : [];
            const maxScale = Math.max(...geometry.map(g => Number(g.scale) || 1), 0.05);
            // Draw at the largest scale the caption reaches, so FFmpeg only ever
            // scales DOWN (no blurry upscaling during a pop-in).
            const renderScale = Math.min(4, Math.max(maxScale, 0.25));

            const fontSize = Number(entry.style?.fontSize) || 48;
            const shadowReach = parseAllTextShadows(entry.raster.textShadow)
                .reduce((m, s) => Math.max(m, Math.abs(s.x) + Math.abs(s.y) + s.blur * 2), 0) * pxScale;
            const glowPeak = Math.max(0, ...geometry.map(g => Number(g.glow) || 0)) * 4 * pxScale;
            const emScale = Math.max(entry.raster.emphasis?.style?.scale || 1, entry.raster.highlight?.scale || 1);
            const padding = Math.ceil(fontSize * (0.35 + (emScale - 1)) + shadowReach + glowPeak
                + (Number(entry.style?.stroke?.width) || 0) * 2);

            const boxWidth = frameW * (Number(entry.raster.layout?.widthFrac) || 0.8);

            const states = Array.isArray(entry.raster.wordStates) && entry.raster.wordStates.length > 0
                ? entry.raster.wordStates
                : [{ from: entry.outputStart, to: entry.outputEnd, shown: Number.MAX_SAFE_INTEGER, active: -1, mix: 1 }];

            // Draw each distinct state once, then pad all to one common size.
            // R107 — the key includes `mix`: two steps of one highlight ramp
            // differ ONLY in mix, so leaving it out would collapse them into a
            // single image and the ramp would never reach the screen.
            const stateKey = (st) => `${st.shown}|${st.active}|${Number.isFinite(Number(st.mix)) ? Number(st.mix) : 1}`;
            const drawn = new Map();
            for (const st of states) {
                const key = stateKey(st);
                if (drawn.has(key)) continue;
                drawn.set(key, drawState(Canvas, entry, st, {
                    fontAlias: alias, metrics, renderScale, pxScale, boxWidth, padding,
                }));
            }
            let W = 0, H = 0;
            for (const d of drawn.values()) { W = Math.max(W, d.width); H = Math.max(H, d.height); }
            W += W % 2; H += H % 2;

            const files = new Map();
            let k = 0;
            for (const [key, d] of drawn) {
                const c = Canvas.createCanvas(W, H);
                c.getContext('2d').drawImage(d.canvas, Math.round((W - d.width) / 2), Math.round((H - d.height) / 2));
                const file = path.join(opts.tmpDir, `rcap-${idx}-${k++}.png`);
                fs.writeFileSync(file, c.toBuffer('image/png'));
                files.set(key, file);
                out.tempFiles.push(file);
            }

            // ffconcat timeline, relative to the caption's own start.
            const t0 = Number(entry.outputStart) || 0;
            const runs = states
                .map(st => ({ file: files.get(stateKey(st)), from: Math.max(t0, Number(st.from)), to: Math.min(Number(entry.outputEnd), Number(st.to)) }))
                .filter(r => r.file && r.to > r.from);
            if (runs.length === 0) { out.skipped.push({ clipId: entry.clipId, reason: 'empty time window' }); return; }

            const esc = (p) => p.replace(/'/g, "'\\''");
            const lines = ['ffconcat version 1.0'];
            // A leading gap (first state starting after the caption start) is
            // covered by the enable window, so the first image simply starts at t0.
            runs.forEach((r) => {
                lines.push(`file '${esc(r.file)}'`);
                lines.push(`duration ${n4(r.to - r.from)}`);
            });
            lines.push(`file '${esc(runs[runs.length - 1].file)}'`); // concat demuxer: last entry needs repeating
            const listPath = path.join(opts.tmpDir, `rcap-${idx}.ffconcat`);
            fs.writeFileSync(listPath, lines.join('\n') + '\n', 'utf8');
            out.tempFiles.push(listPath);

            out.items.push({
                clipId: entry.clipId,
                compositionStack: Array.isArray(entry.compositionStack) ? entry.compositionStack : [],
                sceneId: entry.sceneId ?? null,
                listPath,
                width: W,
                height: H,
                renderScale,
                outputStart: Math.max(t0, runs[0].from),
                outputEnd: Number(entry.outputEnd),
                effects: Array.isArray(entry.raster.effects) ? entry.raster.effects : [],
                geometry: decimate(geometry, MAX_GEOMETRY_SAMPLES),
                images: files.size,
            });
        } catch (err) {
            out.skipped.push({ clipId: entry.clipId, reason: err.message });
        }
    });

    return out;
}

// ─── FFmpeg graph ──────────────────────────────────────────────────────────

/**
 * Build the filter_complex placing every prepared caption over input 0.
 *
 * @param {Array} items from prepareRasterCaptions
 * @param {{frameWidth:number, frameHeight:number, fps:number, firstInputIndex?:number}} opts
 * @returns {{filterComplex:string, outputLabel:string, inputs:Array<{path:string, inputOptions:string[]}>}|null}
 */
function compileRasterOverlays(items, opts) {
    const list = Array.isArray(items) ? items : [];
    const drawtextGroups = (Array.isArray(opts.drawtextGroups) ? opts.drawtextGroups : [])
        .filter(group => Array.isArray(group?.filters) && group.filters.length > 0);
    if (list.length === 0 && drawtextGroups.length === 0) return null;
    const W = Number(opts.frameWidth) || 1080;
    const H = Number(opts.frameHeight) || 1920;
    const fps = Number(opts.fps) > 0 ? Number(opts.fps) : 30;
    const first = Number.isInteger(opts.firstInputIndex) ? opts.firstInputIndex : 1;

    const chains = [];
    const inputs = [];
    // Callers that already have an isolated transparent RGBA base can seed
    // the caption graph from that label; the normal export path still starts
    // from its input video exactly as before.
    const inputLabel = opts.inputLabel || '0:v';
    const order = opts.orderByClipId instanceof Map
        ? opts.orderByClipId
        : new Map(Object.entries(opts.orderByClipId || {}));
    const layers = [
        ...list.map((item, index) => ({ kind: 'raster', item, clipId: item.clipId, index })),
        ...drawtextGroups.map((group, index) => ({ kind: 'drawtext', group, clipId: group.clipId, index: list.length + index })),
    ].sort((a, b) => Number(order.get(a.clipId) ?? Number.MAX_SAFE_INTEGER)
        - Number(order.get(b.clipId) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);

    let serial = 0;
    const label = prefix => `${prefix}${serial++}`;
    const duration = Math.max(0.1, Number(opts.duration) || 0,
        ...layers.map(layer => Number(layer.item?.outputEnd) || 0));

    // Reconstruct composition ancestry before rendering. Siblings can be
    // separated in the flattened list by other tracks; they still share one
    // isolated canvas and receive the parent alpha once when that group closes.
    const buildTree = (source, depth = 0) => {
        const consumed = new Set();
        const output = [];
        for (let index = 0; index < source.length; index++) {
            if (consumed.has(index)) continue;
            const layer = source[index];
            const stack = Array.isArray(layer.compositionStack) ? layer.compositionStack : [];
            const group = stack[depth];
            if (!group?.id) {
                consumed.add(index);
                output.push({ type: 'layer', layer });
                continue;
            }
            const sceneId = layer.sceneId ?? null;
            const parentPath = stack.slice(0, depth).map(item => item?.id);
            const members = [];
            for (let candidate = index; candidate < source.length; candidate++) {
                if (consumed.has(candidate)) continue;
                const candidateStack = Array.isArray(source[candidate].compositionStack) ? source[candidate].compositionStack : [];
                if (candidateStack[depth]?.id !== group.id || (source[candidate].sceneId ?? null) !== sceneId) continue;
                if (!parentPath.every((id, parentIndex) => candidateStack[parentIndex]?.id === id)) continue;
                consumed.add(candidate);
                members.push(source[candidate]);
            }
            output.push({ type: 'composition', group, sceneId, children: buildTree(members, depth + 1) });
        }
        return output;
    };

    const renderLayer = (layer, current, requestedOutLabel = null) => {
        const outLabel = requestedOutLabel || label('rcb');
        if (layer.kind === 'drawtext') {
            const filters = Array.isArray(layer.group.filters) ? layer.group.filters : [];
            if (!filters.length) return current;
            chains.push(`[${current}]${filters.join(',')}[${outLabel}]`);
            return outLabel;
        }
        const it = layer.item;
        const samples = it.geometry;
        const s0 = samples[0] || { scale: 1, rotation: 0, opacity: 1 };
        const rotAnimated = isAnimated(samples, 'rotation');
        const rot0 = Number(s0.rotation) || 0;
        const hasRotation = rotAnimated || Math.abs(rot0) > 0.05;
        const scaleAnimated = isAnimated(samples, 'scale');
        const opacityAnimated = isAnimated(samples, 'opacity');
        // Sparse streams (one frame per state) are enough unless something
        // changes every frame; then densify to the output frame rate.

        const parts = [];
        // Explicitly set the stream fps to match the target frame rate. Concat demuxer
        // streams have no fixed fps; without this, FFmpeg auto-inserts an fps filter
        // defaulting to 25 fps, causing timebase mismatches against 30/60 fps base video.
        parts.push(`fps=${fps}`);
        parts.push(`setpts=PTS-STARTPTS+${n4(it.outputStart)}/TB`);
        parts.push('format=rgba');
        parts.push(...captionEffectFilters(it.effects));

        if (hasRotation) {
            const angle = rotAnimated
                ? buildPiecewiseExpr(samples, 'rotation', Math.PI / 180)
                : n4(rot0 * Math.PI / 180);
            // Output size fixed at the diagonal so any angle fits; the overlay
            // below centres on overlay_w/overlay_h, so the extra margin is harmless.
            parts.push(`rotate=a='${angle}':c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`);
        }

        const rs = it.renderScale || 1;
        if (scaleAnimated) {
            const f = buildPiecewiseExpr(samples, 'scale', 1 / rs);
            parts.push(`scale=w='max(2,2*floor(iw*(${f})/2))':h='max(2,2*floor(ih*(${f})/2))':eval=frame`);
        } else {
            const f = (Number(s0.scale) || 1) / rs;
            if (Math.abs(f - 1) > 0.001) {
                parts.push(`scale=w='max(2,2*floor(iw*${n4(f)}/2))':h='max(2,2*floor(ih*${n4(f)}/2))'`);
            }
        }

        if (opacityAnimated) {
            const opacityExpr = buildPiecewiseExpr(samples, 'opacity')
                .replace(/\bt\b/g, 'T')
                .replace(/,/g, '\\,');
            parts.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip(alpha(X,Y)*(${opacityExpr}),0,255)'`);
        } else if ((Number(s0.opacity) ?? 1) < 0.999) {
            parts.push(`colorchannelmixer=aa=${n4(Math.max(0, Math.min(1, Number(s0.opacity))))}`);
        }

        const inputIdx = first + inputs.length;
        inputs.push({ path: it.listPath, inputOptions: ['-f', 'concat', '-safe', '0'] });
        const captionLabel = label('rc');
        chains.push(`[${inputIdx}:v]${parts.join(',')}[${captionLabel}]`);

        // x/y are the caption box CENTRE in percent (TextOverlay convention).
        const xExpr = buildPiecewiseExpr(samples, 'x', W / 100);
        const yExpr = buildPiecewiseExpr(samples, 'y', H / 100);
        chains.push(
            `[${current}][${captionLabel}]overlay=x='${xExpr}-overlay_w/2':y='${yExpr}-overlay_h/2'` +
            `:eval=frame:eof_action=pass:enable='between(t,${n4(it.outputStart)},${n4(it.outputEnd)})'[${outLabel}]`
        );
        return outLabel;
    };

    const renderNodes = (nodes, current, terminal = false) => {
        for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
            const node = nodes[nodeIndex];
            const isTerminal = terminal && nodeIndex === nodes.length - 1;
            if (node.type === 'layer') {
                current = renderLayer(node.layer, current, isTerminal ? 'rcout' : null);
                continue;
            }
            const inner = label('comp');
            chains.push(`color=c=black@0:s=${W}x${H}:r=${fps}:d=${n4(duration)},format=rgba[${inner}]`);
            const groupContent = renderNodes(node.children, inner);
            const samples = Array.isArray(node.group.opacitySamples) ? node.group.opacitySamples : [];
            const cleanSamples = samples.filter(sample => Number.isFinite(Number(sample?.t)) && Number.isFinite(Number(sample?.value)));
            const min = cleanSamples.length ? Math.min(...cleanSamples.map(sample => Math.max(0, Math.min(1, Number(sample.value))))) : 1;
            const max = cleanSamples.length ? Math.max(...cleanSamples.map(sample => Math.max(0, Math.min(1, Number(sample.value))))) : 1;
            let processed = groupContent;
            if (Math.abs(max - min) > 1e-5 && cleanSamples.length > 1) {
                const expr = buildPiecewiseExpr(cleanSamples, 'value').replace(/\bt\b/g, 'T').replace(/,/g, '\\,');
                const alpha = label('compalpha');
                chains.push(`[${processed}]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip(alpha(X,Y)*(${expr}),0,255)'[${alpha}]`);
                processed = alpha;
            } else {
                const opacity = cleanSamples.length ? Math.max(0, Math.min(1, Number(cleanSamples[0].value))) : Math.max(0, Math.min(1, Number(node.group.opacity ?? 1)));
                if (opacity < 0.999) {
                    const alpha = label('compalpha');
                    chains.push(`[${processed}]format=rgba,colorchannelmixer=aa=${n4(opacity)}[${alpha}]`);
                    processed = alpha;
                }
            }
            const composed = isTerminal ? 'rcout' : label('compout');
            chains.push(`[${current}][${processed}]overlay=x=0:y=0:format=auto:shortest=1:eof_action=pass[${composed}]`);
            current = composed;
        }
        return current;
    };

    const tree = buildTree(layers.map(layer => ({ ...layer, compositionStack: layer.kind === 'raster'
        ? layer.item.compositionStack : layer.group.compositionStack })));
    const final = renderNodes(tree, inputLabel, true);

    return { filterComplex: chains.join(';'), outputLabel: 'rcout', inputs };
}

/** Program entries that should go through this module. */
function rasterEntries(program) {
    return (program && Array.isArray(program.entries) ? program.entries : []).filter(e => e && e.raster);
}

module.exports = {
    prepareRasterCaptions,
    compileRasterOverlays,
    rasterEntries,
    // exported for the regression suite
    readFontMetrics,
    parseAllTextShadows,
    layoutLines,
    wordLook,
    mixColor,
    withAlpha,
};
