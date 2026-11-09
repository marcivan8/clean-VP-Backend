import React from 'react';
import { createBrowserVideoTextureCache, resolveSceneAudioReactiveAssetIds, resolveSceneImageTextures, resolveSceneVideoTextures } from '../../motion/VideoTextureCache.js';
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
const videoTextureCache = createBrowserVideoTextureCache(12);
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

import { drawVectorFrame } from '../../motion/VectorGraphics.js';
import { drawRichTextFrame } from '../../motion/RichTextEngine.js';
import { drawLayerWithEffects } from '../../motion/LayerEffects.js';
import { drawTemporalMotionBlur, relativeMotionTransform } from '../../motion/TemporalMotionBlur.js';
import { resolveMotionAt } from '../../motion/MotionResolver.js';
import { remapSceneObjectTime } from '../../motion/Scene3D.js';
import useTimelineStore from '../../store/useTimelineStore.js';
import WaveformEngine from '../../services/WaveformEngine.js';

const TemplateCanvas = ({ clip, currentTime, style, motionBlurMotion = null }) => {
    const ref = React.useRef(null);
    const [, bump] = React.useReducer(x => x + 1, 0);
    const isVector = clip?.type === 'vector' || !!clip?.vector;
    const kind = clip?.template?.kind;
    const params = isVector ? null : templateParams(kind, clip?.template?.params);
    // 3D scenes already sample their camera, objects, and particles in the
    // scene renderer. Applying the 2D canvas sampler around that renderer
    // would blur each already-integrated frame a second time.
    const graphicMotionBlur = kind === '3d-scene' && params?.scene?.motionBlur?.enabled
        ? null
        : clip?.motionBlur;
    const size = isVector
        ? { w: Number(clip?.vector?.w) || 400, h: Number(clip?.vector?.h) || 400 }
        : kind === 'rich-text'
            ? { w: Number(clip?.template?.params?.w) || 1080, h: Number(clip?.template?.params?.h) || 480 }
            : templateSize(kind, params);
    const localT = Math.max(0, (Number(currentTime) || 0) - (Number(clip?.start) || 0));
    const transformAt = motionBlurMotion?.layer && motionBlurMotion?.base
        ? sampleTime => relativeMotionTransform(
            motionBlurMotion.base,
            resolveMotionAt(motionBlurMotion.layer, (Number(clip?.start) || 0) + sampleTime),
            motionBlurMotion.frameAspect,
            Number(ref.current?.width) || 0,
        )
        : null;
    // Effect tracks and their active windows use project timeline seconds in
    // the compositor plan. Keep preview sampling on that same clock; the
    // template animation callbacks below still receive clip-local time.
    const effectTime = (Number(clip?.start) || 0) + localT;
    const effectContext = { clipStart: Number(clip?.start) || 0, clipDuration: Number(clip?.duration) || 0 };
    const waveformCache = useTimelineStore(state => state.waveformsByAsset || {});
    const assetCatalog = useTimelineStore(state => state.assets || []);
    const assetById = new Map(assetCatalog.filter(asset => asset?.id).map(asset => [asset.id, asset]));
    const primaryImageAsset = params?.imageAssetId ? assetById.get(params.imageAssetId) : null;
    const resolvedPrimaryImageUrl = params?.imageUrl || primaryImageAsset?.sourceUrl || primaryImageAsset?.proxyUrl || primaryImageAsset?.url || null;
    const reactiveIds = kind === '3d-scene' ? resolveSceneAudioReactiveAssetIds(params?.scene) : [];
    const reactiveIdsKey = reactiveIds.join('|');
    const sceneVideoTextures = kind === '3d-scene'
        ? resolveSceneVideoTextures(params?.scene?.objects, assetCatalog)
        : [];
    const sceneImageTextures = kind === '3d-scene'
        ? resolveSceneImageTextures(params?.scene?.objects, assetCatalog)
        : [];
    const videoTextureUrls = [...new Set(sceneVideoTextures.map(texture => texture.url))];
    const videoTextureUrlsKey = videoTextureUrls.join('\n');

    React.useEffect(() => {
        const unsubscribe = videoTextureUrls.map(url => videoTextureCache.subscribe(url, () => bump()));
        return () => unsubscribe.forEach(release => release());
    }, [videoTextureUrlsKey]);

    React.useEffect(() => {
        let cancelled = false;
        for (const assetId of reactiveIds) {
            if (waveformCache[assetId]?.peaks?.length) continue;
            const asset = assetCatalog.find(item => item.id === assetId);
            if (!asset) continue;
            WaveformEngine.getPeaks(assetId, { gcsPath: asset.gcsPath || asset.storagePath || null, proxyUrl: asset.proxyUrl || asset.url || null })
                .then(() => { if (!cancelled) bump(); })
                .catch(error => console.warn('[TemplateCanvas] audio envelope unavailable:', error?.message));
        }
        return () => { cancelled = true; };
    }, [reactiveIdsKey, assetCatalog, waveformCache]);

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
                drawLayerWithEffects(ctx, clip.effects, drawCtx => drawTemporalMotionBlur(
                    drawCtx, graphicMotionBlur, localT, Number(clip.duration) || 1, (sampleCtx, sampleTime) => {
                        sampleCtx.scale(W / size.w, H / size.h);
                        drawVectorFrame(sampleCtx, { ...clip.vector, w: size.w, h: size.h, x: 0, y: 0 }, sampleTime, Number(clip.duration) || 1);
                    }, transformAt), clip.sceneMask, effectTime, effectContext);
            } catch (err) {
                console.warn('[TemplateCanvas] vector draw failed:', err?.message);
            }
            return;
        }

        if (kind === 'rich-text') {
            try {
                ctx.save();
                drawLayerWithEffects(ctx, clip.effects, drawCtx => drawTemporalMotionBlur(
                    drawCtx, graphicMotionBlur, localT, Number(clip.duration) || 1, (sampleCtx, sampleTime) => {
                        sampleCtx.save();
                        sampleCtx.scale(W / size.w, H / size.h);
                        drawRichTextFrame(sampleCtx, clip.template.params, sampleTime, { width: size.w, height: size.h,
                            duration: Number(clip.duration) || 0, globalTime: (Number(clip.start) || 0) + sampleTime });
                        sampleCtx.restore();
                    }, transformAt), clip.sceneMask, effectTime, effectContext);
                ctx.restore();
            } catch (err) {
                ctx.restore();
                console.warn('[TemplateCanvas] rich text draw failed:', err?.message);
            }
            return;
        }

        const images = {};
        const imageUrls = new Set([resolvedPrimaryImageUrl, ...sceneImageTextures.map(texture => texture.url)]);
        for (const url of imageUrls) {
            const img = loadImage(url, bump);
            if (img) images[url] = img;
        }
        if (kind === '3d-scene') for (const { object, url, textureKey } of sceneVideoTextures) {
            const video = videoTextureCache.get(url);
            if (!video) continue;
            // Keep the last decoded frame visible while the next seek is in
            // flight. Omitting the texture until currentTime catches up makes
            // 3D video planes flash transparent at every playhead update.
            images[textureKey] = video;
            const speed = Math.max(0.05, Number(object.videoSpeed) || 1);
            const mappedTime = remapSceneObjectTime(object.timeRemap, localT, Number(clip.duration) || 1);
            const sourceTime = Math.max(0, Number(object.videoStart) || 0) + mappedTime * speed;
            const targetTime = object.videoLoop !== false && video.duration > 0
                ? sourceTime % video.duration
                : Math.min(sourceTime, Math.max(0, (video.duration || sourceTime) - 0.04));
            if (Math.abs(video.currentTime - targetTime) > 0.06) {
                try { video.currentTime = targetTime; } catch (_) {}
            }
        }
        let renderParams = params;
        if (reactiveIds.length || sceneImageTextures.length || resolvedPrimaryImageUrl !== params?.imageUrl) {
            const imageUrlById = new Map(sceneImageTextures.map(texture => [texture.object.id, texture.url]));
            renderParams = {
                ...params,
                ...(resolvedPrimaryImageUrl ? { imageUrl: resolvedPrimaryImageUrl } : {}),
                ...(kind === '3d-scene' ? { scene: {
                    ...params.scene,
                    objects: (params.scene?.objects || []).map(object => object?.imageUrl || object?.textureUrl
                        ? object
                        : imageUrlById.has(object?.id) ? { ...object, imageUrl: imageUrlById.get(object.id) } : object),
                    ...(reactiveIds.length ? { audioWaveformsByAsset: Object.fromEntries(reactiveIds.map(id => [id, waveformCache[id]]).filter(([, value]) => value?.peaks?.length)) } : {}),
                } } : {}),
            };
        }
        try {
            drawLayerWithEffects(ctx, clip.effects, drawCtx => drawTemporalMotionBlur(
                drawCtx, graphicMotionBlur, localT, Number(clip.duration) || 3, (sampleCtx, sampleTime) =>
                    drawTemplate(sampleCtx, kind, renderParams, sampleTime, Number(clip.duration) || 3, { scale: W / size.w, images }), transformAt),
                clip.sceneMask, effectTime, effectContext);
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
