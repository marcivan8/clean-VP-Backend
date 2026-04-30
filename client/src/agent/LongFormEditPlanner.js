/**
 * LongFormEditPlanner Agent — Long-Form Video Intelligence Engine
 *
 * Implements Steps 4–5 of the Long-Form Spec:
 *   4. Edit Mode Selection — classifies as FULL_BUILD / CLEAN_EDIT / YOUTUBE_OPTIMIZED
 *   5. Structural Edit Plan — translates ContentAnalyzer output into atomic EditPlanner steps
 *
 * Changes in this version:
 * - _cleanEditSteps() expanded from 4 → 6 steps with real editorial logic
 *   • More conservative silence threshold (preserves intentional pauses)
 *   • remove_repeated_takes step (new)
 *   • Filler removal is conditional on filler density > 15%
 *   • identify_quotable_moments step (new — analysis only, surfaces best clips)
 * - _buildApprovalMessage() delegates to AgentFeedbackService.generatePreExecutionBrief()
 */

import useTimelineStore from '../store/useTimelineStore.js';
import { EDIT_MODES } from './ContentAnalyzer.js';

export class LongFormEditPlanner {
    /**
     * Generate a complete long-form edit plan from a ContentAnalyzer result.
     *
     * @param {object} analysisResult - From ContentAnalyzer.analyze()
     * @param {object} [options]
     * @param {string} [options.platform]
     * @param {number} [options.targetDuration]
     * @returns {AtomicPlan}
     */
    static generatePlan(analysisResult, options = {}) {
        if (!analysisResult?.success) {
            return this._errorPlan('No valid content analysis available. Run content analysis first.');
        }

        const { editMode, editPlan, segments, structure, contentType } = analysisResult;
        const state = useTimelineStore.getState();
        const planId = this._generatePlanId();

        console.log(`[LongFormEditPlanner] Building atomic plan for mode: ${editMode}`);

        const steps = this._buildAtomicSteps(editMode, editPlan, segments, structure, state);

        const plan = {
            plan_id: planId,
            operation: 'long_form_edit',
            step_count: steps.length,
            steps,
            structuralPlan: editPlan,
            contentType,
            editMode,
            requiresApproval: true,
            approvalMessage: this._buildApprovalMessage(editMode, editPlan, segments || [], structure),
        };

        console.log(`[LongFormEditPlanner] Plan ready: ${steps.length} steps, requiresApproval: true`);
        return plan;
    }

    // ── Step Builder by Edit Mode ─────────────────────────────────────────────

    static _buildAtomicSteps(editMode, editPlan, segments, structure, state) {
        const steps = [];
        let stepNum = 1;
        const S = (action, params) => ({
            step_id: `step_${stepNum++}`,
            action,
            ...params,
        });

        // Always reset to start
        steps.push(S('seek_to', { time: 0, reason: 'Reset to start before editing' }));

        switch (editMode) {
            case EDIT_MODES.CLEAN_EDIT:
                steps.push(...this._cleanEditSteps(editPlan, state, segments || [], S));
                break;
            case EDIT_MODES.YOUTUBE_OPTIMIZED:
                steps.push(...this._youtubeOptimizedSteps(editPlan, segments || [], structure, state, S));
                break;
            case EDIT_MODES.FULL_BUILD:
                steps.push(...this._fullBuildSteps(editPlan, segments || [], structure, state, S));
                break;
            default:
                steps.push(...this._cleanEditSteps(editPlan, state, segments || [], S));
        }

        return steps;
    }

    // ── CLEAN_EDIT ────────────────────────────────────────────────────────────
    /**
     * CLEAN_EDIT mode — podcast / interview / talking-head recording.
     *
     * Step 1: silence_removal         — conservative threshold, preserves natural pauses
     * Step 2: remove_repeated_takes   — NEW: cuts "let me say that again" moments
     * Step 3: remove_filler_words     — only if filler density > 15%
     * Step 4: identify_quotable_moments — NEW: surfaces best standalone clips (no edits)
     * Step 5: normalize_audio
     * Step 6: denoise_audio
     */
    static _cleanEditSteps(editPlan, state, segments, S) {
        const steps = [];

        // Step 1: Silence removal — more conservative than default
        // min_duration 0.8s (vs 0.5s default) to avoid cutting natural sentence pauses.
        // padding 0.15s keeps a little breathing room at cut edges.
        steps.push(S('silence_removal', {
            threshold: '-30dB',
            min_duration: 0.8,
            padding: 0.15,
            reason: 'Remove dead air while preserving natural speech rhythm',
        }));

        // Step 2: Repeated takes removal (NEW)
        // Detects moments where the speaker restarts mid-sentence or restates the
        // same idea within 60 seconds ("let me start that again", repeated openings).
        // Routes to ENGINE.API → /api/ai/detect-repeated-takes.
        // If the backend endpoint doesn't exist yet, CommandCompiler's fallback
        // compiles this as a no-op store action with a warning — won't crash.
        steps.push(S('remove_repeated_takes', {
            lookback_window: 60,   // seconds — how far back to check for repeats
            similarity_threshold: 0.72,  // 0–1, how similar two passages must be
            reason: 'Cut restart moments and repeated takes',
        }));

        // Step 3: Filler word removal — conditional on density
        // Only run if >15% of segments are filler-type to avoid over-cutting
        // natural speech in conversational recordings.
        const fillerCount = segments.filter(s => s.type === 'filler').length;
        const fillerDensity = segments.length > 0 ? fillerCount / segments.length : 0;

        if (fillerDensity > 0.15 || (editPlan?.actions || []).includes('remove_filler_words')) {
            steps.push(S('remove_filler_words', {
                reason: `Remove ums, uhs, and filler phrases (filler density: ${Math.round(fillerDensity * 100)}%)`,
            }));
        } else {
            console.log(`[LongFormEditPlanner] Skipping filler removal — density ${Math.round(fillerDensity * 100)}% is below 15% threshold`);
        }

        // Step 4: Identify quotable moments (NEW — analysis only, zero edits)
        // Finds top 3-5 segments with highest importance_score and duration 15-90s.
        // Result is stored in the content analysis cache as quotableMoments[].
        // The UI can surface these as "best clips" for repurposing.
        steps.push(S('identify_quotable_moments', {
            min_duration: 15,   // seconds
            max_duration: 90,   // seconds
            min_importance: 0.6,  // importance_score threshold
            max_results: 5,
            reason: 'Surface the best standalone clips for repurposing (no edits made)',
        }));

        // Step 5: Normalize audio
        steps.push(S('normalize_audio', {
            reason: 'Ensure consistent loudness throughout',
        }));

        // Step 6: Denoise
        steps.push(S('denoise_audio', {
            reason: 'Remove background hiss and noise',
        }));

        return steps;
    }

    // ── YOUTUBE_OPTIMIZED ─────────────────────────────────────────────────────

    static _youtubeOptimizedSteps(editPlan, segments, structure, state, S) {
        const steps = [];
        const hookCandidate = structure?.hookCandidate;

        // Step 1: Silence removal — less aggressive for YouTube (preserve natural pacing)
        steps.push(S('silence_removal', {
            threshold: '-30dB',
            min_duration: 0.8,
            padding: 0.15,
            reason: 'Clean audio while preserving natural speaking rhythm',
        }));

        // Step 2: Move hook to the beginning if it's not already there
        if (hookCandidate && hookCandidate.start > 5) {
            const videoTrack = state.tracks?.find(t => t.type === 'video');
            const hookClip = videoTrack?.clips?.find(c =>
                c.start <= hookCandidate.start &&
                (c.start + c.duration) >= hookCandidate.end
            );

            if (hookClip) {
                steps.push(S('reorder_segment', {
                    clipId: hookClip.id,
                    trackId: videoTrack.id,
                    targetPosition: 0,
                    reason: `Move hook (${hookCandidate.start.toFixed(0)}s–${hookCandidate.end.toFixed(0)}s) to the beginning`,
                }));
            }
        }

        // Step 3: Remove low-value / filler segments
        if ((editPlan?.actions || []).includes('remove_repetition')) {
            const fillerSegs = segments.filter(s => s.type === 'filler' || (s.importance_score ?? 1) < 0.3);
            fillerSegs.forEach(seg => {
                steps.push(S('cut_segment', {
                    start: seg.start,
                    end: seg.end,
                    reason: `Remove low-value segment: "${seg.topic || 'filler'}" (score: ${seg.importance_score ?? 0})`,
                }));
            });
        }

        // Step 4: Add transitions at section boundaries
        if ((editPlan?.actions || []).includes('add_transitions')) {
            steps.push(S('add_transitions_to_sections', {
                type: 'fade',
                duration: 0.5,
                apply_at: 'section_boundaries',
                reason: 'Smooth transitions between main content sections',
            }));
        }

        // Step 5: Normalize audio
        steps.push(S('normalize_audio', { reason: 'Final audio normalization' }));

        return steps;
    }

    // ── FULL_BUILD ────────────────────────────────────────────────────────────

    static _fullBuildSteps(editPlan, segments, structure, state, S) {
        const steps = [];
        const hookCandidate = structure?.hookCandidate;

        // Step 1: Aggressive silence removal for raw rushes
        steps.push(S('silence_removal', {
            threshold: '-25dB',
            min_duration: 0.5,
            padding: 0.05,
            reason: 'Aggressive silence removal for raw rushes',
        }));

        // Step 2: Remove filler words
        steps.push(S('remove_filler_words', {
            reason: 'Remove all filler words from raw footage',
        }));

        // Step 3: Move hook to front
        if (hookCandidate) {
            const videoTrack = state.tracks?.find(t => t.type === 'video');
            const hookClip = videoTrack?.clips?.find(c =>
                c.start <= hookCandidate.start &&
                (c.start + c.duration) >= hookCandidate.end
            );
            if (hookClip) {
                steps.push(S('reorder_segment', {
                    clipId: hookClip.id,
                    trackId: videoTrack?.id,
                    targetPosition: 0,
                    reason: `Position hook at start: "${hookCandidate.reason}"`,
                }));
            }
        }

        // Step 4: Remove low-value segments
        const lowValue = segments.filter(s => (s.importance_score ?? 1) < 0.25 || s.type === 'filler');
        lowValue.forEach(seg => {
            steps.push(S('cut_segment', {
                start: seg.start,
                end: seg.end,
                reason: `Remove: "${seg.topic || 'low-value'}" (importance: ${seg.importance_score ?? 0})`,
            }));
        });

        // Step 5: Identify quotable moments
        steps.push(S('identify_quotable_moments', {
            min_duration: 15,
            max_duration: 90,
            min_importance: 0.6,
            max_results: 5,
            reason: 'Surface best standalone clips for repurposing',
        }));

        // Step 6: Transitions
        steps.push(S('add_transitions_to_sections', {
            type: 'dissolve',
            duration: 0.3,
            apply_at: 'all_cuts',
            reason: 'Smooth narrative flow for full build',
        }));

        // Step 7: Final normalization
        steps.push(S('normalize_audio', { reason: 'Master output audio normalization' }));

        return steps;
    }

    // ── Approval Message ──────────────────────────────────────────────────────

    /**
     * Builds the human-readable approval message shown to user before execution.
     * Delegates to AgentFeedbackService.generatePreExecutionBrief() for a
     * canonical, consistent format across the codebase.
     */
    static _buildApprovalMessage(editMode, editPlan, segments, structure) {
        // Lazy import to avoid circular dependency
        // AgentFeedbackService imports from this file indirectly in some paths
        try {
            // Build a minimal plan shape for the brief generator
            const mockPlan = {
                steps: this._buildAtomicSteps(
                    editMode,
                    editPlan,
                    segments || [],
                    structure,
                    useTimelineStore.getState()
                ),
            };

            // AgentFeedbackService.generatePreExecutionBrief is a static method
            // added in the updated AgentFeedbackService.js
            const { AgentFeedbackService } = require('./AgentFeedbackService.js');
            return AgentFeedbackService.generatePreExecutionBrief(mockPlan, {
                segments,
                structure,
                editMode,
            });
        } catch (_) {
            // Fallback if circular import or require isn't available
            return this._buildApprovalMessageFallback(editMode, editPlan, segments, structure);
        }
    }

    /** Fallback approval message (same as original implementation) */
    static _buildApprovalMessageFallback(editMode, editPlan, segments, structure) {
        const hook = structure?.hookCandidate;
        const fillerCount = (segments || []).filter(s => s.type === 'filler' || (s.importance_score ?? 1) < 0.3).length;
        const totalSecs = editPlan?.duration_target || 0;
        const mins = Math.floor(totalSecs / 60);
        const secs = Math.round(totalSecs % 60);

        let msg = `📋 **Long-Form Edit Plan Ready**\n\n`;
        msg += `**Mode:** ${(editMode || '').replace(/_/g, ' ')}\n`;
        msg += `**Target duration:** ~${mins}m ${secs}s\n\n`;
        msg += `**Planned actions:**\n`;
        (editPlan?.actions || []).forEach(a => { msg += `  • ${a.replace(/_/g, ' ')}\n`; });

        if (hook) {
            msg += `\n**Hook detected:** ${hook.start.toFixed(0)}s–${hook.end.toFixed(0)}s will be moved to the beginning.\n`;
        }
        if (fillerCount > 0) {
            msg += `**Segments to remove:** ${fillerCount} low-value or filler segments.\n`;
        }
        msg += `\n⚠️ This will modify your timeline. **Approve to execute** or request changes first.`;
        return msg;
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    static _generatePlanId() {
        return `longform_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    static _errorPlan(error) {
        return {
            plan_id: null,
            operation: 'long_form_edit',
            step_count: 0,
            steps: [],
            error,
            requiresApproval: true,
        };
    }

    static selectEditMode(contentType, duration, platform) {
        if (contentType === 'rushes' || contentType === 'long_form_raw') return EDIT_MODES.FULL_BUILD;
        if (contentType === 'podcast' || contentType === 'interview') return EDIT_MODES.CLEAN_EDIT;
        if (platform === 'youtube' || (duration > 300 && contentType === 'youtube_long')) return EDIT_MODES.YOUTUBE_OPTIMIZED;
        return EDIT_MODES.CLEAN_EDIT;
    }
}

export default LongFormEditPlanner;