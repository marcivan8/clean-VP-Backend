import React, { useRef, useEffect, useState } from 'react';

/**
 * Waveform — professional filled-polygon waveform renderer.
 *
 * Uses the same technique as Premiere / Descript / Logic:
 *   - One pass traces the top contour (maxAmp) left → right
 *   - A second pass traces the bottom contour (minAmp) right → left
 *   - The closed path is filled in a single draw call — no per-pixel loops
 *
 * Peak formats supported:
 *   New: peaks = [[minAmp, maxAmp], …]   (values in [-1, 1])
 *   Old: peaks = [scalar, …]             (values in [0, 1], rendered symmetric)
 *
 * Props:
 *   peaks        — waveform data (see above)
 *   duration     — total source audio duration in seconds
 *   offset       — trim offset in seconds (clip.offset)
 *   zoomLevel    — px/s timeline zoom
 *   waveColor    — waveform fill colour
 *   bgColor      — canvas background (drawn before the waveform)
 *   centerLine   — whether to draw a subtle centre-line (default true)
 */
const Waveform = ({
    peaks,
    duration,
    offset = 0,
    zoomLevel,
    waveColor  = 'rgba(74, 222, 128, 0.75)',  // emerald-400 — overridden per clip type
    bgColor    = 'rgba(0, 0, 0, 0.42)',
    centerLine = true,
    // Legacy prop name kept for backwards compatibility
    color,
}) => {
    const canvasRef = useRef(null);
    const [cssSize, setCssSize] = useState({ w: 0, h: 0 });

    // Accept either `waveColor` or the old `color` prop
    const fillColor = color ?? waveColor;

    // ── Observe canvas size ───────────────────────────────────────────────────
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

    // ── Draw ─────────────────────────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !peaks?.length || !duration || !zoomLevel || cssSize.w === 0) return;

        const dpr    = window.devicePixelRatio || 1;
        const W      = cssSize.w;
        const H      = cssSize.h;

        canvas.width  = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);

        const ctx  = canvas.getContext('2d');
        const midY = H / 2;
        const SCALE = 0.90; // leave ~5% margin top and bottom

        const isPairs      = Array.isArray(peaks[0]);
        const peaksPerSec  = peaks.length / duration;

        // Helper: get [minAmp, maxAmp] for a given pixel column
        const getAmps = (x) => {
            const t   = offset + x / zoomLevel;
            const idx = Math.floor(t * peaksPerSec);
            if (idx < 0 || idx >= peaks.length) return null;
            if (isPairs) return peaks[idx];
            const v = Math.abs(peaks[idx]);
            return [-v, v];
        };

        // ── 1. Background ────────────────────────────────────────────────────
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // ── 2. Waveform polygon ──────────────────────────────────────────────
        // Build a closed path:
        //   left-edge anchor → top contour L→R → right-edge anchor
        //   → bottom contour R→L → close
        ctx.beginPath();

        let pathStarted = false;

        // Top contour: left → right
        for (let x = 0; x < W; x++) {
            const amps = getAmps(x);
            if (!amps) continue;
            const [, maxAmp] = amps;
            const y = (midY - maxAmp * midY * SCALE) * dpr;
            if (!pathStarted) {
                ctx.moveTo(x * dpr, y);
                pathStarted = true;
            } else {
                ctx.lineTo(x * dpr, y);
            }
        }

        if (!pathStarted) return; // no visible peaks in this viewport

        // Bottom contour: right → left
        for (let x = W - 1; x >= 0; x--) {
            const amps = getAmps(x);
            if (!amps) continue;
            const [minAmp] = amps;
            const y = (midY - minAmp * midY * SCALE) * dpr;
            ctx.lineTo(x * dpr, y);
        }

        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        // ── 3. Subtle inner highlight (lighter edge along the top contour) ───
        // Draws a 1px line along the top of the waveform so peaks have a crisp edge
        ctx.beginPath();
        pathStarted = false;
        for (let x = 0; x < W; x++) {
            const amps = getAmps(x);
            if (!amps) continue;
            const [, maxAmp] = amps;
            const y = (midY - maxAmp * midY * SCALE) * dpr;
            if (!pathStarted) { ctx.moveTo(x * dpr, y); pathStarted = true; }
            else ctx.lineTo(x * dpr, y);
        }
        // Mirror for bottom edge
        for (let x = W - 1; x >= 0; x--) {
            const amps = getAmps(x);
            if (!amps) continue;
            const [minAmp] = amps;
            const y = (midY - minAmp * midY * SCALE) * dpr;
            ctx.lineTo(x * dpr, y);
        }
        ctx.strokeStyle = fillColor.replace(/[\d.]+\)$/, '0.4)'); // 40% opacity edge
        ctx.lineWidth   = dpr;
        ctx.stroke();

        // ── 4. Centre line ────────────────────────────────────────────────────
        if (centerLine) {
            ctx.beginPath();
            ctx.moveTo(0, midY * dpr);
            ctx.lineTo(canvas.width, midY * dpr);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth   = dpr;
            ctx.stroke();
        }

    }, [peaks, duration, offset, zoomLevel, fillColor, bgColor, centerLine, cssSize]);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full block"
        />
    );
};

export default Waveform;
