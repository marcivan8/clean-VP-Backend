/**
 * Scores the pacing of a video.
 * @param {Object} pacingData - Output from pacingAnalyzer.js.
 * @param {string} platform - Target platform (optional).
 * @returns {Object} - Pacing score and feedback.
 */
function scorePacing(pacingData, platform = 'general') {
    const { averageShotLength, cutsPerMinute, pacingScore } = pacingData;

    let score = pacingScore;
    let feedback = "";

    // Adjust expectations based on platform
    if (platform === 'TikTok' || platform === 'YouTubeShorts' || platform === 'Instagram') {
        // Expect faster pacing
        if (averageShotLength > 5) {
            score -= 20;
            feedback = "Pacing is too slow for short-form content. Aim for cuts every 2-3 seconds.";
        } else if (averageShotLength < 1.5) {
            // Too chaotic? Maybe, but usually good for retention
            score += 5;
            feedback = "Excellent fast pacing, great for retention.";
        } else {
            feedback = "Good pacing for this platform.";
        }
    } else if (platform === 'YouTube') {
        // Expect moderate pacing
        if (averageShotLength < 2) {
            feedback = "Pacing might be too fast for long-form. Ensure viewers can follow.";
        } else if (averageShotLength > 10) {
            score -= 10;
            feedback = "Consider adding B-roll or cuts to keep visual interest.";
        } else {
            feedback = "Comfortable pacing for long-form content.";
        }
    }

    return {
        score: Math.min(100, Math.max(0, score)),
        feedback,
        metrics: {
            averageShotLength,
            cutsPerMinute
        }
    };
}

module.exports = { scorePacing };
