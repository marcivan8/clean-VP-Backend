/**
 * Analyzes the pacing of a video based on scene boundaries and duration.
 * @param {Array<number>} sceneTimestamps - List of scene change timestamps in seconds.
 * @param {number} totalDuration - Total duration of the video in seconds.
 * @returns {Object} - Pacing analysis results.
 */
function analyzePacing(sceneTimestamps, totalDuration) {
    if (!sceneTimestamps || sceneTimestamps.length === 0) {
        return {
            averageShotLength: totalDuration,
            cutsPerMinute: 0,
            pacingScore: 0, // 0 = very slow, 100 = very fast
            segments: [{ start: 0, end: totalDuration, type: 'long_take' }]
        };
    }

    // Add start (0) and end (totalDuration) to timestamps for calculation
    const allPoints = [0, ...sceneTimestamps, totalDuration].sort((a, b) => a - b);
    const uniquePoints = [...new Set(allPoints)]; // Remove duplicates if 0 or duration were already present

    const shotLengths = [];
    for (let i = 0; i < uniquePoints.length - 1; i++) {
        const duration = uniquePoints[i + 1] - uniquePoints[i];
        shotLengths.push(duration);
    }

    const averageShotLength = shotLengths.reduce((a, b) => a + b, 0) / shotLengths.length;
    const cutsPerMinute = (sceneTimestamps.length / totalDuration) * 60;

    // Simple pacing score logic
    // Fast pacing: < 2s avg shot length
    // Medium pacing: 2-5s avg shot length
    // Slow pacing: > 5s avg shot length
    let pacingScore = 0;
    if (averageShotLength < 2) pacingScore = 90; // Very fast
    else if (averageShotLength < 4) pacingScore = 70; // Fast
    else if (averageShotLength < 8) pacingScore = 50; // Medium
    else if (averageShotLength < 15) pacingScore = 30; // Slow
    else pacingScore = 10; // Very slow

    // Identify segments (simplified)
    const segments = shotLengths.map((len, index) => ({
        start: uniquePoints[index],
        end: uniquePoints[index + 1],
        duration: len,
        type: len < 3 ? 'fast' : (len > 10 ? 'slow' : 'medium')
    }));

    return {
        averageShotLength: parseFloat(averageShotLength.toFixed(2)),
        cutsPerMinute: parseFloat(cutsPerMinute.toFixed(2)),
        pacingScore,
        segments
    };
}

module.exports = { analyzePacing };
