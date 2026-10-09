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
 * `raster.wordStates` is a list of runs { from, to, shown, active } in OUTPUT
 * time, computed client-side with the preview's own functions. Each distinct
 * (shown, active) pair is one PNG; an ffconcat list plays them back with the
 * right durations. A caption with no states (rotation only) is one image.
 *
 * ─── SAME CANVAS SIZE FOR EVERY STATE ──────────────────────────────────────
 * All images of one caption share one size and one anchor (the box centre at
 * the image centre), so the FFmpeg chain can treat the stream as one layer.
 *
 * ─── SCOPE ─────────────────────────────────────────────────────────────────
 * Glow is drawn at its PEAK value for the caption's whole life (the R63
 * drawtext path does the same). Animated opacity is reproduced as fade-in /
 * fade-out (CompositorCompiler.findFade), static opacity exactly.
 * R92: bold and italic are SYNTHESISED (a fill-colour outline for bold, a
 * 12-degree slant for italic), the same thing a browser does when the font
 * has no bold or italic face, so the export matches the preview.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
    buildPiecewiseExpr, decimate, isAnimated, findFade, MAX_GEOMETRY_SAMPLES,
} = require('./CompositorCompiler.js');

const n4 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n * 10000) / 10000);
};

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
 * Style of word `i` in a given state. Mirrors CaptionWords (TextOverlay.jsx):
 * emphasis first, then the active-word highlight on top.
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
        if (hl.scale && hl.scale !== 1) look.scale = Math.max(look.scale, hl.scale);
        if (mode === 'color' && hl.color) look.color = hl.color;
        else if (mode === 'box') {
            if (hl.background) look.background = hl.background;
            if (hl.color) look.color = hl.color;
            look.boxed = true;
        } else if (mode === 'vox-marker') {
            look.background = hl.background || '#FFE500';
            look.color = hl.color || '#111827';
            look.boxed = true;
        } else if (mode === 'bounce-box') {
            look.background = (i % 2 === 0 ? hl.background : hl.altBackground) || hl.background || '#FFE500';
            look.color = hl.color || '#000000';
            look.boxed = true;
            look.scale = Math.max(look.scale, hl.scale || 1.15);
        } else if (mode === 'terminal-cursor') {
            look.color = hl.color || '#34D399';
        } else if (mode === 'neon-glow') {
            look.color = hl.color || '#00E5FF';
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
    lines.forEach((line, li) => {
        let lineX;
        if (align === 'left') lineX = pad;
        else if (align === 'right') lineX = pad + maxWidth - line.width;
        else lineX = pad + (maxWidth - line.width) / 2;
        const top = pad + li * lh;
        const baseline = top + halfLeading + ascentPx;
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
    for (const e of list) {
        const f = fontFor(e);
        if (f) aliasFor(f);
    }

    list.forEach((entry, idx) => {
        try {
            const fontPath = fontFor(entry);
            if (!fontPath) { out.skipped.push({ clipId: entry.clipId, reason: 'no font' }); return; }
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
                : [{ from: entry.outputStart, to: entry.outputEnd, shown: Number.MAX_SAFE_INTEGER, active: -1 }];

            // Draw each distinct state once, then pad all to one common size.
            const drawn = new Map();
            for (const st of states) {
                const key = `${st.shown}|${st.active}`;
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
                .map(st => ({ file: files.get(`${st.shown}|${st.active}`), from: Math.max(t0, Number(st.from)), to: Math.min(Number(entry.outputEnd), Number(st.to)) }))
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
                listPath,
                width: W,
                height: H,
                renderScale,
                outputStart: Math.max(t0, runs[0].from),
                outputEnd: Number(entry.outputEnd),
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
    if (list.length === 0) return null;
    const W = Number(opts.frameWidth) || 1080;
    const H = Number(opts.frameHeight) || 1920;
    const fps = Number(opts.fps) > 0 ? Number(opts.fps) : 30;
    const first = Number.isInteger(opts.firstInputIndex) ? opts.firstInputIndex : 1;

    const chains = [];
    const inputs = [];
    let current = '0:v';

    list.forEach((it, i) => {
        const samples = it.geometry;
        const s0 = samples[0] || { scale: 1, rotation: 0, opacity: 1 };
        const rotAnimated = isAnimated(samples, 'rotation');
        const rot0 = Number(s0.rotation) || 0;
        const hasRotation = rotAnimated || Math.abs(rot0) > 0.05;
        const scaleAnimated = isAnimated(samples, 'scale');
        const opacityAnimated = isAnimated(samples, 'opacity');
        // Sparse streams (one frame per state) are enough unless something
        // changes every frame; then densify to the output frame rate.
        const dense = rotAnimated || scaleAnimated || opacityAnimated;

        const parts = [];
        if (dense) parts.push(`fps=${fps}`);
        parts.push(`setpts=PTS-STARTPTS+${n4(it.outputStart)}/TB`);
        parts.push('format=rgba');

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
            const fadeIn = findFade(samples, 'in');
            const fadeOut = findFade(samples, 'out');
            if (fadeIn)  parts.push(`fade=t=in:st=${n4(fadeIn.start)}:d=${n4(fadeIn.duration)}:alpha=1`);
            if (fadeOut) parts.push(`fade=t=out:st=${n4(fadeOut.start)}:d=${n4(fadeOut.duration)}:alpha=1`);
        } else if ((Number(s0.opacity) ?? 1) < 0.999) {
            parts.push(`colorchannelmixer=aa=${n4(Math.max(0, Math.min(1, Number(s0.opacity))))}`);
        }

        const inputIdx = first + i;
        inputs.push({ path: it.listPath, inputOptions: ['-f', 'concat', '-safe', '0'] });
        chains.push(`[${inputIdx}:v]${parts.join(',')}[rc${i}]`);

        // x/y are the caption box CENTRE in percent (TextOverlay convention).
        const xExpr = buildPiecewiseExpr(samples, 'x', W / 100);
        const yExpr = buildPiecewiseExpr(samples, 'y', H / 100);
        const outLabel = i === list.length - 1 ? 'rcout' : `rcb${i}`;
        chains.push(
            `[${current}][rc${i}]overlay=x='${xExpr}-overlay_w/2':y='${yExpr}-overlay_h/2'` +
            `:eval=frame:enable='between(t,${n4(it.outputStart)},${n4(it.outputEnd)})'[${outLabel}]`
        );
        current = outLabel;
    });

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
};
