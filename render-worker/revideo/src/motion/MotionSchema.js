/**
 * render-worker/revideo/src/motion/MotionSchema.js
 *
 * SYNCED COPY of client/src/motion/MotionSchema.js — verbatim below the header divider.
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
 * client/src/motion/MotionSchema.js
 *
 * The MotionLayer / Animation / Keyframe model — PHASE 1 + PHASE 2.
 *
 * ─── HOW THIS RELATES TO THE EXISTING TIMELINE ──────────────────────────────
 * This is deliberately NOT a replacement for `client/src/timeline/
 * TimelineSchema.js`. That schema is the real, live entity store (clips,
 * layers, placements, effects) and every mutation in `useTimelineStore` goes
 * through it. Replacing it would mean rewriting `toLegacyTracks()` /
 * `fromLegacyTracks()` — the two hand-maintained projections that every
 * component in the app actually reads — and that is a migration, not a
 * feature.
 *
 * A MotionLayer is instead a VIEW over an existing clip: `ClipAdapter.js`
 * reads a legacy clip and produces one, and writes changes back as ordinary
 * clip field updates. That means:
 *   • nothing that currently reads clips changes behaviour,
 *   • no persistence migration is required,
 *   • motion data rides along on new OPTIONAL clip fields.
 *
 * The layer *kinds* below therefore include kinds the timeline cannot create
 * yet (`sticker`, `shape`). That is intentional: the model is complete, and
 * the renderer catches up. A kind with no renderer simply resolves to nothing
 * rather than throwing — see MotionResolver.
 *
 * ─── TIME IS LAYER-LOCAL ────────────────────────────────────────────────────
 * Every `time` inside an Animation or Keyframe is SECONDS FROM THE LAYER'S
 * OWN START, not absolute timeline time. This matches how `clip.keyframes`
 * already works (VideoPlayer interpolates against clip-local time) and it is
 * the only choice that survives a clip being dragged along the timeline —
 * absolute times would silently desynchronise on every move.
 */

import { clamp } from './Easing.js';

/** Layer kinds. Superset of the timeline's CLIP_TYPES — see file header. */
export const LAYER_KINDS = {
    CAPTION: 'caption',
    TEXT:    'text',
    IMAGE:   'image',
    VIDEO:   'video',
    STICKER: 'sticker',
    SHAPE:   'shape',
};

/** Animated channels. Each maps to something a renderer can actually apply. */
export const ANIMATION_TYPES = {
    FADE:      'fade',
    SCALE:     'scale',
    TRANSLATE: 'translate',
    ROTATE:    'rotate',
    BLUR:      'blur',
    GLOW:      'glow',
    /** Progressive content reveal (typewriter / word-by-word / mask wipe). */
    REVEAL:    'reveal',
};

/**
 * The animatable properties a keyframe may carry.
 * `reveal` is 0..1 and drives content reveal rather than a CSS transform.
 */
export const ANIMATABLE_PROPS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity', 'blur', 'glow', 'reveal'];

/**
 * How each property composes when several animations touch it at once.
 * Getting this wrong is subtle and ugly: two animations that each halve
 * opacity should give 0.25, but two that each nudge x by 10px should give 20.
 */
export const COMPOSITION_RULES = {
    x:        'add',
    y:        'add',
    rotation: 'add',
    scale:    'multiply',
    scaleX:   'multiply',
    scaleY:   'multiply',
    opacity:  'multiply',
    blur:     'max',
    glow:     'max',
    reveal:   'min',
};

/** Neutral value per property — what "this animation isn't affecting me" means. */
export const IDENTITY = Object.freeze({
    x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, blur: 0, glow: 0, reveal: 1,
});

let _seq = 0;
/**
 * ID generator. Deliberately NOT Date.now()-only: `addCaptionClips` builds
 * dozens of clips inside one millisecond, and a same-ms collision produced
 * duplicate React keys. A monotonic counter makes that impossible.
 */
function nextId(prefix) {
    _seq += 1;
    return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

/**
 * Create a keyframe.
 * @param {number} time seconds from the ANIMATION's start
 * @param {object} properties subset of ANIMATABLE_PROPS
 * @param {string} [easing] overrides the parent animation's easing
 */
export function createKeyframe(time, properties = {}, easing, easingByProperty) {
    const props = {};
    for (const key of ANIMATABLE_PROPS) {
        if (properties[key] !== undefined && Number.isFinite(Number(properties[key]))) {
            props[key] = Number(properties[key]);
        }
    }
    const perPropertyEasing = easingByProperty && typeof easingByProperty === 'object'
        ? Object.fromEntries(ANIMATABLE_PROPS
            .filter(key => props[key] !== undefined && typeof easingByProperty[key] === 'string')
            .map(key => [key, easingByProperty[key]]))
        : {};
    return {
        time: Math.max(0, Number(time) || 0),
        properties: props,
        ...(easing ? { easing } : {}),
        ...(Object.keys(perPropertyEasing).length ? { easingByProperty: perPropertyEasing } : {}),
    };
}

/**
 * Create an animation.
 * Keyframes are sorted on construction so the resolver can binary-walk them
 * without re-sorting every frame.
 */
export function createAnimation(overrides = {}) {
    const keyframes = Array.isArray(overrides.keyframes) ? [...overrides.keyframes] : [];
    keyframes.sort((a, b) => (a.time || 0) - (b.time || 0));
    return {
        id:        overrides.id || nextId('anim'),
        type:      overrides.type || ANIMATION_TYPES.FADE,
        startTime: Math.max(0, Number(overrides.startTime) || 0),
        duration:  Math.max(0, Number(overrides.duration) || 0),
        easing:    overrides.easing || 'easeOutCubic',
        /** 'in' anchors to layer start, 'out' anchors to layer END. */
        anchor:    overrides.anchor === 'out' ? 'out' : 'in',
        presetId:  overrides.presetId || null,
        keyframes,
    };
}

/**
 * Create a motion layer.
 * `endTime` is stored as well as `duration` because the proposal's interface
 * uses endTime while the whole existing timeline uses start+duration. Keeping
 * both, derived from whichever was supplied, avoids a migration and means
 * neither convention has to lose.
 */
export function createMotionLayer(overrides = {}) {
    const startTime = Math.max(0, Number(overrides.startTime) || 0);
    const duration = Number.isFinite(Number(overrides.duration))
        ? Math.max(0, Number(overrides.duration))
        : Math.max(0, (Number(overrides.endTime) || 0) - startTime);

    return {
        id:        overrides.id || nextId('layer'),
        /** The clip/placement this layer is a view of, when adapted. */
        sourceId:  overrides.sourceId || null,
        trackId:   overrides.trackId || null,
        kind:      overrides.kind || LAYER_KINDS.TEXT,
        name:      overrides.name || 'Layer',

        startTime,
        duration,
        endTime:   startTime + duration,

        // Base transform. Position is in PERCENT of frame (0-100), matching
        // clip.x / clip.y and TextOverlay's `left: {x}%` — NOT pixels.
        x:        Number.isFinite(Number(overrides.x)) ? Number(overrides.x) : 50,
        y:        Number.isFinite(Number(overrides.y)) ? Number(overrides.y) : 50,
        scale:    Number.isFinite(Number(overrides.scale)) ? Number(overrides.scale) : 1,
        scaleX:   Number.isFinite(Number(overrides.scaleX)) ? Number(overrides.scaleX) : 1,
        scaleY:   Number.isFinite(Number(overrides.scaleY)) ? Number(overrides.scaleY) : 1,
        rotation: Number.isFinite(Number(overrides.rotation)) ? Number(overrides.rotation) : 0,
        opacity:  Number.isFinite(Number(overrides.opacity)) ? clamp(overrides.opacity, 0, 1) : 1,

        animations: Array.isArray(overrides.animations) ? overrides.animations : [],
        /** Asset-keyed amplitude modulation sampled by the shared resolver. */
        audioReactive: overrides.audioReactive && typeof overrides.audioReactive === 'object' && !Array.isArray(overrides.audioReactive)
            ? { ...overrides.audioReactive } : null,
        /** Layer-local motion path in frame-percent offsets from base x/y. */
        motionPath: overrides.motionPath && Array.isArray(overrides.motionPath.points)
            ? { ...overrides.motionPath, points: overrides.motionPath.points.map(point => Array.isArray(point) ? [...point] : point && typeof point === 'object' ? { ...point } : point) }
            : null,
        expressions: overrides.expressions && typeof overrides.expressions === 'object' && !Array.isArray(overrides.expressions) ? { ...overrides.expressions } : {},
        expressionLayers: Array.isArray(overrides.expressionLayers) ? overrides.expressionLayers
            .filter(layer => layer && Number.isFinite(Number(layer.startTime)) && layer.expressions && typeof layer.expressions === 'object')
            .map(layer => ({
                startTime: Number(layer.startTime), duration: Math.max(0, Number(layer.duration) || 0),
                ...(Number.isFinite(Number(layer.originX)) ? { originX: Number(layer.originX) } : {}),
                ...(Number.isFinite(Number(layer.originY)) ? { originY: Number(layer.originY) } : {}),
                ...(Number.isFinite(Number(layer.frameW)) ? { frameW: Number(layer.frameW) } : {}),
                ...(Number.isFinite(Number(layer.frameH)) ? { frameH: Number(layer.frameH) } : {}),
                expressions: { ...layer.expressions },
            })) : [],
        style:      overrides.style && typeof overrides.style === 'object' ? overrides.style : {},

        /** Caption-only: per-word timings. See CaptionModel.js. */
        words:      Array.isArray(overrides.words) ? overrides.words : null,
        content:    overrides.content ?? '',
    };
}

/**
 * Validate a motion layer. Returns `{ valid, errors }` — never throws.
 * Used by the regression test and by ClipAdapter before writing back.
 */
export function validateMotionLayer(layer) {
    const errors = [];
    if (!layer || typeof layer !== 'object') return { valid: false, errors: ['layer must be an object'] };
    if (!layer.id) errors.push('layer must have an id');
    if (!Object.values(LAYER_KINDS).includes(layer.kind)) errors.push(`invalid layer kind: ${layer.kind}`);
    if (!Number.isFinite(layer.startTime) || layer.startTime < 0) errors.push('startTime must be a non-negative number');
    if (!Number.isFinite(layer.duration) || layer.duration < 0) errors.push('duration must be a non-negative number');
    if (!Array.isArray(layer.animations)) errors.push('animations must be an array');
    for (const property of ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity']) {
        // Missing transform channels use identity defaults in the resolver;
        // reject only authored values that would poison those calculations.
        if (layer[property] !== undefined && !Number.isFinite(layer[property])) errors.push(`${property} must be a finite number`);
    }
    if (layer.motionPath) {
        const path = layer.motionPath;
        const points = Array.isArray(path.points) ? path.points : [];
        if (points.length < 2) errors.push('motionPath must have at least two points');
        points.forEach((point, index) => {
            const x = Array.isArray(point) ? point[0] : point?.x;
            const y = Array.isArray(point) ? point[1] : point?.y;
            if (!Number.isFinite(x) || !Number.isFinite(y)) errors.push(`motionPath.points[${index}] must contain finite x and y coordinates`);
        });
        for (const property of ['startTime', 'duration']) {
            if (path[property] !== undefined && (!Number.isFinite(path[property]) || path[property] < 0)) errors.push(`motionPath.${property} must be a non-negative number`);
        }
        if (path.bank !== undefined && !Number.isFinite(path.bank)) errors.push('motionPath.bank must be a finite number');
        if (path.spin !== undefined && !Number.isFinite(path.spin)) errors.push('motionPath.spin must be a finite number');
    }

    const animationIds = new Set();
    (layer.animations || []).forEach((anim, i) => {
        if (anim?.id && animationIds.has(anim.id)) errors.push(`animations[${i}]: duplicate animation id "${anim.id}"`);
        if (anim?.id) animationIds.add(anim.id);
        if (!Object.values(ANIMATION_TYPES).includes(anim?.type)) {
            errors.push(`animations[${i}]: invalid type "${anim?.type}"`);
        }
        if (!Number.isFinite(anim?.startTime) || anim.startTime < 0) errors.push(`animations[${i}]: startTime must be a non-negative number`);
        if (!Number.isFinite(anim?.duration) || anim.duration < 0) errors.push(`animations[${i}]: duration must be a non-negative number`);
        if (!Array.isArray(anim?.keyframes) || anim.keyframes.length === 0) {
            errors.push(`animations[${i}]: must have at least one keyframe`);
        }
        (anim?.keyframes || []).forEach((kf, k) => {
            if (!Number.isFinite(kf?.time) || kf.time < 0) {
                errors.push(`animations[${i}].keyframes[${k}]: time must be a non-negative number`);
            }
            const propKeys = Object.keys(kf?.properties || {});
            if (propKeys.length === 0) {
                errors.push(`animations[${i}].keyframes[${k}]: has no animatable properties`);
            }
            for (const p of propKeys) {
                if (!ANIMATABLE_PROPS.includes(p)) {
                    errors.push(`animations[${i}].keyframes[${k}]: unknown property "${p}"`);
                } else if (!Number.isFinite(kf.properties[p])) {
                    errors.push(`animations[${i}].keyframes[${k}].properties.${p} must be a finite number`);
                }
            }
        });
    });

    return { valid: errors.length === 0, errors };
}

export default {
    LAYER_KINDS,
    ANIMATION_TYPES,
    ANIMATABLE_PROPS,
    COMPOSITION_RULES,
    IDENTITY,
    createKeyframe,
    createAnimation,
    createMotionLayer,
    validateMotionLayer,
};
