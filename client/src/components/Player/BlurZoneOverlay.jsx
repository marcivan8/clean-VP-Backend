import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import { hasBlurZone } from '../../motion/ZoneBlur.js';

/**
 * client/src/components/Player/BlurZoneOverlay.jsx
 *
 * R99 — freeform zone blur (stickers were R97, generic shadows R98; this
 * is the third and last of the three missing editing features Marc
 * picked). Blurs a STATIC rectangle of a clip's own frame -- a logo, a
 * phone screen, a stray face in the background, anything MatteBaker.js's
 * person segmentation (R92) was never built to find. Deliberately not a
 * tracked region: Marc did not pick "object tracking beyond people" among
 * the options he approved.
 *
 * clip.blurZone = { x, y, w, h, blur } in FRAME FRACTIONS, same convention
 * ZoneBlur.js documents (shared with the export's filter-graph builder).
 *
 * Rendered as a `backdrop-filter: blur()` div sitting directly over the
 * editor's video output. Text/overlay tracks are already excluded from the
 * Revideo scene and drawn as DOM siblings instead (see IDELayout.jsx's
 * playerVariables comment: "would cause duplicate captions AND make every
 * text-clip mutation reload the scene generator"); this component is
 * mounted the same way, right below <TextOverlay>/<GraphicOverlay
 * placementFilter="front">, so editing a blur zone never reloads the
 * Revideo scene either. A `backdrop-filter` blurs whatever renders BEHIND
 * this div -- the video frame -- without touching the WebGL/Revideo
 * pipeline at all, the same reason GraphicOverlay/TextOverlay are plain
 * DOM layers rather than baked into the scene.
 *
 * Export's equivalent is ZoneBlur.js's zoneBlurFilterGraph (split the
 * composed frame, crop+blur one copy to the same box, overlay it back),
 * loaded by jobs/exportProcessor.js the same way it already loads
 * MatteSettings.js -- "preview and export read the same numbers" is the
 * same rule MatteSettings.js's own header documents.
 */
export default function BlurZoneOverlay() {
    const { currentTime, tracks } = useTimelineStore(useShallow(state => ({
        currentTime: state.currentTime,
        tracks: state.tracks,
    })));

    const activeZones = React.useMemo(() => {
        const t = Number(currentTime) || 0;
        const clips = (tracks || [])
            .filter(tr => tr.type === 'video' || tr.type === 'image' || tr.type === 'overlay')
            .flatMap(tr => tr.clips || []);
        return clips.filter(c => hasBlurZone(c)
            && t >= (Number(c.start) || 0)
            && t < (Number(c.start) || 0) + (Number(c.duration) || 0));
    }, [tracks, currentTime]);

    if (activeZones.length === 0) return null;

    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-[3]" aria-hidden="true">
            {activeZones.map(clip => {
                const z = clip.blurZone;
                const blurPx = Math.max(0, Number(z.blur) || 0);
                return (
                    <div
                        key={clip.id}
                        style={{
                            position: 'absolute',
                            left: `${z.x * 100}%`,
                            top: `${z.y * 100}%`,
                            width: `${z.w * 100}%`,
                            height: `${z.h * 100}%`,
                            // Raw CSS px, same convention clip.shadow's dx/dy/blur
                            // (R98) established: the preview uses literal px (no
                            // resolution scaling), only the export scales by
                            // frame.width/1080 (ZoneBlur.js's zoneBlurFilterGraph).
                            backdropFilter: `blur(${blurPx}px)`,
                            WebkitBackdropFilter: `blur(${blurPx}px)`,
                        }}
                    />
                );
            })}
        </div>
    );
}
