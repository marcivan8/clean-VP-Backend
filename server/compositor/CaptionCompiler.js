/**
 * server/compositor/CaptionCompiler.js
 *
 * Compiles a caption program (built by `client/src/motion/CaptionCompiler.js`)
 * into `drawtext` filter strings for `jobs/exportProcessor.js` STEP 4.
 *
 * ─── WHY THIS EXISTS (R63) ───────────────────────────────────────────────────
 * STEP 4 burns ONE static `drawtext` per caption clip for its whole duration,
 * reading only fontFamily/fontSize/color/stroke. Every animation, textShadow,
 * uppercase transform, and word-by-word reveal that the motion engine (R58)
 * and its preview renderer (`TextOverlay.jsx`) already do correctly was
 * silently absent from the exported video — animated in the editor, flat in
 * the file, no error anywhere. This module is the other half of closing that
 * gap: the client decides WHAT each caption looks like at every instant
 * (`CaptionCompiler.buildCaptionProgram`, using the SAME `resolveMotionAt`
 * the preview uses); this module only translates that into FFmpeg syntax —
 * same split as `CompositorCompiler.js`, same reason (R14/R16/R53/R56: two
 * implementations of one visual rule is how this codebase's preview and
 * export silently disagree).
 *
 * ─── REUSES CompositorCompiler'S PIECEWISE EXPRESSION BUILDER ───────────────
 * `buildPiecewiseExpr(samples, key, scale)` already exists there, already
 * keyed on `t` = output time, already proven against a real encoder. A
 * caption's animated x/y/scale/opacity are the same shape of problem an
 * overlay's animated geometry is — importing it rather than rewriting it is
 * what keeps "one nested-if expression style" true instead of two.
 *
 * ─── ONE MECHANISM PLAYS THREE ROLES ─────────────────────────────────────────
 * `drawtext`'s `fontsize=` and `alpha=` options accept per-frame expressions
 * (verified against a real ffmpeg binary — this is not assumed from the docs;
 * see the R63 CLAUDE.md entry for the verification transcript). That single
 * fact is what makes animated scale and opacity possible in export at all —
 * without it, "the caption pops in" would have needed a much heavier
 * mechanism (e.g. pre-rendering frames). `text_w`/`text_h` re-derive from the
 * CURRENT per-frame fontsize automatically, which is what keeps a growing
 * caption correctly CENTRED rather than drifting as it scales — also verified,
 * not assumed.
 *
 * ─── SCOPE, STATED PLAINLY (matches the client module's header) ─────────────
 * Ships: animated x/y/scale/opacity, ONE textShadow layer (offset drawtext
 * duplicate), a glow APPROXIMATION (two extra outline passes in the text's
 * own colour, low alpha — a soft halo, not a true Gaussian blur), uppercase
 * (applied client-side before the text ever reaches here), and word-by-word
 * reveal (multiple textfile segments gated by `enable`).
 * Does NOT ship: per-word highlight colour (needs per-word pixel positions —
 * font metrics this pipeline doesn't have) or animated rotation (drawtext has
 * none; R60's compositor made the identical call for overlays).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { buildPiecewiseExpr, decimate, MAX_GEOMETRY_SAMPLES } = require('./CompositorCompiler.js');

/** Plan version this worker knows how to execute — tracks CAPTION_PROGRAM_VERSION client-side. */
const SUPPORTED_PROGRAM_VERSION = 1;

/**
 * Parse a hex or rgba()/rgb() colour string into FFmpeg's `0xRRGGBB` (+ an
 * alpha, kept separate since FFmpeg wants alpha as its own `@` suffix).
 * Falls back to opaque black on anything unrecognised — a wrong shadow
 * colour is a cosmetic miss, not a reason to drop the whole caption.
 */
function parseColor(value) {
    const s = (value || '').trim();
    const rgbaMatch = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
    if (rgbaMatch) {
        const [, r, g, b, a] = rgbaMatch;
        const hex = [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0')).join('');
        return { hex: `0x${hex}`, alpha: a !== undefined ? Math.max(0, Math.min(1, Number(a))) : 1 };
    }
    const hexMatch = s.match(/^#?([0-9a-fA-F]{6})$/);
    if (hexMatch) return { hex: `0x${hexMatch[1]}`, alpha: 1 };
    return { hex: '0x000000', alpha: 1 };
}

/** Text file path for one (clip, segment) pair — collisions would silently swap captions. */
function segmentTextPath(tmpDir, clipId, segIdx) {
    return path.join(tmpDir, `capprog-${clipId}-${segIdx}.txt`);
}

/**
 * Build the visible-text segments for one entry: either the whole caption for
 * its whole window (no reveal), or one segment per reveal step (word-by-word).
 * Empty-prefix steps (prefixCount === 0) are dropped — nothing to draw yet.
 */
function buildSegments(entry) {
    if (!Array.isArray(entry.revealSteps) || entry.revealSteps.length === 0) {
        return [{ text: entry.text, from: entry.outputStart, to: entry.outputEnd }];
    }
    return entry.revealSteps
        .filter(s => s.prefixCount > 0)
        .map(s => ({
            text: entry.tokens.slice(0, s.prefixCount).join(' '),
            from: s.fromOutput,
            to: s.toOutput,
        }));
}

/**
 * Compile one caption program entry into a list of `drawtext` filter strings
 * (to be joined with commas into the SAME `-vf` chain STEP 4 already builds).
 *
 * @param {object} entry    one `program.entries[]` item
 * @param {object} ctx      { tmpDir, fontFile, escapePath }
 * @returns {{filters: string[], tempFiles: string[]}}
 */
function compileCaptionEntry(entry, ctx) {
    const samples = decimate(entry.geometry, MAX_GEOMETRY_SAMPLES);
    const scaleExpr = buildPiecewiseExpr(samples, 'scale', entry.style.fontSize);
    const xFracExpr = buildPiecewiseExpr(samples, 'x', 0.01); // clip.x is 0..100 → fraction
    const yFracExpr = buildPiecewiseExpr(samples, 'y', 0.01);
    const alphaExpr = buildPiecewiseExpr(samples, 'opacity', 1);
    const xExpr = `(${xFracExpr})*w-text_w/2`;
    const yExpr = `(${yFracExpr})*h-text_h/2`;

    const escapedFont = ctx.escapePath(ctx.fontFile);
    const mainColor = parseColor(entry.style.color || '#FACC15');
    const strokeWidth = entry.style.stroke?.width ?? 0;
    const strokeColor = strokeWidth > 0 ? parseColor(entry.style.stroke.color || '#000000') : null;

    // Glow uses the TEXT'S OWN colour, matching MotionResolver.resolvedToCSS
    // (`textShadow: 0 0 Npx currentColor`) — it is not a separately
    // configurable colour in the preview, so the export must not invent one.
    const glowAmt = Math.max(0, ...samples.map(s => Number(s.glow) || 0));

    const filters = [];
    const tempFiles = [];

    buildSegments(entry).forEach((seg, segIdx) => {
        if (!seg.text || !(seg.to > seg.from)) return;
        const from = Math.max(seg.from, entry.outputStart);
        const to = Math.min(seg.to, entry.outputEnd);
        if (!(to > from)) return;
        const enable = `between(t,${from.toFixed(4)},${to.toFixed(4)})`;

        const textPath = segmentTextPath(ctx.tmpDir, entry.clipId, segIdx);
        fs.writeFileSync(textPath, seg.text, 'utf8');
        tempFiles.push(textPath);
        const escapedText = ctx.escapePath(textPath);

        // 1. Shadow — drawn first (underneath). Position offset is a FIXED
        //    pixel amount (style packs don't animate shadow offset), applied
        //    on top of the animated x/y so the shadow tracks the caption.
        if (entry.style.shadow) {
            const sh = entry.style.shadow;
            const c = parseColor(sh.color);
            const shadowAlphaExpr = c.alpha < 1 ? `(${alphaExpr})*${c.alpha}` : alphaExpr;
            filters.push(
                `drawtext=fontfile='${escapedFont}':textfile='${escapedText}'` +
                `:fontsize='${scaleExpr}':fontcolor=${c.hex}` +
                `:x='${xExpr}+${sh.x}':y='${yExpr}+${sh.y}'` +
                `:alpha='${shadowAlphaExpr}':enable='${enable}'`
            );
        }

        // 2. Glow — a soft halo APPROXIMATION: two outline-only passes (no
        //    fill) in the text's own colour, wide+faint then narrow+brighter.
        //    This is not a true Gaussian blur (drawtext has none); it reads
        //    as a glow at caption sizes, which is the honest bar to clear —
        //    see the module header's scope note.
        if (glowAmt > 0.5) {
            const glowColor = mainColor.hex;
            filters.push(
                `drawtext=fontfile='${escapedFont}':textfile='${escapedText}'` +
                `:fontsize='${scaleExpr}':fontcolor=${glowColor}@0.0` +
                `:borderw=${Math.round(glowAmt)}:bordercolor=${glowColor}@0.18` +
                `:x='${xExpr}':y='${yExpr}':alpha='${alphaExpr}':enable='${enable}'`
            );
            filters.push(
                `drawtext=fontfile='${escapedFont}':textfile='${escapedText}'` +
                `:fontsize='${scaleExpr}':fontcolor=${glowColor}@0.0` +
                `:borderw=${Math.max(1, Math.round(glowAmt * 0.5))}:bordercolor=${glowColor}@0.32` +
                `:x='${xExpr}':y='${yExpr}':alpha='${alphaExpr}':enable='${enable}'`
            );
        }

        // 3. Main text, with the REAL stroke (borderw is static — style packs
        //    don't animate stroke width — matching how STEP 4 already renders it).
        const strokePart = strokeColor ? `:borderw=${strokeWidth}:bordercolor=${strokeColor.hex}` : '';
        filters.push(
            `drawtext=fontfile='${escapedFont}':textfile='${escapedText}'` +
            `:fontsize='${scaleExpr}':fontcolor=${mainColor.hex}` +
            `:x='${xExpr}':y='${yExpr}'` + strokePart +
            `:alpha='${alphaExpr}':enable='${enable}'`
        );
    });

    return { filters, tempFiles };
}

/**
 * Compile a whole caption program into `-vf` filter strings.
 *
 * @param {object} program           a validated caption program
 * @param {object} opts              { tmpDir, resolveFont(family) => path|null, fallbackFontPath }
 * @returns {{filters: string[], tempFiles: string[], skipped: string[], fontFallbacks: Array}}
 *          `skipped` lists clipIds that fell back to no rendering at all —
 *          only possible when even `fallbackFontPath` itself is unresolvable
 *          (effectively "no usable font exists on this worker at all").
 *          `fontFallbacks` lists clipIds that DID render, but not in the font
 *          the clip actually asked for — `resolveFont(family)` came back
 *          null (the family wasn't found in FONT_SPECS, or its file never
 *          finished downloading) and the fallback font was substituted
 *          instead. This used to be silent: the `|| opts.fallbackFontPath`
 *          below always produces a truthy fontFile once ANY fallback exists,
 *          so `skipped` almost never actually fires in practice — the static
 *          per-clip drawtext loop (jobs/exportProcessor.js STEP 4) tracks
 *          this exact same substitution into `fontFallbackWarnings` and
 *          surfaces it to the user; this path rendered the wrong font
 *          with zero signal that anything had been substituted at all.
 */
function compileCaptionProgram(program, opts) {
    const out = { filters: [], tempFiles: [], skipped: [], fontFallbacks: [] };
    if (!program || !Array.isArray(program.entries) || program.entries.length === 0) return out;

    for (const entry of program.entries) {
        const requestedFamily = entry.style.fontFamily;
        const resolvedFamilyFont = requestedFamily ? opts.resolveFont(requestedFamily) : null;
        const fontFile = resolvedFamilyFont || opts.fallbackFontPath;
        if (!fontFile) { out.skipped.push(entry.clipId); continue; }
        if (requestedFamily && !resolvedFamilyFont) {
            out.fontFallbacks.push({ clipId: entry.clipId, requestedFamily });
        }

        const { filters, tempFiles } = compileCaptionEntry(entry, {
            tmpDir: opts.tmpDir,
            fontFile,
            escapePath: opts.escapePath,
        });
        out.filters.push(...filters);
        out.tempFiles.push(...tempFiles);
    }

    return out;
}

/**
 * Server-side validation — the trust boundary, same reasoning as
 * `validateCompositionPlanShape` in CompositorCompiler.js: a separate
 * implementation from the client's `validateCaptionProgram()` because the
 * client is ESM/Vite and this worker is CommonJS/Node, and because this one
 * is validating input that arrived over HTTP, not authoring-time input from
 * trusted local code.
 *
 * @returns {string[]} problems found; empty means safe to execute
 */
function validateCaptionProgramShape(program) {
    const errors = [];
    if (!program || typeof program !== 'object') return ['program is not an object'];
    if (program.version !== SUPPORTED_PROGRAM_VERSION) {
        return [`unsupported caption program version ${program.version} (this worker executes v${SUPPORTED_PROGRAM_VERSION})`];
    }
    if (!Array.isArray(program.entries)) return ['program.entries is not an array'];

    program.entries.forEach((e, i) => {
        if (!e || typeof e !== 'object') { errors.push(`entries[${i}] is not an object`); return; }
        if (typeof e.text !== 'string') errors.push(`entries[${i}] has no text`);
        if (!(Number(e.outputEnd) > Number(e.outputStart))) errors.push(`entries[${i}] has a non-positive time window`);
        if (!Array.isArray(e.geometry) || e.geometry.length === 0) {
            errors.push(`entries[${i}] has no geometry`);
            return;
        }
        for (const g of e.geometry) {
            if (!['t', 'x', 'y', 'scale', 'opacity'].every(k => Number.isFinite(Number(g[k])))) {
                errors.push(`entries[${i}] has a non-finite geometry sample`);
                break;
            }
        }
    });

    return errors;
}

module.exports = {
    compileCaptionProgram,
    validateCaptionProgramShape,
    SUPPORTED_PROGRAM_VERSION,
    // Exported for the regression suite.
    compileCaptionEntry,
    buildSegments,
    parseColor,
    segmentTextPath,
};
