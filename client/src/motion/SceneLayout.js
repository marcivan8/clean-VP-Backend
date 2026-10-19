/**
 * client/src/motion/SceneLayout.js
 *
 * R95 — PHASE 2: where things go and how big they are.
 *
 * Until now a designed graphic hard-coded its own geometry: the subtitle sat
 * at `y + 14`, the headline was 56 px, the accent shape assumed a 1080-wide
 * frame. That works for exactly one frame shape and one length of text, which
 * is why a title sequence built for 16:9 put an 83%-wide underline through
 * TikTok's caption bar.
 *
 * This module replaces those constants with three things a designer actually
 * uses:
 *
 *   1. A TYPE SCALE relative to the frame, so a title is proportionally right
 *      in 16:9 and in 9:16 rather than a fixed pixel size that is huge in one
 *      and tiny in the other.
 *   2. A MEASURED STACK: items are measured, then stacked with gaps
 *      proportional to their own size, anchored inside the rectangle content
 *      may actually use. Nothing is positioned by a magic offset.
 *   3. ACCENT PLACEMENT derived from the text it decorates, in the frame it
 *      will be drawn in.
 *
 * Pure, no DOM: text goes through `TextMeasurement.js`, which uses a canvas
 * when there is one and deterministic metrics when there is not.
 *
 * Positions come back as PERCENT of the frame (what `clip.x`/`clip.y` and a
 * scene node's transform use); sizes are reference pixels (what
 * `clip.fontSize` and `templateSize()` use).
 */

import { measureTextBounds, fitTextToBox, computeAccentBounds } from './TextMeasurement.js';
import { OVERLAY_WIDTH_FRACTION, frameForAspect } from './SceneSchema.js';

/**
 * Type sizes as a fraction of the frame HEIGHT.
 *
 * Height, not width, because a taller frame carries proportionally larger
 * text — a vertical short's hook is enormous next to the same words in a
 * widescreen edit. The width then decides the FINAL size: `layoutStack` fits
 * every item to the space it has, which is how a designer works (pick the
 * scale, then make it fit the column).
 *
 * Calibrated against what the app already used: a caption at 48 px on a
 * 1080-high frame is 0.044, and that stays the caption role exactly.
 */
export const TYPE_SCALE = Object.freeze({
    display:  0.085,
    title:    0.065,
    stat:     0.100,
    subtitle: 0.034,
    caption:  0.044,
    label:    0.028,
    kicker:   0.026,
});

export const TYPE_ROLES = Object.keys(TYPE_SCALE);

/** Default weight and tracking per role — the hierarchy, not just the size. */
export const ROLE_STYLE = Object.freeze({
    display:  { fontWeight: 800, lineHeight: 1.05, tracking: -0.01 },
    title:    { fontWeight: 700, lineHeight: 1.1 },
    stat:     { fontWeight: 900, lineHeight: 1.0, tracking: -0.02 },
    subtitle: { fontWeight: 500, lineHeight: 1.25 },
    caption:  { fontWeight: 700, lineHeight: 1.2 },
    label:    { fontWeight: 700, lineHeight: 1.2, tracking: 0.04 },
    kicker:   { fontWeight: 700, lineHeight: 1.2, tracking: 0.08 },
});

/** Title-safe margin when no platform safe zone is supplied. */
const DEFAULT_MARGIN = 0.05;
/** Gap between stacked items, as a share of the larger neighbour's size. */
const DEFAULT_GAP_RATIO = 0.42;

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round = (v, p = 3) => Math.round(num(v, 0) * 10 ** p) / 10 ** p;

/** The frame for an aspect ratio or an explicit `{w,h}`. */
export function resolveFrame(frameOrAspect) {
    if (frameOrAspect && num(frameOrAspect.w, 0) > 0 && num(frameOrAspect.h, 0) > 0) {
        return { aspectRatio: frameOrAspect.aspectRatio || null, w: num(frameOrAspect.w, 0), h: num(frameOrAspect.h, 0) };
    }
    return frameForAspect(typeof frameOrAspect === 'string' ? frameOrAspect : frameOrAspect?.aspectRatio);
}

/** Every type size in reference pixels for this frame. */
export function typeScaleFor(frameOrAspect) {
    const frame = resolveFrame(frameOrAspect);
    const out = {};
    for (const role of TYPE_ROLES) out[role] = Math.round(TYPE_SCALE[role] * frame.h);
    return out;
}

/** One type size, with an explicit override winning. */
export function sizeForRole(frameOrAspect, role, explicit) {
    if (num(explicit, 0) > 0) return num(explicit, 0);
    const frame = resolveFrame(frameOrAspect);
    return Math.round((TYPE_SCALE[role] ?? TYPE_SCALE.title) * frame.h);
}

/**
 * The rectangle content may use, in reference pixels.
 * `safeZone` is the fractions of the frame to AVOID (platform chrome), as in
 * `PlatformProfiles.safeZone`.
 */
export function contentRectFor(frameOrAspect, safeZone = null, margin = DEFAULT_MARGIN) {
    const frame = resolveFrame(frameOrAspect);
    if (safeZone) {
        const left = num(safeZone.left, 0) * frame.w;
        const right = num(safeZone.right, 0) * frame.w;
        const top = num(safeZone.top, 0) * frame.h;
        const bottom = num(safeZone.bottom, 0) * frame.h;
        return { x: left, y: top, w: Math.max(1, frame.w - left - right), h: Math.max(1, frame.h - top - bottom) };
    }
    const m = num(margin, DEFAULT_MARGIN);
    return { x: frame.w * m, y: frame.h * m, w: frame.w * (1 - m * 2), h: frame.h * (1 - m * 2) };
}

/**
 * Measure one item at the size its role asks for, shrunk to fit the width it
 * has. This is the step the old hard-coded components skipped.
 *
 * @param {{role?:string, text?:string, fontSize?:number, fontFamily?:string,
 *          fontWeight?:number|string, lineHeight?:number, allowWrap?:boolean,
 *          maxLines?:number}} item
 * @param {{frame:object, maxWidth:number}} ctx
 * @returns {{fontSize:number, width:number, height:number, lines:string[], shrunk:boolean}}
 */
export function measureItem(item, ctx) {
    const frame = resolveFrame(ctx.frame);
    const role = TYPE_ROLES.includes(item.role) ? item.role : 'title';
    const roleStyle = ROLE_STYLE[role] || {};
    const requested = sizeForRole(frame, role, item.fontSize);
    const maxWidth = Math.max(1, num(ctx.maxWidth, frame.w));
    const allowWrap = item.allowWrap !== false;
    const maxLines = Math.max(1, num(item.maxLines, allowWrap ? 3 : 1));
    const font = {
        fontFamily: item.fontFamily || 'Inter',
        fontWeight: item.fontWeight ?? roleStyle.fontWeight ?? 'normal',
        lineHeight: num(item.lineHeight, roleStyle.lineHeight ?? 1.2),
    };
    const text = String(item.text ?? '');
    if (!text) return { fontSize: requested, width: 0, height: 0, lines: [], shrunk: false };

    // Height budget: as many lines as this item is allowed.
    const maxHeight = requested * font.lineHeight * maxLines;
    const fitted = fitTextToBox(text, { maxWidth, maxHeight }, { ...font, initialFontSize: requested, allowWrap });
    const fontSize = Math.max(1, Math.floor(num(fitted.fontSize, requested)));
    const bounds = measureTextBounds(text, { ...font, fontSize, maxWidth: allowWrap ? maxWidth : Infinity });
    return {
        fontSize,
        width: bounds.width,
        height: bounds.height,
        lines: bounds.lines,
        shrunk: fontSize < requested,
    };
}

/**
 * Stack items vertically inside a rectangle and return each one's position.
 *
 * Gaps are proportional to the larger of the two neighbours, so a display
 * headline breathes and a kicker sits close to what it introduces. The whole
 * block is then placed by `anchor` and, if it is taller than the rectangle,
 * the gaps tighten before anything is allowed to spill — a block that does
 * not fit is a layout problem, not something to push off the frame.
 *
 * @param {{frame:object, rect?:object, items:Array, anchor?:'centre'|'top'|'bottom',
 *          gapRatio?:number, align?:string, maxWidthFrac?:number}} spec
 * @returns {{items:Array, blockHeight:number, top:number, bottom:number, rect:object, overflowed:boolean}}
 */
export function layoutStack(spec = {}) {
    const frame = resolveFrame(spec.frame);
    const rect = spec.rect && num(spec.rect.w, 0) > 0 ? spec.rect : contentRectFor(frame);
    const maxWidth = num(spec.maxWidthFrac, 0) > 0 ? Math.min(rect.w, spec.maxWidthFrac * frame.w) : rect.w;
    const gapRatio = num(spec.gapRatio, DEFAULT_GAP_RATIO);
    const list = (Array.isArray(spec.items) ? spec.items : []).filter(it => it && String(it.text ?? '').trim());

    const measured = list.map(item => ({ ...item, ...measureItem(item, { frame, maxWidth }) }));
    if (measured.length === 0) {
        return { items: [], blockHeight: 0, top: rect.y, bottom: rect.y, rect, overflowed: false };
    }

    const gapBefore = measured.map((item, i) => {
        if (i === 0) return 0;
        if (num(item.gapBefore, -1) >= 0) return num(item.gapBefore, 0);
        return Math.round(Math.max(item.fontSize, measured[i - 1].fontSize) * gapRatio);
    });

    const contentHeight = measured.reduce((sum, item) => sum + item.height, 0);
    const gapTotal = gapBefore.reduce((a, b) => a + b, 0);
    let blockHeight = contentHeight + gapTotal;
    let tighten = 1;
    if (blockHeight > rect.h && gapTotal > 0) {
        // Close the gaps first, down to a quarter, before giving up.
        tighten = Math.max(0.25, (rect.h - contentHeight) / gapTotal);
        blockHeight = contentHeight + gapTotal * tighten;
    }
    const overflowed = blockHeight > rect.h + 1;

    let top;
    if (spec.anchor === 'top') top = rect.y;
    else if (spec.anchor === 'bottom') top = rect.y + rect.h - blockHeight;
    else top = rect.y + (rect.h - blockHeight) / 2;
    if (overflowed) {
        // The block is taller than the band it was given. Grow AWAY from
        // whatever the band was avoiding: a band above the subject grows
        // upward into the margin, a band below it grows downward. Growing the
        // other way would put the text over the thing the band exists to
        // keep clear of.
        const frameH = frame.h;
        if (spec.anchor === 'top') top = Math.max(0, rect.y + rect.h - blockHeight);
        else if (spec.anchor === 'bottom') top = Math.min(frameH - blockHeight, rect.y);
        else top = Math.max(0, Math.min(frameH - blockHeight, rect.y + (rect.h - blockHeight) / 2));
    }

    let cursor = top;
    const placed = measured.map((item, i) => {
        cursor += gapBefore[i] * tighten;
        const centreY = cursor + item.height / 2;
        const out = {
            ...item,
            // Percent of the frame, ready for a node transform or a clip.
            y: round((centreY / frame.h) * 100),
            top: round(cursor, 2),
            centreY: round(centreY, 2),
            maxWidth,
        };
        cursor += item.height;
        return out;
    });

    return { items: placed, blockHeight: round(blockHeight, 2), top: round(top, 2), bottom: round(cursor, 2), rect, overflowed };
}

/**
 * Where an accent shape goes for a laid-out text item, in the frame it will
 * actually be drawn in.
 *
 * `computeAccentBounds` returns the shape's natural pixel size; the renderers
 * draw an overlay at a fraction of the FRAME WIDTH times `clip.scale`, so the
 * scale has to be derived from this frame. That conversion used to assume
 * 1080 px wide, which is why an underline built for a widescreen edit came
 * out 83% of the width of a vertical one.
 *
 * @param {object} item a laid-out item from `layoutStack`
 * @param {{frame:object, shapeKind:string, offsetRatio?:number, fill?:boolean}} opts
 * @returns {{kind:string, w:number, h:number, scale:number, thickness:number, x:number, y:number}}
 */
export function accentFor(item, opts = {}) {
    const frame = resolveFrame(opts.frame);
    const shapeKind = opts.shapeKind || 'underline';
    const accent = computeAccentBounds(String(item?.text ?? ''), {
        shapeKind,
        fontSize: item?.fontSize,
        fontFamily: item?.fontFamily || 'Inter',
        fontWeight: item?.fontWeight ?? 700,
        maxWidth: num(item?.maxWidth, frame.w),
        frameWidth: frame.w,
    });
    // An underline sits under the last line; a box or circle wraps the text.
    const offsetRatio = num(opts.offsetRatio, shapeKind === 'underline' ? 0.62 : 0);
    const dy = (num(item?.height, 0) / 2 + num(accent.h, 0) * offsetRatio) * (offsetRatio > 0 ? 1 : 0);
    const y = round(num(item?.y, 50) + (dy / frame.h) * 100);

    // R103 round C — cover the text that was ACTUALLY laid out.
    //
    // computeAccentBounds re-measures the string on its own, independently of
    // the measurement layoutStack already did, and the two disagree as soon as
    // the text wraps. Measured on a 9:16 frame: a three-line headline laid out
    // at 494x319 got a highlight-box of 365x254 — a box sized to sit INSIDE
    // the headline rather than around it, and an underline spanning 71% of the
    // words above it. Two lines could come out either way (one case +14/+34,
    // another -43/-5), so the error was not even consistent in direction.
    //
    // When the caller passes an item that layoutStack has already measured
    // (`width`/`height` present), those bounds ARE the truth and are used
    // directly.
    //
    // Round C took the larger of the two instead, which was the cautious
    // choice at the time but assumed computeAccentBounds could only ever
    // under-estimate. It can over-estimate too, and badly: it measures the
    // string as ONE unwrapped line. "Launch Day" laid out as two lines of
    // 587px got an accent sized for its 978px single-line width — 1012px of
    // a 1080px frame, breaching the safe area and tripping the validator's
    // repair pass. Growing-only could not correct that, because the error
    // was in the other direction.
    //
    // An unmeasured item (the legacy callers that pass a bare string) is
    // unaffected and still uses computeAccentBounds as before.
    const measuredW = num(item?.width, 0);
    const measuredH = num(item?.height, 0);
    let w = num(accent.w, 0);
    let h = num(accent.h, 0);
    if (measuredW > 0) {
        const fontSize = num(item?.fontSize, 40);
        // The accent may never exceed the measure its text was laid out to.
        // Clamping to the frame is not enough: the content rect is not
        // centred in the frame (on 9:16 it runs 54..994, so its midpoint sits
        // 16px left of the frame's), which means a shape centred at x=50% and
        // wider than the measure overruns the right edge while still being
        // "inside the frame". That is how a 924px box in a 940px rect still
        // breached the safe area. The measure is always safely inside it.
        const limit = Math.min(frame.w, num(item?.maxWidth, frame.w));
        if (shapeKind === 'underline') {
            // A rule under the words spans the words — no padding, and the
            // widest line is what it should span, not the unwrapped string.
            w = Math.min(limit, measuredW);
        } else {
            // A box, burst or circle wraps the block, with breathing room
            // proportional to the type rather than a fixed pixel pad.
            w = Math.min(limit, measuredW + fontSize * 0.6);
            h = measuredH + fontSize * 0.4;
        }
    }

    return {
        kind: shapeKind,
        w,
        h,
        // scale is the factor from the renderer's base overlay width up to w,
        // so it has to be derived from the final width, not carried over.
        scale: round(w / (frame.w * OVERLAY_WIDTH_FRACTION), 4),
        thickness: accent.thickness,
        x: round(num(opts.x, 50)),
        y,
    };
}

/**
 * A full-bleed or boxed backdrop panel behind a block of text, sized from the
 * block rather than guessed. Returns what a `panel` template node needs.
 */
export function backdropFor(block, opts = {}) {
    const frame = resolveFrame(opts.frame);
    const items = Array.isArray(block?.items) ? block.items : [];
    if (items.length === 0) return null;
    const widest = Math.max(...items.map(i => num(i.width, 0)));
    const padX = num(opts.padX, Math.round(Math.max(...items.map(i => num(i.fontSize, 40))) * 0.6));
    const padY = num(opts.padY, Math.round(Math.max(...items.map(i => num(i.fontSize, 40))) * 0.5));
    const w = Math.min(frame.w, Math.round(widest + padX * 2));
    const h = Math.round(num(block.blockHeight, 0) + padY * 2);
    const centreY = (num(block.top, 0) + num(block.bottom, 0)) / 2;
    return {
        kind: 'panel',
        w,
        h,
        scale: round(w / (frame.w * OVERLAY_WIDTH_FRACTION), 4),
        x: round(num(opts.x, 50)),
        y: round((centreY / frame.h) * 100),
    };
}

/**
 * Keep a box inside a rectangle, returning the percent position it should
 * move to. Used by layout rather than by the validator's repair pass.
 */
export function clampIntoRect(box, rect, frame) {
    const f = resolveFrame(frame);
    const cx = num(box.cx, f.w / 2);
    const cy = num(box.cy, f.h / 2);
    const w = num(box.w, 0);
    const h = num(box.h, 0);
    const x = w >= rect.w ? rect.x + rect.w / 2 : Math.min(Math.max(cx, rect.x + w / 2), rect.x + rect.w - w / 2);
    const y = h >= rect.h ? rect.y + rect.h / 2 : Math.min(Math.max(cy, rect.y + h / 2), rect.y + rect.h - h / 2);
    return { x: round((x / f.w) * 100), y: round((y / f.h) * 100) };
}

export default {
    TYPE_SCALE,
    TYPE_ROLES,
    ROLE_STYLE,
    resolveFrame,
    typeScaleFor,
    sizeForRole,
    contentRectFor,
    measureItem,
    layoutStack,
    accentFor,
    backdropFor,
    clampIntoRect,
};
