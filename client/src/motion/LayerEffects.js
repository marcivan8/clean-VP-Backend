/** Shared, serialisable canvas effects for scene graphic layers. */

import { resolveEffectParameter } from './EffectTiming.js';

// This is also consumed by SceneValidator. Keeping validation tied to the
// renderer's executable set prevents scenes from being declared valid for an
// effect that this Canvas path would silently ignore.
export const GRAPHIC_EFFECT_KINDS = Object.freeze([
    'shadow', 'glow', 'blur', 'blur_gaussian', 'blur_radial', 'blur_motion',
    'shake', 'grain', 'gradient-fill', 'stroke', 'inner-shadow',
    'brightness', 'contrast', 'saturation', 'saturate', 'hue', 'hue-rotate',
    'chromatic-aberration', 'rgb_split', 'film_grain', 'motion-blur',
    'distortion', 'color_grade', 'vignette', 'glitch',
]);
const GRAPHIC_EFFECT_KIND_SET = new Set(GRAPHIC_EFFECT_KINDS);
const SHAPE_MASK_KINDS = new Set(['ellipse', 'circle', 'rectangle', 'rounded-rectangle', 'capsule', 'callout', 'polygon', 'star', 'arrow']);
const PIXEL_EFFECT_KIND_SET = new Set([
    'grain', 'film_grain', 'chromatic-aberration', 'rgb_split', 'motion-blur',
    'blur_motion', 'blur_radial', 'distortion', 'stroke', 'inner-shadow',
    'color_grade', 'vignette', 'glitch',
]);

const readNumber = (value, fallback = 0) => {
    const raw = value && typeof value === 'object' && 'value' in value ? value.value : value;
    const number = Number(raw);
    return Number.isFinite(number) ? number : fallback;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, readNumber(value)));
const hasNumericValue = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const layerCanvasCache = new WeakMap();
const scratchCanvasCache = new WeakMap();
const reportedPreviewFailures = new WeakMap();

function reportLayerPreviewFailure(sourceCanvas, effectContext, effects, reason) {
    const effectIds = effects.map(effect => effect.id || effect.kind || effect.type).filter(Boolean);
    const key = `${reason}:${effectIds.join(',')}`;
    const cacheableCanvas = sourceCanvas && (typeof sourceCanvas === 'object' || typeof sourceCanvas === 'function');
    let reported = cacheableCanvas ? reportedPreviewFailures.get(sourceCanvas) : null;
    if (!reported) {
        reported = new Set();
        if (cacheableCanvas) reportedPreviewFailures.set(sourceCanvas, reported);
    }
    if (reported.has(key)) return;
    reported.add(key);
    const warning = {
        type: 'layer_effect_preview_unavailable',
        effectIds,
        message: `${reason} Effects were skipped in the preview: ${effects.map(effect => effect.name || effect.kind || effect.type).join(', ')}.`,
        recoverable: true,
    };
    if (typeof effectContext?.onWarning === 'function') {
        try { effectContext.onWarning(warning); } catch { /* A warning observer must not break drawing. */ }
    } else if (typeof console !== 'undefined' && console.warn) {
        console.warn('[LayerEffects]', warning.message, warning);
    }
}

function sampleEffect(effect, timeSeconds, context = {}) {
    const params = effect?.params || {};
    const sampled = { ...params };
    for (const [key, raw] of Object.entries(params)) {
        const track = effect?.keyframes?.[key] || raw?.keyframes;
        const expression = effect?.expressions?.[key] ?? raw?.expression;
        if ((!Array.isArray(track) || !track.length) && typeof expression !== 'string') continue;
        const base = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
        sampled[key] = resolveEffectParameter(effect, key, base, timeSeconds, context);
    }
    // Parameters are normally initialized from EffectRegistry, but imported
    // scenes and hand-authored motion data can provide a track/expression
    // without a matching params entry. Keep this path aligned with
    // resolveEffectAtTime, which materializes those sparse controls for the
    // overlay preview.
    const animatedKeys = new Set([
        ...Object.keys(effect?.keyframes || {}),
        ...Object.keys(effect?.expressions || {}),
    ]);
    for (const key of animatedKeys) {
        if (Object.prototype.hasOwnProperty.call(sampled, key)) continue;
        const track = effect?.keyframes?.[key];
        const expression = effect?.expressions?.[key];
        if ((Array.isArray(track) && track.length) || (typeof expression === 'string' && expression.trim())) {
            sampled[key] = resolveEffectParameter(effect, key, 0, timeSeconds, context);
        }
    }
    // EffectRegistry records its discriminator as `type`; scene and timeline
    // serializers commonly use `kind`. Normalize once at the renderer boundary
    // so both authored shapes dispatch to the same preview/export operation.
    return { ...effect, kind: effect?.kind || effect?.type, params: sampled };
}

function rotateHueRgb(red, green, blue, degrees) {
    const r = red / 255, g = green / 255, b = blue / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let hue = 0, saturation = 0;
    const lightness = (max + min) / 2;
    if (delta > 0) {
        saturation = delta / (1 - Math.abs(2 * lightness - 1));
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue = ((hue / 6 + degrees / 360) % 1 + 1) % 1;
    }
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const section = hue * 6;
    const x = chroma * (1 - Math.abs(section % 2 - 1));
    let rr = 0, gg = 0, bb = 0;
    if (section < 1) [rr, gg, bb] = [chroma, x, 0];
    else if (section < 2) [rr, gg, bb] = [x, chroma, 0];
    else if (section < 3) [rr, gg, bb] = [0, chroma, x];
    else if (section < 4) [rr, gg, bb] = [0, x, chroma];
    else if (section < 5) [rr, gg, bb] = [x, 0, chroma];
    else [rr, gg, bb] = [chroma, 0, x];
    const m = lightness - chroma / 2;
    return [(rr + m) * 255, (gg + m) * 255, (bb + m) * 255];
}

function parseEffectColor(ctx, color) {
    color = color && typeof color === 'object' && 'value' in color ? color.value : color;
    if (Array.isArray(color) && color.length >= 3) {
        return color.slice(0, 3).map(channel => {
            const value = Number(channel);
            return Math.round(clamp(Number.isFinite(value) && value <= 1 ? value * 255 : value, 0, 255));
        });
    }
    const original = ctx.fillStyle;
    ctx.fillStyle = color || '#FFFFFF';
    const normalized = String(ctx.fillStyle);
    ctx.fillStyle = original;
    const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    const rgba = normalized.match(/^rgba?\(([^)]+)\)$/i);
    if (hex) {
        const value = hex[1].length === 3 ? [...hex[1]].map(ch => ch + ch).join('') : hex[1];
        return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
    }
    if (rgba) return rgba[1].split(',').slice(0, 3).map(value => clamp(value, 0, 255));
    return [255, 255, 255];
}

function getEffectCanvas(sourceCanvas) {
    if (!sourceCanvas || typeof sourceCanvas !== 'object') return null;
    const cached = layerCanvasCache.get(sourceCanvas);
    if (cached?.width === sourceCanvas.width && cached?.height === sourceCanvas.height) return cached;
    let canvas = null;
    try {
        if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(sourceCanvas.width, sourceCanvas.height);
        else if (sourceCanvas.ownerDocument?.createElement) {
            canvas = sourceCanvas.ownerDocument.createElement('canvas');
            canvas.width = sourceCanvas.width; canvas.height = sourceCanvas.height;
        } else if (sourceCanvas.constructor) canvas = new sourceCanvas.constructor(sourceCanvas.width, sourceCanvas.height);
    } catch { canvas = null; }
    if (canvas) layerCanvasCache.set(sourceCanvas, canvas);
    return canvas;
}

function getScratchCanvas(sourceCanvas) {
    const cached = scratchCanvasCache.get(sourceCanvas);
    if (cached?.width === sourceCanvas.width && cached?.height === sourceCanvas.height) return cached;
    const canvas = getEffectCanvas(sourceCanvas);
    if (canvas) scratchCanvasCache.set(sourceCanvas, canvas);
    return canvas;
}

function applyCanvasEffect(layerCtx, scratchCtx, effect, timeSeconds = 0) {
    const p = effect?.params || {};
    let filter = null, shadow = null;
    switch (effect?.kind) {
        case 'blur': case 'blur_gaussian': filter = `blur(${clamp(p.radius ?? p.amount, 0, 40)}px)`; break;
        case 'brightness': filter = `brightness(${clamp(p.amount ?? p.value ?? 1, 0, 4)})`; break;
        case 'contrast': filter = `contrast(${clamp(p.amount ?? p.value ?? 1, 0, 4)})`; break;
        case 'saturation': case 'saturate': filter = `saturate(${clamp(p.amount ?? p.value ?? 1, 0, 5)})`; break;
        case 'hue': case 'hue-rotate': filter = `hue-rotate(${clamp(p.degrees ?? p.amount, -360, 360)}deg)`; break;
        case 'shadow': shadow = { color: p.color || 'rgba(0,0,0,.55)', blur: clamp(p.blur ?? 12, 0, 100), x: clamp(p.x ?? p.offsetX, -200, 200), y: clamp(p.y ?? p.offsetY, -200, 200) }; break;
        case 'shake': {
            const time = Math.max(0, Number(timeSeconds) || 0);
            const frequency = clamp(p.frequency ?? 10, 1, 60);
            const seed = clamp(p.randomSeed ?? p.seed ?? 0, 0, 1000);
            const phase = seed * 0.61803398875;
            const scale = layerCtx.canvas.width / 1080;
            const intensity = clamp(p.intensity ?? 5, 0, 50) * scale;
            const rotation = clamp(p.rotationAmount ?? 0, 0, 180) * Math.PI / 180;
            const x = Math.sin(2 * Math.PI * time * frequency + phase) * intensity;
            const y = Math.cos(2 * Math.PI * time * frequency * 0.83 + phase + 1.7) * intensity;
            const angle = Math.sin(2 * Math.PI * time * frequency * 0.83 + phase + 1.7) * rotation;
            scratchCtx.save();
            scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
            scratchCtx.clearRect(0, 0, scratchCtx.canvas.width, scratchCtx.canvas.height);
            scratchCtx.translate(scratchCtx.canvas.width / 2 + x, scratchCtx.canvas.height / 2 + y);
            scratchCtx.rotate(angle);
            scratchCtx.drawImage(layerCtx.canvas, -layerCtx.canvas.width / 2, -layerCtx.canvas.height / 2);
            scratchCtx.restore();
            layerCtx.save();
            layerCtx.setTransform(1, 0, 0, 1, 0, 0);
            layerCtx.clearRect(0, 0, layerCtx.canvas.width, layerCtx.canvas.height);
            layerCtx.drawImage(scratchCtx.canvas, 0, 0);
            layerCtx.restore();
            return true;
        }
        case 'glow': {
            // A glow is a bloom of bright source pixels, not a shadow around
            // every opaque edge. Threshold the isolated layer, blur that mask,
            // and add it back without replacing the original image.
            let original;
            try { original = layerCtx.getImageData(0, 0, layerCtx.canvas.width, layerCtx.canvas.height); }
            catch {
                // Cross-origin media can taint the isolated canvas. Retain a
                // visible glow approximation rather than dropping the layer.
                scratchCtx.save();
                scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
                scratchCtx.clearRect(0, 0, scratchCtx.canvas.width, scratchCtx.canvas.height);
                const fallbackColor = parseEffectColor(scratchCtx, p.color || '#FFFFFF');
                scratchCtx.shadowColor = `rgba(${fallbackColor.join(',')},${clamp(p.intensity ?? 1, 0, 3) / 3})`;
                scratchCtx.shadowBlur = clamp(p.radius ?? 10, 1, 50);
                scratchCtx.drawImage(layerCtx.canvas, 0, 0);
                scratchCtx.restore();
                layerCtx.save();
                layerCtx.setTransform(1, 0, 0, 1, 0, 0);
                layerCtx.clearRect(0, 0, layerCtx.canvas.width, layerCtx.canvas.height);
                layerCtx.drawImage(scratchCtx.canvas, 0, 0);
                layerCtx.restore();
                return true;
            }
            const bloom = layerCtx.createImageData(original.width, original.height);
            bloom.data.set(original.data);
            const threshold = clamp(p.threshold ?? 0.7, 0, 1);
            const intensity = clamp(p.intensity ?? 1, 0, 3);
            const radius = clamp(p.radius ?? 10, 1, 50);
            const color = parseEffectColor(layerCtx, p.color || '#FFFFFF');
            for (let i = 0; i < bloom.data.length; i += 4) {
                const sourceAlpha = original.data[i + 3] / 255;
                const luminance = (0.2126 * original.data[i] + 0.7152 * original.data[i + 1] + 0.0722 * original.data[i + 2]) / 255;
                const span = Math.max(0.001, 1 - threshold);
                const amount = clamp((luminance - threshold) / span, 0, 1) * intensity * sourceAlpha;
                bloom.data[i] = color[0]; bloom.data[i + 1] = color[1]; bloom.data[i + 2] = color[2];
                bloom.data[i + 3] = Math.round(255 * clamp(amount, 0, 1));
            }
            scratchCtx.save();
            scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
            scratchCtx.clearRect(0, 0, scratchCtx.canvas.width, scratchCtx.canvas.height);
            scratchCtx.putImageData(bloom, 0, 0);
            scratchCtx.restore();
            layerCtx.save();
            layerCtx.setTransform(1, 0, 0, 1, 0, 0);
            layerCtx.filter = `blur(${radius}px)`;
            layerCtx.globalCompositeOperation = 'lighter';
            layerCtx.drawImage(scratchCtx.canvas, 0, 0);
            layerCtx.restore();
            return true;
        }
        default: return false;
    }
    if (filter && !('filter' in scratchCtx)) return false;
    scratchCtx.save();
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.clearRect(0, 0, scratchCtx.canvas.width, scratchCtx.canvas.height);
    if (filter) scratchCtx.filter = filter;
    if (shadow) {
        scratchCtx.shadowColor = shadow.color;
        scratchCtx.shadowBlur = shadow.blur;
        scratchCtx.shadowOffsetX = shadow.x;
        scratchCtx.shadowOffsetY = shadow.y;
    }
    scratchCtx.drawImage(layerCtx.canvas, 0, 0);
    scratchCtx.restore();
    layerCtx.save();
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.clearRect(0, 0, layerCtx.canvas.width, layerCtx.canvas.height);
    layerCtx.drawImage(scratchCtx.canvas, 0, 0);
    layerCtx.restore();
    return true;
}

function applyPixelEffects(ctx, effects, timeSeconds = 0) {
    const requested = (effects || []).filter(e => ['grain', 'film_grain', 'chromatic-aberration', 'rgb_split', 'motion-blur', 'blur_motion', 'blur_radial', 'distortion', 'stroke', 'inner-shadow', 'color_grade', 'vignette', 'glitch'].includes(e?.kind));
    if (!requested.length || !ctx.canvas?.width || !ctx.canvas?.height) return true;
    try {
        const { width, height } = ctx.canvas;
        const image = ctx.getImageData(0, 0, width, height);
        const src = new Uint8ClampedArray(image.data);
        const out = image.data;
        for (const effect of requested) {
            // Effects in a stack must consume the previous effect's result,
            // while each individual effect still needs a stable source copy
            // for spatial sampling. Refresh this reusable snapshot per stage.
            src.set(out);
            const p = effect.params || {};
            if (effect.kind === 'grain' || effect.kind === 'film_grain') {
                const intensity = readNumber(p.intensity, NaN);
                const amount = clamp(effect.kind === 'film_grain'
                    ? (Number.isFinite(intensity) ? intensity * 48 : 7.2)
                    : (p.amount ?? 8), 0, 48);
                const baseSeed = readNumber(p.seed, 941) >>> 0;
                if (effect.kind === 'film_grain') {
                    const animated = p.animated?.value ?? p.animated;
                    const frameIndex = animated === false ? 0 : Math.floor(Math.max(0, Number(timeSeconds) || 0) * 30);
                    const size = clamp(p.size ?? 1.5, 0.5, 5);
                    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                        const i = (y * width + x) * 4;
                        if (!src[i + 3]) continue;
                        let seed = (baseSeed ^ Math.imul(Math.floor(x / size) + 1, 0x9e3779b1)
                            ^ Math.imul(Math.floor(y / size) + 1, 0x85ebca6b)
                            ^ Math.imul(frameIndex + 1, 0xc2b2ae35)) >>> 0;
                        seed = (seed * 1664525 + 1013904223) >>> 0;
                        const noise = ((seed >>> 24) / 255 - 0.5) * amount;
                        out[i] = src[i] + noise; out[i + 1] = src[i + 1] + noise; out[i + 2] = src[i + 2] + noise;
                    }
                } else {
                    const frameIndex = Math.floor(Math.max(0, Number(timeSeconds) || 0) * 1000);
                    let seed = (baseSeed ^ Math.imul(frameIndex + 1, 0x9e3779b1)) >>> 0;
                    for (let i = 0; i < out.length; i += 4) {
                        seed = (seed * 1664525 + 1013904223) >>> 0;
                        const noise = ((seed >>> 24) / 255 - 0.5) * amount;
                        if (out[i + 3]) {
                            out[i] = src[i] + noise; out[i + 1] = src[i + 1] + noise; out[i + 2] = src[i + 2] + noise;
                        }
                    }
                }
            } else if (effect.kind === 'chromatic-aberration') {
                const shift = Math.round(clamp(p.amount ?? 2, 0, 12));
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    const red = (y * width + Math.max(0, Math.min(width - 1, x - shift))) * 4;
                    const blue = (y * width + Math.max(0, Math.min(width - 1, x + shift))) * 4;
                    out[i] = src[red]; out[i + 2] = src[blue];
                }
            } else if (effect.kind === 'rgb_split') {
                const distance = clamp(p.amount ?? 5, 0, 50);
                const angle = readNumber(p.angle) * Math.PI / 180;
                const centerX = clamp(p.centerX ?? 0.5, 0, 1);
                const centerY = clamp(p.centerY ?? 0.5, 0, 1);
                const dx = Math.cos(angle) * distance;
                const dy = Math.sin(angle) * distance;
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    const radialDistance = Math.hypot(x / width - centerX, y / height - centerY);
                    const redX = Math.max(0, Math.min(width - 1, Math.round(x + dx * radialDistance)));
                    const redY = Math.max(0, Math.min(height - 1, Math.round(y + dy * radialDistance)));
                    const blueX = Math.max(0, Math.min(width - 1, Math.round(x - dx * radialDistance)));
                    const blueY = Math.max(0, Math.min(height - 1, Math.round(y - dy * radialDistance)));
                    out[i] = src[(redY * width + redX) * 4];
                    out[i + 2] = src[(blueY * width + blueX) * 4];
                }
            } else if (effect.kind === 'motion-blur' || effect.kind === 'blur_motion') {
                const angle = readNumber(p.angle) * Math.PI / 180;
                const directional = effect.kind === 'blur_motion';
                const samples = Math.round(clamp(p.samples ?? 16, 4, 64));
                const intensity = clamp(p.intensity ?? 0.5, 0, 1);
                const radius = Math.round(clamp(p.amount ?? 2, 1, 8));
                const extentX = directional ? Math.cos(angle) * intensity * 0.1 * width : Math.cos(angle) * radius;
                // Use the horizontal pixel span for both axes, matching the
                // GPU shader's pixel-space shutter vector. Scaling Y by frame
                // height made the same authored angle turn steeper on portrait
                // footage and disagree with preview/export on CPU renderers.
                const extentY = directional ? Math.sin(angle) * intensity * 0.1 * width : Math.sin(angle) * radius;
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    if (!directional) {
                        const ax = Math.max(0, Math.min(width - 1, Math.round(x - extentX))); const ay = Math.max(0, Math.min(height - 1, Math.round(y - extentY)));
                        const bx = Math.max(0, Math.min(width - 1, Math.round(x + extentX))); const by = Math.max(0, Math.min(height - 1, Math.round(y + extentY)));
                        const a = (ay * width + ax) * 4; const b = (by * width + bx) * 4;
                        const alpha = (src[a + 3] + src[i + 3] * 2 + src[b + 3]) / 4;
                        out[i + 3] = alpha;
                        for (let c = 0; c < 3; c++) {
                            const premultiplied = (src[a + c] * src[a + 3]
                                + src[i + c] * src[i + 3] * 2
                                + src[b + c] * src[b + 3]) / 4;
                            out[i + c] = alpha > 0 ? premultiplied / alpha : 0;
                        }
                        continue;
                    }
                    let alpha = 0, red = 0, green = 0, blue = 0;
                    for (let sample = 0; sample < samples; sample++) {
                        const progress = samples > 1 ? sample / (samples - 1) - 0.5 : 0;
                        const sx = Math.max(0, Math.min(width - 1, Math.round(x + extentX * progress)));
                        const sy = Math.max(0, Math.min(height - 1, Math.round(y + extentY * progress)));
                        const source = (sy * width + sx) * 4;
                        const sampleAlpha = src[source + 3] / samples;
                        alpha += sampleAlpha;
                        red += src[source] * sampleAlpha;
                        green += src[source + 1] * sampleAlpha;
                        blue += src[source + 2] * sampleAlpha;
                    }
                    out[i + 3] = alpha;
                    out[i] = alpha > 0 ? red / alpha : 0;
                    out[i + 1] = alpha > 0 ? green / alpha : 0;
                    out[i + 2] = alpha > 0 ? blue / alpha : 0;
                }
            } else if (effect.kind === 'blur_radial') {
                const intensity = clamp(p.intensity ?? 0.3, 0, 1);
                const centerX = clamp(p.centerX ?? 0.5, 0, 1) * (width - 1);
                const centerY = clamp(p.centerY ?? 0.5, 0, 1) * (height - 1);
                // Keep the software renderer in step with EffectRegistry and the
                // WebGL shader. The old 4..8 clamp silently ignored most of the
                // authored quality range (8..64) during export.
                const samples = Math.round(clamp(p.samples ?? 32, 8, 64));
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    if (!src[i + 3]) continue;
                    let r = 0, g = 0, b = 0, a = 0;
                    for (let sample = 0; sample < samples; sample++) {
                        // Match the WebGL shader: samples travel up to half
                        // the authored intensity toward the center, with the
                        // endpoint excluded (sample / samples). Keeping this
                        // convention also makes the software fallback's edge
                        // alpha behave like texture sampling in the GPU path.
                        const t = sample / samples * intensity * 0.5;
                        const sx = Math.max(0, Math.min(width - 1, Math.round(x + (centerX - x) * t)));
                        const sy = Math.max(0, Math.min(height - 1, Math.round(y + (centerY - y) * t)));
                        const from = (sy * width + sx) * 4;
                        const sampleAlpha = src[from + 3];
                        r += src[from] * sampleAlpha; g += src[from + 1] * sampleAlpha; b += src[from + 2] * sampleAlpha; a += sampleAlpha;
                    }
                    const alpha = a / samples;
                    out[i] = a > 0 ? r / a : 0; out[i + 1] = a > 0 ? g / a : 0;
                    out[i + 2] = a > 0 ? b / a : 0; out[i + 3] = alpha;
                }
            } else if (effect.kind === 'distortion') {
                const amount = clamp(p.amount ?? 0.018, 0, 0.08);
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    const waveX = Math.round(Math.sin(y * 0.045 + readNumber(p.phase)) * amount * width);
                    const waveY = Math.round(Math.sin(x * 0.04) * amount * height);
                    const sx = Math.max(0, Math.min(width - 1, x + waveX)); const sy = Math.max(0, Math.min(height - 1, y + waveY));
                    const from = (sy * width + sx) * 4; const to = (y * width + x) * 4;
                    out[to] = src[from]; out[to + 1] = src[from + 1]; out[to + 2] = src[from + 2];
                    out[to + 3] = src[from + 3];
                }
            } else if (effect.kind === 'color_grade') {
                const brightness = clamp(p.brightness ?? 100, 0, 300) / 100;
                const contrast = clamp(p.contrast ?? 100, 0, 300) / 100;
                const saturation = clamp(p.saturation ?? 100, 0, 300) / 100;
                const hueRotate = clamp(p.hueRotate ?? 0, -180, 180);
                const temperature = clamp(p.temperature ?? 0, -100, 100) * 0.003 * 255;
                const tint = clamp(p.tint ?? 0, -100, 100) * 0.003 * 255;
                for (let i = 0; i < out.length; i += 4) {
                    if (!src[i + 3]) continue;
                    const r = src[i] * brightness, g = src[i + 1] * brightness, b = src[i + 2] * brightness;
                    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    let red = (y + (r - y) * saturation - 128) * contrast + 128;
                    let green = (y + (g - y) * saturation - 128) * contrast + 128;
                    let blue = (y + (b - y) * saturation - 128) * contrast + 128;
                    if (hueRotate) [red, green, blue] = rotateHueRgb(red, green, blue, hueRotate);
                    out[i] = red + temperature;
                    out[i + 1] = green + tint;
                    out[i + 2] = blue - temperature;
                }
            } else if (effect.kind === 'vignette') {
                const intensity = clamp(p.intensity ?? 0.5, 0, 1);
                const radius = clamp(p.radius ?? 0.7, 0.05, 1.5);
                const softness = clamp(p.softness ?? 0.5, 0.01, 1);
                const color = parseEffectColor(ctx, p.color || '#000000');
                const cx = (width - 1) / 2, cy = (height - 1) / 2;
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    if (!src[i + 3]) continue;
                    const distance = Math.hypot((x - cx) / (cx || 1), (y - cy) / (cy || 1)) / Math.SQRT2;
                    const edge = clamp((distance - radius * 0.65) / softness, 0, 1) * intensity;
                    for (let c = 0; c < 3; c++) out[i + c] = src[i + c] * (1 - edge) + color[c] * edge;
                }
            } else if (effect.kind === 'glitch') {
                const amount = clamp(p.amount ?? readNumber(p.intensity, 0.2) * 40, 0, 32);
                const frame = Math.floor(Math.max(0, Number(timeSeconds) || 0) * 12);
                const seed = readNumber(p.seed, 17);
                for (let y = 0; y < height; y++) {
                    const wave = Math.sin(y * 12.9898 + frame * 78.233 + seed * 0.17);
                    const active = Math.sin(y * 0.37 + frame * 2.1 + seed) > 0.72;
                    const shift = active ? Math.round(wave * amount) : 0;
                    for (let x = 0; x < width; x++) {
                        const i = (y * width + x) * 4;
                        const sx = Math.max(0, Math.min(width - 1, x + shift));
                        const from = (y * width + sx) * 4;
                        if (!src[i + 3] && !src[from + 3]) continue;
                        out[i] = src[from]; out[i + 1] = src[from + 1]; out[i + 2] = src[from + 2]; out[i + 3] = src[from + 3];
                    }
                }
            } else if (effect.kind === 'stroke') {
                const radius = Math.round(clamp(p.width ?? p.amount ?? 2, 1, 12));
                const opacity = clamp(p.opacity ?? 1, 0, 1);
                const horizontal = new Uint8Array(width * height), expanded = new Uint8Array(width * height);
                const queue = new Int32Array(Math.max(width, height));
                for (let y = 0; y < height; y++) {
                    let head = 0, tail = 0, next = 0;
                    for (let x = 0; x < width; x++) {
                        const right = Math.min(width - 1, x + radius);
                        while (next <= right) {
                            const alpha = src[(y * width + next) * 4 + 3];
                            while (tail > head && src[(y * width + queue[tail - 1]) * 4 + 3] <= alpha) tail--;
                            queue[tail++] = next++;
                        }
                        while (tail > head && queue[head] < x - radius) head++;
                        horizontal[y * width + x] = src[(y * width + queue[head]) * 4 + 3];
                    }
                }
                for (let x = 0; x < width; x++) {
                    let head = 0, tail = 0, next = 0;
                    for (let y = 0; y < height; y++) {
                        const bottom = Math.min(height - 1, y + radius);
                        while (next <= bottom) {
                            const alpha = horizontal[next * width + x];
                            while (tail > head && horizontal[queue[tail - 1] * width + x] <= alpha) tail--;
                            queue[tail++] = next++;
                        }
                        while (tail > head && queue[head] < y - radius) head++;
                        expanded[y * width + x] = horizontal[queue[head] * width + x];
                    }
                }
                const rgb = parseEffectColor(ctx, p.color);
                for (let i = 0; i < expanded.length; i++) {
                    if (src[i * 4 + 3] > 0 || expanded[i] === 0) continue;
                    out[i * 4] = rgb[0]; out[i * 4 + 1] = rgb[1]; out[i * 4 + 2] = rgb[2];
                    out[i * 4 + 3] = expanded[i] * opacity;
                }
            } else if (effect.kind === 'inner-shadow') {
                const offsetX = clamp(p.x ?? p.offsetX, -80, 80), offsetY = clamp(p.y ?? p.offsetY, -80, 80);
                const radius = Math.round(clamp(p.blur ?? p.radius, 0, 16));
                const opacity = clamp(p.opacity ?? 0.65, 0, 1), color = parseEffectColor(ctx, p.color || '#000000');
                const taps = radius > 0 ? [[-1,-1],[0,-1],[1,-1],[-1,0],[0,0],[1,0],[-1,1],[0,1],[1,1]] : [[0,0]];
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    if (!src[i + 3]) continue;
                    let outside = 0;
                    for (const [tx, ty] of taps) {
                        const sx = Math.round(x - offsetX + tx * radius / 2), sy = Math.round(y - offsetY + ty * radius / 2);
                        outside += (sx < 0 || sx >= width || sy < 0 || sy >= height) ? 1 : 1 - src[(sy * width + sx) * 4 + 3] / 255;
                    }
                    const shade = clamp(outside / taps.length * opacity, 0, 1);
                    for (let channel = 0; channel < 3; channel++) out[i + channel] = src[i + channel] * (1 - shade) + color[channel] * shade;
                }
            }
            src.set(out);
        }
        ctx.putImageData(image, 0, 0);
    } catch (error) {
        // Pixel effects cannot be applied to a tainted cross-origin surface.
        // Let the caller report this through the same warning channel as other
        // preview failures so the authored effect is never silently ignored.
        return false;
    }
    return true;
}

function applyGradientFill(ctx, effect, width, height) {
    const p = effect?.params || {};
    const colors = Array.isArray(p.colors) && p.colors.length ? p.colors : [p.from || p.color || '#FFFFFF', p.to || p.color || '#000000'];
    const angle = readNumber(p.angle) * Math.PI / 180;
    const dx = Math.cos(angle) * width / 2, dy = Math.sin(angle) * height / 2;
    const gradient = ctx.createLinearGradient(width / 2 - dx, height / 2 - dy, width / 2 + dx, height / 2 + dy);
    colors.forEach((entry, index) => {
        const color = typeof entry === 'string' ? entry : entry?.color;
        if (color) gradient.addColorStop(clamp(entry?.offset ?? index / Math.max(1, colors.length - 1), 0, 1), color);
    });
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha *= clamp(p.opacity ?? 1, 0, 1);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

/**
 * Draw one graphic layer with the supported scene effects applied. Canvas
 * filters and shadow state are available in both Chromium and Skia, keeping
 * preview and export on the same implementation.
 */
function traceShapeMask(ctx, mask, width, height) {
    if (mask?.kind !== 'shape' || !SHAPE_MASK_KINDS.has(mask.shape)) return;
    const inset = clamp(mask.inset ?? 0, 0, 0.45);
    const hasX = hasNumericValue(mask.x), hasY = hasNumericValue(mask.y);
    const x = hasX ? Number(mask.x) * width : width * inset;
    const y = hasY ? Number(mask.y) * height : height * inset;
    const w = hasNumericValue(mask.w) ? Number(mask.w) * width : width - x - (hasX ? 0 : width * inset);
    const h = hasNumericValue(mask.h) ? Number(mask.h) * height : height - y - (hasY ? 0 : height * inset);
    if (mask.shape === 'ellipse' || mask.shape === 'circle') {
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (mask.shape === 'rounded-rectangle' || mask.shape === 'capsule') {
        const radius = mask.shape === 'capsule'
            ? Math.min(w, h) / 2
            : Math.max(0, Math.min(0.5, Number(mask.radius ?? mask.roundness ?? 0.12))) * Math.min(w, h);
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, radius);
        else {
            const r = Math.min(radius, w / 2, h / 2);
            ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        }
    } else if (mask.shape === 'callout') {
        const tail = h * 0.2, bottom = y + h - tail, radius = Math.min(w, bottom - y) * 0.12, tx = x + w * 0.28;
        ctx.moveTo(x + radius, y); ctx.lineTo(x + w - radius, y); ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, bottom - radius); ctx.quadraticCurveTo(x + w, bottom, x + w - radius, bottom);
        ctx.lineTo(tx + tail * 0.55, bottom); ctx.lineTo(tx, y + h); ctx.lineTo(tx - tail * 0.55, bottom);
        ctx.lineTo(x + radius, bottom); ctx.quadraticCurveTo(x, bottom, x, bottom - radius);
        ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y);
    } else if (mask.shape === 'polygon' || mask.shape === 'star' || mask.shape === 'arrow') {
        const cx = x + w / 2, cy = y + h / 2;
        const rotation = (Number(mask.rotation) || 0) * Math.PI / 180 - Math.PI / 2;
        let vertices;
        if (mask.shape === 'arrow') {
            const points = [
                [x, cy - h * 0.16], [x + w * 0.58, cy - h * 0.16], [x + w * 0.58, y],
                [x + w, cy], [x + w * 0.58, y + h], [x + w * 0.58, cy + h * 0.16], [x, cy + h * 0.16],
            ];
            vertices = points.map(([px, py]) => {
                const dx = px - cx, dy = py - cy;
                return [cx + dx * Math.cos(rotation) - dy * Math.sin(rotation), cy + dx * Math.sin(rotation) + dy * Math.cos(rotation)];
            });
        } else {
            const count = mask.shape === 'star'
                ? Math.max(2, Math.min(64, Math.round(Number(mask.points) || 5))) * 2
                : Math.max(3, Math.min(128, Math.round(Number(mask.sides) || 5)));
            const outerRatio = Math.max(0.01, Math.min(0.5, Number(mask.outerRadius ?? mask.radius ?? 0.5)));
            const innerRatio = Math.max(0.005, Math.min(outerRatio, Number(mask.innerRadius ?? outerRatio * 0.5)));
            const outer = Math.min(w, h) * outerRatio, inner = Math.min(w, h) * innerRatio;
            vertices = Array.from({ length: count }, (_, index) => {
                const radius = mask.shape === 'star' && index % 2 ? inner : outer;
                const angleStep = mask.shape === 'star' ? Math.PI / (count / 2) : (2 * Math.PI) / count;
                const angle = rotation + index * angleStep;
                return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
            });
        }
        vertices.forEach(([px, py], index) => index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
        ctx.closePath();
    } else ctx.rect(x, y, w, h);
    return true;
}

function applyShapeMask(ctx, mask, width, height) {
    if (mask?.kind !== 'shape' || !SHAPE_MASK_KINDS.has(mask.shape)) return;
    if (mask.invert) {
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        traceShapeMask(ctx, mask, width, height);
        ctx.clip('evenodd');
    } else {
        ctx.beginPath();
        traceShapeMask(ctx, mask, width, height);
        ctx.clip();
    }
}

function applyFeatheredShapeMask(layerCtx, scratchCtx, mask, width, height, transform) {
    if (!layerCtx || !scratchCtx) return false;
    const feather = clamp(mask?.feather ?? 0, 0, 0.25);
    scratchCtx.save();
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.globalCompositeOperation = 'source-over';
    scratchCtx.globalAlpha = 1;
    scratchCtx.filter = 'none';
    scratchCtx.clearRect(0, 0, scratchCtx.canvas.width, scratchCtx.canvas.height);
    if (mask.invert) {
        scratchCtx.fillStyle = '#FFFFFF';
        scratchCtx.fillRect(0, 0, scratchCtx.canvas.width, scratchCtx.canvas.height);
    }
    if (transform) scratchCtx.setTransform(transform);
    scratchCtx.globalCompositeOperation = mask.invert ? 'destination-out' : 'source-over';
    scratchCtx.fillStyle = '#FFFFFF';
    if (feather > 0 && 'filter' in scratchCtx) {
        scratchCtx.filter = `blur(${feather * Math.min(width, height)}px)`;
    }
    scratchCtx.beginPath();
    traceShapeMask(scratchCtx, mask, width, height);
    scratchCtx.fill();
    scratchCtx.restore();

    layerCtx.save();
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.globalAlpha = 1;
    layerCtx.globalCompositeOperation = 'destination-in';
    layerCtx.drawImage(scratchCtx.canvas, 0, 0);
    layerCtx.restore();
    return true;
}

export function drawLayerWithEffects(ctx, effects, draw, mask = null, timeSeconds = 0, effectContext = {}) {
    if (!ctx || typeof draw !== 'function') return;
    // The editor and FFmpeg compiler treat `order` as the authored stack
    // order. Match that here so canvas previews and exports compose identically
    // even when clips were reordered without also reordering their array.
    const stack = (Array.isArray(effects) ? effects : [])
        .map((effect, index) => ({ effect, index }))
        .sort((a, b) => (Number(a.effect?.order) || 0) - (Number(b.effect?.order) || 0) || a.index - b.index)
        .map(({ effect }) => effect);
    const activeStack = stack.filter(effect => {
        const hasStart = effect?.startTime !== null && effect?.startTime !== undefined && effect?.startTime !== '';
        const hasEnd = effect?.endTime !== null && effect?.endTime !== undefined && effect?.endTime !== '';
        const startTime = hasStart ? Number(effect.startTime) : -Infinity;
        const endTime = hasEnd ? Number(effect.endTime) : Infinity;
        return effect?.enabled !== false
            && GRAPHIC_EFFECT_KIND_SET.has(effect?.kind || effect?.type)
            && !(Number.isFinite(startTime) && timeSeconds < startTime)
            && !(Number.isFinite(endTime) && timeSeconds >= endTime);
    });
    // Effects are evaluated on an isolated surface, but the finished surface
    // still belongs to the caller's layer. Preserve its layer-level blend and
    // opacity at the final composite instead of silently making it opaque.
    const compositeAlpha = ctx.globalAlpha;
    const compositeOperation = ctx.globalCompositeOperation;
    const sourceCanvas = ctx.canvas;
    const layerCanvas = getEffectCanvas(sourceCanvas);
    const layerCtx = layerCanvas?.getContext?.('2d', { willReadFrequently: true });
    const scratchCanvas = layerCanvas ? getScratchCanvas(layerCanvas) : null;
    const scratchCtx = scratchCanvas?.getContext?.('2d');
    if (!layerCtx && activeStack.length) {
        reportLayerPreviewFailure(sourceCanvas, effectContext, activeStack, 'The isolated layer surface is unavailable.');
    } else if (layerCtx && !scratchCtx) {
        const scratchDependent = activeStack.filter(effect => (effect.kind || effect.type) !== 'gradient-fill'
            && !PIXEL_EFFECT_KIND_SET.has(effect.kind || effect.type));
        if (scratchDependent.length) {
            reportLayerPreviewFailure(sourceCanvas, effectContext, scratchDependent, 'The layer effect scratch surface is unavailable.');
        }
    }
    // Isolate layer effects whenever an offscreen surface is available. This
    // prevents pixel effects from rewriting pixels belonging to earlier layers.
    const target = layerCtx || ctx;
    if (layerCtx) {
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
    }
    target.save();
    const transform = ctx.getTransform?.();
    if (layerCtx && transform) target.setTransform(transform);
    const width = (ctx.canvas?.width || 0) / (Math.hypot(transform?.a || 0, transform?.b || 0) || 1);
    const height = (ctx.canvas?.height || 0) / (Math.hypot(transform?.c || 0, transform?.d || 0) || 1);
    const validMask = mask?.kind === 'shape' && SHAPE_MASK_KINDS.has(mask.shape);
    const featheredMask = !!(layerCtx && validMask && Number(mask.feather) > 0);
    if (!featheredMask) applyShapeMask(target, mask, width, height);
    let targetRestored = false;
    try {
        draw(target);
        target.restore();
        targetRestored = true;

        if (layerCtx && layerCtx !== ctx) {
            if (featheredMask) applyFeatheredShapeMask(layerCtx, scratchCtx, mask, width, height, transform);
            const activeEffects = [];
            for (const authoredEffect of stack) {
                const hasStart = authoredEffect?.startTime !== null && authoredEffect?.startTime !== undefined && authoredEffect?.startTime !== '';
                const hasEnd = authoredEffect?.endTime !== null && authoredEffect?.endTime !== undefined && authoredEffect?.endTime !== '';
                const startTime = hasStart ? Number(authoredEffect.startTime) : -Infinity;
                const endTime = hasEnd ? Number(authoredEffect.endTime) : Infinity;
                if ((Number.isFinite(startTime) && timeSeconds < startTime)
                    || (Number.isFinite(endTime) && timeSeconds >= endTime)) continue;
                const effect = sampleEffect(authoredEffect, timeSeconds, effectContext);
                if (!effect || effect.enabled === false) continue;
                // Unknown effects are rejected by SceneValidator, but also
                // fail closed here for callers that render clips directly.
                if (!GRAPHIC_EFFECT_KIND_SET.has(effect.kind)) continue;
                activeEffects.push(effect);
            }
            // Pixel effects are sequential but share a single ImageData buffer.
            // Reading/copying an HD canvas once per effect caused a large
            // synchronous cost when creative stacks contained several filters.
            // Keep non-pixel effects as boundaries because their ordering is
            // visually significant (for example, stroke before blur).
            for (let index = 0; index < activeEffects.length;) {
                const effect = activeEffects[index];
                if (PIXEL_EFFECT_KIND_SET.has(effect.kind)) {
                    const pixelStack = [];
                    while (index < activeEffects.length && PIXEL_EFFECT_KIND_SET.has(activeEffects[index].kind)) {
                        pixelStack.push(activeEffects[index++]);
                    }
                    if (!applyPixelEffects(layerCtx, pixelStack, timeSeconds)) {
                        reportLayerPreviewFailure(sourceCanvas, effectContext, pixelStack,
                            'The layer pixels cannot be read by the browser (often due to cross-origin media).');
                    }
                } else {
                    if (effect.kind === 'gradient-fill') applyGradientFill(layerCtx, effect, layerCanvas.width, layerCanvas.height);
                    else if (scratchCtx) {
                        if (!applyCanvasEffect(layerCtx, scratchCtx, effect, timeSeconds)) {
                            reportLayerPreviewFailure(sourceCanvas, effectContext, [effect], 'This effect is unavailable in the current canvas preview.');
                        }
                    }
                    index++;
                }
            }
        } // No offscreen surface means effects are skipped rather than applied to earlier layers.
    } catch (error) {
        if (!targetRestored) target.restore();
        throw error;
    }
    if (layerCtx) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = compositeAlpha;
        ctx.globalCompositeOperation = compositeOperation;
        ctx.drawImage(layerCanvas, 0, 0);
        ctx.restore();
    }
}
