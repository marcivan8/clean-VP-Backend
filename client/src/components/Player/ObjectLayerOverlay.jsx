/**
 * client/src/components/Player/ObjectLayerOverlay.jsx
 *
 * R67 — Object Intelligence Integration, "blur background" PREVIEW path.
 *
 * This is the one genuinely new render primitive this feature needed (see
 * client/src/motion/ObjectLayers.js's header — zoom/track/animate speaker
 * all reuse the existing `virtualCam` crop pipeline and need NO new preview
 * code). Nothing in this codebase has ever composited two video sources
 * with an alpha mask before this — confirmed against PlaybackEngine.js's
 * WebGL shader (single texture sampler, crop + colour-grade only, no second
 * texture input, no blur primitive at all) before writing this file.
 *
 * WHY A SEPARATE CANVAS OVERLAY, NOT A PlaybackEngine.js SHADER CHANGE:
 * PlaybackEngine's fragment shader is the single highest-traffic, most
 * load-bearing piece of render code in this app — every clip, every frame,
 * goes through it. Adding a second texture sampler (the mask) and a
 * multi-tap blur to that ONE shared shader is a much higher-risk change
 * than an ADDITIVE overlay that only mounts for the rare clip that actually
 * has `layerTarget: 'background'`, and leaves the shader every other clip
 * uses completely untouched. Precedent: R64 made the identical call to keep
 * translate-type camera presets preview-only rather than touch zoompan's
 * higher-risk x=/y= pan expression.
 *
 * HOW THE COMPOSITE WORKS (plain Canvas2D, CPU-side):
 * A SAM2 "highlighted" mask output is a plain video whose LUMA marks the
 * foreground (bright = subject, dark = background) — it has no real alpha
 * channel of its own (`drawImage` always treats a decoded video frame as
 * fully opaque), so `destination-in` compositing on the raw mask frame does
 * nothing useful. The actual per-pixel step is: read the mask frame's pixel
 * data, and write a NEW ImageData whose RGB comes from the SOURCE frame and
 * whose ALPHA comes from the mask frame's luminance. That buffer, drawn on
 * top of a blurred copy of the same source frame, is the composite.
 *
 * SCOPE LIMIT, stated plainly per this project's convention (see
 * CameraMotionCompiler.js's precedent): this does NOT compose with
 * `virtualCam` crop or zoom-rhythm keyframes on the SAME clip — the store
 * already treats `layerTarget: 'background'` and `layerTarget: 'speaker'`
 * (which is what drives virtualCam here) as mutually exclusive choices
 * (see useTimelineStore.js's `zoomToSpeaker`/`setLayerTarget`), so this
 * hasn't come up in practice. If it needs to, this component is where that
 * composition would be added.
 *
 * PERFORMANCE: getImageData/putImageData at full source resolution every
 * frame is real CPU work. `PROCESS_SCALE` renders the matte at a reduced
 * resolution (matching this project's existing waveform/proxy "good enough
 * for preview, exact at export" pattern — export's `renderBackgroundBlurSegment`
 * in jobs/exportProcessor.js runs the exact, full-resolution FFmpeg version)
 * and CSS-scales the result up to the container, which is visually
 * indistinguishable for a blurred background at typical preview sizes.
 */

import { useEffect, useRef } from 'react';

const PROCESS_SCALE = 0.5;   // render the matte at half resolution, upscale via CSS
const BLUR_PX = 14;          // CSS-canvas blur radius at PROCESS_SCALE resolution
const MASK_LUMA_THRESHOLD_SOFT = 24; // luma values below this are treated as fully background (avoids a grey halo from compression noise)

function frameLumaAlpha(maskImageData) {
    const { data } = maskImageData;
    const alpha = new Uint8ClampedArray(data.length / 4);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        // Standard luma weights. SAM2 "highlighted" masks are typically
        // near-white on near-black, so this is a clean, near-binary matte.
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        alpha[p] = luma < MASK_LUMA_THRESHOLD_SOFT ? 0 : luma;
    }
    return alpha;
}

/**
 * @param {object} clip - the active clip. Must have layerTarget==='background'
 *   and layerMask.maskAssetUrl for this component to render anything.
 * @param {string} sourceUrl - the clip's own video URL (same one the WebGL
 *   engine plays) — passed in rather than re-resolved here so this stays a
 *   dumb renderer, not another place that duplicates asset-URL resolution.
 * @param {number} currentTime - playhead position, TIMELINE seconds.
 * @param {boolean} isPlaying
 * @param {object} containerStyle - {transform, transformOrigin} copied from
 *   VideoPlayer's own <canvas> so this overlay stays pixel-aligned with it.
 */
export default function ObjectLayerOverlay({ clip, sourceUrl, currentTime, isPlaying, containerStyle }) {
    const canvasRef = useRef(null);
    const sourceVideoRef = useRef(null);
    const maskVideoRef = useRef(null);
    const rafRef = useRef(null);
    const readyRef = useRef({ source: false, mask: false });

    const active = !!(clip && clip.layerTarget === 'background' && clip.layerMask?.maskAssetUrl && sourceUrl);

    // Keep both hidden <video> elements' currentTime in sync with the
    // timeline playhead, mapped to clip-local SOURCE time exactly the way
    // every other clip-local time conversion in this app does it:
    // sourceTime = (timelineTime - clip.start) + clip.offset.
    useEffect(() => {
        if (!active) return;
        const localTime = Math.max(0, (currentTime - (clip.start || 0)) + (clip.offset || 0));
        [sourceVideoRef.current, maskVideoRef.current].forEach(v => {
            if (v && Math.abs(v.currentTime - localTime) > 0.05) {
                try { v.currentTime = localTime; } catch { /* video not ready yet — next tick will retry */ }
            }
        });
    }, [active, currentTime, clip?.start, clip?.offset]);

    useEffect(() => {
        if (!active) return;
        const s = sourceVideoRef.current, m = maskVideoRef.current;
        if (!s || !m) return;
        if (isPlaying) { s.play().catch(() => {}); m.play().catch(() => {}); }
        else { s.pause(); m.pause(); }
    }, [active, isPlaying]);

    // Draw loop — runs on rAF while playing, and once per seek while paused.
    useEffect(() => {
        if (!active) return;
        const canvas = canvasRef.current;
        const sourceVideo = sourceVideoRef.current;
        const maskVideo = maskVideoRef.current;
        if (!canvas || !sourceVideo || !maskVideo) return;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const maskCanvas = document.createElement('canvas');
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
        const fgCanvas = document.createElement('canvas');
        const fgCtx = fgCanvas.getContext('2d');

        function draw() {
            const vw = sourceVideo.videoWidth, vh = sourceVideo.videoHeight;
            if (!vw || !vh || sourceVideo.readyState < 2 || maskVideo.readyState < 2) {
                if (isPlaying) rafRef.current = requestAnimationFrame(draw);
                return;
            }
            const pw = Math.max(1, Math.round(vw * PROCESS_SCALE));
            const ph = Math.max(1, Math.round(vh * PROCESS_SCALE));
            if (canvas.width !== pw || canvas.height !== ph) {
                canvas.width = pw; canvas.height = ph;
                maskCanvas.width = pw; maskCanvas.height = ph;
                fgCanvas.width = pw; fgCanvas.height = ph;
            }

            // 1. Blurred background pass.
            ctx.filter = `blur(${BLUR_PX}px)`;
            ctx.drawImage(sourceVideo, 0, 0, pw, ph);
            ctx.filter = 'none';

            // 2. Sharp foreground, luma-matted by the SAM2 mask frame.
            maskCtx.drawImage(maskVideo, 0, 0, pw, ph);
            fgCtx.drawImage(sourceVideo, 0, 0, pw, ph);
            let maskData, fgData;
            try {
                maskData = maskCtx.getImageData(0, 0, pw, ph);
                fgData = fgCtx.getImageData(0, 0, pw, ph);
            } catch (err) {
                // A tainted-canvas SecurityError here means the mask/source URL
                // isn't CORS-cleared — fail open to just the blurred background
                // rather than throwing and breaking playback.
                if (isPlaying) rafRef.current = requestAnimationFrame(draw);
                return;
            }
            const alpha = frameLumaAlpha(maskData);
            for (let p = 0; p < alpha.length; p++) fgData.data[p * 4 + 3] = alpha[p];
            fgCtx.putImageData(fgData, 0, 0);

            // 3. Composite sharp-masked foreground over the blurred background.
            ctx.drawImage(fgCanvas, 0, 0);

            if (isPlaying) rafRef.current = requestAnimationFrame(draw);
        }

        draw();
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
        // Re-run on every currentTime change while paused (seeking); the rAF
        // loop above self-sustains while playing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, isPlaying, currentTime]);

    if (!active) return null;

    return (
        <>
            <video ref={sourceVideoRef} src={sourceUrl} muted playsInline preload="auto" style={{ display: 'none' }} crossOrigin="anonymous" />
            <video ref={maskVideoRef} src={clip.layerMask.maskAssetUrl} muted playsInline preload="auto" style={{ display: 'none' }} crossOrigin="anonymous" />
            <canvas
                ref={canvasRef}
                style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                    ...containerStyle,
                }}
            />
        </>
    );
}
