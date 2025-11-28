const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Extracts frames from a video file at a specified interval.
 * @param {string} videoPath - Path to the video file.
 * @param {string} outputDir - Directory to save extracted frames.
 * @param {number} intervalSeconds - Interval in seconds between frames.
 * @returns {Promise<Array<{path: string, time: number}>>} - List of extracted frames with metadata.
 */
async function extractFrames(videoPath, outputDir, intervalSeconds = 1) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const frames = [];

        ffmpeg(videoPath)
            .on('end', () => {
                console.log('✅ Frame extraction complete');
                // Read the directory to get the actual files created
                fs.readdir(outputDir, (err, files) => {
                    if (err) return reject(err);

                    // Sort files to ensure order
                    const frameFiles = files
                        .filter(f => f.startsWith('frame-') && f.endsWith('.jpg'))
                        .sort((a, b) => {
                            const numA = parseInt(a.match(/frame-(\d+)/)[1]);
                            const numB = parseInt(b.match(/frame-(\d+)/)[1]);
                            return numA - numB;
                        });

                    const result = frameFiles.map((file, index) => ({
                        path: path.join(outputDir, file),
                        time: index * intervalSeconds // Approximate time
                    }));
                    resolve(result);
                });
            })
            .on('error', (err) => {
                console.error('❌ Error extracting frames:', err);
                reject(err);
            })
            .outputOptions([
                `-vf fps=1/${intervalSeconds}`, // Extract 1 frame every X seconds
                '-q:v 2' // High quality JPEG
            ])
            .output(path.join(outputDir, 'frame-%d.jpg'))
            .run();
    });
}

module.exports = { extractFrames };
