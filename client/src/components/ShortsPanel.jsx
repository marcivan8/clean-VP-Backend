/**
 * client/src/components/ShortsPanel.jsx
 *
 * R92: the shorts found in this project ("repurpose into shorts").
 * Each short is a window of the main edit tuned for one platform. Preview
 * jumps the player to it; Export renders it on its own (sliced timeline, 9:16
 * speaker crop, captions in the platform safe zone, platform preset) through
 * the normal export path. The main edit is never changed.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Smartphone, Play, Download, Loader2, Trash2, Wand2, ExternalLink, Sparkles, Volume2, UserCheck } from 'lucide-react';

import useTimelineStore from '../store/useTimelineStore';
import { PLATFORM_IDS, PLATFORM_PROFILES, profileNotes } from '../agent/PlatformProfiles.js';
import { finishShort } from '../agent/shortFinisher.js';
import { createProject } from '../lib/projectsApi.js';

const fmt = (s) => {
    const n = Math.max(0, Math.round(Number(s) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

export async function ensureMattesFor(short) {
    const st = useTimelineStore.getState();
    const clips = (st.tracks || []).flatMap(t => t.clips || []).filter(c => c.type === 'video' && c.assetId);
    if (!clips.length) return short;
    try {
        const { bakeClipMatte } = await import('../vision/MatteBaker.js');
        for (const clip of clips) {
            const asset = (st.assets || []).find(a => a.id === clip.assetId);
            const url = asset?.proxyUrl || asset?.sourceUrl || asset?.url;
            if (url && !clip.layerMask?.maskUrl) {
                // eslint-disable-next-line no-await-in-loop
                await bakeClipMatte(clip, url).catch(() => null);
            }
        }
    } catch {
        // optional on-device model
    }
    return short;
}

export default function ShortsPanel({ onExport }) {
    const { t } = useTranslation('editor');
    const navigate = useNavigate();
    const shorts = useTimelineStore(s => s.shorts) || [];
    const hasCaptions = useTimelineStore(s => (s.tracks || []).some(tr => tr.type === 'text' && (tr.clips || []).length > 0));
    const [busy, setBusy] = useState({});   // id -> progress 0..100
    const [errors, setErrors] = useState({});

    // Treatment options
    const [polish, setPolish] = useState(true);
    const [popOut, setPopOut] = useState(false);
    const [sfx, setSfx] = useState(true);

    const sorted = useMemo(() => [...shorts].sort((a, b) => (a.start || 0) - (b.start || 0)), [shorts]);

    const handleFind = useCallback(async () => {
        try {
            const { workflowController } = await import('../agent/WorkflowController.js');
            workflowController.processUserPrompt(t('shortsPanel.findPrompt'));
        } catch (err) {
            console.error('[ShortsPanel] find failed:', err.message);
        }
    }, [t]);

    const handlePreview = useCallback((short) => {
        const st = useTimelineStore.getState();
        st.setCurrentTime?.(Math.max(0, Number(short.start) || 0));
        st.setIsPlaying?.(true);
    }, []);

    const handleExport = useCallback(async (short) => {
        if (!onExport || busy[short.id] !== undefined) return;
        const profile = PLATFORM_PROFILES[short.platform] || PLATFORM_PROFILES.tiktok;
        setBusy(b => ({ ...b, [short.id]: 0 }));
        setErrors(e => ({ ...e, [short.id]: null }));
        try {
            if (popOut) await ensureMattesFor(short);
            const built = await finishShort(useTimelineStore.getState(), short, { polish, popOut, sfx });
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
    }, [onExport, busy, polish, popOut, sfx]);

    const handleOpenAsProject = useCallback(async (short) => {
        const profile = PLATFORM_PROFILES[short.platform] || PLATFORM_PROFILES.tiktok;
        try {
            if (popOut) await ensureMattesFor(short);
            const built = await finishShort(useTimelineStore.getState(), short, { polish, popOut, sfx });
            const st = useTimelineStore.getState();
            const data = {
                ...(st.saveProject ? st.saveProject() : {}),
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
    }, [navigate, polish, popOut, sfx, t]);

    const handleExportAll = useCallback(async () => {
        for (const s of sorted) {
            // One at a time: the render worker is the concurrency limit.
            // eslint-disable-next-line no-await-in-loop
            await handleExport(s);
        }
    }, [sorted, handleExport]);

    return (
        <section className="p-4 border-b border-border/50">
            <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5">
                    <Smartphone className="w-3 h-3" /> {t('shortsPanel.title')}
                </div>
                {sorted.length > 1 && (
                    <button type="button" onClick={handleExportAll} disabled={Object.keys(busy).length > 0}
                        className="px-2 py-1 rounded text-[10px] bg-secondary hover:bg-white/10 disabled:opacity-50">
                        {t('shortsPanel.exportAll')}
                    </button>
                )}
            </div>

            <button type="button" onClick={handleFind}
                className="w-full mb-3 px-2 py-1.5 rounded text-[11px] bg-primary/15 border border-primary/40 text-primary flex items-center justify-center gap-1.5">
                <Wand2 className="w-3 h-3" /> {sorted.length ? t('shortsPanel.findAgain') : t('shortsPanel.find')}
            </button>

            {/* Finish treatment toggles */}
            <div className="mb-3 p-2 rounded bg-secondary/20 border border-border/60 space-y-1.5 text-[11px]">
                <label className="flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-1.5 text-foreground">
                        <Sparkles className="w-3 h-3 text-primary" /> {t('shortsPanel.polish')}
                    </span>
                    <input type="checkbox" checked={polish} onChange={e => setPolish(e.target.checked)} className="rounded" />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                    <span className="flex items-center gap-1.5 text-foreground">
                        <Volume2 className="w-3 h-3 text-primary" /> {t('shortsPanel.sfx')}
                    </span>
                    <input type="checkbox" checked={sfx} onChange={e => setSfx(e.target.checked)} className="rounded" />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
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
                    const notes = profileNotes(short, profile, { hasCaptions });
                    const progress = busy[short.id];
                    return (
                        <li key={short.id} className="rounded border border-border p-2 bg-secondary/40">
                            <div className="flex items-center justify-between gap-2 mb-1">
                                <select value={short.platform} aria-label={t('shortsPanel.platform')}
                                    onChange={e => useTimelineStore.getState().updateShort(short.id, { platform: e.target.value })}
                                    className="bg-background border border-border rounded px-1.5 py-0.5 text-[11px]">
                                    {PLATFORM_IDS.map(id => <option key={id} value={id}>{PLATFORM_PROFILES[id].label}</option>)}
                                </select>
                                <span className="text-[10px] font-mono text-muted-foreground">{fmt(short.start)} to {fmt(short.end)} · {Math.round(len)} s</span>
                            </div>
                            <p className="text-[11px] text-foreground line-clamp-2 mb-1">{short.title}</p>
                            <ul className="mb-2">
                                {notes.map(n => (
                                    <li key={n.code} className={`text-[10px] ${n.level === 'warn' ? 'text-amber-400' : n.level === 'ok' ? 'text-emerald-400' : 'text-muted-foreground'}`}>{n.text}</li>
                                ))}
                            </ul>
                            <div className="flex flex-wrap gap-1.5">
                                <button type="button" onClick={() => handlePreview(short)}
                                    className="px-2 py-1 rounded text-[10px] bg-secondary hover:bg-white/10 flex items-center gap-1">
                                    <Play className="w-3 h-3" /> {t('shortsPanel.preview')}
                                </button>
                                <button type="button" onClick={() => handleExport(short)} disabled={progress !== undefined || !onExport}
                                    className="px-2 py-1 rounded text-[10px] bg-primary/15 border border-primary/40 text-primary disabled:opacity-50 flex items-center gap-1">
                                    {progress !== undefined ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                    {progress !== undefined ? t('shortsPanel.exporting', { pct: progress }) : t('shortsPanel.export', { platform: profile.label })}
                                </button>
                                <button type="button" onClick={() => handleOpenAsProject(short)}
                                    className="px-2 py-1 rounded text-[10px] bg-secondary hover:bg-white/10 flex items-center gap-1">
                                    <ExternalLink className="w-3 h-3" /> {t('shortsPanel.open')}
                                </button>
                                <button type="button" onClick={() => useTimelineStore.getState().removeShort(short.id)}
                                    aria-label={t('shortsPanel.remove')} className="ml-auto px-1.5 py-1 rounded text-muted-foreground hover:bg-white/10">
                                    <Trash2 className="w-3 h-3" />
                                </button>
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
            <p className="text-[10px] text-muted-foreground mt-3">{t('shortsPanel.footnote')}</p>
        </section>
    );
}
