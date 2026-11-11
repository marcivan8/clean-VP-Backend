import assert from 'node:assert/strict';
import { canRenderOpaqueScene3DGpu, canRenderScene3DGpu, renderScene3DGpu, renderOpaqueScene3DGpu } from '../client/src/motion/Scene3DGPU.js';

const triangle = { projected: [
    { x: 1, y: 1, z: 2 }, { x: 9, y: 1, z: 3 }, { x: 4, y: 9, z: 4 },
], color: 'rgb(51,102,153)', opacity: 1, blendMode: 'source-over', maskShape: 'none' };
assert.equal(canRenderOpaqueScene3DGpu([triangle]), true);
assert.equal(canRenderOpaqueScene3DGpu([{ ...triangle, color: '#369' }]), true);
const translucentTriangle = { ...triangle, opacity: 0.42 };
assert.equal(canRenderScene3DGpu([translucentTriangle]), true, 'simple source-over transparency remains eligible for the GPU path');
assert.equal(canRenderOpaqueScene3DGpu([translucentTriangle]), false, 'the legacy opaque-only capability check keeps its strict contract');
const texturedTriangle = {
    ...triangle,
    image: { width: 2, height: 2 },
    uvs: [[0, 0], [1, 0], [0.5, 1]],
};
assert.equal(canRenderScene3DGpu([texturedTriangle]), true,
    'a single textured surface can use source-over GPU rendering without writing alpha pixels to depth');
assert.equal(canRenderScene3DGpu([{ ...texturedTriangle, uvs: null }]), false, 'textured geometry without complete UVs remains on software rendering');
assert.equal(canRenderOpaqueScene3DGpu([texturedTriangle]), false,
    'the strict opaque-only predicate does not claim an image texture is opaque without inspecting its pixels');
assert.equal(canRenderScene3DGpu([{ ...texturedTriangle, image: { width: 8192, height: 8192 } }]), false,
    'individual textures over the GPU allocation budget remain on the software renderer');
assert.equal(canRenderScene3DGpu([
    { ...triangle, order: 1 }, { ...texturedTriangle, order: 2 },
]), true, 'opaque geometry and a single transparent texture share the GPU depth-tested path');
assert.equal(canRenderScene3DGpu([
    { ...translucentTriangle, order: 1 },
    { ...translucentTriangle, order: 2, projected: translucentTriangle.projected.map(point => ({ ...point, x: point.x + 20 })) },
]), true, 'multiple transparent surfaces with disjoint projected bounds use the GPU fast path');
assert.equal(canRenderScene3DGpu([
    { ...translucentTriangle, order: 1 },
    { ...translucentTriangle, order: 2, projected: translucentTriangle.projected.map(point => ({ ...point, z: point.z + 10 })) },
]), true, 'overlapping transparent surfaces with a provably stable depth order use the GPU fast path');
assert.equal(canRenderScene3DGpu([
    { ...translucentTriangle, order: 1 },
    { ...translucentTriangle, order: 2, projected: translucentTriangle.projected.map((point, index) => ({
        ...point, z: point.z + (index === 0 ? -1 : 1),
    })) },
]), false, 'overlapping transparent surfaces whose depth intervals cross retain per-pixel software compositing');
for (const unsupported of [
    { ...triangle, opacity: -0.1 }, { ...triangle, opacity: 1.1 }, { ...triangle, image: {} }, { ...triangle, shadow: true },
    { ...triangle, particle: true }, { ...triangle, text: true }, { ...triangle, wireframe: true },
    { ...triangle, maskShape: 'circle' }, { ...triangle, blendMode: 'multiply' },
    { ...triangle, color: 'rgba(1,2,3,0.5)' }, { ...triangle, color: 'rgb(256,2,3)' },
]) assert.equal(canRenderOpaqueScene3DGpu([unsupported]), false);
assert.equal(canRenderOpaqueScene3DGpu([triangle], { focusDistance: 4 }), false);

const calls = [];
let gpuContextLost = false;
const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    DEPTH_TEST: 5, BLEND: 6, COLOR_BUFFER_BIT: 7, DEPTH_BUFFER_BIT: 8,
    ARRAY_BUFFER: 9, STREAM_DRAW: 10, FLOAT: 11, TRIANGLES: 12, LEQUAL: 13,
    SRC_ALPHA: 14, ONE_MINUS_SRC_ALPHA: 15, ONE: 16,
    TEXTURE0: 17, TEXTURE_2D: 18, RGBA: 19, UNSIGNED_BYTE: 20,
    TEXTURE_MIN_FILTER: 21, TEXTURE_MAG_FILTER: 22, LINEAR: 23,
    TEXTURE_WRAP_S: 24, TEXTURE_WRAP_T: 25, CLAMP_TO_EDGE: 26,
    createShader: type => ({ type }), shaderSource: () => {}, compileShader: () => {},
    getShaderParameter: () => true, deleteShader: () => {}, createProgram: () => ({}),
    attachShader: () => {}, linkProgram: () => {}, getProgramParameter: () => true,
    detachShader: () => {}, deleteProgram: () => {}, createBuffer: () => ({}),
    getAttribLocation: (_program, name) => ({ a_position: 0, a_color: 1, a_uv: 2, a_textured: 3, a_textureTint: 4, a_textureAdd: 5 })[name],
    getUniformLocation: () => 0,
    viewport: (...args) => calls.push(['viewport', ...args]), clearColor: () => {}, clearDepth: () => {},
    enable: (...args) => calls.push(['enable', ...args]), depthFunc: () => {}, depthMask: value => calls.push(['depthMask', value]), disable: () => {}, clear: () => {},
    blendFuncSeparate: (...args) => calls.push(['blendFuncSeparate', ...args]),
    useProgram: () => {}, bindBuffer: () => {}, bufferData: (_target, data) => {
        if (gpuContextLost) throw new Error('context lost during buffer upload');
        calls.push(['bufferData', Array.from(data)]);
    },
    enableVertexAttribArray: () => {}, vertexAttribPointer: () => {}, uniform1i: () => {},
    createTexture: () => ({}), deleteTexture: texture => calls.push(['deleteTexture', texture]),
    bindTexture: (...args) => calls.push(['bindTexture', ...args]),
    activeTexture: (...args) => calls.push(['activeTexture', ...args]),
    texParameteri: () => {}, texImage2D: (...args) => calls.push(['texImage2D', ...args]),
    drawArrays: (_mode, start, count) => calls.push(['drawArrays', count, start]), isContextLost: () => gpuContextLost,
};
let offscreenCreations = 0;
let webglContextOptions = null;
class FakeOffscreenCanvas {
    constructor(width, height) { this.width = width; this.height = height; offscreenCreations++; }
    getContext(type, options) {
        if (type !== 'webgl2') return null;
        webglContextOptions = options;
        return gl;
    }
}
const oldOffscreen = globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas = FakeOffscreenCanvas;
try {
    const canvas = { width: 1280, height: 720, ownerDocument: {} };
    const drawn = [];
    const canvasOps = [];
    const ctx = {
        canvas,
        getTransform: () => ({ a: 2, b: 0, c: 0, d: 2, e: 13, f: 17 }),
        save: () => canvasOps.push('save'),
        setTransform: (...args) => canvasOps.push(['setTransform', ...args]),
        restore: () => canvasOps.push('restore'),
        drawImage: (...args) => drawn.push(args),
    };
    assert.equal(renderOpaqueScene3DGpu(ctx, [triangle], 640, 360, { near: 0.05, far: 1000 }), true);
    assert.equal(webglContextOptions?.premultipliedAlpha, true,
        'the GPU surface declares its source-over framebuffer as premultiplied before 2D compositing');
    assert.equal(calls.find(([name]) => name === 'drawArrays')[1], 3, 'the GPU draws the scene triangle');
    const uploadedVertices = calls.find(([name]) => name === 'bufferData')[1];
    assert.equal(uploadedVertices.length, 51);
    assert.ok(Math.abs(uploadedVertices[4] - 51 / 255) < 1e-6
        && Math.abs(uploadedVertices[5] - 102 / 255) < 1e-6
        && Math.abs(uploadedVertices[6] - 153 / 255) < 1e-6,
    'the GPU vertex buffer preserves the renderer’s shaded RGB face color');
    assert.equal(drawn.length, 1, 'the transparent WebGL surface is composited into the scene canvas');
    assert.deepEqual([drawn[0][1], drawn[0][2], drawn[0][3], drawn[0][4]], [0, 0, 1280, 720],
        'the already-transformed GPU surface is composited in device pixels without scaling or translating twice');
    assert.deepEqual(canvasOps.slice(0, 3), ['save', ['setTransform', 1, 0, 0, 1, 0, 0], 'restore'],
        'the GPU surface composite temporarily resets the 2D transform and restores caller state');
    const highDpiVertices = calls.find(([name]) => name === 'bufferData')[1];
    assert.ok(Math.abs(highDpiVertices[0] - (2 * 15 / 1280 - 1) * 2) < 1e-6
        && Math.abs(highDpiVertices[1] - (1 - 2 * 19 / 720) * 2) < 1e-6
        && Math.abs(highDpiVertices[3] - 2) < 1e-6,
        'GPU geometry includes the destination device-pixel transform once and preserves perspective clip W');
    assert.deepEqual([highDpiVertices[3], highDpiVertices[20], highDpiVertices[37]], [2, 3, 4],
        'perspective-correct interpolation receives each vertex camera depth');
    assert.equal(renderOpaqueScene3DGpu(ctx, [translucentTriangle], 640, 360, { near: 0.05, far: 1000 }), true,
        'the GPU renders a supported translucent triangle');
    const translucentVertices = calls.filter(([name]) => name === 'bufferData').at(-1)[1];
    assert.ok(Math.abs(translucentVertices[7] - 0.42) < 1e-6,
        'per-face opacity reaches the GPU fragment color');
    assert.ok(calls.some(([name, ...args]) => name === 'blendFuncSeparate'
        && args.join(',') === '14,15,16,15'), 'source-over blending preserves correct RGB and alpha blend factors');
    assert.ok(calls.some(([name, value]) => name === 'depthMask' && value === false),
        'translucent solid faces do not write occluding depth');
    const textureCalls = calls.length;
    assert.equal(renderScene3DGpu(ctx, [texturedTriangle], 640, 360), true,
        'a single image-textured surface uses the bounded GPU path');
    assert.ok(calls.slice(textureCalls).some(([name]) => name === 'texImage2D'),
        'the image texture is uploaded for the GPU surface');
    assert.ok(calls.slice(textureCalls).some(([name, value]) => name === 'depthMask' && value === false),
        'textured surfaces blend over established depth without writing depth through transparent texels');
    assert.ok(calls.slice(textureCalls).some(([name]) => name === 'drawArrays'),
        'the textured triangle reaches the GPU draw call');
    const opaqueFirstCall = calls.length;
    assert.equal(renderScene3DGpu(ctx, [texturedTriangle, { ...triangle, projected: triangle.projected.map(point => ({ ...point, z: point.z + 10 })) }], 640, 360), true,
        'an opaque surface behind the texture still renders through the GPU path');
    const opaqueFirstVertices = calls.slice(opaqueFirstCall).find(([name]) => name === 'bufferData')[1];
    assert.equal(opaqueFirstVertices[10], 0, 'opaque geometry is packed before alpha-bearing texture geometry');
    assert.equal(opaqueFirstVertices[51 + 10], 1, 'textured geometry is composited after opaque depth has been established');
    const transparentCalls = calls.length;
    assert.equal(renderOpaqueScene3DGpu(ctx, [
        { ...translucentTriangle, order: 1 }, { ...translucentTriangle, order: 2 },
    ], 640, 360), false,
        'distinct transparent surfaces use the per-pixel software compositor instead of average-depth GPU ordering');
    assert.equal(calls.length, transparentCalls, 'ambiguous transparent scenes are rejected before issuing GPU work');
    const disjointTransparentFaces = [
        { ...translucentTriangle, order: 1 },
        { ...translucentTriangle, order: 2, projected: translucentTriangle.projected.map(point => ({ ...point, x: point.x + 20 })) },
    ];
    assert.equal(renderScene3DGpu(ctx, disjointTransparentFaces, 640, 360), true,
        'multiple spatially disjoint translucent surfaces are actually rendered on the GPU');
    assert.equal(calls.filter(([name]) => name === 'drawArrays').at(-1)[1], 6,
        'both transparent surface triangles are submitted in the GPU scene pass');
    const layeredTransparentCall = calls.length;
    assert.equal(renderScene3DGpu(ctx, [
        { ...translucentTriangle, order: 1, z: 3 },
        { ...translucentTriangle, order: 2, z: 13, projected: translucentTriangle.projected.map(point => ({ ...point, z: point.z + 10 })) },
    ], 640, 360), true, 'stable-depth overlapping translucent surfaces use the GPU fast path');
    const layeredVertices = calls.slice(layeredTransparentCall).find(([name]) => name === 'bufferData')[1];
    assert.ok(layeredVertices[3] > layeredVertices[54], 'the far transparent surface is submitted before its foreground surface');
    const textureStart = calls.length;
    assert.equal(renderScene3DGpu(ctx, [texturedTriangle, { ...texturedTriangle, order: 2, image: { width: 2, height: 2 } }], 640, 360), false,
        'multiple transparent textures stay on per-pixel software depth resolution');
    const litTexture = { ...texturedTriangle, textureLighting: {
        diffuse: [0.5, 0.6, 0.7], metallicSpecular: [0.1, 0.2, 0.3],
        dielectricSpecular: [0, 64, 128], emission: [0, 32, 64],
    } };
    assert.equal(renderScene3DGpu(ctx, [litTexture], 640, 360), true,
        'the texture shader retains its lighting controls on the GPU path');
    const videoCanvas = { tagName: 'CANVAS', width: 640, height: 360 };
    const dynamicTexture = { ...texturedTriangle, image: videoCanvas };
    const manyTextures = Array.from({ length: 18 }, (_, index) => ({ ...texturedTriangle, order: 1, image: { id: index, width: 2, height: 2 } }));
    assert.equal(renderScene3DGpu(ctx, [dynamicTexture], 640, 360), true,
        'video textures use the GPU path with alpha-safe depth writes');
    assert.equal(renderOpaqueScene3DGpu(ctx, manyTextures, 640, 360), false,
        'a texture-heavy scene is rejected before allocating GPU texture handles');
    const largeTextures = Array.from({ length: 5 }, (_, index) => ({
        ...texturedTriangle, order: 1, image: { id: `large-${index}`, width: 2048, height: 2048 },
    }));
    assert.equal(renderOpaqueScene3DGpu(ctx, largeTextures, 640, 360), false,
        'large texture arrays are rejected before GPU allocation');
    assert.ok(calls.length > textureStart, 'supported image and video textures issue GPU work while oversized batches are rejected');
    const drawnBeforeRecovery = drawn.length;
    gpuContextLost = true;
    assert.equal(renderOpaqueScene3DGpu(ctx, [triangle], 640, 360), false,
        'a lost WebGL context yields cleanly to the software renderer');
    gpuContextLost = false;
    assert.equal(renderOpaqueScene3DGpu(ctx, [triangle], 640, 360), true,
        'the GPU fast path recovers after a context is restored');
    assert.equal(offscreenCreations, 2, 'context loss invalidates the cached target so a fresh WebGL surface is created');
    assert.equal(drawn.length, drawnBeforeRecovery + 1,
        'the recovered GPU frame is composited back into the scene canvas exactly once');
} finally {
    if (oldOffscreen === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = oldOffscreen;
}
let unavailableAttempts = 0;
globalThis.OffscreenCanvas = class { constructor() {} getContext() { unavailableAttempts++; return null; } };
try {
    const ctx = { canvas: { width: 640, height: 360, ownerDocument: {} } };
    assert.equal(renderOpaqueScene3DGpu(ctx, [triangle], 640, 360), false);
    assert.equal(renderOpaqueScene3DGpu(ctx, [triangle], 640, 360), false);
    assert.equal(unavailableAttempts, 1, 'unsupported WebGL is memoized per render canvas instead of retried every frame');
} finally {
    if (oldOffscreen === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = oldOffscreen;
}
console.log('3D GPU fast-path checks passed: strict capability gate, depth-ready triangles, source-over transparency, and transparent compositing.');
