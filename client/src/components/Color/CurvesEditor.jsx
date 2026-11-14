import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';

const CHANNELS = [
    { key: 'master', label: 'Master', color: '#ffffff', stroke: '#e2e8f0', gradient: 'from-white/10 to-transparent' },
    { key: 'red',    label: 'Red',    color: '#ef4444', stroke: '#f87171', gradient: 'from-red-500/10 to-transparent' },
    { key: 'green',  label: 'Green',  color: '#22c55e', stroke: '#4ade80', gradient: 'from-green-500/10 to-transparent' },
    { key: 'blue',   label: 'Blue',   color: '#3b82f6', stroke: '#60a5fa', gradient: 'from-blue-500/10 to-transparent' },
];

const DEFAULT_CURVE = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
];

/**
 * Natural / Monotone cubic spline interpolation for smooth grading curves.
 */
function evaluateSpline(points, numSamples = 100) {
    if (!points || points.length === 0) return [];
    if (points.length === 1) return [{ x: 0, y: points[0].y }, { x: 1, y: points[0].y }];

    // Sort points by x coordinate
    const sorted = [...points].sort((a, b) => a.x - b.x);
    const n = sorted.length;

    // Slopes
    const dx = [];
    const dy = [];
    const m = [];
    for (let i = 0; i < n - 1; i++) {
        const dxi = sorted[i + 1].x - sorted[i].x;
        const dyi = sorted[i + 1].y - sorted[i].y;
        dx.push(dxi);
        dy.push(dyi);
        m.push(dxi === 0 ? 0 : dyi / dxi);
    }

    // Monotone tangents
    const tangents = new Array(n).fill(0);
    tangents[0] = m[0] || 0;
    tangents[n - 1] = m[n - 2] || 0;
    for (let i = 1; i < n - 1; i++) {
        if (m[i - 1] * m[i] <= 0) {
            tangents[i] = 0;
        } else {
            tangents[i] = (m[i - 1] + m[i]) / 2;
        }
    }

    // Generate sampled points
    const samples = [];
    for (let i = 0; i <= numSamples; i++) {
        const t = i / numSamples;
        // Find segment
        let seg = 0;
        while (seg < n - 2 && sorted[seg + 1].x < t) seg++;

        const p0 = sorted[seg];
        const p1 = sorted[seg + 1];
        const h = p1.x - p0.x;
        if (h <= 0) {
            samples.push({ x: t, y: Math.max(0, Math.min(1, p0.y)) });
            continue;
        }

        const s = (t - p0.x) / h;
        const s2 = s * s;
        const s3 = s2 * s;

        // Hermite basis functions
        const h00 = 2 * s3 - 3 * s2 + 1;
        const h10 = s3 - 2 * s2 + s;
        const h01 = -2 * s3 + 3 * s2;
        const h11 = s3 - s2;

        const y = h00 * p0.y + h10 * h * tangents[seg] + h01 * p1.y + h11 * h * tangents[seg + 1];
        samples.push({ x: t, y: Math.max(0, Math.min(1, y)) });
    }

    return samples;
}

export default function CurvesEditor({ curves = {}, onChange, histogramData = null }) {
    const [activeChannel, setActiveChannel] = useState('master');
    const [selectedPointIndex, setSelectedPointIndex] = useState(null);
    const [draggingIndex, setDraggingIndex] = useState(null);
    const svgRef = useRef(null);

    const activePoints = curves[activeChannel] || DEFAULT_CURVE;
    const currentChannelSpec = CHANNELS.find(c => c.key === activeChannel) || CHANNELS[0];

    // Compute smoothed curve samples for SVG path
    const splineSamples = useMemo(() => {
        return evaluateSpline(activePoints, 80);
    }, [activePoints]);

    // Build SVG path
    const pathD = useMemo(() => {
        if (!splineSamples || splineSamples.length === 0) return '';
        return splineSamples.reduce((acc, pt, idx) => {
            // Y is inverted in SVG coordinate space (0 is top, 1 is bottom)
            const sx = (pt.x * 200).toFixed(1);
            const sy = ((1 - pt.y) * 200).toFixed(1);
            return idx === 0 ? `M ${sx} ${sy}` : `${acc} L ${sx} ${sy}`;
        }, '');
    }, [splineSamples]);

    // Handle pointer down on point
    const handlePointDown = (idx, e) => {
        e.stopPropagation();
        setSelectedPointIndex(idx);
        setDraggingIndex(idx);
    };

    // Handle click on canvas background to add point
    const handleSvgClick = (e) => {
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const normY = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));

        // Don't add too close to existing points
        const tooClose = activePoints.some(p => Math.abs(p.x - normX) < 0.04);
        if (tooClose) return;

        const newPoints = [...activePoints, { x: Number(normX.toFixed(3)), y: Number(normY.toFixed(3)) }];
        newPoints.sort((a, b) => a.x - b.x);
        const newIndex = newPoints.findIndex(p => Math.abs(p.x - normX) < 0.01);

        setSelectedPointIndex(newIndex);
        onChange?.({
            ...curves,
            [activeChannel]: newPoints
        });
    };

    // Pointer move / up for dragging
    useEffect(() => {
        if (draggingIndex === null) return;

        const handlePointerMove = (e) => {
            if (!svgRef.current) return;
            const rect = svgRef.current.getBoundingClientRect();
            let normX = (e.clientX - rect.left) / rect.width;
            let normY = 1 - (e.clientY - rect.top) / rect.height;

            normX = Math.max(0, Math.min(1, normX));
            normY = Math.max(0, Math.min(1, normY));

            const newPoints = [...activePoints];
            // Endpoints cannot move horizontally past their borders
            if (draggingIndex === 0) {
                newPoints[0] = { x: 0, y: Number(normY.toFixed(3)) };
            } else if (draggingIndex === activePoints.length - 1) {
                newPoints[activePoints.length - 1] = { x: 1, y: Number(normY.toFixed(3)) };
            } else {
                // Intermediate point: bound between neighbor X coordinates
                const prevX = newPoints[draggingIndex - 1]?.x ?? 0;
                const nextX = newPoints[draggingIndex + 1]?.x ?? 1;
                normX = Math.max(prevX + 0.02, Math.min(nextX - 0.02, normX));
                newPoints[draggingIndex] = { x: Number(normX.toFixed(3)), y: Number(normY.toFixed(3)) };
            }

            onChange?.({
                ...curves,
                [activeChannel]: newPoints
            });
        };

        const handlePointerUp = () => {
            setDraggingIndex(null);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [draggingIndex, activePoints, activeChannel, curves, onChange]);

    // Delete selected point
    const handleDeletePoint = () => {
        if (selectedPointIndex === null) return;
        // Cannot delete endpoints
        if (selectedPointIndex === 0 || selectedPointIndex === activePoints.length - 1) return;

        const newPoints = activePoints.filter((_, idx) => idx !== selectedPointIndex);
        setSelectedPointIndex(null);
        onChange?.({
            ...curves,
            [activeChannel]: newPoints
        });
    };

    // Reset current channel
    const handleResetCurrent = () => {
        setSelectedPointIndex(null);
        onChange?.({
            ...curves,
            [activeChannel]: DEFAULT_CURVE
        });
    };

    // Reset all channels
    const handleResetAll = () => {
        setSelectedPointIndex(null);
        onChange?.({
            master: DEFAULT_CURVE,
            red: DEFAULT_CURVE,
            green: DEFAULT_CURVE,
            blue: DEFAULT_CURVE
        });
    };

    const isCurrentChannelModified = activePoints.length > 2 ||
        activePoints[0].y !== 0 ||
        activePoints[activePoints.length - 1].y !== 1;

    const selectedPoint = selectedPointIndex !== null ? activePoints[selectedPointIndex] : null;

    return (
        <div className="flex flex-col gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
            {/* Header: Channel Tabs & Reset */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/5">
                    {CHANNELS.map(ch => (
                        <button
                            key={ch.key}
                            type="button"
                            onClick={() => {
                                setActiveChannel(ch.key);
                                setSelectedPointIndex(null);
                            }}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                                activeChannel === ch.key
                                    ? 'bg-white/10 text-white shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <span
                                className="w-2 h-2 rounded-full inline-block"
                                style={{ backgroundColor: ch.color }}
                            />
                            {ch.label}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-1">
                    {isCurrentChannelModified && (
                        <button
                            type="button"
                            onClick={handleResetCurrent}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                            title="Reset channel curve"
                        >
                            <RotateCcw size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Interactive SVG Curve Grid */}
            <div className="relative flex justify-center items-center select-none">
                <svg
                    ref={svgRef}
                    viewBox="0 0 200 200"
                    className="w-full max-w-[240px] aspect-square rounded-lg bg-black/60 border border-white/10 cursor-crosshair overflow-visible shadow-inner"
                    onClick={handleSvgClick}
                >
                    {/* Grid Lines (25%, 50%, 75%) */}
                    <line x1="50" y1="0" x2="50" y2="200" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 2" />
                    <line x1="100" y1="0" x2="100" y2="200" stroke="rgba(255,255,255,0.15)" />
                    <line x1="150" y1="0" x2="150" y2="200" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 2" />

                    <line x1="0" y1="50" x2="200" y2="50" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 2" />
                    <line x1="0" y1="100" x2="200" y2="100" stroke="rgba(255,255,255,0.15)" />
                    <line x1="0" y1="150" x2="200" y2="150" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 2" />

                    {/* Diagonal Identity Reference */}
                    <line x1="0" y1="200" x2="200" y2="0" stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />

                    {/* Smooth Spline Curve */}
                    {pathD && (
                        <path
                            d={pathD}
                            fill="none"
                            stroke={currentChannelSpec.stroke}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            className="transition-all duration-75"
                        />
                    )}

                    {/* Interactive Control Points */}
                    {activePoints.map((pt, idx) => {
                        const cx = pt.x * 200;
                        const cy = (1 - pt.y) * 200;
                        const isSelected = selectedPointIndex === idx;

                        return (
                            <g key={idx} className="cursor-pointer">
                                <circle
                                    cx={cx}
                                    cy={cy}
                                    r={isSelected ? 6 : 4.5}
                                    fill={isSelected ? '#00e5ff' : currentChannelSpec.color}
                                    stroke="#000000"
                                    strokeWidth="1.5"
                                    onPointerDown={(e) => handlePointDown(idx, e)}
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        if (idx > 0 && idx < activePoints.length - 1) {
                                            const newPts = activePoints.filter((_, i) => i !== idx);
                                            setSelectedPointIndex(null);
                                            onChange?.({ ...curves, [activeChannel]: newPts });
                                        }
                                    }}
                                />
                            </g>
                        );
                    })}
                </svg>
            </div>

            {/* Point Coordinate Readout & Actions */}
            <div className="flex items-center justify-between text-[11px] px-1 text-muted-foreground font-mono">
                {selectedPoint ? (
                    <div className="flex items-center gap-3">
                        <span>In: <strong className="text-foreground">{Math.round(selectedPoint.x * 255)}</strong> ({Math.round(selectedPoint.x * 100)}%)</span>
                        <span>Out: <strong className="text-foreground">{Math.round(selectedPoint.y * 255)}</strong> ({Math.round(selectedPoint.y * 100)}%)</span>
                        {selectedPointIndex > 0 && selectedPointIndex < activePoints.length - 1 && (
                            <button
                                type="button"
                                onClick={handleDeletePoint}
                                className="text-red-400 hover:text-red-300 p-0.5 ml-1 transition-colors"
                                title="Remove point"
                            >
                                <Trash2 size={12} />
                            </button>
                        )}
                    </div>
                ) : (
                    <span>Click curve to add point</span>
                )}

                <button
                    type="button"
                    onClick={handleResetAll}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                    Reset All
                </button>
            </div>
        </div>
    );
}
