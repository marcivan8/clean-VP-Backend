import React, { useState, useEffect, useCallback } from 'react';
import {
    X, Film, Download, Tv2, Smartphone, Youtube,
    Clapperboard, CheckCircle2, Loader2, AlertCircle,
    Scissors, ArrowRight, Music2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { exportToNLE } from '../services/nleExportService';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../store/useTimelineStore';
import { useAudioEngine } from '../hooks/useAudioEngine.js';

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
    { id: 'high',   labelKey: 'exportModal.qualityPro',    bitrate: '8 Mbps',  subKey: 'exportModal.qualityMaxBitrate'  },
    { id: 'medium', labelKey: 'exportModal.qualitySocial', bitrate: '5 Mbps',  subKey: 'exportModal.qualityBalanced'     },
    { id: 'low',    labelKey: 'exportModal.qualityDraft',  bitrate: '2 Mbps',  subKey: 'exportModal.qualityFastRender'  },
];

// Two render pipelines live side by side (see CLAUDE.md NODE 1 · SYSTEM ARCHITECTURE):
//   ffmpeg  → jobs/exportProcessor.js via BullMQ — the default, fast and battle-tested.
//   revideo → render-lambda/ (AWS Lambda + Chromium) — renders through a real browser
//             engine instead of FFmpeg's drawtext filter, so fonts/effects are more
//             faithful, but it depends on backend env vars that may not be configured
//             on every deployment (see routes/revideoRenderRoutes.js).
const RENDER_ENGINES = [
    { id: 'ffmpeg',  labelKey: 'exportModal.engineStandard',  subKey: 'exportModal.engineFastStable' },
    { id: 'revideo', labelKey: 'exportModal.engineCinematic', subKey: 'exportModal.engineChromiumRender', beta: true },
];

const AUDIO_FORMATS = [
    { value: 'mp3', label: 'MP3', hintKey: 'audioFormatHintMp3' },
    { value: 'wav', label: 'WAV', hintKey: 'audioFormatHintWav' },
    { value: 'm4a', label: 'M4A', hintKey: 'audioFormatHintM4a' },
    { value: 'aac', label: 'AAC', hintKey: 'audioFormatHintAac' },
];

const AUDIO_BITRATES = ['128k', '192k', '256k', '320k'];

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
    const { t } = useTranslation('editor');
    const [activeTab, setActiveTab] = useState('video');
    const [settings, setSettings]   = useState({ platform: null, resolution: '1080p', fps: 30, format: 'mp4', quality: 'high', engine: 'ffmpeg' });
    const [step, setStep]           = useState('configure');
    const [progress, setProgress]   = useState(0);
    const [nleStatus, setNleStatus] = useState(null);
    const [nleError,  setNleError]  = useState(null);
    const [nleLoading, setNleLoading] = useState(null);

    // Audio export tab state
    const { exportAudio } = useAudioEngine();
    const [audioFormat,    setAudioFormat]    = useState('mp3');
    const [audioBitrate,   setAudioBitrate]   = useState('192k');
    const [audioNormalize, setAudioNormalize] = useState(false);
    const [audioTrimStart, setAudioTrimStart] = useState('');
    const [audioTrimEnd,   setAudioTrimEnd]   = useState('');
    const [audioStatus,    setAudioStatus]    = useState('idle'); // idle | exporting | done | error
    const [audioError,     setAudioError]     = useState('');

    const { tracks, aspectRatio } = useTimelineStore(useShallow(s => ({ tracks: s.tracks, aspectRatio: s.aspectRatio })));

    const handleAudioExport = useCallback(async () => {
        setAudioStatus('exporting');
        setAudioError('');
        try {
            await exportAudio({
                format:    audioFormat,
                bitrate:   audioBitrate,
                normalize: audioNormalize,
                trimStart: audioTrimStart ? Number(audioTrimStart) : undefined,
                trimEnd:   audioTrimEnd   ? Number(audioTrimEnd)   : undefined,
            });
            setAudioStatus('done');
        } catch (e) {
            console.error('[ExportModal] audio export error:', e.message);
            setAudioError(e.message);
            setAudioStatus('error');
        }
    }, [exportAudio, audioFormat, audioBitrate, audioNormalize, audioTrimStart, audioTrimEnd]);

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
        setAudioStatus('idle'); setAudioError('');
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
                                {t('exportModal.header')}
                            </p>
                            <Label>{t('exportModal.headerSub')}</Label>
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
                        { id: 'video', icon: Film,    label: t('exportModal.tabVideo') },
                        { id: 'audio', icon: Music2,  label: t('exportModal.tabAudio') },
                        { id: 'nle',   icon: Scissors, label: t('exportModal.tabNle') },
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
                                    <Label>{t('exportModal.labelPlatform')}</Label>
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
                                        <Label>{t('exportModal.labelResolution')}</Label>
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
                                    <Label>{t('exportModal.labelQuality')}</Label>
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
                                                        {t(q.labelKey)}
                                                    </span>
                                                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: active ? 'color-mix(in oklch, var(--accent) 80%, var(--fg-3))' : 'var(--fg-4)', letterSpacing: '0.02em' }}>
                                                        {q.bitrate}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Render Engine */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <Label>{t('exportModal.renderEngine')}</Label>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                        {RENDER_ENGINES.map(eng => {
                                            const active = settings.engine === eng.id;
                                            return (
                                                <button
                                                    key={eng.id}
                                                    onClick={() => setSettings(s => ({ ...s, engine: eng.id }))}
                                                    style={selCard(active)}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--fg)' : 'var(--fg-2)', letterSpacing: '-0.005em' }}>
                                                            {t(eng.labelKey)}
                                                        </span>
                                                        {eng.beta && (
                                                            <span style={{
                                                                fontFamily: 'var(--f-mono)', fontSize: 9, fontWeight: 700,
                                                                letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 4,
                                                                background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
                                                                border: '0.5px solid color-mix(in oklch, var(--accent) 28%, transparent)',
                                                                color: 'var(--accent)',
                                                            }}>
                                                                {t('exportModal.beta')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p style={{ margin: 0, fontFamily: 'var(--f-mono)', fontSize: 10, color: active ? 'var(--fg-3)' : 'var(--fg-4)', letterSpacing: '0.04em' }}>
                                                        {t(eng.subKey)}
                                                    </p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {settings.engine === 'revideo' && (
                                        <p style={{ margin: 0, fontSize: 10.5, color: 'var(--fg-4)', fontFamily: 'var(--f-mono)', lineHeight: 1.5 }}>
                                            {t('exportModal.revideoWarning')}
                                        </p>
                                    )}
                                </div>

                                {/* FPS / Format — compact row */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <Label>{t('exportModal.labelFrameRate')}</Label>
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
                                        <Label>{t('exportModal.labelFormat')}</Label>
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
                                    {selectedPlatform ? t('exportModal.exportFor', { platform: selectedPlatform.label }) : t('exportModal.exportVideo')}
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
                                        {t('exportModal.rendering')}
                                    </p>
                                    <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-4)', fontFamily: 'var(--f-mono)' }}>
                                        {t('exportModal.renderingSub')}
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
                                            {t('exportModal.renderComplete')}
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
                                        { k: t('exportModal.metaCodec'),    v: exportResult.metadata?.codec || 'H.264' },
                                        { k: t('exportModal.metaSize'),     v: `${exportResult.metadata?.sizeMB || '?'} MB` },
                                        { k: t('exportModal.metaClips'),    v: exportResult.metadata?.segments ?? '—' },
                                        { k: t('exportModal.metaPlatform'), v: exportResult.metadata?.platform || t('exportModal.metaCustom') },
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
                                        <Download size={14} /> {t('exportModal.downloadBtn')}
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
                                        {t('exportModal.exportAgain')}
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
                                    <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>{t('exportModal.renderFailed')}</p>
                                    <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-4)', fontFamily: 'var(--f-mono)', maxWidth: 280 }}>
                                        {exportError || ''}
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
                                    {t('exportModal.tryAgain')}
                                </button>
                            </div>
                        )}
                        </>
                    )}

                    {/* ════ AUDIO TAB ════ */}
                    {activeTab === 'audio' && (
                        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-4)', lineHeight: 1.6, fontFamily: 'var(--f-mono)' }}>
                                {t('exportModal.audioDescription')}
                            </p>

                            {/* Format */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <Label>{t('exportModal.labelAudioFormat')}</Label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
                                    {AUDIO_FORMATS.map(f => {
                                        const active = audioFormat === f.value;
                                        return (
                                            <button key={f.value} onClick={() => setAudioFormat(f.value)} style={selCard(active)}>
                                                <span style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--fg)' : 'var(--fg-2)', textAlign: 'center' }}>
                                                    {f.label}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <p style={{ margin: 0, fontSize: 10.5, color: 'var(--fg-4)', fontFamily: 'var(--f-mono)' }}>
                                    {t(`exportModal.${AUDIO_FORMATS.find(f => f.value === audioFormat)?.hintKey}`)}
                                </p>
                            </div>

                            {/* Bitrate (hidden for wav) */}
                            {audioFormat !== 'wav' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <Label>{t('exportModal.labelAudioBitrate')}</Label>
                                    <div style={{
                                        display: 'flex', gap: 2,
                                        background: 'var(--glass)',
                                        border: '0.5px solid var(--line)',
                                        borderRadius: 'var(--r-sm)',
                                        padding: 3,
                                    }}>
                                        {AUDIO_BITRATES.map(b => (
                                            <button key={b} onClick={() => setAudioBitrate(b)} style={pill(audioBitrate === b)}>
                                                {b}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Normalize */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{t('exportModal.audioNormalize')}</span>
                                <button
                                    onClick={() => setAudioNormalize(n => !n)}
                                    style={{
                                        width: 34, height: 18, borderRadius: 9,
                                        border: 'none', cursor: 'pointer',
                                        background: audioNormalize
                                            ? 'linear-gradient(135deg, var(--accent), var(--violet))'
                                            : 'var(--glass)',
                                        transition: 'background 0.15s',
                                        position: 'relative', flexShrink: 0,
                                    }}
                                >
                                    <span style={{
                                        position: 'absolute',
                                        top: 2, left: audioNormalize ? 18 : 2,
                                        width: 14, height: 14, borderRadius: '50%',
                                        background: '#fff', transition: 'left 0.15s',
                                    }} />
                                </button>
                            </div>

                            {/* Trim */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <Label>{t('exportModal.audioTrimStart')}</Label>
                                    <input
                                        type="number" min="0" step="0.1" placeholder="0"
                                        value={audioTrimStart}
                                        onChange={e => setAudioTrimStart(e.target.value)}
                                        style={{
                                            width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                                            background: 'var(--glass)', border: '0.5px solid var(--line)',
                                            borderRadius: 'var(--r-sm)', color: 'var(--fg)', fontSize: 12,
                                            fontFamily: 'var(--f-mono)', outline: 'none',
                                        }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <Label>{t('exportModal.audioTrimEnd')}</Label>
                                    <input
                                        type="number" min="0" step="0.1" placeholder="end"
                                        value={audioTrimEnd}
                                        onChange={e => setAudioTrimEnd(e.target.value)}
                                        style={{
                                            width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                                            background: 'var(--glass)', border: '0.5px solid var(--line)',
                                            borderRadius: 'var(--r-sm)', color: 'var(--fg)', fontSize: 12,
                                            fontFamily: 'var(--f-mono)', outline: 'none',
                                        }}
                                    />
                                </div>
                            </div>

                            {audioStatus === 'error' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'color-mix(in srgb, #f04040 8%, transparent)', border: '0.5px solid color-mix(in srgb, #f04040 25%, transparent)' }}>
                                    <AlertCircle size={14} style={{ color: '#f04040', flexShrink: 0 }} />
                                    <span style={{ fontSize: 12, color: '#f04040', fontFamily: 'var(--f-mono)' }}>{audioError}</span>
                                </div>
                            )}

                            {/* CTA */}
                            <button
                                onClick={audioStatus === 'done' ? () => setAudioStatus('idle') : handleAudioExport}
                                disabled={audioStatus === 'exporting'}
                                className="glass-button-pro"
                                style={{
                                    width: '100%', padding: '14px 0',
                                    borderRadius: 'var(--r-md)',
                                    fontSize: 13, fontWeight: 700, letterSpacing: '0.06em',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    cursor: audioStatus === 'exporting' ? 'not-allowed' : 'pointer',
                                    opacity: audioStatus === 'exporting' ? 0.7 : 1,
                                }}
                            >
                                {audioStatus === 'exporting' ? (
                                    <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> {t('exportModal.audioExporting')}</>
                                ) : audioStatus === 'done' ? (
                                    <><CheckCircle2 size={14} /> {t('exportModal.audioDownloaded')}</>
                                ) : (
                                    <><Download size={14} /> {t('exportModal.exportAudioBtn', { format: audioFormat.toUpperCase() })}</>
                                )}
                            </button>
                        </div>
                    )}

                    {/* ════ NLE TAB ════ */}
                    {activeTab === 'nle' && (
                        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-4)', lineHeight: 1.6, fontFamily: 'var(--f-mono)' }}>
                                {t('exportModal.nleDescription')}
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
                                                    ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> {t('exportModal.nleGenerating')}</>
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
                                    <span style={{ fontSize: 12, color: '#00c97a', fontFamily: 'var(--f-mono)' }}>{t('exportModal.nleSuccess')}</span>
                                </div>
                            )}
                            {nleStatus === 'error' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 'var(--r-sm)', background: 'color-mix(in srgb, #f04040 8%, transparent)', border: '0.5px solid color-mix(in srgb, #f04040 25%, transparent)' }}>
                                    <AlertCircle size={14} style={{ color: '#f04040', flexShrink: 0 }} />
                                    <span style={{ fontSize: 12, color: '#f04040', fontFamily: 'var(--f-mono)' }}>{nleError || t('exportModal.nleFailed')}</span>
                                </div>
                            )}

                            <Sep />

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {[
                                    ['Premiere Pro',    t('exportModal.nleHintPremiere')],
                                    ['Final Cut Pro',   t('exportModal.nleHintFcpx')],
                                    ['DaVinci Resolve', t('exportModal.nleHintResolve')],
                                    ['OpenTimelineIO',  t('exportModal.nleHintOtio')],
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
