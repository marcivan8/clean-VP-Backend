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

/** Place an imported asset and create a suitable track if the timeline is empty. */
export function addAssetAtTimelinePosition(state, asset, requestedTrackId, start) {
    const trackType = asset.type === 'audio' ? 'audio' : 'video';
    let track = requestedTrackId
        ? state.tracks.find(item => item.id === requestedTrackId)
        : state.tracks.find(item => item.type === trackType);
    let trackId = track?.id || state.addTrack(trackType);
    const duration = asset.type === 'image' ? 5 : (asset.duration || asset.sourceDuration || 10);
    const currentTrack = state.tracks.find(item => item.id === trackId);
    const overlaps = (currentTrack?.clips || []).some(clip =>
        start < clip.start + clip.duration - 0.01 && start + duration > clip.start + 0.01
    );
    if (overlaps) trackId = state.addTrack(trackType);

    const resolution = asset.resolution || (asset.width && asset.height
        ? { w: asset.width, h: asset.height }
        : null);
    state.addClip(trackId, {
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        assetId: asset.id,
        start,
        duration,
        name: asset.name,
        color: asset.type === 'audio' ? 'bg-orange-500' : 'bg-blue-500',
        url: asset.url,
        sourceUrl: asset.sourceUrl || asset.url,
        type: asset.type,
        speed: 1,
        volume: 1,
        sourceWidth: resolution?.w || null,
        sourceHeight: resolution?.h || null,
        metadata: { fps: asset.fps, resolution },
    });
    return { trackId, start, duration };
}
