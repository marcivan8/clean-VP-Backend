/**
 * client/src/motion/SpatialMotion.js
 *
 * High-end spatial Bézier motion, arc-length reparameterization, banking,
 * and optical motion-blur simulation for 2D motion graphics.
 */

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * Evaluates a 2D cubic Bézier curve at parameter t in [0, 1].
 * Formula: B(t) = (1-t)^3*P0 + 3(1-t)^2*t*C1 + 3(1-t)*t^2*C2 + t^3*P3
 */
export function evaluateCubicBezier(p0, c1, c2, p3, t) {
    const u = Math.max(0, Math.min(1, num(t, 0)));
    const u1 = 1 - u;
    const b0 = u1 * u1 * u1;
    const b1 = 3 * u1 * u1 * u;
    const b2 = 3 * u1 * u * u;
    const b3 = u * u * u;

    const x = b0 * p0.x + b1 * c1.x + b2 * c2.x + b3 * p3.x;
    const y = b0 * p0.y + b1 * c1.y + b2 * c2.y + b3 * p3.y;

    return { x, y };
}

/**
 * Computes first derivative (velocity vector dP/dt) of cubic Bézier at parameter t.
 * B'(t) = 3*(1-t)^2*(C1-P0) + 6*(1-t)*t*(C2-C1) + 3*t^2*(P3-C2)
 */
export function evaluateCubicBezierDerivative(p0, c1, c2, p3, t) {
    const u = Math.max(0, Math.min(1, num(t, 0)));
    const u1 = 1 - u;

    const vx = 3 * u1 * u1 * (c1.x - p0.x) + 6 * u1 * u * (c2.x - c1.x) + 3 * u * u * (p3.x - c2.x);
    const vy = 3 * u1 * u1 * (c1.y - p0.y) + 6 * u1 * u * (c2.y - c1.y) + 3 * u * u * (p3.y - c2.y);

    return { vx, vy };
}

/**
 * Builds an arc-length Lookup Table (LUT) for uniform speed travel along a Bézier segment.
 * @param {object} p0
 * @param {object} c1
 * @param {object} c2
 * @param {object} p3
 * @param {number} [samples=64]
 */
export function buildArcLengthLUT(p0, c1, c2, p3, samples = 64) {
    const n = Math.max(8, samples);
    const lut = [{ t: 0, s: 0, x: p0.x, y: p0.y }];
    let totalLength = 0;
    let prev = { x: p0.x, y: p0.y };

    for (let i = 1; i <= n; i++) {
        const t = i / n;
        const pt = evaluateCubicBezier(p0, c1, c2, p3, t);
        const dx = pt.x - prev.x;
        const dy = pt.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        totalLength += dist;
        lut.push({ t, s: totalLength, x: pt.x, y: pt.y });
        prev = pt;
    }

    return {
        lut,
        totalLength,
        sampleAtDistance: (targetDistance) => {
            if (targetDistance <= 0 || totalLength <= 1e-6) return { t: 0, ...lut[0] };
            if (targetDistance >= totalLength) return { t: 1, ...lut[lut.length - 1] };

            // Binary search in LUT
            let low = 0;
            let high = lut.length - 1;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (lut[mid].s < targetDistance) low = mid + 1;
                else high = mid - 1;
            }

            const i = Math.max(1, Math.min(lut.length - 1, low));
            const pA = lut[i - 1];
            const pB = lut[i];
            const frac = (targetDistance - pA.s) / Math.max(1e-6, pB.s - pA.s);
            const t = pA.t + (pB.t - pA.t) * frac;
            return {
                t,
                x: pA.x + (pB.x - pA.x) * frac,
                y: pA.y + (pB.y - pA.y) * frac,
            };
        },
    };
}

/**
 * Converts a sequence of 2D waypoints into smooth cubic Bézier segments (Catmull-Rom to Bézier).
 * @param {Array<{x:number, y:number}|[number, number]>} points
 * @param {boolean} [closed=false]
 */
export function pointsToBezierSpline(points, closed = false) {
    const raw = (points || []).map(p => (Array.isArray(p) ? { x: num(p[0], 0), y: num(p[1], 0) } : { x: num(p?.x, 0), y: num(p?.y, 0) }));
    if (raw.length < 2) return [];

    const pts = [...raw];
    if (closed && (pts[0].x !== pts[pts.length - 1].x || pts[0].y !== pts[pts.length - 1].y)) {
        pts.push({ x: pts[0].x, y: pts[0].y });
    }

    const segments = [];
    const n = pts.length;

    for (let i = 0; i < n - 1; i++) {
        const p0 = i === 0 ? (closed ? pts[n - 2] : pts[0]) : pts[i - 1];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = i + 2 < n ? pts[i + 2] : (closed ? pts[1] : pts[n - 1]);

        // Catmull-Rom to Cubic Bézier control points:
        // C1 = P1 + (P2 - P0) / 6
        // C2 = P2 - (P3 - P1) / 6
        const c1 = {
            x: p1.x + (p2.x - p0.x) / 6,
            y: p1.y + (p2.y - p0.y) / 6,
        };
        const c2 = {
            x: p2.x - (p3.x - p1.x) / 6,
            y: p2.y - (p3.y - p1.y) / 6,
        };

        const lutData = buildArcLengthLUT(p1, c1, c2, p2);
        segments.push({
            p0: p1,
            c1,
            c2,
            p3: p2,
            length: lutData.totalLength,
            lutData,
        });
    }

    const totalLength = segments.reduce((acc, seg) => acc + seg.length, 0);

    return {
        segments,
        totalLength,
        sampleAtNormalizedDistance: (progress) => {
            const u = Math.max(0, Math.min(1, num(progress, 0)));
            if (totalLength <= 1e-6 || segments.length === 0) {
                return { x: pts[0].x, y: pts[0].y, vx: 0, vy: 0, heading: 0 };
            }

            const targetDist = u * totalLength;
            let accumulated = 0;
            let targetSeg = segments[0];

            for (const seg of segments) {
                if (accumulated + seg.length >= targetDist || seg === segments[segments.length - 1]) {
                    targetSeg = seg;
                    break;
                }
                accumulated += seg.length;
            }

            const localDist = targetDist - accumulated;
            const pt = targetSeg.lutData.sampleAtDistance(localDist);
            const deriv = evaluateCubicBezierDerivative(targetSeg.p0, targetSeg.c1, targetSeg.c2, targetSeg.p3, pt.t);
            const heading = (Math.atan2(deriv.vy, deriv.vx) * 180) / Math.PI;

            return {
                x: pt.x,
                y: pt.y,
                vx: deriv.vx,
                vy: deriv.vy,
                heading,
            };
        },
    };
}

/**
 * Computes instantaneous motion blur parameters and multi-sample rendering offsets.
 *
 * @param {object} velocity { vx, vy } in pixels/sec or percent/sec
 * @param {object} [options]
 * @param {number} [options.shutterAngle=180] 0 to 360 degrees
 * @param {number} [options.fps=30]
 * @param {number} [options.samples=5] number of sub-frame blur samples
 */
export function computeMotionBlur(velocity, options = {}) {
    const vx = num(velocity?.vx, 0);
    const vy = num(velocity?.vy, 0);
    const shutterAngle = Math.max(0, Math.min(360, num(options.shutterAngle, 180)));
    const fps = Math.max(1, num(options.fps, 30));
    const sampleCount = Math.max(1, Math.min(15, num(options.samples, 5)));

    const speed = Math.sqrt(vx * vx + vy * vy);
    // Exposure duration in seconds: (shutterAngle / 360) * (1 / fps)
    const exposureTime = (shutterAngle / 360) / fps;
    const blurDistance = speed * exposureTime;
    const blurAngle = (Math.atan2(vy, vx) * 180) / Math.PI;

    // Multi-sample sub-frame positions centered at t=0
    const samples = [];
    if (sampleCount === 1 || blurDistance < 0.5) {
        samples.push({ dx: 0, dy: 0, opacity: 1 });
    } else {
        const halfTime = exposureTime / 2;
        for (let i = 0; i < sampleCount; i++) {
            const frac = sampleCount > 1 ? i / (sampleCount - 1) : 0.5;
            const dt = (frac - 0.5) * exposureTime;
            samples.push({
                dx: vx * dt,
                dy: vy * dt,
                opacity: 1 / sampleCount,
            });
        }
    }

    return {
        speed,
        blurDistance,
        blurAngle,
        exposureTime,
        samples,
    };
}

export default {
    evaluateCubicBezier,
    evaluateCubicBezierDerivative,
    buildArcLengthLUT,
    pointsToBezierSpline,
    computeMotionBlur,
};
