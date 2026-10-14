/**
 * scripts/test_motion_springs.mjs
 *
 * Test suite for Phase 2: High-End Motion, Springs, Spatial Curves & Constraints.
 *
 * Verifies:
 *   1. Analytical spring physics (underdamped, critically damped, overdamped, velocity, settling).
 *   2. Spatial Bézier motion, arc-length LUT, derivative velocity vectors, banking, and motion blur.
 *   3. Constraint engine (topological sorting, cycle resilience, pin-to-edge, look-at, parenting).
 *   4. Integration with Easing.js and SceneMotion.js.
 */

import assert from 'node:assert';
import {
    createSpring,
    estimateSpringSettlingTime,
    solveSpringAt,
    sampleSpringTrajectory,
    compileSpringKeyframes,
    SPRING_PRESETS,
} from '../client/src/motion/SpringPhysics.js';

import {
    evaluateCubicBezier,
    evaluateCubicBezierDerivative,
    buildArcLengthLUT,
    pointsToBezierSpline,
    computeMotionBlur,
} from '../client/src/motion/SpatialMotion.js';

import {
    topologicalSortNodes,
    resolvePinToEdge,
    computeLookAtRotation,
    resolveConstraints,
} from '../client/src/motion/ConstraintEngine.js';

import { resolveEasing, isKnownEasing } from '../client/src/motion/Easing.js';
import { compilePath } from '../client/src/motion/SceneMotion.js';

let passed = 0;
let failed = 0;

function check(label, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ✓ ${label}`);
    } catch (err) {
        failed += 1;
        console.error(`  ✗ ${label}`);
        console.error(`      ${err.message}`);
    }
}

function approx(actual, expected, tol = 0.05, msg = '') {
    const diff = Math.abs(actual - expected);
    assert.ok(diff <= tol, `${msg || 'approx failed'}: expected ${expected} ± ${tol}, got ${actual}`);
}

console.log('\n--- 1. Analytical Spring Dynamics ---');

check('createSpring calculates natural frequency and damping ratio correctly', () => {
    // Underdamped: k=180, c=12, m=1 -> w0 = sqrt(180) ~ 13.416, zeta = 12 / (2 * 13.416) ~ 0.447 < 1
    const s1 = createSpring({ stiffness: 180, damping: 12, mass: 1 });
    assert.strictEqual(s1.regime, 'underdamped');
    approx(s1.zeta, 0.447, 0.01);

    // Critically damped: k=200, c=28.284, m=1 -> w0 ~ 14.142, zeta ~ 1.0
    const s2 = createSpring({ stiffness: 200, damping: 28.284, mass: 1 });
    assert.strictEqual(s2.regime, 'critically-damped');

    // Overdamped: k=100, c=40, m=1 -> w0=10, zeta = 40 / (20) = 2.0 > 1
    const s3 = createSpring({ stiffness: 100, damping: 40, mass: 1 });
    assert.strictEqual(s3.regime, 'overdamped');
});

check('underdamped spring exhibits overshoot and settles to target', () => {
    const s = createSpring({ stiffness: 180, damping: 12, mass: 1 });
    const from = 0;
    const to = 100;

    // At t=0: value must be exactly from
    const at0 = solveSpringAt(s, from, to, 0);
    assert.strictEqual(at0.value, from);

    // Sample along the curve and verify it overshoots 100
    let maxVal = 0;
    for (let t = 0.05; t <= 1.0; t += 0.02) {
        const state = solveSpringAt(s, from, to, t);
        if (state.value > maxVal) maxVal = state.value;
    }
    assert.ok(maxVal > to, `Expected overshoot above 100, got max ${maxVal}`);

    // At settling time (e.g. t=1.5s), value should be resting close to 100
    const settleTime = estimateSpringSettlingTime(s, from, to);
    assert.ok(settleTime > 0.5 && settleTime < 3.0, `Unreasonable settle time: ${settleTime}`);
    const atSettle = solveSpringAt(s, from, to, settleTime);
    approx(atSettle.value, to, 0.5, 'Spring value at settle time');
});

check('critically damped spring reaches target smoothly without overshooting', () => {
    const s = createSpring({ stiffness: 200, damping: 28.284, mass: 1 });
    const from = 0;
    const to = 100;

    for (let t = 0; t <= 2.0; t += 0.05) {
        const state = solveSpringAt(s, from, to, t);
        assert.ok(state.value <= to + 0.05, `Critically damped spring overshot: ${state.value}`);
    }
});

check('solveSpringAt velocity matches analytical derivative of position', () => {
    const s = createSpring({ stiffness: 180, damping: 12, mass: 1 });
    const from = 0;
    const to = 50;
    const t = 0.2;
    const dt = 0.0005;

    const state = solveSpringAt(s, from, to, t);
    const p1 = solveSpringAt(s, from, to, t - dt).value;
    const p2 = solveSpringAt(s, from, to, t + dt).value;
    const numericalVelocity = (p2 - p1) / (2 * dt);

    approx(state.velocity, numericalVelocity, 0.5, 'Velocity derivative check');
});

check('sampleSpringTrajectory and compileSpringKeyframes produce valid trajectories', () => {
    const samples = sampleSpringTrajectory('bouncy', 0, 1, { duration: 1.0, fps: 30 });
    assert.ok(samples.length >= 20);
    assert.strictEqual(samples[0].value, 0);

    const kfs = compileSpringKeyframes('snappy', 0, 100, 'scale', { duration: 0.8, samples: 10 });
    assert.strictEqual(kfs.length, 10);
    assert.strictEqual(kfs[0].properties.scale, 0);
    assert.strictEqual(kfs[0].time, 0);
    approx(kfs[kfs.length - 1].properties.scale, 100, 1.0);
});

console.log('\n--- 2. Spatial Bézier Curves & Motion Simulation ---');

check('evaluateCubicBezier interpolates endpoints and intermediate points correctly', () => {
    const p0 = { x: 0, y: 0 };
    const c1 = { x: 0, y: 100 };
    const c2 = { x: 100, y: 100 };
    const p3 = { x: 100, y: 0 };

    const start = evaluateCubicBezier(p0, c1, c2, p3, 0);
    assert.strictEqual(start.x, 0);
    assert.strictEqual(start.y, 0);

    const end = evaluateCubicBezier(p0, c1, c2, p3, 1);
    assert.strictEqual(end.x, 100);
    assert.strictEqual(end.y, 0);

    const mid = evaluateCubicBezier(p0, c1, c2, p3, 0.5);
    approx(mid.x, 50, 0.1);
    approx(mid.y, 75, 0.1);
});

check('evaluateCubicBezierDerivative computes exact velocity vector', () => {
    const p0 = { x: 0, y: 0 };
    const c1 = { x: 10, y: 20 };
    const c2 = { x: 40, y: 80 };
    const p3 = { x: 100, y: 100 };

    const deriv = evaluateCubicBezierDerivative(p0, c1, c2, p3, 0.5);
    const dt = 0.001;
    const a = evaluateCubicBezier(p0, c1, c2, p3, 0.5 - dt);
    const b = evaluateCubicBezier(p0, c1, c2, p3, 0.5 + dt);
    const numVx = (b.x - a.x) / (2 * dt);
    const numVy = (b.y - a.y) / (2 * dt);

    approx(deriv.vx, numVx, 0.1);
    approx(deriv.vy, numVy, 0.1);
});

check('buildArcLengthLUT produces monotonic distances and accurate sampling', () => {
    const p0 = { x: 0, y: 0 };
    const c1 = { x: 0, y: 50 };
    const c2 = { x: 100, y: 50 };
    const p3 = { x: 100, y: 0 };

    const { lut, totalLength, sampleAtDistance } = buildArcLengthLUT(p0, c1, c2, p3);
    assert.ok(totalLength > 100);
    for (let i = 1; i < lut.length; i++) {
        assert.ok(lut[i].s >= lut[i - 1].s, 'LUT arc length must be monotonic');
    }

    const mid = sampleAtDistance(totalLength / 2);
    approx(mid.x, 50, 2.0);
});

check('pointsToBezierSpline creates continuous path with heading and constant velocity', () => {
    const waypoints = [
        { x: 10, y: 20 },
        { x: 30, y: 80 },
        { x: 70, y: 60 },
        { x: 90, y: 10 },
    ];

    const spline = pointsToBezierSpline(waypoints);
    assert.ok(spline.totalLength > 100);

    const start = spline.sampleAtNormalizedDistance(0);
    approx(start.x, 10, 0.01);
    approx(start.y, 20, 0.01);

    const end = spline.sampleAtNormalizedDistance(1);
    approx(end.x, 90, 0.01);
    approx(end.y, 10, 0.01);

    // Tangent heading must be finite
    assert.ok(Number.isFinite(start.heading));
});

check('computeMotionBlur calculates directional blur distance, angle, and sub-samples', () => {
    const velocity = { vx: 400, vy: 300 }; // speed = 500 px/sec
    const blur = computeMotionBlur(velocity, { shutterAngle: 180, fps: 30, samples: 5 });

    // exposure time = 0.5 / 30 = 1/60 s
    approx(blur.exposureTime, 1 / 60, 0.001);
    // blur distance = 500 * (1/60) = 8.33 px
    approx(blur.blurDistance, 8.33, 0.1);
    // angle = atan2(300, 400) ~ 36.87 deg
    approx(blur.blurAngle, 36.87, 0.1);
    assert.strictEqual(blur.samples.length, 5);
    const sumOpacity = blur.samples.reduce((acc, s) => acc + s.opacity, 0);
    approx(sumOpacity, 1.0, 0.01);
});

console.log('\n--- 3. Parenting & Constraint Engine ---');

check('topologicalSortNodes orders parent before child and leader before follower', () => {
    const nodes = [
        { id: 'child', parentId: 'parent', constraints: {} },
        { id: 'follower', constraints: { targetId: 'leader' } },
        { id: 'parent', constraints: {} },
        { id: 'leader', constraints: {} },
    ];

    const sorted = topologicalSortNodes(nodes);
    const ids = sorted.map(n => n.id);
    assert.ok(ids.indexOf('parent') < ids.indexOf('child'));
    assert.ok(ids.indexOf('leader') < ids.indexOf('follower'));
});

check('topologicalSortNodes handles cyclic dependencies gracefully without crashing', () => {
    const nodes = [
        { id: 'A', constraints: { targetId: 'B' } },
        { id: 'B', constraints: { targetId: 'A' } },
    ];

    const sorted = topologicalSortNodes(nodes);
    assert.strictEqual(sorted.length, 2);
});

check('resolvePinToEdge computes responsive anchor coordinates', () => {
    const tl = resolvePinToEdge('top-left', { x: 8, y: 10 });
    assert.deepStrictEqual(tl, { x: 8, y: 10 });

    const br = resolvePinToEdge('bottom-right', { x: 5, y: 6 });
    assert.deepStrictEqual(br, { x: 95, y: 94 });

    const center = resolvePinToEdge('center');
    assert.deepStrictEqual(center, { x: 50, y: 50 });
});

check('computeLookAtRotation calculates aspect-correct orientation', () => {
    const frame = { w: 1920, h: 1080 };
    // Directly horizontal to the right
    const rotRight = computeLookAtRotation({ x: 10, y: 50 }, { x: 90, y: 50 }, frame);
    approx(rotRight, 0, 0.1);

    // Directly downward
    const rotDown = computeLookAtRotation({ x: 50, y: 10 }, { x: 50, y: 90 }, frame);
    approx(rotDown, 90, 0.1);
});

check('resolveConstraints resolves pin, tracking, and parent transforms', () => {
    const nodes = [
        {
            id: 'header',
            transform: { x: 50, y: 10, scale: 1, rotation: 0, opacity: 1 },
            constraints: { pinEdge: 'top-center', pinMargin: { x: 0, y: 5 } },
        },
        {
            id: 'badge',
            transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
            constraints: { targetId: 'header', offsetX: 15, offsetY: 0 },
        },
    ];

    const resolved = resolveConstraints(nodes, { w: 1920, h: 1080 });
    const headerT = resolved.get('header');
    assert.strictEqual(headerT.x, 50);
    assert.strictEqual(headerT.y, 5);

    const badgeT = resolved.get('badge');
    assert.strictEqual(badgeT.x, 65);
    assert.strictEqual(badgeT.y, 5);
});

console.log('\n--- 4. Integration with Easing & SceneMotion ---');

check('Easing.js resolves new spring presets (bouncy, smooth, heavy)', () => {
    assert.ok(isKnownEasing('bouncy'));
    assert.ok(isKnownEasing('smooth'));
    assert.ok(isKnownEasing('heavy'));
    assert.ok(isKnownEasing('spring-bouncy'));

    const fnBouncy = resolveEasing('bouncy');
    assert.strictEqual(typeof fnBouncy, 'function');
    assert.strictEqual(fnBouncy(0), 0);
    assert.strictEqual(fnBouncy(1), 1);
});

check('SceneMotion compilePath supports Bézier spline mode with banking', () => {
    const path = {
        points: [[10, 20], [40, 70], [80, 50]],
        mode: 'bezier',
        bank: 0.5,
        startTime: 0,
        duration: 1.0,
        samples: 6,
    };

    const anim = compilePath(path, { duration: 2.0 });
    assert.ok(anim !== null);
    assert.strictEqual(anim.keyframes.length, 6);
    assert.ok(anim.keyframes.some(kf => kf.properties.rotation !== undefined));
});

console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed.`);
console.log('========================================\n');

if (failed > 0) process.exit(1);
