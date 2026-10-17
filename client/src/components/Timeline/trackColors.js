/**
 * trackColors.js
 *
 * Single source of truth for "this track's colour" — used by Track.jsx's
 * mobile strip indicator AND by Clip.jsx's waveform tint, so a clip's
 * waveform always matches the colour its own track is identified by
 * elsewhere in the UI, instead of each place hardcoding its own guess.
 *
 * Kept as a standalone module (not exported from Track.jsx) because
 * Track.jsx imports Clip.jsx — exporting from Track.jsx would make Clip.jsx
 * import back from its own importer, a circular dependency.
 */
export const TRACK_STRIP_COLORS = {
    video: 'var(--accent)',
    audio: 'var(--coral)',
    text:  'var(--mint)',
    image: 'var(--accent)',
};

export function colorForTrackType(trackType) {
    return TRACK_STRIP_COLORS[trackType] || 'var(--fg-3)';
}
