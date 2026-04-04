import React, { useRef, useEffect, useState } from 'react';

const Waveform = ({ peaks, duration, offset, zoomLevel, height = 40, color = '#ffffff' }) => {
    const canvasRef = useRef(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas || !peaks) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        // Dimensions from state 
        const { width: cssWidth, height: cssHeight } = dimensions;
        if (cssWidth === 0) return;

        // Ensure canvas buffer matches visual size * DPR
        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;

        // Logical dimensions for drawing
        const width = canvas.width / dpr;
        const h = canvas.height / dpr;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = color;
        ctx.beginPath();

        // Waveform Logic
        const peaksPerSec = peaks.length / duration;

        // We draw pixels from x=0 to width.
        // pixel 0 corresponds to time = offset.
        // pixel W corresponds to time = offset + (width / zoomLevel).

        const startSec = offset;

        // Optimization: Step > 1 if density is too high?
        // 1px step is fine.

        for (let x = 0; x < width; x++) {
            // Map pixel x to Time relative to Offset
            const time = startSec + (x / zoomLevel);

            // Map Time to Peak Index
            const peakIndex = Math.floor(time * peaksPerSec);

            if (peakIndex >= 0 && peakIndex < peaks.length) {
                const val = peaks[peakIndex];

                // Draw 1px bar.
                // Scale height: 0.9 to leave some margin
                const barHeight = val * h * 0.9;
                const y = (h - barHeight) / 2;

                // Draw rect at x*dpr, y*dpr, 1*dpr wide, height*dpr tall
                ctx.fillRect(x * dpr, y * dpr, 1 * dpr, barHeight * dpr);
            }
        }
    };

    // Draw when dependencies change or dimensions update
    useEffect(() => {
        draw();
    }, [peaks, duration, offset, zoomLevel, height, color, dimensions]);

    // Handle Resize
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setDimensions({ width, height });
            }
        });

        resizeObserver.observe(canvas);
        return () => resizeObserver.disconnect();
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="w-full h-full block opacity-70 canvas-waveform"
            style={{ width: '100%', height: '100%' }}
        />
    );
};

export default Waveform;
