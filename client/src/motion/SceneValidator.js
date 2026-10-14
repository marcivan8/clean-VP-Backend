/**
 * client/src/motion/SceneValidator.js
 *
 * R94 — PHASE 6 (brought forward): does this designed scene actually work?
 *
 * Generation without validation is the thing that makes AI motion graphics
 * look amateur: the headline is two characters too wide, the lower third sits
 * under the TikTok caption bar, a shape references a template this build
 * cannot draw, an entrance animation starts after its layer has gone. Every
 * one of those is detectable before a frame is rendered, and most are
 * mechanically fixable.
 *
 * So this module answers one question — "is this scene safe to show?" — and,
 * where the answer is a deterministic nudge rather than a design decision,
 * applies it (`autoFixScene`). Anything that needs taste (two elements
 * fighting for the same space) is REPORTED, never guessed at.
 *
 * Pure: no DOM required. Text is measured through `TextMeasurement.js`, which
 * uses a canvas when there is one and deterministic font metrics when there is
 * not, so the same scene validates the same way in the browser, in a Node
 * test and in the render worker.
 */

import { measureTextBounds, fitTextToBox } from './TextMeasurement.js';
import { TEMPLATE_KINDS, SHAPE_KINDS } from './TemplateGraphics.js';
import {
    NODE_TYPES,
    isOverlayType,
    EFFECT_KINDS,
    MASK_KINDS,
    IDENTITY_TRANSFORM,
    composeTransform,
    nodeBox,
    updateNode,
    normalizeScene,
    validateSceneShape,
} from './SceneSchema.js';

export const SEVERITY = { ERROR: 'error', WARN: 'warn', INFO: 'info' };

export const ISSUE_CODES = {
    SHAPE_INVALID:        'shape_invalid',
    EMPTY_CONTENT:        'empty_content',
    TEXT_OVERFLOW:        'text_overflow',
    TEXT_TOO_SMALL:       'text_too_small',
    OUTSIDE_FRAME:        'outside_frame',
    SAFE_AREA:            'safe_area',
    LAYER_COLLISION:      'layer_collision',
    MISSING_ASSET:        'missing_asset',
    UNSUPPORTED_EFFECT:   'unsupported_effect',
    UNKNOWN_TEMPLATE:     'unknown_template',
    UNSUPPORTED_MASK:     'unsupported_mask',
    ZERO_DURATION:        'zero_duration',
    TIMING_OUT_OF_RANGE:  'timing_out_of_range',
    EXIT_BEFORE_ENTRANCE: 'exit_before_entrance',
    STARTS_AFTER_SCENE:   'starts_after_scene',
    LOW_CONTRAST:         'low_contrast',
};

/** Codes `autoFixScene` can resolve on its own. */
export const AUTO_FIXABLE = Object.freeze([
    ISSUE_CODES.TEXT_OVERFLOW,
    ISSUE_CODES.OUTSIDE_FRAME,
    ISSUE_CODES.SAFE_AREA,
    ISSUE_CODES.UNSUPPORTED_EFFECT,
    ISSUE_CODES.TIMING_OUT_OF_RANGE,
    ISSUE_CODES.ZERO_DURATION,
]);

/** Minimum legible text on a phone, as a fraction of frame height. */
const MIN_TEXT_FRACTION = 0.022;
/** Title-safe margin used when no platform safe zone is supplied. */
const DEFAULT_MARGIN = 0.04;
/** Two boxes count as colliding past this share of the smaller one. */
const COLLISION_SHARE = 0.25;
/** A sliver over the edge is rounding, not a defect. */
const EDGE_TOLERANCE_PX = 2;

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round = (v, p = 2) => Math.round(num(v, 0) * 10 ** p) / 10 ** p;

function issue(code, severity, node, message, detail = {}) {
    return {
        code,
        severity,
        nodeId: node?.id || null,
        nodeName: node?.name || null,
        message,
        fix: AUTO_FIXABLE.includes(code) ? 'auto' : 'manual',
        detail,
    };
}

// ─── Measuring ───────────────────────────────────────────────────────────────

/**
 * The box a text node wants, in reference pixels.
 * `maxWidth` is the node's own size, else its `constraints.maxWidthFrac` of
 * the frame, else the frame minus the margins — the same budget the preview
 * gives a caption.
 */
export function textMetrics(scene, node, opts = {}) {
    const frame = scene.frame;
    const style = node.style || {};
    const fontSize = num(style.fontSize, 48);
    const explicit = node.size && num(node.size.w, 0) > 0 ? num(node.size.w, 0) : 0;
    const frac = num(node.constraints?.maxWidthFrac, 0);
    // With no explicit box, the budget is the space content may actually use:
    // the platform's safe rectangle when there is one, else the title-safe
    // frame. Using the whole frame instead would let text "fit" and then be
    // reported as a safe-area breach that moving it can never resolve.
    const maxWidth = explicit || (frac > 0 ? frac * frame.w : contentRect(scene, opts).w);
    const bounds = measureTextBounds(node.content ?? '', {
        fontSize,
        fontFamily: style.fontFamily || 'Inter',
        fontWeight: style.fontWeight || 'normal',
        lineHeight: num(style.lineHeight, 1.2),
        maxWidth: node.constraints?.allowWrap === false ? Infinity : maxWidth,
    });
    return { ...bounds, maxWidth, fontSize };
}

/** Content size of any node, for `nodeBox`. */
function measurerFor(scene, opts) {
    return (node) => {
        if (!node) return null;
        if (node.type === NODE_TYPES.TEXT || node.type === NODE_TYPES.CAPTION) {
            const m = textMetrics(scene, node, opts);
            return { w: m.width, h: m.height };
        }
        return node.size ? { w: node.size.w, h: node.size.h } : null;
    };
}

/** Every visible leaf with its absolute transform, box and life. */
function visibleLeaves(scene, opts) {
    const measure = measurerFor(scene, opts);
    const out = [];
    const visit = (list, parentAbs, timeOffset) => {
        for (const node of list || []) {
            if (!node || node.hidden) continue;
            const abs = composeTransform(parentAbs, node.transform, scene.frame);
            const start = timeOffset + Math.max(0, num(node.start, 0));
            if (node.type === NODE_TYPES.GROUP) { visit(node.children, abs, start); continue; }
            out.push({
                node,
                abs,
                start,
                end: start + Math.max(0, num(node.duration, 0)),
                box: nodeBox(scene, node, abs, measure),
            });
        }
    };
    visit(scene.nodes, IDENTITY_TRANSFORM, 0);
    return out;
}

// ─── Colour ──────────────────────────────────────────────────────────────────

function parseColor(value) {
    const s = String(value || '').trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16));
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
        const parts = m[1].split(',').map(p => parseFloat(p));
        if (parts.length >= 3 && parts.every(p => Number.isFinite(p))) return parts.slice(0, 3);
    }
    return null;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(color) {
    const rgb = parseColor(color);
    if (!rgb) return null;
    const [r, g, b] = rgb.map(c => {
        const v = Math.min(1, Math.max(0, c / 255));
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. null when either colour cannot be read. */
export function contrastRatio(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    if (la === null || lb === null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ─── Geometry ────────────────────────────────────────────────────────────────

function overlapArea(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The generic safe zone for a frame shape, as fractions of it that content
 * should avoid. Vertical video is the case that matters: the top carries the
 * app's own header and the bottom third carries captions, the handle and the
 * buttons. A caller that knows the real platform (PlatformProfiles.safeZone)
 * should pass that instead — it is stricter and per-platform.
 */
export function safeZoneForAspect(aspectRatio) {
    switch (aspectRatio) {
        case '9:16': return { top: 0.10, bottom: 0.20, left: 0.05, right: 0.08 };
        case '4:5':  return { top: 0.08, bottom: 0.14, left: 0.05, right: 0.06 };
        case '1:1':  return { top: 0.06, bottom: 0.10, left: 0.05, right: 0.05 };
        default:     return null; // landscape: the title-safe margin is enough
    }
}

/** The rectangle content should stay inside, in reference pixels. */
export function contentRect(scene, opts = {}) {
    const { w, h } = scene.frame;
    const sz = opts.safeZone;
    if (sz) {
        const left = num(sz.left, 0) * w;
        const right = num(sz.right, 0) * w;
        const top = num(sz.top, 0) * h;
        const bottom = num(sz.bottom, 0) * h;
        return { x: left, y: top, w: Math.max(0, w - left - right), h: Math.max(0, h - top - bottom) };
    }
    const m = num(opts.margin, DEFAULT_MARGIN);
    return { x: w * m, y: h * m, w: w * (1 - m * 2), h: h * (1 - m * 2) };
}

// ─── The checks ──────────────────────────────────────────────────────────────

function checkContent(entry, issues) {
    const { node } = entry;
    const hasRuns = Array.isArray(node.runs) && node.runs.some(r => String(r.text || '').trim());
    if ((node.type === NODE_TYPES.TEXT || node.type === NODE_TYPES.CAPTION) && !String(node.content ?? '').trim() && !hasRuns) {
        issues.push(issue(ISSUE_CODES.EMPTY_CONTENT, SEVERITY.ERROR, node, 'This text layer has nothing in it, so nothing will show.'));
    }
}

function checkTiming(scene, entry, issues) {
    const { node } = entry;
    const duration = Math.max(0, num(node.duration, 0));
    if (node.type !== NODE_TYPES.GROUP && !(duration > 0)) {
        issues.push(issue(ISSUE_CODES.ZERO_DURATION, SEVERITY.ERROR, node, 'This layer has no time on screen, so it will never be seen.'));
        return;
    }
    if (scene.duration > 0 && entry.start >= scene.duration - 1e-6) {
        issues.push(issue(ISSUE_CODES.STARTS_AFTER_SCENE, SEVERITY.WARN, node,
            `This layer starts at ${round(entry.start)} s, after the graphic ends at ${round(scene.duration)} s.`,
            { start: entry.start, sceneDuration: scene.duration }));
    }
    let entranceEnd = 0;
    let earliestExitStart = Infinity;
    (node.animations || []).forEach((anim, i) => {
        const aDur = Math.max(0, num(anim.duration, 0));
        const aStart = Math.max(0, num(anim.startTime, 0));
        if (anim.anchor === 'out') {
            earliestExitStart = Math.min(earliestExitStart, Math.max(0, duration - aDur - aStart));
            if (aDur > duration + 1e-6) {
                issues.push(issue(ISSUE_CODES.TIMING_OUT_OF_RANGE, SEVERITY.WARN, node,
                    `An exit animation lasts ${round(aDur)} s but the layer only lives ${round(duration)} s.`,
                    { animationIndex: i, animationId: anim.id || null, duration: aDur, nodeDuration: duration }));
            }
            return;
        }
        entranceEnd = Math.max(entranceEnd, aStart + aDur);
        if (aStart >= duration - 1e-6) {
            issues.push(issue(ISSUE_CODES.TIMING_OUT_OF_RANGE, SEVERITY.WARN, node,
                `An animation starts at ${round(aStart)} s, after the layer has gone at ${round(duration)} s.`,
                { animationIndex: i, animationId: anim.id || null, startTime: aStart, nodeDuration: duration }));
        } else if (aStart + aDur > duration + 1e-6) {
            issues.push(issue(ISSUE_CODES.TIMING_OUT_OF_RANGE, SEVERITY.WARN, node,
                `An animation runs ${round(aStart + aDur - duration)} s past the end of its layer, so it will be cut off.`,
                { animationIndex: i, animationId: anim.id || null, startTime: aStart, duration: aDur, nodeDuration: duration }));
        }
    });
    if (Number.isFinite(earliestExitStart) && entranceEnd > earliestExitStart + 1e-6) {
        issues.push(issue(ISSUE_CODES.EXIT_BEFORE_ENTRANCE, SEVERITY.WARN, node,
            `The exit starts at ${round(earliestExitStart)} s, before the entrance finishes at ${round(entranceEnd)} s.`,
            { entranceEnd, exitStart: earliestExitStart }));
    }
}

function checkText(scene, entry, issues, opts) {
    const { node } = entry;
    if (node.type !== NODE_TYPES.TEXT && node.type !== NODE_TYPES.CAPTION) return;
    if (!String(node.content ?? '').trim()) return;
    const m = textMetrics(scene, node, opts);
    const scale = Math.max(0, num(entry.abs.scale, 1));
    const width = m.width * scale;
    const budget = m.maxWidth * scale;
    if (width > budget + EDGE_TOLERANCE_PX) {
        issues.push(issue(ISSUE_CODES.TEXT_OVERFLOW, SEVERITY.ERROR, node,
            `"${String(node.content).slice(0, 40)}" is ${Math.round(width - budget)} px wider than the space it has.`,
            { width, budget, fontSize: m.fontSize, lines: m.lines.length }));
    }
    if (node.size && num(node.size.h, 0) > 0 && m.height * scale > num(node.size.h, 0) * scale + EDGE_TOLERANCE_PX) {
        issues.push(issue(ISSUE_CODES.TEXT_OVERFLOW, SEVERITY.ERROR, node,
            `This text needs ${m.lines.length} lines and does not fit the height it was given.`,
            { height: m.height, budget: num(node.size.h, 0), fontSize: m.fontSize, lines: m.lines.length, vertical: true }));
    }
    const effective = m.fontSize * scale;
    if (effective > 0 && effective < scene.frame.h * MIN_TEXT_FRACTION) {
        issues.push(issue(ISSUE_CODES.TEXT_TOO_SMALL, SEVERITY.WARN, node,
            `At ${Math.round(effective)} px this text will be hard to read on a phone.`,
            { fontSize: effective, minimum: Math.round(scene.frame.h * MIN_TEXT_FRACTION) }));
    }
    const style = node.style || {};
    const hasBacking = !!style.stroke || !!style.textShadow || !!style.background || node.meta?.overBackdrop;
    if (!hasBacking && !opts.skipContrast) {
        const ratio = opts.backdropColor ? contrastRatio(style.color || '#ffffff', opts.backdropColor) : null;
        if (ratio === null || ratio < 4.5) {
            issues.push(issue(ISSUE_CODES.LOW_CONTRAST, SEVERITY.INFO, node,
                'This text has no outline or shadow, so it can disappear over a busy shot.',
                { color: style.color || '#ffffff', ratio: ratio === null ? null : round(ratio) }));
        }
    }
}

function checkPlacement(scene, entry, issues, opts) {
    const { node, box } = entry;
    if (!(box.w > 0) || !(box.h > 0)) return;
    const { w: fw, h: fh } = scene.frame;
    const outside = box.x < -EDGE_TOLERANCE_PX || box.y < -EDGE_TOLERANCE_PX
        || box.x + box.w > fw + EDGE_TOLERANCE_PX || box.y + box.h > fh + EDGE_TOLERANCE_PX;
    if (outside) {
        issues.push(issue(ISSUE_CODES.OUTSIDE_FRAME, SEVERITY.ERROR, node,
            'Part of this layer falls outside the frame and will be cut off.',
            { box: { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) }, frame: { w: fw, h: fh } }));
        return; // the safe-area report would only repeat it
    }
    if (node.constraints?.keepInSafeArea === false) return;
    const safe = contentRect(scene, opts);
    const intrudes = box.x < safe.x - EDGE_TOLERANCE_PX || box.y < safe.y - EDGE_TOLERANCE_PX
        || box.x + box.w > safe.x + safe.w + EDGE_TOLERANCE_PX || box.y + box.h > safe.y + safe.h + EDGE_TOLERANCE_PX;
    if (intrudes) {
        issues.push(issue(ISSUE_CODES.SAFE_AREA, SEVERITY.WARN, node,
            opts.safeZone
                ? 'This layer reaches into the area the platform covers with its own buttons and captions.'
                : 'This layer sits very close to the edge of the frame.',
            { box: { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) }, safe: { x: round(safe.x), y: round(safe.y), w: round(safe.w), h: round(safe.h) } }));
    }
}

function checkSource(entry, issues, opts) {
    const { node } = entry;
    if (node.type === NODE_TYPES.SHAPE) {
        if (node.vector) return; // Native vector shape definition
        if (!node.template?.kind) {
            issues.push(issue(ISSUE_CODES.UNKNOWN_TEMPLATE, SEVERITY.ERROR, node, 'This shape layer has no shape to draw.'));
        } else if (!TEMPLATE_KINDS.includes(node.template.kind)) {
            issues.push(issue(ISSUE_CODES.UNKNOWN_TEMPLATE, SEVERITY.ERROR, node,
                `"${node.template.kind}" is not a shape this version can draw.`, { kind: node.template.kind }));
        }
        return;
    }
    if (node.type === NODE_TYPES.IMAGE || node.type === NODE_TYPES.VIDEO || node.type === NODE_TYPES.STICKER) {
        const src = node.source || {};
        if (!src.assetId && !src.url) {
            issues.push(issue(ISSUE_CODES.MISSING_ASSET, SEVERITY.ERROR, node, 'This layer has no picture or video behind it.'));
        } else if (src.assetId && Array.isArray(opts.assets) && !opts.assets.some(a => a && a.id === src.assetId)) {
            issues.push(issue(ISSUE_CODES.MISSING_ASSET, SEVERITY.ERROR, node,
                'The file this layer uses is not in the project any more.', { assetId: src.assetId }));
        }
    }
}

function checkEffects(entry, issues) {
    const { node } = entry;
    for (const effect of node.effects || []) {
        if (!EFFECT_KINDS.includes(effect.kind)) {
            issues.push(issue(ISSUE_CODES.UNSUPPORTED_EFFECT, SEVERITY.WARN, node,
                `The "${effect.kind}" effect is not supported, so it will be ignored when exporting.`, { kind: effect.kind }));
        }
    }
    if (node.mask && !MASK_KINDS.includes(node.mask.kind)) {
        issues.push(issue(ISSUE_CODES.UNSUPPORTED_MASK, SEVERITY.WARN, node,
            `The "${node.mask.kind}" mask is not supported, so it will be ignored.`, { kind: node.mask.kind }));
    }
}

/**
 * Does this node actually hide what is under it? A drawn stroke — an
 * underline, an arrow, a burst, a circled callout — is decoration designed to
 * sit over or around text, so counting it as a collision would flag every
 * well-made accent. A card, a panel, an image or a filled box does hide
 * things, and two of those over each other is a real defect.
 */
function hidesWhatIsBehind(node) {
    if (node.type === NODE_TYPES.TEXT || node.type === NODE_TYPES.CAPTION) return true;
    if (node.type === NODE_TYPES.IMAGE || node.type === NODE_TYPES.STICKER) return true;
    if (node.type !== NODE_TYPES.SHAPE) return false;
    const kind = node.template?.kind;
    if (!kind) return false;
    if (SHAPE_KINDS.includes(kind)) return node.template?.params?.fill === true;
    return true; // a card: logo-card, quote-card, comparison-card, code-window…
}

/** Opaque things that fight for the same space. */
function checkCollisions(leaves, issues) {
    const solid = leaves.filter(e => e.box.w > 0 && e.box.h > 0 && num(e.abs.opacity, 1) > 0.35 && hidesWhatIsBehind(e.node));
    for (let i = 0; i < solid.length; i++) {
        for (let j = i + 1; j < solid.length; j++) {
            const a = solid[i];
            const b = solid[j];
            // Together on screen?
            const from = Math.max(a.start, b.start);
            const to = Math.min(a.end, b.end);
            if (to - from <= 0.1) continue;
            // A shape drawn deliberately behind its own text is not a collision.
            if (a.node.meta?.backdropFor === b.node.id || b.node.meta?.backdropFor === a.node.id) continue;
            if (a.node.mask?.nodeId === b.node.id || b.node.mask?.nodeId === a.node.id) continue;
            const area = overlapArea(a.box, b.box);
            if (area <= 0) continue;
            const share = area / Math.max(1, Math.min(a.box.w * a.box.h, b.box.w * b.box.h));
            if (share < COLLISION_SHARE) continue;
            issues.push(issue(ISSUE_CODES.LAYER_COLLISION, SEVERITY.WARN, a.node,
                `"${a.node.name}" and "${b.node.name}" cover each other on screen between ${round(from)} s and ${round(to)} s.`,
                { otherNodeId: b.node.id, otherNodeName: b.node.name, share: round(share), from: round(from), to: round(to) }));
        }
    }
}

// ─── Validate ────────────────────────────────────────────────────────────────

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

/**
 * Check a scene. Never throws.
 *
 * @param {object} scene
 * @param {{ safeZone?:{top,bottom,left,right}, margin?:number, assets?:Array,
 *           backdropColor?:string, skipContrast?:boolean, skipCollisions?:boolean }} [opts]
 * @returns {{ ok:boolean, issues:Array, counts:{error:number,warn:number,info:number}, shapeErrors:string[] }}
 */
export function validateScene(scene, opts = {}) {
    const issues = [];
    const shape = validateSceneShape(scene);
    if (!shape.valid) {
        for (const message of shape.errors) issues.push(issue(ISSUE_CODES.SHAPE_INVALID, SEVERITY.ERROR, null, message));
        // A malformed scene cannot be measured; report the structure and stop.
        return { ok: false, issues, counts: { error: issues.length, warn: 0, info: 0 }, shapeErrors: shape.errors };
    }

    const leaves = visibleLeaves(scene, opts);
    for (const entry of leaves) {
        checkContent(entry, issues);
        checkTiming(scene, entry, issues);
        checkText(scene, entry, issues, opts);
        checkPlacement(scene, entry, issues, opts);
        checkSource(entry, issues, opts);
        checkEffects(entry, issues);
    }
    if (!opts.skipCollisions) checkCollisions(leaves, issues);

    issues.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || a.code.localeCompare(b.code));
    const counts = { error: 0, warn: 0, info: 0 };
    for (const i of issues) counts[i.severity] += 1;
    return { ok: counts.error === 0, issues, counts, shapeErrors: [] };
}

// ─── Auto-fix ────────────────────────────────────────────────────────────────

function fixTextOverflow(scene, node, detail, opts) {
    const style = node.style || {};
    const m = textMetrics(scene, node, opts);
    const maxHeight = node.size && num(node.size.h, 0) > 0 ? num(node.size.h, 0) : scene.frame.h * 0.5;
    const fitted = fitTextToBox(node.content, { maxWidth: m.maxWidth, maxHeight }, {
        initialFontSize: num(style.fontSize, 48),
        fontFamily: style.fontFamily || 'Inter',
        fontWeight: style.fontWeight || 'normal',
        allowWrap: node.constraints?.allowWrap !== false,
    });
    const next = Math.max(1, Math.floor(num(fitted.fontSize, num(style.fontSize, 48))));
    if (next >= num(style.fontSize, 48)) return null;
    return {
        patch: { style: { ...style, fontSize: next } },
        message: `"${node.name}" was shrunk from ${Math.round(num(style.fontSize, 48))} px to ${next} px so the words fit.`,
    };
}

function fixPlacement(scene, node, box, target) {
    const { w: fw, h: fh } = scene.frame;
    let cx = box.cx;
    let cy = box.cy;
    // Centre it on the axis it cannot fit on, otherwise push it just inside.
    if (box.w >= target.w) cx = target.x + target.w / 2;
    else cx = Math.min(Math.max(cx, target.x + box.w / 2), target.x + target.w - box.w / 2);
    if (box.h >= target.h) cy = target.y + target.h / 2;
    else cy = Math.min(Math.max(cy, target.y + box.h / 2), target.y + target.h - box.h / 2);
    const dx = ((cx - box.cx) / fw) * 100;
    const dy = ((cy - box.cy) / fh) * 100;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null;
    return {
        patch: { transform: { ...node.transform, x: round(num(node.transform.x, 50) + dx, 3), y: round(num(node.transform.y, 50) + dy, 3) } },
        message: `"${node.name}" was moved back inside the frame.`,
        moved: { dx: round(dx, 3), dy: round(dy, 3) },
    };
}

/**
 * A shape or image bigger than the space it may use is shrunk to fit. Moving
 * it cannot help — that is the difference between "in the wrong place" and
 * "the wrong size", and reporting the first for the second is what makes a
 * validator feel broken.
 */
function fixOverlayFit(node, box, target) {
    if (!isOverlayType(node.type)) return null;
    if (!(box.w > 0) || !(box.h > 0)) return null;
    const factor = Math.min(target.w / box.w, target.h / box.h, 1);
    if (factor >= 0.999) return null;
    const scale = Math.max(0.01, Math.floor(num(node.transform.scale, 1) * factor * 10000) / 10000);
    if (scale >= num(node.transform.scale, 1)) return null;
    return {
        patch: { transform: { ...node.transform, scale } },
        message: `"${node.name}" was ${Math.round((1 - factor) * 100)}% too big for the frame and was scaled to fit.`,
    };
}

function fixTiming(node) {
    const duration = Math.max(0, num(node.duration, 0));
    if (!(duration > 0)) return null;
    let changed = false;
    const animations = (node.animations || []).map(anim => {
        const aDur = Math.max(0, num(anim.duration, 0));
        const aStart = Math.max(0, num(anim.startTime, 0));
        if (anim.anchor === 'out') {
            if (aDur > duration) { changed = true; return { ...anim, duration: round(duration, 3) }; }
            return anim;
        }
        // Keep the shape of the move: clamp the start first, then the length.
        const start = Math.min(aStart, Math.max(0, duration - Math.min(aDur, duration)));
        const dur = Math.min(aDur, Math.max(0, duration - start));
        if (Math.abs(start - aStart) > 1e-6 || Math.abs(dur - aDur) > 1e-6) {
            changed = true;
            return { ...anim, startTime: round(start, 3), duration: round(dur, 3) };
        }
        return anim;
    });
    return changed ? { patch: { animations }, message: `"${node.name}" had its animation timing brought inside its own length.` } : null;
}

/**
 * Apply the fixes that are a calculation rather than a design choice: shrink
 * text that does not fit, move a layer back inside the frame or out of the
 * platform's safe zone, clamp animation timing, give a layer with no life the
 * rest of the scene, and drop effects this build cannot render.
 *
 * Runs to a fixed point (at most 4 passes — shrinking text changes its box,
 * which can clear a safe-area issue). Whatever is left needs a human or
 * Phase 4's art direction, and comes back in `issues`.
 *
 * @returns {{ scene:object, fixes:Array<{code,nodeId,message}>, issues:Array, ok:boolean }}
 */
export function autoFixScene(scene, opts = {}) {
    let current = normalizeScene(scene);
    const fixes = [];
    if (!current) return { scene: null, fixes, issues: [issue(ISSUE_CODES.SHAPE_INVALID, SEVERITY.ERROR, null, 'scene could not be read')], ok: false };

    let report = validateScene(current, opts);
    for (let pass = 0; pass < 4 && report.issues.some(i => i.fix === 'auto'); pass++) {
        let appliedThisPass = 0;
        for (const item of report.issues) {
            if (item.fix !== 'auto' || !item.nodeId) continue;
            const entry = visibleLeaves(current, opts).find(e => e.node.id === item.nodeId);
            if (!entry) continue;
            const { node, box } = entry;
            let applied = null;

            if (item.code === ISSUE_CODES.TEXT_OVERFLOW) {
                applied = fixTextOverflow(current, node, item.detail, opts);
            } else if (item.code === ISSUE_CODES.OUTSIDE_FRAME || item.code === ISSUE_CODES.SAFE_AREA) {
                const target = item.code === ISSUE_CODES.SAFE_AREA
                    ? contentRect(current, opts)
                    : { x: 0, y: 0, w: current.frame.w, h: current.frame.h };
                // Too big is a different fault from in the wrong place: size first.
                applied = fixOverlayFit(node, box, target) || fixPlacement(current, node, box, target);
            } else if (item.code === ISSUE_CODES.TIMING_OUT_OF_RANGE) {
                applied = fixTiming(node);
            } else if (item.code === ISSUE_CODES.UNSUPPORTED_EFFECT) {
                const effects = (node.effects || []).filter(e => EFFECT_KINDS.includes(e.kind));
                applied = { patch: { effects }, message: `An unsupported effect was removed from "${node.name}".` };
            } else if (item.code === ISSUE_CODES.ZERO_DURATION) {
                const left = Math.max(0, num(current.duration, 0) - entry.start);
                if (left > 0.05) applied = { patch: { duration: round(left, 3) }, message: `"${node.name}" was given ${round(left)} s on screen.` };
            }

            if (!applied) continue;
            current = updateNode(current, node.id, applied.patch);
            fixes.push({ code: item.code, nodeId: node.id, message: applied.message });
            appliedThisPass += 1;
        }
        if (appliedThisPass === 0) break;
        current = normalizeScene(current);
        report = validateScene(current, opts);
    }
    return { scene: current, fixes, issues: report.issues, ok: report.ok };
}

/** One short line per issue, for the chat and the panel. Never throws. */
export function describeIssues(issues, limit = 4) {
    const list = Array.isArray(issues) ? issues : [];
    if (list.length === 0) return '';
    const head = list.slice(0, limit).map(i => i.message);
    const rest = list.length - head.length;
    return head.join(' ') + (rest > 0 ? ` And ${rest} more.` : '');
}

export default {
    SEVERITY,
    ISSUE_CODES,
    AUTO_FIXABLE,
    safeZoneForAspect,
    textMetrics,
    luminance,
    contrastRatio,
    contentRect,
    validateScene,
    autoFixScene,
    describeIssues,
};
