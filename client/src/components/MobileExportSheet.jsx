import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Share as ShareIcon, Download, AlertCircle, RotateCw, SlidersHorizontal } from 'lucide-react';
import useTimelineStore from '../store/useTimelineStore';
import { PLATFORMS, RESOLUTIONS, QUALITY_PROFILES } from './exportPresets.js';
import MobileSheet, { SheetLabel } from './MobileSheet';
import ShareDestinations from './ShareDestinations.jsx';

/**
 * MobileExportSheet — export on phones (phase 7), as one bottom sheet:
 *   options  → platform (sets fps), resolution, quality, Export video
 *   progress → real render progress from the export job (IDELayout passes
 *              exportProgress); the render runs on the server and IDELayout
 *              resumes it if the page is closed and the project reopened
 *   done     → preview, Save to phone (share sheet with the file where the
 *              phone supports it, else a download), Share, Export again
 *   error    → message + Try again
 * Audio export and project files for other editors stay in the full
 * ExportModal ("More options"). Mobile only; desktop keeps ExportModal.
 */

const seg = (active) => ({
    height: 40, borderRadius: 9, border: 0, cursor: 'pointer',
    background: active ? 'var(--bg-3)' : 'transparent', color: active ? 'var(--fg)' : 'var(--fg-3)',
    fontFamily: 'var(--f-sans)', fontSize: 13.5, fontWeight: 600,
});

async function fetchAsFile(url, filename) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    return new File([blob], filename || 'vibed-export.mp4', { type: blob.type || 'video/mp4' });
}

function downloadFile(file) {
    const href = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = href;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export default function MobileExportSheet({ open, onClose, onExport, isExporting, progress, result, error, onMoreOptions }) {
    const { t } = useTranslation('editor');
    const aspectRatio = useTimelineStore(s => s.aspectRatio);
    // No platform by default: the export then follows the PROJECT's aspect
    // ratio (server: getResolutionDimensions). A platform preset overrides
    // the frame size on the server, and this used to be pre-picked from the
    // aspect ratio at the editor's first render (always the '16:9' default,
    // before the video's real ratio is known), so every export came out
    // 1920×1080 as "YouTube" whatever the video's format.
    const [settings, setSettings] = useState({ platform: null, resolution: '1080p', fps: 30, format: 'mp4', quality: 'high', engine: 'ffmpeg' });
    // "Export again" / "Try again" show the options even though the last
    // result or error is still set in IDELayout.
    const [showOptions, setShowOptions] = useState(false);
    const [busy, setBusy] = useState(null); // 'save' | 'share' | null
    const [shareError, setShareError] = useState(null);
    // The exported file, fetched BEFORE the user taps Share. See save().
    const [readyFile, setReadyFile] = useState(null);

    // iOS requires navigator.share() to be called while the tap is still the
    // active user gesture. Awaiting a multi-MB download first spends that
    // activation and share() then throws NotAllowedError, which is what the
    // user saw: tap Share, get an error. Fetching the file as soon as the
    // render lands means the tap handler can call share() synchronously.
    useEffect(() => {
        if (!open || !result?.url) { setReadyFile(null); return undefined; }
        let cancelled = false;
        fetchAsFile(result.url, result.filename)
            .then((f) => { if (!cancelled) setReadyFile(f); })
            .catch(() => { /* save() falls back to fetching on demand */ });
        return () => { cancelled = true; };
    }, [open, result?.url, result?.filename]);

    if (!open) return null;

    const view = isExporting ? 'progress'
        : showOptions ? 'options'
        : result ? 'done'
        : error ? 'error'
        : 'options';

    const start = () => { setShowOptions(false); setShareError(null); onExport(settings); };
    const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

    const shareFailed = (err, mode) => {
        // Dismissing the share sheet is not a failure.
        if (err?.name === 'AbortError') return;
        console.error('[MobileExportSheet] save/share failed:', err);
        if (mode === 'save') window.open(result.url, '_blank');
        else setShareError(t('mobileExport.shareFailed'));
    };

    // Deliberately NOT async. On iOS the share sheet only opens if
    // navigator.share() runs inside the tap's user activation, so when the
    // file is already in hand it is called here with nothing awaited before
    // it. The async path below is only for the case where the prefetch has
    // not finished or failed, where a download is the outcome anyway.
    const save = (mode) => {
        if (!result?.url) return;
        setShareError(null);

        if (readyFile && canShareFiles && navigator.canShare({ files: [readyFile] })) {
            // iOS / Android share sheet: "Save video", TikTok, Instagram…
            navigator.share({ files: [readyFile], title: readyFile.name })
                .catch((err) => shareFailed(err, mode));
            return;
        }
        if (readyFile && mode === 'save') {
            downloadFile(readyFile);
            return;
        }
        saveSlowPath(mode);
    };

    const saveSlowPath = async (mode) => {
        setBusy(mode);
        try {
            const file = await fetchAsFile(result.url, result.filename);
            if (mode === 'save') {
                downloadFile(file);
            } else if (canShareFiles && navigator.canShare({ files: [file] })) {
                // Activation is likely already spent by the await above, so
                // this can still be refused on iOS. It is the last resort.
                await navigator.share({ files: [file], title: file.name });
            } else {
                setShareError(t('mobileExport.shareUnsupported'));
            }
        } catch (err) {
            shareFailed(err, mode);
        } finally {
            setBusy(null);
        }
    };

    const platform = PLATFORMS.find(p => p.id === settings.platform);
    const qualityLabel = t(QUALITY_PROFILES.find(q => q.id === settings.quality)?.labelKey || 'exportModal.qualityPro');

    return (
        <MobileSheet open title={t('mobileExport.title')} onClose={onClose}>
            {view === 'options' && (
                <>
                    <SheetLabel>{t('mobileExport.madeFor')}</SheetLabel>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                        {PLATFORMS.map(p => {
                            const active = settings.platform === p.id;
                            return (
                                <button
                                    key={p.id} type="button" aria-pressed={active}
                                    onClick={() => setSettings(s => ({ ...s, platform: active ? null : p.id, fps: p.fps }))}
                                    style={{
                                        height: 62, borderRadius: 'var(--r-sm)', cursor: 'pointer', padding: 0,
                                        border: active ? '2px solid var(--accent)' : '1px solid var(--line-strong)',
                                        background: 'var(--bg-3)', color: 'var(--fg)',
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                                    }}
                                >
                                    <span style={{ fontFamily: 'var(--f-sans)', fontSize: 12.5, fontWeight: 600 }}>{p.label}</span>
                                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9.5, color: 'var(--fg-3)' }}>{p.ar} · {p.fps}</span>
                                </button>
                            );
                        })}
                    </div>

                    {platform && platform.ar !== (aspectRatio || '16:9') && (
                        <p role="note" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--coral)' }}>
                            {t('mobileExport.formatMismatch', { platform: platform.label, platformRatio: platform.ar, ratio: aspectRatio || '16:9' })}
                        </p>
                    )}
                    {!platform && (
                        <p style={{ margin: 0, fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-2)' }}>
                            {t('mobileExport.keepsFormat', { ratio: aspectRatio || '16:9' })}
                        </p>
                    )}

                    <SheetLabel>{t('exportModal.labelResolution')}</SheetLabel>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${RESOLUTIONS.length}, minmax(0, 1fr))`, gap: 4, padding: 4, borderRadius: 12, background: 'var(--bg)' }}>
                        {RESOLUTIONS.map(r => (
                            <button key={r.id} type="button" aria-pressed={settings.resolution === r.id} style={seg(settings.resolution === r.id)}
                                onClick={() => setSettings(s => ({ ...s, resolution: r.id }))}>{r.label}</button>
                        ))}
                    </div>

                    <SheetLabel>{t('exportModal.labelQuality')}</SheetLabel>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${QUALITY_PROFILES.length}, minmax(0, 1fr))`, gap: 4, padding: 4, borderRadius: 12, background: 'var(--bg)' }}>
                        {QUALITY_PROFILES.map(q => (
                            <button key={q.id} type="button" aria-pressed={settings.quality === q.id} style={seg(settings.quality === q.id)}
                                onClick={() => setSettings(s => ({ ...s, quality: q.id }))}>{t(q.labelKey)}</button>
                        ))}
                    </div>

                    <button
                        type="button" onClick={start}
                        style={{ height: 52, marginTop: 4, borderRadius: 'var(--r-sm)', border: 0, background: 'var(--accent)', color: '#fff', fontFamily: 'var(--f-sans)', fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                    >
                        <ShareIcon size={18} /> {t('mobileExport.exportVideo')}
                    </button>
                    <button
                        type="button" onClick={onMoreOptions}
                        style={{ minHeight: 44, border: 0, background: 'transparent', color: 'var(--fg-2)', fontFamily: 'var(--f-sans)', fontSize: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                    >
                        <SlidersHorizontal size={16} /> {t('mobileExport.moreOptions')}
                    </button>
                </>
            )}

            {view === 'progress' && (
                <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '8px 4px 4px', textAlign: 'center' }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 40, fontWeight: 600 }}>{Math.round(progress || 0)}%</span>
                    <span style={{ fontSize: 17, fontWeight: 600 }}>
                        {platform ? t('mobileExport.exportingFor', { platform: platform.label }) : t('mobileExport.exporting')}
                    </span>
                    <div aria-hidden="true" style={{ width: '100%', height: 6, borderRadius: 3, background: 'var(--line-strong)', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(2, Math.round(progress || 0))}%`, height: '100%', borderRadius: 3, background: 'var(--accent)', transition: 'width .4s ease' }} />
                    </div>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-3)' }}>
                        {RESOLUTIONS.find(r => r.id === settings.resolution)?.label} · {qualityLabel}
                    </span>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--fg-2)' }}>{t('mobileExport.leaveNote')}</p>
                </div>
            )}

            {view === 'done' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
                    <video
                        src={result.url} controls playsInline preload="metadata"
                        style={{ width: '100%', maxHeight: '36vh', borderRadius: 'var(--r-sm)', background: '#000' }}
                    />
                    <span style={{ fontSize: 17, fontWeight: 600 }}>{t('mobileExport.ready')}</span>
                    {(result.metadata?.resolution || result.metadata?.sizeMB) && (
                        <span style={{ marginTop: -6, fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-3)' }}>
                            {[result.metadata?.resolution, result.metadata?.sizeMB ? `${result.metadata.sizeMB} MB` : null, 'MP4'].filter(Boolean).join(' · ')}
                        </span>
                    )}
                    <button
                        type="button" onClick={() => save('save')} disabled={!!busy}
                        style={{ width: '100%', height: 52, borderRadius: 'var(--r-sm)', border: 0, background: 'var(--accent)', color: '#fff', fontFamily: 'var(--f-sans)', fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy ? 0.7 : 1 }}
                    >
                        <Download size={18} /> {busy === 'save' ? t('mobileExport.preparingFile') : t('mobileExport.save')}
                    </button>
                    {canShareFiles && (
                        <button
                            type="button" onClick={() => save('share')} disabled={!!busy}
                            style={{ width: '100%', height: 48, borderRadius: 'var(--r-sm)', border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                        >
                            <ShareIcon size={17} /> {busy === 'share' ? t('mobileExport.preparingFile') : t('mobileExport.share')}
                        </button>
                    )}
                    {shareError && <span style={{ fontSize: 12.5, color: 'var(--coral)' }}>{shareError}</span>}

                    {/* Below Save and Share, not instead of them: the phone's
                        own share sheet already reaches TikTok and Instagram
                        and keeps working whatever the API review says. */}
                    <ShareDestinations />

                    <button
                        type="button" onClick={() => setShowOptions(true)}
                        style={{ minHeight: 44, border: 0, background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 500 }}
                    >
                        {t('mobileExport.exportAgain')}
                    </button>
                </div>
            )}

            {view === 'error' && (
                <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
                    <span style={{ width: 48, height: 48, borderRadius: 24, background: 'color-mix(in oklch, var(--coral) 16%, transparent)', color: 'var(--coral)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <AlertCircle size={24} />
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 600 }}>{t('mobileExport.failed')}</span>
                    <span style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.5, wordBreak: 'break-word' }}>{error}</span>
                    <button
                        type="button" onClick={() => setShowOptions(true)}
                        style={{ width: '100%', height: 48, borderRadius: 'var(--r-sm)', border: 0, background: 'var(--accent)', color: '#fff', fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                    >
                        <RotateCw size={17} /> {t('mobileExport.tryAgain')}
                    </button>
                </div>
            )}
        </MobileSheet>
    );
}
