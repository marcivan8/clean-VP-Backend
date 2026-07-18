/**
 * server/brain/strategies/VlogStrategy.js
 *
 * Vlog strategy: sort clips by filename number, sequence all on video_1, music throughout.
 */

'use strict';

class VlogStrategy {

    /**
     * @param {Object[]} assets
     * @param {Object}   projectState
     * @returns {{ commands: string[], explanation: string, suggestions: Object[] }}
     */
    buildTimeline(assets, projectState) {
        const commands = [];
        const suggestions = [];

        // Sort video clips by filename number (common vlog pattern: clip001, clip002…)
        const videoClips = assets
            .filter(a => !a.audio_type?.includes('music') && !a.is_broll)
            .sort((a, b) => {
                const na = _extractNumber(a.name || a.filename || '');
                const nb = _extractNumber(b.name || b.filename || '');
                return na - nb;
            });

        for (const clip of videoClips) {
            commands.push(`add_clip_to_track asset_id=${clip.id} track=video_1`);
        }

        // B-roll interspersed (no specific placement — editor decides)
        const brolls = assets.filter(a => a.is_broll || a.content_class === 'broll');
        for (const clip of brolls) {
            commands.push(`add_clip_to_track asset_id=${clip.id} track=video_2`);
        }

        // Music throughout
        const music = assets.filter(a => a.audio_type === 'music' || a.content_class === 'music');
        for (const track of music) {
            commands.push(`add_clip_to_track asset_id=${track.id} track=audio_music`);
            commands.push(`set_track_volume track=audio_music volume=0.25`);
        }

        if (!music.length) {
            suggestions.push({
                type: 'add_music',
                text: 'Add background music',
                command: 'add_music_bed',
                reason: 'Vlogs benefit from upbeat background music throughout.',
                priority: 'medium',
            });
        }

        if (videoClips.length > 5) {
            suggestions.push({
                type: 'remove_silence',
                text: 'Remove silences',
                command: 'remove_silence',
                reason: 'With multiple clips, removing silence gaps keeps the energy high.',
                priority: 'high',
            });
        }

        return {
            commands,
            explanation: `Arranged ${videoClips.length} clip(s) in filename order on video_1, ${brolls.length} B-roll clip(s) on video_2. ${music.length ? 'Music added throughout.' : 'No music detected in bin.'}`,
            suggestions,
        };
    }
}

function _extractNumber(filename) {
    const match = filename.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : Infinity;
}

module.exports = VlogStrategy;
