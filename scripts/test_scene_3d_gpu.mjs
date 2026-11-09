import assert from 'node:assert/strict';
import { canRenderOpaqueScene3DGpu, canRenderScene3DGpu, renderOpaqueScene3DGpu } from '../client/src/motion/Scene3DGPU.js';

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
assert.equal(canRenderScene3DGpu([texturedTriangle]), true, 'UV-mapped source-over triangles are eligible for GPU texture sampling');
assert.equal(canRenderScene3DGpu([{ ...texturedTriangle, uvs: null }]), false, 'textured geometry without complete UVs remains on software rendering');
assert.equal(canRenderOpaqueScene3DGpu([texturedTriangle]), false,
    'the strict opaque-only predicate does not claim an image texture is opaque without inspecting its pixels');
assert.equal(canRenderScene3DGpu([{ ...texturedTriangle, image: { width: 8192, height: 8192 } }]), false,
    'individual textures over the GPU allocation budget remain on the software renderer');
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
class FakeOffscreenCanvas {
    constructor(width, height) { this.width = width; this.height = height; offscreenCreations++; }
    getContext(type) { return type === 'webgl2' ? gl : null; }
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
    const transparentCalls = calls.length;
    assert.equal(renderOpaqueScene3DGpu(ctx, [
        { ...translucentTriangle, order: 1 }, { ...translucentTriangle, order: 2 },
    ], 640, 360), false,
        'distinct transparent surfaces use the per-pixel software compositor instead of average-depth GPU ordering');
    assert.equal(calls.length, transparentCalls, 'ambiguous transparent scenes are rejected before issuing GPU work');
    const textureStart = calls.length;
    assert.equal(renderOpaqueScene3DGpu(ctx, [texturedTriangle, { ...texturedTriangle, projected: triangle.projected }], 640, 360), true,
        'UV-mapped triangles render through the GPU texture path');
    const textureCalls = calls.slice(textureStart);
    const texturedVertices = textureCalls.find(([name]) => name === 'bufferData')[1];
    assert.deepEqual(Array.from(texturedVertices.slice(8, 11)), [0, 0, 1], 'UV coordinates and the texture selector reach the GPU vertices');
    assert.equal(textureCalls.filter(([name]) => name === 'texImage2D').length, 1,
        'adjacent triangles sharing a texture upload it once per frame');
    assert.ok(textureCalls.some(([name, ...args]) => name === 'blendFuncSeparate'
        && args.join(',') === '14,15,16,15'), 'textured scenes enable source-over for image alpha');
    assert.ok(textureCalls.some(([name, value]) => name === 'depthMask' && value === false),
        'transparent texture pixels do not write occluding depth');
    assert.ok(textureCalls.some(([name, count, start]) => name === 'drawArrays' && start === 0 && count === 6),
        'adjacent triangles sharing a texture render in one draw batch');
    const litTexture = { ...texturedTriangle, textureLighting: {
        diffuse: [0.5, 0.6, 0.7], metallicSpecular: [0.1, 0.2, 0.3],
        dielectricSpecular: [0, 64, 128], emission: [0, 32, 64],
    } };
    const litTextureStart = calls.length;
    assert.equal(renderOpaqueScene3DGpu(ctx, [litTexture], 640, 360), true);
    const litTextureVertices = calls.slice(litTextureStart).find(([name]) => name === 'bufferData')[1];
    assert.ok(Math.abs(litTextureVertices[11] - 0.6) < 1e-6
        && Math.abs(litTextureVertices[12] - 0.8) < 1e-6
        && Math.abs(litTextureVertices[13] - 1) < 1e-6
        && Math.abs(litTextureVertices[14] - 0) < 1e-6
        && Math.abs(litTextureVertices[15] - 96 / 255) < 1e-6
        && Math.abs(litTextureVertices[16] - 192 / 255) < 1e-6,
    'per-face diffuse, metallic, dielectric and emissive texture lighting reaches the GPU shader');
    const staticTextureCalls = calls.length;
    assert.equal(renderOpaqueScene3DGpu(ctx, [texturedTriangle], 640, 360), true);
    assert.equal(calls.slice(staticTextureCalls).filter(([name]) => name === 'texImage2D').length, 0,
        'a cached still texture is not uploaded again on every scene frame');
    const videoCanvas = { tagName: 'CANVAS', width: 640, height: 360 };
    const dynamicTexture = { ...texturedTriangle, image: videoCanvas };
    const dynamicFirstFrame = calls.length;
    assert.equal(renderOpaqueScene3DGpu(ctx, [dynamicTexture], 640, 360), true);
    const dynamicSecondFrame = calls.length;
    assert.equal(renderOpaqueScene3DGpu(ctx, [dynamicTexture], 640, 360), true);
    assert.equal(calls.slice(dynamicFirstFrame, dynamicSecondFrame).filter(([name]) => name === 'texImage2D').length, 1,
        'a canvas-backed video texture uploads its current frame');
    assert.equal(calls.slice(dynamicSecondFrame).filter(([name]) => name === 'texImage2D').length, 1,
        'a canvas-backed video texture refreshes on the next frame');
    const textureEvictionStart = calls.length;
    const manyTextures = Array.from({ length: 18 }, (_, index) => ({ ...texturedTriangle, order: 1, image: { id: index, width: 2, height: 2 } }));
    assert.equal(renderOpaqueScene3DGpu(ctx, manyTextures, 640, 360), true);
    assert.ok(calls.slice(textureEvictionStart).some(([name]) => name === 'deleteTexture'),
        'the GPU texture cache disposes least-recently-used handles at its bound');
    const byteEvictionStart = calls.length;
    const largeTextures = Array.from({ length: 4 }, (_, index) => ({
        ...texturedTriangle, order: 1, image: { id: `large-${index}`, width: 2048, height: 2048 },
    }));
    assert.equal(renderOpaqueScene3DGpu(ctx, largeTextures, 640, 360), true);
    assert.ok(calls.slice(byteEvictionStart).some(([name]) => name === 'deleteTexture'),
        'the GPU texture cache evicts by allocated bytes before exhausting its memory budget');
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
