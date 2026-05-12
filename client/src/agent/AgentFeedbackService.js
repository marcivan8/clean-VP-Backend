/**
 * AgentFeedbackService
 * Generates user-friendly feedback messages after edit operations.
 *
 * FIX: long_form_edit success message now reflects actual execution ("applied")
 *      rather than just plan generation ("generated"), and suggestions are
 *      updated accordingly.
 */
export class AgentFeedbackService {
    /**
     * Generate feedback based on operation results
     */
    static generateFeedback(intent, plan, executionResult, validationResult) {
        const operation = intent?.operation || plan?.intent_operation || 'unknown';
        const success = validationResult?.success ?? executionResult?.success;

        if (!success) {
            return this.generateFailureFeedback(operation, validationResult, executionResult);
        }
        return this.generateSuccessFeedback(operation, validationResult, executionResult);
    }

    // ── Pre-Execution Brief ───────────────────────────────────────────────────

    /**
     * Generate a markdown brief of what the AI is about to do.
     * Called BEFORE execution so the user can approve or adjust.
     *
     * @param {object} plan - The edit plan (has plan.steps[])
     * @param {object|null} analysisResult - Cached ContentAnalyzer result (may be null)
     * @returns {string} Markdown string
     */
    static generatePreExecutionBrief(plan, analysisResult) {
        const steps = plan?.steps || [];
        const segments = analysisResult?.segments || [];
        const structure = analysisResult?.structure || null;
        const editMode = analysisResult?.editMode || null;

        // Count what's being removed
        const silenceSteps = steps.filter(s => s.action === 'silence_removal');
        const fillerSteps = steps.filter(s => s.action === 'remove_filler_words');
        const repeatSteps = steps.filter(s => s.action === 'remove_repeated_takes');
        const cutSegSteps = steps.filter(s => s.action === 'cut_segment');
        const reorderSteps = steps.filter(s => s.action === 'reorder_segment');
        const normalizeSteps = steps.filter(s => s.action === 'normalize_audio' || s.action === 'denoise_audio');

        const fillerSegCount = segments.filter(s => s.type === 'filler').length;
        const lowValueSegCount = segments.filter(s => (s.importance_score ?? 1) < 0.3 && s.type !== 'filler').length;
        const totalCutSec = cutSegSteps.reduce((sum, s) => sum + ((s.end || 0) - (s.start || 0)), 0);
        const hook = structure?.hookCandidate;

        let brief = `## Here's what I'm going to do\n\n`;

        const removals = [];

        if (silenceSteps.length > 0) {
            removals.push(`Silent gaps and dead air (threshold: ${silenceSteps[0].threshold || '-30dB'}, min ${silenceSteps[0].min_duration || 0.5}s)`);
        }
        if (repeatSteps.length > 0) {
            removals.push(`Repeated takes and restart moments`);
        }
        if (fillerSteps.length > 0) {
            const density = fillerSegCount > 0 && segments.length > 0
                ? ` (~${Math.round((fillerSegCount / segments.length) * 100)}% filler density)`
                : '';
            removals.push(`Filler words — ums, uhs, and filler phrases${density}`);
        }
        if (cutSegSteps.length > 0) {
            const durStr = totalCutSec > 0 ? ` (~${this._formatSeconds(Math.round(totalCutSec))} total)` : '';
            removals.push(`${cutSegSteps.length} low-value segment${cutSegSteps.length !== 1 ? 's' : ''}${durStr}`);
        }
        if (lowValueSegCount > 0 && cutSegSteps.length === 0) {
            removals.push(`${lowValueSegCount} low-importance segment${lowValueSegCount !== 1 ? 's' : ''} flagged by analysis`);
        }

        if (removals.length > 0) {
            brief += `**Removing:**\n`;
            removals.forEach(r => { brief += `- ${r}\n`; });
            brief += '\n';
        }

        const keepingParts = [];
        if (segments.length > 0) {
            const keptCount = segments.filter(s => (s.importance_score ?? 1) >= 0.3).length;
            if (keptCount > 0) {
                keepingParts.push(`${keptCount} segment${keptCount !== 1 ? 's' : ''} scoring ≥ 0.3 importance`);
            }
        }
        if (keepingParts.length > 0) {
            brief += `**Keeping:** ${keepingParts.join(', ')}\n\n`;
        }

        if (hook && reorderSteps.length > 0) {
            brief += `**Hook:** Moving ${hook.start.toFixed(0)}s–${hook.end.toFixed(0)}s to the beginning`;
            if (hook.reason) brief += ` _(${hook.reason})_`;
            brief += '\n\n';
        }

        if (normalizeSteps.length > 0) {
            brief += `**Audio:** Normalizing levels and removing background noise\n\n`;
        }

        if (editMode) {
            brief += `**Edit mode:** ${editMode.replace(/_/g, ' ')}\n\n`;
        }

        brief += `**Total steps:** ${steps.length}\n\n`;
        brief += `---\n`;
        brief += `⚠️ This will modify your timeline. Type **approve** to proceed, or tell me what to change.`;

        return brief;
    }

    // ── Success Feedback ─────────────────────────────────────────────────────

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
                suggestions = ['Adjust the cut point', 'Delete one of the clips', 'Split again at another point'];
                break;
            }
            case 'remove_clip': {
                message = '✓ Clip removed from timeline.';
                suggestions = ['Undo if that was a mistake', 'Fill the gap with another clip', 'Continue editing'];
                break;
            }
            case 'set_clip_speed': {
                const speed = validation?.outputs?.[0]?.speed;
                message = `✓ Clip speed set to ${speed}x.`;
                suggestions = ['Adjust speed further', 'Reset to normal speed (1x)', 'Apply to other clips'];
                break;
            }
            case 'set_aspect_ratio': {
                const ratio = validation?.outputs?.[0]?.aspectRatio;
                message = `✓ Aspect ratio changed to ${ratio}.`;
                suggestions = ['Preview the result', 'Try a different ratio', 'Export the video'];
                break;
            }
            case 'silence_removal': {
                message = '✓ Silence detection and removal complete.';
                suggestions = ['Review the cuts in the timeline', 'Undo if pacing feels too tight'];
                break;
            }
            case 'remove_filler_words': {
                message = '✓ Filler words removed from the timeline.';
                suggestions = ['Review the cuts', 'Undo if it removed too much'];
                break;
            }
            case 'undo_action': {
                message = '✓ Last action undone.';
                suggestions = ['Continue editing', 'Redo if needed', 'Start fresh'];
                break;
            }

            // ── Long-Form Intelligence Engine ─────────────────────────────────

            case 'analyze_structure': {
                const analysisData = execution?.analysisResult;
                if (analysisData?.success) {
                    message = AgentFeedbackService.formatAnalysisResult(analysisData);
                } else {
                    message = '✓ Content analysis complete. Review the plan below.';
                }
                suggestions = ['Ask me to edit the clip', 'Request a different edit mode', 'Ask me to find the best hook'];
                break;
            }

            case 'long_form_edit':
            case 'build_from_rushes': {
                // FIX: execution now contains results from actual step execution,
                // not just a plan. Reflect that in the message.
                const stepResults = execution?.results || [];
                const successCount = stepResults.filter(r => r.success !== false).length;
                const planData = execution?.editPlan;
                const totalSteps = planData?.step_count || stepResults.length;

                if (execution?.message && execution.message.startsWith('✓')) {
                    // Message came directly from VideoEditorTools.longFormEdit()
                    message = execution.message;
                } else if (planData) {
                    message = `✓ Long-form edit applied — ${successCount}/${totalSteps} steps completed.\n\n`;
                    message += AgentFeedbackService.formatEditPlanResult(planData);
                } else {
                    message = '✓ Long-form edit applied.';
                }
                suggestions = ['Review the timeline', 'Undo if anything was cut incorrectly', 'Export when ready'];
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
                suggestions = ['Move hook to the beginning', 'Choose a different hook segment', 'Preview the hook'];
                break;
            }
            case 'remove_repetition': {
                const removed = execution?.removedCount ?? 0;
                message = removed > 0
                    ? `✓ Removed ${removed} repetitive segment${removed !== 1 ? 's' : ''} from the timeline.`
                    : '✓ No significant repetitions detected.';
                suggestions = ['Review the cleaned timeline', 'Undo if anything was removed incorrectly'];
                break;
            }
            case 'reorder_segment': {
                message = '✓ Segment moved to new position in the timeline.';
                suggestions = ['Preview the result', "Undo if order doesn't feel right", 'Continue structural editing'];
                break;
            }

            default: {
                message = '✓ Edit completed successfully.';
                suggestions = ['Continue editing', 'Preview changes', 'Export when ready'];
            }
        }

        return { message, suggestions, success: true, operation };
    }

    // ── Long-Form Formatters ──────────────────────────────────────────────────

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

        return msg;
    }

    static formatEditPlanResult(editPlan) {
        let msg = `📋 **Edit Plan Summary**\n\n`;
        msg += `**Mode:** ${(editPlan.editMode || '').replace(/_/g, ' ')}\n`;
        if (editPlan.duration_target) {
            msg += `**Target duration:** ~${Math.round((editPlan.duration_target || 0) / 60)}m ${Math.round((editPlan.duration_target || 0) % 60)}s\n\n`;
        }
        if ((editPlan.actions || []).length > 0) {
            msg += `**Actions applied:**\n`;
            (editPlan.actions || []).forEach(a => { msg += `  • ${a.replace(/_/g, ' ')}\n`; });
        }
        return msg;
    }

    // ── Failure Feedback ──────────────────────────────────────────────────────

    static generateFailureFeedback(operation, validation, execution) {
        const error = validation?.error || execution?.error || 'Unknown error';
        let message = '';
        let suggestions = [];

        if (error.includes('not found')) {
            message = '✗ Couldn\'t find the clip. Please select a clip first.';
            suggestions = ['Select a clip in the timeline', 'Try again'];
        } else if (error.includes('outside clip bounds')) {
            message = '✗ Split point is outside the clip. Try a different position.';
            suggestions = ['Move playhead inside the clip', 'Use "split at midpoint"'];
        } else if (error.includes('cancelled')) {
            message = 'Operation was cancelled.';
            suggestions = ['Try again', 'Choose a different action'];
        } else if (error.includes('timeout')) {
            message = '✗ Operation took too long and was stopped.';
            suggestions = ['Try a simpler edit', 'Check your video file'];
        } else {
            message = `✗ Edit failed: ${error}`;
            suggestions = ['Try again', 'Rephrase your request'];
        }

        return { message, suggestions, success: false, operation, error };
    }

    // ── Chat Formatter ────────────────────────────────────────────────────────

    static formatForChat(feedback) {
        let formatted = feedback.message + '\n\n';
        if (feedback.suggestions && feedback.suggestions.length > 0) {
            formatted += 'What would you like to do next?\n';
            feedback.suggestions.forEach(s => { formatted += `• ${s}\n`; });
        }
        return formatted.trim();
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    static _formatSeconds(totalSeconds) {
        if (totalSeconds < 60) return `${totalSeconds}s`;
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
}

export default AgentFeedbackService;