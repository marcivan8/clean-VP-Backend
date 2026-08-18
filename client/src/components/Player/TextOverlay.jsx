import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import useTimelineStore from '../../store/useTimelineStore';
// R58 — Motion Graphics engine. Animation is now resolved as a pure function
// of (layer, time) instead of being fired as a CSS keyframe on mount. That is
// the correct model for an editor: scrubbing into the middle of a 0.35s
// entrance must SHOW it half-played, which a CSS animation cannot do — it runs
// on wall-clock from mount, which is why this file needed a key-remount hack
// to retrigger it at all. Same resolver the Revideo scene and (later) the
// export call, so the three cannot drift apart the way R14/R16/R53 did.
import { clipToMotionLayer } from '../../motion/ClipAdapter.js';
import { resolveMotionAt }   from '../../motion/MotionResolver.js';
import { revealedWordCount, activeWordIndex } from '../../motion/CaptionModel.js';
// R66 — clip grouping. See the identical import in GraphicOverlay.jsx: a
// LowerThird's title (this component) and its background bar (GraphicOverlay,
// a different track) share a `groupId`; dragging either one must move both.
import { clipsInGroup } from '../../motion/ClipGrouping.js';
import { getPlayerDimensions } from '../../utils/playerDimensions.js';

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

// REMOVED IN R58: the injected `vibed-fade-in` / `vibed-slide-up` / `vibed-pop`
// CSS keyframes and their `getAnimationStyle()` helper.
//
// They are superseded by the motion resolver, which computes the same three
// entrances (and 23 more) as a function of timeline time. Deleting rather than
// leaving them behind is deliberate: a second, dormant animation path is
// exactly how this codebase accumulates "built but never wired" surface area,
// and two systems both claiming to animate the same element is worse than
// either alone. `LEGACY_ANIMATION_MAP` in motion/MotionPresets.js maps the old
// `clip.animation` strings onto presets, so existing projects are unaffected.
//
// NOTE: client/src/components/Player/CaptionOverlay.jsx still defines
// identically-NAMED keyframes with different transform semantics. It is
// currently mounted nowhere (its only importer, VideoPlayer.jsx, is itself
// imported by nothing) — but if it is ever revived, it must not reintroduce
// these names, or the two definitions will collide in the global stylesheet.

/**
 * Word-level caption rendering (R58).
 *
 * Replaces the old `WordByWord`, which split the clip's STRING on spaces and
 * revealed words by linear clip progress — it had no access to real word
 * timings because `groupWordsIntoCaptions` discarded them during grouping.
 * Now that captions carry a `words` array, reveal and highlight are driven by
 * the actual spoken timing, and fall back to linear progress (identical to the
 * old behaviour) for any caption without word data — e.g. hand-typed text, or
 * projects captioned before R58.
 *
 * @param {string} content   the caption text
 * @param {Array}  words     [{text,start,end}] in ABSOLUTE timeline seconds, or null
 * @param {number} time      current timeline time
 * @param {number} reveal    0..1 from a reveal animation (typewriter / word-reveal)
 * @param {object} highlight the style pack's wordHighlight config, or null
 */
const CaptionWords = ({ content, words, time, reveal, highlight }) => {
    const tokens = (content || '').split(' ').filter(Boolean);
    if (tokens.length === 0) return null;

    const shown = revealedWordCount(words, time, reveal, tokens.length);
    // Only meaningful when real word timings exist; -1 disables highlighting.
    const activeIdx = Array.isArray(words) && words.length > 0
        ? activeWordIndex(words, time)
        : -1;

    const mode = highlight?.mode || 'none';

    return (
        <span>
            {tokens.map((word, i) => {
                const visible = i < shown;
                const isActive = mode !== 'none' && i === activeIdx;

                const style = {
                    opacity: visible ? 1 : 0,
                    marginRight: '0.25em',
                    display: 'inline-block',
                    // Transition only opacity — transitioning transform would
                    // fight the per-word scale below and read as jitter.
                    transition: 'opacity 0.1s linear',
                };

                if (isActive) {
                    if (highlight.scale && highlight.scale !== 1) {
                        style.transform = `scale(${highlight.scale})`;
                    }
                    if (mode === 'color' && highlight.color) {
                        style.color = highlight.color;
                    } else if (mode === 'box') {
                        if (highlight.background) style.background = highlight.background;
                        if (highlight.color) style.color = highlight.color;
                        style.padding = '0 0.12em';
                        style.borderRadius = '0.08em';
                    } else if (mode === 'opacity') {
                        // Everything else dims instead of the active word brightening.
                        style.opacity = 1;
                    }
                } else if (visible && mode === 'opacity' && activeIdx >= 0) {
                    style.opacity = 0.55;
                }

                return <span key={i} style={style}>{word}</span>;
            })}
        </span>
    );
};

// Distance between two pointer positions (for pinch-to-scale)
const pointerDist = (a, b) =>
    Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

const TextOverlay = () => {
    const { t } = useTranslation('editor');
    const containerRef = React.useRef(null);

    // Per-clip gesture state: { pointerId→{clientX,clientY}, initialScale, initialDist }
    const gestureRef = React.useRef({});

    // applyCaptionUpdate is THE path for caption style/position changes — see its
    // definition in useTimelineStore. This component used to call updateClip()
    // directly, which is always single-clip, so a drag here ignored the Text
    // panel's global/individual toggle entirely: the user set "Global", dragged a
    // caption on the canvas, and only that one segment moved.
    const { currentTime, tracks, activeClipId, aspectRatio, applyCaptionUpdate, updateClip, setActiveClip, saveToHistory } = useTimelineStore(useShallow(state => ({
        currentTime:        state.currentTime,
        tracks:             state.tracks,
        activeClipId:       state.activeClipId,
        aspectRatio:        state.aspectRatio,
        applyCaptionUpdate: state.applyCaptionUpdate,
        updateClip:         state.updateClip,
        setActiveClip:      state.setActiveClip,
        saveToHistory:      state.saveToHistory,
    })));

    // ── Preview↔export font-size parity ─────────────────────────────────────
    // `clip.fontSize` (and `clip.stroke.width`) are defined in the project's
    // REFERENCE resolution — the same pixel space `<Player width={dims.width}
    // height={dims.height}>` is mounted at in IDELayout.jsx, and (absent an
    // explicit platform/resolution export override) the same space the export
    // worker renders drawtext at. But this container itself is NOT locked to
    // that resolution in actual CSS pixels — it's the responsively-sized div
    // Player/TextOverlay/GraphicOverlay all share (Tailwind classes like
    // `max-h-[70vh]`), so its rendered width is whatever the browser layout
    // gives it. Applying `clip.fontSize`px directly, with no compensation,
    // made captions look right or wrong purely by accident of window size —
    // and never matched the export, which always renders at the full
    // reference resolution. x/y positions never had this problem because
    // they're stored as resolution-independent percentages; fontSize is the
    // one property that's an absolute pixel value instead.
    //
    // previewScale = actual on-screen container width ÷ reference width, so
    // `fontSize * previewScale` always LOOKS the same size on screen as
    // `fontSize` px does when rendered at the full reference resolution —
    // which is what the export produces.
    const [previewScale, setPreviewScale] = React.useState(1);
    React.useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const { width: refWidth } = getPlayerDimensions(aspectRatio);
        const recompute = () => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0) setPreviewScale(rect.width / refWidth);
        };
        recompute();
        const observer = new ResizeObserver(recompute);
        observer.observe(el);
        return () => observer.disconnect();
    }, [aspectRatio]);

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
            // R66 — every OTHER member of this clip's group (this clip's own
            // position is already owned by `applyCaptionUpdate` below —
            // unchanged, including its global/individual scope fan-out).
            // Position only; pinch-to-scale deliberately does NOT fan out to
            // the group (scaling a bar+text pair together isn't a single
            // well-defined operation the way "move together" is).
            state.groupMembers = clip.groupId
                ? clipsInGroup(tracks, clip.groupId)
                    .filter(({ clip: c }) => c.id !== clip.id)
                    .map(({ trackId: tId, clip: c }) => ({
                        trackId: tId, clipId: c.id,
                        initialX: typeof c.x === 'number' ? c.x : 50,
                        initialY: typeof c.y === 'number' ? c.y : 50,
                    }))
                : null;
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

        // liveOnly: mid-gesture we touch ONLY the dragged clip, even in global
        // scope. Fanning out to every caption on each pointermove would mean N
        // store writes per pixel of travel. The real fan-out is committed once,
        // on pointer-up (see handlePointerUp), which is also what makes the
        // whole gesture a single undo entry.
        if (state.mode === 'pinch' && Object.keys(state.pointers).length === 2) {
            // Pinch-to-scale: adjust clip.scale
            const pts = Object.values(state.pointers);
            const currentDist = pointerDist(pts[0], pts[1]);
            const ratio = currentDist / (state.initialDist || 1);
            const newScale = Math.max(0.1, Math.min(5, state.initialScale * ratio));
            state.pendingUpdate = { scale: newScale };
            applyCaptionUpdate({ scale: newScale }, { clipId: clip.id, skipHistory: true, liveOnly: true });
        } else if (state.mode === 'drag') {
            // Single-finger drag: reposition
            const deltaX = e.clientX - state.dragStartX;
            const deltaY = e.clientY - state.dragStartY;
            const deltaXPct = (deltaX / rect.width)  * 100;
            const deltaYPct = (deltaY / rect.height) * 100;
            const newX = state.initialClipX + deltaXPct;
            const newY = state.initialClipY + deltaYPct;
            state.pendingUpdate = { x: newX, y: newY };
            applyCaptionUpdate({ x: newX, y: newY }, { clipId: clip.id, skipHistory: true, liveOnly: true });
            // R66 — drag the rest of the group (e.g. a LowerThird's
            // background bar, on a different track) along with the text.
            // Plain updateClip, not applyCaptionUpdate — a bar isn't a
            // caption and has no global/individual scope of its own.
            if (state.groupMembers) {
                for (const m of state.groupMembers) {
                    updateClip(m.trackId, m.clipId, { x: m.initialX + deltaXPct, y: m.initialY + deltaYPct }, { skipHistory: true });
                }
            }
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
            // Gesture finished — NOW commit at the real scope. In global scope
            // this is what propagates the final position/scale to every other
            // caption; mid-gesture only the dragged clip was moving (liveOnly).
            // Without this commit the canvas would still behave as if the
            // toggle were always "individual".
            if (state.pendingUpdate) {
                applyCaptionUpdate(state.pendingUpdate, { clipId: clip.id, skipHistory: true });
            }
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

        let lastScale = initialScale;

        const onMove = (moveE) => {
            // Diagonal drag: both axes contribute to scale
            const delta = ((moveE.clientX - startX) + (moveE.clientY - startY)) / 2;
            const sensitivity = 0.008;
            const newScale = Math.max(0.1, Math.min(5, initialScale + delta * sensitivity));
            lastScale = newScale;
            // liveOnly mid-drag (one write per move), real scope on release —
            // same two-phase commit as the pointer drag/pinch above.
            applyCaptionUpdate({ scale: newScale }, { clipId: clip.id, skipHistory: true, liveOnly: true });
        };

        const onUp = () => {
            // Commit at the real scope so a global-mode resize reaches every caption.
            applyCaptionUpdate({ scale: lastScale }, { clipId: clip.id, skipHistory: true });
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

                // ── Motion resolution (R58) ─────────────────────────────────
                // The layer is a pure VIEW over the clip — see motion/ClipAdapter.
                // clipToMotionLayer folds the legacy `clip.animation` string and
                // any caption style pack into real animations, so a project made
                // before R58 keeps animating without migration.
                const layer = clipToMotionLayer(clip);
                const motion = layer
                    ? resolveMotionAt(layer, currentTime)
                    : { x: 50, y: 50, scale: clip.scale || 1, rotation: 0, opacity: clip.opacity ?? 1, blur: 0, glow: 0, reveal: 1 };

                // Fall back to the original positioning helper if adaptation
                // failed for any reason — never leave a caption unrenderable.
                const pos = layer
                    ? { left: `${motion.x}%`, top: `${motion.y}%` }
                    : resolvePos(clip);

                const transform = [
                    'translate(-50%, -50%)',
                    motion.rotation ? `rotate(${motion.rotation}deg)` : '',
                    `scale(${motion.scale})`,
                ].filter(Boolean).join(' ');

                const highlight = clip.captionStyle?.wordHighlight || null;
                // Render per-word when there is real word timing to honour, or
                // when a reveal animation is mid-flight. Otherwise emit the
                // plain string — one text node is cheaper than N spans, and
                // most captions are static most of the time.
                const needsWordRender =
                    (Array.isArray(clip.words) && clip.words.length > 0 && highlight && highlight.mode !== 'none')
                    || motion.reveal < 1;

                const content = clip.content || t('timeline.newTextDefault');

                const filters = [];
                if (motion.blur > 0) filters.push(`blur(${motion.blur * previewScale}px)`);
                const glowShadow = motion.glow > 0
                    ? `0 0 ${motion.glow * previewScale}px currentColor, 0 0 ${motion.glow * 2 * previewScale}px currentColor`
                    : null;

                return (
                    <div
                        // Keyed on id alone (R58). The old key folded in
                        // `clip.animation` purely to force a remount so the CSS
                        // keyframe would replay — the resolver is time-driven and
                        // needs no remount, and remounting mid-gesture used to
                        // drop the pointer capture on a drag.
                        key={clip.id}
                        onPointerDown={(e) => handlePointerDown(e, clip)}
                        onPointerMove={(e) => handlePointerMove(e, clip)}
                        onPointerUp={(e)   => handlePointerUp(e, clip)}
                        onPointerCancel={(e) => handlePointerUp(e, clip)}
                        className={`absolute whitespace-pre-wrap select-none origin-center ${isActive ? 'ring-1 ring-primary ring-offset-1 ring-offset-transparent' : 'opacity-90'}`}
                        style={{
                            left: pos.left,
                            top: pos.top,
                            transform,
                            width: '80%',
                            fontFamily: FONT_MAP[clip.fontFamily] || FONT_MAP[clip.fontFamily?.split(',')[0]?.trim()] || 'Inter, sans-serif',
                            // See the previewScale comment above the hook that
                            // computes it — clip.fontSize/clip.stroke.width are
                            // reference-resolution pixels, not screen pixels.
                            fontSize: `${(clip.fontSize || 48) * previewScale}px`,
                            fontWeight: clip.fontWeight || 'normal',
                            fontStyle: clip.fontStyle || 'normal',
                            textDecoration: clip.textDecoration || 'none',
                            color: clip.color || '#ffffff',
                            textAlign: clip.textAlign || 'center',
                            textShadow: glowShadow || clip.textShadow || 'none',
                            WebkitTextStroke: clip.stroke ? `${clip.stroke.width * previewScale}px ${clip.stroke.color}` : 'none',
                            textTransform: clip.captionStyle?.uppercase ? 'uppercase' : 'none',
                            opacity: motion.opacity,
                            ...(filters.length > 0 ? { filter: filters.join(' ') } : {}),
                            pointerEvents: 'auto',
                            // ↓ Critical for mobile: prevents browser scroll/zoom from
                            //   stealing the touch sequence before our handler runs.
                            touchAction: 'none',
                            cursor: 'move',
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                        }}
                    >
                        {needsWordRender
                            ? <CaptionWords
                                  content={content}
                                  words={clip.words}
                                  time={currentTime}
                                  reveal={motion.reveal}
                                  highlight={highlight}
                              />
                            : content
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
                                {t('player.dragPinchToScale')}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default TextOverlay;
