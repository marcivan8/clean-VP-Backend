import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Check, AlertCircle, RotateCw, X } from 'lucide-react';
import useTimelineStore from '../store/useTimelineStore';
import { summarizeUploads, toMB, UPLOAD_PHASES, isProblemPhase } from '../utils/uploadStatus.js';

/**
 * MobileUploadStatus — mobile-only upload feedback drawn ON the preview.
 *
 * Mobile users only ever saw a black preview while their video uploaded and
 * its proxy was encoded: the progress lived in the Media and AI sheets, which
 * are closed by default. This puts it where they are looking:
 *   - a full card (progress ring + Upload → Prepare → Ready steps) while
 *     nothing on the main track can play yet,
 *   - a small pill when other videos are still coming in,
 *   - a "Your video is ready" toast when one finishes,
 *   - a failure card with Try again / Remove when the upload itself failed.
 * Reads only existing asset fields (see utils/uploadStatus.js); renders
 * nothing once everything is ready. IDELayout mounts it on mobile only.
 *
 * Props: onRetry(assetId), onRemove(assetId), onUploadAgain(assetId)
 */

const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;
const TOAST_MS = 4000;

const STYLE = `
@keyframes vibed-upload-slide { 0% { transform: translateX(-110%); } 100% { transform: translateX(260%); } }
@keyframes vibed-upload-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) {
  .vibed-upload-anim { animation: none !important; }
}`;

function Ring({ progress }) {
    const gid = useId().replace(/:/g, '');
    const pct = Math.max(0, Math.min(100, progress || 0));
    return (
        <div style={{ position: 'relative', width: 72, height: 72 }}>
            <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
                <defs>
                    {/* Same cyan → violet as the Vibed logo mark */}
                    <linearGradient id={`ring-${gid}`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#00E5FF" />
                        <stop offset="100%" stopColor="#8A2BE2" />
                    </linearGradient>
                </defs>
                <circle cx="36" cy="36" r={RING_R} fill="none" stroke="var(--line-strong)" strokeWidth="5" />
                <circle
                    cx="36" cy="36" r={RING_R} fill="none" stroke={`url(#ring-${gid})`} strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - pct / 100)} transform="rotate(-90 36 36)"
                    style={{ transition: 'stroke-dashoffset .3s ease' }}
                />
            </svg>
            <span style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--f-mono)', fontSize: 15, fontWeight: 600, color: 'var(--fg)',
            }}>{Math.round(pct)}%</span>
        </div>
    );
}

function Steps({ phase }) {
    const { t } = useTranslation('editor');
    const labels = [t('mobileUpload.stepUpload'), t('mobileUpload.stepPrepare'), t('mobileUpload.stepReady')];
    const failedAt = isProblemPhase(phase) ? 0 : -1;
    const activeIdx = phase === UPLOAD_PHASES.UPLOADING ? 0 : phase === UPLOAD_PHASES.PREPARING ? 1 : -1;
    return (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {labels.map((label, i) => {
                const done = activeIdx > i;
                const active = activeIdx === i;
                const failed = failedAt === i;
                let dot;
                if (failed) {
                    dot = <span style={{ width: 18, height: 18, borderRadius: 9, background: 'var(--coral)', color: '#1A0A06', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={11} strokeWidth={3} /></span>;
                } else if (done) {
                    dot = <span style={{ width: 18, height: 18, borderRadius: 9, background: 'var(--mint)', color: '#04140D', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Check size={12} strokeWidth={3} /></span>;
                } else if (active) {
                    dot = (
                        <span style={{ width: 18, height: 18, borderRadius: 9, boxSizing: 'border-box', border: '2px solid var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="vibed-upload-anim" style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)', animation: 'vibed-upload-pulse 1.4s ease-in-out infinite' }} />
                        </span>
                    );
                } else {
                    dot = <span style={{ width: 18, height: 18, borderRadius: 9, boxSizing: 'border-box', border: '2px solid var(--line-strong)' }} />;
                }
                return (
                    <React.Fragment key={label}>
                        <li style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: active || done ? 'var(--fg)' : 'var(--fg-3)' }}>
                            {dot}{label}
                        </li>
                        {i < labels.length - 1 && <li aria-hidden="true" style={{ width: 16, height: 1, background: 'var(--line-strong)' }} />}
                    </React.Fragment>
                );
            })}
        </ol>
    );
}

const btnPrimary = {
    height: 44, padding: '0 16px', borderRadius: 'var(--r-sm)', border: 0, background: 'var(--accent)', color: '#fff',
    fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
};
const btnGhost = {
    height: 44, padding: '0 16px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line-strong)', background: 'transparent',
    color: 'var(--fg)', fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

function FullCard({ item, onRetry, onRemove, onUploadAgain, onMinimize }) {
    const { t } = useTranslation('editor');
    const totalMB = toMB(item.size);
    const problem = isProblemPhase(item.phase);
    return (
        <div
            role={problem ? 'alert' : 'status'}
            aria-live="polite"
            style={{
                position: 'absolute', inset: 0, zIndex: 25, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 12, padding: '0 28px', textAlign: 'center', background: 'var(--bg-2)', fontFamily: 'var(--f-sans)', color: 'var(--fg)',
            }}
        >
            {item.phase === UPLOAD_PHASES.UPLOADING && <Ring progress={item.progress} />}
            {item.phase === UPLOAD_PHASES.PREPARING && (
                <span className="vibed-upload-anim animate-spin" style={{ width: 40, height: 40, borderRadius: 20, boxSizing: 'border-box', border: '4px solid var(--line-strong)', borderTopColor: 'var(--accent)' }} />
            )}
            {problem && (
                <span style={{ width: 48, height: 48, borderRadius: 24, background: 'color-mix(in oklch, var(--coral) 16%, transparent)', color: 'var(--coral)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertCircle size={24} />
                </span>
            )}

            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                {item.phase === UPLOAD_PHASES.UPLOADING && t('mobileUpload.uploadingTitle')}
                {item.phase === UPLOAD_PHASES.PREPARING && t('mobileUpload.preparingTitle')}
                {item.phase === UPLOAD_PHASES.FAILED && t('mobileUpload.failedTitle')}
                {item.phase === UPLOAD_PHASES.INTERRUPTED && t('mobileUpload.interruptedTitle')}
            </h2>

            {item.phase === UPLOAD_PHASES.UPLOADING && (
                <p style={{ margin: 0, fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-2)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                    {totalMB ? ` · ${t('mobileUpload.mbOf', { done: Math.round(totalMB * (item.progress || 0) / 100), total: totalMB })}` : ''}
                </p>
            )}
            {item.phase === UPLOAD_PHASES.PREPARING && (
                <>
                    <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--fg-2)' }}>{t('mobileUpload.preparingBody')}</p>
                    <div aria-hidden="true" style={{ width: 220, height: 4, borderRadius: 2, background: 'var(--line-strong)', overflow: 'hidden' }}>
                        <div className="vibed-upload-anim" style={{ width: '40%', height: '100%', borderRadius: 2, background: 'var(--accent)', animation: 'vibed-upload-slide 1.6s ease-in-out infinite' }} />
                    </div>
                </>
            )}
            {problem && (
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--fg-2)' }}>
                    {item.phase === UPLOAD_PHASES.FAILED ? t('mobileUpload.failedBody') : t('mobileUpload.interruptedBody')}
                </p>
            )}

            <Steps phase={item.phase} />

            {item.phase === UPLOAD_PHASES.UPLOADING && (
                <p style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--fg-3)' }}>{t('mobileUpload.keepOpen')}</p>
            )}
            {!problem && (
                // The player already uses the local file while it uploads; on
                // phones that can play it, let people watch instead of the card.
                <button type="button" onClick={onMinimize}
                    style={{ minHeight: 44, padding: '0 12px', border: 0, background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--f-sans)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                    {t('mobileUpload.showPreview')}
                </button>
            )}
            {problem && (
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    {item.phase === UPLOAD_PHASES.FAILED ? (
                        <button type="button" style={btnPrimary} onClick={() => onRetry?.(item.id)}>
                            <RotateCw size={17} /> {t('mobileUpload.tryAgain')}
                        </button>
                    ) : (
                        <button type="button" style={btnPrimary} onClick={() => onUploadAgain?.(item.id)}>
                            <RotateCw size={17} /> {t('mobileUpload.uploadAgain')}
                        </button>
                    )}
                    <button type="button" style={btnGhost} onClick={() => onRemove?.(item.id)}>{t('mobileUpload.remove')}</button>
                </div>
            )}
        </div>
    );
}

function Pill({ items, onRetry }) {
    const { t } = useTranslation('editor');
    const problem = items.find(i => isProblemPhase(i.phase));
    const first = problem || items[0];
    let text;
    if (problem) text = t('mobileUpload.pillFailed', { name: problem.name });
    else if (items.length > 1) text = t('mobileUpload.pillMany', { count: items.length });
    else if (first.phase === UPLOAD_PHASES.UPLOADING) text = t('mobileUpload.pillUploading', { name: first.name, pct: first.progress || 0 });
    else text = t('mobileUpload.pillPreparing', { name: first.name });
    return (
        <div
            role="status"
            style={{
                position: 'absolute', left: 10, top: 10, right: 10, zIndex: 24, display: 'flex', justifyContent: 'flex-start', pointerEvents: 'none',
            }}
        >
            <div style={{
                maxWidth: '100%', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 10px', minHeight: 32, boxSizing: 'border-box',
                borderRadius: 16, background: 'rgba(14,15,17,0.85)', border: `1px solid ${problem ? 'var(--coral)' : 'var(--line-strong)'}`,
                backdropFilter: 'blur(12px)', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg)', pointerEvents: 'auto',
            }}>
                {problem
                    ? <AlertCircle size={14} style={{ color: 'var(--coral)', flexShrink: 0 }} />
                    : <span className="vibed-upload-anim animate-spin" style={{ width: 12, height: 12, borderRadius: 6, flexShrink: 0, boxSizing: 'border-box', border: '2px solid var(--line-strong)', borderTopColor: 'var(--accent)' }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
                {problem && problem.phase === UPLOAD_PHASES.FAILED && (
                    <button type="button" onClick={() => onRetry?.(problem.id)} style={{ height: 28, padding: '0 10px', borderRadius: 12, border: 0, background: 'var(--accent)', color: '#fff', fontFamily: 'var(--f-sans)', fontSize: 12, fontWeight: 600, flexShrink: 0, cursor: 'pointer' }}>
                        {t('mobileUpload.tryAgain')}
                    </button>
                )}
            </div>
        </div>
    );
}

export default function MobileUploadStatus({ onRetry, onRemove, onUploadAgain }) {
    const { t } = useTranslation('editor');
    const { assets, tracks } = useTimelineStore(useShallow(s => ({ assets: s.assets, tracks: s.tracks })));
    const summary = useMemo(() => summarizeUploads(assets, tracks), [assets, tracks]);

    // "Your video is ready": fire when an asset we saw uploading/preparing
    // becomes playable. Assets already ready on mount never toast.
    const seenRef = useRef(null);
    const [toast, setToast] = useState(null);
    useEffect(() => {
        const pendingNow = new Map(summary.items.map(i => [i.id, i]));
        const prev = seenRef.current;
        seenRef.current = pendingNow;
        if (!prev) return;
        for (const [id, item] of prev) {
            if (pendingNow.has(id) || isProblemPhase(item.phase)) continue;
            if (!(assets || []).some(a => a?.id === id)) continue; // removed, not finished
            setToast({ id, name: item.name, at: Date.now() });
            try { navigator.vibrate?.(30); } catch { /* not supported (iOS) */ }
            break;
        }
    }, [summary, assets]);
    useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), TOAST_MS);
        return () => clearTimeout(timer);
    }, [toast]);

    // Cards the user collapsed to the pill ("Show the preview meanwhile").
    const [minimized, setMinimized] = useState(() => new Set());
    const showCard = summary.blocking && summary.primary
        && (isProblemPhase(summary.primary.phase) || !minimized.has(summary.primary.id));
    const showPill = !showCard && summary.items.length > 0;

    return (
        <>
            <style>{STYLE}</style>
            {showCard && (
                <FullCard
                    item={summary.primary} onRetry={onRetry} onRemove={onRemove} onUploadAgain={onUploadAgain}
                    onMinimize={() => setMinimized(prev => new Set(prev).add(summary.primary.id))}
                />
            )}
            {showPill && <Pill items={summary.items} onRetry={onRetry} />}
            {toast && !showCard && (
                <div
                    role="status"
                    style={{
                        position: 'absolute', left: 12, right: 12, top: showPill ? 52 : 12, zIndex: 26, display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 8px 10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--bg-2)',
                        border: '1px solid color-mix(in oklch, var(--mint) 45%, transparent)', boxShadow: '0 8px 24px rgba(0,0,0,.45)',
                        fontFamily: 'var(--f-sans)', color: 'var(--fg)',
                    }}
                >
                    <span style={{ width: 24, height: 24, borderRadius: 12, background: 'var(--mint)', color: '#04140D', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Check size={14} strokeWidth={3} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t('mobileUpload.readyTitle')}</span>
                        <span style={{ fontSize: 12, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast.name}</span>
                    </span>
                    <button type="button" aria-label={t('mobileUpload.dismiss')} onClick={() => setToast(null)}
                        style={{ width: 36, height: 36, borderRadius: 10, border: 0, background: 'transparent', color: 'var(--fg-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <X size={16} />
                    </button>
                </div>
            )}
        </>
    );
}
