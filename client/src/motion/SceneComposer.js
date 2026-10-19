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
// R103 round E — text drawn ON a filled accent has to be readable against it.
// Nothing checked that pair: the validator's only contrast check runs against
// an explicit `backdropColor`, which a filled accent never sets.
import { ensureContrast, CONTRAST } from './ColorTheory.js';
// R103 round F — the three principles a vocabulary of independent verbs
// could not express, because each one is a RELATIONSHIP between moves:
// anticipation, follow-through across a stack, and secondary action.
import { stackTiming, accentRole, secondaryActionFor } from './MotionPrinciples.js';

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

/**
 * R103 round D — the measure above is a LANDSCAPE rule, and was being applied
 * to vertical frames unchanged.
 *
 * Its own derivation says so: 0.46 is "880 px of 1920". A share of the frame
 * width is only a sensible measure when the frame is wide, because the
 * typographic rule is really characters per line. On a 1080-wide vertical
 * frame 46% is 497px, and at the display role's 103px that is about five
 * characters — so "Zero To Forty Thousand" came out as three stacked
 * fragments with a third of the frame empty down each side, while the
 * captions underneath it ran at 0.8 (864px). The headline was narrower than
 * its own subtitles.
 *
 * This is the same fault R94 found in computeAccentBounds: a value measured
 * on 1920x1080 and reused on 9:16 as if the frame had not changed.
 *
 * So the landscape values stay exactly as they were, and widen as the frame
 * gets taller — reaching these at 9:16, interpolating in between, so 4:5 and
 * 1:1 are not forced to pick a side. Captions stay at 0.8 everywhere: they
 * were already tuned for both.
 */
const PORTRAIT_MEASURE = Object.freeze({
    // 0.8 on purpose, not 0.84: an accent wraps the text with padding
    // proportional to the type (0.6em), and at a 116px display size that is
    // ~70px. 0.84 (907px) plus that padding came to 973px, outside the 940px
    // content rect — the validator flagged a safe-area breach and repaired it
    // on every vertical headline. 0.8 is 864px, which leaves the accent room
    // to sit inside the safe area, and it matches what captions have always
    // used, so a headline and the captions under it now share one measure.
    display: 0.8, title: 0.8, stat: 0.8, subtitle: 0.76, kicker: 0.72, label: 0.72, caption: 0.8,
});

/**
 * The measure for a role in a given frame, as a share of the frame width.
 *
 * @param {string} role one of MEASURE's keys
 * @param {object|string} frameOrAspect
 * @returns {number}
 */
export function measureFor(role, frameOrAspect) {
    const frame = resolveFrame(frameOrAspect);
    // Taller than wide takes the portrait rule; square and wider keep the
    // landscape one.
    //
    // This was a ramp between the two at first, which read as the careful
    // choice and was not: at 4:5 — an ordinary Instagram format — it landed
    // the headline on 680px while captions kept their 864px, which is the
    // very fault being fixed, just smaller. There is no sensible frame where
    // a headline should be set narrower than the captions underneath it, so
    // the rule is a rule rather than a gradient.
    const portraitFrame = frame.h > frame.w;
    const table = portraitFrame ? PORTRAIT_MEASURE : MEASURE;
    return table[role] ?? table.title ?? MEASURE.title;
}

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

    // ── R103 round B ──────────────────────────────────────────────────────
    // Callout, QuoteCard and CTAWidget were the three TEXT-BEARING
    // components still building flat placements in ComponentLibrary.js, with
    // hardcoded font sizes and hardcoded y positions. That is a visible
    // quality cliff, not a cosmetic one: on a 1080x1920 vertical frame the
    // type scale puts a caption at 84px and a title at 125px, while the
    // hand-built path was emitting a 32px CTA, a 36px callout and a 44px
    // quote — a call to action rendering SMALLER than the captions under it.
    // They also had no safe-zone awareness and no legibility outline, so they
    // could sit under a platform's own chrome and disappear over bright
    // footage.
    //
    // The preset keys deliberately mirror `ComponentLibrary.COMPONENT_PRESETS`
    // for the same components (dark/light, classic, subscribe/follow), so a
    // caller asking for the preset it always asked for gets the designed
    // version of that same look rather than silently falling back to the
    // first key.
    Callout: {
        dark: {
            palette: { text: '#ffffff', sub: '#E2E8F0', kicker: '#A0AEC0', accent: '#0E0F11' },
            fonts: { display: 'Montserrat', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'highlight-box',
            motion: { enter: 'pop-in', emphasis: 'punch', exit: 'fade-out', energy: 0.7 },
        },
        light: {
            palette: { text: '#111111', sub: '#374151', kicker: '#6B7280', accent: '#ffffff' },
            fonts: { display: 'Montserrat', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'highlight-box',
            motion: { enter: 'pop-in', emphasis: 'punch', exit: 'fade-out', energy: 0.7 },
        },
    },
    QuoteCard: {
        classic: {
            palette: { text: '#F5EFE3', sub: '#D9CBB0', kicker: '#C8A96A', accent: '#C8A96A' },
            fonts: { display: 'Playfair Display', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'underline',
            motion: { enter: 'fade-in', emphasis: null, exit: 'fade-out', energy: 0.3 },
        },
    },
    CTAWidget: {
        subscribe: {
            palette: { text: '#ffffff', sub: '#ffffff', kicker: '#ffffff', accent: '#FF3B5C' },
            fonts: { display: 'Anton', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'highlight-box',
            motion: { enter: 'pop-in', emphasis: 'punch', exit: 'shrink-out', energy: 0.85 },
        },
        follow: {
            palette: { text: '#ffffff', sub: '#ffffff', kicker: '#ffffff', accent: '#00E5FF' },
            fonts: { display: 'Anton', subtitle: 'Inter', kicker: 'Inter' },
            accent: 'highlight-box',
            motion: { enter: 'pop-in', emphasis: 'punch', exit: 'shrink-out', energy: 0.85 },
        },
    },
};

/** The component ids this module composes. Everything else stays as it was. */
export const COMPOSED_COMPONENTS = Object.keys(LOOKS);

const DEFAULT_DURATION = { TitleSequence: 4, KineticTitle: 3, StatCallout: 3.5, LowerThird: 4, Callout: 3, QuoteCard: 4, CTAWidget: 3 };

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
    // R103 round F — anticipation is part of this contract, not a separate
    // channel, so a director or an LLM can ask a beat to wind up before it
    // moves the same way it asks for a verb. Strictly boolean: anything else
    // falls back rather than being coerced, like every other field here.
    const anticipate = typeof raw.anticipate === 'boolean' ? raw.anticipate : (fallback.anticipate === true);
    return { enter, emphasis, exit, energy, anticipate };
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
    // ANTICIPATION is a property of LOUD motion, so it is a rule rather than
    // nineteen hand-set flags: a wind-up before a punch or a whip-out is what
    // gives the move weight, while the same gesture on a calm `fade-in` /
    // `breathe` look reads as a stutter. A look (or a caller's override) that
    // states the flag explicitly always wins.
    const base = look.motion.anticipate === undefined
        ? { ...look.motion, anticipate: (Number(look.motion.energy) || 0) >= 0.7 }
        : look.motion;
    const motion = params.motion ? cleanMotionOverride(params.motion, base) : base;
    return { ...look, palette, fonts, accent: params.accent || look.accent, motion };
}

/**
 * Motion for one layer: the look's verbs, with the whole program pushed back
 * by this layer's place in the stagger. That is what makes the layers read as
 * one move rather than three.
 */
function motionFor(look, { duration, index = 0, stagger = STAGGER, emphasis = true }) {
    const at = Math.min(index * stagger, Math.max(0, duration * 0.3));
    // ANTICIPATION rides on the beats that can have it. Entrances cannot —
    // the layer does not exist yet — so the flag is only ever put on the
    // emphasis and the exit, which is also where a viewer reads it as
    // intention rather than as a stutter.
    const anticipate = look.motion.anticipate === true;
    const beats = [{ verb: look.motion.enter, at, energy: look.motion.energy }];
    const hasRoom = duration >= 2.2 && (at + 0.95 < duration - 0.4);
    if (emphasis && look.motion.emphasis && hasRoom) {
        beats.push({ verb: look.motion.emphasis, at: Math.min(at + duration * 0.45, Math.max(at + 0.2, duration - 0.7)), energy: look.motion.energy * 0.8, anticipate });
    }
    if (look.motion.exit) beats.push({ verb: look.motion.exit, energy: look.motion.energy, anticipate });
    const { animations } = composeMotion({ beats }, { duration, kind: 'text' });
    return animations;
}

/**
 * The accent's own motion: supporting, not a second copy of the text's.
 * `secondaryActionFor` decides which half of the rule applies and why; this
 * only compiles its beats.
 */
function accentMotionFor(look, { duration, role, leadAt }) {
    const { beats } = secondaryActionFor(look.motion, { role, leadAt, duration });
    const usable = beats.filter(b => VERBS[b.verb]);
    if (!usable.length) return motionFor(look, { duration, index: 0, emphasis: false });
    const { animations } = composeMotion({ beats: usable }, { duration, kind: 'text' });
    return animations;
}

/**
 * FOLLOW-THROUGH across a stack. The members arrive staggered and used to
 * leave on the same frame, in lockstep — the most visible tell of
 * machine-made motion. Their exits now cascade in reverse: whatever arrived
 * last leaves first, and the lead holds longest.
 *
 * Applied as a post-pass rather than threaded through thirteen `textNode`
 * call sites, because only the caller that sees every node knows how many
 * there are, and re-timing an exit is just a `startTime` — an `out`
 * animation is placed by the resolver at `duration - animDuration -
 * startTime`, so a larger value starts it earlier.
 */
function applyFollowThrough(nodes, { duration }) {
    const stack = nodes.filter(n => n.type === NODE_TYPES.TEXT);
    if (stack.length < 2) return nodes;
    stack.forEach((node, index) => {
        if (!Array.isArray(node.animations)) return;
        const { exitAt } = stackTiming({ index, count: stack.length, stagger: STAGGER, duration });
        if (exitAt <= 0) return;
        // Shift the whole exit GROUP, not each animation to the same value.
        // An exit may be more than one animation — an anticipation wind-up
        // carries a larger startTime precisely so it lands earlier — and
        // assigning them all one number collapses that offset, so the
        // wind-up would play on top of the move it is supposed to precede.
        const outs = node.animations.filter(a => a.anchor === 'out');
        if (!outs.length) return;
        const base = Math.min(...outs.map(a => Number(a.startTime) || 0));
        node.animations = node.animations.map(a => {
            if (a.anchor !== 'out') return a;
            const shifted = (Number(a.startTime) || 0) + exitAt - base;
            // Never push an exit past the start of the clip it belongs to.
            return { ...a, startTime: Math.min(shifted, Math.max(0, duration - a.duration - 0.05)) };
        });
    });
    return nodes;
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
        // SECONDARY ACTION. This used to be `motionFor(look, …)` — the exact
        // same verb as the text it decorates, starting first. Two elements
        // performing one identical move read as a duplicate, not as support,
        // and on a `slam-in` they fight for the same instant. A backdrop now
        // leads quietly (the words land on it); a decoration follows the
        // words and punctuates them.
        animations: accentMotionFor(look, {
            duration,
            role: accentRole(accent.kind, accent.params),
            leadAt: Math.min((index + 1) * STAGGER, Math.max(0, duration * 0.3)),
        }),
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
    if (params.kicker) items.push({ key: 'kicker', role: 'kicker', text: String(params.kicker), fontFamily: look.fonts.kicker, maxWidthFrac: measureFor('kicker', frame), maxLines: 1 });
    items.push({ key: 'title', role: 'display', text: title, fontFamily: look.fonts.display, fontWeight: 800, fontSize: params.fontSize, maxWidthFrac: measureFor('display', frame), maxLines: MAX_LINES.display });
    if (params.subtitle || params.sub) items.push({ key: 'subtitle', role: 'subtitle', text: String(params.subtitle || params.sub), fontFamily: look.fonts.subtitle, maxWidthFrac: measureFor('subtitle', frame), maxLines: MAX_LINES.subtitle });

    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'centre', maxWidthFrac: measureFor('display', frame) });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const titleItem = placed.title;

    const nodes = [];
    // The accent is measured from the headline, in this frame.
    const accent = accentFor({ ...titleItem, maxWidth: measureFor('display', frame) * frame.w }, { frame, shapeKind: look.accent, x: num(params.x, 50) });
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
    if (kicker) items.push({ key: 'kicker', role: 'kicker', text: String(kicker), fontFamily: look.fonts.kicker, maxWidthFrac: measureFor('kicker', frame), maxLines: 1 });
    items.push({ key: 'headline', role: 'display', text: headline, fontFamily: look.fonts.display, fontWeight: 900, fontSize: params.fontSize, maxWidthFrac: measureFor('display', frame), maxLines: MAX_LINES.display });

    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'centre', maxWidthFrac: measureFor('display', frame), gapRatio: 0.3 });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const headlineItem = placed.headline;
    const headlineId = `headline-${origin.componentId}`;

    const nodes = [];
    if (placed.kicker) nodes.push(textNode(placed.kicker, { role: 'kicker', look, colour: look.palette.kicker, duration, index: 0, origin: { ...origin, role: 'kicker' }, x: num(params.x, 50), frame }));
    const headlineNode = textNode(headlineItem, { role: 'display', look, colour: look.palette.text, duration, index: placed.kicker ? 1 : 1, origin: { ...origin, role: 'headline' }, x: num(params.x, 50), frame });
    headlineNode.id = headlineId;
    nodes.push(headlineNode);

    const accent = accentFor({ ...headlineItem, maxWidth: measureFor('display', frame) * frame.w }, {
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
        { key: 'stat', role: 'stat', text: stat, fontFamily: look.fonts.display, fontWeight: 900, fontSize: params.fontSize, maxWidthFrac: measureFor('stat', frame), maxLines: 1, allowWrap: false },
        { key: 'label', role: 'label', text: label, fontFamily: look.fonts.subtitle, maxWidthFrac: measureFor('label', frame), maxLines: 1 },
    ];
    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'centre', maxWidthFrac: measureFor('stat', frame), gapRatio: 0.55 });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const statId = `stat-${origin.componentId}`;

    const accent = accentFor({ ...placed.stat, maxWidth: measureFor('stat', frame) * frame.w }, { frame, shapeKind: look.accent, x: num(params.x, 50) });
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
    const items = [{ key: 'name', role: 'title', text: name, fontFamily: look.fonts.display, fontWeight: 700, fontSize: params.fontSize, maxWidthFrac: measureFor('title', frame), maxLines: 1, allowWrap: false }];
    if (role) items.push({ key: 'role', role: 'subtitle', text: String(role), fontFamily: look.fonts.subtitle, maxWidthFrac: measureFor('subtitle', frame), maxLines: 1 });

    // Bottom of the content rectangle, which is above the platform's own chrome.
    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'bottom', maxWidthFrac: measureFor('title', frame), gapRatio: 0.35 });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const nameId = `name-${origin.componentId}`;

    const accent = accentFor({ ...placed.name, maxWidth: measureFor('title', frame) * frame.w }, { frame, shapeKind: look.accent, x: num(params.x, 50) });
    const nodes = [
        accentNode({ ...accent, params: look.accent === 'highlight-box' ? { fill: false } : {} }, { look, duration, index: 0, origin: { ...origin, role: 'accent' }, backdropFor: nameId }),
    ];
    const nameNode = textNode(placed.name, { role: 'title', look, colour: look.palette.text, duration, index: 1, origin: { ...origin, role: 'name' }, x: num(params.x, 50), frame });
    nameNode.id = nameId;
    nodes.push(nameNode);
    if (placed.role) nodes.push(textNode(placed.role, { role: 'subtitle', look, colour: look.palette.sub, duration, index: 2, origin: { ...origin, role: 'role' }, x: num(params.x, 50), frame }));
    return nodes;
}

/**
 * Callout: one emphasised line on a filled highlight.
 *
 * The accent is FILLED here, unlike the title looks that use
 * `highlight-box` as an outline — the fill is what replaces the hand-built
 * path's `bar` graphic, so the callout still reads as a solid plate behind
 * the words rather than losing its background on the way to the design
 * system.
 */
function composeCallout(params, ctx) {
    const { frame, rect, duration, look, origin } = ctx;
    // Every component in this file accepts the several names a caller might
    // reasonably use for "the words" (see composeTitleSequence's
    // title/headline/text). Callout needs it more than most: the hand-built
    // path required `params.text` exactly, so an assistant that wrote
    // `content` got zero placements and an error.
    const line = String(params.text || params.content || params.label || params.title || 'Your callout');
    const items = [{
        key: 'line', role: 'title', text: line,
        fontFamily: look.fonts.display, fontWeight: 700, fontSize: params.fontSize,
        maxWidthFrac: measureFor('title', frame), maxLines: MAX_LINES.title,
    }];
    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'centre', maxWidthFrac: measureFor('title', frame), gapRatio: 0.4 });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const lineId = `callout-${origin.componentId}`;

    const accent = accentFor({ ...placed.line, maxWidth: measureFor('title', frame) * frame.w }, { frame, shapeKind: look.accent, x: num(params.x, 50) });
    const nodes = [
        accentNode({ ...accent, params: { fill: true } }, { look, duration, index: 0, origin: { ...origin, role: 'accent' }, backdropFor: lineId }),
    ];
    // The plate is filled, so the label sits on the accent colour, not on the
    // footage — it has to be legible against THAT.
    const lineColour = ensureContrast(look.palette.text, look.palette.accent, CONTRAST.large);
    const lineNode = textNode(placed.line, { role: 'title', look, colour: lineColour, duration, index: 1, origin: { ...origin, role: 'line' }, x: num(params.x, 50), frame });
    lineNode.id = lineId;
    nodes.push(lineNode);
    return nodes;
}

/** Quote card: the quote, with the attribution smaller and later beneath it. */
function composeQuoteCard(params, ctx) {
    const { frame, rect, duration, look, origin } = ctx;
    const quote = String(params.quote || params.text || params.content || 'Your quote here');
    const author = params.author || params.attribution || params.label || null;
    const items = [{
        key: 'quote', role: 'title', text: quote,
        fontFamily: look.fonts.display, fontWeight: 500, fontSize: params.fontSize,
        // A quote earns a third line where a headline does not: it is someone
        // else's sentence and breaking it to two lines often cuts it mid-clause.
        maxWidthFrac: measureFor('title', frame), maxLines: 3,
    }];
    if (author) {
        items.push({
            key: 'author', role: 'subtitle', text: `— ${String(author)}`,
            fontFamily: look.fonts.subtitle, maxWidthFrac: measureFor('subtitle', frame), maxLines: 1,
        });
    }
    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'centre', maxWidthFrac: measureFor('title', frame), gapRatio: 0.5 });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const quoteId = `quote-${origin.componentId}`;

    // The rule sits just under the quote block and the attribution is laid
    // out just under that, so with both present they land on each other. The
    // attribution is the stronger anchor of the two, so the rule stands down.
    const nodes = [];
    if (!placed.author) {
        const accent = accentFor({ ...placed.quote, maxWidth: measureFor('title', frame) * frame.w }, { frame, shapeKind: look.accent, x: num(params.x, 50) });
        nodes.push(accentNode(accent, { look, duration, index: 0, origin: { ...origin, role: 'accent' }, backdropFor: quoteId }));
    }
    const quoteNode = textNode(placed.quote, { role: 'title', look, colour: look.palette.text, duration, index: 1, origin: { ...origin, role: 'quote' }, x: num(params.x, 50), frame });
    quoteNode.id = quoteId;
    nodes.push(quoteNode);
    // The attribution arrives last and stays smaller, so it never competes
    // with the quote for the first read.
    if (placed.author) nodes.push(textNode(placed.author, { role: 'subtitle', look, colour: look.palette.sub, duration, index: 2, origin: { ...origin, role: 'author' }, x: num(params.x, 50), frame }));
    return nodes;
}

/** CTA: a short instruction on a filled badge, anchored low. */
function composeCTAWidget(params, ctx) {
    const { frame, rect, duration, look, origin } = ctx;
    // The default wording comes from the preset the caller asked for rather
    // than a field on the look, so the LOOKS entries keep one shape.
    const fallbackLabel = origin.presetId === 'follow' ? 'FOLLOW' : 'SUBSCRIBE';
    const label = String(params.label || params.text || params.content || params.title || fallbackLabel);
    const items = [{
        key: 'label', role: 'title', text: label,
        fontFamily: look.fonts.display, fontWeight: 800, fontSize: params.fontSize,
        // Two lines, wrapping allowed. Pinned to one unwrapped line, a
        // four-word instruction ("Follow for part two") had to shrink to fit
        // the measure and came out at 43px — smaller than the captions
        // underneath it, which is the exact defect this round is fixing. A
        // CTA that takes two lines at full size reads; one that fits on one
        // line at half size does not.
        maxWidthFrac: measureFor('title', frame), maxLines: 2,
    }];
    // Bottom by default: a call to action belongs near where the platform's
    // own action buttons are, and the content rectangle already keeps it
    // clear of that chrome.
    const block = layoutStack({ frame, rect, items, anchor: params.anchor || 'bottom', maxWidthFrac: measureFor('title', frame), gapRatio: 0.35 });
    const placed = Object.fromEntries(block.items.map(i => [i.key, i]));
    const labelId = `cta-${origin.componentId}`;

    const accent = accentFor({ ...placed.label, maxWidth: measureFor('title', frame) * frame.w }, { frame, shapeKind: look.accent, x: num(params.x, 50) });
    const nodes = [
        accentNode({ ...accent, params: { fill: true } }, { look, duration, index: 0, origin: { ...origin, role: 'accent' }, backdropFor: labelId }),
    ];
    // The badge is filled, so the instruction sits on the accent. The
    // "follow" preset shipped white on #00E5FF — 1.54:1, effectively
    // invisible — because nothing compared the two.
    const labelColour = ensureContrast(look.palette.text, look.palette.accent, CONTRAST.large);
    const labelNode = textNode(placed.label, { role: 'title', look, colour: labelColour, duration, index: 1, origin: { ...origin, role: 'label' }, x: num(params.x, 50), frame });
    labelNode.id = labelId;
    nodes.push(labelNode);
    return nodes;
}

const COMPOSERS = {
    TitleSequence: composeTitleSequence,
    KineticTitle: composeKineticTitle,
    StatCallout: composeStatCallout,
    LowerThird: composeLowerThird,
    Callout: composeCallout,
    QuoteCard: composeQuoteCard,
    CTAWidget: composeCTAWidget,
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
    applyFollowThrough(nodes, { duration: ctx.duration });

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
