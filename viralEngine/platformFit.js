/**
 * Calculates fit scores for different platforms.
 * @param {Object} data - Aggregated analysis data.
 * @returns {Object} - Scores for TikTok, Reels, Shorts, YouTube.
 */
function calculatePlatformFit(data) {
    const { duration, pacing, emotion, hook } = data;

    // TikTok: Fast pacing, high emotion, strong hook, short duration (15-60s)
    let tiktokScore = 60;
    if (duration >= 15 && duration <= 60) tiktokScore += 20;
    if (pacing.score > 70) tiktokScore += 10;
    if (emotion.score > 70) tiktokScore += 10;
    if (hook.score > 80) tiktokScore += 10; // Critical for TikTok

    // Reels: Aesthetic (visuals), music (audio), medium duration (up to 90s)
    let reelsScore = 60;
    if (duration <= 90) reelsScore += 15;
    if (emotion.dominantEmotion === 'happy' || emotion.dominantEmotion === 'surprised') reelsScore += 10;
    // (Would check for music here if available)

    // Shorts: Similar to TikTok but maybe slightly less chaotic?
    let shortsScore = tiktokScore; // Proxy for now

    // YouTube: Long form, structured, narrative
    let youtubeScore = 50;
    if (duration > 120) youtubeScore += 30; // > 2 mins
    if (pacing.score > 40 && pacing.score < 80) youtubeScore += 10; // Moderate pacing
    if (data.structure && data.structure.hasCTA) youtubeScore += 10;

    return {
        tiktok: Math.min(100, tiktokScore),
        reels: Math.min(100, reelsScore),
        shorts: Math.min(100, shortsScore),
        youtube: Math.min(100, youtubeScore)
    };
}

module.exports = { calculatePlatformFit };
