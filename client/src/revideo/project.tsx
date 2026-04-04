/** @jsxImportSource @revideo/2d/lib */
import { makeProject } from '@revideo/core';
import { makeScene2D, Video, Audio, Img, Txt, Node } from '@revideo/2d';
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
    const vars = useScene().variables;
    const durationSignal = vars.get('duration', 10);
    const totalDuration: number = (durationSignal ? typeof durationSignal === 'function' ? durationSignal() : durationSignal : 10) as number;

    const tracksSignal = vars.get('tracks', []);
    const tracks: any[] = (tracksSignal ? typeof tracksSignal === 'function' ? tracksSignal() : tracksSignal : []) as any[];

    // Simple placeholder text when no tracks/clips
    const hasClips = tracks.some(t => t.clips && t.clips.length > 0);
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
        yield* waitFor(totalDuration);
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

    // Play all clips at their respective start times
    const runningClips: any[] = [];
    sortedTracks.forEach((track: any) => {
        track.clips.forEach((clip: any) => {
            runningClips.push(function* () {
                // Wait for clip's start time on the timeline
                yield* waitFor(clip.start);

                let clipRef: any = null;
                if (clip.type === 'video') {
                    clipRef = createRef<Video>();
                    const kf = clip.keyframes || {};
                    layerRefs[track.id]().add(
                        <Video
                            ref={clipRef}
                            src={clip.url}
                            width={"100%"}
                            height={"100%"}
                            time={() => useScene().playback.time - clip.start + (clip.offset || 0)}
                            play={true}
                            volume={(clip.volume ?? 1) * (clip.globalVolume ?? 1)}
                            x={() => evaluateKF(kf.x, clipLocalTime(useScene().playback.time, clip.start), clip.x || 0)}
                            y={() => evaluateKF(kf.y, clipLocalTime(useScene().playback.time, clip.start), clip.y || 0)}
                            scaleX={() => evaluateKF(kf.scaleX ?? kf.scale, clipLocalTime(useScene().playback.time, clip.start), clip.scaleX ?? clip.scale ?? 1)}
                            scaleY={() => evaluateKF(kf.scaleY ?? kf.scale, clipLocalTime(useScene().playback.time, clip.start), clip.scaleY ?? clip.scale ?? 1)}
                            rotation={() => evaluateKF(kf.rotation, clipLocalTime(useScene().playback.time, clip.start), clip.rotation || 0)}
                            opacity={() => evaluateKF(kf.opacity, clipLocalTime(useScene().playback.time, clip.start), clip.opacity ?? 1)}
                        />
                    );
                } else if (clip.type === 'audio') {
                    clipRef = createRef<Audio>();
                    layerRefs[track.id]().add(
                        <Audio
                            ref={clipRef}
                            src={clip.url}
                            time={() => useScene().playback.time - clip.start + (clip.offset || 0)}
                            play={true}
                            volume={(clip.volume ?? 1) * (clip.globalVolume ?? 1)}
                        />
                    );
                } else if (clip.type === 'image') {
                    clipRef = createRef<Img>();
                    const kf = clip.keyframes || {};
                    layerRefs[track.id]().add(
                        <Img
                            ref={clipRef}
                            src={clip.url}
                            width={"100%"}
                            height={"100%"}
                            x={() => evaluateKF(kf.x, clipLocalTime(useScene().playback.time, clip.start), clip.x || 0)}
                            y={() => evaluateKF(kf.y, clipLocalTime(useScene().playback.time, clip.start), clip.y || 0)}
                            scaleX={() => evaluateKF(kf.scaleX ?? kf.scale, clipLocalTime(useScene().playback.time, clip.start), clip.scaleX ?? clip.scale ?? 1)}
                            scaleY={() => evaluateKF(kf.scaleY ?? kf.scale, clipLocalTime(useScene().playback.time, clip.start), clip.scaleY ?? clip.scale ?? 1)}
                            rotation={() => evaluateKF(kf.rotation, clipLocalTime(useScene().playback.time, clip.start), clip.rotation || 0)}
                            opacity={() => evaluateKF(kf.opacity, clipLocalTime(useScene().playback.time, clip.start), clip.opacity ?? 1)}
                        />
                    );
                } else if (clip.type === 'text') {
                    clipRef = createRef<Txt>();
                    const kf = clip.keyframes || {};
                    layerRefs[track.id]().add(
                        <Txt
                            ref={clipRef}
                            text={clip.content || ''}
                            fill={clip.color || '#ffffff'}
                            fontSize={clip.fontSize || 48}
                            fontFamily={clip.fontFamily || 'Inter'}
                            x={() => evaluateKF(kf.x, clipLocalTime(useScene().playback.time, clip.start), clip.x || 0)}
                            y={() => evaluateKF(kf.y, clipLocalTime(useScene().playback.time, clip.start), clip.y || 0)}
                            scaleX={() => evaluateKF(kf.scaleX ?? kf.scale, clipLocalTime(useScene().playback.time, clip.start), clip.scaleX ?? clip.scale ?? 1)}
                            scaleY={() => evaluateKF(kf.scaleY ?? kf.scale, clipLocalTime(useScene().playback.time, clip.start), clip.scaleY ?? clip.scale ?? 1)}
                            rotation={() => evaluateKF(kf.rotation, clipLocalTime(useScene().playback.time, clip.start), clip.rotation || 0)}
                            opacity={() => evaluateKF(kf.opacity, clipLocalTime(useScene().playback.time, clip.start), clip.opacity ?? 1)}
                        />
                    );
                }

                // Keep the media alive for its duration and apply transitions if any
                if (clipRef) {
                    const trans = clip.transition;
                    if (trans && trans.duration > 0) {
                        const tDur = Math.min(trans.duration, clip.duration);
                        const waitTime = clip.duration - tDur;
                        
                        if (waitTime > 0) {
                            yield* waitFor(waitTime);
                        }
                        
                        if (clipRef()) {
                            if (trans.type === 'fade' || trans.type === 'crossfade') {
                                yield* clipRef().opacity(0, tDur);
                            } else if (trans.type === 'slide') {
                                // Default slide left
                                yield* clipRef().x(-1920, tDur);
                            } else if (trans.type === 'zoom') {
                                yield* clipRef().scale(0, tDur);
                            } else {
                                yield* waitFor(tDur);
                            }
                        }
                    } else {
                        yield* waitFor(clip.duration);
                    }

                    if (clipRef()) {
                        clipRef().remove();
                    }
                }
            }());
        });
    });

    // Terminate when the duration is hit, OR all clips finish (whichever is sooner/exact duration is safer)
    // Actually we want it to always hit totalDuration exactly. So:
    yield* any(
        waitFor(totalDuration),
        all(...runningClips)
    );
});

export default makeProject({
    scenes: [timelineScene],
});
