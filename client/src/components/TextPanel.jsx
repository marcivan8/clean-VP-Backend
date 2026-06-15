import { useShallow } from 'zustand/react/shallow';
import React, { useState, useRef } from 'react';
import useTimelineStore from '../store/useTimelineStore';
import { Type, AlignLeft, AlignCenter, AlignRight, Plus, Bold, Italic, Underline } from 'lucide-react';
import classNames from 'classnames';

const FONTS = [
    { name: 'Inter',        css: 'Inter, sans-serif' },
    { name: 'Roboto',       css: '"Roboto", sans-serif' },
    { name: 'Lato',         css: '"Lato", sans-serif' },
    { name: 'Montserrat',   css: '"Montserrat", sans-serif' },
    { name: 'Oswald',       css: '"Oswald", sans-serif' },
    { name: 'Merriweather', css: '"Merriweather", serif' },
    { name: 'Playfair',     css: '"Playfair Display", serif' },
    { name: 'Handwriting',  css: '"Dancing Script", cursive' },
];

// ── Small helpers ─────────────────────────────────────────────────────────────

/** A labelled colour swatch that opens the hidden native picker on click */
const ColorSwatch = ({ label, value, onChange }) => {
    const inputRef = useRef(null);
    const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff';
    return (
        <div className="space-y-1.5">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</label>
            <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => inputRef.current?.click()}
            >
                <div
                    className="w-7 h-7 rounded-md border border-white/20 shadow-inner shrink-0"
                    style={{ background: safe }}
                />
                <span className="text-[11px] font-mono opacity-60 select-none">{safe.toUpperCase()}</span>
                <input
                    ref={inputRef}
                    type="color"
                    value={safe}
                    onChange={onChange}
                    onInput={onChange}
                    className="sr-only"
                    tabIndex={-1}
                />
            </div>
        </div>
    );
};

/** A labelled numeric range slider */
const Slider = ({ label, value, min, max, step = 1, unit = '', onChange }) => (
    <div className="space-y-1">
        <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono opacity-60">{typeof value === 'number' ? value.toFixed(step < 1 ? 2 : 0) : value}{unit}</span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={onChange}
            className="w-full h-1 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
        />
    </div>
);

/** Divider */
const Sep = () => <div className="border-t border-border/40 my-3" />;

// ── Main component ─────────────────────────────────────────────────────────────

const TextPanel = () => {
    const { activeClipId, tracks, updateClip, addClip, addTextTrack, setActiveClip } =
        useTimelineStore(useShallow(s => ({
            activeClipId: s.activeClipId,
            tracks:       s.tracks,
            updateClip:   s.updateClip,
            addClip:      s.addClip,
            addTextTrack: s.addTextTrack,
            setActiveClip: s.setActiveClip,
        })));

    const [applyToAll, setApplyToAll] = useState(false);

    const activeTrack = tracks.find(t => t.clips.some(c => c.id === activeClipId));
    const activeClip  = activeTrack?.clips.find(c => c.id === activeClipId);
    const isTextClip  = activeTrack?.type === 'text';

    // ── Preset presets ─────────────────────────────────────────────────────────
    const handleAddText = (preset) => {
        let textTrack = tracks.find(t => t.type === 'text');
        if (!textTrack) {
            useTimelineStore.getState().addTextTrack();
            textTrack = useTimelineStore.getState().tracks.find(t => t.type === 'text');
        }

        const id = `clip-text-${Date.now()}`;
        addClip(textTrack.id, {
            id,
            start:       useTimelineStore.getState().currentTime,
            duration:    5,
            type:        'text',
            name:        preset.name,
            content:     preset.content   || 'New Text',
            fontFamily:  preset.fontFamily || 'Inter',
            fontSize:    preset.fontSize   || 48,
            fontWeight:  preset.fontWeight || 'normal',
            fontStyle:   preset.fontStyle  || 'normal',
            textAlign:   preset.textAlign  || 'center',
            color:       preset.color      || '#ffffff',
            opacity:     preset.opacity    ?? 1,
            x:           50,
            y:           50,
        });
        setActiveClip(id);
    };

    // ── Update helper ──────────────────────────────────────────────────────────
    const handleUpdate = (updates) => {
        if (!activeTrack || !activeClip) return;
        if (applyToAll) {
            const styleUpdates = { ...updates };
            delete styleUpdates.content;
            if (Object.keys(styleUpdates).length > 0) {
                activeTrack.clips.forEach(c => updateClip(activeTrack.id, c.id, styleUpdates));
            }
            if (updates.content !== undefined) {
                updateClip(activeTrack.id, activeClip.id, { content: updates.content });
            }
        } else {
            updateClip(activeTrack.id, activeClip.id, updates);
        }
    };

    // ── Editing panel ──────────────────────────────────────────────────────────
    if (activeClip && isTextClip) {
        // Safe defaults — mirror what TextOverlay uses so UI state matches rendering
        const textAlign  = activeClip.textAlign  || 'center';
        const fontWeight = activeClip.fontWeight  || 'normal';
        const fontStyle  = activeClip.fontStyle   || 'normal';
        const textDeco   = activeClip.textDecoration || 'none';
        const stroke     = activeClip.stroke;
        const opacity    = activeClip.opacity     ?? 1;

        return (
            <div className="space-y-4 text-sm">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                        Text Properties
                    </span>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={applyToAll}
                                onChange={e => setApplyToAll(e.target.checked)}
                                className="w-3.5 h-3.5 rounded-sm accent-primary"
                            />
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">Apply to All</span>
                        </label>
                        <span className="text-[10px] text-green-400 font-mono">EDITING</span>
                    </div>
                </div>

                {/* Content */}
                <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Content</label>
                    <textarea
                        value={activeClip.content || ''}
                        onChange={e => handleUpdate({ content: e.target.value })}
                        className="w-full bg-secondary rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                        rows={3}
                    />
                </div>

                <Sep />

                {/* Font family + size */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Font</label>
                        <select
                            value={activeClip.fontFamily || 'Inter'}
                            onChange={e => handleUpdate({ fontFamily: e.target.value })}
                            className="w-full bg-secondary rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                            {FONTS.map(f => (
                                <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>
                                    {f.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Size (px)</label>
                        <input
                            type="number"
                            min={8}
                            max={300}
                            value={activeClip.fontSize || 48}
                            onChange={e => handleUpdate({ fontSize: parseInt(e.target.value) || 48 })}
                            className="w-full bg-secondary rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                </div>

                {/* Style toggles */}
                <div className="flex items-center gap-1 p-1.5 bg-secondary/40 rounded-lg">
                    <button
                        onClick={() => handleUpdate({ fontWeight: fontWeight === 'bold' ? 'normal' : 'bold' })}
                        className={classNames('p-1.5 rounded transition-colors', fontWeight === 'bold' ? 'bg-white/20 text-white' : 'text-muted-foreground hover:text-white hover:bg-white/10')}
                        title="Bold"
                    ><Bold className="w-3.5 h-3.5" /></button>

                    <button
                        onClick={() => handleUpdate({ fontStyle: fontStyle === 'italic' ? 'normal' : 'italic' })}
                        className={classNames('p-1.5 rounded transition-colors', fontStyle === 'italic' ? 'bg-white/20 text-white' : 'text-muted-foreground hover:text-white hover:bg-white/10')}
                        title="Italic"
                    ><Italic className="w-3.5 h-3.5" /></button>

                    <button
                        onClick={() => handleUpdate({ textDecoration: textDeco === 'underline' ? 'none' : 'underline' })}
                        className={classNames('p-1.5 rounded transition-colors', textDeco === 'underline' ? 'bg-white/20 text-white' : 'text-muted-foreground hover:text-white hover:bg-white/10')}
                        title="Underline"
                    ><Underline className="w-3.5 h-3.5" /></button>

                    <div className="w-px h-4 bg-white/10 mx-0.5" />

                    <button
                        onClick={() => handleUpdate({ textShadow: activeClip.textShadow ? null : '2px 2px 6px rgba(0,0,0,0.85)' })}
                        className={classNames('px-2 py-1 text-[10px] rounded transition-colors', activeClip.textShadow ? 'bg-white/20 text-white' : 'text-muted-foreground hover:text-white hover:bg-white/10')}
                    >Shadow</button>

                    <button
                        onClick={() => handleUpdate({ stroke: stroke ? null : { width: 2, color: '#000000' } })}
                        className={classNames('px-2 py-1 text-[10px] rounded transition-colors', stroke ? 'bg-white/20 text-white' : 'text-muted-foreground hover:text-white hover:bg-white/10')}
                    >Stroke</button>
                </div>

                {/* Stroke controls (visible only when stroke is active) */}
                {stroke && (
                    <div className="grid grid-cols-2 gap-2 pl-1 border-l-2 border-white/20">
                        <ColorSwatch
                            label="Stroke color"
                            value={stroke.color || '#000000'}
                            onChange={e => handleUpdate({ stroke: { ...stroke, color: e.target.value } })}
                        />
                        <div className="space-y-1.5">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Width (px)</label>
                            <input
                                type="number"
                                min={1}
                                max={20}
                                value={stroke.width || 2}
                                onChange={e => handleUpdate({ stroke: { ...stroke, width: parseInt(e.target.value) || 1 } })}
                                className="w-full bg-secondary rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    </div>
                )}

                <Sep />

                {/* Colours row */}
                <div className="grid grid-cols-2 gap-3">
                    <ColorSwatch
                        label="Text color"
                        value={activeClip.color || '#ffffff'}
                        onChange={e => handleUpdate({ color: e.target.value })}
                    />
                    <ColorSwatch
                        label="Background"
                        value={activeClip.bgColor || '#00000000'}
                        onChange={e => handleUpdate({ bgColor: e.target.value })}
                    />
                </div>

                <Sep />

                {/* Alignment */}
                <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Alignment</label>
                    <div className="flex bg-secondary/60 rounded-md p-1 gap-0.5">
                        {[
                            { key: 'left',   Icon: AlignLeft },
                            { key: 'center', Icon: AlignCenter },
                            { key: 'right',  Icon: AlignRight },
                        ].map(({ key, Icon }) => (
                            <button
                                key={key}
                                onClick={() => handleUpdate({ textAlign: key })}
                                className={classNames(
                                    'flex-1 py-1.5 rounded flex justify-center transition-colors',
                                    textAlign === key ? 'bg-white/25 text-white' : 'text-muted-foreground hover:text-white hover:bg-white/10'
                                )}
                                title={key.charAt(0).toUpperCase() + key.slice(1)}
                            >
                                <Icon className="w-3.5 h-3.5" />
                            </button>
                        ))}
                    </div>
                </div>

                <Sep />

                {/* Opacity */}
                <Slider
                    label="Opacity"
                    value={Math.round(opacity * 100)}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={e => handleUpdate({ opacity: parseInt(e.target.value) / 100 })}
                />

                {/* Scale */}
                <Slider
                    label="Scale"
                    value={activeClip.scale ?? 1}
                    min={0.1}
                    max={5}
                    step={0.05}
                    onChange={e => handleUpdate({ scale: parseFloat(e.target.value) })}
                />

                <Sep />

                {/* Position */}
                <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Position</label>
                    <Slider
                        label="X"
                        value={activeClip.x ?? 50}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={e => handleUpdate({ x: parseInt(e.target.value) })}
                    />
                    <Slider
                        label="Y"
                        value={activeClip.y ?? 50}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={e => handleUpdate({ y: parseInt(e.target.value) })}
                    />
                </div>
            </div>
        );
    }

    // ── Default "add text" view ────────────────────────────────────────────────
    return (
        <div className="space-y-5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">Add Text</div>

            <div className="grid grid-cols-1 gap-2">
                <button
                    onClick={() => handleAddText({ name: 'Heading', content: 'Big Headline', fontSize: 72, fontWeight: 'bold' })}
                    className="p-4 bg-secondary/50 hover:bg-secondary border border-border rounded-lg text-left transition-all hover:scale-[1.01]"
                >
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Heading</h1>
                    <p className="text-[10px] text-muted-foreground mt-1">Large, bold title text</p>
                </button>

                <button
                    onClick={() => handleAddText({ name: 'Subheading', content: 'Subtitle Text', fontSize: 48, fontWeight: '500' })}
                    className="p-4 bg-secondary/50 hover:bg-secondary border border-border rounded-lg text-left transition-all hover:scale-[1.01]"
                >
                    <h2 className="text-lg font-medium text-gray-200">Subheading</h2>
                    <p className="text-[10px] text-muted-foreground mt-1">Secondary text for context</p>
                </button>

                <button
                    onClick={() => handleAddText({ name: 'Body Text', content: 'Body text content goes here.', fontSize: 24, fontWeight: 'normal' })}
                    className="p-4 bg-secondary/50 hover:bg-secondary border border-border rounded-lg text-left transition-all hover:scale-[1.01]"
                >
                    <p className="text-sm text-gray-400">Body Text</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Small text for descriptions</p>
                </button>

                <button
                    onClick={() => handleAddText({ name: 'Lower Third', content: 'Name · Title', fontSize: 32, fontWeight: 'normal', y: 82, textAlign: 'left', x: 15 })}
                    className="p-4 bg-secondary/50 hover:bg-secondary border border-border rounded-lg text-left transition-all hover:scale-[1.01]"
                >
                    <p className="text-sm text-gray-400">Lower Third</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Name / title bar at the bottom</p>
                </button>
            </div>

            <div className="pt-1">
                <button
                    onClick={() => handleAddText({ name: 'Text', content: 'Enter text here', fontSize: 48 })}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-md text-xs font-medium transition-colors"
                >
                    <Plus className="w-3 h-3" /> Add Text Layer
                </button>
            </div>
        </div>
    );
};

export default TextPanel;
