/**
 * client/src/motion/SceneComposer.js
 *
 * R95 — PHASE 2: the designed graphics, composed as scenes.
 *
 * `ComponentLibrary.js` built its graphics by hand: a headline at 56 px, a
 * subtitle at `y + 14`, an accent sized against an assumed 1080-wide frame.
 * This module builds the same four graphics as SCENES instead:
 *
 *   • sizes come from the type scale for the real frame (`SceneLayout`),
 *   • positions come from measuring the text and stacking it inside the
 *     rectangle content may actually use,
 *   • the accent is measured from the text it decorates, in the frame it will
 *     be drawn in,
 *   • motion comes from `MotionComposer`'s verbs with a real stagger, so the
 *     layers arrive as one piece of design rather than three things that
 *     happen to animate at once.
 *
 * `ComponentLibrary.buildComponent` delegates here and flattens the result,
 * so every existing caller gets the better layout with no change, and the
 * scene is available for the editor and the validator.
 *
 * A LOOK is the art direction for one preset: palette, fonts, which accent
 * shape, and the motion verbs per role. That table is the thing Phase 4's
 * director will choose from rather than hard-code.
 */

import {
    createScene,
    createGroup,
    createNode,
    normalizeScene,
    NODE_TYPES,
} from './SceneSchema.js';
import {
    resolveFrame,
    contentRectFor,
    layoutStack,
    accentFor,
    backdropFor,
    sizeForRole,
    ROLE_STYLE,
} from './SceneLayout.js';
import { composeMotion, VERBS } from './MotionComposer.js';

/**
 * How wide a block of text may run, as a share of the frame width — the
 * measure. A headline that spans the whole frame is hard to read and looks
 * cheap; 0.46 is what the hand-built components used (880 px of 1920) and it
 * holds up as a rule rather than a coincidence. Captions are the exception:
 * they already span 0.8 everywhere else in the app.
 */
export const MEASURE = Object.freeze({
    display: 0.46, title: 0.46, stat: 0.46, subtitle: 0.52, kicker: 0.5, label: 0.5, caption: 0.8,
});

/** Lines a role may wrap to before it has to shrink instead. */
const MAX_LINES = Object.freeze({ display: 2, title: 2, stat: 1, subtitle: 2, kicker: 1, label: 1, caption: 2 });

/** Seconds between one layer arriving and the next. */
const STAGGER = 0.12;

/**
 * Text in a video sits over moving footage, so it needs something to lift it
 * off the picture or it disappears over a bright or busy shot. A shadow is
 * enough for supporting text; the big roles get an outline too, sized from
 * the type rather than a fixed pixel value.
 */
const TEXT_SHADOW = '0 4px 18px rgba(0,0,0,0.55)';
const OUTLINED_ROLES = new Set(['display', 'stat', 'title']);

/**
 * The art direction per component and preset. `motion` names the verbs per
 * role; `accent` the shape measured from the text; `palette` the colours.
 */
export const LOOKS = {
    TitleSequence: {
        cinematic: {
            palette: { text: '#ffffff', sub: '#E2E8F0', kicker: '#A0AEC0', accent: '#FFE500' },
            fonts: { display: 'Montserrat', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'underline',
            motion: { enter: 'rise-in', emphasis: null, exit: 'fade-out', energy: 0.5 },
        },
        'modern-bold': {
            palette: { text: '#ffffff', sub: '#E2E8F0', kicker: '#00E5FF', accent: '#00E5FF' },
            fonts: { display: 'Montserrat', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'highlight-box',
            motion: { enter: 'pop-in', emphasis: 'punch', exit: 'whip-out', energy: 0.75 },
        },
        minimal: {
            palette: { text: '#ffffff', sub: '#A0AEC0', kicker: '#A0AEC0', accent: '#ffffff' },
            fonts: { display: 'Inter', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'underline',
            motion: { enter: 'fade-in', emphasis: null, exit: 'fade-out', energy: 0.3 },
        },
        // R101 — a fourth, serif-led look so "editorial" and "warm" briefs
        // have somewhere to go besides the same two sans-serif treatments
        // every other tone already uses.
        'editorial-serif': {
            palette: { text: '#F5EFE3', sub: '#D9CBB0', kicker: '#C8A96A', accent: '#C8A96A' },
            fonts: { display: 'Playfair Display', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'underline',
            motion: { enter: 'blur-in', emphasis: null, exit: 'fade-out', energy: 0.35 },
        },
    },
    KineticTitle: {
        punchy: {
            palette: { text: '#FFE500', sub: '#ffffff', kicker: '#ffffff', accent: '#FFE500' },
            fonts: { display: 'Anton', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'burst',
            motion: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out', energy: 0.85 },
        },
        creator: {
            palette: { text: '#ffffff', sub: '#ffffff', kicker: '#00E5FF', accent: '#FF3B5C' },
            fonts: { display: 'Anton', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'highlight-box',
            motion: { enter: 'pop-in', emphasis: 'wobble', exit: 'shrink-out', energy: 0.7 },
        },
        // R101 — a third point/CTA look built around a display face with a
        // genuinely different personality (Orbitron, not another grotesque),
        // for "technology" and "viral" briefs to alternate into across a
        // sequence's repeated point beats instead of reusing one preset.
        futurist: {
            palette: { text: '#ffffff', sub: '#9FF4FF', kicker: '#00E5FF', accent: '#00E5FF' },
            fonts: { display: 'Orbitron', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'burst',
            motion: { enter: 'zoom-in', emphasis: 'punch', exit: 'whip-out', energy: 0.8 },
        },
        refined: {
            palette: { text: '#ffffff', sub: '#E2E8F0', kicker: '#C8A96A', accent: '#C8A96A' },
            fonts: { display: 'Montserrat', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'underline',
            motion: { enter: 'rise-in', emphasis: 'punch', exit: 'fade-out', energy: 0.5 },
        },
    },
    StatCallout: {
        'metric-callout': {
            palette: { text: '#00E5FF', sub: '#ffffff', kicker: '#A0AEC0', accent: '#00E5FF' },
            fonts: { display: 'Montserrat', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'circle-callout',
            motion: { enter: 'pop-in', emphasis: 'pulse', exit: 'shrink-out', energy: 0.7 },
        },
        growth: {
            palette: { text: '#10B981', sub: '#ffffff', kicker: '#A0AEC0', accent: '#10B981' },
            fonts: { display: 'Montserrat', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'underline',
            motion: { enter: 'rise-in', emphasis: 'punch', exit: 'fade-out', energy: 0.6 },
        },
        // R101 — a bolder, high-contrast number treatment to alternate with
        // metric-callout when a sequence calls out more than one figure.
        'bold-ticker': {
            palette: { text: '#0E0F11', sub: '#3A4350', kicker: '#0E0F11', accent: '#FFE500' },
            fonts: { display: 'Bebas Neue', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'highlight-box',
            motion: { enter: 'zoom-in', emphasis: 'bounce', exit: 'whip-out', energy: 0.8 },
        },
    },
    LowerThird: {
        'pro-minimal': {
            palette: { text: '#ffffff', sub: '#CBD5E1', kicker: '#CBD5E1', accent: '#00E5FF' },
            fonts: { display: 'Inter', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'underline',
            motion: { enter: 'slide-in', emphasis: null, exit: 'fade-out', energy: 0.45 },
        },
        'modern-line': {
            palette: { text: '#ffffff', sub: '#CBD5E1', kicker: '#CBD5E1', accent: '#FFE500' },
            fonts: { display: 'Inter', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'highlight-box',
            motion: { enter: 'slide-in', emphasis: null, exit: 'fade-out', energy: 0.45 },
        },
        // R101 — a softer, name-card look distinct from the two line-led
        // presets above.
        'editorial-name': {
            palette: { text: '#ffffff', sub: '#F5EFE3', kicker: '#F5EFE3', accent: '#F5EFE3' },
            fonts: { display: 'Poppins', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'underline',
            motion: { enter: 'drop-in', emphasis: 'nod', exit: 'fade-out', energy: 0.5 },
        },
    },
};

/** The component ids this module composes. Everything else stays as it was. */
export const COMPOSED_COMPONENTS = Object.keys(LOOKS);

const DEFAULT_DURATION = { TitleSequence: 4, KineticTitle: 3, StatCallout: 3.5, LowerThird: 4 };

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * R101 — validate a motion OVERRIDE field by field against MotionComposer's
 * own verb vocabulary, falling back to the look's own value for any field
 * that is missing or names something that is not a real verb in the right
 * slot. This is what lets a beat suggest its own motion (from an LLM, or a
 * future editor UI) without a bad or hostile value ever reaching
 * `composeMotion` — the same "clean what a model hands back, field by
 * field, never all-or-nothing" discipline motionRoutes.js already applies
 * to on-screen text.
 *
 * @param {object} raw {enter?, emphasis?, exit?, energy?}
 * @param {{enter:string, emphasis:string|null, exit:string|null, energy:number}} fallback the look's own motion
 */
export function cleanMotionOverride(raw, fallback) {
    if (!raw || typeof raw !== 'object') return fallback;
    const isVerb = (name, group) => typeof name === 'string' && VERBS[name]?.group === group;
    const enter = isVerb(raw.enter, 'in') ? raw.enter : fallback.enter;
    const emphasis = raw.emphasis === null ? null : (isVerb(raw.emphasis, 'emphasis') ? raw.emphasis : fallback.emphasis);
    const exit = raw.exit === null ? null : (isVerb(raw.exit, 'out') ? raw.exit : fallback.exit);
    const energy = Number.isFinite(Number(raw.energy)) ? Math.min(1, Math.max(0, Number(raw.energy))) : fallback.energy;
    return { enter, emphasis, exit, energy };
}

/** A look, with `params` allowed to override any colour, the display font (a
 *  caller with its own brand type, like a platform's hook title, keeps its
 *  font while still getting the preset's measured layout and accent), and —
 *  R101 — the motion itself (`params.motion`), so a beat the director or an
 *  LLM decided should move differently can, without picking a whole new
 *  preset just to get a different verb. */
function resolveLook(componentId, presetId, params = {}) {
    const table = LOOKS[componentId];
    if (!table) return null;
    const look = table[presetId] || table[Object.keys(table)[0]];
    const palette = {
        ...look.palette,
        ...(params.color ? { text: params.color } : {}),
        ...(params.subColor ? { sub: params.subColor } : {}),
        ...(params.kickerColor ? { kicker: params.kickerColor } : {}),
        ...(params.accentColor ? { accent: params.accentColor } : {}),
        ...(params.statColor ? { text: params.statColor } : {}),
        ...(params.labelColor ? { sub: params.labelColor } : {}),
    };
    const fonts = params.fontFamily ? { ...look.fonts, display: params.fontFamily } : look.fonts;
    const motion = params.motion ? cleanMotionOverride(params.motion, look.motion) : look.motion;
    return { ...look, palette, fonts, accent: params.accent || look.accent, motion };
}

/**
 * Motion for one layer: the look's verbs, with the whole program pushed back
 * by this layer's place in the stagger. That is what makes the layers read as
 * one move rather than three.
 */
function motionFor(look, { duration, index = 0, stagger = STAGGER, emphasis = true }) {
    const at = Math.min(index * stagger, Math.max(0, duration * 0.3));
    const beats = [{ verb: look.motion.enter, at, energy: look.motion.energy }];
    const hasRoom = duration >= 2.2 && (at + 0.95 < duration - 0.4);
    if (emphasis && look.motion.emphasis && hasRoom) {
        beats.push({ verb: look.motion.emphasis, at: Math.min(at + duration * 0.45, Math.max(at + 0.2, duration - 0.7)), energy: look.motion.energy * 0.8 });
    }
    if (look.motion.exit) beats.push({ verb: look.motion.exit, energy: look.motion.energy });
    const { animations } = composeMotion({ beats }, { duration, kind: 'text' });
    return animations;
}

/** A laid-out text item as a scene node. */
function textNode(item, { role, look, colour, duration, index, align, origin, x = 50, frame }) {
    const roleStyle = ROLE_STYLE[role] || {};
    const outline = look.outline !== false && OUTLINED_ROLES.has(role)
        ? { width: Math.max(2, Math.round(num(item.fontSize, 48) * 0.045)), color: '#000000' }
        : null;
    // Record the measure the LAYOUT actually used, so the validator checks
    // this text against the same budget rather than a wider guess.
    const usedFrac = frame && num(item.maxWidth, 0) > 0 ? Math.round((item.maxWidth / frame.w) * 1000) / 1000 : num(item.maxWidthFrac, 0) || undefined;
    return createNode(NODE_TYPES.TEXT, {
        name: item.name || role.charAt(0).toUpperCase() + role.slice(1),
        content: item.text,
        start: 0,
        duration,
        transform: { x: num(item.x, x), y: item.y },
        style: {
            fontFamily: item.fontFamily,
            fontSize: item.fontSize,
            fontWeight: item.fontWeight ?? roleStyle.fontWeight ?? 700,
            // Carried explicitly: the validator measures this text again, and
            // without the same line height it computes a taller box than the
            // layout did and reports a safe-area breach that is not real.
            lineHeight: num(item.lineHeight, roleStyle.lineHeight ?? 1.2),
            color: colour,
            ...(align ? { textAlign: align } : {}),
            ...(roleStyle.tracking !== undefined ? { tracking: roleStyle.tracking } : {}),
            ...(item.stroke || outline ? { stroke: item.stroke || outline } : {}),
            textShadow: item.textShadow || TEXT_SHADOW,
        },
        constraints: { maxWidthFrac: usedFrac, allowWrap: item.allowWrap !== false, maxLines: item.maxLines },
        animations: motionFor(look, { duration, index }),
        origin,
    });
}

/** A measured accent shape as a scene node. */
function accentNode(accent, { look, duration, index, origin, backdropFor: backdropForId }) {
    return createNode(NODE_TYPES.SHAPE, {
        name: accent.kind,
        start: 0,
        duration,
        transform: { x: accent.x, y: accent.y, scale: accent.scale },
        size: { w: accent.w, h: accent.h },
        template: {
            kind: accent.kind,
            params: {
                color: look.palette.accent,
                thickness: accent.thickness,
                w: accent.w,
                h: accent.h,
                ...(accent.params || {}),
            },
        },
        animations: motionFor(look, { duration, index, emphasis: false }),
        // Tells the validator this shape is decoration for that text, not a
        // layer fighting it for the same space.
        meta: backdropForId ? { backdropFor: backdropForId } : {},
        origin,
    });
}

/**
 * An accent that WRAPS its text (a box, a circle) is bigger than the text by
 * its own padding, so the text has to be laid out inside a slightly smaller
 * rectangle or the accent breaches the safe area even though the words do
 * not. Estimated from the role's type size, which is enough: the validator
 * catches anything this misses.
 */
const WRAPPING_ACCENTS = new Set(['highlight-box', 'circle-callout']);

function rectForLook(frame, look, safeZone) {
    const rect = contentRectFor(frame, safeZone || null);
    if (!WRAPPING_ACCENTS.has(look?.accent)) return rect;
    const inset = Math.round(sizeForRole(frame, 'display') * 0.34);
    return { x: rect.x, y: rect.y + inset, w: rect.w, h: Math.max(1, rect.h - inset * 2) };
}

/** Shared setup: frame, content rectangle, duration, look. */
function sceneContext(componentId, presetId, params, opts) {
    const frame = resolveFrame(opts.frame || opts.aspectRatio || '16:9');
    const look = resolveLook(componentId, presetId, params);
    return {
        frame,
        rect: opts.rect || rectForLook(frame, look, opts.safeZone),
        duration: Math.max(0.5, num(params.duration, DEFAULT_DURATION[componentId] || 4)),
        look,
        origin: { componentId, presetId },
    };
}

/** Title sequence: optional kicker, headline with an accent, optional subtitle. */
function composeTitleSequence(params, ctx) {
    const { frame, rect, duration, look, origin } = ctx;
    const title = String(params.title || params.headline || params.text || 'THE HEADLINE');
    const items = [];
    if (params.kicker) items.push({ key: 'kicker', role: 'kicker', text: String(params.kicker), fontFamily: look.fonts.kicker, maxWidthFrac: MEASURE.kicker, maxLines: 1 });
    items.push({ key: 'title', role: 'display', text: title, fontFamily: look.fonts.display, fontWeight: 800, fontSize: params.fontSize, maxWidthFrac: MEASURE.display, maxLines: MAX_LINES.display });
    if (params.subtitle || params.sub) items.push({ key: 'subtitle', role: 'subtitle', text: String(params.subtitle || params.sub), fontFamily: look.fonts.subtitle, maxWidthFrac: MEASURE.subtitle, maxLines: MAX_LINES.subtitle });

    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'centre', maxWidthFrac: MEASURE.display });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const titleItem = placed.title;

    const nodes = [];
    // The accent is measured from the headline, in this frame.
    const accent = accentFor({ ...titleItem, maxWidth: MEASURE.display * frame.w }, { frame, shapeKind: look.accent, x: num(params.x, 50) });
    const titleId = `title-${origin.componentId}`;
    nodes.push(accentNode({ ...accent, params: look.accent === 'highlight-box' ? { fill: false } : {} }, { look, duration, index: 0, origin: { ...origin, role: 'accent' }, backdropFor: titleId }));
    if (placed.kicker) nodes.push(textNode(placed.kicker, { role: 'kicker', look, colour: look.palette.kicker, duration, index: 1, origin: { ...origin, role: 'kicker' }, x: num(params.x, 50), frame }));
    const titleNode = textNode(titleItem, { role: 'display', look, colour: look.palette.text, duration, index: placed.kicker ? 2 : 1, origin: { ...origin, role: 'title' }, x: num(params.x, 50), frame });
    titleNode.id = titleId;
    nodes.push(titleNode);
    if (placed.subtitle) nodes.push(textNode(placed.subtitle, { role: 'subtitle', look, colour: look.palette.sub, duration, index: nodes.length, origin: { ...origin, role: 'subtitle' }, x: num(params.x, 50), frame }));

    // An optional backdrop, sized from the block rather than guessed.
    if (params.backdrop) {
        const panel = backdropFor(block, { frame, x: num(params.x, 50) });
        if (panel) {
            nodes.unshift(createNode(NODE_TYPES.SHAPE, {
                name: 'Backdrop', start: 0, duration,
                transform: { x: panel.x, y: panel.y, scale: panel.scale },
                size: { w: panel.w, h: panel.h },
                template: { kind: 'panel', params: { w: panel.w, h: panel.h, color: params.backdropColor || '#0E0F11', color2: params.backdropColor2 || null, opacity: num(params.backdropOpacity, 0.72), radius: 28, reveal: 'wipe' } },
                animations: motionFor(look, { duration, index: 0, emphasis: false }),
                meta: { backdropFor: titleId },
                origin: { ...origin, role: 'backdrop' },
            }));
        }
    }
    return nodes;
}

/** Kinetic title: a kicker over a heavy headline, with a decorative accent. */
function composeKineticTitle(params, ctx) {
    const { frame, rect, duration, look, origin } = ctx;
    const headline = String(params.title || params.headline || params.text || 'SCALE 10X');
    const userHeadline = params.title || params.headline || params.text;
    const kicker = params.kicker || params.lead || (userHeadline ? null : 'HOW TO');
    const items = [];
    if (kicker) items.push({ key: 'kicker', role: 'kicker', text: String(kicker), fontFamily: look.fonts.kicker, maxWidthFrac: MEASURE.kicker, maxLines: 1 });
    items.push({ key: 'headline', role: 'display', text: headline, fontFamily: look.fonts.display, fontWeight: 900, fontSize: params.fontSize, maxWidthFrac: MEASURE.display, maxLines: MAX_LINES.display });

    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'centre', maxWidthFrac: MEASURE.display, gapRatio: 0.3 });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const headlineItem = placed.headline;
    const headlineId = `headline-${origin.componentId}`;

    const nodes = [];
    if (placed.kicker) nodes.push(textNode(placed.kicker, { role: 'kicker', look, colour: look.palette.kicker, duration, index: 0, origin: { ...origin, role: 'kicker' }, x: num(params.x, 50), frame }));
    const headlineNode = textNode(headlineItem, { role: 'display', look, colour: look.palette.text, duration, index: placed.kicker ? 1 : 1, origin: { ...origin, role: 'headline' }, x: num(params.x, 50), frame });
    headlineNode.id = headlineId;
    nodes.push(headlineNode);

    const accent = accentFor({ ...headlineItem, maxWidth: MEASURE.display * frame.w }, {
        frame,
        shapeKind: look.accent,
        x: look.accent === 'burst' ? num(params.x, 50) + 22 : num(params.x, 50),
        offsetRatio: 0,
    });
    nodes.push(accentNode({ ...accent, scale: look.accent === 'burst' ? 1 : accent.scale, params: look.accent === 'highlight-box' ? { fill: false } : {} },
        { look, duration, index: nodes.length, origin: { ...origin, role: 'accent' }, backdropFor: headlineId }));

    if (params.backdrop) {
        const panel = backdropFor(block, { frame, x: num(params.x, 50) });
        if (panel) {
            nodes.unshift(createNode(NODE_TYPES.SHAPE, {
                name: 'Backdrop', start: 0, duration,
                transform: { x: panel.x, y: panel.y, scale: panel.scale },
                size: { w: panel.w, h: panel.h },
                template: { kind: 'panel', params: { w: panel.w, h: panel.h, color: params.backdropColor || '#0E0F11', color2: params.backdropColor2 || null, opacity: num(params.backdropOpacity, 0.72), radius: 24, reveal: 'wipe' } },
                animations: motionFor(look, { duration, index: 0, emphasis: false }),
                meta: { backdropFor: headlineId },
                origin: { ...origin, role: 'backdrop' },
            }));
        }
    }

    return nodes;
}

/** Stat callout: the figure, its accent, and a label under it. */
function composeStatCallout(params, ctx) {
    const { frame, rect, duration, look, origin } = ctx;
    const stat = String(params.value || params.stat || '+00%');
    const label = String(params.label || params.text || 'YOUR METRIC');
    const items = [
        { key: 'stat', role: 'stat', text: stat, fontFamily: look.fonts.display, fontWeight: 900, fontSize: params.fontSize, maxWidthFrac: MEASURE.stat, maxLines: 1, allowWrap: false },
        { key: 'label', role: 'label', text: label, fontFamily: look.fonts.subtitle, maxWidthFrac: MEASURE.label, maxLines: 1 },
    ];
    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'centre', maxWidthFrac: MEASURE.stat, gapRatio: 0.55 });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const statId = `stat-${origin.componentId}`;

    const accent = accentFor({ ...placed.stat, maxWidth: MEASURE.stat * frame.w }, { frame, shapeKind: look.accent, x: num(params.x, 50) });
    const nodes = [
        accentNode(accent, { look, duration, index: 0, origin: { ...origin, role: 'accent' }, backdropFor: statId }),
    ];
    const statNode = textNode(placed.stat, { role: 'stat', look, colour: look.palette.text, duration, index: 1, origin: { ...origin, role: 'stat' }, x: num(params.x, 50), frame });
    statNode.id = statId;
    nodes.push(statNode);
    if (placed.label) nodes.push(textNode(placed.label, { role: 'label', look, colour: look.palette.sub, duration, index: 2, origin: { ...origin, role: 'label' }, x: num(params.x, 50), frame }));
    return nodes;
}

/** Lower third: a name with an accent rule, and a role under it, bottom-anchored. */
function composeLowerThird(params, ctx) {
    const { frame, rect, duration, look, origin } = ctx;
    const name = String(params.title || params.name || 'Name');
    const role = params.subtitle || params.role || null;
    const items = [{ key: 'name', role: 'title', text: name, fontFamily: look.fonts.display, fontWeight: 700, fontSize: params.fontSize, maxWidthFrac: MEASURE.title, maxLines: 1, allowWrap: false }];
    if (role) items.push({ key: 'role', role: 'subtitle', text: String(role), fontFamily: look.fonts.subtitle, maxWidthFrac: MEASURE.subtitle, maxLines: 1 });

    // Bottom of the content rectangle, which is above the platform's own chrome.
    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'bottom', maxWidthFrac: MEASURE.title, gapRatio: 0.35 });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const nameId = `name-${origin.componentId}`;

    const accent = accentFor({ ...placed.name, maxWidth: MEASURE.title * frame.w }, { frame, shapeKind: look.accent, x: num(params.x, 50) });
    const nodes = [
        accentNode({ ...accent, params: look.accent === 'highlight-box' ? { fill: false } : {} }, { look, duration, index: 0, origin: { ...origin, role: 'accent' }, backdropFor: nameId }),
    ];
    const nameNode = textNode(placed.name, { role: 'title', look, colour: look.palette.text, duration, index: 1, origin: { ...origin, role: 'name' }, x: num(params.x, 50), frame });
    nameNode.id = nameId;
    nodes.push(nameNode);
    if (placed.role) nodes.push(textNode(placed.role, { role: 'subtitle', look, colour: look.palette.sub, duration, index: 2, origin: { ...origin, role: 'role' }, x: num(params.x, 50), frame }));
    return nodes;
}

const COMPOSERS = {
    TitleSequence: composeTitleSequence,
    KineticTitle: composeKineticTitle,
    StatCallout: composeStatCallout,
    LowerThird: composeLowerThird,
};

/**
 * Compose one designed graphic as a scene.
 *
 * @param {string} componentId one of COMPOSED_COMPONENTS
 * @param {string} presetId a key of LOOKS[componentId]
 * @param {object} params title, subtitle, kicker, value, label, colours, duration, x, anchor, backdrop
 * @param {{aspectRatio?:string, frame?:object, safeZone?:object}} [opts]
 * @returns {object|null} a normalised Scene, or null when the component is not composed here
 */
export function composeComponentScene(componentId, presetId, params = {}, opts = {}) {
    const composer = COMPOSERS[componentId];
    if (!composer) return null;
    const ctx = sceneContext(componentId, presetId, params, opts);
    if (!ctx.look) return null;
    let nodes;
    try {
        nodes = composer(params, ctx);
    } catch (err) {
        console.error(`[SceneComposer] ${componentId} (${presetId}) failed:`, err);
        return null;
    }
    if (!Array.isArray(nodes) || nodes.length === 0) return null;

    // One group: the pieces move, scale and retime together. Every clip
    // flattened out of it shares a groupId (R66's contract) because
    // `flattenScene` stamps the enclosing group's id on each one.
    const group = createGroup({
        name: componentId,
        transform: { x: 0, y: 0 },
        duration: ctx.duration,
        children: nodes,
        origin: { componentId, presetId },
    });
    const scene = normalizeScene(createScene({
        name: `${componentId} (${presetId})`,
        frame: ctx.frame,
        duration: ctx.duration,
        nodes: [group],
        meta: { componentId, presetId, look: ctx.look.accent, composed: true },
    }));
    return scene;
}

export default { LOOKS, MEASURE, COMPOSED_COMPONENTS, composeComponentScene, cleanMotionOverride };
