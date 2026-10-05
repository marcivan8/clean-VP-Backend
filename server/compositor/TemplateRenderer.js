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
const FONT_DIR = path.join(ROOT, 'client', 'public', 'fonts');

// Family name → file. Must match client/src/index.css (@font-face) and
// TEMPLATE_FONTS in TemplateGraphics.js.
const FONT_FILES = {
    'Anton': 'Anton-Regular.ttf',
    'Montserrat': 'Montserrat-Bold.ttf',
    'Inter': 'Inter-Regular.ttf',
    'JetBrains Mono': '2fc98a00-b314-4999-a8a1-f9fa9f814297.woff2', // latin subset
};

let graphicsPromise = null;
let fontsRegistered = false;

function loadTemplateGraphics() {
    if (!graphicsPromise) graphicsPromise = import(pathToFileURL(GRAPHICS_PATH).href);
    return graphicsPromise;
}

function registerFonts(Canvas) {
    if (fontsRegistered) return;
    for (const [family, file] of Object.entries(FONT_FILES)) {
        const p = path.join(FONT_DIR, file);
        if (!fs.existsSync(p)) { console.warn(`[TemplateRenderer] font file missing: ${file}`); continue; }
        Canvas.GlobalFonts.registerFromPath(p, family);
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
    const G = await loadTemplateGraphics();
    const Canvas = opts.canvasModule || require('@napi-rs/canvas');
    registerFonts(Canvas);
    const kind = template?.kind;
    if (!G.TEMPLATE_KINDS.includes(kind)) throw new Error(`unknown template kind "${kind}"`);
    const params = template.params || {};
    const size = G.templateSize(kind, params);
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
    for (let i = 0; i < frames; i++) {
        const c = Canvas.createCanvas(W, H);
        G.drawTemplate(c.getContext('2d'), kind, params, i / fps, duration, { scale: W / size.w, images });
        const file = path.join(dir, `f${String(i).padStart(5, '0')}.png`);
        fs.writeFileSync(file, c.toBuffer('image/png'));
        files.push(file);
    }
    return { pattern: path.join(dir, 'f%05d.png'), frames, width: W, height: H, files };
}

module.exports = { renderTemplateFrames, loadTemplateGraphics, FONT_FILES };
