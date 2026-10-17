/**
 * client/src/motion/SpringPhysics.js
 *
 * Analytical damped-harmonic oscillator engine for high-end motion graphics.
 *
 * Provides closed-form physical simulation of springs across underdamped,
 * critically damped, and overdamped regimes with zero drift, exact derivatives
 * (velocity), precise settling time computation, and keyframe synthesis.
 */

export const SPRING_PRESETS = Object.freeze({
    bouncy:  { stiffness: 180, damping: 12, mass: 1 },
    snappy:  { stiffness: 380, damping: 28, mass: 1 },
    gentle:  { stiffness: 120, damping: 14, mass: 1 },
    smooth:  { stiffness: 200, damping: 28.284, mass: 1 }, // zeta ~ 1.0 (critically damped)
    heavy:   { stiffness: 140, damping: 25, mass: 2 },
    stiff:   { stiffness: 210, damping: 20, mass: 1 },
    wobbly:  { stiffness: 180, damping: 10, mass: 1 },
});

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * Normalizes and analyzes spring parameters.
 * @param {object} [config] { stiffness, damping, mass, initialVelocity, restThreshold }
 */
export function createSpring(config = {}) {
    const preset = typeof config === 'string' ? SPRING_PRESETS[config] : null;
    const cfg = preset || (typeof config === 'object' && config !== null ? config : {});

    const k = Math.max(0.1, num(cfg.stiffness, 170));
    const c = Math.max(0.01, num(cfg.damping, 26));
    const m = Math.max(0.01, num(cfg.mass, 1));
    const v0 = num(cfg.initialVelocity, 0);
    const restThreshold = Math.max(1e-5, num(cfg.restThreshold, 0.001));

    const w0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(k * m));

    let regime = 'underdamped';
    if (Math.abs(zeta - 1) < 1e-4) {
        regime = 'critically-damped';
    } else if (zeta > 1) {
        regime = 'overdamped';
    }

    return {
        stiffness: k,
        damping: c,
        mass: m,
        initialVelocity: v0,
        restThreshold,
        w0,
        zeta,
        regime,
    };
}

/**
 * Calculates theoretical settling time in seconds where oscillation amplitude
 * decays within restThreshold of the travel distance.
 */
export function estimateSpringSettlingTime(springConfig, from = 0, to = 1) {
    const spring = createSpring(springConfig);
    const dist = Math.abs(to - from);
    if (dist < 1e-6) return 0;

    const eps = Math.max(1e-5, spring.restThreshold);
    const { w0, zeta, regime } = spring;

    if (regime === 'underdamped') {
        // Envelope is exp(-zeta * w0 * t) <= eps
        const decayRate = zeta * w0;
        return decayRate > 0 ? Math.log(1 / eps) / decayRate : 1.0;
    } else if (regime === 'critically-damped') {
        // (1 + w0 * t) * exp(-w0 * t) <= eps -> approx 9.2 / w0 for eps=0.001
        return Math.max(0.1, -Math.log(eps) / w0 * 1.5);
    } else {
        // Overdamped: dominated by the slower decay root r1 = -w0 * (zeta - sqrt(zeta^2 - 1))
        const r1 = w0 * (zeta - Math.sqrt(zeta * zeta - 1));
        return r1 > 0 ? Math.log(1 / eps) / r1 : 1.0;
    }
}

/**
 * Closed-form analytical evaluation of spring state at time `t` (seconds).
 * Returns position `value`, instantaneous `velocity`, and `isResting`.
 *
 * @param {object|string} springConfig
 * @param {number} from start value
 * @param {number} to target value
 * @param {number} t time in seconds
 */
export function solveSpringAt(springConfig, from = 0, to = 1, t = 0) {
    const spring = createSpring(springConfig);
    const time = Math.max(0, num(t, 0));
    const delta = to - from;

    if (Math.abs(delta) < 1e-7) {
        return { value: to, velocity: 0, isResting: true };
    }

    // Work in displacement space y(t) = x(t) - to
    const y0 = from - to;
    const v0 = spring.initialVelocity;
    const { w0, zeta, regime } = spring;

    let y = 0;
    let v = 0;

    if (regime === 'underdamped') {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        const decay = Math.exp(-zeta * w0 * time);
        const A = y0;
        const B = (v0 + zeta * w0 * y0) / wd;

        const cosWd = Math.cos(wd * time);
        const sinWd = Math.sin(wd * time);

        y = decay * (A * cosWd + B * sinWd);
        // Derivative:
        v = decay * ((B * wd - A * zeta * w0) * cosWd - (A * wd + B * zeta * w0) * sinWd);
    } else if (regime === 'critically-damped') {
        const decay = Math.exp(-w0 * time);
        const C1 = y0;
        const C2 = v0 + w0 * y0;

        y = decay * (C1 + C2 * time);
        v = decay * (C2 - w0 * (C1 + C2 * time));
    } else {
        // Overdamped
        const sqrtTerm = Math.sqrt(zeta * zeta - 1);
        const r1 = -w0 * (zeta - sqrtTerm);
        const r2 = -w0 * (zeta + sqrtTerm);

        const C1 = (v0 - r2 * y0) / (r1 - r2);
        const C2 = y0 - C1;

        const exp1 = Math.exp(r1 * time);
        const exp2 = Math.exp(r2 * time);

        y = C1 * exp1 + C2 * exp2;
        v = r1 * C1 * exp1 + r2 * C2 * exp2;
    }

    const value = to + y;
    const isResting = Math.abs(y) <= Math.abs(delta) * spring.restThreshold && Math.abs(v) <= 0.05 * Math.abs(delta);

    return {
        value,
        velocity: v,
        isResting,
    };
}

/**
 * Samples a continuous spring trajectory into an array of evaluation points.
 *
 * @param {object|string} springConfig
 * @param {number} from
 * @param {number} to
 * @param {object} [opts] { duration, fps, maxSamples }
 */
export function sampleSpringTrajectory(springConfig, from = 0, to = 1, opts = {}) {
    const spring = createSpring(springConfig);
    const estDuration = estimateSpringSettlingTime(spring, from, to);
    const duration = Math.max(0.05, num(opts.duration, estDuration));
    const fps = Math.min(120, Math.max(10, num(opts.fps, 60)));
    const sampleCount = Math.min(num(opts.maxSamples, 200), Math.max(5, Math.ceil(duration * fps)));

    const samples = [];
    for (let i = 0; i <= sampleCount; i++) {
        const t = (i / sampleCount) * duration;
        const state = solveSpringAt(spring, from, to, t);
        samples.push({
            time: Math.round(t * 1000) / 1000,
            value: Math.round(state.value * 1000) / 1000,
            velocity: Math.round(state.velocity * 1000) / 1000,
        });
    }

    return samples;
}

/**
 * Compiles a spring transition into keyframes for the MotionSchema animation pipeline.
 *
 * @param {object|string} springConfig
 * @param {number} from
 * @param {number} to
 * @param {string} prop property name (e.g. 'scale', 'x', 'y')
 * @param {object} [opts] { duration, samples = 12 }
 */
export function compileSpringKeyframes(springConfig, from, to, prop, opts = {}) {
    const spring = createSpring(springConfig);
    const settle = estimateSpringSettlingTime(spring, from, to);
    const duration = Math.max(0.05, num(opts.duration, settle));
    const samples = Math.min(24, Math.max(4, num(opts.samples, 12)));

    const keyframes = [];
    for (let i = 0; i < samples; i++) {
        const u = i / (samples - 1);
        const t = u * duration;
        const state = solveSpringAt(spring, from, to, t);
        keyframes.push({
            time: Math.round(t * 1000) / 1000,
            properties: {
                [prop]: Math.round(state.value * 1000) / 1000,
            },
        });
    }

    return keyframes;
}

export default {
    SPRING_PRESETS,
    createSpring,
    estimateSpringSettlingTime,
    solveSpringAt,
    sampleSpringTrajectory,
    compileSpringKeyframes,
};
