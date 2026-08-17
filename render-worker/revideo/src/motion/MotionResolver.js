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

    // Which properties does this animation address at all?
    const touched = new Set();
    for (const kf of kfs) {
        for (const p of Object.keys(kf.properties || {})) touched.add(p);
    }
    if (touched.size === 0) return {};

    const out = {};
    for (const prop of touched) {
        // Only keyframes that actually specify this property take part —
        // a keyframe list is usually sparse per-property.
        const track = kfs.filter(kf => kf.properties && kf.properties[prop] !== undefined);
        if (track.length === 0) continue;

        if (localTime <= track[0].time) {
            out[prop] = track[0].properties[prop];
            continue;
        }
        const last = track[track.length - 1];
        if (localTime >= last.time) {
            out[prop] = last.properties[prop];
            continue;
        }

        // Find the bracketing pair.
        let from = track[0];
        let to = last;
        for (let i = 0; i < track.length - 1; i++) {
            if (localTime >= track[i].time && localTime <= track[i + 1].time) {
                from = track[i];
                to = track[i + 1];
                break;
            }
        }

        const span = to.time - from.time;
        const progress = span > 0 ? (localTime - from.time) / span : 1;
        // Per-keyframe easing wins over the animation's default — this is what
        // lets a single "pop" animation ease in fast and settle out slowly.
        const ease = resolveEasing(to.easing || animation.easing);
        const t = ease(clamp(progress, 0, 1));
        const a = from.properties[prop];
        const b = to.properties[prop];
        out[prop] = a + (b - a) * t;
    }
    return out;
}

/**
 * Resolve a layer's full animated state at an ABSOLUTE timeline time.
 *
 * @param {object} layer a MotionLayer
 * @param {number} absoluteTime seconds on the timeline
 * @returns {{visible: boolean, x:number, y:number, scale:number, rotation:number,
 *            opacity:number, blur:number, glow:number, reveal:number}}
 */
export function resolveMotionAt(layer, absoluteTime) {
    const base = {
        x:        Number.isFinite(layer?.x) ? layer.x : 50,
        y:        Number.isFinite(layer?.y) ? layer.y : 50,
        scale:    Number.isFinite(layer?.scale) ? layer.scale : 1,
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
    const visible = absoluteTime >= start && absoluteTime <= end;

    const animations = Array.isArray(layer.animations) ? layer.animations : [];
    if (animations.length === 0) return { ...base, visible };

    // Accumulate per-property deltas according to COMPOSITION_RULES.
    const acc = {};
    for (const prop of ANIMATABLE_PROPS) acc[prop] = null;

    const layerLocal = absoluteTime - start;

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
        if (localTime < 0) continue; // hasn't begun; contributes nothing yet

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

    // Guard rails. A NaN or negative scale silently blanks the element rather
    // than erroring, which is miserable to debug from a user's screenshot.
    out.opacity = clamp(out.opacity, 0, 1);
    out.scale   = Math.max(0, Number.isFinite(out.scale) ? out.scale : 1);
    out.blur    = Math.max(0, Number.isFinite(out.blur) ? out.blur : 0);
    out.glow    = Math.max(0, Number.isFinite(out.glow) ? out.glow : 0);
    out.reveal  = clamp(out.reveal, 0, 1);
    if (!Number.isFinite(out.x)) out.x = base.x;
    if (!Number.isFinite(out.y)) out.y = base.y;
    if (!Number.isFinite(out.rotation)) out.rotation = 0;

    return out;
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
    parts.push(`scale(${resolved.scale})`);

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
