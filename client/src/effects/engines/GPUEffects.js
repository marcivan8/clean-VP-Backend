/**
 * GPUEffects.js
 * WebGL shader-based effect engine for real-time preview.
 * 
 * Provides GPU-accelerated visual effects using WebGL 2.0 shaders.
 */

import { ENGINE_TYPES } from '../EffectNode.js';

const unwrapEffectParam = (params, key, fallback) => {
    const raw = params?.[key];
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw
        ? raw.value
        : raw;
    return value ?? fallback;
};

export function resolveFadeProgress(effect, time, placement = {}, params = {}) {
    const clipStart = Number(placement.startTime ?? placement.start ?? 0) || 0;
    const clipDuration = Math.max(0, Number(placement.duration) || 0);
    const edgeValue = effect.type === 'fade_in' ? effect.startTime : effect.endTime;
    const authoredEdge = edgeValue == null || edgeValue === '' ? NaN : Number(edgeValue);
    const edge = Number.isFinite(authoredEdge)
        ? Math.max(0, authoredEdge - clipStart)
        : (effect.type === 'fade_in' ? 0 : clipDuration);
    const rawDuration = Number(unwrapEffectParam(params, 'duration', 0.5));
    const fadeDuration = Math.max(0.05, Math.min(clipDuration || 60,
        Number.isFinite(rawDuration) ? rawDuration : 0.5));
    const localTime = Math.max(0, (Number(time) || 0) - clipStart);
    return effect.type === 'fade_in'
        ? Math.max(0, Math.min(1, (localTime - edge) / fadeDuration))
        : 1 - Math.max(0, Math.min(1, (localTime - (edge - fadeDuration)) / fadeDuration));
}

// ============================================================================
// SHADER SOURCE CODE
// ============================================================================

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}`;

const SHADERS = {
    fade_in: `#version 300 es
precision mediump float;
in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_fadeProgress;
uniform vec3 u_color;
out vec4 outColor;
void main() {
    vec4 source = texture(u_image, v_texCoord);
    outColor = vec4(mix(u_color, source.rgb, clamp(u_fadeProgress, 0.0, 1.0)), source.a);
}`,

    fade_out: `#version 300 es
precision mediump float;
in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_fadeProgress;
uniform vec3 u_color;
out vec4 outColor;
void main() {
    vec4 source = texture(u_image, v_texCoord);
    outColor = vec4(mix(u_color, source.rgb, clamp(u_fadeProgress, 0.0, 1.0)), source.a);
}`,

    // === Gaussian Blur (Two-pass) ===
    blur_gaussian: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform vec2 u_direction;  // (1,0) for horizontal, (0,1) for vertical
uniform float u_radius;
uniform int u_quality;
uniform vec2 u_resolution;

out vec4 outColor;

void main() {
    vec2 texelSize = 1.0 / u_resolution;
    vec4 result = vec4(0.0);
    float total = 0.0;
    
    for (int i = 0; i < 32; i++) {
        if (i >= u_quality) break;
        float position = (float(i) / float(max(u_quality - 1, 1)) - 0.5) * 6.0;
        float radius = max(u_radius, 0.0001);
        float weight = exp(-0.5 * position * position);
        vec2 offset = u_direction * texelSize * position * radius;
        result += texture(u_image, v_texCoord + offset) * weight;
        total += weight;
    }
    
    outColor = result / total;
}`,

    // === Motion Blur ===
    blur_motion: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_intensity;
uniform float u_angle;
uniform int u_samples;
uniform vec2 u_resolution;

out vec4 outColor;

void main() {
    float rad = u_angle * 3.14159265 / 180.0;
    vec2 direction = vec2(cos(rad), sin(rad));
    vec2 texelSize = 1.0 / u_resolution;
    
    vec4 result = vec4(0.0);
    float total = 0.0;
    
    for (int i = 0; i < 64; i++) {
        if (i >= u_samples) break;
        float t = float(i) / float(max(u_samples - 1, 1)) - 0.5;
        // Keep the authored pixel-space angle and distance stable on portrait,
        // square, and landscape frames. UV units have different pixel scales
        // on the two axes, so convert the horizontal reference distance back
        // through texelSize before sampling.
        vec2 offset = direction * t * u_intensity * 0.1 * u_resolution.x * texelSize;
        result += texture(u_image, v_texCoord + offset);
        total += 1.0;
    }
    
    outColor = total > 0.0 ? result / total : texture(u_image, v_texCoord);
}`,

    // === Radial Blur ===
    blur_radial: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_intensity;
uniform vec2 u_center;
uniform int u_samples;
uniform vec2 u_resolution;

out vec4 outColor;

void main() {
    vec2 toCenter = (u_center - v_texCoord) * u_resolution;
    float dist = length(toCenter);
    vec2 direction = dist > 0.00001 ? toCenter / dist : vec2(0.0);
    
    vec4 result = vec4(0.0);
    float total = 0.0;
    
    for (int i = 0; i < 64; i++) {
        if (i >= u_samples) break;
        float t = float(i) / float(max(u_samples, 1));
        vec2 offset = direction * t * u_intensity * dist * 0.5 / u_resolution;
        result += texture(u_image, v_texCoord + offset);
        total += 1.0;
    }
    
    outColor = total > 0.0 ? result / total : texture(u_image, v_texCoord);
}`,

    // === Glow/Bloom ===
    glow: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_threshold;
uniform float u_intensity;
uniform float u_radius;
uniform vec3 u_color;
uniform vec2 u_resolution;

out vec4 outColor;

void main() {
    vec2 texelSize = 1.0 / u_resolution;
    vec4 original = texture(u_image, v_texCoord);
    
    // Match the live SVG and FFmpeg bloom: Rec. 709 luminance, a soft
    // threshold ramp, and a normalized Gaussian blur of the highlight matte.
    float bloom = 0.0;
    float totalWeight = 0.0;
    
    for (float x = -8.0; x <= 8.0; x += 1.0) {
        for (float y = -8.0; y <= 8.0; y += 1.0) {
            float weight = exp(-0.5 * (x*x + y*y) / (u_radius * u_radius * 0.25));
            vec2 offset = vec2(x, y) * texelSize * u_radius * 0.5;
            vec4 sampleColor = texture(u_image, v_texCoord + offset);
            float sampleLuminance = dot(sampleColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            float thresholdWidth = max(1.0 - u_threshold, 0.001);
            float highlight = clamp((sampleLuminance - u_threshold) / thresholdWidth, 0.0, 1.0);
            bloom += highlight * weight;
            totalWeight += weight;
        }
    }
    
    if (totalWeight > 0.0) bloom /= totalWeight;

    // feMerge composites the flood colour over SourceGraphic; it does not
    // add RGB energy to the original, which would clip and look harsher.
    // Registry and controls expose a 0–3 intensity range. Clamp the resulting
    // opacity, not the intensity, so values above 1 remain visibly stronger.
    float glowAlpha = clamp(bloom * clamp(u_intensity, 0.0, 3.0) * 0.7, 0.0, 1.0);
    outColor = vec4(mix(original.rgb, u_color, glowAlpha),
        original.a + glowAlpha * (1.0 - original.a));
}`,

    // === Vignette ===
    vignette: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_intensity;
uniform float u_radius;
uniform float u_softness;
uniform vec3 u_color;

out vec4 outColor;

void main() {
    vec4 color = texture(u_image, v_texCoord);
    
    vec2 center = vec2(0.5);
    float dist = distance(v_texCoord, center);
    float edge = smoothstep(u_radius - max(u_softness, 0.0001), u_radius, dist);
    outColor = vec4(mix(color.rgb, u_color, edge * clamp(u_intensity, 0.0, 1.0)), color.a);
}`,

    // === Camera Shake ===
    shake: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_intensity;
uniform float u_frequency;
uniform float u_time;
uniform float u_seed;
uniform float u_rotation;
uniform vec2 u_resolution;

out vec4 outColor;

// Smooth deterministic value noise avoids frame-to-frame white-noise jitter.
float hash(float x) {
    return fract(sin(x * 12.9898 + u_seed) * 43758.5453);
}

float noise(float x) {
    float cell = floor(x);
    float blend = fract(x);
    blend = blend * blend * (3.0 - 2.0 * blend);
    return mix(hash(cell), hash(cell + 1.0), blend);
}

void main() {
    float t = u_time * u_frequency;
    
    // Generate shake offset
    float shakeX = (noise(t) - 0.5) * 2.0 * u_intensity / u_resolution.x;
    float shakeY = (noise(t + 100.0) - 0.5) * 2.0 * u_intensity / u_resolution.y;
    
    // Apply rotation shake
    float angle = (noise(t + 200.0) - 0.5) * u_rotation * 3.14159265 / 180.0;
    vec2 center = vec2(0.5);
    vec2 uv = v_texCoord - center;
    
    float cosA = cos(angle);
    float sinA = sin(angle);
    vec2 rotated = vec2(
        uv.x * cosA - uv.y * sinA,
        uv.x * sinA + uv.y * cosA
    );
    
    vec2 finalUV = rotated + center + vec2(shakeX, shakeY);
    
    // Clamp to prevent wrapping
    finalUV = clamp(finalUV, vec2(0.0), vec2(1.0));
    
    outColor = texture(u_image, finalUV);
}`,

    // === RGB Split (Chromatic Aberration) ===
    rgb_split: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_amount;
uniform float u_angle;
uniform vec2 u_center;
uniform vec2 u_resolution;

out vec4 outColor;

void main() {
    vec2 dir = v_texCoord - u_center;
    float dist = length(dir);
    
    float rad = u_angle * 3.14159265 / 180.0;
    // amount is in pixels; convert each axis independently so a 90° split
    // has the same pixel displacement as a 0° split on any aspect ratio.
    vec2 offset = vec2(cos(rad) / u_resolution.x, sin(rad) / u_resolution.y) * u_amount;
    
    // Sample each channel with offset
    float r = texture(u_image, v_texCoord + offset * dist).r;
    float g = texture(u_image, v_texCoord).g;
    float b = texture(u_image, v_texCoord - offset * dist).b;
    float a = texture(u_image, v_texCoord).a;
    
    outColor = vec4(r, g, b, a);
}`,

    // === Film Grain ===
    film_grain: `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_intensity;
uniform float u_size;
uniform float u_time;
uniform bool u_animated;
uniform float u_seed;
uniform vec2 u_resolution;

out vec4 outColor;

void main() {
    vec4 color = texture(u_image, v_texCoord);
    
    // Generate grain
    float frame = u_animated ? floor(u_time * 30.0) : 0.0;
    vec2 grainCoord = floor(v_texCoord * u_resolution / max(u_size, 0.01));
    float seed = floor(u_seed);
    float hash = sin((grainCoord.x + seed * 7.1) * 12.9898
        + (grainCoord.y + seed * 3.17) * 78.233 + frame * 37.719) * 43758.5453;
    float grain = (fract(hash) - 0.5) * 2.0;
    
    // Apply grain
    color.rgb += grain * u_intensity;
    
    outColor = color;
}`,

    // === Digital Glitch ===
    glitch: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_intensity;
uniform float u_blockSize;
uniform bool u_colorShift;
uniform bool u_scanlines;
uniform float u_time;
uniform vec2 u_resolution;

out vec4 outColor;

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
    vec2 uv = v_texCoord;
    
    // Block displacement
    vec2 blockCoord = floor(uv * u_resolution / u_blockSize);
    float blockRandom = random(blockCoord + floor(u_time * 10.0));
    
    if (blockRandom > 1.0 - u_intensity * 0.3) {
        uv.x += (random(blockCoord) - 0.5) * u_intensity * 0.1;
    }
    
    // Sample color
    vec4 color = texture(u_image, uv);
    
    // Color shift
    if (u_colorShift && random(blockCoord + 0.5) > 0.7) {
        float shift = (random(blockCoord + 1.0) - 0.5) * u_intensity * 0.02;
        color.r = texture(u_image, uv + vec2(shift, 0.0)).r;
        color.b = texture(u_image, uv - vec2(shift, 0.0)).b;
    }
    
    // Scanlines
    if (u_scanlines) {
        float scanline = sin(uv.y * u_resolution.y * 3.14159265) * 0.5 + 0.5;
        color.rgb *= 0.9 + scanline * 0.1;
    }
    
    outColor = color;
}`,

    // === Color Grade ===
    color_grade: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_hueRotate;
uniform float u_temperature;
uniform float u_tint;

out vec4 outColor;

vec3 rgb2hsl(vec3 c) {
    float maxC = max(max(c.r, c.g), c.b);
    float minC = min(min(c.r, c.g), c.b);
    float l = (maxC + minC) / 2.0;
    
    if (maxC == minC) return vec3(0.0, 0.0, l);
    
    float d = maxC - minC;
    float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
    float h;
    
    if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    
    return vec3(h / 6.0, s, l);
}

vec3 hsl2rgb(vec3 c) {
    if (c.y == 0.0) return vec3(c.z);
    
    float q = c.z < 0.5 ? c.z * (1.0 + c.y) : c.z + c.y - c.z * c.y;
    float p = 2.0 * c.z - q;
    
    vec3 rgb;
    rgb.r = abs(mod(c.x * 6.0 + 0.0, 6.0) - 3.0) - 1.0;
    rgb.g = abs(mod(c.x * 6.0 + 4.0, 6.0) - 3.0) - 1.0;
    rgb.b = abs(mod(c.x * 6.0 + 2.0, 6.0) - 3.0) - 1.0;
    
    rgb = clamp(rgb, 0.0, 1.0);
    return p + (q - p) * rgb;
}

void main() {
    vec4 color = texture(u_image, v_texCoord);
    vec3 rgb = color.rgb;
    
    // Brightness (multiply)
    rgb *= u_brightness / 100.0;
    rgb = clamp(rgb, 0.0, 1.0);
    
    // Contrast
    rgb = (rgb - 0.5) * (u_contrast / 100.0) + 0.5;
    rgb = clamp(rgb, 0.0, 1.0);
    
    // Saturation
    float gray = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(vec3(gray), rgb, u_saturation / 100.0);

    // Contrast and saturation can move channels outside [0, 1]. The export
    // path clips after brightness and before its remaining grade operations;
    // clamp here before RGB-to-HSL so preview avoids invalid saturation and
    // zero-denominator cases while matching that bounded color domain.
    rgb = clamp(rgb, 0.0, 1.0);
    
    // Hue rotate
    vec3 hsl = rgb2hsl(rgb);
    hsl.x = mod(hsl.x + u_hueRotate / 360.0, 1.0);
    rgb = hsl2rgb(hsl);
    
    // Temperature (simple warm/cool)
    rgb.r += u_temperature * 0.003;
    rgb.b -= u_temperature * 0.003;
    
    // Tint (green/magenta)
    rgb.g += u_tint * 0.003;
    
    outColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}`
};

// Public capability manifest used by registry validation and diagnostics.
export const GPU_SHADER_TYPES = Object.freeze(Object.keys(SHADERS));

// ============================================================================
// GPU EFFECT ENGINE CLASS
// ============================================================================

export class GPUEffectEngine {
    constructor(gl) {
        this.gl = gl;
        this.programs = new Map();
        this.uniformLocations = new WeakMap();
        this.framebuffers = [];
        this.textures = [];
        this.targetWidth = 0;
        this.targetHeight = 0;
        this.initialized = false;

        // Geometry buffers
        this.positionBuffer = null;
        this.texCoordBuffer = null;

        if (gl) {
            this._init();
        }
    }

    supportsEffect(type) {
        return this.programs.has(String(type || ''));
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    _init() {
        const gl = this.gl;

        // Create quad geometry
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);

        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 1, 1, 1, 0, 0,
            0, 0, 1, 1, 1, 0
        ]), gl.STATIC_DRAW);

        // Create framebuffers for multi-pass
        for (let i = 0; i < 2; i++) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            const fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

            this.textures.push(texture);
            this.framebuffers.push(fb);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Compile shaders
        for (const [name, fragmentSrc] of Object.entries(SHADERS)) {
            this._compileShader(name, fragmentSrc);
        }

        this.initialized = true;
    }

    _compileShader(name, fragmentSrc) {
        const gl = this.gl;

        // Compile vertex shader
        const vs = gl.createShader(gl.VERTEX_SHADER);
        if (!vs) return;
        gl.shaderSource(vs, VERTEX_SHADER);
        gl.compileShader(vs);

        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            console.error(`[GPUEffects] Vertex shader error:`, gl.getShaderInfoLog(vs));
            gl.deleteShader(vs);
            return;
        }

        // Compile fragment shader
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        if (!fs) { gl.deleteShader(vs); return; }
        gl.shaderSource(fs, fragmentSrc);
        gl.compileShader(fs);

        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error(`[GPUEffects] Fragment shader error (${name}):`, gl.getShaderInfoLog(fs));
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            return;
        }

        // Link program
        const program = gl.createProgram();
        if (!program) {
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            return;
        }
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(`[GPUEffects] Program link error (${name}):`, gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            return;
        }

        // Shader objects are only needed through linking. Detaching and
        // deleting them here keeps long-lived preview contexts lean; the
        // linked program retains its executable until destroy().
        gl.detachShader(program, vs);
        gl.detachShader(program, fs);
        gl.deleteShader(vs);
        gl.deleteShader(fs);

        // Store with attribute locations
        this.programs.set(name, {
            program,
            attributes: {
                position: gl.getAttribLocation(program, 'a_position'),
                texCoord: gl.getAttribLocation(program, 'a_texCoord')
            },
            uniforms: {}
        });
    }

    // ========================================================================
    // PROCESSING
    // ========================================================================

    _ensureRenderTargets(width, height) {
        if (this.targetWidth === width && this.targetHeight === height) return;

        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        for (let i = 0; i < this.textures.length; i++) {
            gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[i]);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[i], 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.targetWidth = width;
        this.targetHeight = height;
    }

    _uniformLocation(gl, program, name) {
        // Uniform locations are stable for a linked program. Avoid querying
        // the WebGL driver again on every frame and every effect pass.
        if (!this.uniformLocations) this.uniformLocations = new WeakMap();
        let locations = this.uniformLocations.get(program);
        if (!locations) {
            locations = new Map();
            this.uniformLocations.set(program, locations);
        }
        if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
        return locations.get(name);
    }

    /**
     * Process a single effect
     * @param {EffectNode} effect - Effect to process
     * @param {WebGLTexture} inputTexture - Input texture
     * @param {number} time - Current time
     * @param {object} context - Rendering context
     * @returns {WebGLTexture} Output texture
     */
    processEffect(effect, inputTexture, time, context = {}) {
        if (!this.initialized || effect.engine !== ENGINE_TYPES.GPU) {
            return inputTexture;
        }

        const shaderInfo = this.programs.get(effect.type);
        if (!shaderInfo) {
            console.warn(`[GPUEffects] No shader for effect: ${effect.type}`);
            return inputTexture;
        }

        const gl = this.gl;
        const { program, attributes } = shaderInfo;

        // Get interpolated params
        const placement = context.placement || {};
        const params = effect.getParamsAt(time, {
            ...context,
            clipStart: context.clipStart ?? placement.startTime ?? placement.start ?? 0,
            clipDuration: context.clipDuration ?? placement.duration,
        });

        // Use framebuffer for output
        const fbIndex = Number.isInteger(context.fbIndex) ? context.fbIndex % this.framebuffers.length : 0;
        const outputTexture = this.textures[fbIndex];

        // Resize framebuffer texture if needed
        const width = context.width || gl.drawingBufferWidth;
        const height = context.height || gl.drawingBufferHeight;

        this._ensureRenderTargets(width, height);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[fbIndex]);
        gl.viewport(0, 0, width, height);

        gl.useProgram(program);

        // Bind geometry
        gl.enableVertexAttribArray(attributes.position);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.vertexAttribPointer(attributes.position, 2, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(attributes.texCoord);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.vertexAttribPointer(attributes.texCoord, 2, gl.FLOAT, false, 0, 0);

        // Bind input texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture);
        gl.uniform1i(this._uniformLocation(gl, program, 'u_image'), 0);

        // Set common uniforms
        gl.uniform2f(this._uniformLocation(gl, program, 'u_resolution'), width, height);
        gl.uniform1f(this._uniformLocation(gl, program, 'u_time'), time);

        // Set effect-specific uniforms
        this._setEffectUniforms(gl, program, effect.type, params, time);
        if (effect.type === 'fade_in' || effect.type === 'fade_out') {
            const progress = resolveFadeProgress(effect, time, {
                startTime: context.clipStart ?? placement.startTime ?? placement.start,
                duration: context.clipDuration ?? placement.duration,
            }, params);
            gl.uniform1f(this._uniformLocation(gl, program, 'u_fadeProgress'), progress);
            const rawColor = unwrapEffectParam(params, 'color', [0, 0, 0]);
            const color = Array.isArray(rawColor) ? rawColor : [0, 0, 0];
            gl.uniform3f(this._uniformLocation(gl, program, 'u_color'),
                ...[0, 1, 2].map(index => Number.isFinite(Number(color[index])) ? Math.max(0, Math.min(1, Number(color[index]))) : 0));
        }

        // Draw
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Gaussian blur is separable: a vertical pass after the horizontal pass
        // produces a true 2D blur at substantially lower cost than a 2D kernel.
        if (effect.type === 'blur_gaussian') {
            const verticalIndex = (fbIndex + 1) % this.framebuffers.length;
            const verticalTexture = this.textures[verticalIndex];
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[verticalIndex]);
            gl.viewport(0, 0, width, height);
            gl.useProgram(program);
            gl.enableVertexAttribArray(attributes.position);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.vertexAttribPointer(attributes.position, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(attributes.texCoord);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
            gl.vertexAttribPointer(attributes.texCoord, 2, gl.FLOAT, false, 0, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, outputTexture);
            gl.uniform1i(this._uniformLocation(gl, program, 'u_image'), 0);
            gl.uniform2f(this._uniformLocation(gl, program, 'u_resolution'), width, height);
            const radius = Number(unwrapEffectParam(params, 'radius', 5));
            gl.uniform1f(this._uniformLocation(gl, program, 'u_radius'), Number.isFinite(radius) ? Math.max(0, Math.min(50, radius)) : 5);
            const quality = Number(unwrapEffectParam(params, 'quality', 8));
            gl.uniform1i(this._uniformLocation(gl, program, 'u_quality'), Number.isFinite(quality) ? Math.max(4, Math.min(32, Math.round(quality))) : 8);
            gl.uniform2f(this._uniformLocation(gl, program, 'u_direction'), 0, 1);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return verticalTexture;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return outputTexture;
    }

    _setEffectUniforms(gl, program, type, params, time = 0) {
        const value = (key, fallback) => unwrapEffectParam(params, key, fallback);
        const number = (key, fallback, min = -Infinity, max = Infinity) => {
            const raw = Number(value(key, fallback));
            return Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : fallback;
        };
        const samples = (key, fallback, min) => Math.round(number(key, fallback, min, 64));
        const boolean = (key, fallback) => Boolean(value(key, fallback));
        switch (type) {
            case 'blur_gaussian':
                gl.uniform1f(this._uniformLocation(gl, program, 'u_radius'), number('radius', 5, 0, 50));
                gl.uniform1i(this._uniformLocation(gl, program, 'u_quality'), Math.min(32, samples('quality', 8, 4)));
                gl.uniform2f(this._uniformLocation(gl, program, 'u_direction'), 1, 0); // Horizontal pass
                break;

            case 'blur_motion':
                gl.uniform1f(this._uniformLocation(gl, program, 'u_intensity'), number('intensity', 0.5, 0, 1));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_angle'), number('angle', 0, 0, 360));
                gl.uniform1i(this._uniformLocation(gl, program, 'u_samples'), samples('samples', 16, 2));
                break;

            case 'blur_radial':
                gl.uniform1f(this._uniformLocation(gl, program, 'u_intensity'), number('intensity', 0.3, 0, 1));
                gl.uniform2f(this._uniformLocation(gl, program, 'u_center'),
                    number('centerX', 0.5, 0, 1), number('centerY', 0.5, 0, 1));
                gl.uniform1i(this._uniformLocation(gl, program, 'u_samples'), samples('samples', 32, 1));
                break;

            case 'glow':
            {
                gl.uniform1f(this._uniformLocation(gl, program, 'u_threshold'), number('threshold', 0.7, 0, 1));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_intensity'), number('intensity', 1, 0, 3));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_radius'), number('radius', 10, 1, 50));
                const glowColor = Array.isArray(value('color', null)) ? value('color', null) : [1, 1, 1];
                gl.uniform3f(this._uniformLocation(gl, program, 'u_color'),
                    ...[0, 1, 2].map(index => Number.isFinite(Number(glowColor[index])) ? Math.max(0, Math.min(1, Number(glowColor[index]))) : 1));
                break;
            }

            case 'vignette':
            {
                gl.uniform1f(this._uniformLocation(gl, program, 'u_intensity'), number('intensity', 0.5, 0, 1));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_radius'), number('radius', 0.7, 0, 1.5));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_softness'), number('softness', 0.5, 0, 1));
                const vigColor = Array.isArray(value('color', null)) ? value('color', null) : [0, 0, 0];
                gl.uniform3f(this._uniformLocation(gl, program, 'u_color'),
                    ...[0, 1, 2].map(index => Number.isFinite(Number(vigColor[index])) ? Math.max(0, Math.min(1, Number(vigColor[index]))) : 0));
                break;
            }

            case 'shake':
                gl.uniform1f(this._uniformLocation(gl, program, 'u_intensity'), number('intensity', 5, 0, 50));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_frequency'), number('frequency', 10, 1, 60));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_seed'), number('randomSeed', 0));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_rotation'), number('rotationAmount', 0, 0, 10));
                break;

            case 'rgb_split':
                gl.uniform1f(this._uniformLocation(gl, program, 'u_amount'), number('amount', 5, 0, 50));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_angle'), number('angle', 0, 0, 360));
                gl.uniform2f(this._uniformLocation(gl, program, 'u_center'),
                    number('centerX', 0.5, 0, 1), number('centerY', 0.5, 0, 1));
                break;

            case 'film_grain':
                gl.uniform1f(this._uniformLocation(gl, program, 'u_intensity'), number('intensity', 0.15, 0, 1));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_size'), number('size', 1.5, 0.5, 5));
                gl.uniform1i(this._uniformLocation(gl, program, 'u_animated'), boolean('animated', true) ? 1 : 0);
                gl.uniform1f(this._uniformLocation(gl, program, 'u_time'), boolean('animated', true) ? (Number(time) || 0) : 0);
                gl.uniform1f(this._uniformLocation(gl, program, 'u_seed'), number('seed', 941, 0, 1000000));
                break;

            case 'glitch':
                gl.uniform1f(this._uniformLocation(gl, program, 'u_intensity'), number('intensity', 0.3, 0, 1));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_blockSize'), number('blockSize', 32, 4, 128));
                gl.uniform1i(this._uniformLocation(gl, program, 'u_colorShift'), boolean('colorShift', false) ? 1 : 0);
                gl.uniform1i(this._uniformLocation(gl, program, 'u_scanlines'), boolean('scanlines', false) ? 1 : 0);
                gl.uniform1f(this._uniformLocation(gl, program, 'u_time'), Number.isFinite(Number(time)) ? Number(time) : 0);
                break;

            case 'color_grade':
                gl.uniform1f(this._uniformLocation(gl, program, 'u_brightness'), number('brightness', 100, 0, 200));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_contrast'), number('contrast', 100, 0, 200));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_saturation'), number('saturation', 100, 0, 200));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_hueRotate'), number('hueRotate', 0, -180, 180));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_temperature'), number('temperature', 0, -100, 100));
                gl.uniform1f(this._uniformLocation(gl, program, 'u_tint'), number('tint', 0, -100, 100));
                break;
        }
    }

    /**
     * Process chain of effects
     */
    processChain(effects, inputTexture, time, context = {}) {
        let current = inputTexture;

        for (const effect of effects) {
            if (effect.enabled && effect.engine === ENGINE_TYPES.GPU && effect.isActiveAt(time)) {
                // Select a target different from the current input to avoid a
                // WebGL feedback loop, including after multi-pass effects.
                const fbIndex = current === this.textures[0] ? 1 : 0;
                current = this.processEffect(effect, current, time, { ...context, fbIndex });
            }
        }

        return current;
    }

    /**
     * Check if effect type is supported
     */
    hasShader(type) {
        return this.programs.has(type);
    }

    /**
     * Get list of supported effects
     */
    getSupportedEffects() {
        return Array.from(this.programs.keys());
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    destroy() {
        const gl = this.gl;
        if (!gl) return;

        // Delete programs
        for (const { program } of this.programs.values()) {
            gl.deleteProgram(program);
        }
        this.programs.clear();

        // Delete framebuffers and textures
        for (const fb of this.framebuffers) {
            gl.deleteFramebuffer(fb);
        }
        for (const tex of this.textures) {
            gl.deleteTexture(tex);
        }

        // Delete buffers
        if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
        if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);

        this.framebuffers.length = 0;
        this.textures.length = 0;
        this.positionBuffer = null;
        this.texCoordBuffer = null;
        this.targetWidth = 0;
        this.targetHeight = 0;
        this.uniformLocations = new WeakMap();
        this.initialized = false;
    }
}

export default GPUEffectEngine;
