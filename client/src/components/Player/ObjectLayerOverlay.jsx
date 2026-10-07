/**
 * client/src/components/Player/ObjectLayerOverlay.jsx
 *
 * Preview of "remove / blur / replace the background" (R67, rebuilt in R92).
 *
 * Draws the active clip with its background changed, on a canvas laid exactly
 * over the player. It reads the SAME mask file and the SAME settings as the
 * export (client/src/motion/MatteSettings.js → jobs/exportProcessor.js
 * renderMattedSegment), so the preview matches the exported video:
 *   - blur / dim / colour / image background, at the same strengths;
 *   - the same luma ramp (threshold + softness) and feather on the mask edge;
 *   - the mask read at (source time - mask.sourceStart), clip speed included.
 *
 * R92 fixes over R67: the mask link is refreshed (signed links expired after
 * 24 h), trimmed clips stay in sync, a cross-origin error shows the plain
 * video instead of blurring the speaker too, and the per-pixel work runs on
 * the small mask only (about 320 px wide), not on the full frame.
 */
import React, { useEffect, useRef, useState } from 'react';
import { normalizeMatte, alphaRamp, lumaToAlpha, scaledPx, maskTimeFor } from '../../motion/MatteSettings.js';
import { freshMaskUrl } from '../../vision/MatteBaker.js';

/** Longest side of the preview canvas. Enough for a sharp preview, cheap to draw. */
const PREVIEW_MAX = 1280;

export default function ObjectLayerOverlay({ clip, sourceUrl, currentTime, isPlaying, containerStyle }) {
    const canvasRef = useRef(null);
    const sourceVideoRef = useRef(null);
    const maskVideoRef = useRef(null);
    const rafRef = useRef(null);
    const bgImageRef = useRef(null);
    const [maskUrl, setMaskUrl] = useState(null);
    const [failed, setFailed] = useState(false);

    const lm = clip?.layerMask;
    const wants = !!(clip && clip.layerTarget === 'background' && (lm?.maskAssetPath || lm?.maskAssetUrl) && sourceUrl);
    const active = wants && !!maskUrl && !failed;
    const settings = normalizeMatte(lm?.settings);
    const speed = Number(clip?.speed) > 0 ? Number(clip.speed) : 1;

    // A fresh link for the stored mask.
    useEffect(() => {
        let cancelled = false;
        setFailed(false);
        if (!wants) { setMaskUrl(null); return undefined; }
        freshMaskUrl(lm).then(url => { if (!cancelled) setMaskUrl(url); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wants, lm?.maskAssetPath, lm?.maskAssetUrl]);

    // Background image for mode "image".
    useEffect(() => {
        bgImageRef.current = null;
        if (settings.mode !== 'image' || !settings.imageUrl) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { bgImageRef.current = img; };
        img.src = settings.imageUrl;
    }, [settings.mode, settings.imageUrl]);

    // Keep both hidden videos on the playhead.
    useEffect(() => {
        if (!active) return;
        const sourceTime = Math.max(0, (Number(clip.offset) || 0) + (currentTime - (Number(clip.start) || 0)) * speed);
        const maskTime = maskTimeFor(clip, currentTime);
        const pairs = [[sourceVideoRef.current, sourceTime], [maskVideoRef.current, maskTime]];
        for (const [v, t] of pairs) {
            if (v && Math.abs(v.currentTime - t) > (isPlaying ? 0.25 : 0.04)) {
                try { v.currentTime = t; } catch { /* not ready yet; the next tick retries */ }
            }
        }
    }, [active, currentTime, clip?.start, clip?.offset, speed, isPlaying, clip]);

    useEffect(() => {
        if (!active) return;
        const s = sourceVideoRef.current, m = maskVideoRef.current;
        if (!s || !m) return;
        s.playbackRate = speed;
        m.playbackRate = speed;
        if (isPlaying) { s.play().catch(() => {}); m.play().catch(() => {}); }
        else { s.pause(); m.pause(); }
    }, [active, isPlaying, speed]);

    // Draw loop: rAF while playing, once per change while paused.
    useEffect(() => {
        if (!active) return undefined;
        const canvas = canvasRef.current;
        const src = sourceVideoRef.current;
        const mask = maskVideoRef.current;
        if (!canvas || !src || !mask) return undefined;

        const ctx = canvas.getContext('2d');
        const fg = document.createElement('canvas');
        const fgCtx = fg.getContext('2d');
        const small = document.createElement('canvas');
        const smallCtx = small.getContext('2d', { willReadFrequently: true });
        const ramp = alphaRamp(settings);
        const lut = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) lut[i] = lumaToAlpha(i, ramp);

        function draw() {
            const vw = src.videoWidth, vh = src.videoHeight;
            if (!vw || !vh || src.readyState < 2 || mask.readyState < 2) {
                if (isPlaying) rafRef.current = requestAnimationFrame(draw);
                return;
            }
            const k = Math.min(1, PREVIEW_MAX / Math.max(vw, vh));
            const cw = Math.round(vw * k), ch = Math.round(vh * k);
            if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; fg.width = cw; fg.height = ch; }
            const mw = mask.videoWidth || 320, mh = mask.videoHeight || 180;
            if (small.width !== mw || small.height !== mh) { small.width = mw; small.height = mh; }

            // 1. Mask → alpha, on the small mask only.
            let alpha;
            try {
                smallCtx.drawImage(mask, 0, 0, mw, mh);
                alpha = smallCtx.getImageData(0, 0, mw, mh);
            } catch (err) {
                // Cross-origin mask: show the plain video rather than a wrong picture.
                console.warn('[ObjectLayerOverlay] mask not readable, showing the plain video:', err.message);
                setFailed(true);
                return;
            }
            const d = alpha.data;
            for (let q = 0; q < d.length; q += 4) d[q + 3] = lut[d[q]];
            smallCtx.putImageData(alpha, 0, 0);

            // 2. Background.
            const blurPx = scaledPx(settings.blur, cw) / 2;
            ctx.save();
            ctx.filter = 'none';
            if (settings.mode === 'color') {
                ctx.fillStyle = settings.color;
                ctx.fillRect(0, 0, cw, ch);
            } else if (settings.mode === 'image' && bgImageRef.current) {
                const img = bgImageRef.current;
                const s = Math.max(cw / img.width, ch / img.height);
                ctx.drawImage(img, (cw - img.width * s) / 2, (ch - img.height * s) / 2, img.width * s, img.height * s);
            } else {
                const b = settings.mode === 'dim' ? blurPx / 2 : blurPx;
                if (b > 0.3) ctx.filter = `blur(${b.toFixed(1)}px)`;
                ctx.drawImage(src, 0, 0, cw, ch);
                ctx.filter = 'none';
                if (settings.mode === 'dim') {
                    ctx.fillStyle = `rgba(0,0,0,${settings.dim})`;
                    ctx.fillRect(0, 0, cw, ch);
                }
            }
            ctx.restore();

            // 3. Sharp person, cut by the (feathered) mask, over the background.
            fgCtx.save();
            fgCtx.globalCompositeOperation = 'source-over';
            fgCtx.clearRect(0, 0, cw, ch);
            fgCtx.drawImage(src, 0, 0, cw, ch);
            fgCtx.globalCompositeOperation = 'destination-in';
            const feather = scaledPx(settings.feather, cw) / 2;
            if (feather > 0.3) fgCtx.filter = `blur(${feather.toFixed(1)}px)`;
            fgCtx.imageSmoothingEnabled = true;
            fgCtx.drawImage(small, 0, 0, cw, ch);
            fgCtx.restore();
            ctx.drawImage(fg, 0, 0);

            if (isPlaying) rafRef.current = requestAnimationFrame(draw);
        }

        draw();
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
        // Re-runs on every playhead change while paused (seeking); the rAF loop
        // keeps itself going while playing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, isPlaying, currentTime, settings.mode, settings.blur, settings.feather, settings.threshold, settings.softness, settings.color, settings.dim]);

    if (!active) return null;

    return (
        <>
            <video ref={sourceVideoRef} src={sourceUrl} muted playsInline preload="auto" style={{ display: 'none' }} crossOrigin="anonymous" />
            <video ref={maskVideoRef} src={maskUrl} muted playsInline preload="auto" style={{ display: 'none' }} crossOrigin="anonymous" />
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
