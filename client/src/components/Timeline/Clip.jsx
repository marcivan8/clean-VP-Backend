import React from 'react';
import { useDraggable, useDroppable, useDndContext } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import useTimelineStore from '../../store/useTimelineStore';
import useAIStore from '../../store/useAIStore';
import useDeviceType from '../../hooks/useDeviceType';
import classNames from 'classnames';
import Waveform from './Waveform';
import ClipContextMenu from './ClipContextMenu';
import ClipWaveform from '../ClipWaveform';
import { usePeaks } from '../../hooks/usePeaks';
import { getAssetUploadStatus, UPLOAD_PHASES, isProblemPhase } from '../../utils/uploadStatus.js';
import { getMainVideoTrackId } from '../../timeline/rippleDelete.js';

const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

const getTabForClip = (clip, trackId) => {
    // Determine which left panel tab to activate based on clip/track type
    if (clip.type === 'text' || clip.type === 'caption') return 'captions';
    const track = useTimelineStore.getState().tracks.find(t => t.id === trackId);
    if (track?.type === 'text') return 'captions';
    if (track?.type === 'audio' || clip.type === 'audio') {
        // Music files get audio tab (TASK 8)
        return 'audio';
    }
    // Check asset extension for music clips without explicit type
    if (clip.assetId) {
        const asset = useTimelineStore.getState().assets?.find(a => a.id === clip.assetId);
        if (asset?.name && AUDIO_EXTENSIONS.test(asset.name)) return 'audio';
        if (asset?.url && AUDIO_EXTENSIONS.test(asset.url)) return 'audio';
    }
    // Video clips → Transform panel (scale, crop, position controls)
    return 'transform';
};

// Mobile: visible trim handles on the selected clip (desktop keeps hover areas).
const MOBILE_HANDLE_STYLE = {
    left:  { width: 14, background: 'var(--accent)', borderRadius: '6px 0 0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    right: { width: 14, background: 'var(--accent)', borderRadius: '0 6px 6px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' },
};
const MOBILE_GRIP = { width: 2, height: '40%', borderRadius: 1, background: 'rgba(255,255,255,0.85)' };
const fmtLen = (s) => {
    const v = Math.max(0, Number(s) || 0);
    const m = Math.floor(v / 60);
    const r = v - m * 60;
    return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
};

const Clip = ({ clip, trackId }) => {
    const { t } = useTranslation('editor');
    const { isMobile } = useDeviceType();
    const { zoomLevel, deleteClipWithMagnet, activeClipId, selectedClipIds, setActiveClip, toggleClipSelection, assets } = useTimelineStore(useShallow(state => ({
        zoomLevel:            state.zoomLevel,
        deleteClipWithMagnet: state.deleteClipWithMagnet,
        activeClipId:         state.activeClipId,
        selectedClipIds:      state.selectedClipIds,
        setActiveClip:        state.setActiveClip,
        toggleClipSelection:  state.toggleClipSelection,
        assets:               state.assets,
    })));
    const isActive = activeClipId === clip.id;
    const isSelected = selectedClipIds && selectedClipIds.includes(clip.id);
    const [ctxMenu, setCtxMenu] = React.useState(null); // null | { x, y }
    // Mobile trim: live "old → new length" bubble while a handle is dragged.
    const [trimLabel, setTrimLabel] = React.useState(null); // null | { from, to }

    // Text/caption clips never have audio — never render a waveform on them.
    const isTextClip = clip.type === 'text' || clip.type === 'caption';
    const asset = assets?.find(a => a.id === clip.assetId);
    // Mobile only: show this clip's upload / prepare state on the clip itself
    // (see components/MobileUploadStatus.jsx for the preview side).
    const uploadStatus = isMobile && !isTextClip ? getAssetUploadStatus(asset) : null;
    const showUploadState = !!uploadStatus && uploadStatus.phase !== UPLOAD_PHASES.READY;

    // NOTE — a SECOND waveform pipeline used to live here: it derived a
    // `waveform.json` URL next to the proxy, fetched it on mount, and wrote the
    // result into the track-keyed `waveforms` store field via addWaveform().
    // Nothing ever rendered that data. Its only consumer was the effect's own
    // "already loaded?" guard, so it was a self-referential loop that issued one
    // network request per clip per mount and displayed nothing. Removed: peaks
    // now come from exactly one place (WaveformEngine, via usePeaks below).
    //
    // usePeaks is READ-ONLY — it does not fetch. WaveformEngine owns extraction,
    // caching, dedupe, concurrency and retry, so rendering a clip can no longer
    // trigger network work. Pass the raw URLs straight through; the engine
    // decides what's usable (it rejects blob:/data:, which the server cannot
    // resolve to a storage object, and waits for a real proxyUrl instead).
    //
    // ONE MORE THING it should NOT be handed: the RAW upload of a video asset
    // before its proxy exists. Raw phone footage routinely has its moov atom at
    // the END of the file (R7/R25 document this exact fact for THIS codebase),
    // which means ffmpeg reading it as a network stream — as the waveform route
    // does — often has to buffer close to the entire file before it can produce
    // any output, because the sample table it needs isn't available until the
    // stream ends. Proxies are always faststart (R7), so decoding one is fast
    // and predictable; decoding the raw source is a coin flip that gets worse
    // as the file gets larger. A 4K interview upload hitting this produced
    // three straight ffmpeg-timeout 500s before the proxy even finished — pure
    // wasted work, since the proxy was going to make the extraction trivial
    // moments later anyway.
    //
    // So: for a VIDEO asset, wait for asset.proxyUrl. usePeaks re-fires as soon
    // as it appears (it's a hook dependency), so this costs nothing but a short
    // wait — no clip is left permanently waveform-less. Non-video assets (plain
    // audio uploads, or a clip with no asset record at all) have no proxy
    // pipeline to wait for, so they keep the original clip-URL fallback.
    // IMPORTANT: `asset.gcsPath` is ALSO the raw path (set in IDELayout the
    // moment the raw upload lands on GCS, before any proxy exists), and
    // usePeaks' `gcsPath` argument takes ABSOLUTE priority over `proxyUrl` on
    // the server (utils/waveformPath.js's deriveGcsPath: `if (rawGcsPath)
    // return rawGcsPath` — checked FIRST, unconditionally). Nulling out
    // wsAudioUrl alone would do nothing: the explicit gcsPath would still force
    // raw-file resolution regardless of what proxyUrl says. Both arguments have
    // to be suppressed together or this fix is a no-op.
    const isUnproxiedVideoAsset = asset?.type === 'video' && !asset?.proxyUrl;
    const rawUrlFallback = isUnproxiedVideoAsset ? null : (clip.sourceUrl || clip.url || null);
    const wsAudioUrl = asset?.proxyUrl || rawUrlFallback;
    const { peaks: wsPeaks, duration: wsDuration, loading: wsLoading, error: wsError } = usePeaks(
        isTextClip ? null : clip.assetId,
        isUnproxiedVideoAsset ? null : asset?.gcsPath,
        wsAudioUrl,
    );

    // Slice the full-asset peaks down to THIS clip's source window.
    // The server extracts peaks for the whole file; a trimmed clip (offset=30,
    // duration=5) must show seconds 30–35 of the waveform, not the entire file
    // squeezed into the clip. Without this, every post-cleanup/multicam segment
    // rendered the same meaningless full-file waveform (or visually nothing at
    // narrow widths) — the recurring "waveform is missing" complaint.
    const clipPeaks = React.useMemo(() => {
        if (!wsPeaks?.length || !wsDuration) return wsPeaks;
        const clipOffset = clip.offset ?? 0;
        const clipDur    = clip.duration ?? 0;
        if (clipDur <= 0) return wsPeaks;
        // Untrimmed clip covering the whole source → no slicing needed
        if (clipOffset < 0.01 && Math.abs(clipDur - wsDuration) < 0.5) return wsPeaks;
        const rate  = wsPeaks.length / wsDuration; // samples per second
        const from  = Math.max(0, Math.floor(clipOffset * rate));
        const to    = Math.min(wsPeaks.length, Math.ceil((clipOffset + clipDur) * rate));
        const slice = wsPeaks.slice(from, to);
        return slice.length >= 2 ? slice : wsPeaks;
    }, [wsPeaks, wsDuration, clip.offset, clip.duration]);
    const wsColor = clip.type === 'audio'
        ? 'rgba(251,146,60,0.6)'
        : 'rgba(52,211,153,0.6)';

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: clip.id,
        data: { clip, trackId }
    });

    // Companion drag — when another selected clip is being dragged, move this one visually too
    const { active: dndActive } = useDndContext();
    const activeClipData = dndActive?.data?.current;
    const isCompanionDrag =
        !isDragging &&
        dndActive !== null &&
        activeClipData?.clip != null &&
        isSelected &&
        (selectedClipIds ?? []).includes(dndActive.id);

    let companionDx = 0;
    if (isCompanionDrag && dndActive.rect.current) {
        const { initial, translated } = dndActive.rect.current;
        if (initial && translated) companionDx = translated.left - initial.left;
    }

    const { setNodeRef: setDroppableRef } = useDroppable({
        id: `drop-clip-${clip.id}`,
        data: {
            type: 'clip',
            clipId: clip.id,
            trackId
        }
    });

    const style = {
        left: `${clip.start * zoomLevel}px`,
        width: `${clip.duration * zoomLevel}px`,
        transform: transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : isCompanionDrag
            ? `translate3d(${companionDx}px, 0, 0)`
            : undefined,
        cursor: 'grab',
        ...(isCompanionDrag && { opacity: 0.5, zIndex: 29 }),
    };

    const handleResize = (e, direction) => {
        e.stopPropagation();
        
        // Handle both mouse and touch events
        const isTouch = e.type.startsWith('touch');
        const startX = isTouch ? e.touches[0].clientX : e.clientX;
        const startDuration = clip.duration;
        const startStart = clip.start;
        const startOffset = clip.offset || 0;
        // Undo snapshot taken NOW, before the live (skipHistory) updates. It
        // used to be taken on release, when the clip was already trimmed, so
        // Undo after a trim did nothing (desktop and mobile).
        // Mobile also closes the gap left by the trim on release (main track).
        const mobileGesture = isMobile;
        useTimelineStore.getState().beginEditGesture();

        let rafId = null;
        let lastUpdates = null;

        const onMove = (moveEvent) => {
            // Keep the timeline from scrolling under the finger while trimming.
            if (moveEvent.type.startsWith('touch') && moveEvent.cancelable) moveEvent.preventDefault();
            // Capture clientX immediately — touch arrays may be recycled before RAF fires
            const clientX = moveEvent.type.startsWith('touch') ? moveEvent.touches[0].clientX : moveEvent.clientX;
            if (rafId !== null) return; // already a frame queued — skip this event
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const deltaSeconds = (clientX - startX) / zoomLevel;

                // Neighbour clips on this track — used to clamp so we never overlap
                const trackState = useTimelineStore.getState().tracks.find(t => t.id === trackId);
                const others = (trackState?.clips || []).filter(c => c.id !== clip.id);

                let updates = {};

                if (direction === 'right') {
                    const nextClip = others
                        .filter(c => c.start >= startStart)
                        .sort((a, b) => a.start - b.start)[0];
                    const maxEnd = nextClip ? nextClip.start : Infinity;
                    const newDuration = Math.max(0.1, Math.min(startDuration + deltaSeconds, maxEnd - startStart));
                    updates = { duration: newDuration };
                } else if (direction === 'left') {
                    const prevClip = others
                        .filter(c => c.start + c.duration <= startStart + startDuration)
                        .sort((a, b) => (b.start + b.duration) - (a.start + a.duration))[0];
                    const minStart = prevClip ? prevClip.start + prevClip.duration : 0;
                    const maxDelta = startDuration - 0.1;
                    const safeDelta = Math.max(Math.min(deltaSeconds, maxDelta), minStart - startStart);
                    updates = {
                        start: startStart + safeDelta,
                        duration: startDuration - safeDelta,
                        offset: startOffset + safeDelta
                    };
                }
                lastUpdates = updates;
                if (mobileGesture) setTrimLabel({ from: startDuration, to: updates.duration });
                // skipHistory: true — avoids deep-cloning the full timeline state on every frame
                useTimelineStore.getState().updateClip(trackId, clip.id, updates, { skipHistory: true });
            });
        };

        const onUp = () => {
            if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
            {
                const st = useTimelineStore.getState();
                const changed = !!lastUpdates && Math.abs((lastUpdates.duration ?? startDuration) - startDuration) > 1e-3;
                if (changed) {
                    st.updateClip(trackId, clip.id, lastUpdates, { skipHistory: true });
                    // Magnet (always on for mobile): close the gap the trim opened
                    // on the main track; captions/text after it move along.
                    if (mobileGesture && getMainVideoTrackId(st.tracks) === trackId) {
                        if (direction === 'right' && lastUpdates.duration < startDuration - 0.01) {
                            st.rippleDeleteGap(trackId, startStart + lastUpdates.duration + 0.001, { skipHistory: true });
                        } else if (direction === 'left' && lastUpdates.start > startStart + 0.01) {
                            st.rippleDeleteGap(trackId, lastUpdates.start - 0.001, { skipHistory: true });
                        }
                    }
                }
                st.endEditGesture(changed);
                if (mobileGesture) setTrimLabel(null);
            }
            if (isTouch) {
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onUp);
            } else {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
        };
        
        if (isTouch) {
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
        } else {
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }
    };

    const handleTransitionResize = (e) => {
        e.stopPropagation();
        const startX = e.clientX;
        const startDuration = clip.transition?.duration || 1.0;

        let rafId = null;
        let lastUpdates = null;

        const onMove = (moveEvent) => {
            const clientX = moveEvent.clientX;
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const deltaSeconds = (startX - clientX) / zoomLevel;
                const newDuration = Math.min(Math.max(0.1, startDuration + deltaSeconds), clip.duration);
                lastUpdates = { transition: { ...clip.transition, duration: newDuration } };
                useTimelineStore.getState().updateClip(trackId, clip.id, lastUpdates, { skipHistory: true });
            });
        };

        const onUp = () => {
            if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
            if (lastUpdates) useTimelineStore.getState().updateClip(trackId, clip.id, lastUpdates);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    return (
        <div
            ref={(node) => {
                setNodeRef(node);
                setDroppableRef(node);
            }}
            data-clip-id={clip.id}
            style={{
                ...style,
                // Two-tone gradient over the Tailwind bg color:
                // lighter top (label area) → darker bottom (waveform area) for contrast
                backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 55%, rgba(0,0,0,0.28) 100%)',
            }}
            {...listeners}
            {...attributes}
            className={classNames(
                "absolute top-0 bottom-0 rounded-md border border-white/10 overflow-hidden group flex flex-col select-none",
                // Text clips use a CSS color (e.g. '#fff') for their content — use
                // type-based Tailwind class for the timeline bar instead.
                clip.type === 'text'
                    ? (clip.bgColor || 'bg-green-600/80')
                    : (clip.color || 'bg-blue-500'),
                (isActive || isSelected) ? "border-white ring-2 ring-primary/50 z-20" : "opacity-90 hover:opacity-100",
                isDragging && (isMobile
                    // Mobile long-press: the clip lifts instead of fading out
                    ? "z-30 ring-2 ring-primary shadow-2xl"
                    : "opacity-50 z-30 ring-2 ring-primary")
            )}
            title={`${clip.name} (${clip.duration.toFixed(2)}s)`}
            onClick={(e) => {
                e.stopPropagation();
                if (e.metaKey || e.ctrlKey) {
                    toggleClipSelection(clip.id);
                } else {
                    setActiveClip(clip.id);
                    // Auto-switch left panel tab based on clip type (Tasks 2 & 8)
                    const targetTab = getTabForClip(clip, trackId);
                    if (targetTab) useAIStore.getState().setActiveTab(targetTab);
                }
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setActiveClip(clip.id);
                setCtxMenu({ x: e.clientX, y: e.clientY });
            }}
        >
            <div className="px-2 py-0.5 text-[10px] font-medium text-white truncate drop-shadow-md flex justify-between items-center bg-black/10 pointer-events-none sticky top-0 z-10">
                <span className="pointer-events-auto">{clip.name}</span>
                <button
                    className={`p-0.5 hover:bg-white/20 rounded-full transition-opacity pointer-events-auto ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    onPointerDown={(e) => {
                        e.stopPropagation(); // Prevent drag start
                        deleteClipWithMagnet(trackId, clip.id);
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
            </div>

            {/* Waveform rendered via ClipWaveform (WaveSurfer) below */}



            {/* ClipWaveform — WaveSurfer overlay, bottom 40%, pointer-events:none */}
            {!isTextClip && wsAudioUrl && (
                <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0,
                    height: '40%', pointerEvents: 'none', overflow: 'hidden',
                }}>
                    <ClipWaveform
                        audioUrl={wsAudioUrl}
                        peaks={clipPeaks}
                        duration={clip.duration ?? wsDuration}
                        height={isMobile ? 20 : 32}
                        color={wsColor}
                        loading={wsLoading}
                        error={wsError}
                    />
                </div>
            )}

            {showUploadState && (
                <div
                    aria-hidden="true"
                    style={{
                        position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none', overflow: 'hidden',
                        background: isProblemPhase(uploadStatus.phase) ? 'rgba(40,16,20,0.82)' : 'rgba(14,15,17,0.62)',
                        border: isProblemPhase(uploadStatus.phase) ? '1px solid var(--coral)' : '1px dashed var(--accent)',
                        borderRadius: 'inherit', display: 'flex', alignItems: 'center', padding: '0 6px',
                    }}
                >
                    {uploadStatus.phase === UPLOAD_PHASES.UPLOADING && (
                        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${uploadStatus.progress || 0}%`, background: 'var(--accent-soft)', transition: 'width .3s ease' }} />
                    )}
                    {uploadStatus.phase === UPLOAD_PHASES.PREPARING && (
                        <div className="animate-pulse" style={{ position: 'absolute', inset: 0, background: 'var(--accent-soft)' }} />
                    )}
                    <span style={{ position: 'relative', fontFamily: 'var(--f-mono)', fontSize: 9.5, color: isProblemPhase(uploadStatus.phase) ? 'var(--coral)' : 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {uploadStatus.phase === UPLOAD_PHASES.UPLOADING && t('mobileUpload.clipUploading', { pct: uploadStatus.progress || 0 })}
                        {uploadStatus.phase === UPLOAD_PHASES.PREPARING && t('mobileUpload.clipPreparing')}
                        {isProblemPhase(uploadStatus.phase) && t('mobileUpload.clipFailed')}
                    </span>
                </div>
            )}

            {/* Transition Handle / Visualizer */}
            {clip.transition && (
                <div 
                    className="absolute top-0 bottom-0 right-0 border-l border-primary/80 z-10 pointer-events-none"
                    style={{ 
                        width: `${clip.transition.duration * zoomLevel}px`,
                        background: 'linear-gradient(to right, transparent, rgba(59, 130, 246, 0.4))'
                    }}
                >
                    <div className="text-[8px] text-white/90 absolute bottom-1 right-1 font-mono uppercase bg-black/40 px-1 rounded">
                        {clip.transition.type} ({(clip.transition.duration).toFixed(1)}s)
                    </div>
                </div>
            )}
            {clip.transition && (
                <div
                    className="absolute top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 z-30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ right: `${clip.transition.duration * zoomLevel - 4}px` }}
                    onMouseDown={handleTransitionResize}
                    onTouchStart={handleTransitionResize}
                    title={t('timeline.dragTransitionDuration')}
                >
                    <div className="h-4 w-0.5 bg-primary shadow-sm rounded-full"></div>
                </div>
            )}

            <div
                className="absolute top-0 bottom-0 left-0 w-4 md:w-2 cursor-w-resize z-10 hover:bg-white/20 touch-none pointer-events-auto"
                style={isMobile && isActive ? MOBILE_HANDLE_STYLE.left : undefined}
                onMouseDown={(e) => handleResize(e, 'left')}
                onTouchStart={(e) => handleResize(e, 'left')}
            >{isMobile && isActive && <span aria-hidden="true" style={MOBILE_GRIP} />}</div>
            <div
                className="absolute top-0 bottom-0 right-0 w-4 md:w-2 cursor-e-resize z-10 hover:bg-white/20 touch-none pointer-events-auto"
                style={isMobile && isActive ? MOBILE_HANDLE_STYLE.right : undefined}
                onMouseDown={(e) => handleResize(e, 'right')}
                onTouchStart={(e) => handleResize(e, 'right')}
            >{isMobile && isActive && <span aria-hidden="true" style={MOBILE_GRIP} />}</div>

            {trimLabel && (
                <div aria-live="polite" style={{
                    position: 'absolute', top: 2, left: '50%', transform: 'translateX(-50%)', zIndex: 30, pointerEvents: 'none',
                    padding: '1px 6px', borderRadius: 6, background: 'var(--accent)', color: '#fff',
                    fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                }}>
                    {fmtLen(trimLabel.from)} → {fmtLen(trimLabel.to)}
                </div>
            )}

            {ctxMenu && (
                <ClipContextMenu
                    clip={clip}
                    trackId={trackId}
                    position={ctxMenu}
                    onClose={() => setCtxMenu(null)}
                />
            )}
        </div>
    );
};

export default Clip;
