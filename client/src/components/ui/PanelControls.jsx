import React, { useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Minus, Plus, Upload } from 'lucide-react';
import {
    clampTo, percentOf, snapTo, formatValue, normalizeHex, hexLuminance,
    segmentedKeyMove, trackBackground,
} from './panelControls.js';

/**
 * client/src/components/ui/PanelControls.jsx
 *
 * R116 - one set of panel controls, so TextPanel and the Effects panels stop
 * inventing their own.
 *
 * Every panel in this app had grown its own `S` object of inline styles: its
 * own label size, its own input border, its own idea of how a slider looks.
 * Three panels open side by side therefore looked like three applications.
 * These are the shapes the references actually use - a section with its own
 * Reset, a label-left/control-right row, a segmented control, a number box
 * with a sub-label, a tinted slider track, a swatch + hex + opacity row, a
 * thumbnail grid - built once against the design tokens.
 *
 * Rules kept throughout:
 *  - tokens only (`var(--fg)`, `var(--line)`, ...), so the light theme works
 *    without a second stylesheet;
 *  - every control is reachable and operable from the keyboard, and announces
 *    itself (radiogroup / slider / switch), because a styling pass that
 *    quietly drops keyboard access is a regression wearing a nicer coat;
 *  - the arithmetic lives in panelControls.js and is tested there.
 */

const MONO_LABEL = {
    fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--fg-4)',
};
const FIELD = {
    background: 'var(--glass)', border: '0.5px solid var(--line)',
    borderRadius: 'var(--r-xs)', color: 'var(--fg)',
    fontFamily: 'var(--f-sans)', fontSize: 12, outline: 'none',
    // Explicit, not inherited from a global reset. A `width: 100%` box with
    // 30px of horizontal padding measures 90px under content-box and breaks
    // out of its 58px slot — which is exactly what the first render did. The
    // app happens to set border-box globally; a shared control must not
    // depend on its host's reset.
    boxSizing: 'border-box',
};

/** A titled block with an optional Reset and an optional collapse. */
export const PanelSection = ({
    title, onReset, resetLabel = 'Reset', collapsible = false,
    defaultOpen = true, right = null, children,
}) => {
    const [open, setOpen] = useState(defaultOpen);
    const id = useId();
    const shown = collapsible ? open : true;
    const Chevron = shown ? ChevronDown : ChevronRight;
    return (
        <section style={{ borderTop: '0.5px solid var(--line-soft)', paddingTop: 12, marginTop: 12 }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: shown ? 10 : 0 }}>
                {collapsible ? (
                    <button
                        type="button"
                        onClick={() => setOpen(o => !o)}
                        aria-expanded={shown}
                        aria-controls={id}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 4, background: 'none',
                            border: 0, padding: 0, cursor: 'pointer', ...MONO_LABEL,
                        }}
                    >
                        <Chevron size={11} style={{ opacity: 0.6 }} />
                        <span>{title}</span>
                    </button>
                ) : (
                    <span style={MONO_LABEL}>{title}</span>
                )}
                <span style={{ flex: 1 }} />
                {right}
                {onReset && (
                    // Disabled rather than hidden: a Reset that appears and
                    // disappears makes the header jump every time a slider is
                    // touched.
                    <button
                        type="button"
                        onClick={onReset}
                        style={{
                            ...MONO_LABEL, background: 'none', border: 0, padding: 0,
                            cursor: 'pointer', color: 'var(--fg-3)',
                        }}
                    >
                        {resetLabel}
                    </button>
                )}
            </header>
            {shown && <div id={id} style={{ display: 'grid', gap: 8 }}>{children}</div>}
        </section>
    );
};

/** Label on the left, control on the right. The label column is fixed so rows line up. */
export const ControlRow = ({ label, hint, labelWidth = 62, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 28 }}>
        <span
            title={hint}
            style={{
                width: labelWidth, flexShrink: 0, fontFamily: 'var(--f-sans)',
                fontSize: 11, color: 'var(--fg-3)',
            }}
        >
            {label}
        </span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            {children}
        </div>
    </div>
);

/**
 * A segmented control: one track, one active chip.
 *
 * It is a real radiogroup with roving tabindex, so the whole control is ONE
 * tab stop and the arrows move within it. The earlier panels used rows of
 * plain buttons, which meant tabbing through an alignment control took four
 * presses and announced nothing about what was selected.
 */
export const Segmented = ({ value, options, onChange, ariaLabel, grow = false }) => {
    const refs = useRef([]);
    const at = Math.max(0, options.findIndex(o => o.value === value));
    const onKeyDown = (e) => {
        const next = segmentedKeyMove(e.key, at, options.length);
        if (next === at) return;
        e.preventDefault();
        onChange(options[next].value);
        refs.current[next]?.focus();
    };
    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            onKeyDown={onKeyDown}
            style={{
                display: 'flex', alignItems: 'center', gap: 2, padding: 2,
                borderRadius: 'var(--r-xs)', background: 'var(--glass)',
                border: '0.5px solid var(--line)', width: grow ? '100%' : 'auto',
            }}
        >
            {options.map((opt, i) => {
                const active = opt.value === value;
                const Icon = opt.icon;
                return (
                    <button
                        key={String(opt.value)}
                        ref={el => { refs.current[i] = el; }}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={opt.label || opt.title}
                        title={opt.title || opt.label}
                        tabIndex={active || (at === -1 && i === 0) ? 0 : -1}
                        onClick={() => onChange(opt.value)}
                        style={{
                            flex: grow ? 1 : '0 0 auto',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 4, minWidth: 26, height: 22, padding: Icon ? '0 6px' : '0 9px',
                            borderRadius: 'calc(var(--r-xs) - 2px)', border: 0, cursor: 'pointer',
                            background: active ? 'var(--glass-2)' : 'transparent',
                            // The inset ring is what makes the active chip
                            // readable on the LIGHT theme, where --glass-2 and
                            // --glass are both near-white and the drop shadow
                            // alone is almost invisible.
                            boxShadow: active
                                ? 'inset 0 0 0 0.5px var(--line-strong), 0 1px 2px rgba(0,0,0,0.18)'
                                : 'none',
                            color: active ? 'var(--fg)' : 'var(--fg-3)',
                            fontFamily: 'var(--f-sans)', fontSize: 11,
                            fontWeight: active ? 600 : 500,
                            transition: 'background 0.12s, color 0.12s',
                        }}
                    >
                        {Icon ? <Icon size={13} /> : opt.label}
                    </button>
                );
            })}
        </div>
    );
};

/**
 * Toggles that are INDEPENDENT of each other - bold, italic, underline;
 * shadow, stroke.
 *
 * It looks like `Segmented` and is deliberately not the same component: a
 * radiogroup announces "one of these", and bold+italic together is not one of
 * these. These are buttons with `aria-pressed`, in a plain group.
 */
export const ToggleGroup = ({ items, ariaLabel }) => (
    <div
        role="group"
        aria-label={ariaLabel}
        style={{
            display: 'flex', alignItems: 'center', gap: 2, padding: 2,
            borderRadius: 'var(--r-xs)', background: 'var(--glass)',
            border: '0.5px solid var(--line)',
        }}
    >
        {items.map((item, i) => {
            const Icon = item.icon;
            return (
                <React.Fragment key={item.id}>
                    {item.divider && i > 0 && (
                        <span style={{ width: 1, alignSelf: 'stretch', margin: '2px 2px', background: 'var(--line)' }} />
                    )}
                    <button
                        type="button"
                        aria-pressed={!!item.on}
                        aria-label={item.label}
                        title={item.label}
                        onClick={item.onToggle}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            minWidth: 24, height: 22, padding: Icon ? '0 5px' : '0 8px',
                            borderRadius: 'calc(var(--r-xs) - 2px)', border: 0, cursor: 'pointer',
                            background: item.on ? 'var(--glass-2)' : 'transparent',
                            boxShadow: item.on ? 'inset 0 0 0 0.5px var(--line-strong)' : 'none',
                            color: item.on ? 'var(--fg)' : 'var(--fg-3)',
                            fontFamily: 'var(--f-sans)', fontSize: 10.5,
                            fontWeight: item.on ? 600 : 500,
                            transition: 'background 0.12s, color 0.12s',
                        }}
                    >
                        {Icon ? <Icon size={13} /> : item.label}
                    </button>
                </React.Fragment>
            );
        })}
    </div>
);

/**
 * A number box with an optional unit and a sub-label underneath (the
 * Size / Spacing / Height trio in the reference).
 *
 * It is `type="text"` with `inputMode="decimal"`, not `type="number"`: a
 * number input swallows a partially-typed value ("1." or "-") and reports it
 * as empty, so committing on every keystroke deletes what is being typed. The
 * box therefore keeps its own draft and commits on blur or Enter.
 */
export const NumberField = ({
    value, onChange, min = -Infinity, max = Infinity, step = 1,
    unit = '', subLabel = null, width = '100%',
}) => {
    const [draft, setDraft] = useState(null);
    const shown = draft !== null ? draft : formatValue(value, step);
    const commit = (raw) => {
        setDraft(null);
        const n = Number(String(raw).replace(',', '.').replace(unit, '').trim());
        if (!Number.isFinite(n)) return;      // junk leaves the value alone
        onChange(snapTo(n, min, max, step));
    };
    return (
        // A floor on the width: two of these share a row (size + scale), and
        // without it a three-digit value and its unit overlap — which is what
        // the first render of this panel actually did.
        <div style={{ width, minWidth: 44, boxSizing: 'border-box' }}>
            <div style={{ position: 'relative' }}>
                <input
                    type="text"
                    inputMode="decimal"
                    value={shown}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={(e) => commit(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); e.currentTarget.blur(); }
                        else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
                        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                            e.preventDefault();
                            const base = Number(String(shown).replace(unit, '')) || 0;
                            const by = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? step * 10 : step);
                            setDraft(null);
                            onChange(snapTo(base + by, min, max, step));
                        }
                    }}
                    style={{
                        ...FIELD, width: '100%', height: 26,
                        padding: unit ? '0 22px 0 8px' : '0 8px',
                        fontFamily: 'var(--f-mono)', fontSize: 11,
                    }}
                />
                {unit && (
                    <span style={{
                        position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)',
                        pointerEvents: 'none', fontFamily: 'var(--f-mono)', fontSize: 9,
                        color: 'var(--fg-4)',
                    }}>{unit}</span>
                )}
            </div>
            {subLabel && (
                <div style={{
                    marginTop: 3, textAlign: 'center', fontFamily: 'var(--f-sans)',
                    fontSize: 9.5, color: 'var(--fg-4)',
                }}>{subLabel}</div>
            )}
        </div>
    );
};

/** − value + , for a bounded count or width. */
export const Stepper = ({ value, onChange, min = 0, max = Infinity, step = 1, suffix = '', ariaLabel }) => {
    const btn = (dir, Icon, label) => (
        <button
            type="button"
            onClick={() => onChange(snapTo(Number(value) + dir * step, min, max, step))}
            aria-label={label}
            disabled={dir < 0 ? Number(value) <= min : Number(value) >= max}
            style={{
                width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 0, background: 'transparent', color: 'var(--fg-2)', cursor: 'pointer',
                borderRadius: 'calc(var(--r-xs) - 2px)',
            }}
        >
            <Icon size={12} />
        </button>
    );
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            style={{
                display: 'flex', alignItems: 'center', gap: 2, padding: 2, height: 26,
                borderRadius: 'var(--r-xs)', background: 'var(--glass)', border: '0.5px solid var(--line)',
            }}
        >
            {btn(-1, Minus, 'decrease')}
            <span style={{
                minWidth: 34, textAlign: 'center', fontFamily: 'var(--f-mono)',
                fontSize: 11, color: 'var(--fg)',
            }}>{formatValue(value, step, suffix)}</span>
            {btn(1, Plus, 'increase')}
        </div>
    );
};

/**
 * A slider whose track can carry a colour ramp, with the value in a box at the
 * right (the Adjust Colors reference).
 *
 * The filled portion is drawn as a translucent overlay rather than a solid
 * fill, so a tinted track keeps its ramp while being dragged.
 */
export const TrackSlider = ({
    value, onChange, onCommit, min = 0, max = 100, step = 1,
    tint = null, unit = '', box = true, ariaLabel,
}) => {
    const pct = percentOf(value, min, max);
    const ramp = trackBackground(tint);
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 40, height: 20, display: 'flex', alignItems: 'center' }}>
                <div style={{
                    position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 999,
                    background: ramp || 'var(--glass-2)',
                }} />
                {!ramp && (
                    <div style={{
                        position: 'absolute', left: 0, width: `${pct}%`, height: 4,
                        borderRadius: 999, background: 'var(--accent)',
                    }} />
                )}
                <div style={{
                    position: 'absolute', left: `${pct}%`, transform: 'translateX(-50%)',
                    width: 12, height: 12, borderRadius: '50%', pointerEvents: 'none',
                    background: 'var(--fg)', border: '1.5px solid var(--bg)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                }} />
                <input
                    type="range"
                    aria-label={ariaLabel}
                    min={min} max={max} step={step}
                    value={clampTo(value, min, max)}
                    onChange={(e) => onChange(Number(e.target.value))}
                    // The committed value comes from the EVENT, not from the
                    // prop. A caller that previews with a skipHistory update
                    // has not necessarily re-rendered with the new value by
                    // the time the pointer goes up, so committing `value`
                    // would write the position the drag STARTED from.
                    onPointerUp={(e) => onCommit?.(Number(e.currentTarget.value))}
                    onKeyUp={(e) => onCommit?.(Number(e.currentTarget.value))}
                    style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', margin: 0 }}
                />
            </div>
            {box && (
                // 58, not 46: "180" plus a unit does not fit in 46 at 11px
                // mono, and the unit is drawn OVER the value rather than
                // wrapping, so the overflow is silent.
                <div style={{ width: 58, flexShrink: 0 }}>
                    <NumberField value={value} onChange={onChange} min={min} max={max} step={step} unit={unit} />
                </div>
            )}
        </div>
    );
};

/**
 * Swatch + hex + opacity, the colour row from the Typography reference.
 *
 * The hex box takes a typed value through `normalizeHex`, so "fff" and
 * "#FFFFFF" both work and a half-typed value does not wipe the colour.
 */
export const SwatchRow = ({ color, onColor, opacity = null, onOpacity, ariaLabel }) => {
    const hex = normalizeHex(color) || '#000000';
    const [draft, setDraft] = useState(null);
    const light = hexLuminance(hex) > 0.6;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            <label
                style={{
                    position: 'relative', width: 22, height: 22, flexShrink: 0, cursor: 'pointer',
                    borderRadius: 'calc(var(--r-xs) - 2px)', background: hex,
                    border: `1px solid ${light ? 'var(--line-strong)' : 'var(--line)'}`,
                }}
            >
                <input
                    type="color"
                    aria-label={ariaLabel}
                    value={hex}
                    onChange={(e) => onColor(e.target.value.toUpperCase())}
                    style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                />
            </label>
            <input
                type="text"
                value={draft !== null ? draft : hex}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => { const h = normalizeHex(e.target.value); setDraft(null); if (h) onColor(h); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
                spellCheck={false}
                style={{ ...FIELD, flex: 1, minWidth: 0, height: 26, padding: '0 8px', fontFamily: 'var(--f-mono)', fontSize: 11 }}
            />
            <span style={{ ...MONO_LABEL, flexShrink: 0 }}>hex</span>
            {opacity !== null && (
                <div style={{ width: 54, flexShrink: 0 }}>
                    <NumberField value={opacity} onChange={onOpacity} min={0} max={100} step={1} unit="%" />
                </div>
            )}
        </div>
    );
};

/** A dropdown that matches the rest of the kit. */
export const SelectField = ({ value, options, onChange, ariaLabel, width = '100%' }) => (
    <div style={{ position: 'relative', width, minWidth: 0, boxSizing: 'border-box' }}>
        <select
            aria-label={ariaLabel}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
                ...FIELD, width: '100%', height: 28, padding: '0 26px 0 9px',
                appearance: 'none', cursor: 'pointer',
            }}
        >
            {options.map(o => (
                o.options
                    ? <optgroup key={o.label} label={o.label}>{o.options.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</optgroup>
                    : <option key={String(o.value)} value={o.value}>{o.label}</option>
            ))}
        </select>
        <ChevronDown
            size={13}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--fg-4)' }}
        />
    </div>
);

/** An on/off switch. */
export const ToggleSwitch = ({ checked, onChange, ariaLabel }) => (
    <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={ariaLabel}
        onClick={() => onChange(!checked)}
        style={{
            width: 34, height: 20, borderRadius: 999, flexShrink: 0, cursor: 'pointer', padding: 2,
            border: '0.5px solid var(--line)',
            background: checked ? 'var(--accent)' : 'var(--glass-2)',
            display: 'flex', justifyContent: checked ? 'flex-end' : 'flex-start',
            transition: 'background 0.15s',
        }}
    >
        <span style={{ width: 15, height: 15, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
    </button>
);

/** A grid of labelled previews (the Filters row in the reference). */
export const ThumbGrid = ({ items, value, onChange, columns = 3, ariaLabel }) => (
    <div
        role="radiogroup"
        aria-label={ariaLabel}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 6 }}
    >
        {items.map(item => {
            const active = item.id === value;
            return (
                <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onChange(item.id)}
                    style={{
                        padding: 0, border: 0, background: 'none', cursor: 'pointer',
                        display: 'grid', gap: 4, justifyItems: 'stretch',
                    }}
                >
                    <span style={{
                        height: 52, borderRadius: 'var(--r-xs)', overflow: 'hidden',
                        background: item.preview || 'var(--bg-3)',
                        border: active ? '1.5px solid var(--accent)' : '0.5px solid var(--line)',
                        boxShadow: active ? '0 0 0 2px var(--accent-soft)' : 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {item.node || null}
                    </span>
                    <span style={{
                        fontFamily: 'var(--f-sans)', fontSize: 10, textAlign: 'center',
                        color: active ? 'var(--fg)' : 'var(--fg-3)',
                    }}>{item.label}</span>
                </button>
            );
        })}
    </div>
);

/** A drag-and-drop file well (the Cover Image box in the reference). */
export const DropField = ({ onFile, label, accept = 'image/*', height = 96 }) => {
    const [over, setOver] = useState(false);
    const inputRef = useRef(null);
    const take = (file) => { if (file) onFile(file); };
    return (
        <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer?.files?.[0]); }}
            style={{
                height, borderRadius: 'var(--r-sm)', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 6,
                border: `1px dashed ${over ? 'var(--accent)' : 'var(--line-strong)'}`,
                background: over ? 'var(--accent-soft)' : 'transparent',
                transition: 'border-color 0.15s, background 0.15s',
            }}
        >
            <Upload size={16} style={{ color: 'var(--fg-4)' }} />
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                style={{
                    background: 'none', border: 0, cursor: 'pointer', padding: 0,
                    fontFamily: 'var(--f-sans)', fontSize: 11, color: 'var(--fg-3)',
                }}
            >
                {label}
            </button>
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                onChange={(e) => take(e.target.files?.[0])}
                style={{ display: 'none' }}
            />
        </div>
    );
};

export default {
    PanelSection, ControlRow, Segmented, ToggleGroup, NumberField, Stepper,
    TrackSlider, SwatchRow, SelectField, ToggleSwitch, ThumbGrid, DropField,
};
