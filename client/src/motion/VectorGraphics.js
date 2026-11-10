/**
 * client/src/motion/VectorGraphics.js
 *
 * Expressive Vector Graphics Engine for VIBED.
 *
 * Pure Canvas 2D engine — ZERO DOM, React, or browser dependencies.
 * Runs identically in the browser preview (Canvas 2D) and the export
 * worker (@napi-rs/canvas / Skia).
 *
 * Features:
 *   1. SVG Path parsing & path command list execution (M, L, C, Q, S, T, A, Z).
 *   2. Parametric vector shapes: rounded rectangles with per-corner radii,
 *      circles, ellipses, regular polygons, stars, arrows, capsules, callouts.
 *   3. Linear & radial gradients, gradient fills and gradient strokes.
 *   4. Animated stroke trimming (trimStart / trimEnd) for animated line reveals.
 *   5. Drop shadows, glows, and layer blend modes (globalCompositeOperation).
 *   6. Reusable clipping paths and alpha matte masks.
 */

import { resolveEasing } from './Easing.js';

// ── SVG Path Parser & Path Operations ────────────────────────────────────────

export const MAX_VECTOR_PATH_CHARS = 100_000;
export const MAX_VECTOR_PATH_COMMANDS = 20_000;

/** Validate SVG path syntax and bound the amount of work accepted by render. */
export function validateSvgPathData(data) {
    if (typeof data !== 'string' || !data.trim()) return { valid: false, reason: 'empty' };
    if (data.length > MAX_VECTOR_PATH_CHARS) return { valid: false, reason: 'too_large' };
    const tokens = [];
    const lexer = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?|[\s,]+/gy;
    let offset = 0, match;
    while (offset < data.length) {
        lexer.lastIndex = offset;
        match = lexer.exec(data);
        if (!match || match.index !== offset) return { valid: false, reason: 'invalid_character' };
        offset = lexer.lastIndex;
        if (/^[\s,]+$/.test(match[0])) continue;
        const value = /^[a-zA-Z]$/.test(match[0]) ? match[0] : Number(match[0]);
        if (typeof value === 'number' && !Number.isFinite(value)) return { valid: false, reason: 'non_finite' };
        tokens.push(value);
    }
    const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
    let index = 0, command = '', count = 0, hasMove = false;
    while (index < tokens.length) {
        if (typeof tokens[index] === 'string') {
            command = tokens[index++];
            const upper = command.toUpperCase();
            if (!hasMove && upper !== 'M') return { valid: false, reason: 'missing_move' };
            if (upper === 'Z') {
                if (!hasMove) return { valid: false, reason: 'missing_move' };
                command = '';
                count++;
                if (count > MAX_VECTOR_PATH_COMMANDS) return { valid: false, reason: 'too_complex' };
                continue;
            }
            if (!(upper in arity)) return { valid: false, reason: 'unsupported_command' };
            if (index >= tokens.length || typeof tokens[index] === 'string') return { valid: false, reason: 'missing_arguments' };
        }
        if (!command) return { valid: false, reason: 'number_without_command' };
        const upper = command.toUpperCase(), args = arity[upper];
        let groups = 0;
        while (index < tokens.length && typeof tokens[index] !== 'string') {
            if (index + args > tokens.length || tokens.slice(index, index + args).some(value => typeof value !== 'number')) {
                return { valid: false, reason: 'incomplete_command' };
            }
            if (upper === 'A' && (![0, 1].includes(tokens[index + 3]) || ![0, 1].includes(tokens[index + 4]))) {
                return { valid: false, reason: 'invalid_arc_flag' };
            }
            index += args;
            groups++;
            count++;
            if (count > MAX_VECTOR_PATH_COMMANDS) return { valid: false, reason: 'too_complex' };
            if (upper === 'M') {
                hasMove = true;
                command = command === 'M' ? 'L' : 'l';
            }
        }
        if (!groups) return { valid: false, reason: 'missing_arguments' };
    }
    return hasMove ? { valid: true, commands: count } : { valid: false, reason: 'missing_move' };
}

/**
 * Tokenize an SVG path data string into command characters and numbers.
 * @param {string} d
 * @returns {Array<string|number>}
 */
export function tokenizePath(d) {
    if (!d || typeof d !== 'string') return [];
    const tokens = [];
    const re = /([a-df-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
    let match;
    while ((match = re.exec(d)) !== null) {
        const val = match[1];
        const num = parseFloat(val);
        tokens.push(Number.isNaN(num) ? val : num);
    }
    return tokens;
}

/**
 * Parse an SVG path data string into an array of structured path commands.
 * Commands: M (moveTo), L (lineTo), H (horizontal), V (vertical),
 *           C (cubic bezier), S (smooth cubic), Q (quadratic), T (smooth quad),
 *           A (arc), Z (close).
 * @param {string} d
 * @returns {Array<{ type: string, args: number[] }>}
 */
export function parseSvgPath(d) {
    // This is the recovery parser used by preview/import paths. Keep authored
    // scene validation strict, but preserve valid geometry around a malformed
    // command instead of dropping the entire path. Bound tokenization so
    // damaged or hostile input still cannot make parsing unbounded.
    if (typeof d !== 'string' || !d.trim() || d.length > MAX_VECTOR_PATH_CHARS) return [];
    const tokens = tokenizePath(d);
    if (!tokens.length || tokens.length > MAX_VECTOR_PATH_COMMANDS * 7) return [];

    const commands = [];
    let currentCmd = '';
    let i = 0;
    const hasNumbers = count => i + count <= tokens.length
        && tokens.slice(i, i + count).every(value => typeof value === 'number' && Number.isFinite(value));
    const skipMalformedCommand = () => {
        currentCmd = '';
        while (i < tokens.length && typeof tokens[i] !== 'string') i++;
    };

    while (i < tokens.length) {
        const token = tokens[i];
        if (typeof token === 'string' && /^[a-zA-Z]$/.test(token)) {
            currentCmd = token;
            i++;
        }

        if (!currentCmd) {
            i++;
            continue;
        }

        const isUpper = currentCmd === currentCmd.toUpperCase();
        const type = currentCmd.toUpperCase();

        switch (type) {
            case 'M': // Move to: x, y (subsequent coords treated as lineTo)
                if (hasNumbers(2)) {
                    commands.push({ type: isUpper ? 'M' : 'm', args: [tokens[i], tokens[i + 1]] });
                    i += 2;
                    currentCmd = isUpper ? 'L' : 'l';
                } else {
                    skipMalformedCommand();
                }
                break;

            case 'L': // Line to: x, y
                if (hasNumbers(2)) {
                    commands.push({ type: isUpper ? 'L' : 'l', args: [tokens[i], tokens[i + 1]] });
                    i += 2;
                } else {
                    skipMalformedCommand();
                }
                break;

            case 'H': // Horizontal line: x
                if (hasNumbers(1)) {
                    commands.push({ type: isUpper ? 'H' : 'h', args: [tokens[i]] });
                    i += 1;
                } else {
                    skipMalformedCommand();
                }
                break;

            case 'V': // Vertical line: y
                if (hasNumbers(1)) {
                    commands.push({ type: isUpper ? 'V' : 'v', args: [tokens[i]] });
                    i += 1;
                } else {
                    skipMalformedCommand();
                }
                break;

            case 'C': // Cubic Bézier: cp1x, cp1y, cp2x, cp2y, x, y
                if (hasNumbers(6)) {
                    commands.push({
                        type: isUpper ? 'C' : 'c',
                        args: [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3], tokens[i + 4], tokens[i + 5]]
                    });
                    i += 6;
                } else {
                    skipMalformedCommand();
                }
                break;

            case 'S': // Smooth cubic Bézier: cp2x, cp2y, x, y
                if (hasNumbers(4)) {
                    commands.push({
                        type: isUpper ? 'S' : 's',
                        args: [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]]
                    });
                    i += 4;
                } else {
                    skipMalformedCommand();
                }
                break;

            case 'Q': // Quadratic Bézier: cpx, cpy, x, y
                if (hasNumbers(4)) {
                    commands.push({
                        type: isUpper ? 'Q' : 'q',
                        args: [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]]
                    });
                    i += 4;
                } else {
                    skipMalformedCommand();
                }
                break;

            case 'T': // Smooth quadratic Bézier: x, y
                if (hasNumbers(2)) {
                    commands.push({
                        type: isUpper ? 'T' : 't',
                        args: [tokens[i], tokens[i + 1]]
                    });
                    i += 2;
                } else {
                    skipMalformedCommand();
                }
                break;

            case 'A': // Arc: rx, ry, x-rotation, large-arc-flag, sweep-flag, x, y
                if (hasNumbers(7)) {
                    commands.push({
                        type: isUpper ? 'A' : 'a',
                        args: [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3], tokens[i + 4], tokens[i + 5], tokens[i + 6]]
                    });
                    i += 7;
                } else {
                    i++;
                }
                break;

            case 'Z': // Close path
                commands.push({ type: 'Z', args: [] });
                // Close-path has no arguments and cannot be repeated implicitly.
                // Reset the command so stray numbers are consumed by the outer
                // loop instead of appending Z forever without advancing `i`.
                currentCmd = '';
                break;

            default:
                skipMalformedCommand();
                break;
        }
    }

    return commands;
}

/**
 * Interpolate two SVG paths only when their command topology matches.
 * Arc flags are categorical SVG values, not coordinates: interpolating a
 * sweep flag from 0 to 1 produces invalid, discontinuous arc geometry.
 */
export function interpolateSvgPaths(from, to, progress) {
    const a = typeof from === 'string' ? parseSvgPath(from) : from;
    const b = typeof to === 'string' ? parseSvgPath(to) : to;
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return null;
    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    const result = [];
    let compatible = a.length === b.length;
    for (let index = 0; compatible && index < a.length; index++) {
        const left = a[index], right = b[index];
        if (typeof left?.type !== 'string' || left.type !== right?.type
            || !Array.isArray(left.args) || !Array.isArray(right.args) || left.args.length !== right.args.length) {
            compatible = false;
            break;
        }
        if (!left.args.every(Number.isFinite) || !right.args.every(Number.isFinite)) return null;
        if (left.type.toUpperCase() === 'A') {
            if (![0, 1].includes(left.args[3]) || ![0, 1].includes(left.args[4])
                || ![0, 1].includes(right.args[3]) || ![0, 1].includes(right.args[4])) return null;
            if (left.args[3] !== right.args[3] || left.args[4] !== right.args[4]) {
                compatible = false;
                break;
            }
        }
        result.push({
            type: left.type,
            args: left.args.map((value, i) => left.type.toUpperCase() === 'A' && (i === 3 || i === 4)
                ? value
                : value + (right.args[i] - value) * t),
        });
    }
    if (compatible) return result;

    // Different SVG command layouts can still describe the same number of
    // contours. Flatten supported line/Bézier commands, resample by distance,
    // then interpolate matching points. This supports e.g. a rectangle
    // morphing into a curve without requiring authored paths to share syntax.
    const contoursA = flattenMorphContours(a), contoursB = flattenMorphContours(b);
    if (!contoursA || !contoursB || contoursA.length !== contoursB.length) return null;
    const morphed = [];
    for (let index = 0; index < contoursA.length; index++) {
        const left = contoursA[index], right = contoursB[index];
        if (left.closed !== right.closed) return null;
        const count = Math.min(128, Math.max(2, left.points.length, right.points.length));
        const fromPoints = resampleMorphContour(left.points, count, left.closed);
        let toPoints = resampleMorphContour(right.points, count, right.closed);
        if (!left.closed && pointDistance(fromPoints[0], toPoints[toPoints.length - 1]) + pointDistance(fromPoints[fromPoints.length - 1], toPoints[0])
            < pointDistance(fromPoints[0], toPoints[0]) + pointDistance(fromPoints[fromPoints.length - 1], toPoints[toPoints.length - 1])) toPoints.reverse();
        if (left.closed) {
            if (contourArea(fromPoints) * contourArea(toPoints) < 0) toPoints.reverse();
            const nearest = toPoints.reduce((best, point, candidate) =>
                pointDistance(fromPoints[0], point) < pointDistance(fromPoints[0], toPoints[best]) ? candidate : best, 0);
            toPoints = [...toPoints.slice(nearest), ...toPoints.slice(0, nearest)];
        }
        morphed.push({ type: 'M', args: [
            fromPoints[0][0] + (toPoints[0][0] - fromPoints[0][0]) * t,
            fromPoints[0][1] + (toPoints[0][1] - fromPoints[0][1]) * t,
        ] });
        for (let point = 1; point < count; point++) morphed.push({ type: 'L', args: [
            fromPoints[point][0] + (toPoints[point][0] - fromPoints[point][0]) * t,
            fromPoints[point][1] + (toPoints[point][1] - fromPoints[point][1]) * t,
        ] });
        if (left.closed) morphed.push({ type: 'Z', args: [] });
    }
    return morphed;
}

function flattenMorphContours(commands, steps = 24) {
    const contours = [];
    let contour = null, x = 0, y = 0, startX = 0, startY = 0;
    let cubicX = 0, cubicY = 0, quadX = 0, quadY = 0, previous = '';
    const point = (args, index, rel, bx = x, by = y) => [Number(args[index]) + (rel ? bx : 0), Number(args[index + 1]) + (rel ? by : 0)];
    const append = p => { if (contour && p.every(Number.isFinite)) contour.points.push(p); };
    for (const command of commands) {
        const type = command?.type, args = command?.args;
        if (typeof type !== 'string' || !Array.isArray(args) || !args.every(Number.isFinite)) return null;
        const cmd = type.toUpperCase(), rel = type !== cmd, bx = x, by = y;
        if (cmd === 'M') {
            if (args.length !== 2) return null;
            [x, y] = point(args, 0, rel); startX = x; startY = y;
            contour = { points: [[x, y]], closed: false }; contours.push(contour);
        } else {
            if (!contour) return null;
            if (cmd === 'L' || cmd === 'T') {
                const end = cmd === 'T' ? point(args, 0, rel) : point(args, 0, rel);
                if (args.length !== 2) return null;
                if (cmd === 'T') {
                    const control = ['Q', 'T'].includes(previous) ? [2 * bx - quadX, 2 * by - quadY] : [bx, by];
                    for (let i = 1; i <= steps; i++) { const q = i / steps, u = 1 - q; append([u*u*bx + 2*u*q*control[0] + q*q*end[0], u*u*by + 2*u*q*control[1] + q*q*end[1]]); }
                    quadX = control[0]; quadY = control[1];
                } else append(end);
                [x, y] = end;
            } else if (cmd === 'H' || cmd === 'V') {
                if (args.length !== 1) return null;
                const end = cmd === 'H' ? [Number(args[0]) + (rel ? bx : 0), by] : [bx, Number(args[0]) + (rel ? by : 0)];
                append(end); [x, y] = end;
            } else if (cmd === 'C' || cmd === 'S') {
                const c1 = cmd === 'C' ? point(args, 0, rel) : (['C', 'S'].includes(previous) ? [2 * bx - cubicX, 2 * by - cubicY] : [bx, by]);
                const c2 = point(args, cmd === 'C' ? 2 : 0, rel), end = point(args, cmd === 'C' ? 4 : 2, rel);
                if (args.length !== (cmd === 'C' ? 6 : 4)) return null;
                for (let i = 1; i <= steps; i++) { const q = i / steps, u = 1 - q; append([u**3*bx + 3*u*u*q*c1[0] + 3*u*q*q*c2[0] + q**3*end[0], u**3*by + 3*u*u*q*c1[1] + 3*u*q*q*c2[1] + q**3*end[1]]); }
                [x, y] = end; cubicX = c2[0]; cubicY = c2[1];
            } else if (cmd === 'Q') {
                if (args.length !== 4) return null;
                const control = point(args, 0, rel), end = point(args, 2, rel);
                for (let i = 1; i <= steps; i++) { const q = i / steps, u = 1 - q; append([u*u*bx + 2*u*q*control[0] + q*q*end[0], u*u*by + 2*u*q*control[1] + q*q*end[1]]); }
                [x, y] = end; quadX = control[0]; quadY = control[1];
            } else if (cmd === 'A') {
                if (args.length !== 7 || ![0, 1].includes(args[3]) || ![0, 1].includes(args[4])) return null;
                const end = point(args, 5, rel);
                const arc = getSvgArcGeometry(x, y, args[0], args[1], args[2], args[3], args[4], end[0], end[1]);
                if (!arc) append(end);
                else {
                    const count = Math.max(steps, Math.min(128, Math.ceil(Math.abs(arc.delta) * Math.max(arc.rx, arc.ry) / 4)));
                    for (let i = 1; i <= count; i++) {
                        const angle = arc.start + arc.delta * i / count;
                        const ex = arc.rx * Math.cos(angle), ey = arc.ry * Math.sin(angle);
                        append([arc.cx + arc.cos * ex - arc.sin * ey, arc.cy + arc.sin * ex + arc.cos * ey]);
                    }
                }
                [x, y] = end;
            } else if (cmd === 'Z') {
                if (args.length) return null;
                contour.closed = true; [x, y] = [startX, startY];
            } else return null;
        }
        if (cmd !== 'C' && cmd !== 'S') { cubicX = x; cubicY = y; }
        if (cmd !== 'Q' && cmd !== 'T') { quadX = x; quadY = y; }
        previous = cmd;
    }
    return contours.every(item => item.points.length >= 2) ? contours : null;
}

function pointDistance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function contourArea(points) {
    return points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2;
}
function resampleMorphContour(points, count, closed) {
    const source = closed ? [...points, points[0]] : points;
    const distances = [0];
    for (let i = 1; i < source.length; i++) distances.push(distances[i - 1] + pointDistance(source[i - 1], source[i]));
    const total = distances[distances.length - 1];
    if (!(total > 0)) return Array.from({ length: count }, () => [...points[0]]);
    return Array.from({ length: count }, (_, index) => {
        const at = total * index / (closed ? count : count - 1);
        let segment = 1;
        while (segment < distances.length - 1 && distances[segment] < at) segment++;
        const span = distances[segment] - distances[segment - 1];
        const t = span > 0 ? (at - distances[segment - 1]) / span : 0;
        return [source[segment - 1][0] + (source[segment][0] - source[segment - 1][0]) * t,
            source[segment - 1][1] + (source[segment][1] - source[segment - 1][1]) * t];
    });
}

function signedAngle(ax, ay, bx, by) {
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

function getSvgArcGeometry(x1, y1, rxInput, ryInput, rotation, largeArc, sweep, x2, y2) {
    let rx = Math.abs(Number(rxInput)), ry = Math.abs(Number(ryInput));
    if (!rx || !ry || (x1 === x2 && y1 === y2)) return null;
    const phi = (Number(rotation) || 0) * Math.PI / 180;
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
    const scale = xp * xp / (rx * rx) + yp * yp / (ry * ry);
    if (scale > 1) { rx *= Math.sqrt(scale); ry *= Math.sqrt(scale); }
    const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp);
    const denominator = rx * rx * yp * yp + ry * ry * xp * xp;
    const direction = Boolean(largeArc) === Boolean(sweep) ? -1 : 1;
    const factor = denominator > 0 ? direction * Math.sqrt(numerator / denominator) : 0;
    const cxp = factor * rx * yp / ry, cyp = factor * -ry * xp / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const ux = (xp - cxp) / rx, uy = (yp - cyp) / ry;
    const vx = (-xp - cxp) / rx, vy = (-yp - cyp) / ry;
    const start = Math.atan2(uy, ux);
    let delta = signedAngle(ux, uy, vx, vy);
    if (!sweep && delta > 0) delta -= Math.PI * 2;
    if (sweep && delta < 0) delta += Math.PI * 2;
    return { cx, cy, rx, ry, cos, sin, start, delta };
}

/** Convert SVG endpoint-parameterized elliptical arcs to Canvas ellipses. */
function drawSvgArc(ctx, x1, y1, rxInput, ryInput, rotation, largeArc, sweep, x2, y2) {
    const arc = getSvgArcGeometry(x1, y1, rxInput, ryInput, rotation, largeArc, sweep, x2, y2);
    if (!arc) { ctx.lineTo(x2, y2); return; }
    const phi = (Number(rotation) || 0) * Math.PI / 180;
    if (typeof ctx.ellipse !== 'function') {
        // Some Canvas implementations (notably older embedded runtimes) do
        // not expose ellipse(). Approximate the same SVG arc with bounded line
        // segments instead of silently collapsing it to a straight chord.
        const segments = Math.max(8, Math.min(128, Math.ceil(Math.abs(arc.delta) * Math.max(arc.rx, arc.ry) / 4)));
        for (let index = 1; index <= segments; index++) {
            const angle = arc.start + arc.delta * index / segments;
            const ex = arc.rx * Math.cos(angle), ey = arc.ry * Math.sin(angle);
            ctx.lineTo(arc.cx + arc.cos * ex - arc.sin * ey, arc.cy + arc.sin * ex + arc.cos * ey);
        }
        return;
    }
    ctx.ellipse(arc.cx, arc.cy, arc.rx, arc.ry, phi, arc.start, arc.start + arc.delta, !sweep);
}

/**
 * Execute an SVG path on a Canvas 2D context.
 * Normalizes relative and shorthand commands into absolute canvas drawing calls.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string|Array<{type: string, args: number[]}>} pathData
 */
export function drawSvgPath(ctx, pathData) {
    // Recovery parsing is useful to inspect/import damaged SVG data, while a
    // render must never turn invalid input into an accidental partial shape.
    if (typeof pathData === 'string' && !validateSvgPathData(pathData).valid) return;
    const commands = typeof pathData === 'string' ? parseSvgPath(pathData) : (pathData || []);
    if (!commands.length) return;

    let cx = 0, cy = 0;       // Current point
    let startX = 0, startY = 0; // Subpath start
    let lastCpX = 0, lastCpY = 0; // Last control point for S / T
    let lastCmd = '';

    ctx.beginPath();

    for (const cmd of commands) {
        const { type, args } = cmd;
        const isRel = type === type.toLowerCase() && type !== 'Z';

        switch (type.toUpperCase()) {
            case 'M': {
                const x = isRel ? cx + args[0] : args[0];
                const y = isRel ? cy + args[1] : args[1];
                ctx.moveTo(x, y);
                cx = x; cy = y;
                startX = x; startY = y;
                lastCpX = x; lastCpY = y;
                break;
            }

            case 'L': {
                const x = isRel ? cx + args[0] : args[0];
                const y = isRel ? cy + args[1] : args[1];
                ctx.lineTo(x, y);
                cx = x; cy = y;
                lastCpX = x; lastCpY = y;
                break;
            }

            case 'H': {
                const x = isRel ? cx + args[0] : args[0];
                ctx.lineTo(x, cy);
                cx = x;
                lastCpX = x; lastCpY = cy;
                break;
            }

            case 'V': {
                const y = isRel ? cy + args[0] : args[0];
                ctx.lineTo(cx, y);
                cy = y;
                lastCpX = cx; lastCpY = y;
                break;
            }

            case 'C': {
                const cp1x = isRel ? cx + args[0] : args[0];
                const cp1y = isRel ? cy + args[1] : args[1];
                const cp2x = isRel ? cx + args[2] : args[2];
                const cp2y = isRel ? cy + args[3] : args[3];
                const x    = isRel ? cx + args[4] : args[4];
                const y    = isRel ? cy + args[5] : args[5];
                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
                cx = x; cy = y;
                lastCpX = cp2x; lastCpY = cp2y;
                break;
            }

            case 'S': {
                // Smooth cubic: cp1 is reflection of previous cp2 across current point
                let cp1x = cx, cp1y = cy;
                if (/^[CS]$/i.test(lastCmd)) {
                    cp1x = 2 * cx - lastCpX;
                    cp1y = 2 * cy - lastCpY;
                }
                const cp2x = isRel ? cx + args[0] : args[0];
                const cp2y = isRel ? cy + args[1] : args[1];
                const x    = isRel ? cx + args[2] : args[2];
                const y    = isRel ? cy + args[3] : args[3];
                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
                cx = x; cy = y;
                lastCpX = cp2x; lastCpY = cp2y;
                break;
            }

            case 'Q': {
                const cpx = isRel ? cx + args[0] : args[0];
                const cpy = isRel ? cy + args[1] : args[1];
                const x   = isRel ? cx + args[2] : args[2];
                const y   = isRel ? cy + args[3] : args[3];
                ctx.quadraticCurveTo(cpx, cpy, x, y);
                cx = x; cy = y;
                lastCpX = cpx; lastCpY = cpy;
                break;
            }

            case 'T': {
                // Smooth quad: cp is reflection of previous cp across current point
                let cpx = cx, cpy = cy;
                if (/^[QT]$/i.test(lastCmd)) {
                    cpx = 2 * cx - lastCpX;
                    cpy = 2 * cy - lastCpY;
                }
                const x = isRel ? cx + args[0] : args[0];
                const y = isRel ? cy + args[1] : args[1];
                ctx.quadraticCurveTo(cpx, cpy, x, y);
                cx = x; cy = y;
                lastCpX = cpx; lastCpY = cpy;
                break;
            }

            case 'A': {
                const x  = isRel ? cx + args[5] : args[5];
                const y  = isRel ? cy + args[6] : args[6];
                drawSvgArc(ctx, cx, cy, args[0], args[1], args[2], args[3], args[4], x, y);
                cx = x; cy = y;
                lastCpX = x; lastCpY = y;
                break;
            }

            case 'Z': {
                ctx.closePath();
                cx = startX; cy = startY;
                lastCpX = cx; lastCpY = cy;
                break;
            }
        }
        lastCmd = type;
    }
}

// ── Parametric Vector Shapes ──────────────────────────────────────────────────

/**
 * Draw a rounded rectangle with individual corner radii: [tl, tr, br, bl] or single radius.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number|number[]} radii
 */
export function drawRoundRect(ctx, x, y, w, h, radii = 0) {
    let tl = 0, tr = 0, br = 0, bl = 0;
    if (Array.isArray(radii)) {
        if (radii.length === 1) tl = tr = br = bl = radii[0];
        else if (radii.length === 2) { tl = br = radii[0]; tr = bl = radii[1]; }
        else if (radii.length === 4) { [tl, tr, br, bl] = radii; }
    } else if (typeof radii === 'number') {
        tl = tr = br = bl = radii;
    }

    // Clamp radii so corners don't overlap
    const maxR = Math.min(w, h) / 2;
    tl = Math.max(0, Math.min(tl, maxR));
    tr = Math.max(0, Math.min(tr, maxR));
    br = Math.max(0, Math.min(br, maxR));
    bl = Math.max(0, Math.min(bl, maxR));

    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    if (tr > 0) ctx.arcTo(x + w, y, x + w, y + tr, tr);
    ctx.lineTo(x + w, y + h - br);
    if (br > 0) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
    ctx.lineTo(x + bl, y + h);
    if (bl > 0) ctx.arcTo(x, y + h, x, y + h - bl, bl);
    ctx.lineTo(x, y + tl);
    if (tl > 0) ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
}

/**
 * Draw a regular polygon (triangle, pentagon, hexagon, etc.).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} sides (minimum 3)
 * @param {number} rotationRad
 */
export function drawPolygon(ctx, cx, cy, radius, sides = 3, rotationRad = 0) {
    const n = Math.max(3, sides);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const angle = rotationRad + (i * 2 * Math.PI) / n - Math.PI / 2;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

/**
 * Draw a star with specified points, inner radius, and outer radius.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} innerR
 * @param {number} outerR
 * @param {number} points (default 5)
 * @param {number} rotationRad
 */
export function drawStar(ctx, cx, cy, innerR, outerR, points = 5, rotationRad = 0) {
    const n = Math.max(3, points);
    const step = Math.PI / n;
    ctx.beginPath();
    for (let i = 0; i < 2 * n; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const angle = rotationRad + i * step - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

/**
 * Draw a direction-oriented arrow.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x1 Start x
 * @param {number} y1 Start y
 * @param {number} x2 End (tip) x
 * @param {number} y2 End (tip) y
 * @param {object} opts { headLength, headWidth, tailWidth, curved }
 */
export function drawArrow(ctx, x1, y1, x2, y2, opts = {}) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);

    const headLength = Math.min(len * 0.5, opts.headLength || 30);
    const headWidth  = opts.headWidth  || headLength * 0.9;
    const tailWidth  = opts.tailWidth  || headWidth * 0.35;

    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(0, -tailWidth / 2);
    ctx.lineTo(len - headLength, -tailWidth / 2);
    ctx.lineTo(len - headLength, -headWidth / 2);
    ctx.lineTo(len, 0);
    ctx.lineTo(len - headLength, headWidth / 2);
    ctx.lineTo(len - headLength, tailWidth / 2);
    ctx.lineTo(0, tailWidth / 2);
    ctx.closePath();

    ctx.restore();
}

/**
 * Draw a pill / capsule badge.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
export function drawCapsule(ctx, x, y, w, h) {
    const r = Math.min(w, h) / 2;
    drawRoundRect(ctx, x, y, w, h, r);
}

// ── Gradients, Colors & Blend Modes ──────────────────────────────────────────

/**
 * Create a CanvasGradient from a gradient specification.
 * Supported types: 'linear', 'radial'.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} gradSpec
 * @param {object} bounds { x, y, w, h } for relative coordinate resolution
 * @returns {CanvasGradient|string}
 */
export function resolveGradient(ctx, gradSpec, bounds = { x: 0, y: 0, w: 100, h: 100 }) {
    if (!gradSpec || typeof gradSpec !== 'object') return gradSpec || '#FFFFFF';
    const type = gradSpec.type || 'linear';
    const stops = Array.isArray(gradSpec.stops) ? gradSpec.stops : [];
    const safeNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const x = safeNumber(bounds?.x, 0), y = safeNumber(bounds?.y, 0);
    const w = safeNumber(bounds?.w, 100), h = safeNumber(bounds?.h, 100);
    const fallbackColor = String(gradSpec.color || stops.find(stop => stop && (stop.color || stop[1]))?.color || '#FFFFFF');

    let grad;
    try {
        if (type === 'linear' && typeof ctx?.createLinearGradient === 'function') {
            let x0 = safeNumber(gradSpec.x0, x);
            let y0 = safeNumber(gradSpec.y0, y);
            let x1 = safeNumber(gradSpec.x1, x + w);
            let y1 = safeNumber(gradSpec.y1, y);

            // If angle is provided (degrees), compute directional vector across bounds.
            if (Number.isFinite(Number(gradSpec.angle))) {
                const angle = Number(gradSpec.angle) * Math.PI / 180;
                const cx = x + w / 2;
                const cy = y + h / 2;
                const diag = Math.hypot(w, h) / 2;
                x0 = cx - Math.cos(angle) * diag;
                y0 = cy - Math.sin(angle) * diag;
                x1 = cx + Math.cos(angle) * diag;
                y1 = cy + Math.sin(angle) * diag;
            }
            grad = ctx.createLinearGradient(x0, y0, x1, y1);
        } else if (type === 'radial' && typeof ctx?.createRadialGradient === 'function') {
            const cx = safeNumber(gradSpec.cx, x + w / 2);
            const cy = safeNumber(gradSpec.cy, y + h / 2);
            const r0 = Math.max(0, safeNumber(gradSpec.r0, 0));
            const r1 = Math.max(r0 + 0.001, safeNumber(gradSpec.r1, Math.max(w, h) / 2));
            grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
        }
    } catch {
        return fallbackColor;
    }
    if (!grad) return fallbackColor;

    const normalizedStops = (stops.length ? stops : [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#000000' }])
        .map((stop, index) => ({
            offset: Math.max(0, Math.min(1, safeNumber(stop?.offset ?? stop?.[0], 0))),
            color: stop?.color ?? stop?.[1],
            index,
        }))
        .filter(stop => stop.color !== undefined && stop.color !== null && String(stop.color).trim() !== '')
        .sort((a, b) => a.offset - b.offset || a.index - b.index);
    let added = 0;
    for (const stop of normalizedStops) {
        try {
            grad.addColorStop(stop.offset, String(stop.color));
            added++;
        } catch {
            // One malformed CSS colour must not discard the rest of the fill.
        }
    }
    return added ? grad : fallbackColor;
}

/**
 * Configure shadow / glow on a 2D context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} shadowOpts { color, blur, offsetX, offsetY }
 */
export function applyShadow(ctx, shadowOpts = {}) {
    if (!shadowOpts || !shadowOpts.color) {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        return;
    }
    ctx.shadowColor   = shadowOpts.color;
    ctx.shadowBlur    = Number(shadowOpts.blur) || 0;
    ctx.shadowOffsetX = Number(shadowOpts.offsetX) || 0;
    ctx.shadowOffsetY = Number(shadowOpts.offsetY) || 0;
}

export const VALID_BLEND_MODES = new Set([
    'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
    'exclusion', 'hue', 'saturation', 'color', 'luminosity',
    'destination-over', 'destination-out', 'source-atop', 'xor'
]);

/**
 * Set blending mode safely.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} mode
 */
export function setBlendMode(ctx, mode = 'source-over') {
    // Keep the compositor's `addition` name aligned with Canvas' standard
    // additive `lighter` operation (CSS preview uses `plus-lighter`). Without
    // this alias, vector layers silently fell back to source-over in preview.
    const canvasMode = mode === 'addition' ? 'lighter' : mode;
    ctx.globalCompositeOperation = canvasMode === 'lighter' || VALID_BLEND_MODES.has(canvasMode)
        ? canvasMode
        : 'source-over';
}

// ── Stroke Trimming & Animation ───────────────────────────────────────────────

/**
 * Setup stroke trimming (reveal from trimStart to trimEnd) via line dash.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} totalLength Approximate or known perimeter/length of path
 * @param {number} trimStart Fraction 0..1
 * @param {number} trimEnd Fraction 0..1
 * @param {number} trimOffset Fraction 0..1 (optional shift)
 */
export function applyTrimPath(ctx, totalLength, trimStart = 0, trimEnd = 1, trimOffset = 0) {
    if (totalLength <= 0) return;
    const s = Math.max(0, Math.min(1, trimStart));
    const e = Math.max(0, Math.min(1, trimEnd));
    const off = ((trimOffset % 1) + 1) % 1;

    if (s <= 0 && e >= 1) {
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        return;
    }

    const visibleLen = Math.max(0, (e - s) * totalLength);
    const gapLen = Math.max(0, totalLength - visibleLen);
    ctx.setLineDash([visibleLen, gapLen]);
    ctx.lineDashOffset = -(s + off) * totalLength;
}

/** Estimate SVG path length in user units for proportional stroke trimming. */
export function estimateSvgPathLength(pathData, curveSteps = 24) {
    const commands = typeof pathData === 'string' ? parseSvgPath(pathData) : (pathData || []);
    let x = 0, y = 0, sx = 0, sy = 0, cpx = 0, cpy = 0, qpx = 0, qpy = 0, previous = '';
    let length = 0;
    const distance = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
    const cubic = (p0, p1, p2, p3, t) => (1-t)**3*p0 + 3*(1-t)**2*t*p1 + 3*(1-t)*t*t*p2 + t**3*p3;
    const quadratic = (p0, p1, p2, t) => (1-t)**2*p0 + 2*(1-t)*t*p1 + t*t*p2;
    for (const { type, args } of commands) {
        const rel = type === type.toLowerCase() && type !== 'Z';
        const cmd = type.toUpperCase();
        const px = x, py = y;
        const point = (i) => [Number(args[i]) + (rel ? px : 0), Number(args[i + 1]) + (rel ? py : 0)];
        if (cmd === 'M') { [x, y] = point(0); sx = x; sy = y; }
        else if (cmd === 'L') { [x, y] = point(0); length += distance(px, py, x, y); }
        else if (cmd === 'H') { x = Number(args[0]) + (rel ? px : 0); length += Math.abs(x-px); }
        else if (cmd === 'V') { y = Number(args[0]) + (rel ? py : 0); length += Math.abs(y-py); }
        else if (cmd === 'C' || cmd === 'S') {
            let p1, p2, p3;
            if (cmd === 'C') { p1=point(0); p2=point(2); p3=point(4); }
            else { p1 = ['C','S'].includes(previous) ? [2*px-cpx, 2*py-cpy] : [px,py]; p2=point(0); p3=point(2); }
            let last=[px,py];
            for (let i=1;i<=curveSteps;i++) { const t=i/curveSteps, next=[cubic(px,p1[0],p2[0],p3[0],t),cubic(py,p1[1],p2[1],p3[1],t)]; length+=distance(...last,...next); last=next; }
            [x,y]=p3; cpx=p2[0]; cpy=p2[1];
        } else if (cmd === 'Q' || cmd === 'T') {
            const control = cmd === 'Q' ? point(0) : (['Q','T'].includes(previous) ? [2*px-qpx,2*py-qpy] : [px,py]);
            const end = cmd === 'Q' ? point(2) : point(0);
            let last=[px,py];
            for (let i=1;i<=curveSteps;i++) { const t=i/curveSteps, next=[quadratic(px,control[0],end[0],t),quadratic(py,control[1],end[1],t)]; length+=distance(...last,...next); last=next; }
            [x,y]=end; qpx=control[0]; qpy=control[1];
        } else if (cmd === 'A') {
            const end=point(5); let rx=Math.abs(Number(args[0])||0), ry=Math.abs(Number(args[1])||0);
            if (!rx || !ry || (px === end[0] && py === end[1])) length += distance(px,py,...end);
            else {
                const phi=(Number(args[2])||0)*Math.PI/180, cos=Math.cos(phi), sin=Math.sin(phi);
                const dx=(px-end[0])/2, dy=(py-end[1])/2;
                const xp=cos*dx+sin*dy, yp=-sin*dx+cos*dy;
                const radiusScale=xp*xp/(rx*rx)+yp*yp/(ry*ry);
                if (radiusScale>1) { rx*=Math.sqrt(radiusScale); ry*=Math.sqrt(radiusScale); }
                const numerator=Math.max(0,rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp);
                const denominator=rx*rx*yp*yp+ry*ry*xp*xp;
                const direction=Boolean(Number(args[3]))===Boolean(Number(args[4])) ? -1 : 1;
                const factor=denominator>0 ? direction*Math.sqrt(numerator/denominator) : 0;
                const cxp=factor*rx*yp/ry, cyp=factor*-ry*xp/rx;
                const cx=cos*cxp-sin*cyp+(px+end[0])/2, cy=sin*cxp+cos*cyp+(py+end[1])/2;
                const ux=(xp-cxp)/rx, uy=(yp-cyp)/ry, vx=(-xp-cxp)/rx, vy=(-yp-cyp)/ry;
                const start=Math.atan2(uy,ux); let delta=signedAngle(ux,uy,vx,vy);
                if (!Number(args[4]) && delta>0) delta-=Math.PI*2;
                if (Number(args[4]) && delta<0) delta+=Math.PI*2;
                let last=[px,py];
                const steps=Math.max(curveSteps,Math.ceil(Math.abs(delta)*Math.max(rx,ry)/4));
                for (let i=1;i<=steps;i++) {
                    const theta=start+delta*i/steps, ex=rx*Math.cos(theta), ey=ry*Math.sin(theta);
                    const next=[cx+cos*ex-sin*ey,cy+sin*ex+cos*ey]; length+=distance(...last,...next); last=next;
                }
            }
            [x,y]=end;
        } else if (cmd === 'Z') { length += distance(px,py,sx,sy); x=sx; y=sy; }
        if (!['C','S'].includes(cmd)) { cpx=x; cpy=y; }
        if (!['Q','T'].includes(cmd)) { qpx=x; qpy=y; }
        previous=cmd;
    }
    return Number.isFinite(length) ? length : 0;
}

// ── Clipping & Masking ────────────────────────────────────────────────────────

/**
 * Execute rendering inside a clipping boundary.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Function} pathFn Draws the clipping boundary
 * @param {Function} renderFn Renders contents clipped to boundary
 */
export function withClip(ctx, pathFn, renderFn) {
    ctx.save();
    pathFn(ctx);
    ctx.clip();
    renderFn(ctx);
    ctx.restore();
}

/**
 * Apply alpha matte mask between mask drawing and content.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Function} maskFn Draws the alpha matte
 * @param {Function} contentFn Draws the content to be masked
 */
export function withAlphaMask(ctx, maskFn, contentFn) {
    ctx.save();
    contentFn(ctx);
    ctx.globalCompositeOperation = 'destination-in';
    maskFn(ctx);
    ctx.restore();
}

/** Create a browser-safe SVG alpha matte URL for a supported vector shape. */
export function vectorMatteDataUrl(vector = {}, fallbackWidth = 100, fallbackHeight = 100) {
    const width = Math.max(1, Math.min(10000, Number(vector.w || fallbackWidth) || 100));
    const height = Math.max(1, Math.min(10000, Number(vector.h || fallbackHeight) || 100));
    const kind = String(vector.kind || 'rect').toLowerCase();
    const bounds = vector.maskBounds || {};
    const bx = Math.max(0, Math.min(1, Number(bounds.x) || 0)) * width;
    const by = Math.max(0, Math.min(1, Number(bounds.y) || 0)) * height;
    const bw = Math.max(0.001, Math.min(1 - bx / width, Number.isFinite(Number(bounds.w)) ? Number(bounds.w) : 1)) * width;
    const bh = Math.max(0.001, Math.min(1 - by / height, Number.isFinite(Number(bounds.h)) ? Number(bounds.h) : 1)) * height;
    const cx = bx + bw / 2, cy = by + bh / 2;
    const radius = Math.min(bw, bh) / 2;
    let shape = '';
    if (kind === 'circle') {
        shape = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="white"/>`;
    } else if (kind === 'ellipse') {
        shape = `<ellipse cx="${cx}" cy="${cy}" rx="${bw / 2}" ry="${bh / 2}" fill="white"/>`;
    } else if (['rect', 'rectangle', 'rounded-rectangle', 'capsule'].includes(kind)) {
        const rawRadius = vector.radius ?? vector.radii;
        const corner = kind === 'capsule' ? radius
            : Array.isArray(rawRadius) ? Math.max(0, ...rawRadius.map(value => Number(value) || 0)) : Math.max(0, Number(rawRadius) || 0);
        shape = `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${Math.min(radius, corner)}" fill="white"/>`;
    } else if (kind === 'polygon' || kind === 'star') {
        const points = Math.max(3, Math.min(128, Math.round(Number(kind === 'star' ? vector.points : vector.sides) || (kind === 'star' ? 5 : 3))));
        const count = kind === 'star' ? points * 2 : points;
        const outer = Math.max(0, Math.min(radius, Number(vector.outerRadius ?? vector.radius) || radius));
        const inner = Math.max(0, Number(vector.innerRadius) || radius * 0.5);
        const rotation = (Number(vector.rotation) || 0) * Math.PI / 180;
        const vertices = Array.from({ length: count }, (_, index) => {
            const r = kind === 'star' && index % 2 ? inner : outer;
            const angle = index * (kind === 'star' ? Math.PI / points : Math.PI * 2 / points) - Math.PI / 2 + rotation;
            return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
        });
        shape = `<polygon points="${vertices.join(' ')}" fill="white"/>`;
    } else if (kind === 'arrow') {
        const length = bw;
        const headLength = Math.min(length * 0.5, Number(vector.headLength) || 30);
        const headWidth = Number(vector.headWidth) || headLength * 0.9;
        const tailWidth = Number(vector.tailWidth) || headWidth * 0.35;
        shape = `<path d="M ${bx} ${cy - tailWidth / 2} H ${bx + bw - headLength} V ${cy - headWidth / 2} L ${bx + bw} ${cy} L ${bx + bw - headLength} ${cy + headWidth / 2} V ${cy + tailWidth / 2} H ${bx} Z" fill="white" transform="rotate(${Number(vector.rotation) || 0} ${cx} ${cy})"/>`;
    } else if (kind === 'path' && typeof vector.pathData === 'string' && vector.pathData.trim()) {
        const d = vector.pathData.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        shape = `<path d="${d}" fill="white" fill-rule="${vector.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'}"/>`;
    } else {
        return null;
    }
    const feather = Math.max(0, Math.min(256, Number(vector.feather) || 0));
    const filteredShape = feather > 0
        ? `<defs><filter id="matte-feather" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${feather}"/></filter></defs><g filter="url(#matte-feather)">${shape}</g>`
        : shape;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${filteredShape}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ── High-Level Vector Drawing Dispatcher ──────────────────────────────────────

/**
 * Draw a vector shape definition with full transform, fill, stroke, gradient and effects.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} shape
 *   {
 *     kind: 'rect'|'circle'|'polygon'|'star'|'arrow'|'capsule'|'path',
 *     x, y, w, h,
 *     radii, sides, points, innerRadius, outerRadius,
 *     pathData,
 *     fill: string|gradientSpec,
 *     stroke: string|gradientSpec,
 *     strokeWidth: number,
 *     lineCap: 'butt'|'round'|'square',
 *     lineJoin: 'miter'|'round'|'bevel',
 *     trimStart: number, trimEnd: number, trimOffset: number,
 *     shadow: { color, blur, offsetX, offsetY },
 *     blendMode: string,
 *     opacity: number,
 *     rotation: number,
 *     scale: number
 *   }
 */
export function drawVectorGraphic(ctx, shape = {}) {
    if (!ctx) return;
    const {
        kind = 'rect',
        x = 0, y = 0, w = 100, h = 100,
        fill, stroke, strokeWidth = 0,
        lineCap = 'round', lineJoin = 'round',
        trimStart = 0, trimEnd = 1, trimOffset = 0,
        shadow, blendMode, opacity = 1,
        rotation = 0, scale = 1,
    } = shape;

    ctx.save();

    if (opacity < 1) ctx.globalAlpha *= Math.max(0, Math.min(1, opacity));
    if (blendMode) setBlendMode(ctx, blendMode);

    // Coordinate origin transform
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (rotation !== 0 || scale !== 1) {
        ctx.translate(cx, cy);
        if (rotation !== 0) ctx.rotate((rotation * Math.PI) / 180);
        if (scale !== 1) ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
    }

    if (shadow) applyShadow(ctx, shadow);

    const bounds = { x, y, w, h };

    // Path creation
    switch (kind) {
        case 'circle':
            ctx.beginPath();
            ctx.arc(cx, cy, Math.min(w, h) / 2, 0, 2 * Math.PI);
            break;

        case 'capsule':
            drawCapsule(ctx, x, y, w, h);
            break;

        case 'polygon':
            drawPolygon(ctx, cx, cy, Math.min(w, h) / 2, shape.sides || 3);
            break;

        case 'star':
            drawStar(ctx, cx, cy, (shape.innerRadius || Math.min(w, h) * 0.25), (shape.outerRadius || Math.min(w, h) * 0.5), shape.points || 5);
            break;

        case 'arrow':
            drawArrow(ctx, x, cy, x + w, cy, shape);
            break;

        case 'path':
            if (shape.pathData) drawSvgPath(ctx, shape.pathData);
            break;

        case 'rect':
        default:
            drawRoundRect(ctx, x, y, w, h, shape.radii || 0);
            break;
    }

    // Fill execution
    if (fill && fill !== 'none') {
        ctx.fillStyle = resolveGradient(ctx, fill, bounds);
        // SVG paths support both nonzero and even-odd winding rules. Keep the
        // Canvas renderer aligned with the SVG matte renderer so compound paths
        // (for example, a ring with a transparent center) look the same in
        // preview and export.
        const fillRule = shape.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
        try {
            ctx.fill(fillRule);
        } catch {
            // Some lightweight Canvas implementations expose fill() without
            // the optional fill-rule argument. Their default is nonzero.
            ctx.fill();
        }
    }

    // Stroke execution
    if (stroke && stroke !== 'none' && strokeWidth > 0) {
        // Clear shadow before stroke so shadow doesn't double-fire if already filled
        if (fill && fill !== 'none') applyShadow(ctx, null);

        ctx.strokeStyle = resolveGradient(ctx, stroke, bounds);
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = lineCap;
        ctx.lineJoin = lineJoin;

        // Path trimming estimation
        const approxLength = kind === 'path'
            ? estimateSvgPathLength(shape.pathData)
            : kind === 'circle'
                ? Math.PI * Math.min(w, h)
                : kind === 'polygon'
                    ? Math.max(3, Number(shape.sides) || 3) * Math.min(w, h) * Math.sin(Math.PI / Math.max(3, Number(shape.sides) || 3))
                    : 2 * (w + h);
        // Canvas keeps line dash state across paths. Establish it for every
        // stroke so a caller's dashed path cannot leak into an ordinary shape.
        if (trimStart > 0 || trimEnd < 1) {
            applyTrimPath(ctx, approxLength, trimStart, trimEnd, trimOffset);
        } else {
            ctx.setLineDash([]);
            ctx.lineDashOffset = 0;
        }

        ctx.stroke();
    }

    ctx.restore();
}

/**
 * Draw a vector layer at local clip time. The motion recipes stay data driven
 * so scene previews and server renders use identical animation math.
 * Supported presets: fade, rise, scale, pop, draw.
 */
export function drawVectorFrame(ctx, vector = {}, localTime = 0, duration = 1) {
    if (!ctx) return;
    const { motion, ...shape } = vector;
    const preset = motion?.preset;
    const span = Math.max(0.08, Math.min(Number(motion?.duration) || 0.42, Number(duration) || 1));
    const t = Math.max(0, Math.min(1, (Number(localTime) || 0) / span));
    const easing = motion?.easing || 'easeOutCubic';
    const eased = resolveEasing(easing)(t);
    const progress = Math.max(0, Math.min(1.12, eased));
    if (shape.kind === 'path' && motion?.pathFrom && motion?.pathTo) {
        const morphDuration = Math.max(0.001, Math.min(Number(motion.morphDuration) || Number(duration) || 1, Number(duration) || 1));
        const morphT = Math.max(0, Math.min(1, (Number(localTime) || 0) / morphDuration));
        const morphProgress = Math.max(0, Math.min(1, resolveEasing(easing)(morphT)));
        const pathData = interpolateSvgPaths(motion.pathFrom, motion.pathTo, morphProgress);
        if (pathData) shape.pathData = pathData;
    }
    const w = Number(shape.w) || 100;
    const h = Number(shape.h) || 100;
    const cx = (Number(shape.x) || 0) + w / 2;
    const cy = (Number(shape.y) || 0) + h / 2;

    ctx.save();
    if (preset === 'fade') ctx.globalAlpha *= progress;
    if (preset === 'rise') {
        ctx.globalAlpha *= progress;
        ctx.translate(0, (1 - progress) * h * 0.22);
    }
    if (preset === 'scale' || preset === 'pop') {
        ctx.globalAlpha *= progress;
        const scale = preset === 'pop' ? 0.72 + progress * 0.28 : 0.84 + progress * 0.16;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
    }
    if (preset === 'draw') {
        shape.trimStart = Number(motion?.trimStart) || 0;
        shape.trimEnd = progress;
        shape.fill = t < 1 ? 'none' : shape.fill;
    }
    drawVectorGraphic(ctx, shape);
    ctx.restore();
}
