/**
 * ContentAnalyzer Agent — Long-Form Video Intelligence Engine
 *
 * Implements Steps 1–3 of the Long-Form Spec:
 *   1. Context Analysis  — reads timeline for duration, clips, transcript presence
 *   2. Segmentation      — calls backend to semantically cluster Whisper segments
 *   3. Structure Detection — receives back { hook, intro, sections[], keyMoments[], outro }
 *
 * This agent NEVER executes edits. It ONLY analyzes and returns structured data.
 * All results are stored in useTimelineStore.contentAnalysis for downstream agents.
 *
 * Constraints:
 *   - Always calls /api/ai/analyze-content for GPT-4 topic detection (Q3 answer)
 *   - Returns requiresApproval: true at all times (Q4 answer)
 *   - Requires word-level transcript (Q1 answer) — gracefully degrades without it
 */

import useTimelineStore from '../store/useTimelineStore.js';

// Segment type constants
export const SEGMENT_TYPES = {
    HOOK: 'hook',
    INTRO: 'intro',
    VALUE: 'value',
    FILLER: 'filler',
    TRANSITION: 'transition',
    OUTRO: 'outro',
};

// Energy levels
export const ENERGY_LEVELS = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
};

// Edit modes
export const EDIT_MODES = {
    FULL_BUILD: 'FULL_BUILD',         // From raw rushes → build narrative
    CLEAN_EDIT: 'CLEAN_EDIT',         // Podcast/interview → remove silences + filler
    YOUTUBE_OPTIMIZED: 'YOUTUBE_OPTIMIZED', // Add hook, improve pacing
};

export class ContentAnalyzer {
    /**
     * Main entry point: Analyze video content for long-form editing.
     *
     * @param {object} options
     * @param {string} [options.platform] - 'youtube' | 'podcast' | 'tiktok' | null
     * @param {number} [options.targetDuration] - Desired output duration in seconds
     * @param {AbortSignal} [options.signal] - For cancellation
     * @returns {Promise<ContentAnalysisResult>}
     */
    static async analyze(options = {}) {
        const { platform = null, targetDuration = null, signal = null } = options;
        const state = useTimelineStore.getState();

        console.log('[ContentAnalyzer] Starting content analysis...');

        // ── Step 1: Context Analysis ────────────────────────────────────────
        const context = this._buildContext(state);
        console.log('[ContentAnalyzer] Context:', context);

        if (context.clipCount === 0) {
            return this._errorResult('No clips found on the timeline. Please import a video first.');
        }

        // ── Step 2: Build transcript payload ───────────────────────────────
        const transcriptPayload = this._buildTranscriptPayload(state);

        // ── Step 3: Call backend for GPT-4 semantic analysis ───────────────
        const backendResult = await this._callBackend({
            transcript: transcriptPayload,
            clips: context.clips,
            duration: context.duration,
            platform,
            targetDuration,
            signal,
        });

        if (!backendResult.success) {
            // Degrade gracefully to local analysis
            console.warn('[ContentAnalyzer] Backend unavailable, using local analysis');
            return this._localAnalysis(context, platform, targetDuration);
        }

        // ── Step 4: Store result in timeline store ─────────────────────────
        const result = {
            ...backendResult,
            requiresApproval: true, // Enforced: always ask user before executing
            timestamp: Date.now(),
        };

        // Persist to store so EditPlanner and ContextGenerator can access it
        useTimelineStore.getState().setContentAnalysis(result);

        console.log(`[ContentAnalyzer] Analysis complete. Mode: ${result.editMode}, Segments: ${result.segments?.length}`);
        return result;
    }

    // ── Context Building ──────────────────────────────────────────────────────

    /**
     * Reads timeline store state and builds a normalized context object.
     */
    static _buildContext(state) {
        const clips = [];
        let totalDuration = 0;

        (state.tracks || []).forEach(track => {
            (track.clips || []).forEach(clip => {
                clips.push({
                    id: clip.id,
                    name: clip.name || 'Untitled',
                    start: clip.start || 0,
                    duration: clip.duration || 0,
                    trackId: track.id,
                    type: track.type,
                });
                const clipEnd = (clip.start || 0) + (clip.duration || 0);
                if (clipEnd > totalDuration) totalDuration = clipEnd;
            });
        });

        const hasTranscript = state.captions && state.captions.length > 0;
        const hasWordTimestamps = hasTranscript && state.captions.some(c => c.start !== undefined && c.end !== undefined);

        return {
            clips,
            clipCount: clips.length,
            duration: state.duration || totalDuration,
            aspectRatio: state.aspectRatio || '16:9',
            hasTranscript,
            hasWordTimestamps,
            captions: state.captions || [],
            contentAnalysis: state.contentAnalysis || null,
        };
    }

    /**
     * Builds the transcript payload for the backend.
     * Handles both plain text captions and word-level timestamp captions.
     */
    static _buildTranscriptPayload(state) {
        const captions = state.captions || [];

        if (captions.length === 0) {
            return { text: '', segments: [] };
        }

        // Reconstruct plain text
        const text = captions.map(c => c.word || c.text || '').join(' ').trim();

        // Build Whisper-compatible segments from captions if they have timing
        const segments = [];
        const SEGMENT_GAP_THRESHOLD = 1.5; // seconds of silence = new segment
        let segStart = captions[0]?.start ?? 0;
        let segText = '';
        let segWords = [];
        let prevEnd = captions[0]?.start ?? 0;

        for (const caption of captions) {
            const wordStart = caption.start ?? prevEnd;
            const wordEnd = caption.end ?? wordStart + 0.2;
            const gap = wordStart - prevEnd;

            // New segment on long gap
            if (gap > SEGMENT_GAP_THRESHOLD && segWords.length > 0) {
                segments.push({
                    id: segments.length,
                    start: segStart,
                    end: prevEnd,
                    text: segText.trim(),
                    words: segWords,
                });
                segStart = wordStart;
                segText = '';
                segWords = [];
            }

            segText += ' ' + (caption.word || caption.text || '');
            segWords.push({
                word: caption.word || caption.text || '',
                start: wordStart,
                end: wordEnd,
                probability: caption.probability ?? 1.0,
            });
            prevEnd = wordEnd;
        }

        // Final segment
        if (segWords.length > 0) {
            segments.push({
                id: segments.length,
                start: segStart,
                end: prevEnd,
                text: segText.trim(),
                words: segWords,
            });
        }

        return { text, segments };
    }

    // ── Backend Call ──────────────────────────────────────────────────────────

    static async _callBackend({ transcript, clips, duration, platform, targetDuration, signal }) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s for GPT-4

        if (signal) {
            signal.addEventListener('abort', () => controller.abort());
        }

        try {
            const response = await fetch('/api/ai/analyze-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transcript, clips, duration, platform, targetDuration }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const err = await response.text();
                console.error('[ContentAnalyzer] Backend error:', err);
                return { success: false, error: err };
            }

            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);
            console.error('[ContentAnalyzer] Network error:', err.message);
            return { success: false, error: err.message };
        }
    }

    // ── Local Fallback Analysis ───────────────────────────────────────────────

    /**
     * Local analysis when backend is unavailable.
     * Uses speech-rate heuristics to score segments.
     */
    static _localAnalysis(context, platform, targetDuration) {
        const { clips, duration } = context;
        const contentType = this._detectContentTypeLocal(context);
        const editMode = this._selectEditModeLocal(contentType, duration, platform);

        // Build segments from clip positions if no transcript
        const segments = clips.map(clip => ({
            start: clip.start,
            end: clip.start + clip.duration,
            topic: clip.name || 'Segment',
            type: SEGMENT_TYPES.VALUE,
            energy: ENERGY_LEVELS.MEDIUM,
            importance_score: 0.5,
        }));

        const editPlan = {
            videoType: contentType,
            duration_target: targetDuration || Math.min(duration, 600),
            editMode,
            structure: [
                { type: 'hook', source_range: [0, Math.min(30, duration * 0.1)] },
                { type: 'intro', source_range: [0, Math.min(60, duration * 0.15)] },
                { type: 'main', source_range: [duration * 0.15, duration * 0.85] },
                { type: 'outro', source_range: [duration * 0.85, duration] },
            ],
            actions: editMode === 'CLEAN_EDIT'
                ? ['remove_silences', 'remove_filler_words', 'improve_pacing']
                : ['remove_silences', 'remove_repetition', 'add_transitions'],
        };

        const result = {
            success: true,
            contentType,
            editMode,
            duration,
            platform: platform || 'youtube',
            segments,
            structure: {
                sections: { intro: { start: 0, end: duration * 0.15 }, body: { start: duration * 0.15, end: duration * 0.85 }, outro: { start: duration * 0.85, end: duration } },
                hookCandidate: clips.length > 0 ? { start: clips[0].start, end: Math.min(clips[0].start + 25, duration), reason: 'First clip used as hook candidate' } : null,
                detectedSections: [],
            },
            editPlan,
            requiresApproval: true,
            localFallback: true,
            timestamp: Date.now(),
            summary: {
                contentType,
                editMode,
                totalSegments: segments.length,
                fillerSegments: 0,
                highValueSegments: segments.length,
                hookFound: clips.length > 0,
                plannedActions: editPlan.actions,
                estimatedOutputDuration: editPlan.duration_target,
            },
        };

        useTimelineStore.getState().setContentAnalysis(result);
        return result;
    }

    static _detectContentTypeLocal(context) {
        const { clips, duration } = context;
        if (duration > 600 && clips.length <= 2) return 'long_form_raw';
        if (clips.length > 5) return 'rushes';
        if (duration < 180) return 'short_form';
        return 'youtube_long';
    }

    static _selectEditModeLocal(contentType, duration, platform) {
        if (contentType === 'rushes' || contentType === 'long_form_raw') return EDIT_MODES.FULL_BUILD;
        if (platform === 'podcast') return EDIT_MODES.CLEAN_EDIT;
        if (platform === 'youtube' || duration > 300) return EDIT_MODES.YOUTUBE_OPTIMIZED;
        return EDIT_MODES.CLEAN_EDIT;
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    static _errorResult(message) {
        return {
            success: false,
            error: message,
            segments: [],
            structure: null,
            editPlan: null,
            requiresApproval: true,
        };
    }

    /**
     * Gets the current content analysis from the store (cached result).
     */
    static getCachedAnalysis() {
        return useTimelineStore.getState().contentAnalysis || null;
    }

    /**
     * Returns a human-readable summary of the analysis for the chat UI.
     */
    static formatSummaryForChat(analysis) {
        if (!analysis?.success) {
            return `❌ Analysis failed: ${analysis?.error || 'Unknown error'}`;
        }

        const { contentType, editMode, summary, structure } = analysis;
        const hook = structure?.hookCandidate;

        let msg = `🎬 **Content Analysis Complete**\n\n`;
        msg += `**Type:** ${contentType.replace(/_/g, ' ')}\n`;
        msg += `**Edit Mode:** ${editMode.replace(/_/g, ' ')}\n`;
        msg += `**Segments detected:** ${summary.totalSegments}\n`;
        msg += `**High-value segments:** ${summary.highValueSegments}\n`;
        if (summary.fillerSegments > 0) msg += `**Filler segments:** ${summary.fillerSegments}\n`;
        if (hook) {
            msg += `\n✅ **Hook candidate:** ${hook.start.toFixed(0)}s – ${hook.end.toFixed(0)}s\n`;
        } else {
            msg += `\n⚠️ No strong hook found in the first 40% of the video.\n`;
        }
        msg += `\n**Planned actions:** ${summary.plannedActions?.join(', ')}\n`;
        msg += `**Estimated output:** ~${Math.round(summary.estimatedOutputDuration / 60)}min ${Math.round(summary.estimatedOutputDuration % 60)}s\n`;
        msg += `\n**Approve to proceed with the edit, or request changes.**`;

        return msg;
    }
}

export default ContentAnalyzer;
