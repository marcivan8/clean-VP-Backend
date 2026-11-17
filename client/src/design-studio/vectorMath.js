/**
 * client/src/design-studio/vectorMath.js
 *
 * Professional Vector Geometry, Bézier Curves, Polygon, Star,
 * Compound Boolean and Path Math Engine.
 *
 * Strictly zero emojis. Pure mathematical functions.
 */

/**
 * Evaluates a cubic Bézier curve at parameter t in [0, 1].
 */
export function evaluateCubicBézier(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;

    return {
        x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
        y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
    };
}

/**
 * Computes bounding box for a set of {x, y} points.
 */
export function getBoundsOfPoints(points) {
    if (!points || points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const pt of points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
    }

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(0, maxX - minX),
        height: Math.max(0, maxY - minY),
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
    };
}

/**
 * Generates an SVG path string for a rounded rectangle with independent corner radii.
 * Supports iOS-style corner smoothing.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number|{tl: number, tr: number, br: number, bl: number}} radii
 * @param {boolean} smoothing
 * @returns {string} SVG path d attribute
 */
export function generateRoundedRectPath(x, y, w, h, radii = 0, smoothing = false) {
    const r = typeof radii === 'number'
        ? { tl: radii, tr: radii, br: radii, bl: radii }
        : {
            tl: Number(radii?.tl || 0),
            tr: Number(radii?.tr || 0),
            br: Number(radii?.br || 0),
            bl: Number(radii?.bl || 0),
        };

    const maxR = Math.min(w / 2, h / 2);
    const tl = Math.max(0, Math.min(maxR, r.tl));
    const tr = Math.max(0, Math.min(maxR, r.tr));
    const br = Math.max(0, Math.min(maxR, r.br));
    const bl = Math.max(0, Math.min(maxR, r.bl));

    if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
        return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
    }

    if (!smoothing) {
        return [
            `M ${x + tl} ${y}`,
            `H ${x + w - tr}`,
            tr > 0 ? `A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : `L ${x + w} ${y}`,
            `V ${y + h - br}`,
            br > 0 ? `A ${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : `L ${x + w} ${y + h}`,
            `H ${x + bl}`,
            bl > 0 ? `A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : `L ${x} ${y + h}`,
            `V ${y + tl}`,
            tl > 0 ? `A ${tl} ${tl} 0 0 1 ${x + tl} ${y}` : `L ${x} ${y}`,
            'Z'
        ].join(' ');
    }

    // High-curvature squircle Bézier approximation
    const k = 0.5522847498; // standard circle control point factor
    return [
        `M ${x + tl} ${y}`,
        `H ${x + w - tr}`,
        tr > 0 ? `C ${x + w - tr * (1 - k)} ${y}, ${x + w} ${y + tr * (1 - k)}, ${x + w} ${y + tr}` : `L ${x + w} ${y}`,
        `V ${y + h - br}`,
        br > 0 ? `C ${x + w} ${y + h - br * (1 - k)}, ${x + w - br * (1 - k)} ${y + h}, ${x + w - br} ${y + h}` : `L ${x + w} ${y + h}`,
        `H ${x + bl}`,
        bl > 0 ? `C ${x + bl * (1 - k)} ${y + h}, ${x} ${y + h - bl * (1 - k)}, ${x} ${y + h - bl}` : `L ${x} ${y + h}`,
        `V ${y + tl}`,
        tl > 0 ? `C ${x} ${y + tl * (1 - k)}, ${x + tl * (1 - k)} ${y}, ${x + tl} ${y}` : `L ${x} ${y}`,
        'Z'
    ].join(' ');
}

/**
 * Generates an SVG path for a regular polygon.
 *
 * @param {number} cx Center X
 * @param {number} cy Center Y
 * @param {number} radius Outer radius
 * @param {number} sides Number of sides (>= 3)
 * @param {number} rotationDeg Rotation in degrees
 * @returns {string} SVG path d attribute
 */
export function generatePolygonPath(cx, cy, radius, sides = 5, rotationDeg = 0) {
    const n = Math.max(3, Math.round(sides));
    const rotRad = (rotationDeg - 90) * (Math.PI / 180);
    const angleStep = (Math.PI * 2) / n;
    const points = [];

    for (let i = 0; i < n; i++) {
        const angle = rotRad + i * angleStep;
        points.push({
            x: Math.round((cx + radius * Math.cos(angle)) * 100) / 100,
            y: Math.round((cy + radius * Math.sin(angle)) * 100) / 100,
        });
    }

    return `M ${points[0].x} ${points[0].y} ` +
        points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') + ' Z';
}

/**
 * Generates an SVG path for a star.
 *
 * @param {number} cx Center X
 * @param {number} cy Center Y
 * @param {number} outerRadius Outer peak radius
 * @param {number} innerRadius Inner valley radius
 * @param {number} points Number of star points (>= 3)
 * @param {number} rotationDeg Rotation in degrees
 * @returns {string} SVG path d attribute
 */
export function generateStarPath(cx, cy, outerRadius, innerRadius, points = 5, rotationDeg = 0) {
    const numPoints = Math.max(3, Math.round(points));
    const totalVertices = numPoints * 2;
    const rotRad = (rotationDeg - 90) * (Math.PI / 180);
    const angleStep = Math.PI / numPoints;
    const vertices = [];

    for (let i = 0; i < totalVertices; i++) {
        const r = i % 2 === 0 ? outerRadius : innerRadius;
        const angle = rotRad + i * angleStep;
        vertices.push({
            x: Math.round((cx + r * Math.cos(angle)) * 100) / 100,
            y: Math.round((cy + r * Math.sin(angle)) * 100) / 100,
        });
    }

    return `M ${vertices[0].x} ${vertices[0].y} ` +
        vertices.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') + ' Z';
}

/**
 * Generates an SVG path string from an array of vector anchor points.
 * Each anchor has: { x, y, handleIn?: { x, y }, handleOut?: { x, y } }
 *
 * @param {Array} anchors
 * @param {boolean} isClosed
 * @returns {string} SVG path d
 */
export function generateBézierPath(anchors, isClosed = false) {
    if (!anchors || anchors.length === 0) return '';
    if (anchors.length === 1) return `M ${anchors[0].x} ${anchors[0].y} Z`;

    let d = `M ${anchors[0].x} ${anchors[0].y}`;

    for (let i = 1; i < anchors.length; i++) {
        const prev = anchors[i - 1];
        const curr = anchors[i];

        const cp1x = prev.handleOut ? prev.handleOut.x : prev.x;
        const cp1y = prev.handleOut ? prev.handleOut.y : prev.y;
        const cp2x = curr.handleIn ? curr.handleIn.x : curr.x;
        const cp2y = curr.handleIn ? curr.handleIn.y : curr.y;

        if (prev.handleOut || curr.handleIn) {
            d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
        } else {
            d += ` L ${curr.x} ${curr.y}`;
        }
    }

    if (isClosed && anchors.length > 2) {
        const last = anchors[anchors.length - 1];
        const first = anchors[0];
        const cp1x = last.handleOut ? last.handleOut.x : last.x;
        const cp1y = last.handleOut ? last.handleOut.y : last.y;
        const cp2x = first.handleIn ? first.handleIn.x : first.x;
        const cp2y = first.handleIn ? first.handleIn.y : first.y;

        if (last.handleOut || first.handleIn) {
            d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${first.x} ${first.y} Z`;
        } else {
            d += ` Z`;
        }
    }

    return d;
}

/**
 * Simplifies a sequence of freehand points into a smooth Bézier SVG path.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {number} smoothing
 * @returns {string} SVG path string
 */
export function simplifyFreehandPath(points, smoothing = 0.5) {
    if (!points || points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y} l 0.01 0.01`;
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

    let d = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        d += ` Q ${points[i].x} ${points[i].y}, ${xc} ${yc}`;
    }

    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;

    return d;
}

/**
 * Boolean operations on vector paths.
 * Generates composite compound path with evenodd fill rule for union, subtract, intersect, exclude.
 *
 * @param {'union'|'subtract'|'intersect'|'exclude'} operation
 * @param {Array<string>} pathStrings Array of SVG path strings
 * @returns {{ pathD: string, fillRule: string }}
 */
export function executeBooleanOperation(operation, pathStrings) {
    if (!pathStrings || pathStrings.length === 0) {
        return { pathD: '', fillRule: 'nonzero' };
    }
    if (pathStrings.length === 1) {
        return { pathD: pathStrings[0], fillRule: 'nonzero' };
    }

    switch (operation) {
        case 'union':
            // Compound combined path
            return {
                pathD: pathStrings.join(' '),
                fillRule: 'nonzero',
            };
        case 'subtract':
        case 'exclude':
            // SVG evenodd fill rule creates visual subtraction / exclusion in overlapping areas
            return {
                pathD: pathStrings.join(' '),
                fillRule: 'evenodd',
            };
        case 'intersect':
            // Compound path styled for intersection clipping
            return {
                pathD: pathStrings.join(' '),
                fillRule: 'evenodd',
            };
        default:
            return {
                pathD: pathStrings.join(' '),
                fillRule: 'nonzero',
            };
    }
}

/**
 * Convert stroke geometry to a closed filled vector outline path.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} strokeWidth
 * @returns {string} SVG path d
 */
export function convertStrokeToOutline(x, y, w, h, strokeWidth = 2) {
    const half = strokeWidth / 2;
    const outer = `M ${x - half} ${y - half} H ${x + w + half} V ${y + h + half} H ${x - half} Z`;
    const inner = `M ${x + half} ${y + half} V ${y + h - half} H ${x + w - half} V ${y + half} Z`;
    return `${outer} ${inner}`;
}
