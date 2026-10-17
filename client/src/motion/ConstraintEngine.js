/**
 * client/src/motion/ConstraintEngine.js
 *
 * Runtime constraints and hierarchical parenting engine for dynamic layouts,
 * responsive canvas pin-points, position tracking, and look-at orientation.
 */

import { composeTransform, IDENTITY_TRANSFORM } from './SceneSchema.js';

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * Topologically sorts nodes so that targets and parents are resolved before followers.
 * Detects cycles safely without crashing or infinite recursion.
 *
 * @param {Array<object>} nodes
 * @returns {Array<object>} ordered nodes
 */
export function topologicalSortNodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length <= 1) return nodes || [];

    const nodeMap = new Map();
    const adj = new Map();
    const inDegree = new Map();

    nodes.forEach(node => {
        if (!node?.id) return;
        nodeMap.set(node.id, node);
        adj.set(node.id, []);
        inDegree.set(node.id, 0);
    });

    nodes.forEach(node => {
        if (!node?.id) return;
        const dependencies = [];

        // Check parenting
        if (node.parentId && nodeMap.has(node.parentId)) {
            dependencies.push(node.parentId);
        }

        // Check constraints
        const c = node.constraints || {};
        if (c.targetId && nodeMap.has(c.targetId)) {
            dependencies.push(c.targetId);
        }
        if (c.lookAtTargetId && nodeMap.has(c.lookAtTargetId)) {
            dependencies.push(c.lookAtTargetId);
        }

        dependencies.forEach(depId => {
            if (depId !== node.id) {
                adj.get(depId).push(node.id);
                inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
            }
        });
    });

    const queue = [];
    inDegree.forEach((deg, id) => {
        if (deg === 0) queue.push(id);
    });

    const sorted = [];
    while (queue.length > 0) {
        const u = queue.shift();
        const node = nodeMap.get(u);
        if (node) sorted.push(node);

        const neighbors = adj.get(u) || [];
        for (const v of neighbors) {
            inDegree.set(v, inDegree.get(v) - 1);
            if (inDegree.get(v) === 0) {
                queue.push(v);
            }
        }
    }

    // If there is a cycle, append any unvisited nodes in original order
    if (sorted.length < nodes.length) {
        const visited = new Set(sorted.map(n => n.id));
        nodes.forEach(n => {
            if (!visited.has(n.id)) sorted.push(n);
        });
    }

    return sorted;
}

/**
 * Resolves pin-to-edge constraint for responsive canvas repositioning.
 *
 * @param {string} edge 'top-left'|'top-right'|'bottom-left'|'bottom-right'|'top-center'|'bottom-center'|'center'
 * @param {{x:number, y:number}} margin in percentage of frame
 */
export function resolvePinToEdge(edge, margin = { x: 5, y: 5 }) {
    const mx = num(margin.x, 5);
    const my = num(margin.y, 5);

    switch (edge) {
        case 'top-left':
            return { x: mx, y: my };
        case 'top-center':
            return { x: 50, y: my };
        case 'top-right':
            return { x: 100 - mx, y: my };
        case 'center-left':
            return { x: mx, y: 50 };
        case 'center':
            return { x: 50, y: 50 };
        case 'center-right':
            return { x: 100 - mx, y: 50 };
        case 'bottom-left':
            return { x: mx, y: 100 - my };
        case 'bottom-center':
            return { x: 50, y: 100 - my };
        case 'bottom-right':
            return { x: 100 - mx, y: 100 - my };
        default:
            return null;
    }
}

/**
 * Computes look-at rotation towards a target position.
 * Converts coordinate delta through frame aspect ratio to eliminate skew.
 *
 * @param {{x:number, y:number}} sourcePos
 * @param {{x:number, y:number}} targetPos
 * @param {{w:number, h:number}} frame
 * @param {number} [offsetAngle=0]
 */
export function computeLookAtRotation(sourcePos, targetPos, frame = { w: 1920, h: 1080 }, offsetAngle = 0) {
    const dx = (num(targetPos.x, 50) - num(sourcePos.x, 50)) * (frame.w / 100);
    const dy = (num(targetPos.y, 50) - num(sourcePos.y, 50)) * (frame.h / 100);

    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
        return num(offsetAngle, 0);
    }

    const rad = Math.atan2(dy, dx);
    const deg = (rad * 180) / Math.PI;
    return deg + num(offsetAngle, 0);
}

/**
 * Resolves all constraints and parenting across a scene node collection.
 * Pure function: returns a Map of nodeId -> resolvedTransform.
 *
 * @param {Array<object>} nodes scene nodes
 * @param {object} frame { w, h, aspectRatio }
 */
export function resolveConstraints(nodes, frame = { w: 1920, h: 1080 }) {
    if (!Array.isArray(nodes) || nodes.length === 0) return new Map();

    const sorted = topologicalSortNodes(nodes);
    const resolvedTransforms = new Map();

    for (const node of sorted) {
        let t = {
            x: num(node.transform?.x, 50),
            y: num(node.transform?.y, 50),
            scale: num(node.transform?.scale, 1),
            rotation: num(node.transform?.rotation, 0),
            opacity: num(node.transform?.opacity, 1),
        };

        const c = node.constraints || {};

        // 1. Pin to Edge
        if (c.pinEdge) {
            const pinned = resolvePinToEdge(c.pinEdge, c.pinMargin);
            if (pinned) {
                t.x = pinned.x;
                t.y = pinned.y;
            }
        }

        // 2. Track Position
        if (c.targetId && resolvedTransforms.has(c.targetId)) {
            const targetT = resolvedTransforms.get(c.targetId);
            const offX = num(c.offsetX, 0);
            const offY = num(c.offsetY, 0);
            t.x = targetT.x + offX;
            t.y = targetT.y + offY;
        }

        // 3. Look At
        if (c.lookAtTargetId && resolvedTransforms.has(c.lookAtTargetId)) {
            const targetT = resolvedTransforms.get(c.lookAtTargetId);
            t.rotation = computeLookAtRotation(t, targetT, frame, c.lookAtOffset || 0);
        } else if (c.lookAtPoint && Number.isFinite(c.lookAtPoint.x) && Number.isFinite(c.lookAtPoint.y)) {
            t.rotation = computeLookAtRotation(t, c.lookAtPoint, frame, c.lookAtOffset || 0);
        }

        // 4. Hierarchical Parenting
        if (node.parentId && resolvedTransforms.has(node.parentId)) {
            const parentT = resolvedTransforms.get(node.parentId);
            const inherit = {
                inheritPosition: c.inheritPosition !== false,
                inheritRotation: c.inheritRotation !== false,
                inheritScale: c.inheritScale !== false,
                inheritOpacity: c.inheritOpacity !== false,
            };

            const composed = composeTransform(parentT, t, frame);
            t = {
                x: inherit.inheritPosition ? composed.x : t.x,
                y: inherit.inheritPosition ? composed.y : t.y,
                scale: inherit.inheritScale ? composed.scale : t.scale,
                rotation: inherit.inheritRotation ? composed.rotation : t.rotation,
                opacity: inherit.inheritOpacity ? composed.opacity : t.opacity,
            };
        }

        resolvedTransforms.set(node.id, t);
    }

    return resolvedTransforms;
}

export default {
    topologicalSortNodes,
    resolvePinToEdge,
    computeLookAtRotation,
    resolveConstraints,
};
