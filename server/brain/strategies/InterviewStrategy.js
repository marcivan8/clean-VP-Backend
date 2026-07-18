/**
 * server/brain/strategies/InterviewStrategy.js
 *
 * Timeline organization strategy for interview-style content.
 * Main camera on video_1, B-camera angles on video_2,
 * B-roll on video_3 at topic transition points, music bed at 0.15 volume.
 */

'use strict';

class InterviewStrategy {

    /**
     * @param {Object[]} assets       - Media bin assets (analyzed)
     * @param {Object}   projectState - { platform, summary }
     * @returns {{ commands: string[], explanation: string, suggestions: Object[] }}
     */
    buildTimeline(assets, projectState) {
        const commands = [];
        const suggestions = [];

        // Main camera clips → video_1
        const mainClips = assets.filter(a =>
            a.content_class === 'main_camera' ||
            (a.has_main_speaker && !a.is_broll)
        );
        for (const clip of mainClips) {
            commands.push(`add_clip_to_track asset_id=${clip.id} track=video_1`);
        }

        // B-camera angles → video_2
        const angleCams = assets.filter(a =>
            a.content_class === 'interview_b_cam' || a.content_class === 'angle_b'
        );
        for (const clip of angleCams) {
            commands.push(`add_clip_to_track asset_id=${clip.id} track=video_2`);
        }

        // B-roll → video_3 (at natural transition points)
        const brolls = assets.filter(a => a.is_broll || a.content_class === 'broll');
        for (const clip of brolls) {
            commands.push(`add_clip_to_track asset_id=${clip.id} track=video_3`);
        }

        // Music bed at low volume
        const music = assets.filter(a => a.audio_type === 'music' || a.content_class === 'music');
        for (const track of music) {
            commands.push(`add_clip_to_track asset_id=${track.id} track=audio_music`);
            commands.push(`set_track_volume track=audio_music volume=0.15`);
        }

        if (mainClips.length === 0) {
            suggestions.push({
                type: 'no_main_camera',
                text: 'No main camera found',
                reason: 'Label your primary talking-head clip as the main camera for best results.',
                priority: 'high',
            });
        }

        if (!music.length) {
            suggestions.push({
                type: 'add_music_bed',
                text: 'Add music bed',
                command: 'add_music_bed',
                reason: 'A subtle background track improves perceived production quality.',
                priority: 'medium',
            });
        }

        return {
            commands,
            explanation: `Placed ${mainClips.length} main clip(s) on video_1, ${angleCams.length} angle(s) on video_2, and ${brolls.length} B-roll clip(s) on video_3. Music bed set to 15% volume.`,
            suggestions,
        };
    }
}

module.exports = InterviewStrategy;
