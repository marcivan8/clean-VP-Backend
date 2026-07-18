/**
 * server/brain/strategies/TalkingHeadStrategy.js
 *
 * Talking head strategy: single clip on video_1, suggest zoom + captions.
 * The most common content type for solo creators.
 */

'use strict';

class TalkingHeadStrategy {

    /**
     * @param {Object[]} assets
     * @param {Object}   projectState
     * @returns {{ commands: string[], explanation: string, suggestions: Object[] }}
     */
    buildTimeline(assets, projectState) {
        const commands = [];
        const suggestions = [];

        // Primary clip → video_1
        const mainClips = assets.filter(a =>
            !a.is_broll && !a.audio_type?.includes('music')
        );

        // Use first (longest) clip as primary
        mainClips.sort((a, b) => (b.duration || 0) - (a.duration || 0));

        for (const clip of mainClips) {
            commands.push(`add_clip_to_track asset_id=${clip.id} track=video_1`);
        }

        // Always suggest these two for talking head
        suggestions.push({
            type: 'remove_silence',
            text: 'Remove silences',
            command: 'remove_silence',
            reason: 'Silence removal is the single highest-ROI edit for talking-head content.',
            priority: 'high',
        });

        suggestions.push({
            type: 'generate_captions',
            text: 'Add captions',
            command: 'generate_captions',
            reason: 'Most viewers watch without sound — captions are essential.',
            priority: 'high',
        });

        suggestions.push({
            type: 'apply_smart_zoom',
            text: 'Smart zoom',
            command: 'apply_smart_zoom',
            reason: 'Subtle zoom adds dynamism to static talking-head shots.',
            priority: 'medium',
        });

        return {
            commands,
            explanation: `Placed ${mainClips.length} clip(s) on video_1. Ready for silence removal and captioning.`,
            suggestions,
        };
    }
}

module.exports = TalkingHeadStrategy;
