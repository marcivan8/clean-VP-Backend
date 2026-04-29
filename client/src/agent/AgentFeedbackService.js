/**
 * AgentFeedbackService
 * Generates user-friendly feedback messages after edit operations.
 * 
 * Provides:
 * - Concise success/failure messages
 * - Next action suggestions
 * - Context-aware responses
 */
export class AgentFeedbackService {
    /**
     * Generate feedback based on operation results
     * @param {object} intent - Parsed intent
     * @param {object} plan - Edit plan
     * @param {object} executionResult - Result from execution
     * @param {object} validationResult - Result from validation
     * @returns {object} Feedback object with message and suggestions
     */
    static generateFeedback(intent, plan, executionResult, validationResult) {
        const operation = intent?.operation || plan?.intent_operation || 'unknown';
        const success = validationResult?.success ?? executionResult?.success;

        if (!success) {
            return this.generateFailureFeedback(operation, validationResult, executionResult);
        }

        return this.generateSuccessFeedback(operation, validationResult, executionResult);
    }

    /**
     * Generate success feedback
     */
    static generateSuccessFeedback(operation, validation, execution) {
        let message = '';
        let suggestions = [];

        switch (operation) {
            case 'split_clip': {
                const outputs = validation?.outputs || [];
                if (outputs.length >= 2) {
                    const part1 = outputs[0];
                    const part2 = outputs[1];
                    message = `✓ Split completed at ${part1?.end?.toFixed(1) || 'the midpoint'}s.\n` +
                        `Created two clips: ${part1?.duration?.toFixed(1) || '?'}s and ${part2?.duration?.toFixed(1) || '?'}s.`;
                } else {
                    message = '✓ Clip split successfully.';
                }
                suggestions = [
                    'Adjust the cut point',
                    'Delete one of the clips',
                    'Split again at another point'
                ];
                break;
            }

            case 'remove_clip': {
                message = '✓ Clip removed from timeline.';
                suggestions = [
                    'Undo if that was a mistake',
                    'Fill the gap with another clip',
                    'Continue editing'
                ];
                break;
            }

            case 'set_clip_speed': {
                const speed = validation?.outputs?.[0]?.speed;
                message = `✓ Clip speed set to ${speed}x.`;
                suggestions = [
                    'Adjust speed further',
                    'Reset to normal speed (1x)',
                    'Apply to other clips'
                ];
                break;
            }

            case 'set_aspect_ratio': {
                const ratio = validation?.outputs?.[0]?.aspectRatio;
                message = `✓ Aspect ratio changed to ${ratio}.`;
                suggestions = [
                    'Preview the result',
                    'Try a different ratio',
                    'Export the video'
                ];
                break;
            }

            case 'silence_removal': {
                message = '✓ Silence detection and removal complete.';
                suggestions = [
                    'Review the cuts in the timeline',
                    'Undo if pacing feels too tight'
                ];
                break;
            }

            case 'remove_filler_words': {
                message = '✓ Filler words removed from the timeline.';
                suggestions = [
                    'Review the cuts',
                    'Undo if it removed too much'
                ];
                break;
            }

            case 'undo_action': {
                message = '✓ Last action undone.';
                suggestions = [
                    'Continue editing',
                    'Redo if needed',
                    'Start fresh'
                ];
                break;
            }

            // ── Long-Form Intelligence Engine feedback ──────────────────────

            case 'analyze_structure': {
                const analysisData = execution?.analysisResult;
                if (analysisData?.success) {
                    message = AgentFeedbackService.formatAnalysisResult(analysisData);
                } else {
                    message = '✓ Content analysis complete. Review the plan below.';
                }
                suggestions = [
                    'Approve the edit plan to proceed',
                    'Request a different edit mode',
                    'Ask me to find the best hook'
                ];
                break;
            }

            case 'long_form_edit':
            case 'build_from_rushes': {
                const planData = execution?.editPlan;
                if (planData) {
                    message = AgentFeedbackService.formatEditPlanResult(planData);
                } else {
                    message = '✓ Long-form edit plan generated.';
                }
                suggestions = [
                    'Approve to execute the plan',
                    'Ask to adjust pacing or structure',
                    'Preview the hook first'
                ];
                break;
            }

            case 'find_hook': {
                const hook = execution?.hookCandidate;
                if (hook) {
                    message = `✓ **Hook found:** ${hook.start.toFixed(0)}s – ${hook.end.toFixed(0)}s\n\n`;
                    message += `📍 **Why:** ${hook.reason || 'Highest speech energy in the opening 40%'}\n`;
                    if (hook.segmentText) message += `💬 *"${hook.segmentText.slice(0, 120)}..."*`;
                } else {
                    message = '⚠️ No strong hook detected in the first 40% of the video. Consider recording a dedicated opening.';
                }
                suggestions = [
                    'Move hook to the beginning',
                    'Choose a different hook segment',
                    'Preview the hook'
                ];
                break;
            }

            case 'remove_repetition': {
                const removed = execution?.removedCount ?? 0;
                message = removed > 0
                    ? `✓ Removed ${removed} repetitive segment${removed !== 1 ? 's' : ''} from the timeline.`
                    : '✓ No significant repetitions detected.';
                suggestions = [
                    'Review the cleaned timeline',
                    'Undo if anything was removed incorrectly'
                ];
                break;
            }

            case 'reorder_segment': {
                message = '✓ Segment moved to new position in the timeline.';
                suggestions = [
                    'Preview the result',
                    'Undo if order doesn\'t feel right',
                    'Continue structural editing'
                ];
                break;
            }

            default: {
                message = '✓ Edit completed successfully.';
                suggestions = [
                    'Continue editing',
                    'Preview changes',
                    'Export when ready'
                ];
            }
        }

        return {
            message,
            suggestions,
            success: true,
            operation
        };
    }

    // ── Long-Form Specific Formatters ────────────────────────────────────────

    /**
     * Renders a rich content analysis result for the chat UI.
     */
    static formatAnalysisResult(analysis) {
        const { contentType, editMode, summary, structure, segments } = analysis;
        const hook = structure?.hookCandidate;

        let msg = `🎬 **Content Analysis Complete**\n\n`;
        msg += `| Field | Value |\n|---|---|\n`;
        msg += `| Content type | ${(contentType || '').replace(/_/g, ' ')} |\n`;
        msg += `| Edit mode | **${(editMode || '').replace(/_/g, ' ')}** |\n`;
        msg += `| Total segments | ${summary?.totalSegments || segments?.length || '—'} |\n`;
        if ((summary?.fillerSegments || 0) > 0) {
            msg += `| Filler segments | ${summary.fillerSegments} (will be removed) |\n`;
        }
        msg += `| High-value segments | ${summary?.highValueSegments || '—'} |\n`;
        msg += `| Est. output duration | ~${Math.round((summary?.estimatedOutputDuration || 0) / 60)}m ${Math.round((summary?.estimatedOutputDuration || 0) % 60)}s |\n\n`;

        if (hook) {
            msg += `✅ **Hook candidate:** ${hook.start.toFixed(0)}s – ${hook.end.toFixed(0)}s\n`;
            if (hook.reason) msg += `_${hook.reason}_\n`;
        } else {
            msg += `⚠️ No strong hook detected in first 40% of video.\n`;
        }

        if (analysis.requiresApproval) {
            msg += `\n---\n⚠️ **Approval required.** Type "approve" to execute the edit plan, or describe changes you'd like.`;
        }

        return msg;
    }

    /**
     * Renders a structural edit plan summary for the chat UI.
     */
    static formatEditPlanResult(editPlan) {
        let msg = `📋 **Long-Form Edit Plan Ready**\n\n`;
        msg += `**Mode:** ${(editPlan.editMode || '').replace(/_/g, ' ')}\n`;
        msg += `**Target duration:** ~${Math.round((editPlan.duration_target || 0) / 60)}m ${Math.round((editPlan.duration_target || 0) % 60)}s\n\n`;
        msg += `**Actions to be performed:**\n`;
        (editPlan.actions || []).forEach(a => {
            msg += `  • ${a.replace(/_/g, ' ')}\n`;
        });

        if (editPlan.requiresApproval) {
            msg += `\n---\n⚠️ **Ready to execute.** Type "approve" to proceed, or request changes.`;
        }

        return msg;
    }

    /**
     * Generate failure feedback
     */
    static generateFailureFeedback(operation, validation, execution) {
        const error = validation?.error || execution?.error || 'Unknown error';
        let message = '';
        let suggestions = [];

        // Make error message user-friendly
        if (error.includes('not found')) {
            message = `✗ Couldn't find the clip. Please select a clip first.`;
            suggestions = ['Select a clip in the timeline', 'Try again'];
        } else if (error.includes('outside clip bounds')) {
            message = `✗ Split point is outside the clip. Try a different position.`;
            suggestions = ['Move playhead inside the clip', 'Use "split at midpoint"'];
        } else if (error.includes('cancelled')) {
            message = `Operation was cancelled.`;
            suggestions = ['Try again', 'Choose a different action'];
        } else if (error.includes('timeout')) {
            message = `✗ Operation took too long and was stopped.`;
            suggestions = ['Try a simpler edit', 'Check your video file'];
        } else {
            message = `✗ Edit failed: ${error}`;
            suggestions = ['Try again', 'Rephrase your request'];
        }

        return {
            message,
            suggestions,
            success: false,
            operation,
            error
        };
    }

    /**
     * Format message for display in chat
     */
    static formatForChat(feedback) {
        let formatted = feedback.message + '\n\n';

        if (feedback.suggestions && feedback.suggestions.length > 0) {
            formatted += 'What would you like to do next?\n';
            feedback.suggestions.forEach((suggestion, i) => {
                formatted += `• ${suggestion}\n`;
            });
        }

        return formatted.trim();
    }
}

export default AgentFeedbackService;
