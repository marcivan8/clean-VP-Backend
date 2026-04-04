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
                message = '✓ Silence detection complete.';
                suggestions = [
                    'Review detected silences',
                    'Adjust sensitivity threshold',
                    'Apply removal'
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
