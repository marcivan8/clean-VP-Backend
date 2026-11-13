/**
 * KeyframeEditor.jsx
 * Visual keyframe timeline & Bézier Graph Editor for animating effect & motion parameters.
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { sampleKeyframeTrack } from '../../motion/MotionResolver.js';
import { resolveEasing, cubicBezier, clamp } from '../../motion/Easing.js';
import {
    Key,
    Plus,
    Trash2,
    ChevronDown,
    ChevronRight,
    Diamond,
    Circle,
    SlidersHorizontal,
    Activity
} from 'lucide-react';

// Easing curves
export const EASING_OPTIONS = [
    { value: 'linear', labelKey: 'effects.easingLinear', path: 'M0,1 L1,0' },
    { value: 'ease-in', labelKey: 'effects.easingEaseIn', path: 'M0,1 C0.42,1 1,0 1,0' },
    { value: 'ease-out', labelKey: 'effects.easingEaseOut', path: 'M0,1 C0,1 0.58,0 1,0' },
    { value: 'ease-in-out', labelKey: 'effects.easingEaseInOut', path: 'M0,1 C0.42,1 0.58,0 1,0' },
    { value: 'step-start', labelKey: 'effects.easingStepStart', path: 'M0,0.5 H0.5 V0 H1' },
    { value: 'step-end', labelKey: 'effects.easingStepEnd', path: 'M0,1 H0.5 V0.5 H1 V0' },
    { value: 'hold', labelKey: 'effects.easingHold', path: 'M0,1 H1 V0' },
    { value: '__custom_steps__', labelKey: 'effects.easingCustomSteps', path: 'M0,1 H0.25 V0.75 H0.5 V0.5 H0.75 V0.25 H1 V0' },
    { value: 'bounce', labelKey: 'effects.easingBounce', path: 'M0,1 C0.33,1 0.66,0.5 0.7,0 S1,0 1,0' },
    // R92: real springs and expo curves (motion/Easing.js)
    { value: 'spring', labelKey: 'effects.easingSpring', path: 'M0,1 C0.2,0 0.5,-0.08 1,0' },
    { value: 'springWobbly', labelKey: 'effects.easingSpringWobbly', path: 'M0,1 C0.2,-0.3 0.4,0.15 0.6,-0.05 S1,0 1,0' },
    { value: 'springSnappy', labelKey: 'effects.easingSpringSnappy', path: 'M0,1 C0.1,0 0.3,-0.04 1,0' },
    { value: 'easeOutExpo', labelKey: 'effects.easingExpoOut', path: 'M0,1 C0.16,1 0.3,0 1,0' },
    { value: 'backOut', labelKey: 'effects.easingBackOut', path: 'M0,1 C0.34,-0.4 0.64,0 1,0' },
    { value: '__custom_bezier__', labelKey: 'effects.easingCustomBezier', path: 'M0,1 C0.25,1 0.25,0 1,0' }
];

export const GRAPH_CURVE_PRESETS = [
    { id: 'linear', label: 'Linear', easing: 'linear', bezier: [0.33, 0.33, 0.67, 0.67] },
    { id: 'ease-out', label: 'Expo Out', easing: 'cubic-bezier(0.16, 1, 0.3, 1)', bezier: [0.16, 1, 0.3, 1] },
    { id: 'ease-in-out', label: 'Smooth Ease', easing: 'cubic-bezier(0.42, 0, 0.2, 1)', bezier: [0.42, 0, 0.2, 1] },
    { id: 'snap-back', label: 'Anticipate', easing: 'cubic-bezier(0.34, 1.45, 0.64, 1)', bezier: [0.34, 1.45, 0.64, 1] },
    { id: 'spring-snappy', label: 'Snappy Spring', easing: 'spring(300, 18, 1)' },
    { id: 'spring-bouncy', label: 'Elastic Spring', easing: 'spring(220, 11, 1)' },
    { id: 'quad-inout', label: 'Quart InOut', easing: 'cubic-bezier(0.76, 0, 0.24, 1)', bezier: [0.76, 0, 0.24, 1] },
    { id: 'hold', label: 'Hold Frame', easing: 'hold' },
];

export const DEFAULT_BEZIER = [0.25, 0.1, 0.25, 1];
export const BEZIER_CONTROL_NAMES = ['X1', 'Y1', 'X2', 'Y2'];

export const readBezierControls = (easing) => {
    const match = /^\s*cubic-bezier\(([^)]+)\)\s*$/i.exec(String(easing || ''));
    const values = match?.[1].split(',').map(value => Number(value.trim()));
    return values?.length === 4 && values.every(Number.isFinite) ? values : [...DEFAULT_BEZIER];
};

export const encodeBezierControls = (values) => `cubic-bezier(${values.map(value => Number(value.toFixed(3))).join(', ')})`;

const DEFAULT_STEPS = { count: 4, position: 'jump-end' };
const readStepControls = easing => {
    const match = /^\s*steps\(\s*(\d+)\s*(?:,\s*(start|end|jump-start|jump-end|jump-none|jump-both)\s*)?\)\s*$/i.exec(String(easing || ''));
    const count = Number(match?.[1]);
    if (!Number.isSafeInteger(count) || count < 1) return { ...DEFAULT_STEPS };
    const rawPosition = String(match?.[2] || 'end').toLowerCase();
    const position = rawPosition === 'start' ? 'jump-start' : rawPosition === 'end' ? 'jump-end' : rawPosition;
    if (position === 'jump-none' && count < 2) return { ...DEFAULT_STEPS };
    return { count, position };
};
const encodeStepControls = ({ count, position }) => `steps(${count}, ${position})`;

/**
 * Single keyframe diamond marker
 */
const KeyframeDiamond = ({
    keyframe,
    paramName,
    timelineWidth,
    duration,
    isSelected,
    onSelect,
    onDrag,
    onDoubleClick
}) => {
    const [isDragging, setIsDragging] = useState(false);
    const position = (keyframe.time / duration) * timelineWidth;

    const handleMouseDown = useCallback((e) => {
        e.stopPropagation();
        setIsDragging(true);
        onSelect(keyframe.time, paramName);

        const startX = e.clientX;
        const startTime = keyframe.time;

        const handleMouseMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaTime = (deltaX / timelineWidth) * duration;
            const newTime = Math.max(0, Math.min(duration, startTime + deltaTime));
            onDrag(paramName, keyframe.time, newTime);
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [keyframe.time, paramName, timelineWidth, duration, onSelect, onDrag]);

    return (
        <div
            className={`
                absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer
                transition-transform hover:scale-125
                ${isDragging ? 'scale-125 z-10' : ''}
            `}
            style={{ left: position }}
            onMouseDown={handleMouseDown}
            onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(keyframe, paramName); }}
        >
            <Diamond
                className={`
                    w-3 h-3 transition-colors
                    ${isSelected ? 'text-yellow-400 fill-yellow-400' : 'text-primary fill-primary'}
                `}
            />
        </div>
    );
};

/**
 * Parameter row with keyframe track
 */
const KeyframeTrack = ({
    paramName,
    paramDef,
    keyframes = [],
    effect,
    duration,
    playhead,
    onAddKeyframe,
    onUpdateKeyframe,
    onRemoveKeyframe,
    selectedKeyframe,
    onSelectKeyframe,
    onOpenGraph
}) => {
    const { t } = useTranslation('editor');
    const [isExpanded, setIsExpanded] = useState(false);
    const [bezierControls, setBezierControls] = useState(DEFAULT_BEZIER);
    const [bezierDraft, setBezierDraft] = useState(DEFAULT_BEZIER.map(String));
    const [stepControls, setStepControls] = useState(DEFAULT_STEPS);
    const [stepCountDraft, setStepCountDraft] = useState(String(DEFAULT_STEPS.count));
    const trackRef = useRef(null);
    const [trackWidth, setTrackWidth] = useState(0);

    useEffect(() => {
        if (trackRef.current) {
            setTrackWidth(trackRef.current.offsetWidth);
        }
    }, []);

    const handleTrackClick = (e) => {
        if (!trackRef.current) return;

        const rect = trackRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const time = (x / rect.width) * duration;

        const baseValue = effect.params?.[paramName]?.value ?? paramDef.value;
        const value = sampleKeyframeTrack(keyframes, time, baseValue);
        onAddKeyframe(paramName, time, value);
    };

    const handleDragKeyframe = (paramName, oldTime, newTime) => {
        const kf = keyframes.find(k => k.time === oldTime);
        if (kf) {
            onUpdateKeyframe(paramName, oldTime, newTime, kf.value, kf.easing);
        }
    };

    const isSelected = selectedKeyframe?.paramName === paramName;
    const selectedKf = isSelected ? keyframes.find(k => k.time === selectedKeyframe.time) : null;
    const isCustomBezier = /^\s*cubic-bezier\(/i.test(String(selectedKf?.easing || ''));
    const isCustomSteps = /^\s*steps\(/i.test(String(selectedKf?.easing || ''));

    useEffect(() => {
        const controls = readBezierControls(selectedKf?.easing);
        setBezierControls(controls);
        setBezierDraft(controls.map(String));
    }, [paramName, selectedKf?.time, selectedKf?.easing]);

    useEffect(() => {
        const controls = readStepControls(selectedKf?.easing);
        setStepControls(controls);
        setStepCountDraft(String(controls.count));
    }, [paramName, selectedKf?.time, selectedKf?.easing]);

    const updateBezierControl = (index, rawValue) => {
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed)) return;
        const next = [...bezierControls];
        next[index] = Math.max(index % 2 === 0 ? 0 : -2, Math.min(index % 2 === 0 ? 1 : 2, parsed));
        setBezierControls(next);
        setBezierDraft(next.map(String));
        onUpdateKeyframe(paramName, selectedKf.time, selectedKf.time, selectedKf.value, encodeBezierControls(next));
    };

    const updateStepControls = next => {
        if (next.position === 'jump-none' && next.count < 2) next = { ...next, count: 2 };
        setStepControls(next);
        setStepCountDraft(String(next.count));
        onUpdateKeyframe(paramName, selectedKf.time, selectedKf.time, selectedKf.value, encodeStepControls(next));
    };

    const updateStepCount = rawValue => {
        setStepCountDraft(rawValue);
        const parsed = Number(rawValue);
        if (!Number.isSafeInteger(parsed) || parsed < 1) return;
        updateStepControls({ ...stepControls, count: parsed });
    };

    return (
        <div className="border-b border-border last:border-b-0">
            {/* Header */}
            <div
                className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {isExpanded ?
                    <ChevronDown className="w-3 h-3 text-muted-foreground" /> :
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                }
                <span className="text-xs flex-1">{paramDef.label || paramName}</span>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpenGraph?.(paramName);
                    }}
                    title="Open Bézier Graph Curve Editor"
                    className="px-1.5 py-0.5 text-[10px] text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 rounded flex items-center gap-1 transition-colors"
                >
                    <Activity className="w-2.5 h-2.5" />
                    Curve
                </button>
                <span className="text-[10px] text-muted-foreground font-mono">
                    {t('effects.keyframeCount', { count: keyframes.length })}
                </span>
            </div>

            {/* Keyframe track */}
            <div
                ref={trackRef}
                className="relative h-6 mx-3 mb-2 bg-secondary/50 rounded cursor-crosshair"
                onClick={handleTrackClick}
            >
                {/* Playhead indicator */}
                <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
                    style={{ left: `${(playhead / duration) * 100}%` }}
                />

                {/* Keyframe markers */}
                {keyframes.map((kf, idx) => (
                    <KeyframeDiamond
                        key={`${kf.time}-${idx}`}
                        keyframe={kf}
                        paramName={paramName}
                        timelineWidth={trackWidth}
                        duration={duration}
                        isSelected={selectedKeyframe?.paramName === paramName && selectedKeyframe?.time === kf.time}
                        onSelect={onSelectKeyframe}
                        onDrag={handleDragKeyframe}
                        onDoubleClick={() => setIsExpanded(true)}
                    />
                ))}
            </div>

            {/* Expanded value/easing editor */}
            {isExpanded && selectedKf && (
                <div className="px-3 pb-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-16">{t('effects.time')}:</span>
                        <span className="font-mono">{selectedKf.time.toFixed(2)}s</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-16">{t('effects.value')}:</span>
                        <input
                            type="number"
                            value={selectedKf.value}
                            onChange={(e) => onUpdateKeyframe(paramName, selectedKf.time, selectedKf.time, parseFloat(e.target.value), selectedKf.easing)}
                            className="w-20 px-2 py-1 bg-secondary border border-border rounded text-xs"
                            step={paramDef.type === 'int' ? 1 : 0.01}
                        />
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-16">{t('effects.easing')}:</span>
                        <select
                            value={isCustomBezier ? '__custom_bezier__' : isCustomSteps ? '__custom_steps__' : (selectedKf.easing || 'linear')}
                            onChange={(e) => {
                                if (e.target.value === '__custom_bezier__') {
                                    const controls = [...DEFAULT_BEZIER];
                                    setBezierControls(controls);
                                    onUpdateKeyframe(paramName, selectedKf.time, selectedKf.time, selectedKf.value, encodeBezierControls(controls));
                                } else if (e.target.value === '__custom_steps__') {
                                    const controls = { ...DEFAULT_STEPS };
                                    setStepControls(controls);
                                    setStepCountDraft(String(controls.count));
                                    onUpdateKeyframe(paramName, selectedKf.time, selectedKf.time, selectedKf.value, encodeStepControls(controls));
                                } else {
                                    onUpdateKeyframe(paramName, selectedKf.time, selectedKf.time, selectedKf.value, e.target.value);
                                }
                            }}
                            className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-xs"
                        >
                            {EASING_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                            ))}
                        </select>
                    </div>
                    {isCustomBezier && (
                        <fieldset className="grid grid-cols-4 gap-2" aria-label={t('effects.bezierControls')}>
                            {BEZIER_CONTROL_NAMES.map((name, index) => (
                                <label key={name} className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                                    <span>{name}</span>
                                    <input
                                        type="number"
                                        aria-label={`${t('effects.bezierControls')} ${name}`}
                                        min={index % 2 === 0 ? 0 : -2}
                                        max={index % 2 === 0 ? 1 : 2}
                                        step="0.01"
                                        value={bezierDraft[index]}
                                        onChange={(e) => setBezierDraft(current => current.map((value, controlIndex) => controlIndex === index ? e.target.value : value))}
                                        onBlur={(e) => updateBezierControl(index, e.target.value)}
                                        className="w-full px-2 py-1 bg-secondary border border-border rounded text-xs text-foreground"
                                    />
                                </label>
                            ))}
                        </fieldset>
                    )}
                    {isCustomSteps && (
                        <fieldset className="grid grid-cols-2 gap-2" aria-label={t('effects.stepControls')}>
                            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                                <span>{t('effects.stepCount')}</span>
                                <input
                                    type="number"
                                    aria-label={t('effects.stepCount')}
                                    min="1"
                                    max={Number.MAX_SAFE_INTEGER}
                                    step="1"
                                    value={stepCountDraft}
                                    onChange={e => updateStepCount(e.target.value)}
                                    onBlur={() => {
                                        if (!Number.isSafeInteger(Number(stepCountDraft)) || Number(stepCountDraft) < 1) {
                                            setStepCountDraft(String(stepControls.count));
                                        }
                                    }}
                                    className="w-full px-2 py-1 bg-secondary border border-border rounded text-xs text-foreground"
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                                <span>{t('effects.stepPosition')}</span>
                                <select
                                    aria-label={t('effects.stepPosition')}
                                    value={stepControls.position}
                                    onChange={e => updateStepControls({ ...stepControls, position: e.target.value })}
                                    className="w-full px-2 py-1 bg-secondary border border-border rounded text-xs text-foreground"
                                >
                                    <option value="jump-start">{t('effects.stepJumpStart')}</option>
                                    <option value="jump-end">{t('effects.stepJumpEnd')}</option>
                                    <option value="jump-none">{t('effects.stepJumpNone')}</option>
                                    <option value="jump-both">{t('effects.stepJumpBoth')}</option>
                                </select>
                            </label>
                        </fieldset>
                    )}
                    <button
                        onClick={() => onRemoveKeyframe(paramName, selectedKf.time)}
                        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                    >
                        <Trash2 className="w-3 h-3" />
                        {t('effects.removeKeyframe')}
                    </button>
                </div>
            )}
        </div>
    );
};

/**
 * Bézier Graph Editor View with draggable tangent handles & presets
 */
export const BezierGraphEditor = ({
    paramName,
    paramDef,
    keyframes = [],
    duration,
    playhead,
    onAddKeyframe,
    onUpdateKeyframe,
    onRemoveKeyframe,
    selectedKeyframe,
    onSelectKeyframe,
}) => {
    const sortedKfs = useMemo(() => {
        return [...keyframes].sort((a, b) => a.time - b.time);
    }, [keyframes]);

    const activeKf = useMemo(() => {
        if (sortedKfs.length === 0) return null;
        if (selectedKeyframe?.paramName === paramName) {
            const found = sortedKfs.find(k => Math.abs(k.time - selectedKeyframe.time) < 1e-4);
            if (found) return found;
        }
        return sortedKfs[0];
    }, [sortedKfs, selectedKeyframe, paramName]);

    const isCustomBezier = /^\s*cubic-bezier\(/i.test(String(activeKf?.easing || ''));
    const activeBezier = useMemo(() => {
        return readBezierControls(activeKf?.easing);
    }, [activeKf?.easing]);

    const [draggingHandle, setDraggingHandle] = useState(null);
    const svgRef = useRef(null);

    const curvePathD = useMemo(() => {
        const W = 280;
        const H = 130;
        const padX = 24;
        const padY = 22;
        const plotW = W - padX * 2;
        const plotH = H - padY * 2;
        const pts = [];
        const steps = 48;
        const easingFn = isCustomBezier
            ? cubicBezier(activeBezier[0], activeBezier[1], activeBezier[2], activeBezier[3])
            : resolveEasing(activeKf?.easing || 'linear');

        for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const val = easingFn(u);
            const px = padX + u * plotW;
            const py = H - padY - val * plotH;
            pts.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`);
        }
        return pts.join(' ');
    }, [activeKf?.easing, isCustomBezier, activeBezier]);

    const handleSvgPointerMove = useCallback((e) => {
        if (!draggingHandle || !activeKf || !svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const W = 280;
        const H = 130;
        const padX = 24;
        const padY = 22;
        const plotW = W - padX * 2;
        const plotH = H - padY * 2;

        const svgX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * W;
        const svgY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * H;

        const nx = clamp((svgX - padX) / plotW, 0.02, 0.98);
        const ny = clamp((H - padY - svgY) / plotH, -0.4, 1.5);

        const nextBezier = [...activeBezier];
        if (draggingHandle === 'h1') {
            nextBezier[0] = Number(nx.toFixed(2));
            nextBezier[1] = Number(ny.toFixed(2));
        } else {
            nextBezier[2] = Number(nx.toFixed(2));
            nextBezier[3] = Number(ny.toFixed(2));
        }

        onUpdateKeyframe(
            paramName,
            activeKf.time,
            activeKf.time,
            activeKf.value,
            encodeBezierControls(nextBezier)
        );
    }, [draggingHandle, activeKf, activeBezier, paramName, onUpdateKeyframe]);

    return (
        <div className="flex-1 min-h-0 flex items-stretch gap-3 p-3 overflow-hidden bg-[#0A0E17] text-slate-200">
            {/* Left: Keyframe segment list */}
            <div className="w-48 space-y-2 overflow-y-auto shrink-0 border-r border-slate-800/60 pr-2">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>Keyframes</span>
                    <button
                        type="button"
                        onClick={() => {
                            const val = sampleKeyframeTrack(sortedKfs, playhead, paramDef?.value ?? 0);
                            onAddKeyframe(paramName, playhead, val, 'linear');
                        }}
                        className="text-sky-400 hover:text-sky-300 text-[10px] flex items-center gap-0.5"
                    >
                        <Plus className="w-3 h-3" /> Add @ playhead
                    </button>
                </div>

                {sortedKfs.length > 0 ? (
                    <div className="space-y-1">
                        {sortedKfs.map((kf, idx) => {
                            const isSel = activeKf?.time === kf.time;
                            return (
                                <div
                                    key={`${kf.time}-${idx}`}
                                    className={`px-2 py-1.5 rounded border text-xs flex items-center justify-between gap-1 transition-colors ${
                                        isSel
                                            ? 'bg-sky-500/20 border-sky-500/60 text-sky-200'
                                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => onSelectKeyframe(kf.time, paramName)}
                                        className="text-left font-mono text-[11px] flex-1 cursor-pointer truncate"
                                    >
                                        K{idx + 1} · {kf.time.toFixed(2)}s → {Number(kf.value).toFixed(2)}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`Delete keyframe K${idx + 1}`}
                                        onClick={() => onRemoveKeyframe(paramName, kf.time)}
                                        className="text-slate-500 hover:text-rose-400 cursor-pointer p-0.5"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-xs text-slate-500">
                        No keyframes on this track. Click &quot;Add @ playhead&quot; above to add one.
                    </p>
                )}
            </div>

            {/* Middle: SVG Curve Canvas */}
            <div className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-lg flex flex-col items-center justify-center relative p-2 select-none">
                <svg
                    ref={svgRef}
                    data-testid="bezier-graph-svg"
                    viewBox="0 0 280 130"
                    onPointerMove={handleSvgPointerMove}
                    onPointerUp={() => setDraggingHandle(null)}
                    onPointerLeave={() => setDraggingHandle(null)}
                    className="w-full h-full max-w-md select-none touch-none"
                >
                    <rect x="24" y="22" width="232" height="86" fill="none" stroke="#1E293B" strokeWidth="1" />
                    <line x1="24" y1="65" x2="256" y2="65" stroke="#1E293B" strokeDasharray="3 3" />
                    <line x1="140" y1="22" x2="140" y2="108" stroke="#1E293B" strokeDasharray="3 3" />

                    <path d={curvePathD} fill="none" stroke="#38BDF8" strokeWidth="2.5" />

                    {activeKf && (
                        <>
                            <line
                                x1="24"
                                y1="108"
                                x2={24 + activeBezier[0] * 232}
                                y2={108 - activeBezier[1] * 86}
                                stroke="#F59E0B"
                                strokeWidth="1.2"
                            />
                            <line
                                x1="256"
                                y1="22"
                                x2={24 + activeBezier[2] * 232}
                                y2={108 - activeBezier[3] * 86}
                                stroke="#A855F7"
                                strokeWidth="1.2"
                            />
                            <circle
                                cx={24 + activeBezier[0] * 232}
                                cy={108 - activeBezier[1] * 86}
                                r="5.5"
                                fill="#F59E0B"
                                className="cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
                                onPointerDown={(e) => {
                                    e.currentTarget.setPointerCapture?.(e.pointerId);
                                    setDraggingHandle('h1');
                                }}
                            />
                            <circle
                                cx={24 + activeBezier[2] * 232}
                                cy={108 - activeBezier[3] * 86}
                                r="5.5"
                                fill="#A855F7"
                                className="cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
                                onPointerDown={(e) => {
                                    e.currentTarget.setPointerCapture?.(e.pointerId);
                                    setDraggingHandle('h2');
                                }}
                            />
                        </>
                    )}
                </svg>
                <div className="w-full flex justify-between px-6 text-[10px] font-mono text-slate-500">
                    <span>0.0s (Start)</span>
                    <span>1.0s (End)</span>
                </div>
            </div>

            {/* Right: Presets & Value Editor */}
            <div className="w-52 space-y-2.5 overflow-y-auto shrink-0 border-l border-slate-800/60 pl-2">
                <div className="text-[11px] font-medium text-slate-400">
                    {activeKf
                        ? isCustomBezier
                            ? `cubic-bezier(${activeBezier.join(', ')})`
                            : `Easing: ${activeKf.easing || 'linear'}`
                        : 'Select a keyframe'}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                    {GRAPH_CURVE_PRESETS.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            disabled={!activeKf}
                            onClick={() => {
                                if (!activeKf) return;
                                onUpdateKeyframe(
                                    paramName,
                                    activeKf.time,
                                    activeKf.time,
                                    activeKf.value,
                                    preset.easing
                                );
                            }}
                            className="px-2 py-1.5 text-[11px] font-medium text-left rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 disabled:opacity-40 cursor-pointer truncate transition-colors"
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>

                {activeKf && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400">Value:</span>
                            <input
                                type="number"
                                value={activeKf.value}
                                onChange={(e) => onUpdateKeyframe(paramName, activeKf.time, activeKf.time, parseFloat(e.target.value) || 0, activeKf.easing)}
                                className="w-20 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-xs font-mono text-slate-200"
                                step={paramDef?.type === 'int' ? 1 : 0.01}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Main Keyframe Editor component with Dopesheet and Bézier Graph Editor modes
 */
const KeyframeEditor = ({
    effect,
    definition,
    duration = 10,
    playhead = 0,
    onAddKeyframe,
    onUpdateKeyframe,
    onRemoveKeyframe
}) => {
    const { t } = useTranslation('editor');
    const [mode, setMode] = useState('dopesheet'); // 'dopesheet' | 'graph'
    const [selectedKeyframe, setSelectedKeyframe] = useState(null);
    const [activeGraphParam, setActiveGraphParam] = useState(null);

    const handleSelectKeyframe = useCallback((time, paramName) => {
        setSelectedKeyframe({ time, paramName });
    }, []);

    const handleUpdateKeyframe = useCallback((paramName, oldTime, newTime, value, easing) => {
        if (oldTime !== newTime) {
            onRemoveKeyframe(effect.id, paramName, oldTime);
        }
        onAddKeyframe(effect.id, paramName, newTime, value, easing);
        setSelectedKeyframe({ time: newTime, paramName });
    }, [effect.id, onAddKeyframe, onRemoveKeyframe]);

    const handleRemoveKeyframe = useCallback((paramName, time) => {
        onRemoveKeyframe(effect.id, paramName, time);
        setSelectedKeyframe(null);
    }, [effect.id, onRemoveKeyframe]);

    if (!effect || !definition) {
        return (
            <div className="text-xs text-muted-foreground text-center py-4">
                {t('effects.selectEffectToEditKeyframes')}
            </div>
        );
    }

    const params = definition.params || {};
    const keyframes = effect.keyframes || {};

    const animatableParams = Object.entries(params).filter(([_, def]) =>
        def.type === 'float' || def.type === 'FLOAT' || def.type === 'int' || def.type === 'INT'
    );

    if (animatableParams.length === 0) {
        return (
            <div className="text-xs text-muted-foreground text-center py-4">
                <Key className="w-6 h-6 mx-auto mb-2 opacity-30" />
                {t('effects.noAnimatableParameters')}
            </div>
        );
    }

    const effectiveGraphParam = activeGraphParam || animatableParams[0][0];
    const effectiveGraphDef = params[effectiveGraphParam] || { value: 0 };
    const effectiveGraphKeyframes = keyframes[effectiveGraphParam] || [];

    return (
        <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
            {/* Header with Mode Switch */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-black/30">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setMode('dopesheet')}
                        className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer transition-colors ${
                            mode === 'dopesheet'
                                ? 'bg-primary/20 text-primary border border-primary/40'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        Dope Sheet
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode('graph')}
                        className={`px-2 py-1 text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer transition-colors ${
                            mode === 'graph'
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        <Activity className="w-3.5 h-3.5" />
                        Bézier Graph
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    {mode === 'graph' && (
                        <select
                            value={effectiveGraphParam}
                            onChange={(e) => setActiveGraphParam(e.target.value)}
                            className="px-2 py-0.5 text-xs bg-secondary border border-border rounded text-foreground font-mono"
                        >
                            {animatableParams.map(([name, def]) => (
                                <option key={name} value={name}>
                                    {def.label || name} ({(keyframes[name] || []).length} kf)
                                </option>
                            ))}
                        </select>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">
                        {playhead.toFixed(2)}s / {duration.toFixed(2)}s
                    </span>
                </div>
            </div>

            {/* Mode Body */}
            {mode === 'dopesheet' ? (
                <>
                    {/* Parameter tracks */}
                    <div className="divide-y divide-border">
                        {animatableParams.map(([paramName, paramDef]) => (
                            <KeyframeTrack
                                key={paramName}
                                paramName={paramName}
                                paramDef={paramDef}
                                keyframes={keyframes[paramName] || []}
                                effect={effect}
                                duration={duration}
                                playhead={playhead}
                                onAddKeyframe={(pn, time, value) =>
                                    onAddKeyframe(effect.id, pn, time, value, 'linear')
                                }
                                onUpdateKeyframe={handleUpdateKeyframe}
                                onRemoveKeyframe={handleRemoveKeyframe}
                                selectedKeyframe={selectedKeyframe}
                                onSelectKeyframe={handleSelectKeyframe}
                                onOpenGraph={(pn) => {
                                    setActiveGraphParam(pn);
                                    setMode('graph');
                                }}
                            />
                        ))}
                    </div>

                    {/* Timeline ruler */}
                    <div className="h-6 bg-secondary/30 border-t border-border relative select-none">
                        {[...Array(11)].map((_, i) => {
                            const time = (i / 10) * duration;
                            return (
                                <div
                                    key={i}
                                    className="absolute top-0 h-2 w-px bg-border"
                                    style={{ left: `${i * 10}%` }}
                                >
                                    <span className="absolute top-2 -translate-x-1/2 text-[9px] text-muted-foreground font-mono">
                                        {time.toFixed(1)}s
                                    </span>
                                </div>
                            );
                        })}

                        {/* Playhead */}
                        <div
                            className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
                            style={{ left: `${(playhead / duration) * 100}%` }}
                        >
                            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rotate-45" />
                        </div>
                    </div>
                </>
            ) : (
                <BezierGraphEditor
                    paramName={effectiveGraphParam}
                    paramDef={effectiveGraphDef}
                    keyframes={effectiveGraphKeyframes}
                    duration={duration}
                    playhead={playhead}
                    onAddKeyframe={(pn, time, value, easing) =>
                        onAddKeyframe(effect.id, pn, time, value, easing || 'linear')
                    }
                    onUpdateKeyframe={handleUpdateKeyframe}
                    onRemoveKeyframe={handleRemoveKeyframe}
                    selectedKeyframe={selectedKeyframe}
                    onSelectKeyframe={handleSelectKeyframe}
                />
            )}
        </div>
    );
};

export default KeyframeEditor;
