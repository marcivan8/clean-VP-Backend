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
import { applyStagger, resolveNodeAnimations } from './SceneMotion.js';

/** Bumped whenever a stored scene needs `migrateScene` to touch it. */
export const SCENE_SCHEMA_VERSION = 1;

export const NODE_TYPES = {
    GROUP:   'group',
    TEXT:    'text',
    SHAPE:   'shape',
    IMAGE:   'image',
    VIDEO:   'video',
    STICKER: 'sticker',
    CAPTION: 'caption',
};

const NODE_TYPE_LIST = Object.values(NODE_TYPES);

/** Node types that hold children. Only groups, for now. */
export const CONTAINER_TYPES = [NODE_TYPES.GROUP];

/** How a node is pinned when the frame changes shape (Phase 2 layout). */
export const PINS = { START: 'start', CENTRE: 'centre', END: 'end' };

/** Effects a node may declare. A renderer that does not know one ignores it. */
export const EFFECT_KINDS = ['shadow', 'glow', 'blur', 'grain', 'gradient-fill', 'stroke', 'inner-shadow'];

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
export const IDENTITY_TRANSFORM = Object.freeze({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });

export function createTransform(overrides = {}) {
    return {
        x:        num(overrides.x, 50),
        y:        num(overrides.y, 50),
        scale:    Math.max(0, num(overrides.scale, 1)),
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
        /** Per-word timings for a caption node. See CaptionModel.js. */
        words: Array.isArray(overrides.words) ? overrides.words : null,

        /** Shape nodes: `{ kind, params }` for TemplateGraphics.drawTemplate or vector definition. */
        vector: overrides.vector && typeof overrides.vector === 'object' ? { ...overrides.vector } : null,
        template: overrides.template && overrides.template.kind
            ? { kind: String(overrides.template.kind), params: { ...(overrides.template.params || {}) } }
            : null,

        /** Image/video nodes: where the pixels come from. */
        source: overrides.source && typeof overrides.source === 'object' ? { ...overrides.source } : null,

        /** `{ kind, nodeId?, template?, invert? }`. */
        mask: overrides.mask && overrides.mask.kind ? { ...overrides.mask } : null,

        /** `[{ kind, params }]`. Unknown kinds are reported by SceneValidator. */
        effects: Array.isArray(overrides.effects) ? overrides.effects.filter(e => e && e.kind).map(e => ({ kind: String(e.kind), params: { ...(e.params || {}) } })) : [],

        /** Layout intent: `{ pinX, pinY, keepInSafeArea, maxWidthFrac }`. */
        constraints: overrides.constraints && typeof overrides.constraints === 'object' ? { ...overrides.constraints } : {},

        /** MotionSchema Animation[]. Layer-local times. */
        animations: Array.isArray(overrides.animations) ? overrides.animations : [],

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
    let end = 0;
    const visit = (list, offset) => {
        for (const n of list || []) {
            if (!n) continue;
            const s = offset + Math.max(0, num(n.start, 0));
            end = Math.max(end, s + Math.max(0, num(n.duration, 0)));
            if (Array.isArray(n.children) && n.children.length) visit(n.children, s);
        }
    };
    visit(nodes, 0);
    return Math.round(end * 1000) / 1000;
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

function normalizeNode(raw, seen) {
    if (!raw || typeof raw !== 'object') return null;
    const node = createNode(raw.type, raw);
    // Duplicate ids break React keys and node lookup; the second one is renamed.
    if (seen.has(node.id)) node.id = nextNodeId(node.type);
    seen.add(node.id);
    node.animations = normalizeAnimations(raw.animations);
    node.children = CONTAINER_TYPES.includes(node.type) && Array.isArray(raw.children)
        ? raw.children.map(c => normalizeNode(c, seen)).filter(Boolean)
        : [];
    // A group with no stated life covers its children.
    if (node.type === NODE_TYPES.GROUP && !(node.duration > 0) && node.children.length) {
        node.duration = sceneContentDuration(node.children);
    }
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
    const visit = (list, parent, depth, path, offset) => {
        for (let i = 0; i < (list || []).length; i++) {
            const node = list[i];
            if (!node) continue;
            const nodePath = [...path, i];
            const absoluteStart = offset + Math.max(0, num(node.start, 0));
            const go = fn(node, { parent, depth, path: nodePath, absoluteStart });
            if (go !== false && Array.isArray(node.children) && node.children.length) {
                visit(node.children, node, depth + 1, nodePath, absoluteStart);
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
    const visit = (list) => (list || []).map(n => {
        if (!n) return n;
        if (n.id === nodeId) {
            hit = true;
            const next = { ...n, ...(typeof patch === 'function' ? patch(n) : patch) };
            next.transform = createTransform({ ...n.transform, ...((typeof patch === 'function' ? patch(n) : patch)?.transform || {}) });
            next.children = n.children;
            return next;
        }
        if (Array.isArray(n.children) && n.children.length) return { ...n, children: visit(n.children) };
        return n;
    });
    const nodes = visit(scene.nodes);
    return hit ? { ...scene, nodes } : scene;
}

/** Immutably remove a node and its children. */
export function removeNode(scene, nodeId) {
    if (!scene || !nodeId) return scene;
    const visit = (list) => (list || [])
        .filter(n => n && n.id !== nodeId)
        .map(n => (Array.isArray(n.children) && n.children.length ? { ...n, children: visit(n.children) } : n));
    return { ...scene, nodes: visit(scene.nodes) };
}

/** Add a node, at the end of the scene or inside a group. */
export function addNode(scene, node, parentId = null) {
    if (!scene || !node) return scene;
    const prepared = normalizeNode(node, new Set(listNodes(scene).map(e => e.node.id))) || node;
    if (!parentId) return { ...scene, nodes: [...(scene.nodes || []), prepared] };
    const visit = (list) => (list || []).map(n => {
        if (!n) return n;
        if (n.id === parentId && CONTAINER_TYPES.includes(n.type)) return { ...n, children: [...(n.children || []), prepared] };
        if (Array.isArray(n.children) && n.children.length) return { ...n, children: visit(n.children) };
        return n;
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
    const scale = Math.max(0, num(p.scale, 1)) * Math.max(0, num(local.scale, 1));
    const rotation = num(p.rotation, 0) + num(local.rotation, 0);
    const opacity = clamp(num(p.opacity, 1) * num(local.opacity, 1), 0, 1);

    const offX = num(local.x, 0) * num(p.scale, 1);
    const offY = num(local.y, 0) * num(p.scale, 1);
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
        rotation,
        opacity,
    };
}

/** The absolute transform of a node, composed through every ancestor. */
export function resolveAbsoluteTransform(scene, nodeId) {
    if (!scene) return { ...IDENTITY_TRANSFORM, x: 50, y: 50 };
    let result = null;
    const visit = (list, parentAbs) => {
        for (const node of list || []) {
            if (!node || result) continue;
            const abs = composeTransform(parentAbs, node.transform, scene.frame);
            if (node.id === nodeId) { result = abs; return; }
            if (Array.isArray(node.children) && node.children.length) visit(node.children, abs);
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
    const scale = Math.max(0, num(abs.scale, 1));
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

    const visit = (list, parentAbs, timeOffset, groupId, parentAnimations) => {
        // R95 PHASE 3: a group's stagger is applied to its children here, so
        // the delays are computed once rather than stored on each child.
        const children = list || [];
        for (const node of children) {
            if (!node) continue;
            if (node.hidden && !opts.includeHidden) continue;
            const abs = composeTransform(parentAbs, node.transform, scene.frame);
            const start = timeOffset + Math.max(0, num(node.start, 0));
            if (node.type === NODE_TYPES.GROUP) {
                // Its own animations pass down to its children (parenting),
                // along with anything it inherited itself.
                const inherited = [...(parentAnimations || []), ...(Array.isArray(node.animations) ? node.animations : [])];
                visit(applyStagger(node.children, node.motion || {}), abs, start, groupId || node.id, inherited);
                continue;
            }
            const duration = Math.max(0, num(node.duration, 0));
            if (!(duration > 0)) continue; // nothing with no life on screen

            // Paths, repeats and anything inherited from a parent become
            // ordinary keyframes right here (SceneMotion), which is why
            // preview and export need no new concepts for any of it.
            const animations = resolveNodeAnimations(node, {
                parentAnimations,
                offsetX: num(node.transform?.x, 0),
                offsetY: num(node.transform?.y, 0),
                frame: scene.frame,
            });

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
                ...(animations.length ? { animations, animation: 'none' } : {}),
            };
            if (num(abs.opacity, 1) < 1) common.opacity = Math.round(num(abs.opacity, 1) * 1000) / 1000;
            if (node.mask) common.layerMask = node.mask.layerMask || common.layerMask;

            const x = Math.round(num(abs.x, 50) * 1000) / 1000;
            const y = Math.round(num(abs.y, 50) * 1000) / 1000;

            if (node.type === NODE_TYPES.TEXT || node.type === NODE_TYPES.CAPTION) {
                const s = node.style || {};
                // A group's scale lands in the font size: a text clip is sized
                // by fontSize, it has no scale of its own in the renderer.
                const fontSize = num(s.fontSize, 48) * Math.max(0, num(abs.scale, 1));
                placements.push({
                    trackType: 'text',
                    clip: {
                        ...common,
                        type: 'text',
                        content: node.content ?? '',
                        x, y,
                        fontSize: Math.round(fontSize * 100) / 100,
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
    const type = clip.type === 'text' ? (clip.words ? NODE_TYPES.CAPTION : NODE_TYPES.TEXT)
        : clip.type === 'template' ? NODE_TYPES.SHAPE
            : clip.type === 'image' ? NODE_TYPES.IMAGE
                : clip.type === 'video' ? NODE_TYPES.VIDEO
                    : NODE_TYPES.STICKER;
    const style = {};
    for (const k of TEXT_STYLE_KEYS) if (clip[k] !== undefined) style[k] = clip[k];
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
            rotation: num(clip.rotation, 0),
            opacity: num(clip.opacity, 1),
        },
        size: res && num(res.w, 0) > 0 ? { w: res.w, h: res.h } : null,
        style,
        content: clip.content ?? '',
        words: Array.isArray(clip.words) ? clip.words : null,
        template: clip.template || null,
        source: clip.assetId || clip.url ? { assetId: clip.assetId || null, url: clip.url || clip.sourceUrl || null } : null,
        animations: Array.isArray(clip.animations) ? clip.animations : [],
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
        if (!NODE_TYPE_LIST.includes(node.type)) errors.push(`${where}: unknown type "${node.type}"`);
        if (!Number.isFinite(num(node.start, NaN)) || node.start < 0) errors.push(`${where}: start must be a non-negative number`);
        if (!Number.isFinite(num(node.duration, NaN)) || node.duration < 0) errors.push(`${where}: duration must be a non-negative number`);
        if (!node.transform) errors.push(`${where}: missing transform`);
        if (!Array.isArray(node.animations)) errors.push(`${where}: animations must be an array`);
        if (!CONTAINER_TYPES.includes(node.type) && (node.children || []).length) errors.push(`${where}: a ${node.type} cannot have children`);
        if (ctx.depth > 8) errors.push(`${where}: nested deeper than 8 groups`);
        return ctx.depth <= 8;
    });
    return { valid: errors.length === 0, errors };
}

export default {
    SCENE_SCHEMA_VERSION,
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
