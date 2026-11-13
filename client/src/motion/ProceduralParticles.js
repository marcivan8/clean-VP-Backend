import { resolveEasing } from './Easing.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const MAX_PROCEDURAL_PARTICLES = 2_000;

function random01(index, seed, salt = 0) {
    const value = Math.sin((index + 1) * 127.1 + (seed + salt) * 311.7) * 43758.5453;
    return value - Math.floor(value);
}

function randomDirection(index, seed) {
    const z = random01(index, seed, 1) * 2 - 1;
    const angle = random01(index, seed, 2) * Math.PI * 2;
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    return { x: radius * Math.cos(angle), y: z, z: radius * Math.sin(angle) };
}

export function normalizeParticleLifeCurve(track) {
    if (!Array.isArray(track) || track.length === 0) return [];
    return track.slice(0, 32).map((point, order) => ({
        time: Number(point?.time ?? point?.progress),
        value: Number(point?.value),
        easing: typeof point?.easing === 'string' ? point.easing : 'linear',
        order,
    })).filter(point => Number.isFinite(point.time) && Number.isFinite(point.value))
        .map(point => ({ ...point, time: clamp(point.time, 0, 1) }))
        .sort((a, b) => a.time - b.time || a.order - b.order);
}

/** Update one normalized endpoint without creating a stop the renderer drops. */
export function setParticleLifeCurveEndpoint(track, endpoint, value) {
    const time = clamp(finite(endpoint), 0, 1);
    const points = normalizeParticleLifeCurve(track)
        .filter(point => point.time !== time)
        .map(({ time: pointTime, value: pointValue, easing }) => ({ time: pointTime, value: pointValue, easing }));
    points.push({ time, value: finite(value), easing: 'linear' });
    points.sort((a, b) => a.time - b.time);
    if (points.length <= 32) return points;

    const starts = points.filter(point => point.time === 0).slice(0, 1);
    const ends = points.filter(point => point.time === 1).slice(0, 1);
    const edited = points.find(point => point.time === time);
    const preserved = new Set([starts[0], ends[0], edited].filter(Boolean));
    const interior = points.filter(point => !preserved.has(point));
    return [...preserved, ...interior.slice(0, 32 - preserved.size)].sort((a, b) => a.time - b.time);
}

/** Set the interpolation used as a life curve leaves one normalized stop. */
export function setParticleLifeCurveEasing(track, endpoint, easing) {
    const time = clamp(finite(endpoint), 0, 1);
    const name = typeof easing === 'string' && easing.trim() ? easing.trim() : 'linear';
    const points = normalizeParticleLifeCurve(track);
    const index = points.findIndex(point => point.time === time);
    if (index < 0) return Array.isArray(track) ? track : [];
    points[index] = { ...points[index], easing: name };
    return points.map(({ time: pointTime, value, easing: pointEasing }) => ({ time: pointTime, value, easing: pointEasing }));
}

function sampleLifeCurve(points, progress, fallback) {
    if (!points.length) return fallback;
    if (progress <= points[0].time) return points[0].value;
    if (progress >= points[points.length - 1].time) return points[points.length - 1].value;
    let from = points[0];
    for (let index = 1; index < points.length; index++) {
        const to = points[index];
        if (progress <= to.time) {
            if (to.time === from.time) return to.value;
            const amount = (progress - from.time) / (to.time - from.time);
            const eased = resolveEasing(from.easing)(amount);
            return from.value + (to.value - from.value) * eased;
        }
        from = to;
    }
    return points[points.length - 1].value;
}

const parseParticleColor = value => {
    const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(value || '').trim());
    if (!match) return null;
    const hex = match[1].length === 3 ? [...match[1]].map(channel => channel + channel).join('') : match[1];
    return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
};

export function normalizeParticleColorCurve(track) {
    if (!Array.isArray(track)) return [];
    return track.slice(0, 32).map((point, order) => ({
        time: Number(point?.time ?? point?.progress),
        color: String(point?.color ?? ''),
        easing: typeof point?.easing === 'string' ? point.easing : 'linear',
        order,
    })).filter(point => Number.isFinite(point.time) && parseParticleColor(point.color))
        .map(point => ({ ...point, time: clamp(point.time, 0, 1) }))
        .sort((a, b) => a.time - b.time || a.order - b.order);
}

export function setParticleColorCurveEasing(track, endpoint, easing) {
    const time = clamp(finite(endpoint), 0, 1);
    const name = typeof easing === 'string' && easing.trim() ? easing.trim() : 'linear';
    const points = normalizeParticleColorCurve(track);
    const index = points.findIndex(point => point.time === time);
    if (index < 0) return Array.isArray(track) ? track : [];
    points[index] = { ...points[index], easing: name };
    return points.map(({ time: pointTime, color, easing: pointEasing }) => ({ time: pointTime, color, easing: pointEasing }));
}

export function sampleParticleColorOverLife(track, progress, fallback = '#C4B5FD', preparedCurve = null) {
    const points = preparedCurve || normalizeParticleColorCurve(track);
    if (!points.length) return parseParticleColor(fallback) ? fallback : '#C4B5FD';
    const t = clamp(finite(progress), 0, 1);
    let from = points[0];
    if (t <= from.time) return from.color;
    for (let index = 1; index < points.length; index++) {
        const to = points[index];
        if (t <= to.time) {
            if (to.time === from.time) return to.color;
            const amount = resolveEasing(from.easing)((t - from.time) / (to.time - from.time));
            const a = parseParticleColor(from.color), b = parseParticleColor(to.color);
            const channels = a.map((channel, i) => Math.round(channel + (b[i] - channel) * amount));
            return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
        }
        from = to;
    }
    return points[points.length - 1].color;
}

/**
 * Sample one deterministic particle in an authored 3D emitter.
 *
 * A particle's position depends only on its seed, index and time. Preview
 * scrubbing and frame-by-frame worker export therefore produce the same
 * particle layout without keeping a mutable simulation between frames.
 * Returns null when a non-looping burst particle has not been born or has
 * expired.
 */
export function sampleProceduralParticle(config = {}, index = 0, time = 0, preparedSizeCurve = null, preparedOpacityCurve = null, preparedColorCurve = null) {
    const seed = finite(config.seed, 17);
    const emitter = config.emitter && typeof config.emitter === 'object' ? config.emitter : {};
    const shape = ['point', 'box', 'sphere', 'ring'].includes(emitter.shape) ? emitter.shape : 'box';
    const center = emitter.position || {};
    const size = emitter.size || {};
    const velocity = config.velocity || {};
    const gravity = config.gravity || {};
    const lifetime = clamp(finite(config.lifetime, 4), 0.05, 120);
    const elapsed = Math.max(0, finite(time, 0));
    const burst = emitter.mode === 'burst';
    const initialAge = burst ? 0 : random01(index, seed, 3) * lifetime;
    const ageProgress = initialAge + elapsed;
    if (!burst && config.loop === false && ageProgress >= lifetime) return null;
    if (burst && config.loop === false && elapsed >= lifetime) return null;
    const cycle = Math.floor(ageProgress / lifetime);
    // A looping burst emits a fresh deterministic batch each lifetime. Only
    // one-shot emitters keep unwrapped elapsed time so their particles expire.
    const age = config.loop === false ? ageProgress : ageProgress % lifetime;
    const cycleIndex = config.loop === false ? index : index + cycle * 997;

    let offset;
    if (shape === 'point') {
        offset = { x: 0, y: 0, z: 0 };
    } else if (shape === 'sphere') {
        const direction = randomDirection(cycleIndex, seed);
        const radius = Math.cbrt(random01(cycleIndex, seed, 4));
        offset = {
            x: direction.x * radius * clamp(finite(size.x, finite(size.radius, 1)), 0, 50),
            y: direction.y * radius * clamp(finite(size.y, finite(size.radius, 1)), 0, 50),
            z: direction.z * radius * clamp(finite(size.z, finite(size.radius, 1)), 0, 50),
        };
    } else if (shape === 'ring') {
        const angle = random01(cycleIndex, seed, 5) * Math.PI * 2;
        const innerRatio = clamp(finite(emitter.innerRatio, 0.65), 0, 0.99);
        const radial = Math.sqrt(innerRatio * innerRatio + random01(cycleIndex, seed, 6) * (1 - innerRatio * innerRatio));
        const radiusX = clamp(finite(size.x, finite(size.radius, 1)), 0, 50);
        const radiusZ = clamp(finite(size.z, radiusX), 0, 50);
        offset = { x: Math.cos(angle) * radiusX * radial, y: (random01(cycleIndex, seed, 7) - 0.5) * finite(size.y), z: Math.sin(angle) * radiusZ * radial };
    } else {
        offset = {
            x: (random01(cycleIndex, seed, 8) - 0.5) * clamp(finite(size.x, finite(config.spread, 3.8)), 0, 50),
            y: (random01(cycleIndex, seed, 9) - 0.5) * clamp(finite(size.y, finite(config.spread, 3.8)), 0, 50),
            z: (random01(cycleIndex, seed, 10) - 0.5) * clamp(finite(size.z, finite(config.spread, 3.8) * 0.35), 0, 50),
        };
    }

    const speed = clamp(finite(config.speed, 1), 0, 20);
    const turbulence = clamp(finite(config.turbulence, 0), 0, 20);
    const frequency = clamp(finite(config.turbulenceFrequency, 1.5), 0.1, 30);
    const phase = random01(index, seed, 11) * Math.PI * 2;
    const position = {};
    for (const axis of ['x', 'y', 'z']) {
        const drift = finite(velocity[axis]) * speed * age;
        const acceleration = 0.5 * finite(gravity[axis]) * age * age;
        const noise = turbulence * Math.sin(age * frequency + phase + ({ x: 0, y: 2.1, z: 4.2 })[axis]);
        position[axis] = finite(center[axis]) + offset[axis] + drift + acceleration + noise;
    }

    const fadeIn = clamp(finite(config.fadeIn, Math.min(0.15, lifetime * 0.2)), 0, lifetime);
    const fadeOut = clamp(finite(config.fadeOut, Math.min(0.35, lifetime * 0.25)), 0, lifetime);
    const inAlpha = fadeIn > 0 ? clamp(age / fadeIn, 0, 1) : 1;
    const outAlpha = fadeOut > 0 ? clamp((lifetime - age) / fadeOut, 0, 1) : 1;
    return {
        position,
        age,
        lifeProgress: clamp(age / lifetime, 0, 1),
        opacity: clamp(Math.min(inAlpha, outAlpha) * sampleLifeCurve(preparedOpacityCurve || normalizeParticleLifeCurve(config.opacityOverLife),
            clamp(age / lifetime, 0, 1), 1), 0, 1),
        size: clamp(sampleLifeCurve(preparedSizeCurve || normalizeParticleLifeCurve(config.sizeOverLife),
            clamp(age / lifetime, 0, 1), finite(config.size, 5)), 0, 30),
        color: sampleParticleColorOverLife(config.colorOverLife, clamp(age / lifetime, 0, 1), config.color || '#C4B5FD', preparedColorCurve),
        seed: cycleIndex,
    };
}

export function sampleProceduralParticles(config = {}, time = 0) {
    const count = Math.round(clamp(finite(config.count), 0, MAX_PROCEDURAL_PARTICLES));
    const particles = [];
    for (let index = 0; index < count; index++) {
        const particle = sampleProceduralParticle(config, index, time);
        if (particle) particles.push({ index, ...particle });
    }
    return particles;
}
