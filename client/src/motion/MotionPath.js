/** Utilities for authoring a bounded, clip-local 2D motion path. */

export const MAX_MOTION_PATH_POINTS = 32;

export function createMotionPath(duration = 1) {
    return {
        points: [[0, 0], [15, -10]],
        startTime: 0,
        duration: Math.max(0.001, Number(duration) || 1),
        easing: 'easeInOutCubic',
        mode: 'bezier',
        arcLength: true,
        closed: false,
        bank: 0,
        spin: 0,
    };
}

function pointXY(point) {
    return Array.isArray(point)
        ? [Number(point[0]), Number(point[1])]
        : [Number(point?.x), Number(point?.y)];
}

export function updateMotionPathPoint(path, index, axis, value) {
    if (!path || !Array.isArray(path.points) || !['x', 'y'].includes(axis) || !Number.isFinite(Number(value))) return path;
    if (!Number.isInteger(index) || index < 0 || index >= path.points.length) return path;
    const points = path.points.map(pointXY);
    points[index][axis === 'x' ? 0 : 1] = Number(value);
    return { ...path, points };
}

export function appendMotionPathPoint(path) {
    if (!path || !Array.isArray(path.points) || path.points.length < 2 || path.points.length >= MAX_MOTION_PATH_POINTS) return path;
    const points = path.points.map(pointXY);
    const current = points.at(-1);
    const previous = points.at(-2);
    points.push([current[0] + (current[0] - previous[0]), current[1] + (current[1] - previous[1])]);
    return { ...path, points };
}

export function removeMotionPathPoint(path, index) {
    if (!path || !Array.isArray(path.points) || path.points.length <= 2) return path;
    if (!Number.isInteger(index) || index < 0 || index >= path.points.length) return path;
    return { ...path, points: path.points.filter((_, pointIndex) => pointIndex !== index).map(pointXY) };
}
