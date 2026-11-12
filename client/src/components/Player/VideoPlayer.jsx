/**
 * NOT MOUNTED TODAY (R165) — and it is the root of the largest unreachable
 * cluster in the client.
 *
 * Nothing imports this file. The live preview is rendered by IDELayout's own
 * preview stage with <BaseClipOverlay />, <TextOverlay /> and
 * <GraphicOverlay /> (which draws TemplateCanvas) on top of it. TextOverlay's
 * own header already noted this about CaptionOverlay.
 *
 * What hangs off it, reachable through nothing else:
 *   engine/PlaybackEngine.js  → engine/VideoWorker.js, MasterClock, RingBuffer,
 *                               MP4Demuxer, audioResample, webglContextLifecycle
 *   effects/index.js          → EffectPipeline, EffectRenderer, EffectGraph,
 *                               engines/{GPU,CPU,AI}Effects, presets/*
 *   Player/CaptionOverlay.jsx, DebugOverlay, FatigueAlert, ObjectLayerOverlay
 *
 * That is roughly 4,500 lines of WebGL effect runtime plus the custom WebCodecs
 * playback engine. The consequence worth knowing: this file is the ONLY place
 * that ever sets `gpuPreview: true` (see motion/TimelineVisualEffects.js's
 * isEffectHandledByGpuPreview), so in the live editor every GPU effect falls
 * back to its CSS/SVG approximation, and only renders through the real filter
 * graph at export time, where the SERVER compositor
 * (server/compositor/CompositorCompiler.js) does the work independently.
 *
 * So the engine is not broken and not unused — the AI sets effects through
 * VideoEditorTools' apply_motion_effect_stack, the preview approximates them
 * and the export renders them. What is unreachable is this client-side
 * WebGL/WebCodecs path. Reviving it is a real decision (two playback engines,
 * two effect renderers), not a wiring fix.
 */
import React, { useRef, useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import useTimelineStore from '../../store/useTimelineStore';
import { audioEngineAPI } from '../../audio-engine/AudioEngineAPI.js';
import { getVisualTrackRoles } from '../../motion/Compositor.js';
import { clipToMotionLayer } from '../../motion/ClipAdapter.js';
import { resolveMotionAt, sampleKeyframeTrack } from '../../motion/MotionResolver.js';
import { composeAnimatedCrop } from '../../motion/CameraMotionCompiler.js';
import CaptionOverlay from './CaptionOverlay';
import TextOverlay from './TextOverlay';
import GraphicOverlay from './GraphicOverlay';
import FatigueAlert from './FatigueAlert';
import DebugOverlay from './DebugOverlay';
import PlaybackEngine from '../../engine/PlaybackEngine';
import ObjectLayerOverlay from './ObjectLayerOverlay'; // R67 — Object Intelligence "blur background"
import TransitionLayer from './TransitionLayer.jsx';
import { transitionTransform, transitionFilter } from './transitionStyle.js';
import { transitionWindows, fxAtTime } from '../../motion/TransitionFX.js';
import { combinePreviewFilters, resolveTimelineEffectFilter, resolveTimelineLutPreviewFilter, resolveTimelineEffectTransform, resolveTimelineFadeOverlays, resolveTimelineSvgEffectParams, resolveTimelineSvgEffectInstances, resolveTimelineVignetteStyle } from '../../motion/TimelineVisualEffects.js';
import { drawRadialBlur, previewCanvasSize } from '../../motion/RadialBlurPreview.js';
import { useDeviceType } from '../../hooks/useDeviceType.js';
import { createTimelineRetimeMap, mapSourceTimeToTimeline, mapTimelineTimeToRate, mapTimelineTimeToSource, serializeTimelineRetimeMap } from '../../timeline/retimeMap.js';

/**
 * Interpolates a keyframe track at `localTime` (clip-local seconds).
 * Shared by the CSS-transform block (plain zoom-rhythm, no multicam) and the
 * crop-composition effect (zoom-rhythm ON TOP of a virtual-multicam crop) so
 * both use identical easing — see the "compose, don't stack" note on
 * computeComposedCrop below.
 */
function TimelineEffectFilterDefinitions({ instances = [], timelineEffectTime = 0 }) {
    return instances.map(({ id, kind, params }) => {
        const p = params;
        switch (kind) {
            case 'color_grade':
                return <filter key={id} id={id} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={`1 0 0 0 ${(p.colorGrade.temperature * 0.003).toFixed(4)}  0 1 0 0 ${(p.colorGrade.tint * 0.003).toFixed(4)}  0 0 1 0 ${(-p.colorGrade.temperature * 0.003).toFixed(4)}  0 0 0 1 0`} /></filter>;
            case 'grain': case 'film_grain': case 'film-grain':
                return <filter key={id} id={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
                    <feTurbulence type="fractalNoise" baseFrequency={(0.72 / p.grain.size).toFixed(4)} numOctaves="2" seed={p.grain.seed + (p.grain.animated ? Math.floor(timelineEffectTime * 30) : 0)} result="grain" />
                    <feColorMatrix in="grain" type="saturate" values="0" result="mono-grain" />
                    <feComponentTransfer in="mono-grain" result="grain-alpha"><feFuncA type="table" tableValues={`0 ${p.grain.intensity}`} /></feComponentTransfer>
                    <feBlend in="SourceGraphic" in2="grain-alpha" mode="soft-light" />
                </filter>;
            case 'chromatic-aberration': case 'rgb_split':
                return <filter key={id} id={id} x="-8%" y="-4%" width="116%" height="108%" colorInterpolationFilters="sRGB">
                    <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
                    <feOffset in="red" dx={p.chromatic.amount * Math.cos(p.chromatic.angle * Math.PI / 180)} dy={p.chromatic.amount * Math.sin(p.chromatic.angle * Math.PI / 180)} result="red-shift" />
                    <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
                    <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
                    <feOffset in="blue" dx={-p.chromatic.amount * Math.cos(p.chromatic.angle * Math.PI / 180)} dy={-p.chromatic.amount * Math.sin(p.chromatic.angle * Math.PI / 180)} result="blue-shift" />
                    <feMerge><feMergeNode in="red-shift" /><feMergeNode in="green" /><feMergeNode in="blue-shift" /></feMerge>
                </filter>;
            case 'blur_motion': case 'motion-blur':
                return <filter key={id} id={id} x="-8%" y="-4%" width="116%" height="108%"><feGaussianBlur stdDeviation={`${p.motion.amount} ${p.motion.amount * 0.21}`} /></filter>;
            case 'distortion': case 'lens-distortion':
                return <filter key={id} id={id} x="-6%" y="-6%" width="112%" height="112%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="4" result="warp" /><feDisplacementMap in="SourceGraphic" in2="warp" scale={p.distortion.amount} xChannelSelector="R" yChannelSelector="G" /></filter>;
            case 'glitch':
                return <filter key={id} id={id} x="-8%" y="-2%" width="116%" height="104%" colorInterpolationFilters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0 0.08" numOctaves="1" seed={Math.floor(p.glitch.seed + timelineEffectTime * 12)} result="bands" /><feDisplacementMap in="SourceGraphic" in2="bands" scale={p.glitch.amount} xChannelSelector="R" yChannelSelector="R" /></filter>;
            case 'glow':
                return <filter key={id} id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
                    <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.2126 0.7152 0.0722 0 0" result="luminance-mask" />
                    <feComponentTransfer in="luminance-mask" result="highlight-mask"><feFuncA type="linear" slope={1 / Math.max(0.01, 1 - p.glow.threshold)} intercept={-p.glow.threshold / Math.max(0.01, 1 - p.glow.threshold)} /></feComponentTransfer>
                    <feGaussianBlur in="highlight-mask" stdDeviation={p.glow.radius} result="bloom" />
                    <feFlood floodColor={p.glow.color} floodOpacity={Math.min(1, p.glow.intensity * 0.7)} result="glow-tint" />
                    <feComposite in="glow-tint" in2="bloom" operator="in" result="colored-bloom" />
                    <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="colored-bloom" /></feMerge>
                </filter>;
            default: return null;
        }
    });
}

function interpolateKeyframes(propKeyframes, defaultVal, localTime) {
    return sampleKeyframeTrack(propKeyframes, localTime, defaultVal);
}

/**
 * Composes a virtual-multicam crop with a zoom-rhythm scale keyframe track
 * into ONE effective crop rectangle, instead of stacking the multicam crop
 * (WebGL UV sub-region) and the rhythm zoom (CSS transform scale) as two
 * independent transforms — which is what used to happen, and which silently
 * over-zoomed/cropped-out faces whenever both effects landed on the same clip
 * (see CLAUDE.md R16).
 *
 * The rhythm scale is applied WITHIN the multicam window, re-centered on the
 * SAME point the multicam angle detected (not frame-center) — so a punch-in
 * on a close-up shot zooms further into that same close-up.
 *
 * @param {{cropX:number,cropY:number,cropW:number,cropH:number}} baseCrop
 * @param {number} extraScale  — interpolated keyframe scale (1.0 = no extra zoom)
 * @returns {{cropX:number,cropY:number,cropW:number,cropH:number}}
 */
function RadialFootageCanvas({ videoRef, radial, isPlaying, style }) {
    const canvasRef = useRef(null);
    const [ready, setReady] = useState(false);
    const paintRef = useRef(null);
    paintRef.current = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        const size = previewCanvasSize(video.videoWidth, video.videoHeight);
        if (canvas.width !== size.width || canvas.height !== size.height) {
            canvas.width = size.width;
            canvas.height = size.height;
        }
        try {
            drawRadialBlur(canvas.getContext('2d', { alpha: true }), video, size.width, size.height, radial);
            setReady(true);
        } catch (error) {
            setReady(false);
            console.warn('[VideoPlayer] Radial blur fallback unavailable:', error?.message);
        }
    };
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return undefined;
        const redraw = () => paintRef.current?.();
        video.addEventListener('loadeddata', redraw);
        video.addEventListener('seeked', redraw);
        redraw();
        return () => {
            video.removeEventListener('loadeddata', redraw);
            video.removeEventListener('seeked', redraw);
        };
    }, [videoRef]);
    useEffect(() => {
        paintRef.current?.();
    }, [radial.intensity, radial.centerX, radial.centerY, radial.samples]);
    useEffect(() => {
        if (!isPlaying) return undefined;
        let raf = null;
        let lastPaint = 0;
        const tick = now => {
            if (now - lastPaint >= 33) {
                paintRef.current?.();
                lastPaint = now;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => { if (raf !== null) cancelAnimationFrame(raf); };
    }, [isPlaying]);
    return <canvas ref={canvasRef} aria-hidden="true" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        objectFit: 'contain', pointerEvents: 'none', display: ready ? 'block' : 'none', ...style,
    }} />;
}

const VideoPlayer = () => {
    const [clipLutPreviewFilters, setClipLutPreviewFilters] = useState({});
    // Phones take the cheap transition filter: the full SVG chain over a live
    // video is what makes playback stutter through a cut on a phone GPU.
    const { isMobile: isMobileViewport } = useDeviceType();
    const { t } = useTranslation('editor');
    const canvasRef = useRef(null);
    const containerRef = useRef(null); // Added containerRef
    const engineRef = useRef(null); // Persist engine instance
    // (prevTimeRef / prevIsPlayingRef removed — seek-on-scrub is now handled by a
    //  dedicated useEffect([currentTime, isPlaying]) so these stale-closure guards
    //  are no longer needed)
    // Native video dimensions from onMetadata — used to pin canvas to source resolution
    // so that ResizeObserver doesn't downgrade it back to container size.
    const nativeVideoDimRef = useRef(null);
    // Project frame aspect as [w, h]. Held in a ref because handleResize lives
    // in a ResizeObserver effect with empty deps — reading the store value
    // directly there would capture the mount-time ratio forever, so switching
    // 9:16 → 16:9 would never resize the buffer. Same trap as R42's labelWRef.
    const frameAspectRef = useRef([16, 9]);
    // Lets the aspect-ratio effect re-run the buffer sizing without duplicating it.
    const resizeHandlerRef = useRef(null);
    // Surfaces PlaybackEngine.onError to the UI. Previously `onError` was never
    // even passed to `new PlaybackEngine(...)` below, so the engine's onError
    // option defaulted to a no-op — a failed decode/config had nowhere to go
    // and the canvas just stayed black with fully-working-looking controls.
    const [playbackError, setPlaybackError] = useState(null);
    const [playbackWarning, setPlaybackWarning] = useState(null);
    // ─── Native <video> fallback (mobile WebCodecs reliability fix) ──────────
    // The primary pipeline (PlaybackEngine → VideoWorker → WebCodecs
    // VideoDecoder/AudioDecoder, composited to a WebGL canvas) has no
    // fallback of any kind — confirmed by reading every engine file, there is
    // no plain <video> anywhere in this pipeline. On iOS Safari that pipeline
    // can fail in ways that are invisible even with error reporting wired up
    // (a WebGL context budget exhaustion throws before the engine object
    // exists at all; a module Worker can fail to boot with no onerror; a
    // codec/profile can be rejected by VideoDecoder.isConfigSupported). All
    // of those previous fixes made the failure VISIBLE (a red error overlay)
    // but did not make the video PLAY. This adds an actual second rendering
    // path: when the primary pipeline fails to initialize at all, or fails
    // for a SPECIFIC source file, fall back to a plain <video> element for
    // that file. It loses the WebGL-only live preview features (color
    // grading CSS filter still applies since that's just a CSS filter, but
    // virtual-multicam crop does not, since that's WebGL UV-sampling) — an
    // acceptable, clearly-scoped trade: the core feature (the video plays)
    // wins over a preview-only nicety, and ONLY in the narrow case where the
    // primary path has already provably failed.
    //
    // enginePermanentlyBroken: the engine couldn't even construct (no WebGL
    // context available at all on this device/tab) — every clip falls back.
    // failedUrls: per-URL — a SPECIFIC file's decode failed (bad codec, dead
    // worker, etc.) without necessarily meaning EVERY other clip in the
    // project would also fail. Scoping per-URL means one broken source file
    // doesn't needlessly downgrade every other clip that would decode fine.
    const [enginePermanentlyBroken, setEnginePermanentlyBroken] = useState(false);
    const [failedUrls, setFailedUrls] = useState(() => new Set());
    const [webglFallbackUrl, setWebglFallbackUrl] = useState(null);
    const fallbackVideoRef = useRef(null);
    const fallbackSrcRef = useRef(null); // last URL actually assigned to the fallback <video>.src
    // True only if the fallback <video> ITSELF also failed (vs. still loading,
    // or already playing) — distinguishes "give the fallback a chance, don't
    // show an error overlay over it" from "both paths failed, this file is
    // genuinely unplayable here."
    const [fallbackFailed, setFallbackFailed] = useState(false);

    // Connect to store
    // NOTE: we subscribe to the full `tracks` array for clip lookups, but use
    // a derived `avTracks` (audio+video only) as the dep for effects that talk
    // to the playback engine.  This prevents text-clip position/style changes
    // from triggering seek() / renderOnce() on every slider pixel.
    const { currentTime, isPlaying, tracks, assets, seek, setIsPlaying } = useTimelineStore(useShallow(state => ({
        currentTime:  state.currentTime,
        isPlaying:    state.isPlaying,
        tracks:       state.tracks,
        assets:       state.assets,
        seek:         state.seek,
        setIsPlaying: state.setIsPlaying,
    })));

    // avTracks: only audio/video tracks — used as effect dependencies so that
    // text-clip style/position changes don't trigger engine seek() / renderOnce().
    const avTracks = React.useMemo(
        () => tracks.filter(t => t.type === 'video' || t.type === 'audio'),
        [tracks]
    );

    // Determine Active Clip for Rendering & Logic
    // The first visual track is the compositing base. Higher video tracks are
    // rendered by GraphicOverlay as layers, rather than replacing the base
    // decoder whenever both clips overlap. Fall back to another active track
    // only when the base has a gap (split-speaker timelines can be sparse).
    const videoTracks = avTracks.filter(t => t.type === 'video');
    const { baseTrack } = getVisualTrackRoles(tracks);
    const videoTrack = baseTrack?.type === 'video' ? baseTrack : videoTracks[0];
    const referenceAssetIds = React.useMemo(
        () => new Set(assets.filter(asset => asset?.assistantReference === true).map(asset => asset.id)),
        [assets]
    );
    const isPlayableClip = clip => clip?.assistantReference !== true
            && !referenceAssetIds.has(clip?.assetId)
            && currentTime >= clip.start - 0.001
            && currentTime < clip.start + clip.duration + 0.001;
    const activeClip = (videoTrack?.clips || []).find(isPlayableClip)
        || videoTracks.filter(track => track.id !== videoTrack?.id)
            .flatMap(track => track.clips || []).find(isPlayableClip);

    const clipLutIds = [...new Set((activeClip?.effects || [])
        .filter(effect => effect && effect.enabled !== false && (effect.kind || effect.type || effect.id) === 'lut_apply')
        .map(effect => effect.params?.lutId?.value ?? effect.params?.lutId)
        .filter(Boolean).map(String))].sort();
    const clipLutIdsKey = clipLutIds.join('|');
    useEffect(() => {
        if (!clipLutIds.length) {
            setClipLutPreviewFilters({});
            return undefined;
        }
        let cancelled = false;
        setClipLutPreviewFilters({});
        Promise.all(clipLutIds.map(async lutId => [lutId, await audioEngineAPI.getLUTPreview(lutId)]))
            .then(entries => { if (!cancelled) setClipLutPreviewFilters(Object.fromEntries(entries)); });
        return () => { cancelled = true; };
    }, [clipLutIdsKey]);

    // activeClipForEngine: stable reference that only changes when properties the
    // engine actually cares about change. x / y / scale / rotation are pure CSS
    // transforms applied to the canvas element — they never need a seek() or
    // renderOnce(). Excluding them prevents quality-degrading re-decodes and the
    // "cursor jumps to end of clip" bug caused by onTick firing inside renderOnce().
    const activeClipForEngine = React.useMemo(() => {
        if (!activeClip) return null;
        return {
            id:         activeClip.id,
            assetId:    activeClip.assetId,
            url:        activeClip.url,
            grading:    activeClip.grading,
            volume:     activeClip.volume,
            virtualCam: activeClip.virtualCam,
            start:      activeClip.start,
            duration:   activeClip.duration,
            offset:     activeClip.offset,
            speed:      activeClip.speed,
            effects:    activeClip.effects,
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        activeClip?.id, activeClip?.assetId, activeClip?.url,
        activeClip?.grading, activeClip?.volume, activeClip?.virtualCam,
        activeClip?.start, activeClip?.duration, activeClip?.offset,
        activeClip?.speed, activeClip?.effects,
    ]);

    const retimeMap = React.useMemo(
        () => activeClip ? createTimelineRetimeMap(activeClip) : null,
        [activeClip?.id, activeClip?.start, activeClip?.duration, activeClip?.offset, activeClip?.speed, activeClip?.effects]
    );
    const serializedRetimeMap = React.useMemo(() => serializeTimelineRetimeMap(retimeMap), [retimeMap]);
    useEffect(() => {
        setPlaybackWarning(previous => {
            if (retimeMap?.precisionWarning) {
                return {
                    type: 'retime_precision_approximation',
                    message: retimeMap.precisionWarning,
                };
            }
            return previous?.type === 'retime_precision_approximation' ? null : previous;
        });
    }, [retimeMap?.precisionWarning]);

    // Resolve the best available URL for the active clip. Extracted from the
    // play/pause effect below into a memo so BOTH the primary engine path and
    // the fallback <video> path (which needs this even when engineRef.current
    // is null, i.e. exactly the case the play/pause effect's early-return
    // used to make this unreachable) can use the same URL resolution.
    // Priority: asset.proxyUrl > clip.url > asset.url (raw) — unchanged from
    // before.
    const mediaUrl = React.useMemo(() => {
        let url = null;
        if (activeClip?.assetId) {
            const asset = assets.find(a => a.id === activeClip.assetId);
            if (asset?.proxyUrl) {
                url = asset.proxyUrl;
                if (url.startsWith('proxies/') || url.startsWith('raw/')) {
                    url = `/api/proxy/gcs-media/${url}`;
                }
            } else if (activeClip?.url) {
                url = activeClip.url;
            } else if (asset?.url) {
                url = asset.url;
                if (url.startsWith('proxies/') || url.startsWith('raw/')) {
                    url = `/api/proxy/gcs-media/${url}`;
                }
            }
        } else {
            url = activeClip?.url || null;
        }
        return url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeClip?.assetId, activeClip?.url, assets]);

    // True when the primary pipeline has already provably failed — either for
    // this specific file, or altogether on this device. Drives which element
    // (canvas vs. fallback <video>) actually renders below.
    const useFallbackPlayer = !!mediaUrl && (enginePermanentlyBroken || failedUrls.has(mediaUrl) || webglFallbackUrl === mediaUrl);

    // Initialize Engine
    useEffect(() => {
        if (!canvasRef.current) return;

        // PlaybackEngine's constructor throws synchronously if it can't get a
        // WebGL context (`canvas.getContext('webgl2')` / experimental-webgl
        // both return null). This used to be unguarded: the throw happened
        // mid-effect, before `engineRef.current` was assigned and before
        // `playbackEngine` was ever written to the store — so the failure was
        // completely invisible (no error overlay, play button silently a
        // no-op forever). This is the realistic failure mode on iOS Safari,
        // which enforces a hard cap on simultaneous WebGL contexts per page;
        // repeatedly mounting/unmounting this component (switching projects,
        // re-opening the editor) can exhaust it even though PlaybackEngine's
        // own destroy() now releases its context on unmount (see engine's
        // WEBGL_lose_context fix) — a context freed by a PREVIOUS session
        // (e.g. before that fix existed, or another tab/PWA instance) can
        // still leave the budget exhausted for a while. Catching this turns
        // "silently do nothing forever" into a visible, actionable error.
        try {
            engineRef.current = new PlaybackEngine(canvasRef.current, {
            onTick: (time) => {
                // This is the playback clock reporting its current position.
                // `seek()` would send a requestSeek back to the running player
                // on every tick, creating a feedback loop that stutters video
                // and makes the timeline playhead jump.
                useTimelineStore.getState().setPlaybackTime(time);
            },
            onAudioLevels: (levels) => {
                useTimelineStore.getState().setAudioLevels(levels);
            },
            onWaveformUpdate: (peaks, timestamp, duration, trackId) => {
                useTimelineStore.getState().addWaveform(trackId, peaks, duration);
            },
            onMetadata: (videoWidth, videoHeight) => {
                // Pin native resolution so ResizeObserver never downgrades it.
                nativeVideoDimRef.current = { width: videoWidth, height: videoHeight };

                // Tell the engine the SOURCE shape so it can contain-fit into
                // the project frame. Without this the fit falls back to
                // identity (fill) — which is the old, wrong behaviour.
                engineRef.current?.setSourceAspect?.(videoWidth, videoHeight);

                // Re-derive the buffer from the PROJECT frame, not from these
                // dimensions. Resizing the canvas to the video's own shape is
                // exactly what made the preview disagree with the export (R53);
                // handleResize uses the source only to pick a resolution, never
                // an aspect ratio.
                if (resizeHandlerRef.current) {
                    resizeHandlerRef.current();
                } else if (canvasRef.current && engineRef.current) {
                    engineRef.current.resize(videoWidth, videoHeight);
                }
                // Update store so Timeline and Engine know the true dimensions
                useTimelineStore.setState({ videoWidth, videoHeight });
                console.log(`[VideoPlayer] Video metadata: ${videoWidth}x${videoHeight}`);
                // A frame actually arrived — whatever error was showing (e.g. from
                // a prior clip / prior URL) no longer applies.
                setPlaybackError(null);
                setPlaybackWarning(null);
            },
            onWarning: (warning) => {
                setPlaybackWarning(warning?.type === 'gpu_effect_preview_recovered' ? null : warning);
            },
            onError: (err) => {
                console.error('[VideoPlayer] Playback error:', err);
                setPlaybackError(err);
                // Scope the fallback to the URL that actually failed. Read
                // from the engine's own currentUrl (not the outer mediaUrl
                // closure, which is stale inside this effect's one-time
                // callback) — this is exactly the source the engine was
                // trying, and failing, to play.
                const failedUrl = engineRef.current?.currentUrl;
                if (err?.type === 'webgl_context_lost' && failedUrl) {
                    setWebglFallbackUrl(failedUrl);
                } else if (failedUrl) {
                    setFailedUrls(prev => (prev.has(failedUrl) ? prev : new Set(prev).add(failedUrl)));
                }
            },
            onRecovered: ({ preservePlaybackError = false } = {}) => {
                if (!preservePlaybackError) setPlaybackError(null);
                setPlaybackWarning(null);
                const restoredUrl = engineRef.current?.currentUrl;
                setWebglFallbackUrl(current => current === restoredUrl ? null : current);
            },
            });
        } catch (e) {
            console.error('[VideoPlayer] Failed to construct PlaybackEngine:', e);
            engineRef.current = null;
            setPlaybackError({
                type: 'engine_init_failed',
                message: e?.message || 'Failed to initialize video preview on this device.',
            });
            // No WebGL context at all on this device/tab — every clip falls
            // back to the plain <video> element, not just the current one.
            setEnginePermanentlyBroken(true);
        }

        // Expose Engine to Store (for Direct Access from UI controls like Play Button)
        useTimelineStore.setState({ playbackEngine: engineRef.current });

        return () => {
            useTimelineStore.setState({ playbackEngine: null });
            if (engineRef.current) engineRef.current.destroy(); // Assuming destroy exists, or let GC handle
        };
    }, []);

    // Sync Play/Pause
    useEffect(() => {
        if (!engineRef.current) return;

        // This URL (or the whole engine) is already known broken — the
        // fallback <video> effect below owns playback instead. Just make
        // sure the WebGL engine stays paused/silent so it can't fight the
        // fallback for audio (both would otherwise be valid, separate audio
        // sources for the same clip). In every failure case this targets,
        // the engine's own audio decode already died alongside its video
        // decode (same worker, same demuxer), so there is no real audio to
        // lose by pausing here — the fallback <video>'s native audio becomes
        // the only source.
        if (useFallbackPlayer) {
            engineRef.current.pause();
            return;
        }

        engineRef.current.setTimelineRetimeMap?.(serializedRetimeMap);

        // mediaUrl resolved above (memo): asset.proxyUrl > clip.url > asset.url (raw).
        // We must always check asset.proxyUrl first: a clip may have been created with
        // clip.url pointing at a raw unprocessed upload.  Once the proxy job finishes,
        // assets[].proxyUrl is set and this effect re-runs — the engine then switches
        // to the streamable proxy automatically.

        // --- URL Sync Fix for Paused State ---
        // If the clip changes (e.g. Undo/Redo) while paused, we must tell the engine
        // to load the new URL, otherwise it holds onto the old one (or none).
        if (mediaUrl && engineRef.current.currentUrl !== mediaUrl) {
            // New source — clear any error left over from the previous one.
            setPlaybackError(null);
            // If playing, play() handles it below. But if paused, we must explicit load.
            if (!isPlaying) {
                engineRef.current.load(mediaUrl);
            }
        } else if (!mediaUrl && !activeClip) {
            // No clip on the timeline at all — clear to black.
            // If activeClip exists but mediaUrl is null (proxy still generating),
            // we leave the canvas as-is rather than clearing it.
            engineRef.current.clearCanvas();
        }

        if (isPlaying) {
            if (activeClip) {
                if (!mediaUrl) {
                    // Proxy not yet generated for this clip — don't hand the engine a null URL
                    // or a huge unprocessed raw file that can't stream.  The assets array will
                    // update when the proxy job finishes, re-triggering this effect with a real URL.
                    console.log('[VideoPlayer] Proxy not ready yet — waiting for generation job to finish');
                } else {
                    engineRef.current.play(mediaUrl);
                }
            } else {
                engineRef.current.resumeAudio();
                engineRef.current.play(); // No active clip — attempt resume on cached URL
            }
        } else {
            engineRef.current.pause();
        }

        // Sync grading, volume, and virtual-cam crop — runs for both playing and paused states.
        if (engineRef.current) {
            engineRef.current.setEffectSourceClipId?.(activeClip?.id);
            engineRef.current.setClipEffects?.(activeClip?.id, activeClip?.effects || [], {
                startTime: Number(activeClip?.start) || 0,
                duration: Number(activeClip?.duration) || 0,
            });
            // Update Grading Real-time
            if (activeClip && activeClip.grading) {
                engineRef.current.setGrading({
                    brightness: activeClip.grading.brightness,
                    contrast: activeClip.grading.contrast,
                    saturate: activeClip.grading.saturate,
                    hueRotate: activeClip.grading.hueRotate,
                    selective: activeClip.grading.selective
                });
            } else {
                engineRef.current.setGrading({ brightness: 100, contrast: 100, saturate: 100, hueRotate: 0 });
            }
            // Update Volume Real-time
            if (activeClip) {
                engineRef.current.setMasterVolume(activeClip.volume !== undefined ? activeClip.volume : 1.0);
            }
            // Virtual multicam crop is now handled by the dedicated composed-crop
            // effect below (keyed on currentTime), which also folds in any
            // zoom-rhythm scale keyframes — see composeCropWithZoom().

                // When paused the RAF loop stops — renderOnce() alone isn't enough because
            // _wantOneRender is only consumed when a NEW_FRAME arrives from the worker.
            // seek() triggers the worker to decode and send a fresh frame, so the two
            // must always be paired (as documented on renderOnce()).
            if (!isPlaying) {
                if (typeof engineRef.current.renderOnce === 'function') {
                    engineRef.current.renderOnce();
                }
                if (typeof engineRef.current.seek === 'function') {
                    engineRef.current.seek(currentTime);
                }
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPlaying, avTracks, assets, activeClipForEngine, mediaUrl, useFallbackPlayer, serializedRetimeMap]);

    // --- Composed crop effect (virtual multicam + zoom rhythm) ---
    // Runs on every currentTime tick (both playing and paused) so a rhythm
    // punch-in/push-in animates smoothly even when it's layered on top of a
    // multicam angle. This is the SINGLE place crop is set — see
    // composeCropWithZoom() above for why multicam crop + rhythm scale must be
    // combined into one rectangle rather than applied as two independent
    // transforms (R16 in CLAUDE.md). Ordered BEFORE the paused-scrub effect so
    // the crop is applied before any render is triggered in the same commit.
    useEffect(() => {
        if (!engineRef.current || typeof engineRef.current.setCrop !== 'function') return;

        if (!activeClip?.virtualCam) {
            engineRef.current.setCrop(0, 0, 1, 1);
            return;
        }

        const { cropX = 0, cropY = 0, cropW = 1, cropH = 1 } = activeClip.virtualCam;
        const baseCrop = { cropX, cropY, cropW, cropH };

        const localTime = currentTime - activeClip.start;
        const kf = activeClip.keyframes || {};
        const extraScale = interpolateKeyframes(kf.scale, 1.0, localTime);
        const panX = interpolateKeyframes(kf.panX, 0, localTime);
        const panY = interpolateKeyframes(kf.panY, 0, localTime);
        const composed = composeAnimatedCrop(baseCrop, extraScale, panX, panY);
        engineRef.current.setCrop(composed.cropX, composed.cropY, composed.cropW, composed.cropH);
    }, [currentTime, activeClip?.id, activeClip?.start, activeClip?.virtualCam, activeClip?.keyframes]);

    // --- Fallback <video> element sync (only active while useFallbackPlayer) ---
    // Mirrors the primary engine's own load/play/pause/seek behavior above,
    // using the plain HTMLMediaElement API instead of the WebCodecs pipeline.
    useEffect(() => {
        const video = fallbackVideoRef.current;
        if (!video || !useFallbackPlayer || !mediaUrl) return;
        // Compare against our own ref, not video.src — the browser normalizes
        // video.src to an absolute URL, so a plain !== check against the
        // (possibly relative) mediaUrl would re-assign and reload on every
        // render.
        if (fallbackSrcRef.current !== mediaUrl) {
            fallbackSrcRef.current = mediaUrl;
            setFallbackFailed(false); // fresh source — give it a clean attempt
            video.src = mediaUrl;
            video.load();
        }
    }, [useFallbackPlayer, mediaUrl]);

    useEffect(() => {
        const video = fallbackVideoRef.current;
        if (!video || !useFallbackPlayer) return;
        if (isPlaying) {
            const p = video.play();
            if (p?.catch) p.catch(e => console.warn('[VideoPlayer] Fallback <video>.play() rejected:', e.message));
        } else {
            video.pause();
        }
    }, [isPlaying, useFallbackPlayer]);

    useEffect(() => {
        const video = fallbackVideoRef.current;
        // Only force-seek while paused — while playing, the <video> owns its
        // own clock and this would fight it every render (same reasoning as
        // the primary engine's paused-scrub effect below).
        if (!video || !useFallbackPlayer || isPlaying) return;
        if (Math.abs(video.currentTime - currentTime) > 0.05) {
            video.currentTime = mapTimelineTimeToSource(retimeMap, currentTime);
        }
    }, [currentTime, isPlaying, useFallbackPlayer, retimeMap]);

    useEffect(() => {
        const video = fallbackVideoRef.current;
        if (!video || !useFallbackPlayer) return;
        video.playbackRate = mapTimelineTimeToRate(retimeMap, currentTime);
        const preservePitch = retimeMap.maintainPitch !== false;
        if ('preservesPitch' in video) video.preservesPitch = preservePitch;
        if ('webkitPreservesPitch' in video) video.webkitPreservesPitch = preservePitch;
        if ('mozPreservesPitch' in video) video.mozPreservesPitch = preservePitch;
    }, [currentTime, useFallbackPlayer, retimeMap]);

    // --- Paused-scrub seek effect ---
    // Runs only when currentTime changes while paused so the preview frame stays in sync
    // with the scrubber.  Separated from the play/pause effect to avoid calling play()
    // ~60fps during playback (which was the root cause of the canvas-clear quality bug).
    useEffect(() => {
        if (!engineRef.current || isPlaying) return;
        if (typeof engineRef.current.seek === 'function') {
            engineRef.current.seek(currentTime);
        }
        if (typeof engineRef.current.renderOnce === 'function') {
            engineRef.current.renderOnce();
        }
    }, [currentTime, isPlaying]);

    // --- Audio Track Loader & Sync ---
    useEffect(() => {
        if (!engineRef.current) return;

        // Iterate all tracks to find audio/video clips
        tracks.forEach(track => {
            // Update Track Mixer State
            if (track.type === 'audio' || track.type === 'video') {
                engineRef.current.setTrackVolume(track.id, track.volume);
                engineRef.current.setMute(track.id, track.muted);
                engineRef.current.setSolo(track.id, track.solo);

                track.clips.forEach(clip => {
                    // Load if new
                    let mediaUrl = clip.url;
                    if (!mediaUrl && clip.assetId) {
                        const asset = assets.find(a => a.id === clip.assetId);
                        mediaUrl = asset?.url;
                        if (mediaUrl && (mediaUrl.startsWith('proxies/') || mediaUrl.startsWith('raw/'))) {
                            mediaUrl = `/api/proxy/gcs-media/${mediaUrl}`;
                        }
                    }

                    if (mediaUrl) {
                        engineRef.current.loadAudioTrack(clip.id, mediaUrl);
                    }
                });
            }
        });

        // Pass Full Track Metadata to Engine for Fades/Effects Logic
        engineRef.current.updateTrackMetadata(tracks); // pass full tracks for audio mixing

    }, [avTracks, assets]); // avTracks: only re-run when video/audio tracks change

    // --- Resize Observer with Quality Scaling ---
    useEffect(() => {
        if (!containerRef.current || !canvasRef.current || !engineRef.current) return;

        const handleResize = () => {
            if (!containerRef.current) return;
            const { width, height } = containerRef.current.getBoundingClientRect();

            const quality = useTimelineStore.getState().previewQuality;
            const qualityScale = quality === 'low' ? 0.5 : 1.0;

            // The canvas buffer is the PROJECT FRAME, not the active clip.
            //
            // It used to be sized from nativeVideoDimRef — the current video's
            // own pixel dimensions — which meant the preview surface was
            // whatever shape the clip happened to be, not the shape being
            // exported. Switch a 9:16 project to 16:9 and the buffer stayed
            // 9:16 while the frame around it became 16:9, so the source got
            // blown up to cover the difference: heavily upscaled, soft, and
            // cropped top and bottom. Export never had this problem because it
            // composites into a real output frame and pads (see
            // buildScaleFilter's force_original_aspect_ratio=decrease).
            //
            // Deriving the buffer from the project's aspect ratio makes the two
            // agree by construction; the source is then FITTED into it by the
            // engine's contain-fit (computeContainFit). See CLAUDE.md R53.
            const native = nativeVideoDimRef.current;

            // Longest edge of the source, so a portrait project keeps portrait
            // resolution and we never upscale beyond what the footage has.
            const sourceLongEdge = native
                ? Math.max(native.width, native.height)
                : Math.max(width, height);

            const [arW, arH] = frameAspectRef.current;   // e.g. [16, 9]
            const frameIsLandscape = arW >= arH;

            const baseW = frameIsLandscape ? sourceLongEdge : Math.round(sourceLongEdge * (arW / arH));
            const baseH = frameIsLandscape ? Math.round(sourceLongEdge * (arH / arW)) : sourceLongEdge;

            const targetWidth  = Math.max(2, Math.floor(baseW * qualityScale));
            const targetHeight = Math.max(2, Math.floor(baseH * qualityScale));

            // Only update if changed to avoid thrashing
            if (canvasRef.current.width !== targetWidth || canvasRef.current.height !== targetHeight) {
                engineRef.current.resize(targetWidth, targetHeight);
                console.log(`[VideoPlayer] Resized to ${targetWidth}x${targetHeight} (${quality})`);

                // Force repaint if paused, because resize clears the WebGL buffer
                if (!useTimelineStore.getState().isPlaying) {
                    const t = useTimelineStore.getState().currentTime;
                    engineRef.current.seek(t);
                }
            }
        };

        resizeHandlerRef.current = handleResize;
        const observer = new ResizeObserver(handleResize);
        observer.observe(containerRef.current);

        // Also listen to quality changes (via store subscription or eff dependency)
        // Since we are inside useEffect with empty deps, we need a way to trigger this.
        // We will add a separate effect for quality tracking or `useTimelineStore` subscription.

        handleResize(); // Initial

        return () => observer.disconnect();
    }, []);

    // Effect to monitor Quality Change specifically
    const previewQuality = useTimelineStore(state => state.previewQuality);
    useEffect(() => {
        if (!containerRef.current || !engineRef.current || !canvasRef.current) return;

        // 1. Tell Engine to update Worker quality (Downscaling pipeline)
        engineRef.current.setQuality(previewQuality);

        // 2. Adjust Canvas Resolution — use native video dims when available so
        //    CSS scale() transforms don't stretch a low-res canvas buffer.
        const qualityScale = previewQuality === 'low' ? 0.5 : 1.0;
        const native = nativeVideoDimRef.current;
        let targetWidth, targetHeight;
        if (native) {
            targetWidth  = Math.floor(native.width  * qualityScale);
            targetHeight = Math.floor(native.height * qualityScale);
        } else {
            const { width, height } = containerRef.current.getBoundingClientRect();
            targetWidth  = Math.floor(width  * qualityScale);
            targetHeight = Math.floor(height * qualityScale);
        }

        if (canvasRef.current.width !== targetWidth || canvasRef.current.height !== targetHeight) {
            engineRef.current.resize(targetWidth, targetHeight);
            console.log(`[VideoPlayer] Quality changed to ${previewQuality}, resized to ${targetWidth}x${targetHeight}`);

            // Repaint if paused
            if (!useTimelineStore.getState().isPlaying) {
                const t = useTimelineStore.getState().currentTime;
                engineRef.current.seek(t);
            }
        }
    }, [previewQuality]);

    // Show debug overlay in development only
    const showDebug = import.meta.env.DEV;

    // Pull global project aspect ratio so the container matches the layout perfectly
    const aspectRatio = useTimelineStore(state => state.aspectRatio);
    // The selected LUT id is the source of truth for whether a project LUT is
    // active; the matching CSS preview filter is the value applied to the
    // rendered canvas below. Subscribe to both so selecting or clearing a LUT
    // immediately repaints the preview, and an old filter cannot linger after
    // the id has been cleared.
    const projectLUTId = useTimelineStore(state => state.projectLUTId);
    const storedProjectLUTFilter = useTimelineStore(state => state.projectLUTFilter);
    const projectLUTFilter = projectLUTId ? storedProjectLUTFilter : 'none';
    
    const getPlayerRatioString = (ratio) => {
        switch (ratio) {
            case '9:16': return '1080 / 1920';
            case '1:1': return '1 / 1';
            case '4:3': return '4 / 3';
            case '4:5': return '4 / 5';
            case '21:9': return '21 / 9';
            case '16:9':
            default: return '16 / 9';
        }
    };
    const dynamicRatio = getPlayerRatioString(aspectRatio);

    // Keep the resize closure's view of the project frame current, and re-run
    // the buffer sizing when the ratio changes. Without this second part the
    // buffer would only be re-derived on a container resize, so switching
    // aspect ratio would leave the old frame shape until the window moved.
    useEffect(() => {
        const [w, h] = (dynamicRatio || '16 / 9').split('/').map(n => parseFloat(n.trim()));
        frameAspectRef.current = [
            Number.isFinite(w) && w > 0 ? w : 16,
            Number.isFinite(h) && h > 0 ? h : 9,
        ];
        // Re-run the buffer sizing directly. A ResizeObserver only fires when
        // the observed ELEMENT's box changes, and the container box does not
        // necessarily change when the ratio does — so without this the new
        // frame shape would not take effect until the window was resized.
        resizeHandlerRef.current?.();
    }, [dynamicRatio]);

    // --- Interpolate Keyframes for Smart Zoom ---
    let transformStyle = '';
    // For talking-head content (portrait or standard interview framing) scale from the
    // upper-center third so the speaker's face stays in frame rather than the bottom
    // of the frame drifting in. Landscape B-roll keeps the default center-center anchor.
    const contentType = useTimelineStore(state => state.contentAnalysis?.contentType);
    // R91: a talking editing style counts too (export always anchors here).
    const editingStyle = useTimelineStore(state => state.editingStyle);
    const isTalkingHead = ['long_form_raw', 'podcast', 'interview', 'youtube_long'].includes(contentType)
        || ['talking_head', 'interview', 'podcast', 'reel'].includes(editingStyle);
    const transformOrigin = isTalkingHead ? '50% 28%' : 'center center';
    const motionLayer = activeClip ? clipToMotionLayer(activeClip, videoTrack) : null;
    const resolvedMotion = motionLayer ? resolveMotionAt(motionLayer, currentTime) : null;
    const frameWidthForMotion = containerRef.current?.clientWidth || 1080;
    const frameHeightForMotion = frameWidthForMotion * frameAspectRef.current[1] / frameAspectRef.current[0];
    const motionDeltaX = motionLayer && resolvedMotion
        ? ((resolvedMotion.x - motionLayer.x) / 100) * frameWidthForMotion : 0;
    const motionDeltaY = motionLayer && resolvedMotion
        ? ((resolvedMotion.y - motionLayer.y) / 100) * frameHeightForMotion : 0;

    // When activeClip.virtualCam is present, any zoom-rhythm scale keyframes are
    // baked into the composed crop rectangle by the effect above instead — CSS
    // transform scale must stay neutral here or the zoom gets applied TWICE
    // (once via crop, once via this transform). x/y/rotation still apply as
    // normal since virtualCam only ever controls the crop, never these.
    if (activeClip && activeClip.keyframes) {
        const localTime = currentTime - activeClip.start;
        const kf = activeClip.keyframes;
        const hasVirtualCam = !!activeClip.virtualCam;

        const scale = hasVirtualCam ? 1.0
            : (resolvedMotion?.scale ?? activeClip.scale ?? 1) * interpolateKeyframes(kf.scale, 1.0, localTime);
        const x = interpolateKeyframes(kf.x, activeClip.x ?? 0, localTime) + motionDeltaX;
        const y = interpolateKeyframes(kf.y, activeClip.y ?? 0, localTime) + motionDeltaY;
        const rotation = (resolvedMotion?.rotation ?? activeClip.rotation ?? 0)
            + interpolateKeyframes(kf.rotation, activeClip.rotation ?? 0, localTime) - (activeClip.rotation ?? 0);
        const scaleX = hasVirtualCam ? 1
            : (resolvedMotion?.scaleX ?? 1) * interpolateKeyframes(kf.scaleX, 1, localTime);
        const scaleY = hasVirtualCam ? 1
            : (resolvedMotion?.scaleY ?? 1) * interpolateKeyframes(kf.scaleY, 1, localTime);

        if (scale !== 1.0 || x !== 0 || y !== 0 || rotation !== 0 || scaleX !== 1 || scaleY !== 1) {
            transformStyle = `translate(${x}px, ${y}px) scale(${scale}) scaleX(${scaleX}) scaleY(${scaleY}) rotate(${rotation}deg)`;
        }
    } else if (activeClip) {
        // No keyframes — read direct clip properties set by the Transform tab
        const scale = activeClip.virtualCam ? 1.0 : (resolvedMotion?.scale ?? activeClip.scale ?? 1.0);
        const x = (activeClip.x ?? 0) + motionDeltaX;
        const y = (activeClip.y ?? 0) + motionDeltaY;
        const rotation = resolvedMotion?.rotation ?? activeClip.rotation ?? 0;
        const scaleX = activeClip.virtualCam ? 1 : resolvedMotion?.scaleX ?? 1;
        const scaleY = activeClip.virtualCam ? 1 : resolvedMotion?.scaleY ?? 1;
        if (scale !== 1.0 || x !== 0 || y !== 0 || rotation !== 0 || scaleX !== 1 || scaleY !== 1) {
            transformStyle = `translate(${x}px, ${y}px) scale(${scale}) scaleX(${scaleX}) scaleY(${scaleY}) rotate(${rotation}deg)`;
        }
    }
    const clipOpacityTrack = activeClip?.keyframes?.opacity;
    const previewClipOpacity = Array.isArray(clipOpacityTrack) && clipOpacityTrack.length
        ? interpolateKeyframes(clipOpacityTrack, activeClip.opacity ?? 1, currentTime - activeClip.start)
        : (resolvedMotion?.opacity ?? activeClip?.opacity ?? 1);

    // ── R89 transitions (to-do A4) ──────────────────────────────────────────
    // Cut effects centred on each base-track cut, from motion/TransitionFX.js —
    // the same description the export samples. Applied to the base video only;
    // captions and stickers (separate layers) are not shaken or blurred, which
    // is also the export's order (transitions run before overlays/captions).
    const baseTransitionClips = React.useMemo(() => {
        const base = (tracks || []).find(t => t.type === 'video' && (t.clips || []).length > 0);
        return base ? base.clips : [];
    }, [tracks]);
    const transitionWins = React.useMemo(() => transitionWindows(baseTransitionClips), [baseTransitionClips]);
    const tfx = transitionWins.length > 0 ? fxAtTime(transitionWins, currentTime) : null;
    const baseTransform = transitionTransform(tfx, transformStyle, transformOrigin);
    const timelineEffectTime = Math.max(0, currentTime - (Number(activeClip?.start) || 0));
    const shakeTransform = resolveTimelineEffectTransform(
        activeClip?.effects,
        timelineEffectTime,
        containerRef.current?.clientWidth || 1080,
        currentTime,
        { clipStart: Number(activeClip?.start ?? activeClip?.startTime) || 0, clipDuration: Number(activeClip?.duration) || 0 },
    );
    const previewBaseTransform = [baseTransform, shakeTransform].filter(Boolean).join(' ') || undefined;
    const animatedVirtualCrop = (vc) => {
        if (!vc) return null;
        const localTime = currentTime - (Number(activeClip?.start) || 0);
        const kf = activeClip?.keyframes || {};
        return composeAnimatedCrop(
            { cropX: Number(vc.cropX) || 0, cropY: Number(vc.cropY) || 0, cropW: Number(vc.cropW) || 1, cropH: Number(vc.cropH) || 1 },
            interpolateKeyframes(kf.scale, 1, localTime),
            interpolateKeyframes(kf.panX, 0, localTime),
            interpolateKeyframes(kf.panY, 0, localTime),
        );
    };
    // The normal WebGL path applies virtualCam as a UV crop. When WebCodecs or
    // WebGL fails, reproduce that crop with CSS so multicam does not look wide
    // just because playback switched to the native-video fallback.
    const fallbackTransform = (() => {
        const vc = activeClip?.virtualCam;
        if (!useFallbackPlayer || !vc) return previewBaseTransform;

        const crop = animatedVirtualCrop(vc);
        const cropW = Math.max(0.05, Math.min(1, Number(crop?.cropW) || 1));
        const cropH = Math.max(0.05, Math.min(1, Number(crop?.cropH) || cropW));
        if (cropW >= 0.999 && cropH >= 0.999) return previewBaseTransform;

        const scaleX = 1 / cropW;
        const scaleY = 1 / cropH;
        const centerX = (Number(crop?.cropX) || 0) + cropW / 2;
        const centerY = (Number(crop?.cropY) || 0) + cropH / 2;
        const translateX = (0.5 - centerX) * scaleX * 100;
        const translateY = (0.5 - centerY) * scaleY * 100;
        const cropTransform = `translate(${translateX}%, ${translateY}%) scale(${scaleX}, ${scaleY})`;
        return [previewBaseTransform, cropTransform].filter(Boolean).join(' ');
    })();
    // The matte preview draws its own source and mask canvases (rather than
    // using the WebGL frame), so it must reproduce the virtual-camera crop in
    // CSS even while the main preview is using the WebGL UV crop.
    const matteTransform = (() => {
        const vc = activeClip?.virtualCam;
        if (!vc) return previewBaseTransform;
        const crop = animatedVirtualCrop(vc);
        const cropW = Math.max(0.05, Math.min(1, Number(crop?.cropW) || 1));
        const cropH = Math.max(0.05, Math.min(1, Number(crop?.cropH) || cropW));
        if (cropW >= 0.999 && cropH >= 0.999) return previewBaseTransform;
        const scaleX = 1 / cropW;
        const scaleY = 1 / cropH;
        const centerX = (Number(crop?.cropX) || 0) + cropW / 2;
        const centerY = (Number(crop?.cropY) || 0) + cropH / 2;
        const x = (0.5 - centerX) * scaleX * 100;
        const y = (0.5 - centerY) * scaleY * 100;
        return [previewBaseTransform, `translate(${x}%, ${y}%) scale(${scaleX}, ${scaleY})`].filter(Boolean).join(' ');
    })();
    const effectContext = { clipStart: Number(activeClip?.start ?? activeClip?.startTime) || 0, clipDuration: Number(activeClip?.duration) || 0 };
    const effectFilter = resolveTimelineEffectFilter(activeClip?.effects, currentTime, effectContext);
    const clipLutFilter = resolveTimelineLutPreviewFilter(activeClip?.effects, clipLutPreviewFilters, currentTime, effectContext);
    const gpuClipEffectPreview = Boolean(!useFallbackPlayer && engineRef.current?.supportsClipEffectPreview?.());
    const gpuSupportedEffectTypes = gpuClipEffectPreview
        ? engineRef.current?.getSupportedClipEffectTypes?.() ?? []
        : null;
    const canvasEffectFilter = resolveTimelineEffectFilter(activeClip?.effects, currentTime, {
        ...effectContext,
        gpuPreview: gpuClipEffectPreview,
        gpuSupportedEffectTypes,
    });
    const canvasClipLutFilter = resolveTimelineLutPreviewFilter(activeClip?.effects, clipLutPreviewFilters, currentTime, {
        ...effectContext, gpuPreview: gpuClipEffectPreview, gpuSupportedEffectTypes,
    });
    const previewEffectContext = { ...effectContext, gpuPreview: gpuClipEffectPreview, gpuSupportedEffectTypes };
    const svgEffectParams = resolveTimelineSvgEffectParams(activeClip?.effects, currentTime, previewEffectContext);
    const svgEffectInstances = resolveTimelineSvgEffectInstances(activeClip?.effects, currentTime, previewEffectContext);
    const vignetteStyle = resolveTimelineVignetteStyle(activeClip?.effects, currentTime, {
        ...effectContext,
        gpuPreview: gpuClipEffectPreview,
        gpuSupportedEffectTypes,
    });
    const fadeOverlays = resolveTimelineFadeOverlays(activeClip?.effects, currentTime, effectContext);
    const frameWidthPx = containerRef.current?.clientWidth || 0;
    // Applying a LUT stores both its project id and an editable per-clip grade.
    // If this clip's grade came from that same LUT, the shader already renders
    // the LUT-derived look; applying its CSS approximation again would double
    // grade the preview. Clips with independent/manual grading still receive
    // the project LUT, matching the export filter order.
    const clipUsesSelectedLut = Boolean(projectLUTId && activeClip?.grading?._lutId
        && String(activeClip.grading._lutId) === String(projectLUTId));
    const previewProjectLutFilter = clipUsesSelectedLut ? 'none' : projectLUTFilter;
    const fallbackClipGradeFilter = activeClip?.grading
        ? `brightness(${Number(activeClip.grading.brightness ?? 100)}%) contrast(${Number(activeClip.grading.contrast ?? 100)}%) saturate(${Number(activeClip.grading.saturate ?? 100)}%) hue-rotate(${Number(activeClip.grading.hueRotate ?? 0)}deg)`
        : '';
    // Phones get the cheap transition blur — see transitionFilter().
    // Native-video fallback has no WebGL grading shader, so mirror clip.grade
    // with CSS there. The normal canvas path receives grading via setGrading().
    const baseFilter = combinePreviewFilters(
        transitionFilter(tfx, previewProjectLutFilter, { cheap: isMobileViewport, frameWidth: frameWidthPx }),
        effectFilter,
        clipLutFilter,
        useFallbackPlayer ? fallbackClipGradeFilter : '',
    );
    const canvasFilter = combinePreviewFilters(
        transitionFilter(tfx, previewProjectLutFilter, { cheap: isMobileViewport, frameWidth: frameWidthPx }),
        canvasEffectFilter,
        canvasClipLutFilter,
    );

    // Show overlay when user presses play but no proxy exists yet.
    // Computed here (not in the effect) so it stays reactive to the store subscription.
    const proxyGenerating = (() => {
        if (!isPlaying || !activeClip) return false;
        if (!activeClip.assetId) return !activeClip.url;
        const asset = assets.find(a => a.id === activeClip.assetId);
        return !(asset?.proxyUrl || activeClip?.url);
    })();

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden"
            style={{ aspectRatio: dynamicRatio }}
        >
            <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', overflow: 'hidden' }}>
                <defs>
                    <TimelineEffectFilterDefinitions instances={svgEffectInstances} timelineEffectTime={timelineEffectTime} />
                </defs>
            </svg>
            {proxyGenerating && <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>}
            {/* The Custom Rendering Surface — kept permanently mounted (never
                conditionally unmounted) even while the fallback <video> below
                is what's actually visible, so canvasRef never goes stale and
                the WebGL engine's own internal plumbing (already paused, see
                the play/pause effect's useFallbackPlayer branch) is never
                disturbed by a DOM remount. display:none instead. */}
            <canvas
                ref={canvasRef}
                className="transition-transform duration-75"
                data-project-lut-id={projectLUTId || undefined}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    transform: previewBaseTransform,
                    transformOrigin,
                    opacity: previewClipOpacity,
                    // Apply the selected project's LUT preview directly to the
                    // canvas pixels. The id gates the stored filter, and the
                    // filter is combined with clip effects and transition FX
                    // above. 'none' is the unchanged, ungraded path.
                    filter: canvasFilter,
                    display: useFallbackPlayer ? 'none' : 'block',
                }}
            />

            {/* Native-video fallback: the primary engine is paused while this
                is active, making this the sole audio source. CSS mirrors the
                virtualCam crop for preview parity with the WebGL path. */}
            {useFallbackPlayer && mediaUrl && <>
                <video
                    ref={fallbackVideoRef}
                    playsInline
                    className="transition-transform duration-75"
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        transform: fallbackTransform,
                        transformOrigin: '50% 50%',
                        opacity: previewClipOpacity,
                        filter: baseFilter,
                    }}
                    onTimeUpdate={(e) => {
                        // Mirror the primary engine's clock update without
                        // sending another seek back to the playing video.
                        // Only push into the store while actually playing —
                        // while paused, the scrub-sync effect above is the one
                        // driving video.currentTime, not the other way round.
                        if (isPlaying) {
                            useTimelineStore.getState().setPlaybackTime(
                                mapSourceTimeToTimeline(retimeMap, e.currentTarget.currentTime)
                            );
                        }
                    }}
                    onLoadedMetadata={(e) => {
                        const { videoWidth, videoHeight } = e.currentTarget;
                        e.currentTarget.currentTime = mapTimelineTimeToSource(retimeMap, currentTime);
                        e.currentTarget.playbackRate = mapTimelineTimeToRate(retimeMap, currentTime);
                        const preservePitch = retimeMap.maintainPitch !== false;
                        if ('preservesPitch' in e.currentTarget) e.currentTarget.preservesPitch = preservePitch;
                        if ('webkitPreservesPitch' in e.currentTarget) e.currentTarget.webkitPreservesPitch = preservePitch;
                        if ('mozPreservesPitch' in e.currentTarget) e.currentTarget.mozPreservesPitch = preservePitch;
                        if (videoWidth && videoHeight) {
                            useTimelineStore.setState({ videoWidth, videoHeight });
                        }
                        // A frame is now genuinely playable — the error banner
                        // describes the primary pipeline, which is accurate
                        // information, but once the fallback is visibly
                        // working there is nothing actionable left to show.
                        setPlaybackError(null);
                    }}
                    onError={(e) => {
                        // Both the primary pipeline AND the plain <video>
                        // element failed on this source — genuinely
                        // unplayable in this browser (e.g. a truly corrupt
                        // file), not just a WebCodecs-specific gap. Surface
                        // that distinction rather than silently doing nothing.
                        console.error('[VideoPlayer] Fallback <video> also failed:', e.currentTarget.error);
                        setFallbackFailed(true);
                        setPlaybackError({
                            type: 'fallback_also_failed',
                            message: 'This video format isn\'t supported for preview on this device.',
                        });
                    }}
                />
                {svgEffectParams.radial.intensity > 0 && <RadialFootageCanvas
                    videoRef={fallbackVideoRef}
                    radial={svgEffectParams.radial}
                    isPlaying={isPlaying}
                    style={{ transform: fallbackTransform, transformOrigin: '50% 50%', opacity: previewClipOpacity, filter: baseFilter }}
                />}
            </>}

            {fadeOverlays.map((fade, index) => (
                <div key={`footage-fade-${index}`} aria-hidden="true" style={{
                    position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
                    backgroundColor: fade.color, opacity: fade.opacity,
                }} />
            ))}

            {vignetteStyle && <div aria-hidden="true" style={vignetteStyle} />}

            {/* R67 — Object Intelligence "blur background". Reuses the same
                asset URL priority (proxy > clip.url > raw asset.url) the
                engine's own load effect uses above, kept inline here rather
                than refactored into a shared helper since this is the only
                other place in the component that needs it and duplicating
                three lines is cheaper than a premature abstraction. */}
            <ObjectLayerOverlay
                clip={activeClip}
                sourceUrl={(() => {
                    if (!activeClip) return null;
                    const asset = activeClip.assetId ? assets.find(a => a.id === activeClip.assetId) : null;
                    let url = asset?.proxyUrl || activeClip.url || asset?.url || null;
                    if (url && (url.startsWith('proxies/') || url.startsWith('raw/'))) {
                        url = `/api/proxy/gcs-media/${url}`;
                    }
                    return url;
                })()}
                currentTime={currentTime}
                isPlaying={isPlaying}
                containerStyle={{ transform: matteTransform, transformOrigin }}
            >
                {/* R93: Sandwich depth layer — text & graphics placed behind the speaker */}
                <TextOverlay placementFilter="behind_subject" />
                <GraphicOverlay placementFilter="behind_subject" onWarning={warning => setPlaybackWarning(warning)} />
            </ObjectLayerOverlay>

            {transitionWins.length > 0 && <TransitionLayer fx={tfx} frameWidth={frameWidthPx} />}

            {/* Proxy still generating — shown when user presses play before the
                background proxy job finishes. Engine is NOT started in this state. */}
            {proxyGenerating && (
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.72)',
                    color: 'var(--fg-2, #a0a0b0)',
                    fontSize: 13,
                    fontFamily: 'var(--f-sans, system-ui)',
                    gap: 10,
                    pointerEvents: 'none',
                }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        style={{ animation: 'spin 1s linear infinite', opacity: 0.7 }}
                        xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                    {t('player.generatingPreview')}
                </div>
            )}

            {/* Was previously impossible to reach: PlaybackEngine's onError callback
                was never wired up here at all (defaulted to a no-op inside the
                engine), so a decode/config failure just left a black canvas with
                fully-working-looking play/skip controls — no way for the editor,
                let alone the user, to tell "still loading" apart from "failed for
                good". Shown only when not mid-proxy-generation so the two overlays
                never fight for the same space. */}
            {!proxyGenerating && playbackError && (!useFallbackPlayer || fallbackFailed) && (
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.8)',
                    color: '#f0a0a0',
                    fontSize: 13,
                    fontFamily: 'var(--f-sans, system-ui)',
                    gap: 8,
                    textAlign: 'center',
                    padding: '0 24px',
                    pointerEvents: 'none',
                }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <div>{t('player.playbackError', 'Preview couldn\'t play this file')}</div>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>{playbackError.message}</div>
                </div>
            )}
            {!proxyGenerating && playbackWarning && !playbackError && (
                <div
                    role="status"
                    aria-live="polite"
                    data-preview-warning={playbackWarning.type || 'preview-warning'}
                    style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        maxWidth: 'min(420px, calc(100% - 24px))',
                        padding: '8px 11px',
                        borderRadius: 8,
                        background: 'rgba(18, 20, 24, 0.88)',
                        border: '1px solid rgba(255, 190, 100, 0.35)',
                        color: '#f4d7ae',
                        fontSize: 12,
                        lineHeight: 1.4,
                        fontFamily: 'var(--f-sans, system-ui)',
                        pointerEvents: 'none',
                        zIndex: 5,
                    }}
                >
                    {playbackWarning.message || t('player.previewWarning', 'Some effects may not appear in this preview.')}
                </div>
            )}
        </div>
    );
};

export default VideoPlayer;
