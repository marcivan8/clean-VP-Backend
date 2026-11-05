/**
 * contentEnd.js
 *
 * Where the picture actually ends.
 *
 * `store.duration` is the project's length and can sit ahead of the clips (and,
 * briefly, behind them) after a cut, so it is not a safe answer to "is the
 * playhead still over something?". The last clip end is.
 *
 * Pure, and in its own module on purpose: both the store and
 * timeline/previewPlayback.js need it, and previewPlayback imports the store,
 * so putting it there would make the store import a module that imports the
 * store back.
 */

export function contentEndOf(tracks, fallbackDuration = 0) {
    let end = 0;
    for (const track of tracks || []) {
        for (const clip of track.clips || []) {
            end = Math.max(end, (Number(clip.start) || 0) + (Number(clip.duration) || 0));
        }
    }
    return end > 0 ? end : (Number(fallbackDuration) || 0);
}

/**
 * Where the PICTURE ends, which is not the same thing.
 *
 * VideoPlayer draws the video clip whose range contains the playhead. Captions
 * and text draw on top of that and nothing on their own, so a stretch of
 * timeline with only a caption on it is black. After a cut the video shrinks
 * while a remapped caption can still run past it, so "inside the content" is
 * not enough to guarantee there is a frame to show: it has to be inside the
 * VIDEO.
 *
 * Falls back to the overall end when there is no video at all, where there is
 * nothing better to aim at.
 */
export function visualEndOf(tracks, fallbackDuration = 0) {
    let end = 0;
    for (const track of tracks || []) {
        if (track.type !== 'video') continue;
        for (const clip of track.clips || []) {
            end = Math.max(end, (Number(clip.start) || 0) + (Number(clip.duration) || 0));
        }
    }
    return end > 0 ? end : contentEndOf(tracks, fallbackDuration);
}

export default { contentEndOf, visualEndOf };
