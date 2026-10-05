import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Undo2, Redo2, Play, Pause, SkipBack, SkipForward, MoreHorizontal, ZoomIn, ZoomOut, Type, Palette } from 'lucide-react';
import useTimelineStore from '../store/useTimelineStore';
import useAIStore from '../store/useAIStore';
import { prevClipBoundary, nextClipBoundary } from '../timeline/clipNav.js';
import MobileSheet, { SheetLabel, SheetChip, SheetRow } from './MobileSheet';
import { TRANSITION_TYPES, TRANSITION_DEFAULT_DURATION } from '../motion/TransitionFX.js';

/**
 * MobileTransportBar — the mobile editor's playback row, under the preview.
 *
 *   [undo][redo]   [⏮][▶][⏭]   0:04.1 / 0:31.0   [⋯]
 *
 * Replaces, on mobile only, the floating play pill on the preview (whose ⏭
 * did nothing) and the timeline's own toolbar row (a horizontally scrolling
 * strip of tiny desktop controls, cut off as '*****' on phones). Nothing that
 * row did is lost: aspect ratio, timeline zoom, add text, transition and the
 * cinematic filter live in the More sheet; split / duplicate / speed are on
 * the clip toolbar when a clip is selected (MobileToolbar).
 */

const ASPECTS = ['9:16', '16:9', '1:1', '4:5', '4:3', '21:9'];
// R89 transition pack (motion/TransitionFX.js).
const TRANSITIONS = TRANSITION_TYPES.map(id => ({ id, key: `transitions.${id}` }));

function fmt(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

function contentEnd(state) {
    let end = 0;
    for (const t of state.tracks || []) {
        for (const c of t.clips || []) end = Math.max(end, (Number(c.start) || 0) + (Number(c.duration) || 0));
    }
    return end > 0 ? end : Number(state.duration) || 0;
}

const iconBtn = {
    width: 44, height: 44, borderRadius: 12, border: 0, background: 'transparent', color: 'var(--fg-2)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer',
};

export default function MobileTransportBar() {
    const { t } = useTranslation('editor');
    const { isPlaying, canUndo, canRedo, aspectRatio, activeClipId } = useTimelineStore(useShallow(s => ({
        isPlaying: s.isPlaying,
        canUndo: (s.past?.length || 0) > 0,
        canRedo: (s.future?.length || 0) > 0,
        aspectRatio: s.aspectRatio,
        activeClipId: s.activeClipId,
    })));
    const [moreOpen, setMoreOpen] = useState(false);

    // One time display, updated per frame without re-rendering React.
    const timeRef = useRef(null);
    useEffect(() => {
        let raf;
        const tick = () => {
            const st = useTimelineStore.getState();
            if (timeRef.current) timeRef.current.textContent = fmt(st.currentTime);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);
    const totalRef = useRef(null);
    useEffect(() => {
        const update = (st) => { if (totalRef.current) totalRef.current.textContent = fmt(contentEnd(st)); };
        update(useTimelineStore.getState());
        return useTimelineStore.subscribe(update);
    }, []);

    const st = () => useTimelineStore.getState();
    const jump = (fn) => {
        const s = st();
        s.seek(fn(s.tracks, s.currentTime));
    };

    return (
        <>
            <div
                className="md:hidden shrink-0 flex items-center justify-between"
                style={{ height: 48, padding: '0 6px', borderTop: '1px solid var(--line-soft)', background: 'var(--bg-2)', touchAction: 'manipulation' }}
            >
                <div style={{ display: 'flex' }}>
                    <button type="button" style={{ ...iconBtn, opacity: canUndo ? 1 : 0.35 }} disabled={!canUndo} aria-label={t('mobileUi.undo')} onClick={() => st().undo()}>
                        <Undo2 size={19} />
                    </button>
                    <button type="button" style={{ ...iconBtn, opacity: canRedo ? 1 : 0.35 }} disabled={!canRedo} aria-label={t('mobileUi.redo')} onClick={() => st().redo()}>
                        <Redo2 size={19} />
                    </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button type="button" style={iconBtn} aria-label={t('mobileUi.prevClip')} onClick={() => jump(prevClipBoundary)}>
                        <SkipBack size={18} />
                    </button>
                    <button
                        type="button"
                        aria-label={isPlaying ? t('mobileUi.pause') : t('mobileUi.play')}
                        onClick={() => st().togglePlay()}
                        style={{ width: 44, height: 44, borderRadius: 22, border: 0, background: 'var(--fg)', color: 'var(--bg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    >
                        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
                    </button>
                    <button type="button" style={iconBtn} aria-label={t('mobileUi.nextClip')} onClick={() => jump(nextClipBoundary)}>
                        <SkipForward size={18} />
                    </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, whiteSpace: 'nowrap', minWidth: 84, textAlign: 'right' }}>
                        <span ref={timeRef} style={{ color: 'var(--fg)' }}>0:00.0</span>
                        <span style={{ color: 'var(--fg-3)' }}> / </span>
                        <span ref={totalRef} style={{ color: 'var(--fg-3)' }}>0:00.0</span>
                    </span>
                    <button type="button" style={iconBtn} aria-label={t('mobileUi.more')} aria-haspopup="dialog" onClick={() => setMoreOpen(true)}>
                        <MoreHorizontal size={20} />
                    </button>
                </div>
            </div>

            <MobileSheet open={moreOpen} title={t('mobileUi.more')} onClose={() => setMoreOpen(false)}>
                <SheetLabel>{t('mobileUi.aspectRatio')}</SheetLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {ASPECTS.map(a => (
                        <SheetChip key={a} active={aspectRatio === a} onClick={() => st().setAspectRatio(a)}>{a}</SheetChip>
                    ))}
                </div>

                <SheetLabel>{t('mobileUi.timelineZoom')}</SheetLabel>
                <div style={{ display: 'flex', gap: 8 }}>
                    <SheetChip onClick={() => st().setZoomLevel(st().zoomLevel * 0.8)}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ZoomOut size={16} />{t('mobileUi.zoomOut')}</span>
                    </SheetChip>
                    <SheetChip onClick={() => st().setZoomLevel(st().zoomLevel * 1.2)}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ZoomIn size={16} />{t('mobileUi.zoomIn')}</span>
                    </SheetChip>
                </div>

                <SheetRow
                    icon={<Type size={20} />}
                    label={t('mobileUi.addText')}
                    sub={t('mobileUi.addTextSub')}
                    onClick={() => {
                        // Add at the playhead, select it and open the text sheet on it.
                        const textIds = (s) => new Set(s.tracks.filter(tr => tr.type === 'text').flatMap(tr => (tr.clips || []).map(c => c.id)));
                        const before = textIds(st());
                        st().addTextOverlay(t('timeline.newTextDefault'), 'center', 5, 'default');
                        const added = [...textIds(st())].find(id => !before.has(id));
                        setMoreOpen(false);
                        if (added) {
                            st().setActiveClip?.(added);
                            useAIStore.getState().openMobileCaptionSheet('text', added);
                        }
                    }}
                />

                <SheetLabel>{t('mobileUi.transition')}</SheetLabel>
                <p style={{ margin: '-6px 0 0', fontSize: 12.5, color: 'var(--fg-3)' }}>
                    {activeClipId ? t('mobileUi.transitionHint') : t('mobileUi.selectClipFirst')}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {TRANSITIONS.map(tr => (
                        <SheetChip key={tr.id} disabled={!activeClipId} onClick={() => { st().addTransition(activeClipId, tr.id, TRANSITION_DEFAULT_DURATION[tr.id] || 0.4); setMoreOpen(false); }}>
                            {t(tr.key)}
                        </SheetChip>
                    ))}
                </div>

                <SheetRow
                    icon={<Palette size={20} />}
                    label={t('mobileUi.filterCinematic')}
                    sub={activeClipId ? t('mobileUi.filterCinematicSub') : t('mobileUi.selectClipFirst')}
                    disabled={!activeClipId}
                    onClick={() => { st().addFilter(activeClipId, 'cinematic', 0.8); setMoreOpen(false); }}
                />
            </MobileSheet>
        </>
    );
}
