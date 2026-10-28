/**
 * client/src/components/BackgroundPanel.jsx
 *
 * R92: background removal settings for the selected video clip.
 * "Remove background" runs the free on-device model once (vision/MatteBaker.js);
 * after that every slider only changes settings, so it is instant and the
 * export follows (client/src/motion/MatteSettings.js).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ControlRow, TrackSlider } from './ui/PanelControls.jsx';
import { useTranslation } from 'react-i18next';
import { Loader2, UserRound, X } from 'lucide-react';

import useTimelineStore from '../store/useTimelineStore';
import { MATTE_MODES, MATTE_REVEALS, normalizeMatte } from '../motion/MatteSettings.js';

function sourceUrlFor(clip, assets) {
    const asset = clip?.assetId ? (assets || []).find(a => a.id === clip.assetId) : null;
    let url = asset?.proxyUrl || clip?.url || asset?.url || null;
    if (url && (url.startsWith('proxies/') || url.startsWith('raw/'))) url = `/api/proxy/gcs-media/${url}`;
    return url;
}

export default function BackgroundPanel({ clip, trackId }) {
    const { t } = useTranslation('editor');
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);
    const abortRef = useRef(null);
    const assets = useTimelineStore(s => s.assets);

    const lm = clip?.layerMask;
    const on = clip?.layerTarget === 'background' && !!(lm?.maskAssetPath || lm?.maskAssetUrl);
    const settings = useMemo(() => normalizeMatte(lm?.settings), [lm?.settings]);
    const images = useMemo(() => (assets || []).filter(a => a?.type === 'image' && (a.url || a.proxyUrl)), [assets]);

    const set = useCallback((patch) => {
        if (!clip || !trackId) return;
        useTimelineStore.getState().setMatteSettings(trackId, clip.id, patch);
    }, [clip, trackId]);

    const handleRemove = useCallback(async () => {
        if (!clip || !trackId || busy) return;
        setBusy(true); setError(null); setProgress(0);
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        try {
            const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
            const covers = lm && (lm.maskAssetPath || lm.maskAssetUrl) && Number.isFinite(Number(lm.sourceDuration))
                && Number(lm.sourceStart) <= (Number(clip.offset) || 0) + 0.05
                && Number(lm.sourceStart) + Number(lm.sourceDuration) >= (Number(clip.offset) || 0) + (Number(clip.duration) || 0) * speed - 0.15;
            const st = useTimelineStore.getState();
            st.saveToHistory?.();
            if (!covers) {
                const { bakeMatte } = await import('../vision/MatteBaker.js');
                const baked = await bakeMatte({
                    sourceUrl: sourceUrlFor(clip, assets),
                    sourceStart: Number(clip.offset) || 0,
                    sourceDuration: (Number(clip.duration) || 0) * speed,
                    onProgress: setProgress,
                    signal: ctrl.signal,
                });
                const r = useTimelineStore.getState().applyLayerSeparation(trackId, clip.id, { ...baked, settings: lm?.settings, skipHistory: true });
                if (!r?.success) throw new Error(r?.error || 'The mask could not be applied.');
                if (baked.bboxTrack.length === 0) setError(t('backgroundPanel.noPerson'));
            }
            useTimelineStore.getState().setLayerTarget(trackId, clip.id, 'background', { skipHistory: true });
        } catch (err) {
            if (err?.name !== 'AbortError') {
                console.error('[BackgroundPanel] remove failed:', err.message);
                setError(err.message);
            }
        } finally {
            setBusy(false);
            abortRef.current = null;
        }
    }, [clip, trackId, busy, lm, assets, t]);

    const handleOff = useCallback(() => {
        if (!clip || !trackId) return;
        useTimelineStore.getState().setLayerTarget(trackId, clip.id, null);
    }, [clip, trackId]);

    if (!clip || clip.type === 'image') return null;

    /**
     * R118 - on the shared panel kit, like every other control panel.
     *
     * `threshold`, `softness` and `dim` are stored 0..1 and shown as a
     * percentage, so the conversion happens here rather than being baked into
     * the control: the kit works in the units the person reads.
     */
    const slider = (key, min, max, step = 1) => {
        const asPercent = key === 'threshold' || key === 'softness' || key === 'dim';
        const factor = asPercent ? 100 : 1;
        const label = t(`backgroundPanel.${key}`);
        return (
            <ControlRow key={key} label={label} labelWidth={70}>
                <TrackSlider
                    ariaLabel={label}
                    value={settings[key] * factor}
                    min={min * factor}
                    max={max * factor}
                    step={Math.max(1, step * factor)}
                    unit={asPercent ? '%' : ''}
                    scrub
                    onChange={v => set({ [key]: v / factor })}
                />
            </ControlRow>
        );
    };

    return (
        <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{t('backgroundPanel.title')}</div>
            {!on ? (
                <>
                    <button type="button" onClick={handleRemove} disabled={busy}
                        className="w-full px-2 py-1.5 rounded text-[11px] bg-primary/15 border border-primary/40 text-primary disabled:opacity-50 flex items-center justify-center gap-1.5">
                        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserRound className="w-3 h-3" />}
                        {busy ? t('backgroundPanel.working', { pct: Math.round(progress * 100) }) : t('backgroundPanel.remove')}
                    </button>
                    {busy && (
                        <button type="button" onClick={() => abortRef.current?.abort()} className="mt-1 text-[10px] text-muted-foreground underline">
                            {t('backgroundPanel.cancel')}
                        </button>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">{t('backgroundPanel.hint')}</p>
                </>
            ) : (
                <>
                    <div className="grid grid-cols-4 gap-1 mb-2" role="radiogroup" aria-label={t('backgroundPanel.mode')}>
                        {MATTE_MODES.map(m => (
                            <button key={m} type="button" role="radio" aria-checked={settings.mode === m}
                                disabled={m === 'image' && images.length === 0}
                                onClick={() => set(m === 'image' && !settings.imageUrl ? { mode: m, imageUrl: images[0]?.url || images[0]?.proxyUrl || null } : { mode: m })}
                                className={`px-1 py-1 rounded text-[10px] border disabled:opacity-40 ${settings.mode === m ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-secondary border-transparent hover:bg-white/10'}`}>
                                {t(`backgroundPanel.modes.${m}`)}
                            </button>
                        ))}
                    </div>
                    {(settings.mode === 'blur' || settings.mode === 'dim') && slider('blur', 0, 60)}
                    {settings.mode === 'dim' && slider('dim', 0, 1, 0.01)}
                    {settings.mode === 'color' && (
                        <label className="flex items-center justify-between mb-2 text-[10px] text-muted-foreground">
                            {t('backgroundPanel.color')}
                            <input type="color" value={settings.color} onChange={e => set({ color: e.target.value })} />
                        </label>
                    )}
                    {settings.mode === 'image' && (
                        <select value={settings.imageUrl || ''} onChange={e => set({ imageUrl: e.target.value || null })}
                            className="w-full mb-2 bg-background border border-border rounded px-2 py-1 text-xs" aria-label={t('backgroundPanel.image')}>
                            {images.map(a => <option key={a.id} value={a.url || a.proxyUrl}>{a.name || a.id}</option>)}
                        </select>
                    )}
                    {slider('feather', 0, 30)}
                    {slider('threshold', 0.05, 0.95, 0.01)}
                    {slider('softness', 0.02, 1, 0.01)}

                    {/* R93: Background Reveal & Transition FX */}
                    <div className="pt-2 mt-2 border-t border-border/40 mb-2">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1.5 font-mono">
                            {t('backgroundPanel.revealTitle', 'Reveal Animation')}
                        </div>
                        <select
                            value={settings.reveal || 'none'}
                            onChange={e => set({ reveal: e.target.value })}
                            className="w-full mb-2 bg-secondary border border-border/60 rounded px-2 py-1 text-[11px] text-foreground"
                            aria-label={t('backgroundPanel.revealTitle', 'Reveal Animation')}
                        >
                            {MATTE_REVEALS.map(r => (
                                <option key={r} value={r}>
                                    {r === 'none' ? 'None (Static)' : r.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                                </option>
                            ))}
                        </select>
                        {settings.reveal !== 'none' && slider('revealDuration', 0.2, 3.0, 0.05)}
                    </div>

                    {/* Sandwich Depth Layer notice */}
                    <div className="p-2 rounded bg-primary/10 border border-primary/25 text-[10px] text-foreground/85 mb-3 leading-relaxed">
                        <span className="font-semibold text-primary">✨ Sandwich Layer Ready:</span> In the Text or Graphic panel, toggle <span className="font-mono text-[9px] bg-background/50 px-1 py-0.5 rounded">Behind Subject</span> to layer titles and stickers between the background plate and the creator.
                    </div>
                    <div className="flex gap-1.5">
                        <button type="button" onClick={handleRemove} disabled={busy}
                            className="flex-1 px-2 py-1 rounded text-[10px] bg-secondary hover:bg-white/10 disabled:opacity-50">
                            {busy ? t('backgroundPanel.working', { pct: Math.round(progress * 100) }) : t('backgroundPanel.refresh')}
                        </button>
                        <button type="button" onClick={handleOff}
                            className="px-2 py-1 rounded text-[10px] bg-secondary hover:bg-white/10 flex items-center gap-1">
                            <X className="w-3 h-3" /> {t('backgroundPanel.off')}
                        </button>
                    </div>
                </>
            )}
            {error && <p className="text-[10px] text-amber-400 mt-1">{error}</p>}
        </div>
    );
}
