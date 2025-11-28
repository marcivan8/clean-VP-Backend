const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Detects scene changes in a video.
 * @param {string} videoPath - Path to the video file.
 * @param {number} threshold - Scene change threshold (0-1). Lower = more sensitive.
 * @returns {Promise<Array<number>>} - List of timestamps (in seconds) where scenes change.
 */
async function detectScenes(videoPath, threshold = 0.3) {
    return new Promise((resolve, reject) => {
        const sceneTimestamps = [];

        ffmpeg(videoPath)
            .outputOptions([
                `-filter:v select='gt(scene,${threshold})',showinfo` // Use ffmpeg's scene detection filter
            ])
            .output('null') // We don't need the output video, just the logs
            .format('null')
            .on('stderr', (stderrLine) => {
                // Parse ffmpeg stderr output for "pts_time" which indicates a selected frame (scene change)
                // Example line: [Parsed_showinfo_1 @ 0x...] n:   0 pts:  7200 pts_time:0.24 ...
                const match = stderrLine.match(/pts_time:([0-9.]+)/);
                if (match && stderrLine.includes('showinfo')) {
                    const time = parseFloat(match[1]);
                    if (!isNaN(time)) {
                        sceneTimestamps.push(time);
                    }
                }
            })
            .on('end', () => {
                console.log(`✅ Scene detection complete. Found ${sceneTimestamps.length} scenes.`);
                // Deduplicate and sort
                const uniqueScenes = [...new Set(sceneTimestamps)].sort((a, b) => a - b);
                resolve(uniqueScenes);
            })
            .on('error', (err) => {
                console.error('❌ Error detecting scenes:', err);
                reject(err);
            })
            .run();
    });
}

module.exports = { detectScenes };
