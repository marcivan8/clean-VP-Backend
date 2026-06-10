import ContentAnalyzer, { SEGMENT_TYPES, ENERGY_LEVELS } from './ContentAnalyzer.js';
import useTimelineStore from '../store/useTimelineStore.js';

const TALKING_HEAD_TYPES = new Set(['long_form_raw', 'podcast', 'interview', 'youtube_long']);

/**
 * ZoomAnalyzer
 * Generates context-aware zoom keyframes for interview/talking-head content.
 *
 * Key design decisions:
 * - Segment lookup uses source time (clip.offset + local position), not clip.start,
 *   so it works correctly after silence/filler removal compresses the timeline.
 * - Word-level timestamps from store.captions drive sentence-boundary punch timing.
 * - Cross-clip scale alternation (1.0 → 1.08 → 1.0 → 1.12) creates a camera-switch feel.
 * - transformOrigin for talking heads is '50% 28%' (set by VideoPlayer via clip metadata),
 *   keeping the speaker's face in frame when scaling up from the default '50% 50%'.
 */
export class ZoomAnalyzer {
    /**
     * @param {Array} clips - Video clips with { id, start, duration, offset } fields.
     * @returns {Array} Zoom events: { clipId, time, scale, easing, transformOrigin? }
     */
    static async generateZoomEvents(clips) {
        const events = [];

        // 1. Get or run content analysis
        let analysis = ContentAnalyzer.getCachedAnalysis();
        if (!analysis || !analysis.segments || analysis.segments.length === 0) {
            console.log('[ZoomAnalyzer] No cached analysis — running local fallback');
            const state = useTimelineStore.getState();
            const context = ContentAnalyzer._buildContext(state);
            analysis = ContentAnalyzer._localAnalysis(context, 'youtube', state.duration);
        }

        const segments = analysis.segments;
        const contentType = analysis.contentType;
        const isTalkingHead = TALKING_HEAD_TYPES.has(contentType);

        // Word-level timestamps from Whisper (may be empty for unprocessed videos)
        const words = useTimelineStore.getState().captions || [];

        console.log(
            `[ZoomAnalyzer] ${clips.length} clips | ${segments.length} segments | ` +
            `contentType=${contentType} | words=${words.length}`
        );

        // Cross-clip scale alternation state: tracks where the previous clip ended.
        // Clip N ends at scaleA → Clip N+1 starts at 1.0 (visual cut feel).
        let prevEndScale = 1.0;

        // 2. Process each clip
        for (const clip of clips) {
            const clipLocalDuration = clip.duration || 0;
            if (clipLocalDuration <= 0) continue;

            // ── Source-time lookup ────────────────────────────────────────────
            // clip.offset = where in the source file this clip starts (set during silence removal).
            // Segments have source-file timestamps from ContentAnalyzer/Whisper.
            // Using clip.start (timeline position) would mismap after any timeline compression.
            const srcStart = clip.offset ?? clip.start ?? 0;
            const srcEnd   = srcStart + clipLocalDuration;

            const overlappingSegments = segments.filter(
                seg => seg.start < srcEnd && seg.end > srcStart
            );

            // ── Word-level sentence boundaries ───────────────────────────────
            // Find pauses ≥ 0.4 s within this clip's source range → sentence starts.
            // These are used for per-sentence punch-in timing below.
            const clipWords = words.filter(w => w.start >= srcStart && w.end <= srcEnd);
            const sentenceStartTimes = []; // clip-local times
            for (let i = 1; i < clipWords.length; i++) {
                const gap = clipWords[i].start - clipWords[i - 1].end;
                if (gap >= 0.4) {
                    // timeline-local offset of this sentence start
                    sentenceStartTimes.push(clipWords[i].start - srcStart);
                }
            }

            // ── Dominant segment ─────────────────────────────────────────────
            let dominantSegment = overlappingSegments[0] || null;
            let maxOverlap = 0;
            for (const seg of overlappingSegments) {
                const ol = Math.min(srcEnd, seg.end) - Math.max(srcStart, seg.start);
                if (ol > maxOverlap) { maxOverlap = ol; dominantSegment = seg; }
            }

            const type            = dominantSegment?.type ?? SEGMENT_TYPES.VALUE;
            const energy          = dominantSegment?.energy ?? ENERGY_LEVELS.MEDIUM;
            const importanceScore = dominantSegment?.importance_score ?? 0.5;

            // ── Zoom rules ───────────────────────────────────────────────────

            // Rule 1: High importance / emotional peak → dramatic push-in
            if (importanceScore > 0.7 || type === SEGMENT_TYPES.HOOK) {
                const pushDur = Math.min(clipLocalDuration * 0.3, 0.8);
                events.push({ clipId: clip.id, time: 0,               scale: 1.0,  easing: 'easeOutCubic' });
                events.push({ clipId: clip.id, time: pushDur,          scale: 1.15, easing: 'linear' });
                events.push({ clipId: clip.id, time: clipLocalDuration, scale: 1.20, easing: 'linear' });
                prevEndScale = 1.20;
                continue;
            }

            // Rule 2: Talking-head content (any type) with word timestamps →
            //         sentence-boundary punch timing for a multi-camera feel.
            if (isTalkingHead && sentenceStartTimes.length > 0) {
                // Clip N+1 always starts at 1.0 regardless of where clip N ended,
                // simulating a camera-cut reset.
                const baseScale = 1.0;
                const targetScale = prevEndScale > 1.05 ? 1.08 : 1.12; // alternate levels

                events.push({ clipId: clip.id, time: 0, scale: baseScale, easing: 'linear' });

                // Punch in at the first sentence boundary, drift gently to targetScale by end
                const firstBoundary = sentenceStartTimes[0];
                events.push({ clipId: clip.id, time: firstBoundary,      scale: targetScale, easing: 'easeOutCubic' });
                events.push({ clipId: clip.id, time: clipLocalDuration,   scale: targetScale, easing: 'linear' });

                prevEndScale = targetScale;
                continue;
            }

            // Rule 3: Talking head without word timestamps → slow drift
            if (isTalkingHead && clipLocalDuration > 3) {
                const targetScale = prevEndScale > 1.05 ? 1.08 : 1.12;
                events.push({ clipId: clip.id, time: 0,               scale: 1.0,        easing: 'linear' });
                events.push({ clipId: clip.id, time: clipLocalDuration, scale: targetScale, easing: 'linear' });
                prevEndScale = targetScale;
                continue;
            }

            // Rule 4: Value segment, medium energy → subtle punch-in
            if (type === SEGMENT_TYPES.VALUE && energy === ENERGY_LEVELS.MEDIUM) {
                events.push({ clipId: clip.id, time: 0,               scale: 1.08, easing: 'linear' });
                events.push({ clipId: clip.id, time: clipLocalDuration, scale: 1.08, easing: 'linear' });
                prevEndScale = 1.08;
                continue;
            }

            // Rule 5: High-energy / action → no zoom (preserve motion)
            if (energy === ENERGY_LEVELS.HIGH) {
                events.push({ clipId: clip.id, time: 0,               scale: 1.0, easing: 'linear' });
                events.push({ clipId: clip.id, time: clipLocalDuration, scale: 1.0, easing: 'linear' });
                prevEndScale = 1.0;
                continue;
            }

            // Default: static 1.0
            events.push({ clipId: clip.id, time: 0, scale: 1.0, easing: 'linear' });
            prevEndScale = 1.0;
        }

        return events;
    }
}

export default ZoomAnalyzer;
