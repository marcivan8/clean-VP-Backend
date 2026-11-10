/**
 * render-worker/revideo/src/motion/MotionResolver.js
 *
 * SYNCED COPY of client/src/motion/MotionResolver.js — verbatim below the header divider.
 * This file has ZERO dependencies beyond its siblings in this directory, so
 * it is safe to duplicate rather than import: the render-worker Docker build
 * context is render-worker/ only (see render-worker/Dockerfile's `COPY . .`),
 * so `client/src/motion/` is unreachable at build time regardless.
 *
 * KEEP IN SYNC BY HAND. If you change the original, copy the change here too —
 * scripts/test_revideo_render_path.js checks the two bodies match (ignoring
 * this header) and fails loudly if they drift, so a missed sync is caught in
 * CI/local test runs rather than silently rendering exports wrong.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * client/src/motion/MotionResolver.js
 *
 * The pure evaluation core of the Motion Graphics engine.
 *
 * Given a MotionLayer and a time, produce the concrete transform/style values
 * for that instant. Nothing here touches React, the DOM, WebGL, the store or
 * the network — it is deliberately a pure function so that the SAME code can
 * drive:
 *   • the live DOM preview (TextOverlay.jsx),
 *   • the Revideo canvas scene (client/src/revideo/project.tsx),
 *   • and, eventually, the export.
 *
 * That last point is the entire reason this is separated out. This codebase
 * has been burned three separate times (CLAUDE.md R14, R16, R53) by a visual
 * behaviour being implemented once for preview and again for export, then
 * silently diverging. An animation that is a pure function of (layer, time)
 * cannot diverge — both sides call this.
 */

import { resolveEasing, clamp } from './Easing.js';
import { ANIMATABLE_PROPS, COMPOSITION_RULES, IDENTITY } from './MotionSchema.js';
import { evaluateMotionExpression } from './MotionExpression.js';
import { pointsToBezierSpline } from './SpatialMotion.js';
import { applyAudioReactiveMotion } from './AudioReactive.js';

const isTrackValue = value => Number.isFinite(value)
    || (Array.isArray(value) && value.length > 0 && value.every(Number.isFinite));

function interpolateTrackValue(from, to, progress) {
    if (Number.isFinite(from) && Number.isFinite(to)) return from + (to - from) * progress;
    if (Array.isArray(from) && Array.isArray(to) && from.length === to.length
        && from.every(Number.isFinite) && to.every(Number.isFinite)) {
        return from.map((value, index) => value + (to[index] - value) * progress);
    }
    // A vector dimension change has no implicit channel mapping. Hold the
    // nearest authored vector instead of manufacturing invalid components.
    return progress < 0.5 ? from : to;
}

/** Sample a scalar or numeric-vector track using the incoming key's easing. */
export function sampleKeyframeTrack(keyframes, localTime, fallback = 0) {
    if (!Array.isArray(keyframes) || keyframes.length === 0) return fallback;
    const track = keyframes.map((keyframe, index) => ({
        time: Number(keyframe?.time), value: Array.isArray(keyframe?.value) ? [...keyframe.value] : Number(keyframe?.value), easing: keyframe?.easing, index,
    })).filter(point => Number.isFinite(point.time) && isTrackValue(point.value))
        .sort((a, b) => a.time - b.time || a.index - b.index);
    if (!track.length) return fallback;
    const unique = [];
    for (const point of track) {
        if (unique.at(-1)?.time === point.time) unique[unique.length - 1] = point;
        else unique.push(point);
    }
    const at = Number.isFinite(Number(localTime)) ? Number(localTime) : 0;
    if (at <= unique[0].time) return unique[0].value;
    const last = unique.at(-1);
    if (at >= last.time) return last.value;
    for (let i = 0; i < unique.length - 1; i++) {
        const from = unique[i], to = unique[i + 1];
        if (at < from.time || at >= to.time) continue;
        const progress = (at - from.time) / (to.time - from.time);
        return interpolateTrackValue(from.value, to.value, resolveEasing(to.easing || 'linear')(clamp(progress, 0, 1)));
    }
    return last.value;
}

/**
 * Interpolate one animation's contribution at a given animation-local time.
 * Returns a sparse object containing ONLY the properties this animation's
 * keyframes actually mention — so an animation that only touches opacity
 * doesn't silently reset everyone else's scale to 1.
 *
 * @param {object} animation
 * @param {number} localTime seconds since the animation's own start
 * @returns {object} sparse property bag
 */
export function sampleAnimation(animation, localTime) {
    const kfs = animation?.keyframes;
    if (!Array.isArray(kfs) || kfs.length === 0) return {};
    const at = Number.isFinite(Number(localTime)) ? Number(localTime) : 0;

    // Which properties does this animation address at all?
    const touched = new Set();
    for (const kf of kfs) {
        if (!kf?.properties || typeof kf.properties !== 'object') continue;
        for (const p of Object.keys(kf.properties || {})) touched.add(p);
    }
    if (touched.size === 0) return {};

    const out = {};
    for (const prop of touched) {
        // Only keyframes that actually specify this property take part —
        // a keyframe list is usually sparse per-property.
        const track = [];
        for (let index = 0; index < kfs.length; index++) {
            const kf = kfs[index];
            if (!kf?.properties || kf.properties[prop] === undefined || kf.properties[prop] === null || kf.properties[prop] === '') continue;
            const time = Number(kf.time), value = Number(kf.properties[prop]);
            if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
            track.push({ time, value, easing: kf.easing, index });
        }
        track.sort((a, b) => a.time - b.time || a.index - b.index);
        if (track.length === 0) continue;

        // A later-authored keyframe at the same timestamp deterministically
        // replaces the earlier value instead of creating a zero-width segment.
        const uniqueTrack = [];
        for (const point of track) {
            if (uniqueTrack.at(-1)?.time === point.time) uniqueTrack[uniqueTrack.length - 1] = point;
            else uniqueTrack.push(point);
        }

        if (at <= uniqueTrack[0].time) {
            out[prop] = uniqueTrack[0].value;
            continue;
        }
        const last = uniqueTrack[uniqueTrack.length - 1];
        if (at >= last.time) {
            out[prop] = last.value;
            continue;
        }

        // Find the bracketing pair.
        let from = uniqueTrack[0];
        let to = last;
        for (let i = 0; i < uniqueTrack.length - 1; i++) {
            if (at >= uniqueTrack[i].time && at <= uniqueTrack[i + 1].time) {
                from = uniqueTrack[i];
                to = uniqueTrack[i + 1];
                break;
            }
        }

        const span = to.time - from.time;
        const progress = span > 0 ? (at - from.time) / span : 1;
        // Per-keyframe easing wins over the animation's default — this is what
        // lets a single "pop" animation ease in fast and settle out slowly.
        const ease = resolveEasing(to.easing || animation.easing);
        const t = ease(clamp(progress, 0, 1));
        out[prop] = from.value + (to.value - from.value) * t;
    }
    return out;
}

const motionPathSplineCache = new WeakMap();

function cachedMotionPathSpline(path, points) {
    if (!path || typeof path !== 'object') return pointsToBezierSpline(points, false);
    const signature = JSON.stringify([points, path.closed === true]);
    const cached = motionPathSplineCache.get(path);
    if (cached?.signature === signature) return cached.spline;
    const spline = pointsToBezierSpline(points, path.closed === true);
    motionPathSplineCache.set(path, { signature, spline });
    return spline;
}

function sampleMotionPath(path, localTime, layerDuration) {
    const points = (Array.isArray(path?.points) ? path.points : [])
        .map(point => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point?.x), Number(point?.y)])
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (points.length < 2) return null;
    if (path.closed && (points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1])) points.push([...points[0]]);
    const start = Math.max(0, Number(path.startTime) || 0);
    const duration = Math.max(0.001, Number.isFinite(Number(path.duration)) && Number(path.duration) > 0
        ? Number(path.duration) : Math.max(0.001, layerDuration - start));
    const raw = clamp((localTime - start) / duration, 0, 1);
    const eased = clamp(resolveEasing(path.easing || 'easeInOutCubic')(raw), 0, 1);
    const sampleAt = progress => {
        const last = points.length - 1;
        const scaled = clamp(progress, 0, 1) * last;
        const segment = Math.min(last - 1, Math.floor(scaled));
        const t = scaled - segment;
        const p0 = points[Math.max(0, segment - 1)], p1 = points[segment];
        const p2 = points[segment + 1], p3 = points[Math.min(last, segment + 2)];
        const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
        return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
    };
    // Scene-authored paths already offer arc-length travel. Keep the same
    // option on clip MotionLayers, using a bounded lookup table so evaluation
    // remains deterministic and cheap on every preview/export frame.
    const useArcLength = path.arcLength === true || path.mode === 'bezier';
    // The scene animator and clip resolver must evaluate the same Catmull-Rom
    // to cubic-Bezier spline. Cache the bounded arc-length LUT per authored
    // path object so a preview frame does not rebuild it on every tick.
    const spline = useArcLength ? cachedMotionPathSpline(path, points) : null;
    const samplePath = progress => {
        if (!spline) return sampleAt(progress);
        const point = spline.sampleAtNormalizedDistance(progress);
        return [point.x, point.y];
    };
    const [x, y] = samplePath(eased);
    let rotation = (Number(path.spin) || 0) * eased;
    if (Number(path.bank)) {
        const ahead = samplePath(Math.min(1, eased + 0.002));
        const behind = samplePath(Math.max(0, eased - 0.002));
        rotation += Math.atan2(ahead[1] - behind[1], ahead[0] - behind[0]) * 180 / Math.PI * Number(path.bank);
    }
    return { x, y, rotation };
}

/**
 * Resolve a layer's full animated state at an ABSOLUTE timeline time.
 *
 * @param {object} layer a MotionLayer
 * @param {number} absoluteTime seconds on the timeline
 * @returns {{visible: boolean, x:number, y:number, scale:number, scaleX:number, scaleY:number, rotation:number,
 *            opacity:number, blur:number, glow:number, reveal:number}}
 */
export function resolveMotionAt(layer, absoluteTime, context = {}) {
    const base = {
        x:        Number.isFinite(layer?.x) ? layer.x : 50,
        y:        Number.isFinite(layer?.y) ? layer.y : 50,
        scale:    Number.isFinite(layer?.scale) ? layer.scale : 1,
        scaleX:   Number.isFinite(layer?.scaleX) ? layer.scaleX : 1,
        scaleY:   Number.isFinite(layer?.scaleY) ? layer.scaleY : 1,
        rotation: Number.isFinite(layer?.rotation) ? layer.rotation : 0,
        opacity:  Number.isFinite(layer?.opacity) ? layer.opacity : 1,
        blur:     0,
        glow:     0,
        reveal:   1,
    };

    if (!layer) return { ...base, visible: false };

    const start = Number(layer.startTime) || 0;
    const duration = Number(layer.duration) || 0;
    const end = start + duration;
    const visible = absoluteTime >= start && absoluteTime < end;

    const animations = Array.isArray(layer.animations) ? layer.animations : [];
    const layerLocal = absoluteTime - start;
    const expressions = layer.expressions && typeof layer.expressions === 'object' ? layer.expressions : {};
    const expressionLayers = Array.isArray(layer.expressionLayers) ? layer.expressionLayers : [];
    if (animations.length === 0 && !Object.keys(expressions).length && !layer.motionPath && expressionLayers.length === 0 && !layer.audioReactive) return { ...base, visible };

    // Accumulate per-property deltas according to COMPOSITION_RULES.
    const acc = {};
    for (const prop of ANIMATABLE_PROPS) acc[prop] = null;

    for (const anim of animations) {
        if (!anim) continue;
        const animDuration = Number(anim.duration) || 0;

        // 'out' animations anchor to the layer's END, so a 0.3s exit always
        // sits in the last 0.3s no matter how the clip is trimmed. Anchoring
        // exits to the start would put them in the wrong place the instant a
        // user drags a clip edge — which is exactly the kind of bug that only
        // shows up on someone else's timeline.
        const animStart = anim.anchor === 'out'
            ? Math.max(0, duration - animDuration - (Number(anim.startTime) || 0))
            : (Number(anim.startTime) || 0);

        const localTime = layerLocal - animStart;

        // Outside its window an animation still holds its terminal value —
        // a fade-in that stops contributing after it finishes would pop the
        // element back to base opacity the frame after it completes.
        const clampedLocal = clamp(localTime, 0, animDuration > 0 ? animDuration : 0);
        if (localTime < 0) {
            // Before animStart: if this is an entrance animation (anchor === 'in' and not a mid-clip event),
            // it holds its initial keyframe state so it doesn't pop on at t=0 before animating.
            if (anim.anchor === 'in' && anim.source !== 'auto-animate') {
                const sample = sampleAnimation(anim, 0);
                for (const [prop, value] of Object.entries(sample)) {
                    if (!Number.isFinite(value)) continue;
                    const rule = COMPOSITION_RULES[prop] || 'add';
                    if (acc[prop] === null) {
                        acc[prop] = value;
                    } else if (rule === 'add') {
                        acc[prop] += value;
                    } else if (rule === 'multiply') {
                        acc[prop] *= value;
                    } else if (rule === 'max') {
                        acc[prop] = Math.max(acc[prop], value);
                    } else if (rule === 'min') {
                        acc[prop] = Math.min(acc[prop], value);
                    }
                }
            }
            continue; // hasn't begun; for non-entrance animations, contributes nothing yet
        }

        const sample = sampleAnimation(anim, clampedLocal);
        for (const [prop, value] of Object.entries(sample)) {
            if (!Number.isFinite(value)) continue;
            const rule = COMPOSITION_RULES[prop] || 'add';
            if (acc[prop] === null) {
                acc[prop] = value;
            } else if (rule === 'add') {
                acc[prop] += value;
            } else if (rule === 'multiply') {
                acc[prop] *= value;
            } else if (rule === 'max') {
                acc[prop] = Math.max(acc[prop], value);
            } else if (rule === 'min') {
                acc[prop] = Math.min(acc[prop], value);
            }
        }
    }

    // Fold accumulated deltas onto the base transform.
    const out = { ...base, visible };
    for (const prop of ANIMATABLE_PROPS) {
        if (acc[prop] === null) continue;
        const rule = COMPOSITION_RULES[prop] || 'add';
        if (rule === 'add')            out[prop] = base[prop] + acc[prop];
        else if (rule === 'multiply')  out[prop] = base[prop] * acc[prop];
        else                           out[prop] = acc[prop];
    }

    const pathMotion = sampleMotionPath(layer.motionPath, layerLocal, duration);
    if (pathMotion) {
        out.x += pathMotion.x;
        out.y += pathMotion.y;
        out.rotation += pathMotion.rotation;
    }

    // Procedural expressions are deterministic functions of clip-local time.
    // They override keyframed values for the same property, making the result
    // predictable while leaving keyframes available as the authored fallback.
    const progress = duration > 0 ? clamp(layerLocal / duration, 0, 1) : 0;
    for (const prop of ANIMATABLE_PROPS) {
        if (typeof expressions[prop] !== 'string') continue;
        const value = evaluateMotionExpression(expressions[prop], {
            t: layerLocal, time: layerLocal, duration, progress, value: out[prop],
        });
        if (value !== null) out[prop] = value;
    }

    // Parent scene expressions are relative to each owning group, not the
    // flattened child's clock. Static parent transforms are already composed
    // into the child's base values by SceneSchema; apply only the live delta
    // here so child and parent animation remain additive and export samples
    // the same result as preview.
    const priorGroupTransforms = [];
    for (const expressionLayer of expressionLayers) {
        const groupDuration = Math.max(0, Number(expressionLayer.duration) || 0);
        const groupLocal = absoluteTime - (Number(expressionLayer.startTime) || 0);
        if (groupLocal < 0) continue;
        const groupProgress = groupDuration > 0 ? clamp(groupLocal / groupDuration, 0, 1) : 0;
        const evaluated = {};
        for (const [prop, expression] of Object.entries(expressionLayer.expressions || {})) {
            if (!['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation'].includes(prop) || typeof expression !== 'string') continue;
            const value = evaluateMotionExpression(expression, {
                t: groupLocal, time: groupLocal, duration: groupDuration, progress: groupProgress,
            });
            if (value !== null) evaluated[prop] = value;
        }
        const scale = Number.isFinite(evaluated.scale) ? evaluated.scale : 1;
        const scaleX = Number.isFinite(evaluated.scaleX) ? evaluated.scaleX : 1;
        const scaleY = Number.isFinite(evaluated.scaleY) ? evaluated.scaleY : 1;
        const rotation = Number.isFinite(evaluated.rotation) ? evaluated.rotation : 0;
        if (scale !== 1 || scaleX !== 1 || scaleY !== 1 || rotation !== 0) {
            const frame = { w: Number(expressionLayer.frameW) || 1920, h: Number(expressionLayer.frameH) || 1080 };
            let ox = Number(expressionLayer.originX) || 0;
            let oy = Number(expressionLayer.originY) || 0;
            for (const prior of priorGroupTransforms) {
                const dx = ((ox - prior.originX) / 100) * frame.w * prior.scale * prior.scaleX;
                const dy = ((oy - prior.originY) / 100) * frame.h * prior.scale * prior.scaleY;
                const rad = (prior.rotation * Math.PI) / 180;
                ox = prior.originX + ((dx * Math.cos(rad) - dy * Math.sin(rad)) / frame.w) * 100 + prior.x;
                oy = prior.originY + ((dx * Math.sin(rad) + dy * Math.cos(rad)) / frame.h) * 100 + prior.y;
            }
            const px = ((out.x - ox) / 100) * frame.w * scale * scaleX;
            const py = ((out.y - oy) / 100) * frame.h * scale * scaleY;
            const rad = (rotation * Math.PI) / 180;
            out.x = ox + ((px * Math.cos(rad) - py * Math.sin(rad)) / frame.w) * 100;
            out.y = oy + ((px * Math.sin(rad) + py * Math.cos(rad)) / frame.h) * 100;
            out.scale *= scale;
            out.scaleX *= scaleX;
            out.scaleY *= scaleY;
            out.rotation += rotation;
            priorGroupTransforms.push({ originX: Number(expressionLayer.originX) || 0, originY: Number(expressionLayer.originY) || 0, scale, scaleX, scaleY, rotation, x: evaluated.x || 0, y: evaluated.y || 0 });
        } else {
            priorGroupTransforms.push({ originX: Number(expressionLayer.originX) || 0, originY: Number(expressionLayer.originY) || 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, x: evaluated.x || 0, y: evaluated.y || 0 });
        }
        if (Number.isFinite(evaluated.x)) out.x += evaluated.x;
        if (Number.isFinite(evaluated.y)) out.y += evaluated.y;
    }

    // Guard against non-finite values while preserving signed scale. A negative
    // scale is a deliberate mirror transform handled by the compositor.
    out.opacity = clamp(out.opacity, 0, 1);
    out.scale   = Number.isFinite(out.scale) ? out.scale : 1;
    out.scaleX  = Number.isFinite(out.scaleX) ? out.scaleX : 1;
    out.scaleY  = Number.isFinite(out.scaleY) ? out.scaleY : 1;
    out.blur    = Math.max(0, Number.isFinite(out.blur) ? out.blur : 0);
    out.glow    = Math.max(0, Number.isFinite(out.glow) ? out.glow : 0);
    out.reveal  = clamp(out.reveal, 0, 1);
    if (!Number.isFinite(out.x)) out.x = base.x;
    if (!Number.isFinite(out.y)) out.y = base.y;
    if (!Number.isFinite(out.rotation)) out.rotation = 0;

    return applyAudioReactiveMotion(out, layer.audioReactive, layerLocal, duration, context?.audioWaveformsByAsset);
}

/**
 * Turn a resolved state into a CSS style fragment for DOM rendering.
 * Kept here (not in the component) so the Revideo scene can derive the same
 * numbers without duplicating the maths.
 *
 * @param {object} resolved output of resolveMotionAt
 * @param {object} [opts] `{ centered }` — apply the translate(-50%,-50%) that
 *                        TextOverlay uses to treat x/y as the element's CENTRE
 */
export function resolvedToCSS(resolved, opts = {}) {
    const { centered = true } = opts;
    const parts = [];
    if (centered) parts.push('translate(-50%, -50%)');
    if (resolved.x !== undefined && resolved.y !== undefined && (resolved.dx || resolved.dy)) {
        parts.push(`translate(${resolved.dx || 0}px, ${resolved.dy || 0}px)`);
    }
    if (resolved.rotation) parts.push(`rotate(${resolved.rotation}deg)`);
    parts.push(`scale(${resolved.scale}) scaleX(${resolved.scaleX ?? 1}) scaleY(${resolved.scaleY ?? 1})`);

    const filters = [];
    if (resolved.blur > 0) filters.push(`blur(${resolved.blur}px)`);

    const style = {
        transform: parts.join(' '),
        opacity: resolved.opacity,
    };
    if (filters.length > 0) style.filter = filters.join(' ');
    if (resolved.glow > 0) {
        // Layered glow reads far better than a single large shadow.
        style.textShadow = `0 0 ${resolved.glow}px currentColor, 0 0 ${resolved.glow * 2}px currentColor`;
    }
    return style;
}

export default { sampleAnimation, resolveMotionAt, resolvedToCSS };
