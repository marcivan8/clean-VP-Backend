import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';

// Map preset names to actual font families
const FONT_MAP = {
    // Talking Head
    'Anton':              '"Anton", sans-serif',
    'Bebas Neue':         '"Bebas Neue", sans-serif',
    'Montserrat':         '"Montserrat", sans-serif',
    'Inter':              'Inter, sans-serif',
    'Barlow Condensed':   '"Barlow Condensed", sans-serif',
    // Podcast / Doc
    'Playfair Display':   '"Playfair Display", serif',
    'Playfair':           '"Playfair Display", serif',
    'Lora':               '"Lora", serif',
    'Merriweather':       '"Merriweather", serif',
    'DM Serif Display':   '"DM Serif Display", serif',
    'Cormorant Garamond': '"Cormorant Garamond", serif',
    // Lifestyle / Vlog
    'Nunito':             '"Nunito", sans-serif',
    'Poppins':            '"Poppins", sans-serif',
    'Quicksand':          '"Quicksand", sans-serif',
    'Josefin Sans':       '"Josefin Sans", sans-serif',
    'Raleway':            '"Raleway", sans-serif',
    // Gaming / Tech
    'Rajdhani':           '"Rajdhani", sans-serif',
    'Exo 2':              '"Exo 2", sans-serif',
    'Orbitron':           '"Orbitron", sans-serif',
    'Oxanium':            '"Oxanium", sans-serif',
    'Roboto Condensed':   '"Roboto Condensed", sans-serif',
    // Motivational
    'Oswald':             '"Oswald", sans-serif',
    'Teko':               '"Teko", sans-serif',
    'Black Han Sans':     '"Black Han Sans", sans-serif',
    'Saira Condensed':    '"Saira Condensed", sans-serif',
    'Cabin':              '"Cabin", sans-serif',
    // Handwritten
    'Caveat':             '"Caveat", cursive',
    'Pacifico':           '"Pacifico", cursive',
    'Kalam':              '"Kalam", cursive',
    'Satisfy':            '"Satisfy", cursive',
    'Dancing Script':     '"Dancing Script", cursive',
    'Handwriting':        '"Dancing Script", cursive',
    // Neon / Glow
    'Boogaloo':           '"Boogaloo", cursive',
    'Righteous':          '"Righteous", cursive',
    'Press Start 2P':     '"Press Start 2P", monospace',
    'Audiowide':          '"Audiowide", sans-serif',
    // Legacy
    'Roboto':             '"Roboto", sans-serif',
    'Lato':               '"Lato", sans-serif',
    'Outfit':             '"Outfit", sans-serif',
};

// CSS keyframes injected once
const ANIMATION_CSS = `
@keyframes vibed-fade-in    { from { opacity:0 }                           to { opacity:1 } }
@keyframes vibed-slide-up   { from { opacity:0; transform:translate(-50%,calc(-50%+16px)) scale(var(--clip-scale,1)) }   to { opacity:1; transform:translate(-50%,-50%) scale(var(--clip-scale,1)) } }
@keyframes vibed-pop        { 0% { opacity:0; transform:translate(-50%,-50%) scale(calc(var(--clip-scale,1)*0.75)) } 60% { transform:translate(-50%,-50%) scale(calc(var(--clip-scale,1)*1.08)) } 100% { opacity:1; transform:translate(-50%,-50%) scale(var(--clip-scale,1)) } }
`;
if (typeof document !== 'undefined' && !document.getElementById('vibed-overlay-anims')) {
    const s = document.createElement('style');
    s.id = 'vibed-overlay-anims';
    s.textContent = ANIMATION_CSS;
    document.head.appendChild(s);
}

const getAnimationStyle = (animation, clipScale) => {
    if (!animation || animation === 'none') return {};
    const dur = '0.35s';
    const ease = 'cubic-bezier(0.22,0.61,0.36,1)';
    const base = { '--clip-scale': clipScale || 1 };
    if (animation === 'fade-in')  return { ...base, animation: `vibed-fade-in  ${dur} ${ease} both` };
    if (animation === 'slide-up') return { ...base, animation: `vibed-slide-up ${dur} ${ease} both` };
    if (animation === 'pop')      return { ...base, animation: `vibed-pop      0.45s ${ease} both` };
    return {};
};

// Word-by-word: reveal words progressively across clip duration
const WordByWord = ({ content, progress }) => {
    const words = (content || '').split(' ');
    const revealCount = Math.ceil(progress * words.length);
    return (
        <span>
            {words.map((word, i) => (
                <span key={i} style={{ opacity: i < revealCount ? 1 : 0, transition: 'opacity 0.1s', marginRight: '0.25em' }}>
                    {word}
                </span>
            ))}
        </span>
    );
};

const TextOverlay = () => {
    const containerRef = React.useRef(null);
    const { currentTime, tracks, activeClipId, updateClip, setActiveClip, saveToHistory } = useTimelineStore(useShallow(state => ({
        currentTime:   state.currentTime,
        tracks:        state.tracks,
        activeClipId:  state.activeClipId,
        updateClip:    state.updateClip,
        setActiveClip: state.setActiveClip,
        saveToHistory: state.saveToHistory,
    })));

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

    // Resolve percentage-based position from the clip's position/x/y fields.
    // Explicit x/y always win; otherwise map the 'position' preset.
    const resolvePos = (clip) => {
        if (typeof clip.x === 'number' && typeof clip.y === 'number') {
            return { left: `${clip.x}%`, top: `${clip.y}%` };
        }
        if (clip.position === 'top')    return { left: '50%', top: '12%' };
        if (clip.position === 'bottom') return { left: '50%', top: '85%' };
        // 'center' or anything else
        return { left: '50%', top: '50%' };
    };

    return (
        <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden z-10">
            {activeTextClips.map((clip) => {
                const isActive = clip.id === activeClipId;
                const { left, top } = resolvePos(clip);
                const clipScale = clip.scale || 1;
                const animStyle = clip.animation !== 'word-by-word'
                    ? getAnimationStyle(clip.animation, clipScale)
                    : {};
                // Word-by-word progress: 0→1 across clip duration
                const clipProgress = clip.duration > 0
                    ? Math.min(1, Math.max(0, (currentTime - clip.start) / clip.duration))
                    : 1;

                return (
                    <div
                        key={`${clip.id}-${clip.animation || 'none'}`}
                        onPointerDown={(e) => handleDragStart(e, clip)}
                        className={`absolute whitespace-pre-wrap select-none origin-center cursor-move transition-opacity hover:opacity-100 ${isActive ? 'ring-1 ring-primary ring-offset-1 ring-offset-transparent' : 'opacity-90'}`}
                        style={{
                            left,
                            top,
                            transform: `translate(-50%, -50%) scale(${clipScale})`,
                            width: '80%',
                            fontFamily: FONT_MAP[clip.fontFamily] || FONT_MAP[clip.fontFamily?.split(',')[0]?.trim()] || 'Inter, sans-serif',
                            fontSize: `${clip.fontSize || 48}px`,
                            fontWeight: clip.fontWeight || 'normal',
                            fontStyle: clip.fontStyle || 'normal',
                            textDecoration: clip.textDecoration || 'none',
                            color: clip.color || '#ffffff',
                            textAlign: clip.textAlign || 'center',
                            textShadow: clip.textShadow || 'none',
                            WebkitTextStroke: clip.stroke ? `${clip.stroke.width}px ${clip.stroke.color}` : 'none',
                            opacity: clip.opacity ?? 1,
                            pointerEvents: 'auto',
                            ...animStyle,
                        }}
                    >
                        {clip.animation === 'word-by-word'
                            ? <WordByWord content={clip.content || 'New Text'} progress={clipProgress} />
                            : (clip.content || 'New Text')
                        }

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
