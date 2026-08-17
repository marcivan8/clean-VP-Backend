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
 *   REVEAL           — caption/text wording that reads as a reveal, or a big
 *                       push-in following a pause (R68 — heuristic, no LLM call)
 *   PUNCHLINE_DETECTED — a silence gap immediately followed by a loud audio
 *                       peak — the setup/pause/payoff shape of a punchline
 *   EMPHASIS_MOMENT   — a standalone loud audio peak not already claimed as
 *                       a punchline
 *   EMOTIONAL_BEAT    — a soft-cut/silence gap covered by caption wording
 *                       that reads as emotionally weighted
 *
 * These four are documented in AnimationKnowledgeGraph.js as the semantic
 * events the "AI Animation Intelligence" feature (R68) acts on — this file
 * only detects them; it does not decide what animation or SFX to apply.
 *
 * Detection is synchronous and runs in O(n) over clips.
 */

const { TimelineEventType } = require('../types.js');

// ── Constants ──────────────────────────────────────────────────────────────────

const HARD_CUT_GAP_MS      = 80;   // ≤ 80ms gap between clips = hard cut
const SOFT_CUT_DURATION_MS = 600;  // ≤ 600ms crossfade = soft cut
const SILENCE_THRESHOLD_S  = 0.25; // gap in seconds counted as silence gap

// R68 semantic-event heuristic thresholds. All heuristics run against
// signals this file already computes or that already exist on clips —
// no LLM call, per the confirmed "heuristic-based on existing signals" scope.
const PUNCHLINE_PEAK_WINDOW_S = 1.2;  // silence→peak gap read as comedic timing
const PUNCHLINE_PEAK_DB       = -8;   // peak loudness above this counts
const EMPHASIS_PEAK_DB        = -4;   // standalone peak this loud reads as emphasis
const REVEAL_ZOOM_THRESHOLD   = 1.3;  // a push bigger than plain ZOOM_IN's 1.05 reads as a reveal
const EMOTIONAL_SILENCE_S     = 1.0;  // a pause this long, near matching wording, reads as a beat

const REVEAL_KEYWORDS = /\b(reveal(?:ing|ed)?|introduc(?:e|ing)|here'?s|check (?:this|it) out|behold|unveil(?:ing|ed)?|presenting|meet the|watch this)\b/i;
const EMOTIONAL_KEYWORDS = /\b(love|miss(?:ed|ing)?|sorry|goodbye|remember|thank you|proud|hurts?|heart|cry(?:ing)?)\b/i;

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

        // R68 — semantic events derive from the structural events + clip
        // wording above, so they run as a second pass once those exist.
        this._detectSemanticEvents(tracks, events);

        // Sort by timeline position
        events.sort((a, b) => a.timelineTime - b.timelineTime);
        return events;
    }

    // ── Semantic events (R68 — AI Animation Intelligence) ─────────────────────

    /**
     * Detect REVEAL, PUNCHLINE_DETECTED, EMPHASIS_MOMENT and EMOTIONAL_BEAT
     * purely from signals already present on `events` (silence gaps, audio
     * peaks, soft cuts) and `tracks` (caption/text wording, zoom). No LLM
     * call — every check here is a threshold or keyword match against data
     * this detector or an earlier analysis pass already produced.
     * @private
     */
    _detectSemanticEvents(tracks, events) {
        const silenceEnds  = events.filter(e => e.eventType === TimelineEventType.SILENCE_END);
        const silenceStarts = events.filter(e => e.eventType === TimelineEventType.SILENCE_START);
        const audioPeaks   = events.filter(e => e.eventType === TimelineEventType.AUDIO_PEAK);

        // Flatten text/caption clips once — several heuristics below need to
        // ask "is there wording near time T", so build the lookup up front
        // rather than re-scanning tracks per candidate.
        const textClips = [];
        for (const track of tracks) {
            if (!track || track.type !== 'text') continue;
            for (const clip of (track.clips || [])) {
                if (!clip) continue;
                const start = clip.startTime || clip.start || 0;
                const end   = clip.endTime || clip.end || (start + (clip.duration || 0));
                const text  = clip.text || clip.caption || '';
                textClips.push({ clip, start, end, text });
            }
        }

        // ── PUNCHLINE_DETECTED / EMPHASIS_MOMENT — both read off audio peaks ──
        // A peak that lands shortly after a silence gap has the setup/pause/
        // payoff shape of a punchline. A peak that's just loud on its own,
        // with no preceding pause, reads as emphasis instead. Each peak is
        // claimed by at most one of the two so they never double-fire.
        for (const peak of audioPeaks) {
            const db = peak.metadata?.db;
            if (typeof db !== 'number') continue;

            const precedingSilence = silenceEnds.find(s =>
                peak.timelineTime >= s.timelineTime &&
                (peak.timelineTime - s.timelineTime) <= PUNCHLINE_PEAK_WINDOW_S
            );

            if (precedingSilence && db >= PUNCHLINE_PEAK_DB) {
                events.push({
                    eventType:    TimelineEventType.PUNCHLINE_DETECTED,
                    timelineTime: peak.timelineTime,
                    clipId:       peak.clipId,
                    trackId:      peak.trackId,
                    metadata:     { db, silenceGapS: peak.timelineTime - precedingSilence.timelineTime },
                });
            } else if (db >= EMPHASIS_PEAK_DB) {
                events.push({
                    eventType:    TimelineEventType.EMPHASIS_MOMENT,
                    timelineTime: peak.timelineTime,
                    clipId:       peak.clipId,
                    trackId:      peak.trackId,
                    metadata:     { db },
                });
            }
        }

        // ── REVEAL — reveal-coded wording, or a big push-in ────────────────
        for (const { clip, start, text } of textClips) {
            if (REVEAL_KEYWORDS.test(text)) {
                events.push({
                    eventType:    TimelineEventType.REVEAL,
                    timelineTime: start,
                    clipId:       clip.id || null,
                    trackId:      null,
                    metadata:     { via: 'keyword', text: text.slice(0, 100) },
                });
            }
        }
        for (const track of tracks) {
            if (!track || track.type !== 'video') continue;
            for (const clip of (track.clips || [])) {
                if (!clip) continue;
                const zoom = clip.zoom || clip.zoomLevel || null;
                if (zoom && zoom >= REVEAL_ZOOM_THRESHOLD) {
                    events.push({
                        eventType:    TimelineEventType.REVEAL,
                        timelineTime: clip.startTime || clip.start || 0,
                        clipId:       clip.id || null,
                        trackId:      track.id || null,
                        metadata:     { via: 'push-in', zoomLevel: zoom },
                    });
                }
            }
        }

        // ── EMOTIONAL_BEAT — a real pause covered by emotionally-coded wording ──
        for (const silence of silenceStarts) {
            const durationS = silence.metadata?.durationS;
            if (typeof durationS !== 'number' || durationS < EMOTIONAL_SILENCE_S) continue;

            const nearbyWording = textClips.find(({ start, end, text }) =>
                EMOTIONAL_KEYWORDS.test(text) &&
                start <= silence.timelineTime + 0.5 &&
                end   >= silence.timelineTime - 2.0
            );
            if (nearbyWording) {
                events.push({
                    eventType:    TimelineEventType.EMOTIONAL_BEAT,
                    timelineTime: silence.timelineTime,
                    clipId:       nearbyWording.clip.id || null,
                    trackId:      silence.trackId,
                    metadata:     { durationS, text: nearbyWording.text.slice(0, 100) },
                });
            }
        }
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
