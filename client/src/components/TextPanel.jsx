import { useShallow } from 'zustand/react/shallow';
import React, { useState } from 'react';
import useTimelineStore from '../store/useTimelineStore';
import { AlignLeft, AlignCenter, AlignRight, Plus, Bold, Italic, Underline, RotateCcw, Type } from 'lucide-react';

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
    { id: 'none',         label: 'None' },
    { id: 'fade-in',      label: 'Fade in' },
    { id: 'slide-up',     label: 'Slide up' },
    { id: 'pop',          label: 'Pop' },
    { id: 'word-by-word', label: 'Word by word' },
];

// ── Shared style tokens ────────────────────────────────────────────────────────
const S = {
    label:   { fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em' },
    section: { borderTop: '0.5px solid var(--line-soft)', paddingTop: 12, marginTop: 12 },
    input:   { background: 'rgba(255,255,255,0.05)', border: '0.5px solid var(--line)', borderRadius: 6, padding: '5px 8px', color: 'var(--fg)', fontFamily: 'var(--f-sans)', fontSize: 12, width: '100%', outline: 'none' },
    select:  { background: 'rgba(255,255,255,0.05)', border: '0.5px solid var(--line)', borderRadius: 6, padding: '5px 8px', color: 'var(--fg)', fontFamily: 'var(--f-sans)', fontSize: 12, width: '100%', outline: 'none' },
    row:     { display: 'flex', gap: 8 },
    pill:    (active) => ({
        padding: '3px 10px', borderRadius: 999, fontSize: 10, fontFamily: 'var(--f-mono)',
        border: active ? '1px solid var(--accent)' : '0.5px solid var(--line)',
        background: active ? 'color-mix(in oklch, var(--accent) 15%, transparent)' : 'rgba(255,255,255,0.04)',
        color: active ? 'var(--accent)' : 'var(--fg-3)',
        cursor: 'pointer', transition: 'all 0.15s',
    }),
    iconBtn: (active) => ({
        padding: 6, borderRadius: 5, cursor: 'pointer',
        background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
        color: active ? 'var(--fg)' : 'var(--fg-4)',
        border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.1s',
    }),
};

// ── Shared style editor ────────────────────────────────────────────────────────
// onUpdate       — commit change to history (buttons, select, etc.)
// onLiveUpdate   — skipHistory drag preview; onUpdate fires on pointerUp to commit
const StyleEditor = ({ clip, onUpdate, onLiveUpdate, showContent = true, showReset = false, onReset }) => {
    // Fall back to onUpdate if no live variant provided
    const live = onLiveUpdate || onUpdate;
    if (!clip) return null;

    const activeAnim = clip.animation || 'none';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {showContent && (
                <div style={{ marginBottom: 12 }}>
                    <div style={{ ...S.label, marginBottom: 4 }}>Content</div>
                    <textarea
                        value={clip.content || ''}
                        onChange={(e) => onUpdate({ content: e.target.value })}
                        style={{ ...S.input, resize: 'vertical', minHeight: 52, lineHeight: 1.4 }}
                        rows={2}
                    />
                </div>
            )}

            <div style={{ ...S.row, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                    <div style={{ ...S.label, marginBottom: 4 }}>Size</div>
                    <input type="number" value={clip.fontSize || 48}
                        onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) })}
                        style={S.input} />
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ ...S.label, marginBottom: 4 }}>Scale</div>
                    <input type="number" step="0.1" min="0.1" max="5.0" value={clip.scale || 1.0}
                        onChange={(e) => onUpdate({ scale: parseFloat(e.target.value) })}
                        style={S.input} />
                </div>
            </div>

            <div style={{ marginBottom: 12 }}>
                <div style={{ ...S.label, marginBottom: 4 }}>Font</div>
                <select value={clip.fontFamily || 'Inter'}
                    onChange={(e) => onUpdate({ fontFamily: e.target.value })}
                    style={S.select}>
                    {FONTS.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
            </div>

            {/* Style buttons */}
            <div style={{ display: 'flex', gap: 4, padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '0.5px solid var(--line)', marginBottom: 12, flexWrap: 'wrap' }}>
                <button style={S.iconBtn(clip.fontWeight === 'bold')}
                    onClick={() => onUpdate({ fontWeight: clip.fontWeight === 'bold' ? 'normal' : 'bold' })}>
                    <Bold size={13} />
                </button>
                <button style={S.iconBtn(clip.fontStyle === 'italic')}
                    onClick={() => onUpdate({ fontStyle: clip.fontStyle === 'italic' ? 'normal' : 'italic' })}>
                    <Italic size={13} />
                </button>
                <button style={S.iconBtn(clip.textDecoration === 'underline')}
                    onClick={() => onUpdate({ textDecoration: clip.textDecoration === 'underline' ? 'none' : 'underline' })}>
                    <Underline size={13} />
                </button>
                <div style={{ width: '0.5px', background: 'var(--line)', margin: '0 2px' }} />
                <button
                    style={{ ...S.iconBtn(!!clip.textShadow), padding: '4px 8px', fontSize: 10, fontFamily: 'var(--f-mono)' }}
                    onClick={() => onUpdate({ textShadow: clip.textShadow ? null : '2px 2px 4px rgba(0,0,0,0.8)' })}>
                    Shadow
                </button>
                <button
                    style={{ ...S.iconBtn(!!clip.stroke), padding: '4px 8px', fontSize: 10, fontFamily: 'var(--f-mono)' }}
                    onClick={() => onUpdate({ stroke: clip.stroke ? null : { width: 1, color: '#000000' } })}>
                    Stroke
                </button>
            </div>

            {/* Color */}
            <div style={{ marginBottom: 12 }}>
                <div style={{ ...S.label, marginBottom: 6 }}>Color</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="color" value={clip.color || '#ffffff'}
                        onChange={(e) => onUpdate({ color: e.target.value })}
                        style={{ width: 28, height: 28, border: '0.5px solid var(--line)', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 2 }} />
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)' }}>{clip.color || '#ffffff'}</span>
                </div>
            </div>

            {/* Alignment */}
            <div style={{ marginBottom: 12 }}>
                <div style={{ ...S.label, marginBottom: 6 }}>Alignment</div>
                <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 6, border: '0.5px solid var(--line)', padding: 3, gap: 2 }}>
                    {[
                        { align: 'left',   Icon: AlignLeft },
                        { align: 'center', Icon: AlignCenter },
                        { align: 'right',  Icon: AlignRight },
                    ].map(({ align, Icon }) => (
                        <button key={align} onClick={() => onUpdate({ textAlign: align })}
                            style={{ flex: 1, padding: 5, borderRadius: 4, border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center',
                                background: clip.textAlign === align ? 'rgba(255,255,255,0.10)' : 'transparent',
                                color: clip.textAlign === align ? 'var(--fg)' : 'var(--fg-4)' }}>
                            <Icon size={13} />
                        </button>
                    ))}
                </div>
            </div>

            {/* Position */}
            <div style={S.section}>
                <div style={{ ...S.label, marginBottom: 10 }}>Position</div>
                {[{ key: 'x', label: 'X Axis' }, { key: 'y', label: 'Y Axis' }].map(({ key, label }) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontFamily: 'var(--f-sans)', fontSize: 11, color: 'var(--fg-3)' }}>{label}</span>
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)' }}>{clip[key] ?? 50}%</span>
                        </div>
                        <input type="range" min="0" max="100" value={clip[key] ?? 50}
                            onChange={(e) => live({ [key]: parseInt(e.target.value) })}
                            onPointerUp={(e) => onUpdate({ [key]: parseInt(e.target.value) })}
                            style={{ width: '100%', accentColor: 'var(--accent)', height: 3, cursor: 'pointer' }} />
                    </div>
                ))}
            </div>

            {/* Animation */}
            <div style={S.section}>
                <div style={{ ...S.label, marginBottom: 8 }}>Animation</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {ANIMATION_PRESETS.map(preset => (
                        <button key={preset.id}
                            onClick={() => onUpdate({ animation: preset.id === 'none' ? null : preset.id })}
                            style={S.pill(activeAnim === preset.id)}>
                            {preset.label}
                        </button>
                    ))}
                </div>
            </div>

            {showReset && onReset && (
                <button onClick={onReset}
                    style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        padding: '6px 0', borderRadius: 6, background: 'transparent',
                        border: '0.5px solid var(--line)', color: 'var(--fg-4)',
                        fontFamily: 'var(--f-mono)', fontSize: 9, textTransform: 'uppercase',
                        letterSpacing: '0.06em', cursor: 'pointer', width: '100%' }}>
                    <RotateCcw size={10} /> Reset to global style
                </button>
            )}
        </div>
    );
};

// ── Per-segment row ────────────────────────────────────────────────────────────
const SegmentRow = ({ clip, trackId, globalStyle, onActivate, isActive }) => {
    const { updateClip } = useTimelineStore.getState();
    const [expanded, setExpanded] = useState(false);

    const handleToggle = () => { onActivate(clip.id); setExpanded(p => !p); };
    const handleUpdate = (updates) => updateClip(trackId, clip.id, updates);

    const hasOverrides = Object.keys(globalStyle).some(k => {
        if (k === 'content') return false;
        return clip[k] !== undefined && clip[k] !== globalStyle[k];
    });

    const handleReset = () => {
        const { content, ...styleOnly } = globalStyle;
        updateClip(trackId, clip.id, styleOnly);
    };

    const fmt = (s) => { const m = Math.floor(s / 60); return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`; };

    return (
        <div style={{
            borderRadius: 7,
            border: isActive ? '0.5px solid color-mix(in oklch, var(--accent) 50%, transparent)' : '0.5px solid var(--line)',
            background: isActive ? 'color-mix(in oklch, var(--accent) 6%, transparent)' : 'rgba(255,255,255,0.02)',
            marginBottom: 4,
            overflow: 'hidden',
        }}>
            <button onClick={handleToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', flexShrink: 0 }}>{fmt(clip.start)}</span>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--fg-2)', fontFamily: 'var(--f-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.content || '—'}</span>
                {hasOverrides && <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'var(--accent)', flexShrink: 0 }}>custom</span>}
                <span style={{ color: 'var(--fg-4)', fontSize: 9 }}>{expanded ? '▲' : '▼'}</span>
            </button>
            {expanded && (
                <div style={{ padding: '4px 10px 10px', borderTop: '0.5px solid var(--line-soft)' }}>
                    <StyleEditor clip={clip} onUpdate={handleUpdate} showContent showReset={hasOverrides} onReset={handleReset} />
                </div>
            )}
        </div>
    );
};

// ── Mode toggle ────────────────────────────────────────────────────────────────
const ModeToggle = ({ mode, onChange }) => (
    <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '0.5px solid var(--line)', flexShrink: 0 }}>
        {['global', 'individual'].map((m) => (
            <button key={m} onClick={() => onChange(m)}
                style={{
                    padding: '4px 10px', border: 'none', cursor: 'pointer',
                    fontFamily: 'var(--f-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em',
                    background: mode === m ? 'color-mix(in oklch, var(--accent) 14%, transparent)' : 'transparent',
                    color: mode === m ? 'var(--accent)' : 'var(--fg-4)',
                    borderLeft: m === 'individual' ? '0.5px solid var(--line)' : 'none',
                    transition: 'all 0.15s',
                }}>
                {m === 'global' ? 'Global' : 'Per segment'}
            </button>
        ))}
    </div>
);

// ── Main TextPanel ─────────────────────────────────────────────────────────────
const TextPanel = () => {
    const { activeClipId, tracks, updateClip, addClip, addTextTrack, setActiveClip } = useTimelineStore(useShallow(state => ({
        activeClipId:  state.activeClipId,
        tracks:        state.tracks,
        updateClip:    state.updateClip,
        addClip:       state.addClip,
        addTextTrack:  state.addTextTrack,
        setActiveClip: state.setActiveClip,
    })));

    const [editMode, setEditMode] = useState('global');

    const activeTrack = tracks.find(t => t.clips.some(c => c.id === activeClipId));
    const activeClip  = activeTrack?.clips.find(c => c.id === activeClipId);
    const isTextClip  = activeTrack?.type === 'text';

    const textTrack    = tracks.find(t => t.type === 'text');
    const captionClips = textTrack?.clips || [];
    const globalStyle  = captionClips[0] || {};

    const handleUpdate = (updates, skipHistory = false) => {
        if (!activeClip && !textTrack) return;
        const opts = skipHistory ? { skipHistory: true } : undefined;

        if (editMode === 'global') {
            const { content, ...styleOnly } = updates;
            if (Object.keys(styleOnly).length > 0 && textTrack) {
                textTrack.clips.forEach(clip => updateClip(textTrack.id, clip.id, styleOnly, opts));
            }
            if (content !== undefined && activeTrack && activeClip) {
                updateClip(activeTrack.id, activeClip.id, { content }, opts);
            }
        } else if (activeTrack && activeClip) {
            updateClip(activeTrack.id, activeClip.id, updates, opts);
        }
    };

    // Live update: no history entry (called on every slider pixel during drag)
    const handleLiveUpdate = (updates) => handleUpdate(updates, true);

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

    // ── Individual mode ────────────────────────────────────────────────────────
    if (editMode === 'individual') {
        return (
            <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Captions</span>
                    <ModeToggle mode="individual" onChange={setEditMode} />
                </div>

                {captionClips.length === 0 ? (
                    <div style={{ padding: 20, borderRadius: 8, border: '0.5px dashed var(--line)', textAlign: 'center' }}>
                        <p style={{ fontFamily: 'var(--f-sans)', fontSize: 11, color: 'var(--fg-4)' }}>No captions yet. Ask the AI to add captions first.</p>
                    </div>
                ) : (
                    <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
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

    // ── Global mode (clip selected) ────────────────────────────────────────────
    if (activeClip && isTextClip) {
        return (
            <div>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0 }}>
                        Text Properties
                    </span>
                    {captionClips.length > 1 && (
                        <ModeToggle mode="global" onChange={setEditMode} />
                    )}
                </div>
                <StyleEditor clip={activeClip} onUpdate={handleUpdate} onLiveUpdate={handleLiveUpdate} showContent />
            </div>
        );
    }

    // ── Default: Add presets ───────────────────────────────────────────────────
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                <Type size={13} style={{ color: 'var(--fg-4)' }} />
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Add Text</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {[
                    { name: 'Heading',    content: 'Big Headline', fontSize: 72, fontWeight: 'bold',   preview: { fontSize: 20, fontWeight: 700 }, sub: 'Large, bold title text.' },
                    { name: 'Subheading', content: 'Subtitle Text', fontSize: 48, fontWeight: 'medium', preview: { fontSize: 14, fontWeight: 500 }, sub: 'Secondary text for context.' },
                    { name: 'Body Text',  content: 'Body text content goes here.', fontSize: 24,       preview: { fontSize: 11, fontWeight: 400 }, sub: 'Small text for descriptions.' },
                ].map(preset => (
                    <button key={preset.name} onClick={() => handleAddText(preset)}
                        style={{ padding: 14, background: 'rgba(255,255,255,0.03)', border: '0.5px solid var(--line)', borderRadius: 8, textAlign: 'left', cursor: 'pointer', transition: 'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}>
                        <div style={{ ...preset.preview, fontFamily: 'var(--f-sans)', color: 'var(--fg)', marginBottom: 3 }}>{preset.name}</div>
                        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)' }}>{preset.sub}</div>
                    </button>
                ))}
            </div>

            <div style={{ borderTop: '0.5px solid var(--line)', paddingTop: 12 }}>
                <button onClick={() => handleAddText({ name: 'Text', content: 'Enter text here', fontSize: 48 })}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        padding: '8px 0', borderRadius: 7, cursor: 'pointer',
                        background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                        border: '0.5px solid color-mix(in oklch, var(--accent) 30%, transparent)',
                        color: 'var(--accent)', fontFamily: 'var(--f-mono)', fontSize: 10,
                        textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <Plus size={12} /> Add Text Layer
                </button>
            </div>
        </div>
    );
};

export default TextPanel;
