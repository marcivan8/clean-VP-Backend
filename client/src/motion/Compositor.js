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
import { getEffectKeyframeTrack, resolveEffectParameter } from './EffectTiming.js';
import { resolveTimelineEffectGraphPreview } from './TimelineVisualEffects.js';
import { LAYER_KINDS } from './MotionSchema.js';
import { remapSceneObjectTime } from './TimeRemap.js';
import { MAX_MOTION_BLUR_SAMPLES } from './MotionLimits.js';

// Same test as LayoutPresets.hasLayoutFrame (R88). Inlined rather than
// imported: the regression suites load this file by concatenating a fixed list
// of motion modules, and scripts/test_layout_presets.mjs checks the two stay
// identical.
const LAYOUT_FRAME_PRESETS = ['split', 'fullscreen', 'pip'];
function hasLayoutFrame(clip) {
    const f = clip?.frame;
    return !!(f && LAYOUT_FRAME_PRESETS.includes(f.preset)
        && [f.x, f.y, f.w, f.h].every(Number.isFinite) && f.w > 0 && f.h > 0);
}

/** Bump when the plan shape changes so a worker can reject one it can't execute. */
export const COMPOSITION_PLAN_VERSION = 8;
const hasNumericValue = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

/** How finely animated overlay geometry is sampled, in seconds. */
// Exported (R63) so CaptionCompiler.js samples animated caption geometry at
// the identical rate — one sampling cadence, not two that could drift.
export const GEOMETRY_SAMPLE_STEP = 1 / 15;

/** Keep procedural samples at least twice as dense as the output frame clock. */
export function sampleStepForFps(fps) {
    const outputFps = Math.max(1, Math.min(120, Number(fps) || 30));
    return Math.min(GEOMETRY_SAMPLE_STEP, 1 / (outputFps * 2));
}

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
 * Resolve the visual track roles shared by the editor preview and export.
 * The first video/image track is the base; every higher visual track is a
 * composited layer. Keeping this decision shared prevents a second video track
 * from appearing as a cut in one renderer and a picture-in-picture layer in
 * the other.
 */
export function getVisualTrackRoles(tracks) {
    const visual = sortedVisualTracks(tracks);
    const baseTrack = visual.find(track => track.type === 'video' || track.type === 'image') || null;
    return {
        baseTrack,
        overlayTracks: visual.filter(track => track !== baseTrack),
    };
}

/**
 * Build the timeline→output time map from the BASE track's clips.
 *
 * Mirrors the concatenation the exporter performs: segments are emitted in
 * start order, back-to-back, gaps removed. A clip's `duration` is already its
 * TIMELINE length (speed is applied to the source it reads, see
 * timeline/speedChange.js), so a clip lasts exactly `duration` in the output
 * too. This used to divide by speed a second time.
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
        const outDuration = Number(c.duration);
        segments.push({
            clipId: c.id,
            timelineStart: Number(c.start),
            timelineEnd: Number(c.start) + outDuration,
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
            return s.outputStart + (t - s.timelineStart);
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
function resolveGeometry(layer, timelineTime, frame, audioWaveformsByAsset) {
    const m = resolveMotionAt(layer, timelineTime, { audioWaveformsByAsset });

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
    const scaleX = (Number.isFinite(m.scale) ? m.scale : 1)
        * (Number.isFinite(m.scaleX) ? m.scaleX : 1);
    const scaleY = (Number.isFinite(m.scale) ? m.scale : 1)
        * (Number.isFinite(m.scaleY) ? m.scaleY : 1);
    const wFrac = DEFAULT_WIDTH_FRACTION * Math.abs(scaleX);
    // Preserve the source's own aspect: h_px = w_px / srcAspect.
    const hFrac = (srcAspect > 0 ? DEFAULT_WIDTH_FRACTION * (frameAspect / srcAspect) : DEFAULT_WIDTH_FRACTION)
        * Math.abs(scaleY);

    const centreX = m.x / 100;
    const centreY = m.y / 100;

    return {
        w: Math.max(0.001, wFrac),
        h: Math.max(0.001, hFrac),
        // Top-left corner, as a fraction of the frame.
        x: centreX - wFrac / 2,
        y: centreY - hFrac / 2,
        rotation: Number(m.rotation) || 0,
        opacity: Math.abs(scaleX) < 1e-8 || Math.abs(scaleY) < 1e-8
            ? 0 : (Number.isFinite(m.opacity) ? m.opacity : 1),
        blur: Number(m.blur) || 0,
        reveal: Number.isFinite(m.reveal) ? Math.max(0, Math.min(1, m.reveal)) : 1,
        flipH: scaleX < 0 ? 1 : 0,
        flipV: scaleY < 0 ? 1 : 0,
    };
}

/**
 * R98 — validate/clamp a clip's shadow descriptor before it goes in the plan.
 * dx/dy/blur are CSS-pixel-ish constants (same convention as CaptionModel's
 * fixed-px textShadow presets, not frame-fraction-scaled): the preview
 * applies them as literal CSS px, and CompositorCompiler's
 * compileShadowSource scales them by the render resolution so a shadow
 * reads the same size at 720p and at 4K.
 */
function normalizeShadow(shadow) {
    const dx = Number(shadow?.dx);
    const dy = Number(shadow?.dy);
    const blur = Number(shadow?.blur);
    const opacity = Number(shadow?.opacity);
    return {
        dx: Number.isFinite(dx) ? dx : 4,
        dy: Number.isFinite(dy) ? dy : 6,
        blur: Number.isFinite(blur) ? Math.max(0, blur) : 10,
        opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.55,
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
        reveal: Math.round(g.reveal * 1000) / 1000,
        flipH: g.flipH ? 1 : 0,
        flipV: g.flipV ? 1 : 0,
    };
}

/** Are two geometry samples identical enough to collapse? */
function sameGeometry(a, b) {
    return Math.abs(a.x - b.x) < 1e-5 && Math.abs(a.y - b.y) < 1e-5
        && Math.abs(a.w - b.w) < 1e-5 && Math.abs(a.h - b.h) < 1e-5
        && Math.abs(a.rotation - b.rotation) < 1e-3
        && Math.abs(a.opacity - b.opacity) < 2e-3
        && Math.abs(a.blur - b.blur) < 1e-2
        && Math.abs(a.reveal - b.reveal) < 1e-3
        && a.flipH === b.flipH && a.flipV === b.flipV;
}

/**
 * Sample an overlay's geometry across its life.
 *
 * A static overlay collapses to ONE sample — worth the check, because a static
 * overlay compiles to a plain `overlay=x=N:y=M`, while an animated one needs
 * piecewise-linear `x='if(lt(t,..),..)'` expressions. That is the same shape as
 * the exporter's scale-keyframe zoom (buildSmoothZoomFilter), deliberately: it is a
 * proven pattern in this pipeline rather than a new one.
 */
function sampleGeometry(layer, frame, timeMap, fps = 30, audioWaveformsByAsset) {
    const start = Number(layer.startTime) || 0;
    const duration = Number(layer.duration) || 0;
    const end = start + duration;

    const samples = [];
    const push = (tTimeline) => {
        const geom = roundGeometry(resolveGeometry(layer, tTimeline, frame, audioWaveformsByAsset));
        const tOut = timelineToOutputTime(timeMap, tTimeline);
        const prev = samples[samples.length - 1];
        if (prev && sameGeometry(prev, geom)) return;
        samples.push({ t: Number(tOut.toFixed(4)), ...geom });
    };

    const sampleStep = sampleStepForFps(fps);
    push(start);
    if (duration > 0) {
        for (let t = start + sampleStep; t < end; t += sampleStep) push(t);
        push(end);
    }

    return simplifySamples(samples);
}

function sampleCompositionOpacity(group, timeMap, fps = 30) {
    const animations = Array.isArray(group?.opacityAnimations) ? group.opacityAnimations : [];
    const expression = typeof group?.opacityExpression === 'string' ? group.opacityExpression : null;
    if (!animations.length && !expression) return null;
    const start = Number(group.start) || 0;
    const duration = Math.max(0, Number(group.duration) || 0);
    const layer = { startTime: start, duration, opacity: 1, animations, expressions: expression ? { opacity: expression } : {} };
    const timelineSamples = new Set();
    const sampleStep = sampleStepForFps(fps);
    const segments = timeMap?.segments || [];
    for (const segment of segments) {
        const from = Number(segment.timelineStart) || 0;
        const to = Number(segment.timelineEnd) || from;
        for (let t = from; t < to; t += sampleStep) timelineSamples.add(Number(t.toFixed(6)));
        timelineSamples.add(to);
        for (const animation of animations) {
            const animStart = animation.anchor === 'out'
                ? Math.max(0, duration - (Number(animation.duration) || 0) - (Number(animation.startTime) || 0))
                : Number(animation.startTime) || 0;
            for (const keyframe of animation.keyframes || []) {
                const t = start + animStart + (Number(keyframe?.time) || 0);
                if (t >= from && t <= to) timelineSamples.add(Number(t.toFixed(6)));
            }
        }
    }
    const samples = [...timelineSamples].sort((a, b) => a - b).map(t => ({
        t: Number(timelineToOutputTime(timeMap, t).toFixed(4)),
        value: Number(resolveMotionAt(layer, t).opacity.toFixed(5)),
    })).filter((sample, index, all) => index === 0 || sample.t > all[index - 1].t);
    return samples.length ? samples : [{ t: 0, value: 1 }];
}

function reduceEffectSampleRows(rows, keys, protectedTimes, max = 60) {
    if (!Array.isArray(rows) || rows.length <= max) return rows;
    const retained = new Set([0, rows.length - 1]);
    for (const time of protectedTimes) {
        const index = rows.findIndex(row => Math.abs(row.localTime - time) < 1e-6);
        if (index >= 0) retained.add(index);
    }
    // Do not discard authored keyframes just to satisfy the expression cap.
    // The worker validator will refuse this over-budget track explicitly.
    if (retained.size > max) return [...retained].sort((a, b) => a - b).map(index => rows[index]);
    const ranges = Object.fromEntries(keys.map(key => {
        const vectors = rows.map(row => row.values[key]).filter(Array.isArray);
        const length = vectors.length ? Math.max(...vectors.map(value => value.length)) : 1;
        return [key, Array.from({ length }, (_, channel) => {
            const values = rows.map(row => Array.isArray(row.values[key]) ? row.values[key][channel] : row.values[key]).filter(Number.isFinite);
            let low = Infinity, high = -Infinity;
            for (const value of values) { low = Math.min(low, value); high = Math.max(high, value); }
            return Math.max(1e-9, high - low);
        })];
    }));
    const tolerance = 0.0015;
    while (retained.size < max) {
        const anchors = [...retained].sort((a, b) => a - b);
        let worst = tolerance;
        let worstIndex = -1;
        for (let span = 0; span < anchors.length - 1; span++) {
            const lo = anchors[span], hi = anchors[span + 1];
            const a = rows[lo], b = rows[hi];
            const dt = b.localTime - a.localTime;
            for (let index = lo + 1; index < hi; index++) {
                const point = rows[index];
                const progress = dt > 0 ? (point.localTime - a.localTime) / dt : 0;
                let deviation = 0;
                for (const key of keys) {
                    const actuals = Array.isArray(point.values[key]) ? point.values[key] : [point.values[key]];
                    const froms = Array.isArray(a.values[key]) ? a.values[key] : [a.values[key]];
                    const tos = Array.isArray(b.values[key]) ? b.values[key] : [b.values[key]];
                    for (let channel = 0; channel < Math.max(actuals.length, froms.length, tos.length); channel++) {
                        const actual = actuals[channel], from = froms[channel], to = tos[channel];
                        if (![actual, from, to].every(Number.isFinite)) continue;
                        deviation = Math.max(deviation, Math.abs(actual - (from + (to - from) * progress)) / ranges[key][channel]);
                    }
                }
                if (deviation > worst) { worst = deviation; worstIndex = index; }
            }
        }
        if (worstIndex < 0) break;
        retained.add(worstIndex);
    }
    return [...retained].sort((a, b) => a - b).map(index => rows[index]);
}

/** Sample keyed effect parameters onto the same output-time clock as geometry. */
function sampleEffectTracks(effects, layer, timeMap, { clipLocalOutputTime = false, fps = 30 } = {}) {
    return (Array.isArray(effects) ? effects : []).map((effect, effectIndex) => {
        // Empty inputs are the editor's representation of an unset boundary.
        // Number('') is 0, so coercing before checking emptiness accidentally
        // turned a full-clip effect into a zero-length window during export.
        const hasBoundary = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
        const hasStart = hasBoundary(effect?.startTime);
        const hasEnd = hasBoundary(effect?.endTime);
        const outputWindows = (hasStart || hasEnd) ? (timeMap?.segments || []).flatMap(segment => {
            const timelineStart = Math.max(
                Number(layer.startTime) || 0,
                hasStart ? Number(effect.startTime) : Number(layer.startTime) || 0,
                Number(segment.timelineStart) || 0,
            );
            const timelineEnd = Math.min(
                (Number(layer.startTime) || 0) + (Number(layer.duration) || 0),
                hasEnd ? Number(effect.endTime) : (Number(layer.startTime) || 0) + (Number(layer.duration) || 0),
                Number(segment.timelineEnd) || 0,
            );
            if (!(timelineEnd > timelineStart)) return [];
            return [{
                // Timeline clip duration is already its output duration. Speed
                // changes which source frames play inside that window; it does
                // not compress the clip's authored timeline coordinates again.
                start: Number((Number(segment.outputStart) + (timelineStart - Number(segment.timelineStart))).toFixed(4)),
                end: Number((Number(segment.outputStart) + (timelineEnd - Number(segment.timelineStart))).toFixed(4)),
            }];
        }) : undefined;
        const params = effect?.params || {};
        const tracks = Object.fromEntries(Object.entries(params).flatMap(([key, raw]) => {
            const track = getEffectKeyframeTrack(effect, key, raw);
            return Array.isArray(track) && track.length ? [[key, track]] : [];
        }));
        for (const [key, track] of Object.entries(effect?.keyframes || {})) {
            if (Array.isArray(track) && track.length && !tracks[key]) tracks[key] = track;
        }
        for (const [key, expression] of Object.entries(effect?.expressions || {})) {
            if (typeof expression === 'string' && expression.trim() && !tracks[key]) tracks[key] = [];
        }
        for (const [key, raw] of Object.entries(params)) {
            if (typeof raw?.expression === 'string' && raw.expression.trim() && !tracks[key]) tracks[key] = [];
        }
        if (!Object.keys(tracks).length) return outputWindows ? { ...effect, outputWindows } : effect;

        const duration = Math.max(0, Number(layer.duration) || 0);
        const localTimes = new Set([0, duration]);
        const protectedTimes = new Set([0, duration]);
        const sampleRate = Math.max(1, Math.min(120, Number(fps) || 30));
        const frameCount = Math.ceil(duration * sampleRate);
        for (let frame = 1; frame < frameCount; frame++) {
            const at = frame / sampleRate;
            if (at < duration) localTimes.add(Number(at.toFixed(6)));
        }
        for (const track of Object.values(tracks)) for (const point of track) {
            // Effect controls author keyframes at the project playhead, so
            // their times are timeline seconds (unlike clip-local motion
            // preset tracks). Convert authored times to this local sample grid.
            const at = Number(point?.time) - (Number(layer.startTime) || 0);
            if (Number.isFinite(at) && at >= 0 && at <= duration) {
                localTimes.add(at);
                protectedTimes.add(at);
            }
        }
        const keys = Object.keys(tracks);
        const rows = [...localTimes].sort((a, b) => a - b).map(localTime => ({
            localTime,
            t: Number((clipLocalOutputTime ? localTime : timelineToOutputTime(timeMap, layer.startTime + localTime)).toFixed(4)),
            values: Object.fromEntries(keys.map(key => [key,
                resolveEffectParameter(effect, key, Array.isArray(params[key]?.value ?? params[key])
                    ? (params[key]?.value ?? params[key])
                    : Number(params[key]?.value ?? params[key]) || 0, (Number(layer.startTime) || 0) + localTime, {
                    clipStart: Number(layer.startTime) || 0,
                    clipDuration: duration,
                }),
            ])),
        }));
        const reducedRows = reduceEffectSampleRows(rows, keys, protectedTimes, 60);
        const samples = Object.fromEntries(keys.map(key => [key,
            reducedRows.map(row => ({ t: row.t, value: row.values[key] }))
                .filter(point => Number.isFinite(point.t) && (Array.isArray(point.value)
                    ? point.value.length > 0 && point.value.every(Number.isFinite)
                    : Number.isFinite(point.value))),
        ]));
        return { ...effect, ...(outputWindows ? { outputWindows } : {}), samples, sourceIndex: effectIndex };
    });
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
export function simplifySamples(samples, tolerance = 0.0015, keys = ['x', 'y', 'w', 'h', 'opacity', 'rotation', 'flipH', 'flipV']) {
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
function simplifySourceTimeMap(points, tolerance) {
    if (!Array.isArray(points) || points.length <= 2) return points || [];
    const keep = new Set([0, points.length - 1]);
    const visit = (first, last) => {
        const a = points[first], b = points[last];
        const span = Number(b.source) - Number(a.source);
        if (!(span > 1e-8)) return;
        let maxError = tolerance, maxIndex = -1;
        for (let index = first + 1; index < last; index++) {
            const progress = (Number(points[index].source) - Number(a.source)) / span;
            const expected = Number(a.output) + (Number(b.output) - Number(a.output)) * progress;
            const error = Math.abs(Number(points[index].output) - expected);
            if (error > maxError) { maxError = error; maxIndex = index; }
        }
        if (maxIndex < 0) return;
        keep.add(maxIndex);
        visit(first, maxIndex);
        visit(maxIndex, last);
    };
    visit(0, points.length - 1);
    return [...keep].sort((a, b) => a - b).map(index => points[index]);
}

export function buildCompositionPlan(tracks, opts = {}) {
    const frame = {
        width:  Number(opts.width)  > 0 ? Math.round(Number(opts.width))  : 1080,
        height: Number(opts.height) > 0 ? Math.round(Number(opts.height)) : 1920,
    };
    const fps = Number(opts.fps) > 0 ? Number(opts.fps) : 30;

    const { baseTrack, overlayTracks } = getVisualTrackRoles(tracks);
    // The base must be an actual video/image track — never 'overlay' (R62).
    // `sortedVisualTracks` already puts overlay tracks last via
    // VISUAL_TYPE_PRIORITY, which makes `visual[0]` correct in every case that
    // reaches export today (exportProcessor's STEP 2 refuses to run without a
    // real video track). This `.find` is the belt-and-suspenders version of
    // the same guarantee: even a plan built for a video-less/overlay-only
    // timeline (unreachable in the app today, but not unreachable as an input
    // to this pure function) cannot promote a sticker into the base role.
    const timeMap = buildTimeMap(baseTrack?.clips || []);

    const overlays = [];
    // Rasterized graphics accept the normal ordered effect stack directly.
    // A branched graph is carried separately so the worker can render the
    // graph against the generated RGBA frame sequence *before* ordinary layer
    // geometry/compositing. That preserves fork/join semantics instead of
    // flattening a composite into a made-up order.
    const compositionOpacityCache = new Map();
    const compositionEffectCache = new Map();
    // zIndex counts up from 1: the base track is 0 and is not in this list.
    let zIndex = 1;

    for (const track of overlayTracks) {
        const rawClips = track.clips || [];
        const expandedClips = rawClips.flatMap(c => {
            if (c?.isCompound && Array.isArray(c.compoundLayers)) {
                return c.compoundLayers.map(l => ({
                    ...l,
                    id: `${c.id}-${l.id || l.nodeId || Math.random().toString(36).slice(2, 6)}`,
                    start: c.start + (l.relativeStart ?? (Number(l.start) || 0)),
                    duration: Number(l.duration) || c.duration,
                    x: l.x != null ? (Number(c.x ?? 50) + (Number(l.x) - 50)) : c.x,
                    y: l.y != null ? (Number(c.y ?? 50) + (Number(l.y) - 50)) : c.y,
                    scale: (Number(c.scale) || 1) * (Number(l.scale) || 1),
                    opacity: (Number(c.opacity) || 1) * (Number(l.opacity) || 1),
                    rotation: (Number(c.rotation) || 0) + (Number(l.rotation) || 0),
                }));
            }
            return [c];
        });
        for (const clip of expandedClips) {
            if (!clip || !(Number(clip.duration) > 0)) continue;

            // A linear graph can be projected into the ordinary stack (and is
            // therefore shown in the live SVG/CSS preview). Preserve a graph
            // that cannot be projected so export can execute its true DAG on
            // a local RGBA sequence before this plan composites it. This is
            // source-agnostic: uploaded footage, images and generated layers
            // all use the same verified raster prepass.
            const graphPreview = clip.effectGraph
                ? resolveTimelineEffectGraphPreview(clip.effectGraph)
                : { effects: [] };
            const requiresGraphRasterPass = graphPreview.hasGraph && !graphPreview.supported;
            const canRasterizeGraph = requiresGraphRasterPass;
            const authoredEffects = [
                ...graphPreview.effects,
                ...(Array.isArray(clip.effects) ? clip.effects : []),
            ];

            const groupOpacity = (clip.compositionStack || []).reduce((product, group) =>
                product * Math.max(0, Math.min(1, Number(group?.opacity ?? 1))), 1);
            // Scene flattening stores the legacy aggregate opacity on each
            // child. Remove static container opacity from the child sample;
            // the compiler applies it once after isolating the group buffer.
            const renderClip = groupOpacity > 1e-6 && groupOpacity < 0.999999
                ? { ...clip, opacity: Number(clip.opacity ?? 1) / groupOpacity }
                : clip;
            const layer = clipToMotionLayer(renderClip, track);
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

            // Ordinary video overlays can carry the same authored source-time
            // curve used by scene video. Sample that shared mapping in output
            // time so export can compile a bounded inverse PTS map. The map is
            // omitted for legacy clips, preserving their constant-speed path.
            let sourceTimeMap = null;
            let sourceTimeSegments = null;
            let sourceTimeMapWarning = null;
            if (clip.type === 'video' && (
                (Array.isArray(clip.timeRemap?.keyframes) && clip.timeRemap.keyframes.length)
                || (typeof clip.timeRemap?.expression === 'string' && clip.timeRemap.expression.trim())
            )) {
                const duration = Math.max(0, Number(clip.duration) || 0);
                const sampleCount = Math.max(2, Math.min(1800, Math.ceil(duration * fps)));
                const sampled = Array.from({ length: sampleCount + 1 }, (_, index) => {
                    const localTime = duration * index / sampleCount;
                    return {
                        source: remapSceneObjectTime(clip.timeRemap, localTime, duration || 1),
                        output: timelineToOutputTime(timeMap, layer.startTime + localTime) - startOut,
                        timeline: layer.startTime + localTime,
                    };
                }).filter(point => Number.isFinite(point.source) && Number.isFinite(point.output));
                const direction = Math.sign(sampled.at(-1)?.source - sampled[0]?.source);
                const monotonic = sampled.every((point, index) => index === 0
                    || (point.output >= sampled[index - 1].output - 1e-7
                        && (direction < 0
                            ? point.source <= sampled[index - 1].source + 1e-7
                            : point.source >= sampled[index - 1].source - 1e-7)));
                if (!monotonic) {
                    const ranges = [];
                    let segmentStart = 0;
                    let currentDirection = 0;
                    for (let index = 1; index < sampled.length; index++) {
                        const delta = Number(sampled[index].source) - Number(sampled[index - 1].source);
                        const nextDirection = Math.abs(delta) <= 1e-7 ? 0 : Math.sign(delta);
                        if (nextDirection && currentDirection && nextDirection !== currentDirection) {
                            ranges.push(sampled.slice(segmentStart, index));
                            segmentStart = index - 1;
                        }
                        if (nextDirection) currentDirection = nextDirection;
                    }
                    ranges.push(sampled.slice(segmentStart));
                    if (ranges.length > 24) {
                        sourceTimeMapWarning = `source-time curve changes direction too often to export safely (${ranges.length} segments; limit 24)`;
                    } else {
                        sourceTimeSegments = ranges.filter(segment => segment.length > 1
                            && Number(segment.at(-1).output) > Number(segment[0].output))
                            .map(segment => {
                                const points = segment.map(point => ({
                                    source: Number(point.source.toFixed(6)),
                                    output: Number((point.output - segment[0].output).toFixed(6)),
                                }));
                                const hasMovement = points.some(point => Math.abs(point.source - points[0].source) > 1e-7);
                                return {
                                    outputStart: Number(segment[0].output.toFixed(6)),
                                    outputEnd: Number(segment.at(-1).output.toFixed(6)),
                                    timelineStart: Number(segment[0].timeline.toFixed(6)),
                                    sourceTimeMap: hasMovement
                                        ? simplifySourceTimeMap(points, 0.5 / fps)
                                        : [{ source: points[0].source, output: 0 }],
                                };
                            });
                        if (!sourceTimeSegments.length) sourceTimeMapWarning = 'source-time curve could not be divided into renderable segments';
                    }
                } else {
                    // Preserve duplicate source coordinates: they encode a
                    // deliberate hold interval in output time. The worker
                    // turns that vertical segment into a timestamp jump so
                    // FFmpeg's framesync holds the selected source frame.
                    const points = sampled.map(point => ({
                        source: Number(point.source.toFixed(6)),
                        output: Number(point.output.toFixed(6)),
                    }));
                    const hasMovement = points.some(point => Math.abs(point.source - points[0].source) > 1e-7);
                    sourceTimeMap = hasMovement
                        ? simplifySourceTimeMap(points, 0.5 / fps)
                        : [{ source: points[0].source, output: 0 }];
                }
            }

            let geometry = sampleGeometry(layer, frame, timeMap, fps, opts.audioWaveformsByAsset);

            // R88 layout presets: the clip sits in a fixed box (frame
            // fractions) and its media COVERS it, cropped around the focus
            // point. Opacity/blur still come from the motion samples.
            let fit = null;
            if (hasLayoutFrame(clip)) {
                const f = clip.frame;
                const boxed = geometry.map(g => ({ ...g, x: f.x, y: f.y, w: f.w, h: f.h, rotation: 0 }));
                geometry = boxed.filter((g, i) => i === 0 || i === boxed.length - 1
                    || Math.abs(g.opacity - boxed[i - 1].opacity) > 1e-3 || Math.abs((g.blur || 0) - (boxed[i - 1].blur || 0)) > 1e-3);
                fit = {
                    mode: 'cover',
                    focusX: Math.max(0, Math.min(1, Number(f.focusX ?? 0.5))),
                    focusY: Math.max(0, Math.min(1, Number(f.focusY ?? 0.5))),
                    preset: f.preset,
                };
            }

            const overlayPlan = {
                id: `ov-${clip.id}`,
                clipId: clip.id,
                trackId: track.id,
                ...(clip.sceneId ? { sceneId: clip.sceneId } : {}),
                ...(clip.sceneNodeId ? { sceneNodeId: clip.sceneNodeId } : {}),
                ...(Array.isArray(clip.compositionStack) && clip.compositionStack.length
                    ? { compositionStack: clip.compositionStack.map((group, groupIndex) => {
                        const groupCacheKey = `${clip.sceneId || 'no-scene'}:${clip.compositionStack.slice(0, groupIndex).map(parent => parent?.id).join('/')}:${group.id}`;
                        let opacitySamples = compositionOpacityCache.get(groupCacheKey);
                        if (opacitySamples === undefined) {
                            opacitySamples = sampleCompositionOpacity(group, timeMap, fps);
                            compositionOpacityCache.set(groupCacheKey, opacitySamples);
                        }
                        const { opacityAnimations: _opacityAnimations, opacityExpression: _opacityExpression, ...serializableGroup } = group;
                        let sampledEffects = compositionEffectCache.get(groupCacheKey);
                        if (sampledEffects === undefined) {
                            sampledEffects = sampleEffectTracks(group.effects, {
                                startTime: Number(group.start) || 0,
                                duration: Math.max(0, Number(group.duration) || 0),
                            }, timeMap, { fps });
                            compositionEffectCache.set(groupCacheKey, sampledEffects);
                        }
                        return {
                            ...serializableGroup,
                            effects: sampledEffects.map(effect => {
                                const { keyframes: _keyframes, expressions: _expressions, ...serializableEffect } = effect;
                                return serializableEffect;
                            }),
                            ...(opacitySamples ? { opacitySamples } : {}),
                        };
                    }) }
                    : {}),
                zIndex: zIndex++,
                kind: layer.kind,
                source: {
                    url: clip.proxyUrl || clip.url || clip.sourceUrl || null,
                    assetId: clip.assetId || null,
                    type: clip.vector ? 'vector' : (clip.type || track.type),
                    // R89: a template is drawn by the worker from this
                    // description (TemplateRenderer), not fetched.
                    ...(clip.type === 'template' && clip.template ? { template: clip.template } : {}),
                    // Vector clips are authored as serializable drawing data,
                    // not media URLs. Preserve that payload for the export
                    // compositor's PNG-sequence renderer.
                    ...(clip.vector ? { vector: clip.vector } : {}),
                },
                // Where in the SOURCE file this clip starts, and how fast it runs.
                sourceOffset: Number(clip.offset) || 0,
                speed: Number(clip.speed) > 0 ? Number(clip.speed) : 1,
                ...(sourceTimeMap ? { sourceTimeMap } : {}),
                ...(sourceTimeMapWarning ? { sourceTimeMapWarning } : {}),
                // Output-time window — what the worker gates `enable=` on.
                outputStart: Number(startOut.toFixed(4)),
                outputEnd: Number(endOut.toFixed(4)),
                animated: geometry.length > 1,
                geometry,
                ...(fit ? { fit } : {}),
                // R98 — generic drop shadow (stickers/icons/shapes/templates).
                // A constant style switch, not something that animates frame
                // to frame, so it lives beside the geometry samples rather
                // than inside them (same reasoning as `fit` above). The
                // worker (CompositorCompiler's compileShadowSource) scales
                // dx/dy/blur by the actual render resolution, so this stays
                // in CSS-pixel-ish units consistent with the preview.
                ...(clip.shadow ? { shadow: normalizeShadow(clip.shadow) } : {}),
                ...(clip.motionBlur?.enabled ? { motionBlur: {
                    enabled: true,
                    samples: Math.max(2, Math.min(MAX_MOTION_BLUR_SAMPLES, Math.round(Number(clip.motionBlur.samples) || 5))),
                    shutterAngle: Math.max(0, Math.min(360, Number.isFinite(Number(clip.motionBlur.shutterAngle)) ? Number(clip.motionBlur.shutterAngle) : 180)),
                    frameRate: Math.max(1, Math.min(120, Number(clip.motionBlur.frameRate) || 30)),
                } } : {}),
                ...(clip.blendMode && clip.blendMode !== 'source-over' ? { blendMode: clip.blendMode } : {}),
                ...(authoredEffects.length ? { effects: sampleEffectTracks(authoredEffects, layer, timeMap, { fps }).map(effect => {
                    const { type: _legacyType, ...preserved } = effect;
                    return {
                        ...preserved,
                        kind: effect.kind || effect.type,
                        params: Object.fromEntries(Object.entries(effect.params || {}).map(([key, value]) => [key,
                            value && typeof value === 'object' && 'value' in value
                                ? (Array.isArray(value.keyframes) ? { ...value, value: value.value } : value.value)
                                : value,
                        ])),
                        // Keep the authoring state in the plan. Preview skips
                        // disabled effects; dropping this flag made export apply them.
                        ...(effect.enabled !== undefined ? { enabled: effect.enabled } : {}),
                    };
                }) } : {}),
                // An unsupported live-preview graph remains intact for the
                // worker's RGBA raster pass. It is not duplicated for a
                // linear graph because those nodes already live in `effects`.
                ...(canRasterizeGraph ? {
                    effectGraph: clip.effectGraph,
                    // Effect-graph windows/keyframes are authored on the
                    // project timeline, whereas `outputStart` can move when
                    // the base edit contains removed or retimed ranges. Keep
                    // the authoring origin so the worker can render the
                    // generated local frame sequence on the correct clock.
                    timelineStart: Number(layer.startTime) || 0,
                } : {}),
                ...(clip.sceneMask ? { sceneMask: { ...clip.sceneMask } } : {}),
            };
            if (sourceTimeSegments) {
                sourceTimeSegments.forEach((segment, segmentIndex) => overlays.push({
                    ...overlayPlan,
                    id: `${overlayPlan.id}-retime-${segmentIndex + 1}`,
                    sourceTimeMap: segment.sourceTimeMap,
                    outputStart: Number((startOut + segment.outputStart).toFixed(4)),
                    outputEnd: Number((startOut + segment.outputEnd).toFixed(4)),
                    // This split represents a later span of the original
                    // clip. Keep graph windows/keyframes on that authored
                    // source timeline when the worker rasterizes the segment.
                    timelineStart: Number(segment.timelineStart),
                }));
            } else {
                overlays.push(overlayPlan);
            }
        }
    }

    // Resolve scene-node mattes only after every visible overlay has been
    // collected. The matte node travels as a real source layer through export
    // but is not drawn as a visible layer by default, matching track-matte
    // behavior in compositing applications.
    const sceneNodeOverlays = new Map();
    for (const overlay of overlays) {
        if (overlay.sceneId && overlay.sceneNodeId) {
            sceneNodeOverlays.set(`${overlay.sceneId}:${overlay.sceneNodeId}`, overlay);
        }
    }
    for (const overlay of overlays) {
        if (overlay.sceneMask?.kind !== 'layer') continue;
        const matte = sceneNodeOverlays.get(`${overlay.sceneId}:${overlay.sceneMask.nodeId}`);
        overlay.sceneMask = {
            ...overlay.sceneMask,
            sourceOverlayId: matte?.id || null,
        };
        if (matte && matte.id !== overlay.id) matte.matteOnly = true;
    }

    const baseEffectsByClip = (baseTrack?.clips || []).flatMap(clip => {
        const authored = Array.isArray(clip.effects) ? clip.effects : [];
        if (!authored.some(effect => Object.keys(effect?.expressions || {}).length
            || Object.values(effect?.params || {}).some(param => typeof param?.expression === 'string' && param.expression.trim()))) return [];
        const layer = clipToMotionLayer(clip, baseTrack);
        if (!layer) return [];
        const effects = sampleEffectTracks(authored, layer, timeMap, { clipLocalOutputTime: true, fps })
            .filter(effect => Object.keys(effect?.expressions || {}).length
                || Object.values(effect?.params || {}).some(param => typeof param?.expression === 'string' && param.expression.trim()));
        return effects.length ? [{ clipId: clip.id, effects }] : [];
    });

    return {
        version: COMPOSITION_PLAN_VERSION,
        frame,
        fps,
        base: {
            trackId: baseTrack?.id || null,
            segments: timeMap.segments,
            totalDuration: Number(timeMap.totalDuration.toFixed(4)),
            ...(baseEffectsByClip.length ? { effectsByClip: baseEffectsByClip } : {}),
        },
        overlays,
    };
}

/**
 * True when there are neither overlays nor sampled base-footage expressions.
 * Ordinary projects still skip the plan; procedural base effects retain it so
 * their samples reach the worker even without any overlay layers.
 */
export function planIsNoOp(plan) {
    return !plan || ((!Array.isArray(plan.overlays) || plan.overlays.length === 0)
        && !(plan.base?.effectsByClip || []).length);
}

/**
 * Validate a plan before executing it. Returns `{ valid, errors }`, never throws.
 * The worker should call this and, on failure, render WITHOUT the overlay pass
 * rather than failing the export — an ungraded/unlayered video is a far better
 * outcome than no video, which is the same fail-open rule the LUT lookup uses.
 */
function validClientIsolatedGroupEffect(effect) {
    if (effect?.enabled === false) return true;
    const kind = effect?.kind || effect?.type;
    if (!['blur', 'blur_gaussian', 'brightness', 'contrast', 'saturation', 'saturate', 'hue', 'hue-rotate', 'color_grade', 'glow'].includes(kind)
        || effect.keyframes || effect.expressions) return false;
    if (effect.samples == null) return effect.outputWindows == null;
    if (kind === 'blur' || kind === 'blur_gaussian') {
        const key = effect.samples?.radius ? 'radius' : 'amount';
        const points = effect.samples?.[key];
        return Array.isArray(points) && points.length > 0 && points.length <= 60
            && !Object.keys(effect.samples || {}).some(sampleKey => sampleKey !== key)
            && !points.some((point, index) => !point || !hasNumericValue(point.t) || Number(point.t) < 0
                || !hasNumericValue(point.value) || Number(point.value) < 0 || Number(point.value) > 50
                || (index > 0 && Number(point.t) <= Number(points[index - 1]?.t)))
            && (effect.outputWindows == null || (Array.isArray(effect.outputWindows) && !effect.outputWindows.some(effectWindow =>
                !effectWindow || !hasNumericValue(effectWindow.start) || !hasNumericValue(effectWindow.end) || Number(effectWindow.start) < 0 || Number(effectWindow.end) <= Number(effectWindow.start))));
    }
    if (kind === 'hue' || kind === 'hue-rotate') {
        const key = effect.samples?.degrees ? 'degrees' : 'amount';
        const points = effect.samples?.[key];
        return Array.isArray(points) && points.length > 0 && points.length <= 60
            && !Object.keys(effect.samples || {}).some(sampleKey => sampleKey !== key)
            && !points.some((point, pointIndex) => !point || !hasNumericValue(point.t) || Number(point.t) < 0
                || !hasNumericValue(point.value) || Number(point.value) < -360 || Number(point.value) > 360
                || (pointIndex > 0 && Number(point.t) <= Number(points[pointIndex - 1]?.t)))
            && (effect.outputWindows == null || (Array.isArray(effect.outputWindows) && !effect.outputWindows.some(effectWindow =>
                !effectWindow || !hasNumericValue(effectWindow.start) || !hasNumericValue(effectWindow.end) || Number(effectWindow.start) < 0 || Number(effectWindow.end) <= Number(effectWindow.start))));
    }
    if (kind === 'glow') {
        const limits = { threshold: [0, 1], intensity: [0, 3], radius: [0, 50] };
        const samples = effect.samples;
        return !!samples && Object.keys(samples).length > 0 && !Object.keys(samples).some(key => !limits[key])
            && Object.entries(samples).every(([key, points]) => Array.isArray(points) && points.length > 0 && points.length <= 60
                && !points.some((point, index) => !point || !hasNumericValue(point.t) || Number(point.t) < 0
                    || !hasNumericValue(point.value) || Number(point.value) < limits[key][0] || Number(point.value) > limits[key][1]
                    || (index > 0 && Number(point.t) <= Number(points[index - 1]?.t))))
            && (effect.outputWindows == null || (Array.isArray(effect.outputWindows) && !effect.outputWindows.some(effectWindow =>
                !effectWindow || !hasNumericValue(effectWindow.start) || !hasNumericValue(effectWindow.end) || Number(effectWindow.start) < 0 || Number(effectWindow.end) <= Number(effectWindow.start))));
    }
    if (kind === 'color_grade') {
        const limits = { brightness: [0, 200], contrast: [0, 200], saturation: [0, 200], temperature: [-100, 100], tint: [-100, 100] };
        const samples = effect.samples;
        return !!samples && Object.keys(samples).length > 0 && !Object.keys(samples).some(sampleKey => !limits[sampleKey])
            && Object.entries(samples).every(([key, points]) => Array.isArray(points) && points.length > 0 && points.length <= 60
                && !points.some((point, pointIndex) => !point || !hasNumericValue(point.t) || Number(point.t) < 0
                    || !hasNumericValue(point.value) || Number(point.value) < limits[key][0] || Number(point.value) > limits[key][1]
                    || (pointIndex > 0 && Number(point.t) <= Number(points[pointIndex - 1]?.t))))
            && (effect.outputWindows == null || (Array.isArray(effect.outputWindows) && !effect.outputWindows.some(effectWindow =>
                !effectWindow || !hasNumericValue(effectWindow.start) || !hasNumericValue(effectWindow.end) || Number(effectWindow.start) < 0 || Number(effectWindow.end) <= Number(effectWindow.start))));
    }
    const points = effect.samples?.amount;
    return ['brightness', 'contrast', 'saturation', 'saturate'].includes(kind)
        && Array.isArray(points) && points.length > 0 && points.length <= 60
        && !Object.keys(effect.samples || {}).some(key => key !== 'amount')
        && !points.some((point, pointIndex) => !point || !hasNumericValue(point.t) || Number(point.t) < 0
            || !hasNumericValue(point.value) || Number(point.value) < 0 || Number(point.value) > (kind === 'saturation' || kind === 'saturate' ? 5 : 4)
            || (pointIndex > 0 && Number(point.t) <= Number(points[pointIndex - 1]?.t)))
        && (effect.outputWindows == null || (Array.isArray(effect.outputWindows) && !effect.outputWindows.some(effectWindow =>
            !effectWindow || !hasNumericValue(effectWindow.start) || !hasNumericValue(effectWindow.end) || Number(effectWindow.start) < 0 || Number(effectWindow.end) <= Number(effectWindow.start))));
}

function validClientEffectSamples(effect) {
    if (effect?.samples == null) return true;
    const samples = effect.samples;
    if (!samples || typeof samples !== 'object' || Array.isArray(samples)) return false;
    const entries = Object.entries(samples);
    if (!entries.length || entries.length > 16) return false;
    if (!entries.every(([, points]) => Array.isArray(points) && points.length > 0 && points.length <= 60
        && !points.some((point, index) => !point || !hasNumericValue(point.t) || Number(point.t) < 0
            || !hasNumericValue(point.value) || (index > 0 && Number(point.t) <= Number(points[index - 1]?.t))))) return false;
    return effect.outputWindows == null || (Array.isArray(effect.outputWindows) && !effect.outputWindows.some(effectWindow =>
        !effectWindow || !hasNumericValue(effectWindow.start) || !hasNumericValue(effectWindow.end)
        || Number(effectWindow.start) < 0 || Number(effectWindow.end) <= Number(effectWindow.start)));
}

export function validateCompositionPlan(plan) {
    const errors = [];
    if (!plan || typeof plan !== 'object') return { valid: false, errors: ['plan must be an object'] };
    if (plan.version !== COMPOSITION_PLAN_VERSION) {
        errors.push(`unsupported plan version ${plan.version} (expected ${COMPOSITION_PLAN_VERSION})`);
    }
    if (!plan.frame || !Number.isFinite(Number(plan.frame.width)) || !Number.isFinite(Number(plan.frame.height))
        || Number(plan.frame.width) <= 0 || Number(plan.frame.height) <= 0) {
        errors.push('plan.frame must have finite positive width and height');
    }
    if (!Array.isArray(plan.overlays)) errors.push('plan.overlays must be an array');
    if (plan.warnings != null && (!Array.isArray(plan.warnings)
        || plan.warnings.some(warning => typeof warning !== 'string' || !warning.trim() || warning.length > 600))) {
        errors.push('plan.warnings must be short non-empty strings');
    }

    (plan.overlays || []).forEach((ov, i) => {
        const vector = ov.source?.vector;
        const vectorKinds = new Set(['rect', 'circle', 'ellipse', 'capsule', 'callout', 'polygon', 'star', 'arrow', 'path']);
        const inlineVector = ov.source?.type === 'vector' && vector && typeof vector === 'object'
            && vectorKinds.has(String(vector.kind || 'rect'))
            && (!('w' in vector) || (Number.isFinite(Number(vector.w)) && Number(vector.w) > 0 && Number(vector.w) <= 10000))
            && (!('h' in vector) || (Number.isFinite(Number(vector.h)) && Number(vector.h) > 0 && Number(vector.h) <= 10000))
            && (vector.kind !== 'path' || (typeof vector.pathData === 'string' && vector.pathData.trim().length > 0));
        if (!ov.source?.url && !ov.source?.assetId && !inlineVector) {
            errors.push(`overlays[${i}]: has no resolvable media or inline vector source`);
        }
        if (!hasNumericValue(ov.outputStart) || !hasNumericValue(ov.outputEnd)
            || Number(ov.outputStart) < 0 || !(ov.outputEnd > ov.outputStart)) {
            errors.push(`overlays[${i}]: output window must be finite, non-negative, and positive in duration`);
        }
        if (ov.blendMode && !['source-over', 'multiply', 'screen', 'darken', 'lighten', 'difference', 'addition', 'overlay', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].includes(ov.blendMode)) {
            errors.push(`overlays[${i}]: unsupported blend mode ${ov.blendMode}`);
        }
        if (ov.effects != null && (!Array.isArray(ov.effects) || ov.effects.some(effect => !validClientEffectSamples(effect)))) {
            errors.push(`overlays[${i}]: effect samples are malformed or exceed the render budget`);
        }
        if (ov.effectGraph != null) {
            if (!hasNumericValue(ov.timelineStart) || Number(ov.timelineStart) < 0) {
                errors.push(`overlays[${i}]: effect graph timelineStart must be finite and non-negative`);
            }
        }
        if (ov.compositionStack != null && (!Array.isArray(ov.compositionStack) || ov.compositionStack.some(group =>
            !group || typeof group.id !== 'string' || !group.id || !hasNumericValue(group.opacity) || Number(group.opacity) < 0 || Number(group.opacity) > 1
            || (group.start !== undefined && (!hasNumericValue(group.start) || Number(group.start) < 0))
            || (group.duration !== undefined && (!hasNumericValue(group.duration) || Number(group.duration) < 0))
            || (group.blendMode && !['source-over', 'multiply', 'screen', 'darken', 'lighten', 'difference', 'addition', 'overlay', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].includes(group.blendMode))
            || (group.opacitySamples != null && (!Array.isArray(group.opacitySamples) || group.opacitySamples.length === 0 || group.opacitySamples.some((sample, sampleIndex, samples) =>
                !sample || !hasNumericValue(sample.t) || Number(sample.t) < 0 || !hasNumericValue(sample.value)
                || Number(sample.value) < 0 || Number(sample.value) > 1
                || (sampleIndex > 0 && Number(sample.t) <= Number(samples[sampleIndex - 1]?.t)))) )
            || (group.effects != null && (!Array.isArray(group.effects) || group.effects.some(effect => !validClientIsolatedGroupEffect(effect))))))) {
            errors.push(`overlays[${i}]: compositionStack must contain groups with ids and opacity in [0, 1]`);
        }
        const supportedShapeMasks = ['ellipse', 'circle', 'rectangle', 'rounded-rectangle', 'capsule', 'callout', 'polygon', 'star', 'arrow'];
        if (ov.sceneMask && (ov.sceneMask.kind !== 'shape' || !supportedShapeMasks.includes(ov.sceneMask.shape))) {
            const matte = (plan.overlays || []).find(candidate => candidate?.id === ov.sceneMask?.sourceOverlayId);
            if (ov.sceneMask.kind !== 'layer' || !matte?.matteOnly || matte.id === ov.id) {
                errors.push(`overlays[${i}]: unsupported or unresolved scene mask`);
            }
            if (ov.sceneMask.kind === 'layer' && ov.sceneMask.mode != null && !['alpha', 'luma', 'luminance'].includes(ov.sceneMask.mode)) {
                errors.push(`overlays[${i}]: unsupported layer matte mode ${ov.sceneMask.mode}`);
            }
        }
        if (ov.sceneMask?.kind === 'shape' && supportedShapeMasks.includes(ov.sceneMask.shape)) {
            const mask = ov.sceneMask;
            const inset = Number.isFinite(Number(mask.inset)) ? Math.max(0, Math.min(0.45, Number(mask.inset))) : 0;
            const hasX = hasNumericValue(mask.x), hasY = hasNumericValue(mask.y);
            const x = hasX ? Number(mask.x) : inset;
            const y = hasY ? Number(mask.y) : inset;
            const w = hasNumericValue(mask.w) ? Number(mask.w) : 1 - x - (hasX ? 0 : inset);
            const h = hasNumericValue(mask.h) ? Number(mask.h) : 1 - y - (hasY ? 0 : inset);
            if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) {
                errors.push(`overlays[${i}]: scene mask bounds must be positive and fit inside the layer`);
            }
            if (mask.shape === 'polygon' && (!Number.isFinite(Number(mask.sides ?? 5)) || Number(mask.sides ?? 5) < 3 || Number(mask.sides ?? 5) > 128)) {
                errors.push(`overlays[${i}]: polygon mask sides must be between 3 and 128`);
            }
            if (mask.shape === 'star' && (!Number.isFinite(Number(mask.points ?? 5)) || Number(mask.points ?? 5) < 2 || Number(mask.points ?? 5) > 64)) {
                errors.push(`overlays[${i}]: star mask points must be between 2 and 64`);
            }
            if (mask.feather !== undefined && (!hasNumericValue(mask.feather) || Number(mask.feather) < 0 || Number(mask.feather) > 0.25)) {
                errors.push(`overlays[${i}]: shape mask feather must be in 0..0.25`);
            }
            for (const key of ['radius', 'innerRadius', 'outerRadius', 'rotation']) {
                if (mask[key] != null && !Number.isFinite(Number(mask[key]))) errors.push(`overlays[${i}]: scene mask ${key} must be finite`);
            }
        }
        if (!Array.isArray(ov.geometry) || ov.geometry.length === 0) {
            errors.push(`overlays[${i}]: needs at least one geometry sample`);
        }
        (ov.geometry || []).forEach((g, k) => {
            if (!g || typeof g !== 'object') {
                errors.push(`overlays[${i}].geometry[${k}]: sample must be an object`);
                return;
            }
            for (const key of ['x', 'y', 'w', 'h', 't', 'rotation', 'opacity', 'blur']) {
                if (!hasNumericValue(g?.[key])) errors.push(`overlays[${i}].geometry[${k}]: ${key} is not finite`);
            }
            if (g.w <= 0 || g.h <= 0) errors.push(`overlays[${i}].geometry[${k}]: non-positive size`);
            if (g.t < 0 || g.opacity < 0 || g.opacity > 1 || g.blur < 0) {
                errors.push(`overlays[${i}].geometry[${k}]: value is outside supported bounds`);
            }
            if (['flipH', 'flipV'].some(key => g[key] !== undefined
                && (!hasNumericValue(g[key]) || ![0, 1].includes(Number(g[key]))))) {
                errors.push(`overlays[${i}].geometry[${k}]: scale flip must be 0 or 1`);
            }
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
        // Timeline clips use half-open windows throughout the editor. Keep the
        // preview boundary identical so a layer cannot flash on the cut frame.
        if (t < ov.outputStart || t >= ov.outputEnd) continue;
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
            // Geometry is normalized to the frame (0..1), so integer rounding
            // collapses most positions and sizes to zero. Keep subpixel frame
            // fractions through preview interpolation; pixel rounding belongs
            // in the final renderer after multiplying by output dimensions.
            const lerp = (k) => Number((a[k] + (b[k] - a[k]) * p).toFixed(6));
            return {
                t,
                x: lerp('x'),
                y: lerp('y'),
                w: lerp('w'),
                h: lerp('h'),
                rotation: lerp('rotation'),
                opacity: lerp('opacity'),
                blur: lerp('blur'),
                ...(a.flipH !== undefined || b.flipH !== undefined ? { flipH: lerp('flipH') } : {}),
                ...(a.flipV !== undefined || b.flipV !== undefined ? { flipV: lerp('flipV') } : {}),
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
