import { useShallow } from 'zustand/react/shallow';
import React from 'react';
import { useTranslation } from 'react-i18next';
import Track from './Track';
import useTimelineStore from '../../store/useTimelineStore';
import useDeviceType from '../../hooks/useDeviceType';
import { TRANSITION_TYPES, TRANSITION_DEFAULT_DURATION } from '../../motion/TransitionFX.js';
import { Scissors, ZoomIn, ZoomOut, Copy, Type, Palette, Undo2, Redo2, ChevronsRight, Magnet, ChevronLeft, ChevronRight } from 'lucide-react';

const RULER_H    = 24;   // h-6 = 24px (ruler height)
const LABEL_W         = 128; // w-32 = 128px (track label column) — desktop
// On a 375-430px phone, a 128px label column eats ~30-34% of the width before
// any clip is even visible. Narrower on mobile gives the actual clips (the
// thing being edited) most of the screen. This value is threaded through every
// place that used to assume the fixed 128px (ruler placeholder, playhead math,
// content width, and Track's own header column via a prop) — changing it here
// alone is not enough, see the `labelW` usages below and in Track.jsx.
const LABEL_W_MOBILE  = 36; // icon strip only (Track.jsx TrackStrip); track options open from the icon
const EDGE_ZONE  = 60;   // px from edge that triggers auto-scroll
const SCROLL_SPD = 10;   // base px/frame; scales with proximity to edge

const Timeline = () => {
    const { t } = useTranslation('editor');
    const { isMobile } = useDeviceType();
    const labelW = isMobile ? LABEL_W_MOBILE : LABEL_W;
    const { tracks, duration, zoomLevel, seek, setZoomLevel, undo, redo, past, future, mainTrackMagnet, setMainTrackMagnet } = useTimelineStore(useShallow(state => ({
        mainTrackMagnet:    state.mainTrackMagnet,
        setMainTrackMagnet: state.setMainTrackMagnet,
        tracks:      state.tracks,
        duration:    state.duration,
        zoomLevel:   state.zoomLevel,
        seek:        state.seek,
        setZoomLevel: state.setZoomLevel,
        undo:        state.undo,
        redo:        state.redo,
        past:        state.past,
        future:      state.future,
    })));

    // Hoisted out of the toolbar JSX: that row is not rendered on mobile, and a
    // hook inside conditionally-rendered JSX would change the hook order.
    const aspectRatio = useTimelineStore(state => state.aspectRatio);
    const timeDisplayRef = React.useRef(null);
    const playheadLineRef = React.useRef(null);
    const playheadHandleRef = React.useRef(null);

    // Rubber-band multi-select
    const tracksAreaRef = React.useRef(null);
    const selDragRef = React.useRef(null);
    const [selBox, setSelBox] = React.useState(null);

    // Scroll hint: show briefly when horizontal content overflows
    const [showScrollHint, setShowScrollHint] = React.useState(false);
    React.useEffect(() => {
        const el = tracksAreaRef.current;
        if (!el) return;
        const timer = setTimeout(() => {
            const canScroll = el.scrollWidth > el.clientWidth + 4;
            if (canScroll) {
                setShowScrollHint(true);
                setTimeout(() => setShowScrollHint(false), 3000);
            }
        }, 800);
        return () => clearTimeout(timer);
    }, [tracks.length]);

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
        if (localX < labelW) return; // in label column

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
            useTimelineStore.getState().seek(Math.max(0, (cur.x - labelW) / zl));
        };

        // Edge-scroll loop: runs every animation frame while cursor is in the edge zone
        const scrollTick = () => {
            const areaRect = area.getBoundingClientRect();
            const relX     = cursorX - areaRect.left;
            let   delta    = 0;

            if (relX < labelW + EDGE_ZONE) {
                // Left edge — the closer to the label column, the faster
                const proximity = Math.max(0, relX - labelW) / EDGE_ZONE; // 0 = very left, 1 = edge zone boundary
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
                const tStart = Math.max(0, (x1 - labelW) / zl);
                const tEnd   = (x2 - labelW) / zl;

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
                // A click on empty track space seeks directly. Keep this in the
                // same coordinate system as the ruler, including horizontal
                // scrolling and the track label column.
                const area = tracksAreaRef.current;
                if (area) {
                    const rect = area.getBoundingClientRect();
                    const x = me.clientX - rect.left + area.scrollLeft - labelW;
                    const { zoomLevel, duration, playerRef } = useTimelineStore.getState();
                    const fps = Number(playerRef?.playback?.fps) || 30;
                    const time = Math.max(0, Math.min(duration, x / (zoomLevel || 1)));
                    useTimelineStore.getState().seek(Math.round(time * fps) / fps);
                }
                useTimelineStore.getState().clearSelection();
            }

            selDragRef.current = null;
            setSelBox(null);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [getContentPos, labelW]);

    // ── Mobile pinch-to-zoom ─────────────────────────────────────────────────────
    // Without this, the browser intercepts 2-finger pinches anywhere on the page
    // and zooms the entire viewport instead of the timeline.
    // We attach non-passive listeners so we can call preventDefault() on pinch
    // starts, then drive zoomLevel ourselves from the finger distance ratio.
    React.useEffect(() => {
        const el = tracksAreaRef.current;
        if (!el) return;

        let pinchStartDist = null;
        let pinchStartZoom = null;

        const dist = (touches) => {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.hypot(dx, dy);
        };

        const onTouchStart = (e) => {
            if (e.touches.length === 2) {
                // Prevent the browser from stealing this as a page-zoom gesture
                e.preventDefault();
                pinchStartDist = dist(e.touches);
                pinchStartZoom = useTimelineStore.getState().zoomLevel;
            }
        };

        const onTouchMove = (e) => {
            if (e.touches.length === 2 && pinchStartDist !== null) {
                e.preventDefault();
                const scale   = dist(e.touches) / pinchStartDist;
                const newZoom = Math.max(2, Math.min(300, pinchStartZoom * scale));
                useTimelineStore.getState().setZoomLevel(newZoom);
            }
        };

        const onTouchEnd = (e) => {
            if (e.touches.length < 2) {
                pinchStartDist = null;
                pinchStartZoom = null;
            }
        };

        // { passive: false } is required — passive listeners cannot call preventDefault()
        el.addEventListener('touchstart', onTouchStart, { passive: false });
        el.addEventListener('touchmove',  onTouchMove,  { passive: false });
        el.addEventListener('touchend',   onTouchEnd);
        el.addEventListener('touchcancel', onTouchEnd);

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove',  onTouchMove);
            el.removeEventListener('touchend',   onTouchEnd);
            el.removeEventListener('touchcancel', onTouchEnd);
        };
    }, []);
    // ─────────────────────────────────────────────────────────────────────────────

    // Kept in sync every render so the RAF loop below (which mounts once with an
    // empty dependency array) always reads the CURRENT label width — without
    // this, resizing across the mobile/desktop breakpoint after mount would
    // leave the playhead line offset by a stale value until a full remount.
    const labelWRef = React.useRef(labelW);
    React.useEffect(() => { labelWRef.current = labelW; }, [labelW]);

    // The playhead's horizontal position is written imperatively here (not
    // through React state) so it can move at 60fps without re-rendering the
    // whole timeline. That only works if React never ALSO manages `left` on
    // these same two elements: previously both playhead divs' JSX also
    // carried a `style={{ left: ... }}`, and any unrelated re-render of this
    // component (zoom change, a track mutating e.g. from a live waveform
    // update during playback, selection, scrolling) made React reconcile
    // that inline style back to its stale render-time value, snapping the
    // playhead back toward the timeline start for one frame before this
    // loop corrected it back on the next -- the intermittent "flicker".
    // Fix: `left` is no longer part of either element's React-managed style
    // (see the JSX below) -- this effect is now the ONLY writer of it, ever.
    // useLayoutEffect (not useEffect) so the first position is painted
    // synchronously, with no one-frame flash at mount while waiting for the
    // first requestAnimationFrame callback.
    // R108 — the last time this loop drew, so the view only follows the
    // playhead when the playhead actually MOVED. Without that test, every
    // frame would rewrite scrollLeft and the user could never scroll away
    // from the playhead to look at another part of the timeline.
    const lastDrawnTimeRef = React.useRef(null);

    React.useLayoutEffect(() => {
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
                playheadLineRef.current.style.left = `${labelWRef.current + px}px`;
            }
            if (playheadHandleRef.current && !isNaN(px)) {
                playheadHandleRef.current.style.left = `${px}px`;
            }

            // R108 — keep the playhead in view.
            //
            // The position above is written in CONTENT coordinates, inside a
            // container that scrolls. Nothing ever scrolled it, so once the
            // playhead passed the right edge it simply left the screen: during
            // playback it vanished, and stepping frame by frame past that point
            // moved a playhead nobody could see. The frame-step shortcut was
            // not broken — the view just never followed it.
            //
            // Only on a real move, so a user who scrolls away while paused is
            // left alone. No smooth scrolling: this runs every frame during
            // playback, and an animated scroll would lag a frame behind itself.
            const area = tracksAreaRef.current;
            const moved = lastDrawnTimeRef.current === null || Math.abs(time - lastDrawnTimeRef.current) > 1e-6;
            if (area && moved && !isNaN(px)) {
                const contentX = labelWRef.current + px;
                const view = area.clientWidth;
                // A margin, so the playhead is never pinned to the very edge
                // with no sight of what it is about to reach.
                const margin = Math.min(140, Math.max(48, view * 0.12));
                if (contentX < area.scrollLeft + margin) {
                    area.scrollLeft = Math.max(0, contentX - margin);
                } else if (contentX > area.scrollLeft + view - margin) {
                    area.scrollLeft = contentX - view + margin;
                }
            }
            lastDrawnTimeRef.current = time;

            rafId = requestAnimationFrame(updatePlayhead);
        };
        updatePlayhead();
        return () => cancelAnimationFrame(rafId);
    }, []);

    // Keyboard Shortcuts
    const handleKeyDown = React.useCallback((e) => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

        const { activeClipId, tracks, deleteClipWithMagnet, splitClip, copyClip, pasteClip, currentTime } = useTimelineStore.getState();

        // Delete — closes the gap on the main video track when the magnet is on
        if (e.key === 'Backspace' || e.key === 'Delete') {
            if (activeClipId) {
                const track = tracks.find(t => t.clips.find(c => c.id === activeClipId));
                if (track) deleteClipWithMagnet(track.id, activeClipId);
            }
        }

        // Undo (Cmd+Z)
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            useTimelineStore.getState().undo();
        }

        // Redo (Cmd+Shift+Z)
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
            e.preventDefault();
            useTimelineStore.getState().redo();
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

    // Frame-accurate seek calculation from ruler element and clientX
    const seekFromRulerX = React.useCallback((rulerEl, clientX) => {
        if (!rulerEl) return;
        const rect = rulerEl.getBoundingClientRect();
        const x = clientX - rect.left;
        const zl = useTimelineStore.getState().zoomLevel;
        const dur = useTimelineStore.getState().duration;
        const fps = Number(useTimelineStore.getState().playerRef?.playback?.fps) || 30;
        const t = Math.max(0, Math.min(dur, x / zl));
        seek(Math.round(t * fps) / fps);
    }, [seek]);

    const handleRulerMouseDown = React.useCallback((e) => {
        if (e.button !== 0) return;
        const rulerEl = e.currentTarget;
        seekFromRulerX(rulerEl, e.clientX);

        const onMouseMove = (me) => {
            seekFromRulerX(rulerEl, me.clientX);
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [seekFromRulerX]);

    // Touch-seek: tap or drag a single finger on the ruler to scrub
    const handleRulerTouchStart = React.useCallback((e) => {
        if (e.touches.length !== 1) return;
        e.preventDefault(); // prevent scroll while scrubbing ruler
        seekFromRulerX(e.currentTarget, e.touches[0].clientX);
    }, [seekFromRulerX]);

    const handleRulerTouchMove = React.useCallback((e) => {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        seekFromRulerX(e.currentTarget, e.touches[0].clientX);
    }, [seekFromRulerX]);


    return (
        <div className="flex-1 bg-transparent flex flex-col relative h-full select-none" onKeyDown={handleKeyDown} tabIndex={0}>
            {/* Toolbar — horizontally scrollable so nothing is silently clipped.
                This row (undo/redo, split, duplicate, text overlay, transition/
                filter/aspect-ratio/speed selects, zoom controls) is rendered
                identically on mobile and desktop, but on mobile the timeline's
                parent wrapper has overflow-hidden (IDELayout's h-36 container) —
                without its own scroll, every control past a phone's ~375-430px
                width was invisible and unreachable with no indication anything
                was missing. On desktop this scrolls only if the window is
                genuinely narrower than the content, so nothing changes there. */}
            {/* Mobile: this row is replaced by MobileTransportBar (undo/redo,
                time, More: aspect ratio, zoom, text, transition, filter) and the
                clip toolbar (split, duplicate, speed) — see IDELayout. */}
            {!isMobile && (
            <div
                className="h-10 border-b flex items-center px-4 justify-between z-20 shrink-0 overflow-x-auto custom-scrollbar"
                style={{ background: "var(--glass)", borderColor: "var(--line-soft)", WebkitOverflowScrolling: 'touch' }}
            >
                <div className="flex items-center gap-4 shrink-0">
                    <span ref={timeDisplayRef} className="text-xs w-16 text-center studio-mono-label shrink-0" style={{ color: "var(--accent)" }}>0.00s</span>

                    {/* R108 — frame step. The ←/→ shortcut existed and nothing
                        on screen said so, which is the same reason the panel
                        tabs went unnoticed: a feature nobody can see is a
                        feature nobody has. The tooltip names the key. */}
                    <div className="flex items-center shrink-0">
                        <button
                            className="p-1 rounded group transition-colors hover:bg-white/5"
                            title={t('timeline.stepBack')}
                            aria-label={t('timeline.stepBack')}
                            onClick={() => useTimelineStore.getState().stepFrames(-1)}
                        >
                            <ChevronLeft className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                        </button>
                        <button
                            className="p-1 rounded group transition-colors hover:bg-white/5"
                            title={t('timeline.stepForward')}
                            aria-label={t('timeline.stepForward')}
                            onClick={() => useTimelineStore.getState().stepFrames(1)}
                        >
                            <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                        </button>
                    </div>

                    <div className="h-4 w-px mx-2" style={{ background: "var(--line-soft)" }}></div>
                    {/* Undo / Redo */}
                    <button
                        className="p-1 rounded group transition-colors hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={t('timeline.undo')}
                        disabled={!past?.length}
                        onClick={() => undo()}
                    >
                        <Undo2 className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                    </button>
                    <button
                        className="p-1 rounded group transition-colors hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={t('timeline.redo')}
                        disabled={!future?.length}
                        onClick={() => redo()}
                    >
                        <Redo2 className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                    </button>
                    {/* Main-track magnet — desktop only (always on for mobile) */}
                    {!isMobile && (
                        <button
                            className={`p-1 rounded group transition-colors hover:bg-white/5 ${mainTrackMagnet ? 'bg-primary/10' : ''}`}
                            title={mainTrackMagnet ? t('timeline.mainTrackMagnetOn') : t('timeline.mainTrackMagnetOff')}
                            aria-pressed={mainTrackMagnet}
                            onClick={() => setMainTrackMagnet(!mainTrackMagnet)}
                        >
                            <Magnet className={`w-3 h-3 ${mainTrackMagnet ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
                        </button>
                    )}
                    <div className="h-4 w-px mx-2" style={{ background: "var(--line-soft)" }}></div>
                    <button
                        className="p-1 rounded relative group transition-colors hover:bg-white/5"
                        title={t('timeline.splitClipShortcut')}
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
                        title={t('timeline.duplicateClipShortcut')}
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
                        title={t('timeline.addTextOverlay')}
                        onClick={() => {
                            useTimelineStore.getState().addTextOverlay(t('timeline.newTextDefault'), 'center', 5, 'default');
                        }}
                    >
                        <Type className="w-3 h-3 text-muted-foreground group-hover:text-primary" />
                    </button>

                    <select
                        className="text-[10px] text-muted-foreground rounded px-1 py-0.5 border-none outline-none cursor-pointer hover:bg-white/10"
                        style={{ background: "var(--glass-2)", fontFamily: "var(--f-mono)" }}
                        title={t('timeline.addTransition')}
                        value=""
                        onChange={(e) => {
                            const type = e.target.value;
                            if (!type) return;
                            const { activeClipId, addTransition } = useTimelineStore.getState();
                            if (activeClipId) addTransition(activeClipId, type, TRANSITION_DEFAULT_DURATION[type] || 0.4);
                            e.target.value = "";
                        }}
                    >
                        <option value="">+ {t('timeline.transition')}</option>
                        {TRANSITION_TYPES.map(type => (
                            <option key={type} value={type}>{t(`transitions.${type}`)}</option>
                        ))}
                    </select>

                    <button
                        className="p-1 rounded relative group transition-colors hover:bg-white/5"
                        title={t('timeline.addFilterCinematic')}
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
                        title={t('timeline.aspectRatio')}
                        value={aspectRatio}
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
                        title={t('timeline.playbackSpeed')}
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
                <div className="flex items-center gap-2 shrink-0 ml-4">
                    <button onClick={() => setZoomLevel(zoomLevel * 0.8)} className="group"><ZoomOut className="w-3 h-3 text-muted-foreground group-hover:text-foreground" /></button>
                    <div className="w-20 h-1 rounded-full overflow-hidden relative" style={{ background: "var(--glass-2)" }}>
                        <div className="absolute inset-y-0 left-0 bg-primary/50 w-full" style={{ width: '50%' }}></div>
                    </div>
                    <button onClick={() => setZoomLevel(zoomLevel * 1.2)} className="group"><ZoomIn className="w-3 h-3 text-muted-foreground group-hover:text-foreground" /></button>
                </div>
            </div>

            )}

            {/* Tracks Area */}
            <div
                ref={tracksAreaRef}
                className="flex-1 overflow-auto relative custom-scrollbar flex flex-col"
                style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
                onMouseDown={handleTracksMouseDown}
                onScroll={() => setShowScrollHint(false)}
            >
                {/* Scroll hint — fades in briefly when horizontal content overflows */}
                {showScrollHint && (
                    <div
                        className="pointer-events-none absolute right-0 top-6 bottom-0 z-30 flex items-center pr-2"
                        style={{ width: 64, background: 'linear-gradient(to right, transparent, rgba(0,0,0,0.55))' }}
                    >
                        <ChevronsRight
                            className="w-4 h-4 ml-auto animate-pulse"
                            style={{ color: 'var(--accent)', opacity: 0.7 }}
                        />
                    </div>
                )}
                {/* Ruler */}
                <div className="flex h-6 border-b border-white/5 bg-black/20 sticky top-0 z-10 shrink-0">
                    <div className="border-r shrink-0" style={{ width: `${labelW}px`, borderColor: "var(--line-soft)", background: "var(--bg-2)" }}></div>
                    <div
                        className="flex-1 relative cursor-pointer"
                        style={{ width: `${duration * zoomLevel}px`, minWidth: '100%', touchAction: 'none' }}
                        onMouseDown={handleRulerMouseDown}
                        onTouchStart={handleRulerTouchStart}
                        onTouchMove={handleRulerTouchMove}
                    >
                        {/* Ruler ticks */}
                        {Array.from({ length: Math.ceil(duration / 5) }).map((_, i) => (
                            <div key={i} className="absolute top-0 bottom-0 border-l border-white/20 text-[9px] text-muted-foreground pl-1 pt-1 pointer-events-none select-none" style={{ left: `${i * 5 * zoomLevel}px` }}>
                                {formatTime(i * 5)}
                            </div>
                        ))}

                        {/* Beat Markers */}
                        {useTimelineStore.getState().beatMarkers && useTimelineStore.getState().beatMarkers.map((beatTime, idx) => (
                            <div
                                key={`beat-${idx}`}
                                className="absolute bottom-0 h-2 w-px bg-purple-500/80 pointer-events-none"
                                style={{ left: `${beatTime * zoomLevel}px` }}
                                title={t('timeline.beatN', { n: idx + 1 })}
                            />
                        ))}
                    </div>
                </div>

                {/* Vertical Playhead Line — full height, offset by the (responsive) label column width */}
                <div
                    ref={playheadLineRef}
                    className="absolute top-6 bottom-0 w-px bg-red-500 z-50 pointer-events-none"
                    // No `left` here -- the useLayoutEffect above is the only
                    // writer of this element's position (see its comment).
                />

                <div className="relative min-w-full" style={{ width: `calc(${labelW}px + ${duration * zoomLevel}px)` }}>
                    {/* Playhead handle (diamond) inside track area */}
                    <div
                        ref={playheadHandleRef}
                        className="absolute top-0 bottom-0 w-px bg-red-500 z-50 pointer-events-none"
                        // `left` is NOT set here -- the useLayoutEffect above is
                        // the only writer of it (see its comment). `marginLeft`
                        // stays React-managed: it only changes with the
                        // responsive label width, not every frame, so there is
                        // nothing for the playback loop to race against.
                        style={{ marginLeft: `${labelW}px` }}
                    >
                        <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-red-500 rotate-45 transform shadow-sm"></div>
                    </div>

                    {tracks.map(track => (
                        <Track key={track.id} track={track} labelWidth={labelW} compact={isMobile} />
                    ))}

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
