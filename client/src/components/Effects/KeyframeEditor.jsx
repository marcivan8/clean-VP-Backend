/**
 * KeyframeEditor.jsx
 * Visual keyframe timeline for animating effect parameters.
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { sampleKeyframeTrack } from '../../motion/MotionResolver.js';
import {
    Key,
    Plus,
    Trash2,
    ChevronDown,
    ChevronRight,
    Diamond,
    Circle
} from 'lucide-react';

// Easing curves
const EASING_OPTIONS = [
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

const DEFAULT_BEZIER = [0.25, 0.1, 0.25, 1];
const BEZIER_CONTROL_NAMES = ['X1', 'Y1', 'X2', 'Y2'];
const readBezierControls = (easing) => {
    const match = /^\s*cubic-bezier\(([^)]+)\)\s*$/i.exec(String(easing || ''));
    const values = match?.[1].split(',').map(value => Number(value.trim()));
    return values?.length === 4 && values.every(Number.isFinite) ? values : [...DEFAULT_BEZIER];
};
const encodeBezierControls = (values) => `cubic-bezier(${values.map(value => Number(value.toFixed(3))).join(', ')})`;
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
    onSelectKeyframe
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

        // Preserve the exact value visible at this time so inserting a key
        // does not create a jump in an already animated parameter.
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
                className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {isExpanded ?
                    <ChevronDown className="w-3 h-3 text-muted-foreground" /> :
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                }
                <span className="text-xs flex-1">{paramDef.label || paramName}</span>
                <span className="text-[10px] text-muted-foreground">
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
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
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
                        isSelected={isSelected && selectedKeyframe.time === kf.time}
                        onSelect={onSelectKeyframe}
                        onDrag={handleDragKeyframe}
                        onDoubleClick={(kf) => onRemoveKeyframe(paramName, kf.time)}
                    />
                ))}

                {/* Interpolation lines between keyframes */}
                {keyframes.length > 1 && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none">
                        {keyframes.slice(0, -1).map((kf, idx) => {
                            const nextKf = keyframes[idx + 1];
                            const x1 = (kf.time / duration) * 100;
                            const x2 = (nextKf.time / duration) * 100;
                            return (
                                <line
                                    key={idx}
                                    x1={`${x1}%`}
                                    y1="50%"
                                    x2={`${x2}%`}
                                    y2="50%"
                                    stroke="currentColor"
                                    strokeWidth="1"
                                    strokeDasharray={kf.easing === 'linear' ? 'none' : '2,2'}
                                    className="text-primary/50"
                                />
                            );
                        })}
                    </svg>
                )}
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
 * Main Keyframe Editor component
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
    const [selectedKeyframe, setSelectedKeyframe] = useState(null);

    const handleSelectKeyframe = useCallback((time, paramName) => {
        setSelectedKeyframe({ time, paramName });
    }, []);

    const handleUpdateKeyframe = useCallback((paramName, oldTime, newTime, value, easing) => {
        // If time changed, need to remove old and add new
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

    // Only show animatable params
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

    return (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-black/20">
                <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">{t('effects.keyframeEditor')}</span>
                </div>
                <span className="text-xs text-muted-foreground font-mono">
                    {playhead.toFixed(2)}s / {duration.toFixed(2)}s
                </span>
            </div>

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
                    />
                ))}
            </div>

            {/* Timeline ruler */}
            <div className="h-6 bg-secondary/30 border-t border-border relative">
                {/* Time markers */}
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
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                    style={{ left: `${(playhead / duration) * 100}%` }}
                >
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rotate-45" />
                </div>
            </div>
        </div>
    );
};

export default KeyframeEditor;
