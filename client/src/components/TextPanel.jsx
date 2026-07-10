import { useShallow } from 'zustand/react/shallow';
import React, { useState } from 'react';
import useTimelineStore from '../store/useTimelineStore';
import { Type, AlignLeft, AlignCenter, AlignRight, Plus, Bold, Italic, Underline, RotateCcw } from 'lucide-react';
import classNames from 'classnames';

const FONTS = [
    { name: 'Inter',            value: 'Inter, sans-serif' },
    { name: 'Anton',            value: '"Anton", sans-serif' },
    { name: 'Montserrat',       value: '"Montserrat", sans-serif' },
    { name: 'Nunito',           value: '"Nunito", sans-serif' },
    { name: 'Playfair Display', value: '"Playfair Display", serif' },
    { name: 'Caveat',           value: '"Caveat", cursive' },
    { name: 'Oswald',           value: '"Oswald", sans-serif' },
    { name: 'Roboto',           value: '"Roboto", sans-serif' },
];

const ANIMATION_PRESETS = [
    { id: 'none',       label: 'None' },
    { id: 'fade-in',    label: 'Fade in' },
    { id: 'slide-up',   label: 'Slide up' },
    { id: 'pop',        label: 'Pop' },
    { id: 'word-by-word', label: 'Word by word' },
];

// ── Shared style editor (used by both global and per-clip modes) ──────────────
const StyleEditor = ({ clip, onUpdate, showContent = true, showReset = false, onReset }) => {
    if (!clip) return null;
    return (
        <div className="space-y-5">
            {showContent && (
                <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Content</label>
                    <textarea
                        value={clip.content || ''}
                        onChange={(e) => onUpdate({ content: e.target.value })}
                        className="w-full bg-secondary rounded-md p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        rows={2}
                    />
                </div>
            )}

            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Size (px)</label>
                    <input type="number" value={clip.fontSize || 48}
                        onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) })}
                        className="w-full bg-secondary rounded-md p-2 text-sm" />
                </div>
                <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Scale (x)</label>
                    <input type="number" step="0.1" min="0.1" max="5.0" value={clip.scale || 1.0}
                        onChange={(e) => onUpdate({ scale: parseFloat(e.target.value) })}
                        className="w-full bg-secondary rounded-md p-2 text-sm" />
                </div>
            </div>

            <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Font</label>
                <select value={clip.fontFamily || 'Inter'}
                    onChange={(e) => onUpdate({ fontFamily: e.target.value })}
                    className="w-full bg-secondary rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary">
                    {FONTS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
            </div>

            <div className="flex gap-2 p-2 bg-secondary/30 rounded-lg flex-wrap">
                <button onClick={() => onUpdate({ fontWeight: clip.fontWeight === 'bold' ? 'normal' : 'bold' })}
                    className={classNames("p-2 rounded hover:bg-white/10 transition-colors", clip.fontWeight === 'bold' ? "bg-white/20 text-white" : "text-muted-foreground")} title="Bold">
                    <Bold className="w-4 h-4" />
                </button>
                <button onClick={() => onUpdate({ fontStyle: clip.fontStyle === 'italic' ? 'normal' : 'italic' })}
                    className={classNames("p-2 rounded hover:bg-white/10 transition-colors", clip.fontStyle === 'italic' ? "bg-white/20 text-white" : "text-muted-foreground")} title="Italic">
                    <Italic className="w-4 h-4" />
                </button>
                <button onClick={() => onUpdate({ textDecoration: clip.textDecoration === 'underline' ? 'none' : 'underline' })}
                    className={classNames("p-2 rounded hover:bg-white/10 transition-colors", clip.textDecoration === 'underline' ? "bg-white/20 text-white" : "text-muted-foreground")} title="Underline">
                    <Underline className="w-4 h-4" />
                </button>
                <div className="w-px bg-border mx-1" />
                <button onClick={() => onUpdate({ textShadow: clip.textShadow ? null : '2px 2px 4px rgba(0,0,0,0.8)' })}
                    className={classNames("px-2 py-1 text-[10px] rounded hover:bg-white/10 transition-colors border border-transparent", clip.textShadow ? "bg-white/10 border-white/20 text-white" : "text-muted-foreground")}>
                    Shadow
                </button>
                <button onClick={() => onUpdate({ stroke: clip.stroke ? null : { width: 1, color: '#000000' } })}
                    className={classNames("px-2 py-1 text-[10px] rounded hover:bg-white/10 transition-colors border border-transparent", clip.stroke ? "bg-white/10 border-white/20 text-white" : "text-muted-foreground")}>
                    Stroke
                </button>
            </div>

            <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Color</label>
                <div className="flex items-center gap-2">
                    <input type="color" value={clip.color || '#ffffff'}
                        onChange={(e) => onUpdate({ color: e.target.value })}
                        className="w-8 h-8 rounded cursor-pointer bg-transparent border-none" />
                    <span className="text-xs font-mono opacity-50">{clip.color}</span>
                </div>
            </div>

            <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Alignment</label>
                <div className="flex bg-secondary rounded-md p-1">
                    {['left', 'center', 'right'].map(align => (
                        <button key={align} onClick={() => onUpdate({ textAlign: align })}
                            className={`flex-1 p-1 rounded hover:bg-white/10 flex justify-center ${clip.textAlign === align ? 'bg-white/20' : ''}`}>
                            {align === 'left'   && <AlignLeft  className="w-4 h-4" />}
                            {align === 'center' && <AlignCenter className="w-4 h-4" />}
                            {align === 'right'  && <AlignRight  className="w-4 h-4" />}
                        </button>
                    ))}
                </div>
            </div>

            {/* Position */}
            <div className="space-y-3 pt-3 border-t border-border">
                <div className="text-xs font-bold text-muted-foreground">Position</div>
                {[{ key: 'x', label: 'X Axis' }, { key: 'y', label: 'Y Axis' }].map(({ key, label }) => (
                    <div key={key} className="space-y-1">
                        <div className="flex justify-between text-xs"><span>{label}</span><span>{clip[key] ?? 50}%</span></div>
                        <input type="range" min="0" max="100" value={clip[key] ?? 50}
                            onChange={(e) => onUpdate({ [key]: parseInt(e.target.value) })}
                            className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer" />
                    </div>
                ))}
            </div>

            {/* Animation presets (TASK 5) */}
            <div className="space-y-2 pt-3 border-t border-border">
                <div className="text-xs font-bold text-muted-foreground">Animation</div>
                <div className="flex flex-wrap gap-1.5">
                    {ANIMATION_PRESETS.map(preset => (
                        <button key={preset.id}
                            onClick={() => onUpdate({ animation: preset.id === 'none' ? null : preset.id })}
                            className={classNames(
                                "px-2.5 py-1 text-[10px] rounded-full border transition-colors",
                                (clip.animation === preset.id || (!clip.animation && preset.id === 'none'))
                                    ? "border-primary/60 bg-primary/10 text-primary"
                                    : "border-border bg-secondary/40 text-muted-foreground hover:text-white"
                            )}>
                            {preset.label}
                        </button>
                    ))}
                </div>
            </div>

            {showReset && onReset && (
                <button onClick={onReset}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-muted-foreground hover:text-white rounded-md border border-border transition-colors">
                    <RotateCcw className="w-3 h-3" /> Reset to global style
                </button>
            )}
        </div>
    );
};

// ── Per-segment row in individual editing mode ────────────────────────────────
const SegmentRow = ({ clip, trackId, globalStyle, onActivate, isActive }) => {
    const { updateClip } = useTimelineStore.getState();
    const [expanded, setExpanded] = useState(false);

    const handleToggle = () => {
        onActivate(clip.id);
        setExpanded(prev => !prev);
    };

    const handleUpdate = (updates) => updateClip(trackId, clip.id, updates);

    const hasOverrides = Object.keys(globalStyle).some(k => {
        if (k === 'content') return false;
        return clip[k] !== undefined && clip[k] !== globalStyle[k];
    });

    const handleReset = () => {
        const { content, ...styleOnly } = globalStyle;
        updateClip(trackId, clip.id, styleOnly);
    };

    const formatTime = (s) => {
        const m = Math.floor(s / 60);
        const sec = (s % 60).toFixed(1);
        return `${m}:${sec.padStart(4, '0')}`;
    };

    return (
        <div className={classNames("rounded-md border transition-all", isActive ? "border-primary/40 bg-primary/5" : "border-border/40 bg-secondary/20")}>
            <button onClick={handleToggle} className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
                <span className="font-mono text-[9px] text-muted-foreground shrink-0">{formatTime(clip.start)}</span>
                <span className="flex-1 truncate text-xs text-foreground">{clip.content || '—'}</span>
                {hasOverrides && (
                    <span className="text-[9px] text-primary/70 font-mono shrink-0">custom</span>
                )}
                <span className="text-muted-foreground text-xs">{expanded ? '▲' : '▼'}</span>
            </button>
            {expanded && (
                <div className="px-3 pb-3 pt-1 border-t border-border/30">
                    <StyleEditor clip={clip} onUpdate={handleUpdate} showContent showReset={hasOverrides} onReset={handleReset} />
                </div>
            )}
        </div>
    );
};

// ── Main TextPanel ────────────────────────────────────────────────────────────
const TextPanel = () => {
    const { activeClipId, tracks, updateClip, addClip, addTextTrack, setActiveClip } = useTimelineStore(useShallow(state => ({
        activeClipId: state.activeClipId,
        tracks:       state.tracks,
        updateClip:   state.updateClip,
        addClip:      state.addClip,
        addTextTrack: state.addTextTrack,
        setActiveClip: state.setActiveClip,
    })));

    const [applyToAll, setApplyToAll] = useState(true);
    // editMode: 'global' = edit all together (default), 'individual' = per-segment
    const [editMode, setEditMode] = useState('global');

    const activeTrack = tracks.find(t => t.clips.some(c => c.id === activeClipId));
    const activeClip  = activeTrack?.clips.find(c => c.id === activeClipId);
    const isTextClip  = activeTrack?.type === 'text';

    // The text/caption track (may differ from activeTrack if nothing selected)
    const textTrack = tracks.find(t => t.type === 'text');
    const captionClips = textTrack?.clips || [];

    // Global style = first caption clip's style (reference)
    const globalStyle = captionClips[0] || {};

    const handleUpdate = (updates) => {
        if (!activeClip && !textTrack) return;

        if (editMode === 'global' || applyToAll) {
            // Apply styles (not content) to ALL caption clips
            const { content, ...styleOnly } = updates;
            if (Object.keys(styleOnly).length > 0 && textTrack) {
                textTrack.clips.forEach(clip => updateClip(textTrack.id, clip.id, styleOnly));
            }
            // Content only to active clip
            if (content !== undefined && activeTrack && activeClip) {
                updateClip(activeTrack.id, activeClip.id, { content });
            }
        } else if (activeTrack && activeClip) {
            updateClip(activeTrack.id, activeClip.id, updates);
        }
    };

    const handleAddText = (preset) => {
        let track = tracks.find(t => t.type === 'text');
        if (!track) {
            useTimelineStore.getState().addTextTrack();
            track = useTimelineStore.getState().tracks.find(t => t.type === 'text');
        }
        const id = `clip-text-${Date.now()}`;
        addClip(track.id, {
            id, start: useTimelineStore.getState().currentTime, duration: 5,
            name: preset.name, content: preset.content || 'New Text',
            fontFamily: preset.fontFamily || 'Inter',
            fontSize: preset.fontSize || 48,
            color: preset.color || '#ffffff',
            type: 'text',
        });
        setActiveClip(id);
    };

    // ── Individual mode (show list of all caption clips) ──────────────────────
    if (editMode === 'individual') {
        return (
            <div className="space-y-4">
                {/* Mode toggle */}
                <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Captions</div>
                    <div className="flex rounded-md overflow-hidden border border-border text-[10px] font-mono">
                        <button onClick={() => setEditMode('global')}
                            className="px-2.5 py-1 text-muted-foreground hover:text-white transition-colors">
                            Global style
                        </button>
                        <button onClick={() => setEditMode('individual')}
                            className="px-2.5 py-1 bg-primary/10 text-primary border-l border-border">
                            Per segment
                        </button>
                    </div>
                </div>

                {captionClips.length === 0 ? (
                    <div className="p-4 rounded-md border border-dashed border-border text-center">
                        <p className="text-xs text-muted-foreground">No captions yet. Ask the AI to add captions first.</p>
                    </div>
                ) : (
                    <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                        {captionClips
                            .slice()
                            .sort((a, b) => a.start - b.start)
                            .map(clip => (
                                <SegmentRow
                                    key={clip.id}
                                    clip={clip}
                                    trackId={textTrack.id}
                                    globalStyle={globalStyle}
                                    isActive={activeClipId === clip.id}
                                    onActivate={setActiveClip}
                                />
                            ))
                        }
                    </div>
                )}
            </div>
        );
    }

    // ── Global style mode ─────────────────────────────────────────────────────
    if (activeClip && isTextClip) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Text Properties</div>
                    <div className="flex items-center gap-2">
                        {captionClips.length > 1 && (
                            <div className="flex rounded-md overflow-hidden border border-border text-[10px] font-mono">
                                <button onClick={() => setEditMode('global')}
                                    className="px-2.5 py-1 bg-primary/10 text-primary border-r border-border">
                                    Global style
                                </button>
                                <button onClick={() => setEditMode('individual')}
                                    className="px-2.5 py-1 text-muted-foreground hover:text-white transition-colors">
                                    Per segment
                                </button>
                            </div>
                        )}
                        <label className="flex items-center gap-1.5 cursor-pointer group">
                            <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)}
                                className="w-3.5 h-3.5 rounded-sm bg-secondary border-border text-primary focus:ring-primary/50" />
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold group-hover:text-white transition-colors">Apply to All</span>
                        </label>
                        <div className="text-[10px] text-green-400 font-mono">EDITING</div>
                    </div>
                </div>
                <StyleEditor clip={activeClip} onUpdate={handleUpdate} showContent />
            </div>
        );
    }

    // ── Default: Add presets ──────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Add Text</div>
            </div>

            <div className="grid grid-cols-1 gap-3">
                <button onClick={() => handleAddText({ name: 'Heading', content: 'Big Headline', fontSize: 72, fontWeight: 'bold' })}
                    className="p-4 bg-secondary/50 hover:bg-secondary border border-border rounded-lg text-left transition-all hover:scale-[1.02]">
                    <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Heading</h1>
                    <p className="text-[10px] text-muted-foreground mt-1">Large, bold title text.</p>
                </button>
                <button onClick={() => handleAddText({ name: 'Subheading', content: 'Subtitle Text', fontSize: 48, fontWeight: 'medium' })}
                    className="p-4 bg-secondary/50 hover:bg-secondary border border-border rounded-lg text-left transition-all hover:scale-[1.02]">
                    <h2 className="text-lg font-medium text-gray-200">Subheading</h2>
                    <p className="text-[10px] text-muted-foreground mt-1">Secondary text for context.</p>
                </button>
                <button onClick={() => handleAddText({ name: 'Body Text', content: 'Body text content goes here.', fontSize: 24, fontWeight: 'normal' })}
                    className="p-4 bg-secondary/50 hover:bg-secondary border border-border rounded-lg text-left transition-all hover:scale-[1.02]">
                    <p className="text-sm text-gray-400">Body Text</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Small text for descriptions.</p>
                </button>
            </div>

            <div className="pt-4 border-t border-border">
                <button onClick={() => handleAddText({ name: 'Text', content: 'Enter text here', fontSize: 48 })}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-md text-xs font-medium transition-colors">
                    <Plus className="w-3 h-3" /> Add Text Layer
                </button>
            </div>
        </div>
    );
};

export default TextPanel;
