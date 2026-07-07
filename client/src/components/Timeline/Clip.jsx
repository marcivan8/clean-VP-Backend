import React, { useCallback } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import classNames from 'classnames';
import Waveform from './Waveform';

const Clip = React.memo(({ clip, trackId }) => {
    // Precise selector — only subscribe to the 4 values this component actually needs.
    // Without useShallow+selector every clip re-rendered on every store change (playhead, etc).
    const { zoomLevel, isActive, isSelected, waveformData } = useTimelineStore(
        useShallow(state => ({
            zoomLevel:    state.zoomLevel,
            isActive:     state.activeClipId === clip.id,
            isSelected:   state.selectedClipIds?.includes(clip.id) ?? false,
            waveformData: state.waveforms?.[trackId] ?? null,
        }))
    );

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: clip.id,
        data: { clip, trackId },
    });

    const { setNodeRef: setDroppableRef } = useDroppable({
        id: `drop-clip-${clip.id}`,
        data: { type: 'clip', clipId: clip.id, trackId },
    });

    const style = {
        left:       `${clip.start * zoomLevel}px`,
        width:      `${clip.duration * zoomLevel}px`,
        transform:  transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        cursor:     'grab',
        willChange: isDragging ? 'transform' : undefined,
    };

    // RAF-throttled resize — skipHistory during drag, commit once on mouseUp.
    // Previously: fired updateClip (+ _saveHistory deep-clone) on every mouse pixel.
    const handleResize = useCallback((e, direction) => {
        e.stopPropagation();
        e.preventDefault();

        const startX        = e.clientX;
        const startDuration = clip.duration;
        const startStart    = clip.start;
        const startOffset   = clip.offset || 0;
        // Read zoomLevel once — stable for the whole drag gesture
        const zl            = useTimelineStore.getState().zoomLevel;

        let lastUpdates = null;
        let rafId       = null;

        const onMove = (moveEvent) => {
            const clientX = moveEvent.clientX; // capture before RAF
            if (rafId !== null) return;        // skip if a frame is already queued
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const deltaSeconds = (clientX - startX) / zl;

                if (direction === 'right') {
                    lastUpdates = { duration: Math.max(0.1, startDuration + deltaSeconds) };
                } else {
                    const safeDelta = Math.min(deltaSeconds, startDuration - 0.1);
                    lastUpdates = {
                        start:    startStart + safeDelta,
                        duration: startDuration - safeDelta,
                        offset:   startOffset + safeDelta,
                    };
                }
                // skipHistory: true — no deep-clone of timeline state on every frame
                useTimelineStore.getState().updateClip(trackId, clip.id, lastUpdates, { skipHistory: true });
            });
        };

        const onUp = () => {
            if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
            // Commit final position to undo history once
            if (lastUpdates) {
                useTimelineStore.getState().updateClip(trackId, clip.id, lastUpdates);
            }
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
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
            if (lastUpdates) {
                useTimelineStore.getState().updateClip(trackId, clip.id, lastUpdates);
            }
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

            <div className="flex-1 w-full bg-black/10 relative">
                {waveformData && (
                    <Waveform
                        peaks={waveformData.peaks}
                        duration={waveformData.duration}
                        offset={clip.offset || 0}
                        zoomLevel={zoomLevel}
                        color="rgba(255, 255, 255, 0.8)"
                    />
                )}
            </div>

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
                    className="absolute top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 z-30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity touch-none"
                    style={{ right: `${clip.transition.duration * zoomLevel - 4}px` }}
                    onMouseDown={handleTransitionResize}
                    title="Drag to change transition duration"
                >
                    <div className="h-4 w-0.5 bg-primary shadow-sm rounded-full" />
                </div>
            )}

            {/* Single onMouseDown per handle — previously had both onPointerDown AND onMouseDown which fired twice */}
            <div
                className="absolute top-0 bottom-0 left-0 w-3 cursor-w-resize hover:bg-white/20 z-20 touch-none"
                onMouseDown={(e) => handleResize(e, 'left')}
            />
            <div
                className="absolute top-0 bottom-0 right-0 w-3 cursor-e-resize z-10 hover:bg-white/20 touch-none"
                onMouseDown={(e) => handleResize(e, 'right')}
            />
        </div>
    );
}, (prev, next) =>
    // Only re-render when this clip's own data changes — not when unrelated clips update
    prev.clip.id         === next.clip.id       &&
    prev.clip.start      === next.clip.start     &&
    prev.clip.duration   === next.clip.duration  &&
    prev.clip.name       === next.clip.name      &&
    prev.clip.color      === next.clip.color     &&
    prev.clip.bgColor    === next.clip.bgColor   &&
    prev.clip.type       === next.clip.type      &&
    prev.clip.transition === next.clip.transition &&
    prev.clip.offset     === next.clip.offset    &&
    prev.trackId         === next.trackId
);

Clip.displayName = 'Clip';
export default Clip;
