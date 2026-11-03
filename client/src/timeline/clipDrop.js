import { computeDragSnap } from './dragSnap.js';

/** Convert the horizontal pointer delta into the timeline start for a clip drop. */
export function getClipDropStart({
    tracks,
    movingIds,
    clipStart,
    deltaX,
    zoomLevel,
    currentTime = null,
    snapThresholdPx = 12,
}) {
    const zoom = Number(zoomLevel) > 0 ? Number(zoomLevel) : 1;
    const { deltaSec } = computeDragSnap({
        tracks,
        movingIds,
        deltaSec: (Number(deltaX) || 0) / zoom,
        thresholdSec: Math.max(0, Number(snapThresholdPx) || 0) / zoom,
        currentTime,
    });
    return Math.max(0, (Number(clipStart) || 0) + deltaSec);
}

/**
 * Keep a clip's own moving drop target from masking the destination lane.
 * When available, pointer position is the clearest signal for vertical drops;
 * a real target clip wins over its containing track lane.
 */
export function createClipCollisionDetection({ pointerWithin, rectIntersection }) {
    return (args) => {
        const active = args?.active;
        const activeData = active?.data?.current;
        if (!activeData?.clip) {
            const pointerHits = pointerWithin(args);
            if (!pointerHits.length) return rectIntersection(args);
            if (activeData?.type === 'timeline-transition') {
                const cut = pointerHits.find(hit => hit.data?.droppableContainer?.data?.current?.type === 'transition-cut');
                if (cut) return [cut];
            }
            if (activeData?.type === 'timeline-effect') {
                const clip = pointerHits.find(hit => String(hit.id).startsWith('drop-clip-'));
                if (clip) return [clip];
            }
            return pointerHits;
        }

        const containers = args.droppableContainers.filter((container) => {
            if (container.id === `drop-clip-${active.id}`) return false;
            return Boolean(container.data?.current?.trackId);
        });
        const scopedArgs = { ...args, droppableContainers: containers };
        const pointerHits = pointerWithin(scopedArgs);
        if (pointerHits.length > 0) {
            const clipHit = pointerHits.find((hit) => String(hit.id).startsWith('drop-clip-'));
            return clipHit ? [clipHit] : pointerHits;
        }
        return rectIntersection(scopedArgs);
    };
}
