/**
 * client/src/motion/MotionPrinciples.js
 *
 * R103 round F — the three animation principles the engine did not have.
 *
 * The motion vocabulary already covered timing, easing, springs, staging,
 * transitions and choreography: 33 verbs (34 with this round's), 7 moods, 31 presets and 34
 * catalogued techniques. An audit of it against the classical principles
 * found exactly three holes, and they are holes of a particular kind — each
 * one is a RELATIONSHIP between moves, which is why a vocabulary of
 * independent verbs could not express any of them:
 *
 *   ANTICIPATION     a small move AGAINST the main move, just before it.
 *                    The engine had the word — Easing.js aliases
 *                    'anticipate' to `backIn` — but an easing curve is not
 *                    anticipation. `backIn` shapes the move itself; the
 *                    principle is a separate, earlier, opposite gesture.
 *
 *   FOLLOW-THROUGH   the move does not stop when the body stops: the parts
 *                    overshoot and settle. Several entrances already land on
 *                    a spring, which is follow-through for ONE layer. What
 *                    was missing is follow-through across a STACK — a title,
 *                    subtitle and kicker that arrive staggered and then all
 *                    leave on the same frame, in lockstep, which is the most
 *                    visible tell of machine-made motion.
 *
 *   SECONDARY ACTION a supporting move on a different element that enriches
 *                    the main one without competing. The engine's accent
 *                    shapes played the SAME verb as the text they decorate,
 *                    at the same time — two things doing one thing, which
 *                    reads as a duplicate rather than as support.
 *
 * This module is knowledge, not rendering: it declares the shapes and the
 * rules, and `MotionComposer` and `SceneComposer` apply them. Nothing here
 * invents a property or an easing the resolver cannot already draw.
 */

/**
 * ── ANTICIPATION ────────────────────────────────────────────────────────
 *
 * Per verb: the peak of the counter-move, as deltas from rest, in each
 * property's own unit (x/y are % of frame, scale is a multiplier).
 * `ctx` carries the beat's energy and resolved direction.
 *
 * A null entry is a deliberate statement, not an omission: it records WHY
 * that verb cannot anticipate, so nobody adds a wrong one later.
 */
export const ANTICIPATION = Object.freeze({
    // ── Emphasis ──
    // A punch grows, so it crouches first. This is the textbook case.
    'punch':  { peak: ({ energy }) => ({ scale: -(0.03 + 0.04 * energy) }) },
    'pulse':  { peak: ({ energy }) => ({ scale: -(0.02 + 0.03 * energy) }) },
    'jiggle': { peak: ({ energy }) => ({ scale: -(0.03 + 0.05 * energy) }) },
    // A hop crouches before it leaves the ground (+y is down here).
    'bounce': { peak: ({ energy }) => ({ y: 1 + 2 * energy }) },
    // A nod dips, so it lifts first.
    'nod':    { peak: ({ energy }) => ({ y: -(0.6 + 1.2 * energy) }) },
    'shake':  null,  // already starts by jumping to one extreme — the first half-cycle IS the anticipation
    'wobble': null,  // same: a decaying oscillation has no single main move to precede
    'flash':  null,  // glow only, no displacement to oppose

    // ── Exits ──
    // Wind up against the direction of travel before leaving.
    'fly-out':  { peak: ({ energy, dir }) => ({ x: (dir?.x ?? 1) * (2 + 4 * energy), y: (dir?.y ?? 0) * (2 + 4 * energy) }) },
    'whip-out': { peak: ({ energy, dir }) => ({ x: (dir?.x ?? 1) * (2.5 + 5 * energy), y: (dir?.y ?? 0) * (2.5 + 5 * energy) }) },
    // Sinking: rise first.
    'sink-out': { peak: ({ energy }) => ({ y: -(1 + 2 * energy) }) },
    'shrink-out': null, // its own easing is `backIn` — it already winds back; a second one would double the gesture
    'fade-out': null,   // opacity only
    'blur-out': null,   // focus only
});

/**
 * Entrances are excluded by construction, and the reason is worth stating
 * once rather than being rediscovered: in this engine an entrance OWNS
 * opacity, so before it runs the layer is not on screen. There is nothing
 * there to pull back. Anticipation for an entrance is the overshoot baked
 * into verbs like `pop-in` and `drop-in`, which is a different principle
 * (follow-through) applied at the end of the move.
 */
export const ANTICIPATION_EXCLUDES_ENTRANCES =
    'An entrance owns opacity, so the layer does not exist before it runs; there is nothing on screen to pull back.';

/** How long the wind-up lasts, as a fraction of the beat it precedes. */
export const ANTICIPATION_SPAN = Object.freeze({ min: 0.08, max: 0.22, fraction: 0.45 });

/**
 * The anticipation animation for a beat, as a plain keyframe spec, or null.
 *
 * Timing is the subtle part and differs by anchor. An `out` animation is
 * placed by the resolver at `layerDuration - animDuration - startTime`, so a
 * LARGER startTime starts it EARLIER. For the wind-up to end exactly where
 * the exit begins, its startTime is `at + exitDuration` — which falls out of
 * that formula and is why this is computed here rather than guessed at the
 * call site.
 *
 * @param {string} verbName
 * @param {{at:number, duration:number, energy:number, dir:?{x:number,y:number}, group:string}} ctx
 * @returns {{frames:Array, at:number, anchor:string, easing:string}|null}
 */
export function anticipationFor(verbName, { at, duration, energy = 0.5, dir = null, group }) {
    const shape = ANTICIPATION[verbName];
    if (!shape || typeof shape.peak !== 'function') return null;
    if (group !== 'emphasis' && group !== 'out') return null;

    const peak = shape.peak({ energy, dir });
    const props = Object.entries(peak).filter(([, v]) => Number.isFinite(v) && v !== 0);
    if (!props.length) return null;

    const span = Math.min(
        ANTICIPATION_SPAN.max,
        Math.max(ANTICIPATION_SPAN.min, duration * ANTICIPATION_SPAN.fraction),
    );

    // Rest → peak → rest. The return to rest is what the main beat departs
    // from, so the two read as one gesture rather than two.
    const rest = Object.fromEntries(props.map(([p]) => [p, p === 'scale' ? 1 : 0]));
    const top = Object.fromEntries(props.map(([p, v]) => [p, p === 'scale' ? 1 + v : v]));
    const frames = [[0, rest], [span * 0.55, top, 'easeOutQuad'], [span, rest, 'easeInQuad']];

    if (group === 'out') {
        // Anchored to the clip end: startTime grows backwards in time.
        return { frames, at: at + duration, anchor: 'out', easing: 'easeInOutSine' };
    }
    // Anchored to the clip start: sit immediately before the beat, and give
    // up rather than overlap it if there is no room at the head of the clip.
    const start = at - span;
    if (start < 0) return null;
    return { frames, at: start, anchor: 'in', easing: 'easeInOutSine' };
}

/**
 * ── FOLLOW-THROUGH ──────────────────────────────────────────────────────
 *
 * For one layer it is the overshoot-and-settle several verbs already have.
 * Across a stack it is the part that was missing: elements arrive staggered
 * and must LEAVE staggered too, in reverse — the thing that arrived last
 * leaves first, and the lead holds longest. A stack that enters one by one
 * and then vanishes on a single frame is the most visible tell of
 * machine-made motion, and it is what this engine did.
 *
 * Returns the two offsets for one member of a stack.
 *
 * @param {{index:number, count:number, stagger:number, duration:number}} p
 * @returns {{enterAt:number, exitAt:number}}
 */
export function stackTiming({ index = 0, count = 1, stagger = 0.12, duration = 3 }) {
    const i = Math.max(0, index);
    const n = Math.max(1, count);
    // The entrance cascade, capped so a short clip does not spend a third of
    // itself waiting for the last line.
    const enterAt = Math.min(i * stagger, Math.max(0, duration * 0.3));
    // The exit cascade, reversed. An `out` animation's startTime counts
    // BACKWARDS from the clip end, so a larger value leaves earlier: index 0
    // (the lead) gets 0 and is last to go.
    const exitStagger = Math.min(stagger, duration * 0.08);
    const exitAt = n > 1 ? Math.min(i * exitStagger, Math.max(0, duration * 0.2)) : 0;
    return { enterAt, exitAt };
}

/**
 * ── SECONDARY ACTION ────────────────────────────────────────────────────
 *
 * The accent shape under a headline was given the SAME verb as the headline,
 * starting first. Two elements performing one identical move do not read as
 * support; they read as a duplicate, and on a `slam-in` they fight for the
 * same instant.
 *
 * The rule has two halves, and which half applies is a question about what
 * the shape IS, not how it looks:
 *
 *   A BACKDROP (a filled plate, a highlight box the words sit on) must be
 *   there for the words to land on, so it leads — but quietly, with a
 *   calmer verb and less energy than the words it carries.
 *
 *   A DECORATION (an underline, a burst, a circle) punctuates words that
 *   are already there, so it follows them, briefly and with more snap.
 *
 * Both are genuine secondary action: a supporting move that enriches the
 * main one without competing with it.
 */

/** A calmer stand-in for a loud entrance, for backdrops. */
const CALMER = Object.freeze({
    'slam-in': 'fade-in', 'drop-in': 'rise-in', 'pop-in': 'fade-in', 'whip-in': 'slide-in',
    'spin-in': 'pop-in', 'swing-in': 'rise-in', 'glitch-in': 'fade-in', 'zoom-in': 'fade-in',
    'typewriter': 'fade-in', 'word-reveal': 'fade-in',
});

/** A quick punctuating entrance, for decorations that arrive after the words. */
const SNAPPIER = Object.freeze({
    'fade-in': 'pop-in', 'blur-in': 'pop-in', 'rise-in': 'pop-in',
    'typewriter': 'pop-in', 'word-reveal': 'pop-in',
});

/** Accent kinds that the words sit ON rather than beside. */
const BACKDROP_KINDS = new Set(['highlight-box', 'panel']);

/**
 * Is this accent a backdrop (leads) or a decoration (follows)?
 * An explicit `fill` settles it: a filled shape is something to land on,
 * whatever its kind. `highlight-box` is the ambiguous one — outlined it is
 * a decoration, filled it is a plate — so the fill flag is checked first.
 */
export function accentRole(kind, params = {}) {
    if (params.fill === true) return 'backdrop';
    if (params.fill === false) return 'decoration';
    return BACKDROP_KINDS.has(String(kind)) ? 'backdrop' : 'decoration';
}

/**
 * The supporting beat program for an accent, given the motion of the text it
 * accompanies.
 *
 * @param {{enter:string, exit:?string, energy:number}} lead the look's motion
 * @param {{role:string, leadAt:number, duration:number}} p
 * @returns {{beats:object[], note:string}}
 */
export function secondaryActionFor(lead, { role, leadAt = 0, duration = 3 }) {
    const energy = Math.max(0, Math.min(1, Number(lead?.energy) || 0.5));
    const enter = String(lead?.enter || 'fade-in');
    const exit = lead?.exit ? String(lead.exit) : null;

    if (role === 'backdrop') {
        // Arrives a beat BEFORE the words, calmer, so there is something for
        // them to land on without the plate stealing the entrance.
        const verb = CALMER[enter] || enter;
        const at = Math.max(0, leadAt - Math.min(0.12, duration * 0.05));
        const beats = [{ verb, at, energy: energy * 0.6 }];
        // The plate leaves with the words, not after them: a bare plate held
        // for an extra beat after its text has gone looks like a mistake.
        if (exit) beats.push({ verb: exit, energy: energy * 0.6 });
        return { beats, note: 'The plate arrives first and quieter, so the words land on it rather than race it.' };
    }

    // A decoration punctuates: it waits for the words, then snaps in.
    const verb = SNAPPIER[enter] || enter;
    const after = Math.min(leadAt + Math.max(0.18, duration * 0.12), Math.max(0, duration * 0.45));
    const beats = [{ verb, at: after, energy: Math.min(1, energy * 1.1) }];
    if (exit) beats.push({ verb: exit, energy: energy * 0.8 });
    return { beats, note: 'The accent lands after the words it underlines, so it reads as punctuation rather than a second copy of the entrance.' };
}

export default {
    ANTICIPATION,
    ANTICIPATION_SPAN,
    ANTICIPATION_EXCLUDES_ENTRANCES,
    anticipationFor,
    stackTiming,
    accentRole,
    secondaryActionFor,
};
