import { makeScene2D } from '@revideo/2d';
import { Video, Audio, Img, Txt, Rect } from '@revideo/2d';
import { all, chain, createRef, useScene, waitFor } from '@revideo/core';

export default makeScene2D('timeline', function* (view) {
    const vars = useScene().variables;

    const clips = ((vars.get('clips') as any[]) ?? [])
        .slice()
        .sort((a, b) => (a.start ?? 0) - (b.start ?? 0)); // Bug #4 corrigé

    const totalDuration = (vars.get('duration') as number) ?? 10;
    const aspectRatio = (vars.get('aspectRatio') as string) ?? '16:9';

    const height = 1080;
    const ratioMap: Record<string, number> = {
        '16:9': 16 / 9,
        '9:16': 9 / 16,
        '1:1': 1,
        '4:5': 4 / 5,
    };
    const ratio = ratioMap[aspectRatio] ?? 16 / 9;
    const width = Math.round(height * ratio);

    yield view.add(<Rect width={width} height={height} fill="#000000" />);

    // Bug #1, #2, #3, #5 corrigés : chaque clip est séquencé proprement
    const clipAnimations = clips.map((clip) => {
        const clipStart = clip.start ?? 0;
        const clipDuration = clip.duration ?? 5;

        switch (clip.type) {
            case 'video': {
                const videoRef = createRef<Video>();
                // On ajoute le nœud immédiatement mais invisible
                view.add(
                    <Video
                        ref={videoRef}
                        src={clip.url}
                        size={['100%', '100%']}
                        play={false}
                        time={clip.offset ?? 0}
                        opacity={0}
                    />
                );
                return function* () {
                    yield* waitFor(clipStart);           // attendre le bon moment
                    videoRef().opacity(1);
                    videoRef().play(true);               // démarrer la lecture
                    yield* waitFor(clipDuration);        // laisser jouer
                    videoRef().play(false);
                    videoRef().opacity(0);               // masquer après fin
                };
            }

            case 'audio': {
                const audioRef = createRef<Audio>();
                view.add(
                    <Audio
                        ref={audioRef}
                        src={clip.url}
                        play={false}
                        time={clip.offset ?? 0}
                        volume={clip.volume ?? 1}
                    />
                );
                return function* () {
                    yield* waitFor(clipStart);           // Bug #6 corrigé
                    audioRef().play(true);
                    yield* waitFor(clipDuration);
                    audioRef().play(false);
                };
            }

            case 'image': {
                const imgRef = createRef<Img>();
                view.add(
                    <Img
                        ref={imgRef}
                        src={clip.url}
                        size={['100%', '100%']}
                        opacity={0}
                    />
                );
                return function* () {
                    yield* waitFor(clipStart);
                    imgRef().opacity(clip.opacity ?? 1);
                    yield* waitFor(clipDuration);
                    imgRef().opacity(0);
                };
            }

            case 'text': {
                const txtRef = createRef<Txt>();
                const style = clip.style ?? {};
                view.add(
                    <Txt
                        ref={txtRef}
                        text={clip.content ?? clip.name ?? ''}
                        fontSize={style.fontSize ?? 48}
                        fontWeight={style.fontWeight ?? 700}
                        fontFamily={style.fontFamily ?? 'Inter'}
                        fill={style.color ?? '#ffffff'}
                        opacity={0}
                        y={
                            clip.position === 'top' ? -height / 3 :
                                clip.position === 'bottom' ? height / 3 : 0
                        }
                    />
                );
                return function* () {
                    yield* waitFor(clipStart);
                    txtRef().opacity(1);
                    yield* waitFor(clipDuration);
                    txtRef().opacity(0);
                };
            }

            default:
                return function* () { };
        }
    });

    // Lancer tous les clips en parallèle (all = ils tournent simultanément,
    // chacun gère son propre waitFor interne)
    yield* all(...clipAnimations.map(fn => fn()));

    // Compléter jusqu'à la durée totale si nécessaire
    yield* waitFor(totalDuration);
});