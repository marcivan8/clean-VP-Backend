/**
 * client/src/motion/Easing.js
 *
 * The canonical easing table for the Motion Graphics engine.
 *
 * WHY THIS EXISTS SEPARATELY: this codebase already had THREE easing
 * vocabularies that did not agree with each other —
 *   1. `EffectNode.js`'s `EASING_FUNCTIONS` — 11 functions, camelCase keys
 *      (`easeIn`, `easeOutCubic`), not exported, so nothing outside that file
 *      could reuse them.
 *   2. `KeyframeEditor.jsx`'s dropdown — kebab-case (`ease-in`, `ease-out`),
 *      which misses every camelCase key and silently falls back to linear.
 *      Four of its five options have never actually eased anything.
 *   3. `VideoPlayer.jsx`'s `interpolateKeyframes` — a single hardcoded
 *      `easing === 'easeOutCubic' ? ... : linear` branch.
 *
 * This module resolves ALL of those spellings to the same functions, so a
 * keyframe authored anywhere eases the same way everywhere. It deliberately
 * does not modify EffectNode — that file is wired into the GPU pipeline and
 * changing it is out of scope for an additive engine.
 *
 * RULE: resolveEasing() NEVER throws and NEVER returns undefined. An unknown
 * easing name degrades to linear, because a slightly-wrong animation is an
 * acceptable outcome and a crashed render loop is not.
 */

/** Raw easing implementations, keyed by canonical camelCase name. */
export const EASING_FUNCTIONS = {
    linear:        t => t,
    easeIn:        t => t * t,
    easeOut:       t => t * (2 - t),
    easeInOut:     t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    easeInCubic:   t => t * t * t,
    easeOutCubic:  t => (--t) * t * t + 1,
    easeInOutCubic: t => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
    easeInQuart:   t => t * t * t * t,
    easeOutQuart:  t => 1 - (--t) * t * t * t,
    easeInOutQuart: t => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t),
    /** Overshoot-and-settle. Good for "pop" / "bounce" presets. */
    bounce: t => {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (t < 1 / d1)      return n1 * t * t;
        if (t < 2 / d1)      return n1 * (t -= 1.5 / d1) * t + 0.75;
        if (t < 2.5 / d1)    return n1 * (t -= 2.25 / d1) * t + 0.9375;
        return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
    /** Decaying oscillation. Endpoints are clamped so 0→0 and 1→1 exactly. */
    elastic: t => {
        if (t === 0 || t === 1) return t;
        return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
    },
    /** Pulls slightly past the target then settles — the classic UI "pop". */
    backOut: t => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
};

/**
 * Every spelling in use anywhere in this codebase, mapped to a canonical key.
 * Kebab-case entries exist because KeyframeEditor.jsx emits them.
 */
const EASING_ALIASES = {
    'ease':            'easeInOut',
    'ease-in':         'easeIn',
    'ease-out':        'easeOut',
    'ease-in-out':     'easeInOut',
    'ease-in-cubic':   'easeInCubic',
    'ease-out-cubic':  'easeOutCubic',
    'ease-in-out-cubic': 'easeInOutCubic',
    'ease-in-quart':   'easeInQuart',
    'ease-out-quart':  'easeOutQuart',
    'ease-in-out-quart': 'easeInOutQuart',
    'back-out':        'backOut',
    'back':            'backOut',
    'spring':          'elastic',
};

/**
 * Resolve an easing name (any known spelling) to a function.
 * @param {string} [name]
 * @returns {(t: number) => number} always a usable function
 */
export function resolveEasing(name) {
    if (typeof name !== 'string' || name.length === 0) return EASING_FUNCTIONS.linear;
    if (EASING_FUNCTIONS[name]) return EASING_FUNCTIONS[name];
    const canonical = EASING_ALIASES[name];
    if (canonical && EASING_FUNCTIONS[canonical]) return EASING_FUNCTIONS[canonical];
    return EASING_FUNCTIONS.linear;
}

/** Every name resolveEasing() accepts — used by UI dropdowns and the regression test. */
export function listEasingNames() {
    return [...Object.keys(EASING_FUNCTIONS), ...Object.keys(EASING_ALIASES)];
}

/**
 * Clamp a value into [min, max]. Non-finite input returns `min`, because
 * NaN propagating into a CSS transform blanks the element silently.
 */
export function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return n < min ? min : (n > max ? max : n);
}

export default { EASING_FUNCTIONS, resolveEasing, listEasingNames, clamp };
