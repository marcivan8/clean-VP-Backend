/**
 * client/src/components/PresetCard.jsx
 *
 * Displays a system or user preset.
 * FULL_EDIT type → shows lock icon and routes through PresetApprovalModal.
 * Other types → apply directly on click.
 *
 * Props:
 *   preset         — preset asset object
 *   onApply        — (preset, approved) => void
 *   onRequestApproval — (preset) => void — called for FULL_EDIT presets
 */

import React, { useState } from 'react';
import { Layers, Lock, Zap, Palette, Type, Volume2, Settings, CheckCircle } from 'lucide-react';

const TYPE_META = {
    COLOR_GRADE:     { icon: Palette, color: '#8a2be2', label: 'Color Grade' },
    CAPTION_STYLE:   { icon: Type,    color: '#00e5ff', label: 'Captions' },
    SOUND_SETTINGS:  { icon: Volume2, color: '#4a9eff', label: 'Sound' },
    EXPORT_SETTINGS: { icon: Settings,color: '#aaa',    label: 'Export' },
    FULL_EDIT:       { icon: Zap,     color: '#ff3a6e', label: 'Full Edit' },
    TRANSITION:      { icon: Layers,  color: '#00b4d8', label: 'Transition' },
};

export default function PresetCard({ preset, onApply, onRequestApproval }) {
    const [hovered, setHovered] = useState(false);

    const presetType = preset.preset_type || preset.presetType || 'TRANSITION';
    const meta       = TYPE_META[presetType] || TYPE_META.TRANSITION;
    const Icon       = meta.icon;
    const isFullEdit = presetType === 'FULL_EDIT';

    const handleApply = e => {
        e.stopPropagation();
        if (isFullEdit) {
            onRequestApproval?.(preset);
        } else {
            onApply?.(preset, true);
        }
    };

    return (
        <div
            style={{
                background:   hovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                border:       `0.5px solid ${hovered ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 8,
                padding:      '10px 12px',
                cursor:       'pointer',
                transition:   'border-color 0.15s, background 0.15s',
                fontFamily:   'var(--f-sans)',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={handleApply}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                {/* Icon badge */}
                <div style={{
                    width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                    background: `color-mix(in oklch, ${meta.color} 14%, transparent)`,
                    border:     `0.5px solid color-mix(in oklch, ${meta.color} 28%, transparent)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Icon size={13} color={meta.color} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {preset.display_name || preset.name}
                        </span>
                        {isFullEdit && <Lock size={9} color="var(--fg-3)" />}
                    </div>

                    {/* Type badge */}
                    <span style={{
                        display: 'inline-block', marginTop: 3,
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                        color: meta.color,
                        background: `color-mix(in oklch, ${meta.color} 12%, transparent)`,
                        border: `0.5px solid color-mix(in oklch, ${meta.color} 25%, transparent)`,
                        borderRadius: 4, padding: '1px 5px',
                        textTransform: 'uppercase',
                    }}>
                        {meta.label}
                    </span>
                </div>

                {/* Apply CTA */}
                <button
                    onClick={handleApply}
                    style={{
                        flexShrink:  0,
                        padding:     '4px 9px',
                        border:      'none',
                        borderRadius: 5,
                        background:  isFullEdit
                            ? 'rgba(255,58,110,0.12)'
                            : 'linear-gradient(135deg, var(--accent), var(--violet))',
                        color:       isFullEdit ? '#ff3a6e' : '#fff',
                        fontSize:    10,
                        fontWeight:  700,
                        fontFamily:  'var(--f-sans)',
                        cursor:      'pointer',
                        display:     'flex',
                        alignItems:  'center',
                        gap:         4,
                    }}
                >
                    {isFullEdit ? <Lock size={9} /> : <CheckCircle size={9} />}
                    {isFullEdit ? 'Review' : 'Apply'}
                </button>
            </div>

            {/* Description */}
            {preset.description && (
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 7, lineHeight: 1.45 }}>
                    {preset.description.slice(0, 90)}{preset.description.length > 90 ? '…' : ''}
                </div>
            )}
        </div>
    );
}
