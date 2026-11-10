const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

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

/**
 * Sample one deterministic particle in an authored 3D emitter.
 *
 * A particle's position depends only on its seed, index and time. Preview
 * scrubbing and frame-by-frame worker export therefore produce the same
 * particle layout without keeping a mutable simulation between frames.
 * Returns null when a non-looping burst particle has not been born or has
 * expired.
 */
export function sampleProceduralParticle(config = {}, index = 0, time = 0) {
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
        opacity: Math.min(inAlpha, outAlpha),
        size: clamp(finite(config.size, 5), 0, 30),
        seed: cycleIndex,
    };
}

export function sampleProceduralParticles(config = {}, time = 0) {
    const count = Math.round(clamp(finite(config.count), 0, 500));
    const particles = [];
    for (let index = 0; index < count; index++) {
        const particle = sampleProceduralParticle(config, index, time);
        if (particle) particles.push({ index, ...particle });
    }
    return particles;
}
