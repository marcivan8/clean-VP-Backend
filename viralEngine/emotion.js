/**
 * Scores the emotional impact of a video.
 * @param {Object} emotionData - Output from emotionAnalyzer.js.
 * @returns {Object} - Emotion score and insights.
 */
function scoreEmotion(emotionData) {
    if (!emotionData || !emotionData.emotionDistribution) {
        return {
            score: 50,
            dominantEmotion: 'neutral',
            feedback: "No emotional data detected."
        };
    }

    const { emotionDistribution, overallDominantEmotion, totalFacesDetected } = emotionData;

    // Calculate emotional variance/intensity
    const totalEmotions = Object.values(emotionDistribution).reduce((a, b) => a + b, 0);

    // Weights for "viral" emotions
    const weights = {
        happy: 1.2,
        surprised: 1.5, // High arousal
        angry: 1.1, // High arousal
        fearful: 1.1,
        sad: 0.8,
        neutral: 0.5
    };

    let weightedScore = 0;
    Object.entries(emotionDistribution).forEach(([emo, count]) => {
        const weight = weights[emo] || 1;
        weightedScore += (count / totalEmotions) * weight * 100;
    });

    // Boost if faces are present (human connection)
    if (totalFacesDetected > 0) {
        weightedScore += 10;
    }

    let feedback = "";
    if (overallDominantEmotion === 'neutral') {
        feedback = "Content seems emotionally flat. Try to express more energy or emotion.";
    } else if (overallDominantEmotion === 'surprised' || overallDominantEmotion === 'happy') {
        feedback = "Great emotional energy! Positive and high-arousal emotions drive shares.";
    } else {
        feedback = `Dominant emotion is ${overallDominantEmotion}. Ensure this matches your intended tone.`;
    }

    return {
        score: Math.min(100, Math.max(0, Math.round(weightedScore))),
        dominantEmotion: overallDominantEmotion,
        feedback
    };
}

module.exports = { scoreEmotion };
