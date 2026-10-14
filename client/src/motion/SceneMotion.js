/**
 * client/src/motion/SceneMotion.js
 *
 * R95 — PHASE 3: motion that belongs to a COMPOSITION rather than to one
 * layer at a time.
 *
 * Four things a motion-graphics tool is expected to do, and none of which the
 * per-clip animation model could express:
 *
 *   1. STAGGER across a group — five bullet points arriving one after another,
 *      from one setting, not five hand-typed delays.
 *   2. PATHS — an element travelling along a curve instead of straight from A
 *      to B, with the option to bank into the turn.
 *   3. REPEAT — a loop or a ping-pong of the same move, a stated number of
 *      times or for as long as the layer lives.
 *   4. PARENTING — animate the group and everything inside follows, including
 *      ORBITING a rotating parent rather than each child spinning in place.
 *
 * ─── WHY THIS NEEDS NO RENDERER CHANGE ──────────────────────────────────────
 * All four are COMPILED INTO ORDINARY KEYFRAMES when a scene is flattened.
 * The preview's `MotionResolver` and the worker's copy of it already
 * interpolate keyframes and compose properties by the rules in
 * `MotionSchema.COMPOSITION_RULES`; a path is a sampled x/y track, a repeat is
 * the same keyframes laid down again, an orbit is an x/y track derived from
 * the parent's rotation. So preview and export get this on the same day, with
 * no new renderer concepts and no second implementation to drift.
 *
 * Everything here is pure, and every output goes back through
 * `MotionComposer.sanitizeAnimations`, so a hand-written or AI-written scene
 * cannot produce values outside the ranges the renderers trust.
 */

import { sampleAnimation } from './MotionResolver.js';
import { sanitizeAnimations, LIMITS } from './MotionComposer.js';
import { createAnimation, createKeyframe, ANIMATION_TYPES } from './MotionSchema.js';
import { pointsToBezierSpline } from './SpatialMotion.js';

/** How a stagger walks the children of a group. */
export const STAGGER_ORDERS = ['forward', 'reverse', 'centre', 'edges'];

/** Ways a repeat can play. */
export const REPEAT_MODES = ['loop', 'pingpong'];

/** Samples used when a curve has to become keyframes. Keeps under LIMITS. */
const PATH_SAMPLES = 12;
const ORBIT_SAMPLES = 10;

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round = (v, p = 3) => Math.round(num(v, 0) * 10 ** p) / 10 ** p;

/**
 * The order children take their turn in.
 * @returns {number[]} for each index, its place in the queue (0 first)
 */
export function staggerSlots(count, order = 'forward') {
    const n = Math.max(0, Math.floor(count));
    const idx = Array.from({ length: n }, (_, i) => i);
    if (n === 0) return [];
    switch (order) {
        case 'reverse':
            return idx.map(i => n - 1 - i);
        case 'centre': {
            // The middle leads, the outer pair follows, and so on.
            const mid = (n - 1) / 2;
            const ranked = [...idx].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
            const slot = new Array(n);
            ranked.forEach((i, place) => { slot[i] = place; });
            return slot;
        }
        case 'edges': {
            const mid = (n - 1) / 2;
            const ranked = [...idx].sort((a, b) => Math.abs(b - mid) - Math.abs(a - mid) || a - b);
            const slot = new Array(n);
            ranked.forEach((i, place) => { slot[i] = place; });
            return slot;
        }
        default:
            return idx;
    }
}

/**
 * Push a layer's ENTRANCE animations back by `delay`. Exits stay anchored to
 * the end, which is the point of anchoring them there: a staggered entrance
 * should not drag the exit along with it.
 */
export function delayAnimations(animations, delay, duration) {
    const d = Math.max(0, num(delay, 0));
    if (!(d > 0) || !Array.isArray(animations)) return animations || [];
    const life = Math.max(0.01, num(duration, 0));
    return animations.map(anim => {
        if (!anim || anim.anchor === 'out') return anim;
        const start = Math.min(num(anim.startTime, 0) + d, Math.max(0, life - Math.min(num(anim.duration, 0), life)));
        return { ...anim, startTime: round(start) };
    });
}

/**
 * Apply a group's stagger to its children.
 *
 * @param {Array} children scene nodes
 * @param {{stagger?:number, order?:string, max?:number}} motion the group's `motion`
 * @returns {Array} the children, with their entrances offset
 */
export function applyStagger(children, motion = {}) {
    const step = num(motion.stagger, 0);
    const list = Array.isArray(children) ? children : [];
    if (!(step > 0) || list.length < 2) return list;
    const order = STAGGER_ORDERS.includes(motion.order) ? motion.order : 'forward';
    const slots = staggerSlots(list.length, order);
    // A stagger that outruns the layers is a graphic that arrives after it has
    // gone, so the total is capped and the step shrinks to fit.
    const span = num(motion.max, 0) > 0 ? num(motion.max, 0) : step * (list.length - 1);
    const effective = list.length > 1 ? Math.min(step, span / (list.length - 1)) : 0;
    return list.map((child, i) => {
        if (!child) return child;
        const delay = slots[i] * effective;
        return { ...child, animations: delayAnimations(child.animations, delay, child.duration), meta: { ...child.meta, staggerDelay: round(delay) } };
    });
}

// ─── Paths ───────────────────────────────────────────────────────────────────

/** Catmull-Rom through the points, which gives a curve that hits each one. */
function sampleCurve(points, u) {
    const pts = points;
    const n = pts.length;
    if (n === 1) return pts[0];
    if (n === 2) {
        return [pts[0][0] + (pts[1][0] - pts[0][0]) * u, pts[0][1] + (pts[1][1] - pts[0][1]) * u];
    }
    const span = 1 / (n - 1);
    const seg = Math.min(n - 2, Math.floor(u / span));
    const t = (u - seg * span) / span;
    const p0 = pts[Math.max(0, seg - 1)];
    const p1 = pts[seg];
    const p2 = pts[seg + 1];
    const p3 = pts[Math.min(n - 1, seg + 2)];
    const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
}

/**
 * Compile a path into a translate animation.
 *
 * `points` are offsets in PERCENT of the frame from where the layer already
 * sits, so a path is relative and survives the layer being moved. The first
 * point is where it starts; a path that should begin off-frame simply starts
 * outside 0-100.
 *
 * @param {{points:Array, startTime?:number, duration?:number, easing?:string,
 *          closed?:boolean, bank?:number, spin?:number}} path
 * @param {{duration:number}} ctx the layer's life
 * @returns {object|null} an Animation, or null if there is no usable path
 */
export function compilePath(path, ctx = {}) {
    const raw = Array.isArray(path?.points) ? path.points : [];
    const points = raw
        .map(p => (Array.isArray(p) ? [num(p[0], NaN), num(p[1], NaN)] : [num(p?.x, NaN), num(p?.y, NaN)]))
        .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (points.length < 2) return null;
    if (path.closed && (points[0][0] !== points[points.length - 1][0] || points[0][1] !== points[points.length - 1][1])) {
        points.push([points[0][0], points[0][1]]);
    }

    const life = Math.max(0.01, num(ctx.duration, 3));
    const startTime = Math.max(0, Math.min(num(path.startTime, 0), life));
    const duration = Math.max(0.05, Math.min(num(path.duration, life - startTime), life - startTime));
    const samples = Math.min(LIMITS.maxKeyframes, Math.max(3, num(path.samples, PATH_SAMPLES)));
    const bank = num(path.bank, 0);
    const spin = num(path.spin, 0);

    const keyframes = [];
    const spline = (path.mode === 'bezier' || path.arcLength) ? pointsToBezierSpline(points, path.closed) : null;

    for (let i = 0; i < samples; i++) {
        const u = i / (samples - 1);
        let x, y, rot;
        if (spline) {
            const pt = spline.sampleAtNormalizedDistance(u);
            x = pt.x;
            y = pt.y;
            if (bank !== 0) {
                rot = round(pt.heading * bank, 2);
            }
        } else {
            const pt = sampleCurve(points, u);
            x = pt[0];
            y = pt[1];
            if (bank !== 0) {
                // Angle of travel, so the layer leans into the turn.
                const ahead = sampleCurve(points, Math.min(1, u + 0.02));
                const behind = sampleCurve(points, Math.max(0, u - 0.02));
                const angle = (Math.atan2(ahead[1] - behind[1], ahead[0] - behind[0]) * 180) / Math.PI;
                rot = round(angle * bank, 2);
            }
        }
        const props = { x: round(x, 2), y: round(y, 2) };
        if (rot !== undefined) props.rotation = rot;
        else if (spin !== 0) props.rotation = round(spin * u, 2);
        keyframes.push(createKeyframe(round(duration * u, 3), props));
    }

    return createAnimation({
        type: ANIMATION_TYPES.TRANSLATE,
        startTime: round(startTime),
        duration: round(duration),
        easing: path.easing || 'easeInOutCubic',
        anchor: 'in',
        presetId: 'path',
        keyframes,
    });
}

// ─── Repeat ──────────────────────────────────────────────────────────────────

/**
 * Lay an animation's keyframes down again, `times` over, inside the layer's
 * life. `pingpong` plays every other pass backwards, so a move that does not
 * return to where it started still loops cleanly.
 *
 * @param {object} animation
 * @param {{duration:number}} ctx the layer's life
 * @returns {object} the animation, repeated (or untouched when it has no repeat)
 */
export function expandRepeat(animation, ctx = {}) {
    const repeat = animation?.repeat;
    if (!repeat) return animation;
    const base = Array.isArray(animation.keyframes) ? animation.keyframes : [];
    if (base.length < 2) return animation;
    const life = Math.max(0.01, num(ctx.duration, 3));
    const cycle = Math.max(0.05, num(animation.duration, 0));
    const startTime = Math.max(0, num(animation.startTime, 0));
    const room = Math.max(0, life - startTime);
    const asked = num(repeat.times, 0);
    // "times: 0" or "infinite" means for as long as the layer lives.
    const wanted = asked > 0 ? Math.floor(asked) : Math.floor(room / cycle);
    const cycles = Math.max(1, Math.min(wanted, Math.floor(room / cycle), Math.floor(LIMITS.maxKeyframes / base.length)));
    if (cycles <= 1) {
        const { repeat: _drop, ...rest } = animation;
        return rest;
    }
    const pingpong = repeat.mode === 'pingpong';
    const span = base[base.length - 1].time - base[0].time || cycle;

    const keyframes = [];
    // A frame's worth, so a loop's snap back to the start is an instant rather
    // than a duplicate time the interpolator would have to break the tie on.
    const SEAM = 0.001;
    for (let c = 0; c < cycles; c++) {
        const backwards = pingpong && c % 2 === 1;
        const pass = backwards ? [...base].reverse() : base;
        for (let i = 0; i < pass.length; i++) {
            // A ping-pong turns round at the seam, so its first keyframe IS
            // the previous pass's last one and keeping both would stall for a
            // frame. A LOOP has to jump back to where it started, so that
            // keyframe is the whole point of the loop and is kept, a frame
            // after the seam. Skipping it made cycles 2 and 3 of a loop play
            // backwards, or freeze outright on a two-keyframe move.
            if (i === 0 && c > 0 && backwards) continue;
            const kf = pass[i];
            const local = backwards ? span - (kf.time - base[0].time) : kf.time - base[0].time;
            const seam = (i === 0 && c > 0 && !backwards) ? SEAM : 0;
            keyframes.push(createKeyframe(round(c * span + local + seam, 3), kf.properties, kf.easing));
        }
    }
    const { repeat: _used, ...rest } = animation;
    return { ...rest, duration: round(Math.min(cycle * cycles, room)), keyframes };
}

// ─── Parenting ───────────────────────────────────────────────────────────────

const POSITIONAL = new Set(['x', 'y', 'rotation']);

/**
 * Pass a group's animation down to one child.
 *
 * Opacity, scale and blur need nothing clever: the renderers already multiply
 * or take the max of what several animations say, so the parent's track is
 * simply handed to the child as well.
 *
 * Position and rotation do need care. A rotating parent should swing its
 * children AROUND ITS ORIGIN — copying the rotation onto each child would
 * spin each one where it stands, which looks nothing like the same move. So
 * for those the parent's animation is SAMPLED and the child's own orbit is
 * worked out at each sample: the result is an ordinary x/y (and rotation)
 * track that any renderer can play.
 *
 * @param {object} animation one of the parent's animations
 * @param {{offsetX:number, offsetY:number, frame:object, duration:number, parentScale?:number}} ctx
 *        the child's offset from the parent origin, in percent
 * @returns {object|null}
 */
export function inheritAnimation(animation, ctx = {}) {
    if (!animation || !Array.isArray(animation.keyframes) || animation.keyframes.length === 0) return null;
    const touched = new Set();
    for (const kf of animation.keyframes) for (const p of Object.keys(kf.properties || {})) touched.add(p);
    if (touched.size === 0) return null;

    const positional = [...touched].some(p => POSITIONAL.has(p));
    if (!positional) return { ...animation, presetId: animation.presetId || 'inherited' };

    const frame = ctx.frame && num(ctx.frame.w, 0) > 0 ? ctx.frame : { w: 1920, h: 1080 };
    const offX = num(ctx.offsetX, 0);
    const offY = num(ctx.offsetY, 0);
    const life = Math.max(0.01, num(ctx.duration, 3));
    const dur = Math.max(0.05, Math.min(num(animation.duration, life), life));
    const samples = Math.min(LIMITS.maxKeyframes, Math.max(3, num(ctx.samples, ORBIT_SAMPLES)));

    const keyframes = [];
    for (let i = 0; i < samples; i++) {
        const u = i / (samples - 1);
        const at = dur * u;
        const s = sampleAnimation(animation, at);
        const rot = num(s.rotation, 0);
        const scale = num(s.scale, 1);
        // Where the child ends up once the parent has turned and scaled.
        const px = (offX / 100) * frame.w * scale;
        const py = (offY / 100) * frame.h * scale;
        const rad = (rot * Math.PI) / 180;
        const rx = px * Math.cos(rad) - py * Math.sin(rad);
        const ry = px * Math.sin(rad) + py * Math.cos(rad);
        const props = {
            x: round(num(s.x, 0) + ((rx - px) / frame.w) * 100, 2),
            y: round(num(s.y, 0) + ((ry - py) / frame.h) * 100, 2),
        };
        if (touched.has('rotation')) props.rotation = round(rot, 2);
        keyframes.push(createKeyframe(round(at, 3), props));
    }
    return createAnimation({
        type: ANIMATION_TYPES.TRANSLATE,
        startTime: round(num(animation.startTime, 0)),
        duration: round(dur),
        easing: 'linear', // the shape of the move is already in the samples
        anchor: animation.anchor === 'out' ? 'out' : 'in',
        presetId: 'inherited',
        keyframes,
    });
}

/**
 * Everything a child's animation list should contain once its group's own
 * motion, its path and its repeats have been taken into account.
 *
 * @param {object} child a scene node
 * @param {{parentAnimations?:Array, offsetX?:number, offsetY?:number, frame:object}} ctx
 * @returns {Array} animations, sanitised and within the renderers' limits
 */
export function resolveNodeAnimations(child, ctx = {}) {
    const duration = Math.max(0.01, num(child?.duration, 0));
    const own = (Array.isArray(child?.animations) ? child.animations : []).map(a => expandRepeat(a, { duration }));
    const path = child?.path ? compilePath(child.path, { duration }) : null;
    const inherited = (Array.isArray(ctx.parentAnimations) ? ctx.parentAnimations : [])
        .map(a => inheritAnimation(a, { offsetX: ctx.offsetX, offsetY: ctx.offsetY, frame: ctx.frame, duration }))
        .filter(Boolean);

    const all = [...inherited, ...own, ...(path ? [path] : [])].slice(0, LIMITS.maxAnimations);
    // The same gate the rest of the engine trusts: ranges, ordering, limits.
    const clean = sanitizeAnimations(all, { duration, kind: child?.type === 'video' ? 'video' : 'text' });
    // `sanitizeAnimations` mints a new id for everything it passes. Flattening
    // happens on every edit once there is a scene editor, so keep the ids the
    // animations already had: a stable id makes a re-flatten a no-op instead
    // of a churn of new objects. Positional, which holds whenever nothing was
    // dropped; when something was, the new ids stand.
    if (clean.length === all.length) {
        return clean.map((a, i) => (all[i]?.id ? { ...a, id: all[i].id } : a));
    }
    return clean;
}

export default {
    STAGGER_ORDERS,
    REPEAT_MODES,
    staggerSlots,
    delayAnimations,
    applyStagger,
    compilePath,
    expandRepeat,
    inheritAnimation,
    resolveNodeAnimations,
};
