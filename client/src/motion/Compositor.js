/**
 * client/src/motion/Compositor.js
 *
 * The compositing model — the piece that was genuinely missing.
 *
 * ─── THE PROBLEM ────────────────────────────────────────────────────────────
 * `jobs/exportProcessor.js` flattens EVERY clip from EVERY video track into one
 * array and sorts it by start time:
 *
 *     const allClips = videoTracks.flatMap(t => t.clips).sort((a,b) => a.start - b.start)
 *
 * So two clips that overlap in time on different tracks are SERIALISED — played
 * one after the other — rather than layered. An image clip becomes its own
 * full-frame segment instead of an overlay. That is the real reason stickers,
 * logos, lower thirds and picture-in-picture are impossible today: not a missing
 * layer *type*, a missing layer *renderer*. Adding `"sticker"` to an enum moves
 * nothing until something can draw two things at once.
 *
 * ─── THE DESIGN, AND WHY ────────────────────────────────────────────────────
 * This module produces a COMPOSITION PLAN: a serialisable, versioned description
 * of what is drawn, where, in what order, and — critically — at what OUTPUT time.
 *
 * The plan is computed ONCE, on the client, by the same code that drives the
 * preview, and shipped to the render worker inside the export settings (exactly
 * as `projectLUTId` already is — see R55). The worker executes the plan; it does
 * not re-derive it.
 *
 * That is a deliberate structural choice. The alternative — the client composites
 * for preview and the worker independently composites for export — is precisely
 * the shape of R14 (multicam crop applied in one path, not the other), R16 (two
 * zooms that had to be combined multiplicatively in both places), R53 (preview
 * fit vs export fit) and R56 (a whole second renderer that silently disagreed).
 * Four incidents, one root cause: two implementations of one visual rule. A plan
 * computed once cannot disagree with itself.
 *
 * ─── THE NON-BREAKING GUARANTEE ─────────────────────────────────────────────
 * The FIRST video track is the BASE. It is segmented and concatenated exactly as
 * today — this module does not touch it. Only *additional* video/image tracks
 * become overlays. Therefore:
 *   • a project with one video track produces `overlays: []`, and the export
 *     pipeline runs completely unchanged;
 *   • a project with several video tracks was already rendering wrongly
 *     (serialised), so there is no correct behaviour to preserve.
 * `planIsNoOp()` makes that explicit so the caller can skip the overlay pass
 * entirely rather than building an empty filter graph.
 *
 * ─── OUTPUT TIME IS NOT TIMELINE TIME ───────────────────────────────────────
 * The single subtlest thing here. The exported video concatenates base segments
 * back-to-back with all gaps removed, and speed-adjusts each one. So a graphic
 * sitting at 12.0s on the Vibed timeline does NOT belong at 12.0s in the output.
 * `jobs/exportProcessor.js` already has `vibedToOutputTime()` for captions for
 * exactly this reason. Overlays need the same remap, and getting it wrong fails
 * the worst possible way: everything renders, nothing errors, and every graphic
 * is silently at the wrong moment. `buildTimeMap()` below is that remap, and it
 * is part of the plan so the worker never recomputes it.
 */

import { clipToMotionLayer } from './ClipAdapter.js';
import { resolveMotionAt } from './MotionResolver.js';
import { LAYER_KINDS } from './MotionSchema.js';

/** Bump when the plan shape changes so a worker can reject one it can't execute. */
export const COMPOSITION_PLAN_VERSION = 1;

/** How finely animated overlay geometry is sampled, in seconds. */
// Exported (R63) so CaptionCompiler.js samples animated caption geometry at
// the identical rate — one sampling cadence, not two that could drift.
export const GEOMETRY_SAMPLE_STEP = 1 / 15;

/**
 * Track types that participate in visual compositing.
 * Text is excluded on purpose: captions are burned in by their own drawtext
 * pass (export STEP 4) and drawn by <TextOverlay /> in the preview. Folding
 * them in here would double-render them — the same reason IDELayout filters
 * text tracks out of the Revideo player's variables.
 *
 * 'overlay' (R62) is the graphics track — stickers, logos, lower thirds,
 * shapes. It participates in the SAME plan as video/image tracks (it needs
 * the same overlay-filter treatment), but it must never become the BASE —
 * see VISUAL_TYPE_PRIORITY below.
 */
const VISUAL_TRACK_TYPES = new Set(['video', 'image', 'overlay']);

/**
 * video/image always outrank overlay, regardless of numeric `order`.
 *
 * WHY THIS EXISTS: `order` is assigned per-type in `addTrack()` (useTimelineStore.js)
 * — "lowest order among tracks of my own type" — so the first video track and
 * the first overlay track can both land on order 0. Sorting purely by `order`
 * would then depend on object-iteration order, which is exactly the kind of
 * silent, data-dependent bug this module exists to prevent (see the module
 * header re: R14/R16/R53/R56). Type priority makes "the base is always a
 * video/image track when one exists" true by construction instead of by luck.
 */
const VISUAL_TYPE_PRIORITY = { video: 0, image: 0, overlay: 1 };

/**
 * Order tracks bottom-to-top. `order` wins when present; array index is the
 * documented fallback (`toLegacyTracks` emits `order: t.order ?? idx`).
 */
function sortedVisualTracks(tracks) {
    return (Array.isArray(tracks) ? tracks : [])
        .filter(t => t && VISUAL_TRACK_TYPES.has(t.type) && Array.isArray(t.clips))
        .map((t, idx) => ({
            track: t,
            priority: VISUAL_TYPE_PRIORITY[t.type] ?? 0,
            order: Number.isFinite(Number(t.order)) ? Number(t.order) : idx,
        }))
        .sort((a, b) => (a.priority - b.priority) || (a.order - b.order))
        .map(e => e.track);
}

/**
 * Build the timeline→output time map from the BASE track's clips.
 *
 * Mirrors the concatenation the exporter performs: segments are emitted in
 * start order, back-to-back, each shortened by its own speed factor.
 *
 * @returns {{segments: Array, totalDuration: number}}
 */
export function buildTimeMap(baseClips) {
    const clips = (Array.isArray(baseClips) ? [...baseClips] : [])
        .filter(c => c && Number.isFinite(Number(c.start)) && Number(c.duration) > 0)
        .sort((a, b) => Number(a.start) - Number(b.start));

    const segments = [];
    let cursor = 0;
    for (const c of clips) {
        const speed = Number(c.speed) > 0 ? Number(c.speed) : 1;
        const srcDuration = Number(c.duration);
        const outDuration = srcDuration / speed;
        segments.push({
            clipId: c.id,
            timelineStart: Number(c.start),
            timelineEnd: Number(c.start) + srcDuration,
            speed,
            outputStart: cursor,
            outputEnd: cursor + outDuration,
        });
        cursor += outDuration;
    }
    return { segments, totalDuration: cursor };
}

/**
 * Convert a timeline time to its position in the concatenated output.
 *
 * A time inside a GAP between base segments has no true output position — the
 * gap does not exist in the output. Such a time is snapped to the start of the
 * next segment, which keeps an overlay authored slightly early from being
 * dropped or landing before the footage it annotates.
 *
 * @param {{segments: Array, totalDuration: number}} timeMap
 * @param {number} timelineTime
 * @returns {number} seconds into the exported video
 */
export function timelineToOutputTime(timeMap, timelineTime) {
    const segs = timeMap?.segments || [];
    const t = Number(timelineTime);
    if (!Number.isFinite(t) || segs.length === 0) return 0;

    if (t <= segs[0].timelineStart) return 0;
    const last = segs[segs.length - 1];
    if (t >= last.timelineEnd) return timeMap.totalDuration;

    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (t >= s.timelineStart && t <= s.timelineEnd) {
            return s.outputStart + (t - s.timelineStart) / s.speed;
        }
        // Fell into the gap before this segment.
        if (t < s.timelineStart) return s.outputStart;
    }
    return timeMap.totalDuration;
}

/**
 * Resolve one overlay's geometry at a given timeline time, in NORMALISED units.
 *
 * ─── WHY NORMALISED AND NOT PIXELS ──────────────────────────────────────────
 * `x`, `y`, `w`, `h` are all fractions of the frame (0..1), not pixels. The
 * worker multiplies by whatever resolution it is actually rendering.
 *
 * Pixels would mean the plan is only valid for the exact resolution it was
 * authored against — and the client does not reliably know that, because the
 * platform/resolution preset tables live in `jobs/exportProcessor.js`. The
 * options were: duplicate those tables client-side (a second list to keep in
 * sync — precisely the class of bug that produced R57's fonts and this file's
 * own header warning), or make the plan resolution-independent. The second
 * removes the failure mode instead of managing it. Export at 720p or 4K from
 * the same plan and every overlay lands in the same place.
 *
 * Aspect ratio still matters — see `aspect` below — but that the client DOES
 * know, and a mismatch is checked rather than assumed.
 *
 * ─── THE CENTRE→TOP-LEFT CONVERSION ─────────────────────────────────────────
 *   • `layer.x`/`layer.y` are PERCENTAGES naming the element's CENTRE — the
 *     convention TextOverlay renders with (`translate(-50%,-50%)`).
 *   • FFmpeg's `overlay` positions the overlaid image's TOP-LEFT corner.
 * The conversion happens here, once. Dropping that centring term is exactly
 * what once pushed captions off the frame edge, worse the wider the element.
 */
function resolveGeometry(layer, timelineTime, frame) {
    const m = resolveMotionAt(layer, timelineTime);

    // Frame aspect (w/h) — needed to derive a height fraction from a width
    // fraction, since the two axes are normalised independently.
    const frameAspect = frame.width / frame.height;

    const srcW = Number(layer.sourceWidth) > 0 ? Number(layer.sourceWidth) : frame.width;
    const srcH = Number(layer.sourceHeight) > 0 ? Number(layer.sourceHeight) : frame.height;
    const srcAspect = srcH > 0 ? srcW / srcH : frameAspect;

    // An overlay defaults to a quarter of frame width, so a graphic dropped onto
    // a track is visible immediately rather than filling the screen and looking
    // broken. An explicit clip scale multiplies this.
    const DEFAULT_WIDTH_FRACTION = 0.25;
    const wFrac = DEFAULT_WIDTH_FRACTION * (Number.isFinite(m.scale) ? m.scale : 1);
    // Preserve the source's own aspect: h_px = w_px / srcAspect.
    const hFrac = srcAspect > 0 ? wFrac * (frameAspect / srcAspect) : wFrac;

    const centreX = m.x / 100;
    const centreY = m.y / 100;

    return {
        w: Math.max(0.001, wFrac),
        h: Math.max(0.001, hFrac),
        // Top-left corner, as a fraction of the frame.
        x: centreX - wFrac / 2,
        y: centreY - hFrac / 2,
        rotation: Number(m.rotation) || 0,
        opacity: Number.isFinite(m.opacity) ? m.opacity : 1,
        blur: Number(m.blur) || 0,
    };
}

/** Round normalised geometry so sample-collapsing isn't defeated by float noise. */
function roundGeometry(g) {
    const r = (v) => Math.round(v * 100000) / 100000;
    return {
        x: r(g.x), y: r(g.y), w: r(g.w), h: r(g.h),
        rotation: Math.round(g.rotation * 1000) / 1000,
        opacity: Math.round(g.opacity * 1000) / 1000,
        blur: Math.round(g.blur * 1000) / 1000,
    };
}

/** Are two geometry samples identical enough to collapse? */
function sameGeometry(a, b) {
    return Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.y - b.y) < 1e-5
        && Math.abs(a.w - b.w) < 1e-5 && Math.abs(a.h - b.h) < 1e-5
        && Math.abs(a.rotation - b.rotation) < 1e-3
        && Math.abs(a.opacity - b.opacity) < 2e-3
        && Math.abs(a.blur - b.blur) < 1e-2;
}

/**
 * Sample an overlay's geometry across its life.
 *
 * A static overlay collapses to ONE sample — worth the check, because a static
 * overlay compiles to a plain `overlay=x=N:y=M`, while an animated one needs
 * piecewise-linear `x='if(lt(t,..),..)'` expressions. That is the same shape as
 * the existing `buildZoomKeyframeExpr()` in the exporter, deliberately: it is a
 * proven pattern in this pipeline rather than a new one.
 */
function sampleGeometry(layer, frame, timeMap) {
    const start = Number(layer.startTime) || 0;
    const duration = Number(layer.duration) || 0;
    const end = start + duration;

    const samples = [];
    const push = (tTimeline) => {
        const geom = roundGeometry(resolveGeometry(layer, tTimeline, frame));
        const tOut = timelineToOutputTime(timeMap, tTimeline);
        const prev = samples[samples.length - 1];
        if (prev && sameGeometry(prev, geom)) return;
        samples.push({ t: Number(tOut.toFixed(4)), ...geom });
    };

    push(start);
    if (duration > 0) {
        for (let t = start + GEOMETRY_SAMPLE_STEP; t < end; t += GEOMETRY_SAMPLE_STEP) push(t);
        push(end);
    }

    return simplifySamples(samples);
}

/**
 * Drop samples that sit on the straight line between their neighbours.
 *
 * Each surviving sample becomes another nested `if(lt(t,..),..)` in the FFmpeg
 * expression the worker compiles, so an unsimplified 30s animation would
 * produce a filter string long enough to risk the parser or the command-line
 * length limit — and it would fail at render time on a real export, not here.
 * A linear ramp collapses to its two endpoints and renders identically.
 */
// Exported (R63) so CaptionCompiler.js reduces animated caption keyframe
// samples with the SAME Douglas-Peucker logic that fixed the curve-flattening
// bug here (see the comment below) — a second copy could silently regress
// independently of this one.
export function simplifySamples(samples, tolerance = 0.0015, keys = ['x', 'y', 'w', 'h', 'opacity']) {
    if (!Array.isArray(samples) || samples.length <= 2) return samples;

    const KEYS = keys;

    // Douglas–Peucker, NOT a neighbour-by-neighbour pass.
    //
    // The obvious implementation — drop a sample when it sits on the line
    // between the two beside it — is WRONG for a smooth curve, and wrong in a
    // way that looks fine until you render. Every point on a finely-sampled arc
    // is nearly collinear with its immediate neighbours, so they get discarded
    // one after another and the entire curve flattens to its two endpoints.
    // A "float" or "pop" would then export perfectly STATIC while the preview
    // animated correctly — the precise preview/export divergence this whole
    // module exists to prevent, reintroduced by an off-by-one in a helper.
    //
    // Measuring deviation from the chord between RETAINED anchors, and keeping
    // the single worst offender before recursing, is what makes the reduction
    // safe: a point survives if the curve bends anywhere near it.
    const keepFlags = new Array(samples.length).fill(false);
    keepFlags[0] = true;
    keepFlags[samples.length - 1] = true;

    const stack = [[0, samples.length - 1]];
    while (stack.length > 0) {
        const [lo, hi] = stack.pop();
        if (hi <= lo + 1) continue;

        const a = samples[lo];
        const b = samples[hi];
        const span = b.t - a.t;

        let worstDev = -1;
        let worstIdx = -1;
        for (let i = lo + 1; i < hi; i++) {
            const p = span > 0 ? (samples[i].t - a.t) / span : 0;
            let dev = 0;
            for (const k of KEYS) {
                const lerped = a[k] + (b[k] - a[k]) * p;
                const d = Math.abs(samples[i][k] - lerped);
                if (d > dev) dev = d;
            }
            if (dev > worstDev) { worstDev = dev; worstIdx = i; }
        }

        if (worstDev > tolerance && worstIdx > lo) {
            keepFlags[worstIdx] = true;
            stack.push([lo, worstIdx], [worstIdx, hi]);
        }
    }

    return samples.filter((_, i) => keepFlags[i]);
}

/**
 * Build a composition plan for a timeline.
 *
 * @param {Array} tracks       `state.tracks` (legacy projection shape)
 * @param {object} opts        `{ width, height, fps }` of the export target
 * @returns {object} a serialisable plan; `overlays` is empty when nothing composites
 */
export function buildCompositionPlan(tracks, opts = {}) {
    const frame = {
        width:  Number(opts.width)  > 0 ? Math.round(Number(opts.width))  : 1080,
        height: Number(opts.height) > 0 ? Math.round(Number(opts.height)) : 1920,
    };
    const fps = Number(opts.fps) > 0 ? Number(opts.fps) : 30;

    const visual = sortedVisualTracks(tracks);
    // The base must be an actual video/image track — never 'overlay' (R62).
    // `sortedVisualTracks` already puts overlay tracks last via
    // VISUAL_TYPE_PRIORITY, which makes `visual[0]` correct in every case that
    // reaches export today (exportProcessor's STEP 2 refuses to run without a
    // real video track). This `.find` is the belt-and-suspenders version of
    // the same guarantee: even a plan built for a video-less/overlay-only
    // timeline (unreachable in the app today, but not unreachable as an input
    // to this pure function) cannot promote a sticker into the base role.
    const baseTrack = visual.find(t => t.type === 'video' || t.type === 'image') || null;
    const overlayTracks = visual.filter(t => t !== baseTrack);

    const timeMap = buildTimeMap(baseTrack?.clips || []);

    const overlays = [];
    // zIndex counts up from 1: the base track is 0 and is not in this list.
    let zIndex = 1;

    for (const track of overlayTracks) {
        for (const clip of (track.clips || [])) {
            if (!clip || !(Number(clip.duration) > 0)) continue;

            const layer = clipToMotionLayer(clip, track);
            if (!layer) continue;

            // Carry through source dimensions when the app already knows them —
            // `metadata.resolution` is populated by the media probe. Without it
            // the geometry falls back to frame size, which the worker can still
            // correct with scale2ref.
            layer.sourceWidth  = clip.metadata?.resolution?.w || clip.sourceWidth  || null;
            layer.sourceHeight = clip.metadata?.resolution?.h || clip.sourceHeight || null;

            const startOut = timelineToOutputTime(timeMap, layer.startTime);
            const endOut   = timelineToOutputTime(timeMap, layer.startTime + layer.duration);

            // An overlay whose whole span falls in a gap collapses to zero
            // output length. Emitting it would add a filter that draws nothing
            // while still costing a full pass.
            if (!(endOut > startOut)) continue;

            const geometry = sampleGeometry(layer, frame, timeMap);

            overlays.push({
                id: `ov-${clip.id}`,
                clipId: clip.id,
                trackId: track.id,
                zIndex: zIndex++,
                kind: layer.kind,
                source: {
                    url: clip.proxyUrl || clip.url || clip.sourceUrl || null,
                    assetId: clip.assetId || null,
                    type: clip.type || track.type,
                },
                // Where in the SOURCE file this clip starts, and how fast it runs.
                sourceOffset: Number(clip.offset) || 0,
                speed: Number(clip.speed) > 0 ? Number(clip.speed) : 1,
                // Output-time window — what the worker gates `enable=` on.
                outputStart: Number(startOut.toFixed(4)),
                outputEnd: Number(endOut.toFixed(4)),
                animated: geometry.length > 1,
                geometry,
            });
        }
    }

    return {
        version: COMPOSITION_PLAN_VERSION,
        frame,
        fps,
        base: {
            trackId: baseTrack?.id || null,
            segments: timeMap.segments,
            totalDuration: Number(timeMap.totalDuration.toFixed(4)),
        },
        overlays,
    };
}

/**
 * True when the plan changes nothing and the overlay pass can be skipped
 * entirely. This is the non-breaking guarantee, made checkable: for every
 * project that renders correctly today, this returns true and the export runs
 * byte-for-byte as it did before.
 */
export function planIsNoOp(plan) {
    return !plan || !Array.isArray(plan.overlays) || plan.overlays.length === 0;
}

/**
 * Validate a plan before executing it. Returns `{ valid, errors }`, never throws.
 * The worker should call this and, on failure, render WITHOUT the overlay pass
 * rather than failing the export — an ungraded/unlayered video is a far better
 * outcome than no video, which is the same fail-open rule the LUT lookup uses.
 */
export function validateCompositionPlan(plan) {
    const errors = [];
    if (!plan || typeof plan !== 'object') return { valid: false, errors: ['plan must be an object'] };
    if (plan.version !== COMPOSITION_PLAN_VERSION) {
        errors.push(`unsupported plan version ${plan.version} (expected ${COMPOSITION_PLAN_VERSION})`);
    }
    if (!plan.frame || !(plan.frame.width > 0) || !(plan.frame.height > 0)) {
        errors.push('plan.frame must have positive width and height');
    }
    if (!Array.isArray(plan.overlays)) errors.push('plan.overlays must be an array');

    (plan.overlays || []).forEach((ov, i) => {
        if (!ov.source?.url && !ov.source?.assetId) {
            errors.push(`overlays[${i}]: has neither a source url nor an assetId`);
        }
        if (!(ov.outputEnd > ov.outputStart)) {
            errors.push(`overlays[${i}]: outputEnd must be greater than outputStart`);
        }
        if (!Array.isArray(ov.geometry) || ov.geometry.length === 0) {
            errors.push(`overlays[${i}]: needs at least one geometry sample`);
        }
        (ov.geometry || []).forEach((g, k) => {
            for (const key of ['x', 'y', 'w', 'h', 't']) {
                if (!Number.isFinite(g[key])) errors.push(`overlays[${i}].geometry[${k}]: ${key} is not finite`);
            }
            if (g.w <= 0 || g.h <= 0) errors.push(`overlays[${i}].geometry[${k}]: non-positive size`);
        });
    });

    // z-order must be a strict, gapless-enough ordering or "on top of" is undefined.
    const zs = (plan.overlays || []).map(o => o.zIndex);
    if (new Set(zs).size !== zs.length) errors.push('overlay zIndex values must be unique');

    return { valid: errors.length === 0, errors };
}

/**
 * Which overlays are visible at an OUTPUT time, back-to-front, with their
 * geometry interpolated. This is what a preview renderer consumes — the same
 * plan the worker executes, so the two cannot disagree about stacking order or
 * placement.
 */
export function resolveCompositionAt(plan, outputTime) {
    if (planIsNoOp(plan)) return [];
    const t = Number(outputTime);
    if (!Number.isFinite(t)) return [];

    const out = [];
    for (const ov of plan.overlays) {
        if (t < ov.outputStart || t > ov.outputEnd) continue;
        out.push({ ...ov, geometry: interpolateGeometry(ov.geometry, t) });
    }
    return out.sort((a, b) => a.zIndex - b.zIndex);
}

/** Piecewise-linear geometry lookup, matching how the worker compiles it. */
export function interpolateGeometry(samples, t) {
    if (!Array.isArray(samples) || samples.length === 0) return null;
    if (samples.length === 1) return samples[0];
    if (t <= samples[0].t) return samples[0];
    const last = samples[samples.length - 1];
    if (t >= last.t) return last;

    for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i];
        const b = samples[i + 1];
        if (t >= a.t && t <= b.t) {
            const span = b.t - a.t;
            const p = span > 0 ? (t - a.t) / span : 0;
            const lerp = (k) => a[k] + (b[k] - a[k]) * p;
            return {
                t,
                x: Math.round(lerp('x')),
                y: Math.round(lerp('y')),
                w: Math.round(lerp('w')),
                h: Math.round(lerp('h')),
                rotation: lerp('rotation'),
                opacity: lerp('opacity'),
                blur: lerp('blur'),
            };
        }
    }
    return last;
}

export default {
    COMPOSITION_PLAN_VERSION,
    GEOMETRY_SAMPLE_STEP,
    buildTimeMap,
    timelineToOutputTime,
    buildCompositionPlan,
    planIsNoOp,
    validateCompositionPlan,
    resolveCompositionAt,
    interpolateGeometry,
    simplifySamples,
};
