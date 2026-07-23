import { useShallow } from 'zustand/react/shallow';
import React, { useState, useRef, useEffect } from 'react';
import useTimelineStore from '../store/useTimelineStore';
import { AlignLeft, AlignCenter, AlignRight, Plus, Bold, Italic, Underline, RotateCcw, Type } from 'lucide-react';

const FONT_GROUPS = [
    { group: 'Talking Head',       fonts: ['Anton', 'Bebas Neue', 'Montserrat', 'Inter', 'Barlow Condensed'] },
    { group: 'Podcast / Doc',      fonts: ['Playfair Display', 'Lora', 'Merriweather', 'DM Serif Display', 'Cormorant Garamond'] },
    { group: 'Lifestyle / Vlog',   fonts: ['Nunito', 'Poppins', 'Quicksand', 'Josefin Sans', 'Raleway'] },
    { group: 'Gaming / Tech',      fonts: ['Rajdhani', 'Exo 2', 'Orbitron', 'Oxanium', 'Roboto Condensed'] },
    { group: 'Motivational',       fonts: ['Oswald', 'Teko', 'Black Han Sans', 'Saira Condensed', 'Cabin'] },
    { group: 'Handwritten',        fonts: ['Caveat', 'Pacifico', 'Kalam', 'Satisfy', 'Dancing Script'] },
    { group: 'Neon / Glow',        fonts: ['Boogaloo', 'Righteous', 'Press Start 2P', 'Audiowide'] },
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
// livePos        — { x, y } override from parent's drag state (avoids reading stale clip)
const StyleEditor = ({ clip, onUpdate, onLiveUpdate, livePos, showContent = true, showReset = false, onReset }) => {
    // Fall back to onUpdate if no live variant provided
    const live = onLiveUpdate || onUpdate;

    // Local state for number inputs — prevents fan-out on every keystroke.
    // Committed to the store on blur or Enter; cleared when clip identity changes.
    const [localFontSize, setLocalFontSize] = useState(null);
    const [localScale,    setLocalScale]    = useState(null);
    const prevClipRef = useRef(null);

    useEffect(() => {
        // When a different clip is displayed, discard any locally typed-but-uncommitted values
        if (prevClipRef.current !== clip?.id) {
            setLocalFontSize(null);
            setLocalScale(null);
            prevClipRef.current = clip?.id;
        }
    });

    if (!clip) return null;

    const activeAnim   = clip.animation || 'none';
    const displayX     = livePos?.x ?? clip.x ?? 50;
    const displayY     = livePos?.y ?? clip.y ?? 50;

    const commitFontSize = () => {
        if (localFontSize !== null) { onUpdate({ fontSize: localFontSize }); setLocalFontSize(null); }
    };
    const commitScale = () => {
        if (localScale !== null) { onUpdate({ scale: localScale }); setLocalScale(null); }
    };

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
                    <input
                        type="number"
                        value={localFontSize ?? (clip.fontSize || 48)}
                        onChange={(e) => setLocalFontSize(parseInt(e.target.value) || 1)}
                        onBlur={commitFontSize}
                        onKeyDown={(e) => { if (e.key === 'Enter') { commitFontSize(); e.target.blur(); } }}
                        style={S.input} />
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ ...S.label, marginBottom: 4 }}>Scale</div>
                    <input
                        type="number" step="0.1" min="0.1" max="5.0"
                        value={localScale ?? (clip.scale || 1.0)}
                        onChange={(e) => setLocalScale(parseFloat(e.target.value) || 0.1)}
                        onBlur={commitScale}
                        onKeyDown={(e) => { if (e.key === 'Enter') { commitScale(); e.target.blur(); } }}
                        style={S.input} />
                </div>
            </div>

            <div style={{ marginBottom: 12 }}>
                <div style={{ ...S.label, marginBottom: 4 }}>Font</div>
                <select value={clip.fontFamily || 'Inter'}
                    onChange={(e) => onUpdate({ fontFamily: e.target.value })}
                    style={S.select}>
                    {FONT_GROUPS.map(g => (
                        <optgroup key={g.group} label={g.group}>
                            {g.fonts.map(f => <option key={f} value={f}>{f}</option>)}
                        </optgroup>
                    ))}
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
                {[{ key: 'x', label: 'X Axis', display: displayX }, { key: 'y', label: 'Y Axis', display: displayY }].map(({ key, label, display }) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontFamily: 'var(--f-sans)', fontSize: 11, color: 'var(--fg-3)' }}>{label}</span>
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)' }}>{display}%</span>
                        </div>
                        <input type="range" min="0" max="100" value={display}
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
    const [expanded, setExpanded] = useState(false);

    const handleToggle = () => { onActivate(clip.id); setExpanded(p => !p); };
    const handleUpdate = (updates) => {
        const store = useTimelineStore.getState();
        store.saveToHistory?.();
        store.updateClip(trackId, clip.id, updates, { skipHistory: true });
    };

    const hasOverrides = Object.keys(globalStyle).some(k => {
        if (k === 'content') return false;
        return clip[k] !== undefined && clip[k] !== globalStyle[k];
    });

    const handleReset = () => {
        const { content, ...styleOnly } = globalStyle;
        const store = useTimelineStore.getState();
        store.saveToHistory?.();
        store.updateClip(trackId, clip.id, styleOnly, { skipHistory: true });
    };

    const fmt = (s) => { const m = Math.floor(s / 60); return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`; };

    return (
        <div style={{
            borderRadius: 5,
            border: isActive
                ? '1px solid color-mix(in oklch, var(--accent) 55%, transparent)'
                : '1px solid var(--line)',
            background: isActive ? 'color-mix(in oklch, var(--accent) 7%, transparent)' : 'rgba(255,255,255,0.03)',
            marginBottom: 3,
            overflow: 'hidden',
        }}>
            <button onClick={handleToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: 'var(--fg-4)', flexShrink: 0, letterSpacing: '0.02em' }}>{fmt(clip.start)}</span>
                <span style={{ flex: 1, fontSize: 10, color: 'var(--fg-2)', fontFamily: 'var(--f-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{clip.content || '—'}</span>
                {hasOverrides && <span style={{ fontFamily: 'var(--f-mono)', fontSize: 7, color: 'var(--accent)', flexShrink: 0, letterSpacing: '0.04em' }}>custom</span>}
                <span style={{ color: 'var(--fg-4)', fontSize: 8 }}>{expanded ? '▲' : '▼'}</span>
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
    const { activeClipId, tracks, addClip, setActiveClip } = useTimelineStore(useShallow(state => ({
        activeClipId:  state.activeClipId,
        tracks:        state.tracks,
        addClip:       state.addClip,
        setActiveClip: state.setActiveClip,
    })));

    const [editMode, setEditMode] = useState('global');
    const [globalFlash, setGlobalFlash] = useState(false);
    // Live drag state: holds position/style values being dragged before store commit.
    // Prevents the N-clip fan-out from firing on every drag pixel.
    const [liveOverride, setLiveOverride] = useState({});

    const activeTrack = tracks.find(t => t.clips.some(c => c.id === activeClipId));
    const activeClip  = activeTrack?.clips.find(c => c.id === activeClipId);
    const isTextClip  = activeTrack?.type === 'text';

    const textTrack    = tracks.find(t => t.type === 'text');
    const captionClips = textTrack?.clips || [];
    // Representative clip for global mode display: prefer the active text clip,
    // fall back to the first caption clip so the editor is always populated.
    const globalStyle  = captionClips[0] || {};
    const baseClip     = (activeClip && isTextClip) ? activeClip : globalStyle;
    // Merge live-drag overrides so the panel UI reflects drag instantly,
    // without waiting for the store update to propagate back through Zustand.
    const displayClip  = Object.keys(liveOverride).length > 0
        ? { ...baseClip, ...liveOverride }
        : baseClip;

    const handleUpdate = (updates, skipHistory = false) => {
        // Clear any pending live-drag overrides before committing to the store.
        // (setLiveOverride is async, but the store fan-out below is what actually
        // matters; the state flush happens on the same React tick.)
        if (!skipHistory) setLiveOverride({});

        // Always read fresh from the store — avoids stale-closure issues when
        // multiple clips are updated in the same event (N _saveHistory calls
        // would create N intermediate undo entries and risk partial fan-out).
        const store       = useTimelineStore.getState();
        const freshTracks = store.tracks;
        const freshText   = freshTracks.find(t => t.type === 'text');
        const freshActTrk = freshTracks.find(t => t.clips.some(c => c.id === activeClipId));
        const freshActClp = freshActTrk?.clips.find(c => c.id === activeClipId);
        const freshIsText = freshActTrk?.type === 'text';

        if (!freshText && !freshActTrk) return;

        if (editMode === 'global') {
            const { content, ...styleOnly } = updates;
            if (Object.keys(styleOnly).length > 0 && freshText) {
                // ONE history entry for the entire batch
                if (!skipHistory) store.saveToHistory?.();
                freshText.clips.forEach(clip =>
                    store.updateClip(freshText.id, clip.id, styleOnly, { skipHistory: true })
                );
                // Flash the count badge so the user can see the fan-out happened
                if (!skipHistory) {
                    setGlobalFlash(true);
                    setTimeout(() => setGlobalFlash(false), 900);
                }
            }
            // Content is per-segment — update only the active caption clip
            if (content !== undefined && freshIsText && freshActTrk && freshActClp) {
                store.updateClip(freshActTrk.id, freshActClp.id, { content }, { skipHistory: true });
            }
        } else {
            if (!freshActTrk || !freshActClp) return;
            if (!skipHistory) store.saveToHistory?.();
            store.updateClip(freshActTrk.id, freshActClp.id, updates, { skipHistory: true });
        }
    };

    // Live update: no history, no full fan-out.
    // 1. Update local state so the StyleEditor panel reflects the drag immediately.
    // 2. Update only ONE clip in the store so the TextOverlay shows live preview.
    // The full fan-out to all clips happens on pointerUp via handleUpdate.
    const handleLiveUpdate = (updates) => {
        const { content, ...styleOnly } = updates;
        if (Object.keys(styleOnly).length === 0) return;

        // Update panel display via local state (zero React children re-renders)
        setLiveOverride(prev => ({ ...prev, ...styleOnly }));

        // Update the display clip only (1 store write instead of N)
        const store = useTimelineStore.getState();
        const freshText = store.tracks?.find(t => t.type === 'text');
        if (!freshText) return;
        const displayTarget =
            freshText.clips.find(c => c.id === activeClipId) || freshText.clips[0];
        if (displayTarget) {
            store.updateClip(freshText.id, displayTarget.id, styleOnly, { skipHistory: true });
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

    // ── No captions yet → Add presets ─────────────────────────────────────────
    if (captionClips.length === 0) {
        return (
            <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                    <Type size={13} style={{ color: 'var(--fg-4)' }} />
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Add Text</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {[
                        { name: 'Heading',    content: 'Big Headline',                fontSize: 72, fontWeight: 'bold',   preview: { fontSize: 20, fontWeight: 700 }, sub: 'Large, bold title text.' },
                        { name: 'Subheading', content: 'Subtitle Text',                fontSize: 48, fontWeight: 'medium', preview: { fontSize: 14, fontWeight: 500 }, sub: 'Secondary text for context.' },
                        { name: 'Body Text',  content: 'Body text content goes here.', fontSize: 24,                      preview: { fontSize: 11, fontWeight: 400 }, sub: 'Small text for descriptions.' },
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
    }

    // ── Shared header (always shown when captions exist) ───────────────────────
    const Header = () => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {editMode === 'global' ? 'Caption Style' : 'Segments'}
                </span>
                {editMode === 'global' && captionClips.length > 0 && (
                    <span style={{
                        fontFamily: 'var(--f-mono)', fontSize: 8, padding: '1px 6px', borderRadius: 99,
                        background: globalFlash
                            ? 'color-mix(in oklch, var(--accent) 30%, transparent)'
                            : 'color-mix(in oklch, var(--accent) 12%, transparent)',
                        color: 'var(--accent)',
                        border: `0.5px solid color-mix(in oklch, var(--accent) ${globalFlash ? 70 : 30}%, transparent)`,
                        transition: 'all 0.3s ease',
                    }}>
                        {captionClips.length} captions
                    </span>
                )}
            </div>
            <ModeToggle mode={editMode} onChange={setEditMode} />
        </div>
    );

    // Count how many segments have per-segment overrides vs. global style
    const customCount = captionClips.filter(clip =>
        Object.keys(globalStyle).some(k => k !== 'content' && clip[k] !== undefined && clip[k] !== globalStyle[k])
    ).length;

    // ── Individual mode ────────────────────────────────────────────────────────
    if (editMode === 'individual') {
        return (
            <div>
                <Header />
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    marginBottom: 8, padding: '4px 8px',
                    background: 'rgba(255,255,255,0.025)',
                    borderRadius: 5, border: '0.5px solid var(--line-soft)',
                }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)' }}>
                        ↓ Expand a caption to edit its style
                    </span>
                    {customCount > 0 && (
                        <span style={{
                            marginLeft: 'auto', fontFamily: 'var(--f-mono)', fontSize: 8,
                            color: 'var(--accent)', padding: '1px 5px',
                            background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                            borderRadius: 99, border: '0.5px solid color-mix(in oklch, var(--accent) 25%, transparent)',
                        }}>
                            {customCount} custom
                        </span>
                    )}
                </div>
                <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
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
            </div>
        );
    }

    // ── Global mode — always accessible when captions exist ───────────────────
    // displayClip is the active text clip if selected, otherwise the first caption.
    // All style changes fan out to every caption clip via handleUpdate.
    // Content is per-segment: only shown when a specific clip is active.
    // livePos passes the current drag position values so StyleEditor can display
    // them without reading from the (not-yet-updated) store.
    const livePos = (liveOverride.x !== undefined || liveOverride.y !== undefined)
        ? { x: liveOverride.x, y: liveOverride.y }
        : null;

    return (
        <div>
            <Header />
            <StyleEditor
                clip={displayClip}
                onUpdate={handleUpdate}
                onLiveUpdate={handleLiveUpdate}
                livePos={livePos}
                showContent={activeClip && isTextClip}
            />
        </div>
    );
};

export default TextPanel;
