'use strict';

/**
 * server/audio-engine/timeline/TimelineEventDetector.js
 *
 * Analyses a timeline state snapshot and emits TimelineEvent objects.
 *
 * Detects:
 *   HARD_CUT     — adjacent clips with no gap/overlap
 *   SOFT_CUT     — adjacent clips with short crossfade
 *   ZOOM_IN/OUT  — clips with zoom metadata
 *   SILENCE_START/END — silence segments from prior analysis
 *   TEXT_APPEARS  — text/caption clips appearing
 *   B_ROLL_START  — secondary video clips starting
 *   SCENE_CHANGE  — large visual jump between clips
 *   AUDIO_PEAK    — audio track peak markers
 *   CHAPTER_START — marker clips
 *   SPEAKER_CHANGE — diarization speaker changes
 *
 * Detection is synchronous and runs in O(n) over clips.
 */

const { TimelineEventType } = require('../types.js');

// ── Constants ──────────────────────────────────────────────────────────────────

const HARD_CUT_GAP_MS      = 80;   // ≤ 80ms gap between clips = hard cut
const SOFT_CUT_DURATION_MS = 600;  // ≤ 600ms crossfade = soft cut
const SILENCE_THRESHOLD_S  = 0.25; // gap in seconds counted as silence gap

class TimelineEventDetector {
    /**
     * Detect all timeline events from a project state snapshot.
     *
     * @param {Object} projectState — lightweight snapshot from ContextEngine/useBrain
     * @returns {import('../types').TimelineEvent[]}  detected events
     */
    detect(projectState) {
        const events = [];
        const tracks = projectState?.tracks || [];

        for (const track of tracks) {
            if (!track) continue;

            const clips = track.clips || [];
            const type  = track.type || 'video';

            if (type === 'video') {
                this._detectVideoEvents(clips, track, events);
            } else if (type === 'audio') {
                this._detectAudioEvents(clips, track, events);
            } else if (type === 'text') {
                this._detectTextEvents(clips, track, events);
            }
        }

        // Sort by timeline position
        events.sort((a, b) => a.timelineTime - b.timelineTime);
        return events;
    }

    // ── Video track ────────────────────────────────────────────────────────────

    /** @private */
    _detectVideoEvents(clips, track, events) {
        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            if (!clip) continue;

            const startTime = (clip.startTime || clip.start || 0);
            const endTime   = (clip.endTime   || clip.end   || startTime + (clip.duration || 0));

            // Clip start
            events.push({
                eventType:    TimelineEventType.CLIP_START,
                timelineTime: startTime,
                clipId:       clip.id || null,
                trackId:      track.id || null,
                metadata:     { clipName: clip.name || null },
            });

            // Chapter / marker
            if (clip.isChapter || clip.type === 'marker') {
                events.push({
                    eventType:    TimelineEventType.CHAPTER_START,
                    timelineTime: startTime,
                    clipId:       clip.id || null,
                    trackId:      track.id || null,
                    metadata:     { label: clip.label || null },
                });
            }

            // B-roll (secondary video track)
            if (track.isSecondary || track.role === 'b-roll') {
                events.push({
                    eventType:    TimelineEventType.B_ROLL_START,
                    timelineTime: startTime,
                    clipId:       clip.id || null,
                    trackId:      track.id || null,
                    metadata:     {},
                });
            }

            // Zoom in/out
            const zoom = clip.zoom || clip.zoomLevel || null;
            if (zoom && zoom > 1.05) {
                events.push({
                    eventType:    TimelineEventType.ZOOM_IN,
                    timelineTime: startTime,
                    clipId:       clip.id || null,
                    trackId:      track.id || null,
                    metadata:     { zoomLevel: zoom },
                });
            }
            if (zoom && zoom < 0.95) {
                events.push({
                    eventType:    TimelineEventType.ZOOM_OUT,
                    timelineTime: startTime,
                    clipId:       clip.id || null,
                    trackId:      track.id || null,
                    metadata:     { zoomLevel: zoom },
                });
            }

            // Scene change (detect via analysis metadata on clip)
            if (clip.isSceneChange || clip.sceneChangeScore > 0.7) {
                events.push({
                    eventType:    TimelineEventType.SCENE_CHANGE,
                    timelineTime: startTime,
                    clipId:       clip.id || null,
                    trackId:      track.id || null,
                    metadata:     { score: clip.sceneChangeScore || 1 },
                });
            }

            // Cut detection (comparing with previous clip)
            if (i > 0) {
                const prev    = clips[i - 1];
                const prevStart = prev.startTime || prev.start || 0;
                const prevEnd   = prev.endTime || prev.end
                    || (prevStart + (prev.duration || 0));
                const gapMs   = (startTime - prevEnd) * 1000;

                if (Math.abs(gapMs) <= HARD_CUT_GAP_MS) {
                    events.push({
                        eventType:    TimelineEventType.HARD_CUT,
                        timelineTime: startTime,
                        clipId:       clip.id || null,
                        trackId:      track.id || null,
                        metadata:     { gapMs },
                    });
                } else if (gapMs > HARD_CUT_GAP_MS && gapMs <= SOFT_CUT_DURATION_MS) {
                    events.push({
                        eventType:    TimelineEventType.SOFT_CUT,
                        timelineTime: startTime,
                        clipId:       clip.id || null,
                        trackId:      track.id || null,
                        metadata:     { gapMs },
                    });
                }
            }

            // Silence gap (gap after this clip, before next)
            if (i < clips.length - 1) {
                const next     = clips[i + 1];
                const nextStart = (next.startTime || next.start || 0);
                const gapS      = nextStart - endTime;
                if (gapS > SILENCE_THRESHOLD_S) {
                    events.push({
                        eventType:    TimelineEventType.SILENCE_START,
                        timelineTime: endTime,
                        clipId:       null,
                        trackId:      track.id || null,
                        metadata:     { durationS: gapS },
                    });
                    events.push({
                        eventType:    TimelineEventType.SILENCE_END,
                        timelineTime: nextStart,
                        clipId:       null,
                        trackId:      track.id || null,
                        metadata:     { durationS: gapS },
                    });
                }
            }
        }
    }

    // ── Audio track ────────────────────────────────────────────────────────────

    /** @private */
    _detectAudioEvents(clips, track, events) {
        for (const clip of clips) {
            if (!clip) continue;
            const startTime = clip.startTime || clip.start || 0;

            // Speaker change (from diarization metadata)
            if (clip.speakerChange || clip.speaker !== clips[0]?.speaker) {
                events.push({
                    eventType:    TimelineEventType.SPEAKER_CHANGE,
                    timelineTime: startTime,
                    clipId:       clip.id || null,
                    trackId:      track.id || null,
                    metadata:     { speaker: clip.speaker || null },
                });
            }

            // Audio peak markers
            const peaks = clip.peaks || clip.audioPeaks || [];
            for (const peak of peaks) {
                const peakTime = startTime + (peak.offset || 0);
                events.push({
                    eventType:    TimelineEventType.AUDIO_PEAK,
                    timelineTime: peakTime,
                    clipId:       clip.id || null,
                    trackId:      track.id || null,
                    metadata:     { db: peak.db || peak.level || null },
                });
            }
        }
    }

    // ── Text / caption track ───────────────────────────────────────────────────

    /** @private */
    _detectTextEvents(clips, track, events) {
        for (const clip of clips) {
            if (!clip) continue;
            const startTime = clip.startTime || clip.start || 0;

            const eventType = (clip.type === 'caption' || clip.isCaption)
                ? TimelineEventType.CAPTION_APPEARS
                : TimelineEventType.TEXT_APPEARS;

            events.push({
                eventType,
                timelineTime: startTime,
                clipId:       clip.id || null,
                trackId:      track.id || null,
                metadata:     {
                    text: (clip.text || clip.caption || '').slice(0, 100),
                },
            });
        }
    }
}

// Singleton
const timelineEventDetector = new TimelineEventDetector();
module.exports = { TimelineEventDetector, timelineEventDetector };
