/**
 * client/src/components/PresetApprovalModal.jsx
 *
 * Shown for FULL_EDIT presets before execution.
 * Lists the preset's command sequence so the user knows what will happen.
 * The user must explicitly click "Apply" to set approved=true.
 *
 * Props:
 *   preset   — preset object (must have command_sequence or commandSequence)
 *   onApply  — () => void — user approved
 *   onCancel — () => void — user cancelled
 */

import React from 'react';
import { Zap, CheckCircle, XCircle, AlertTriangle, ChevronRight } from 'lucide-react';

const OVERLAY = {
    position:        'fixed',
    inset:           0,
    background:      'rgba(0,0,0,0.72)',
    backdropFilter:  'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          9000,
    padding:         16,
};

const MODAL = {
    background:    'rgba(12,12,16,0.98)',
    border:        '0.5px solid rgba(255,58,110,0.25)',
    borderRadius:  12,
    padding:       '24px 24px 20px',
    maxWidth:      440,
    width:         '100%',
    fontFamily:    'var(--f-sans)',
    boxShadow:     '0 24px 48px rgba(0,0,0,0.5)',
};

export default function PresetApprovalModal({ preset, onApply, onCancel }) {
    if (!preset) return null;

    const name     = preset.display_name || preset.name || 'Preset';
    const commands = preset.command_sequence || preset.commandSequence || [];
    const sorted   = [...commands].sort((a, b) => (a.order || 0) - (b.order || 0));

    return (
        <div style={OVERLAY} onClick={onCancel}>
            <div style={MODAL} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                        background: 'rgba(255,58,110,0.14)',
                        border:     '0.5px solid rgba(255,58,110,0.3)',
                        display:    'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Zap size={15} color="#ff3a6e" />
                    </div>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>Full Edit — {name}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 1 }}>Review the steps before applying</div>
                    </div>
                </div>

                {/* Warning banner */}
                <div style={{
                    background:   'rgba(255,58,110,0.08)',
                    border:       '0.5px solid rgba(255,58,110,0.2)',
                    borderRadius: 6,
                    padding:      '8px 11px',
                    display:      'flex',
                    alignItems:   'flex-start',
                    gap:          8,
                    marginBottom: 14,
                }}>
                    <AlertTriangle size={13} color="#ff3a6e" style={{ marginTop: 1, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: '#ff8faa', lineHeight: 1.55 }}>
                        This preset applies multiple edits to your project. These actions can be undone individually using Ctrl+Z.
                    </span>
                </div>

                {/* Command list */}
                {sorted.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
                            Steps ({sorted.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {sorted.map((cmd, i) => (
                                <div key={cmd.order || i} style={{
                                    display:      'flex',
                                    alignItems:   'center',
                                    gap:          8,
                                    padding:      '5px 8px',
                                    background:   'rgba(255,255,255,0.04)',
                                    borderRadius: 5,
                                }}>
                                    <ChevronRight size={10} color="var(--fg-3)" />
                                    <span style={{ fontSize: 11, color: 'var(--fg-2)', flex: 1 }}>
                                        {cmd.label || cmd.action}
                                    </span>
                                    {cmd.skipIfFailed && (
                                        <span style={{ fontSize: 9, color: 'var(--fg-3)' }}>optional</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={onCancel}
                        style={{
                            flex: 1, padding: '9px 0', border: '0.5px solid rgba(255,255,255,0.12)',
                            borderRadius: 7, background: 'transparent', color: 'var(--fg-2)',
                            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--f-sans)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        }}
                    >
                        <XCircle size={12} /> Cancel
                    </button>
                    <button
                        onClick={onApply}
                        style={{
                            flex: 2, padding: '9px 0', border: 'none',
                            borderRadius: 7,
                            background: 'linear-gradient(135deg, #ff3a6e, #8a2be2)',
                            color: '#fff',
                            fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--f-sans)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        }}
                    >
                        <CheckCircle size={12} /> Apply Full Edit
                    </button>
                </div>
            </div>
        </div>
    );
}
