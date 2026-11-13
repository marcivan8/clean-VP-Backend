/**
 * EffectControls.jsx
 * Parameter controls for individual effects including sliders,
 * color pickers, dropdowns, and keyframe indicators.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Key,
    Circle,
    CircleDot
} from 'lucide-react';
import {
    PanelSection, ControlRow, TrackSlider, ToggleSwitch, SelectField, SwatchRow,
} from '../ui/PanelControls.jsx';
import { normalizeHex, changedKeys } from '../ui/panelControls.js';
import { sampleKeyframeTrack } from '../../motion/MotionResolver.js';
import { validateMotionExpression } from '../../motion/MotionExpression.js';
import { audioEngineAPI } from '../../audio-engine/AudioEngineAPI.js';

// ============================================================================
// CONTROL COMPONENTS
// ============================================================================

/**
 * Slider control for numeric parameters
 */
/**
 * R116 — these five controls now sit on the shared panel kit
 * (components/ui/PanelControls.jsx). Their props are unchanged, so the
 * dispatcher below and every caller are untouched; what changed is that an
 * effect parameter, a text property and a transform property finally look and
 * behave like the same control.
 *
 * Three things came with the move rather than being written here again:
 *  - the numeric box beside every slider, so a value can be TYPED. Dragging a
 *    0..1 float to exactly 0.35 with a mouse is not realistically possible;
 *  - typed hex on the colour control;
 *  - a real `<select>` in place of the hand-rolled dropdown, which had no
 *    listbox role, no arrow keys and no way to close on Escape.
 */

/**
 * The colour ramps that belong under a slider.
 *
 * A temperature slider that is a plain grey bar tells you nothing about which
 * way is warm. Keyed by parameter NAME (lowercased) because effect
 * definitions do not declare this — matching on name is a guess, so it is a
 * small, explicit list rather than a pattern, and an unknown parameter simply
 * gets the ordinary accent-filled track.
 */
const PARAM_TINTS = {
    temperature: ['#4FC3F7', '#9E9E9E', '#FFD54F'],
    tint: ['#66BB6A', '#9E9E9E', '#CE93D8'],
    hue: ['#FF5252', '#FFD740', '#69F0AE', '#40C4FF', '#7C4DFF', '#FF5252'],
    saturation: ['#9E9E9E', '#FF4081'],
};

const tintFor = (name) => PARAM_TINTS[String(name || '').toLowerCase()] || null;

/**
 * Slider control for numeric parameters.
 *
 * The keyframe dot stays exactly where it was — it is the only control in
 * this panel that is about TIME rather than value, and moving it would hide
 * the one piece of state that explains why a parameter changes mid-clip.
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
    canAnimate = true,
    expression = '',
    onExpressionChange,
    canExpression = true,
}) => {
    const { t } = useTranslation('editor');
    const [expressionOpen, setExpressionOpen] = useState(Boolean(expression));
    const [expressionDraft, setExpressionDraft] = useState(expression || '');
    const [expressionError, setExpressionError] = useState('');
    useEffect(() => {
        setExpressionDraft(expression || '');
        const initial = String(expression || '').trim();
        const validation = initial ? validateMotionExpression(initial, {
            variables: ['t', 'time', 'duration', 'progress', 'value'],
        }) : { valid: true };
        setExpressionError(validation.valid ? '' : validation.reason);
    }, [expression]);

    const commitExpression = () => {
        const draft = expressionDraft.trim();
        if (!draft) {
            setExpressionError('');
            onExpressionChange?.(name, '');
            return;
        }
        const validation = validateMotionExpression(draft, {
            variables: ['t', 'time', 'duration', 'progress', 'value'],
        });
        if (!validation.valid) {
            setExpressionError(validation.reason);
            return;
        }
        setExpressionError('');
        onExpressionChange?.(name, draft);
    };

    return (
        <div>
            <ControlRow label={label} labelWidth={74}>
                <TrackSlider
                    ariaLabel={label}
                    value={value}
                    min={min}
                    max={max}
                    step={step}
                    unit={unit}
                    tint={tintFor(name)}
                    onChange={(v) => onChange(name, v)}
                />
                {canExpression && <button type="button" onClick={() => setExpressionOpen(open => !open)}
                    title="Animate with an expression" aria-label={`${label} expression`}
                    aria-pressed={expressionOpen}
                    className={`shrink-0 rounded px-1.5 py-1 text-[10px] font-mono ${expressionOpen ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-white/10'}`}>
                    ƒx
                </button>}
                {canExpression && expressionOpen && <input
                    type="text"
                    aria-label={`${label} expression formula`}
                    aria-invalid={!!expressionError}
                    aria-describedby={expressionError ? `${name}-expression-error` : undefined}
                    title="Use t, time, duration, progress, value, math functions, wiggle(), or noise()"
                    value={expressionDraft}
                    placeholder="0.5 + sin(t)"
                    onChange={event => { setExpressionDraft(event.target.value); setExpressionError(''); }}
                    onBlur={commitExpression}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitExpression(); } }}
                    className={`w-[116px] rounded border bg-black/20 px-2 py-1 text-[10px] font-mono text-foreground placeholder:text-muted-foreground ${expressionError ? 'border-destructive' : 'border-border'}`}
                />}
                {canAnimate && (
                    <button
                        type="button"
                        onClick={() => onAddKeyframe(name, value)}
                        className={`p-1 rounded hover:bg-white/10 shrink-0 ${hasKeyframe ? 'text-yellow-400' : 'text-muted-foreground'}`}
                        title={hasKeyframe ? t('effects.keyframeAtCurrentTime') : t('effects.addKeyframe')}
                        aria-label={hasKeyframe ? t('effects.keyframeAtCurrentTime') : t('effects.addKeyframe')}
                    >
                        {hasKeyframe ? <CircleDot className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                    </button>
                )}
            </ControlRow>
            {canExpression && expressionOpen && expressionError && <p id={`${name}-expression-error`} role="alert" className="ml-[78px] mt-1 text-[10px] text-destructive">
                {t('scene3d.expressionInvalid', { reason: t(`scene3d.expressionErrors.${expressionError}`) })}
            </p>}
        </div>
    );
};

/** Toggle/switch control for boolean parameters */
const ToggleControl = ({ name, label, value, onChange }) => (
    <ControlRow label={label} labelWidth={74}>
        <span style={{ flex: 1 }} />
        <ToggleSwitch ariaLabel={label} checked={!!value} onChange={(on) => onChange(name, on)} />
    </ControlRow>
);

/** Dropdown/select control for enum parameters */
const SelectControl = ({ name, label, value, options, onChange }) => (
    <ControlRow label={label} labelWidth={74}>
        <SelectField
            ariaLabel={label}
            value={value ?? options[0]?.value}
            options={options.map(o => ({ value: o.value, label: o.label ?? o.value }))}
            onChange={(v) => onChange(name, v)}
        />
    </ControlRow>
);

/**
 * Colour picker control.
 *
 * Effects store colour as an RGB array of 0..1 floats for the shader, so this
 * converts both ways; the kit's swatch speaks hex.
 */
const ColorControl = ({ name, label, value, onChange }) => {
    const hex = useMemo(() => {
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) {
            const [r, g, b] = value.map(v => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 255));
            return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
        }
        return '#FFFFFF';
    }, [value]);

    const handleChange = (next) => {
        const h = normalizeHex(next);
        if (!h) return;
        // Back to the 0..1 triple the shader wants. Writing the hex string
        // straight through would be accepted here and render as black.
        onChange(name, [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255));
    };

    return (
        <ControlRow label={label} labelWidth={74}>
            <SwatchRow ariaLabel={label} color={hex} onColor={handleChange} />
        </ControlRow>
    );
};

/** Position/XY control */
const PositionControl = ({ name, label, value, onChange }) => {
    const x = value?.x ?? value?.[0] ?? 0.5;
    const y = value?.y ?? value?.[1] ?? 0.5;
    return (
        <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-4)' }}>
                {label}
            </span>
            <SliderControl
                name={`${name}_x`} label="X" value={x} min={0} max={1} step={0.01}
                onChange={(_, val) => onChange(name, { x: val, y })} canAnimate={false}
                canExpression={false}
            />
            <SliderControl
                name={`${name}_y`} label="Y" value={y} min={0} max={1} step={0.01}
                onChange={(_, val) => onChange(name, { x, y: val })} canAnimate={false}
                canExpression={false}
            />
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
    const { t } = useTranslation('editor');

    // These three hooks must run on EVERY render, so they stay ABOVE the
    // "no parameters" early return below. They used to sit under it, so
    // selecting an effect after that state had rendered called three hooks
    // more than the previous render -- React error #310, which throws out of
    // render and takes the panel down instead of just showing the controls.
    const params = definition?.params || {};
    const currentValues = effect?.params || {};
    const [lutOptions, setLutOptions] = useState([]);
    // useMemo so hasKeyframeAt below keeps a stable identity across renders
    // (a fresh {} literal every render would rebuild it every time).
    const keyframes = useMemo(() => effect?.keyframes || {}, [effect]);

    useEffect(() => {
        if (effect?.type !== 'lut_apply') return undefined;
        let cancelled = false;
        audioEngineAPI.listLUTs({ limit: 100 }).then(({ luts = [] } = {}) => {
            if (cancelled) return;
            const options = luts.map(item => item?.asset || item).filter(lut => lut?.id).map(lut => ({
                value: String(lut.id),
                label: lut.display_name || lut.name || String(lut.id),
            }));
            const selectedId = currentValues.lutId?.value ?? currentValues.lutId;
            if (selectedId && !options.some(option => option.value === String(selectedId))) {
                options.unshift({ value: String(selectedId), label: 'Selected LUT' });
            }
            setLutOptions([{ value: '', label: 'Choose a look' }, ...options]);
        }).catch(error => {
            if (cancelled) return;
            console.warn('[EffectControls] Could not load LUT library:', error.message);
            const selectedId = currentValues.lutId?.value ?? currentValues.lutId;
            setLutOptions(selectedId
                ? [{ value: '', label: 'Choose a look' }, { value: String(selectedId), label: 'Selected LUT' }]
                : [{ value: '', label: 'LUT library unavailable' }]);
        });
        return () => { cancelled = true; };
    }, [effect?.type, currentValues.lutId]);

    const handleParamChange = useCallback((paramName, value) => {
        if (!effect) return;
        // Once a parameter has an animation track, edits at the playhead must
        // change that track. Updating only the static base value would leave
        // the rendered animation untouched and make the control appear broken.
        if ((keyframes[paramName] || []).length > 0) {
            onAddKeyframe(effect.id, paramName, playhead, value);
            return;
        }
        const current = currentValues[paramName];
        onUpdateParams(effect.id, { [paramName]: current && typeof current === 'object'
            ? { ...current, value } : value });
    }, [effect, keyframes, onAddKeyframe, onUpdateParams, playhead]);

    const handleAddKeyframe = useCallback((paramName, value) => {
        if (!effect) return;
        onAddKeyframe(effect.id, paramName, playhead, value);
    }, [effect, playhead, onAddKeyframe]);

    const hasKeyframeAt = useCallback((paramName) => {
        const paramKeyframes = keyframes[paramName];
        if (!paramKeyframes) return false;
        return paramKeyframes.some(k => Math.abs(k.time - playhead) < 0.01);
    }, [keyframes, playhead]);

    if (!effect || !definition) {
        return (
            <div className="text-xs text-muted-foreground text-center py-2">
                {t('effects.noParametersAvailable')}
            </div>
        );
    }

    // Reset to defaults
    const handleReset = () => {
        const defaults = {};
        Object.entries(params).forEach(([key, def]) => {
            defaults[key] = def.value;
        });
        onUpdateParams(effect.id, defaults);
    };

    // R116 - the section's Reset is live only when something actually differs
    // from the definition's defaults, so a header that offers to undo nothing
    // is never shown. `changedKeys` compares numbers with a tolerance: without
    // that, a slider that has landed on 0.1 + 0.2 reads as "changed" forever.
    const defaults = Object.fromEntries(Object.entries(params).map(([k, d]) => [k, d.value]));
    const current = Object.fromEntries(Object.keys(params).map(k => [
        k, currentValues[k]?.value ?? currentValues[k] ?? params[k].value,
    ]));
    const dirty = changedKeys(current, defaults).length > 0;

    // Render controls based on parameter type
    const renderControl = (paramName, paramDef) => {
        const baseValue = currentValues[paramName]?.value ?? currentValues[paramName] ?? paramDef.value;
        // Reflect the value the renderer evaluates at the current playhead.
        // Showing the unanimated base value made an animated parameter look
        // stuck, and edits from this control then jumped back to that base.
        const value = sampleKeyframeTrack(keyframes[paramName], playhead, baseValue);

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
                        expression={currentValues[paramName]?.expression}
                        onExpressionChange={(name, expression) => {
                            const raw = currentValues[name];
                            onUpdateParams(effect.id, { [name]: {
                                ...(raw && typeof raw === 'object' ? raw : { value: raw ?? paramDef.value }),
                                expression,
                            } });
                        }}
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
                        options={name === 'lutId' ? lutOptions : (paramDef.options || [])}
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
        <div>
            {/* Keyframe indicator */}
            {Object.keys(keyframes).length > 0 && (
                <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded mb-2">
                    <Key className="w-3 h-3" />
                    <span>{t('effects.animatedParams', { count: Object.keys(keyframes).length })}</span>
                </div>
            )}

            {/* R116 - one collapsible section carrying its own Reset, the way
                the reference panels group adjustments. Collapsing matters here
                because a stack of three effects is otherwise a wall of
                sliders with no way to put one away. */}
            <PanelSection
                title={definition.name || definition.label || t('effects.parameters', 'Parameters')}
                collapsible
                onReset={dirty ? handleReset : null}
                resetLabel={t('effects.reset', 'Reset')}
            >
                {Object.entries(params).filter(([, def]) => !def.uiHidden).map(([name, def]) => renderControl(name, def))}
            </PanelSection>
        </div>
    );
};

export default EffectControls;
