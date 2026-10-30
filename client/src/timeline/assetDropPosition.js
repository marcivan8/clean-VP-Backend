/** Resolve the timeline time under the pointer when dropping media-bin assets. */
export function getDropClientX(activatorEvent, deltaX = 0) {
    const point = activatorEvent?.changedTouches?.[0]
        || activatorEvent?.touches?.[0]
        || activatorEvent;
    const startX = Number(point?.clientX);
    return Number.isFinite(startX) ? startX + (Number(deltaX) || 0) : null;
}

export function getAssetDropTime({ clientX, laneLeft, zoomLevel, currentTime = 0 }) {
    const zoom = Number(zoomLevel);
    const x = Number(clientX);
    const left = Number(laneLeft);
    if (!Number.isFinite(x) || !Number.isFinite(left) || !Number.isFinite(zoom) || zoom <= 0) {
        return Math.max(0, Number(currentTime) || 0);
    }
    return Math.max(0, (x - left) / zoom);
}
