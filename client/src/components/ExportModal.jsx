import React, { useState, useEffect } from 'react';
import { X, Film, Download, Tv2, Smartphone, Youtube, Clapperboard, CheckCircle2, Loader2, AlertCircle, FileCode2, Scissors, Zap } from 'lucide-react';
import { exportToNLE } from '../services/nleExportService';
import useTimelineStore from '../store/useTimelineStore';

// ============================================================================
// PLATFORM DEFINITIONS (mirrors backend)
// ============================================================================

const PLATFORMS = [
    {
        id: 'youtube',
        label: 'YouTube',
        icon: Youtube,
        aspectRatio: '16:9',
        resolution: '1920×1080',
        fps: 30,
        color: 'from-red-500/20 to-red-600/10',
        border: 'border-red-500/40',
        text: 'text-red-400',
        badge: 'bg-red-500/20 text-red-300'
    },
    {
        id: 'tiktok',
        label: 'TikTok',
        icon: Smartphone,
        aspectRatio: '9:16',
        resolution: '1080×1920',
        fps: 30,
        color: 'from-pink-500/20 to-fuchsia-600/10',
        border: 'border-pink-500/40',
        text: 'text-pink-400',
        badge: 'bg-pink-500/20 text-pink-300'
    },
    {
        id: 'reels',
        label: 'IG Reels',
        icon: Clapperboard,
        aspectRatio: '9:16',
        resolution: '1080×1920',
        fps: 30,
        color: 'from-orange-500/20 to-amber-600/10',
        border: 'border-orange-500/40',
        text: 'text-orange-400',
        badge: 'bg-orange-500/20 text-orange-300'
    },
    {
        id: 'shorts',
        label: 'Shorts',
        icon: Tv2,
        aspectRatio: '9:16',
        resolution: '1080×1920',
        fps: 60,
        color: 'from-sky-500/20 to-blue-600/10',
        border: 'border-sky-500/40',
        text: 'text-sky-400',
        badge: 'bg-sky-500/20 text-sky-300'
    }
];

const RESOLUTIONS = [
    { id: '720p',  label: '720p',  sub: 'HD' },
    { id: '1080p', label: '1080p', sub: 'Full HD' },
    { id: '2k',    label: '2K',    sub: 'QHD' },
    { id: '4k',    label: '4K',    sub: 'Ultra HD' }
];

const QUALITY_PROFILES = [
    { id: 'high',   label: 'Pro',    sub: 'Max bitrate',    bitrate: '8 Mbps' },
    { id: 'medium', label: 'Social', sub: 'Optimized',      bitrate: '5 Mbps' },
    { id: 'low',    label: 'Draft',  sub: 'Fast render',    bitrate: '2 Mbps' }
];

// NLE target definitions — IDs must match POST /api/export/nle `target` values
const NLE_TARGETS = [
    {
        id:     'premiere',
        label:  'Premiere Pro',
        sub:    'xmeml v5 (.xml)',
        ext:    '.xml',
        color:  'from-indigo-500/20 to-purple-600/10',
        border: 'border-indigo-500/40',
        text:   'text-indigo-400',
        badge:  'bg-indigo-500/20 text-indigo-300',
    },
    {
        id:     'fcpx',
        label:  'Final Cut Pro',
        sub:    'FCPXML 1.8 (.fcpxml)',
        ext:    '.fcpxml',
        color:  'from-gray-500/20 to-slate-600/10',
        border: 'border-gray-400/40',
        text:   'text-gray-300',
        badge:  'bg-gray-500/20 text-gray-300',
    },
    {
        id:     'resolve',
        label:  'DaVinci Resolve',
        sub:    'xmeml v5 + OTIO',
        ext:    '.xml + .otio',
        color:  'from-yellow-500/20 to-amber-600/10',
        border: 'border-yellow-500/40',
        text:   'text-yellow-400',
        badge:  'bg-yellow-500/20 text-yellow-300',
    },
    {
        id:     'otio',
        label:  'OpenTimelineIO',
        sub:    'Universal interchange',
        ext:    '.otio',
        color:  'from-teal-500/20 to-cyan-600/10',
        border: 'border-teal-500/40',
        text:   'text-teal-400',
        badge:  'bg-teal-500/20 text-teal-300',
    },
];

// ============================================================================
// VIBED LOGO (inline SVG — no external dep, always matches brand)
// ============================================================================

const VibedLogoIcon = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
            d="M310 110 L185 265 L250 245 L200 390 L325 230 L258 248 Z"
            fill="none" stroke="#1a3fa8" strokeWidth="20" strokeLinejoin="round" strokeLinecap="round"
        />
        <line x1="248" y1="248" x2="195" y2="268" stroke="#FFB800" strokeWidth="10" strokeLinecap="round" />
    </svg>
);

// ============================================================================
// EXPORT MODAL
// ============================================================================

const ExportModal = ({ isOpen, onClose, onExport, isExporting, exportResult, exportError }) => {
    const [activeTab, setActiveTab] = useState('video');   // 'video' | 'nle'
    const [settings, setSettings] = useState({
        platform: null,
        resolution: '1080p',
        fps: 30,
        format: 'mp4',
        quality: 'high'
    });
    const [step, setStep] = useState('configure');
    const [progress, setProgress] = useState(0);
    const [nleStatus,      setNleStatus]      = useState(null); // null | 'success' | 'error'
    const [nleError,       setNleError]       = useState(null);
    const [nleLoadingId,   setNleLoadingId]   = useState(null); // id of card currently exporting

    const { tracks, aspectRatio } = useTimelineStore();

    useEffect(() => {
        if (isExporting) {
            setStep('exporting');
            let p = 0;
            const ticker = setInterval(() => {
                p = Math.min(p + Math.random() * 8, 90);
                setProgress(Math.round(p));
            }, 400);
            return () => clearInterval(ticker);
        }
    }, [isExporting]);

    useEffect(() => {
        if (exportResult) { setStep('done'); setProgress(100); }
    }, [exportResult]);

    useEffect(() => {
        if (exportError) { setStep('error'); }
    }, [exportError]);

    if (!isOpen) return null;

    const selectedPlatform = PLATFORMS.find(p => p.id === settings.platform);

    const handleClose = () => {
        setStep('configure');
        setProgress(0);
        setNleStatus(null);
        setNleError(null);
        onClose();
    };

    const handlePlatformSelect = (platformId) => {
        const p = PLATFORMS.find(pl => pl.id === platformId);
        setSettings(s => ({ ...s, platform: platformId, fps: p?.fps || 30 }));
    };

    const handleExport = () => {
        setProgress(0);
        onExport(settings);
    };

    const handleNLEExport = async (format) => {
        setNleStatus(null);
        setNleError(null);
        setNleLoadingId(format);
        try {
            await exportToNLE(format, tracks, {
                fps: settings.fps || 30,
                aspectRatio: aspectRatio || '16:9',
                title: 'Viral Pilot Export',
            });
            setNleStatus('success');
        } catch (err) {
            setNleStatus('error');
            setNleError(err.message);
        } finally {
            setNleLoadingId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-[#0f1117] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/8" style={{ background: 'rgba(8,12,24,0.8)' }}>
                    <div className="flex items-center gap-3">
                        <div
                            className="p-2 rounded-lg"
                            style={{ background: 'rgba(26,63,168,0.15)', border: '1px solid rgba(26,63,168,0.3)', boxShadow: '0 0 12px rgba(26,63,168,0.2)' }}
                        >
                            <VibedLogoIcon size={18} />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-white">Export</h2>
                            <p className="text-[10px] text-white/40">Video render · NLE project file</p>
                        </div>
                    </div>
                    <button onClick={handleClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                        <X className="w-4 h-4 text-white/50" />
                    </button>
                </div>

                {/* Tab Switcher */}
                <div className="flex border-b border-white/8 px-5 pt-3 gap-1">
                    <button
                        onClick={() => setActiveTab('video')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-semibold transition-all ${activeTab === 'video' ? 'bg-blue-500/20 text-blue-300 border-b-2 border-blue-400' : 'text-white/40 hover:text-white/70'}`}
                    >
                        <Film className="w-3 h-3" /> Video File
                    </button>
                    <button
                        onClick={() => setActiveTab('nle')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-semibold transition-all ${activeTab === 'nle' ? 'bg-indigo-500/20 text-indigo-300 border-b-2 border-indigo-400' : 'text-white/40 hover:text-white/70'}`}
                    >
                        <Scissors className="w-3 h-3" /> NLE Project
                    </button>
                </div>

                {/* ── VIDEO TAB ── */}
                {activeTab === 'video' && (
                    <>
                        {/* CONFIGURE step */}
                        {step === 'configure' && (
                            <div className="p-5 space-y-5">
                                {/* Platform Profiles */}
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-white/50 uppercase tracking-widest">Platform</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {PLATFORMS.map(pl => {
                                            const Icon = pl.icon;
                                            const isActive = settings.platform === pl.id;
                                            return (
                                                <button
                                                    key={pl.id}
                                                    onClick={() => handlePlatformSelect(pl.id)}
                                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left ${isActive ? `bg-gradient-to-br ${pl.color} ${pl.border} shadow-md` : 'bg-white/4 border-white/8 hover:bg-white/8'}`}
                                                >
                                                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? pl.text : 'text-white/40'}`} />
                                                    <div className="min-w-0">
                                                        <div className={`text-xs font-bold ${isActive ? pl.text : 'text-white/70'}`}>{pl.label}</div>
                                                        <div className="text-[9px] text-white/30 truncate">{pl.aspectRatio} · {pl.fps}fps</div>
                                                    </div>
                                                    {isActive && (
                                                        <span className={`ml-auto text-[8px] px-1.5 py-0.5 rounded-full ${pl.badge} shrink-0`}>{pl.resolution}</span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <button
                                        onClick={() => setSettings(s => ({ ...s, platform: null }))}
                                        className={`w-full text-xs py-2 rounded-lg border transition-all ${settings.platform === null ? 'bg-white/10 border-white/20 text-white' : 'bg-white/3 border-white/6 text-white/40 hover:bg-white/6'}`}
                                    >
                                        Custom settings
                                    </button>
                                </div>

                                {/* Resolution */}
                                {!settings.platform && (
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold text-white/50 uppercase tracking-widest">Resolution</label>
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {RESOLUTIONS.map(r => (
                                                <button
                                                    key={r.id}
                                                    onClick={() => setSettings(s => ({ ...s, resolution: r.id }))}
                                                    className={`py-2 rounded-lg border text-center transition-all ${settings.resolution === r.id ? 'bg-blue-500/20 border-blue-500/50 text-blue-300 shadow-md shadow-blue-500/10' : 'bg-white/4 border-white/8 text-white/50 hover:bg-white/8'}`}
                                                >
                                                    <div className="text-xs font-bold">{r.label}</div>
                                                    <div className="text-[9px] opacity-60">{r.sub}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* FPS + Format */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold text-white/50 uppercase tracking-widest">Frame Rate</label>
                                        <div className="flex bg-white/4 rounded-lg p-0.5">
                                            {[24, 30, 60].map(fps => (
                                                <button key={fps} onClick={() => setSettings(s => ({ ...s, fps }))} disabled={!!settings.platform}
                                                    className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-all ${settings.fps === fps ? 'bg-white/20 text-white' : 'text-white/30 hover:text-white/60'} ${settings.platform ? 'opacity-40 cursor-not-allowed' : ''}`}>
                                                    {fps}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold text-white/50 uppercase tracking-widest">Format</label>
                                        <div className="flex bg-white/4 rounded-lg p-0.5">
                                            {['mp4', 'webm'].map(fmt => (
                                                <button key={fmt} onClick={() => setSettings(s => ({ ...s, format: fmt }))}
                                                    className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-all ${settings.format === fmt ? 'bg-white/20 text-white' : 'text-white/30 hover:text-white/60'}`}>
                                                    {fmt.toUpperCase()}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Quality */}
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-white/50 uppercase tracking-widest">Quality</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {QUALITY_PROFILES.map(q => (
                                            <button key={q.id} onClick={() => setSettings(s => ({ ...s, quality: q.id }))}
                                                className={`py-2.5 rounded-xl border text-center transition-all ${settings.quality === q.id ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300 shadow-md' : 'bg-white/4 border-white/8 text-white/50 hover:bg-white/8'}`}>
                                                <div className="text-xs font-bold">{q.label}</div>
                                                <div className="text-[9px] opacity-70 mt-0.5">{q.bitrate}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <button onClick={handleExport}
                                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 hover:scale-[1.01] transition-all">
                                    <Download className="w-4 h-4" />
                                    {selectedPlatform ? `Export for ${selectedPlatform.label}` : 'Export Video'}
                                </button>
                            </div>
                        )}

                        {/* EXPORTING step */}
                        {step === 'exporting' && (
                            <div className="p-8 flex flex-col items-center gap-5">
                                <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center">
                                    <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                                </div>
                                <div className="text-center">
                                    <p className="text-sm font-bold text-white">Rendering your video…</p>
                                    <p className="text-xs text-white/40 mt-1">FFmpeg is concatenating clips and encoding</p>
                                </div>
                                <div className="w-full bg-white/8 rounded-full h-1.5 overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
                                </div>
                                <p className="text-xs text-white/30 font-mono">{progress}% complete</p>
                            </div>
                        )}

                        {/* DONE step */}
                        {step === 'done' && exportResult && (
                            <div className="p-8 flex flex-col items-center gap-5">
                                <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
                                    <CheckCircle2 className="w-8 h-8 text-green-400" />
                                </div>
                                <div className="text-center">
                                    <p className="text-sm font-bold text-white">Export Complete! 🎉</p>
                                    <p className="text-xs text-white/40 mt-1">{exportResult.metadata?.resolution} · {exportResult.metadata?.sizeMB} MB · {exportResult.metadata?.duration}</p>
                                </div>
                                <div className="w-full bg-white/4 rounded-xl border border-white/8 p-4 text-xs space-y-1.5 font-mono">
                                    <div className="flex justify-between"><span className="text-white/40">Codec</span><span className="text-green-300">{exportResult.metadata?.codec || 'h264'}</span></div>
                                    <div className="flex justify-between"><span className="text-white/40">Resolution</span><span className="text-white/80">{exportResult.metadata?.resolution}</span></div>
                                    <div className="flex justify-between"><span className="text-white/40">Clips merged</span><span className="text-white/80">{exportResult.metadata?.segments}</span></div>
                                    {exportResult.metadata?.platform && (
                                        <div className="flex justify-between"><span className="text-white/40">Platform</span><span className="text-blue-300">{exportResult.metadata.platform}</span></div>
                                    )}
                                </div>
                                <div className="flex gap-2 w-full">
                                    <a href={exportResult.url} download={exportResult.filename}
                                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-green-500/20 transition-all">
                                        <Download className="w-4 h-4" /> Download
                                    </a>
                                    <button onClick={() => setStep('configure')}
                                        className="px-4 py-3 rounded-xl bg-white/6 border border-white/10 hover:bg-white/10 text-white/60 text-sm font-medium transition-all">
                                        Export Again
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ERROR step */}
                        {step === 'error' && (
                            <div className="p-8 flex flex-col items-center gap-5">
                                <div className="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center">
                                    <AlertCircle className="w-8 h-8 text-red-400" />
                                </div>
                                <div className="text-center">
                                    <p className="text-sm font-bold text-white">Export Failed</p>
                                    <p className="text-xs text-red-400/70 mt-1 max-w-xs">{exportError || 'An unknown error occurred during rendering.'}</p>
                                </div>
                                <button onClick={() => setStep('configure')}
                                    className="w-full py-3 rounded-xl bg-white/6 border border-white/10 hover:bg-white/10 text-white font-bold text-sm transition-all">
                                    Try Again
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* ── NLE TAB ── */}
                {activeTab === 'nle' && (
                    <div className="p-5 space-y-4">
                        <p className="text-[11px] text-white/40 leading-relaxed">
                            Export your timeline as a project file that can be imported directly into your editing software. No re-encoding — your original media stays intact.
                        </p>

                        <div className="grid grid-cols-2 gap-2">
                            {NLE_TARGETS.map(nle => {
                                const isLoading = nleLoadingId === nle.id;
                                return (
                                    <button
                                        key={nle.id}
                                        onClick={() => handleNLEExport(nle.id)}
                                        disabled={!!nleLoadingId}
                                        className={`flex flex-col gap-1.5 px-4 py-3 rounded-xl border text-left transition-all bg-gradient-to-br ${nle.color} ${nle.border} hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className={`text-xs font-bold ${nle.text}`}>{nle.label}</span>
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${nle.badge}`}>{nle.ext}</span>
                                        </div>
                                        <span className="text-[10px] text-white/40">{nle.sub}</span>
                                        <div className={`flex items-center gap-1 mt-1 text-[10px] ${nle.text}`}>
                                            {isLoading
                                                ? <><Loader2 className="w-3 h-3 animate-spin" /><span>Generating…</span></>
                                                : <><Download className="w-3 h-3" /><span>Download</span></>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Status messages */}
                        {nleStatus === 'success' && (
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-green-500/10 border border-green-500/30">
                                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                                <span className="text-xs text-green-300">Project file downloaded successfully!</span>
                            </div>
                        )}
                        {nleStatus === 'error' && (
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30">
                                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                                <span className="text-xs text-red-300">{nleError || 'Failed to generate project file.'}</span>
                            </div>
                        )}

                        <div className="pt-1 border-t border-white/6">
                            <p className="text-[10px] text-white/25 leading-relaxed">
                                <strong className="text-white/40">Premiere Pro</strong> — File → Import → .xml (xmeml v5)<br />
                                <strong className="text-white/40">Final Cut Pro</strong> — File → Import → XML → .fcpxml (FCPXML 1.8)<br />
                                <strong className="text-white/40">DaVinci Resolve</strong> — downloads both .xml &amp; .otio (Resolve 18+ supports OTIO natively)<br />
                                <strong className="text-white/40">OTIO</strong> — universal interchange; works in Resolve 18, Premiere (beta), Kdenlive 20+
                            </p>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default ExportModal;
