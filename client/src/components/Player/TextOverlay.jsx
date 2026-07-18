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

// Distance between two pointer positions (for pinch-to-scale)
const pointerDist = (a, b) =>
    Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

const TextOverlay = () => {
    const containerRef = React.useRef(null);

    // Per-clip gesture state: { pointerId→{clientX,clientY}, initialScale, initialDist }
    const gestureRef = React.useRef({});

    const { currentTime, tracks, activeClipId, updateClip, setActiveClip, saveToHistory } = useTimelineStore(useShallow(state => ({
        currentTime:   state.currentTime,
        tracks:        state.tracks,
        activeClipId:  state.activeClipId,
        updateClip:    state.updateClip,
        setActiveClip: state.setActiveClip,
        saveToHistory: state.saveToHistory,
    })));

    const textTracks = tracks.filter(t => t.type === 'text');
    if (textTracks.length === 0) return null;

    const activeTextClips = textTracks.flatMap(track =>
        track.clips.filter(clip =>
            currentTime >= clip.start && currentTime < clip.start + clip.duration
        )
    );
    if (activeTextClips.length === 0) return null;

    const allTracks = tracks;

    const getTrackForClip = (clipId) =>
        allTracks.find(t => t.clips.some(c => c.id === clipId));

    // ── Unified pointer handler (drag + pinch-to-scale) ────────────────────────
    // We use pointer events so the same code handles both mouse and touch.
    // `touch-action: none` on the element prevents the browser from stealing
    // the touch sequence before our handler can call setPointerCapture.

    const handlePointerDown = (e, clip) => {
        e.stopPropagation();

        // Capture the pointer so we keep receiving events even if finger
        // leaves the element boundary. Critical on mobile.
        e.currentTarget.setPointerCapture(e.pointerId);

        setActiveClip(clip.id);

        const gs = gestureRef.current;
        if (!gs[clip.id]) gs[clip.id] = { pointers: {} };
        const state = gs[clip.id];

        state.pointers[e.pointerId] = { clientX: e.clientX, clientY: e.clientY };

        const pointerCount = Object.keys(state.pointers).length;

        if (pointerCount === 1) {
            // Single-finger drag setup
            saveToHistory();
            state.dragStartX    = e.clientX;
            state.dragStartY    = e.clientY;
            state.initialClipX  = typeof clip.x === 'number' ? clip.x : 50;
            state.initialClipY  = typeof clip.y === 'number' ? clip.y : 50;
            state.mode          = 'drag';
        } else if (pointerCount === 2) {
            // Second finger arrived — switch to pinch-to-scale
            saveToHistory();
            const pts = Object.values(state.pointers);
            state.initialDist   = pointerDist(pts[0], pts[1]);
            state.initialScale  = clip.scale || 1;
            state.mode          = 'pinch';
        }
    };

    const handlePointerMove = (e, clip) => {
        e.stopPropagation();

        const gs = gestureRef.current;
        const state = gs[clip.id];
        if (!state || !state.pointers[e.pointerId]) return;

        // Update tracked position for this pointer
        state.pointers[e.pointerId] = { clientX: e.clientX, clientY: e.clientY };

        const track = getTrackForClip(clip.id);
        if (!track) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        if (state.mode === 'pinch' && Object.keys(state.pointers).length === 2) {
            // Pinch-to-scale: adjust clip.scale
            const pts = Object.values(state.pointers);
            const currentDist = pointerDist(pts[0], pts[1]);
            const ratio = currentDist / (state.initialDist || 1);
            const newScale = Math.max(0.1, Math.min(5, state.initialScale * ratio));
            updateClip(track.id, clip.id, { scale: newScale }, { skipHistory: true });
        } else if (state.mode === 'drag') {
            // Single-finger drag: reposition
            const deltaX = e.clientX - state.dragStartX;
            const deltaY = e.clientY - state.dragStartY;
            const newX = state.initialClipX + (deltaX / rect.width)  * 100;
            const newY = state.initialClipY + (deltaY / rect.height) * 100;
            updateClip(track.id, clip.id, { x: newX, y: newY }, { skipHistory: true });
        }
    };

    const handlePointerUp = (e, clip) => {
        e.stopPropagation();

        const gs = gestureRef.current;
        const state = gs[clip.id];
        if (!state) return;

        delete state.pointers[e.pointerId];

        const remaining = Object.keys(state.pointers).length;
        if (remaining === 0) {
            // All fingers lifted — clean up
            delete gs[clip.id];
        } else if (remaining === 1 && state.mode === 'pinch') {
            // One finger lifted during pinch — revert to drag with the remaining finger
            saveToHistory();
            const [lastPt] = Object.values(state.pointers);
            state.dragStartX   = lastPt.clientX;
            state.dragStartY   = lastPt.clientY;
            state.initialClipX = typeof clip.x === 'number' ? clip.x : 50;
            state.initialClipY = typeof clip.y === 'number' ? clip.y : 50;
            state.mode         = 'drag';
        }
    };

    // ── Resize handle drag (desktop corner drag, still works on mobile too) ────
    const handleResizePointerDown = (e, clip) => {
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        saveToHistory();

        const startY      = e.clientY;
        const startX      = e.clientX;
        const initialScale = clip.scale || 1;

        const onMove = (moveE) => {
            // Diagonal drag: both axes contribute to scale
            const delta = ((moveE.clientX - startX) + (moveE.clientY - startY)) / 2;
            const sensitivity = 0.008;
            const newScale = Math.max(0.1, Math.min(5, initialScale + delta * sensitivity));
            const track = getTrackForClip(clip.id);
            if (track) updateClip(track.id, clip.id, { scale: newScale }, { skipHistory: true });
        };

        const onUp = () => {
            e.currentTarget?.removeEventListener('pointermove', onMove);
            e.currentTarget?.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        // Use window so the pointer can leave the element without losing events
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp, { once: true });
    };

    // Resolve percentage-based position
    const resolvePos = (clip) => {
        if (typeof clip.x === 'number' && typeof clip.y === 'number') {
            return { left: `${clip.x}%`, top: `${clip.y}%` };
        }
        if (clip.position === 'top')    return { left: '50%', top: '12%' };
        if (clip.position === 'bottom') return { left: '50%', top: '85%' };
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
                const clipProgress = clip.duration > 0
                    ? Math.min(1, Math.max(0, (currentTime - clip.start) / clip.duration))
                    : 1;

                return (
                    <div
                        key={`${clip.id}-${clip.animation || 'none'}`}
                        onPointerDown={(e) => handlePointerDown(e, clip)}
                        onPointerMove={(e) => handlePointerMove(e, clip)}
                        onPointerUp={(e)   => handlePointerUp(e, clip)}
                        onPointerCancel={(e) => handlePointerUp(e, clip)}
                        className={`absolute whitespace-pre-wrap select-none origin-center ${isActive ? 'ring-1 ring-primary ring-offset-1 ring-offset-transparent' : 'opacity-90'}`}
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
                            // ↓ Critical for mobile: prevents browser scroll/zoom from
                            //   stealing the touch sequence before our handler runs.
                            touchAction: 'none',
                            cursor: 'move',
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                            ...animStyle,
                        }}
                    >
                        {clip.animation === 'word-by-word'
                            ? <WordByWord content={clip.content || 'New Text'} progress={clipProgress} />
                            : (clip.content || 'New Text')
                        }

                        {/* Active selection ring hint (mobile: always show when active) */}
                        {isActive && (
                            <span
                                className="absolute -inset-2 rounded pointer-events-none"
                                style={{ border: '1px dashed rgba(0,229,255,0.5)' }}
                            />
                        )}

                        {/* Resize handle — large touch target (44×44) with small visual dot */}
                        {isActive && (
                            <div
                                onPointerDown={(e) => handleResizePointerDown(e, clip)}
                                style={{
                                    position: 'absolute',
                                    bottom: -22,
                                    right: -22,
                                    width: 44,
                                    height: 44,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'se-resize',
                                    touchAction: 'none',
                                    pointerEvents: 'auto',
                                }}
                            >
                                {/* Visual indicator (smaller than touch zone) */}
                                <div style={{
                                    width: 18,
                                    height: 18,
                                    borderRadius: '50%',
                                    background: 'var(--accent, #00E5FF)',
                                    border: '2px solid white',
                                    boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    {/* Diagonal resize arrows */}
                                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                        <path d="M1 7L7 1M4 7h3V4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                </div>
                            </div>
                        )}

                        {/* Pinch hint — shown briefly when clip is first selected on mobile */}
                        {isActive && (
                            <div
                                className="absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none"
                                style={{
                                    fontSize: 9,
                                    fontFamily: 'var(--f-mono, monospace)',
                                    color: 'rgba(0,229,255,0.7)',
                                    whiteSpace: 'nowrap',
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                }}
                            >
                                drag · pinch to scale
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default TextOverlay;
