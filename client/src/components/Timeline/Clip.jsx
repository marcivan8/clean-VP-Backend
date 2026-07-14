import React from 'react';
import { useDraggable, useDroppable, useDndContext } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import useAIStore from '../../store/useAIStore';
import classNames from 'classnames';
import Waveform from './Waveform';
import ClipContextMenu from './ClipContextMenu';
import ClipWaveform from '../ClipWaveform';
import { usePeaks } from '../../hooks/usePeaks';

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

const Clip = ({ clip, trackId }) => {
    const { zoomLevel, removeClip, activeClipId, selectedClipIds, setActiveClip, toggleClipSelection, waveforms, assets, addWaveform } = useTimelineStore(useShallow(state => ({
        zoomLevel:            state.zoomLevel,
        removeClip:           state.removeClip,
        activeClipId:         state.activeClipId,
        selectedClipIds:      state.selectedClipIds,
        setActiveClip:        state.setActiveClip,
        toggleClipSelection:  state.toggleClipSelection,
        waveforms:            state.waveforms,
        assets:               state.assets,
        addWaveform:          state.addWaveform,
    })));
    const isActive = activeClipId === clip.id;
    const isSelected = selectedClipIds && selectedClipIds.includes(clip.id);
    const [ctxMenu, setCtxMenu] = React.useState(null); // null | { x, y }

    // Waveform Data — PlaybackEngine emits under 'video_main' (the embedded
    // audio stream). Fall back to that key so audio track clips get the waveform
    // even though their trackId doesn't match 'video_main'.
    // Text/caption clips never have audio — skip the fallback so they don't
    // accidentally display the video's waveform on the caption track.
    const isTextClip = clip.type === 'text' || clip.type === 'caption';
    const waveformData = isTextClip ? null
        : waveforms ? (waveforms[trackId] ?? waveforms['video_main'] ?? null) : null;

    // Resolve waveform URL — prefer explicit waveformUrl on the asset, fall back
    // to deriving it from proxyUrl for assets uploaded before waveformUrl was stored.
    // proxyUrl pattern: .../proxies/{userId}/{videoFile}/proxy.mp4
    // waveformUrl:      .../proxies/{userId}/{videoFile}/waveform.json
    const asset = assets?.find(a => a.id === clip.assetId);
    const resolvedWaveformUrl = asset?.waveformUrl ||
        (asset?.proxyUrl ? asset.proxyUrl.replace(/\/proxy\.[^/]+$/, '/waveform.json') : null);

    // Fetch waveform peaks whenever the URL is available and not yet in store.
    // Adding resolvedWaveformUrl to deps means the effect re-runs as soon as
    // the proxy job sets the URL (without it the effect fires once on mount,
    // sees no URL, and never retries even after the asset is updated).
    React.useEffect(() => {
        if (waveformData) return; // already loaded
        if (!resolvedWaveformUrl) return;

        let cancelled = false;
        fetch(resolvedWaveformUrl)
            .then(r => r.ok ? r.json() : null)
            .then(wf => {
                if (!cancelled && wf?.peaks?.length) {
                    addWaveform(trackId, wf.peaks, wf.duration);
                    // Also store under 'video_main' so audio-track clips sharing the
                    // same asset pick it up via the fallback lookup in Clip.jsx.
                    addWaveform('video_main', wf.peaks, wf.duration);
                }
            })
            .catch(err => console.warn('[Clip] Waveform fetch failed:', err.message));

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvedWaveformUrl, !!waveformData]);

    // WaveSurfer peaks — fetched from server (independent of canvas waveform above)
    const { peaks: wsPeaks, duration: wsDuration, loading: wsLoading } = usePeaks(
        isTextClip ? null : clip.assetId,
        asset?.gcsPath,
        asset?.proxyUrl,
    );
    const wsColor = clip.type === 'audio'
        ? 'rgba(251,146,60,0.6)'
        : 'rgba(52,211,153,0.6)';
    const wsAudioUrl = asset?.proxyUrl || clip.url || clip.sourceUrl || null;

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

        let rafId = null;
        let lastUpdates = null;

        const onMove = (moveEvent) => {
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
                // skipHistory: true — avoids deep-cloning the full timeline state on every frame
                useTimelineStore.getState().updateClip(trackId, clip.id, updates, { skipHistory: true });
            });
        };

        const onUp = () => {
            if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
            // Commit final position to undo history exactly once
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
            style={style}
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
                isDragging && "opacity-50 z-30 ring-2 ring-primary"
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
                        removeClip(trackId, clip.id);
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
                        peaks={wsPeaks}
                        duration={wsDuration}
                        height={32}
                        color={wsColor}
                        loading={wsLoading}
                    />
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
                    title="Drag to change transition duration"
                >
                    <div className="h-4 w-0.5 bg-primary shadow-sm rounded-full"></div>
                </div>
            )}

            <div
                className="absolute top-0 bottom-0 left-0 w-4 md:w-2 cursor-w-resize z-10 hover:bg-white/20 touch-none pointer-events-auto"
                onMouseDown={(e) => handleResize(e, 'left')}
                onTouchStart={(e) => handleResize(e, 'left')}
            ></div>
            <div
                className="absolute top-0 bottom-0 right-0 w-4 md:w-2 cursor-e-resize z-10 hover:bg-white/20 touch-none pointer-events-auto"
                onMouseDown={(e) => handleResize(e, 'right')}
                onTouchStart={(e) => handleResize(e, 'right')}
            ></div>

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
