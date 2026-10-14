import React from 'react';
import { drawTemplate, templateSize, templateParams, TEMPLATE_FONTS } from '../../motion/TemplateGraphics.js';

/**
 * R89 (to-do A5) — draws a template clip (counter, price pop, logo card, code
 * window) in the preview, every frame, with the SAME drawTemplate() the export
 * runs (server/compositor/TemplateRenderer.js). The parent sizes the box; this
 * canvas fills its width and keeps the template's own aspect.
 */
let fontsReady = null;
function ensureFonts() {
    if (fontsReady) return fontsReady;
    if (typeof document === 'undefined' || !document.fonts?.load) return (fontsReady = Promise.resolve());
    fontsReady = Promise.all(Object.values(TEMPLATE_FONTS).map(f => document.fonts.load(`40px "${f}"`).catch(() => null)));
    return fontsReady;
}

const imageCache = new Map();
function loadImage(url, onLoad) {
    if (!url) return null;
    const hit = imageCache.get(url);
    if (hit) return hit.complete ? hit : null;
    const img = new Image();
    img.onload = () => onLoad?.();
    img.onerror = () => console.warn('[TemplateCanvas] logo image failed to load');
    img.src = url;
    imageCache.set(url, img);
    return null;
}

import { drawVectorGraphic } from '../../motion/VectorGraphics.js';

const TemplateCanvas = ({ clip, currentTime, style }) => {
    const ref = React.useRef(null);
    const [, bump] = React.useReducer(x => x + 1, 0);
    const isVector = clip?.type === 'vector' || !!clip?.vector;
    const kind = clip?.template?.kind;
    const params = isVector ? null : templateParams(kind, clip?.template?.params);
    const size = isVector
        ? { w: Number(clip?.vector?.w) || 400, h: Number(clip?.vector?.h) || 400 }
        : templateSize(kind, params);
    const localT = Math.max(0, (Number(currentTime) || 0) - (Number(clip?.start) || 0));

    React.useEffect(() => { ensureFonts().then(() => bump()); }, []);

    React.useEffect(() => {
        const cv = ref.current;
        if (!cv || (!kind && !isVector)) return;
        const rect = cv.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const W = Math.max(2, Math.round(rect.width * dpr));
        const H = Math.max(2, Math.round(W * size.h / size.w));
        if (cv.width !== W) cv.width = W;
        if (cv.height !== H) cv.height = H;
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);

        if (isVector) {
            try {
                drawVectorGraphic(ctx, {
                    ...clip.vector,
                    w: W,
                    h: H,
                    x: 0,
                    y: 0,
                });
            } catch (err) {
                console.warn('[TemplateCanvas] vector draw failed:', err?.message);
            }
            return;
        }

        const images = {};
        const img = loadImage(params?.imageUrl, bump);
        if (img) images[params.imageUrl] = img;
        try {
            drawTemplate(ctx, kind, params, localT, Number(clip.duration) || 3, { scale: W / size.w, images });
        } catch (err) {
            console.warn('[TemplateCanvas] draw failed:', err?.message);
        }
    });

    return (
        <canvas
            ref={ref}
            aria-label={clip?.name || kind}
            style={{ display: 'block', width: '100%', aspectRatio: `${size.w} / ${size.h}`, ...style }}
        />
    );
};

export default TemplateCanvas;
