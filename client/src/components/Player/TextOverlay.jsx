import React from 'react';
import useTimelineStore from '../../store/useTimelineStore';

// Map preset names to actual font families
const FONT_MAP = {
    'Inter': 'Inter, sans-serif',
    'Roboto': '"Roboto", sans-serif',
    'Lato': '"Lato", sans-serif',
    'Montserrat': '"Montserrat", sans-serif',
    'Oswald': '"Oswald", sans-serif',
    'Merriweather': '"Merriweather", serif',
    'Playfair': '"Playfair Display", serif',
    'Handwriting': '"Dancing Script", cursive',
};

const TextOverlay = () => {
    const containerRef = React.useRef(null);
    const { currentTime, tracks, activeClipId, updateClip, setActiveClip, saveToHistory } = useTimelineStore();

    // 1. Filter for 'text' tracks
    const textTracks = tracks.filter(t => t.type === 'text');

    if (textTracks.length === 0) return null;

    // 2. Find all active text clips across all text tracks
    // (We support multiple text layers!)
    const activeTextClips = textTracks.flatMap(track =>
        track.clips.filter(clip =>
            currentTime >= clip.start && currentTime < clip.start + clip.duration
        )
    );

    if (activeTextClips.length === 0) return null;

    // Helper to get all tracks for updateClip (since 'tracks' above is from store)
    // Actually 'tracks' from store is allTracks.
    const allTracks = tracks;

    // Drag Handler
    const handleDragStart = (e, clip) => {
        e.stopPropagation();
        e.preventDefault();
        setActiveClip(clip.id); // Select on click

        // Ensure we save history state BEFORE starting drag interaction
        saveToHistory();

        const startX = e.clientX;
        const startY = e.clientY;
        const initialClipX = clip.x || 50;
        const initialClipY = clip.y || 50;

        // Container dimensions
        const rect = containerRef.current.getBoundingClientRect();
        const containerW = rect.width;
        const containerH = rect.height;

        const handleMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;

            // Convert delta pixels to percentage
            const deltaPercentX = (deltaX / containerW) * 100;
            const deltaPercentY = (deltaY / containerH) * 100;

            const newX = initialClipX + deltaPercentX;
            const newY = initialClipY + deltaPercentY;

            // Find track ID (inefficient but safe)
            const track = allTracks.find(t => t.clips.some(c => c.id === clip.id));
            if (track) {
                // Update with skipHistory: true to avoid flooding
                updateClip(track.id, clip.id, { x: newX, y: newY }, { skipHistory: true });
            }
        };

        const handleUp = () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            // Final save? updateClip doesn't save with skipHistory=true. 
            // We should do a final commit... but technically the last state is current.
            // The issue is Undo will go back to BEFORE drag. 
            // So if I drag, I have 1 undo step. That is correct.
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
    };

    // Resize Handler
    const handleResizeStart = (e, clip) => {
        e.stopPropagation(); // Don't trigger drag
        e.preventDefault();
        saveToHistory();

        const startY = e.clientY;
        const initialScale = clip.scale || 1.0;
        const sensitivity = 0.01;

        const handleMove = (moveEvent) => {
            const deltaY = moveEvent.clientY - startY;
            // Drag Down = Grow, Drag Up = Shrink
            const newScale = Math.max(0.1, initialScale + (deltaY * sensitivity));

            const track = allTracks.find(t => t.clips.some(c => c.id === clip.id));
            if (track) {
                updateClip(track.id, clip.id, { scale: newScale }, { skipHistory: true });
            }
        };

        const handleUp = () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
    };

    return (
        <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden z-10">
            {activeTextClips.map((clip) => {
                const isActive = clip.id === activeClipId;

                return (
                    <div
                        key={clip.id}
                        onPointerDown={(e) => handleDragStart(e, clip)}
                        className={`absolute whitespace-pre-wrap select-none origin-center cursor-move transition-opacity hover:opacity-100 ${isActive ? 'ring-1 ring-primary ring-offset-1 ring-offset-transparent' : 'opacity-90'}`}
                        style={{
                            left: `${clip.x || 50}%`,
                            top: `${clip.y || 50}%`,
                            // Transform: Center (-50%) + Scale
                            transform: `translate(-50%, -50%) scale(${clip.scale || 1})`,
                            width: '80%',
                            fontFamily: FONT_MAP[clip.fontFamily] || 'Inter, sans-serif',
                            fontSize: `${clip.fontSize || 48}px`,
                            fontWeight: clip.fontWeight || 'normal',
                            fontStyle: clip.fontStyle || 'normal',
                            textDecoration: clip.textDecoration || 'none',
                            color: clip.color || '#ffffff',
                            textAlign: clip.textAlign || 'center',
                            textShadow: clip.textShadow || 'none',
                            WebkitTextStroke: clip.stroke ? `${clip.stroke.width}px ${clip.stroke.color}` : 'none',
                            opacity: clip.opacity ?? 1,
                            pointerEvents: 'auto'
                        }}
                    >
                        {clip.content || 'New Text'}

                        {/* Resize Handle (Only if Active) */}
                        {isActive && (
                            <div
                                onPointerDown={(e) => handleResizeStart(e, clip)}
                                className="absolute -bottom-2 -right-2 w-4 h-4 bg-primary border border-white rounded-full cursor-se-resize flex items-center justify-center shadow-md hover:scale-125 transition-transform"
                            >
                                <div className="w-1.5 h-1.5 bg-white rounded-full" />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default TextOverlay;
