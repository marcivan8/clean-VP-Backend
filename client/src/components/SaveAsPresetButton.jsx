/**
 * client/src/components/SaveAsPresetButton.jsx
 *
 * Shared "Save as preset" affordance — captures the CURRENT settings (caption
 * style, color grade, etc.) as a named, reusable preset on the user's account
 * via AudioEngineAPI.createUserPreset() → POST /api/presets/user.
 *
 * Distinct from favoriting (heart icon on SoundCard/transitions): this saves a
 * custom, named settings object rather than bookmarking an existing library item.
 *
 * Usage:
 *   <SaveAsPresetButton
 *     presetType="CAPTION_STYLE"
 *     defaultName="My Caption Style"
 *     buildSettings={() => ({ fontFamily, fontSize, color, ... })}
 *   />
 */

import React, { useState, useCallback } from 'react';
import { Bookmark, Check, Loader2, X } from 'lucide-react';
import { audioEngineAPI } from '../audio-engine/AudioEngineAPI.js';

export default function SaveAsPresetButton({ presetType, defaultName, buildSettings, disabled = false }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(defaultName || '');
    const [status, setStatus] = useState('idle'); // idle | saving | done | error
    const [error, setError] = useState('');

    const reset = useCallback(() => {
        setOpen(false);
        setStatus('idle');
        setError('');
        setName(defaultName || '');
    }, [defaultName]);

    const handleSave = useCallback(async () => {
        const trimmed = name.trim();
        if (!trimmed) { setError('Give it a name first'); return; }

        setStatus('saving');
        setError('');
        try {
            const settings = buildSettings();
            await audioEngineAPI.createUserPreset({
                name: trimmed,
                presetType,
                settings,
                isPublic: false, // private only — see conversation scope decision
            });
            setStatus('done');
            setTimeout(reset, 1600);
        } catch (err) {
            setStatus('error');
            setError(err.message || 'Could not save preset');
        }
    }, [name, presetType, buildSettings, reset]);

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                disabled={disabled}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    width: '100%', padding: '7px 0', marginTop: 10,
                    borderRadius: 6, border: '0.5px solid var(--line)',
                    background: 'rgba(255,255,255,0.03)', color: 'var(--fg-3)',
                    fontFamily: 'var(--f-mono)', fontSize: 9.5, textTransform: 'uppercase',
                    letterSpacing: '0.06em', cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1, transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
            >
                <Bookmark size={11} /> Save as preset
            </button>
        );
    }

    return (
        <div style={{
            marginTop: 10, padding: 8, borderRadius: 7,
            border: '0.5px solid var(--line)', background: 'rgba(255,255,255,0.03)',
            display: 'flex', flexDirection: 'column', gap: 6,
        }}>
            {status === 'done' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#00c97a', fontSize: 11, fontFamily: 'var(--f-mono)', justifyContent: 'center', padding: '4px 0' }}>
                    <Check size={12} /> Saved to My Presets
                </div>
            ) : (
                <>
                    <input
                        autoFocus
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') reset(); }}
                        placeholder="Preset name…"
                        disabled={status === 'saving'}
                        style={{
                            width: '100%', boxSizing: 'border-box', padding: '6px 8px',
                            borderRadius: 5, border: '0.5px solid var(--line)',
                            background: 'rgba(255,255,255,0.04)', color: 'var(--fg)',
                            fontSize: 12, fontFamily: 'var(--f-sans)', outline: 'none',
                        }}
                    />
                    {error && (
                        <span style={{ fontSize: 10, color: '#f04040', fontFamily: 'var(--f-mono)' }}>{error}</span>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            onClick={handleSave}
                            disabled={status === 'saving'}
                            style={{
                                flex: 1, padding: '6px 0', borderRadius: 5, border: 'none',
                                background: 'linear-gradient(135deg, var(--accent), var(--violet))',
                                color: '#fff', fontSize: 11, fontWeight: 600, cursor: status === 'saving' ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            }}
                        >
                            {status === 'saving' ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Bookmark size={11} />}
                            Save
                        </button>
                        <button
                            onClick={reset}
                            disabled={status === 'saving'}
                            style={{
                                padding: '6px 10px', borderRadius: 5,
                                border: '0.5px solid var(--line)', background: 'transparent',
                                color: 'var(--fg-3)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            <X size={11} />
                        </button>
                    </div>
                </>
            )}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
