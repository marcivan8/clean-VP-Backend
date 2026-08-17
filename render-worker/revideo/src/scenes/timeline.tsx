import { makeScene2D, Video, Img, Txt, Node } from '@revideo/2d';
import { waitFor, useScene, all, createRef } from '@revideo/core';
import { clipToLayer } from '../motion/RevideoLayerAdapter.js';
import { resolveMotionAt } from '../motion/MotionResolver.js';
import { revealedWordCount } from '../motion/CaptionModel.js';

/**
 * render-worker/revideo/src/scenes/timeline.tsx
 *
 * R69 — AI Animation Intelligence's sibling entry: the render architecture
 * split (CLAUDE.md, "let's build and wire revideo for animation, captions
 * and motion graphics"). Rewritten from the pre-existing scene, which only
 * understood the old flat `clip.keyframes` format and had no caption/sticker/
 * lower-third support at all.
 *
 * ─── WHAT THIS SCENE DOES, AND WHAT IT DELIBERATELY DOES NOT DO ────────────
 * Per the confirmed architecture split: FFmpeg owns cuts, audio, encoding,
 * muxing, compression, AND camera-motion (push/pull/zoom/shake stays in
 * `jobs/exportProcessor.js`'s existing zoompan path — R64, already reliable).
 * This scene receives exactly ONE pre-cut, pre-graded, fully-audio-mixed
 * `baseVideoUrl` — the output of FFmpeg's STEP 1–3 — and draws ONLY:
 *   - 'text' tracks (captions, titles) — word-timed reveal + the SAME
 *     `resolveMotionAt()` every other surface (DOM preview, FFmpeg's R63
 *     caption program) uses, via the ported motion/ files in this directory.
 *   - 'overlay' tracks (stickers, logos, lower-thirds, motion-graphic
 *     composite groups) — image-sourced only, matching R62's own scope limit.
 * It does NOT re-implement per-clip video trimming, transitions, colour
 * grading, or virtualCam crop — those stay exactly where FFmpeg already does
 * them reliably, so this scene never duplicates that logic (the "two
 * implementations of one rule" failure this codebase has hit before:
 * R14/R16/R53/R56).
 *
 * ─── COORDINATES ────────────────────────────────────────────────────────────
 * `layer.x`/`layer.y` are PERCENT-of-frame naming the element's CENTRE (the
 * same convention TextOverlay.jsx / GraphicOverlay.jsx use). Revideo's node
 * origin is canvas-centre, so converting is one line: pixelX = (x-50)/100*cw.
 *
 * ─── SCOPE LIMITS, STATED PLAINLY ───────────────────────────────────────────
 * - No per-word colour highlight of the actively-spoken word yet — captions
 *   reveal word-by-word (real timing, via `revealedWordCount`) but render as
 *   one flat colour. `CAPTION_STYLE_PACKS.wordHighlight` is not applied here.
 * - No custom font embedding (render-lambda's `FontInstaller` base64-embeds
 *   fonts for a stateless Lambda cold start; this worker doesn't need that
 *   trick, but font loading here is still just a named `fontFamily` on `Txt`,
 *   falling back to the browser's built-in sans-serif if the family isn't
 *   otherwise available in the render container).
 */

function useVar<T>(vars: any, name: string, fallback: T): T {
    const signal = vars.get(name, fallback);
    return (typeof signal === 'function' ? signal() : signal) as T;
}

export default makeScene2D('timeline', function* (view) {
    const scene = useScene();
    const playback = scene.playback;
    const vars = scene.variables;

    const backendUrl = useVar<string>(vars, 'backendUrl', '');
    const fixUrl = (url: string) => {
        if (!url) return url;
        if (url.startsWith('blob:') || url.startsWith('http') || url.startsWith('data:')) return url;
        if (url.startsWith('/api') || url.startsWith('/uploads')) return backendUrl + url;
        return url;
    };

    const totalDuration = useVar<number>(vars, 'duration', 10);
    const baseVideoUrl = useVar<string>(vars, 'baseVideoUrl', '');
    const tracks = useVar<any[]>(vars, 'tracks', []); // ONLY 'text'/'overlay' tracks — see header

    const ar = useVar<string>(vars, 'aspectRatio', '16:9');
    const SIZE_MAP: Record<string, [number, number]> = {
        '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080],
        '4:3': [1440, 1080], '4:5': [1080, 1350], '21:9': [2560, 1080],
    };
    const [cw, ch] = SIZE_MAP[ar] ?? SIZE_MAP['16:9'];
    view.size([cw, ch]);

    // ── Base video — the ONE video node, already cut/graded/mixed by FFmpeg ──
    if (baseVideoUrl) {
        yield view.add(
            <Video
                src={fixUrl(baseVideoUrl)}
                width={cw}
                height={ch}
                x={0}
                y={0}
                time={() => playback.time}
                play={true}
            />
        );
    } else {
        // No base video passed — this scene is only ever called with one from
        // exportProcessor.js's Revideo branch, but fail visibly rather than
        // silently rendering a blank/black export if that contract is broken.
        yield view.add(
            <Txt text="NO BASE VIDEO" fontSize={48} fontWeight={700} fontFamily="Inter, sans-serif" fill="rgba(255,0,0,0.4)" />
        );
    }

    // Sort tracks highest-order-first so order:0 draws LAST (on top) — same
    // convention the old scene and the DOM preview both already use.
    const sortedTracks = [...tracks].sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

    const layerRefs: Record<string, any> = {};
    sortedTracks.forEach(track => {
        const ref = createRef<Node>();
        layerRefs[track.id] = ref;
        view.add(<Node ref={ref} />);
    });

    // ── Percent-of-frame-centre → pixel-from-canvas-centre ──────────────────
    const toPxX = (pct: number) => ((pct ?? 50) - 50) / 100 * cw;
    const toPxY = (pct: number) => ((pct ?? 50) - 50) / 100 * ch;

    const runningLayers: any[] = [];
    sortedTracks.forEach((track: any) => {
        (track.clips || []).forEach((clip: any) => {
            const layer = clipToLayer(clip, track);
            if (!layer) return;

            runningLayers.push(function* () {
                yield* waitFor(layer.startTime);
                if (!layerRefs[track.id] || !layerRefs[track.id]()) return;

                const resolved = () => resolveMotionAt(layer, playback.time);
                const nodeRef = createRef<Node>();

                if (track.type === 'text') {
                    const wordCount = Array.isArray(layer.words) ? layer.words.length : 0;
                    const textFn = () => {
                        if (wordCount > 0) {
                            const r = resolved();
                            const n = revealedWordCount(layer.words, playback.time, r.reveal, wordCount);
                            return layer.words.slice(0, n).map((w: any) => w.text).join(' ');
                        }
                        return layer.content || '';
                    };
                    layerRefs[track.id]().add(
                        <Txt
                            ref={nodeRef}
                            text={textFn}
                            fill={clip.color || '#ffffff'}
                            fontSize={clip.fontSize || 48}
                            fontFamily={clip.fontFamily || 'Inter'}
                            fontWeight={clip.fontWeight || 400}
                            x={() => toPxX(resolved().x)}
                            y={() => toPxY(resolved().y)}
                            scale={() => resolved().scale}
                            rotation={() => resolved().rotation}
                            opacity={() => resolved().opacity}
                        />
                    );
                } else if (track.type === 'overlay') {
                    // Image-sourced only — matches R62's own scope limit
                    // (lower thirds/logos/stickers are all real image files;
                    // vector shapes have a model, still no renderer, anywhere).
                    const url = clip.url || clip.proxyUrl || clip.sourceUrl;
                    if (!url) return;
                    layerRefs[track.id]().add(
                        <Img
                            ref={nodeRef}
                            src={fixUrl(url)}
                            x={() => toPxX(resolved().x)}
                            y={() => toPxY(resolved().y)}
                            scale={() => resolved().scale}
                            rotation={() => resolved().rotation}
                            opacity={() => resolved().opacity}
                        />
                    );
                }

                yield* waitFor(layer.duration);
                // Remove this clip's node once its window ends — without this
                // every text/overlay clip would stay on screen for the REST of
                // the render, stacking on top of whatever plays after it.
                if (nodeRef()) nodeRef().remove();
            }());
        });
    });

    yield* all(waitFor(totalDuration), ...runningLayers);
});
