/**
 * Analyzes the hook (first 3-5 seconds) of a video.
 * @param {Object} data - Multimodal analysis data.
 * @returns {Object} - Hook analysis results and score.
 */
function analyzeHook(data) {
    const { transcript, audioAnalysis, visualAnalysis, duration } = data;

    // 1. Define Hook Window (first 3 seconds or 10% of video if shorter)
    const hookDuration = Math.min(3, duration * 0.1);

    // 2. Analyze Audio in Hook
    // Check if there is speech in the first few seconds
    const speechInHook = audioAnalysis.segments.some(s => s.start < hookDuration && s.text.length > 0);

    // Check volume/energy (mock logic if detailed energy not available)
    const highEnergyStart = audioAnalysis.wpm > 150; // Fast speech often implies energy

    // 3. Analyze Visuals in Hook
    // Check for face presence
    const faceInHook = visualAnalysis.frames.some(f => f.time < hookDuration && f.facesDetected > 0);

    // Check for scene changes (fast cuts in hook)
    const cutsInHook = visualAnalysis.sceneBoundaries.filter(t => t < hookDuration).length;

    // 4. Analyze Content (Keywords)
    const hookTranscript = transcript.slice(0, 100).toLowerCase();
    const hookKeywords = ['wait', 'stop', 'secret', 'you need', 'listen', 'watch this', 'attention', 'did you know', 'tu savais', 'regarde', 'attends'];
    const hasHookKeyword = hookKeywords.some(kw => hookTranscript.includes(kw));

    // 5. Calculate Score (0-100)
    let score = 50; // Base score

    if (speechInHook) score += 10;
    if (faceInHook) score += 10;
    if (cutsInHook > 0) score += 10; // Visual movement
    if (hasHookKeyword) score += 15;
    if (highEnergyStart) score += 5;

    // Penalties
    if (!speechInHook && !faceInHook && cutsInHook === 0) score -= 20; // Boring start

    return {
        score: Math.min(100, Math.max(0, score)),
        duration: hookDuration,
        hasSpeech: speechInHook,
        hasFace: faceInHook,
        hasFastCuts: cutsInHook > 0,
        hasHookKeyword,
        suggestion: score < 70 ? "Start with a stronger visual or verbal hook. Use 'You won't believe...' or show the result first." : "Strong hook detected!"
    };
}

module.exports = { analyzeHook };
