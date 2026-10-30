/** Resolve the timeline time under the pointer when dropping media-bin assets. */
export function getAssetDropTime({ clientX, laneLeft, zoomLevel, currentTime = 0 }) {
    const zoom = Number(zoomLevel);
    const x = Number(clientX);
    const left = Number(laneLeft);
    if (!Number.isFinite(x) || !Number.isFinite(left) || !Number.isFinite(zoom) || zoom <= 0) {
        return Math.max(0, Number(currentTime) || 0);
    }
    return Math.max(0, (x - left) / zoom);
}
