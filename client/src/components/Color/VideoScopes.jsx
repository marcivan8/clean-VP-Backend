import React, { useRef, useEffect, useState, useCallback } from 'react';
import useTimelineStore from '../../store/useTimelineStore.js';
import { Eye, Activity, PieChart, BarChart3, Maximize2 } from 'lucide-react';

const MODES = [
    { key: 'waveform',    label: 'Waveform',    icon: Activity },
    { key: 'vectorscope', label: 'Vectorscope', icon: PieChart },
    { key: 'histogram',   label: 'Histogram',   icon: BarChart3 },
];

export default function VideoScopes({ className = '' }) {
    const [mode, setMode] = useState('waveform');
    const [waveformType, setWaveformType] = useState('luma'); // 'luma' | 'parade'
    const canvasRef = useRef(null);
    const playbackEngine = useTimelineStore(s => s.playbackEngine);
    const pixelDataRef = useRef(null);
    const animFrameRef = useRef(null);

    // Subscribe to PlaybackEngine scope listener
    useEffect(() => {
        if (!playbackEngine) return;

        const handlePixels = (buffer, width, height) => {
            pixelDataRef.current = { buffer, width, height };
        };

        playbackEngine.registerScopeListener?.(handlePixels);
        return () => {
            playbackEngine.unregisterScopeListener?.();
        };
    }, [playbackEngine]);

    // Draw routine
    const drawScope = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        // Clear canvas with dark oscilloscope background
        ctx.fillStyle = '#0a0d12';
        ctx.fillRect(0, 0, w, h);

        const data = pixelDataRef.current;

        if (mode === 'waveform') {
            drawWaveform(ctx, w, h, data, waveformType);
        } else if (mode === 'vectorscope') {
            drawVectorscope(ctx, w, h, data);
        } else if (mode === 'histogram') {
            drawHistogram(ctx, w, h, data);
        }
    }, [mode, waveformType]);

    // Animation loop for rendering scopes
    useEffect(() => {
        let active = true;
        let lastDraw = 0;

        const render = (time) => {
            if (!active) return;
            // Limit scope rendering to ~15fps to conserve CPU/GPU
            if (time - lastDraw >= 66) {
                drawScope();
                lastDraw = time;
            }
            animFrameRef.current = requestAnimationFrame(render);
        };

        animFrameRef.current = requestAnimationFrame(render);
        return () => {
            active = false;
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [drawScope]);

    return (
        <div className={`flex flex-col gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/5 ${className}`}>
            {/* Header / Mode Selector */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/5">
                    {MODES.map(m => {
                        const Icon = m.icon;
                        return (
                            <button
                                key={m.key}
                                type="button"
                                onClick={() => setMode(m.key)}
                                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-all flex items-center gap-1 ${
                                    mode === m.key
                                        ? 'bg-white/10 text-white shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <Icon size={11} />
                                {m.label}
                            </button>
                        );
                    })}
                </div>

                {mode === 'waveform' && (
                    <div className="flex items-center gap-1 text-[10px]">
                        <button
                            type="button"
                            onClick={() => setWaveformType('luma')}
                            className={`px-1.5 py-0.5 rounded ${waveformType === 'luma' ? 'bg-primary/20 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Luma
                        </button>
                        <span className="text-white/20">|</span>
                        <button
                            type="button"
                            onClick={() => setWaveformType('parade')}
                            className={`px-1.5 py-0.5 rounded ${waveformType === 'parade' ? 'bg-primary/20 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Parade
                        </button>
                    </div>
                )}
            </div>

            {/* Scope Canvas */}
            <div className="relative flex justify-center items-center w-full">
                <canvas
                    ref={canvasRef}
                    width={280}
                    height={150}
                    className="w-full h-[150px] rounded-lg border border-white/10 shadow-inner"
                />
            </div>
        </div>
    );
}

// ----------------------------------------------------
// SCOPE RENDERING IMPLEMENTATIONS
// ----------------------------------------------------

/**
 * Waveform (Luma or RGB Parade)
 */
function drawWaveform(ctx, w, h, data, waveformType) {
    // Graticule: 0 IRE, 25 IRE, 50 IRE, 75 IRE, 100 IRE
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    [0.1, 0.3, 0.5, 0.7, 0.9].forEach(relY => {
        const y = Math.round(h * relY) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
    });
    ctx.stroke();

    // IRE labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.font = '9px monospace';
    ctx.fillText('100 IRE', 4, Math.round(h * 0.1) + 3);
    ctx.fillText('50 IRE',  4, Math.round(h * 0.5) + 3);
    ctx.fillText('0 IRE',   4, Math.round(h * 0.9) + 3);

    if (!data || !data.buffer) {
        // Draw idle line
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
        ctx.beginPath();
        ctx.moveTo(0, h * 0.5);
        ctx.lineTo(w, h * 0.5);
        ctx.stroke();
        return;
    }

    const { buffer, width: srcW, height: srcH } = data;
    const padding = 20;
    const plotH = h - 2 * padding;

    if (waveformType === 'luma') {
        // Green phosphor trace
        ctx.fillStyle = 'rgba(34, 197, 94, 0.28)';
        for (let x = 0; x < srcW; x += 2) {
            const plotX = (x / srcW) * w;
            for (let y = 0; y < srcH; y += 2) {
                const idx = (y * srcW + x) * 4;
                const r = buffer[idx];
                const g = buffer[idx + 1];
                const b = buffer[idx + 2];
                // Rec.709 Luma
                const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                const plotY = padding + (1 - luma / 255) * plotH;
                ctx.fillRect(plotX, plotY, 1.2, 1.2);
            }
        }
    } else {
        // RGB Parade: Split into 3 columns (R, G, B)
        const colW = w / 3;
        const colors = [
            'rgba(239, 68, 68, 0.32)',   // Red
            'rgba(34, 197, 94, 0.32)',   // Green
            'rgba(59, 130, 246, 0.32)',  // Blue
        ];

        // Column dividers
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.beginPath();
        ctx.moveTo(colW, 0); ctx.lineTo(colW, h);
        ctx.moveTo(colW * 2, 0); ctx.lineTo(colW * 2, h);
        ctx.stroke();

        for (let ch = 0; ch < 3; ch++) {
            ctx.fillStyle = colors[ch];
            const colOffset = ch * colW;

            for (let x = 0; x < srcW; x += 3) {
                const plotX = colOffset + (x / srcW) * colW;
                for (let y = 0; y < srcH; y += 3) {
                    const idx = (y * srcW + x) * 4;
                    const val = buffer[idx + ch];
                    const plotY = padding + (1 - val / 255) * plotH;
                    ctx.fillRect(plotX, plotY, 1.2, 1.2);
                }
            }
        }
    }
}

/**
 * Vectorscope (Hue / Saturation Polar Plot)
 */
function drawVectorscope(ctx, w, h, data) {
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) - 10;

    // Graticule: Outer circle & 75% saturation target circle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
    ctx.arc(cx, cy, maxR * 0.75, 0, Math.PI * 2);
    ctx.stroke();

    // Center Crosshair
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
    ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
    ctx.stroke();

    // Skin Tone Reference Line (I-line, ~123 degrees)
    ctx.save();
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.4)'; // amber/orange
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const skinAngle = -123 * Math.PI / 180;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(skinAngle) * maxR, cy + Math.sin(skinAngle) * maxR);
    ctx.stroke();
    ctx.restore();

    // Color Targets at 75% Saturation: R, Y, G, C, B, M
    const targets = [
        { label: 'R', angle: -103, color: '#ef4444' },
        { label: 'M', angle: -56,  color: '#ec4899' },
        { label: 'B', angle: -338, color: '#3b82f6' },
        { label: 'C', angle: -283, color: '#06b6d4' },
        { label: 'G', angle: -236, color: '#22c55e' },
        { label: 'Y', angle: -158, color: '#eab308' },
    ];

    targets.forEach(t => {
        const rad = t.angle * Math.PI / 180;
        const tx = cx + Math.cos(rad) * (maxR * 0.75);
        const ty = cy + Math.sin(rad) * (maxR * 0.75);

        ctx.strokeStyle = t.color;
        ctx.strokeRect(tx - 3, ty - 3, 6, 6);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '8px monospace';
        ctx.fillText(t.label, tx + 4, ty + 3);
    });

    if (!data || !data.buffer) return;

    // Plot pixels in U/V color space
    const { buffer, width: srcW, height: srcH } = data;
    ctx.fillStyle = 'rgba(0, 229, 255, 0.25)'; // Cyan phosphor

    for (let x = 0; x < srcW; x += 2) {
        for (let y = 0; y < srcH; y += 2) {
            const idx = (y * srcW + x) * 4;
            const r = buffer[idx] / 255;
            const g = buffer[idx + 1] / 255;
            const b = buffer[idx + 2] / 255;

            // Rec.709 RGB to UV conversion
            const u = -0.09991 * r - 0.33609 * g + 0.436 * b;
            const v =  0.615   * r - 0.55861 * g - 0.05639 * b;

            // Map UV coordinates to vectorscope plane
            const px = cx + (u / 0.436) * (maxR * 0.75);
            const py = cy - (v / 0.615) * (maxR * 0.75);

            ctx.fillRect(px, py, 1.2, 1.2);
        }
    }
}

/**
 * RGB Histogram
 */
function drawHistogram(ctx, w, h, data) {
    // Grid lines (0, 64, 128, 192, 255)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    [0.25, 0.5, 0.75].forEach(relX => {
        const x = Math.round(w * relX) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
    });
    ctx.stroke();

    if (!data || !data.buffer) return;

    const { buffer, width: srcW, height: srcH } = data;
    const numPixels = srcW * srcH;
    const rBins = new Uint32Array(256);
    const gBins = new Uint32Array(256);
    const bBins = new Uint32Array(256);

    for (let i = 0; i < buffer.length; i += 4) {
        rBins[buffer[i]]++;
        gBins[buffer[i + 1]]++;
        bBins[buffer[i + 2]]++;
    }

    // Find peak frequency to normalize
    let maxBin = 1;
    for (let i = 0; i < 256; i++) {
        if (rBins[i] > maxBin) maxBin = rBins[i];
        if (gBins[i] > maxBin) maxBin = gBins[i];
        if (bBins[i] > maxBin) maxBin = bBins[i];
    }

    // Draw channels with soft translucent fills
    const channels = [
        { bins: rBins, color: 'rgba(239, 68, 68, 0.4)',  stroke: '#ef4444' },
        { bins: gBins, color: 'rgba(34, 197, 94, 0.4)',  stroke: '#22c55e' },
        { bins: bBins, color: 'rgba(59, 130, 246, 0.4)', stroke: '#3b82f6' },
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    channels.forEach(ch => {
        ctx.fillStyle = ch.color;
        ctx.strokeStyle = ch.stroke;
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(0, h);

        for (let i = 0; i < 256; i++) {
            const x = (i / 255) * w;
            const normHeight = Math.min(1, ch.bins[i] / (maxBin * 0.85));
            const y = h - normHeight * (h - 10);
            ctx.lineTo(x, y);
        }

        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    });

    ctx.restore();
}
