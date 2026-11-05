/**
 * previewPlayback.js
 *
 * Playing the preview from a review surface, as opposed to from the editor.
 *
 * The editor drives playback through MobileTransportBar, which sits under the
 * preview and carries undo, redo, clip skip and a More sheet. The guided mobile
 * flow covers that bar with its own sheet, and pulling it back in would drag
 * the whole editor into a flow built to keep it out. What a result screen needs
 * is just: tap to play, and replay when it has finished.
 */

import useTimelineStore from '../store/useTimelineStore';

/**
 * The real end of the edit.
 *
 * store.duration is the project's length and can sit ahead of the clips after
 * a cut, so playing to `duration` would run past the picture into dead air.
 * The last clip end is what the viewer actually sees.
 */
export function contentEnd(state) {
    let end = 0;
    for (const track of state?.tracks || []) {
        for (const clip of track.clips || []) {
            end = Math.max(end, (Number(clip.start) || 0) + (Number(clip.duration) || 0));
        }
    }
    return end > 0 ? end : Number(state?.duration) || 0;
}

/** Whether the playhead has reached the end of the picture. */
export function isAtEnd(state, epsilon = 0.08) {
    const end = contentEnd(state);
    return end > 0 && (Number(state?.currentTime) || 0) >= end - epsilon;
}

/**
 * Play or pause the preview. Pressing play on a short that has already run to
 * the end replays it, rather than looking broken because the playhead has
 * nowhere left to go.
 */
export function togglePreview() {
    const store = useTimelineStore.getState();
    if (!store.isPlaying && isAtEnd(store)) store.seek(0);
    store.togglePlay();
}

export default { contentEnd, isAtEnd, togglePreview };
