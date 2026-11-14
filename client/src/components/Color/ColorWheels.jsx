import React, { useRef, useState, useCallback, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

const WHEEL_RADIUS = 46;

function polarToRgb(x, y, maxR) {
    const dist = Math.hypot(x, y);
    if (dist < 1e-4) return [0, 0, 0];
    const normDist = Math.min(1, dist / maxR);
    const angle = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

    // Convert polar angle & dist to RGB balance offsets
    const rad = angle * Math.PI / 180;
    const r = Math.cos(rad) * normDist;
    const g = Math.cos(rad - 2 * Math.PI / 3) * normDist;
    const b = Math.cos(rad - 4 * Math.PI / 3) * normDist;
    return [r, g, b];
}

const SingleWheel = ({ label, sublabel, x = 0, y = 0, level = 0, onChange, onReset }) => {
    const containerRef = useRef(null);
    const [dragging, setDragging] = useState(false);

    const handlePointerDown = (e) => {
        setDragging(true);
        updateFromEvent(e);
    };

    const updateFromEvent = useCallback((e) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = e.clientX - cx;
        let dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > WHEEL_RADIUS) {
            dx = (dx / dist) * WHEEL_RADIUS;
            dy = (dy / dist) * WHEEL_RADIUS;
        }
        onChange?.({ x: Math.round(dx), y: Math.round(dy), level });
    }, [level, onChange]);

    useEffect(() => {
        if (!dragging) return;
        const handlePointerMove = (e) => updateFromEvent(e);
        const handlePointerUp = () => setDragging(false);

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [dragging, updateFromEvent]);

    const isNonDefault = x !== 0 || y !== 0 || level !== 0;

    return (
        <div className="flex flex-col items-center p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
            {/* Header */}
            <div className="flex items-center justify-between w-full mb-2 px-1">
                <div className="text-left">
                    <div className="text-xs font-semibold text-foreground tracking-wide">{label}</div>
                    <div className="text-[9px] text-muted-foreground">{sublabel}</div>
                </div>
                {isNonDefault && (
                    <button
                        type="button"
                        onClick={onReset}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                        title="Reset wheel"
                    >
                        <RotateCcw size={11} />
                    </button>
                )}
            </div>

            {/* Circular Color Wheel */}
            <div
                ref={containerRef}
                onPointerDown={handlePointerDown}
                onDoubleClick={onReset}
                className="relative cursor-crosshair select-none my-1"
                style={{ width: WHEEL_RADIUS * 2, height: WHEEL_RADIUS * 2 }}
                title="Drag puck to tint, double-click to center"
            >
                {/* Wheel gradient background */}
                <div
                    className="absolute inset-0 rounded-full border border-white/20 shadow-inner"
                    style={{
                        background: 'radial-gradient(circle, #555 0%, transparent 80%), conic-gradient(from 90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
                        opacity: 0.85
                    }}
                />
                <div className="absolute inset-0 rounded-full bg-black/40 pointer-events-none" />

                {/* Crosshairs */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20 pointer-events-none" />
                <div className="absolute top-1/2 left-0 right-0 h-px bg-white/20 pointer-events-none" />
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-white/20 pointer-events-none" />

                {/* Draggable Puck */}
                <div
                    className="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full border-2 border-white shadow-md pointer-events-none transition-transform"
                    style={{
                        left: `${WHEEL_RADIUS + x}px`,
                        top: `${WHEEL_RADIUS + y}px`,
                        background: isNonDefault ? 'var(--primary, #00e5ff)' : 'rgba(255,255,255,0.7)',
                        boxShadow: '0 0 6px rgba(0,0,0,0.8)'
                    }}
                />
            </div>

            {/* Master Level Slider */}
            <div className="w-full mt-3 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                    <span>Master</span>
                    <span>{level > 0 ? `+${level}` : level}</span>
                </div>
                <input
                    type="range"
                    min={-100}
                    max={100}
                    value={level}
                    onChange={(e) => onChange?.({ x, y, level: Number(e.target.value) })}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
                />
            </div>
        </div>
    );
};

export default function ColorWheels({ wheels = {}, onChange }) {
    const lift = wheels.lift || { x: 0, y: 0, level: 0 };
    const gamma = wheels.gamma || { x: 0, y: 0, level: 0 };
    const gain = wheels.gain || { x: 0, y: 0, level: 0 };
    const offset = wheels.offset || { x: 0, y: 0, level: 0 };

    const handleWheelChange = (wheelKey, val) => {
        onChange?.({
            ...wheels,
            [wheelKey]: val
        });
    };

    const handleWheelReset = (wheelKey) => {
        onChange?.({
            ...wheels,
            [wheelKey]: { x: 0, y: 0, level: 0 }
        });
    };

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
                <SingleWheel
                    label="Lift"
                    sublabel="Shadows"
                    x={lift.x}
                    y={lift.y}
                    level={lift.level}
                    onChange={(val) => handleWheelChange('lift', val)}
                    onReset={() => handleWheelReset('lift')}
                />
                <SingleWheel
                    label="Gamma"
                    sublabel="Midtones"
                    x={gamma.x}
                    y={gamma.y}
                    level={gamma.level}
                    onChange={(val) => handleWheelChange('gamma', val)}
                    onReset={() => handleWheelReset('gamma')}
                />
                <SingleWheel
                    label="Gain"
                    sublabel="Highlights"
                    x={gain.x}
                    y={gain.y}
                    level={gain.level}
                    onChange={(val) => handleWheelChange('gain', val)}
                    onReset={() => handleWheelReset('gain')}
                />
                <SingleWheel
                    label="Offset"
                    sublabel="Global"
                    x={offset.x}
                    y={offset.y}
                    level={offset.level}
                    onChange={(val) => handleWheelChange('offset', val)}
                    onReset={() => handleWheelReset('offset')}
                />
            </div>
        </div>
    );
}
export { polarToRgb };
