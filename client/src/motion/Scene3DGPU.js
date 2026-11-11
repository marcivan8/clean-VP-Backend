/** WebGL fast path for source-over 3D scene geometry. */
// One context per browsing document. A WebGL context per overlay canvas quickly
// exhausts browser context limits in a composition with multiple 3D layers.
const contexts = new WeakMap();
const UNAVAILABLE = Symbol('WebGL2 unavailable');
const MAX_CACHED_TEXTURES = 16;
const MAX_TEXTURE_CACHE_BYTES = 64 * 1024 * 1024;

const VERTEX_SHADER = `#version 300 es
in vec4 a_position;
in vec4 a_color;
in vec2 a_uv;
in float a_textured;
in vec3 a_textureTint;
in vec3 a_textureAdd;
out vec4 v_color;
out vec2 v_uv;
flat out float v_textured;
out vec3 v_textureTint;
out vec3 v_textureAdd;
void main() {
  gl_Position = a_position;
  v_color = a_color;
  v_uv = a_uv;
  v_textured = a_textured;
  v_textureTint = a_textureTint;
  v_textureAdd = a_textureAdd;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec4 v_color;
in vec2 v_uv;
flat in float v_textured;
in vec3 v_textureTint;
in vec3 v_textureAdd;
uniform sampler2D u_texture;
out vec4 outColor;
void main() {
  vec4 source = v_textured > 0.5 ? texture(u_texture, v_uv) : vec4(1.0);
  outColor = vec4(source.rgb * v_color.rgb * v_textureTint + v_textureAdd, source.a * v_color.a);
}`;

function parseOpaqueColor(value) {
    const color = String(value || '');
    const rgb = color.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
    if (rgb) {
        const channels = rgb.slice(1).map(Number);
        return channels.every(channel => channel >= 0 && channel <= 255) ? channels : null;
    }
    const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
    if (!hex) return null;
    const full = hex.length === 3 ? hex.split('').map(channel => channel + channel).join('') : hex;
    return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16));
}

function createTarget(sourceCanvas) {
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(1, 1);
    else if (sourceCanvas?.ownerDocument?.createElement) canvas = sourceCanvas.ownerDocument.createElement('canvas');
    else return null;

    let gl;
    try {
        gl = canvas.getContext('webgl2', {
            alpha: true,
            antialias: true,
            depth: true,
            // The source-over blend pass stores premultiplied RGB in the
            // framebuffer (`SRC_ALPHA`, `ONE_MINUS_SRC_ALPHA`). Declare that
            // representation accurately so drawImage does not premultiply the
            // translucent edge a second time when this surface enters 2D.
            premultipliedAlpha: true,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance',
        });
    } catch { return null; }
    if (!gl) return null;

    const compile = (type, source) => {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertex || !fragment) {
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
        return null;
    }
    const program = gl.createProgram();
    if (!program) {
        gl.deleteShader(vertex); gl.deleteShader(fragment);
        return null;
    }
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.detachShader(program, vertex); gl.detachShader(program, fragment);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
    const buffer = gl.createBuffer();
    if (!buffer) { gl.deleteProgram(program); return null; }
    return {
        canvas, gl, program, buffer,
        position: gl.getAttribLocation(program, 'a_position'),
        color: gl.getAttribLocation(program, 'a_color'),
        uv: gl.getAttribLocation(program, 'a_uv'),
        textured: gl.getAttribLocation(program, 'a_textured'),
        textureTint: gl.getAttribLocation(program, 'a_textureTint'),
        textureAdd: gl.getAttribLocation(program, 'a_textureAdd'),
        textureUniform: gl.getUniformLocation(program, 'u_texture'),
        textures: new Map(),
        textureBytes: 0,
    };
}

function textureMetrics(image) {
    const width = Number(image?.videoWidth || image?.naturalWidth || image?.width) || 0;
    const height = Number(image?.videoHeight || image?.naturalHeight || image?.height) || 0;
    if (!(width > 0 && height > 0)) return null;
    const bytes = Math.ceil(width) * Math.ceil(height) * 4;
    const source = String(image?.currentSrc || image?.src || '');
    return Number.isSafeInteger(bytes) && bytes > 0
        ? { width, height, bytes, signature: `${source}|${width}x${height}` }
        : null;
}

function validTextureCoordinates(face) {
    return Array.isArray(face?.uvs) && face.uvs.length === 3
        && face.uvs.every(uv => Array.isArray(uv) && uv.length >= 2
            && Number.isFinite(Number(uv[0])) && Number.isFinite(Number(uv[1])));
}

function withinTextureBudget(faces) {
    const images = new Set((faces || []).map(face => face?.image).filter(Boolean));
    if (images.size > MAX_CACHED_TEXTURES) return false;
    let totalBytes = 0;
    for (const image of images) {
        const metrics = textureMetrics(image);
        if (!metrics) return false;
        totalBytes += metrics.bytes;
        if (totalBytes >= MAX_TEXTURE_CACHE_BYTES) return false;
    }
    return true;
}

/** Accept source-over faces with bounded textures and a depth-safe surface set. */
export function canRenderScene3DGpu(faces, depthOfField = null) {
    return !depthOfField && Array.isArray(faces) && faces.length > 0 && faces.every(face =>
        !face.shadow && !face.particle && !face.text && !face.wireframe
        && face.projected?.length === 3
        && Number.isFinite(Number(face.opacity ?? 1))
        && Number(face.opacity ?? 1) >= 0 && Number(face.opacity ?? 1) <= 1
        && (!face.blendMode || face.blendMode === 'source-over')
        && (!face.maskShape || face.maskShape === 'none')
        && (face.image
            ? !!textureMetrics(face.image) && validTextureCoordinates(face)
            : !!parseOpaqueColor(face.color)))
        && withinTextureBudget(faces)
        && !hasMultipleTransparentSurfaces(faces);
}

/** Backwards-compatible strict predicate for integrations requiring opaque geometry. */
export function canRenderOpaqueScene3DGpu(faces, depthOfField = null) {
    return canRenderScene3DGpu(faces, depthOfField)
        // The GPU cannot infer whether an uploaded image contains transparent
        // texels without reading its pixels. Keep this stricter legacy contract
        // honest and let the general source-over path handle textured faces.
        && faces.every(face => !face.image && Number(face.opacity ?? 1) >= 0.999);
}

function hasMultipleTransparentSurfaces(faces) {
    // Transparent geometry can safely share the GPU path when projected
    // surfaces are disjoint or their depth intervals prove a stable ordering.
    // Overlapping surfaces whose depth ranges cross still need per-pixel
    // fragment sorting from the software compositor.
    const surfaces = new Map();
    const imageIds = new Map();
    let nextImageId = 0;
    for (let index = 0; index < faces.length; index++) {
        const face = faces[index];
        if (Number(face.opacity ?? 1) >= 0.999 && !face.image) continue;
        if (!Array.isArray(face.projected) || face.projected.length !== 3
            || !face.projected.every(point => Number.isFinite(Number(point.x))
                && Number.isFinite(Number(point.y)) && Number.isFinite(Number(point.z)))) return true;
        // Scene3D assigns one order to all triangles of a scene object. Treat
        // those triangles as a single transparent surface, including a
        // textured plane split into multiple triangles.
        let key;
        if (face.image && Number.isFinite(Number(face.order))) {
            if (!imageIds.has(face.image)) imageIds.set(face.image, nextImageId++);
            key = `image:${Number(face.order)}:${imageIds.get(face.image)}`;
        } else if (Number.isFinite(Number(face.order))) key = `order:${Number(face.order)}`;
        else if (face.image) {
            if (!imageIds.has(face.image)) imageIds.set(face.image, nextImageId++);
            key = `image:${imageIds.get(face.image)}`;
        } else key = `face:${index}`;

        const xs = face.projected.map(point => Number(point.x));
        const ys = face.projected.map(point => Number(point.y));
        const zs = face.projected.map(point => Number(point.z));
        const surface = surfaces.get(key) || { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity, near: Infinity, far: -Infinity };
        surface.left = Math.min(surface.left, ...xs);
        surface.top = Math.min(surface.top, ...ys);
        surface.right = Math.max(surface.right, ...xs);
        surface.bottom = Math.max(surface.bottom, ...ys);
        surface.near = Math.min(surface.near, ...zs);
        surface.far = Math.max(surface.far, ...zs);
        surfaces.set(key, surface);
    }

    const groups = [...surfaces.values()];
    for (let first = 0; first < groups.length; first++) for (let second = first + 1; second < groups.length; second++) {
        const a = groups[first], b = groups[second];
        const projectedOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1e-4
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1e-4;
        const orderedDepth = a.far < b.near - 1e-4 || b.far < a.near - 1e-4;
        if (projectedOverlap && !orderedDepth) return true;
    }
    return false;
}

/**
 * Render already-lit triangle faces into a transparent WebGL surface and
 * composite it back through the target 2D context. Returns false on any
 * unsupported canvas/context so the full software renderer remains available.
 */
export function renderScene3DGpu(ctx, faces, logicalWidth, logicalHeight, camera = {}) {
    const sourceCanvas = ctx?.canvas;
    const pixelWidth = Number(sourceCanvas?.width) || 0;
    const pixelHeight = Number(sourceCanvas?.height) || 0;
    if (!pixelWidth || !pixelHeight || pixelWidth * pixelHeight > 12_000_000
        || !canRenderScene3DGpu(faces, camera.depthOfField)
        || hasMultipleTransparentSurfaces(faces)) return false;

    const contextOwner = sourceCanvas.ownerDocument || globalThis;
    let target = contexts.get(contextOwner);
    if (target === UNAVAILABLE) return false;
    if (target === undefined) {
        target = createTarget(sourceCanvas);
        contexts.set(contextOwner, target || UNAVAILABLE);
    }
    if (!target) return false;

    const { canvas, gl } = target;
    canvas.width = pixelWidth; canvas.height = pixelHeight;
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    // Texture alpha is not knowable without reading back the source pixels.
    // Keep source-over enabled for textured faces so transparent PNG/video
    // pixels composite correctly instead of replacing the GPU surface.
    const hasTransparency = faces.some(face => Number(face.opacity ?? 1) < 0.999 || !!face.image);
    if (hasTransparency) {
        if (typeof gl.blendFuncSeparate !== 'function') return false;
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const transform = typeof ctx.getTransform === 'function'
        ? ctx.getTransform()
        : { a: pixelWidth / logicalWidth, b: 0, c: 0, d: pixelHeight / logicalHeight, e: 0, f: 0 };
    const near = Math.max(0.01, Number(camera.near) || 0.05);
    const far = Math.max(near + 0.01, Number(camera.far) || 1000);
    const perspective = camera.projection !== 'orthographic';
    // Establish opaque depth before compositing alpha-bearing faces. Sort the
    // alpha pass far-to-near; opaque depth is already established, and the
    // surface safety gate rejects overlapping transparent depth crossings.
    const faceDepth = face => Number.isFinite(Number(face.z))
        ? Number(face.z)
        : face.projected.reduce((sum, point) => sum + Number(point.z), 0) / face.projected.length;
    const renderFaces = faces.filter(face => !face.image && Number(face.opacity ?? 1) >= 0.999)
        .concat(faces.filter(face => face.image || Number(face.opacity ?? 1) < 0.999)
            .sort((a, b) => faceDepth(b) - faceDepth(a) || Number(a.order || 0) - Number(b.order || 0)));
    const vertices = new Float32Array(renderFaces.length * 3 * 17);
    let offset = 0;
    for (const face of renderFaces) {
        const color = face.image ? [255, 255, 255] : parseOpaqueColor(face.color);
        const [red, green, blue] = color.map(channel => channel / 255);
        for (let pointIndex = 0; pointIndex < face.projected.length; pointIndex++) {
            const point = face.projected[pointIndex];
            const x = transform.a * point.x + transform.c * point.y + transform.e;
            const y = transform.b * point.x + transform.d * point.y + transform.f;
            const z = Number(point.z);
            if (![x, y, z].every(Number.isFinite) || z < near || z > far) return false;
            const ndcDepth = perspective
                ? (far + near) / (far - near) - (2 * far * near) / ((far - near) * z)
                : (2 * (z - near) / (far - near)) - 1;
            const clipW = perspective ? z : 1;
            vertices[offset++] = ((2 * x / pixelWidth) - 1) * clipW;
            vertices[offset++] = (1 - (2 * y / pixelHeight)) * clipW;
            vertices[offset++] = ndcDepth * clipW;
            vertices[offset++] = clipW;
            vertices[offset++] = red; vertices[offset++] = green; vertices[offset++] = blue;
            vertices[offset++] = Math.max(0, Math.min(1, Number(face.opacity ?? 1)));
            const uv = face.image ? face.uvs[pointIndex] : null;
            vertices[offset++] = uv ? Number(uv[0]) : 0;
            vertices[offset++] = uv ? Number(uv[1]) : 0;
            vertices[offset++] = face.image ? 1 : 0;
            for (let channel = 0; channel < 3; channel++) {
                vertices[offset++] = face.image ? Number(face.textureLighting?.diffuse?.[channel] ?? 1)
                    + Number(face.textureLighting?.metallicSpecular?.[channel] ?? 0) : 1;
            }
            for (let channel = 0; channel < 3; channel++) {
                vertices[offset++] = face.image ? (Number(face.textureLighting?.dielectricSpecular?.[channel] ?? 0)
                    + Number(face.textureLighting?.emission?.[channel] ?? 0)) / 255 : 0;
            }
        }
    }

    try {
        gl.useProgram(target.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, target.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
        const stride = 17 * Float32Array.BYTES_PER_ELEMENT;
        gl.enableVertexAttribArray(target.position);
        gl.vertexAttribPointer(target.position, 4, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(target.color);
        gl.vertexAttribPointer(target.color, 4, gl.FLOAT, false, stride, 4 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(target.uv);
        gl.vertexAttribPointer(target.uv, 2, gl.FLOAT, false, stride, 8 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(target.textured);
        gl.vertexAttribPointer(target.textured, 1, gl.FLOAT, false, stride, 10 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(target.textureTint);
        gl.vertexAttribPointer(target.textureTint, 3, gl.FLOAT, false, stride, 11 * Float32Array.BYTES_PER_ELEMENT);
        gl.enableVertexAttribArray(target.textureAdd);
        gl.vertexAttribPointer(target.textureAdd, 3, gl.FLOAT, false, stride, 14 * Float32Array.BYTES_PER_ELEMENT);
        gl.uniform1i(target.textureUniform, 0);

        // Keep consecutive image batches in the scene's painter order. Depth
        // testing still resolves intersecting geometry, while a video texture
        // is uploaded only once per frame even when a mesh has many triangles.
    const uploadedThisFrame = new Set();
        let batchStart = 0;
    while (batchStart < renderFaces.length) {
        const image = renderFaces[batchStart].image || null;
            let batchEnd = batchStart + 1;
        while (batchEnd < renderFaces.length && (renderFaces[batchEnd].image || null) === image) batchEnd++;
            let batchIsOpaque = !image;
            for (let i = batchStart; batchIsOpaque && i < batchEnd; i++) {
            if (Number(renderFaces[i].opacity ?? 1) < 0.999) batchIsOpaque = false;
            }
            gl.depthMask(batchIsOpaque);
            if (image) {
                const metrics = textureMetrics(image);
                let entry = target.textures.get(image);
                if (entry && entry.signature !== metrics.signature) {
                    target.textures.delete(image);
                    target.textureBytes -= entry.bytes;
                    gl.deleteTexture(entry.texture);
                    entry = null;
                }
                const isNewTexture = !entry;
                if (!entry) {
                    while (target.textures.size >= MAX_CACHED_TEXTURES
                        || target.textureBytes + metrics.bytes > MAX_TEXTURE_CACHE_BYTES) {
                        const [oldestImage, oldestEntry] = target.textures.entries().next().value;
                        target.textures.delete(oldestImage);
                        target.textureBytes -= oldestEntry.bytes;
                        gl.deleteTexture(oldestEntry.texture);
                    }
                    const texture = gl.createTexture();
                    if (!texture) return false;
                    entry = { texture, uploaded: false, bytes: metrics.bytes, signature: metrics.signature };
                    target.textureBytes += metrics.bytes;
                }
                target.textures.delete(image);
                target.textures.set(image, entry);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, entry.texture);
                if (isNewTexture) {
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                }
                const sourceTag = String(image.tagName || '').toUpperCase();
                const dynamicSource = Number(image.videoWidth) > 0 || sourceTag === 'CANVAS' || typeof image.getContext === 'function';
                if (!uploadedThisFrame.has(image) && (dynamicSource || !entry.uploaded)) {
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
                    uploadedThisFrame.add(image);
                    entry.uploaded = true;
                }
            }
            gl.drawArrays(gl.TRIANGLES, batchStart * 3, (batchEnd - batchStart) * 3);
            batchStart = batchEnd;
        }
        gl.depthMask(true);
        if (gl.isContextLost?.()) { contexts.delete(contextOwner); return false; }
        // Vertex coordinates above already include the destination context's
        // transform and are expressed in backing-store pixels. Draw the GPU
        // surface in that same pixel space with an identity transform, or a
        // high-DPI scale / translated scene context would be applied twice.
        ctx.save();
        try {
            if (typeof ctx.setTransform === 'function') ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(canvas, 0, 0, pixelWidth, pixelHeight);
        } finally {
            ctx.restore();
        }
        return true;
    } catch {
        // Some browsers throw from buffer upload/draw calls as the context is
        // being lost, before the post-draw check can run. Drop that handle so
        // a later frame can recreate the fast path after restoration.
        if (gl.isContextLost?.()) contexts.delete(contextOwner);
        return false;
    }
}

export const renderOpaqueScene3DGpu = renderScene3DGpu;
