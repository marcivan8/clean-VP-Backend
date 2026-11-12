import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import { getVisualTrackRoles } from '../../motion/Compositor.js';
import { groupCompositionEntries, resolveCompositionOpacity } from '../../motion/CompositionGrouping.js';
// R62 — Graphics/Overlay track. Same motion engine as captions (R58): a
// GraphicOverlay clip is a MotionLayer view (see motion/ClipAdapter) resolved
// through the SAME resolveMotionAt() that drives TextOverlay and the
// compositor's export-side geometry sampling (motion/Compositor.js). One
// resolver, three consumers — the whole point of building it as a pure
// function instead of a component method (see MotionResolver.js header).
import { clipToMotionLayer } from '../../motion/ClipAdapter.js';
import { resolveMotionAt }   from '../../motion/MotionResolver.js';
import { resolveEffectAtTime } from '../../motion/EffectTiming.js';
// R66 — clip grouping. A LowerThird's background bar lives on THIS track
// but its title lives on the 'text' track; `clipsInGroup` looks across ALL
// tracks (not just this component's own 'overlay' ones) so dragging the bar
// drags its grouped text along with it. See ClipGrouping.js's header for
// why a group is just clips sharing `clip.groupId`, not a new entity type.
import { clipsInGroup } from '../../motion/ClipGrouping.js';
import RotateHandle from './RotateHandle.jsx';
import ResizeHandle from './ResizeHandle.jsx';
import { hasLayoutFrame, frameToCss } from '../../motion/LayoutPresets.js';
import TemplateCanvas from './TemplateCanvas.jsx';
import { resolveTimelineFadeOpacity, resolveTimelineFadeOverlays, resolveTimelineVignetteStyle } from '../../motion/TimelineVisualEffects.js';
import { vectorMatteDataUrl } from '../../motion/VectorGraphics.js';
import { sceneMaskCss } from '../../motion/SceneMask.js';
import { drawRadialBlur, previewCanvasSize } from '../../motion/RadialBlurPreview.js';
import { drawMaskedGradient, drawTemporalMotionBlur, relativeMotionTransform } from '../../motion/TemporalMotionBlur.js';
import { resolveOverlayVideoPlaybackRate, resolveOverlayVideoSourceTime } from '../../motion/TimeRemap.js';
// R92 round C: alignment guides while dragging
import { computeSnap, measureOthers } from '../../motion/SnapGuides.js';
import { useSnapGuides } from './SnapGuidesLayer.jsx';
import WaveformEngine from '../../services/WaveformEngine.js';

function renderGroupedOverlayEntries(clips, elements, timeKey, currentTime, depth = 0) {
    const entries = clips.map((item, index) => ({ clip: item.clip, element: elements[index] }));
    return renderGroupedCompositionNodes(groupCompositionEntries(entries, depth), timeKey, currentTime, depth);
}

function renderGroupedCompositionNodes(nodes, timeKey, currentTime, depth) {
    return (nodes || []).map(item => item.type === 'layer'
        ? item.entry.element || null
        : <CompositionGroup key={`scene-comp-${item.key}-${depth}-${timeKey}`} group={item.group}
            children={renderGroupedCompositionNodes(item.children, timeKey, currentTime, depth + 1)}
            timeKey={timeKey} currentTime={currentTime} depth={depth} />);
}

function CompositionGroup({ group, children, timeKey, currentTime, depth }) {
    const groupClip = { id: `composition-${group.id}`, start: Number(group.start) || 0, duration: Number(group.duration) || 0, effects: group.effects || [] };
    const groupFilter = overlayFilterCss(0, null, group.effects, groupClip.id, currentTime, groupClip);
    const groupOpacity = resolveCompositionOpacity([group], currentTime);
    return <div key={`scene-comp-${group.id}-${depth}-${timeKey}`} aria-label={undefined} style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: groupOpacity,
        isolation: 'isolate',
        ...(group.blendMode && group.blendMode !== 'source-over'
            ? { mixBlendMode: group.blendMode === 'addition' ? 'plus-lighter' : group.blendMode }
            : {}),
        ...(groupFilter ? { filter: groupFilter } : {}),
    }}>
        <LayerEffectFilters clip={groupClip} currentTime={currentTime} />
        {children}
    </div>;
}

/**
 * A video on the overlay track (b-roll cutaway, screen recording, PiP). Before
 * R88 every overlay was drawn as an <img>, so a video overlay showed a broken
 * image in the preview while the export composited it correctly. Muted: the
 * export does not mix overlay audio either (CompositorCompiler, STEP 2.5).
 * Kept in step with the playhead: seeks when paused, plays along when the
 * editor plays and re-syncs if it drifts.
 */
function radialBlurAtTime(clip, currentTime) {
    const context = { clipStart: Number(clip?.start ?? clip?.startTime) || 0, clipDuration: Number(clip?.duration) || 0 };
    const raw = (clip?.effects || []).find(effect => effect && effect.enabled !== false && (effect.kind || effect.type) === 'blur_radial');
    const effect = raw && resolveEffectAtTime(raw, currentTime, context);
    if (!effect || effect.enabled === false) return null;
    const p = effect.params || {};
    const number = (key, fallback) => {
        const value = Number(p[key]?.value ?? p[key] ?? fallback);
        return Number.isFinite(value) ? value : fallback;
    };
    const intensity = Math.max(0, Math.min(1, number('intensity', 0.3)));
    return intensity > 0 ? {
        intensity,
        centerX: Math.max(0, Math.min(1, number('centerX', 0.5))),
        centerY: Math.max(0, Math.min(1, number('centerY', 0.5))),
        // The main footage shader can process 64 samples on the GPU. Media
        // overlays use a bounded Canvas preview pass to keep multiple layers
        // from monopolizing the editor's paint thread.
        samples: Math.max(6, Math.min(10, Math.round(number('samples', 32)))),
    } : null;
}

function RadialBlurImageCanvas({ src, style, radial, framed }) {
    const canvasRef = React.useRef(null);
    const imageRef = React.useRef(null);
    const [aspect, setAspect] = React.useState(null);
    const [failed, setFailed] = React.useState(false);
    React.useEffect(() => {
        if (!src || typeof Image === 'undefined') return undefined;
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            const size = previewCanvasSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
            imageRef.current = image;
            setFailed(false);
            setAspect(`${size.width} / ${size.height}`);
        };
        image.onerror = () => setFailed(true);
        image.src = src;
        return () => { image.onload = null; image.onerror = null; imageRef.current = null; };
    }, [src]);
    React.useEffect(() => {
        const image = imageRef.current, canvas = canvasRef.current;
        const context = canvas?.getContext('2d', { alpha: true });
        if (!image || !canvas || !context) return;
        const size = previewCanvasSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
        if (canvas.width !== size.width || canvas.height !== size.height) {
            canvas.width = size.width;
            canvas.height = size.height;
        }
        try { drawRadialBlur(context, image, size.width, size.height, radial); }
        catch (error) { console.warn('[GraphicOverlay] radial image preview unavailable:', error?.message); }
    }, [aspect, radial?.intensity, radial?.centerX, radial?.centerY, radial?.samples]);
    if (failed) return <img src={src} alt="Radial blur image preview" draggable={false} style={style} />;
    return <canvas ref={canvasRef} aria-label="Radial blur image preview" style={{ display: 'block', width: '100%', height: framed ? '100%' : 'auto', aspectRatio: aspect || undefined, objectFit: 'cover', ...style }} />;
}

function RadialBlurVideoCanvas({ clip, src, target, isPlaying, speed, style, radial }) {
    const videoRef = React.useRef(null);
    const canvasRef = React.useRef(null);
    const stateRef = React.useRef(null);
    stateRef.current = { target, isPlaying, speed, radial };
    const paintRef = React.useRef(null);
    const [aspect, setAspect] = React.useState(null);
    const [failed, setFailed] = React.useState(false);
    React.useEffect(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return undefined;
        const context = canvas.getContext('2d', { alpha: true });
        if (!context) { setFailed(true); return undefined; }
        let disposed = false;
        paintRef.current = () => {
            if (disposed || video.readyState < 2) return;
            const sourceWidth = video.videoWidth || 0, sourceHeight = video.videoHeight || 0;
            if (!sourceWidth || !sourceHeight) return;
            const size = previewCanvasSize(sourceWidth, sourceHeight);
            if (canvas.width !== size.width || canvas.height !== size.height) {
                canvas.width = size.width;
                canvas.height = size.height;
                setAspect(`${size.width} / ${size.height}`);
            }
            try { drawRadialBlur(context, video, size.width, size.height, stateRef.current?.radial || radial); }
            catch (error) { setFailed(true); console.warn('[GraphicOverlay] radial video preview unavailable:', error?.message); }
        };
        const ready = () => paintRef.current?.();
        video.addEventListener('loadedmetadata', ready);
        video.addEventListener('loadeddata', ready);
        video.addEventListener('seeked', ready);
        video.src = src;
        video.load();
        setFailed(false);
        return () => {
            disposed = true;
            paintRef.current = null;
            video.removeEventListener('loadedmetadata', ready);
            video.removeEventListener('loadeddata', ready);
            video.removeEventListener('seeked', ready);
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
    }, [src]);
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        try {
            const nativePlayback = isPlaying && speed > 0;
            video.playbackRate = Math.max(0.05, Math.abs(speed));
            const syncThreshold = nativePlayback ? 0.25 : (isPlaying ? 1 / 60 : 0.04);
            if (Math.abs((video.currentTime || 0) - target) > syncThreshold) video.currentTime = target;
            if (nativePlayback) video.play().catch(() => {}); else video.pause();
            if (!isPlaying) paintRef.current?.();
        } catch { /* Media may not be seekable before metadata is ready. */ }
    }, [target, isPlaying, speed]);
    React.useEffect(() => {
        if (!isPlaying) return undefined;
        let raf = null, lastPaint = 0;
        const tick = () => {
            if (performance.now() - lastPaint >= 30) { paintRef.current?.(); lastPaint = performance.now(); }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { if (raf !== null) cancelAnimationFrame(raf); };
    }, [isPlaying, src]);
    React.useEffect(() => { paintRef.current?.(); }, [radial.intensity, radial.centerX, radial.centerY, radial.samples]);
    return <div style={{ ...style, position: 'relative', overflow: 'hidden', aspectRatio: aspect || undefined }}>
        <video ref={videoRef} muted playsInline preload="auto" aria-hidden="true" style={{ position: failed ? 'relative' : 'absolute', display: 'block', width: '100%', height: '100%', opacity: failed ? 1 : 0, objectFit: 'cover', pointerEvents: 'none' }} />
        <canvas ref={canvasRef} aria-label={`${clip.name || 'Overlay video'} radial blur preview`} style={{ display: failed ? 'none' : 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>;
}

function motionBlurScratch(scratchRef, name, width, height) {
    let canvas = scratchRef.current?.[name];
    if (!canvas || canvas.width !== width || canvas.height !== height) {
        canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        scratchRef.current = { ...(scratchRef.current || {}), [name]: canvas };
    }
    return canvas;
}

function paintMotionBlurFrame(canvas, source, clip, currentTime, motionContext, scratchRef) {
    if (!canvas || !source) return;
    const width = Number(source.videoWidth || source.naturalWidth || source.width) || 0;
    const height = Number(source.videoHeight || source.naturalHeight || source.height) || 0;
    if (!width || !height) return;
    const size = previewCanvasSize(width, height);
    if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
    }
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    const start = Number(clip.start ?? clip.startTime) || 0;
    const duration = Number(clip.duration) || 1;
    drawTemporalMotionBlur(ctx, clip.motionBlur, Math.max(0, currentTime - start), duration,
        (sampleCtx, sampleTime) => {
            const projectTime = start + sampleTime;
            const effects = (clip.effects || []).map(effect => resolveEffectAtTime(effect, projectTime, { clipStart: start, clipDuration: duration }))
                .filter(effect => effect && effect.enabled !== false);
            const radial = radialBlurAtTime(clip, projectTime);
            const gradients = effects.filter(effect => (effect.kind || effect.type) === 'gradient-fill');
            let paintSource = source;
            if (radial) {
                const radialCanvas = motionBlurScratch(scratchRef, 'radial', size.width, size.height);
                drawRadialBlur(radialCanvas.getContext('2d'), source, size.width, size.height, radial);
                paintSource = radialCanvas;
            }
            if (gradients.length) {
                const composite = motionBlurScratch(scratchRef, 'composite', size.width, size.height);
                const compositeCtx = composite.getContext('2d');
                compositeCtx.clearRect(0, 0, size.width, size.height);
                compositeCtx.globalCompositeOperation = 'source-over';
                compositeCtx.globalAlpha = 1;
                compositeCtx.drawImage(paintSource, 0, 0, size.width, size.height);
                for (let index = 0; index < gradients.length; index++) {
                    const gradientCanvas = motionBlurScratch(scratchRef, `gradient-${index}`, size.width, size.height);
                    const gradientCtx = gradientCanvas.getContext('2d');
                    gradientCtx.clearRect(0, 0, size.width, size.height);
                    gradientCtx.globalCompositeOperation = 'source-over';
                    drawMaskedGradient(gradientCtx, paintSource, gradients[index], size.width, size.height);
                    compositeCtx.drawImage(gradientCanvas, 0, 0);
                }
                paintSource = composite;
            }
            sampleCtx.drawImage(paintSource, 0, 0, size.width, size.height);
        },
        sampleTime => relativeMotionTransform(
            motionContext.base,
            resolveMotionAt(motionContext.layer, start + sampleTime),
            motionContext.frameAspect,
            size.width,
        ));
}

function MotionBlurImageCanvas({ clip, src, style, currentTime, motionContext }) {
    const canvasRef = React.useRef(null);
    const imageRef = React.useRef(null);
    const scratchRef = React.useRef(null);
    const [, bump] = React.useReducer(value => value + 1, 0);
    const [aspect, setAspect] = React.useState(null);
    React.useEffect(() => {
        if (!src || typeof Image === 'undefined') return undefined;
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            imageRef.current = image;
            const size = previewCanvasSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
            setAspect(`${size.width} / ${size.height}`);
            bump();
        };
        image.onerror = () => { imageRef.current = null; };
        image.src = src;
        return () => { image.onload = null; image.onerror = null; imageRef.current = null; };
    }, [src]);
    React.useEffect(() => {
        paintMotionBlurFrame(canvasRef.current, imageRef.current, clip, currentTime, motionContext, scratchRef);
    }, [src, aspect, currentTime, clip.motionBlur?.samples, clip.motionBlur?.shutterAngle, clip.motionBlur?.frameRate, clip.effects,
        motionContext.base.x, motionContext.base.y, motionContext.base.scale, motionContext.base.scaleX,
        motionContext.base.scaleY, motionContext.base.rotation, motionContext.base.opacity]);
    return <canvas ref={canvasRef} aria-label={`${clip.name || 'Overlay image'} motion blur preview`} style={{ display: 'block', width: '100%', height: style?.height || 'auto', aspectRatio: aspect || undefined, ...style }} />;
}

function MotionBlurVideoCanvas({ clip, src, style, currentTime, isPlaying, motionContext }) {
    const videoRef = React.useRef(null);
    const canvasRef = React.useRef(null);
    const scratchRef = React.useRef(null);
    const paintRef = React.useRef(null);
    const speed = resolveOverlayVideoPlaybackRate(clip, currentTime);
    const target = resolveOverlayVideoSourceTime(clip, currentTime);
    const [aspect, setAspect] = React.useState(null);
    const stateRef = React.useRef(null);
    stateRef.current = { clip, currentTime, motionContext };
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return undefined;
        let disposed = false;
        paintRef.current = () => {
            if (!disposed && video.readyState >= 2) {
                const state = stateRef.current;
                if (state) paintMotionBlurFrame(canvasRef.current, video, state.clip, state.currentTime, state.motionContext, scratchRef);
            }
        };
        const ready = () => paintRef.current?.();
        const metadata = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) setAspect(`${video.videoWidth} / ${video.videoHeight}`);
            ready();
        };
        video.addEventListener('loadedmetadata', metadata);
        video.addEventListener('loadeddata', ready);
        video.addEventListener('seeked', ready);
        video.src = src;
        video.load();
        return () => {
            disposed = true;
            paintRef.current = null;
            video.removeEventListener('loadedmetadata', metadata);
            video.removeEventListener('loadeddata', ready);
            video.removeEventListener('seeked', ready);
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
    }, [src]);
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        try {
            const nativePlayback = isPlaying && speed > 0;
            video.playbackRate = Math.max(0.05, Math.abs(speed));
            const syncThreshold = nativePlayback ? 0.25 : (isPlaying ? 1 / 60 : 0.04);
            if (Math.abs((video.currentTime || 0) - target) > syncThreshold) video.currentTime = target;
            if (nativePlayback) video.play().catch(() => {}); else video.pause();
            if (!isPlaying) paintRef.current?.();
        } catch { /* The source may not be seekable until metadata arrives. */ }
    }, [target, isPlaying, speed]);
    React.useEffect(() => {
        paintRef.current?.();
    }, [currentTime, src, clip.motionBlur?.samples, clip.motionBlur?.shutterAngle, clip.motionBlur?.frameRate, clip.effects,
        motionContext.base.x, motionContext.base.y, motionContext.base.scale, motionContext.base.scaleX,
        motionContext.base.scaleY, motionContext.base.rotation, motionContext.base.opacity]);
    React.useEffect(() => {
        if (!isPlaying) return undefined;
        let raf = null, lastPaint = 0;
        const tick = () => {
            if (performance.now() - lastPaint >= 33) { paintRef.current?.(); lastPaint = performance.now(); }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { if (raf !== null) cancelAnimationFrame(raf); };
    }, [isPlaying, src]);
    return <div style={{ ...style, position: 'relative', aspectRatio: aspect || undefined }}>
        <video ref={videoRef} muted playsInline preload="auto" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, pointerEvents: 'none' }} />
        <canvas ref={canvasRef} aria-label={`${clip.name || 'Overlay video'} motion blur preview`} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>;
}

const OverlayVideo = ({ clip, src, currentTime, isPlaying, style, motionContext = null }) => {
    const ref = React.useRef(null);
    const speed = resolveOverlayVideoPlaybackRate(clip, currentTime);
    const target = resolveOverlayVideoSourceTime(clip, currentTime);
    const effectContext = { clipStart: Number(clip.start ?? clip.startTime) || 0, clipDuration: Number(clip.duration) || 0 };
    const gradients = (Array.isArray(clip.effects) ? clip.effects : [])
        .map(effect => resolveEffectAtTime(effect, currentTime, effectContext))
        .filter(effect => (effect?.kind || effect?.type) === 'gradient-fill' && effect.enabled !== false);

    React.useEffect(() => {
        const v = ref.current;
        if (!v) return;
        try {
            const nativePlayback = isPlaying && speed > 0;
            v.playbackRate = Math.max(0.05, Math.abs(speed));
            const drift = Math.abs((v.currentTime || 0) - target);
            if (nativePlayback) {
                if (drift > 0.25) v.currentTime = target;
                if (v.paused) v.play().catch(() => { /* autoplay refusal: stays on the seeked frame */ });
            } else {
                if (!v.paused) v.pause();
                if (drift > (isPlaying ? 1 / 60 : 0.04)) v.currentTime = target;
            }
        } catch (err) {
            console.warn('[GraphicOverlay] overlay video sync failed:', err?.message);
        }
    }, [target, isPlaying, speed]);

    const radial = radialBlurAtTime(clip, currentTime);
    if (motionContext) return <MotionBlurVideoCanvas clip={clip} src={src} currentTime={currentTime} isPlaying={isPlaying} style={style} motionContext={motionContext} />;
    if (radial && !gradients.length) return <RadialBlurVideoCanvas clip={clip} src={src} target={target} isPlaying={isPlaying} speed={speed} style={style} radial={radial} />;
    const video = radial
        ? <RadialBlurVideoCanvas clip={clip} src={src} target={target} isPlaying={isPlaying} speed={speed}
            style={{ display: 'block', width: '100%', height: 'auto', objectFit: 'cover', pointerEvents: 'none' }} radial={radial} />
        : <video
            ref={ref}
            src={src}
            muted
            playsInline
            preload="auto"
            style={{ display: 'block', width: '100%', height: 'auto', pointerEvents: 'none' }}
        />;
    if (!gradients.length) return video;
    return <div style={{ ...style, position: 'relative', display: 'block' }}>
        {video}
        {gradients.map((effect, index) => (
            <div key={`${clip.id}-video-gradient-${index}`} aria-hidden="true" style={{
                position: 'absolute', inset: 0,
                background: cssGradient(effect),
                opacity: Math.max(0, Math.min(1, Number(effect.params?.opacity?.value ?? effect.params?.opacity ?? 1))),
                pointerEvents: 'none',
            }} />
        ))}
    </div>;
};

function cssGradient(effect) {
    const p = effect?.params || {};
    const read = (value, fallback) => value && typeof value === 'object' && 'value' in value ? value.value : value ?? fallback;
    const colorEntries = read(p.colors, null);
    const entries = Array.isArray(colorEntries) && colorEntries.length ? colorEntries : [read(p.from, read(p.color, '#FFFFFF')), read(p.to, read(p.color, '#000000'))];
    const stops = entries.map((entry, index) => {
        const rawColor = typeof entry === 'string' || Array.isArray(entry) ? entry : entry?.color;
        const color = Array.isArray(rawColor) ? effectColorCss(rawColor) : (rawColor || '#FFFFFF');
        const offset = Number.isFinite(Number(entry?.offset)) ? `${Math.max(0, Math.min(1, Number(entry.offset))) * 100}%` : `${index / Math.max(1, entries.length - 1) * 100}%`;
        return `${color} ${offset}`;
    });
    // Canvas gradients use zero degrees for left-to-right. CSS uses 90deg.
    return `linear-gradient(${(Number(read(p.angle, 0)) || 0) + 90}deg, ${stops.join(', ')})`;
}

function effectColorCss(color, fallback = '#72D9FF') {
    if (Array.isArray(color)) {
        const channels = color.slice(0, 3).map(channel => {
            const value = Number(channel);
            const normalized = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
            return Math.round(normalized * 255);
        });
        if (channels.length === 3) return `rgb(${channels.join(' ')})`;
    }
    return typeof color === 'string' && color.trim() ? color : fallback;
}

function OverlayImage({ clip, src, style, framed = false, currentTime = 0, motionContext = null }) {
    const effectContext = { clipStart: Number(clip.start ?? clip.startTime) || 0, clipDuration: Number(clip.duration) || 0 };
    const gradients = (Array.isArray(clip.effects) ? clip.effects : [])
        .map(effect => resolveEffectAtTime(effect, currentTime, effectContext))
        .filter(effect => (effect?.kind || effect?.type) === 'gradient-fill' && effect.enabled !== false);
    const radial = radialBlurAtTime(clip, currentTime);
    if (motionContext) return <MotionBlurImageCanvas clip={clip} src={src} currentTime={currentTime} style={style} motionContext={motionContext} />;
    if (!gradients.length) return radial
        ? <RadialBlurImageCanvas src={src} radial={radial} framed={framed} style={style} />
        : <img src={src} alt={clip.name || 'overlay'} draggable={false} style={style} />;

    const safeUrl = `url("${String(src).replace(/["\\]/g, '\\$&')}")`;
    const { opacity, filter, ...imageStyle } = style;
    return (
        <div style={{ position: 'relative', display: 'block', width: '100%', height: framed ? '100%' : 'auto', opacity, filter, pointerEvents: 'none' }}>
            {radial
                ? <RadialBlurImageCanvas src={src} radial={radial} framed={framed} style={{ ...imageStyle, width: '100%', height: framed ? '100%' : 'auto' }} />
                : <img src={src} alt={clip.name || 'overlay'} draggable={false} style={{ ...imageStyle, width: '100%', height: framed ? '100%' : 'auto' }} />}
            {gradients.map((effect, index) => (
                <div
                    key={`${clip.id}-gradient-${index}`}
                    aria-hidden="true"
                    style={{
                        position: 'absolute', inset: 0,
                        background: cssGradient(effect),
                        opacity: Math.max(0, Math.min(1, Number(effect.params?.opacity?.value ?? effect.params?.opacity ?? 1))),
                        maskImage: safeUrl, WebkitMaskImage: safeUrl,
                        maskSize: framed ? 'cover' : '100% 100%', WebkitMaskSize: framed ? 'cover' : '100% 100%',
                        maskPosition: 'center', WebkitMaskPosition: 'center',
                        maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
                    }}
                />
            ))}
        </div>
    );
}

const effectFilterId = (clipId, index) => `vibed-effect-${String(clipId || 'layer').replace(/[^a-zA-Z0-9_-]/g, '-')}-${index}`;

function LayerEffectFilters({ clip, scale = 1, currentTime = 0 }) {
    const effectContext = { clipStart: Number(clip.start ?? clip.startTime) || 0, clipDuration: Number(clip.duration) || 0 };
    const effects = (clip.effects || []).map((effect, index) => {
        const sampled = resolveEffectAtTime(effect, currentTime, effectContext);
        return { effect: sampled ? { ...sampled, kind: effect.kind || effect.type } : null, index };
    })
        .filter(({ effect }) => effect)
        .filter(({ effect }) => effect && effect.enabled !== false && ['inner-shadow', 'grain', 'film_grain', 'film-grain', 'chromatic-aberration', 'rgb_split', 'motion-blur', 'blur_motion', 'distortion', 'glitch', 'glow'].includes(effect.kind));
    if (!effects.length) return null;
    return (
        <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', overflow: 'hidden' }}>
            <defs>{effects.map(({ effect, index }) => {
                const p = effect.params || {};
                const n = (key, fallback = 0) => {
                    const raw = p[key]?.value ?? p[key];
                    return Number.isFinite(Number(raw)) ? Number(raw) : fallback;
                };
                const grainFallback = effect.kind === 'film_grain' || effect.kind === 'film-grain' ? n('intensity', 0.15) * 48 : 8;
                const amount = Math.max(0, n('amount', effect.kind === 'rgb_split' ? 5 : effect.kind === 'chromatic-aberration' ? 2 : effect.kind === 'motion-blur' ? 2 : effect.kind === 'distortion' ? 0.018 : grainFallback));
                const blur = Math.max(0, Math.min(16, n('blur', n('radius', 0)))) * scale;
                const x = Math.max(-80, Math.min(80, n('x', n('offsetX', 0)))) * scale;
                const y = Math.max(-80, Math.min(80, n('y', n('offsetY', 0)))) * scale;
                const opacity = Math.max(0, Math.min(1, n('opacity', effect.kind === 'inner-shadow' ? 0.65 : 1)));
                const filterId = effectFilterId(clip.id, index);
                if (effect.kind === 'glow') {
                    const threshold = Math.max(0, Math.min(0.99, n('threshold', 0.7)));
                    const intensity = Math.max(0, Math.min(1, n('intensity', 1) * 0.7));
                    const radius = Math.max(0, Math.min(50, n('radius', 18))) * scale;
                    const color = effectColorCss(p.color);
                    return <filter key={filterId} id={filterId} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
                        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.2126 0.7152 0.0722 0 0" result="luminance-mask" />
                        <feComponentTransfer in="luminance-mask" result="highlight-mask">
                            <feFuncA type="linear" slope={1 / Math.max(0.01, 1 - threshold)} intercept={-threshold / Math.max(0.01, 1 - threshold)} />
                        </feComponentTransfer>
                        <feGaussianBlur in="highlight-mask" stdDeviation={radius} result="bloom" />
                        <feFlood floodColor={color} floodOpacity={intensity} result="glow-tint" />
                        <feComposite in="glow-tint" in2="bloom" operator="in" result="colored-bloom" />
                        <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="colored-bloom" /></feMerge>
                    </filter>;
                }
                if (effect.kind === 'grain' || effect.kind === 'film_grain' || effect.kind === 'film-grain') {
                    const intensity = Math.min(0.48, amount / 8 * 0.16);
                    const frequency = Math.max(0.1, Math.min(1.5, 0.2 + amount / 48));
                    return (
                        <filter key={filterId} id={filterId} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
                            <feTurbulence type="fractalNoise" baseFrequency={frequency} numOctaves="2" seed={n('seed', 9)} result="grain" />
                            <feColorMatrix in="grain" type="saturate" values="0" result="mono-grain" />
                            <feComponentTransfer in="mono-grain" result="grain-alpha"><feFuncA type="table" tableValues={`0 ${intensity}`} /></feComponentTransfer>
                            <feBlend in="SourceGraphic" in2="grain-alpha" mode="soft-light" />
                        </filter>
                    );
                }
                if (effect.kind === 'chromatic-aberration' || effect.kind === 'rgb_split') {
                    const shift = Math.max(0, Math.min(12, amount)) * scale;
                    const angle = effect.kind === 'rgb_split' ? n('angle', 0) * Math.PI / 180 : 0;
                    const dx = shift * Math.cos(angle);
                    const dy = shift * Math.sin(angle);
                    return (
                        <filter key={filterId} id={filterId} x="-8%" y="-4%" width="116%" height="108%" colorInterpolationFilters="sRGB">
                            <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
                            <feOffset in="red" dx={dx} dy={dy} result="red-shift" />
                            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
                            <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
                            <feOffset in="blue" dx={-dx} dy={-dy} result="blue-shift" />
                            <feMerge><feMergeNode in="red-shift" /><feMergeNode in="green" /><feMergeNode in="blue-shift" /></feMerge>
                        </filter>
                    );
                }
                if (effect.kind === 'motion-blur') {
                    const radius = Math.max(0, Math.min(8, amount)) * scale;
                    return <filter key={filterId} id={filterId} x="-8%" y="-4%" width="116%" height="108%"><feGaussianBlur stdDeviation={`${radius / 2} ${radius / 8}`} /></filter>;
                }
                if (effect.kind === 'blur_motion') {
                    // Match the footage compositor's directional blur. A
                    // weighted set of offsets approximates its rotated
                    // one-axis Gaussian while keeping the configured angle;
                    // ordinary CSS blur here made preview disagree with export.
                    const intensity = Math.max(0, Math.min(1, n('intensity', 0.5)));
                    const angle = n('angle', 0) * Math.PI / 180;
                    const extent = intensity * 27 * scale;
                    const sampleCount = 9;
                    const initial = 'motion-average-0';
                    let previous = initial;
                    const taps = [];
                    for (let tap = 0; tap < sampleCount; tap++) {
                        const progress = tap / (sampleCount - 1) - 0.5;
                        const result = `motion-average-${tap + 1}`;
                        if (tap === 0) {
                            const offset = `motion-offset-${tap}`;
                            taps.push(<feOffset key={`${filterId}-offset-${tap}`} in="SourceGraphic"
                                dx={Math.cos(angle) * extent * progress} dy={Math.sin(angle) * extent * progress} result={offset} />);
                            taps.push(<feComponentTransfer key={`${filterId}-weight`} in={offset} result={initial}>
                                <feFuncR type="linear" slope={1 / sampleCount} />
                                <feFuncG type="linear" slope={1 / sampleCount} />
                                <feFuncB type="linear" slope={1 / sampleCount} />
                                <feFuncA type="linear" slope={1 / sampleCount} />
                            </feComponentTransfer>);
                            continue;
                        }
                        const offset = `motion-offset-${tap}`;
                        taps.push(<feOffset key={`${filterId}-offset-${tap}`} in="SourceGraphic"
                            dx={Math.cos(angle) * extent * progress} dy={Math.sin(angle) * extent * progress} result={offset} />);
                        taps.push(<feComposite key={`${filterId}-sum-${tap}`} in={previous} in2={offset}
                            operator="arithmetic" k2="1" k3="1" result={result} />);
                        previous = result;
                    }
                    return <filter key={filterId} id={filterId} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
                        {taps}<feMerge><feMergeNode in={previous} /></feMerge>
                    </filter>;
                }
                if (effect.kind === 'distortion') {
                    const displacement = Math.max(0, Math.min(0.08, amount)) * 280 * scale;
                    return (
                        <filter key={filterId} id={filterId} x="-6%" y="-6%" width="112%" height="112%">
                            <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed={n('seed', 4)} result="warp" />
                            <feDisplacementMap in="SourceGraphic" in2="warp" scale={displacement} xChannelSelector="R" yChannelSelector="G" />
                        </filter>
                    );
                }
                if (effect.kind === 'glitch') {
                    const displacement = Math.max(0, Math.min(24, n('intensity', n('amount', 0.3) * 24))) * scale;
                    return (
                        <filter key={filterId} id={filterId} x="-8%" y="-8%" width="116%" height="116%">
                            <feTurbulence type="fractalNoise" baseFrequency="0.025 0.2" numOctaves="1" seed={n('seed', 7) + Math.floor(Math.max(0, Number(currentTime) || 0) * 12)} result="glitch-noise" />
                            <feDisplacementMap in="SourceGraphic" in2="glitch-noise" scale={displacement} xChannelSelector="R" yChannelSelector="G" />
                        </filter>
                    );
                }
                return (
                    <filter key={filterId} id={filterId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
                        <feGaussianBlur in="SourceAlpha" stdDeviation={blur / 2} result="blurred-alpha" />
                        <feOffset in="blurred-alpha" dx={-x} dy={-y} result="shifted-alpha" />
                        <feComposite in="SourceAlpha" in2="shifted-alpha" operator="out" result="inner-edge" />
                        <feFlood floodColor={p.color || '#000000'} floodOpacity={opacity} result="shadow-color" />
                        <feComposite in="shadow-color" in2="inner-edge" operator="in" result="inner-shadow" />
                        <feComposite in="inner-shadow" in2="SourceGraphic" operator="over" />
                    </filter>
                );
            })}</defs>
        </svg>
    );
}


/**
 * R98 — CSS for a clip's generic drop shadow (stickers/icons/shapes/
 * templates), combined with any motion blur into ONE `filter` string (CSS
 * filter accepts several functions space-separated; a second `filter`
 * property would just overwrite the first, not merge). `drop-shadow`, not
 * `box-shadow`: it follows the element's own alpha silhouette -- a round
 * icon gets a round shadow, not a square one -- which is the whole point for
 * a sticker/icon/shape. The exact same magnitude is reproduced in export by
 * CompositorCompiler.js's compileShadowSource, so a shadow looks the same
 * in the preview and in the rendered video.
 */
function overlayFilterCss(motionBlur, clipShadow, effects = [], clipId = 'layer', currentTime = 0, clip = null) {
    const parts = [];
    if (motionBlur > 0) parts.push(`blur(${motionBlur}px)`);
    if (clipShadow) {
        const dx = Number(clipShadow.dx) || 0;
        const dy = Number(clipShadow.dy) || 0;
        const blur = Math.max(0, Number(clipShadow.blur) || 0);
        const alpha = Math.max(0, Math.min(1, Number.isFinite(Number(clipShadow.opacity)) ? Number(clipShadow.opacity) : 0.55));
        parts.push(`drop-shadow(${dx}px ${dy}px ${blur}px rgba(0,0,0,${alpha}))`);
    }
    for (const [effectIndex, rawEffect] of (Array.isArray(effects) ? effects : []).entries()) {
        const effect = resolveEffectAtTime(rawEffect, currentTime, {
            clipStart: Number(clip?.start ?? clip?.startTime) || 0,
            clipDuration: Number(clip?.duration) || 0,
        });
        if (!effect) continue;
        const p = effect.params || {};
        const kind = effect.kind || effect.type;
        const value = (key, fallback = 1) => {
            const raw = p[key]?.value ?? p[key];
            return Number.isFinite(Number(raw)) ? Number(raw) : fallback;
        };
        const clampValue = (number, min, max) => Math.max(min, Math.min(max, number));
        switch (kind) {
            case 'blur': case 'blur_gaussian': parts.push(`blur(${clampValue(value('radius', value('amount', 0)), 0, 40)}px)`); break;
            case 'blur_radial': break;
            case 'brightness': parts.push(`brightness(${clampValue(value('amount', value('value', 1)), 0, 4)})`); break;
            case 'contrast': parts.push(`contrast(${clampValue(value('amount', value('value', 1)), 0, 4)})`); break;
            case 'saturation': case 'saturate': parts.push(`saturate(${clampValue(value('amount', value('value', 1)), 0, 5)})`); break;
            case 'grayscale': parts.push(`grayscale(${clampValue(value('amount', value('value', 1)), 0, 1)})`); break;
            case 'sepia': parts.push(`sepia(${clampValue(value('amount', value('value', 1)), 0, 1)})`); break;
            case 'hue': case 'hue-rotate': parts.push(`hue-rotate(${clampValue(value('degrees', value('amount', 0)), -360, 360)}deg)`); break;
            case 'color_grade':
                parts.push(`brightness(${clampValue(value('brightness', 100) / 100, 0, 2)}) contrast(${clampValue(value('contrast', 100) / 100, 0, 2)}) saturate(${clampValue(value('saturation', 100) / 100, 0, 2)})`);
                break;
            case 'grain': case 'film_grain': case 'film-grain': case 'chromatic-aberration': case 'rgb_split': case 'motion-blur': case 'distortion': case 'glitch': case 'glow':
                parts.push(`url(#${effectFilterId(clipId, effectIndex)})`); break;
            case 'shadow': parts.push(`drop-shadow(${value('x', value('offsetX', 0))}px ${value('y', value('offsetY', 0))}px ${clampValue(value('blur', 12), 0, 100)}px ${p.color || 'rgba(0,0,0,.55)'})`); break;
            case 'inner-shadow': parts.push(`url(#${effectFilterId(clipId, effectIndex)})`); break;
            case 'stroke': {
                const width = clampValue(value('width', value('amount', 2)), 1, 12);
                const color = p.color || '#ffffff';
                // CSS drop-shadows follow the image alpha; eight short offsets
                // give a clean outline in preview that closely matches the export dilation.
                for (let angle = 0; angle < 360; angle += 45) {
                    const radians = angle * Math.PI / 180;
                    parts.push(`drop-shadow(${Math.cos(radians) * width}px ${Math.sin(radians) * width}px 0 ${color})`);
                }
                break;
            }
            default: break;
        }
    }
    return parts.length ? parts.join(' ') : null;
}

function vectorMatteUrl(clip) {
    const vector = clip?.vector;
    if (!vector) return null;
    const w = Math.max(1, Number(vector.w || clip.metadata?.resolution?.w) || 100);
    const h = Math.max(1, Number(vector.h || clip.metadata?.resolution?.h) || 100);
    return vectorMatteDataUrl(vector, w, h);
}

function trackMatteCss(target, targetMotion, matte, matteMotion, matteUrl, frameAspect = 16 / 9) {
    if (!target || !matte || !matteUrl || !targetMotion || !matteMotion) return {};
    const aspect = clip => {
        const w = Number(clip?.metadata?.resolution?.w || clip?.size?.w);
        const h = Number(clip?.metadata?.resolution?.h || clip?.size?.h);
        return w > 0 && h > 0 ? w / h : 1;
    };
    const box = (clip, motion) => {
        const w = DEFAULT_WIDTH_FRACTION * Math.max(0.01, Number(motion.scale) || 1);
        const h = w / Math.max(0.05, aspect(clip)) / Math.max(0.1, frameAspect);
        return { x: Number(motion.x) - w / 2, y: Number(motion.y) - h / 2, w, h };
    };
    const t = box(target, targetMotion), m = box(matte, matteMotion);
    const x = (m.x - t.x) / t.w, y = (m.y - t.y) / t.h;
    const w = m.w / t.w, h = m.h / t.h;
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return {};
    // CSS positions a mask against the leftover space (box minus mask size).
    // Keep negative percentages when a matte is larger than its target; that
    // is how a deliberately oversized matte remains centered in preview.
    const px = (offset, size) => `${Math.max(-1000, Math.min(1000, offset / (1 - size || 0.0001) * 100))}%`;
    const image = `url("${String(matteUrl).replace(/["\\]/g, '\\$&')}")`;
    const position = `${px(x, w)} ${px(y, h)}`;
    const style = {
        maskImage: image,
        WebkitMaskImage: image,
        maskMode: target.sceneMask?.mode === 'luma' || target.sceneMask?.mode === 'luminance' ? 'luminance' : 'alpha',
        maskSize: `${Math.min(1000, w * 100)}% ${Math.min(1000, h * 100)}%`,
        WebkitMaskSize: `${Math.min(1000, w * 100)}% ${Math.min(1000, h * 100)}%`,
        maskPosition: position,
        WebkitMaskPosition: position,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
    };
    if (target.sceneMask?.invert) {
        // A white opaque base makes `exclude` the inverse of the source mask
        // after alpha/luminance is converted to coverage by the browser.
        style.maskImage = `linear-gradient(#fff 0 0), ${image}`;
        style.WebkitMaskImage = style.maskImage;
        style.maskSize = `100% 100%, ${Math.min(1000, w * 100)}% ${Math.min(1000, h * 100)}%`;
        style.WebkitMaskSize = style.maskSize;
        style.maskPosition = `0 0, ${position}`;
        style.WebkitMaskPosition = style.maskPosition;
        style.maskComposite = 'exclude';
        style.WebkitMaskComposite = 'xor';
    }
    return style;
}

/**
 * Video track mattes cannot be used as CSS mask URLs. Decode the matte at the
 * playhead into a small alpha-preserving canvas image, then apply the same
 * geometry as still/vector mattes. The video stays detached from the DOM and
 * muted; its only job is supplying the current mask frame.
 */
function VideoTrackMattePreview({ target, targetMotion, matte, matteMotion, src, frameAspect, currentTime, isPlaying, children }) {
    const videoRef = React.useRef(null);
    const canvasRef = React.useRef(null);
    const captureRef = React.useRef(null);
    const frameUrlRef = React.useRef(null);
    const clockRef = React.useRef({ sourceTime: 0, isPlaying: false, speed: 1 });
    const [frameUrl, setFrameUrl] = React.useState(null);

    const clampSourceTime = (video, time) => {
        const duration = Number(video?.duration);
        return Number.isFinite(duration) && duration > 0
            ? Math.min(Math.max(0, time), Math.max(0, duration - 0.04))
            : Math.max(0, time);
    };

    React.useEffect(() => {
        if (!src || typeof document === 'undefined') return undefined;
        setFrameUrl(null);
        if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
        frameUrlRef.current = null;
        let disposed = false;
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        videoRef.current = video;

        const capture = () => {
            if (video.readyState < 2) return;
            const sourceWidth = Number(video.videoWidth) || 0;
            const sourceHeight = Number(video.videoHeight) || 0;
            if (!sourceWidth || !sourceHeight) return;
            const scale = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));
            const canvas = canvasRef.current || document.createElement('canvas');
            canvasRef.current = canvas;
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            const context = canvas.getContext('2d', { alpha: true });
            if (!context) return;
            try {
                context.clearRect(0, 0, width, height);
                context.drawImage(video, 0, 0, width, height);
                // Blob URLs avoid base64 strings and synchronous PNG encoding
                // on every decoded video frame. Retire each previous frame as
                // soon as the replacement has been encoded.
                canvas.toBlob((blob) => {
                    if (!blob || disposed) return;
                    const nextUrl = URL.createObjectURL(blob);
                    const previousUrl = frameUrlRef.current;
                    frameUrlRef.current = nextUrl;
                    setFrameUrl(nextUrl);
                    if (previousUrl) URL.revokeObjectURL(previousUrl);
                }, 'image/png');
            } catch (error) {
                // Cross-origin videos without CORS cannot be read as pixels.
                // Keep the last valid matte frame rather than breaking preview.
                console.warn('[GraphicOverlay] video matte frame unavailable:', error?.message);
            }
        };
        captureRef.current = capture;
        const syncWhenReady = () => {
            const clock = clockRef.current;
            try {
                video.playbackRate = clock.speed;
                const sourceTime = clampSourceTime(video, clock.sourceTime);
                if (Math.abs(video.currentTime - sourceTime) > 0.025) video.currentTime = sourceTime;
                if (clock.isPlaying) video.play().catch(() => {});
                else video.pause();
            } catch { /* The browser may not have a seekable frame yet. */ }
        };

        video.addEventListener('loadeddata', capture);
        video.addEventListener('seeked', capture);
        video.addEventListener('loadedmetadata', syncWhenReady);
        video.src = src;
        video.load();

        let callbackId = null;
        let intervalId = null;
        let scheduled = false;
        const scheduleFrame = () => {
            if (scheduled) return;
            scheduled = true;
            if (typeof video.requestVideoFrameCallback === 'function') {
                callbackId = video.requestVideoFrameCallback(() => {
                    callbackId = null;
                    scheduled = false;
                    capture();
                    scheduleFrame();
                });
            } else if (intervalId == null) {
                intervalId = window.setInterval(capture, 100);
            }
        };
        video.addEventListener('playing', scheduleFrame);
        video.addEventListener('loadeddata', scheduleFrame, { once: true });

        return () => {
            disposed = true;
            video.removeEventListener('loadeddata', capture);
            video.removeEventListener('seeked', capture);
            video.removeEventListener('loadedmetadata', syncWhenReady);
            video.removeEventListener('playing', scheduleFrame);
            if (callbackId != null && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(callbackId);
            if (intervalId != null) window.clearInterval(intervalId);
            scheduled = false;
            video.pause();
            video.removeAttribute('src');
            video.load();
            videoRef.current = null;
            captureRef.current = null;
            if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
            frameUrlRef.current = null;
        };
    }, [src]);

    const speed = Number(matte?.speed) > 0 ? Number(matte.speed) : 1;
    const sourceTime = Math.max(0, (Number(matte?.offset) || 0)
        + Math.max(0, Number(currentTime) - (Number(matte?.start) || 0)) * speed);
    React.useEffect(() => {
        clockRef.current = { sourceTime, isPlaying, speed };
    }, [sourceTime, isPlaying, speed]);
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 1) return;
        const boundedSourceTime = clampSourceTime(video, sourceTime);
        try {
            video.playbackRate = speed;
            if (isPlaying) {
                if (Math.abs(video.currentTime - boundedSourceTime) > 0.3) video.currentTime = boundedSourceTime;
                if (video.paused) video.play().catch(() => {});
            } else {
                if (!video.paused) video.pause();
                if (Math.abs(video.currentTime - boundedSourceTime) > 0.025) video.currentTime = boundedSourceTime;
                else if (video.readyState >= 2) captureRef.current?.();
            }
        } catch (error) {
            console.warn('[GraphicOverlay] video matte sync failed:', error?.message);
        }
    }, [sourceTime, isPlaying, speed, src]);

    const dynamicStyle = trackMatteCss(target, targetMotion, matte, matteMotion, frameUrl, frameAspect);
    return React.cloneElement(children, {
        style: { ...children.props.style, ...dynamicStyle },
    });
}

// Must match DEFAULT_WIDTH_FRACTION in motion/Compositor.js's resolveGeometry.
// The export computes an overlay's on-screen size as 25% of frame width times
// clip.scale; the preview needs the identical constant or a sticker would be
// framed differently in the editor than in the exported video — exactly the
// preview/export divergence this whole engine exists to prevent.
const DEFAULT_WIDTH_FRACTION = 25; // as a CSS percent

// Overlay clips can be created from an asset that only has a proxy URL (for
// example while the original upload is still processing). Resolve that URL
// the same way IDELayout does for Revideo's main video tracks; otherwise the
// video renderer may receive an unserved storage path or be skipped entirely.
function resolveOverlayMediaUrl(clip, asset) {
    const rawUrl = clip?.proxyUrl || asset?.proxyUrl || clip?.url || clip?.sourceUrl
        || asset?.url || asset?.sourceUrl || asset?.fileUrl || asset?.downloadUrl;
    if (!rawUrl) return null;
    if (rawUrl.startsWith('https://storage.googleapis.com/')) {
        const objectPath = rawUrl.slice('https://storage.googleapis.com/'.length).split('/').slice(1).join('/');
        return `/api/proxy/gcs-media/${objectPath}`;
    }
    if (rawUrl.startsWith('proxies/') || rawUrl.startsWith('raw/')) {
        return `/api/proxy/gcs-media/${rawUrl}`;
    }
    return rawUrl;
}

// Preview<->export shadow parity. CompositorCompiler.js's compileShadowSource
// scales clip.shadow.{dx,dy,blur} by frame.width / REFERENCE_WIDTH (a FLAT,
// aspect-ratio-INDEPENDENT reference, per Compositor.js's normalizeShadow doc
// comment) so a shadow reads the same size at 720p and at 4K. The preview
// here never implemented that scaling and applied the raw values as literal
// CSS px, so a sticker's shadow rendered far larger/more diffuse in the
// editor (where the overlay box is almost always much smaller than 1080px
// wide) than in the export. Must stay a flat 1080, NOT
// getPlayerDimensions(aspectRatio).width (that's the aspect-aware reference
// TextOverlay.jsx uses for fontSize/stroke -- a different convention).
const SHADOW_REFERENCE_WIDTH = 1080;

function scaleShadow(shadow, scale) {
    if (!shadow) return shadow;
    return {
        ...shadow,
        dx: (Number(shadow.dx) || 0) * scale,
        dy: (Number(shadow.dy) || 0) * scale,
        blur: Math.max(0, (Number(shadow.blur) || 0) * scale),
    };
}

function resolveShakeTransform(effects, currentTime, clip, scale) {
    const context = {
        clipStart: Number(clip?.start ?? clip?.startTime) || 0,
        clipDuration: Number(clip?.duration) || 0,
    };
    let x = 0, y = 0, rotation = 0;
    for (const authored of Array.isArray(effects) ? effects : []) {
        const effect = resolveEffectAtTime(authored, currentTime, context);
        if (!effect || (effect.kind || effect.type) !== 'shake') continue;
        const p = effect.params || {};
        const read = (key, fallback) => {
            const value = Number(p[key]?.value ?? p[key] ?? fallback);
            return Number.isFinite(value) ? value : fallback;
        };
        const frequency = Math.max(1, Math.min(60, read('frequency', 10)));
        const seed = Math.max(0, Math.min(1000, read('randomSeed', read('seed', 0))));
        const phase = seed * 0.61803398875;
        const intensity = Math.max(0, Math.min(50, read('intensity', 5))) * scale;
        const angle = 2 * Math.PI * Number(currentTime || 0) * frequency;
        x += Math.sin(angle + phase) * intensity;
        y += Math.cos(angle * 0.83 + phase + 1.7) * intensity;
        rotation += Math.sin(angle * 0.83 + phase + 1.7)
            * Math.max(0, Math.min(180, read('rotationAmount', 0)));
    }
    return x || y || rotation
        ? `translate(${x}px, ${y}px) rotate(${rotation}deg)`
        : undefined;
}

const GraphicOverlay = ({ placementFilter = 'all', onWarning = null }) => {
    const containerRef = React.useRef(null);
    const gestureRef = React.useRef({});
    const clipElRefs = React.useRef({});

    const { currentTime, tracks, assets, waveformsByAsset, activeClipId, updateClip, setActiveClip, saveToHistory, isPlaying, aspectRatio } = useTimelineStore(useShallow(state => ({
        currentTime:   state.currentTime,
        isPlaying:     state.isPlaying,
        tracks:        state.tracks,
        assets:        state.assets,
        waveformsByAsset: state.waveformsByAsset || {},
        activeClipId:  state.activeClipId,
        updateClip:    state.updateClip,
        setActiveClip: state.setActiveClip,
        saveToHistory: state.saveToHistory,
        aspectRatio:   state.aspectRatio,
    })));

    const reactiveAssetIds = React.useMemo(() => [...new Set(tracks.flatMap(track => track.clips || [])
        .map(clip => clip.audioReactive?.assetId).filter(Boolean))], [tracks]);
    React.useEffect(() => {
        for (const assetId of reactiveAssetIds) {
            if (waveformsByAsset[assetId]?.peaks?.length) continue;
            const asset = assets.find(item => item.id === assetId);
            if (!asset) continue;
            WaveformEngine.getPeaks(assetId, { gcsPath: asset.gcsPath || asset.storagePath || null, proxyUrl: asset.proxyUrl || asset.url || null })
                .catch(error => console.warn('[GraphicOverlay] audio envelope unavailable:', error?.message));
        }
    }, [reactiveAssetIds.join('|'), assets, waveformsByAsset]);

    // Every hook must run on EVERY render, so this one stays ABOVE the early
    // return below. It used to sit under it: a project with no overlay track
    // bailed out before this useMemo, so the first render that DID have one
    // called one hook more than the previous render -> React error #310
    // ("rendered more hooks than during the previous render"), which threw out
    // of render and unmounted the whole player subtree -- a blank dark preview
    // with nothing in the UI to explain it. Previewing a short hits exactly
    // that: agent/shortPolish.js adds track-short-graphics (type 'overlay')
    // to a timeline that usually had no overlay track at all.
    const hasActiveMatte = React.useMemo(() => {
        const vidClips = tracks.filter(t => t.type === 'video' || t.type === 'image').flatMap(t => t.clips || []);
        return vidClips.some(c => c.layerTarget === 'background' && c.layerMask && currentTime >= c.start && currentTime < c.start + c.duration);
    }, [tracks, currentTime]);

    // Preview<->export shadow parity (see SHADOW_REFERENCE_WIDTH above).
    // Hook stays above the early return below for the same reason
    // hasActiveMatte does (see its comment): every hook must run on every
    // render or a timeline with no overlay track throws React error #310.
    const [shadowScale, setShadowScale] = React.useState(1);
    React.useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const recompute = () => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0) setShadowScale(rect.width / SHADOW_REFERENCE_WIDTH);
        };
        recompute();
        const observer = new ResizeObserver(recompute);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Match the export compositor's track roles. The first video/image track
    // is the base layer; later video, image and graphic tracks render above it.
    // Previously only explicit `overlay` tracks appeared here, so clips placed
    // on a second video track were editable in the timeline but invisible in
    // preview even though export treated them as composited layers.
    const { overlayTracks: visualOverlayTracks } = getVisualTrackRoles(tracks);
    const overlayTracks = visualOverlayTracks;
    if (overlayTracks.length === 0) return null;

    // Scene mattes are ordinary scene nodes in the authoring model. In the
    // preview, resolve the node reference to its overlay clip and render it as
    // a CSS alpha mask instead of showing it as a second visible graphic.
    const sceneNodeClips = new Map();
    for (const track of tracks) {
        for (const clip of track.clips || []) {
            if (clip.sceneId && clip.sceneNodeId) sceneNodeClips.set(`${clip.sceneId}:${clip.sceneNodeId}`, { clip, track });
        }
    }
    const matteNodeKeys = new Set();
    for (const track of overlayTracks) {
        for (const clip of track.clips || []) {
            if (clip.sceneMask?.kind === 'layer' && clip.sceneId && clip.sceneMask.nodeId) {
                matteNodeKeys.add(`${clip.sceneId}:${clip.sceneMask.nodeId}`);
            }
        }
    }

    const activeClips = overlayTracks.flatMap(track =>
        track.clips
            .filter(clip => {
                if (!(currentTime >= clip.start && currentTime < clip.start + clip.duration)) return false;
                if (clip.sceneId && clip.sceneNodeId && matteNodeKeys.has(`${clip.sceneId}:${clip.sceneNodeId}`)) return false;
                const isSandwich = clip.placement === 'behind_subject' || clip.placement === 'behind_speaker';
                if (placementFilter === 'behind_subject') return isSandwich;
                if (placementFilter === 'front') return hasActiveMatte ? !isSandwich : true;
                return true;
            })
            .map(clip => ({ clip, trackId: track.id, trackType: track.type }))
    );
    if (activeClips.length === 0) return null;

    const handlePointerDown = (e, clip, trackId) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setActiveClip(clip.id);

        const gs = gestureRef.current;
        if (!gs[clip.id]) gs[clip.id] = { pointers: {} };
        const state = gs[clip.id];
        state.pointers[e.pointerId] = { clientX: e.clientX, clientY: e.clientY };
        const pointerCount = Object.keys(state.pointers).length;

        if (pointerCount === 1 && hasLayoutFrame(clip)) {
            // A clip in a layout preset stays in its box; dragging pans the
            // picture inside the box (the crop focus) instead.
            saveToHistory();
            state.primaryPointerId = e.pointerId;
            const box = clipElRefs.current[clip.id]?.getBoundingClientRect();
            state.dragStartX = e.clientX;
            state.dragStartY = e.clientY;
            state.boxW = box?.width || 1;
            state.boxH = box?.height || 1;
            state.initialFocusX = Number(clip.frame.focusX ?? 0.5);
            state.initialFocusY = Number(clip.frame.focusY ?? 0.5);
            state.mode = 'focus';
            state.trackId = trackId;
        } else if (pointerCount === 1) {
            saveToHistory();
            state.primaryPointerId = e.pointerId;
            state.dragStartX   = e.clientX;
            state.dragStartY   = e.clientY;
            state.initialClipX = typeof clip.x === 'number' ? clip.x : 78;
            state.initialClipY = typeof clip.y === 'number' ? clip.y : 18;
            state.mode         = 'drag';
            state.trackId      = trackId;
            {
                const fr = containerRef.current?.getBoundingClientRect();
                const own = clipElRefs.current[clip.id]?.getBoundingClientRect();
                state.snap = fr && fr.width > 0 ? {
                    frameW: fr.width, frameH: fr.height,
                    w: own ? (own.width / fr.width) * 100 : 0,
                    h: own ? (own.height / fr.height) * 100 : 0,
                    // Group members move together, so they are not snap targets.
                    others: measureOthers(containerRef.current, clip.id)
                        .filter(o => !(clip.groupId && clipsInGroup(tracks, clip.groupId).some(g => g.clip.id === o.id))),
                } : null;
            }
            // R66 — snapshot every group member's OWN starting x/y (across
            // ALL tracks, not just this one) once, up front — the same
            // "capture initial, then add delta" shape the single-clip case
            // already uses just below, so neither path drifts from a stale
            // closure read mid-gesture. Always includes the dragged clip
            // itself, so one loop in handlePointerMove covers everyone.
            state.groupMembers = clip.groupId
                ? clipsInGroup(tracks, clip.groupId).map(({ trackId: tId, clip: c }) => ({
                    trackId: tId, clipId: c.id,
                    initialX: typeof c.x === 'number' ? c.x : 78,
                    initialY: typeof c.y === 'number' ? c.y : 18,
                }))
                : null;
        }
        // A second finger landing on the clip is tracked (so pointerUp's
        // bookkeeping stays correct) but intentionally does nothing else —
        // resize only happens via the corner handles now (R119).
    };

    const handlePointerMove = (e, clip) => {
        e.stopPropagation();
        const gs = gestureRef.current;
        const state = gs[clip.id];
        if (!state || !state.pointers[e.pointerId]) return;
        state.pointers[e.pointerId] = { clientX: e.clientX, clientY: e.clientY };
        // Only the pointer that started the gesture drives it — a second
        // finger resting on the clip must not hijack dragStartX/Y.
        if (e.pointerId !== state.primaryPointerId) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        if (state.mode === 'focus') {
            const clamp01 = (v) => Math.max(0, Math.min(1, v));
            // Dragging the picture right reveals more of its left side.
            const focusX = clamp01(state.initialFocusX - (e.clientX - state.dragStartX) / state.boxW);
            const focusY = clamp01(state.initialFocusY - (e.clientY - state.dragStartY) / state.boxH);
            updateClip(state.trackId, clip.id, { frame: { ...clip.frame, focusX, focusY } }, { skipHistory: true });
            return;
        }

        if (state.mode === 'drag') {
            const deltaX = e.clientX - state.dragStartX;
            const deltaY = e.clientY - state.dragStartY;
            let deltaXPct = (deltaX / rect.width)  * 100;
            let deltaYPct = (deltaY / rect.height) * 100;
            // R92: snap the dragged clip; the group follows the same delta.
            if (state.snap) {
                const s = computeSnap({ x: state.initialClipX + deltaXPct, y: state.initialClipY + deltaYPct, w: state.snap.w, h: state.snap.h },
                    { others: state.snap.others, aspectRatio, frameW: state.snap.frameW, frameH: state.snap.frameH, disabled: e.altKey });
                deltaXPct = s.x - state.initialClipX;
                deltaYPct = s.y - state.initialClipY;
                useSnapGuides.getState().setGuides(s.guides);
            }
            if (state.groupMembers) {
                // R66 — grouped drag: every member (this clip included) moves
                // by the SAME percent delta from ITS OWN starting position.
                for (const m of state.groupMembers) {
                    updateClip(m.trackId, m.clipId, { x: m.initialX + deltaXPct, y: m.initialY + deltaYPct }, { skipHistory: true });
                }
            } else {
                const newX = state.initialClipX + deltaXPct;
                const newY = state.initialClipY + deltaYPct;
                updateClip(state.trackId, clip.id, { x: newX, y: newY }, { skipHistory: true });
            }
        }
    };

    const handlePointerUp = (e, clip) => {
        e.stopPropagation();
        const gs = gestureRef.current;
        const state = gs[clip.id];
        if (!state) return;
        delete state.pointers[e.pointerId];
        if (Object.keys(state.pointers).length === 0) {
            delete gs[clip.id];
            useSnapGuides.getState().clear();
        }
    };

    return (
        <div ref={containerRef} className={`absolute inset-0 pointer-events-none overflow-hidden ${placementFilter === 'behind_subject' ? 'z-[2]' : 'z-10'}`}>
            {renderGroupedOverlayEntries(activeClips, activeClips.map(({ clip, trackId, trackType }) => {
                const isActive = clip.id === activeClipId;
                const asset = clip.assetId ? assets.find(item => item.id === clip.assetId) : null;

                const layer = clipToMotionLayer(clip, { id: trackId, type: 'overlay' });
                const resolvedMotion = layer
                    ? resolveMotionAt(layer, currentTime, { audioWaveformsByAsset: waveformsByAsset })
                    : { x: clip.x ?? 78, y: clip.y ?? 18, scale: clip.scale || 1, rotation: 0, opacity: clip.opacity ?? 1, blur: 0 };
                const groupOpacity = (clip.compositionStack || []).reduce((product, item) => product * Math.max(0, Math.min(1, Number(item.opacity ?? 1))), 1);
                const motion = { ...resolvedMotion, opacity: groupOpacity > 1e-6 ? resolvedMotion.opacity / groupOpacity : resolvedMotion.opacity };

                const isTemplate = (clip.type === 'template' && !!clip.template) || (clip.type === 'vector' && !!clip.vector);
                const frameAspect = typeof aspectRatio === 'number' ? aspectRatio
                    : typeof aspectRatio === 'string' && aspectRatio.includes(':')
                        ? Number(aspectRatio.split(':')[0]) / Number(aspectRatio.split(':')[1])
                        : 16 / 9;
                const sceneOwnsMotionBlur = clip.template?.kind === '3d-scene' && clip.template?.params?.scene?.motionBlur?.enabled;
                const transformBlurContext = clip.motionBlur?.enabled && !sceneOwnsMotionBlur && !hasLayoutFrame(clip)
                    ? { layer, base: resolvedMotion, frameAspect }
                    : null;
                const src = resolveOverlayMediaUrl(clip, asset);
                if (!src && !isTemplate) return null;

                const matteEntry = clip.sceneMask?.kind === 'layer' && clip.sceneId
                    ? sceneNodeClips.get(`${clip.sceneId}:${clip.sceneMask.nodeId}`)
                    : null;
                const matteClip = matteEntry?.clip;
                const matteTrack = matteEntry?.track;
                const matteAsset = matteClip?.assetId ? assets.find(item => item.id === matteClip.assetId) : null;
                const matteIsVector = matteClip?.type === 'vector' && !!matteClip.vector;
                const matteIsVideo = matteClip?.type === 'video';
                const matteVideoSrc = matteIsVideo ? resolveOverlayMediaUrl(matteClip, matteAsset) : null;
                const matteUrl = matteIsVector ? vectorMatteUrl(matteClip)
                    : matteIsVideo ? null
                        : resolveOverlayMediaUrl(matteClip, matteAsset);
                const matteLayer = matteClip && clipToMotionLayer(matteClip, { id: matteTrack?.id, type: matteTrack?.type });
                const matteMotion = matteLayer ? resolveMotionAt(matteLayer, currentTime) : null;
                const matteStyle = trackMatteCss(clip, motion, matteClip, matteMotion, matteUrl, frameAspect);
                const withMattePreview = element => matteIsVideo && matteVideoSrc
                    ? <VideoTrackMattePreview target={clip} targetMotion={motion} matte={matteClip}
                        matteMotion={matteMotion} src={matteVideoSrc} frameAspect={frameAspect}
                        currentTime={currentTime} isPlaying={isPlaying}>{element}</VideoTrackMattePreview>
                    : element;

                const transform = [
                    'translate(-50%, -50%)',
                    motion.rotation ? `rotate(${motion.rotation}deg)` : '',
                    `scaleX(${motion.scaleX ?? 1})`,
                    `scaleY(${motion.scaleY ?? 1})`,
                ].filter(Boolean).join(' ');
                const revealClip = Number.isFinite(motion.reveal) && motion.reveal < 0.999
                    ? `inset(0 ${(1 - Math.max(0, Math.min(1, motion.reveal))) * 100}% 0 0)`
                    : undefined;

                const isVideo = (clip.type || trackType) === 'video';
                const handlers = {
                    onPointerDown: (e) => handlePointerDown(e, clip, trackId),
                    onPointerMove: (e) => handlePointerMove(e, clip),
                    onPointerUp: (e) => handlePointerUp(e, clip),
                    onPointerCancel: (e) => handlePointerUp(e, clip),
                };
                const setRef = (el) => { if (el) clipElRefs.current[clip.id] = el; else delete clipElRefs.current[clip.id]; };

                // R88 layout presets: a fixed box, the media covering it
                // (object-fit: cover around the focus point). Same arithmetic
                // as the export's scale+crop (CompositorCompiler, `fit`).
                if (hasLayoutFrame(clip)) {
                    const css = frameToCss(clip.frame);
                    const effectContext = { clipStart: Number(clip.start ?? clip.startTime) || 0, clipDuration: Number(clip.duration) || 0 };
                    const framedFilter = overlayFilterCss(0, scaleShadow(clip.shadow, shadowScale), clip.effects, clip.id, currentTime, clip);
                    const framedShake = resolveShakeTransform(clip.effects, currentTime, clip, shadowScale);
                    const vignetteStyle = resolveTimelineVignetteStyle((clip.effects || []).map(effect => resolveEffectAtTime(effect, currentTime, effectContext)).filter(Boolean), currentTime, effectContext);
                    const fadeOverlays = resolveTimelineFadeOverlays(clip.effects, currentTime, effectContext);
                    const alphaFade = isVideo ? 1 : resolveTimelineFadeOpacity(clip.effects, currentTime, effectContext);
                    const mediaStyle = {
                        ...css.media,
                        opacity: motion.opacity * alphaFade,
                        ...(framedShake ? { transform: framedShake, transformOrigin: 'center' } : {}),
                        ...(framedFilter ? { filter: framedFilter } : {}),
                        pointerEvents: 'none',
                    };
                    return withMattePreview(
                        <div
                            key={clip.id}
                            ref={setRef}
                        data-snap-id={clip.id}
                            {...handlers}
                            className={`absolute select-none ${isActive ? 'ring-1 ring-primary ring-inset' : ''}`}
                            style={{ ...css.box, ...sceneMaskCss(clip.sceneMask), ...(revealClip ? { clipPath: revealClip } : {}), ...matteStyle, ...(clip.blendMode && clip.blendMode !== 'source-over' ? { mixBlendMode: clip.blendMode === 'addition' ? 'plus-lighter' : clip.blendMode } : {}), pointerEvents: 'auto', touchAction: 'none', cursor: isActive ? 'grab' : 'pointer' }}
                        >
                            <LayerEffectFilters clip={clip} scale={shadowScale} currentTime={currentTime} />
                            {isVideo
                                ? <OverlayVideo clip={clip} src={src} currentTime={currentTime} isPlaying={isPlaying} style={mediaStyle} />
                                : <OverlayImage clip={clip} src={src} style={mediaStyle} framed currentTime={currentTime} />}
                            {isVideo && fadeOverlays.map((fade, index) => <div key={`fade-${index}`} aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundColor: fade.color, opacity: fade.opacity, pointerEvents: 'none' }} />)}
                            {vignetteStyle && <div aria-hidden="true" style={vignetteStyle} />}
                        </div>
                    );
                }

                // The wrapper carries position/size/rotation so the rotate
                // handle (a child) can sit on the sticker's corner; opacity and
                // blur stay on the media so the handle itself never fades.
                    const effectContext = { clipStart: Number(clip.start ?? clip.startTime) || 0, clipDuration: Number(clip.duration) || 0 };
                    const overlayFilter = overlayFilterCss(motion.blur, scaleShadow(clip.shadow, shadowScale), clip.effects, clip.id, currentTime, clip);
                const shakeTransform = resolveShakeTransform(clip.effects, currentTime, clip, shadowScale);
                const vignetteStyle = resolveTimelineVignetteStyle((clip.effects || []).map(effect => resolveEffectAtTime(effect, currentTime, effectContext)).filter(Boolean), currentTime, effectContext);
                const fadeOverlays = resolveTimelineFadeOverlays(clip.effects, currentTime, effectContext);
                const alphaFade = isVideo ? 1 : resolveTimelineFadeOpacity(clip.effects, currentTime, effectContext);
                const mediaStyle = {
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    opacity: transformBlurContext ? alphaFade : motion.opacity * alphaFade,
                    ...(shakeTransform ? { transform: shakeTransform, transformOrigin: 'center' } : {}),
                    ...(overlayFilter ? { filter: overlayFilter } : {}),
                    pointerEvents: 'none',
                };
                return withMattePreview(
                    <div
                        key={clip.id}
                        ref={setRef}
                        data-snap-id={clip.id}
                        {...handlers}
                        className={`absolute select-none origin-center ${isActive ? 'ring-1 ring-primary ring-offset-1 ring-offset-transparent' : ''}`}
                        style={{
                            left: `${motion.x}%`,
                            top: `${motion.y}%`,
                            width: `${DEFAULT_WIDTH_FRACTION * (Number.isFinite(motion.scale) ? motion.scale : 1)}%`,
                            transform,
                            ...sceneMaskCss(clip.sceneMask),
                            ...(revealClip ? { clipPath: revealClip } : {}),
                            ...matteStyle,
                            ...(clip.blendMode && clip.blendMode !== 'source-over' ? { mixBlendMode: clip.blendMode === 'addition' ? 'plus-lighter' : clip.blendMode } : {}),
                            pointerEvents: 'auto',
                            touchAction: 'none',
                            cursor: 'move',
                        }}
                    >
                        <LayerEffectFilters clip={clip} scale={shadowScale} currentTime={currentTime} />
                        {isTemplate
                            ? <TemplateCanvas clip={clip} currentTime={currentTime}
                                motionBlurMotion={transformBlurContext}
                                onWarning={onWarning}
                                style={{ opacity: transformBlurContext ? alphaFade : motion.opacity * alphaFade, pointerEvents: 'none', ...(shakeTransform ? { transform: shakeTransform, transformOrigin: 'center' } : {}), ...(overlayFilter ? { filter: overlayFilter } : {}) }} />
                            : isVideo
                            ? <OverlayVideo clip={clip} src={src} currentTime={currentTime} isPlaying={isPlaying} style={mediaStyle} motionContext={transformBlurContext} />
                            : <OverlayImage clip={clip} src={src} style={mediaStyle} currentTime={currentTime} motionContext={transformBlurContext} />}
                        {isVideo && fadeOverlays.map((fade, index) => <div key={`fade-${index}`} aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundColor: fade.color, opacity: fade.opacity, pointerEvents: 'none' }} />)}
                        {vignetteStyle && <div aria-hidden="true" style={vignetteStyle} />}
                        {isActive && (
                            <RotateHandle
                                getElement={() => clipElRefs.current[clip.id]}
                                rotation={Number(clip.rotation) || 0}
                                onStart={() => saveToHistory()}
                                onLive={(deg) => updateClip(trackId, clip.id, { rotation: deg }, { skipHistory: true })}
                                onCommit={(deg) => updateClip(trackId, clip.id, { rotation: deg }, { skipHistory: true })}
                            />
                        )}
                        {isActive && (
                            <ResizeHandle
                                getElement={() => clipElRefs.current[clip.id]}
                                scale={Number(clip.scale) || 1}
                                onStart={() => saveToHistory()}
                                onLive={(s) => updateClip(trackId, clip.id, { scale: s }, { skipHistory: true })}
                                onCommit={(s) => updateClip(trackId, clip.id, { scale: s }, { skipHistory: true })}
                            />
                        )}
                    </div>
                );
            }), currentTime, currentTime)}
        </div>
    );
};

export default GraphicOverlay;
