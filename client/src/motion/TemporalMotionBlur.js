const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const surfacePools = new WeakMap();

function drawCurrentSample(ctx, timeSeconds, draw, transformAt) {
    const relative = typeof transformAt === 'function' ? transformAt(timeSeconds) : null;
    if (relative?.visible === false) return;
    if (!Number.isFinite(relative?.opacity)) return draw(ctx, timeSeconds);
    ctx.save();
    ctx.globalAlpha *= clamp(relative.opacity, 0, 1);
    draw(ctx, timeSeconds);
    ctx.restore();
}

/** Convert two resolved layer transforms into the canvas-local delta needed
 * when the preview wrapper itself remains positioned at the playhead frame. */
export function relativeMotionTransform(base, sample, frameAspect, canvasWidth) {
    if (!base || !sample) return null;
    const scale = (value, fallback = 1) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const baseXScale = scale(base.scale) * scale(base.scaleX);
    const baseYScale = scale(base.scale) * scale(base.scaleY);
    const sampleXScale = scale(sample.scale) * scale(sample.scaleX);
    const sampleYScale = scale(sample.scale) * scale(sample.scaleY);
    // A zero playhead scale has no inverse transform. Keep the sharp
    // collapsed frame rather than feeding infinities into Canvas transforms.
    if (Math.abs(baseXScale) < 1e-8 || Math.abs(baseYScale) < 1e-8) return null;
    const aspect = Math.max(0.01, Number(frameAspect) || 16 / 9);
    const dx = (Number(sample.x) - Number(base.x)) * canvasWidth / 25;
    const dy = (Number(sample.y) - Number(base.y)) * canvasWidth / (25 * aspect);
    const radians = -(Number(base.rotation) || 0) * Math.PI / 180;
    const localX = (Math.cos(radians) * dx - Math.sin(radians) * dy) / baseXScale;
    const localY = (Math.sin(radians) * dx + Math.cos(radians) * dy) / baseYScale;
    const rotation = ((Number(sample.rotation) || 0) - (Number(base.rotation) || 0)) * Math.PI / 180;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const a = cos * sampleXScale / baseXScale;
    const b = sin * sampleXScale / baseYScale;
    const c = -sin * sampleYScale / baseXScale;
    const d = cos * sampleYScale / baseYScale;
    const sampleOpacity = Number(sample.opacity);
    const opacity = Number.isFinite(sampleOpacity) ? clamp(sampleOpacity, 0, 1) : 1;
    const visible = sample.visible !== false;
    if (visible && Math.abs(opacity - 1) < 1e-5 && Math.abs(localX) < 1e-4 && Math.abs(localY) < 1e-4 && Math.abs(a - 1) < 1e-5 &&
        Math.abs(b) < 1e-5 && Math.abs(c) < 1e-5 && Math.abs(d - 1) < 1e-5) return null;
    return { x: localX, y: localY, a, b, c, d, opacity, visible };
}

/** Paint an animated gradient onto a scratch canvas and retain only the
 * source's alpha silhouette, matching the media overlay's gradient fill. */
export function drawMaskedGradient(ctx, maskSource, settings, width, height) {
    if (!ctx || !maskSource || !width || !height) return;
    const params = settings?.params || {};
    const read = (key, fallback) => {
        const value = params[key];
        return value && typeof value === 'object' && 'value' in value ? value.value : value ?? fallback;
    };
    const authoredColors = read('colors', null);
    const stops = Array.isArray(authoredColors) && authoredColors.length
        ? authoredColors
        : [read('from', read('color', '#FFFFFF')), read('to', read('color', '#000000'))];
    const angle = (Number(read('angle', 0)) || 0) * Math.PI / 180;
    const reach = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2;
    const cx = width / 2, cy = height / 2;
    const gradient = ctx.createLinearGradient(cx - Math.cos(angle) * reach, cy - Math.sin(angle) * reach,
        cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
    stops.forEach((entry, index) => {
        const color = typeof entry === 'string' ? entry : entry?.color || '#FFFFFF';
        const rawOffset = Number(entry?.offset);
        const defaultOffset = index / Math.max(1, stops.length - 1);
        gradient.addColorStop(clamp(Number.isFinite(rawOffset) ? rawOffset : defaultOffset, 0, 1), color);
    });
    ctx.save();
    ctx.globalAlpha = clamp(Number(read('opacity', 1)) || 0, 0, 1);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskSource, 0, 0, width, height);
    ctx.restore();
}

function createSurface(canvas) {
    const width = Number(canvas?.width) || 0;
    const height = Number(canvas?.height) || 0;
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    if (canvas?.ownerDocument?.createElement) {
        const surface = canvas.ownerDocument.createElement('canvas');
        surface.width = width;
        surface.height = height;
        return surface;
    }
    if (typeof canvas?.constructor === 'function') return new canvas.constructor(width, height);
    return null;
}

function surfacesFor(canvas, count) {
    let pool = surfacePools.get(canvas);
    if (!pool) { pool = []; surfacePools.set(canvas, pool); }
    while (pool.length < count) {
        const surface = createSurface(canvas);
        if (!surface) throw new Error('Canvas surfaces are unavailable');
        pool.push(surface);
    }
    for (const surface of pool) {
        if (surface.width !== canvas.width) surface.width = canvas.width;
        if (surface.height !== canvas.height) surface.height = canvas.height;
    }
    return pool;
}

/**
 * Draw a 2D graphic several times across a simulated camera shutter and
 * accumulate the samples with equal exposure. The callback receives the
 * sample time in the same local-time domain as the ordinary frame renderer.
 */
export function drawTemporalMotionBlur(ctx, settings, timeSeconds, durationSeconds, draw, transformAt = null) {
    if (!ctx || typeof draw !== 'function') return;
    if (!settings?.enabled) return draw(ctx, timeSeconds);

    const samples = Math.round(clamp(Number(settings.samples) || 5, 2, 15));
    const fps = clamp(Number(settings.frameRate) || 30, 1, 120);
    const rawShutterAngle = Number(settings.shutterAngle);
    const shutterAngle = clamp(Number.isFinite(rawShutterAngle) ? rawShutterAngle : 180, 0, 360);
    const exposure = shutterAngle / (360 * fps);
    const canvas = ctx.canvas;
    const width = Number(canvas?.width) || 0;
    const height = Number(canvas?.height) || 0;
    if (!width || !height || exposure <= 0 || typeof canvas?.constructor !== 'function') {
        return drawCurrentSample(ctx, timeSeconds, draw, transformAt);
    }

    const transform = typeof ctx.getTransform === 'function'
        ? ctx.getTransform()
        : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    // Reuse two full-resolution surfaces regardless of shutter sample count.
    // Retaining one canvas per sample scales memory needlessly with both DPR
    // and sample count (16 RGBA canvases can exceed 250 MB on a 1080p preview).
    let pool;
    try { pool = surfacesFor(canvas, 2); } catch (_) { return drawCurrentSample(ctx, timeSeconds, draw, transformAt); }
    const [surface, accumulation] = pool;
    const sampleCtx = surface.getContext?.('2d');
    const accumulationCtx = accumulation.getContext?.('2d');
    if (!sampleCtx || !accumulationCtx) return drawCurrentSample(ctx, timeSeconds, draw, transformAt);
    accumulationCtx.setTransform?.(1, 0, 0, 1, 0, 0);
    accumulationCtx.clearRect(0, 0, width, height);
    accumulationCtx.globalCompositeOperation = 'lighter';
    accumulationCtx.globalAlpha = 1 / samples;
    for (let index = 0; index < samples; index++) {
        sampleCtx.setTransform?.(1, 0, 0, 1, 0, 0);
        sampleCtx.clearRect(0, 0, width, height);
        sampleCtx.globalAlpha = 1;
        sampleCtx.globalCompositeOperation = 'source-over';
        sampleCtx.setTransform?.(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
        const offset = ((index + 0.5) / samples - 0.5) * exposure;
        const sampledTime = clamp(Number(timeSeconds) + offset, 0, Math.max(0, Number(durationSeconds) || 0));
        const relative = typeof transformAt === 'function' ? transformAt(sampledTime) : null;
        if (relative?.visible === false) continue;
        if (relative) {
            const centerX = width / 2, centerY = height / 2;
            sampleCtx.translate(centerX, centerY);
            sampleCtx.translate(Number(relative.x) || 0, Number(relative.y) || 0);
            if ([relative.a, relative.b, relative.c, relative.d].every(Number.isFinite)) {
                sampleCtx.transform(relative.a, relative.b, relative.c, relative.d, 0, 0);
            } else {
                sampleCtx.rotate((Number(relative.rotation) || 0) * Math.PI / 180);
                sampleCtx.scale(Number(relative.scaleX) || 1, Number(relative.scaleY) || 1);
            }
            sampleCtx.translate(-centerX, -centerY);
        }
        if (relative && Number.isFinite(relative.opacity)) sampleCtx.globalAlpha = clamp(relative.opacity, 0, 1);
        draw(sampleCtx, sampledTime);
        sampleCtx.globalAlpha = 1;
        accumulationCtx.drawImage(surface, 0, 0);
    }
    accumulationCtx.globalAlpha = 1;
    accumulationCtx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.setTransform?.(1, 0, 0, 1, 0, 0);
    ctx.drawImage(accumulation, 0, 0);
    ctx.restore();
}

export default { drawTemporalMotionBlur };
