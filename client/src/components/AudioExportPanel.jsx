/**
 * client/src/components/AudioExportPanel.jsx
 *
 * Panel for exporting project audio as mp3/wav/aac/m4a.
 * Triggers a browser download via AudioEngineAPI.requestAudioExport().
 *
 * Props:
 *   onClose — () => void
 */

import React, { useState, useCallback } from 'react';
import { Download, Music2, Loader2, CheckCircle, X } from 'lucide-react';
import { useAudioEngine } from '../hooks/useAudioEngine.js';

const FORMATS = [
    { value: 'mp3',  label: 'MP3',  hint: 'Smallest file. Universal compatibility.' },
    { value: 'wav',  label: 'WAV',  hint: 'Lossless. Best for further editing.' },
    { value: 'm4a',  label: 'M4A',  hint: 'AAC in MPEG-4. Great for mobile.' },
    { value: 'aac',  label: 'AAC',  hint: 'Raw AAC stream.' },
];

const BITRATES = ['128k', '192k', '256k', '320k'];

export default function AudioExportPanel({ onClose }) {
    const { exportAudio } = useAudioEngine();

    const [format,    setFormat]    = useState('mp3');
    const [bitrate,   setBitrate]   = useState('192k');
    const [normalize, setNormalize] = useState(false);
    const [trimStart, setTrimStart] = useState('');
    const [trimEnd,   setTrimEnd]   = useState('');
    const [status,    setStatus]    = useState('idle'); // idle | exporting | done | error
    const [errMsg,    setErrMsg]    = useState('');

    const handleExport = useCallback(async () => {
        setStatus('exporting');
        setErrMsg('');
        try {
            await exportAudio({
                format,
                bitrate,
                normalize,
                trimStart: trimStart ? Number(trimStart) : undefined,
                trimEnd:   trimEnd   ? Number(trimEnd)   : undefined,
            });
            setStatus('done');
        } catch (e) {
            console.error('[AudioExportPanel]', e.message);
            setErrMsg(e.message);
            setStatus('error');
        }
    }, [exportAudio, format, bitrate, normalize, trimStart, trimEnd]);

    const selectedFormatHint = FORMATS.find(f => f.value === format)?.hint || '';

    return (
        <div style={{
            background:   'rgba(12,12,16,0.97)',
            border:       '0.5px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            padding:      '20px 20px 18px',
            fontFamily:   'var(--f-sans)',
            width:        300,
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Music2 size={14} color="var(--accent)" />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>Export Audio</span>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer' }}>
                    <X size={14} />
                </button>
            </div>

            {/* Format */}
            <label style={labelStyle}>Format</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 4 }}>
                {FORMATS.map(f => (
                    <button
                        key={f.value}
                        onClick={() => setFormat(f.value)}
                        style={{
                            padding:      '5px 0',
                            border:       format === f.value
                                ? '0.5px solid var(--accent)'
                                : '0.5px solid rgba(255,255,255,0.1)',
                            borderRadius: 5,
                            background:   format === f.value
                                ? 'color-mix(in oklch, var(--accent) 14%, transparent)'
                                : 'transparent',
                            color:        format === f.value ? 'var(--accent)' : 'var(--fg-2)',
                            fontSize:     11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--f-sans)',
                        }}
                    >
                        {f.label}
                    </button>
                ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginBottom: 12 }}>{selectedFormatHint}</div>

            {/* Bitrate (hidden for wav) */}
            {format !== 'wav' && (
                <>
                    <label style={labelStyle}>Bitrate</label>
                    <div style={{ display: 'flex', gap: 5, marginBottom: 12 }}>
                        {BITRATES.map(b => (
                            <button
                                key={b}
                                onClick={() => setBitrate(b)}
                                style={{
                                    flex: 1, padding: '4px 0',
                                    border:       bitrate === b ? '0.5px solid var(--accent)' : '0.5px solid rgba(255,255,255,0.1)',
                                    borderRadius: 5,
                                    background:   bitrate === b ? 'color-mix(in oklch, var(--accent) 12%, transparent)' : 'transparent',
                                    color:        bitrate === b ? 'var(--accent)' : 'var(--fg-3)',
                                    fontSize:     10, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--f-sans)',
                                }}
                            >
                                {b}
                            </button>
                        ))}
                    </div>
                </>
            )}

            {/* Normalize */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>Normalize loudness (EBU R128)</span>
                <button
                    onClick={() => setNormalize(n => !n)}
                    style={{
                        width: 34, height: 18, borderRadius: 9,
                        border: 'none', cursor: 'pointer',
                        background: normalize
                            ? 'linear-gradient(135deg, var(--accent), var(--violet))'
                            : 'rgba(255,255,255,0.12)',
                        transition: 'background 0.15s',
                        position: 'relative',
                    }}
                >
                    <span style={{
                        position:   'absolute',
                        top: 2, left: normalize ? 18 : 2,
                        width: 14, height: 14, borderRadius: '50%',
                        background: '#fff', transition: 'left 0.15s',
                    }} />
                </button>
            </div>

            {/* Trim (optional) */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Trim start (s)</label>
                    <input
                        type="number" min="0" step="0.1" placeholder="0"
                        value={trimStart}
                        onChange={e => setTrimStart(e.target.value)}
                        style={inputStyle}
                    />
                </div>
                <div style={{ flex: 1 }}>
                    <label style={labelStyle}>Trim end (s)</label>
                    <input
                        type="number" min="0" step="0.1" placeholder="end"
                        value={trimEnd}
                        onChange={e => setTrimEnd(e.target.value)}
                        style={inputStyle}
                    />
                </div>
            </div>

            {/* Error */}
            {status === 'error' && (
                <div style={{ fontSize: 11, color: '#ff8faa', marginBottom: 10 }}>{errMsg}</div>
            )}

            {/* Export button */}
            <button
                onClick={status === 'done' ? onClose : handleExport}
                disabled={status === 'exporting'}
                style={{
                    width:        '100%',
                    padding:      '10px 0',
                    border:       'none',
                    borderRadius: 7,
                    background:   status === 'done'
                        ? 'rgba(0,229,255,0.15)'
                        : 'linear-gradient(135deg, var(--accent), var(--violet))',
                    color:        status === 'done' ? 'var(--accent)' : '#fff',
                    fontSize:     12,
                    fontWeight:   700,
                    fontFamily:   'var(--f-sans)',
                    cursor:       status === 'exporting' ? 'not-allowed' : 'pointer',
                    display:      'flex',
                    alignItems:   'center',
                    justifyContent: 'center',
                    gap:          6,
                    opacity:      status === 'exporting' ? 0.7 : 1,
                }}
            >
                {status === 'exporting' ? (
                    <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Exporting…</>
                ) : status === 'done' ? (
                    <><CheckCircle size={12} /> Downloaded — Close</>
                ) : (
                    <><Download size={12} /> Export {format.toUpperCase()}</>
                )}
            </button>
        </div>
    );
}

const labelStyle = { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 };
const inputStyle = {
    width: '100%', padding: '5px 8px', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)',
    borderRadius: 5, color: 'var(--fg)', fontSize: 11, fontFamily: 'var(--f-sans)', outline: 'none',
};
