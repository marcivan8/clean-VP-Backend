import React, { useCallback } from 'react';
import { useDraggable, useDroppable, useDndContext } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import classNames from 'classnames';
import Waveform from './Waveform';
import ClipContextMenu from './ClipContextMenu';

const Clip = React.memo(({ clip, trackId }) => {
    // Precise selector — only the values this component actually needs.
    // Avoids re-rendering every clip on every store change (playhead, other clips, etc.)
    const { zoomLevel, isActive, isSelected, selectedClipIds, waveformData, assets } = useTimelineStore(
        useShallow(state => ({
            zoomLevel:       state.zoomLevel,
            isActive:        state.activeClipId === clip.id,
            isSelected:      state.selectedClipIds?.includes(clip.id) ?? false,
            selectedClipIds: state.selectedClipIds,
            // Waveform: prefer track-specific key, fall back to 'video_main' (embedded audio stream)
            waveformData:    state.waveforms?.[trackId] ?? state.waveforms?.['video_main'] ?? null,
            assets:          state.assets,
        }))
    );

    const [ctxMenu, setCtxMenu] = React.useState(null);

    // Resolve waveform URL — prefer explicit waveformUrl on the asset, fall back to
    // deriving it from proxyUrl for assets uploaded before waveformUrl was stored.
    const asset             = assets?.find(a => a.id === clip.assetId);
    const resolvedWaveformUrl = asset?.waveformUrl ||
        (asset?.proxyUrl ? asset.proxyUrl.replace(/\/proxy\.[^/]+$/, '/waveform.json') : null);

    // Fetch waveform peaks whenever the URL is available and not yet in store.
    // resolvedWaveformUrl in deps means the effect retries as soon as the proxy
    // job sets the URL, without waiting for a remount.
    React.useEffect(() => {
        if (waveformData) return;
        if (!resolvedWaveformUrl) return;

        let cancelled = false;
        fetch(resolvedWaveformUrl)
            .then(r => r.ok ? r.json() : null)
            .then(wf => {
                if (!cancelled && wf?.peaks?.length) {
                    const { addWaveform } = useTimelineStore.getState();
                    addWaveform(trackId, wf.peaks, wf.duration);
                    // Also store under 'video_main' so audio-track clips sharing the
                    // same asset pick it up via the fallback lookup above.
                    addWaveform('video_main', wf.peaks, wf.duration);
                }
            })
            .catch(err => console.warn('[Clip] Waveform fetch failed:', err.message));

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvedWaveformUrl, !!waveformData]);

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: clip.id,
        data: { clip, trackId },
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
        data: { type: 'clip', clipId: clip.id, trackId },
    });

    const style = {
        left:  `${clip.start * zoomLevel}px`,
        width: `${clip.duration * zoomLevel}px`,
        transform: transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : isCompanionDrag
            ? `translate3d(${companionDx}px, 0, 0)`
            : undefined,
        cursor:    'grab',
        willChange: isDragging ? 'transform' : undefined,
        ...(isCompanionDrag && { opacity: 0.5, zIndex: 29 }),
    };

    // RAF-throttled resize with skipHistory during drag; one history commit on mouseUp.
    // Previously: updateClip (+ _saveHistory deep-clone) fired on every mouse pixel.
    const handleResize = useCallback((e, direction) => {
        e.stopPropagation();

        const isTouch       = e.type.startsWith('touch');
        const startX        = isTouch ? e.touches[0].clientX : e.clientX;
        const startDuration = clip.duration;
        const startStart    = clip.start;
        const startOffset   = clip.offset || 0;
        // Read zoomLevel once — stable for the whole gesture
        const zl            = useTimelineStore.getState().zoomLevel;

        let lastUpdates = null;
        let rafId       = null;

        const onMove = (moveEvent) => {
            const clientX = moveEvent.type?.startsWith('touch')
                ? (moveEvent.touches[0]?.clientX ?? moveEvent.changedTouches[0]?.clientX)
                : moveEvent.clientX;
            if (rafId !== null) return; // skip if a frame is already queued
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const deltaSeconds = (clientX - startX) / zl;

                // Clamp to neighbour clips so we never overlap
                const trackState = useTimelineStore.getState().tracks.find(t => t.id === trackId);
                const others     = (trackState?.clips || []).filter(c => c.id !== clip.id);

                let updates = {};
                if (direction === 'right') {
                    const nextClip    = others.filter(c => c.start >= startStart).sort((a, b) => a.start - b.start)[0];
                    const maxEnd      = nextClip ? nextClip.start : Infinity;
                    const newDuration = Math.max(0.1, Math.min(startDuration + deltaSeconds, maxEnd - startStart));
                    updates = { duration: newDuration };
                } else {
                    const prevClip  = others
                        .filter(c => c.start + c.duration <= startStart + startDuration)
                        .sort((a, b) => (b.start + b.duration) - (a.start + a.duration))[0];
                    const minStart  = prevClip ? prevClip.start + prevClip.duration : 0;
                    const maxDelta  = startDuration - 0.1;
                    const safeDelta = Math.max(Math.min(deltaSeconds, maxDelta), minStart - startStart);
                    updates = { start: startStart + safeDelta, duration: startDuration - safeDelta, offset: startOffset + safeDelta };
                }
                lastUpdates = updates;
                useTimelineStore.getState().updateClip(trackId, clip.id, updates, { skipHistory: true });
            });
        };

        const onUp = () => {
            if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
            // Commit final position to undo history once
            if (lastUpdates) useTimelineStore.getState().updateClip(trackId, clip.id, lastUpdates);
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
    }, [clip.id, clip.duration, clip.start, clip.offset, trackId]);

    const handleTransitionResize = useCallback((e) => {
        e.stopPropagation();
        const startX        = e.clientX;
        const startDuration = clip.transition?.duration || 1.0;
        const zl            = useTimelineStore.getState().zoomLevel;

        let lastUpdates = null;
        let rafId       = null;

        const onMove = (moveEvent) => {
            const clientX = moveEvent.clientX;
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const deltaSeconds = (startX - clientX) / zl;
                const newDuration  = Math.min(Math.max(0.1, startDuration + deltaSeconds), clip.duration);
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
    }, [clip.id, clip.duration, clip.transition, trackId]);

    return (
        <div
            ref={(node) => { setNodeRef(node); setDroppableRef(node); }}
            data-clip-id={clip.id}
            style={style}
            {...listeners}
            {...attributes}
            className={classNames(
                'absolute top-0 bottom-0 rounded-md border border-white/10 overflow-hidden group flex flex-col justify-between select-none',
                clip.type === 'text'
                    ? (clip.bgColor || 'bg-green-600/80')
                    : (clip.color   || 'bg-blue-500'),
                (isActive || isSelected) ? 'border-white ring-2 ring-primary/50 z-20' : 'opacity-90 hover:opacity-100',
                isDragging && 'opacity-50 z-30 ring-2 ring-primary'
            )}
            title={`${clip.name} (${clip.duration.toFixed(2)}s)`}
            onClick={(e) => {
                e.stopPropagation();
                if (e.metaKey || e.ctrlKey) {
                    useTimelineStore.getState().toggleClipSelection(clip.id);
                } else {
                    useTimelineStore.getState().setActiveClip(clip.id);
                }
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                useTimelineStore.getState().setActiveClip(clip.id);
                setCtxMenu({ x: e.clientX, y: e.clientY });
            }}
        >
            <div className="px-2 py-0.5 text-[10px] font-medium text-white truncate drop-shadow-md flex justify-between items-center bg-black/10 pointer-events-none sticky top-0 z-10">
                <span className="pointer-events-auto">{clip.name}</span>
                <button
                    className="p-0.5 hover:bg-white/20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto"
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        useTimelineStore.getState().removeClip(trackId, clip.id);
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                    </svg>
                </button>
            </div>

            {/* Waveform */}
            <div className="w-full h-12 relative overflow-hidden flex-shrink-0">
                {waveformData && (
                    <Waveform
                        peaks={waveformData.peaks}
                        duration={waveformData.duration}
                        offset={clip.offset || 0}
                        zoomLevel={zoomLevel}
                        waveColor={clip.type === 'audio' ? 'rgba(251, 146, 60, 0.80)' : 'rgba(74, 222, 128, 0.78)'}
                        bgColor="rgba(0, 0, 0, 0.50)"
                    />
                )}
            </div>

            {/* Transition visualizer */}
            {clip.transition && (
                <div
                    className="absolute top-0 bottom-0 right-0 border-l border-primary/80 z-10 pointer-events-none"
                    style={{
                        width:      `${clip.transition.duration * zoomLevel}px`,
                        background: 'linear-gradient(to right, transparent, rgba(59, 130, 246, 0.4))',
                    }}
                >
                    <div className="text-[8px] text-white/90 absolute bottom-1 right-1 font-mono uppercase bg-black/40 px-1 rounded">
                        {clip.transition.type} ({clip.transition.duration.toFixed(1)}s)
                    </div>
                </div>
            )}
            {clip.transition && (
                <div
                    className="absolute top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 z-30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ right: `${clip.transition.duration * zoomLevel - 4}px` }}
                    onMouseDown={handleTransitionResize}
                    onTouchStart={handleTransitionResize}
                    title="Drag to change transition duration"
                >
                    <div className="h-4 w-0.5 bg-primary shadow-sm rounded-full" />
                </div>
            )}

            {/* Resize handles — single handler each (was duplicated before), with touch support */}
            <div
                className="absolute top-0 bottom-0 left-0 w-4 md:w-2 cursor-w-resize z-10 hover:bg-white/20 touch-none pointer-events-auto"
                onMouseDown={(e) => handleResize(e, 'left')}
                onTouchStart={(e) => handleResize(e, 'left')}
            />
            <div
                className="absolute top-0 bottom-0 right-0 w-4 md:w-2 cursor-e-resize z-10 hover:bg-white/20 touch-none pointer-events-auto"
                onMouseDown={(e) => handleResize(e, 'right')}
                onTouchStart={(e) => handleResize(e, 'right')}
            />

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
}, (prev, next) =>
    // Only re-render when this clip's own data changes
    prev.clip.id         === next.clip.id        &&
    prev.clip.start      === next.clip.start      &&
    prev.clip.duration   === next.clip.duration   &&
    prev.clip.name       === next.clip.name       &&
    prev.clip.color      === next.clip.color      &&
    prev.clip.bgColor    === next.clip.bgColor    &&
    prev.clip.type       === next.clip.type       &&
    prev.clip.transition === next.clip.transition &&
    prev.clip.offset     === next.clip.offset     &&
    prev.clip.assetId    === next.clip.assetId    &&
    prev.trackId         === next.trackId
);

Clip.displayName = 'Clip';
export default Clip;
