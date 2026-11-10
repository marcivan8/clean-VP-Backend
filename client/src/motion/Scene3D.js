/**
 * Lightweight deterministic 3D scene renderer for motion graphics.
 *
 * This renderer projects triangles with a perspective camera and shades their
 * faces from scene lights. It uses WebGL for eligible opaque scenes and the
 * Canvas software depth/painter paths for transparency and unsupported cases.
 * The same renderer runs in browser preview and the server PNG-frame renderer.
 * Coordinates are scene units; the camera looks from +Z toward the origin.
 */

import { sampleAnimation } from './MotionResolver.js';
import { evaluateMotionExpression } from './MotionExpression.js';
import { sceneImageTextureCache } from './SceneImageTextureCache.js';
import { renderScene3DGpu } from './Scene3DGPU.js';
import { remapSceneObjectTime } from './TimeRemap.js';
import { sampleProceduralParticle } from './ProceduralParticles.js';
import { sampleAudioEnvelope } from './AudioReactive.js';
export { remapSceneObjectTime, resolveSceneVideoSourceTime, maxSceneObjectSourceTime, getSceneShutterSampleTimes } from './TimeRemap.js';

/** Shared editor/renderer defaults so a new camera keyframe starts from the value actually rendered. */
export const SCENE3D_CAMERA_DEFAULTS = Object.freeze({
    x: 0, y: 0, z: 7, yaw: 0, pitch: 0, roll: 0,
    fov: 780, orthoScale: 180, near: 0.05, far: 1000,
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
// Parent chains are normalized before rendering. Keep a generous ceiling to
// protect the renderer from pathological imported scenes while allowing
// realistic nested compositions to inherit their complete transform stack.
const MAX_SCENE_OBJECT_PARENT_DEPTH = 128;
export const MAX_SCENE_OBJECTS = 80;
export const MAX_SCENE_LIGHTS = 8;
export const MAX_SCENE_PARTICLES = 500;
export const MAX_MESH_VERTICES = 5000;
export const MAX_MESH_FACES = 5000;
// Bound per-frame geometry work. A single authored n-gon can expand into many
// triangles, so raw face count alone is not a useful renderer budget.
export const MAX_MESH_TRIANGLES = 10_000;
export const MAX_SCENE_TRIANGLES = 50_000;
export const MAX_SCENE_SHADOW_RECEIVERS = 16;
const SCENE3D_MULTIPLICATIVE_ANIMATION_PROPERTIES = new Set(['scale', 'scaleX', 'scaleY', 'scaleZ', 'opacity']);
const SCENE3D_COLOR_CHANNEL_PROPERTIES = new Set(['colorR', 'colorG', 'colorB', 'emissiveR', 'emissiveG', 'emissiveB']);
/** Limits that truncate content in the deterministic 3D renderer. */
export function getScene3DRenderLimitWarnings(scene = {}) {
    const objects = Array.isArray(scene.objects) ? scene.objects : [];
    const lights = Array.isArray(scene.lights) ? scene.lights : [];
    const receivers = objects.filter(object => object?.type === 'plane' && object.receivesShadow === true).length
        + (scene.shadows?.receiverPlane && typeof scene.shadows.receiverPlane === 'object' ? 1 : 0);
    const particleCount = Number(scene.particles?.count);
    const particles = Number.isFinite(particleCount) ? Math.max(0, Math.round(particleCount)) : 0;
    const warnings = [
        ['objects', objects.length, MAX_SCENE_OBJECTS],
        ['lights', lights.length, MAX_SCENE_LIGHTS],
        ['shadow receiver planes', receivers, MAX_SCENE_SHADOW_RECEIVERS],
        ['particles', particles, MAX_SCENE_PARTICLES],
    ].filter(([, actual, limit]) => actual > limit)
        .map(([label, actual, limit]) => ({ label, actual, limit }));
    let sceneTriangles = 0;
    for (const object of objects.slice(0, MAX_SCENE_OBJECTS)) {
        if (object?.type !== 'mesh') continue;
        const vertices = Array.isArray(object.vertices) ? object.vertices.length : 0;
        const faces = Array.isArray(object.faces) ? object.faces : [];
        const validFaces = faces.slice(0, MAX_MESH_FACES).filter(face => Array.isArray(face)
            && face.length >= 3 && face.length <= 64
            && face.every(index => Number.isInteger(index) && index >= 0 && index < Math.min(vertices, MAX_MESH_VERTICES)));
        const triangles = validFaces.reduce((total, face) => total + face.length - 2, 0);
        const name = object.name || object.id || 'unnamed';
        const meshLimits = [
            [`vertices on mesh “${name}”`, vertices, MAX_MESH_VERTICES],
            [`faces on mesh “${name}”`, faces.length, MAX_MESH_FACES],
            [`triangles on mesh “${name}”`, triangles, MAX_MESH_TRIANGLES],
        ];
        for (const [label, actual, limit] of meshLimits) {
            if (actual > limit) warnings.push({ label, actual, limit, objectId: object.id || null });
        }
        sceneTriangles += Math.min(triangles, MAX_MESH_TRIANGLES);
    }
    if (sceneTriangles > MAX_SCENE_TRIANGLES) {
        warnings.push({ label: 'triangles in the 3D scene', actual: sceneTriangles, limit: MAX_SCENE_TRIANGLES });
    }
    return warnings.map(warning => ({ ...warning,
        message: `This 3D scene has ${warning.actual} ${warning.label}; the renderer supports ${warning.limit}, so the extra content will not appear.` }));
}
/** Report authored 3D values that the renderer silently substitutes. */
export function getScene3DCompatibilityWarnings(scene = {}) {
    const supportedObjects = new Set(['box', 'sphere', 'capsule', 'cylinder', 'cone', 'torus', 'plane', 'image', 'video', 'text', 'mesh']);
    const supportedLights = new Set(['point', 'directional', 'spot', 'area']);
    const supportedSides = new Set(['front', 'back', 'double']);
    const warnings = [];
    const checkRange = (record, key, label, min, max, owner, fallback) => {
        if (!record || !Object.hasOwn(record, key) || record[key] === undefined) return;
        const value = Number(record[key]);
        if (!Number.isFinite(value)) {
            warnings.push({ ...owner, message: `${label} on ${owner.messageOwner} is invalid; the renderer will use ${fallback}.` });
        } else if (value < min || value > max) {
            warnings.push({ ...owner, message: `${label} on ${owner.messageOwner} is ${value}, outside the supported range ${min}–${max}; the renderer will clamp it.` });
        }
    };
    for (const object of Array.isArray(scene.objects) ? scene.objects : []) {
        const name = object?.name || object?.id || 'unnamed';
        const owner = { objectId: object?.id || null, messageOwner: `3D object “${name}”` };
        if (object && Object.hasOwn(object, 'type') && object.type !== undefined && !supportedObjects.has(object.type)) {
            warnings.push({ objectId: object.id || null, message: `3D object “${name}” uses unsupported type “${object.type}”; it will render as a box.` });
        }
        if (object?.material && Object.hasOwn(object.material, 'side') && object.material.side !== undefined && !supportedSides.has(object.material.side)) {
            warnings.push({ objectId: object.id || null, message: `3D object “${name}” uses unsupported material side “${object.material.side}”; it will render as front-sided.` });
        }
        if (object && Object.hasOwn(object, 'blendMode') && object.blendMode !== undefined && !SCENE3D_BLEND_MODES.includes(object.blendMode)) {
            warnings.push({ objectId: object.id || null, message: `3D object “${name}” uses unsupported blend mode “${object.blendMode}”; it will render as source-over.` });
        }
        checkRange(object?.material, 'opacity', 'Material opacity', 0, 1, owner, '1');
        checkRange(object?.material, 'roughness', 'Material roughness', 0.04, 1, owner, '0.62');
        checkRange(object?.material, 'metalness', 'Material metalness', 0, 1, owner, '0.08');
        checkRange(object?.material, 'emissiveIntensity', 'Emissive intensity', 0, 10, owner, '0');
    }
    (Array.isArray(scene.lights) ? scene.lights : []).forEach((light, index) => {
        const owner = { lightIndex: index, messageOwner: `3D light ${index + 1}` };
        if (light && Object.hasOwn(light, 'type') && light.type !== undefined && !supportedLights.has(light.type)) {
            warnings.push({ lightIndex: index, message: `3D light ${index + 1} uses unsupported type “${light.type}”; it will render as a point light.` });
        }
        checkRange(light, 'intensity', 'Intensity', 0, 4, owner, '0.8');
        checkRange(light, 'range', 'Range', 0.1, 1000, owner, '24');
        checkRange(light, 'decay', 'Decay', 0, 8, owner, '0.3');
        checkRange(light, 'angle', 'Spot angle', 1, 179, owner, '60');
        checkRange(light, 'width', 'Area-light width', 0.1, 40, owner, '4');
        checkRange(light, 'height', 'Area-light height', 0.1, 40, owner, '4');
    });
    const particleShape = scene.particles?.shape;
    if (particleShape != null && !SCENE3D_PARTICLE_SHAPES.includes(particleShape)) {
        warnings.push({ message: `3D particles use unsupported shape “${particleShape}”; they will render as circles.` });
    }
    return warnings.map(({ messageOwner, ...warning }) => warning);
}
export const SCENE3D_BLEND_MODES = Object.freeze([
    'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference',
    'addition', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'exclusion',
    'hue', 'saturation', 'color', 'luminosity',
]);
export const resolveParticleSeed = (particles = {}) => n(particles.seed, 17);
export const SCENE3D_PARTICLE_SHAPES = Object.freeze(['circle', 'square', 'diamond', 'star']);
function particleContains(shape, dx, dy, radius) {
    const x = dx / radius, y = dy / radius;
    if (shape === 'square') return Math.abs(x) <= 1 && Math.abs(y) <= 1;
    if (shape === 'diamond') return Math.abs(x) + Math.abs(y) <= 1;
    if (shape === 'star') {
        const angle = Math.atan2(y, x) + Math.PI / 2;
        const sector = ((angle % (Math.PI / 5)) + Math.PI / 5) % (Math.PI / 5);
        return Math.hypot(x, y) <= 0.52 + 0.48 * Math.cos(sector * 10);
    }
    return x * x + y * y <= 1;
}
function traceParticlePath(ctx, shape, x, y, radius) {
    ctx.beginPath();
    if (shape === 'square') ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
    else if (shape === 'diamond') {
        ctx.moveTo(x, y - radius); ctx.lineTo(x + radius, y); ctx.lineTo(x, y + radius); ctx.lineTo(x - radius, y); ctx.closePath();
    } else if (shape === 'star') {
        for (let point = 0; point < 10; point++) {
            const angle = -Math.PI / 2 + point * Math.PI / 5;
            const reach = radius * (point % 2 === 0 ? 1 : 0.52);
            const px = x + Math.cos(angle) * reach, py = y + Math.sin(angle) * reach;
            if (point === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
    } else ctx.arc(x, y, radius, 0, Math.PI * 2);
}
const rad = (deg) => n(deg) * Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => ({ x: n(x), y: n(y), z: n(z) });

function rotate(p, r) {
    let { x, y, z } = p;
    const cx = Math.cos(r.x), sx = Math.sin(r.x);
    const cy = Math.cos(r.y), sy = Math.sin(r.y);
    const cz = Math.cos(r.z), sz = Math.sin(r.z);
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    return V(x, y, z);
}

function quaternionFromEulerXYZ(rotation = {}) {
    const x = rad(rotation.x) / 2, y = rad(rotation.y) / 2, z = rad(rotation.z) / 2;
    const sx = Math.sin(x), cx = Math.cos(x), sy = Math.sin(y), cy = Math.cos(y), sz = Math.sin(z), cz = Math.cos(z);
    // `rotate()` applies X, then Y, then Z, which corresponds to qz*qy*qx.
    return {
        x: sx * cy * cz - cx * sy * sz,
        y: cx * sy * cz + sx * cy * sz,
        z: cx * cy * sz - sx * sy * cz,
        w: cx * cy * cz + sx * sy * sz,
    };
}

function eulerXYZFromQuaternion(q) {
    const sinY = clamp(2 * (q.w * q.y - q.z * q.x), -1, 1);
    return {
        x: Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y)) * 180 / Math.PI,
        y: Math.asin(sinY) * 180 / Math.PI,
        z: Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)) * 180 / Math.PI,
    };
}

/** Compose parent and local Euler rotations without treating angles as additive. */
export function composeSceneRotation(parent = {}, local = {}) {
    const a = quaternionFromEulerXYZ(parent), b = quaternionFromEulerXYZ(local);
    return eulerXYZFromQuaternion({
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    });
}

const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a) => { const m = Math.hypot(a.x, a.y, a.z) || 1; return V(a.x / m, a.y / m, a.z / m); };

const IDENTITY_3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const multiplyMatrix3 = (a, b) => [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

function sceneRotationMatrix(rotation = {}) {
    const x = rad(rotation.x), y = rad(rotation.y), z = rad(rotation.z);
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    // Keep the same X, then Y, then Z convention as rotate().
    return [
        cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
        sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
        -sy, cy * sx, cy * cx,
    ];
}

function transformSceneVector(point, matrix) {
    return V(
        matrix[0] * point.x + matrix[1] * point.y + matrix[2] * point.z,
        matrix[3] * point.x + matrix[4] * point.y + matrix[5] * point.z,
        matrix[6] * point.x + matrix[7] * point.y + matrix[8] * point.z,
    );
}

/** Compose a full affine parent/local transform, retaining shear from nested TRS layers. */
export function composeSceneTransform(parent = {}, localPosition = {}, localRotation = {}, localScale = {}) {
    const parentMatrix = Array.isArray(parent.matrix) && parent.matrix.length === 9 ? parent.matrix : IDENTITY_3;
    const localScaleVector = V(n(localScale.x, 1), n(localScale.y, 1), n(localScale.z, 1));
    const rotationMatrix = sceneRotationMatrix(localRotation);
    const localMatrix = multiplyMatrix3(rotationMatrix, [
        localScaleVector.x, 0, 0,
        0, localScaleVector.y, 0,
        0, 0, localScaleVector.z,
    ]);
    const parentPosition = parent.position || V();
    const position = V(localPosition.x, localPosition.y, localPosition.z);
    return {
        position: add(parentPosition, transformSceneVector(position, parentMatrix)),
        matrix: multiplyMatrix3(parentMatrix, localMatrix),
        // Keep decomposed values for inspectors and legacy callers. Rendering
        // uses matrix so nested non-uniform-scale shear is preserved.
        rotation: composeSceneRotation(parent.rotation, localRotation),
        scale: V(n(parent.scale?.x, 1) * localScaleVector.x,
            n(parent.scale?.y, 1) * localScaleVector.y,
            n(parent.scale?.z, 1) * localScaleVector.z),
    };
}

function boxMesh(size) {
    const x = n(size?.x, 1) / 2, y = n(size?.y, 1) / 2, z = n(size?.z, 1) / 2;
    const v = [V(-x,-y,-z), V(x,-y,-z), V(x,y,-z), V(-x,y,-z), V(-x,-y,z), V(x,-y,z), V(x,y,z), V(-x,y,z)];
    return { vertices: v, faces: [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]] };
}

function sphereMesh(radius, segments = 24, rings = 16) {
    const vertices = [];
    for (let y = 0; y <= rings; y++) {
        const theta = Math.PI * y / rings;
        for (let x = 0; x <= segments; x++) {
            const phi = 2 * Math.PI * x / segments;
            vertices.push(V(radius * Math.sin(theta) * Math.cos(phi), radius * Math.cos(theta), radius * Math.sin(theta) * Math.sin(phi)));
        }
    }
    const faces = [];
    for (let y = 0; y < rings; y++) for (let x = 0; x < segments; x++) {
        const a = y * (segments + 1) + x, b = a + segments + 1;
        // Keep the winding outward so the face normal receives light on the
        // visible surface (the reverse winding made spheres look unlit).
        faces.push([a, a + 1, b + 1, b]);
    }
    return { vertices, faces };
}

function radialMesh(radius, height, segments = 20, pointed = false) {
    const vertices = [];
    for (const y of [-height / 2, height / 2]) for (let i = 0; i < segments; i++) {
        const a = 2 * Math.PI * i / segments;
        vertices.push(V(Math.cos(a) * radius, y, Math.sin(a) * radius));
    }
    const faces = [];
    if (pointed) {
        const tip = vertices.push(V(0, height / 2, 0)) - 1;
        for (let i = 0; i < segments; i++) faces.push([i, (i + 1) % segments, tip]);
    } else {
        for (let i = 0; i < segments; i++) faces.push([i, (i + 1) % segments, segments + (i + 1) % segments, segments + i]);
    }
    faces.push(Array.from({ length: segments }, (_, i) => i).reverse(), Array.from({ length: segments }, (_, i) => segments + i));
    return { vertices, faces };
}

function capsuleMesh(radius, height, segments = 24, hemisphereRings = 8) {
    // Y-up capsule with a cylindrical waist and rounded hemispherical ends.
    // Height is the end-to-end dimension; keep the geometry inside that
    // authored bound when its requested radius is too large.
    const r = Math.min(radius, height / 2);
    const halfWaist = Math.max(0, height / 2 - r);
    const rings = [];
    for (let step = 0; step <= hemisphereRings; step++) {
        const angle = Math.PI / 2 - (Math.PI / 2) * step / hemisphereRings;
        rings.push({ y: halfWaist + r * Math.sin(angle), radius: r * Math.cos(angle) });
    }
    // When the waist collapses (radius === height / 2), the top hemisphere's
    // equator is already the bottom hemisphere's start. Avoid a duplicate
    // ring, which would introduce zero-area faces into the sphere-like limit.
    if (halfWaist > 0) rings.push({ y: -halfWaist, radius: r });
    for (let step = 1; step <= hemisphereRings; step++) {
        const angle = -(Math.PI / 2) * step / hemisphereRings;
        rings.push({ y: -halfWaist + r * Math.sin(angle), radius: r * Math.cos(angle) });
    }
    const vertices = [];
    for (const ring of rings) for (let segment = 0; segment < segments; segment++) {
        const angle = 2 * Math.PI * segment / segments;
        vertices.push(V(Math.cos(angle) * ring.radius, ring.y, Math.sin(angle) * ring.radius));
    }
    const faces = [];
    for (let ring = 0; ring < rings.length - 1; ring++) for (let segment = 0; segment < segments; segment++) {
        const a = ring * segments + segment;
        const next = ring * segments + (segment + 1) % segments;
        const below = (ring + 1) * segments + segment;
        const belowNext = (ring + 1) * segments + (segment + 1) % segments;
        faces.push([a, next, belowNext, below]);
    }
    return { vertices, faces };
}

function torusMesh(radius, tube, segments = 24, sides = 10) {
    const vertices = [], faces = [];
    for (let i = 0; i <= segments; i++) {
        const u = 2 * Math.PI * i / segments;
        for (let j = 0; j <= sides; j++) {
            const v = 2 * Math.PI * j / sides;
            const r = radius + tube * Math.cos(v);
            vertices.push(V(r * Math.cos(u), tube * Math.sin(v), r * Math.sin(u)));
        }
    }
    for (let i = 0; i < segments; i++) for (let j = 0; j < sides; j++) {
        const a = i * (sides + 1) + j, b = a + sides + 1;
        faces.push([a, a + 1, b + 1, b]);
    }
    return { vertices, faces };
}

const primitiveMeshCache = new Map();
const PRIMITIVE_MESH_CACHE_LIMIT = 64;

export function normalizeSceneMesh(object) {
    // User-provided meshes can be edited in place, so keep normalizing those
    // from their current data. Built-in primitive topology only depends on a
    // small set of dimensions and is identical across animation frames.
    if (object?.type === 'mesh' && Array.isArray(object.vertices) && Array.isArray(object.faces)) {
        const size = object.size || {};
        const vertices = object.vertices.slice(0, MAX_MESH_VERTICES).map(p => V(
            n(p?.x) * n(size.x, 1), n(p?.y) * n(size.y, 1), n(p?.z) * n(size.z, 1),
        ));
        const authoredFaces = object.faces.slice(0, MAX_MESH_FACES).filter(face => Array.isArray(face)
            && face.length >= 3 && face.length <= 64
            && face.every(index => Number.isInteger(index) && index >= 0 && index < vertices.length));
        const faces = [];
        let triangleBudget = MAX_MESH_TRIANGLES;
        for (const face of authoredFaces) {
            const triangleCount = face.length - 2;
            if (triangleCount > triangleBudget) break;
            faces.push(face);
            triangleBudget -= triangleCount;
            if (triangleBudget <= 0) break;
        }
        const uvs = Array.isArray(object.uvs) && object.uvs.length === vertices.length
            ? object.uvs.map(uv => Array.isArray(uv) && uv.length >= 2
                && Number.isFinite(Number(uv[0])) && Number.isFinite(Number(uv[1]))
                ? [clamp(Number(uv[0]), 0, 1), clamp(Number(uv[1]), 0, 1)]
                : null)
            : null;
        return { vertices, faces, ...(uvs?.every(Boolean) ? { uvs } : {}) };
    }
    const type = object?.type || 'box';
    const size = object?.size || {};
    const radius = type === 'torus' ? clamp(n(object?.radius, 0.8), 0.02, 10) : clamp(n(object?.radius, 0.65), 0.02, 10);
    const height = clamp(n(object?.height, 1.5), 0.02, 20);
    const tube = clamp(n(object?.tube, 0.2), 0.01, 3);
    const dimensions = [n(size.x, 1), n(size.y, 1), n(size.z, 1)];
    const key = JSON.stringify([type, dimensions, radius, height, tube]);
    let mesh = primitiveMeshCache.get(key);
    if (mesh) {
        primitiveMeshCache.delete(key);
        primitiveMeshCache.set(key, mesh);
        return mesh;
    }
    if (type === 'sphere') mesh = sphereMesh(radius);
    else if (type === 'capsule') mesh = capsuleMesh(radius, height);
    else if (type === 'cylinder') mesh = radialMesh(radius, height);
    else if (type === 'cone') mesh = radialMesh(radius, height, 20, true);
    else if (type === 'torus') mesh = torusMesh(radius, tube);
    else if (['plane', 'image', 'video'].includes(type)) {
        const [width, planeHeight] = dimensions;
        mesh = { vertices: [V(-width/2,-planeHeight/2,0), V(width/2,-planeHeight/2,0), V(width/2,planeHeight/2,0), V(-width/2,planeHeight/2,0)], uvs: [[0,1],[1,1],[1,0],[0,0]], faces: [[0,1,2,3]] };
    } else mesh = boxMesh(size);
    if (primitiveMeshCache.size >= PRIMITIVE_MESH_CACHE_LIMIT) primitiveMeshCache.delete(primitiveMeshCache.keys().next().value);
    primitiveMeshCache.set(key, mesh);
    return mesh;
}

function colorWithLight(hex, amount) {
    const rgb = parseHexColor(hex);
    const factor = clamp(amount, 0.08, 1.8);
    return `rgb(${rgb.map(channel => clamp(Math.round(channel * factor), 0, 255)).join(',')})`;
}

function parseHexColor(hex) {
    const value = String(hex || '#7C3AED').match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1] || '7C3AED';
    const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function colorFromChannels(baseColor, animated, prefix) {
    const base = parseHexColor(baseColor);
    const channels = ['R', 'G', 'B'].map((channel, index) => clamp(
        n(animated[`${prefix}${channel}`], base[index]), 0, 255));
    return `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function shadeMaterial(baseColor, ambient, contributions, metalness, roughness, emissiveColor = null, emissiveIntensity = 0) {
    const base = parseHexColor(baseColor);
    const out = base.map(channel => channel * ambient);
    if (emissiveColor && emissiveIntensity > 0) {
        const emission = parseHexColor(emissiveColor);
        for (let i = 0; i < 3; i++) out[i] += emission[i] * emissiveIntensity;
    }
    for (const { color, diffuse, specular } of contributions) {
        const tint = parseHexColor(color);
        for (let i = 0; i < 3; i++) {
            const light = tint[i] / 255;
            out[i] += base[i] * light * diffuse;
            // Metals reflect their own base colour; dielectrics reflect the light.
            out[i] += (metalness > 0.5 ? base[i] * light : tint[i]) * specular;
        }
    }
    return `rgb(${out.map(channel => clamp(Math.round(channel * (1 - roughness * 0.08)), 0, 255)).join(',')})`;
}

function textureLighting(ambient, contributions, metalness, roughness, emissiveColor, emissiveIntensity) {
    const diffuse = [ambient, ambient, ambient];
    const specular = [0, 0, 0];
    for (const contribution of contributions) {
        const lightColor = parseHexColor(contribution.color);
        for (let channel = 0; channel < 3; channel++) {
            diffuse[channel] += lightColor[channel] / 255 * contribution.diffuse;
            specular[channel] += lightColor[channel] / 255 * contribution.specular;
        }
    }
    const emission = emissiveColor && emissiveIntensity > 0
        ? parseHexColor(emissiveColor).map(channel => channel * emissiveIntensity) : [0, 0, 0];
    const finish = 1 - roughness * 0.08;
    return {
        diffuse: diffuse.map(value => value * finish),
        metallicSpecular: metalness > 0.5 ? specular.map(value => value * finish) : [0, 0, 0],
        dielectricSpecular: metalness > 0.5 ? [0, 0, 0] : specular.map(value => value * finish),
        emission: emission.map(value => value * finish),
    };
}

function shadeTextureSample(source, lighting) {
    if (!lighting) return source;
    return [0, 1, 2].map(channel => clamp(Math.round(
        source[channel] * (lighting.diffuse[channel] + lighting.metallicSpecular[channel])
        + lighting.dielectricSpecular[channel] + lighting.emission[channel],
    ), 0, 255)).concat(source[3]);
}

function drawTexturedTriangle(ctx, image, uvs, points, opacity) {
    const width = Number(image.naturalWidth || image.videoWidth || image.width) || 0;
    const height = Number(image.naturalHeight || image.videoHeight || image.height) || 0;
    if (!width || !height) return;
    const [p, q, r] = points;
    const depths = points.map(point => Math.max(0.05, Number(point.z) || 0.05));
    const minDepth = Math.min(...depths), maxDepth = Math.max(...depths);
    // Canvas 2D only supports affine transforms. Subdivide triangles whose
    // vertices sit at different camera depths, calculating UVs at every new
    // vertex with the same reciprocal-depth interpolation as the z-buffer
    // renderer. This keeps the no-readback fallback from visibly stretching
    // textures across tilted planes and custom meshes.
    const divisions = clamp(Math.ceil((maxDepth / minDepth - 1) * 12), 1, 16);
    const mapVertex = (i, j) => {
        const weights = [1 - (i + j) / divisions, i / divisions, j / divisions];
        const reciprocalDepth = weights.reduce((sum, weight, index) => sum + weight / depths[index], 0);
        const uv = [0, 1].map(axis => weights.reduce((sum, weight, index) =>
            sum + weight * uvs[index][axis] / depths[index], 0) / reciprocalDepth);
        return {
            x: weights[0] * p.x + weights[1] * q.x + weights[2] * r.x,
            y: weights[0] * p.y + weights[1] * q.y + weights[2] * r.y,
            u: uv[0] * width,
            v: uv[1] * height,
        };
    };
    const drawAffine = (vertices) => {
        const [a, b, c] = vertices.map(vertex => ({ x: vertex.u, y: vertex.v }));
        const [d, e, f] = vertices;
    const den = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
    if (Math.abs(den) < 1e-6) return;
    const solve = (v0, v1, v2) => [
        (v0 * (b.y - c.y) + v1 * (c.y - a.y) + v2 * (a.y - b.y)) / den,
        (v0 * (c.x - b.x) + v1 * (a.x - c.x) + v2 * (b.x - a.x)) / den,
        (v0 * (b.x * c.y - c.x * b.y) + v1 * (c.x * a.y - a.x * c.y) + v2 * (a.x * b.y - b.x * a.y)) / den,
    ];
        const [m11, m12, dx] = solve(d.x, e.x, f.x);
        const [m21, m22, dy] = solve(d.y, e.y, f.y);
    ctx.save();
    ctx.globalAlpha = opacity;
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(e.x, e.y); ctx.lineTo(f.x, f.y); ctx.closePath(); ctx.clip();
    ctx.transform(m11, m21, m12, m22, dx, dy);
    ctx.drawImage(image, 0, 0, width, height);
    ctx.restore();
    };
    const vertices = new Map();
    const getVertex = (i, j) => {
        const key = `${i},${j}`;
        if (!vertices.has(key)) vertices.set(key, mapVertex(i, j));
        return vertices.get(key);
    };
    for (let j = 0; j < divisions; j++) {
        for (let i = 0; i + j < divisions; i++) {
            drawAffine([getVertex(i, j), getVertex(i + 1, j), getVertex(i, j + 1)]);
            if (i + j < divisions - 1) {
                drawAffine([getVertex(i + 1, j), getVertex(i + 1, j + 1), getVertex(i, j + 1)]);
            }
        }
    }
}

// Shared by renderer validation and editor controls so a selectable mask is
// always renderable and an unsupported authored value is reported up front.
export const SCENE3D_TEXTURE_MASK_SHAPES = Object.freeze([
    'none', 'ellipse', 'circle', 'rounded-rectangle', 'rectangle', 'capsule', 'polygon', 'star', 'arrow',
]);
const TEXTURE_MASK_SHAPES = new Set(SCENE3D_TEXTURE_MASK_SHAPES);

function maskPolygon(shape, sides = 5) {
    if (shape === 'arrow') return [[0.5, 0], [1, 0.42], [0.68, 0.42], [0.68, 1], [0.32, 1], [0.32, 0.42], [0, 0.42]];
    const count = shape === 'star' ? 10 : Math.max(3, Math.min(32, Math.round(sides)));
    return Array.from({ length: count }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
        const radius = shape === 'star' && index % 2 ? 0.25 : 0.5;
        return [0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius];
    });
}

function clipPlaneMask(ctx, shape, rect, invert = false) {
    if (!shape || shape === 'none' || !rect || rect.width <= 0 || rect.height <= 0) return false;
    const { x, y, width, height } = rect;
    ctx.beginPath();
    if (invert) ctx.rect(x - 1_000_000, y - 1_000_000, 2_000_000, 2_000_000);
    if (shape === 'circle' || shape === 'ellipse') {
        const radiusX = shape === 'circle' ? Math.min(width, height) / 2 : width / 2;
        const radiusY = shape === 'circle' ? Math.min(width, height) / 2 : height / 2;
        ctx.ellipse(x + width / 2, y + height / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
    } else if (shape === 'rounded-rectangle') {
        const radius = Math.min(18, width * 0.12, height * 0.12);
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, radius);
        else {
            ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
            ctx.lineTo(x + width, y + height - radius); ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
            ctx.lineTo(x + radius, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
            ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y);
        }
    } else if (['polygon', 'star', 'arrow'].includes(shape)) {
        const vertices = maskPolygon(shape);
        ctx.moveTo(x + vertices[0][0] * width, y + vertices[0][1] * height);
        for (let index = 1; index < vertices.length; index++) ctx.lineTo(x + vertices[index][0] * width, y + vertices[index][1] * height);
        ctx.closePath();
    } else if (shape === 'capsule') {
        const radius = Math.min(width, height) / 2;
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, radius);
        else {
            ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y);
            ctx.arc(x + width - radius, y + radius, radius, -Math.PI / 2, Math.PI / 2);
            ctx.lineTo(x + radius, y + height);
            ctx.arc(x + radius, y + radius, radius, Math.PI / 2, Math.PI * 1.5);
        }
    } else if (shape === 'rectangle') {
        ctx.rect(x, y, width, height);
    } else return false;
    if (invert) ctx.clip('evenodd');
    else ctx.clip();
    return true;
}

// Reuse the large per-pixel z-buffer arrays across frames rendered into the
// same canvas. At UHD, allocating these for every frame creates ~50 MB of
// short-lived typed arrays even before Canvas' image data is counted. A
// WeakMap lets a discarded preview/export canvas release its buffers without
// a global eviction policy, while keeping independently rendered canvases
// isolated.
const sceneDepthBuffers = new WeakMap();

function depthBuffersFor(canvas, pixelCount) {
    let buffers = sceneDepthBuffers.get(canvas);
    if (!buffers || buffers.depths.length !== pixelCount) {
        buffers = {
            depths: new Float32Array(pixelCount),
            owners: new Uint16Array(pixelCount),
        };
        sceneDepthBuffers.set(canvas, buffers);
    }
    buffers.depths.fill(Infinity);
    buffers.owners.fill(0xFFFF);
    return buffers;
}

/**
 * Rasterize the scene's triangle list into the target canvas' pixel buffer.
 * The canvas transform is applied to vertex positions explicitly because
 * putImageData intentionally ignores Canvas transforms. Text and particles
 * are rasterized against the same depth buffer. Returns false when pixel access
 * is unavailable, allowing the portable painter fallback to run.
 */
function rasterizeDepthBuffer(ctx, faces, logicalWidth, logicalHeight, depthOfField = null) {
    const canvas = ctx?.canvas;
    const pixelWidth = Number(canvas?.width) || 0, pixelHeight = Number(canvas?.height) || 0;
    // UHD 4K is 8,294,400 pixels. The previous two-megapixel guard forced
    // normal 4K exports onto the painter fallback, which loses per-pixel
    // occlusion for intersecting meshes, transparent textures, and particles.
    // Keep a finite ceiling for pathological/custom canvases while preserving
    // the full depth path through common 4K landscape and portrait sizes.
    if (!pixelWidth || !pixelHeight || pixelWidth * pixelHeight > 12_000_000 || typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return false;
    let imageData;
    try { imageData = ctx.getImageData(0, 0, pixelWidth, pixelHeight); }
    catch { return false; }

    const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : { a: pixelWidth / logicalWidth, b: 0, c: 0, d: pixelHeight / logicalHeight, e: 0, f: 0 };
    const screenFaces = [];
    const screenParticles = [];
    const texturePixels = new Map();
    try {
        for (const face of faces) {
            if (face.particle) {
                screenParticles.push({
                    ...face,
                    x: transform.a * face.point.x + transform.c * face.point.y + transform.e,
                    y: transform.b * face.point.x + transform.d * face.point.y + transform.f,
                    pixelRadius: face.radius * Math.max(Math.abs(transform.a), Math.abs(transform.d)),
                });
                continue;
            }
            if (!face.projected || face.projected.length !== 3) continue;
            const points = face.projected.map(point => ({
                x: transform.a * point.x + transform.c * point.y + transform.e,
                y: transform.b * point.x + transform.d * point.y + transform.f,
                z: point.z,
            }));
            let texture = null;
            if (face.image) {
                texture = texturePixels.get(face.image);
                if (!texture) texture = sceneImageTextureCache.get(face.image);
                if (!texture) {
                    const width = Number(face.image.naturalWidth || face.image.videoWidth || face.image.width) || 0;
                    const height = Number(face.image.naturalHeight || face.image.videoHeight || face.image.height) || 0;
                    if (!width || !height) return false;
                    let scratch;
                    if (typeof OffscreenCanvas !== 'undefined') scratch = new OffscreenCanvas(width, height);
                    else if (canvas.ownerDocument?.createElement) { scratch = canvas.ownerDocument.createElement('canvas'); scratch.width = width; scratch.height = height; }
                    else scratch = new canvas.constructor(width, height);
                    const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
                    scratchCtx.drawImage(face.image, 0, 0, width, height);
                    texture = { width, height, data: scratchCtx.getImageData(0, 0, width, height).data };
                    sceneImageTextureCache.set(face.image, texture);
                    texturePixels.set(face.image, texture);
                }
                if (texture) texturePixels.set(face.image, texture);
            }
            screenFaces.push({ ...face, points, texture });
        }
    } catch {
        return false;
    }

    // Scene order is bounded to 80 objects plus 500 particles, so a 16-bit
    // owner index is sufficient. The sentinel sorts after every valid owner
    // and halves this per-pixel buffer at 4K (16 MB saved).
    const { depths, owners } = depthBuffersFor(canvas, pixelWidth * pixelHeight);
    const rgba = face => {
        const match = String(face.color || '#7C3AED').match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        return match ? [Number(match[1]), Number(match[2]), Number(match[3]), 255] : [...parseHexColor(face.color), 255];
    };
    const strokeRgba = face => {
        const match = String(face.stroke || '').match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        return match ? [Number(match[1]), Number(match[2]), Number(match[3]), 255] : [...parseHexColor(face.stroke), 255];
    };
    const blendChannel = (mode, source, backdrop) => {
        switch (mode) {
            case 'multiply': return source * backdrop;
            case 'screen': return source + backdrop - source * backdrop;
            case 'overlay': return backdrop <= 0.5 ? 2 * source * backdrop : 1 - 2 * (1 - source) * (1 - backdrop);
            case 'darken': return Math.min(source, backdrop);
            case 'lighten': return Math.max(source, backdrop);
            case 'difference': return Math.abs(backdrop - source);
            case 'addition': return Math.min(1, source + backdrop);
            case 'color-dodge': return source >= 1 ? 1 : Math.min(1, backdrop / (1 - source));
            case 'color-burn': return source <= 0 ? 0 : 1 - Math.min(1, (1 - backdrop) / source);
            case 'hard-light': return source <= 0.5 ? 2 * source * backdrop : 1 - 2 * (1 - source) * (1 - backdrop);
            case 'soft-light': {
                const d = backdrop <= 0.25 ? ((16 * backdrop - 12) * backdrop + 4) * backdrop : Math.sqrt(backdrop);
                return source <= 0.5
                    ? backdrop - (1 - 2 * source) * backdrop * (1 - backdrop)
                    : backdrop + (2 * source - 1) * (d - backdrop);
            }
            case 'exclusion': return backdrop + source - 2 * backdrop * source;
            default: return source;
        }
    };
    // HSL blend modes operate on the RGB triplet, so evaluating them one
    // channel at a time (as the scalar blend modes do) produces incorrect
    // color and luminosity. These helpers implement the W3C non-separable
    // blend functions in linear channel space, matching the 2D compositor.
    const luminosity = color => 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
    const saturation = color => Math.max(...color) - Math.min(...color);
    const clipColor = color => {
        const lum = luminosity(color), min = Math.min(...color), max = Math.max(...color);
        let result = [...color];
        if (min < 0) result = result.map(channel => lum + ((channel - lum) * lum) / (lum - min || 1));
        if (max > 1) result = result.map(channel => lum + ((channel - lum) * (1 - lum)) / (max - lum || 1));
        return result.map(channel => clamp(channel, 0, 1));
    };
    const setLuminosity = (color, lum) => clipColor(color.map(channel => channel + lum - luminosity(color)));
    const setSaturation = (color, sat) => {
        const result = [...color];
        const [min, mid, max] = [0, 1, 2].sort((a, b) => color[a] - color[b]);
        if (color[max] > color[min]) {
            result[mid] = ((color[mid] - color[min]) * sat) / (color[max] - color[min]);
            result[max] = sat;
        } else {
            result[mid] = result[max] = 0;
        }
        result[min] = 0;
        return result;
    };
    const blendRgb = (mode, source, backdrop) => {
        switch (mode) {
            case 'hue': return setLuminosity(setSaturation(source, saturation(backdrop)), luminosity(backdrop));
            case 'saturation': return setLuminosity(setSaturation(backdrop, saturation(source)), luminosity(backdrop));
            case 'color': return setLuminosity(source, luminosity(backdrop));
            case 'luminosity': return setLuminosity(backdrop, luminosity(source));
            default: return source.map((channel, index) => blendChannel(mode, channel, backdrop[index]));
        }
    };
    const compositePixel = (data, offset, source, alpha, mode) => {
        const backdropAlpha = data[offset + 3] / 255;
        const outAlpha = alpha + backdropAlpha * (1 - alpha);
        const src = source.slice(0, 3).map(channel => channel / 255);
        const dst = [data[offset], data[offset + 1], data[offset + 2]].map(channel => channel / 255);
        const blended = blendRgb(mode, src, dst);
        for (let channel = 0; channel < 3; channel++) {
            const premultiplied = (1 - alpha) * backdropAlpha * dst[channel]
                + (1 - backdropAlpha) * alpha * src[channel]
                + backdropAlpha * alpha * blended[channel];
            data[offset + channel] = outAlpha > 0 ? Math.round(255 * premultiplied / outAlpha) : 0;
        }
        data[offset + 3] = Math.round(255 * outAlpha);
    };
    const maskAlpha = (shape, u, v, aspectRatio = 1, invert = false) => {
        if (!shape || shape === 'none') return 1;
        const aspect = clamp(n(aspectRatio, 1), 0.01, 100);
        const minSide = Math.min(aspect, 1);
        const x = Math.abs(u - 0.5) * aspect, y = Math.abs(v - 0.5);
        let distance;
        if (shape === 'circle') distance = (minSide / 2 - Math.hypot(x, y)) / minSide;
        else if (shape === 'ellipse') distance = 1 - Math.hypot((u - 0.5) * 2, (v - 0.5) * 2);
        else if (shape === 'rounded-rectangle' || shape === 'capsule') {
            const radius = minSide * (shape === 'capsule' ? 0.5 : 0.12);
            const qx = x - (aspect / 2 - radius), qy = y - (0.5 - radius);
            distance = (radius - Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - Math.min(Math.max(qx, qy), 0)) / minSide;
        } else if (shape === 'rectangle') distance = Math.min(0.5 - Math.abs(u - 0.5), 0.5 - Math.abs(v - 0.5));
        else if (['polygon', 'star', 'arrow'].includes(shape)) {
            const vertices = maskPolygon(shape);
            let inside = false, minDistance = Infinity;
            for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
                const [ax, ay] = vertices[previous], [bx, by] = vertices[index];
                const dx = bx - ax, dy = by - ay;
                const projection = clamp(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
                minDistance = Math.min(minDistance, Math.hypot(u - ax - dx * projection, v - ay - dy * projection));
                if ((ay > v) !== (by > v) && u < (dx * (v - ay)) / (dy || 1e-12) + ax) inside = !inside;
            }
            distance = (inside ? 1 : -1) * minDistance;
        } else return 1;
        const coverage = clamp((distance + 0.012) / 0.024, 0, 1);
        return invert ? 1 - coverage : coverage;
    };
    const raster = (face, depthPass, clipRect = null, fragmentPixels = null) => {
        const [a, b, c] = face.points;
        const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (Math.abs(area) < 1e-5) return;
        const minX = Math.max(0, clipRect?.x0 ?? 0, Math.floor(Math.min(a.x, b.x, c.x)));
        const maxX = Math.min(pixelWidth - 1, clipRect?.x1 ?? pixelWidth - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
        const minY = Math.max(0, clipRect?.y0 ?? 0, Math.floor(Math.min(a.y, b.y, c.y)));
        const maxY = Math.min(pixelHeight - 1, clipRect?.y1 ?? pixelHeight - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
        const base = face.texture ? null : rgba(face);
        const stroke = face.stroke ? strokeRgba(face) : null;
        const opacity = clamp(n(face.opacity, 1), 0, 1);
        const uv = face.uvs;
        const edgeWidth = face.wireframe ? clamp(n(face.wireframeWidth, 1.5), 0.5, 8) : 0;
        const edgeScaleA = face.wireframe && face.wireframeEdges?.[0]
            || face.shadow && face.shadowEdges?.[0]
            ? Math.abs(area) / Math.max(1e-6, Math.hypot(c.x - b.x, c.y - b.y)) : 0;
        const edgeScaleB = face.wireframe && face.wireframeEdges?.[1]
            || face.shadow && face.shadowEdges?.[1]
            ? Math.abs(area) / Math.max(1e-6, Math.hypot(a.x - c.x, a.y - c.y)) : 0;
        const edgeScaleC = face.wireframe && face.wireframeEdges?.[2]
            || face.shadow && face.shadowEdges?.[2]
            ? Math.abs(area) / Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y)) : 0;
        const shadowBlurPx = face.shadow
            ? Math.max(0, n(face.shadowBlur)) * Math.max(Math.abs(transform.a), Math.abs(transform.d))
            : 0;
        const isWireEdge = (wa, wb, wc) => {
            if (!face.wireframe) return true;
            let edgeDistance = Infinity;
            if (edgeScaleA) edgeDistance = Math.min(edgeDistance, Math.abs(wa) * edgeScaleA);
            if (edgeScaleB) edgeDistance = Math.min(edgeDistance, Math.abs(wb) * edgeScaleB);
            if (edgeScaleC) edgeDistance = Math.min(edgeDistance, Math.abs(wc) * edgeScaleC);
            return edgeDistance <= edgeWidth / 2;
        };
        const inverseArea = 1 / area;
        // A shared edge belongs to exactly one triangle. Allowing a small
        // negative barycentric tolerance on both triangles paints translucent
        // polygon seams twice, which is especially visible on textured planes.
        const topLeftEdge = (from, to) => {
            const a = area > 0 ? from : to;
            const b = area > 0 ? to : from;
            const dy = b.y - a.y, dx = b.x - a.x;
            return dy < 0 || (dy === 0 && dx > 0);
        };
        const edgeAInclusive = topLeftEdge(b, c);
        const edgeBInclusive = topLeftEdge(c, a);
        const edgeCInclusive = topLeftEdge(a, b);
        const insideEdge = (weight, inclusive) => weight > 1e-7 || (Math.abs(weight) <= 1e-7 && inclusive);
        const waStepX = (b.y - c.y) * inverseArea;
        const wbStepX = (c.y - a.y) * inverseArea;
        const waStepY = (c.x - b.x) * inverseArea;
        const wbStepY = (a.x - c.x) * inverseArea;
        const firstPx = minX + 0.5;
        const firstPy = minY + 0.5;
        let rowWa = ((b.x - firstPx) * (c.y - firstPy) - (b.y - firstPy) * (c.x - firstPx)) * inverseArea;
        let rowWb = ((c.x - firstPx) * (a.y - firstPy) - (c.y - firstPy) * (a.x - firstPx)) * inverseArea;
        for (let y = minY; y <= maxY; y++) {
            let wa = rowWa, wb = rowWb;
            for (let x = minX; x <= maxX; x++, wa += waStepX, wb += wbStepX) {
            const wc = 1 - wa - wb;
            if (!insideEdge(wa, edgeAInclusive) || !insideEdge(wb, edgeBInclusive)
                || !insideEdge(wc, edgeCInclusive)) continue;
            const reciprocalDepth = wa / a.z + wb / b.z + wc / c.z;
            if (reciprocalDepth <= 0) continue;
            const depth = 1 / reciprocalDepth;
            const pixel = y * pixelWidth + x;
            const u = uv ? ((wa * uv[0][0] / a.z) + (wb * uv[1][0] / b.z) + (wc * uv[2][0] / c.z)) / reciprocalDepth : 0;
            const v = uv ? ((wa * uv[0][1] / a.z) + (wb * uv[1][1] / b.z) + (wc * uv[2][1] / c.z)) / reciprocalDepth : 0;
            const mask = uv ? maskAlpha(face.maskShape, u, v, face.maskAspectRatio, face.maskInvert) : 1;
            if (mask <= 0) continue;
            if (depthPass) {
                // Blend-mode surfaces need the already-rendered backdrop to
                // compute their colour. Writing them into the opaque depth
                // pass would both hide that backdrop and make the blend mode
                // degenerate to source-over against transparent pixels.
                if (opacity < 0.999 || (face.blendMode && face.blendMode !== 'source-over')) continue;
                // Wireframe interiors are transparent, so they must not write
                // depth and hide geometry behind the empty part of the mesh.
                if (!isWireEdge(wa, wb, wc)) continue;
                let alpha = 255;
                if (face.texture) {
                    const tx = clamp(Math.floor(u * face.texture.width), 0, face.texture.width - 1);
                    const ty = clamp(Math.floor(v * face.texture.height), 0, face.texture.height - 1);
                    alpha = face.texture.data[(ty * face.texture.width + tx) * 4 + 3];
                }
                const nearer = depth < depths[pixel] - 1e-4;
                const sameDepthFrontmost = Math.abs(depth - depths[pixel]) <= 1e-4 && face.order >= owners[pixel];
                if (alpha * mask > 250 && (nearer || sameDepthFrontmost)) {
                    depths[pixel] = depth;
                    owners[pixel] = face.order;
                }
                continue;
            }
            if (depth > depths[pixel] + 1e-4) continue;
            if (Math.abs(depth - depths[pixel]) <= 1e-4 && face.order < owners[pixel]) continue;
            // Wireframe coverage and its depth ownership share the same edge
            // test, leaving the mesh interior transparent in both passes.
            if (!isWireEdge(wa, wb, wc)) continue;
            let source = base;
            if (face.texture) {
                const tx = clamp(Math.floor(u * face.texture.width), 0, face.texture.width - 1);
                const ty = clamp(Math.floor(v * face.texture.height), 0, face.texture.height - 1);
                const offset = (ty * face.texture.width + tx) * 4;
                source = [face.texture.data[offset], face.texture.data[offset + 1], face.texture.data[offset + 2], face.texture.data[offset + 3]];
                source = shadeTextureSample(source, face.textureLighting);
            }
            if (face.wireframe && stroke) source = stroke;
            let shadowCoverage = 1;
            if (face.shadow && shadowBlurPx > 0) {
                let edgeDistance = Infinity;
                if (face.shadowEdges?.[0]) edgeDistance = Math.min(edgeDistance, Math.abs(wa) * edgeScaleA);
                if (face.shadowEdges?.[1]) edgeDistance = Math.min(edgeDistance, Math.abs(wb) * edgeScaleB);
                if (face.shadowEdges?.[2]) edgeDistance = Math.min(edgeDistance, Math.abs(wc) * edgeScaleC);
                const t = clamp(edgeDistance / shadowBlurPx, 0, 1);
                shadowCoverage = t * t * (3 - 2 * t);
            }
            const alpha = opacity * mask * source[3] / 255 * shadowCoverage;
            if (alpha <= 0) continue;
            // The opaque colour pass establishes fully opaque texel colour;
            // partially transparent texels and antialiased mask edges are
            // composited later with the per-pixel transparent fragment list.
            // Painting them here as well would blend those pixels twice.
            if (!fragmentPixels && face.texture && alpha < 0.999) continue;
            if (fragmentPixels) {
                // Fully opaque samples already participated in the z-buffer
                // depth and colour passes. Textured planes share this path so
                // their partially transparent pixels are correctly sorted.
                if (opacity >= 0.999 && source[3] * mask > 250) continue;
                const tileWidth = clipRect.x1 - clipRect.x0 + 1;
                const fragmentIndex = (y - clipRect.y0) * tileWidth + (x - clipRect.x0);
                const pixelFragments = fragmentPixels.get(fragmentIndex) || [];
                pixelFragments.push({ depth, order: face.order, source, alpha, blendMode: face.blendMode });
                fragmentPixels.set(fragmentIndex, pixelFragments);
                continue;
            }
            compositePixel(imageData.data, pixel * 4, source, alpha, face.blendMode);
            }
            rowWa += waStepY;
            rowWb += wbStepY;
        }
    };
    for (const face of screenFaces) raster(face, true);
    const opaqueFaces = screenFaces.filter(face => clamp(n(face.opacity, 1), 0, 1) >= 0.999);
    for (const face of opaqueFaces) raster(face, false);

    // A single global face sort cannot correctly composite two slanted or
    // intersecting translucent surfaces: their depth order changes across the
    // frame. Sort the actual fragments at each pixel instead. Work tile by
    // tile so a 4K frame never allocates a full-frame fragment list.
    const transparentFaces = screenFaces.filter(face => clamp(n(face.opacity, 1), 0, 1) < 0.999
        || face.texture || (face.blendMode && face.blendMode !== 'source-over'));
    if (transparentFaces.length) {
        const tileSize = 64;
        for (let tileY = 0; tileY < pixelHeight; tileY += tileSize) {
            const y1 = Math.min(pixelHeight - 1, tileY + tileSize - 1);
            for (let tileX = 0; tileX < pixelWidth; tileX += tileSize) {
                const x1 = Math.min(pixelWidth - 1, tileX + tileSize - 1);
                const rect = { x0: tileX, y0: tileY, x1, y1 };
                const tileWidth = x1 - tileX + 1;
                const fragments = new Map();
                for (const face of transparentFaces) {
                    const [a, b, c] = face.points;
                    if (Math.max(a.x, b.x, c.x) < tileX || Math.min(a.x, b.x, c.x) > x1
                        || Math.max(a.y, b.y, c.y) < tileY || Math.min(a.y, b.y, c.y) > y1) continue;
                    raster(face, false, rect, fragments);
                }
                for (const [localPixel, fragmentsAtPixel] of fragments) {
                    fragmentsAtPixel.sort((a, b) => b.depth - a.depth || a.order - b.order);
                    const localY = Math.floor(localPixel / tileWidth), localX = localPixel % tileWidth;
                    const pixel = (tileY + localY) * pixelWidth + tileX + localX;
                    const offset = pixel * 4;
                    for (const fragment of fragmentsAtPixel) {
                        const opaqueDepth = depths[pixel];
                        if (fragment.depth > opaqueDepth + 1e-4) continue;
                        if (Math.abs(fragment.depth - opaqueDepth) <= 1e-4 && fragment.order < owners[pixel]) continue;
                        compositePixel(imageData.data, offset, fragment.source, fragment.alpha, fragment.blendMode);
                    }
                }
            }
        }
    }

    // 3D text is rasterized to a temporary surface, then depth-tested against
    // the same opaque depth buffer as mesh triangles. Drawing it afterward via
    // Canvas 2D alone made text ignore occluding geometry and always appear on
    // top of the scene, even when it was placed behind an object.
    const textFaces = faces.filter(face => face.text).sort((a, b) => b.z - a.z || a.order - b.order);
    if (textFaces.length) {
        const textCanvas = sceneSampleCanvas(canvas, pixelWidth, pixelHeight, 6);
        const textCtx = textCanvas?.getContext?.('2d', { willReadFrequently: true });
        if (textCtx) {
            for (const face of textFaces) {
                textCtx.setTransform(1, 0, 0, 1, 0, 0);
                textCtx.clearRect(0, 0, pixelWidth, pixelHeight);
                textCtx.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
                face.draw(textCtx);
                let textPixels;
                try { textPixels = textCtx.getImageData(0, 0, pixelWidth, pixelHeight).data; }
                catch { continue; }
                for (let pixel = 0; pixel < depths.length; pixel++) {
                    const sourceOffset = pixel * 4;
                    const sourceAlpha = textPixels[sourceOffset + 3] / 255;
                    if (sourceAlpha <= 0) continue;
                    const x = pixel % pixelWidth, y = Math.floor(pixel / pixelWidth);
                    const textDepth = face.depthAt(x + 0.5, y + 0.5);
                    const nearer = textDepth < depths[pixel] - 1e-4;
                    const sameDepthFrontmost = Math.abs(textDepth - depths[pixel]) <= 1e-4 && face.order >= owners[pixel];
                    if (!nearer && !sameDepthFrontmost) continue;

                    const targetOffset = sourceOffset;
                    compositePixel(imageData.data, targetOffset, textPixels.slice(sourceOffset, sourceOffset + 4), sourceAlpha, face.blendMode || 'source-over');
                    if (sourceAlpha > 0.98) {
                        depths[pixel] = textDepth;
                        owners[pixel] = face.order;
                    }
                }
            }
        }
    }
    // Particles are translucent point sprites. Test each covered pixel against
    // opaque geometry (and any opaque text already written to depth) so a
    // background particle cannot paint over a foreground mesh.
    for (const particle of screenParticles) {
        const radius = Math.max(0.5, particle.pixelRadius);
        const minX = Math.max(0, Math.floor(particle.x - radius));
        const maxX = Math.min(pixelWidth - 1, Math.ceil(particle.x + radius));
        const minY = Math.max(0, Math.floor(particle.y - radius));
        const maxY = Math.min(pixelHeight - 1, Math.ceil(particle.y + radius));
        const source = parseHexColor(particle.color);
        const alpha = clamp(n(particle.opacity, 1), 0, 1);
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
            const dx = x + 0.5 - particle.x, dy = y + 0.5 - particle.y;
            if (!particleContains(particle.shape, dx, dy, radius)) continue;
            const pixel = y * pixelWidth + x;
            if (particle.z > depths[pixel] + 1e-4) continue;
            const offset = pixel * 4;
            const backdropAlpha = imageData.data[offset + 3] / 255;
            const outAlpha = alpha + backdropAlpha * (1 - alpha);
            for (let channel = 0; channel < 3; channel++) {
                const premultiplied = source[channel] / 255 * alpha + imageData.data[offset + channel] / 255 * backdropAlpha * (1 - alpha);
                imageData.data[offset + channel] = outAlpha > 0 ? Math.round(255 * premultiplied / outAlpha) : 0;
            }
            imageData.data[offset + 3] = Math.round(255 * outAlpha);
        }
    }
    if (depthOfField?.enabled) {
        const focusDistance = Math.max(0.1, n(depthOfField.focusDistance, 7));
        const focusRange = clamp(n(depthOfField.focusRange, 0.35), 0, 100);
        const strength = clamp(n(depthOfField.strength, 1), 0, 2);
        const maxBlur = Math.round(clamp(n(depthOfField.maxBlur, 6), 0, 12));
        if (maxBlur > 0 && strength > 0) {
            const source = new Uint8ClampedArray(imageData.data);
            const offsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
            for (let y = 0; y < pixelHeight; y++) for (let x = 0; x < pixelWidth; x++) {
                const pixel = y * pixelWidth + x, depth = depths[pixel], offset = pixel * 4;
                if (!Number.isFinite(depth) || source[offset + 3] === 0) continue;
                const circleOfConfusion = Math.min(maxBlur, Math.max(0, Math.abs(depth - focusDistance) - focusRange) * strength * 1.5);
                const radius = Math.round(circleOfConfusion);
                if (!radius) continue;
                const depthTolerance = Math.max(0.025, depth * 0.002);
                let red = 0, green = 0, blue = 0, alpha = 0, samples = 0;
                for (const [dx, dy] of offsets) {
                    const sx = Math.max(0, Math.min(pixelWidth - 1, x + dx * radius));
                    const sy = Math.max(0, Math.min(pixelHeight - 1, y + dy * radius));
                    const samplePixel = sy * pixelWidth + sx, sampleDepth = depths[samplePixel];
                    // Keep sharp foreground edges from bleeding into a defocused
                    // background while allowing transparent pixels to soften a
                    // distant silhouette.
                    if (Number.isFinite(sampleDepth) && sampleDepth < depth - depthTolerance) continue;
                    const sampleOffset = samplePixel * 4, sampleAlpha = source[sampleOffset + 3] / 255;
                    red += source[sampleOffset] * sampleAlpha;
                    green += source[sampleOffset + 1] * sampleAlpha;
                    blue += source[sampleOffset + 2] * sampleAlpha;
                    alpha += source[sampleOffset + 3];
                    samples++;
                }
                if (samples < 2) continue;
                imageData.data[offset + 3] = Math.round(alpha / samples);
                const outAlpha = imageData.data[offset + 3] / 255;
                imageData.data[offset] = outAlpha ? Math.round(red / samples / outAlpha) : 0;
                imageData.data[offset + 1] = outAlpha ? Math.round(green / samples / outAlpha) : 0;
                imageData.data[offset + 2] = outAlpha ? Math.round(blue / samples / outAlpha) : 0;
            }
        }
    }
    try { ctx.putImageData(imageData, 0, 0); }
    catch { return false; }
    return true;
}

function cameraPoint(p, camera) {
    return rotate(V(p.x - camera.x, p.y - camera.y, camera.z - p.z), { x: -rad(camera.pitch), y: -rad(camera.yaw), z: -rad(camera.roll) });
}

// Sutherland-Hodgman clipping keeps geometry between the camera's near and
// far planes before projection, preventing giant triangles and giving the
// scene an explicit, predictable depth range.
function clipDepthPlane(points, depth, keepGreater) {
    const clipped = [];
    for (let i = 0; i < points.length; i++) {
        const current = points[i], previous = points[(i + points.length - 1) % points.length];
        const currentInside = keepGreater ? current.z >= depth : current.z <= depth;
        const previousInside = keepGreater ? previous.z >= depth : previous.z <= depth;
        if (currentInside !== previousInside) {
            const amount = (depth - previous.z) / (current.z - previous.z);
            const intersection = V(previous.x + (current.x - previous.x) * amount, previous.y + (current.y - previous.y) * amount, depth);
            if (previous.uv && current.uv) {
                intersection.uv = [
                    previous.uv[0] + (current.uv[0] - previous.uv[0]) * amount,
                    previous.uv[1] + (current.uv[1] - previous.uv[1]) * amount,
                ];
            }
            clipped.push(intersection);
        }
        if (currentInside) clipped.push(current);
    }
    return clipped;
}

function clipCameraDepth(points, near, far) {
    return clipDepthPlane(clipDepthPlane(points, near, true), far, false);
}

function projectCameraPoint(q, camera, width, height) {
    const focal = Math.max(1, n(camera.fov, 50));
    const scale = camera.projection === 'orthographic'
        ? Math.max(1, n(camera.orthoScale, 180))
        : focal / Math.max(0.05, q.z);
    return { x: width / 2 + q.x * scale, y: height / 2 - q.y * scale, z: q.z, scale };
}

function project(p, camera, width, height) {
    const q = cameraPoint(p, camera);
    return projectCameraPoint(q, camera, width, height);
}

/** Re-export the shared normalized waveform sampler for existing consumers. */
export { sampleAudioEnvelope };

/** Validate and repair object parenting without mutating the authored scene.
 * Missing parents and cyclic edges are detached to the scene root so preview
 * and export stay deterministic instead of inventing partial transforms.
 */
export function normalizeScene3D(scene = {}) {
    const authored = Array.isArray(scene.objects) ? scene.objects : [];
    const objects = authored.map(object => object && typeof object === 'object' ? { ...object } : object);
    const issues = [];
    const firstById = new Map();
    const usedIds = new Set();
    for (let i = 0; i < objects.length; i++) {
        const object = objects[i];
        if (!object || typeof object !== 'object') {
            issues.push(`object ${i}: expected an object`);
            continue;
        }
        const authoredId = typeof object.id === 'string' ? object.id.trim() : '';
        if (!authoredId) {
            let generatedId = `scene-object-${i + 1}`;
            let suffix = 2;
            while (usedIds.has(generatedId)) generatedId = `scene-object-${i + 1}-${suffix++}`;
            object.id = generatedId;
            usedIds.add(generatedId);
            firstById.set(generatedId, object);
            issues.push(`object ${i}: missing id; assigned "${generatedId}"`);
            continue;
        }
        if (usedIds.has(authoredId)) {
            let uniqueId = `${authoredId}-duplicate-${i + 1}`;
            let suffix = 2;
            while (usedIds.has(uniqueId)) uniqueId = `${authoredId}-duplicate-${i + 1}-${suffix++}`;
            object.id = uniqueId;
            usedIds.add(uniqueId);
            issues.push(`object "${authoredId}": duplicate id; renamed to "${uniqueId}"; parent references resolve to the first object`);
        } else {
            object.id = authoredId;
            usedIds.add(authoredId);
            firstById.set(authoredId, object);
        }
    }
    for (const object of objects) {
        if (!object?.parentId) continue;
        if (!firstById.has(object.parentId)) {
            issues.push(`object "${object.id || '?'}": missing parent "${object.parentId}"; detached to scene root`);
            delete object.parentId;
        }
    }
    const visited = new Set();
    for (const object of objects) {
        if (!object?.id || visited.has(object.id)) continue;
        const path = new Map();
        const chain = [];
        let cursor = object;
        while (cursor?.id && !visited.has(cursor.id)) {
            if (path.has(cursor.id)) {
                // `path` stores numeric traversal offsets; detach the actual
                // last object in this cycle so the persisted scene is safe to
                // traverse after normalization, not merely protected by the
                // transform resolver's recursion guard.
                const detached = chain.at(-1);
                issues.push(`object "${detached.id}": cyclic parent chain; detached to scene root`);
                delete detached.parentId;
                break;
            }
            path.set(cursor.id, chain.length);
            chain.push(cursor);
            cursor = cursor.parentId ? firstById.get(cursor.parentId) : null;
        }
        for (const id of path.keys()) visited.add(id);
    }
    for (const object of objects) {
        if (!object?.parentId) continue;
        let cursor = object;
        let depth = 0;
        while (cursor?.parentId && depth <= MAX_SCENE_OBJECT_PARENT_DEPTH) {
            cursor = firstById.get(cursor.parentId);
            depth++;
        }
        if (depth > MAX_SCENE_OBJECT_PARENT_DEPTH) {
            issues.push(`object "${object.id || '?'}": parent chain exceeds ${MAX_SCENE_OBJECT_PARENT_DEPTH} levels; detached to scene root`);
            delete object.parentId;
        }
    }
    return { scene: { ...scene, objects }, issues };
}

/** Sample a scene animation on the same bounded local clock as MotionResolver. */
function sampleSceneAnimation(animation, localTime) {
    const inferredDuration = Math.max(0, ...(Array.isArray(animation?.keyframes)
        ? animation.keyframes.map(keyframe => n(keyframe?.time, 0)) : [0]));
    const duration = animation?.duration == null || animation.duration === ''
        ? inferredDuration : Math.max(0, n(animation.duration));
    return sampleAnimation(animation, clamp(n(localTime), 0, duration));
}

function resolveObjectTransform(object, time, duration, byId, audioWaveformsByAsset = {}, seen = new Set()) {
    const id = object?.id;
    if (!object || (id && seen.has(id)) || seen.size > MAX_SCENE_OBJECT_PARENT_DEPTH) return { position: V(), rotation: V(), scale: V(1, 1, 1), matrix: IDENTITY_3, opacity: 1 };
    if (id) seen.add(id);
    const parent = object.parentId ? byId.get(object.parentId) : null;
    const outer = parent ? resolveObjectTransform(parent, time, duration, byId, audioWaveformsByAsset, seen) : { position: V(), rotation: V(), scale: V(1, 1, 1), matrix: IDENTITY_3, opacity: 1 };
    const position = object.position || {};
    const rotation = object.rotation || {};
    const auto = object.autoRotate || {};
    // Time remapping stays deterministic in preview and export. `offset` is
    // seconds in source time; loop and ping-pong remap into the composition
    // duration while clamp holds on the first/last frame.
    const localTime = remapSceneObjectTime(object.timeRemap, time, duration);
    const phase = duration > 0 ? localTime / duration : 0;
    const animated = {};
    for (const animation of Array.isArray(object.animations) ? object.animations : []) {
        const start = Math.max(0, n(animation?.startTime));
        if (localTime < start) continue;
        const values = sampleSceneAnimation(animation, localTime - start);
        for (const [key, value] of Object.entries(values)) {
            if (!Number.isFinite(Number(value))) continue;
            const contribution = Number(value);
            if (SCENE3D_MULTIPLICATIVE_ANIMATION_PROPERTIES.has(key)) {
                animated[key] = (key in animated ? animated[key] : 1) * contribution;
            } else if (SCENE3D_COLOR_CHANNEL_PROPERTIES.has(key)) {
                // RGB channels are absolute 0–255 values, unlike transform
                // tracks whose values compose as offsets across animations.
                animated[key] = contribution;
            } else {
                animated[key] = (key in animated ? animated[key] : 0) + contribution;
            }
        }
    }
    const authoredSize = object.size || {};
    const geometryBase = {
        radius: n(object.radius, object.type === 'torus' ? 0.8 : 0.65),
        height: n(object.height, 1.5),
        tube: n(object.tube, 0.2),
        sizeX: n(authoredSize.x, 1),
        sizeY: n(authoredSize.y, 1),
        sizeZ: n(authoredSize.z, 1),
    };
    const objectExpressionBase = {
        x: n(position.x), y: n(position.y), z: n(position.z),
        scale: 1, scaleX: 1, scaleY: 1, scaleZ: 1,
        rotationX: n(rotation.x), rotationY: n(rotation.y), rotationZ: n(rotation.z),
        opacity: n(object.opacity, 1),
        roughness: clamp(n(object.material?.roughness, 0.62), 0.04, 1),
        metalness: clamp(n(object.material?.metalness, 0.08), 0, 1),
        emissiveIntensity: clamp(n(object.material?.emissiveIntensity, 0), 0, 10),
        ...Object.fromEntries(['R', 'G', 'B'].map((channel, index) => [
            `color${channel}`, parseHexColor(object.color || object.material?.color || '#7C3AED')[index],
        ])),
        ...Object.fromEntries(['R', 'G', 'B'].map((channel, index) => [
            `emissive${channel}`, parseHexColor(object.material?.emissiveColor || object.material?.emissive || '#000000')[index],
        ])),
        ...geometryBase,
    };
    for (const [property, expression] of Object.entries(object.expressions || {})) {
        if (!['x', 'y', 'z', 'scale', 'scaleX', 'scaleY', 'scaleZ', 'rotationX', 'rotationY', 'rotationZ', 'opacity', 'roughness', 'metalness', 'emissiveIntensity', 'colorR', 'colorG', 'colorB', 'emissiveR', 'emissiveG', 'emissiveB', 'radius', 'height', 'tube', 'sizeX', 'sizeY', 'sizeZ'].includes(property)) continue;
        const current = property in objectExpressionBase
            ? objectExpressionBase[property] + (property in animated ? n(animated[property]) : 0)
            : n(animated[property], objectExpressionBase[property]);
        const value = evaluateMotionExpression(expression, {
            t: localTime, time: localTime, duration, progress: duration > 0 ? localTime / duration : 0,
            value: current,
        });
        if (value !== null) animated[property] = SCENE3D_COLOR_CHANNEL_PROPERTIES.has(property) ? value
            : ['roughness', 'metalness', 'emissiveIntensity', 'radius', 'height', 'tube', 'sizeX', 'sizeY', 'sizeZ'].includes(property)
            ? value - objectExpressionBase[property] : value;
    }
    const reactive = object.audioReactive || {};
    const waveform = audioWaveformsByAsset?.[reactive.assetId];
    const envelope = sampleAudioEnvelope(waveform?.peaks || waveform, localTime, waveform?.duration || duration);
    const amount = clamp(n(reactive.amount, 0), -10, 10) * envelope;
    const target = reactive.target;
    const r = V(n(rotation.x) + n(animated.rotationX) + n(auto.x) * phase + (target === 'rotationX' ? amount : 0), n(rotation.y) + n(animated.rotationY) + n(auto.y) * phase + (target === 'rotationY' ? amount : 0), n(rotation.z) + n(animated.rotation) + n(animated.rotationZ) + n(auto.z) * phase + (target === 'rotationZ' ? amount : 0));
    const scale = object.scale || {};
    const localPosition = V(n(animated.x, n(position.x)) + (target === 'positionX' ? amount : 0),
        n(animated.y, n(position.y)) + (target === 'positionY' ? amount : 0),
        n(animated.z, n(position.z)) + (target === 'positionZ' ? amount : 0));
    const reactiveScale = target === 'scale' ? Math.max(0.01, 1 + amount) : 1;
    const reactiveGeometry = {};
    if (['radius', 'height', 'tube', 'sizeX', 'sizeY', 'sizeZ'].includes(target)) {
        reactiveGeometry[target] = amount;
    }
    const localScale = V(
        n(scale.x, 1) * n(animated.scale, 1) * n(animated.scaleX, 1) * reactiveScale,
        n(scale.y, 1) * n(animated.scale, 1) * n(animated.scaleY, 1) * reactiveScale,
        n(scale.z, 1) * n(animated.scale, 1) * n(animated.scaleZ, 1) * reactiveScale,
    );
    const composed = composeSceneTransform(outer, localPosition, r, localScale);
    const animatedMaterial = {
        ...(object.material || {}),
        ...Object.fromEntries([...SCENE3D_COLOR_CHANNEL_PROPERTIES]
            .filter(property => Number.isFinite(animated[property]))
            .map(property => [property, animated[property]])),
        emissiveColor: colorFromChannels(object.material?.emissiveColor || object.material?.emissive || '#000000', animated, 'emissive'),
        roughness: clamp(objectExpressionBase.roughness + n(animated.roughness), 0.04, 1),
        metalness: clamp(objectExpressionBase.metalness + n(animated.metalness), 0, 1),
        emissiveIntensity: clamp(objectExpressionBase.emissiveIntensity + n(animated.emissiveIntensity), 0, 10),
    };
    const geometry = {
        radius: clamp(geometryBase.radius + n(animated.radius) + n(reactiveGeometry.radius), 0.02, 10),
        height: clamp(geometryBase.height + n(animated.height) + n(reactiveGeometry.height), 0.02, 20),
        tube: clamp(geometryBase.tube + n(animated.tube) + n(reactiveGeometry.tube), 0.01, 3),
        size: {
            x: clamp(geometryBase.sizeX + n(animated.sizeX) + n(reactiveGeometry.sizeX), 0, 1000),
            y: clamp(geometryBase.sizeY + n(animated.sizeY) + n(reactiveGeometry.sizeY), 0, 1000),
            z: clamp(geometryBase.sizeZ + n(animated.sizeZ) + n(reactiveGeometry.sizeZ), 0, 1000),
        },
    };
    return {
        ...composed,
        material: animatedMaterial,
        geometry,
        opacity: outer.opacity * clamp(n(object.opacity, 1) * n(animated.opacity, 1) + (target === 'opacity' ? amount : 0), 0, 1),
    };
}

function worldVertex(vertex, objectTransform) {
    if (Array.isArray(objectTransform.matrix) && objectTransform.matrix.length === 9) {
        return add(transformSceneVector(vertex, objectTransform.matrix), objectTransform.position);
    }
    const r = { x: rad(objectTransform.rotation.x), y: rad(objectTransform.rotation.y), z: rad(objectTransform.rotation.z) };
    const scaled = V(vertex.x * objectTransform.scale.x, vertex.y * objectTransform.scale.y, vertex.z * objectTransform.scale.z);
    return add(rotate(scaled, r), objectTransform.position);
}

function rgbaAlpha(color, alpha) {
    const rgb = String(color).match(/^rgb\((\d+),(\d+),(\d+)\)$/);
    return rgb ? `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${clamp(alpha, 0, 1)})` : color;
}

function convexHull(points) {
    // Callers project points into a 2D plane, which may use either X/Y or
    // X/Z coordinates. Resolve the second axis once so the hull stays valid
    // for vertical, horizontal, and arbitrarily oriented shadow receivers.
    const ordinate = point => Number.isFinite(Number(point?.y)) ? Number(point.y) : Number(point?.z);
    const sorted = [...points].sort((a, b) => a.x - b.x || ordinate(a) - ordinate(b));
    if (sorted.length < 3) return sorted;
    const turn = (o, a, b) => (a.x - o.x) * (ordinate(b) - ordinate(o)) - (ordinate(a) - ordinate(o)) * (b.x - o.x);
    const lower = [], upper = [];
    for (const point of sorted) {
        while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
        lower.push(point);
    }
    for (let i = sorted.length - 1; i >= 0; i--) {
        const point = sorted[i];
        while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
        upper.push(point);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
}

function clipPolygonToConvexPolygon(subject, boundary) {
    if (!Array.isArray(subject) || subject.length < 3 || !Array.isArray(boundary) || boundary.length < 3) return [];
    const area = boundary.reduce((sum, point, index) => {
        const next = boundary[(index + 1) % boundary.length];
        return sum + point.x * next.y - next.x * point.y;
    }, 0);
    const orientation = area >= 0 ? 1 : -1;
    let output = subject;
    for (let edge = 0; edge < boundary.length && output.length; edge++) {
        const a = boundary[edge], b = boundary[(edge + 1) % boundary.length];
        const signedDistance = point => orientation * ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x));
        const input = output;
        output = [];
        let previous = input[input.length - 1];
        let previousDistance = signedDistance(previous);
        for (const current of input) {
            const currentDistance = signedDistance(current);
            const previousInside = previousDistance >= -1e-8;
            const currentInside = currentDistance >= -1e-8;
            if (previousInside !== currentInside) {
                const amount = previousDistance / (previousDistance - currentDistance);
                output.push({
                    x: previous.x + (current.x - previous.x) * amount,
                    y: previous.y + (current.y - previous.y) * amount,
                    point: V(
                        previous.point.x + (current.point.x - previous.point.x) * amount,
                        previous.point.y + (current.point.y - previous.point.y) * amount,
                        previous.point.z + (current.point.z - previous.point.z) * amount,
                    ),
                });
            }
            if (currentInside) output.push(current);
            previous = current;
            previousDistance = currentDistance;
        }
    }
    return output;
}

/** Find projected mesh silhouette loops for a point/directional light. */
function meshLightSilhouetteLoops(mesh, worldVertices, lightPosition) {
    if (!mesh?.faces?.length || !worldVertices?.length) return null;
    const faceFacing = [];
    const edgeFaces = new Map();
    for (let faceIndex = 0; faceIndex < mesh.faces.length; faceIndex++) {
        const indices = mesh.faces[faceIndex];
        if (!Array.isArray(indices) || indices.length < 3) continue;
        let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < indices.length; i++) {
            const current = worldVertices[indices[i]], next = worldVertices[indices[(i + 1) % indices.length]];
            if (!current || !next) return null;
            nx += (current.y - next.y) * (current.z + next.z);
            ny += (current.z - next.z) * (current.x + next.x);
            nz += (current.x - next.x) * (current.y + next.y);
            cx += current.x; cy += current.y; cz += current.z;
        }
        const normal = norm(V(nx, ny, nz));
        const center = V(cx / indices.length, cy / indices.length, cz / indices.length);
        const facing = dot(normal, norm(sub(lightPosition, center))) > 1e-7;
        faceFacing[faceIndex] = facing;
        for (let i = 0; i < indices.length; i++) {
            const a = indices[i], b = indices[(i + 1) % indices.length];
            if (a === b) continue;
            const key = a < b ? `${a}:${b}` : `${b}:${a}`;
            const attached = edgeFaces.get(key) || [];
            attached.push({ a, b, faceIndex });
            edgeFaces.set(key, attached);
        }
    }

    const silhouetteEdges = [];
    for (const attached of edgeFaces.values()) {
        if (attached.length > 2) return null;
        const isSilhouette = attached.length === 1
            || (attached.length === 2 && faceFacing[attached[0].faceIndex] !== faceFacing[attached[1].faceIndex]);
        if (isSilhouette) silhouetteEdges.push([attached[0].a, attached[0].b]);
    }
    if (!silhouetteEdges.length) return null;

    const edgesByVertex = new Map();
    silhouetteEdges.forEach(([a, b], edgeIndex) => {
        for (const vertex of [a, b]) {
            const attached = edgesByVertex.get(vertex) || [];
            attached.push(edgeIndex);
            edgesByVertex.set(vertex, attached);
        }
    });
    // A simple closed silhouette has exactly two boundary edges per vertex.
    // Non-manifold/open topology falls back to the bounded convex silhouette.
    if ([...edgesByVertex.values()].some(edges => edges.length !== 2)) return null;

    const used = new Set();
    const loops = [];
    for (let edgeIndex = 0; edgeIndex < silhouetteEdges.length; edgeIndex++) {
        if (used.has(edgeIndex)) continue;
        const [start] = silhouetteEdges[edgeIndex];
        const loop = [start];
        let current = start, previousEdge = -1, guard = silhouetteEdges.length + 1;
        while (guard-- > 0) {
            const nextEdge = edgesByVertex.get(current).find(candidate => candidate !== previousEdge && !used.has(candidate));
            if (nextEdge === undefined) return null;
            used.add(nextEdge);
            const [a, b] = silhouetteEdges[nextEdge];
            const next = a === current ? b : a;
            if (next === start) break;
            loop.push(next);
            previousEdge = nextEdge;
            current = next;
        }
        if (loop.length < 3 || used.size > silhouetteEdges.length) return null;
        loops.push(loop);
    }
    return loops.length ? loops : null;
}

/** Triangulate a simple planar polygon while preserving its concave outline. */
function triangulateFace(indices, vertices) {
    if (indices.length <= 3) return [indices];
    const points = indices.map(index => vertices[index]);
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < points.length; i++) {
        const current = points[i], next = points[(i + 1) % points.length];
        nx += (current.y - next.y) * (current.z + next.z);
        ny += (current.z - next.z) * (current.x + next.x);
        nz += (current.x - next.x) * (current.y + next.y);
    }
    const axis = Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz) ? 'x'
        : Math.abs(ny) >= Math.abs(nz) ? 'y' : 'z';
    const projected = points.map(point => axis === 'x' ? [point.y, point.z]
        : axis === 'y' ? [point.x, point.z] : [point.x, point.y]);
    const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    let signedArea = 0;
    for (let i = 0; i < projected.length; i++) {
        const a = projected[i], b = projected[(i + 1) % projected.length];
        signedArea += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(signedArea) < 1e-9) return [];
    const orientation = Math.sign(signedArea);
    const pointInTriangle = (point, a, b, c) => {
        const ab = cross2(a, b, point) * orientation;
        const bc = cross2(b, c, point) * orientation;
        const ca = cross2(c, a, point) * orientation;
        return ab >= -1e-9 && bc >= -1e-9 && ca >= -1e-9;
    };
    const remaining = indices.map((_, index) => index);
    // Drop redundant collinear points before clipping ears. Exported CAD/SVG
    // meshes often retain these along otherwise straight polygon edges.
    let changed = true;
    while (changed && remaining.length > 3) {
        changed = false;
        for (let i = 0; i < remaining.length; i++) {
            const previous = remaining[(i + remaining.length - 1) % remaining.length];
            const current = remaining[i];
            const next = remaining[(i + 1) % remaining.length];
            if (Math.abs(cross2(projected[previous], projected[current], projected[next])) <= 1e-9) {
                remaining.splice(i, 1);
                changed = true;
                break;
            }
        }
    }
    const triangles = [];
    let attempts = remaining.length * remaining.length;
    while (remaining.length > 3 && attempts-- > 0) {
        let clipped = false;
        for (let i = 0; i < remaining.length; i++) {
            const previous = remaining[(i + remaining.length - 1) % remaining.length];
            const current = remaining[i];
            const next = remaining[(i + 1) % remaining.length];
            const a = projected[previous], b = projected[current], c = projected[next];
            if (cross2(a, b, c) * orientation <= 1e-9) continue;
            if (remaining.some(candidate => candidate !== previous && candidate !== current && candidate !== next
                && pointInTriangle(projected[candidate], a, b, c))) continue;
            triangles.push([indices[previous], indices[current], indices[next]]);
            remaining.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped) return [];
    }
    if (remaining.length === 3) triangles.push(remaining.map(index => indices[index]));
    return triangles;
}

/** Draw a serializable 3D scene into a 2D canvas context. */
function drawScene3DSample(ctx, scene = {}, time = 0, duration = 1, width = 1080, height = 760, images = {}) {
    if (!ctx) return;
    // Export supplies a time-indexed provider for video textures so shutter
    // samples see the corresponding source frame, not one frozen frame per
    // output tick. Static preview image dictionaries remain fully supported.
    images = typeof images === 'function' ? (images(time) || {}) : (images || {});
    scene = normalizeScene3D(scene).scene;
    const cameraConfig = scene.camera || {};
    const animatedCamera = { ...cameraConfig };
    for (const animation of Array.isArray(cameraConfig.animations) ? cameraConfig.animations : []) {
        const start = Math.max(0, n(animation?.startTime));
        if (time < start) continue;
        Object.assign(animatedCamera, sampleSceneAnimation(animation, time - start));
    }
    const lookAt = cameraConfig.lookAt;
    const hasLookAt = lookAt && [lookAt.x, lookAt.y, lookAt.z].every(value => Number.isFinite(Number(value)));
    const derivedLookAtAngle = property => {
        if (!hasLookAt || !['yaw', 'pitch'].includes(property)) return undefined;
        const cameraX = n(animatedCamera.x, SCENE3D_CAMERA_DEFAULTS.x);
        const cameraY = n(animatedCamera.y, SCENE3D_CAMERA_DEFAULTS.y);
        const cameraZ = Math.max(0.1, n(animatedCamera.z, SCENE3D_CAMERA_DEFAULTS.z));
        const targetX = n(animatedCamera.targetX, n(lookAt.x));
        const targetY = n(animatedCamera.targetY, n(lookAt.y));
        const targetZ = n(animatedCamera.targetZ, n(lookAt.z));
        const dx = targetX - cameraX, dy = targetY - cameraY, dz = cameraZ - targetZ;
        const horizontalDistance = Math.hypot(dx, dz);
        return property === 'yaw'
            ? Math.atan2(dx, dz) * 180 / Math.PI
            : -Math.atan2(dy, horizontalDistance) * 180 / Math.PI;
    };
    // Camera properties use the same safe procedural expression evaluator as
    // scene objects, so expressions survive identically in preview and export.
    for (const [property, expression] of Object.entries(cameraConfig.expressions || {})) {
        if (!['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'fov', 'orthoScale', 'near', 'far', 'targetX', 'targetY', 'targetZ',
            'dofFocusDistance', 'dofFocusRange', 'dofStrength', 'dofMaxBlur'].includes(property)) continue;
        const targetAxis = property.startsWith('target') ? property.slice(-1).toLowerCase() : null;
        const dofBase = cameraConfig.depthOfField || scene.depthOfField || {};
        const dofProperty = ({ dofFocusDistance: 'focusDistance', dofFocusRange: 'focusRange', dofStrength: 'strength', dofMaxBlur: 'maxBlur' })[property];
        const baseValue = dofProperty
            ? n(dofBase[dofProperty], property === 'dofFocusDistance' ? n(cameraConfig.z, SCENE3D_CAMERA_DEFAULTS.z) : ({ focusRange: 0.35, strength: 1, maxBlur: 6 })[dofProperty])
            : targetAxis && Number.isFinite(Number(lookAt?.[targetAxis]))
            ? Number(lookAt[targetAxis])
            : n(cameraConfig[property], derivedLookAtAngle(property) ?? SCENE3D_CAMERA_DEFAULTS[property]);
        const value = evaluateMotionExpression(expression, {
            t: time,
            time,
            duration,
            progress: duration > 0 ? time / duration : 0,
            value: n(animatedCamera[property], baseValue),
        });
        if (value !== null) animatedCamera[property] = value;
    }
    // A camera can be authored with a world-space look-at point instead of
    // requiring users and generated scenes to calculate yaw/pitch by hand.
    // Explicit rotations remain authoritative, so existing scenes keep their
    // authored camera direction. Flat targetX/Y/Z animation and expressions
    // are supported alongside a static `lookAt` vector.
    // Check the resolved values, not merely whether a future animation track
    // exists. Before an animation's start time, its absent property should let
    // look-at determine the camera orientation until the track becomes active.
    const hasYaw = Number.isFinite(Number(animatedCamera.yaw));
    const hasPitch = Number.isFinite(Number(animatedCamera.pitch));
    if (hasLookAt && (!hasYaw || !hasPitch)) {
        const cameraX = n(animatedCamera.x, SCENE3D_CAMERA_DEFAULTS.x), cameraY = n(animatedCamera.y, SCENE3D_CAMERA_DEFAULTS.y), cameraZ = Math.max(0.1, n(animatedCamera.z, SCENE3D_CAMERA_DEFAULTS.z));
        const targetX = n(animatedCamera.targetX, n(lookAt.x)), targetY = n(animatedCamera.targetY, n(lookAt.y)), targetZ = n(animatedCamera.targetZ, n(lookAt.z));
        const dx = targetX - cameraX, dy = targetY - cameraY, dz = cameraZ - targetZ;
        const horizontalDistance = Math.hypot(dx, dz);
        if (!hasYaw) animatedCamera.yaw = Math.atan2(dx, dz) * 180 / Math.PI;
        if (!hasPitch) animatedCamera.pitch = -Math.atan2(dy, horizontalDistance) * 180 / Math.PI;
    }
    const near = clamp(n(animatedCamera.near, SCENE3D_CAMERA_DEFAULTS.near), 0.01, 100);
    const far = Math.max(near + 0.01, clamp(n(animatedCamera.far, SCENE3D_CAMERA_DEFAULTS.far), 0.02, 100000));
    const cameraZ = Math.max(0.1, n(animatedCamera.z, SCENE3D_CAMERA_DEFAULTS.z));
    const authoredDepthOfField = animatedCamera.depthOfField || scene.depthOfField;
    const depthOfField = authoredDepthOfField && typeof authoredDepthOfField === 'object'
        ? { ...authoredDepthOfField,
            focusDistance: Math.max(0.1, n(animatedCamera.dofFocusDistance, n(authoredDepthOfField.focusDistance, cameraZ))),
            focusRange: Math.max(0, n(animatedCamera.dofFocusRange, n(authoredDepthOfField.focusRange, 0.35))),
            strength: clamp(n(animatedCamera.dofStrength, n(authoredDepthOfField.strength, 1)), 0, 2),
            maxBlur: clamp(n(animatedCamera.dofMaxBlur, n(authoredDepthOfField.maxBlur, 6)), 0, 12),
        }
        : null;
    const camera = {
        x: n(animatedCamera.x, SCENE3D_CAMERA_DEFAULTS.x), y: n(animatedCamera.y, SCENE3D_CAMERA_DEFAULTS.y), z: cameraZ,
        yaw: n(animatedCamera.yaw, SCENE3D_CAMERA_DEFAULTS.yaw), pitch: n(animatedCamera.pitch, SCENE3D_CAMERA_DEFAULTS.pitch), roll: n(animatedCamera.roll, SCENE3D_CAMERA_DEFAULTS.roll),
        fov: clamp(n(animatedCamera.fov, SCENE3D_CAMERA_DEFAULTS.fov), 80, 2400), near, far,
        projection: animatedCamera.projection === 'orthographic' ? 'orthographic' : 'perspective',
        orthoScale: clamp(n(animatedCamera.orthoScale, SCENE3D_CAMERA_DEFAULTS.orthoScale), 10, 2400), depthOfField,
    };
    const lights = (Array.isArray(scene.lights) ? scene.lights : []).slice(0, MAX_SCENE_LIGHTS).map(light => {
        const animated = { ...light, position: { ...(light?.position || {}) }, direction: { ...(light?.direction || {}) }, target: { ...(light?.target || {}) } };
        for (const animation of Array.isArray(light?.animations) ? light.animations : []) {
            const start = Math.max(0, n(animation?.startTime));
            if (time < start) continue;
            Object.assign(animated, sampleSceneAnimation(animation, time - start));
        }
        // Procedural light motion uses the same sandboxed expression language
        // as cameras and objects. Expressions are evaluated after keyframes,
        // so an explicitly authored expression is the final driver for that
        // channel, while unconfigured channels retain their keyframed values.
        for (const [property, expression] of Object.entries(light?.expressions || {})) {
            if (!['intensity', 'range', 'decay', 'angle', 'width', 'height', 'positionX', 'positionY', 'positionZ',
                'directionX', 'directionY', 'directionZ', 'targetX', 'targetY', 'targetZ', 'colorR', 'colorG', 'colorB'].includes(property)) continue;
            const axis = property.endsWith('X') ? 'x' : property.endsWith('Y') ? 'y' : property.endsWith('Z') ? 'z' : null;
            const nested = property.startsWith('position') ? animated.position
                : property.startsWith('direction') ? animated.direction
                    : property.startsWith('target') ? animated.target : null;
            const fallback = property === 'intensity' ? 0.8
                : property === 'range' ? 24
                    : property === 'decay' ? 0.3
                        : property === 'angle' ? 60
                        : property === 'width' || property === 'height' ? 4
                            : axis ? n(nested?.[axis]) : 0;
            const value = evaluateMotionExpression(expression, {
                t: time, time, duration, progress: duration > 0 ? time / duration : 0,
                value: property.startsWith('color') ? n(animated[property], parseHexColor(light?.color || '#FFFFFF')[property === 'colorR' ? 0 : property === 'colorG' ? 1 : 2])
                    : n(animated[property], fallback),
            });
            if (value !== null && Number.isFinite(value)) animated[property] = value;
        }
        // Light tracks use flat, serializable keyframe properties so they can
        // share the camera/object animation format. Position and direction
        // axes are mapped to their nested scene properties before shading.
        for (const axis of ['x', 'y', 'z']) {
            if (Number.isFinite(Number(animated[`position${axis.toUpperCase()}`]))) animated.position[axis] = Number(animated[`position${axis.toUpperCase()}`]);
            if (Number.isFinite(Number(animated[`direction${axis.toUpperCase()}`]))) animated.direction[axis] = Number(animated[`direction${axis.toUpperCase()}`]);
            if (Number.isFinite(Number(animated[`target${axis.toUpperCase()}`]))) animated.target[axis] = Number(animated[`target${axis.toUpperCase()}`]);
        }
        const type = ['directional', 'spot', 'area'].includes(animated?.type) ? animated.type : 'point';
        return {
            type,
            position: V(animated?.position?.x, animated?.position?.y, animated?.position?.z),
            direction: V(animated?.direction?.x, animated?.direction?.y, animated?.direction?.z),
            target: V(animated?.target?.x, animated?.target?.y, animated?.target?.z),
            intensity: clamp(n(animated?.intensity, 0.8), 0, 4),
            color: colorFromChannels(light?.color || '#FFFFFF', animated, 'color'),
            range: clamp(n(animated?.range, 24), 0.1, 1000),
            decay: clamp(n(animated?.decay, 0.3), 0, 8),
            angle: clamp(n(animated?.angle, 60), 1, 179),
            width: clamp(n(animated?.width, 4), 0.1, 40),
            height: clamp(n(animated?.height, 4), 0.1, 40),
            castsShadow: animated?.castsShadow !== false,
        };
    });
    if (!lights.length) lights.push({ type: 'point', position: V(-3, 5, 6), intensity: 0.9, color: '#FFFFFF', range: 24, decay: 0.3 });
    // Area emitters are integrated with the same deterministic software
    // shading and shadow pipeline as point lights. Four stratified samples
    // approximate both the larger diffuse source and its softer penumbra.
    for (const light of lights) {
        if (light.type !== 'area') continue;
        const targetDirection = sub(light.target, light.position);
        const normal = Math.hypot(targetDirection.x, targetDirection.y, targetDirection.z) > 1e-6
            ? norm(targetDirection) : V(0, 0, -1);
        const reference = Math.abs(normal.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
        const tangent = norm(cross(normal, reference));
        const bitangent = norm(cross(normal, tangent));
        const hx = light.width * 0.25, hy = light.height * 0.25;
        light.areaSamples = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) => add(light.position,
            V(tangent.x * hx * x + bitangent.x * hy * y, tangent.y * hx * x + bitangent.y * hy * y, tangent.z * hx * x + bitangent.z * hy * y)));
    }
    const ambient = clamp(n(scene.ambient, 0.24), 0, 1);
    const faces = [];
    let sceneTriangleCount = 0;
    const shadows = [];
    const shadowConfig = scene.shadows || {};
    const groundY = n(shadowConfig.groundY, -1.8);
    const authoredReceiverPlane = shadowConfig.receiverPlane && typeof shadowConfig.receiverPlane === 'object'
        ? shadowConfig.receiverPlane : null;
    const objects = (Array.isArray(scene.objects) ? scene.objects : []).slice(0, MAX_SCENE_OBJECTS);
    const byId = new Map(objects.filter(o => o?.id).map(o => [o.id, o]));
    const receiverPlanes = [];
    if (authoredReceiverPlane) {
        const point = authoredReceiverPlane.point && [authoredReceiverPlane.point.x, authoredReceiverPlane.point.y, authoredReceiverPlane.point.z].every(value => Number.isFinite(Number(value)))
            ? V(authoredReceiverPlane.point.x, authoredReceiverPlane.point.y, authoredReceiverPlane.point.z) : V(0, groundY, 0);
        const normal = authoredReceiverPlane.normal;
        const normalLength = Math.hypot(n(normal?.x), n(normal?.y), n(normal?.z));
        receiverPlanes.push({ point, normal: normalLength > 1e-6
            ? V(n(normal.x) / normalLength, n(normal.y) / normalLength, n(normal.z) / normalLength) : V(0, 1, 0),
        authored: true });
    }
    for (const receiverObject of objects) {
        if (receiverObject?.type !== 'plane' || receiverObject.receivesShadow !== true || receiverObject.visible === false) continue;
        const receiverTransform = resolveObjectTransform(receiverObject, time, duration, byId, scene.audioWaveformsByAsset || {});
        const receiverMesh = normalizeSceneMesh({ ...receiverObject, ...receiverTransform.geometry });
        const receiverVertices = receiverMesh.vertices.map(vertex => worldVertex(vertex, receiverTransform));
        const firstFace = receiverMesh.faces.find(face => face.length >= 3 && face.slice(0, 3).every(index => receiverVertices[index]));
        if (!firstFace) continue;
        const [a, b, c] = firstFace.slice(0, 3).map(index => receiverVertices[index]);
        const normal = norm(cross(sub(b, a), sub(c, a)));
        receiverPlanes.push({ point: receiverTransform.position, normal, authored: false, sceneObject: true, boundaryPoints: receiverVertices });
    }
    if (!receiverPlanes.length) receiverPlanes.push({ point: V(0, groundY, 0), normal: V(0, 1, 0), authored: false });
    receiverPlanes.length = Math.min(receiverPlanes.length, MAX_SCENE_SHADOW_RECEIVERS);
    const shadowLights = lights.filter(light => light.castsShadow && light.intensity > 0).flatMap(light => {
        const samples = light.areaSamples || [light.position];
        return samples.map(position => ({
            ...light,
            position,
            intensity: light.intensity / samples.length,
            areaRadius: light.type === 'area' ? Math.max(light.width, light.height) * 0.25 : 0,
            projectionPoint: light.type === 'directional'
                ? V(-light.direction.x * 100, -light.direction.y * 100, -light.direction.z * 100)
                : position,
        }));
    });
    const totalShadowIntensity = shadowLights.reduce((sum, light) => sum + light.intensity, 0);
    for (let objectOrder = 0; objectOrder < objects.length; objectOrder++) {
        if (sceneTriangleCount >= MAX_SCENE_TRIANGLES) break;
        const object = objects[objectOrder];
        if (object?.visible === false) continue;
        const transform = resolveObjectTransform(object, time, duration, byId, scene.audioWaveformsByAsset || {});
        const mesh = normalizeSceneMesh({ ...object, ...transform.geometry });
        // Material opacity participates in the same inherited alpha as the
        // object's transform opacity. Keeping it here makes transparent
        // materials behave consistently for meshes, image planes, and 3D text
        // in both the browser preview and the server frame renderer.
        const materialOpacity = clamp(n(object?.material?.opacity, 1), 0, 1);
        const objectOpacity = clamp(n(transform.opacity, 1), 0, 1) * materialOpacity;
        if (object?.type === 'text') {
            const cameraPosition = cameraPoint(transform.position, camera);
            if (cameraPosition.z < camera.near || cameraPosition.z > camera.far) continue;
            const p = projectCameraPoint(cameraPosition, camera, width, height);
            const fontSize = clamp(n(object.fontSize, 0.72), 0.05, 3);
            const depth = clamp(Math.round(n(object.depth, 6)), 0, 32);
            // Extrusion slices move along the text object's local -Z axis.
            // Projecting each slice from world space makes depth follow object
            // rotation, parenting, scale and perspective instead of shifting
            // glyphs diagonally in screen space.
            const textPlanes = [];
            for (let slice = depth; slice > 0; slice--) {
                const localZ = -slice * fontSize * 0.025;
                const centerWorld = worldVertex(V(0, 0, localZ), transform);
                const centerCamera = cameraPoint(centerWorld, camera);
                if (centerCamera.z < camera.near || centerCamera.z > camera.far) continue;
                const center = projectCameraPoint(centerCamera, camera, width, height);
                const projectedX = project(worldVertex(V(1, 0, localZ), transform), camera, width, height);
                const projectedY = project(worldVertex(V(0, 1, localZ), transform), camera, width, height);
                const basisX = { x: projectedX.x - center.x, y: projectedX.y - center.y };
                const basisY = { x: projectedY.x - center.x, y: projectedY.y - center.y };
                if ([basisX.x, basisX.y, basisY.x, basisY.y].every(Number.isFinite)) {
                    textPlanes.push({ center, centerCamera, projectedX, projectedY, basisX, basisY });
                }
            }
            textPlanes.push({ center: p, centerCamera: cameraPosition,
                projectedX: project(worldVertex(V(1, 0, 0), transform), camera, width, height),
                projectedY: project(worldVertex(V(0, 1, 0), transform), camera, width, height),
                basisX: null, basisY: null, front: true });
            for (const plane of textPlanes) {
                if (!plane.basisX) plane.basisX = { x: plane.projectedX.x - plane.center.x, y: plane.projectedX.y - plane.center.y };
                if (!plane.basisY) plane.basisY = { x: plane.projectedY.x - plane.center.x, y: plane.projectedY.y - plane.center.y };
            }
            const frontPlane = textPlanes[textPlanes.length - 1];
            if (![frontPlane.basisX.x, frontPlane.basisX.y, frontPlane.basisY.x, frontPlane.basisY.y].every(Number.isFinite)) continue;
            // Reciprocal camera depth is affine across the front text plane.
            // The renderer uses it to depth-test the complete glyph silhouette.
            const determinant = frontPlane.basisX.x * frontPlane.basisY.y - frontPlane.basisY.x * frontPlane.basisX.y;
            const depthAt = Math.abs(determinant) > 1e-8
                ? (x, y) => {
                    const dx = x - p.x, dy = y - p.y;
                    const localX = (dx * frontPlane.basisY.y - frontPlane.basisY.x * dy) / determinant;
                    const localY = (frontPlane.basisX.x * dy - dx * frontPlane.basisX.y) / determinant;
                    const reciprocalDepth = 1 / cameraPosition.z
                        + localX * (1 / frontPlane.projectedX.z - 1 / cameraPosition.z)
                        + localY * (1 / frontPlane.projectedY.z - 1 / cameraPosition.z);
                    return reciprocalDepth > 0 ? 1 / reciprocalDepth : Infinity;
                }
                : () => cameraPosition.z;
            faces.push({ z: p.z, order: objectOrder, opacity: objectOpacity, text: true, depthAt, draw: (context) => {
                context.save();
                context.globalAlpha = objectOpacity;
                context.globalCompositeOperation = object.blendMode === 'addition' ? 'lighter' : (SCENE3D_BLEND_MODES.includes(object.blendMode) ? object.blendMode : 'source-over');
                context.textAlign = ['left', 'right'].includes(object.textAlign) ? object.textAlign : 'center';
                context.textBaseline = 'middle';
                const fontWeight = Math.max(100, Math.min(900, Math.round(n(object.fontWeight, 800) / 100) * 100));
                context.font = `${fontWeight} ${fontSize}px ${object.fontFamily || 'Arial'}, sans-serif`;
                context.lineJoin = 'round';
                for (const plane of textPlanes) {
                    context.save();
                    context.translate(plane.center.x, plane.center.y);
                    context.transform(plane.basisX.x, plane.basisX.y, plane.basisY.x, plane.basisY.y, 0, 0);
                    if (plane.front) {
                        context.fillStyle = object.color || '#FFFFFF';
                        context.strokeStyle = object.strokeColor || 'rgba(15,23,42,.55)'; context.lineWidth = Math.max(0, n(object.strokeWidth, fontSize * 0.025));
                        context.strokeText(String(object.content || '3D TEXT'), 0, 0);
                    } else {
                        context.fillStyle = object.sideColor || '#3730A3';
                    }
                    context.fillText(String(object.content || '3D TEXT'), 0, 0);
                    context.restore();
                }
                context.restore();
            } });
            continue;
        }
        const vertices = mesh.vertices.map(v => worldVertex(v, transform));
        if (shadowConfig.enabled !== false && object?.castsShadow !== false && object?.type !== 'plane') {
            for (const light of shadowLights) {
                const shadowLight = light.projectionPoint;
                for (const receiverPlane of receiverPlanes) {
                const receiverPoint = receiverPlane.point;
                let planeNormal = receiverPlane.normal;
                const lightSide = dot(sub(shadowLight, receiverPoint), planeNormal);
                if (lightSide < 0) {
                    planeNormal = V(-planeNormal.x, -planeNormal.y, -planeNormal.z);
                }
                const orientedLightSide = Math.abs(lightSide);
                if (orientedLightSide < 1e-4) continue;
                const planeReference = Math.abs(planeNormal.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
                const planeTangent = norm(cross(planeReference, planeNormal));
                const planeBitangent = norm(cross(planeNormal, planeTangent));
                const receiverBoundary = receiverPlane.boundaryPoints?.map(point => {
                    const relative = sub(point, receiverPoint);
                    return { x: dot(relative, planeTangent), y: dot(relative, planeBitangent) };
                });
                // Surface shading limits spotlights to their authored cone.
                // Apply the same cone to projected shadows, otherwise a spot
                // aimed away from an object still paints a full-strength
                // ground shadow behind it.
                const centre = vertices.reduce((sum, vertex) => add(sum, vertex), V());
                centre.x /= vertices.length; centre.y /= vertices.length; centre.z /= vertices.length;
                const lightDistance = Math.hypot(centre.x - light.position.x, centre.y - light.position.y, centre.z - light.position.z);
                const shadowAttenuation = light.type === 'directional' ? 1
                    : 1 / (1 + light.decay * (lightDistance / light.range) ** 2);
                let shadowCone = 1;
                if (light.type === 'spot') {
                    const forward = norm(sub(light.target, light.position));
                    const fromLight = norm(sub(centre, light.position));
                    const outer = Math.cos(rad(light.angle / 2));
                    const inner = Math.cos(rad(light.angle * 0.4));
                    shadowCone = clamp((dot(forward, fromLight) - outer) / Math.max(1e-5, inner - outer), 0, 1);
                    shadowCone *= shadowCone;
                    if (shadowCone <= 0) continue;
                }
                const projectToReceiver = vertex => {
                    const vertexSide = dot(sub(vertex, receiverPoint), planeNormal);
                    const denominator = orientedLightSide - vertexSide;
                    if (Math.abs(denominator) < 1e-4) return null;
                    const amount = orientedLightSide / denominator;
                    if (!(amount > 0) || !Number.isFinite(amount)) return null;
                    const intersection = add(shadowLight, V(
                        (vertex.x - shadowLight.x) * amount,
                        (vertex.y - shadowLight.y) * amount,
                        (vertex.z - shadowLight.z) * amount,
                    ));
                    // Lift the catcher shadow slightly toward the light so
                    // painter-only canvases keep it visible over the receiver.
                    // The legacy ground plane retains its authored offset.
                    const offset = Number.isFinite(Number(shadowConfig.surfaceOffset))
                        ? clamp(Number(shadowConfig.surfaceOffset), 0, 0.2)
                        : (receiverPlane.authored || receiverPlane.sceneObject ? 0.01 : 0.06);
                    return add(intersection, V(planeNormal.x * offset, planeNormal.y * offset, planeNormal.z * offset));
                };
                const projectedGround = vertices.map(projectToReceiver);
                const silhouetteLoops = object.type === 'mesh'
                    ? meshLightSilhouetteLoops(mesh, vertices, shadowLight) : null;
                const shadowShapes = silhouetteLoops?.every(loop => loop.every(index => projectedGround[index]))
                    ? silhouetteLoops.flatMap(loop => {
                        const boundary = new Set(loop.map((index, i) => {
                            const next = loop[(i + 1) % loop.length];
                            return index < next ? `${index}:${next}` : `${next}:${index}`;
                        }));
                        const edgeIsBoundary = (a, b) => boundary.has(a < b ? `${a}:${b}` : `${b}:${a}`);
                        return triangulateFace(loop, projectedGround).map(indices => ({
                            points: indices.map(index => projectedGround[index]),
                            // For raster's barycentric edge order: opposite A,
                            // opposite B, opposite C. Internal ear-clipping
                            // diagonals remain fully covered, so blur cannot
                            // reveal seams inside one silhouette.
                            edgeFlags: [edgeIsBoundary(indices[1], indices[2]),
                                edgeIsBoundary(indices[2], indices[0]), edgeIsBoundary(indices[0], indices[1])],
                        }));
                    })
                    : (() => {
                        const planeCoordinates = projectedGround.filter(Boolean).map(point => {
                            const relative = sub(point, receiverPoint);
                            return { point, x: dot(relative, planeTangent), y: dot(relative, planeBitangent) };
                        });
                        const hull = convexHull(planeCoordinates);
                        return hull.length >= 3 ? [{ points: hull.map(entry => entry.point) }] : [];
                    })();
                for (const shape of shadowShapes) {
                    const clippedShape = receiverBoundary?.length >= 3
                        ? clipPolygonToConvexPolygon(shape.points.map(point => {
                            const relative = sub(point, receiverPoint);
                            return { point, x: dot(relative, planeTangent), y: dot(relative, planeBitangent) };
                        }), receiverBoundary)
                        : shape.points.map(point => ({ point }));
                    if (clippedShape.length < 3) continue;
                    const shapePoints = clippedShape.map(entry => entry.point);
                    const shapeUnchanged = shapePoints.length === shape.points.length
                        && shapePoints.every((point, index) => point === shape.points[index]);
                    shadows.push({
                        points: shapePoints.map(point => project(point, camera, width, height)),
                        ...(shape.edgeFlags && shapeUnchanged ? { edgeFlags: shape.edgeFlags } : {}),
                        opacity: clamp(n(shadowConfig.opacity, 0.24) * (light.intensity / Math.max(0.001, totalShadowIntensity)) * shadowCone * shadowAttenuation * objectOpacity, 0, 0.75),
                        blur: clamp(n(shadowConfig.blur, 12) + n(light.areaRadius, 0) * 0.35, 0, 80), color: shadowConfig.color || '#111827',
                    });
                }
                }
            }
        }
        // Non-wireframe polygon faces are triangulated in world space so
        // concave custom meshes preserve their silhouette. Wireframe polygons
        // keep their authored perimeter instead of exposing triangulation seams.
        const renderFaces = object.wireframe ? mesh.faces
            : mesh.faces.flatMap(indices => triangulateFace(indices, vertices));
        for (const indices of renderFaces) {
            if (indices.some(i => !Number.isInteger(i) || !vertices[i])) continue;
            const points = indices.map(i => vertices[i]);
            const normal = norm(cross(sub(points[1], points[0]), sub(points[2], points[0])));
            const centre = points.reduce((sum, p) => add(sum, p), V());
            centre.x /= points.length; centre.y /= points.length; centre.z /= points.length;
            const view = norm(sub(V(camera.x, camera.y, camera.z), centre));
            const facing = dot(normal, view);
            const requestedSide = object.material?.side;
            const side = ['front', 'back', 'double'].includes(requestedSide) ? requestedSide : 'front';
            // The default is a conventional front-sided material. This matters
            // most for translucent closed meshes: drawing both the near and
            // far polygon at one pixel incorrectly composites the same glass
            // surface twice because transparent faces do not write z-buffer.
            if ((side === 'front' && facing <= 0) || (side === 'back' && facing >= 0)) continue;
            const shadedNormal = side === 'double' && facing < 0 ? V(-normal.x, -normal.y, -normal.z) : normal;
            const roughness = clamp(n(transform.material?.roughness, 0.62), 0.04, 1);
            const metalness = clamp(n(transform.material?.metalness, 0.08), 0, 1);
            const emissiveColor = transform.material?.emissiveColor || transform.material?.emissive || null;
            const emissiveIntensity = clamp(n(transform.material?.emissiveIntensity, 0), 0, 10);
            const contributions = [];
            for (const light of lights) {
                const samples = light.areaSamples || [light.position];
                for (const position of samples) {
                    const toLight = sub(position, centre);
                    const distance = Math.hypot(toLight.x, toLight.y, toLight.z);
                    const direction = light.type === 'directional'
                        ? norm(V(-light.direction.x, -light.direction.y, -light.direction.z))
                        : norm(toLight);
                    const attenuation = light.type === 'directional' ? 1 : 1 / (1 + light.decay * (distance / light.range) ** 2);
                    let cone = 1;
                    if (light.type === 'spot') {
                        const forward = norm(sub(light.target, position));
                        const fromLight = norm(sub(centre, position));
                        const outer = Math.cos(rad(light.angle / 2));
                        const inner = Math.cos(rad(light.angle * 0.4));
                        cone = clamp((dot(forward, fromLight) - outer) / Math.max(1e-5, inner - outer), 0, 1);
                        cone *= cone;
                    }
                    const energy = light.intensity * attenuation * cone / samples.length;
                    const diffuse = Math.max(0, dot(shadedNormal, direction)) * energy;
                    const half = norm(add(direction, view));
                    const exponent = 8 + (1 - roughness) ** 2 * 112;
                    const specular = (Math.max(0, dot(shadedNormal, half)) ** exponent) * energy * (0.18 + metalness * 0.55) * (1 - roughness * 0.7);
                    contributions.push({ color: light.color, diffuse, specular });
                }
            }
            const color = shadeMaterial(colorFromChannels(object.color || object.material?.color || '#7C3AED', transform.material, 'color'), ambient, contributions, metalness, roughness, emissiveColor, emissiveIntensity);
            const uvByIndex = mesh.uvs || [[0, 1], [1, 1], [1, 0], [0, 0]];
            const cameraVertices = points.map((p, pointIndex) => {
                const point = cameraPoint(p, camera);
                if ((['plane', 'image', 'video'].includes(object.type) || (object.type === 'mesh' && Array.isArray(mesh.uvs)))
                    && uvByIndex[indices[pointIndex]]) point.uv = uvByIndex[indices[pointIndex]];
                return point;
            });
            const cameraPoints = clipCameraDepth(cameraVertices, camera.near, camera.far);
            if (cameraPoints.length < 3) continue;
            const projected = cameraPoints.map(p => projectCameraPoint(p, camera, width, height));
            const maskRect = ['plane', 'image', 'video'].includes(object.type) && object.maskShape && object.maskShape !== 'none'
                ? { x: Math.min(...projected.map(p => p.x)), y: Math.min(...projected.map(p => p.y)), width: Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x)), height: Math.max(...projected.map(p => p.y)) - Math.min(...projected.map(p => p.y)) }
                : null;
            // Split clipped polygons into triangles so intersecting surfaces sort
            // more predictably and each triangle has a smaller depth range.
            for (let i = 1; i < projected.length - 1; i++) {
                if (sceneTriangleCount >= MAX_SCENE_TRIANGLES) break;
                const triangle = [projected[0], projected[i], projected[i + 1]];
                const z = (triangle[0].z + triangle[1].z + triangle[2].z) / 3;
                const face = { projected: triangle, z, order: objectOrder, color, opacity: objectOpacity,
                    textureLighting: textureLighting(ambient, contributions, metalness, roughness, emissiveColor, emissiveIntensity),
                    maskShape: TEXTURE_MASK_SHAPES.has(object.maskShape) ? object.maskShape : 'none',
                    maskAspectRatio: Math.abs(n(object.size?.x, 1) / (n(object.size?.y, 1) || 1)),
                    maskInvert: !!object.maskInvert, maskRect,
                    blendMode: SCENE3D_BLEND_MODES.includes(object.blendMode) ? object.blendMode : 'source-over', wireframe: !!object.wireframe,
                    wireframeWidth: clamp(n(object.wireframeWidth, 1.5), 0.5, 8), wireframeEdges: [true, i + 1 === projected.length - 1, i === 1],
                    stroke: object.wireframe ? colorWithLight(object.wireColor || '#FFFFFF', 0.8) : null };
                const textureUrl = object.type === 'video'
                    ? (object.videoTextureKey || object.id || object.videoUrl)
                    : (object.imageUrl || object.textureUrl);
                const image = textureUrl ? images[textureUrl] : null;
                const hasUvMapping = ['plane', 'image', 'video'].includes(object.type) || (object.type === 'mesh' && Array.isArray(mesh.uvs));
                if (hasUvMapping && cameraPoints.slice(0, i + 2).every(point => Array.isArray(point.uv))) {
                    face.uvs = [cameraPoints[0].uv, cameraPoints[i].uv, cameraPoints[i + 1].uv];
                    face.maskShape = object.maskShape;
                    if (image) face.image = image;
                }
                faces.push(face);
                sceneTriangleCount += 1;
            }
        }
    }
    // Cast shadows are translucent surfaces on the configured ground or
    // authored receiver planes. Put them through the same depth compositor as
    // meshes so receiver planes do not paint over them and foreground geometry
    // still occludes them. The fan's internal edges are excluded from blur
    // coverage to avoid seams between its triangles.
    for (const shadow of shadows) {
        if (faces.length >= MAX_SCENE_TRIANGLES) break;
        const triangles = shadow.edgeFlags
            ? [{ projected: shadow.points, edgeFlags: shadow.edgeFlags }]
            : shadow.points.slice(1, -1).map((point, index) => ({
                projected: [shadow.points[0], point, shadow.points[index + 2]],
                edgeFlags: [index === 0, index === shadow.points.length - 3, index === 0],
            }));
        for (const triangle of triangles) {
            if (faces.length >= MAX_SCENE_TRIANGLES) break;
            const projected = triangle.projected;
            faces.push({
                projected,
                z: (projected[0].z + projected[1].z + projected[2].z) / 3,
                order: objects.length + 10,
                color: shadow.color,
                opacity: shadow.opacity,
                blendMode: 'source-over',
                shadow: true,
                shadowBlur: shadow.blur,
                shadowEdges: triangle.edgeFlags,
            });
        }
    }
    const particleConfig = scene.particles || {};
    const particleCount = Math.round(clamp(n(particleConfig.count, 0), 0, MAX_SCENE_PARTICLES));
    const seed = resolveParticleSeed(particleConfig);
    const particleReactive = particleConfig.audioReactive || {};
    const particleWaveform = scene.audioWaveformsByAsset?.[particleReactive.assetId];
    const particleEnvelope = sampleAudioEnvelope(particleWaveform?.peaks || particleWaveform, time, particleWaveform?.duration || duration);
    const particleAmount = clamp(n(particleReactive.amount, 0), -1, 3) * particleEnvelope;
    const particleSpreadScale = particleReactive.target === 'spread' ? Math.max(0, 1 + particleAmount) : 1;
    const rand = (i, salt) => {
        const value = Math.sin((i + 1) * 127.1 + (seed + salt) * 311.7) * 43758.5453;
        return value - Math.floor(value);
    };
    const hasParticleSimulation = !!(particleConfig.emitter || particleConfig.velocity || particleConfig.gravity
        || particleConfig.lifetime != null || particleConfig.turbulence != null || particleConfig.loop === false);
    for (let i = 0; i < particleCount; i++) {
        if (faces.length >= MAX_SCENE_TRIANGLES) break;
        const spread = clamp(n(particleConfig.spread, 3.8) * particleSpreadScale, 0, 80);
        const baseSpeed = clamp(n(particleConfig.speed, 0.18), 0, 3);
        const speed = clamp(baseSpeed * (particleReactive.target === 'speed' ? Math.max(0, 1 + particleAmount) : 1), 0, 3);
        const emitter = particleConfig.emitter && typeof particleConfig.emitter === 'object'
            ? particleConfig.emitter : null;
        const emitterSize = emitter?.size;
        const reactiveEmitter = particleSpreadScale !== 1 && emitter
            ? { ...emitter, size: {
                x: n(emitterSize?.x, n(emitterSize?.radius, n(particleConfig.spread, 3.8))) * particleSpreadScale,
                y: n(emitterSize?.y, n(emitterSize?.radius, n(particleConfig.spread, 3.8))) * particleSpreadScale,
                z: n(emitterSize?.z, n(emitterSize?.radius, n(particleConfig.spread, 3.8) * 0.35)) * particleSpreadScale,
            } }
            : emitter;
        const simulated = hasParticleSimulation
            ? sampleProceduralParticle({ ...particleConfig, ...(reactiveEmitter ? { emitter: reactiveEmitter } : {}), spread, speed }, i, time)
            : null;
        if (hasParticleSimulation && !simulated) continue;
        const phase = (rand(i, 1) + time * speed / Math.max(0.5, duration)) % 1;
        const point = simulated
            ? V(simulated.position.x, simulated.position.y, simulated.position.z)
            : V((rand(i, 2) - 0.5) * spread, (phase - 0.5) * spread, (rand(i, 3) - 0.5) * spread * 0.35);
        const cameraSpacePoint = cameraPoint(point, camera);
        if (cameraSpacePoint.z < camera.near || cameraSpacePoint.z > camera.far) continue;
        const projected = projectCameraPoint(cameraSpacePoint, camera, width, height);
        const radius = clamp((simulated?.size ?? n(particleConfig.size, 5))
            * (particleReactive.target === 'size' ? Math.max(0, 1 + particleAmount) : 1), 0.5, 30) * projected.scale;
        const baseOpacity = simulated ? simulated.opacity : 0.25 + rand(i, 4) * 0.65;
        const opacity = clamp(baseOpacity * (particleReactive.target === 'opacity' ? Math.max(0, 1 + particleAmount) : 1), 0, 1);
        faces.push({ z: projected.z, order: objects.length + i, particle: true, shape: SCENE3D_PARTICLE_SHAPES.includes(particleConfig.shape) ? particleConfig.shape : 'circle', point: projected, radius, color: particleConfig.color || '#C4B5FD', opacity });
    }
    // The fallback painter still handles unsupported/oversized surfaces. On
    // normal scene canvases the z-buffer pass below handles opaque, transparent,
    // and textured triangles with perspective-correct depth tests.
    faces.sort((a, b) => b.z - a.z || a.order - b.order);
    ctx.save();
    const depthRendered = renderScene3DGpu(ctx, faces, width, height, camera)
        || rasterizeDepthBuffer(ctx, faces, width, height, camera.depthOfField);
    for (const face of faces) {
        if (depthRendered) continue;
        if (face.shadow) {
            // In the no-readback painter path, keep the projected shadow in
            // the same far-to-near ordering as the scene. Compositing every
            // shadow after all geometry made distant ground shadows paint on
            // top of foreground objects.
            ctx.save();
            ctx.globalAlpha = face.opacity;
            if ('filter' in ctx) ctx.filter = `blur(${face.shadowBlur}px)`;
            ctx.fillStyle = face.color;
            ctx.beginPath();
            ctx.moveTo(face.projected[0].x, face.projected[0].y);
            for (let i = 1; i < face.projected.length; i++) ctx.lineTo(face.projected[i].x, face.projected[i].y);
            ctx.closePath(); ctx.fill();
            ctx.restore();
            continue;
        }
        if (face.text) { face.draw(ctx); continue; }
        if (face.particle) {
            ctx.globalAlpha = face.opacity;
            ctx.fillStyle = face.color;
            traceParticlePath(ctx, face.shape, face.point.x, face.point.y, face.radius); ctx.fill();
            continue;
        }
        if (face.image) {
            const useMaskFallback = !depthRendered && face.maskShape !== 'none' && face.maskRect;
            if (useMaskFallback) { ctx.save(); clipPlaneMask(ctx, face.maskShape, face.maskRect, face.maskInvert); }
            ctx.globalCompositeOperation = face.blendMode === 'addition' ? 'lighter' : face.blendMode || 'source-over';
            drawTexturedTriangle(ctx, face.image, face.uvs, face.projected, face.opacity);
            if (useMaskFallback) ctx.restore();
            ctx.globalCompositeOperation = 'source-over';
            continue;
        }
        const useMaskFallback = !depthRendered && face.maskShape !== 'none' && face.maskRect;
        if (useMaskFallback) { ctx.save(); clipPlaneMask(ctx, face.maskShape, face.maskRect, face.maskInvert); }
        ctx.beginPath();
        ctx.moveTo(face.projected[0].x, face.projected[0].y);
        for (let i = 1; i < face.projected.length; i++) ctx.lineTo(face.projected[i].x, face.projected[i].y);
        ctx.closePath();
        ctx.globalAlpha = face.opacity;
        ctx.globalCompositeOperation = face.blendMode === 'addition' ? 'lighter' : face.blendMode || 'source-over';
        if (!face.wireframe) {
            ctx.fillStyle = face.color;
            ctx.fill();
        }
        // Match the edge to the face to close antialias seams between adjacent
        // software-rasterized polygons, especially on spheres and toruses.
        if (!face.wireframe) { ctx.strokeStyle = face.color; ctx.lineWidth = 0.6; ctx.stroke(); }
        if (face.stroke) { ctx.strokeStyle = rgbaAlpha(face.stroke, 0.8); ctx.lineWidth = face.wireframeWidth || 1.5; ctx.stroke(); }
        if (useMaskFallback) ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
}

const sceneSampleCanvases = new Map();
function sceneSampleCanvas(reference, width, height, slot) {
    const key = `${width}x${height}:${slot}`;
    let canvas = sceneSampleCanvases.get(key);
    if (canvas) {
        // Keep recently used surfaces hot, while preventing a long-lived
        // editor/export worker from retaining one full-resolution canvas for
        // every preview/export size it has ever rendered.
        sceneSampleCanvases.delete(key);
        sceneSampleCanvases.set(key, canvas);
        return canvas;
    }
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
    else if (reference?.ownerDocument?.createElement) { canvas = reference.ownerDocument.createElement('canvas'); canvas.width = width; canvas.height = height; }
    else if (reference?.constructor) canvas = new reference.constructor(width, height);
    if (canvas) {
        // Motion blur uses at most five samples and one accumulation surface.
        // Six entries preserve reuse for the active render at any resolution.
        if (sceneSampleCanvases.size >= 6) sceneSampleCanvases.delete(sceneSampleCanvases.keys().next().value);
        sceneSampleCanvases.set(key, canvas);
    }
    return canvas;
}

/** Render a scene frame, optionally sampling object motion across a shutter interval. */
export function drawScene3D(ctx, scene = {}, time = 0, duration = 1, width = 1080, height = 760, images = {}) {
    if (!ctx) return;
    const motionBlur = scene.motionBlur || {};
    const sampleCount = motionBlur.enabled ? Math.round(clamp(n(motionBlur.samples, 3), 2, 5)) : 1;
    if (sampleCount === 1) return drawScene3DSample(ctx, scene, time, duration, width, height, images);
    const shutterAngle = clamp(n(motionBlur.shutterAngle, 180), 0, 360);
    const frameRate = clamp(n(motionBlur.frameRate, 30), 1, 120);
    const exposure = shutterAngle / 360 / frameRate;
    if (exposure <= 0) return drawScene3DSample(ctx, scene, time, duration, width, height, images);
    const pixelWidth = Number(ctx.canvas?.width) || width;
    const pixelHeight = Number(ctx.canvas?.height) || height;
    // The preview/export target can already carry a template or parent-layer
    // transform. Render every shutter sample with that same transform so the
    // accumulated pixels line up with the non-blurred scene path.
    const transform = typeof ctx.getTransform === 'function'
        ? ctx.getTransform()
        : { a: pixelWidth / width, b: 0, c: 0, d: pixelHeight / height, e: 0, f: 0 };
    const buffers = [];
    for (let index = 0; index < sampleCount; index++) {
        const canvas = sceneSampleCanvas(ctx.canvas, pixelWidth, pixelHeight, index);
        const sampleCtx = canvas?.getContext?.('2d');
        if (!sampleCtx) return drawScene3DSample(ctx, scene, time, duration, width, height, images);
        sampleCtx.setTransform?.(1, 0, 0, 1, 0, 0);
        sampleCtx.clearRect(0, 0, pixelWidth, pixelHeight);
        sampleCtx.setTransform?.(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
        const offset = ((index + 0.5) / sampleCount - 0.5) * exposure;
        drawScene3DSample(sampleCtx, scene, Math.max(0, time + offset), duration, width, height, images);
        buffers.push(canvas);
    }
    const accumulation = sceneSampleCanvas(ctx.canvas, pixelWidth, pixelHeight, 5);
    const accumulationCtx = accumulation?.getContext?.('2d');
    if (!accumulationCtx) return drawScene3DSample(ctx, scene, time, duration, width, height, images);
    accumulationCtx.setTransform?.(1, 0, 0, 1, 0, 0);
    accumulationCtx.clearRect(0, 0, pixelWidth, pixelHeight);
    accumulationCtx.globalCompositeOperation = 'lighter';
    accumulationCtx.globalAlpha = 1 / sampleCount;
    for (const canvas of buffers) accumulationCtx.drawImage(canvas, 0, 0, pixelWidth, pixelHeight);
    accumulationCtx.globalAlpha = 1;
    accumulationCtx.globalCompositeOperation = 'source-over';
    ctx.save();
    // Samples already contain the caller's transform (the rasterizer applies
    // it to projected coordinates), so composite in backing-pixel space to
    // avoid applying that transform a second time. Keep alpha and blend mode
    // untouched so this still behaves like a normal layer composite.
    ctx.setTransform?.(1, 0, 0, 1, 0, 0);
    ctx.drawImage(accumulation, 0, 0, pixelWidth, pixelHeight);
    ctx.restore();
}

export const SCENE3D_PRIMITIVES = Object.freeze({ box: 'box', sphere: 'sphere', capsule: 'capsule', cylinder: 'cylinder', cone: 'cone', torus: 'torus', plane: 'plane', image: 'image', video: 'video', text: 'text', mesh: 'mesh' });
