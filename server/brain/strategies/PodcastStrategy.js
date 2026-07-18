/**
 * server/brain/strategies/PodcastStrategy.js
 *
 * Podcast strategy: main clip on video_1, music bed at 0.12 volume,
 * flags if no captions yet.
 */

'use strict';

class PodcastStrategy {

    /**
     * @param {Object[]} assets
     * @param {Object}   projectState
     * @returns {{ commands: string[], explanation: string, suggestions: Object[] }}
     */
    buildTimeline(assets, projectState) {
        const commands = [];
        const suggestions = [];

        // Primary recording → video_1
        const mainClips = assets.filter(a =>
            !a.is_broll &&
            (a.has_main_speaker || a.audio_type === 'speech' || a.content_class === 'main_camera')
        );
        for (const clip of mainClips) {
            commands.push(`add_clip_to_track asset_id=${clip.id} track=video_1`);
        }

        // Intro/outro music → very low bed
        const music = assets.filter(a => a.audio_type === 'music' || a.content_class === 'music');
        for (const track of music) {
            commands.push(`add_clip_to_track asset_id=${track.id} track=audio_music`);
            commands.push(`set_track_volume track=audio_music volume=0.12`);
        }

        // Flag if captions are missing (podcasts strongly benefit from them)
        const hasCaptions = projectState?.captions?.length > 0;
        if (!hasCaptions) {
            suggestions.push({
                type: 'generate_captions',
                text: 'Add podcast captions',
                command: 'generate_captions',
                reason: 'Captions dramatically increase podcast discoverability and accessibility.',
                priority: 'high',
            });
        }

        // Suggest filler word removal
        suggestions.push({
            type: 'remove_filler_words',
            text: 'Remove filler words',
            command: 'remove_filler_words',
            reason: 'Removing um, uh, and like makes the podcast feel more polished.',
            priority: 'medium',
        });

        return {
            commands,
            explanation: `Placed ${mainClips.length} recording(s) on video_1. ${music.length ? 'Music bed set to 12% volume.' : 'No music in bin.'}`,
            suggestions,
        };
    }
}

module.exports = PodcastStrategy;
