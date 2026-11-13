/**
 * server/compositor/TemplateRenderer.js
 *
 * R89 (to-do A5) — renders a template overlay (counter, price pop, logo card,
 * code window) to a PNG sequence for the compositor (STEP 2.5). The drawing is
 * client/src/motion/TemplateGraphics.js itself, loaded with a dynamic import(),
 * the same function the preview canvas runs every frame. @napi-rs/canvas is
 * Skia like Chrome, and the fonts are the same files the editor's @font-face
 * rules load, registered under the same family names.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const GRAPHICS_PATH = path.join(ROOT, 'client', 'src', 'motion', 'TemplateGraphics.js');
const RICH_TEXT_PATH = path.join(ROOT, 'client', 'src', 'motion', 'RichTextEngine.js');
const LAYER_EFFECTS_PATH = path.join(ROOT, 'client', 'src', 'motion', 'LayerEffects.js');
const SCENE_3D_PATH = path.join(ROOT, 'client', 'src', 'motion', 'Scene3D.js');
const FONT_DIR = path.join(ROOT, 'client', 'public', 'fonts');

// Family name → file. Must match client/src/index.css (@font-face) and
// TEMPLATE_FONTS in TemplateGraphics.js.
const FONT_FILES = {
    'Anton': 'Anton-Regular.ttf',
    'Montserrat': 'Montserrat-Bold.ttf',
    'Inter': 'Inter-Regular.ttf',
    'JetBrains Mono': '2fc98a00-b314-4999-a8a1-f9fa9f814297.woff2', // latin subset
};

// Extended fonts available in client/public/fonts/ for rich text and typography
const EXTENDED_FONT_FILES = {
    'Bebas Neue': 'BebasNeue-Regular.ttf',
    'Oswald': 'Oswald-Regular.ttf',
    'Poppins': 'Poppins-Regular.ttf',
    'Roboto': 'Roboto-Regular.ttf',
    'Playfair Display': 'PlayfairDisplay-Regular.ttf',
    'Nunito': 'Nunito-Regular.ttf',
    'Caveat': 'Caveat-Regular.ttf',
    'DM Sans': 'DMSans-Regular.ttf',
    'JetBrainsMono': 'JetBrainsMono-Regular.ttf',
};

// Common system aliases mapped to bundled TTFs for environments without system fonts (e.g. Linux CI)
const SYSTEM_FONT_ALIASES = {
    'Arial': 'Inter-Regular.ttf',
    'sans-serif': 'Inter-Regular.ttf',
    'Helvetica': 'Inter-Regular.ttf',
    'default': 'Inter-Regular.ttf',
};

let graphicsPromise = null;
let richTextPromise = null;
let layerEffectsPromise = null;
let scene3dPromise = null;
let temporalBlurPromise = null;
let fontsRegistered = false;

function loadTemplateGraphics() {
    if (!graphicsPromise) graphicsPromise = import(pathToFileURL(GRAPHICS_PATH).href);
    return graphicsPromise;
}

function loadRichTextEngine() {
    if (!richTextPromise) richTextPromise = import(pathToFileURL(RICH_TEXT_PATH).href);
    return richTextPromise;
}

function loadLayerEffects() {
    if (!layerEffectsPromise) layerEffectsPromise = import(pathToFileURL(LAYER_EFFECTS_PATH).href);
    return layerEffectsPromise;
}

function loadScene3D() {
    if (!scene3dPromise) scene3dPromise = import(pathToFileURL(SCENE_3D_PATH).href);
    return scene3dPromise;
}

function loadTemporalMotionBlur() {
    const file = path.join(ROOT, 'client', 'src', 'motion', 'TemporalMotionBlur.js');
    if (!temporalBlurPromise) temporalBlurPromise = import(pathToFileURL(file).href);
    return temporalBlurPromise;
}

function registerFonts(CanvasModule) {
    const C = CanvasModule || (typeof require !== 'undefined' ? require('@napi-rs/canvas') : null);
    if (!C?.GlobalFonts?.registerFromPath) return;
    if (fontsRegistered) return;
    for (const [family, file] of Object.entries(FONT_FILES)) {
        const p = path.join(FONT_DIR, file);
        if (!fs.existsSync(p)) { console.warn(`[TemplateRenderer] font file missing: ${file}`); continue; }
        try { C.GlobalFonts.registerFromPath(p, family); } catch { }
    }
    for (const [family, file] of Object.entries(EXTENDED_FONT_FILES)) {
        const p = path.join(FONT_DIR, file);
        if (fs.existsSync(p)) {
            try { C.GlobalFonts.registerFromPath(p, family); } catch { }
        }
    }
    for (const [family, file] of Object.entries(SYSTEM_FONT_ALIASES)) {
        const p = path.join(FONT_DIR, file);
        if (fs.existsSync(p)) {
            try { C.GlobalFonts.registerFromPath(p, family); } catch { }
        }
    }
    fontsRegistered = true;
}

/**
 * @param {object} template { kind, params }
 * @param {object} opts
 *   durationSec, fps, widthPx (output width of the template box), tmpDir, name
 *   imageFiles: { [url]: localPath } for logo-card images already downloaded
 *   canvasModule: injectable for tests
 * @returns {Promise<{pattern:string, frames:number, width:number, height:number, files:string[]}>}
 */
async function renderTemplateFrames(template, opts) {
    const Canvas = opts.canvasModule || require('@napi-rs/canvas');
    registerFonts(Canvas);
    const kind = template?.kind;
    const params = template.params || {};
    const richText = kind === 'rich-text';
    const G = richText ? await loadRichTextEngine() : await loadTemplateGraphics();
    const FX = await loadLayerEffects();
    const MB = await loadTemporalMotionBlur();
    if (!richText && !G.TEMPLATE_KINDS.includes(kind)) throw new Error(`unknown template kind "${kind}"`);
    const size = richText
        ? { w: Number(params.w) || 1080, h: Number(params.h) || 480 }
        : G.templateSize(kind, params);
    const fps = Number(opts.fps) > 0 ? Number(opts.fps) : 30;
    const duration = Math.max(0.2, Number(opts.durationSec) || 3);
    // Draw at the size the box will occupy in the output (even pixels).
    const scale = Math.max(0.1, (Number(opts.widthPx) || size.w) / size.w);
    const W = Math.max(2, Math.round(size.w * scale / 2) * 2);
    const H = Math.max(2, Math.round(size.h * scale / 2) * 2);

    const images = {};
    for (const [url, file] of Object.entries(opts.imageFiles || {})) {
        try { images[url] = await Canvas.loadImage(fs.readFileSync(file)); }
        catch (err) { console.warn(`[TemplateRenderer] logo image unreadable (${url}):`, err.message); }
    }

    const dir = path.join(opts.tmpDir, `tpl-${opts.name || kind}`);
    fs.mkdirSync(dir, { recursive: true });
    const frames = Math.max(1, Math.ceil(duration * fps));
    const files = [];
    const videoImages = new Map();
    const sceneVideoObjects = (params.scene?.objects || []).filter(object => object?.type === 'video');
    const { resolveSceneVideoSourceTime, getSceneShutterSampleTimes } = await loadScene3D();
    // Reuse the backing surface across frames; PNG bytes are copied out before
    // the next clear, avoiding per-frame native canvas allocation at 30–60fps.
    const c = Canvas.createCanvas(W, H);
    const ctx = c.getContext('2d');
    for (let i = 0; i < frames; i++) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const loadFrameImages = async sampleTime => {
            const frameImages = { ...images };
            for (const object of sceneVideoObjects) {
                const key = object.videoTextureKey || object.id || object.videoUrl;
                const frameSource = opts.videoFrameFiles?.[key];
                const sourceFrames = Array.isArray(frameSource) ? frameSource : frameSource?.frames;
                if (!key || !Array.isArray(sourceFrames) || sourceFrames.length === 0) continue;
                // Export may extract a bounded sequence beginning at videoStart
                // rather than decoding the entire source. Keep the origin beside
                // the frame list so the requested absolute source time is mapped
                // back into that sequence exactly once.
                const extractedStart = Math.max(0, Number(frameSource?.startTime) || 0);
                const requestedTime = resolveSceneVideoSourceTime(object, sampleTime, duration);
                const requestedIndex = Math.max(0, Math.floor((requestedTime - extractedStart) * fps));
                const frameIndex = object.videoLoop === false
                    ? Math.min(requestedIndex, sourceFrames.length - 1)
                    : requestedIndex % sourceFrames.length;
                const framePath = sourceFrames[frameIndex];
                let image = videoImages.get(framePath);
                if (!image) {
                    try {
                        image = await Canvas.loadImage(fs.readFileSync(framePath));
                        videoImages.set(framePath, image);
                        if (videoImages.size > 48) videoImages.delete(videoImages.keys().next().value);
                    } catch (err) {
                        console.warn(`[TemplateRenderer] 3D video frame unavailable (${key}):`, err.message);
                        continue;
                    }
                }
                frameImages[key] = image;
            }
            return frameImages;
        };
        const sceneOwnsMotionBlur = kind === '3d-scene' && params.scene?.motionBlur?.enabled;
        const sceneShutter = sceneOwnsMotionBlur ? params.scene.motionBlur : null;
        const externalShutter = !sceneOwnsMotionBlur ? opts.motionBlur : null;
        const shutter = sceneShutter || externalShutter;
        let sampleTimes = [i / fps];
        if (sceneOwnsMotionBlur) {
            sampleTimes = getSceneShutterSampleTimes(i, duration, fps, sceneShutter);
        } else if (externalShutter?.enabled) {
            const samples = Math.round(Math.max(2, Math.min(15, Number(externalShutter.samples) || 5)));
            const shutterFps = Math.max(1, Math.min(120, Number(externalShutter.frameRate) || 30));
            const angle = Math.max(0, Math.min(360, Number(externalShutter.shutterAngle ?? 180)));
            const exposure = angle / (360 * shutterFps);
            sampleTimes = Array.from({ length: samples }, (_, index) => {
                const offset = ((index + 0.5) / samples - 0.5) * exposure;
                return Math.max(0, Math.min(duration, i / fps + offset));
            });
        }
        const frameImagesByTime = new Map();
        for (const sampleTime of sampleTimes) {
            frameImagesByTime.set(sampleTime.toFixed(9), await loadFrameImages(sampleTime));
        }
        const frameImages = frameImagesByTime.get((i / fps).toFixed(9)) || frameImagesByTime.values().next().value || { ...images };
        FX.drawLayerWithEffects(ctx, template.effects, drawCtx => MB.drawTemporalMotionBlur(
            drawCtx, sceneOwnsMotionBlur ? null : opts.motionBlur, i / fps, duration, (sampleCtx, sampleTime) => {
            if (richText) {
                sampleCtx.save();
                sampleCtx.scale(W / size.w, H / size.h);
                G.drawRichTextFrame(sampleCtx, params, sampleTime, {
                    width: size.w,
                    height: size.h,
                    durationSec: duration,
                    globalTime: (Number(params.captionTimeOffset) || 0) + sampleTime,
                });
                sampleCtx.restore();
            } else {
                G.drawTemplate(sampleCtx, kind, params, sampleTime, duration, {
                    scale: W / size.w,
                    images: kind === '3d-scene'
                        ? (sceneTime => frameImagesByTime.get(Number(sceneTime).toFixed(9)) || frameImages)
                        : frameImages,
                });
            }
        }), opts.mask, i / fps, { clipStart: 0, clipDuration: duration });
        const file = path.join(dir, `f${String(i).padStart(5, '0')}.png`);
        fs.writeFileSync(file, c.toBuffer('image/png'));
        files.push(file);
    }
    return { pattern: path.join(dir, 'f%05d.png'), frames, width: W, height: H, files };
}

const VECTOR_GRAPHICS_PATH = path.join(ROOT, 'client', 'src', 'motion', 'VectorGraphics.js');
let vectorGraphicsPromise = null;

function loadVectorGraphics() {
    if (!vectorGraphicsPromise) vectorGraphicsPromise = import(pathToFileURL(VECTOR_GRAPHICS_PATH).href);
    return vectorGraphicsPromise;
}

/**
 * Render vector shape frames using @napi-rs/canvas Skia engine.
 * @param {object} vector Vector shape definition
 * @param {object} opts { fps, durationSec, widthPx, tmpDir, name, canvasModule }
 */
async function renderVectorFrames(vector, opts) {
    const VG = await loadVectorGraphics();
    const FX = await loadLayerEffects();
    const MB = await loadTemporalMotionBlur();
    const Canvas = opts.canvasModule || require('@napi-rs/canvas');
    registerFonts(Canvas);
    const w = Number(vector?.w) || 400;
    const h = Number(vector?.h) || 400;
    const fps = Number(opts.fps) > 0 ? Number(opts.fps) : 30;
    const duration = Math.max(0.2, Number(opts.durationSec) || 3);
    const scale = Math.max(0.1, (Number(opts.widthPx) || w) / w);
    const W = Math.max(2, Math.round(w * scale / 2) * 2);
    const H = Math.max(2, Math.round(h * scale / 2) * 2);

    const dir = path.join(opts.tmpDir, `vec-${opts.name || 'shape'}`);
    fs.mkdirSync(dir, { recursive: true });
    const frames = Math.max(1, Math.ceil(duration * fps));
    const files = [];
    const c = Canvas.createCanvas(W, H);
    const ctx = c.getContext('2d');
    for (let i = 0; i < frames; i++) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        FX.drawLayerWithEffects(ctx, opts.effects, drawCtx => MB.drawTemporalMotionBlur(
            drawCtx, opts.motionBlur, i / fps, duration, (sampleCtx, sampleTime) => {
            // Keep authored vector coordinates in their logical space and scale
            // the drawing surface. Replacing w/h alone scales parametric shapes,
            // but leaves SVG path coordinates unchanged in high-resolution exports.
            sampleCtx.scale(scale, scale);
            VG.drawVectorFrame(sampleCtx, { ...vector, w, h, x: 0, y: 0 }, sampleTime, duration);
        }), opts.mask, i / fps, { clipStart: 0, clipDuration: duration });
        const file = path.join(dir, `f${String(i).padStart(5, '0')}.png`);
        fs.writeFileSync(file, c.toBuffer('image/png'));
        files.push(file);
    }
    return { pattern: path.join(dir, 'f%05d.png'), frames, width: W, height: H, files };
}

module.exports = {
    renderTemplateFrames,
    renderVectorFrames,
    loadTemplateGraphics,
    loadVectorGraphics,
    loadRichTextEngine,
    loadLayerEffects,
    loadScene3D,
    FONT_FILES,
    FONT_DIR,
    registerFonts,
};
