/**
 * GPUEffects.js
 * WebGL shader-based effect engine for real-time preview.
 * 
 * Provides GPU-accelerated visual effects using WebGL 2.0 shaders.
 */

import { ENGINE_TYPES } from '../EffectNode.js';

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
    // === Gaussian Blur (Two-pass) ===
    blur_gaussian: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform vec2 u_direction;  // (1,0) for horizontal, (0,1) for vertical
uniform float u_radius;
uniform vec2 u_resolution;

out vec4 outColor;

void main() {
    vec2 texelSize = 1.0 / u_resolution;
    vec4 result = vec4(0.0);
    float total = 0.0;
    
    for (float i = -16.0; i <= 16.0; i += 1.0) {
        float weight = exp(-0.5 * (i * i) / (u_radius * u_radius));
        vec2 offset = u_direction * texelSize * i * u_radius;
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
        float t = float(i) / float(u_samples - 1) - 0.5;
        vec2 offset = direction * t * u_intensity * 0.1;
        result += texture(u_image, v_texCoord + offset);
        total += 1.0;
    }
    
    outColor = result / total;
}`,

    // === Radial Blur ===
    blur_radial: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_intensity;
uniform vec2 u_center;
uniform int u_samples;

out vec4 outColor;

void main() {
    vec2 toCenter = u_center - v_texCoord;
    float dist = length(toCenter);
    vec2 direction = normalize(toCenter);
    
    vec4 result = vec4(0.0);
    float total = 0.0;
    
    for (int i = 0; i < 64; i++) {
        if (i >= u_samples) break;
        float t = float(i) / float(u_samples);
        vec2 offset = direction * t * u_intensity * dist * 0.5;
        result += texture(u_image, v_texCoord + offset);
        total += 1.0;
    }
    
    outColor = result / total;
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
    
    // Extract bright areas
    float brightness = dot(original.rgb, vec3(0.299, 0.587, 0.114));
    vec3 bright = brightness > u_threshold ? original.rgb : vec3(0.0);
    
    // Blur bright areas
    vec3 bloom = vec3(0.0);
    float total = 0.0;
    
    for (float x = -8.0; x <= 8.0; x += 1.0) {
        for (float y = -8.0; y <= 8.0; y += 1.0) {
            float weight = exp(-0.5 * (x*x + y*y) / (u_radius * u_radius * 0.25));
            vec2 offset = vec2(x, y) * texelSize * u_radius * 0.5;
            vec4 sampleColor = texture(u_image, v_texCoord + offset);
            float sampleBright = dot(sampleColor.rgb, vec3(0.299, 0.587, 0.114));
            if (sampleBright > u_threshold) {
                bloom += sampleColor.rgb * weight;
                total += weight;
            }
        }
    }
    
    if (total > 0.0) bloom /= total;
    
    // Combine with tint
    vec3 tintedBloom = bloom * u_color;
    outColor = vec4(original.rgb + tintedBloom * u_intensity, original.a);
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
    float vignette = smoothstep(u_radius, u_radius - u_softness, dist);
    
    vec3 vignetted = mix(u_color, color.rgb, vignette * (1.0 - u_intensity) + (1.0 - u_intensity));
    vignetted = mix(color.rgb, u_color, (1.0 - vignette) * u_intensity);
    
    outColor = vec4(mix(color.rgb, vignetted, u_intensity), color.a);
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

// Simple noise function
float noise(float x) {
    return fract(sin(x * 12.9898 + u_seed) * 43758.5453);
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
    vec2 offset = vec2(cos(rad), sin(rad)) * u_amount / u_resolution.x;
    
    // Sample each channel with offset
    float r = texture(u_image, v_texCoord + offset * dist).r;
    float g = texture(u_image, v_texCoord).g;
    float b = texture(u_image, v_texCoord - offset * dist).b;
    float a = texture(u_image, v_texCoord).a;
    
    outColor = vec4(r, g, b, a);
}`,

    // === Film Grain ===
    film_grain: `#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform float u_intensity;
uniform float u_size;
uniform float u_time;

out vec4 outColor;

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
    vec4 color = texture(u_image, v_texCoord);
    
    // Generate grain
    vec2 grainCoord = v_texCoord * u_size + vec2(u_time);
    float grain = random(grainCoord) * 2.0 - 1.0;
    
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
    
    // Contrast
    rgb = (rgb - 0.5) * (u_contrast / 100.0) + 0.5;
    
    // Saturation
    float gray = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(vec3(gray), rgb, u_saturation / 100.0);
    
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

// ============================================================================
// GPU EFFECT ENGINE CLASS
// ============================================================================

export class GPUEffectEngine {
    constructor(gl) {
        this.gl = gl;
        this.programs = new Map();
        this.framebuffers = [];
        this.textures = [];
        this.initialized = false;

        // Geometry buffers
        this.positionBuffer = null;
        this.texCoordBuffer = null;

        if (gl) {
            this._init();
        }
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
        gl.shaderSource(vs, VERTEX_SHADER);
        gl.compileShader(vs);

        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            console.error(`[GPUEffects] Vertex shader error:`, gl.getShaderInfoLog(vs));
            return;
        }

        // Compile fragment shader
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fragmentSrc);
        gl.compileShader(fs);

        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error(`[GPUEffects] Fragment shader error (${name}):`, gl.getShaderInfoLog(fs));
            return;
        }

        // Link program
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(`[GPUEffects] Program link error (${name}):`, gl.getProgramInfoLog(program));
            return;
        }

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
        const params = effect.getParamsAt(time);

        // Use framebuffer for output
        const fbIndex = context.fbIndex || 0;
        const outputTexture = this.textures[fbIndex];

        // Resize framebuffer texture if needed
        const width = context.width || gl.drawingBufferWidth;
        const height = context.height || gl.drawingBufferHeight;

        gl.bindTexture(gl.TEXTURE_2D, outputTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

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
        gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);

        // Set common uniforms
        gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
        gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time);

        // Set effect-specific uniforms
        this._setEffectUniforms(gl, program, effect.type, params);

        // Draw
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return outputTexture;
    }

    _setEffectUniforms(gl, program, type, params) {
        switch (type) {
            case 'blur_gaussian':
                gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), params.radius || 5);
                gl.uniform2f(gl.getUniformLocation(program, 'u_direction'), 1, 0); // Horizontal pass
                break;

            case 'blur_motion':
                gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), params.intensity || 0.5);
                gl.uniform1f(gl.getUniformLocation(program, 'u_angle'), params.angle || 0);
                gl.uniform1i(gl.getUniformLocation(program, 'u_samples'), params.samples || 16);
                break;

            case 'blur_radial':
                gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), params.intensity || 0.3);
                gl.uniform2f(gl.getUniformLocation(program, 'u_center'),
                    params.centerX || 0.5, params.centerY || 0.5);
                gl.uniform1i(gl.getUniformLocation(program, 'u_samples'), params.samples || 32);
                break;

            case 'glow':
                gl.uniform1f(gl.getUniformLocation(program, 'u_threshold'), params.threshold || 0.7);
                gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), params.intensity || 1.0);
                gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), params.radius || 10);
                const glowColor = params.color || [1, 1, 1];
                gl.uniform3f(gl.getUniformLocation(program, 'u_color'),
                    glowColor[0], glowColor[1], glowColor[2]);
                break;

            case 'vignette':
                gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), params.intensity || 0.5);
                gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), params.radius || 0.7);
                gl.uniform1f(gl.getUniformLocation(program, 'u_softness'), params.softness || 0.5);
                const vigColor = params.color || [0, 0, 0];
                gl.uniform3f(gl.getUniformLocation(program, 'u_color'),
                    vigColor[0], vigColor[1], vigColor[2]);
                break;

            case 'shake':
                gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), params.intensity || 5);
                gl.uniform1f(gl.getUniformLocation(program, 'u_frequency'), params.frequency || 10);
                gl.uniform1f(gl.getUniformLocation(program, 'u_seed'), params.randomSeed || 0);
                gl.uniform1f(gl.getUniformLocation(program, 'u_rotation'), params.rotationAmount || 0);
                break;

            case 'rgb_split':
                gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), params.amount || 5);
                gl.uniform1f(gl.getUniformLocation(program, 'u_angle'), params.angle || 0);
                gl.uniform2f(gl.getUniformLocation(program, 'u_center'),
                    params.centerX || 0.5, params.centerY || 0.5);
                break;

            case 'film_grain':
                gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), params.intensity || 0.15);
                gl.uniform1f(gl.getUniformLocation(program, 'u_size'), params.size || 1.5);
                break;

            case 'glitch':
                gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), params.intensity || 0.3);
                gl.uniform1f(gl.getUniformLocation(program, 'u_blockSize'), params.blockSize || 32);
                gl.uniform1i(gl.getUniformLocation(program, 'u_colorShift'), params.colorShift ? 1 : 0);
                gl.uniform1i(gl.getUniformLocation(program, 'u_scanlines'), params.scanlines ? 1 : 0);
                break;

            case 'color_grade':
                gl.uniform1f(gl.getUniformLocation(program, 'u_brightness'), params.brightness || 100);
                gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), params.contrast || 100);
                gl.uniform1f(gl.getUniformLocation(program, 'u_saturation'), params.saturation || 100);
                gl.uniform1f(gl.getUniformLocation(program, 'u_hueRotate'), params.hueRotate || 0);
                gl.uniform1f(gl.getUniformLocation(program, 'u_temperature'), params.temperature || 0);
                gl.uniform1f(gl.getUniformLocation(program, 'u_tint'), params.tint || 0);
                break;
        }
    }

    /**
     * Process chain of effects
     */
    processChain(effects, inputTexture, time, context = {}) {
        let current = inputTexture;
        let fbIndex = 0;

        for (const effect of effects) {
            if (effect.enabled && effect.engine === ENGINE_TYPES.GPU && effect.isActiveAt(time)) {
                current = this.processEffect(effect, current, time, { ...context, fbIndex });
                fbIndex = (fbIndex + 1) % 2;  // Ping-pong framebuffers
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

        this.initialized = false;
    }
}

export default GPUEffectEngine;
