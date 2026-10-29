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
import { revealedWordCount, activeWordIndex, resolveEmphasis } from '../../motion/CaptionModel.js';
import { highlightMixAt } from '../../motion/TextCraft.js';
import { mixColor, withAlpha } from '../../motion/ColorTheory.js';
// R66 — clip grouping. See the identical import in GraphicOverlay.jsx: a
// LowerThird's title (this component) and its background bar (GraphicOverlay,
// a different track) share a `groupId`; dragging either one must move both.
import { clipsInGroup } from '../../motion/ClipGrouping.js';
import { getPlayerDimensions } from '../../utils/playerDimensions.js';
import RotateHandle from './RotateHandle.jsx';
import ResizeHandle from './ResizeHandle.jsx';
// R92 round C: alignment guides while dragging
import { computeSnap, startPosition, measureOthers } from '../../motion/SnapGuides.js';
import { useSnapGuides } from './SnapGuidesLayer.jsx';

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
 * @param {string} baseColor the caption's own colour, which the highlight
 *                 blends FROM (R107 — see `highlightMixAt`)
 */
const CaptionWords = ({ content, words, time, reveal, highlight, emphasis, baseColor }) => {
    const tokens = (content || '').split(' ').filter(Boolean);
    if (tokens.length === 0) return null;

    // Words appear one by one only when a reveal animation is running or the
    // active-word highlight is on (the behaviour before R88). Keyword emphasis
    // alone renders per word but shows the whole caption at once.
    const hasWords = Array.isArray(words) && words.length > 0;
    const revealing = reveal < 1 || (hasWords && !!highlight && highlight.mode && highlight.mode !== 'none');
    const shown = revealing ? revealedWordCount(words, time, reveal, tokens.length) : tokens.length;
    // Only meaningful when real word timings exist; -1 disables highlighting.
    const activeIdx = Array.isArray(words) && words.length > 0
        ? activeWordIndex(words, time)
        : -1;

    const mode = highlight?.mode || 'none';
    // Keyword emphasis (R88): a fixed set of word indices styled for the whole
    // caption, separate from the active-word highlight. The look comes from the
    // style pack (resolveEmphasis → emphasisStyleFor). Applied first so the
    // active-word highlight, when it lands on the same word, wins on colour.
    const emphasised = new Set(emphasis?.indices || []);
    const emStyle = emphasis?.style || null;

    // R107 — the active-word highlight BLENDS in over a few frames instead of
    // switching colour, box and scale on one. The mix is quantised
    // (TextCraft.HIGHLIGHT_MIX_STEPS) so the export's pre-rendered word states
    // can carry the same value and the two paths agree by construction.
    // Without word timings there is no moment the highlight arrives, so there
    // is nothing to ramp: it is simply on.
    const activeWord = hasWords && activeIdx >= 0 ? words[activeIdx] : null;
    const hlMix = activeWord
        ? highlightMixAt(time, Number(activeWord.start), Number(activeWord.end) - Number(activeWord.start))
        : 1;
    const fromColor = baseColor || '#ffffff';

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

                let scale = 1;
                if (emStyle && emphasised.has(i)) {
                    if (emStyle.scale && emStyle.scale !== 1) scale = emStyle.scale;
                    if ((emStyle.mode === 'color' || emStyle.mode === 'box') && emStyle.color) style.color = emStyle.color;
                    if (emStyle.mode === 'box') {
                        if (emStyle.background) style.background = emStyle.background;
                        style.padding = '0 0.12em';
                        style.borderRadius = '0.08em';
                    }
                }

                if (isActive) {
                    // Each of these is the end state multiplied by the ramp:
                    // a colour blended from the word's own, a box faded up
                    // from nothing (there is no colour to blend a background
                    // from), and a scale that grows from 1.
                    const blend = (c) => mixColor(style.color || fromColor, c, hlMix);
                    const box = (c) => withAlpha(c, hlMix) || c;
                    const grow = (to) => Math.max(scale, 1 + (Number(to) - 1) * hlMix);
                    if (highlight.scale && highlight.scale !== 1) {
                        scale = grow(highlight.scale);
                    }
                    if (mode === 'color' && highlight.color) {
                        style.color = blend(highlight.color);
                    } else if (mode === 'box') {
                        if (highlight.background) style.background = box(highlight.background);
                        if (highlight.color) style.color = blend(highlight.color);
                        style.padding = '0 0.12em';
                        style.borderRadius = '0.08em';
                    } else if (mode === 'vox-marker') {
                        style.background = box(highlight.background || '#FFE500');
                        style.color = blend(highlight.color || '#111827');
                        style.padding = '0.04em 0.2em';
                        style.borderRadius = '0.12em';
                        style.boxShadow = `0 2px 8px ${withAlpha('#FFE500', 0.4 * hlMix) || 'rgba(255,229,0,0.4)'}`;
                    } else if (mode === 'bounce-box') {
                        style.background = box((i % 2 === 0 ? highlight.background : highlight.altBackground) || highlight.background || '#FFE500');
                        style.color = blend(highlight.color || '#000000');
                        style.padding = '0.06em 0.22em';
                        style.borderRadius = '0.15em';
                        style.transform = `scale(${grow(highlight.scale || 1.15)}) rotate(${i % 2 === 0 ? '-2deg' : '2deg'})`;
                    } else if (mode === 'terminal-cursor') {
                        style.color = blend(highlight.color || '#34D399');
                    } else if (mode === 'neon-glow') {
                        style.color = blend(highlight.color || '#00E5FF');
                        const glow = highlight.glowColor || '#00E5FF';
                        style.textShadow = `0 0 ${12 * hlMix}px ${glow}, 0 0 ${24 * hlMix}px ${glow}`;
                    } else if (mode === 'opacity') {
                        // Everything else dims instead of the active word brightening.
                        style.opacity = 1;
                    }
                } else if (visible && mode === 'opacity' && activeIdx >= 0) {
                    style.opacity = 0.55;
                }

                if (scale !== 1 && mode !== 'bounce-box') style.transform = `scale(${scale})`;

                return (
                    <span key={i} style={style}>
                        {word}
                        {isActive && mode === 'terminal-cursor' && (
                            <span style={{ color: highlight.cursorColor || '#10B981', marginLeft: '2px', animation: 'pulse 1s infinite' }}>{highlight.cursor || '█'}</span>
                        )}
                    </span>
                );
            })}
        </span>
    );
};

const TextOverlay = ({ placementFilter = 'all' }) => {
    const { t } = useTranslation('editor');
    const containerRef = React.useRef(null);

    // Per-clip gesture state: { pointerId→{clientX,clientY}, initialScale, initialDist }
    const gestureRef = React.useRef({});
    // Caption DOM nodes by clip id — the rotate handle needs the element's
    // on-screen centre to measure the drag angle around.
    const clipElRefs = React.useRef({});

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

    // Hook before the early return -- see the same fix in GraphicOverlay.jsx.
    // A timeline with no text track bailed out above this useMemo, so the
    // first render that had one called an extra hook and threw React error
    // #310, unmounting the player into a blank dark frame. A short preview
    // adds track-short-title (type 'text') for the hook headline, so this
    // fired together with the overlay one every time a short was previewed.
    const hasActiveMatte = React.useMemo(() => {
        const vidClips = tracks.filter(t => t.type === 'video' || t.type === 'image').flatMap(t => t.clips || []);
        return vidClips.some(c => c.layerTarget === 'background' && c.layerMask && currentTime >= c.start && currentTime < c.start + c.duration);
    }, [tracks, currentTime]);

    const textTracks = tracks.filter(t => t.type === 'text');
    if (textTracks.length === 0) return null;

    const activeTextClips = textTracks.flatMap(track =>
        track.clips.filter(clip => {
            if (!(currentTime >= clip.start && currentTime < clip.start + clip.duration)) return false;
            const isSandwich = clip.placement === 'behind_subject' || clip.placement === 'behind_speaker';
            if (placementFilter === 'behind_subject') return isSandwich;
            if (placementFilter === 'front') return hasActiveMatte ? !isSandwich : true;
            return true;
        })
    );
    if (activeTextClips.length === 0) return null;

    const allTracks = tracks;

    const getTrackForClip = (clipId) =>
        allTracks.find(t => t.clips.some(c => c.id === clipId));

    // ── Unified pointer handler (drag; resize is the corner handle below) ──
    // We use pointer events so the same code handles both mouse and touch.
    // `touch-action: none` on the element prevents the browser from stealing
    // the touch sequence before our handler can call setPointerCapture.
    // R119: pinch-to-scale was removed — resize is now ONLY the corner
    // handle, so a second finger landing here is tracked for bookkeeping
    // but no longer starts a scale gesture. `primaryPointerId` pins the
    // drag to whichever pointer started it.

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
            state.primaryPointerId = e.pointerId;
            state.dragStartX    = e.clientX;
            state.dragStartY    = e.clientY;
            // R92: start where the element is DRAWN ('bottom' captions sit at
            // 85 %), not at 50/50, so the first drag no longer jumps.
            const startPos      = startPosition(clip);
            state.initialClipX  = startPos.x;
            state.initialClipY  = startPos.y;
            state.mode          = 'drag';
            // Snap context: this element's size and the other elements, measured once.
            {
                const fr = containerRef.current?.getBoundingClientRect();
                const own = clipElRefs.current[clip.id]?.getBoundingClientRect();
                state.snap = fr && fr.width > 0 ? {
                    frameW: fr.width, frameH: fr.height,
                    w: own ? (own.width / fr.width) * 100 : 0,
                    h: own ? (own.height / fr.height) * 100 : 0,
                    others: measureOthers(containerRef.current, clip.id),
                } : null;
            }
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
        }
        // A second finger landing on the clip is tracked (so pointerUp's
        // bookkeeping stays correct) but intentionally does nothing else —
        // resize only happens via the corner handle now (R119).
    };

    const handlePointerMove = (e, clip) => {
        e.stopPropagation();

        const gs = gestureRef.current;
        const state = gs[clip.id];
        if (!state || !state.pointers[e.pointerId]) return;

        // Update tracked position for this pointer
        state.pointers[e.pointerId] = { clientX: e.clientX, clientY: e.clientY };
        // Only the pointer that started the drag drives it — a second
        // finger resting on the clip must not hijack dragStartX/Y.
        if (e.pointerId !== state.primaryPointerId) return;

        const track = getTrackForClip(clip.id);
        if (!track) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        // liveOnly: mid-gesture we touch ONLY the dragged clip, even in global
        // scope. Fanning out to every caption on each pointermove would mean N
        // store writes per pixel of travel. The real fan-out is committed once,
        // on pointer-up (see handlePointerUp), which is also what makes the
        // whole gesture a single undo entry.
        if (state.mode === 'drag') {
            // Single-finger drag: reposition
            const deltaX = e.clientX - state.dragStartX;
            const deltaY = e.clientY - state.dragStartY;
            const deltaXPct = (deltaX / rect.width)  * 100;
            const deltaYPct = (deltaY / rect.height) * 100;
            const rawX = state.initialClipX + deltaXPct;
            const rawY = state.initialClipY + deltaYPct;
            // R92: snap to the frame centre, thirds, safe margins and other
            // elements (Alt / Option drags freely).
            const snapped = state.snap
                ? computeSnap({ x: rawX, y: rawY, w: state.snap.w, h: state.snap.h },
                    { others: state.snap.others, aspectRatio, frameW: state.snap.frameW, frameH: state.snap.frameH, disabled: e.altKey })
                : { x: rawX, y: rawY, guides: [] };
            useSnapGuides.getState().setGuides(snapped.guides);
            const newX = snapped.x;
            const newY = snapped.y;
            state.pendingUpdate = { x: newX, y: newY };
            applyCaptionUpdate({ x: newX, y: newY }, { clipId: clip.id, skipHistory: true, liveOnly: true });
            // R66 — drag the rest of the group (e.g. a LowerThird's
            // background bar, on a different track) along with the text.
            // Plain updateClip, not applyCaptionUpdate — a bar isn't a
            // caption and has no global/individual scope of its own.
            if (state.groupMembers) {
                for (const m of state.groupMembers) {
                    updateClip(m.trackId, m.clipId, { x: m.initialX + (newX - state.initialClipX), y: m.initialY + (newY - state.initialClipY) }, { skipHistory: true });
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
            useSnapGuides.getState().clear();
            // All fingers lifted — clean up
            delete gs[clip.id];
        }
    };

    // ── Resize gesture — corner handles (R119) ─────────────────────────────
    // Delegated to the shared <ResizeHandle/> (see ResizeHandle.jsx /
    // resizeGesture.js) instead of a bespoke per-file implementation, the
    // same way RotateHandle is already shared below. liveOnly mid-drag (one
    // write per move), real scope (global/individual) on release — same
    // two-phase commit the pointer drag above uses.

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
        <div ref={containerRef} className={`absolute inset-0 pointer-events-none overflow-hidden ${placementFilter === 'behind_subject' ? 'z-[2]' : 'z-10'}`}>
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
                const emphasis = resolveEmphasis(clip);
                const needsWordRender =
                    (Array.isArray(clip.words) && clip.words.length > 0 && highlight && highlight.mode !== 'none')
                    || motion.reveal < 1
                    || !!emphasis;

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
                        ref={(el) => { if (el) clipElRefs.current[clip.id] = el; else delete clipElRefs.current[clip.id]; }}
                        data-snap-id={clip.id}
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
                                  baseColor={clip.color || '#ffffff'}
                                  content={content}
                                  words={clip.words}
                                  time={currentTime}
                                  reveal={motion.reveal}
                                  highlight={highlight}
                                  emphasis={emphasis}
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

                        {isActive && (
                            <ResizeHandle
                                getElement={() => clipElRefs.current[clip.id]}
                                scale={Number(clip.scale) || 1}
                                onStart={() => saveToHistory()}
                                onLive={(s) => applyCaptionUpdate({ scale: s }, { clipId: clip.id, skipHistory: true, liveOnly: true })}
                                onCommit={(s) => applyCaptionUpdate({ scale: s }, { clipId: clip.id, skipHistory: true })}
                            />
                        )}

                        {/* Rotate handle (A3) — edits clip.rotation, the layer's base
                            rotation; animated presets still add on top of it. Same
                            two-phase commit as resize: live on the dragged clip,
                            real scope (global/individual) on release. */}
                        {isActive && (
                            <RotateHandle
                                getElement={() => clipElRefs.current[clip.id]}
                                rotation={Number(clip.rotation) || 0}
                                onStart={() => saveToHistory()}
                                onLive={(deg) => applyCaptionUpdate({ rotation: deg }, { clipId: clip.id, skipHistory: true, liveOnly: true })}
                                onCommit={(deg) => applyCaptionUpdate({ rotation: deg }, { clipId: clip.id, skipHistory: true })}
                            />
                        )}

                    </div>
                );
            })}
        </div>
    );
};

export default TextOverlay;
