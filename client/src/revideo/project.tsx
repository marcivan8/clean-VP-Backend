/** @jsxImportSource @revideo/2d/lib */
import { makeProject, DependencyContext } from '@revideo/core';
import { makeScene2D, Video, Audio, Img, Txt, Node, brightness, contrast, saturate, hue } from '@revideo/2d';
import { waitFor, useScene, all, any, createRef } from '@revideo/core';
import { clipToMotionLayer } from '../motion/ClipAdapter.js';
import { resolveMotionAt, sampleKeyframeTrack } from '../motion/MotionResolver.js';
import { composeAnimatedCrop } from '../motion/CameraMotionCompiler.js';
import { createRevideoEffectFilters, resolveRevideoPreviewEffects } from './EffectAdapter.js';

/**
 * PATCH: DependencyContext.collectPromise uses Promise.all in consumePromises(),
 * which fails on ANY rejection. video.play() can legitimately reject (autoplay
 * policy, pause-during-play race) and permanently stop the render loop.
 * Wrapping every collected promise in .catch(→null) makes consumePromises safe.
 */
;(function patchDependencyContext() {
    const orig = DependencyContext.collectPromise.bind(DependencyContext);
    (DependencyContext as any).collectPromise = function(promise: Promise<any>, initialValue: any = null) {
        const safe = Promise.resolve(promise).catch(() => null);
        return orig(safe, initialValue);
    };
})();

/**
 * Evaluate a keyframe array at a given local clip time.
 * Uses the canonical resolver so the editor's scale/zoom tracks support the
 * same named, spring, steps, and cubic-Bezier curves as motion layers/export.
 */
function evaluateKF(keyframes: any[], time: number, defaultValue: number): number {
    return sampleKeyframeTrack(keyframes, time, defaultValue);
}

/** Helper: get clip-local time relative to clip start (for keyframe evaluation) */
function clipLocalTime(playbackTime: number, clipStart: number): number {
    return Math.max(0, playbackTime - clipStart);
}

/**
 * Scale keyframes (zoom rhythm push-ins / punch-ins) zoom around the point 28%
 * from the top of the FRAME, the speaker's face, not the frame centre. The
 * export does exactly this (buildSmoothZoomFilter in jobs/exportProcessor.js,
 * anchor 0.5 / 0.28); without this offset the preview zoomed on the centre and
 * framed every push-in differently from the exported video.
 * Scaling about a point A = scaling about the centre, then moving by A*(1-s).
 */
const RHYTHM_ANCHOR_Y = 0.28;
/**
 * Total zoom of a VIDEO clip: its motion-engine animation (camera zoom/push/
 * shake…) × its own scale keyframes (zoom rhythm). Both play together, as in
 * the export (CameraMotionCompiler multiplies them). It used to be either/or:
 * with an animation on the clip, the zoom rhythm vanished from the preview.
 */
function videoCameraScale(kf: any, localTime: number, animScale: number | null, baseScale: number): number {
    const own = kf?.scale;
    if (animScale === null) return evaluateKF(own, localTime, baseScale);
    return animScale * evaluateKF(own, localTime, 1);
}

function rhythmAnchorDy(kf: any, localTime: number, canvasHeight: number): number {
    const scaleKfs = kf?.scaleY ?? kf?.scale;
    if (!Array.isArray(scaleKfs) || scaleKfs.length === 0) return 0;
    const s = evaluateKF(scaleKfs, localTime, 1);
    return (0.5 - RHYTHM_ANCHOR_Y) * canvasHeight * (s - 1);
}

/**
 * R64 — resolve a base video/image clip's `clip.animations` (Motion-tab
 * camera presets) at the current playback time.
 *
 * `motionLayer.x`/`.y` default to 50 (percent-of-frame, the convention every
 * OTHER layer kind uses — see MotionSchema.js header) while this file's own
 * `clip.x`/`clip.y` default to 0 (pixels, centred). Rather than assume which
 * convention a given clip's base position is in, this measures only the
 * DELTA the animation contributed (`resolved.x - motionLayer.x`) and applies
 * that delta, as pixels, on top of whatever pixel position the clip already
 * had — so it is correct regardless of the 50-vs-0 base mismatch. scale,
 * rotation and opacity have no such mismatch (their bases already agree with
 * `clip.scale`/`clip.rotation`/`clip.opacity`), so those resolve directly.
 */
function motionOffsets(motionLayer: any, absoluteTime: number, canvasWidth: number, canvasHeight: number) {
    const resolved = resolveMotionAt(motionLayer, absoluteTime);
    const dxPct = resolved.x - (Number.isFinite(motionLayer?.x) ? motionLayer.x : 50);
    const dyPct = resolved.y - (Number.isFinite(motionLayer?.y) ? motionLayer.y : 50);
    return {
        dx: (dxPct / 100) * canvasWidth,
        dy: (dyPct / 100) * canvasHeight,
        scale: resolved.scale,
        scaleX: resolved.scaleX,
        scaleY: resolved.scaleY,
        rotation: resolved.rotation,
        opacity: resolved.opacity,
    };
}

const timelineScene = makeScene2D('timeline', function* (view) {
    // ── Capture scene reference ONCE (safe inside generator body) ──
    const scene = useScene();
    const playback = scene.playback;
    const vars = scene.variables;

    const durationSignal = vars.get('duration', 10);
    const totalDuration: number = (durationSignal ? typeof durationSignal === 'function' ? durationSignal() : durationSignal : 10) as number;

    const tracksSignal = vars.get('tracks', []);
    const _rawTracks = (tracksSignal ? typeof tracksSignal === 'function' ? tracksSignal() : tracksSignal : []);
    // Defensive: vars.get can return a signal object, null, or a non-array on corrupted data.
    // If it's not an array, default to [] so the scene falls through to the "NO MEDIA" branch
    // instead of crashing the generator and triggering cascading r.map errors in Revideo internals.
    const tracks: any[] = Array.isArray(_rawTracks) ? _rawTracks : [];

    const backendUrlSignal = vars.get('backendUrl', '');
    const backendUrl: string = (typeof backendUrlSignal === 'function' ? backendUrlSignal() : backendUrlSignal) as string;

    const fixUrl = (url: string) => {
        if (!url) return '';
        if (url.startsWith('blob:') || url.startsWith('http')) return url;
        const base = backendUrl ? backendUrl.replace(/\/$/, '') : '';
        return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
    };

    const arSignal = vars.get('aspectRatio', '16:9');
    const ar: string = (typeof arSignal === 'function' ? arSignal() : arSignal) as string;
    const SIZE_MAP: Record<string, [number, number]> = {
        '16:9':  [1920, 1080],
        '9:16':  [1080, 1920],
        '1:1':   [1080, 1080],
        '4:3':   [1440, 1080],
        '4:5':   [1080, 1350],
        '21:9':  [2560, 1080],
    };
    const [cw, ch] = SIZE_MAP[ar] ?? SIZE_MAP['16:9'];
    view.size([cw, ch]);

    const canvasWidth = cw;
    const canvasHeight = ch;

    // Simple placeholder text when no tracks/clips.
    // Loop quickly (0.5s) so the scene re-reads tracks as soon as a clip is
    // added — the player key also remounts on empty→media transition as a
    // belt-and-suspenders guard.
    const hasClips = tracks.some(t => t.clips?.some((c: any) => c.url || c.type === 'text'));
    if (!hasClips) {
        yield view.add(
            <Txt
                text="NO MEDIA"
                fontSize={48}
                fontWeight={700}
                fontFamily="Inter, sans-serif"
                fill="rgba(255,255,255,0.15)"
            />
        );
        yield* waitFor(0.5);
        return;
    }

    // Sort tracks: highest order first, 0 last. 0 is drawn last (on top).
    const sortedTracks = [...tracks].sort((a,b) => (b.order ?? 0) - (a.order ?? 0));

    const layerRefs: Record<string, any> = {};
    sortedTracks.forEach(track => {
        const ref = createRef<Node>();
        layerRefs[track.id] = ref;
        view.add(<Node ref={ref} />);
    });

    /**
     * Contain fit: the whole picture is visible inside the project frame, with
     * black bars where the shapes differ. This is what the export renders
     * (buildScaleFilter in jobs/exportProcessor.js: scale ...decrease + pad),
     * so the editor now shows what will be exported (R53). It used to "cover"
     * (scale up and crop), which showed a portrait clip in a 16:9 project
     * filling the frame while the export had bars, and made captions look a
     * different size next to the speaker.
     *
     * Unknown source dimensions → assume the media already matches the canvas.
     */
    function fitSize(mediaW: number, mediaH: number): { w: number; h: number } {
        if (!mediaW || !mediaH) return { w: canvasWidth, h: canvasHeight };
        const s = Math.min(canvasWidth / mediaW, canvasHeight / mediaH);
        return { w: Math.round(mediaW * s), h: Math.round(mediaH * s) };
    }

    // Play all clips at their respective start times
    const runningClips: any[] = [];
    sortedTracks.forEach((track: any) => {
        // Defensive: clips should always be an array (built via .map() in IDELayout),
        // but guard against null/undefined from corrupted localStorage or serialization edge-cases.
        const trackClips: any[] = Array.isArray(track.clips) ? track.clips : [];
        trackClips.forEach((clip: any) => {
            runningClips.push(function* () {
                // Wait for clip's start time on the timeline
                yield* waitFor(clip.start);

                if (!layerRefs[track.id]) return;

                let wrapperRef: any = null;
                let mediaRef: any = null;
                if (clip.type === 'video') {
                    const resolvedUrl = fixUrl(clip.url);
                    if (!resolvedUrl) return;

                    wrapperRef = createRef<Node>();
                    mediaRef = createRef<Video>();
                    const kf = clip.keyframes || {};
                    // Motion-tab camera presets write clip.animations for
                    // base clips. Overlay clips also use the adapter even
                    // without animations so their percentage-centre geometry
                    // and quarter-frame base scale match the DOM preview.
                    const isOverlay = track.type === 'overlay';
                    // Overlay tracks use the same geometry contract as
                    // GraphicOverlay/Compositor: x/y are percentage centres
                    // and scale 1 means 25% of the canvas width. The base
                    // video path below uses pixel top-left coordinates and a
                    // full-frame fit, which made overlays jump to full-screen
                    // as soon as Revideo playback replaced the DOM preview.
                    const motionLayer = (isOverlay || (Array.isArray(clip.animations) && clip.animations.length > 0))
                        ? clipToMotionLayer(clip, track)
                        : null;

                    // FIX: Fall back to canvasWidth/canvasHeight (not 1920×1080)
                    // so 9:16 clips on a 9:16 canvas get the correct 1:1 mapping.
                    const srcW = clip.metadata?.resolution?.w || clip.sourceWidth || canvasWidth;
                    const srcH = clip.metadata?.resolution?.h || clip.sourceHeight || canvasHeight;
                    const fitted = fitSize(srcW, srcH);

                    // Read grading once at render time (static snapshot).
                    // Reactive callbacks calling tracksSignal() inside filter lambdas
                    // cause "scene not available" errors in Revideo's signal context.
                    const g = clip.grading;
                    const previewEffects = resolveRevideoPreviewEffects(clip);
                    const effectFilters = createRevideoEffectFilters(
                        previewEffects.effects, clip.start, clip.duration, () => playback.time,
                    );

                    // ── Virtual multicam / reframe crop (clip.virtualCam) ────────────────
                    // {cropX, cropY, cropW, cropH} are UV fractions of the source
                    // frame (see R14, render-lambda/revideo/src/scenes/timeline.tsx).
                    const vc = clip.virtualCam;
                    const hasVc = vc && typeof vc.cropW === 'number' && vc.cropW > 0 && vc.cropW < 0.999;
                    const vcZoom = hasVc ? 1 / vc.cropW : 1;
                    // Camera pan is image motion, so the crop window follows in
                    // the opposite direction. Keep this in source-frame units
                    // to match VideoPlayer's composed UV crop and FFmpeg export.
                    const vcLocalTime = clipLocalTime(playback.time, clip.start);
                    const vcPanX = evaluateKF(kf.panX, vcLocalTime, 0);
                    const vcPanY = evaluateKF(kf.panY, vcLocalTime, 0);
                    const animatedCrop = hasVc ? composeAnimatedCrop(
                        { cropX: vc.cropX ?? 0, cropY: vc.cropY ?? 0, cropW: vc.cropW, cropH: vc.cropH ?? 1 },
                        evaluateKF(kf.scale, vcLocalTime, 1), vcPanX, vcPanY,
                    ) : null;
                    const vcCx = animatedCrop ? (animatedCrop.cropX + animatedCrop.cropW / 2) - 0.5 : 0;
                    const vcCy = animatedCrop ? (animatedCrop.cropY + animatedCrop.cropH / 2) - 0.5 : 0;

                    const overlayScaleBase = canvasWidth * 0.25 / Math.max(1, fitted.w);
                    const totalScaleX = () => {
                        const motion = motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight);
                        return isOverlay
                            ? overlayScaleBase * motion.scale * motion.scaleX
                            : videoCameraScale(
                                kf,
                                clipLocalTime(playback.time, clip.start),
                                motionLayer ? motion.scale : null,
                                motionLayer ? 1 : (clip.scaleX ?? clip.scale ?? 1),
                            )
                                * (motionLayer ? motion.scaleX : 1)
                                * evaluateKF(kf.scaleX, clipLocalTime(playback.time, clip.start), 1) * vcZoom;
                    };
                    const totalScaleY = () => {
                        const motion = motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight);
                        return isOverlay
                            ? overlayScaleBase * motion.scale * motion.scaleY
                            : videoCameraScale(
                                kf,
                                clipLocalTime(playback.time, clip.start),
                                motionLayer ? motion.scale : null,
                                motionLayer ? 1 : (clip.scaleY ?? clip.scale ?? 1),
                            )
                                * (motionLayer ? motion.scaleY : 1)
                                * evaluateKF(kf.scaleY, clipLocalTime(playback.time, clip.start), 1) * vcZoom;
                    };

                    const posX = () => {
                        if (isOverlay) {
                            const motion = motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight);
                            const centreX = ((Number.isFinite(clip.x) ? clip.x : 50) / 100) * canvasWidth + motion.dx;
                            return centreX - fitted.w * totalScaleX() / 2;
                        }
                        const baseX = motionLayer
                            ? evaluateKF(kf.x, clipLocalTime(playback.time, clip.start), clip.x || 0) + motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight).dx
                            : evaluateKF(kf.x, clipLocalTime(playback.time, clip.start), clip.x || 0);
                        return baseX - vcCx * fitted.w * totalScaleX();
                    };
                    const posY = () => {
                        if (isOverlay) {
                            const motion = motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight);
                            const centreY = ((Number.isFinite(clip.y) ? clip.y : 50) / 100) * canvasHeight + motion.dy;
                            return centreY - fitted.h * totalScaleY() / 2;
                        }
                        const baseY = motionLayer
                            ? evaluateKF(kf.y, clipLocalTime(playback.time, clip.start), clip.y || 0) + motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight).dy
                                + (0.5 - RHYTHM_ANCHOR_Y) * canvasHeight * (
                                    videoCameraScale(kf, clipLocalTime(playback.time, clip.start), motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight).scale, 1)
                                    * motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight).scaleY
                                    * evaluateKF(kf.scaleY, clipLocalTime(playback.time, clip.start), 1) - 1
                                )
                            : evaluateKF(kf.y, clipLocalTime(playback.time, clip.start), clip.y || 0) + rhythmAnchorDy(kf, clipLocalTime(playback.time, clip.start), canvasHeight);
                        return baseY - vcCy * fitted.h * totalScaleY();
                    };

                    layerRefs[track.id]().add(
                        <Node ref={wrapperRef}>
                            <Video
                                ref={mediaRef}
                            src={resolvedUrl}
                            width={fitted.w}
                            height={fitted.h}
                            // Speed: the clip shows duration × speed seconds of
                            // source from `offset` (timeline/speedChange.js).
                            time={() => (playback.time - clip.start) * (clip.speed || 1) + (clip.offset || 0)}
                            playbackRate={clip.speed || 1}
                            play={true}
                            volume={(clip.volume ?? 1) * (clip.globalVolume ?? 1)}
                            allowVolumeAmplificationInPreview={true}
                            x={posX}
                            y={posY}
                            scaleX={totalScaleX}
                            scaleY={totalScaleY}
                            rotation={() => motionLayer
                                ? motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight).rotation
                                    + evaluateKF(kf.rotation, clipLocalTime(playback.time, clip.start), clip.rotation || 0) - (clip.rotation || 0)
                                : evaluateKF(kf.rotation, clipLocalTime(playback.time, clip.start), clip.rotation || 0)}
                            opacity={() => motionLayer
                                ? motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight).opacity
                                    + evaluateKF(kf.opacity, clipLocalTime(playback.time, clip.start), clip.opacity ?? 1) - (clip.opacity ?? 1)
                                : evaluateKF(kf.opacity, clipLocalTime(playback.time, clip.start), clip.opacity ?? 1)}
                            filters={[
                                ...(g ? [
                                    brightness((g.brightness ?? 100) / 100),
                                    contrast((g.contrast ?? 100) / 100),
                                    saturate((g.saturate ?? 100) / 100),
                                    hue(g.hueRotate ?? 0),
                                ] : []),
                                ...effectFilters,
                            ]}
                        />
                        </Node>
                    );
                } else if (clip.type === 'audio') {
                    const resolvedUrl = fixUrl(clip.url);
                    if (!resolvedUrl) return;

                    wrapperRef = createRef<Node>();
                    mediaRef = createRef<Audio>();
                    layerRefs[track.id]().add(
                        <Node ref={wrapperRef}>
                            <Audio
                                ref={mediaRef}
                            src={resolvedUrl}
                            // Speed: the clip shows duration × speed seconds of
                            // source from \`offset\` (timeline/speedChange.js).
                            time={() => (playback.time - clip.start) * (clip.speed || 1) + (clip.offset || 0)}
                            playbackRate={clip.speed || 1}
                            play={true}
                            volume={(clip.volume ?? 1) * (clip.globalVolume ?? 1)}
                            allowVolumeAmplificationInPreview={true}
                            />
                        </Node>
                    );
                } else if (clip.type === 'image') {
                    const resolvedUrl = fixUrl(clip.url);
                    if (!resolvedUrl) return;

                    wrapperRef = createRef<Node>();
                    mediaRef = createRef<Img>();
                    const kf = clip.keyframes || {};
                    // R64: see the identical comment in the video branch above.
                    const isOverlay = track.type === 'overlay';
                    const motionLayer = (isOverlay || (Array.isArray(clip.animations) && clip.animations.length > 0))
                        ? clipToMotionLayer(clip, track)
                        : null;

                    // FIX: Same canvas-relative fallback for images
                    const srcW = clip.metadata?.resolution?.w || clip.sourceWidth || canvasWidth;
                    const srcH = clip.metadata?.resolution?.h || clip.sourceHeight || canvasHeight;
                    const fitted = fitSize(srcW, srcH);
                    const overlayScaleBase = canvasWidth * 0.25 / Math.max(1, fitted.w);

                    const g = clip.grading;
                    const previewEffects = resolveRevideoPreviewEffects(clip);
                    const effectFilters = createRevideoEffectFilters(
                        previewEffects.effects, clip.start, clip.duration, () => playback.time,
                    );

                    // Image layers obey the exact same transform contract as
                    // video layers: `scale` is the uniform factor and
                    // `scaleX`/`scaleY` are independent axis multipliers.
                    // The former image implementation only used `scale`, so
                    // an authored stretch/squash (or an expression/parent
                    // transform producing one) snapped back to uniform scale
                    // as soon as the Revideo preview took over.
                    const imageScaleX = () => {
                        if (isOverlay) {
                            const motion = motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight);
                            return overlayScaleBase * motion.scale * motion.scaleX;
                        }
                        if (motionLayer) {
                            const motion = motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight);
                            return motion.scale * motion.scaleX;
                        }
                        return evaluateKF(kf.scaleX ?? kf.scale, clipLocalTime(playback.time, clip.start), clip.scaleX ?? clip.scale ?? 1);
                    };
                    const imageScaleY = () => {
                        if (isOverlay) {
                            const motion = motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight);
                            return overlayScaleBase * motion.scale * motion.scaleY;
                        }
                        if (motionLayer) {
                            const motion = motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight);
                            return motion.scale * motion.scaleY;
                        }
                        return evaluateKF(kf.scaleY ?? kf.scale, clipLocalTime(playback.time, clip.start), clip.scaleY ?? clip.scale ?? 1);
                    };

                    layerRefs[track.id]().add(
                        <Node ref={wrapperRef}>
                            <Img
                                ref={mediaRef}
                            src={resolvedUrl}
                            width={fitted.w}
                            height={fitted.h}
                            x={() => {
                                if (isOverlay) {
                                    const motion = motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight);
                                    const centreX = ((Number.isFinite(clip.x) ? clip.x : 50) / 100) * canvasWidth + motion.dx;
                                    return centreX - fitted.w * imageScaleX() / 2;
                                }
                                return motionLayer ? (clip.x || 0) + motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight).dx : evaluateKF(kf.x, clipLocalTime(playback.time, clip.start), clip.x || 0);
                            }}
                            y={() => {
                                if (isOverlay) {
                                    const motion = motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight);
                                    const centreY = ((Number.isFinite(clip.y) ? clip.y : 50) / 100) * canvasHeight + motion.dy;
                                    return centreY - fitted.h * imageScaleY() / 2;
                                }
                                return motionLayer ? (clip.y || 0) + motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight).dy : evaluateKF(kf.y, clipLocalTime(playback.time, clip.start), clip.y || 0);
                            }}
                            scaleX={imageScaleX}
                            scaleY={imageScaleY}
                            rotation={() => motionLayer ? motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight).rotation : evaluateKF(kf.rotation, clipLocalTime(playback.time, clip.start), clip.rotation || 0)}
                            opacity={() => motionLayer ? motionOffsets(motionLayer, playback.time, canvasWidth, canvasHeight).opacity : evaluateKF(kf.opacity, clipLocalTime(playback.time, clip.start), clip.opacity ?? 1)}
                            filters={[
                                ...(g ? [
                                    brightness((g.brightness ?? 100) / 100),
                                    contrast((g.contrast ?? 100) / 100),
                                    saturate((g.saturate ?? 100) / 100),
                                    hue(g.hueRotate ?? 0),
                                ] : []),
                                ...effectFilters,
                            ]}
                        />
                        </Node>
                    );
                } else if (clip.type === 'text') {
                    wrapperRef = createRef<Node>();
                    mediaRef = createRef<Txt>();
                    const kf = clip.keyframes || {};
                    layerRefs[track.id]().add(
                        <Node ref={wrapperRef}>
                            <Txt
                                ref={mediaRef}
                            text={clip.content || ''}
                            fill={clip.color || '#ffffff'}
                            fontSize={clip.fontSize || 48}
                            fontFamily={clip.fontFamily || 'Inter'}
                            x={() => evaluateKF(kf.x, clipLocalTime(playback.time, clip.start), clip.x || 0)}
                            y={() => evaluateKF(kf.y, clipLocalTime(playback.time, clip.start), clip.y || 0)}
                            scaleX={() => evaluateKF(kf.scaleX ?? kf.scale, clipLocalTime(playback.time, clip.start), clip.scaleX ?? clip.scale ?? 1)}
                            scaleY={() => evaluateKF(kf.scaleY ?? kf.scale, clipLocalTime(playback.time, clip.start), clip.scaleY ?? clip.scale ?? 1)}
                            rotation={() => evaluateKF(kf.rotation, clipLocalTime(playback.time, clip.start), clip.rotation || 0)}
                            opacity={() => evaluateKF(kf.opacity, clipLocalTime(playback.time, clip.start), clip.opacity ?? 1)}
                            />
                        </Node>
                    );
                }

                // Keep the media alive for its duration and apply transitions if any
                if (wrapperRef) {
                    const trans = clip.transition;
                    if (trans && trans.duration > 0) {
                        const tDur = Math.min(trans.duration, clip.duration);
                        const waitTime = clip.duration - tDur;

                        if (waitTime > 0) {
                            yield* waitFor(waitTime);
                        }

                        if (wrapperRef()) {
                            if (trans.type === 'fade' || trans.type === 'crossfade') {
                                yield* wrapperRef().opacity(0, tDur);
                            } else if (trans.type === 'slide') {
                                yield* wrapperRef().x(-1920, tDur);
                            } else if (trans.type === 'zoom') {
                                yield* wrapperRef().scale(0, tDur);
                            } else {
                                yield* waitFor(tDur);
                            }
                        }
                    } else {
                        yield* waitFor(clip.duration);
                    }

                    if (wrapperRef()) {
                        if (mediaRef() && typeof mediaRef().pause === 'function') {
                            mediaRef().pause();
                        }
                        wrapperRef().remove();
                    }
                }
            }());
        });
    });

    // Keep scene active for at least totalDuration (and until any running clips finish).
    // Using all() ensures the generator does not terminate early when clips finish before totalDuration.
    yield* all(
        waitFor(totalDuration),
        ...(runningClips.length > 0 ? runningClips : [])
    );
});

export default makeProject({
    scenes: [timelineScene],
});
