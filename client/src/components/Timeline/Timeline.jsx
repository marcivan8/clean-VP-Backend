import { useShallow } from 'zustand/react/shallow';
import React from 'react';
import { useDroppable, useDndContext } from '@dnd-kit/core';
import Track from './Track';
import useTimelineStore from '../../store/useTimelineStore';
import { Scissors, ZoomIn, ZoomOut, Copy, Type, Palette } from 'lucide-react';

const RULER_H    = 24;   // h-6 = 24px (ruler height)
const LABEL_W    = 128;  // w-32 = 128px (track label column)
const EDGE_ZONE  = 60;   // px from edge that triggers auto-scroll
const SCROLL_SPD = 10;   // base px/frame; scales with proximity to edge

const Timeline = () => {
    const { tracks, duration, zoomLevel, seek, setZoomLevel, addTrack } = useTimelineStore(useShallow(state => ({
    tracks: state.tracks,
    duration: state.duration,
    zoomLevel: state.zoomLevel,
    seek: state.seek,
    setZoomLevel: state.setZoomLevel,
    addTrack: state.addTrack
})));

    const timeDisplayRef = React.useRef(null);
    const playheadLineRef = React.useRef(null);
    const playheadHandleRef = React.useRef(null);

    // Rubber-band multi-select
    const tracksAreaRef = React.useRef(null);
    const selDragRef = React.useRef(null);
    const [selBox, setSelBox] = React.useState(null);

    // "Create new track" drop zone — shown above the track list while dragging a clip
    const { active: dndActive } = useDndContext();
    const isDraggingClip = dndActive?.data?.current?.clip != null;
    const { setNodeRef: newTrackDropRef, isOver: isOverNewTrack } = useDroppable({
        id: 'new-track-drop-zone',
    });

    const getContentPos = React.useCallback((clientX, clientY) => {
        const area = tracksAreaRef.current;
        if (!area) return { x: 0, y: 0 };
        const rect = area.getBoundingClientRect();
        return {
            x: clientX - rect.left + area.scrollLeft,
            y: clientY - rect.top + area.scrollTop - RULER_H,
        };
    }, []);

    const handleTracksMouseDown = React.useCallback((e) => {
        if (e.button !== 0) return;
        if (e.target.closest('[data-clip-id], button, input, select')) return;
        const area = tracksAreaRef.current;
        if (!area) return;
        const rect = area.getBoundingClientRect();
        const localX = e.clientX - rect.left + area.scrollLeft;
        if (localX < LABEL_W) return; // in label column

        const start = getContentPos(e.clientX, e.clientY);
        selDragRef.current = { ...start, moved: false };

        // Track cursor position so the scroll RAF can access it without closure issues
        let cursorX = e.clientX;
        let cursorY = e.clientY;
        let scrollRafId = null;

        // Recompute and paint the selection box from the latest cursor + scroll position
        const refreshSelBox = () => {
            const cur = getContentPos(cursorX, cursorY);
            const dx = cur.x - selDragRef.current.x;
            const dy = cur.y - selDragRef.current.y;
            setSelBox({
                left:   Math.min(selDragRef.current.x, cur.x),
                top:    Math.min(selDragRef.current.y, cur.y),
                width:  Math.abs(dx),
                height: Math.abs(dy),
            });
            const zl = useTimelineStore.getState().zoomLevel;
            useTimelineStore.getState().seek(Math.max(0, (cur.x - LABEL_W) / zl));
        };

        // Edge-scroll loop: runs every animation frame while cursor is in the edge zone
        const scrollTick = () => {
            const areaRect = area.getBoundingClientRect();
            const relX     = cursorX - areaRect.left;
            let   delta    = 0;

            if (relX < LABEL_W + EDGE_ZONE) {
                // Left edge — the closer to the label column, the faster
                const proximity = Math.max(0, relX - LABEL_W) / EDGE_ZONE; // 0 = very left, 1 = edge zone boundary
                delta = -SCROLL_SPD * (1 + (1 - proximity) * 2);
            } else if (relX > areaRect.width - EDGE_ZONE) {
                // Right edge — the closer to the right wall, the faster
                const proximity = (areaRect.width - relX) / EDGE_ZONE; // 0 = very right, 1 = edge zone boundary
                delta = SCROLL_SPD * (1 + (1 - proximity) * 2);
            }

            if (delta !== 0) {
                area.scrollLeft = Math.max(0, area.scrollLeft + delta);
                refreshSelBox();
                scrollRafId = requestAnimationFrame(scrollTick);
            } else {
                scrollRafId = null;
            }
        };

        const onMove = (me) => {
            cursorX = me.clientX;
            cursorY = me.clientY;

            const cur = getContentPos(me.clientX, me.clientY);
            const dx  = cur.x - selDragRef.current.x;
            const dy  = cur.y - selDragRef.current.y;
            if (!selDragRef.current.moved && Math.hypot(dx, dy) < 5) return;
            selDragRef.current.moved = true;

            refreshSelBox();

            // Kick off the scroll loop only if it is not already running
            if (scrollRafId === null) scrollTick();
        };

        const onUp = (me) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (scrollRafId !== null) { cancelAnimationFrame(scrollRafId); scrollRafId = null; }

            if (selDragRef.current?.moved) {
                const cur = getContentPos(me.clientX, me.clientY);
                const x1  = Math.min(selDragRef.current.x, cur.x);
                const x2  = Math.max(selDragRef.current.x, cur.x);
                const zl  = useTimelineStore.getState().zoomLevel;
                const tStart = Math.max(0, (x1 - LABEL_W) / zl);
                const tEnd   = (x2 - LABEL_W) / zl;

                const ids = [];
                for (const track of useTimelineStore.getState().tracks) {
                    for (const clip of track.clips || []) {
                        if ((clip.start + clip.duration) > tStart && clip.start < tEnd) {
                            ids.push(clip.id);
                        }
                    }
                }
                if (ids.length > 0) {
                    useTimelineStore.setState({ selectedClipIds: ids, activeClipId: ids[0] });
                } else {
                    useTimelineStore.getState().clearSelection();
                }
            } else {
                // Single click without drag — seek to the clicked position and clear selection
                const zl = useTimelineStore.getState().zoomLevel;
                useTimelineStore.getState().seek(Math.max(0, (selDragRef.current.x - LABEL_W) / zl));
                useTimelineStore.getState().clearSelection();
            }

            selDragRef.current = null;
            setSelBox(null);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [getContentPos]);

    React.useEffect(() => {
        let rafId;
        const updatePlayhead = () => {
            const state = useTimelineStore.getState();

            // FIX: Read currentTime directly from store instead of trying to read
            // from player.playback.time (a Revideo internal ref that is often
            // undefined during playback). The Revideo <Player onTimeUpdate={...}>
            // already keeps state.currentTime in sync at every frame.
            const time = state.currentTime || 0;

            if (timeDisplayRef.current) timeDisplayRef.current.innerText = `${time.toFixed(2)}s`;

            const renderZoom = Number(state.zoomLevel) || 10;
            const px = time * renderZoom;

            if (playheadLineRef.current && !isNaN(px)) {
                playheadLineRef.current.style.left = `${128 + px}px`;
            }
            if (playheadHandleRef.current && !isNaN(px)) {
                playheadHandleRef.current.style.left = `${px}px`;
            }

            rafId = requestAnimationFrame(updatePlayhead);
        };
        rafId = requestAnimationFrame(updatePlayhead);
        return () => cancelAnimationFrame(rafId);
    }, []);

    // Keyboard Shortcuts
    const handleKeyDown = React.useCallback((e) => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

        const { activeClipId, tracks, removeClip, splitClip, copyClip, pasteClip, currentTime } = useTimelineStore.getState();

        // Delete
        if (e.key === 'Backspace' || e.key === 'Delete') {
            if (activeClipId) {
                const track = tracks.find(t => t.clips.find(c => c.id === activeClipId));
                if (track) removeClip(track.id, activeClipId);
            }
        }

        // Split (Cmd+B)
        if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
            e.preventDefault();
            if (activeClipId) {
                const track = tracks.find(t => t.clips.find(c => c.id === activeClipId));
                if (track) splitClip(track.id, activeClipId, currentTime);
            }
        }

        // Copy (Cmd+C)
        if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
            if (activeClipId) {
                copyClip(activeClipId);
            }
        }

        // Paste (Cmd+V)
        if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
            pasteClip(currentTime);
        }

        // Arrow keys — frame-by-frame scrubbing (no modifier key)
        // Shift+Arrow = jump 10 frames
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            const { seek, duration, playerRef } = useTimelineStore.getState();
            // Prefer fps from the live Revideo player; fall back to 30
            const fps = playerRef?.playback?.fps ?? 30;
            const frames = e.shiftKey ? 10 : 1;
            const step = (frames / fps) * (e.key === 'ArrowLeft' ? -1 : 1);
            seek(Math.max(0, Math.min(duration, currentTime + step)));
        }
    }, []);

    React.useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex-1 bg-transparent flex flex-col relative h-full select-none" onKeyDown={handleKeyDown} onContextMenu={e => e.preventDefault()} tabIndex={0}>
            {/* Toolbar */}
            <div className="h-10 border-b flex items-center px-4 justify-between z-20 shrink-0" style={{ background: "var(--glass)", borderColor: "var(--line-soft)" }}>
                <div className="flex items-center gap-4">
                    <span ref={timeDisplayRef} className="text-xs w-16 text-center studio-mono-label" style={{ color: "var(--accent)" }}>0.00s</span>
                    <div className="h-4 w-px mx-2" style={{ background: "var(--line-soft)" }}></div>
                    <button
                        className="p-1 rounded relative group transition-colors hover:bg-white/5"
                        title="Split Clip (Cmd+B)"
                        onClick={() => {
                            const { activeClipId, tracks, splitClip, currentTime } = useTimelineStore.getState();
                            if (activeClipId) {
                                const track = tracks.find(t => t.clips.find(c => c.id === activeClipId));
                                if (track) splitClip(track.id, activeClipId, currentTime);
                            }
                        }}
                    >
                        <Scissors className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                    </button>

                    <button
                        className="p-1 rounded relative group transition-colors hover:bg-white/5"
                        title="Duplicate Clip (Cmd+D)"
                        onClick={() => {
                            const { activeClipId, tracks, duplicateClip } = useTimelineStore.getState();
                            if (activeClipId) {
                                const track = tracks.find(t => t.clips.find(c => c.id === activeClipId));
                                if (track) duplicateClip(track.id, activeClipId);
                            }
                        }}
                    >
                        <Copy className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                    </button>

                    <div className="h-4 w-px mx-2" style={{ background: "var(--line-soft)" }}></div>

                    <button
                        className="p-1 rounded relative group transition-colors hover:bg-white/5"
                        title="Add Text Overlay"
                        onClick={() => {
                            useTimelineStore.getState().addTextOverlay('New Text', 'center', 5, 'default');
                        }}
                    >
                        <Type className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                    </button>

                    <select
                        className="text-[10px] text-muted-foreground rounded px-1 py-0.5 border-none outline-none cursor-pointer hover:bg-white/10"
                        style={{ background: "var(--glass-2)", fontFamily: "var(--f-mono)" }}
                        title="Add Transition"
                        value=""
                        onChange={(e) => {
                            const type = e.target.value;
                            if (!type) return;
                            const { activeClipId, addTransition } = useTimelineStore.getState();
                            if (activeClipId) addTransition(activeClipId, type, 1.0);
                            e.target.value = "";
                        }}
                    >
                        <option value="">+ Transition</option>
                        <option value="fade">Fade Out</option>
                        <option value="crossfade">Crossfade</option>
                        <option value="slide">Slide Left</option>
                        <option value="zoom">Zoom Out</option>
                    </select>

                    <button
                        className="p-1 rounded relative group transition-colors hover:bg-white/5"
                        title="Add Filter (Cinematic)"
                        onClick={() => {
                            const { activeClipId, addFilter } = useTimelineStore.getState();
                            if (activeClipId) addFilter(activeClipId, 'cinematic', 0.8);
                        }}
                    >
                        <Palette className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                    </button>

                    {/* Aspect Ratio Control */}
                    <div className="h-4 w-px mx-2" style={{ background: "var(--line-soft)" }}></div>
                    <select
                        className="text-[10px] text-muted-foreground rounded px-1 py-0.5 border-none outline-none cursor-pointer hover:bg-white/10"
                        style={{ background: "var(--glass-2)", fontFamily: "var(--f-mono)" }}
                        title="Aspect Ratio"
                        value={useTimelineStore(state => state.aspectRatio)}
                        onChange={(e) => useTimelineStore.getState().setAspectRatio(e.target.value)}
                    >
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                        <option value="4:3">4:3</option>
                        <option value="4:5">4:5</option>
                        <option value="21:9">21:9</option>
                    </select>

                    {/* Speed Control */}
                    <div className="h-4 w-px mx-2" style={{ background: "var(--line-soft)" }}></div>
                    <select
                        className="text-[10px] text-muted-foreground rounded px-1 py-0.5 border-none outline-none cursor-pointer hover:bg-white/10"
                        style={{ background: "var(--glass-2)", fontFamily: "var(--f-mono)" }}
                        title="Playback Speed"
                        value={(() => {
                            const { activeClipId, tracks } = useTimelineStore.getState();
                            const track = tracks.find(t => t.clips.find(c => c.id === activeClipId));
                            const clip = track?.clips.find(c => c.id === activeClipId);
                            return clip?.speed || 1.0;
                        })()}
                        onChange={(e) => {
                            const speed = parseFloat(e.target.value);
                            const { activeClipId, tracks, setClipSpeed } = useTimelineStore.getState();
                            if (activeClipId) {
                                const track = tracks.find(t => t.clips.find(c => c.id === activeClipId));
                                if (track) setClipSpeed(track.id, activeClipId, speed);
                            }
                        }}
                    >
                        <option value="0.25">0.25x</option>
                        <option value="0.5">0.5x</option>
                        <option value="1.0">1.0x</option>
                        <option value="1.5">1.5x</option>
                        <option value="2.0">2.0x</option>
                        <option value="4.0">4.0x</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className="text-[10px] px-2 py-1 rounded text-muted-foreground transition-colors hover:bg-white/10"
                        style={{ background: "var(--glass-2)", fontFamily: "var(--f-mono)" }}
                        onClick={() => addTrack('video')}
                    >
                        + Track
                    </button>
                    <button onClick={() => setZoomLevel(zoomLevel * 0.8)} className="group"><ZoomOut className="w-3 h-3 text-muted-foreground group-hover:text-foreground" /></button>
                    <div className="w-20 h-1 rounded-full overflow-hidden relative" style={{ background: "var(--glass-2)" }}>
                        <div className="absolute inset-y-0 left-0 bg-primary/50 w-full" style={{ width: '50%' }}></div>
                    </div>
                    <button onClick={() => setZoomLevel(zoomLevel * 1.2)} className="group"><ZoomIn className="w-3 h-3 text-muted-foreground group-hover:text-foreground" /></button>
                </div>
            </div>

            {/* Tracks Area */}
            <div
                ref={tracksAreaRef}
                className="flex-1 overflow-auto relative custom-scrollbar flex flex-col"
                style={{ WebkitOverflowScrolling: 'touch' }}
                onMouseDown={handleTracksMouseDown}
            >
                {/* Ruler */}
                <div className="flex h-6 border-b border-white/5 bg-black/20 sticky top-0 z-10 shrink-0">
                    <div className="w-32 border-r shrink-0" style={{ borderColor: "var(--line-soft)", background: "var(--bg-2)" }}></div>
                    <div
                        className="flex-1 relative cursor-pointer"
                        style={{ width: `${duration * zoomLevel}px`, minWidth: '100%' }}
                        onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            // Stop propagation so the tracks-area rubber-band handler
                            // doesn't also fire and compete with the ruler seek.
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            seek(Math.max(0, (e.clientX - rect.left) / zoomLevel));
                        }}
                    >
                        {/* Ruler ticks */}
                        {Array.from({ length: Math.ceil(duration / 5) }).map((_, i) => (
                            <div key={i} className="absolute top-0 bottom-0 border-l border-white/20 text-[9px] text-muted-foreground pl-1 pt-1" style={{ left: `${i * 5 * zoomLevel}px` }}>
                                {formatTime(i * 5)}
                            </div>
                        ))}

                        {/* Beat Markers */}
                        {useTimelineStore.getState().beatMarkers && useTimelineStore.getState().beatMarkers.map((beatTime, idx) => (
                            <div
                                key={`beat-${idx}`}
                                className="absolute bottom-0 h-2 w-px bg-purple-500/80 pointer-events-none"
                                style={{ left: `${beatTime * zoomLevel}px` }}
                                title={`Beat ${idx + 1}`}
                            />
                        ))}
                    </div>
                </div>

                {/* Vertical Playhead Line — full height, fixed at 128px (w-32) offset */}
                <div
                    ref={playheadLineRef}
                    className="absolute top-6 bottom-0 w-px bg-red-500 z-50 pointer-events-none"
                    style={{ left: '128px' }}
                />

                <div className="relative min-w-full" style={{ width: `calc(128px + ${duration * zoomLevel}px)` }}>
                    {/* Playhead handle (diamond) inside track area */}
                    <div
                        ref={playheadHandleRef}
                        className="absolute top-0 bottom-0 w-px bg-red-500 z-50 pointer-events-none ml-32"
                        style={{ left: '0px' }}
                    >
                        <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-red-500 rotate-45 transform shadow-sm"></div>
                    </div>

                    {/* New-track drop zone — appears above all tracks while dragging a clip */}
                    {isDraggingClip && (
                        <div
                            ref={newTrackDropRef}
                            className={`flex items-center justify-center h-9 mx-1 my-0.5 rounded border-2 border-dashed transition-all text-xs font-medium select-none pointer-events-auto
                                ${isOverNewTrack
                                    ? 'border-blue-400 bg-blue-400/15 text-blue-400'
                                    : 'border-white/20 text-white/30'}`}
                        >
                            ↑ Drop here to create a new track
                        </div>
                    )}

                    {(() => {
                        // Identify the baseline video and audio tracks — always kept
                        // visible as drop targets, even when empty.
                        //
                        // Tracks are sorted by order ascending. New video tracks get
                        // minOrder-1 (float above), so the original main video track
                        // has the highest order → it is LAST in the video list.
                        // New audio tracks get maxOrder+1 (sink below), so the main
                        // audio track has the lowest order → FIRST in the audio list.
                        const videoTracks = tracks.filter(t => t.type === 'video');
                        const audioTracks = tracks.filter(t => t.type === 'audio');
                        const mainVideoId = videoTracks.at(-1)?.id ?? null;
                        const mainAudioId = audioTracks[0]?.id ?? null;

                        return tracks
                            .filter(track =>
                                track.clips.length > 0 ||
                                track.id === mainVideoId ||
                                track.id === mainAudioId
                            )
                            .map(track => <Track key={track.id} track={track} />);
                    })()}

                    {/* Rubber-band selection box */}
                    {selBox && (
                        <div
                            className="absolute z-40 border border-blue-400/80 bg-blue-400/10 pointer-events-none rounded-sm"
                            style={{
                                left: `${selBox.left}px`,
                                top: `${selBox.top}px`,
                                width: `${selBox.width}px`,
                                height: `${selBox.height}px`,
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default Timeline;
