import React, { useRef, useEffect, useState } from 'react';

/**
 * Waveform — canvas-based peak renderer for timeline clips.
 *
 * Accepts two peak formats:
 *   New: peaks = [[minAmp, maxAmp], ...]   — min/max pairs, both in [-1, 1]
 *   Old: peaks = [scalar, ...]             — single amplitude value in [0, 1]
 *
 * The new format produces a symmetric waveform (bar extends both above and
 * below the centre line). The old scalar format is rendered as a symmetric
 * bar where top = +scalar and bottom = -scalar, so both formats look correct.
 *
 * Props:
 *   peaks       — array of [min,max] pairs or scalars
 *   duration    — total audio duration in seconds (used to map pixels → peaks)
 *   offset      — clip trim offset in seconds (start within the source audio)
 *   zoomLevel   — pixels per second on the timeline (drives horizontal scale)
 *   color       — fill colour (CSS string)
 */
const Waveform = ({ peaks, duration, offset = 0, zoomLevel, color = 'rgba(255,255,255,0.85)' }) => {
    const canvasRef = useRef(null);
    const [cssSize, setCssSize] = useState({ w: 0, h: 0 });

    // ── Measure the canvas element whenever it resizes ────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setCssSize({ w: width, h: height });
            }
        });
        ro.observe(canvas);
        return () => ro.disconnect();
    }, []);

    // ── Re-draw whenever anything changes ────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !peaks?.length || !duration || !zoomLevel || cssSize.w === 0) return;

        const dpr    = window.devicePixelRatio || 1;
        const width  = cssSize.w;
        const height = cssSize.h;

        // Resize the backing buffer to match the CSS display size * DPR
        canvas.width  = Math.round(width  * dpr);
        canvas.height = Math.round(height * dpr);

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const SCALE      = 0.88;       // leave a tiny margin at top/bottom
        const midY       = height / 2; // centre line in CSS pixels
        const peaksPerSec = peaks.length / duration;

        // Determine whether we have the new [min, max] format or old scalar format
        const isPairs = Array.isArray(peaks[0]);

        ctx.fillStyle = color;

        for (let x = 0; x < width; x++) {
            // Convert pixel position → source audio time
            const t          = offset + x / zoomLevel;
            const peakIndex  = Math.floor(t * peaksPerSec);
            if (peakIndex < 0 || peakIndex >= peaks.length) continue;

            let minAmp, maxAmp;
            if (isPairs) {
                // New format: [minAmp, maxAmp] where minAmp ≤ 0 ≤ maxAmp
                [minAmp, maxAmp] = peaks[peakIndex];
            } else {
                // Legacy scalar: treat as symmetric (bar mirrors above and below)
                const v = Math.abs(peaks[peakIndex]);
                minAmp = -v;
                maxAmp =  v;
            }

            // Map amplitude to canvas Y (CSS pixels):
            //   maxAmp > 0 → bar extends UP   from centre (smaller Y value)
            //   minAmp < 0 → bar extends DOWN from centre (larger  Y value)
            const topY    = midY - maxAmp * midY * SCALE;  // above centre
            const bottomY = midY - minAmp * midY * SCALE;  // below centre
            const barH    = Math.max(1, bottomY - topY);   // always ≥ 1px visible

            // Draw a 1 CSS-pixel wide bar (scaled by DPR for sharpness)
            ctx.fillRect(
                Math.round(x * dpr),
                Math.round(topY * dpr),
                Math.max(1, dpr),
                Math.round(barH * dpr),
            );
        }
    }, [peaks, duration, offset, zoomLevel, color, cssSize]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full block"
            style={{ imageRendering: 'pixelated' }}
        />
    );
};

export default Waveform;
