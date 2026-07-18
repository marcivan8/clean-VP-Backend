/**
 * client/src/components/SoundCard.jsx
 *
 * Displays a single SFX search result.
 * Plays a preview on hover/click (if previewUrl is available).
 * On select → calls onSelect(sfx) for the parent to add to timeline.
 */

import React, { useRef, useState, useCallback } from 'react';
import { Play, Pause, Plus, Zap } from 'lucide-react';

const glassCard = {
    background:    'rgba(255,255,255,0.04)',
    border:        '0.5px solid rgba(255,255,255,0.09)',
    borderRadius:  8,
    padding:       '10px 12px',
    display:       'flex',
    alignItems:    'center',
    gap:           10,
    cursor:        'pointer',
    transition:    'border-color 0.15s, background 0.15s',
    fontFamily:    'var(--f-sans)',
    userSelect:    'none',
};

const energyColors = ['#555', '#4a9eff', '#00e5ff', '#8a2be2', '#ff3a6e'];

/**
 * @param {{ sfx: object, onSelect: (sfx: object) => void, compact?: boolean }} props
 */
export default function SoundCard({ sfx, onSelect, compact = false }) {
    const audioRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [hovered, setHovered] = useState(false);

    const energy = Math.max(0, Math.min(4, (sfx.energy_level || 3) - 1));

    const togglePlay = useCallback(e => {
        e.stopPropagation();
        if (!sfx.preview_url) return;
        if (!audioRef.current) {
            audioRef.current = new Audio(sfx.preview_url);
            audioRef.current.addEventListener('ended', () => setPlaying(false));
        }
        if (playing) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            setPlaying(false);
        } else {
            audioRef.current.play().catch(() => {});
            setPlaying(true);
        }
    }, [sfx.preview_url, playing]);

    const handleSelect = useCallback(() => {
        if (audioRef.current) { audioRef.current.pause(); setPlaying(false); }
        onSelect?.(sfx);
    }, [sfx, onSelect]);

    return (
        <div
            style={{
                ...glassCard,
                borderColor: hovered ? 'rgba(0,229,255,0.2)' : 'rgba(255,255,255,0.09)',
                background:  hovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.04)',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={handleSelect}
        >
            {/* Play button */}
            <button
                onClick={togglePlay}
                style={{
                    width: 30, height: 30, borderRadius: 6, border: 'none',
                    background: playing
                        ? 'color-mix(in oklch, var(--accent) 22%, transparent)'
                        : 'rgba(255,255,255,0.08)',
                    color: playing ? 'var(--accent)' : 'var(--fg-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: sfx.preview_url ? 'pointer' : 'default',
                    flexShrink: 0, transition: 'background 0.15s, color 0.15s',
                }}
            >
                {playing ? <Pause size={13} /> : <Play size={13} />}
            </button>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {sfx.display_name || sfx.name}
                </div>
                {!compact && (
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1 }}>
                        {sfx.description?.slice(0, 55)}{sfx.description?.length > 55 ? '…' : ''}
                    </div>
                )}
            </div>

            {/* Energy dot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <Zap size={10} color={energyColors[energy]} />
                <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{energy + 1}</span>
            </div>

            {/* Add button */}
            <button
                onClick={e => { e.stopPropagation(); handleSelect(); }}
                style={{
                    width: 24, height: 24, borderRadius: 5, border: 'none',
                    background: 'rgba(0,229,255,0.12)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0,
                }}
            >
                <Plus size={12} />
            </button>
        </div>
    );
}
