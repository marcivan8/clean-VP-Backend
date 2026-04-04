const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

class ProxyService {
    /**
     * Generate a 540p proxy for a given video file.
     * @param {string} videoPath - Relative path from uploads directory (e.g. 'analysis_only/123/video.mp4')
     * @param {string} userId - User ID for organizing output
     * @returns {Promise<string>} - Relative path to the generated proxy
     */
    static async generateProxy(videoPath, userId) {
        return new Promise((resolve, reject) => {
            const uploadsDir = path.join(__dirname, '..', 'uploads');
            const inputPath = path.join(uploadsDir, videoPath);
            
            // Check if input exists
            if (!fs.existsSync(inputPath)) {
                return reject(new Error(`Input file not found: ${inputPath}`));
            }

            // Construct output path
            // Structure: uploads/proxies/{userId}/{timestamp}_{filename}_proxy.mp4
            const proxiesDir = path.join(uploadsDir, 'proxies', userId.toString());
            
            if (!fs.existsSync(proxiesDir)) {
                fs.mkdirSync(proxiesDir, { recursive: true });
            }

            const filename = path.basename(videoPath, path.extname(videoPath));
            const timestamp = Date.now();
            const outputFilename = `${timestamp}_${filename}_proxy.mp4`;
            const outputPath = path.join(proxiesDir, outputFilename);
            const relativeOutputPath = path.join('proxies', userId.toString(), outputFilename);

            console.log(`[ProxyService] Starting generation for: ${videoPath}`);
            console.log(`[ProxyService] Output: ${relativeOutputPath}`);

            ffmpeg(inputPath)
                .output(outputPath)
                // Video settings: Scale to 540p height (maintaining aspect ratio), H.264
                .videoCodec('libx264')
                .size('?x540') 
                .videoBitrate('1000k') // Cap bitrate for lightweight playback
                .outputOptions([
                    '-crf 23',          // Good balance of quality/size
                    '-preset veryfast', // Fast encoding
                    '-pix_fmt yuv420p', // Ensure compatibility
                    '-movflags +faststart' // Web optimization
                ])
                // Audio settings: AAC
                .audioCodec('aac')
                .audioBitrate('128k')
                .on('start', (commandLine) => {
                    console.log('[ProxyService] FFmpeg process started:', commandLine);
                })
                .on('progress', (progress) => {
                    // Optional: could emit progress events here if we had the socket instance
                    // console.log(`[ProxyService] Processing: ${progress.percent}% done`);
                })
                .on('error', (err) => {
                    console.error('[ProxyService] Error:', err.message);
                    reject(err);
                })
                .on('end', () => {
                    console.log('[ProxyService] Proxy generation finished successfully');
                    resolve(relativeOutputPath);
                })
                .run();
        });
    }

    /**
     * Check if a proxy exists for a given file.
     * @param {string} proxyPath 
     */
    static checkProxyExists(proxyPath) {
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        const fullPath = path.join(uploadsDir, proxyPath);
        return fs.existsSync(fullPath);
    }
}

module.exports = ProxyService;
