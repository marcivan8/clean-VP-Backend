/**
 * Small, deterministic expression evaluator for motion properties.
 * It intentionally supports arithmetic, relational logic, and an After Effects math & motion function whitelist;
 * it never evaluates arbitrary JavaScript or exposes the global object.
 */

// Analytical cubic-bezier solver for easing and keyframes
function solveCubicBezier(t, x1, y1, x2, y2) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;

    const sampleX = u => ((ax * u + bx) * u + cx) * u;
    const sampleY = u => ((ay * u + by) * u + cy) * u;
    const sampleDerivX = u => (3 * ax * u + 2 * bx) * u + cx;

    let u = t;
    for (let i = 0; i < 8; i++) {
        const err = sampleX(u) - t;
        if (Math.abs(err) < 1e-6) return sampleY(u);
        const d = sampleDerivX(u);
        if (Math.abs(d) < 1e-6) break;
        u -= err / d;
    }

    let lo = 0, hi = 1;
    u = t;
    for (let i = 0; i < 14; i++) {
        const x = sampleX(u);
        if (Math.abs(x - t) < 1e-6) break;
        if (t > x) lo = u; else hi = u;
        u = 0.5 * (lo + hi);
    }
    return sampleY(u);
}

function solveSpring(t, stiffness = 220, damping = 18, mass = 1) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const k = Math.max(1, stiffness);
    const m = Math.max(0.1, mass);
    const c = Math.max(0.05, damping);
    const w0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(k * m));
    const physT = t * 1.15;
    let value = 1;
    if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        const env = Math.exp(-zeta * w0 * physT);
        value = 1 - env * (Math.cos(wd * physT) + ((zeta * w0) / wd) * Math.sin(wd * physT));
    } else {
        const env = Math.exp(-w0 * physT);
        value = 1 - env * (1 + w0 * physT);
    }
    const settleBoost = t > 0.85 ? (t - 0.85) / 0.15 : 0;
    return value + (1 - value) * (settleBoost * settleBoost);
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function applyEasing(u, easing = 'linear', bezier, spring) {
    const t = clamp(u, 0, 1);
    const norm = String(easing || 'linear').toLowerCase().replace(/-/g, '');
    switch (norm) {
        case 'hold':
        case 'stepend':
            return t >= 1 ? 1 : 0;
        case 'stepstart':
            return t > 0 ? 1 : 0;
        case 'easein':
            return t * t;
        case 'easeout':
            return t * (2 - t);
        case 'easeinout':
        case 'ease':
            return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        case 'easeincubic':
            return t * t * t;
        case 'easeoutcubic': {
            const tm = t - 1;
            return tm * tm * tm + 1;
        }
        case 'easeinoutcubic':
            return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
        case 'bezier': {
            const [x1, y1, x2, y2] = Array.isArray(bezier) && bezier.length === 4 ? bezier : [0.25, 0.1, 0.25, 1];
            return solveCubicBezier(t, x1, y1, x2, y2);
        }
        case 'spring':
            return solveSpring(t, spring?.stiffness ?? 220, spring?.damping ?? 18, spring?.mass ?? 1);
        case 'linear':
        default:
            return t;
    }
}

function sampleKeyframes(sorted, time, fallback) {
    if (time <= sorted[0].time) return sorted[0].value;
    if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;
    for (let i = 0; i < sorted.length - 1; i++) {
        const k0 = sorted[i];
        const k1 = sorted[i + 1];
        if (time >= k0.time && time <= k1.time) {
            if (k0.easing === 'hold' || k0.easing === 'step-end') return k0.value;
            const span = k1.time - k0.time;
            if (span <= 1e-6) return k1.value;
            const u = (time - k0.time) / span;
            const eased = applyEasing(u, k0.easing, k0.bezier, k0.spring);
            return lerp(k0.value, k1.value, eased);
        }
    }
    return sorted[sorted.length - 1].value;
}

function evalLoop(mode, typeStr, keyframes, time, baseValue) {
    if (!Array.isArray(keyframes) || keyframes.length < 2) return baseValue;
    const sorted = [...keyframes]
        .map(kf => ({
            time: Number(kf?.time),
            value: Number(kf?.value !== undefined ? kf.value : kf?.properties?.value),
            easing: kf?.easing || 'linear',
            bezier: kf?.bezier,
            spring: kf?.spring,
        }))
        .filter(kf => Number.isFinite(kf.time) && Number.isFinite(kf.value))
        .sort((a, b) => a.time - b.time);
    if (sorted.length < 2) return baseValue;

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = Math.max(1e-4, last.time - first.time);

    if (mode === 'out' && time <= last.time) {
        return sampleKeyframes(sorted, time, baseValue);
    }
    if (mode === 'in' && time >= first.time) {
        return sampleKeyframes(sorted, time, baseValue);
    }

    const delta = mode === 'out' ? time - last.time : first.time - time;
    const cycles = Math.floor(delta / span);
    const rem = delta % span;
    const kind = String(typeStr || 'cycle').toLowerCase();

    if (kind === 'pingpong') {
        const forward = mode === 'out' ? cycles % 2 === 1 : cycles % 2 === 0;
        const sampleT = forward ? first.time + rem : last.time - rem;
        return sampleKeyframes(sorted, sampleT, baseValue);
    }

    if (kind === 'offset') {
        const totalDelta = last.value - first.value;
        const sampleT = mode === 'out' ? first.time + rem : last.time - rem;
        const v = sampleKeyframes(sorted, sampleT, baseValue);
        return mode === 'out'
            ? v + (cycles + 1) * totalDelta
            : v - (cycles + 1) * totalDelta;
    }

    if (kind === 'continue') {
        if (mode === 'out') {
            const prev = sorted[sorted.length - 2];
            const dt = last.time - prev.time;
            const slope = dt > 1e-4 ? (last.value - prev.value) / dt : 0;
            return last.value + slope * (time - last.time);
        } else {
            const next = sorted[1];
            const dt = next.time - first.time;
            const slope = dt > 1e-4 ? (next.value - first.value) / dt : 0;
            return first.value - slope * (first.time - time);
        }
    }

    // default 'cycle'
    const sampleT = mode === 'out' ? first.time + rem : last.time - rem;
    return sampleKeyframes(sorted, sampleT, baseValue);
}

function hashNoise(index, seed) {
    const value = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453123;
    return (value - Math.floor(value)) * 2 - 1;
}

/** Smooth, deterministic one-dimensional value noise in [-1, 1]. */
function noise1D(position, seed = 0) {
    const left = Math.floor(position);
    const fraction = position - left;
    const eased = fraction * fraction * (3 - 2 * fraction);
    const a = hashNoise(left, seed);
    const b = hashNoise(left + 1, seed);
    return a + (b - a) * eased;
}

const FUNCTIONS = Object.freeze({
    abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
    atan2: Math.atan2, exp: Math.exp, log: Math.log, pow: Math.pow, sign: Math.sign, hypot: Math.hypot,
    degreesToRadians: value => value * Math.PI / 180,
    radiansToDegrees: value => value * 180 / Math.PI,
    min: Math.min, max: Math.max, sqrt: Math.sqrt,
    mod: (value, divisor) => ((value % divisor) + divisor) % divisor,
    fract: value => value - Math.floor(value),
    clamp: (value, lo, hi) => Math.max(lo, Math.min(hi, value)),
    smoothstep: (edge0, edge1, value) => {
        if (edge0 === edge1) return value < edge0 ? 0 : 1;
        const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
        return x * x * (3 - 2 * x);
    },
    linear: (value, inMin, inMax, outMin, outMax) => inMax === inMin
        ? (value < inMin ? outMin : outMax)
        : outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin)),
    ease: (value, inMin, inMax, outMin, outMax) => {
        const p = inMax === inMin ? (value < inMin ? 0 : 1) : Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)));
        return outMin + (outMax - outMin) * p * p * (3 - 2 * p);
    },
    easeIn: (value, inMin, inMax, outMin, outMax) => {
        const p = inMax === inMin ? (value < inMin ? 0 : 1) : Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)));
        return outMin + (outMax - outMin) * p * p;
    },
    easeOut: (value, inMin, inMax, outMin, outMax) => {
        const p = inMax === inMin ? (value < inMin ? 0 : 1) : Math.max(0, Math.min(1, (value - inMin) / (inMax - inMin)));
        return outMin + (outMax - outMin) * (1 - (1 - p) * (1 - p));
    },
    bounce: (t, amp = 0.08, freq = 3, decay = 5) => {
        const time = Math.max(0, t);
        return amp * Math.sin(freq * time * 2 * Math.PI) * Math.exp(-decay * time);
    },
    overshoot: (t, s = 1.70158) => {
        const p = Math.max(0, Math.min(1, t)) - 1;
        return (p * p * ((s + 1) * p + s) + 1);
    },
    spring: (t, stiffness = 220, damping = 18, mass = 1) => {
        return solveSpring(t, stiffness, damping, mass);
    },
    squash: (stretch) => {
        const s = Math.abs(stretch);
        return s > 1e-4 ? 1 / s : 1;
    },
});

const FUNCTION_ARITY = Object.freeze({
    abs: [1, 1], ceil: [1, 1], floor: [1, 1], round: [1, 1],
    sin: [1, 1], cos: [1, 1], tan: [1, 1], asin: [1, 1], acos: [1, 1], atan: [1, 1],
    atan2: [2, 2], exp: [1, 1], log: [1, 1], pow: [2, 2], sign: [1, 1], hypot: [1, 3],
    degreesToRadians: [1, 1], radiansToDegrees: [1, 1], sqrt: [1, 1],
    mod: [2, 2], fract: [1, 1],
    min: [1, 48], max: [1, 48], clamp: [3, 3], smoothstep: [3, 3],
    linear: [5, 5], ease: [5, 5], easeIn: [5, 5], easeOut: [5, 5],
    bounce: [1, 4], overshoot: [1, 2], spring: [1, 4], squash: [1, 1],
    noise: [1, 2], wiggle: [2, 3],
    loopWiggle: [2, 4], loopwiggle: [2, 4],
    loopOut: [0, 2], loopout: [0, 2],
    loopIn: [0, 2], loopin: [0, 2],
    audioAmp: [0, 1], audioamp: [0, 1],
});

const EXPRESSION_FUNCTIONS = new Set([
    ...Object.keys(FUNCTIONS),
    'noise', 'wiggle',
    'loopWiggle', 'loopwiggle',
    'loopOut', 'loopout',
    'loopIn', 'loopin',
    'audioAmp', 'audioamp',
]);

function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (/\s/.test(ch)) {
            i++;
            continue;
        }
        if (/[0-9.]/.test(ch)) {
            if (ch === '.' && (i + 1 >= src.length || !/[0-9]/.test(src[i + 1]))) {
                tokens.push({ type: 'dot' });
                i++;
                continue;
            }
            let numStr = '';
            let dotSeen = false;
            while (i < src.length && /[0-9.]/.test(src[i])) {
                if (src[i] === '.') {
                    if (dotSeen) break;
                    dotSeen = true;
                }
                numStr += src[i++];
            }
            if (i < src.length && (src[i] === 'e' || src[i] === 'E')) {
                let eStr = src[i++];
                if (i < src.length && (src[i] === '+' || src[i] === '-')) {
                    eStr += src[i++];
                }
                while (i < src.length && /[0-9]/.test(src[i])) {
                    eStr += src[i++];
                }
                numStr += eStr;
            }
            const parsed = Number(numStr);
            if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${numStr}`);
            tokens.push({ type: 'num', value: parsed });
            continue;
        }
        if (ch === '"' || ch === "'") {
            const quote = ch;
            i++;
            let str = '';
            while (i < src.length && src[i] !== quote) {
                if (src[i] === '\\' && i + 1 < src.length) {
                    i++;
                    str += src[i++];
                } else {
                    str += src[i++];
                }
            }
            if (i >= src.length) throw new Error('Unterminated string literal');
            i++;
            tokens.push({ type: 'str', value: str });
            continue;
        }
        if (/[a-zA-Z_$]/.test(ch)) {
            let id = '';
            while (i < src.length && /[a-zA-Z0-9_$.]/.test(src[i])) {
                id += src[i++];
            }
            tokens.push({ type: 'id', value: id });
            continue;
        }
        if (ch === '(' || ch === ')') {
            tokens.push({ type: 'paren', value: ch });
            i++;
            continue;
        }
        if (ch === ',') {
            tokens.push({ type: 'comma' });
            i++;
            continue;
        }
        if (ch === '?') {
            tokens.push({ type: 'qmark' });
            i++;
            continue;
        }
        if (ch === ':') {
            tokens.push({ type: 'colon' });
            i++;
            continue;
        }
        const two = src.slice(i, i + 2);
        if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
            tokens.push({ type: 'op', value: two });
            i += 2;
            continue;
        }
        if ('+-*/%^<>!'.includes(ch)) {
            tokens.push({ type: 'op', value: ch });
            i++;
            continue;
        }
        throw new Error(`Unexpected character "${ch}"`);
    }
    return tokens;
}

export function evaluateMotionExpression(expression, variables = {}) {
    const source = String(expression || '').trim();
    if (!source || source.length > 512) return null;

    let tokens;
    try {
        tokens = tokenize(source);
    } catch {
        return null;
    }
    if (tokens.length === 0 || tokens.length > 128) return null;

    let cursor = 0;
    const peek = () => tokens[cursor];
    const take = () => tokens[cursor++];

    const toNum = (v) => {
        if (typeof v === 'number') return v;
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    };

    const resolveVar = (name) => {
        const lower = name.toLowerCase();
        if (lower === 'pi' || name === 'Math.PI') return Math.PI;
        if (lower === 'e' || name === 'Math.E') return Math.E;

        if (Object.prototype.hasOwnProperty.call(variables, name)) {
            const val = variables[name];
            if (typeof val === 'number') return val;
            const n = Number(val);
            if (Number.isFinite(n)) return n;
            throw new Error('Invalid variable');
        }
        if (Object.prototype.hasOwnProperty.call(variables, lower)) {
            const val = variables[lower];
            if (typeof val === 'number') return val;
            const n = Number(val);
            if (Number.isFinite(n)) return n;
            throw new Error('Invalid variable');
        }

        if (name.includes('.')) {
            const parts = name.split('.');
            let curr = variables;
            for (const part of parts) {
                if (curr && typeof curr === 'object' && part in curr) {
                    curr = curr[part];
                } else {
                    curr = undefined;
                    break;
                }
            }
            if (curr !== undefined) {
                const n = Number(curr);
                if (Number.isFinite(n)) return n;
            }
        }

        if (name === 't' && Object.prototype.hasOwnProperty.call(variables, 'time')) {
            return Number(variables.time);
        }
        if (name === 'time' && Object.prototype.hasOwnProperty.call(variables, 't')) {
            return Number(variables.t);
        }

        throw new Error(`Unknown variable ${name}`);
    };

    const callFn = (name, args) => {
        let cleanName = name;
        if (cleanName.startsWith('Math.') || cleanName.startsWith('math.')) {
            cleanName = cleanName.slice(5);
        }
        const lower = cleanName.toLowerCase();

        if (lower === 'noise') {
            if (args.length < 1 || args.length > 2) throw new Error('noise expects 1-2 arguments');
            return noise1D(toNum(args[0]), toNum(args[1] || 0));
        }
        if (lower === 'wiggle') {
            if (args.length < 2 || args.length > 3) throw new Error('wiggle expects frequency, amplitude and optional seed');
            const time = Number(variables.t ?? variables.time ?? 0);
            if (!Number.isFinite(time)) throw new Error('wiggle requires finite time');
            const frequency = Math.max(0.01, Math.min(120, Math.abs(toNum(args[0]))));
            const amplitude = Math.max(0, Math.min(1e6, Math.abs(toNum(args[1]))));
            const seed = args[2] !== undefined ? toNum(args[2]) : (Number(variables.seed ?? variables.index ?? 0) * 17.3);
            return noise1D(time * frequency, seed) * amplitude;
        }
        if (lower === 'loopwiggle') {
            if (args.length < 2 || args.length > 4) throw new Error('loopWiggle expects frequency, amplitude, and optional loopDuration, seed');
            const time = Number(variables.t ?? variables.time ?? 0);
            if (!Number.isFinite(time)) throw new Error('loopWiggle requires finite time');
            const frequency = Math.max(0.01, Math.min(120, Math.abs(toNum(args[0]))));
            const amplitude = Math.max(0, Math.min(1e6, Math.abs(toNum(args[1]))));
            const loopDuration = args[2] !== undefined ? Math.max(0.1, toNum(args[2])) : 5;
            const seed = args[3] !== undefined ? toNum(args[3]) : (Number(variables.seed ?? variables.index ?? 0) * 17.3);
            const cycleT = ((time % loopDuration) + loopDuration) % loopDuration;
            const progress = cycleT / loopDuration;
            const w1 = noise1D(progress * loopDuration * frequency, seed) * amplitude;
            const w2 = noise1D((progress - 1) * loopDuration * frequency, seed) * amplitude;
            return w1 * (1 - progress) + w2 * progress;
        }
        if (lower === 'loopout') {
            const loopType = typeof args[0] === 'string' ? args[0] : 'cycle';
            const time = Number(variables.t ?? variables.time ?? 0);
            const baseVal = Number(variables.value ?? 0);
            return evalLoop('out', loopType, variables.keyframes, time, baseVal);
        }
        if (lower === 'loopin') {
            const loopType = typeof args[0] === 'string' ? args[0] : 'cycle';
            const time = Number(variables.t ?? variables.time ?? 0);
            const baseVal = Number(variables.value ?? 0);
            return evalLoop('in', loopType, variables.keyframes, time, baseVal);
        }
        if (lower === 'audioamp') {
            const band = (typeof args[0] === 'string' ? args[0] : 'all').toLowerCase();
            const audio = variables.audio || {};
            if (band === 'bass') return Number(audio.bass ?? variables.bass ?? 0);
            if (band === 'mid') return Number(audio.mid ?? variables.mid ?? 0);
            if (band === 'treble') return Number(audio.treble ?? variables.treble ?? 0);
            return Number(audio.all ?? variables.audioAmp ?? variables.audio ?? 0);
        }

        const fn = FUNCTIONS[cleanName] || FUNCTIONS[lower];
        const arity = FUNCTION_ARITY[cleanName] || FUNCTION_ARITY[lower];
        if (!fn || !arity || args.length < arity[0] || args.length > arity[1]) {
            throw new Error(`Unsupported function arguments for ${name}`);
        }
        return fn(...args.map(toNum));
    };

    const primary = () => {
        const tok = take();
        if (!tok) throw new Error('Unexpected end of tokens');
        if (tok.type === 'paren' && tok.value === '(') {
            const val = ternary();
            const close = take();
            if (!close || close.type !== 'paren' || close.value !== ')') {
                throw new Error('Missing closing parenthesis');
            }
            return val;
        }
        if (tok.type === 'num') return tok.value;
        if (tok.type === 'str') return tok.value;
        if (tok.type === 'id') {
            if (peek() && peek().type === 'paren' && peek().value === '(') {
                take(); // '('
                const args = [];
                if (peek() && !(peek().type === 'paren' && peek().value === ')')) {
                    while (cursor < tokens.length) {
                        args.push(ternary());
                        if (peek() && peek().type === 'comma') {
                            take();
                        } else {
                            break;
                        }
                    }
                }
                const close = take();
                if (!close || close.type !== 'paren' || close.value !== ')') {
                    throw new Error('Missing function closing parenthesis');
                }
                return callFn(tok.value, args);
            }
            return resolveVar(tok.value);
        }
        throw new Error(`Invalid token ${tok.type}`);
    };

    const power = () => {
        let val = primary();
        if (peek() && peek().type === 'op' && peek().value === '^') {
            take();
            val = Math.pow(toNum(val), toNum(unary()));
        }
        return val;
    };

    const unary = () => {
        if (peek() && peek().type === 'op' && ['+', '-', '!'].includes(peek().value)) {
            const op = take().value;
            const val = unary();
            if (op === '-') return -toNum(val);
            if (op === '+') return toNum(val);
            if (op === '!') return toNum(val) === 0 ? 1 : 0;
        }
        return power();
    };

    const product = () => {
        let val = unary();
        while (peek() && peek().type === 'op' && ['*', '/', '%'].includes(peek().value)) {
            const op = take().value;
            const r = unary();
            const rNum = toNum(r);
            if (op === '*') val = toNum(val) * rNum;
            else if (op === '/') val = toNum(val) / rNum;
            else val = toNum(val) % rNum;
        }
        return val;
    };

    const sum = () => {
        let val = product();
        while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
            const op = take().value;
            const r = product();
            val = op === '+' ? toNum(val) + toNum(r) : toNum(val) - toNum(r);
        }
        return val;
    };

    const comparison = () => {
        let left = sum();
        while (peek() && peek().type === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(peek().value)) {
            const op = take().value;
            const right = sum();
            if (typeof left === 'string' && typeof right === 'string') {
                if (op === '==') left = left === right ? 1 : 0;
                else if (op === '!=') left = left !== right ? 1 : 0;
                else if (op === '<') left = left < right ? 1 : 0;
                else if (op === '>') left = left > right ? 1 : 0;
                else if (op === '<=') left = left <= right ? 1 : 0;
                else if (op === '>=') left = left >= right ? 1 : 0;
            } else {
                const l = toNum(left);
                const r = toNum(right);
                if (op === '<') left = l < r ? 1 : 0;
                else if (op === '>') left = l > r ? 1 : 0;
                else if (op === '<=') left = l <= r ? 1 : 0;
                else if (op === '>=') left = l >= r ? 1 : 0;
                else if (op === '==') left = l === r ? 1 : 0;
                else if (op === '!=') left = l !== r ? 1 : 0;
            }
        }
        return left;
    };

    const logicalAnd = () => {
        let left = comparison();
        while (peek() && peek().type === 'op' && peek().value === '&&') {
            take();
            const right = comparison();
            const lB = typeof left === 'string' ? Boolean(left) : toNum(left) !== 0;
            const rB = typeof right === 'string' ? Boolean(right) : toNum(right) !== 0;
            left = (lB && rB) ? 1 : 0;
        }
        return left;
    };

    const logicalOr = () => {
        let left = logicalAnd();
        while (peek() && peek().type === 'op' && peek().value === '||') {
            take();
            const right = logicalAnd();
            const lB = typeof left === 'string' ? Boolean(left) : toNum(left) !== 0;
            const rB = typeof right === 'string' ? Boolean(right) : toNum(right) !== 0;
            left = (lB || rB) ? 1 : 0;
        }
        return left;
    };

    const ternary = () => {
        const cond = logicalOr();
        if (peek() && peek().type === 'qmark') {
            take();
            const tVal = ternary();
            const colon = take();
            if (!colon || colon.type !== 'colon') {
                throw new Error('Expected ":" in ternary expression');
            }
            const fVal = ternary();
            const isTruthy = typeof cond === 'string' ? Boolean(cond) : toNum(cond) !== 0;
            return isTruthy ? tVal : fVal;
        }
        return cond;
    };

    try {
        const result = ternary();
        const finalNum = toNum(result);
        return cursor === tokens.length && Number.isFinite(finalNum) ? finalNum : null;
    } catch {
        return null;
    }
}

/**
 * Validate the sandbox expression grammar before an editor persists a formula.
 * Expressions stay inert in the renderer when invalid; this helper lets the
 * authoring UI explain why instead of silently leaving the property unchanged.
 */
export function validateMotionExpression(expression, { variables = ['t', 'time', 'duration', 'progress', 'value'] } = {}) {
    const source = String(expression || '').trim();
    if (!source) return { valid: false, reason: 'empty' };
    if (source.length > 512) return { valid: false, reason: 'too_long' };
    if (/\b[a-zA-Z_$]\w*\.[a-zA-Z_$]/.test(source)) {
        return { valid: false, reason: 'unsupported_syntax' };
    }

    let tokens;
    try {
        tokens = tokenize(source);
    } catch {
        return { valid: false, reason: 'unsupported_syntax' };
    }
    if (tokens.length === 0 || tokens.length > 128) {
        return { valid: false, reason: 'unsupported_syntax' };
    }

    const allowedVariables = new Set([
        'pi', 'e', 'Math.PI', 'Math.E', 'PI', 'E',
        'audio', 'audio.bass', 'audio.mid', 'audio.treble', 'audio.all',
        'keyframes', 'seed', 'index', 'fps', 'width', 'height', 'w', 'h',
        'layerStart', 'layerEnd',
        'scale', 'rotation', 'opacity', 'x', 'y',
        ...variables,
        ...variables.map(v => typeof v === 'string' ? v.toLowerCase() : v),
    ]);

    for (let index = 0; index < tokens.length; index++) {
        const tok = tokens[index];
        if (tok.type !== 'id') continue;
        const next = tokens[index + 1];
        if (next && next.type === 'paren' && next.value === '(') {
            let fnName = tok.value;
            if (fnName.startsWith('Math.') || fnName.startsWith('math.')) fnName = fnName.slice(5);
            if (!EXPRESSION_FUNCTIONS.has(fnName) && !EXPRESSION_FUNCTIONS.has(fnName.toLowerCase())) {
                return { valid: false, reason: 'unsupported_function', detail: tok.value };
            }
        } else {
            const val = tok.value;
            const root = val.split('.')[0];
            if (!allowedVariables.has(val) && !allowedVariables.has(val.toLowerCase()) && !allowedVariables.has(root) && !allowedVariables.has(root.toLowerCase())) {
                return { valid: false, reason: 'unknown_variable', detail: val };
            }
        }
    }

    const probeValues = [0.37, 1, 2.5];
    const contexts = [
        { t: 0.37, time: 0.37, duration: 2, progress: 0.185, value: 0.5 },
        { t: 1, time: 1, duration: 2, progress: 0.5, value: 1 },
        { t: 2.5, time: 2.5, duration: 4, progress: 0.625, value: 1.5 },
    ].map((context, index) => {
        context.audio = { bass: 0.5, mid: 0.5, treble: 0.5, all: 0.5 };
        context.keyframes = [{ time: 0, value: 0 }, { time: 2, value: 10 }];
        context.scale = probeValues[index];
        context.rotation = 0;
        context.opacity = 1;
        context.x = 0;
        context.y = 0;
        for (const variable of variables) {
            if (!Object.prototype.hasOwnProperty.call(context, variable) && variable !== 'pi' && variable !== 'e') {
                context[variable] = probeValues[index];
            }
        }
        return context;
    });

    if (!contexts.every(context => evaluateMotionExpression(source, context) !== null)) {
        return { valid: false, reason: 'non_finite' };
    }
    return { valid: true, reason: '' };
}
