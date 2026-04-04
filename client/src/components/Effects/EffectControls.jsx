/**
 * EffectControls.jsx
 * Parameter controls for individual effects including sliders,
 * color pickers, dropdowns, and keyframe indicators.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
    Key,
    Circle,
    CircleDot,
    RotateCcw,
    ChevronDown
} from 'lucide-react';

// ============================================================================
// CONTROL COMPONENTS
// ============================================================================

/**
 * Slider control for numeric parameters
 */
const SliderControl = ({
    name,
    label,
    value,
    min = 0,
    max = 100,
    step = 1,
    unit = '',
    onChange,
    onAddKeyframe,
    hasKeyframe = false,
    canAnimate = true
}) => {
    const percentage = ((value - min) / (max - min)) * 100;

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">{label}</label>
                <div className="flex items-center gap-1">
                    {canAnimate && (
                        <button
                            onClick={() => onAddKeyframe(name, value)}
                            className={`p-1 rounded hover:bg-white/10 ${hasKeyframe ? 'text-yellow-400' : 'text-muted-foreground'}`}
                            title={hasKeyframe ? 'Keyframe at current time' : 'Add keyframe'}
                        >
                            {hasKeyframe ? <CircleDot className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                        </button>
                    )}
                    <span className="text-xs font-mono text-muted-foreground w-14 text-right">
                        {typeof value === 'number' ? value.toFixed(step < 1 ? 2 : 0) : value}{unit}
                    </span>
                </div>
            </div>
            <div className="relative h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                    className="absolute top-0 left-0 h-full bg-primary rounded-full transition-all"
                    style={{ width: `${percentage}%` }}
                />
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => onChange(name, parseFloat(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
            </div>
        </div>
    );
};

/**
 * Toggle/switch control for boolean parameters
 */
const ToggleControl = ({ name, label, value, onChange }) => {
    return (
        <div className="flex items-center justify-between py-1">
            <label className="text-xs text-muted-foreground">{label}</label>
            <button
                onClick={() => onChange(name, !value)}
                className={`
                    w-10 h-5 rounded-full transition-colors relative
                    ${value ? 'bg-primary' : 'bg-secondary'}
                `}
            >
                <div className={`
                    absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                    ${value ? 'translate-x-5' : 'translate-x-0.5'}
                `} />
            </button>
        </div>
    );
};

/**
 * Dropdown/select control for enum parameters
 */
const SelectControl = ({ name, label, value, options, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);

    const selectedOption = options.find(o => o.value === value) || options[0];

    return (
        <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">{label}</label>
            <div className="relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-secondary border border-border rounded-lg hover:border-primary/50 transition-colors text-sm"
                >
                    <span>{selectedOption?.label || value}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
                        {options.map(option => (
                            <button
                                key={option.value}
                                onClick={() => { onChange(name, option.value); setIsOpen(false); }}
                                className={`
                                    w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors
                                    ${option.value === value ? 'bg-primary/20 text-primary' : ''}
                                `}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Color picker control
 */
const ColorControl = ({ name, label, value, onChange }) => {
    // Parse value - could be hex, rgb array, or object
    const colorValue = useMemo(() => {
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) {
            const [r, g, b] = value.map(v => Math.round(v * 255));
            return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        }
        return '#ffffff';
    }, [value]);

    const handleChange = (e) => {
        const hex = e.target.value;
        // Convert to RGB array for shader compatibility
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        onChange(name, [r, g, b]);
    };

    return (
        <div className="flex items-center justify-between py-1">
            <label className="text-xs text-muted-foreground">{label}</label>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={colorValue}
                    onChange={handleChange}
                    className="w-8 h-8 border-0 bg-transparent cursor-pointer"
                />
                <span className="text-xs font-mono text-muted-foreground">{colorValue}</span>
            </div>
        </div>
    );
};

/**
 * Position/XY control
 */
const PositionControl = ({ name, label, value, onChange }) => {
    const x = value?.x ?? value?.[0] ?? 0.5;
    const y = value?.y ?? value?.[1] ?? 0.5;

    return (
        <div className="space-y-2">
            <label className="text-xs text-muted-foreground">{label}</label>
            <div className="grid grid-cols-2 gap-2">
                <SliderControl
                    name={`${name}_x`}
                    label="X"
                    value={x}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(_, val) => onChange(name, { x: val, y })}
                    canAnimate={false}
                />
                <SliderControl
                    name={`${name}_y`}
                    label="Y"
                    value={y}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(_, val) => onChange(name, { x, y: val })}
                    canAnimate={false}
                />
            </div>
        </div>
    );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Effect controls renderer
 */
const EffectControls = ({
    effect,
    definition,
    onUpdateParams,
    onAddKeyframe,
    playhead = 0
}) => {
    if (!effect || !definition) {
        return (
            <div className="text-xs text-muted-foreground text-center py-2">
                No parameters available
            </div>
        );
    }

    const params = definition.params || {};
    const currentValues = effect.params || {};
    const keyframes = effect.keyframes || {};

    const handleParamChange = useCallback((paramName, value) => {
        onUpdateParams(effect.id, { [paramName]: value });
    }, [effect.id, onUpdateParams]);

    const handleAddKeyframe = useCallback((paramName, value) => {
        onAddKeyframe(effect.id, paramName, playhead, value);
    }, [effect.id, playhead, onAddKeyframe]);

    const hasKeyframeAt = useCallback((paramName) => {
        const paramKeyframes = keyframes[paramName];
        if (!paramKeyframes) return false;
        return paramKeyframes.some(k => Math.abs(k.time - playhead) < 0.01);
    }, [keyframes, playhead]);

    // Reset to defaults
    const handleReset = () => {
        const defaults = {};
        Object.entries(params).forEach(([key, def]) => {
            defaults[key] = def.value;
        });
        onUpdateParams(effect.id, defaults);
    };

    // Render controls based on parameter type
    const renderControl = (paramName, paramDef) => {
        const value = currentValues[paramName]?.value ?? currentValues[paramName] ?? paramDef.value;

        switch (paramDef.type) {
            case 'float':
            case 'int':
            case 'FLOAT':
            case 'INT':
                return (
                    <SliderControl
                        key={paramName}
                        name={paramName}
                        label={paramDef.label || paramName}
                        value={value}
                        min={paramDef.min ?? 0}
                        max={paramDef.max ?? 100}
                        step={paramDef.type === 'int' || paramDef.type === 'INT' ? 1 : 0.01}
                        unit={paramDef.unit || ''}
                        onChange={handleParamChange}
                        onAddKeyframe={handleAddKeyframe}
                        hasKeyframe={hasKeyframeAt(paramName)}
                    />
                );

            case 'bool':
            case 'BOOL':
                return (
                    <ToggleControl
                        key={paramName}
                        name={paramName}
                        label={paramDef.label || paramName}
                        value={value}
                        onChange={handleParamChange}
                    />
                );

            case 'select':
            case 'enum':
            case 'SELECT':
                return (
                    <SelectControl
                        key={paramName}
                        name={paramName}
                        label={paramDef.label || paramName}
                        value={value}
                        options={paramDef.options || []}
                        onChange={handleParamChange}
                    />
                );

            case 'color':
            case 'COLOR':
            case 'vec3':
                return (
                    <ColorControl
                        key={paramName}
                        name={paramName}
                        label={paramDef.label || paramName}
                        value={value}
                        onChange={handleParamChange}
                    />
                );

            case 'position':
            case 'vec2':
                return (
                    <PositionControl
                        key={paramName}
                        name={paramName}
                        label={paramDef.label || paramName}
                        value={value}
                        onChange={handleParamChange}
                    />
                );

            default:
                return (
                    <SliderControl
                        key={paramName}
                        name={paramName}
                        label={paramDef.label || paramName}
                        value={value}
                        min={paramDef.min ?? 0}
                        max={paramDef.max ?? 100}
                        step={0.01}
                        onChange={handleParamChange}
                        onAddKeyframe={handleAddKeyframe}
                        hasKeyframe={hasKeyframeAt(paramName)}
                    />
                );
        }
    };

    return (
        <div className="space-y-3">
            {/* Keyframe indicator */}
            {Object.keys(keyframes).length > 0 && (
                <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded">
                    <Key className="w-3 h-3" />
                    <span>{Object.keys(keyframes).length} animated parameter(s)</span>
                </div>
            )}

            {/* Parameter controls */}
            {Object.entries(params).map(([name, def]) => renderControl(name, def))}

            {/* Reset button */}
            <button
                onClick={handleReset}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                <RotateCcw className="w-3 h-3" />
                Reset to defaults
            </button>
        </div>
    );
};

export default EffectControls;
