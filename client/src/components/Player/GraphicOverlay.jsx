import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
// R62 — Graphics/Overlay track. Same motion engine as captions (R58): a
// GraphicOverlay clip is a MotionLayer view (see motion/ClipAdapter) resolved
// through the SAME resolveMotionAt() that drives TextOverlay and the
// compositor's export-side geometry sampling (motion/Compositor.js). One
// resolver, three consumers — the whole point of building it as a pure
// function instead of a component method (see MotionResolver.js header).
import { clipToMotionLayer } from '../../motion/ClipAdapter.js';
import { resolveMotionAt }   from '../../motion/MotionResolver.js';
// R66 — clip grouping. A LowerThird's background bar lives on THIS track
// but its title lives on the 'text' track; `clipsInGroup` looks across ALL
// tracks (not just this component's own 'overlay' ones) so dragging the bar
// drags its grouped text along with it. See ClipGrouping.js's header for
// why a group is just clips sharing `clip.groupId`, not a new entity type.
import { clipsInGroup } from '../../motion/ClipGrouping.js';

// Must match DEFAULT_WIDTH_FRACTION in motion/Compositor.js's resolveGeometry.
// The export computes an overlay's on-screen size as 25% of frame width times
// clip.scale; the preview needs the identical constant or a sticker would be
// framed differently in the editor than in the exported video — exactly the
// preview/export divergence this whole engine exists to prevent.
const DEFAULT_WIDTH_FRACTION = 25; // as a CSS percent

const pointerDist = (a, b) =>
    Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

const GraphicOverlay = () => {
    const containerRef = React.useRef(null);
    const gestureRef = React.useRef({});

    const { currentTime, tracks, activeClipId, updateClip, setActiveClip, saveToHistory } = useTimelineStore(useShallow(state => ({
        currentTime:   state.currentTime,
        tracks:        state.tracks,
        activeClipId:  state.activeClipId,
        updateClip:    state.updateClip,
        setActiveClip: state.setActiveClip,
        saveToHistory: state.saveToHistory,
    })));

    const overlayTracks = tracks.filter(t => t.type === 'overlay');
    if (overlayTracks.length === 0) return null;

    const activeClips = overlayTracks.flatMap(track =>
        track.clips
            .filter(clip => currentTime >= clip.start && currentTime < clip.start + clip.duration)
            .map(clip => ({ clip, trackId: track.id }))
    );
    if (activeClips.length === 0) return null;

    const handlePointerDown = (e, clip, trackId) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setActiveClip(clip.id);

        const gs = gestureRef.current;
        if (!gs[clip.id]) gs[clip.id] = { pointers: {} };
        const state = gs[clip.id];
        state.pointers[e.pointerId] = { clientX: e.clientX, clientY: e.clientY };
        const pointerCount = Object.keys(state.pointers).length;

        if (pointerCount === 1) {
            saveToHistory();
            state.dragStartX   = e.clientX;
            state.dragStartY   = e.clientY;
            state.initialClipX = typeof clip.x === 'number' ? clip.x : 78;
            state.initialClipY = typeof clip.y === 'number' ? clip.y : 18;
            state.mode         = 'drag';
            state.trackId      = trackId;
            // R66 — snapshot every group member's OWN starting x/y (across
            // ALL tracks, not just this one) once, up front — the same
            // "capture initial, then add delta" shape the single-clip case
            // already uses just below, so neither path drifts from a stale
            // closure read mid-gesture. Always includes the dragged clip
            // itself, so one loop in handlePointerMove covers everyone.
            state.groupMembers = clip.groupId
                ? clipsInGroup(tracks, clip.groupId).map(({ trackId: tId, clip: c }) => ({
                    trackId: tId, clipId: c.id,
                    initialX: typeof c.x === 'number' ? c.x : 78,
                    initialY: typeof c.y === 'number' ? c.y : 18,
                }))
                : null;
        } else if (pointerCount === 2) {
            saveToHistory();
            const pts = Object.values(state.pointers);
            state.initialDist  = pointerDist(pts[0], pts[1]);
            state.initialScale = clip.scale || 1;
            state.mode         = 'pinch';
            state.trackId      = trackId;
        }
    };

    const handlePointerMove = (e, clip) => {
        e.stopPropagation();
        const gs = gestureRef.current;
        const state = gs[clip.id];
        if (!state || !state.pointers[e.pointerId]) return;
        state.pointers[e.pointerId] = { clientX: e.clientX, clientY: e.clientY };

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        if (state.mode === 'pinch' && Object.keys(state.pointers).length === 2) {
            const pts = Object.values(state.pointers);
            const ratio = pointerDist(pts[0], pts[1]) / (state.initialDist || 1);
            const newScale = Math.max(0.1, Math.min(5, state.initialScale * ratio));
            // skipHistory here: one undo step per whole drag/pinch gesture, not
            // one per pointermove — matches TextOverlay's drag behaviour.
            // pointerup does not commit again; updateClip has no liveOnly/global
            // concept the way applyCaptionUpdate does (a sticker never fans out
            // to "every sticker"), so the last live write during the gesture IS
            // the committed value.
            updateClip(state.trackId, clip.id, { scale: newScale }, { skipHistory: true });
        } else if (state.mode === 'drag') {
            const deltaX = e.clientX - state.dragStartX;
            const deltaY = e.clientY - state.dragStartY;
            const deltaXPct = (deltaX / rect.width)  * 100;
            const deltaYPct = (deltaY / rect.height) * 100;
            if (state.groupMembers) {
                // R66 — grouped drag: every member (this clip included) moves
                // by the SAME percent delta from ITS OWN starting position.
                for (const m of state.groupMembers) {
                    updateClip(m.trackId, m.clipId, { x: m.initialX + deltaXPct, y: m.initialY + deltaYPct }, { skipHistory: true });
                }
            } else {
                const newX = state.initialClipX + deltaXPct;
                const newY = state.initialClipY + deltaYPct;
                updateClip(state.trackId, clip.id, { x: newX, y: newY }, { skipHistory: true });
            }
        }
    };

    const handlePointerUp = (e, clip) => {
        e.stopPropagation();
        const gs = gestureRef.current;
        const state = gs[clip.id];
        if (!state) return;
        delete state.pointers[e.pointerId];
        if (Object.keys(state.pointers).length === 0) delete gs[clip.id];
    };

    return (
        <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden z-10">
            {activeClips.map(({ clip, trackId }) => {
                const isActive = clip.id === activeClipId;

                const layer = clipToMotionLayer(clip, { id: trackId, type: 'overlay' });
                const motion = layer
                    ? resolveMotionAt(layer, currentTime)
                    : { x: clip.x ?? 78, y: clip.y ?? 18, scale: clip.scale || 1, rotation: 0, opacity: clip.opacity ?? 1, blur: 0 };

                const src = clip.url || clip.sourceUrl;
                if (!src) return null;

                const transform = [
                    'translate(-50%, -50%)',
                    motion.rotation ? `rotate(${motion.rotation}deg)` : '',
                ].filter(Boolean).join(' ');

                return (
                    <img
                        key={clip.id}
                        src={src}
                        alt={clip.name || 'overlay'}
                        draggable={false}
                        onPointerDown={(e) => handlePointerDown(e, clip, trackId)}
                        onPointerMove={(e) => handlePointerMove(e, clip)}
                        onPointerUp={(e)   => handlePointerUp(e, clip)}
                        onPointerCancel={(e) => handlePointerUp(e, clip)}
                        className={`absolute select-none origin-center ${isActive ? 'ring-1 ring-primary ring-offset-1 ring-offset-transparent' : ''}`}
                        style={{
                            left: `${motion.x}%`,
                            top: `${motion.y}%`,
                            width: `${DEFAULT_WIDTH_FRACTION * (Number.isFinite(motion.scale) ? motion.scale : 1)}%`,
                            height: 'auto',
                            transform,
                            opacity: motion.opacity,
                            ...(motion.blur > 0 ? { filter: `blur(${motion.blur}px)` } : {}),
                            pointerEvents: 'auto',
                            touchAction: 'none',
                            cursor: 'move',
                        }}
                    />
                );
            })}
        </div>
    );
};

export default GraphicOverlay;
