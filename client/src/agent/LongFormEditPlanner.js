/**
 * LongFormEditPlanner Agent — Long-Form Video Intelligence Engine
 *
 * Implements Steps 4–5 of the Long-Form Spec:
 *   4. Edit Mode Selection — classifies as FULL_BUILD / CLEAN_EDIT / YOUTUBE_OPTIMIZED
 *   5. Structural Edit Plan — translates ContentAnalyzer output into atomic EditPlanner steps
 *
 * FIX: Replaced CommonJS require() with a top-level ES module import.
 *      require() is not available in Vite/ESM browser builds and crashed every
 *      long_form_edit operation in production.
 */

import useTimelineStore from '../store/useTimelineStore.js';
import { EDIT_MODES } from './ContentAnalyzer.js';
// FIX: was `const { AgentFeedbackService } = require('./AgentFeedbackService.js')` inside
//      _buildApprovalMessage(). require() is undefined in ESM — moved to top-level import.
import { AgentFeedbackService } from './AgentFeedbackService.js';

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
     * Step 2: remove_repeated_takes   — cuts "let me say that again" moments
     * Step 3: remove_filler_words     — only if filler density > 15%
     * Step 4: identify_quotable_moments — surfaces best standalone clips (no edits)
     * Step 5: normalize_audio
     * Step 6: denoise_audio
     */
    static _cleanEditSteps(editPlan, state, segments, S) {
        const steps = [];

        steps.push(S('silence_removal', {
            threshold: '-30dB',
            min_duration: 0.8,
            padding: 0.15,
            reason: 'Remove dead air while preserving natural speech rhythm',
        }));

        steps.push(S('remove_repeated_takes', {
            lookback_window: 60,
            similarity_threshold: 0.72,
            reason: 'Cut restart moments and repeated takes',
        }));

        const fillerCount = segments.filter(s => s.type === 'filler').length;
        const fillerDensity = segments.length > 0 ? fillerCount / segments.length : 0;

        if (fillerDensity > 0.15 || (editPlan?.actions || []).includes('remove_filler_words')) {
            steps.push(S('remove_filler_words', {
                reason: `Remove ums, uhs, and filler phrases (filler density: ${Math.round(fillerDensity * 100)}%)`,
            }));
        } else {
            console.log(`[LongFormEditPlanner] Skipping filler removal — density ${Math.round(fillerDensity * 100)}% is below 15% threshold`);
        }

        steps.push(S('identify_quotable_moments', {
            min_duration: 15,
            max_duration: 90,
            min_importance: 0.6,
            max_results: 5,
            reason: 'Surface the best standalone clips for repurposing (no edits made)',
        }));

        steps.push(S('normalize_audio', {
            reason: 'Ensure consistent loudness throughout',
        }));

        steps.push(S('denoise_audio', {
            reason: 'Remove background hiss and noise',
        }));

        return steps;
    }

    // ── YOUTUBE_OPTIMIZED ─────────────────────────────────────────────────────

    static _youtubeOptimizedSteps(editPlan, segments, structure, state, S) {
        const steps = [];
        const hookCandidate = structure?.hookCandidate;

        steps.push(S('silence_removal', {
            threshold: '-30dB',
            min_duration: 0.8,
            padding: 0.15,
            reason: 'Clean audio while preserving natural speaking rhythm',
        }));

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

        if ((editPlan?.actions || []).includes('add_transitions')) {
            steps.push(S('add_transitions_to_sections', {
                type: 'fade',
                duration: 0.5,
                apply_at: 'section_boundaries',
                reason: 'Smooth transitions between main content sections',
            }));
        }

        steps.push(S('normalize_audio', { reason: 'Final audio normalization' }));

        return steps;
    }

    // ── FULL_BUILD ────────────────────────────────────────────────────────────

    static _fullBuildSteps(editPlan, segments, structure, state, S) {
        const steps = [];
        const hookCandidate = structure?.hookCandidate;

        steps.push(S('silence_removal', {
            threshold: '-25dB',
            min_duration: 0.5,
            padding: 0.05,
            reason: 'Aggressive silence removal for raw rushes',
        }));

        steps.push(S('remove_filler_words', {
            reason: 'Remove all filler words from raw footage',
        }));

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

        const lowValue = segments.filter(s => (s.importance_score ?? 1) < 0.25 || s.type === 'filler');
        lowValue.forEach(seg => {
            steps.push(S('cut_segment', {
                start: seg.start,
                end: seg.end,
                reason: `Remove: "${seg.topic || 'low-value'}" (importance: ${seg.importance_score ?? 0})`,
            }));
        });

        steps.push(S('identify_quotable_moments', {
            min_duration: 15,
            max_duration: 90,
            min_importance: 0.6,
            max_results: 5,
            reason: 'Surface best standalone clips for repurposing',
        }));

        steps.push(S('add_transitions_to_sections', {
            type: 'dissolve',
            duration: 0.3,
            apply_at: 'all_cuts',
            reason: 'Smooth narrative flow for full build',
        }));

        steps.push(S('normalize_audio', { reason: 'Master output audio normalization' }));

        return steps;
    }

    // ── Approval Message ──────────────────────────────────────────────────────

    /**
     * Builds the human-readable approval message shown to user before execution.
     * FIX: Was using CommonJS require() inside this method which crashes in ESM.
     *      Now uses the top-level imported AgentFeedbackService directly.
     */
    static _buildApprovalMessage(editMode, editPlan, segments, structure) {
        try {
            const state = useTimelineStore.getState();
            const mockPlan = {
                steps: this._buildAtomicSteps(
                    editMode,
                    editPlan,
                    segments || [],
                    structure,
                    state
                ),
            };

            return AgentFeedbackService.generatePreExecutionBrief(mockPlan, {
                segments,
                structure,
                editMode,
            });
        } catch (_) {
            return this._buildApprovalMessageFallback(editMode, editPlan, segments, structure);
        }
    }

    /** Fallback approval message */
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