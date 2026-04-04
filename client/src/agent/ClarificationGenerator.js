/**
 * ClarificationGenerator
 * Generates bounded, multiple-choice questions for missing intent parameters.
 * Guarantees that the agent converges towards execution.
 */

export class ClarificationGenerator {
    /**
     * Generate clarification questions for an ambiguous intent
     * @param {object} intent - The intent object with missingParameters
     * @returns {Array} List of clarification questions
     */
    static generate(intent) {
        if (!intent.missingParameters || intent.missingParameters.length === 0) {
            return [];
        }

        const questions = [];
        for (const param of intent.missingParameters) {
            const question = this.createQuestion(param, intent);
            if (question) {
                questions.push(question);
            }
        }
        return questions;
    }

    /**
     * Create a specific question for a missing parameter
     */
    static createQuestion(param, intent) {
        switch (param) {
            // === EDIT OPERATIONS ===
            case 'clipId':
            case 'selection':
                return {
                    parameter: param,
                    question: 'Which clip should I apply this to?',
                    type: 'selection', // UI should show clip selector
                    options: ['$active_clip', '$all_clips']
                };

            case 'timestamp':
            case 'timestamp_or_condition':
                return {
                    parameter: 'timestamp',
                    question: 'Where should I apply this change?',
                    type: 'option',
                    options: [
                        { label: 'At Playhead', value: '$playhead' },
                        { label: 'Start of Clip', value: '$start' },
                        { label: 'End of Clip', value: '$end' }
                        // UI could also offer a time picker
                    ]
                };

            case 'speed':
                return {
                    parameter: 'speed',
                    question: 'What speed should I set?',
                    type: 'option',
                    options: [
                        { label: 'Slow Motion (0.5x)', value: 0.5 },
                        { label: 'Fast (2x)', value: 2.0 },
                        { label: 'Timelapse (4x)', value: 4.0 },
                        { label: 'Normal (1x)', value: 1.0 }
                    ]
                };

            case 'duration':
            case 'amount':
                return {
                    parameter: param,
                    question: 'How much should I trim/change?',
                    type: 'text', // Fallback to text if no specific options
                    suggestions: ['1 second', '5 seconds', 'Subject to subject']
                };

            // === EXPORT / FORMAT ===
            case 'format':
                return {
                    parameter: 'format',
                    question: 'What format do you need?',
                    type: 'option',
                    options: [
                        { label: 'MP4 (Universal)', value: 'mp4' },
                        { label: 'MOV (High Quality)', value: 'mov' },
                        { label: 'GIF (Animation)', value: 'gif' }
                    ]
                };

            case 'quality':
                return {
                    parameter: 'quality',
                    question: 'What quality should the export be?',
                    type: 'option',
                    options: [
                        { label: '1080p (HD)', value: '1080p' },
                        { label: '4K (Ultra HD)', value: '4k' },
                        { label: '720p (Fast)', value: '720p' }
                    ]
                };

            case 'ratio':
                return {
                    parameter: 'ratio',
                    question: 'Which aspect ratio?',
                    type: 'option',
                    options: [
                        { label: '9:16 (TikTok/Reels)', value: '9:16' },
                        { label: '16:9 (YouTube)', value: '16:9' },
                        { label: '1:1 (Square)', value: '1:1' }
                    ]
                };

            // === EFFECTS ===
            case 'text':
                return {
                    parameter: 'text',
                    question: 'What text should I add?',
                    type: 'text_input',
                    placeholder: 'Enter text here...'
                };

            case 'volume':
                return {
                    parameter: 'volume',
                    question: 'How loud should it be?',
                    type: 'option',
                    options: [
                        { label: 'Mute (0%)', value: 0 },
                        { label: 'Quiet (50%)', value: 0.5 },
                        { label: 'Normal (100%)', value: 1.0 },
                        { label: 'Loud (150%)', value: 1.5 }
                    ]
                };

            case 'filterType':
                return {
                    parameter: 'filterType',
                    question: 'Which filter?',
                    type: 'option',
                    options: [
                        { label: 'Black & White', value: 'grayscale' },
                        { label: 'Sepia', value: 'sepia' },
                        { label: 'Blur', value: 'blur' },
                        { label: 'Sharpen', value: 'sharpen' }
                    ]
                };

            // === CRL: Creative / Optimization Parameters ===
            case 'platform':
                return {
                    parameter: 'platform',
                    question: 'Which platform is this for?',
                    type: 'option',
                    options: [
                        { label: '1️⃣ TikTok / Reels', value: 'tiktok' },
                        { label: '2️⃣ YouTube Shorts', value: 'youtube_shorts' },
                        { label: '3️⃣ YouTube', value: 'youtube' },
                        { label: '4️⃣ Instagram', value: 'instagram' }
                    ]
                };

            case 'targetDuration':
                return {
                    parameter: 'targetDuration',
                    question: 'Should we shorten it for better retention?',
                    type: 'option',
                    options: [
                        { label: 'Keep original duration', value: 'keep' },
                        { label: 'Shorten to 30-60s', value: '30-60s' },
                        { label: 'Shorten to 15-30s', value: '15-30s' },
                        { label: 'Under 15s (max impact)', value: '<15s' }
                    ]
                };

            case 'style':
                return {
                    parameter: 'style',
                    question: 'What style are you going for?',
                    type: 'option',
                    options: [
                        { label: '⚡ Fast-paced / Energetic', value: 'fast_paced' },
                        { label: '🎬 Cinematic / Dramatic', value: 'cinematic' },
                        { label: '✨ Clean / Minimal', value: 'clean' },
                        { label: '🔥 Raw / Dynamic', value: 'energetic' }
                    ]
                };

            case 'strategies':
                return {
                    parameter: 'strategies',
                    question: 'What should I focus on?',
                    type: 'option',
                    options: [
                        { label: 'Remove silences + tighten cuts', value: 'silence_cleanup' },
                        { label: 'Add transitions + polish', value: 'polish' },
                        { label: 'Reformat for platform', value: 'reformat' },
                        { label: 'All of the above', value: 'all' }
                    ]
                };

            default:
                return {
                    parameter: param,
                    question: `Please specify ${param}`,
                    type: 'text'
                };
        }
    }
}
