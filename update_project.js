const fs = require('fs');
const file = 'client/src/revideo/project.tsx';
let code = fs.readFileSync(file, 'utf8');

// Replace the clip component generation to use wrappers
code = code.replace(
    /let clipRef: any = null;\s+if \(clip\.type === 'video'\) {([\s\S]*?)\]\n\s+\/>\n\s+\);\n\s+} else if \(clip\.type === 'audio'\) {/g,
    `let wrapperRef: any = null;
                let mediaRef: any = null;
                if (clip.type === 'video') {
                    wrapperRef = createRef<Node>();
                    mediaRef = createRef<Video>();
                    const kf = clip.keyframes || {};
$1]
                            />
                        </Node>
                    );
                } else if (clip.type === 'audio') {`
);

code = code.replace(/clipRef = createRef<Video>\(\);/, '');
code = code.replace(/<Video\s+ref=\{clipRef\}/, '<Video\n                                ref={mediaRef}');

code = code.replace(
    /clipRef = createRef<Audio>\(\);\s+layerRefs\[track\.id\]\(\)\.add\(\s+<Audio\s+ref=\{clipRef\}/g,
    `wrapperRef = createRef<Node>();
                    mediaRef = createRef<Audio>();
                    layerRefs[track.id]().add(
                        <Node ref={wrapperRef}>
                            <Audio
                                ref={mediaRef}`
);
code = code.replace(
    /play=\{true\}\s+volume=\{\(clip\.volume \?\? 1\) \* \(clip\.globalVolume \?\? 1\)\}\s+\/>\n\s+\);/g,
    `play={true}
                                volume={(clip.volume ?? 1) * (clip.globalVolume ?? 1)}
                            />
                        </Node>
                    );`
);

code = code.replace(
    /clipRef = createRef<Img>\(\);\s+const kf = clip\.keyframes/g,
    `wrapperRef = createRef<Node>();
                    mediaRef = createRef<Img>();
                    const kf = clip.keyframes`
);
code = code.replace(/layerRefs\[track\.id\]\(\)\.add\(\s+<Img\s+ref=\{clipRef\}/g, `layerRefs[track.id]().add(
                        <Node ref={wrapperRef}>
                            <Img
                                ref={mediaRef}`);
code = code.replace(
    /hue\(\(\) => getGrading\(\)\?\.hueRotate \?\? 0\),\n\s+\]\}\n\s+\/>\n\s+\);/g,
    `hue(() => getGrading()?.hueRotate ?? 0),
                            ]}
                        />
                        </Node>
                    );`
);

code = code.replace(
    /clipRef = createRef<Txt>\(\);\s+const kf = clip\.keyframes/g,
    `wrapperRef = createRef<Node>();
                    mediaRef = createRef<Txt>();
                    const kf = clip.keyframes`
);
code = code.replace(/layerRefs\[track\.id\]\(\)\.add\(\s+<Txt\s+ref=\{clipRef\}/g, `layerRefs[track.id]().add(
                        <Node ref={wrapperRef}>
                            <Txt
                                ref={mediaRef}`);
code = code.replace(
    /opacity\{\(\) => evaluateKF\(kf\.opacity, clipLocalTime\(playback\.time, clip\.start\), clip\.opacity \?\? 1\)\}\n\s+\/>\n\s+\);/g,
    `opacity={() => evaluateKF(kf.opacity, clipLocalTime(playback.time, clip.start), clip.opacity ?? 1)}
                            />
                        </Node>
                    );`
);


// Replace transition tweening
code = code.replace(/if \(clipRef\) \{/g, `if (wrapperRef) {`);
code = code.replace(/if \(clipRef\(\)\) \{/g, `if (wrapperRef()) {`);
code = code.replace(/yield\* clipRef\(\)\./g, `yield* wrapperRef().`);

// Keep pause on mediaRef
code = code.replace(/if \(typeof clipRef\(\)\.pause === 'function'\) \{/g, `if (mediaRef() && typeof mediaRef().pause === 'function') {`);
code = code.replace(/clipRef\(\)\.pause\(\);/g, `mediaRef().pause();`);

// Keep remove on wrapperRef
code = code.replace(/clipRef\(\)\.remove\(\);/g, `wrapperRef().remove();`);

fs.writeFileSync(file, code);
