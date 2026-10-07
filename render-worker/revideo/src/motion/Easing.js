/**
 * render-worker/revideo/src/motion/Easing.js
 *
 * SYNCED COPY of client/src/motion/Easing.js — verbatim below the header divider.
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
    // ── R92: the rest of the standard curve family ─────────────────────────
    easeInSine:     t => 1 - Math.cos((t * Math.PI) / 2),
    easeOutSine:    t => Math.sin((t * Math.PI) / 2),
    easeInOutSine:  t => -(Math.cos(Math.PI * t) - 1) / 2,
    easeInExpo:     t => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    easeOutExpo:    t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    easeInOutExpo:  t => (t === 0 || t === 1 ? t
        : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
    easeOutCirc:    t => Math.sqrt(1 - Math.pow(t - 1, 2)),
    easeInOutCirc:  t => (t < 0.5
        ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
        : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2),
    /** Winds back before leaving. The "anticipation" principle of animation. */
    backIn: t => {
        const c1 = 1.70158;
        return (c1 + 1) * t * t * t - c1 * t * t;
    },
    backInOut: t => {
        const c2 = 1.70158 * 1.525;
        return t < 0.5
            ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
            : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
    },
};

/**
 * R92 — real damped-spring easing.
 *
 * Before R92 'spring' was an alias for `elastic`, a fixed sine wobble. A real
 * spring is a damped harmonic oscillator (stiffness k, damping c, mass m) and
 * is what motion designers mean by "spring": the overshoot and settle come
 * from physics, so a stiff spring snaps and a soft one floats.
 *
 * The physical settle time is mapped onto t = 0..1, so a spring still fits the
 * keyframe span it was given. t = 1 always returns exactly 1, so the next
 * keyframe starts where this one ended.
 */
export function springEasing({ stiffness = 170, damping = 26, mass = 1 } = {}) {
    const k = Math.max(1, Number(stiffness) || 170);
    const c = Math.max(0.1, Number(damping) || 26);
    const m = Math.max(0.1, Number(mass) || 1);
    const w0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(k * m));
    let x;
    let settle;
    if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        x = tau => 1 - Math.exp(-zeta * w0 * tau) * (Math.cos(wd * tau) + (zeta * w0 / wd) * Math.sin(wd * tau));
        settle = Math.log(1000) / (zeta * w0);
    } else if (zeta === 1) {
        x = tau => 1 - Math.exp(-w0 * tau) * (1 + w0 * tau);
        settle = 9.2 / w0;
    } else {
        const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
        const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
        const A = r2 / (r2 - r1);
        const B = 1 - A;
        x = tau => 1 - (A * Math.exp(r1 * tau) + B * Math.exp(r2 * tau));
        settle = Math.log(1000) / Math.abs(r1);
    }
    return t => (t <= 0 ? 0 : t >= 1 ? 1 : x(t * settle));
}

/** Named spring configs (react-spring's well-known presets). */
export const SPRING_PRESETS = Object.freeze({
    spring:        { stiffness: 170, damping: 26 },
    springGentle:  { stiffness: 120, damping: 14 },
    springWobbly:  { stiffness: 180, damping: 12 },
    springStiff:   { stiffness: 210, damping: 20 },
    springSlow:    { stiffness: 280, damping: 60 },
    springSnappy:  { stiffness: 400, damping: 28 },
});
for (const [name, cfg] of Object.entries(SPRING_PRESETS)) {
    EASING_FUNCTIONS[name] = springEasing(cfg);
}

/**
 * R92 — CSS-compatible cubic-bezier(x1, y1, x2, y2). Same solver browsers use
 * (Newton steps, then bisection), so a curve copied from a design tool eases
 * identically in preview and export.
 */
export function cubicBezier(x1, y1, x2, y2) {
    const X1 = clamp(x1, 0, 1);
    const X2 = clamp(x2, 0, 1);
    const Y1 = Number.isFinite(Number(y1)) ? Number(y1) : 0;
    const Y2 = Number.isFinite(Number(y2)) ? Number(y2) : 1;
    const cx = 3 * X1, bx = 3 * (X2 - X1) - cx, ax = 1 - cx - bx;
    const cy = 3 * Y1, by = 3 * (Y2 - Y1) - cy, ay = 1 - cy - by;
    const sx = u => ((ax * u + bx) * u + cx) * u;
    const sy = u => ((ay * u + by) * u + cy) * u;
    const dx = u => (3 * ax * u + 2 * bx) * u + cx;
    const solveX = x => {
        let u = x;
        for (let i = 0; i < 8; i++) {
            const e = sx(u) - x;
            if (Math.abs(e) < 1e-6) return u;
            const d = dx(u);
            if (Math.abs(d) < 1e-6) break;
            u -= e / d;
        }
        let lo = 0, hi = 1;
        u = x;
        for (let i = 0; i < 30 && lo < hi; i++) {
            const v = sx(u);
            if (Math.abs(v - x) < 1e-6) return u;
            if (x > v) lo = u; else hi = u;
            u = (lo + hi) / 2;
        }
        return u;
    };
    return t => (t <= 0 ? 0 : t >= 1 ? 1 : sy(solveX(t)));
}

/** R92 — steps(n): a hold-and-jump curve, for stop-motion and ticker looks. */
export function stepsEasing(n) {
    const count = Math.max(1, Math.min(60, Math.round(Number(n) || 1)));
    return t => (t >= 1 ? 1 : Math.floor(clampUnit(t) * count) / count);
}

const clampUnit = t => (t < 0 ? 0 : t > 1 ? 1 : t);

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
    'ease-in-sine':    'easeInSine',
    'ease-out-sine':   'easeOutSine',
    'ease-in-out-sine': 'easeInOutSine',
    'ease-in-expo':    'easeInExpo',
    'ease-out-expo':   'easeOutExpo',
    'ease-in-out-expo': 'easeInOutExpo',
    'ease-out-circ':   'easeOutCirc',
    'ease-in-out-circ': 'easeInOutCirc',
    'back-in':         'backIn',
    'back-in-out':     'backInOut',
    'anticipate':      'backIn',
    'spring-gentle':   'springGentle',
    'spring-wobbly':   'springWobbly',
    'spring-stiff':    'springStiff',
    'spring-slow':     'springSlow',
    'spring-snappy':   'springSnappy',
    'wobbly':          'springWobbly',
    'snappy':          'springSnappy',
};

const _parsedCache = new Map();
/**
 * Parse a function-style easing: `cubic-bezier(a,b,c,d)`, `spring(k,c[,m])`,
 * `steps(n)`. Returns null for anything else. Cached (bounded) because the
 * resolver runs every frame.
 */
function parseEasingFunction(name) {
    if (_parsedCache.has(name)) return _parsedCache.get(name);
    const m = /^\s*(cubic-bezier|spring|steps)\s*\(([^)]*)\)\s*$/i.exec(name);
    let fn = null;
    if (m) {
        const args = m[2].split(',').map(v => Number(v.trim()));
        const kind = m[1].toLowerCase();
        if (kind === 'cubic-bezier' && args.length === 4 && args.every(Number.isFinite)) {
            fn = cubicBezier(args[0], args[1], args[2], args[3]);
        } else if (kind === 'spring' && args.length >= 2 && args.slice(0, 2).every(Number.isFinite)) {
            fn = springEasing({ stiffness: args[0], damping: args[1], mass: Number.isFinite(args[2]) ? args[2] : 1 });
        } else if (kind === 'steps' && Number.isFinite(args[0])) {
            fn = stepsEasing(args[0]);
        }
    }
    if (_parsedCache.size > 256) _parsedCache.clear();
    _parsedCache.set(name, fn);
    return fn;
}

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
    const parsed = name.includes('(') ? parseEasingFunction(name) : null;
    if (parsed) return parsed;
    return EASING_FUNCTIONS.linear;
}

/** True when resolveEasing() would use this name as given (not fall back to linear). */
export function isKnownEasing(name) {
    if (typeof name !== 'string' || !name) return false;
    if (EASING_FUNCTIONS[name] || EASING_ALIASES[name]) return true;
    return name.includes('(') && !!parseEasingFunction(name);
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

export default { EASING_FUNCTIONS, SPRING_PRESETS, resolveEasing, isKnownEasing, listEasingNames, clamp, springEasing, cubicBezier, stepsEasing };
