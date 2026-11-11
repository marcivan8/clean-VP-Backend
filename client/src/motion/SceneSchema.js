/**
 * client/src/motion/SceneSchema.js
 *
 * R94 — PHASE 1: the design-scene model.
 *
 * ─── WHAT THIS IS, AND WHAT IT IS NOT ───────────────────────────────────────
 * A Scene is a structured, EDITABLE description of a designed graphic: nested
 * groups, text with a real box, vector shapes, images, masks, effects and
 * constraints, with motion attached per node. It is what a title sequence or a
 * stat callout IS, rather than the flat list of clip fields it currently
 * becomes.
 *
 * It does NOT replace two things, on purpose:
 *   • `timeline/TimelineSchema.js` — still the only live entity store. Every
 *     mutation still goes through it. A Scene FLATTENS into ordinary clips
 *     (`flattenScene`), so preview, export, undo, drag and persistence all
 *     keep working with no migration.
 *   • `MotionSchema.js` — still the Animation/Keyframe model. A node's
 *     `animations` array is exactly that shape, so `MotionResolver` resolves a
 *     flattened node with no changes.
 *
 * The pair that makes this safe is `sceneFromPlacements` / `flattenScene`:
 * today's `ComponentLibrary` output lifts INTO a scene and flattens back to
 * the same clips. Phase 2 can then author scenes directly and nothing
 * downstream has to move at the same time.
 *
 * ─── COORDINATE SPACE ───────────────────────────────────────────────────────
 * Positions are PERCENT of the frame (0-100), matching `clip.x` / `clip.y` and
 * TextOverlay's `left: {x}%`. Sizes and font sizes are REFERENCE PIXELS, the
 * frame given by `utils/playerDimensions.js` (1080x1920 for 9:16), matching
 * `clip.fontSize` and `templateSize()`.
 *
 * A node's transform is LOCAL, relative to its parent:
 *   • a top-level node's x/y is its position in the frame — identical to a clip,
 *     which is why lifting existing placements is lossless;
 *   • a GROUP's x/y is the group's ORIGIN in its parent's space, and its
 *     children's x/y are OFFSETS from that origin.
 * So a group at (0,0) with scale 1 is the identity: children keep absolute
 * percent. That is the shape `sceneFromPlacements` produces.
 *
 * Percent is anisotropic — one percent of x is a different number of pixels
 * from one percent of y — so composing a ROTATION has to go through pixels.
 * `frame.w/h` is stored on the scene for exactly that reason; getting it wrong
 * silently skews every rotated group.
 *
 * ─── TIME ───────────────────────────────────────────────────────────────────
 * `node.start` / `node.duration` are seconds from the SCENE's start. Times
 * inside an animation stay layer-local (see MotionSchema's header), so a node
 * can be moved in time without rewriting its motion.
 */

import { clamp } from './Easing.js';
import { ANIMATABLE_PROPS } from './MotionSchema.js';
import { applyStagger, resolveNodeAnimations, resolveGroupAnimations } from './SceneMotion.js';

/** Bumped whenever a stored scene needs `migrateScene` to touch it. */
export const SCENE_SCHEMA_VERSION = 1;

export const NODE_TYPES = {
    GROUP:   'group',
    COMPOSITION: 'composition',
    TEXT:    'text',
    SHAPE:   'shape',
    IMAGE:   'image',
    VIDEO:   'video',
    STICKER: 'sticker',
    CAPTION: 'caption',
};

const NODE_TYPE_LIST = Object.values(NODE_TYPES);
export const MAX_SCENE_DEPTH = 8;

function animationWithoutOpacity(animation) {
    if (!animation || !Array.isArray(animation.keyframes)) return animation;
    const keyframes = animation.keyframes.map(keyframe => {
        const properties = { ...(keyframe?.properties || {}) };
        delete properties.opacity;
        return { ...keyframe, properties };
    }).filter(keyframe => Object.keys(keyframe.properties || {}).length > 0);
    return keyframes.length ? { ...animation, keyframes } : null;
}

function animationHasOpacity(animation) {
    return (animation?.keyframes || []).some(keyframe => Object.prototype.hasOwnProperty.call(keyframe?.properties || {}, 'opacity'));
}

/** Node types that hold children. Only groups, for now. */
export const CONTAINER_TYPES = [NODE_TYPES.GROUP, NODE_TYPES.COMPOSITION];

/** How a node is pinned when the frame changes shape (Phase 2 layout). */
export const PINS = { START: 'start', CENTRE: 'centre', END: 'end' };

/** Blend modes supported by scene/vector preview and timeline export. */
export const BLEND_MODE_KINDS = Object.freeze([
    'source-over', 'multiply', 'screen', 'darken', 'lighten', 'difference',
    'addition', 'overlay', 'color-dodge', 'color-burn', 'hard-light',
    'soft-light', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);
const BLEND_MODE_SET = new Set(BLEND_MODE_KINDS);

/** Effects declared across the graphic-layer and footage-overlay renderers. */
export const EFFECT_KINDS = [
    'shadow', 'glow', 'blur', 'blur_gaussian', 'blur_radial', 'blur_motion', 'shake', 'fade_in', 'fade_out',
    'grain', 'film_grain', 'gradient-fill', 'stroke', 'inner-shadow',
    'brightness', 'contrast', 'saturation', 'saturate', 'hue', 'hue-rotate',
    'chromatic-aberration', 'rgb_split', 'motion-blur', 'distortion', 'vignette',
    'glitch', 'color_grade',
];

/** Mask kinds. `node` masks by another node's box, `shape` by a template. */
export const MASK_KINDS = ['node', 'shape', 'matte'];

const DEFAULT_FRAME = { aspectRatio: '16:9', w: 1920, h: 1080 };

/**
 * An overlay clip (template, image, sticker) is drawn at this fraction of the
 * FRAME WIDTH times `clip.scale`, with its height following its own aspect —
 * not at its pixel size. The same number lives in `Compositor.js`
 * (resolveGeometry) and `Player/GraphicOverlay.jsx`; all three must agree or
 * the box this module reports is not the box the user sees.
 */
export const OVERLAY_WIDTH_FRACTION = 0.25;

/** Reference frame for an aspect ratio. Mirrors utils/playerDimensions.js. */
export function frameForAspect(aspectRatio) {
    switch (aspectRatio) {
        case '9:16': return { aspectRatio, w: 1080, h: 1920 };
        case '1:1':  return { aspectRatio, w: 1080, h: 1080 };
        case '4:3':  return { aspectRatio, w: 1440, h: 1080 };
        case '4:5':  return { aspectRatio, w: 1080, h: 1350 };
        case '21:9': return { aspectRatio, w: 2560, h: 1080 };
        case '16:9': return { aspectRatio, w: 1920, h: 1080 };
        default:     return { ...DEFAULT_FRAME, aspectRatio: aspectRatio || DEFAULT_FRAME.aspectRatio };
    }
}

let _seq = 0;
/**
 * Monotonic id. Not Date.now() alone: a scene builds every node inside one
 * millisecond, and same-ms collisions produced duplicate React keys before
 * (see MotionSchema's nextId).
 */
export function nextNodeId(prefix = 'node') {
    _seq += 1;
    return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Types drawn on an overlay track, which share the width-fraction geometry. */
export function isOverlayType(type) {
    return type === NODE_TYPES.SHAPE || type === NODE_TYPES.IMAGE || type === NODE_TYPES.STICKER || type === NODE_TYPES.VIDEO;
}

/** The identity transform: the scene root's own space. */
export const IDENTITY_TRANSFORM = Object.freeze({ x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 });

export function createTransform(overrides = {}) {
    return {
        x:        num(overrides.x, 50),
        y:        num(overrides.y, 50),
        // Signed scales are intentional: a negative axis mirrors the node.
        // The compositor handles the mirror while geometry uses its magnitude.
        scale:    num(overrides.scale, 1),
        scaleX:   num(overrides.scaleX, 1),
        scaleY:   num(overrides.scaleY, 1),
        rotation: num(overrides.rotation, 0),
        opacity:  clamp(num(overrides.opacity, 1), 0, 1),
    };
}

/**
 * Create a scene node.
 * Unknown keys are kept under `meta` rather than dropped, so a newer field
 * written by a later phase survives a round trip through an older build.
 */
export function createNode(type, overrides = {}) {
    const t = NODE_TYPE_LIST.includes(type) ? type : NODE_TYPES.TEXT;
    const isContainer = CONTAINER_TYPES.includes(t);
    return {
        id:   overrides.id || nextNodeId(t),
        type: t,
        name: overrides.name || t.charAt(0).toUpperCase() + t.slice(1),

        start:    Math.max(0, num(overrides.start, 0)),
        duration: Math.max(0, num(overrides.duration, 0)),

        transform: createTransform(overrides.transform || overrides),

        /** Layout box in reference px. null means "as big as the content is". */
        size: overrides.size && num(overrides.size.w, 0) > 0 && num(overrides.size.h, 0) > 0
            ? { w: num(overrides.size.w, 0), h: num(overrides.size.h, 0) }
            : null,

        /** Paint: fontFamily, fontSize, fontWeight, color, align, lineHeight, tracking, fill, stroke, shadow. */
        style: overrides.style && typeof overrides.style === 'object' ? { ...overrides.style } : {},

        /** Text content (text/caption nodes). */
        content: overrides.content ?? '',
        /** Advanced Typography: Multi-style runs and character motion. */
        runs: Array.isArray(overrides.runs) ? overrides.runs.map(r => ({ ...r })) : null,
        charAnim: overrides.charAnim && typeof overrides.charAnim === 'object' ? { ...overrides.charAnim } : null,
        /** SVG path followed by rich-text glyphs during canvas rendering. */
        textPath: overrides.textPath && typeof overrides.textPath === 'object' ? { ...overrides.textPath } : null,
        /** Per-word timings for a caption node. See CaptionModel.js. */
        words: Array.isArray(overrides.words) ? overrides.words : null,

        /**
         * R107 — a text node whose content cycles through alternatives
         * ("Made for Reels / Shorts / TikTok").
         *
         *   alternatives  the words, in order. Two or more makes it a cycle.
         *   slotWidth     reference px reserved for the slot, measured from
         *                 the WIDEST alternative. Without it the slot is
         *                 sized by whichever word is in it and everything
         *                 beside it jumps on every swap, which is why
         *                 SceneValidator auto-fixes a missing value rather
         *                 than only reporting it (TextCraft.swapSlotWidth).
         *   dwell         seconds per word. 0 shares the duration evenly.
         */
        alternatives: Array.isArray(overrides.alternatives)
            ? overrides.alternatives.map(w => String(w == null ? '' : w)).filter(w => w.trim().length > 0)
            : null,
        slotWidth: num(overrides.slotWidth, 0) > 0 ? num(overrides.slotWidth, 0) : null,
        dwell: num(overrides.dwell, 0) > 0 ? num(overrides.dwell, 0) : null,

        /** Shape nodes: `{ kind, params }` for TemplateGraphics.drawTemplate or vector definition. */
        vector: overrides.vector && typeof overrides.vector === 'object' ? { ...overrides.vector } : null,
        template: overrides.template && overrides.template.kind
            ? { kind: String(overrides.template.kind), params: { ...(overrides.template.params || {}) } }
            : null,

        /** Image/video nodes: where the pixels come from. */
        source: overrides.source && typeof overrides.source === 'object' ? { ...overrides.source } : null,

        /** `{ kind, nodeId?, template?, invert? }`. */
        mask: overrides.mask && overrides.mask.kind ? { ...overrides.mask } : null,

        /** Temporal shutter sampling for 2D graphic layers. */
        motionBlur: overrides.motionBlur && typeof overrides.motionBlur === 'object'
            ? {
                enabled: !!overrides.motionBlur.enabled,
                samples: Math.max(2, Math.min(15, Math.round(num(overrides.motionBlur.samples, 5)))),
                shutterAngle: Math.max(0, Math.min(360, num(overrides.motionBlur.shutterAngle, 180))),
                frameRate: Math.max(1, Math.min(120, num(overrides.motionBlur.frameRate, 30))),
            }
            : null,

        /** Canvas/FFmpeg compositing mode. `source-over` is the default. */
        blendMode: BLEND_MODE_SET.has(overrides.blendMode)
            ? overrides.blendMode : 'source-over',
        /** Per-layer cast shadow used by the timeline overlay renderer. */
        shadow: overrides.shadow && typeof overrides.shadow === 'object' ? { ...overrides.shadow } : null,

        /** `[{ kind, params }]`. Unknown kinds are reported by SceneValidator. */
        effects: Array.isArray(overrides.effects) ? overrides.effects.filter(e => e && (e.kind || e.type)).map(e => ({
            ...e,
            kind: String(e.kind || e.type),
            params: { ...(e.params || {}) },
            ...(e.enabled !== undefined ? { enabled: !!e.enabled } : {}),
        })) : [],

        /** Layout intent: `{ pinX, pinY, keepInSafeArea, maxWidthFrac }`. */
        constraints: overrides.constraints && typeof overrides.constraints === 'object' ? { ...overrides.constraints } : {},

        /** MotionSchema Animation[]. Layer-local times. */
        animations: Array.isArray(overrides.animations) ? overrides.animations : [],
        expressions: overrides.expressions && typeof overrides.expressions === 'object' && !Array.isArray(overrides.expressions) ? { ...overrides.expressions } : {},

        /**
         * R95 PHASE 3 — a curve this node travels, as percent offsets:
         * `{ points, startTime, duration, easing, closed, bank, spin }`.
         * Compiled into an ordinary x/y keyframe track when the scene is
         * flattened (SceneMotion.compilePath), so no renderer learns a new
         * concept.
         */
        path: overrides.path && Array.isArray(overrides.path.points) ? { ...overrides.path } : null,

        /**
         * R95 PHASE 3 — group-level motion: `{ stagger, order, max }`. The
         * children's entrances are offset from this one setting instead of
         * each carrying a hand-typed delay. A group's own `animations` are
         * inherited by its children, which is what makes animating a group
         * move everything inside it.
         */
        motion: overrides.motion && typeof overrides.motion === 'object' ? { ...overrides.motion } : null,

        children: isContainer && Array.isArray(overrides.children) ? overrides.children : [],

        locked: !!overrides.locked,
        hidden: !!overrides.hidden,

        /** Where this node came from: `{ componentId, presetId, role, clipId, trackType }`. */
        origin: overrides.origin && typeof overrides.origin === 'object' ? { ...overrides.origin } : null,

        meta: overrides.meta && typeof overrides.meta === 'object' ? { ...overrides.meta } : {},
    };
}

/** A group node. Its x/y is the origin its children are offset from. */
export function createGroup(overrides = {}) {
    return createNode(NODE_TYPES.GROUP, {
        name: 'Group',
        // A group defaults to the identity so lifted flat content keeps absolute percent.
        transform: createTransform({ x: 0, y: 0, ...(overrides.transform || {}) }),
        ...overrides,
        type: NODE_TYPES.GROUP,
    });
}

/** A nested composition: a timed, editable precomposition in its parent scene. */
export function createComposition(overrides = {}) {
    return createNode(NODE_TYPES.COMPOSITION, {
        name: 'Composition',
        transform: createTransform({ x: 0, y: 0, ...(overrides.transform || {}) }),
        ...overrides,
        type: NODE_TYPES.COMPOSITION,
    });
}

/** Wrap one existing layer in a same-frame composition without changing its timing or transform. */
export function wrapNodeInComposition(scene, nodeId) {
    const entry = findNode(scene, nodeId);
    if (!entry || CONTAINER_TYPES.includes(entry.node.type)) return scene;
    const path = entry.path;
    const wrap = (nodes, depth = 0) => (nodes || []).map((node, index) => {
        if (depth === path.length - 1 && index === path[depth]) {
            const child = { ...node, start: 0 };
            return createComposition({
                name: `${node.name || 'Layer'} Composition`,
                start: node.start,
                duration: Math.max(0.01, num(node.duration, 1)),
                children: [child],
            });
        }
        if (depth < path.length - 1 && index === path[depth] && Array.isArray(node.children)) {
            return { ...node, children: wrap(node.children, depth + 1) };
        }
        return node;
    });
    return { ...scene, nodes: wrap(scene.nodes) };
}

export function createScene(overrides = {}) {
    const frame = overrides.frame && num(overrides.frame.w, 0) > 0
        ? { aspectRatio: overrides.frame.aspectRatio || DEFAULT_FRAME.aspectRatio, w: num(overrides.frame.w, 1920), h: num(overrides.frame.h, 1080) }
        : frameForAspect(overrides.aspectRatio);
    const nodes = Array.isArray(overrides.nodes) ? overrides.nodes : [];
    return {
        schemaVersion: SCENE_SCHEMA_VERSION,
        id:    overrides.id || nextNodeId('scene'),
        name:  overrides.name || 'Scene',
        frame,
        duration: Math.max(0, num(overrides.duration, 0)) || sceneContentDuration(nodes),
        nodes,
        /** `{ componentId, presetId, brief, palette, styleKey, ... }` — the art direction that produced it. */
        meta: overrides.meta && typeof overrides.meta === 'object' ? { ...overrides.meta } : {},
    };
}

/** The furthest point any node reaches, in seconds. */
export function sceneContentDuration(nodes) {
    const visit = (list, offset, limit = Infinity, ancestors = new WeakSet(), depth = 0) => {
        let end = 0;
        if (depth > MAX_SCENE_DEPTH) return end;
        for (const n of list || []) {
            if (!n) continue;
            // Scene data is normally JSON, but callers can construct scenes in
            // memory. A malformed parent/child cycle must not recurse forever.
            if (typeof n === 'object' && ancestors.has(n)) continue;
            if (typeof n === 'object') ancestors.add(n);
            const s = offset + Math.max(0, num(n.start, 0));
            end = Math.max(end, Math.min(limit, s + Math.max(0, num(n.duration, 0))));
            if (Array.isArray(n.children) && n.children.length) {
                const childLimit = n.type === NODE_TYPES.COMPOSITION ? Math.min(limit, s + Math.max(0, num(n.duration, 0))) : limit;
                end = Math.max(end, visit(n.children, s, childLimit, ancestors, depth + 1));
            }
            if (typeof n === 'object') ancestors.delete(n);
        }
        return end;
    };
    return Math.round(visit(nodes, 0) * 1000) / 1000;
}

// ─── Normalisation and migration ─────────────────────────────────────────────

function normalizeAnimations(animations) {
    if (!Array.isArray(animations)) return [];
    return animations
        .filter(a => a && typeof a === 'object' && Array.isArray(a.keyframes) && a.keyframes.length > 0)
        .map(a => {
            const keyframes = a.keyframes
                .filter(k => k && Number.isFinite(Number(k.time)))
                .map(k => {
                    const props = {};
                    for (const p of ANIMATABLE_PROPS) {
                        if (k.properties?.[p] !== undefined && Number.isFinite(Number(k.properties[p]))) props[p] = Number(k.properties[p]);
                    }
                    return { ...k, time: Math.max(0, Number(k.time)), properties: props };
                })
                .filter(k => Object.keys(k.properties).length > 0)
                .sort((x, y) => x.time - y.time);
            return {
                ...a,
                startTime: Math.max(0, num(a.startTime, 0)),
                duration: Math.max(0, num(a.duration, 0)),
                anchor: a.anchor === 'out' ? 'out' : 'in',
                easing: a.easing || 'easeOutCubic',
                keyframes,
            };
        })
        .filter(a => a.keyframes.length > 0);
}

function normalizeNode(raw, seen, ancestors = new WeakSet(), depth = 0) {
    if (!raw || typeof raw !== 'object') return null;
    if (depth > MAX_SCENE_DEPTH) return null;
    // Drop only the cyclic edge; valid siblings and the rest of the scene are
    // retained so one corrupt in-memory node cannot take down scene recovery.
    if (ancestors.has(raw)) return null;
    ancestors.add(raw);
    const node = createNode(raw.type, raw);
    // Duplicate ids break React keys and node lookup; the second one is renamed.
    if (seen.has(node.id)) node.id = nextNodeId(node.type);
    seen.add(node.id);
    node.animations = normalizeAnimations(raw.animations);
    node.children = CONTAINER_TYPES.includes(node.type) && Array.isArray(raw.children)
        ? raw.children.map(c => normalizeNode(c, seen, ancestors, depth + 1)).filter(Boolean)
        : [];
    // A group with no stated life covers its children.
    if (CONTAINER_TYPES.includes(node.type) && !(node.duration > 0) && node.children.length) {
        node.duration = sceneContentDuration(node.children);
    }
    ancestors.delete(raw);
    return node;
}

/** Bring a stored scene up to the current version. Never throws. */
export function migrateScene(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const version = num(raw.schemaVersion, 0);
    let scene = raw;
    if (version < 1) {
        // Pre-version scenes: a bare `{ nodes }` or `{ layers }` bag.
        scene = { ...raw, schemaVersion: 1, nodes: Array.isArray(raw.nodes) ? raw.nodes : (Array.isArray(raw.layers) ? raw.layers : []) };
    }
    if (num(scene.schemaVersion, 0) > SCENE_SCHEMA_VERSION) {
        // Written by a newer build: keep what is understood rather than refuse.
        console.warn(`[SceneSchema] scene "${scene.id}" is version ${scene.schemaVersion}, this build reads ${SCENE_SCHEMA_VERSION}`);
    }
    return scene;
}

/**
 * Fill defaults, clamp values, drop what cannot be rendered, make ids unique.
 * Idempotent: normalising a normalised scene changes nothing.
 */
export function normalizeScene(raw) {
    const migrated = migrateScene(raw);
    if (!migrated) return null;
    const seen = new Set();
    const nodes = (Array.isArray(migrated.nodes) ? migrated.nodes : []).map(n => normalizeNode(n, seen)).filter(Boolean);
    return createScene({ ...migrated, nodes, duration: num(migrated.duration, 0) });
}

// ─── Reading a scene ─────────────────────────────────────────────────────────

/**
 * Depth-first walk. `fn(node, ctx)` where ctx is
 * `{ parent, depth, path, absoluteStart }`. Returning false skips children.
 */
export function walkScene(scene, fn) {
    if (!scene || typeof fn !== 'function') return;
    const visit = (list, parent, depth, path, offset, ancestors = new WeakSet()) => {
        for (let i = 0; i < (list || []).length; i++) {
            const node = list[i];
            if (!node) continue;
            const cycle = typeof node === 'object' && ancestors.has(node);
            const nodePath = [...path, i];
            const absoluteStart = offset + Math.max(0, num(node.start, 0));
            const go = fn(node, { parent, depth, path: nodePath, absoluteStart, cycle });
            if (!cycle && depth <= MAX_SCENE_DEPTH && go !== false && Array.isArray(node.children) && node.children.length) {
                ancestors.add(node);
                visit(node.children, node, depth + 1, nodePath, absoluteStart, ancestors);
                ancestors.delete(node);
            }
        }
    };
    visit(scene.nodes, null, 0, [], 0);
}

export function findNode(scene, nodeId) {
    let found = null;
    walkScene(scene, (node, ctx) => {
        if (found) return false;
        if (node.id === nodeId) { found = { node, ...ctx }; return false; }
        return true;
    });
    return found;
}

/** Every node, flat, with its context. Handy for validation and panels. */
export function listNodes(scene) {
    const out = [];
    walkScene(scene, (node, ctx) => { out.push({ node, ...ctx }); });
    return out;
}

/** Immutably patch one node. Returns a new scene (the same one if not found). */
export function updateNode(scene, nodeId, patch) {
    if (!scene || !nodeId) return scene;
    let hit = false;
    const visit = (list, ancestors = new Set()) => (list || []).flatMap(n => {
        if (!n) return [n];
        if (ancestors.has(n)) return [];
        if (n.id === nodeId) {
            hit = true;
            const resolvedPatch = typeof patch === 'function' ? patch(n) : patch;
            const next = { ...n, ...(resolvedPatch || {}) };
            next.transform = createTransform({ ...n.transform, ...(resolvedPatch?.transform || {}) });
            const childAncestors = new Set(ancestors);
            childAncestors.add(n);
            next.children = Array.isArray(n.children) ? visit(n.children, childAncestors) : n.children;
            return [next];
        }
        if (Array.isArray(n.children) && n.children.length) {
            const childAncestors = new Set(ancestors);
            childAncestors.add(n);
            return [{ ...n, children: visit(n.children, childAncestors) }];
        }
        return [n];
    });
    const nodes = visit(scene.nodes);
    return hit ? { ...scene, nodes } : scene;
}

/** Immutably remove a node and its children. */
export function removeNode(scene, nodeId) {
    if (!scene || !nodeId) return scene;
    const visit = (list, ancestors = new Set()) => (list || []).flatMap(n => {
        if (!n || n.id === nodeId || ancestors.has(n)) return [];
        if (!Array.isArray(n.children) || !n.children.length) return [n];
        const childAncestors = new Set(ancestors);
        childAncestors.add(n);
        return [{ ...n, children: visit(n.children, childAncestors) }];
    });
    return { ...scene, nodes: visit(scene.nodes) };
}

/** Add a node, at the end of the scene or inside a group. */
export function addNode(scene, node, parentId = null) {
    if (!scene || !node) return scene;
    const prepared = normalizeNode(node, new Set(listNodes(scene).map(e => e.node.id))) || node;
    if (!parentId) return { ...scene, nodes: [...(scene.nodes || []), prepared] };
    const visit = (list, ancestors = new Set()) => (list || []).flatMap(n => {
        if (!n) return [n];
        if (ancestors.has(n)) return [];
        if (n.id === parentId && CONTAINER_TYPES.includes(n.type)) {
            const childAncestors = new Set(ancestors);
            childAncestors.add(n);
            return [{ ...n, children: [...visit(n.children, childAncestors), prepared] }];
        }
        if (Array.isArray(n.children) && n.children.length) {
            const childAncestors = new Set(ancestors);
            childAncestors.add(n);
            return [{ ...n, children: visit(n.children, childAncestors) }];
        }
        return [n];
    });
    return { ...scene, nodes: visit(scene.nodes) };
}

// ─── Transform composition ───────────────────────────────────────────────────

/**
 * Compose a child's local transform onto its parent's absolute one.
 * The child's x/y are percent OFFSETS inside the parent's space; they are
 * converted to pixels before rotating, because a percent of width and a
 * percent of height are different distances (see the file header).
 */
export function composeTransform(parentAbs, local, frame) {
    const p = parentAbs || IDENTITY_TRANSFORM;
    const f = frame && num(frame.w, 0) > 0 ? frame : DEFAULT_FRAME;
    const scale = num(p.scale, 1) * num(local.scale, 1);
    const scaleX = num(p.scaleX, 1) * num(local.scaleX, 1);
    const scaleY = num(p.scaleY, 1) * num(local.scaleY, 1);
    const rotation = num(p.rotation, 0) + num(local.rotation, 0);
    const opacity = clamp(num(p.opacity, 1) * num(local.opacity, 1), 0, 1);

    // Apply a parent's independent axes to the child's local position before
    // rotating it into the parent coordinate space.
    const offX = num(local.x, 0) * num(p.scale, 1) * num(p.scaleX, 1);
    const offY = num(local.y, 0) * num(p.scale, 1) * num(p.scaleY, 1);
    const rad = (num(p.rotation, 0) * Math.PI) / 180;
    let dx = offX;
    let dy = offY;
    if (rad !== 0) {
        const px = (offX / 100) * f.w;
        const py = (offY / 100) * f.h;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        dx = ((px * cos - py * sin) / f.w) * 100;
        dy = ((px * sin + py * cos) / f.h) * 100;
    }
    return {
        x: num(p.x, 0) + dx,
        y: num(p.y, 0) + dy,
        scale,
        scaleX,
        scaleY,
        rotation,
        opacity,
    };
}

/** The absolute transform of a node, composed through every ancestor. */
export function resolveAbsoluteTransform(scene, nodeId) {
    if (!scene) return { ...IDENTITY_TRANSFORM, x: 50, y: 50 };
    let result = null;
    const visit = (list, parentAbs, ancestors = new Set()) => {
        for (const node of list || []) {
            if (!node || result) continue;
            if (typeof node === 'object' && ancestors.has(node)) continue;
            const abs = composeTransform(parentAbs, node.transform, scene.frame);
            if (node.id === nodeId) { result = abs; return; }
            if (Array.isArray(node.children) && node.children.length) {
                const childAncestors = new Set(ancestors);
                childAncestors.add(node);
                visit(node.children, abs, childAncestors);
            }
        }
    };
    visit(scene.nodes, IDENTITY_TRANSFORM);
    return result || { ...IDENTITY_TRANSFORM, x: 50, y: 50 };
}

/**
 * A node's box in the frame, in reference pixels, as
 * `{ x, y, w, h, cx, cy }` where x/y is the top-left. `measure` supplies the
 * content size for a node with no explicit `size` (SceneValidator passes the
 * text measurer; callers that do not care get the font box as an estimate).
 */
export function nodeBox(scene, node, absTransform, measure = null) {
    const f = scene?.frame && num(scene.frame.w, 0) > 0 ? scene.frame : DEFAULT_FRAME;
    const abs = absTransform || resolveAbsoluteTransform(scene, node?.id);
    const scale = Math.abs(num(abs.scale, 1));
    let w = 0;
    let h = 0;
    if (isOverlayType(node?.type)) {
        // Drawn at a fraction of the frame width, keeping its own aspect.
        w = f.w * OVERLAY_WIDTH_FRACTION * scale;
        const aspect = node?.size && num(node.size.h, 0) > 0 ? num(node.size.w, 1) / num(node.size.h, 1) : 1;
        h = aspect > 0 ? w / aspect : w;
    } else {
        const measured = typeof measure === 'function' ? measure(node) : null;
        if (measured && num(measured.w, 0) > 0) { w = measured.w; h = num(measured.h, 0); } else if (node?.size) {
            w = num(node.size.w, 0); h = num(node.size.h, 0);
        } else {
            const fs = num(node?.style?.fontSize, 0);
            const text = String(node?.content || '');
            // Rough fallback: enough to catch a wildly off-frame element.
            w = fs > 0 ? Math.max(fs, text.length * fs * 0.52) : 0;
            h = fs > 0 ? fs * 1.25 : 0;
        }
        w *= scale;
        h *= scale;
    }
    const cx = (num(abs.x, 50) / 100) * f.w;
    const cy = (num(abs.y, 50) / 100) * f.h;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
}

/** Absolute `[start, end]` of a node in scene time, including its ancestors. */
export function nodeLife(scene, nodeId) {
    const entry = findNode(scene, nodeId);
    if (!entry) return null;
    const start = entry.absoluteStart;
    return { start, end: start + Math.max(0, num(entry.node.duration, 0)) };
}

// ─── Flattening to clips ─────────────────────────────────────────────────────

/** Which track a node's clip belongs on. */
function trackTypeFor(node) {
    switch (node.type) {
        case NODE_TYPES.TEXT:
        case NODE_TYPES.CAPTION:
            return 'text';
        case NODE_TYPES.VIDEO:
            return 'video';
        default:
            return 'overlay';
    }
}

function findSceneNode(nodes, id, ancestors = new Set()) {
    for (const node of nodes || []) {
        if (!node || (typeof node === 'object' && ancestors.has(node))) continue;
        if (node?.id === id) return node;
        const childAncestors = new Set(ancestors);
        childAncestors.add(node);
        const child = findSceneNode(node?.children, id, childAncestors);
        if (child) return child;
    }
    return null;
}

/**
 * Turn a scene into the placement list the timeline already understands:
 * `[{ trackType, clip, asset? }]`, the exact shape `ComponentLibrary`
 * returns and `useTimelineStore.addMotionComponent` consumes.
 *
 * Groups do not become clips: their transform is baked into their children,
 * which is what keeps one renderer and one export path for everything.
 *
 * @param {object} scene
 * @param {{ sceneId?:string, startOffset?:number, includeHidden?:boolean }} [opts]
 */
export function flattenScene(scene, opts = {}) {
    const placements = [];
    if (!scene) return { placements };
    const sceneId = opts.sceneId || scene.id;
    const startOffset = Math.max(0, num(opts.startOffset, 0));
    // A hidden node can still be an explicitly referenced track matte. Keep
    // it in the flattened graph so the compositor can resolve the source;
    // the compositor marks that source matte-only, so it is never drawn as
    // ordinary visible footage.
    const matteRequiredIds = new Set();
    const nodeById = new Map();
    const collectNodes = (nodes, ancestors = [], active = new WeakSet()) => {
        for (const node of nodes || []) {
            if (!node) continue;
            if (typeof node === 'object' && active.has(node)) continue;
            nodeById.set(node.id, { node, ancestors });
            if (typeof node === 'object') active.add(node);
            collectNodes(node.children, [...ancestors, node.id], active);
            if (typeof node === 'object') active.delete(node);
        }
    };
    collectNodes(scene.nodes);
    const isMaskTarget = node => (node.type === NODE_TYPES.SHAPE && (!!node.template || !!node.vector))
        || [NODE_TYPES.IMAGE, NODE_TYPES.VIDEO, NODE_TYPES.STICKER].includes(node.type);
    const isMatteSource = node => ((node.type === NODE_TYPES.SHAPE && !!node.vector)
        || [NODE_TYPES.IMAGE, NODE_TYPES.VIDEO, NODE_TYPES.STICKER].includes(node.type));
    for (const { node } of nodeById.values()) {
        if (node.mask?.kind !== 'node' || !node.mask.nodeId || !isMaskTarget(node)) continue;
        const source = nodeById.get(node.mask.nodeId);
        if (!source || source.node.id === node.id || !isMatteSource(source.node)) continue;
        matteRequiredIds.add(source.node.id);
        source.ancestors.forEach(id => matteRequiredIds.add(id));
    }

    const visit = (list, parentAbs, timeOffset, groupId, parentAnimations, timeLimit = Infinity, compositionStack = [], ancestors = new Set()) => {
        // R95 PHASE 3: a group's stagger is applied to its children here, so
        // the delays are computed once rather than stored on each child.
        const children = list || [];
        for (const node of children) {
            if (!node) continue;
            if (typeof node === 'object' && ancestors.has(node)) continue;
            if (node.hidden && !opts.includeHidden && !matteRequiredIds.has(node.id)) continue;
            const abs = composeTransform(parentAbs, node.transform, scene.frame);
            const start = timeOffset + Math.max(0, num(node.start, 0));
            if (start >= timeLimit) continue;
            if (CONTAINER_TYPES.includes(node.type)) {
                const groupAnimations = resolveGroupAnimations(node, scene.frame);
                // Its own animations pass down to its children (parenting),
                // along with anything it inherited itself.
                const inherited = [
                    ...(parentAnimations || []),
                    ...groupAnimations.map(animationWithoutOpacity).filter(Boolean).map(animation => ({
                        animation,
                        originX: num(abs.x, 0),
                        originY: num(abs.y, 0),
                        startTimeAbs: start,
                    })),
                ];
                // Keep the container boundaries in the flattened representation.
                // Child transforms still carry their legacy aggregate opacity for
                // existing renderers; the explicit stack lets isolated-group
                // compositing apply opacity/effects once to the rendered group.
                const nextCompositionStack = [...compositionStack, {
                    id: node.id,
                    type: node.type,
                    start: Math.round((startOffset + start) * 1000) / 1000,
                    duration: Math.max(0, num(node.duration, 0)),
                    originX: num(abs.x, 0),
                    originY: num(abs.y, 0),
                    frameW: num(scene.frame?.w, DEFAULT_FRAME.w),
                    frameH: num(scene.frame?.h, DEFAULT_FRAME.h),
                    opacity: clamp(num(node.transform?.opacity, 1), 0, 1),
                    opacityAnimations: groupAnimations.filter(animationHasOpacity),
                    ...(typeof node.expressions?.opacity === 'string' ? { opacityExpression: node.expressions.opacity } : {}),
                    // Transform expressions need to survive flattening too. The
                    // child resolver evaluates these relative to the owning
                    // group's clock, preserving live procedural motion in both
                    // preview and export instead of baking a one-time sample.
                    ...(Object.entries(node.expressions || {}).some(([property, expression]) =>
                        ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation'].includes(property) && typeof expression === 'string')
                        ? { transformExpressions: Object.fromEntries(Object.entries(node.expressions).filter(([property, expression]) =>
                            ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation'].includes(property) && typeof expression === 'string')) }
                        : {}),
                    blendMode: node.blendMode || 'source-over',
                    effects: (node.effects || []).map(effect => ({ ...effect })),
                }];
                const childLimit = node.type === NODE_TYPES.COMPOSITION
                    ? Math.min(timeLimit, start + Math.max(0, num(node.duration, 0)))
                    : timeLimit;
                // Container blend modes are composited once at the isolated
                // boundary. Passing them to each child would blend twice.
                const childNodes = node.hidden && !opts.includeHidden
                    ? (node.children || []).filter(child => matteRequiredIds.has(child?.id))
                    : node.children;
                const childAncestors = new Set(ancestors);
                childAncestors.add(node);
                visit(applyStagger(childNodes, node.motion || {}), abs, start, groupId || node.id, inherited, childLimit, nextCompositionStack, childAncestors);
                continue;
            }
            const duration = Math.min(Math.max(0, num(node.duration, 0)), Math.max(0, timeLimit - start));
            if (!(duration > 0)) continue; // nothing with no life on screen

            // Paths, repeats and anything inherited from a parent become
            // ordinary keyframes right here (SceneMotion), which is why
            // preview and export need no new concepts for any of it.
            const animations = resolveNodeAnimations(node, {
                parentAnimations,
                offsetX: num(node.transform?.x, 0),
                offsetY: num(node.transform?.y, 0),
                absoluteX: num(abs.x, 0),
                absoluteY: num(abs.y, 0),
                absoluteStart: start,
                frame: scene.frame,
            });
            const vectorBlendMode = BLEND_MODE_SET.has(node.vector?.blendMode)
                ? node.vector.blendMode : 'source-over';
            const resolvedBlendMode = node.blendMode && node.blendMode !== 'source-over'
                ? node.blendMode
                : vectorBlendMode;

            const common = {
                id: node.origin?.clipId || node.id,
                name: node.name,
                start: Math.round((startOffset + start) * 1000) / 1000,
                duration: Math.round(duration * 1000) / 1000,
                rotation: Math.round(num(abs.rotation, 0) * 1000) / 1000,
                // Scene provenance: what lets a clip be traced back to its node.
                sceneId,
                sceneNodeId: node.id,
                ...(groupId ? { groupId } : {}),
                ...(compositionStack.length ? { compositionStack: compositionStack.map(group => ({
                    ...group,
                    effects: group.effects.map(effect => ({ ...effect, params: { ...(effect.params || {}) } })),
                })) } : {}),
                ...(animations.length ? { animations, animation: 'none' } : {}),
                ...(node.expressions && Object.keys(node.expressions).length ? { expressions: { ...node.expressions } } : {}),
                ...(node.audioReactive && typeof node.audioReactive === 'object' ? { audioReactive: { ...node.audioReactive } } : {}),
                // Group effects are carried on compositionStack and applied
                // after the group is isolated. Inheriting them onto each leaf
                // changes the result for overlapping children (and applies
                // the effect multiple times).
                ...(node.effects?.length ? { effects: [...node.effects].map(e => ({
                    ...e,
                    kind: e.kind || e.type,
                    params: { ...(e.params || {}) },
                    ...(e.enabled !== undefined ? { enabled: !!e.enabled } : {}),
                })) } : {}),
                ...(resolvedBlendMode !== 'source-over' ? { blendMode: resolvedBlendMode } : {}),
                ...(node.shadow ? { shadow: { ...node.shadow } } : {}),
                ...(node.motionBlur?.enabled ? { motionBlur: { ...node.motionBlur } } : {}),
            };
            if (num(abs.opacity, 1) < 1) common.opacity = Math.round(num(abs.opacity, 1) * 1000) / 1000;
            // A scene matte uses the same foreground/background removal path
            // as a timeline video clip. Carrying only `layerMask` is not
            // enough: both ObjectLayerOverlay and exportProcessor gate this
            // renderer on `layerTarget === 'background'`.
            if (node.mask?.kind === 'matte' && node.mask.layerMask && node.type === NODE_TYPES.VIDEO) {
                common.layerTarget = 'background';
            }
            const maskable = (node.type === NODE_TYPES.SHAPE && (node.template || node.vector))
                || [NODE_TYPES.IMAGE, NODE_TYPES.VIDEO, NODE_TYPES.STICKER].includes(node.type);
            let sceneMask = node.mask?.kind === 'shape' ? { ...node.mask } : null;
            if (node.mask?.kind === 'node' && node.mask.nodeId) {
                const maskNode = findSceneNode(scene.nodes, node.mask.nodeId);
                const isVisualMatte = maskNode && (
                    (maskNode.type === NODE_TYPES.SHAPE && !!maskNode.vector)
                    || [NODE_TYPES.IMAGE, NODE_TYPES.VIDEO, NODE_TYPES.STICKER].includes(maskNode.type)
                );
                if (isVisualMatte) {
                    // Keep the matte as a layer reference. Converting it to a
                    // rectangle here discarded source alpha and made preview
                    // and export lie about the actual track-matte result.
                    sceneMask = {
                        kind: 'layer',
                        nodeId: maskNode.id,
                        mode: ['luma', 'luminance'].includes(node.mask.mode) ? 'luminance' : 'alpha',
                        invert: !!node.mask.invert,
                    };
                }
            }
            if (maskable && sceneMask) common.sceneMask = sceneMask;
            else if (node.mask?.kind === 'matte' && node.mask.layerMask) common.layerMask = { ...node.mask.layerMask };

            const x = Math.round(num(abs.x, 50) * 1000) / 1000;
            const y = Math.round(num(abs.y, 50) * 1000) / 1000;

            if (node.type === NODE_TYPES.TEXT || node.type === NODE_TYPES.CAPTION) {
                const s = node.style || {};
                // R107: an alternatives slot is an animated word-cycle
                // graphic. Route it through the shared template renderer so
                // preview and export show the same measured, crossfading slot.
                if (node.type === NODE_TYPES.TEXT && node.alternatives?.length > 1) {
                    const size = node.size || { w: Math.round(scene.frame.w * 0.8), h: Math.round(scene.frame.h * 0.24) };
                    placements.push({
                        trackType: 'overlay',
                        clip: {
                            ...common,
                            type: 'template',
                            content: node.content ?? '',
                            alternatives: [...node.alternatives],
                            slotWidth: node.slotWidth || null,
                            dwell: node.dwell || null,
                            template: {
                                kind: 'word-cycle',
                                params: {
                                    w: size.w,
                                    h: size.h,
                                    prefix: node.content ?? '',
                                    words: node.alternatives.join(','),
                                    dwell: node.dwell || 0,
                                    fontSize: num(s.fontSize, 86),
                                    color: s.color || '#FFFFFF',
                                    accent: s.accent || '#00E5FF',
                                },
                            },
                            metadata: { resolution: { w: size.w, h: size.h } },
                            x, y,
                            scale: Math.round(num(abs.scale, 1) * 10000) / 10000,
                            scaleX: Math.round(num(abs.scale, 1) * num(abs.scaleX, 1) * 10000) / 10000,
                            scaleY: Math.round(num(abs.scale, 1) * num(abs.scaleY, 1) * 10000) / 10000,
                        },
                    });
                    continue;
                }
                // Rich typography is a designed graphic layer, not a plain
                // caption. Route it through the shared canvas compositor so
                // mixed runs and per-character motion survive preview/export.
                const requiresCompositionIsolation = compositionStack.some(group =>
                    (Array.isArray(group.effects) && group.effects.length > 0)
                    || (Number(group.opacity ?? 1) < 0.999999)
                    || (group.blendMode && group.blendMode !== 'source-over')
                    || (Array.isArray(group.opacityAnimations) && group.opacityAnimations.length > 0)
                    || typeof group.opacityExpression === 'string');
                const requiresGraphicRender = requiresCompositionIsolation || !!node.motionBlur?.enabled;
                const canUseRichGraphic = node.type === NODE_TYPES.TEXT
                    || (node.type === NODE_TYPES.CAPTION && requiresGraphicRender);
                if ((node.runs?.length || node.charAnim?.preset || node.textPath?.data || requiresGraphicRender) && canUseRichGraphic) {
                    const size = node.size || { w: Math.round(scene.frame.w * 0.8), h: Math.round(scene.frame.h * 0.38) };
                    placements.push({
                        trackType: 'overlay',
                        clip: {
                            ...common,
                            type: 'template',
                            content: node.content ?? '',
                            runs: node.runs || null,
                            charAnim: node.charAnim || null,
                            template: {
                                kind: 'rich-text',
                                params: {
                                    w: size.w,
                                    h: size.h,
                                    runs: node.runs || null,
                                    text: node.content ?? '',
                                    charAnim: node.charAnim || null,
                                    textPath: node.textPath || null,
                                    ...(node.type === NODE_TYPES.CAPTION ? {
                                        captionMode: true,
                                        captionWords: node.words || [],
                                        captionStyle: s.captionStyle || {},
                                        captionTimeOffset: Math.round((startOffset + start) * 1000) / 1000,
                                    } : {}),
                                    style: { ...s },
                                },
                            },
                            metadata: { resolution: { w: size.w, h: size.h } },
                            x, y,
                            scale: Math.round(num(abs.scale, 1) * 10000) / 10000,
                            scaleX: Math.round(num(abs.scale, 1) * num(abs.scaleX, 1) * 10000) / 10000,
                            scaleY: Math.round(num(abs.scale, 1) * num(abs.scaleY, 1) * 10000) / 10000,
                        },
                    });
                    continue;
                }
                // A group's scale lands in the font size: a text clip is sized
                // by fontSize, it has no scale of its own in the renderer.
                const fontSize = num(s.fontSize, 48) * Math.abs(num(abs.scale, 1));
                placements.push({
                    trackType: 'text',
                    clip: {
                        ...common,
                        type: 'text',
                        content: node.content ?? '',
                        x, y,
                        fontSize: Math.round(fontSize * 100) / 100,
                        scaleX: Math.round(num(abs.scaleX, 1) * 10000) / 10000,
                        scaleY: Math.round(num(abs.scaleY, 1) * 10000) / 10000,
                        ...(s.fontFamily ? { fontFamily: s.fontFamily } : {}),
                        ...(s.fontWeight !== undefined ? { fontWeight: s.fontWeight } : {}),
                        ...(s.color ? { color: s.color } : {}),
                        ...(s.textAlign ? { textAlign: s.textAlign } : {}),
                        ...(s.stroke ? { stroke: s.stroke } : {}),
                        ...(s.textShadow ? { textShadow: s.textShadow } : {}),
                        ...(s.tracking !== undefined ? { tracking: s.tracking } : {}),
                        ...(s.captionStyle ? { captionStyle: s.captionStyle } : {}),
                        ...(node.words ? { words: node.words } : {}),
                        ...(node.runs ? { runs: node.runs } : {}),
                        ...(node.charAnim ? { charAnim: node.charAnim } : {}),
                        ...(node.textPath ? { textPath: { ...node.textPath } } : {}),
                ...(node.alternatives?.length ? { alternatives: [...node.alternatives] } : {}),
                ...(node.slotWidth ? { slotWidth: node.slotWidth } : {}),
                ...(node.dwell ? { dwell: node.dwell } : {}),
                        ...(node.style?.emphasis ? { emphasis: node.style.emphasis } : {}),
                    },
                });
                continue;
            }

            if (node.type === NODE_TYPES.SHAPE) {
                if (node.vector) {
                    placements.push({
                        trackType: 'overlay',
                        clip: {
                            ...common,
                            type: 'vector',
                            vector: { ...node.vector },
                            ...(node.size ? { metadata: { resolution: { w: node.size.w, h: node.size.h } } } : {}),
                            x, y,
                            scale: Math.round(num(abs.scale, 1) * 10000) / 10000,
                            scaleX: Math.round(num(abs.scale, 1) * num(abs.scaleX, 1) * 10000) / 10000,
                            scaleY: Math.round(num(abs.scale, 1) * num(abs.scaleY, 1) * 10000) / 10000,
                        },
                    });
                    continue;
                }
                if (node.template) {
                    placements.push({
                        trackType: 'overlay',
                        clip: {
                            ...common,
                            type: 'template',
                            template: { kind: node.template.kind, params: { ...node.template.params } },
                            ...(node.size ? { metadata: { resolution: { w: node.size.w, h: node.size.h } } } : {}),
                            x, y,
                            scale: Math.round(num(abs.scale, 1) * 10000) / 10000,
                            scaleX: Math.round(num(abs.scale, 1) * num(abs.scaleX, 1) * 10000) / 10000,
                            scaleY: Math.round(num(abs.scale, 1) * num(abs.scaleY, 1) * 10000) / 10000,
                        },
                    });
                    continue;
                }
            }

            // image / video / sticker
            const src = node.source || {};
            placements.push({
                trackType: trackTypeFor(node),
                ...(src.assetId || src.url ? { asset: { id: src.assetId || null, name: node.name, url: src.url || null } } : {}),
                clip: {
                    ...common,
                    type: node.type === NODE_TYPES.VIDEO ? 'video' : (node.type === NODE_TYPES.IMAGE ? 'image' : 'sticker'),
                    ...(src.assetId ? { assetId: src.assetId } : {}),
                    ...(src.url ? { url: src.url, sourceUrl: src.url } : {}),
                    x, y,
                    scale: Math.round(num(abs.scale, 1) * 10000) / 10000,
                    scaleX: Math.round(num(abs.scale, 1) * num(abs.scaleX, 1) * 10000) / 10000,
                    scaleY: Math.round(num(abs.scale, 1) * num(abs.scaleY, 1) * 10000) / 10000,
                },
            });
        }
    };
    visit(scene.nodes, IDENTITY_TRANSFORM, 0, null, []);
    return { placements };
}

// ─── Lifting clips into a scene ──────────────────────────────────────────────

const TEXT_STYLE_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'color', 'textAlign', 'stroke', 'textShadow', 'tracking', 'lineHeight', 'captionStyle', 'emphasis'];

/** One clip as a scene node. Pure; the clip is not modified. */
export function nodeFromClip(clip, trackType = 'overlay') {
    if (!clip) return null;
    const wordCycleTemplate = clip.type === 'template' && clip.template?.kind === 'word-cycle';
    const richTextTemplate = clip.type === 'template' && clip.template?.kind === 'rich-text';
    const richParams = richTextTemplate ? (clip.template.params || {}) : {};
    const type = clip.type === 'text' ? (clip.words ? NODE_TYPES.CAPTION : NODE_TYPES.TEXT)
        : (wordCycleTemplate || richTextTemplate) ? NODE_TYPES.TEXT
            : clip.type === 'template' ? NODE_TYPES.SHAPE
            : (clip.type === 'vector' || clip.type === 'shape') ? NODE_TYPES.SHAPE
            : clip.type === 'image' ? NODE_TYPES.IMAGE
                : clip.type === 'video' ? NODE_TYPES.VIDEO
                    : NODE_TYPES.STICKER;
    const style = {};
    for (const k of TEXT_STYLE_KEYS) {
        const value = clip[k] ?? richParams.style?.[k];
        if (value !== undefined) style[k] = value;
    }
    if (wordCycleTemplate) {
        const params = clip.template.params || {};
        style.fontSize = num(params.fontSize, style.fontSize || 86);
        style.color = params.color || style.color || '#FFFFFF';
    }
    const res = clip.metadata?.resolution;
    return createNode(type, {
        id: clip.sceneNodeId || undefined,
        name: clip.name || undefined,
        start: num(clip.start, 0),
        duration: num(clip.duration, 0),
        transform: {
            x: num(clip.x, 50),
            y: num(clip.y, 50),
            // A text clip's size lives in fontSize, so its transform scale stays 1.
            scale: clip.type === 'text' ? 1 : num(clip.scale, 1),
            scaleX: clip.type === 'text' ? num(clip.scaleX, 1)
                : num(clip.scaleX, num(clip.scale, 1)) / (Math.abs(num(clip.scale, 1)) > 0.0001 ? num(clip.scale, 1) : 1),
            scaleY: clip.type === 'text' ? num(clip.scaleY, 1)
                : num(clip.scaleY, num(clip.scale, 1)) / (Math.abs(num(clip.scale, 1)) > 0.0001 ? num(clip.scale, 1) : 1),
            rotation: num(clip.rotation, 0),
            opacity: num(clip.opacity, 1),
        },
        size: res && num(res.w, 0) > 0 ? { w: res.w, h: res.h } : null,
        style,
        content: clip.content ?? (wordCycleTemplate ? clip.template.params?.prefix : null) ?? richParams.text ?? '',
        runs: Array.isArray(clip.runs) ? clip.runs : Array.isArray(richParams.runs) ? richParams.runs : null,
        charAnim: clip.charAnim && typeof clip.charAnim === 'object' ? clip.charAnim
            : richParams.charAnim && typeof richParams.charAnim === 'object' ? richParams.charAnim : null,
        textPath: clip.textPath && typeof clip.textPath === 'object' ? { ...clip.textPath }
            : richParams.textPath && typeof richParams.textPath === 'object' ? { ...richParams.textPath } : null,
        alternatives: Array.isArray(clip.alternatives)
            ? clip.alternatives
            : wordCycleTemplate ? String(clip.template.params?.words || '').split(',').map(word => word.trim()).filter(Boolean) : null,
        slotWidth: clip.slotWidth || null,
        dwell: clip.dwell ?? (wordCycleTemplate ? clip.template.params?.dwell : null),
        words: Array.isArray(clip.words) ? clip.words : null,
        template: clip.template || null,
        vector: clip.vector || null,
        source: clip.assetId || clip.url ? { assetId: clip.assetId || null, url: clip.url || clip.sourceUrl || null } : null,
        // Lifting a timeline clip into a scene must preserve authored visual
        // behavior. Otherwise opening and re-flattening a scene silently
        // strips the effect stack, compositing mode, and mask.
        effects: Array.isArray(clip.effects) ? clip.effects : [],
        motionBlur: clip.motionBlur || null,
        blendMode: clip.blendMode || 'source-over',
        shadow: clip.shadow || null,
        mask: clip.sceneMask || (clip.layerMask ? { kind: 'matte', layerMask: clip.layerMask } : null),
        animations: Array.isArray(clip.animations) ? clip.animations : [],
        expressions: clip.expressions && typeof clip.expressions === 'object' ? clip.expressions : {},
        origin: { clipId: clip.id, trackType, groupId: clip.groupId || null },
    });
}

/**
 * Lift a placement list (what `ComponentLibrary.buildComponent` returns) into
 * a scene: one identity group holding every piece, so the group can later be
 * moved, scaled or retimed as a unit, and `flattenScene` gives back the same
 * clips. The placements are not modified.
 *
 * @param {Array<{trackType:string, clip:object, asset?:object}>} placements
 * @param {{ name?:string, aspectRatio?:string, componentId?:string, presetId?:string, start?:number, meta?:object }} [opts]
 */
export function sceneFromPlacements(placements, opts = {}) {
    const list = Array.isArray(placements) ? placements.filter(p => p && p.clip) : [];
    // Times are relative to the scene, so the earliest piece sits at 0.
    const base = list.length ? Math.min(...list.map(p => Math.max(0, num(p.clip.start, 0)))) : 0;
    const children = list.map(p => {
        const node = nodeFromClip(p.clip, p.trackType);
        if (!node) return null;
        node.start = Math.max(0, num(p.clip.start, 0) - base);
        if (p.asset && (p.asset.id || p.asset.url)) {
            node.source = { assetId: p.asset.id || node.source?.assetId || null, url: p.asset.url || node.source?.url || null };
        }
        if (opts.componentId) node.origin = { ...(node.origin || {}), componentId: opts.componentId, presetId: opts.presetId || null };
        return node;
    }).filter(Boolean);

    // The group's origin is the centre of what it holds, so scaling or
    // rotating the group happens in place rather than dragging everything
    // toward the top-left corner of the frame. Offsets are computed from the
    // ROUNDED origin, so origin + offset is exactly the original position.
    const xs = children.map(c => num(c.transform.x, 50));
    const ys = children.map(c => num(c.transform.y, 50));
    const origin = children.length
        ? { x: Math.round(((Math.min(...xs) + Math.max(...xs)) / 2) * 1000) / 1000, y: Math.round(((Math.min(...ys) + Math.max(...ys)) / 2) * 1000) / 1000 }
        : { x: 0, y: 0 };
    for (const child of children) {
        child.transform = createTransform({ ...child.transform, x: num(child.transform.x, 50) - origin.x, y: num(child.transform.y, 50) - origin.y });
    }

    const group = createGroup({
        name: opts.name || opts.componentId || 'Graphic',
        transform: { x: origin.x, y: origin.y },
        children,
        origin: opts.componentId ? { componentId: opts.componentId, presetId: opts.presetId || null } : null,
    });
    return normalizeScene(createScene({
        name: opts.name || opts.componentId || 'Scene',
        aspectRatio: opts.aspectRatio || '16:9',
        nodes: [group],
        meta: { ...(opts.meta || {}), ...(opts.componentId ? { componentId: opts.componentId, presetId: opts.presetId || null } : {}) },
    }));
}

/** The top-level group of a lifted scene, which is what a user drags as one. */
export function rootGroup(scene) {
    const first = (scene?.nodes || [])[0];
    return first && first.type === NODE_TYPES.GROUP ? first : null;
}

// ─── Shape validation (structure only; design checks are SceneValidator) ─────

/** `{ valid, errors }`. Structure and types only. Never throws. */
export function validateSceneShape(scene) {
    const errors = [];
    if (!scene || typeof scene !== 'object') return { valid: false, errors: ['scene must be an object'] };
    if (num(scene.schemaVersion, 0) < 1) errors.push('scene must have a schemaVersion');
    if (!scene.id) errors.push('scene must have an id');
    if (!scene.frame || !(num(scene.frame.w, 0) > 0) || !(num(scene.frame.h, 0) > 0)) errors.push('scene.frame needs a positive w and h');
    if (!Array.isArray(scene.nodes)) errors.push('scene.nodes must be an array');

    const ids = new Set();
    walkScene(scene, (node, ctx) => {
        const where = `node "${node.id || '?'}"`;
        if (!node.id) errors.push(`${where}: missing id`);
        else if (ids.has(node.id)) errors.push(`${where}: duplicate id`);
        ids.add(node.id);
        if (ctx.cycle) errors.push(`${where}: cyclic parent/child reference`);
        if (!NODE_TYPE_LIST.includes(node.type)) errors.push(`${where}: unknown type "${node.type}"`);
        if (!Number.isFinite(num(node.start, NaN)) || node.start < 0) errors.push(`${where}: start must be a non-negative number`);
        if (!Number.isFinite(num(node.duration, NaN)) || node.duration < 0) errors.push(`${where}: duration must be a non-negative number`);
        if (!node.transform) errors.push(`${where}: missing transform`);
        if (!Array.isArray(node.animations)) errors.push(`${where}: animations must be an array`);
        if (!CONTAINER_TYPES.includes(node.type) && (node.children || []).length) errors.push(`${where}: a ${node.type} cannot have children`);
        if (ctx.depth > MAX_SCENE_DEPTH) errors.push(`${where}: nested deeper than ${MAX_SCENE_DEPTH} groups`);
        return !ctx.cycle && ctx.depth <= 8;
    });
    return { valid: errors.length === 0, errors };
}

export default {
    SCENE_SCHEMA_VERSION,
    MAX_SCENE_DEPTH,
    NODE_TYPES,
    CONTAINER_TYPES,
    PINS,
    EFFECT_KINDS,
    MASK_KINDS,
    IDENTITY_TRANSFORM,
    OVERLAY_WIDTH_FRACTION,
    isOverlayType,
    frameForAspect,
    nextNodeId,
    createTransform,
    createNode,
    createGroup,
    createComposition,
    wrapNodeInComposition,
    createScene,
    sceneContentDuration,
    migrateScene,
    normalizeScene,
    walkScene,
    findNode,
    listNodes,
    updateNode,
    removeNode,
    addNode,
    composeTransform,
    resolveAbsoluteTransform,
    nodeBox,
    nodeLife,
    flattenScene,
    nodeFromClip,
    sceneFromPlacements,
    rootGroup,
    validateSceneShape,
};
