/**
 * client/src/motion/CaptionCompiler.js
 *
 * R63 — closes the gap identified while auditing the caption engine: word
 * timing, motion presets, textShadow, uppercase and glow are all fully built
 * and correctly wired into the live PREVIEW (TextOverlay.jsx via
 * resolveMotionAt), but the EXPORT still burns one static `drawtext` per
 * caption clip for its whole duration, reading only fontFamily/fontSize/
 * color/stroke — see `jobs/exportProcessor.js` STEP 4. Every animated,
 * shadowed, glowing, uppercased, or word-revealed caption exported flat,
 * silently, with no error — the exact preview/export divergence this whole
 * motion engine exists to prevent (R14/R16/R53/R56, cited throughout this
 * directory).
 *
 * ─── THE SAME ARCHITECTURE AS THE COMPOSITOR (R59-62), ON PURPOSE ──────────
 * This module computes a CAPTION PROGRAM once, on the client, using the exact
 * same `resolveMotionAt()` that drives the preview — not a second animation
 * implementation. The program is a serialisable list of sampled keyframes per
 * clip, shipped in export settings alongside `compositionPlan`. A server-side
 * compiler (`server/compositor/CaptionCompiler.js`) turns it into `drawtext`
 * filters. The client decides WHAT the caption does at every instant; the
 * server only decides HOW to spell that in FFmpeg syntax. Two implementations
 * of "what does this caption look like at time t" is exactly the mistake this
 * codebase keeps re-committing — see the Compositor.js header for the full
 * citation list (R14, R16, R53, R56).
 *
 * ─── THE NON-BREAKING GUARANTEE ─────────────────────────────────────────────
 * A caption clip with no animation, no textShadow, no uppercase transform,
 * and no word-reveal produces NO program entry. `exportProcessor.js` STEP 4
 * keeps rendering it exactly as it does today — same static drawtext, same
 * output. `planIsNoOp()` mirrors the compositor's guarantee: a project using
 * only plain captions (which is every project today, since none of this was
 * reachable before R58-62) is untouched.
 *
 * ─── SCOPE, STATED PLAINLY ──────────────────────────────────────────────────
 * Ships: animated x/y/scale/opacity, textShadow (first shadow layer only —
 * see `parseTextShadow`), glow (approximated as a soft multi-pass stroke
 * halo, not a true Gaussian blur — see the server compiler), uppercase, and
 * word-by-word reveal (typewriter / real word timings).
 * Per-word HIGHLIGHT colour, keyword EMPHASIS and ROTATION (R88) are not
 * drawtext features. Entries that need them carry a `raster` block and are
 * drawn as pre-rendered images by server/compositor/RasterCaptionCompiler.js
 * (node-canvas measures the real font, so per-word positions are exact).
 */

import { clipToMotionLayer } from './ClipAdapter.js';
import { resolveMotionAt } from './MotionResolver.js';
import { revealedWordCount, activeWordIndex, resolveEmphasis } from './CaptionModel.js';
import { buildTimeMap, timelineToOutputTime, simplifySamples, GEOMETRY_SAMPLE_STEP } from './Compositor.js';

export const CAPTION_PROGRAM_VERSION = 1;

/**
 * Parse a CSS-style `text-shadow` value into ONE renderable shadow.
 *
 * Style packs sometimes stack multiple shadows (e.g. four offset copies to
 * fake a hard stroke — `bold-impact`/`hormozi`). Those packs also set a real
 * `clip.stroke`, which STEP 4 already renders via `borderw`/`bordercolor`, so
 * the multi-shadow trick is redundant with something that already works.
 * This takes the shadow with the LARGEST blur radius — the soft drop-shadow/
 * glow entries (e.g. `'0 2px 8px rgba(0,0,0,0.55)'`) are what's actually
 * being lost today, not the stroke fakery.
 *
 * @param {string} value e.g. '0 2px 8px rgba(0,0,0,0.55)' or a comma list
 * @returns {{x:number, y:number, blur:number, color:string}|null}
 */
export function parseTextShadow(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim() === 'none') return null;

    const entries = value.split(/,(?![^(]*\))/g); // split on commas NOT inside rgba(...)
    let best = null;

    for (const raw of entries) {
        const s = raw.trim();
        // Pull the colour token (hex or rgb/rgba(...)) out first, then the
        // remaining space-separated tokens are the length values in order.
        const colorMatch = s.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/);
        const color = colorMatch ? colorMatch[0] : '#000000';
        const lengths = s.replace(colorMatch ? colorMatch[0] : '', '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(v => parseFloat(v))
            .filter(v => Number.isFinite(v));

        const [x = 0, y = 0, blur = 0] = lengths;
        const entry = { x, y, blur, color };
        if (!best || entry.blur > best.blur) best = entry;
    }

    return best;
}

/** Does this clip need anything the CURRENT static drawtext path can't render? */
function needsCaptionProgram(clip, layer) {
    if (!clip) return false;
    if (Array.isArray(layer?.animations) && layer.animations.length > 0) return true;
    if (parseTextShadow(clip.textShadow)) return true;
    if (clip.captionStyle?.uppercase) return true;
    if (Math.abs(Number(clip.rotation) || 0) > 0.05) return true;
    if (activeHighlight(clip)) return true;
    if (resolveEmphasis(clip)) return true;
    return false;
}

/**
 * The style pack's active-word highlight, when the preview would actually
 * draw it: TextOverlay only renders per word when real word timings exist and
 * the mode is not 'none' (`needsWordRender`). Same gate here, nothing broader.
 */
function activeHighlight(clip) {
    const h = clip?.captionStyle?.wordHighlight;
    if (!h || !h.mode || h.mode === 'none') return null;
    if (!Array.isArray(clip.words) || clip.words.length === 0) return null;
    return h;
}

/**
 * Per-word display states over a clip's lifetime, in OUTPUT time, computed
 * with the SAME functions CaptionWords (TextOverlay.jsx) calls for the preview:
 * `revealedWordCount` for how many words are visible and `activeWordIndex`
 * for the highlighted one. Sampled at every word boundary plus the geometry
 * cadence (for reveal animations without word timings), then collapsed into
 * runs. Each run becomes one pre-rendered image on the server.
 *
 * @returns {Array<{from:number,to:number,shown:number,active:number}>}
 */
function buildWordStates(clip, layer, timeMap, tokenCount, highlight) {
    const start = Number(layer.startTime) || 0;
    const end = start + (Number(layer.duration) || 0);
    const words = Array.isArray(clip.words) && clip.words.length > 0 ? clip.words : null;

    const times = new Set([start]);
    for (let t = start + GEOMETRY_SAMPLE_STEP; t < end; t += GEOMETRY_SAMPLE_STEP) times.add(Number(t.toFixed(4)));
    if (words) {
        for (const w of words) {
            for (const edge of [w?.start, w?.end]) {
                if (!Number.isFinite(edge)) continue;
                // A word boundary is sampled exactly and just after (activeWordIndex
                // uses an inclusive end, so `end` itself still shows that word).
                for (const tt of [edge, edge + 0.0005]) if (tt >= start && tt < end) times.add(Number(tt.toFixed(4)));
            }
        }
    }

    const sorted = [...times].sort((a, b) => a - b);
    const runs = [];
    for (const t of sorted) {
        const m = resolveMotionAt(layer, t);
        // Same rule as CaptionWords: emphasis alone shows the whole caption.
        const revealing = m.reveal < 1 || (!!highlight && !!words);
        const shown = revealing ? revealedWordCount(words, t, m.reveal, tokenCount) : tokenCount;
        const active = highlight && words ? activeWordIndex(words, t) : -1;
        const prev = runs[runs.length - 1];
        if (prev && prev.shown === shown && prev.active === active) continue;
        runs.push({ fromTimeline: t, shown, active });
    }

    const out = [];
    for (let i = 0; i < runs.length; i++) {
        const from = timelineToOutputTime(timeMap, runs[i].fromTimeline);
        const to = i + 1 < runs.length ? timelineToOutputTime(timeMap, runs[i + 1].fromTimeline) : timelineToOutputTime(timeMap, end);
        if (!(to > from)) continue;
        out.push({ from: Number(from.toFixed(4)), to: Number(to.toFixed(4)), shown: runs[i].shown, active: runs[i].active });
    }
    return out;
}

/**
 * Sample a numeric channel of `resolveMotionAt()` across a clip's lifetime,
 * converting each sample's time into OUTPUT time and simplifying with the
 * SAME Douglas-Peucker reduction the compositor uses for overlay geometry
 * (`Compositor.simplifySamples`) — not a second, potentially-diverging copy.
 */
function sampleChannel(layer, timeMap, keys) {
    const start = Number(layer.startTime) || 0;
    const duration = Number(layer.duration) || 0;
    const end = start + duration;

    const samples = [];
    const push = (tTimeline) => {
        const m = resolveMotionAt(layer, tTimeline);
        const tOut = timelineToOutputTime(timeMap, tTimeline);
        const point = { t: Number(tOut.toFixed(4)) };
        for (const k of keys) point[k] = Number.isFinite(m[k]) ? m[k] : 0;
        const prev = samples[samples.length - 1];
        if (prev && keys.every(k => Math.abs(prev[k] - point[k]) < 1e-4)) return;
        samples.push(point);
    };

    push(start);
    if (duration > 0) {
        for (let t = start + GEOMETRY_SAMPLE_STEP; t < end; t += GEOMETRY_SAMPLE_STEP) push(t);
        push(end);
    }

    return simplifySamples(samples, 0.0015, keys);
}

/**
 * Build the word-reveal "prefix step" list for one clip: at what OUTPUT time
 * does the visible prefix grow to N words, and until when does it hold there.
 *
 * Prefers real word timings (`clip.words`) — deterministic, no sampling
 * needed, since `revealedWordCount()` only grows with time. Falls back to
 * sampling the `reveal` animation channel (typewriter-style presets with no
 * real word data) at the same cadence as the geometry channels.
 *
 * @returns {Array<{prefixCount:number, fromOutput:number, toOutput:number}>}
 */
function buildRevealSteps(clip, layer, timeMap, tokens) {
    const start = Number(layer.startTime) || 0;
    const duration = Number(layer.duration) || 0;
    const end = start + duration;
    const clipOutEnd = timelineToOutputTime(timeMap, end);

    const boundaries = []; // [{ prefixCount, fromTimeline }]

    if (Array.isArray(clip.words) && clip.words.length > 0) {
        let n = 0;
        boundaries.push({ prefixCount: 0, fromTimeline: start });
        for (const w of clip.words) {
            n++;
            if (Number.isFinite(w?.start)) boundaries.push({ prefixCount: n, fromTimeline: Math.max(start, w.start) });
        }
    } else {
        // No real word data — sample the `reveal` channel and record every
        // point where the derived prefix count increases.
        const samples = sampleChannel(layer, timeMap, ['reveal']);
        let lastCount = -1;
        for (const s of samples) {
            const count = revealedWordCount(null, undefined, s.reveal, tokens.length);
            if (count !== lastCount) {
                boundaries.push({ prefixCount: count, fromTimeline: null, fromOutput: s.t });
                lastCount = count;
            }
        }
        if (boundaries.length === 0 || boundaries[0].prefixCount !== 0) {
            boundaries.unshift({ prefixCount: 0, fromTimeline: null, fromOutput: 0 });
        }
    }

    // Convert to output time and pair each boundary with the next one's start.
    const withOutput = boundaries.map(b => ({
        prefixCount: b.prefixCount,
        fromOutput: Number.isFinite(b.fromOutput) ? b.fromOutput : timelineToOutputTime(timeMap, b.fromTimeline),
    }));

    const steps = [];
    for (let i = 0; i < withOutput.length; i++) {
        const from = withOutput[i].fromOutput;
        const to = i + 1 < withOutput.length ? withOutput[i + 1].fromOutput : clipOutEnd;
        if (!(to > from)) continue;
        steps.push({ prefixCount: withOutput[i].prefixCount, fromOutput: from, toOutput: to });
    }
    return steps;
}

/**
 * Build the caption program for a timeline.
 *
 * @param {Array} tracks   `state.tracks` (legacy projection shape)
 * @param {Array} baseClips the BASE video track's clips — same track
 *                          `buildCompositionPlan` treats as base, needed here
 *                          to build the identical timeline→output time map.
 *                          Pass `plan.base` info, or recompute with the same
 *                          `sortedVisualTracks` logic the caller already ran.
 * @returns {object} a serialisable program; `entries` is empty when nothing
 *                    needs anything beyond the existing static drawtext path.
 */
export function buildCaptionProgram(tracks, baseClips) {
    const timeMap = buildTimeMap(baseClips || []);
    const textTracks = (Array.isArray(tracks) ? tracks : []).filter(t => t && t.type === 'text' && Array.isArray(t.clips));

    const entries = [];

    for (const track of textTracks) {
        for (const clip of track.clips) {
            if (!clip || !(Number(clip.duration) > 0)) continue;

            const layer = clipToMotionLayer(clip, track);
            if (!layer || !needsCaptionProgram(clip, layer)) continue;

            const outputStart = timelineToOutputTime(timeMap, layer.startTime);
            const outputEnd = timelineToOutputTime(timeMap, layer.startTime + layer.duration);
            if (!(outputEnd > outputStart)) continue; // whole span fell in a gap

            const rawText = clip.content || clip.name || '';
            const text = clip.captionStyle?.uppercase ? rawText.toUpperCase() : rawText;
            const tokens = text.split(' ').filter(Boolean);

            const geometry = sampleChannel(layer, timeMap, ['x', 'y', 'scale', 'opacity', 'glow', 'rotation']);

            // Gate on a genuine reveal-type ANIMATION (e.g. the `word-reveal`
            // preset), not merely on `clip.words` being present. TextOverlay
            // only switches to per-word rendering when `motion.reveal < 1` or
            // word-highlight colouring is active (`needsWordRender` in
            // TextOverlay.jsx) — a caption with real word timings but neither
            // renders as a single flat string in the live preview today. This
            // module ships what the preview actually shows; inventing a
            // broader trigger here would make export MORE animated than
            // preview, which is the same class of divergence as the reverse.
            const needsReveal = Array.isArray(layer.animations) && layer.animations.some(a =>
                Array.isArray(a.keyframes) && a.keyframes.some(k => k.properties && 'reveal' in k.properties));

            const revealSteps = needsReveal ? buildRevealSteps(clip, layer, timeMap, tokens) : null;

            // ── Raster entries (A2/A3) ─────────────────────────────────────
            // Rotation, the active-word highlight and keyword emphasis all need
            // per-word positions or a rotated glyph run — things drawtext cannot
            // do. Those clips are flagged `raster` and drawn server-side as
            // pre-rendered images (server/compositor/RasterCaptionCompiler.js).
            // Everything else in the entry is unchanged, so an older worker, or
            // the raster pass failing, still renders the text through the R63
            // drawtext path: the caption appears, only without those effects.
            const highlight = activeHighlight(clip);
            const emphasis = resolveEmphasis(clip, tokens.length);
            const rotated = geometry.some(g => Math.abs(Number(g.rotation) || 0) > 0.05);
            const wordRender = !!highlight || !!emphasis || needsReveal;
            const raster = rotated || !!highlight || !!emphasis;

            entries.push({
                clipId: clip.id,
                trackId: track.id,
                text,
                tokens,
                outputStart: Number(outputStart.toFixed(4)),
                outputEnd: Number(outputEnd.toFixed(4)),
                style: {
                    fontFamily: clip.fontFamily,
                    fontSize: Number(clip.fontSize) || 48,
                    color: clip.color || '#FACC15',
                    stroke: clip.stroke || null,
                    shadow: parseTextShadow(clip.textShadow),
                },
                geometry,       // [{t, x, y, scale, opacity, glow, rotation}] in OUTPUT time
                revealSteps,    // [{prefixCount, fromOutput, toOutput}] | null — null means render `text` whole
                ...(raster ? {
                    raster: {
                        // The preview box: 80% of the frame wide, pre-wrap,
                        // centred on (x, y) — TextOverlay.jsx's caption <div>.
                        layout: {
                            widthFrac: 0.8,
                            align: clip.textAlign || 'center',
                            lineHeight: 1.2,
                            // Per-word spans use a 0.25em right margin instead
                            // of a space (CaptionWords); plain text uses spaces.
                            wordGap: wordRender ? 'margin' : 'space',
                        },
                        font: {
                            weight: clip.fontWeight || 'normal',
                            style: clip.fontStyle || 'normal',
                        },
                        // Every layer of the CSS shadow (style packs stack
                        // several); the drawtext path keeps only one.
                        textShadow: typeof clip.textShadow === 'string' ? clip.textShadow : null,
                        highlight: highlight || null,
                        emphasis: emphasis || null,
                        wordStates: wordRender ? buildWordStates(clip, layer, timeMap, tokens.length, highlight) : null,
                    },
                } : {}),
            });
        }
    }

    return { version: CAPTION_PROGRAM_VERSION, entries };
}

/** True when the program changes nothing — the existing static drawtext path handles everything. */
export function captionProgramIsNoOp(program) {
    return !program || !Array.isArray(program.entries) || program.entries.length === 0;
}

/**
 * Validate a program before shipping it. Mirrors `validateCompositionPlan` —
 * never throws, so the caller can fail open (render with plain static
 * captions rather than fail the export) exactly like the compositor and the
 * LUT lookup (R55) already do.
 */
export function validateCaptionProgram(program) {
    const errors = [];
    if (!program || typeof program !== 'object') return { valid: false, errors: ['program must be an object'] };
    if (program.version !== CAPTION_PROGRAM_VERSION) {
        errors.push(`unsupported caption program version ${program.version} (expected ${CAPTION_PROGRAM_VERSION})`);
    }
    if (!Array.isArray(program.entries)) errors.push('program.entries must be an array');

    (program.entries || []).forEach((e, i) => {
        if (typeof e.text !== 'string') errors.push(`entries[${i}]: text must be a string`);
        if (!(e.outputEnd > e.outputStart)) errors.push(`entries[${i}]: outputEnd must be greater than outputStart`);
        if (!Array.isArray(e.geometry) || e.geometry.length === 0) errors.push(`entries[${i}]: needs at least one geometry sample`);
        (e.geometry || []).forEach((g, k) => {
            for (const key of ['t', 'x', 'y', 'scale', 'opacity']) {
                if (!Number.isFinite(g[key])) errors.push(`entries[${i}].geometry[${k}]: ${key} is not finite`);
            }
        });
    });

    return { valid: errors.length === 0, errors };
}

export default {
    CAPTION_PROGRAM_VERSION,
    parseTextShadow,
    buildCaptionProgram,
    captionProgramIsNoOp,
    validateCaptionProgram,
};
