/** @jsxImportSource @revideo/2d/lib */
import { makeProject } from '@revideo/core';
import { makeScene2D, Video, Audio, Img, Txt, Node, brightness, contrast, saturate, hue } from '@revideo/2d';
import { waitFor, useScene, all, any, createRef } from '@revideo/core';

/**
 * Evaluate a keyframe array at a given local clip time.
 * Supports: linear, easeIn, easeOut, easeInOut, bounce, elastic.
 */
function evaluateKF(keyframes: any[], time: number, defaultValue: number): number {
    if (!keyframes || keyframes.length === 0) return defaultValue;
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    if (time <= sorted[0].time) return sorted[0].value;
    if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

    let from = sorted[0], to = sorted[1];
    for (let i = 0; i < sorted.length - 1; i++) {
        if (time >= sorted[i].time && time < sorted[i + 1].time) { from = sorted[i]; to = sorted[i + 1]; break; }
    }
    const t0 = (time - from.time) / Math.max(to.time - from.time, 0.0001);
    const easingMap: Record<string, (t: number) => number> = {
        linear: t => t,
        easeIn: t => t * t,
        easeOut: t => t * (2 - t),
        easeInOut: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
        'ease-in': t => t * t,
        'ease-out': t => t * (2 - t),
        'ease-in-out': t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
        bounce: t => { const n1 = 7.5625, d1 = 2.75; if (t < 1/d1) return n1*t*t; if (t < 2/d1) return n1*(t-=1.5/d1)*t+0.75; if (t < 2.5/d1) return n1*(t-=2.25/d1)*t+0.9375; return n1*(t-=2.625/d1)*t+0.984375; },
        elastic: t => t === 0 || t === 1 ? t : Math.pow(2, -10*t) * Math.sin((t-0.1)*5*Math.PI) + 1,
    };
    const easing = easingMap[to.easing || 'linear'] || easingMap.linear;
    return from.value + (to.value - from.value) * easing(t0);
}

/** Helper: get clip-local time relative to clip start (for keyframe evaluation) */
function clipLocalTime(playbackTime: number, clipStart: number): number {
    return Math.max(0, playbackTime - clipStart);
}

const timelineScene = makeScene2D('timeline', function* (view) {
    // ── Capture scene reference ONCE (safe inside generator body) ──
    const scene = useScene();
    const playback = scene.playback;
    const vars = scene.variables;

    const durationSignal = vars.get('duration', 10);
    const totalDuration: number = (durationSignal ? typeof durationSignal === 'function' ? durationSignal() : durationSignal : 10) as number;

    const tracksSignal = vars.get('tracks', []);
    const tracks: any[] = (tracksSignal ? typeof tracksSignal === 'function' ? tracksSignal() : tracksSignal : []) as any[];

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
     * FIX: Cover-mode scaling — video fills the canvas completely.
     * Uses max scale so the media covers every pixel (cropping overflow
     * rather than leaving letterbox/pillarbox bars).
     *
     * When source dimensions are unknown we fall back to the canvas size
     * directly (1:1 mapping) instead of the old 1920×1080 hard-code which
     * was wrong for 9:16 canvases and caused the squeeze bug.
     */
    function fitSize(mediaW: number, mediaH: number): { w: number; h: number } {
        // Unknown dimensions → assume the media already matches the canvas
        if (!mediaW || !mediaH) return { w: canvasWidth, h: canvasHeight };
        const scaleW = canvasWidth / mediaW;
        const scaleH = canvasHeight / mediaH;
        // "cover" — scale up so the smaller dimension fills its canvas axis;
        // the larger dimension overflows and is cropped by the node boundary.
        const s = Math.max(scaleW, scaleH);
        return { w: Math.round(mediaW * s), h: Math.round(mediaH * s) };
    }

    // Play all clips at their respective start times
    const runningClips: any[] = [];
    sortedTracks.forEach((track: any) => {
        track.clips.forEach((clip: any) => {
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

                    // FIX: Fall back to canvasWidth/canvasHeight (not 1920×1080)
                    // so 9:16 clips on a 9:16 canvas get the correct 1:1 mapping.
                    const srcW = clip.metadata?.resolution?.w || clip.sourceWidth || canvasWidth;
                    const srcH = clip.metadata?.resolution?.h || clip.sourceHeight || canvasHeight;
                    const fitted = fitSize(srcW, srcH);

                    // Read grading once at render time (static snapshot).
                    // Reactive callbacks calling tracksSignal() inside filter lambdas
                    // cause "scene not available" errors in Revideo's signal context.
                    const g = clip.grading;

                    layerRefs[track.id]().add(
                        <Node ref={wrapperRef}>
                            <Video
                                ref={mediaRef}
                            src={resolvedUrl}
                            width={fitted.w}
                            height={fitted.h}
                            time={() => playback.time - clip.start + (clip.offset || 0)}
                            play={true}
                            volume={(clip.volume ?? 1) * (clip.globalVolume ?? 1)}
                            x={() => evaluateKF(kf.x, clipLocalTime(playback.time, clip.start), clip.x || 0)}
                            y={() => evaluateKF(kf.y, clipLocalTime(playback.time, clip.start), clip.y || 0)}
                            scaleX={() => evaluateKF(kf.scaleX ?? kf.scale, clipLocalTime(playback.time, clip.start), clip.scaleX ?? clip.scale ?? 1)}
                            scaleY={() => evaluateKF(kf.scaleY ?? kf.scale, clipLocalTime(playback.time, clip.start), clip.scaleY ?? clip.scale ?? 1)}
                            rotation={() => evaluateKF(kf.rotation, clipLocalTime(playback.time, clip.start), clip.rotation || 0)}
                            opacity={() => evaluateKF(kf.opacity, clipLocalTime(playback.time, clip.start), clip.opacity ?? 1)}
                            filters={g ? [
                                brightness((g.brightness ?? 100) / 100),
                                contrast((g.contrast ?? 100) / 100),
                                saturate((g.saturate ?? 100) / 100),
                                hue(g.hueRotate ?? 0),
                            ] : []}
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
                            time={() => playback.time - clip.start + (clip.offset || 0)}
                            play={true}
                                volume={(clip.volume ?? 1) * (clip.globalVolume ?? 1)}
                            />
                        </Node>
                    );
                } else if (clip.type === 'image') {
                    const resolvedUrl = fixUrl(clip.url);
                    if (!resolvedUrl) return;

                    wrapperRef = createRef<Node>();
                    mediaRef = createRef<Img>();
                    const kf = clip.keyframes || {};

                    // FIX: Same canvas-relative fallback for images
                    const srcW = clip.metadata?.resolution?.w || clip.sourceWidth || canvasWidth;
                    const srcH = clip.metadata?.resolution?.h || clip.sourceHeight || canvasHeight;
                    const fitted = fitSize(srcW, srcH);

                    const g = clip.grading;

                    layerRefs[track.id]().add(
                        <Node ref={wrapperRef}>
                            <Img
                                ref={mediaRef}
                            src={resolvedUrl}
                            width={fitted.w}
                            height={fitted.h}
                            x={() => evaluateKF(kf.x, clipLocalTime(playback.time, clip.start), clip.x || 0)}
                            y={() => evaluateKF(kf.y, clipLocalTime(playback.time, clip.start), clip.y || 0)}
                            scaleX={() => evaluateKF(kf.scaleX ?? kf.scale, clipLocalTime(playback.time, clip.start), clip.scaleX ?? clip.scale ?? 1)}
                            scaleY={() => evaluateKF(kf.scaleY ?? kf.scale, clipLocalTime(playback.time, clip.start), clip.scaleY ?? clip.scale ?? 1)}
                            rotation={() => evaluateKF(kf.rotation, clipLocalTime(playback.time, clip.start), clip.rotation || 0)}
                            opacity={() => evaluateKF(kf.opacity, clipLocalTime(playback.time, clip.start), clip.opacity ?? 1)}
                            filters={g ? [
                                brightness((g.brightness ?? 100) / 100),
                                contrast((g.contrast ?? 100) / 100),
                                saturate((g.saturate ?? 100) / 100),
                                hue(g.hueRotate ?? 0),
                            ] : []}
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

    yield* any(
        waitFor(totalDuration),
        all(...runningClips)
    );
});

export default makeProject({
    scenes: [timelineScene],
});
