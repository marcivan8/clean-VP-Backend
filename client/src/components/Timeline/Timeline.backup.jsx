import React from 'react';
import { DndContext, pointerWithin } from '@dnd-kit/core';
import Track from './Track';
import useTimelineStore from '../../store/useTimelineStore';
import { Scissors, ZoomIn, ZoomOut } from 'lucide-react';

const Timeline = () => {
    const { tracks, currentTime, duration, zoomLevel, seek, addClip, updateClip, setZoomLevel, addTrack } = useTimelineStore();

    // Keyboard Shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e) => {
            // Ignore if input is focused
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
                    console.log("Copied Clip:", activeClipId);
                }
            }

            // Paste (Cmd+V)
            if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
                pasteClip(currentTime);
                console.log("Pasted at:", currentTime);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleDragEnd = (event) => {
        const { active, over, delta } = event;

        if (active && over) {
            const activeClipId = active.id;
            const targetTrackId = over.data.current?.trackId;
            const currentClip = active.data.current?.clip;

            if (targetTrackId && currentClip) {
                // Calculate new start time based on drag delta
                // Delta.x is in pixels. Convert to seconds.
                const deltaSeconds = delta.x / zoomLevel;
                let newStart = currentClip.start + deltaSeconds;
                newStart = Math.max(0, newStart); // No negative time

                if (active.data.current.trackId === targetTrackId) {
                    updateClip(targetTrackId, activeClipId, { start: newStart });
                }
            }
        }
    };

    // Format time for ruler
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleSeekClick = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const clickedTime = x / zoomLevel;
        seek(clickedTime);
    };

    // Ref for the timeline content area to calculate playhead position
    const timelineRef = React.useRef(null);

    return (
        <div className="flex-1 bg-card flex flex-col relative h-full select-none" onKeyDown={handleKeyDown} tabIndex={0}>
            {/* Toolbar */}
            <div className="h-10 border-b border-border flex items-center px-4 justify-between bg-card z-20">
                <div className="flex items-center gap-4">
                    <span className="text-xs font-mono text-primary w-16 text-center">{currentTime.toFixed(2)}s</span>
                    <div className="h-4 w-px bg-border mx-2"></div>
                    <button
                        className="p-1 hover:bg-secondary rounded"
                        title="Split Clip (Cmd+B)"
                        onClick={() => {
                            const { activeClipId, tracks, splitClip, currentTime } = useTimelineStore.getState();
                            if (activeClipId) {
                                const track = tracks.find(t => t.clips.find(c => c.id === activeClipId));
                                if (track) splitClip(track.id, activeClipId, currentTime);
                            }
                        }}
                    >
                        <Scissors className="w-3 h-3 text-muted-foreground" />
                    </button>

                    {/* Speed Control */}
                    <div className="h-4 w-px bg-border mx-2"></div>
                    <select
                        className="bg-secondary text-[10px] text-muted-foreground rounded px-1 py-0.5 border-none outline-none cursor-pointer hover:bg-white/10"
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
                        onClick={() => addTrack('video')}
                        className="text-[10px] bg-secondary hover:bg-white/10 px-2 py-1 rounded text-muted-foreground transition-colors"
                    >
                        + Track
                    </button>
                    <button onClick={() => setZoomLevel(zoomLevel * 0.8)} className="group"><ZoomOut className="w-3 h-3 text-muted-foreground group-hover:text-foreground" /></button>
                    <div className="w-20 h-1 bg-secondary rounded-full overflow-hidden relative">
                        <div className="absolute inset-y-0 left-0 bg-primary/50 w-full" style={{ width: '50%' }}></div>
                    </div>
                    <button onClick={() => setZoomLevel(zoomLevel * 1.2)} className="group"><ZoomIn className="w-3 h-3 text-muted-foreground group-hover:text-foreground" /></button>
                </div>
            </div>

            {/* Tracks Area */}
            <div className="flex-1 overflow-auto relative custom-scrollbar flex flex-col">
                <DndContext onDragEnd={handleDragEnd} collisionDetection={pointerWithin}>

                    {/* Ruler */}
                    <div className="flex h-6 border-b border-white/5 bg-black/20 sticky top-0 z-10 shrink-0">
                        <div className="w-32 border-r border-border bg-card shrink-0"></div> {/* Spacer for headers */}
                        <div
                            className="flex-1 relative cursor-pointer"
                            style={{ width: `${duration * zoomLevel}px`, minWidth: '100%' }}
                            onClick={handleSeekClick}
                        >
                            {/* Generate ticks */}
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

                    {/* Vertical Playhead - Full Height */}
                    <div
                        className="absolute top-6 bottom-0 w-px bg-red-500 z-50 pointer-events-none"
                        style={{ left: `${32 * 4 + (currentTime * zoomLevel)}px` /* 32*4 is w-32 (128px) offset? No wait, w-32 is 8rem = 128px. */ }}
                    >
                        {/* Actually, the playhead should be inside the scrollable content container, aligned with tracks */}
                        {/* But we have a sidebar. The tracks start AFTER 128px. handleSeekClick logic handles standard x. */}
                        {/* Let's fix alignment. Tracks 'flex-1' area starts after 'w-32'. */}
                    </div>

                    {/* Correct structure for scroll sync: The scroll container should hold both ruler and tracks. */}
                    {/* Simplify: Playhead inside the 'flex-1' part of Ruler? No playhead needs to span tracks. */}
                    {/* Let's put playhead in an absolute overlay over the tracks container. */}

                    <div className="relative min-w-full" style={{ width: `calc(128px + ${duration * zoomLevel}px)` }}>
                        {/* Playhead Overlay */}
                        <div
                            className="absolute top-0 bottom-0 w-px bg-red-500 z-50 pointer-events-none ml-32"
                            style={{ left: `${currentTime * zoomLevel}px` }}
                        >
                            <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-red-500 rotate-45 transform shadow-sm"></div>
                        </div>

                        {/* tracks.map(track => (
                            <Track key={track.id} track={track} />
                        )) */}
                    </div>

                </DndContext>
            </div>
        </div >
    );
};

export default Timeline;
