/**
 * LongFormEditPlanner Agent — Long-Form Video Intelligence Engine
 *
 * Implements Steps 4–5 of the Long-Form Spec:
 *   4. Edit Mode Selection — classifies as FULL_BUILD / CLEAN_EDIT / YOUTUBE_OPTIMIZED
 *   5. Structural Edit Plan — translates ContentAnalyzer output into atomic EditPlanner steps
 *
 * This agent NEVER executes edits directly.
 * It generates an atomic plan that AgentOrchestrator can execute after USER APPROVAL.
 *
 * Integration:
 *   ContentAnalyzer → LongFormEditPlanner → EditPlanner (atomic steps) → AgentOrchestrator → VideoEditorTools
 */

import useTimelineStore from '../store/useTimelineStore.js';
import { EDIT_MODES } from './ContentAnalyzer.js';

/**
 * @typedef {Object} StructuralPlan
 * @property {string} videoType - Content type
 * @property {number} duration_target - Target output duration in seconds
 * @property {string} editMode - FULL_BUILD | CLEAN_EDIT | YOUTUBE_OPTIMIZED
 * @property {Array<StructuralSection>} structure - Ordered structural sections
 * @property {string[]} actions - High-level action list
 */

/**
 * @typedef {Object} AtomicPlan
 * @property {string} plan_id
 * @property {string} operation
 * @property {number} step_count
 * @property {Array<AtomicStep>} steps
 * @property {StructuralPlan} structuralPlan - Original structural plan for UI display
 * @property {boolean} requiresApproval - Always true
 */

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

        // Translate structural plan into atomic steps
        const steps = this._buildAtomicSteps(editMode, editPlan, segments, structure, state);

        const plan = {
            plan_id: planId,
            operation: 'long_form_edit',
            step_count: steps.length,
            steps,
            structuralPlan: editPlan,
            contentType,
            editMode,
            requiresApproval: true, // Always — user must approve before any execution
            approvalMessage: this._buildApprovalMessage(editMode, editPlan, segments, structure),
        };

        console.log(`[LongFormEditPlanner] Plan ready: ${steps.length} steps, requiresApproval: true`);
        return plan;
    }

    // ── Step Builder by Edit Mode ─────────────────────────────────────────────

    /**
     * Translates a structural edit plan + segment data into ordered atomic steps.
     */
    static _buildAtomicSteps(editMode, editPlan, segments, structure, state) {
        const steps = [];
        let stepNum = 1;
        const S = (action, params) => ({
            step_id: `step_${stepNum++}`,
            action,
            ...params,
        });

        // ── Common: Seek to start ────────────────────────────────────────────
        steps.push(S('seek_to', { time: 0, reason: 'Reset to start before editing' }));

        switch (editMode) {
            case EDIT_MODES.CLEAN_EDIT:
                steps.push(...this._cleanEditSteps(editPlan, state, S));
                break;

            case EDIT_MODES.YOUTUBE_OPTIMIZED:
                steps.push(...this._youtubeOptimizedSteps(editPlan, segments, structure, state, S));
                break;

            case EDIT_MODES.FULL_BUILD:
                steps.push(...this._fullBuildSteps(editPlan, segments, structure, state, S));
                break;

            default:
                steps.push(...this._cleanEditSteps(editPlan, state, S));
        }

        return steps;
    }

    /**
     * CLEAN_EDIT mode: Remove silences + filler words + normalize audio.
     * Best for podcasts and interviews.
     */
    static _cleanEditSteps(editPlan, state, S) {
        const steps = [];
        const threshold = '-30dB';

        // Step 1: Remove silences
        if (editPlan.actions?.includes('remove_silences')) {
            steps.push(S('silence_removal', {
                threshold,
                min_duration: 0.5,
                padding: 0.1,
                reason: 'Remove dead air from podcast/interview',
            }));
        }

        // Step 2: Remove filler words
        if (editPlan.actions?.includes('remove_filler_words') || editPlan.actions?.includes('remove_repetition')) {
            steps.push(S('remove_filler_words', {
                reason: 'Remove ums, uhs, and repeated phrases',
            }));
        }

        // Step 3: Normalize audio
        steps.push(S('normalize_audio', {
            reason: 'Ensure consistent loudness throughout',
        }));

        // Step 4: Apply audio denoise if clean edit
        steps.push(S('denoise_audio', {
            reason: 'Remove background hiss and noise',
        }));

        return steps;
    }

    /**
     * YOUTUBE_OPTIMIZED mode: Hook first, structured sections, dynamic pacing.
     */
    static _youtubeOptimizedSteps(editPlan, segments, structure, state, S) {
        const steps = [];
        const hookCandidate = structure?.hookCandidate;

        // Step 1: Remove silences (always first for clean audio)
        steps.push(S('silence_removal', {
            threshold: '-30dB',
            min_duration: 0.8, // Less aggressive for YouTube — preserve natural pauses
            padding: 0.15,
            reason: 'Clean audio while preserving natural speaking rhythm',
        }));

        // Step 2: If hook is not at the start, reorder to put it first
        if (hookCandidate && hookCandidate.start > 5) {
            const videoTrack = state.tracks?.find(t => t.type === 'video');
            const hookClip = videoTrack?.clips?.find(c =>
                c.start <= hookCandidate.start && (c.start + c.duration) >= hookCandidate.end
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

        // Step 3: Remove repetitive segments (low importance_score)
        if (editPlan.actions?.includes('remove_repetition')) {
            const fillerSegments = segments.filter(s => s.type === 'filler' || s.importance_score < 0.3);
            fillerSegments.forEach(seg => {
                steps.push(S('cut_segment', {
                    start: seg.start,
                    end: seg.end,
                    reason: `Remove low-value segment: "${seg.topic}" (score: ${seg.importance_score})`,
                }));
            });
        }

        // Step 4: Add transitions between sections
        if (editPlan.actions?.includes('add_transitions')) {
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

    /**
     * FULL_BUILD mode: Reconstruct narrative from raw rushes.
     * Reorders segments, removes filler, builds structured output.
     */
    static _fullBuildSteps(editPlan, segments, structure, state, S) {
        const steps = [];

        // Step 1: Heavy silence removal
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

        // Step 3: Sort segments by importance (high-value segments first)
        const sortedSegments = [...segments]
            .filter(s => s.type !== 'filler' && s.importance_score >= 0.3)
            .sort((a, b) => b.importance_score - a.importance_score);

        // Step 4: Identify hook from structure (highest energy early segment)
        const hookCandidate = structure?.hookCandidate;
        if (hookCandidate) {
            const videoTrack = state.tracks?.find(t => t.type === 'video');
            const hookClip = videoTrack?.clips?.find(c =>
                c.start <= hookCandidate.start && (c.start + c.duration) >= hookCandidate.end
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

        // Step 5: Remove low-value and filler segments
        const lowValueSegments = segments.filter(s => s.importance_score < 0.25 || s.type === 'filler');
        lowValueSegments.forEach(seg => {
            steps.push(S('cut_segment', {
                start: seg.start,
                end: seg.end,
                reason: `Remove: "${seg.topic}" (importance: ${seg.importance_score})`,
            }));
        });

        // Step 6: Add transitions
        steps.push(S('add_transitions_to_sections', {
            type: 'dissolve',
            duration: 0.3,
            apply_at: 'all_cuts',
            reason: 'Smooth narrative flow for full build',
        }));

        // Step 7: Final audio normalization
        steps.push(S('normalize_audio', { reason: 'Master output audio normalization' }));

        return steps;
    }

    // ── Approval Message ──────────────────────────────────────────────────────

    /**
     * Builds the human-readable approval message shown to user before execution.
     */
    static _buildApprovalMessage(editMode, editPlan, segments, structure) {
        const hook = structure?.hookCandidate;
        const fillerCount = segments.filter(s => s.type === 'filler' || s.importance_score < 0.3).length;
        const totalSecs = editPlan?.duration_target || 0;
        const mins = Math.floor(totalSecs / 60);
        const secs = Math.round(totalSecs % 60);

        let msg = `📋 **Long-Form Edit Plan Ready**\n\n`;
        msg += `**Mode:** ${editMode.replace(/_/g, ' ')}\n`;
        msg += `**Target duration:** ~${mins}m ${secs}s\n\n`;

        msg += `**Planned actions:**\n`;
        (editPlan?.actions || []).forEach(a => {
            msg += `  • ${a.replace(/_/g, ' ')}\n`;
        });

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

    /**
     * Select edit mode from content type + platform hint.
     * Exposed as a static helper for IntentParser.
     */
    static selectEditMode(contentType, duration, platform) {
        if (contentType === 'rushes' || contentType === 'long_form_raw') return EDIT_MODES.FULL_BUILD;
        if (contentType === 'podcast' || contentType === 'interview') return EDIT_MODES.CLEAN_EDIT;
        if (platform === 'youtube' || (duration > 300 && contentType === 'youtube_long')) return EDIT_MODES.YOUTUBE_OPTIMIZED;
        return EDIT_MODES.CLEAN_EDIT;
    }
}

export default LongFormEditPlanner;
