import { makeScene2D } from '@revideo/2d';
import { Video, Audio, Img, Txt, Rect } from '@revideo/2d';
import { all, chain, createRef, useScene, waitFor } from '@revideo/core';

/**
 * Timeline Scene
 *
 * Reads clip data from `variables` and renders them using Revideo's
 * built-in Video, Audio, Img, and Txt components.
 *
 * Expected variables shape:
 * {
 *   clips: [
 *     { type: 'video', url, start, duration, volume?, filter?, opacity? },
 *     { type: 'audio', url, start, duration, volume? },
 *     { type: 'image', url, start, duration, filter?, opacity? },
 *     { type: 'text',  content, start, duration, position?, style? },
 *   ],
 *   duration: number (seconds),
 *   aspectRatio: '16:9' | '9:16' | '1:1' | '4:5',
 *   fps: number
 * }
 */
export default makeScene2D('timeline', function* (view) {
    const vars = useScene().variables;

    // Parse variables (with defaults)
    const clips = (vars.get('clips') as any[]) ?? [];
    const totalDuration = (vars.get('duration') as number) ?? 10;
    const aspectRatio = (vars.get('aspectRatio') as string) ?? '16:9';

    // Compute canvas dimensions
    const height = 1080;
    const ratioMap: Record<string, number> = {
        '16:9': 16 / 9,
        '9:16': 9 / 16,
        '1:1': 1,
        '4:5': 4 / 5,
    };
    const ratio = ratioMap[aspectRatio] ?? 16 / 9;
    const width = Math.round(height * ratio);

    // Background
    yield view.add(
        <Rect width={width} height={height} fill="#000000" />
    );

    // Render each clip
    for (const clip of clips) {
        const clipStart = clip.start ?? 0;
        const clipDuration = clip.duration ?? 5;

        switch (clip.type) {
            case 'video': {
                const videoRef = createRef<Video>();
                yield view.add(
                    <Video
                        ref={videoRef}
                        src={clip.url}
                        size={['100%', '100%']}
                        play={true}
                        time={clip.offset ?? 0}
                        opacity={clip.opacity ?? 1}
                    />
                );
                break;
            }

            case 'audio': {
                yield view.add(
                    <Audio
                        src={clip.url}
                        play={true}
                        time={clip.offset ?? 0}
                        volume={clip.volume ?? 1}
                    />
                );
                break;
            }

            case 'image': {
                yield view.add(
                    <Img
                        src={clip.url}
                        size={['100%', '100%']}
                        opacity={clip.opacity ?? 1}
                    />
                );
                break;
            }

            case 'text': {
                const style = clip.style ?? {};
                yield view.add(
                    <Txt
                        text={clip.content ?? clip.name ?? ''}
                        fontSize={style.fontSize ?? 48}
                        fontWeight={style.fontWeight ?? 700}
                        fontFamily={style.fontFamily ?? 'Inter'}
                        fill={style.color ?? '#ffffff'}
                        y={clip.position === 'top' ? -height / 3 :
                            clip.position === 'bottom' ? height / 3 : 0}
                    />
                );
                break;
            }
        }
    }

    // Hold for the total duration of the video
    yield* waitFor(totalDuration);
});
