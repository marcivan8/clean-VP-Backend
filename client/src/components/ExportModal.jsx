import React, { useState, useEffect } from 'react';
import {
    X, Film, Download, Tv2, Smartphone, Youtube,
    Clapperboard, CheckCircle2, Loader2, AlertCircle,
    Scissors, ArrowRight,
} from 'lucide-react';
import { exportToNLE } from '../services/nleExportService';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../store/useTimelineStore';

// ─── Data ─────────────────────────────────────────────────────────────────────

const PLATFORMS = [
    { id: 'youtube', label: 'YouTube',      icon: Youtube,      ar: '16:9', fps: 30, res: '1920×1080' },
    { id: 'tiktok',  label: 'TikTok',       icon: Smartphone,   ar: '9:16', fps: 30, res: '1080×1920' },
    { id: 'reels',   label: 'IG Reels',     icon: Clapperboard, ar: '9:16', fps: 30, res: '1080×1920' },
    { id: 'shorts',  label: 'YT Shorts',    icon: Tv2,          ar: '9:16', fps: 60, res: '1080×1920' },
];

const RESOLUTIONS = [
    { id: '720p',  label: '720p',  sub: 'HD' },
    { id: '1080p', label: '1080p', sub: 'FHD' },
    { id: '2k',    label: '2K',    sub: 'QHD' },
    { id: '4k',    label: '4K',    sub: 'UHD' },
];

const QUALITY_PROFILES = [
    { id: 'high',   label: 'Pro',    bitrate: '8 Mbps',  sub: 'Max bitrate'  },
    { id: 'medium', label: 'Social', bitrate: '5 Mbps',  sub: 'Balanced'     },
    { id: 'low',    label: 'Draft',  bitrate: '2 Mbps',  sub: 'Fast render'  },
];

const NLE_TARGETS = [
    { id: 'premiere', label: 'Premiere Pro',    sub: 'xmeml v5',          ext: '.xml'         },
    { id: 'fcpx',     label: 'Final Cut Pro',   sub: 'FCPXML 1.8',        ext: '.fcpxml'      },
    { id: 'resolve',  label: 'DaVinci Resolve', sub: 'xmeml + OTIO',      ext: '.xml + .otio' },
    { id: 'otio',     label: 'OpenTimelineIO',  sub: 'Universal format',  ext: '.otio'        },
];

// ─── Vibed logo mark (waveform bars, cyan→violet) ────────────────────────────

const VibedMark = ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect x="2.5"  y="15"   width="7" height="70" rx="3.5" fill="#00E5FF" />
        <rect x="13.5" y="25"   width="7" height="50" rx="3.5" fill="#17CDFB" />
        <rect x="24.5" y="33"   width="7" height="34" rx="3.5" fill="#2EB5F7" />
        <rect x="35.5" y="39.5" width="7" height="21" rx="3.5" fill="#459DF3" />
        <rect x="46.5" y="43"   width="7" height="14" rx="3.5" fill="#5B85EF" />
        <rect x="57.5" y="39.5" width="7" height="21" rx="3.5" fill="#726DEB" />
        <rect x="68.5" y="33"   width="7" height="34" rx="3.5" fill="#8855E7" />
        <rect x="79.5" y="25"   width="7" height="50" rx="3.5" fill="#9F3DE3" />
        <rect x="90.5" y="15"   width="7" height="70" rx="3.5" fill="#8A2BE2" />
    </svg>
);

// ─── Atoms ────────────────────────────────────────────────────────────────────

/** Mono eyebrow label */
const Label = ({ children }) => (
    <p style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--fg-4)',
        margin: 0,
    }}>
        {children}
    </p>
);

/** Thin separator */
const Sep = () => (
    <div style={{ height: 1, background: 'var(--line)', margin: '0 -24px' }} />
);

// ─── Main component ───────────────────────────────────────────────────────────

const ExportModal = ({ isOpen, onClose, onExport, isExporting, exportResult, exportError }) => {
    const [activeTab, setActiveTab] = useState('video');
    const [settings, setSettings]   = useState({ platform: null, resolution: '1080p', fps: 30, format: 'mp4', quality: 'high' });
    const [step, setStep]           = useState('configure');
    const [progress, setProgress]   = useState(0);
    const [nleStatus, setNleStatus] = useState(null);
    const [nleError,  setNleError]  = useState(null);
    const [nleLoading, setNleLoading] = useState(null);

    const { tracks, aspectRatio } = useTimelineStore(useShallow(s => ({ tracks: s.tracks, aspectRatio: s.aspectRatio })));

    useEffect(() => {
        if (isExporting) {
            setStep('exporting');
            let p = 0;
            const t = setInterval(() => { p = Math.min(p + Math.random() * 6, 88); setProgress(Math.round(p)); }, 500);
            return () => clearInterval(t);
        }
    }, [isExporting]);

    useEffect(() => { if (exportResult) { setStep('done'); setProgress(100); } }, [exportResult]);
    useEffect(() => { if (exportError)  { setStep('error'); } }, [exportError]);

    if (!isOpen) return null;

    const selectedPlatform = PLATFORMS.find(p => p.id === settings.platform);

    const handleClose = () => {
        setStep('configure'); setProgress(0);
        setNleStatus(null); setNleError(null);
        onClose();
    };

    const handleNLEExport = async (id) => {
        setNleStatus(null); setNleError(null); setNleLoading(id);
        try {
            await exportToNLE(id, tracks, { fps: settings.fps || 30, aspectRatio: aspectRatio || '16:9', title: 'Vibed Export' });
            setNleStatus('success');
        } catch (err) {
            setNleStatus('error'); setNleError(err.message);
        } finally {
            setNleLoading(null);
        }
    };

    // ── Shared styles ──────────────────────────────────────────────────────────

    const overlay = {
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
    };

    const modal = {
        width: '100%', maxWidth: 488,
        background: 'var(--bg-2)',
        border: '0.5px solid var(--glass-stroke)',
        borderRadius: 'var(--r-xl)',
        boxShadow: '0 40px 80px -20px rgba(0,0,0,0.8), 0 0 0 0.5px rgba(255,255,255,0.04) inset',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh',
    };

    const selCard = (active) => ({
        padding: '12px 14px',
        borderRadius: 'var(--r-md)',
        border: active ? '0.5px solid var(--accent)' : '0.5px solid var(--line)',
        background: active
            ? 'color-mix(in oklch, var(--accent) 12%, transparent)'
            : 'var(--glass)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        boxShadow: active ? '0 0 16px -4px color-mix(in oklch, var(--accent) 30%, transparent)' : 'none',
        textAlign: 'left',
        display: 'flex', flexDirection: 'column', gap: 4,
    });

    const pill = (active) => ({
        flex: 1, padding: '8px 0',
        borderRadius: 'var(--r-sm)',
        border: active ? '0.5px solid var(--accent)' : '0.5px solid transparent',
        background: active ? 'color-mix(in oklch, var(--accent) 14%, transparent)' : 'transparent',
        color: active ? 'var(--fg)' : 'var(--fg-4)',
        fontFamily: 'var(--f-mono)', fontSize: 11, fontWeight: 500,
        letterSpacing: '0.02em', textAlign: 'center', cursor: 'pointer',
        transition: 'all 0.12s ease',
    });

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <div style={overlay}>
            <div style={modal}>

                {/* ── Header ── */}
                <div style={{ padding: '20px 24px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <VibedMark size={22} />
                        <div>
                            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
                                Export
                            </p>
                            <Label>Publish your work</Label>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        style={{
                            width: 30, height: 30, borderRadius: 'var(--r-sm)',
                            border: '0.5px solid var(--line)',
                            background: 'var(--glass)',
                            color: 'var(--fg-3)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', transition: 'all 0.12s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--fg)'; e.currentTarget.style.background = 'var(--glass-2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-3)'; e.currentTarget.style.background = 'var(--glass)'; }}
                    >
                        <X size={14} />
                    </button>
                </div>

                <Sep />

                {/* ── Tab switcher ── */}
                <div style={{ display: 'flex', gap: 2, padding: '8px 24px 0', background: 'var(--bg-2)' }}>
                    {[
                        { id: 'video', icon: Film,    label: 'Video file' },
                        { id: 'nle',   icon: Scissors, label: 'NLE project' },
                    ].map(tab => {
                        const active = activeTab === tab.id;
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '8px 14px',
                                    borderRadius: 'var(--r-sm) var(--r-sm) 0 0',
                                    border: active ? '0.5px solid var(--line)' : '0.5px solid transparent',
                                    borderBottom: active ? '0.5px solid var(--bg-3)' : '0.5px solid transparent',
                                    background: active ? 'var(--bg-3)' : 'transparent',
                                    color: active ? 'var(--fg)' : 'var(--fg-4)',
                                    fontSize: 12, fontWeight: 500,
                                    letterSpacing: '-0.005em',
                                    cursor: 'pointer',
                                    transition: 'all 0.12s ease',
                                    marginBottom: -1,
                                }}
                            >
                                <Icon size={12} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* ── Body ── */}
                <div style={{ background: 'var(--bg-3)', flex: 1, overflowY: 'auto', borderTop: '0.5px solid var(--line)' }}>

                    {/* ════ VIDEO TAB ════ */}
                    {activeTab === 'video' && (

                        <>
                        {/* Configure */}
                        {step === 'configure' && (
                            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 22 }}>

                                {/* Platform */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <Label>Platform</Label>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                        {PLATFORMS.map(pl => {
                                            const Icon = pl.icon;
                                            const active = settings.platform === pl.id;
                                            return (
                                                <button
                                                    key={pl.id}
                                                    onClick={() => setSettings(s => ({ ...s, platform: pl.id === s.platform ? null : pl.id, fps: pl.fps }))}
                                                    style={selCard(active)}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <Icon size={14} style={{ color: active ? 'var(--accent)' : 'var(--fg-3)', flexShrink: 0 }} />
                                                        <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--fg)' : 'var(--fg-2)', letterSpacing: '-0.005em' }}>
                                                            {pl.label}
                                                        </span>
                                                    </div>
                                                    <p style={{ margin: 0, fontFamily: 'var(--f-mono)', fontSize: 10, color: active ? 'var(--fg-3)' : 'var(--fg-4)', letterSpacing: '0.04em' }}>
                                                        {pl.ar} · {pl.fps}fps
                                                    </p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Resolution — only when no platform preset */}
                                {!settings.platform && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <Label>Resolution</Label>
                                        <div style={{
                                            display: 'flex', gap: 2,
                                            background: 'var(--glass)',
                                            border: '0.5px solid var(--line)',
                                            borderRadius: 'var(--r-sm)',
                                            padding: 3,
                                        }}>
                                            {RESOLUTIONS.map(r => (
                                                <button
                                                    key={r.id}
                                                    onClick={() => setSettings(s => ({ ...s, resolution: r.id }))}
                                                    style={pill(settings.resolution === r.id)}
                                                >
                                                    <div style={{ fontWeight: 600, fontSize: 11 }}>{r.label}</div>
                                                    <div style={{ fontSize: 9, opacity: 0.6 }}>{r.sub}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Quality */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <Label>Quality</Label>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                                        {QUALITY_PROFILES.map(q => {
                                            const active = settings.quality === q.id;
                                            return (
                                                <button
                                                    key={q.id}
                                                    onClick={() => setSettings(s => ({ ...s, quality: q.id }))}
                                                    style={selCard(active)}
                                                >
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--fg)' : 'var(--fg-2)' }}>
                                                        {q.label}
                                                    </span>
                                                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: active ? 'color-mix(in oklch, var(--accent) 80%, var(--fg-3))' : 'var(--fg-4)', letterSpacing: '0.02em' }}>
                                                        {q.bitrate}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* FPS / Format — compact row */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <Label>Frame rate</Label>
                                        <div style={{
                                            display: 'flex', gap: 2,
                                            background: 'var(--glass)',
                                            border: '0.5px solid var(--line)',
                                            borderRadius: 'var(--r-sm)',
                                            padding: 3,
                                            opacity: settings.platform ? 0.4 : 1,
                                            pointerEvents: settings.platform ? 'none' : 'auto',
                                        }}>
                                            {[24, 30, 60].map(fps => (
                                                <button key={fps} onClick={() => setSettings(s => ({ ...s, fps }))} style={pill(settings.fps === fps)}>
                                                    {fps}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <Label>Format</Label>
                                        <div style={{
                                            display: 'flex', gap: 2,
                                            background: 'var(--glass)',
                                            border: '0.5px solid var(--line)',
                                            borderRadius: 'var(--r-sm)',
                                            padding: 3,
                                        }}>
                                            {['mp4', 'webm'].map(fmt => (
                                                <button key={fmt} onClick={() => setSettings(s => ({ ...s, format: fmt }))} style={pill(settings.format === fmt)}>
                                                    {fmt.toUpperCase()}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* CTA */}
                                <button
                                    onClick={() => { setProgress(0); onExport(settings); }}
                                    className="glass-button-pro"
                                    style={{
                                        width: '100%', padding: '14px 0',
                                        borderRadius: 'var(--r-md)',
                                        fontSize: 13, fontWeight: 700, letterSpacing: '0.06em',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                        marginTop: 4,
                                    }}
                                >
                                    <Download size={14} />
                                    {selectedPlatform ? `Export for ${selectedPlatform.label}` : 'Export video'}
                                    <ArrowRight size={13} style={{ opacity: 0.6 }} />
                                </button>
                            </div>
                        )}

                        {/* Exporting */}
                        {step === 'exporting' && (
                            <div style={{ padding: '52px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
                                {/* Spinner with glow */}
                                <div style={{ position: 'relative', width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <div style={{
                                        position: 'absolute', inset: 0, borderRadius: '50%',
                                        background: 'color-mix(in oklch, var(--accent) 15%, transparent)',
                                        boxShadow: '0 0 32px color-mix(in oklch, var(--accent) 30%, transparent)',
                                    }} />
                                    <Loader2 size={28} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite', position: 'relative' }} />
                                </div>

                                <div style={{ textAlign: 'center' }}>
                                    <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
                                        Rendering
                                    </p>
                                    <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-4)', fontFamily: 'var(--f-mono)' }}>
                                        FFmpeg is encoding your timeline
                                    </p>
                                </div>

                                {/* Progress bar */}
                                <div style={{ width: '100%', maxWidth: 280 }}>
                                    <div style={{
                                        height: 3, width: '100%',
                                        background: 'var(--glass)',
                                        borderRadius: 99, overflow: 'hidden',
                                    }}>
                                        <div style={{
                                            height: '100%',
                                            width: `${progress}%`,
                                            background: 'linear-gradient(90deg, var(--accent), var(--violet))',
                                            borderRadius: 99,
                                            transition: 'width 0.4s ease',
                                            boxShadow: '0 0 8px var(--accent)',
                                        }} />
                                    </div>
                                    <p style={{ margin: '8px 0 0', textAlign: 'center', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg-4)' }}>
                                        {progress}%
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Done */}
                        {step === 'done' && exportResult && (
                            <div style={{ padding: '36px 24px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                                {/* Success badge */}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                                    <div style={{
                                        width: 52, height: 52, borderRadius: '50%',
                                        background: 'color-mix(in srgb, #00c97a 12%, transparent)',
                                        border: '0.5px solid color-mix(in srgb, #00c97a 30%, transparent)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        boxShadow: '0 0 24px color-mix(in srgb, #00c97a 20%, transparent)',
                                    }}>
                                        <CheckCircle2 size={24} style={{ color: '#00c97a' }} />
                                    </div>
                                    <div style={{ textAlign: 'center' }}>
                                        <p style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
                                            Render complete
                                        </p>
                                        <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-4)', fontFamily: 'var(--f-mono)' }}>
                                            {exportResult.metadata?.resolution} · {exportResult.metadata?.sizeMB} MB
                                        </p>
                                    </div>
                                </div>

                                {/* Metadata grid */}
                                <div style={{
                                    width: '100%',
                                    background: 'var(--glass)',
                                    border: '0.5px solid var(--line)',
                                    borderRadius: 'var(--r-md)',
                                    padding: '14px 16px',
                                    display: 'grid', gridTemplateColumns: '1fr 1fr',
                                    gap: '10px 24px',
                                }}>
                                    {[
                                        { k: 'Codec',    v: exportResult.metadata?.codec || 'H.264' },
                                        { k: 'Size',     v: `${exportResult.metadata?.sizeMB || '?'} MB` },
                                        { k: 'Clips',    v: exportResult.metadata?.segments ?? '—' },
                                        { k: 'Platform', v: exportResult.metadata?.platform || 'Custom' },
                                    ].map(({ k, v }) => (
                                        <div key={k}>
                                            <p style={{ margin: '0 0 2px', fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-4)' }}>{k}</p>
                                            <p style={{ margin: 0, fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--fg-2)' }}>{v}</p>
                                        </div>
                                    ))}
                                </div>

                                {/* Actions */}
                                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                                    <button
                                        onClick={async () => {
                                            try {
                                                const res = await fetch(exportResult.url);
                                                const blob = await res.blob();
                                                const blobUrl = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = blobUrl;
                                                a.download = exportResult.filename || 'vibed-export.mp4';
                                                a.click();
                                                URL.revokeObjectURL(blobUrl);
                                            } catch {
                                                window.open(exportResult.url, '_blank');
                                            }
                                        }}
                                        className="glass-button-pro"
                                        style={{
                                            flex: 1, padding: '13px 0',
                                            borderRadius: 'var(--r-md)',
                                            fontSize: 13, fontWeight: 700, letterSpacing: '0.06em',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                                        }}
                                    >
                                        <Download size={14} /> Download
                                    </button>
                                    <button
                                        onClick={() => setStep('configure')}
                                        style={{
                                            padding: '13px 18px',
                                            borderRadius: 'var(--r-md)',
                                            border: '0.5px solid var(--line)',
                                            background: 'var(--glass)',
                                            color: 'var(--fg-3)', fontSize: 12, fontWeight: 500,
                                            cursor: 'pointer', transition: 'all 0.12s ease',
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--fg)'; e.currentTarget.style.background = 'var(--glass-2)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-3)'; e.currentTarget.style.background = 'var(--glass)'; }}
                                    >
                                        Again
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {step === 'error' && (
                            <div style={{ padding: '48px 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
                                <div style={{
                                    width: 52, height: 52, borderRadius: '50%',
                                    background: 'color-mix(in srgb, #f04040 10%, transparent)',
                                    border: '0.5px solid color-mix(in srgb, #f04040 25%, transparent)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <AlertCircle size={22} style={{ color: '#f04040' }} />
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Render failed</p>
                                    <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-4)', fontFamily: 'var(--f-mono)', maxWidth: 280 }}>
                                        {exportError || 'An unknown error occurred.'}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setStep('configure')}
                                    style={{
                                        padding: '12px 32px',
                                        borderRadius: 'var(--r-md)',
                                        border: '0.5px solid var(--line)',
                                        background: 'var(--glass)',
                                        color: 'var(--fg)', fontSize: 13, fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    Try again
                                </button>
                            </div>
                        )}
                        </>
                    )}

                    {/* ════ NLE TAB ════ */}
                    {activeTab === 'nle' && (
                        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-4)', lineHeight: 1.6, fontFamily: 'var(--f-mono)' }}>
                                Export as a project file — no re-encoding. Your original media stays intact.
                            </p>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                {NLE_TARGETS.map(nle => {
                                    const loading = nleLoading === nle.id;
                                    return (
                                        <button
                                            key={nle.id}
                                            onClick={() => handleNLEExport(nle.id)}
                                            disabled={!!nleLoading}
                                            style={{
                                                ...selCard(false),
                                                opacity: nleLoading && !loading ? 0.4 : 1,
                                                cursor: nleLoading ? 'not-allowed' : 'pointer',
                                                gap: 8,
                                            }}
                                            onMouseEnter={e => { if (!nleLoading) { e.currentTarget.style.background = 'var(--glass-2)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; } }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--glass)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
                                        >
                                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>{nle.label}</span>
                                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)' }}>{nle.sub}</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, color: 'var(--accent)', fontSize: 11 }}>
                                                {loading
                                                    ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
                                                    : <><Download size={11} /> <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10 }}>{nle.ext}</span></>
                                                }
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {nleStatus === 'success' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'color-mix(in srgb, #00c97a 8%, transparent)', border: '0.5px solid color-mix(in srgb, #00c97a 25%, transparent)' }}>
                                    <CheckCircle2 size={14} style={{ color: '#00c97a', flexShrink: 0 }} />
                                    <span style={{ fontSize: 12, color: '#00c97a', fontFamily: 'var(--f-mono)' }}>Project file downloaded</span>
                                </div>
                            )}
                            {nleStatus === 'error' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'color-mix(in srgb, #f04040 8%, transparent)', border: '0.5px solid color-mix(in srgb, #f04040 25%, transparent)' }}>
                                    <AlertCircle size={14} style={{ color: '#f04040', flexShrink: 0 }} />
                                    <span style={{ fontSize: 12, color: '#f04040', fontFamily: 'var(--f-mono)' }}>{nleError || 'Failed to generate.'}</span>
                                </div>
                            )}

                            <Sep />

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {[
                                    ['Premiere Pro',    'File → Import → .xml'],
                                    ['Final Cut Pro',   'File → Import → XML'],
                                    ['DaVinci Resolve', '.xml + .otio (Resolve 18+)'],
                                    ['OpenTimelineIO',  'Universal — Resolve, Premiere (beta), Kdenlive 20+'],
                                ].map(([app, hint]) => (
                                    <div key={app} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-3)', minWidth: 110 }}>{app}</span>
                                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)' }}>{hint}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            </div>

            {/* Spin keyframe — injected once */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default ExportModal;
