/**
 * client/src/components/LUTCard.jsx
 *
 * Displays a LUT with a live CSS filter preview on a sample gradient swatch.
 *
 * DESIGN RULE: cssFilterPreview is applied via CSS filter on the swatch — NEVER via FFmpeg.
 * FFmpeg lut3d is only used in the export pipeline (jobs/exportProcessor.js).
 *
 * Props:
 *   lut       — LUT asset object (must have cssFilterPreview — never null)
 *   onApply   — (lut) => void — called when user clicks Apply
 *   applied   — boolean — whether this LUT is currently applied to the project
 */

import React, { useState } from 'react';
import { Check, X } from 'lucide-react';

const SWATCH_GRADIENT = 'linear-gradient(135deg, #e8c97a 0%, #4a7fc1 40%, #2d4a2d 70%, #c44b4b 100%)';

export default function LUTCard({ lut, onApply, applied = false }) {
    const [hovered, setHovered] = useState(false);

    // cssFilterPreview is NEVER null — guaranteed by LUTService.getPreviewFilter()
    const cssFilter = lut.cssFilterPreview || lut.css_filter_preview || 'none';

    return (
        <div
            style={{
                background:   applied ? 'rgba(0,229,255,0.06)' : hovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                border:       applied
                    ? '0.5px solid rgba(0,229,255,0.35)'
                    : hovered ? '0.5px solid rgba(255,255,255,0.14)' : '0.5px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                overflow:     'hidden',
                cursor:       'pointer',
                transition:   'border-color 0.15s, background 0.15s',
                fontFamily:   'var(--f-sans)',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={() => onApply?.(lut)}
        >
            {/* Color swatch — CSS filter preview (ZERO FFmpeg) */}
            <div style={{
                height:     48,
                background: SWATCH_GRADIENT,
                // ↓ THIS IS THE ONLY PLACE WHERE CSS FILTER IS APPLIED
                filter:     cssFilter,
                position:   'relative',
            }}>
                {applied && (
                    <div style={{
                        position:   'absolute', top: 4, right: 4,
                        background: 'var(--accent)', borderRadius: '50%',
                        width: 16, height: 16, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Check size={10} color="#000" strokeWidth={3} />
                    </div>
                )}
            </div>

            {/* Info */}
            <div style={{ padding: '7px 9px 8px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: applied ? 'var(--accent)' : 'var(--fg)', lineHeight: 1.3 }}>
                    {lut.display_name || lut.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {lut.style?.slice(0, 2).join(' · ') || lut.description?.slice(0, 30)}
                </div>

                {/* Apply / Remove button */}
                <button
                    onClick={e => { e.stopPropagation(); onApply?.(lut); }}
                    style={{
                        marginTop:   6,
                        width:       '100%',
                        padding:     '4px 0',
                        border:      'none',
                        borderRadius: 5,
                        background:  applied
                            ? 'rgba(255,255,255,0.06)'
                            : 'linear-gradient(135deg, var(--accent), var(--violet))',
                        color:       applied ? 'var(--fg-2)' : '#fff',
                        fontSize:    10,
                        fontWeight:  600,
                        fontFamily:  'var(--f-sans)',
                        cursor:      'pointer',
                        display:     'flex',
                        alignItems:  'center',
                        justifyContent: 'center',
                        gap:         4,
                        letterSpacing: '0.03em',
                    }}
                >
                    {applied ? <><X size={9} /> Remove</> : 'Apply'}
                </button>
            </div>
        </div>
    );
}
