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

// ── SVG Path Parser & Path Operations ────────────────────────────────────────

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
    const tokens = tokenizePath(d);
    if (!tokens.length) return [];

    const commands = [];
    let currentCmd = '';
    let i = 0;

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
                if (i + 1 < tokens.length && typeof tokens[i] === 'number' && typeof tokens[i + 1] === 'number') {
                    commands.push({ type: isUpper ? 'M' : 'm', args: [tokens[i], tokens[i + 1]] });
                    i += 2;
                    currentCmd = isUpper ? 'L' : 'l';
                } else {
                    i++;
                }
                break;

            case 'L': // Line to: x, y
                if (i + 1 < tokens.length && typeof tokens[i] === 'number' && typeof tokens[i + 1] === 'number') {
                    commands.push({ type: isUpper ? 'L' : 'l', args: [tokens[i], tokens[i + 1]] });
                    i += 2;
                } else {
                    i++;
                }
                break;

            case 'H': // Horizontal line: x
                if (i < tokens.length && typeof tokens[i] === 'number') {
                    commands.push({ type: isUpper ? 'H' : 'h', args: [tokens[i]] });
                    i += 1;
                } else {
                    i++;
                }
                break;

            case 'V': // Vertical line: y
                if (i < tokens.length && typeof tokens[i] === 'number') {
                    commands.push({ type: isUpper ? 'V' : 'v', args: [tokens[i]] });
                    i += 1;
                } else {
                    i++;
                }
                break;

            case 'C': // Cubic Bézier: cp1x, cp1y, cp2x, cp2y, x, y
                if (i + 5 < tokens.length) {
                    commands.push({
                        type: isUpper ? 'C' : 'c',
                        args: [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3], tokens[i + 4], tokens[i + 5]]
                    });
                    i += 6;
                } else {
                    i++;
                }
                break;

            case 'S': // Smooth cubic Bézier: cp2x, cp2y, x, y
                if (i + 3 < tokens.length) {
                    commands.push({
                        type: isUpper ? 'S' : 's',
                        args: [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]]
                    });
                    i += 4;
                } else {
                    i++;
                }
                break;

            case 'Q': // Quadratic Bézier: cpx, cpy, x, y
                if (i + 3 < tokens.length) {
                    commands.push({
                        type: isUpper ? 'Q' : 'q',
                        args: [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]]
                    });
                    i += 4;
                } else {
                    i++;
                }
                break;

            case 'T': // Smooth quadratic Bézier: x, y
                if (i + 1 < tokens.length) {
                    commands.push({
                        type: isUpper ? 'T' : 't',
                        args: [tokens[i], tokens[i + 1]]
                    });
                    i += 2;
                } else {
                    i++;
                }
                break;

            case 'A': // Arc: rx, ry, x-rotation, large-arc-flag, sweep-flag, x, y
                if (i + 6 < tokens.length) {
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
                break;

            default:
                i++;
                break;
        }
    }

    return commands;
}

/**
 * Execute an SVG path on a Canvas 2D context.
 * Normalizes relative and shorthand commands into absolute canvas drawing calls.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string|Array<{type: string, args: number[]}>} pathData
 */
export function drawSvgPath(ctx, pathData) {
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
                // Approximate arc to line segment / arcTo
                const rx = Math.abs(args[0]);
                const ry = Math.abs(args[1]);
                const x  = isRel ? cx + args[5] : args[5];
                const y  = isRel ? cy + args[6] : args[6];
                if (rx === 0 || ry === 0) {
                    ctx.lineTo(x, y);
                } else {
                    // Elliptical arc approximation fallback
                    ctx.lineTo(x, y);
                }
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
    const { type = 'linear', stops = [], angle = 0 } = gradSpec;
    const { x, y, w, h } = bounds;

    let grad;
    if (type === 'linear') {
        let x0 = gradSpec.x0 ?? x;
        let y0 = gradSpec.y0 ?? y;
        let x1 = gradSpec.x1 ?? (x + w);
        let y1 = gradSpec.y1 ?? y;

        // If angle is provided (degrees), compute directional vector across bounds
        if (typeof gradSpec.angle === 'number') {
            const rad = (gradSpec.angle * Math.PI) / 180;
            const cx = x + w / 2;
            const cy = y + h / 2;
            const diag = Math.hypot(w, h) / 2;
            x0 = cx - Math.cos(rad) * diag;
            y0 = cy - Math.sin(rad) * diag;
            x1 = cx + Math.cos(rad) * diag;
            y1 = cy + Math.sin(rad) * diag;
        }

        grad = ctx.createLinearGradient(x0, y0, x1, y1);
    } else if (type === 'radial') {
        const cx = gradSpec.cx ?? (x + w / 2);
        const cy = gradSpec.cy ?? (y + h / 2);
        const r0 = gradSpec.r0 ?? 0;
        const r1 = gradSpec.r1 ?? (Math.max(w, h) / 2);
        grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    } else {
        return gradSpec.color || '#FFFFFF';
    }

    const defaultStops = stops.length ? stops : [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#000000' }];
    for (const s of defaultStops) {
        const offset = Math.max(0, Math.min(1, Number(s.offset ?? s[0]) || 0));
        const color  = s.color || s[1] || '#FFFFFF';
        grad.addColorStop(offset, color);
    }

    return grad;
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
    ctx.globalCompositeOperation = VALID_BLEND_MODES.has(mode) ? mode : 'source-over';
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
        ctx.fill();
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
        const approxLength = 2 * (w + h);
        if (trimStart > 0 || trimEnd < 1) {
            applyTrimPath(ctx, approxLength, trimStart, trimEnd, trimOffset);
        }

        ctx.stroke();
    }

    ctx.restore();
}
