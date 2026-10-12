import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import { getPlayerDimensions } from '../../utils/playerDimensions.js';
import { baseClipScreenBox, screenDeltaToCanvasDelta } from '../../motion/BaseClipGeometry.js';
import ResizeHandle from './ResizeHandle.jsx';

/**
 * R100 — move/resize handles for a BASE video/image clip (the main track),
 * directly on the player screen. Until now only overlay-track clips
 * (GraphicOverlay.jsx) could be dragged or pinch-scaled in the preview; a
 * base clip's `x`/`y`/`scale` were already read by the live renderer
 * (client/src/revideo/project.tsx) but nothing in the UI ever wrote them.
 *
 * Mounted as a DOM sibling positioned `inset-0` over the exact same box as
 * the Revideo <Player> (see IDELayout.jsx), BELOW BlurZoneOverlay/TextOverlay/
 * GraphicOverlay in DOM order so overlay-track clips keep first claim on
 * pointer events — a base clip's drag surface only catches clicks that land
 * outside every overlay clip's own (smaller) box.
 *
 * IMPORTANT unit note (see BaseClipGeometry.js's header): base clips use
 * canvas-PIXEL x/y (centre-anchored), not the 0-100 PERCENT convention
 * overlay clips use — so the drag gesture here converts screen-pixel deltas
 * into canvas-pixel deltas before writing `clip.x`/`clip.y`. The resize
 * handle is unitless (`clip.scale`, same field and same meaning as overlay
 * clips) and needs no conversion — it is the exact same <ResizeHandle/>.
 */
const pointerDist = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

const BaseClipOverlay = () => {
    const containerRef = React.useRef(null);
    const gestureRef = React.useRef({});
    const clipElRefs = React.useRef({});

    const { currentTime, tracks, activeClipId, updateClip, setActiveClip, saveToHistory, aspectRatio } = useTimelineStore(useShallow(state => ({
        currentTime:   state.currentTime,
        tracks:        state.tracks,
        activeClipId:  state.activeClipId,
        updateClip:    state.updateClip,
        setActiveClip: state.setActiveClip,
        saveToHistory: state.saveToHistory,
        aspectRatio:   state.aspectRatio,
    })));

    const dims = getPlayerDimensions(aspectRatio);
    const videoTracks = tracks.filter(t => t.type === 'video');
    if (videoTracks.length === 0) return null;

    const activeClips = videoTracks.flatMap(track =>
        (track.clips || [])
            .filter(clip => (clip.type === 'video' || clip.type === 'image')
                && currentTime >= clip.start && currentTime < clip.start + clip.duration)
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
            state.initialClipX = Number(clip.x) || 0;
            state.initialClipY = Number(clip.y) || 0;
            state.mode          = 'drag';
            state.trackId       = trackId;
            state.containerRect = containerRef.current?.getBoundingClientRect() || null;
        } else if (pointerCount === 2) {
            saveToHistory();
            const pts = Object.values(state.pointers);
            state.initialDist  = pointerDist(pts[0], pts[1]);
            state.initialScale = Number(clip.scale) || 1;
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

        if (state.mode === 'pinch' && Object.keys(state.pointers).length === 2) {
            const pts = Object.values(state.pointers);
            const ratio = pointerDist(pts[0], pts[1]) / (state.initialDist || 1);
            const newScale = Math.max(0.1, Math.min(5, state.initialScale * ratio));
            updateClip(state.trackId, clip.id, { scale: newScale }, { skipHistory: true });
        } else if (state.mode === 'drag' && state.containerRect) {
            const { dx, dy } = screenDeltaToCanvasDelta({
                deltaScreenX: e.clientX - state.dragStartX,
                deltaScreenY: e.clientY - state.dragStartY,
                containerRect: state.containerRect,
                canvasWidth: dims.width,
                canvasHeight: dims.height,
            });
            updateClip(state.trackId, clip.id, { x: state.initialClipX + dx, y: state.initialClipY + dy }, { skipHistory: true });
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
        <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden z-[1]">
            {activeClips.map(({ clip, trackId }) => {
                const isActive = clip.id === activeClipId;
                const srcW = clip.metadata?.resolution?.w || clip.sourceWidth || dims.width;
                const srcH = clip.metadata?.resolution?.h || clip.sourceHeight || dims.height;
                const box = baseClipScreenBox({
                    clipX: clip.x, clipY: clip.y, scale: clip.scale,
                    srcW, srcH, canvasWidth: dims.width, canvasHeight: dims.height,
                });
                const rotation = Number(clip.rotation) || 0;
                const transform = ['translate(-50%, -50%)', rotation ? `rotate(${rotation}deg)` : ''].filter(Boolean).join(' ');
                const setRef = (el) => { if (el) clipElRefs.current[clip.id] = el; else delete clipElRefs.current[clip.id]; };

                return (
                    <div
                        key={clip.id}
                        ref={setRef}
                        onPointerDown={(e) => handlePointerDown(e, clip, trackId)}
                        onPointerMove={(e) => handlePointerMove(e, clip)}
                        onPointerUp={(e) => handlePointerUp(e, clip)}
                        onPointerCancel={(e) => handlePointerUp(e, clip)}
                        className={`absolute select-none origin-center ${isActive ? 'ring-1 ring-primary ring-offset-1 ring-offset-transparent' : ''}`}
                        style={{
                            left: `${box.leftPct}%`,
                            top: `${box.topPct}%`,
                            width: `${box.widthPct}%`,
                            // Height follows the media's own intrinsic aspect ratio
                            // (same technique GraphicOverlay.jsx uses) — there is
                            // nothing drawn here, this is purely a transparent
                            // drag/resize surface over the video the Player already
                            // renders underneath.
                            aspectRatio: srcW && srcH ? `${srcW} / ${srcH}` : undefined,
                            transform,
                            pointerEvents: 'auto',
                            touchAction: 'none',
                            cursor: 'move',
                        }}
                    >
                        {isActive && (
                            <ResizeHandle
                                getElement={() => clipElRefs.current[clip.id]}
                                scale={Number(clip.scale) || 1}
                                onStart={() => saveToHistory()}
                                onLive={(s) => updateClip(trackId, clip.id, { scale: s }, { skipHistory: true })}
                                onCommit={(s) => updateClip(trackId, clip.id, { scale: s }, { skipHistory: true })}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default BaseClipOverlay;
