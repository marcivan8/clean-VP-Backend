/**
 * client/src/components/ShortsPanel.jsx
 *
 * R92: the shorts found in this project ("repurpose into shorts").
 * Each short is a window of the main edit tuned for one platform. The main
 * edit is never changed.
 *
 * R93:
 *  - Preview plays the FINISHED short (9:16 framing, hook title, captions,
 *    camera moves, sounds, as exported) in the editor's own player. The main
 *    edit is set aside and comes back with "Back to my edit"
 *    (useTimelineStore.startShortPreview / exitShortPreview, ShortPreviewBar).
 *  - Every short shows a picture of the speaker, framed like the export
 *    (utils/captureShortThumbnail.js), instead of a block of text.
 *  - Speaker pop-out bakes the mask through the engine (the old call pointed
 *    at a MatteBaker export that does not exist, so pop-out never applied).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Smartphone, Play, Square, Download, Loader2, Trash2, Wand2, ExternalLink, Sparkles, Volume2, UserCheck, AlertTriangle, Lock } from 'lucide-react';

import useTimelineStore from '../store/useTimelineStore';
import { PLATFORM_IDS, PLATFORM_PROFILES, profileNotes } from '../agent/PlatformProfiles.js';
import { finishShort } from '../agent/shortFinisher.js';
import { createProject } from '../lib/projectsApi.js';
import { captureShortThumbnail, getCachedShortThumbnail, thumbnailKey } from '../utils/captureShortThumbnail.js';
import { useUserPlan } from '../hooks/useUserPlan.js';
import { EventBus, EVENT_TYPES } from '../agent/EventBus.js';

const fmt = (s) => {
    const n = Math.max(0, Math.round(Number(s) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

/** The main edit's state, even while a short is being previewed. */
function mainEditState() {
    const st = useTimelineStore.getState();
    return st.shortPreview ? { ...st, ...st.shortPreview.saved } : st;
}

/** Bake the free background mask on the main-edit video clips a short uses. */
async function ensureMattesFor(short) {
    useTimelineStore.getState().exitShortPreview();
    const st = useTimelineStore.getState();
    const { mediaExecutionEngine } = await import('../agent/MediaExecutionEngine.js');
    let videoCount = 0;
    let personCount = 0;
    for (const t of (st.tracks || []).filter(tr => tr.type === 'video')) {
        for (const c of t.clips || []) {
            const cs = Number(c.start) || 0;
            const ce = cs + (Number(c.duration) || 0);
            if (ce <= short.start || cs >= short.end || (c.type && c.type !== 'video')) continue;
            videoCount += 1;
            const r = await mediaExecutionEngine._ensureMatte(t.id, c.id, null);
            if (!r?.ok) throw new Error(r?.error || 'The background mask could not be made.');
            if (r.people !== false) personCount += 1;
        }
    }
    if (!videoCount) throw new Error('There is no video clip in this short to separate from its background.');
    if (!personCount) throw new Error('No person was detected in this short, so the speaker highlight could not be applied.');
    return short;
}

export default function ShortsPanel({ onExport }) {
    const { t } = useTranslation('editor');
    const navigate = useNavigate();
    const { plan } = useUserPlan();
    const isFree = plan === 'free';
    const shorts = useTimelineStore(s => s.shorts) || [];
    const previewId = useTimelineStore(s => s.shortPreview?.shortId || null);
    const hasCaptions = useTimelineStore(s => (s.shortPreview?.saved?.tracks || s.tracks || []).some(tr => tr.type === 'text' && (tr.clips || []).length > 0));
    const [busy, setBusy] = useState({});         // id -> export progress 0..100
    const [preparing, setPreparing] = useState(null); // id of the short being readied for preview
    const [errors, setErrors] = useState({});
    const [thumbs, setThumbs] = useState({});     // thumbnailKey -> data URL | null

    // Treatment options
    const [polish, setPolish] = useState(true);
    const [popOut, setPopOut] = useState(false);
    const [sfx, setSfx] = useState(true);

    const sorted = useMemo(() => [...shorts].sort((a, b) => (a.start || 0) - (b.start || 0)), [shorts]);
    const thumbKeys = sorted.map(thumbnailKey).join('|');

    // One picture per short, one at a time (each loads the video once).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const s of sorted) {
                const key = thumbnailKey(s);
                if (cancelled) return;
                if (getCachedShortThumbnail(s)) {
                    setThumbs(m => (m[key] ? m : { ...m, [key]: getCachedShortThumbnail(s) }));
                    continue;
                }
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const pic = await captureShortThumbnail(s, mainEditState());
                    if (!cancelled) setThumbs(m => ({ ...m, [key]: pic || null }));
                } catch (err) {
                    console.warn('[ShortsPanel] thumbnail failed:', err.message);
                    if (!cancelled) setThumbs(m => ({ ...m, [key]: null }));
                }
            }
        })();
        return () => { cancelled = true; };
        // thumbKeys captures every field a picture depends on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [thumbKeys]);

    const handleFind = useCallback(async () => {
        if (isFree) {
            EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                reason: 'paid_feature',
                message: t('shortsPanel.lockedMessage', 'AI Shorts repurposing is available on Creator and Pro plans.'),
                upgradeRequired: 'creator',
            });
            return;
        }
        try {
            const { workflowController } = await import('../agent/WorkflowController.js');
            workflowController.processUserPrompt(t('shortsPanel.findPrompt'));
        } catch (err) {
            console.error('[ShortsPanel] find failed:', err.message);
        }
    }, [t, isFree]);

    const handlePreview = useCallback(async (short) => {
        if (isFree) {
            EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                reason: 'paid_feature',
                message: t('shortsPanel.lockedMessage', 'AI Shorts repurposing is available on Creator and Pro plans.'),
                upgradeRequired: 'creator',
            });
            return;
        }
        const st = useTimelineStore.getState();
        if (st.shortPreview?.shortId === short.id) { st.exitShortPreview(); return; }
        if (preparing) return;
        const profile = PLATFORM_PROFILES[short.platform] || PLATFORM_PROFILES.tiktok;
        setPreparing(short.id);
        setErrors(e => ({ ...e, [short.id]: null }));
        try {
            if (popOut) await ensureMattesFor(short);
            const built = await finishShort(mainEditState(), short, { polish, popOut, sfx });
            const ok = useTimelineStore.getState().startShortPreview(short, built, { label: profile.label });
            if (!ok) setErrors(e => ({ ...e, [short.id]: t('shortsPanel.previewFailed') }));
        } catch (err) {
            console.error('[ShortsPanel] preview failed:', err.message);
            setErrors(e => ({ ...e, [short.id]: err.message || t('shortsPanel.previewFailed') }));
        } finally {
            setPreparing(null);
        }
    }, [preparing, polish, popOut, sfx, t, isFree]);

    const handleExport = useCallback(async (short) => {
        if (isFree) {
            EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                reason: 'paid_feature',
                message: t('shortsPanel.lockedMessage', 'AI Shorts repurposing is available on Creator and Pro plans.'),
                upgradeRequired: 'creator',
            });
            return;
        }
        if (!onExport || busy[short.id] !== undefined) return;
        const profile = PLATFORM_PROFILES[short.platform] || PLATFORM_PROFILES.tiktok;
        setBusy(b => ({ ...b, [short.id]: 0 }));
        setErrors(e => ({ ...e, [short.id]: null }));
        try {
            if (popOut) await ensureMattesFor(short);
            const built = await finishShort(mainEditState(), short, { polish, popOut, sfx });
            const result = await onExport(
                { platform: profile.exportPreset, quality: 'high', resolution: '1080p', fps: profile.fps },
                {
                    tracks: built.tracks,
                    duration: built.duration,
                    aspectRatio: built.aspectRatio,
                    onProgress: (p) => setBusy(b => ({ ...b, [short.id]: Math.round(Number(p) || 0) })),
                },
            );
            useTimelineStore.getState().updateShort(short.id, { exportUrl: result?.url || null, exportedAt: Date.now() });
        } catch (err) {
            console.error('[ShortsPanel] export failed:', err.message);
            setErrors(e => ({ ...e, [short.id]: err.message }));
        } finally {
            setBusy(b => { const n = { ...b }; delete n[short.id]; return n; });
        }
    }, [onExport, busy, polish, popOut, sfx, isFree, t]);

    const handleOpenAsProject = useCallback(async (short) => {
        if (isFree) {
            EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                reason: 'paid_feature',
                message: t('shortsPanel.lockedMessage', 'AI Shorts repurposing is available on Creator and Pro plans.'),
                upgradeRequired: 'creator',
            });
            return;
        }
        const profile = PLATFORM_PROFILES[short.platform] || PLATFORM_PROFILES.tiktok;
        try {
            // The project is built from the main edit, so the preview ends first.
            useTimelineStore.getState().exitShortPreview();
            if (popOut) await ensureMattesFor(short);
            const built = await finishShort(useTimelineStore.getState(), short, { polish, popOut, sfx });
            const st = useTimelineStore.getState();
            const data = {
                ...(st.saveProject() || {}),
                tracks: built.tracks,
                duration: built.duration,
                aspectRatio: built.aspectRatio,
                captions: built.words || [],
                editingStyle: 'reel',
                shorts: [],
            };
            const name = `${short.title || 'Short'} (${profile.label || short.platform})`;
            const id = await createProject(name, data);
            if (id) {
                navigate(`/editor/${id}`);
            } else {
                setErrors(e => ({ ...e, [short.id]: t('shortsPanel.openFailed') }));
            }
        } catch (err) {
            console.error('[ShortsPanel] open as project failed:', err.message);
            setErrors(e => ({ ...e, [short.id]: err.message }));
        }
    }, [navigate, polish, popOut, sfx, t, isFree]);

    const handleRemove = useCallback((short) => {
        const st = useTimelineStore.getState();
        if (st.shortPreview?.shortId === short.id) st.exitShortPreview();
        st.removeShort(short.id);
    }, []);

    const handleExportAll = useCallback(async () => {
        if (isFree) {
            EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                reason: 'paid_feature',
                message: t('shortsPanel.lockedMessage', 'AI Shorts repurposing is available on Creator and Pro plans.'),
                upgradeRequired: 'creator',
            });
            return;
        }
        for (const s of sorted) {
            // One at a time: the render worker is the concurrency limit.
            // eslint-disable-next-line no-await-in-loop
            await handleExport(s);
        }
    }, [sorted, handleExport, isFree, t]);

    return (
        <section className="p-4 border-b border-border/50">
            <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5">
                    <Smartphone className="w-3 h-3" /> {t('shortsPanel.title')}
                    {isFree && (
                        <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] bg-primary/20 text-primary border border-primary/30 flex items-center gap-1 font-mono">
                            <Lock className="w-2.5 h-2.5" /> PRO
                        </span>
                    )}
                </div>
                {sorted.length > 1 && (
                    <button type="button" onClick={handleExportAll} disabled={Object.keys(busy).length > 0}
                        className="px-2 py-1 rounded text-[10px] bg-secondary hover:bg-white/10 disabled:opacity-50">
                        {t('shortsPanel.exportAll')}
                    </button>
                )}
            </div>

            {isFree && (
                <div className="mb-3.5 p-3.5 rounded-xl border border-primary/30 bg-primary/10 flex flex-col items-center text-center">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center mb-2 text-primary border border-primary/40">
                        <Lock className="w-4 h-4" />
                    </div>
                    <h4 className="text-xs font-semibold text-foreground mb-1">
                        {t('shortsPanel.lockedTitle')}
                    </h4>
                    <p className="text-[11px] text-muted-foreground mb-2.5 leading-relaxed">
                        {t('shortsPanel.lockedDescription')}
                    </p>
                    <button
                        type="button"
                        onClick={() => EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, { reason: 'paid_feature', upgradeRequired: 'creator' })}
                        className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm flex items-center gap-1.5"
                    >
                        <Sparkles className="w-3 h-3" />
                        {t('shortsPanel.lockedCta')}
                    </button>
                </div>
            )}

            <button type="button" onClick={handleFind}
                className="w-full mb-3 px-2 py-1.5 rounded text-[11px] bg-primary/15 border border-primary/40 text-primary flex items-center justify-center gap-1.5">
                <Wand2 className="w-3 h-3" /> {sorted.length ? t('shortsPanel.findAgain') : t('shortsPanel.find')}
                {isFree && <Lock className="w-2.5 h-2.5 ml-1 text-primary" />}
            </button>

            {/* Finish treatment toggles */}
            <div className="mb-3 p-2 rounded bg-secondary/20 border border-border/60 space-y-1.5 text-[11px]">
                <label className="flex items-center justify-between cursor-pointer" title={t('shortsPanel.polishHint')}>
                    <span className="flex items-center gap-1.5 text-foreground">
                        <Sparkles className="w-3 h-3 text-primary" /> {t('shortsPanel.polish')}
                    </span>
                    <input type="checkbox" checked={polish} onChange={e => setPolish(e.target.checked)} className="rounded" />
                </label>
                <label className="flex items-center justify-between cursor-pointer" title={t('shortsPanel.sfxHint')}>
                    <span className="flex items-center gap-1.5 text-foreground">
                        <Volume2 className="w-3 h-3 text-primary" /> {t('shortsPanel.sfx')}
                    </span>
                    <input type="checkbox" checked={sfx} onChange={e => setSfx(e.target.checked)} className="rounded" />
                </label>
                <label className="flex items-center justify-between cursor-pointer" title={t('shortsPanel.popOutHint')}>
                    <span className="flex items-center gap-1.5 text-foreground">
                        <UserCheck className="w-3 h-3 text-primary" /> {t('shortsPanel.popOut')}
                    </span>
                    <input type="checkbox" checked={popOut} onChange={e => setPopOut(e.target.checked)} className="rounded" />
                </label>
            </div>

            {sorted.length === 0 && <p className="text-[11px] text-muted-foreground">{t('shortsPanel.empty')}</p>}

            <ul className="space-y-2">
                {sorted.map(short => {
                    const profile = PLATFORM_PROFILES[short.platform] || PLATFORM_PROFILES.tiktok;
                    const len = (Number(short.end) || 0) - (Number(short.start) || 0);
                    // Only what needs attention is shown; the rest is in the tooltip.
                    const notes = profileNotes(short, profile, { hasCaptions });
                    const warnings = notes.filter(n => n.level === 'warn');
                    const progress = busy[short.id];
                    const key = thumbnailKey(short);
                    const pic = thumbs[key];
                    const isPreviewing = previewId === short.id;
                    const isPreparing = preparing === short.id;
                    return (
                        <li key={short.id} className={`rounded border p-2 bg-secondary/40 ${isPreviewing ? 'border-primary/70' : 'border-border'}`}>
                            <div className="flex gap-2">
                                {/* 9:16 picture of the short; click to preview it in the player */}
                                <button type="button" onClick={() => handlePreview(short)}
                                    aria-label={isPreviewing ? t('shortsPanel.previewStop') : t('shortsPanel.preview')}
                                    title={short.title || ''}
                                    className="relative shrink-0 w-[54px] h-[96px] rounded overflow-hidden bg-black/60 border border-border group">
                                    {pic
                                        ? <img src={pic} alt="" className="w-full h-full object-cover" draggable={false} />
                                        : pic === undefined
                                            ? <span className="absolute inset-0 animate-pulse bg-white/5" />
                                            : <Smartphone className="absolute inset-0 m-auto w-4 h-4 text-muted-foreground" />}
                                    <span className={`absolute inset-0 flex items-center justify-center bg-black/30 ${isPreviewing || isPreparing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                                        {isPreparing
                                            ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                                            : isPreviewing ? <Square className="w-3.5 h-3.5 text-white fill-current" /> : <Play className="w-4 h-4 text-white fill-current" />}
                                    </span>
                                    <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/70 text-[9px] font-mono text-white">{fmt(len)}</span>
                                </button>

                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                        <select value={short.platform} aria-label={t('shortsPanel.platform')}
                                            onChange={e => useTimelineStore.getState().updateShort(short.id, { platform: e.target.value })}
                                            className="bg-background border border-border rounded px-1 py-0.5 text-[11px] min-w-0">
                                            {PLATFORM_IDS.map(id => <option key={id} value={id}>{PLATFORM_PROFILES[id].label}</option>)}
                                        </select>
                                        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap"
                                            title={notes.map(n => n.text).join('\n')}>
                                            {fmt(short.start)}
                                        </span>
                                    </div>
                                    {short.title && <p className="text-[11px] text-foreground truncate mb-1" title={short.title}>{short.title}</p>}
                                    {warnings.slice(0, 1).map(n => (
                                        <p key={n.code} className="text-[10px] text-amber-400 flex items-start gap-1 mb-1" title={n.text}>
                                            <AlertTriangle className="w-3 h-3 shrink-0 mt-px" /><span className="line-clamp-1">{n.text}</span>
                                        </p>
                                    ))}
                                    <div className="flex flex-wrap items-center gap-1">
                                        <button type="button" onClick={() => handleExport(short)} disabled={progress !== undefined || !onExport}
                                            title={t('shortsPanel.export', { platform: profile.label })}
                                            className="px-2 py-1 rounded text-[10px] bg-primary/15 border border-primary/40 text-primary disabled:opacity-50 flex items-center gap-1">
                                            {progress !== undefined ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                            {progress !== undefined ? `${progress}%` : profile.label}
                                        </button>
                                        <button type="button" onClick={() => handleOpenAsProject(short)}
                                            aria-label={t('shortsPanel.open')} title={t('shortsPanel.open')}
                                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/10">
                                            <ExternalLink className="w-3 h-3" />
                                        </button>
                                        <button type="button" onClick={() => handleRemove(short)}
                                            aria-label={t('shortsPanel.remove')} title={t('shortsPanel.remove')}
                                            className="ml-auto p-1 rounded text-muted-foreground hover:bg-white/10">
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            {short.exportUrl && (
                                <a href={short.exportUrl} target="_blank" rel="noreferrer" className="block mt-1 text-[10px] text-primary underline">
                                    {t('shortsPanel.download')}
                                </a>
                            )}
                            {errors[short.id] && <p className="mt-1 text-[10px] text-amber-400">{errors[short.id]}</p>}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
