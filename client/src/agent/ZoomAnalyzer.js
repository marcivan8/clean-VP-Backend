import ContentAnalyzer, { SEGMENT_TYPES, ENERGY_LEVELS } from './ContentAnalyzer.js';
import useTimelineStore from '../store/useTimelineStore.js';

/**
 * ZoomAnalyzer
 * Analyzes segments and transcripts to generate context-aware zoom keyframes (Ken Burns style).
 */
export class ZoomAnalyzer {
    /**
     * Generates zoom events for the given clips based on content analysis.
     * @param {Array} clips - The clips to analyze.
     * @returns {Array} List of zoom events { clipId, time, scale, easing }
     */
    static async generateZoomEvents(clips) {
        const events = [];
        
        // 1. Get or run content analysis
        let analysis = ContentAnalyzer.getCachedAnalysis();
        if (!analysis || !analysis.segments || analysis.segments.length === 0) {
            console.log('[ZoomAnalyzer] No cached analysis found, running local analysis...');
            const state = useTimelineStore.getState();
            const context = ContentAnalyzer._buildContext(state);
            // We use local analysis here as a quick fallback if the main agent hasn't run it
            analysis = ContentAnalyzer._localAnalysis(context, 'youtube', state.duration);
        }

        const segments = analysis.segments;
        const contentType = analysis.contentType;
        
        console.log(`[ZoomAnalyzer] Analyzing ${clips.length} clips against ${segments.length} segments. Content type: ${contentType}`);

        // 2. Map clips to segments and generate keyframes
        for (const clip of clips) {
            const clipStart = clip.start || 0;
            const clipEnd = clipStart + (clip.duration || 0);
            
            // Find segments that overlap with this clip
            const overlappingSegments = segments.filter(seg => 
                (seg.start < clipEnd) && (seg.end > clipStart)
            );
            
            if (overlappingSegments.length === 0) continue;
            
            // Determine dominant segment type for this clip
            let dominantSegment = overlappingSegments[0];
            let maxOverlap = 0;
            
            for (const seg of overlappingSegments) {
                const overlapStart = Math.max(clipStart, seg.start);
                const overlapEnd = Math.min(clipEnd, seg.end);
                const overlapAmount = overlapEnd - overlapStart;
                
                if (overlapAmount > maxOverlap) {
                    maxOverlap = overlapAmount;
                    dominantSegment = seg;
                }
            }

            const { type, energy, importance_score } = dominantSegment;
            const clipLocalDuration = clip.duration || 0;

            // --- ZOOM LOGIC RULES ---
            
            // Rule 1: High importance or emotional moments -> Dramatic push-in
            if (importance_score > 0.75 || type === SEGMENT_TYPES.HOOK) {
                // Fast ease-in to 1.15x over the first 30% of the clip, then hold/slow-drift
                const pushDuration = Math.min(clipLocalDuration * 0.3, 2.0); // max 2s push
                
                events.push({ clipId: clip.id, time: 0, scale: 1.0, easing: 'easeOutCubic' });
                events.push({ clipId: clip.id, time: pushDuration, scale: 1.15, easing: 'linear' });
                events.push({ clipId: clip.id, time: clipLocalDuration, scale: 1.20, easing: 'linear' });
                continue;
            }
            
            // Rule 2: Dialog/Interview (multi-speaker implied by frequent cuts or specific content type)
            // If it's a 'value' segment with medium energy, do a subtle punch-in
            if (type === SEGMENT_TYPES.VALUE && energy === ENERGY_LEVELS.MEDIUM) {
                events.push({ clipId: clip.id, time: 0, scale: 1.10, easing: 'linear' }); // Instant punch-in
                events.push({ clipId: clip.id, time: clipLocalDuration, scale: 1.10, easing: 'linear' });
                continue;
            }
            
            // Rule 3: Talking head (long single shot)
            if (contentType === 'long_form_raw' && clipLocalDuration > 5) {
                 // Slow, continuous drift
                 events.push({ clipId: clip.id, time: 0, scale: 1.0, easing: 'linear' });
                 events.push({ clipId: clip.id, time: clipLocalDuration, scale: 1.08, easing: 'linear' });
                 continue;
            }
            
            // Rule 4: Action / High Energy -> No zoom (preserve motion)
            if (energy === ENERGY_LEVELS.HIGH) {
                events.push({ clipId: clip.id, time: 0, scale: 1.0, easing: 'linear' });
                events.push({ clipId: clip.id, time: clipLocalDuration, scale: 1.0, easing: 'linear' });
                continue;
            }
            
            // Default: Static
            events.push({ clipId: clip.id, time: 0, scale: 1.0, easing: 'linear' });
        }
        
        return events;
    }
}

export default ZoomAnalyzer;
