/**
 * Small, deterministic expression evaluator for motion properties.
 * It intentionally supports arithmetic and a short math-function whitelist;
 * it never evaluates JavaScript or exposes the global object.
 */
const FUNCTIONS = Object.freeze({
    abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    min: Math.min, max: Math.max, sqrt: Math.sqrt,
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
});
const EXPRESSION_FUNCTIONS = new Set([...Object.keys(FUNCTIONS), 'noise', 'wiggle']);
const FUNCTION_ARITY = Object.freeze({
    abs: [1, 1], ceil: [1, 1], floor: [1, 1], round: [1, 1],
    sin: [1, 1], cos: [1, 1], tan: [1, 1], sqrt: [1, 1],
    min: [1, 3], max: [1, 3], clamp: [3, 3], smoothstep: [3, 3],
    linear: [5, 5], ease: [5, 5], easeIn: [5, 5], easeOut: [5, 5],
    noise: [1, 2], wiggle: [2, 3],
});

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

export function evaluateMotionExpression(expression, variables = {}) {
    const source = String(expression || '').trim();
    if (!source || source.length > 240) return null;
    const tokens = source.match(/(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?|[a-zA-Z_]\w*|[()+\-*/%^,]/g) || [];
    if (tokens.join('') !== source.replace(/\s+/g, '') || tokens.length > 96) return null;
    let cursor = 0;
    const peek = () => tokens[cursor];
    const take = () => tokens[cursor++];
    const number = (token) => Number(token);
    const primary = () => {
        const token = take();
        if (token === '(') {
            const value = sum();
            if (take() !== ')') throw new Error('Missing closing parenthesis');
            return value;
        }
        if (token && /^\d/.test(token)) return number(token);
        if (token && /^[a-zA-Z_]/.test(token)) {
            if (peek() !== '(') {
                if (token === 'pi') return Math.PI;
                if (token === 'e') return Math.E;
                // A misspelled variable must fail closed. Returning zero made
                // a typo such as `progres` look like a valid expression and
                // quietly pinned the animated property to an unintended value.
                if (!Object.prototype.hasOwnProperty.call(variables, token)) throw new Error('Unknown variable');
                const value = Number(variables[token]);
                if (!Number.isFinite(value)) throw new Error('Invalid variable');
                return value;
            }
            take();
            const args = [];
            if (peek() !== ')') {
                do { args.push(sum()); if (peek() !== ',') break; take(); } while (cursor < tokens.length);
            }
            if (take() !== ')') throw new Error('Missing function parenthesis');
            if (token === 'noise') {
                if (args.length < 1 || args.length > 2) throw new Error('noise expects position and optional seed');
                return noise1D(args[0], args[1] || 0);
            }
            if (token === 'wiggle') {
                if (args.length < 2 || args.length > 3) throw new Error('wiggle expects frequency, amplitude and optional seed');
                const time = Number(variables.t ?? variables.time ?? 0);
                if (!Number.isFinite(time)) throw new Error('wiggle requires finite time');
                const frequency = Math.max(0.01, Math.min(120, Math.abs(args[0])));
                const amplitude = Math.max(0, Math.min(1e6, Math.abs(args[1])));
                return noise1D(time * frequency, args[2] || 0) * amplitude;
            }
            const fn = FUNCTIONS[token];
            const arity = FUNCTION_ARITY[token];
            if (!fn || !arity || args.length < arity[0] || args.length > arity[1]) {
                throw new Error('Unsupported function arguments');
            }
            return fn(...args);
        }
        throw new Error('Invalid expression');
    };
    // Unary signs bind less tightly than exponentiation, so `-2^2` is -4,
    // while signed exponents such as `2^-2` remain valid. Exponentiation is
    // still right-associative.
    const power = () => { let value = primary(); if (peek() === '^') { take(); value **= unary(); } return value; };
    const unary = () => {
        if (peek() === '+' || peek() === '-') {
            const sign = take();
            const value = unary();
            return sign === '-' ? -value : value;
        }
        return power();
    };
    const product = () => {
        let value = unary();
        while (['*', '/', '%'].includes(peek())) {
            const op = take(), right = unary();
            value = op === '*' ? value * right : op === '/' ? value / right : value % right;
        }
        return value;
    };
    const sum = () => {
        let value = product();
        while (peek() === '+' || peek() === '-') { const op = take(), right = product(); value = op === '+' ? value + right : value - right; }
        return value;
    };
    try {
        const result = sum();
        return cursor === tokens.length && Number.isFinite(result) ? result : null;
    } catch { return null; }
}

/**
 * Validate the sandbox expression grammar before an editor persists a formula.
 * Expressions stay inert in the renderer when invalid; this helper lets the
 * authoring UI explain why instead of silently leaving the property unchanged.
 */
export function validateMotionExpression(expression, { variables = ['t', 'time', 'duration', 'progress', 'value'] } = {}) {
    const source = String(expression || '').trim();
    if (!source) return { valid: false, reason: 'empty' };
    if (source.length > 240) return { valid: false, reason: 'too_long' };
    const tokens = source.match(/(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?|[a-zA-Z_]\w*|[()+\-*/%^,]/g) || [];
    if (tokens.join('') !== source.replace(/\s+/g, '') || tokens.length > 96) {
        return { valid: false, reason: 'unsupported_syntax' };
    }
    const allowedVariables = new Set(['pi', 'e', ...variables]);
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (!/^[a-zA-Z_]\w*$/.test(token)) continue;
        if (tokens[index + 1] === '(') {
            if (!EXPRESSION_FUNCTIONS.has(token)) return { valid: false, reason: 'unsupported_function', detail: token };
        } else if (!allowedVariables.has(token)) {
            return { valid: false, reason: 'unknown_variable', detail: token };
        }
    }
    // Supply every caller-declared variable to the probes as well as the
    // built-ins. Previously the grammar accepted custom names here, but the
    // evaluator then saw them as undefined and rejected otherwise valid
    // expressions. Probe custom variables at several values so singularities
    // such as `1 / (custom - 1)` still fail closed.
    const probeValues = [0.37, 1, 2.5];
    const contexts = [
        { t: 0.37, time: 0.37, duration: 2, progress: 0.185, value: 0.5 },
        { t: 1, time: 1, duration: 2, progress: 0.5, value: 1 },
        { t: 2.5, time: 2.5, duration: 4, progress: 0.625, value: 1.5 },
    ].map((context, index) => {
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
