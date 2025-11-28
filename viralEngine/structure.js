/**
 * Analyzes the structure of the video.
 * @param {Object} data - Multimodal data.
 * @returns {Object} - Structure analysis.
 */
function analyzeStructure(data) {
    const { duration, transcript } = data;

    // Simple heuristic structure detection
    // Intro: First 10-15%
    // Outro: Last 10-15%
    // Body: The rest

    const introEnd = duration * 0.15;
    const outroStart = duration * 0.85;

    // Check for CTA in outro
    const outroText = transcript.slice(-Math.min(transcript.length, 500)).toLowerCase(); // Last ~500 chars
    const ctaKeywords = ['subscribe', 'follow', 'like', 'comment', 'share', 'link in bio', 'abonnez', 'clique'];
    const hasCTA = ctaKeywords.some(kw => outroText.includes(kw));

    // Check for Intro hook
    // (Reusing hook logic slightly or just checking if there's speech early on)
    const hasIntro = true; // Assumed for now, can be refined

    let score = 70;
    if (hasCTA) score += 20;

    return {
        score,
        sections: {
            intro: { start: 0, end: introEnd },
            body: { start: introEnd, end: outroStart },
            outro: { start: outroStart, end: duration }
        },
        hasCTA,
        feedback: hasCTA ? "Good structure with a clear Call to Action." : "Missing a clear Call to Action at the end."
    };
}

module.exports = { analyzeStructure };
