const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

module.exports = async function processSilenceJob(job) {
    const { filename, filePath: jobFilePath, userId, threshold = '-30dB', duration = '0.5' } = job.data;

    const uploadsDir = path.resolve(__dirname, '../uploads');
    const publicDir = path.resolve(__dirname, '../client/public');
    const { bucket } = require('../config/storage');

    // Prefer explicit filePath from job data; fall back to resolving filename
    let filePath = jobFilePath || null;
    if (!filePath && filename) {
        const normalizedFilename = filename.startsWith('/') ? filename.slice(1) : filename;
        filePath = path.resolve(uploadsDir, normalizedFilename);
        if (!filePath.startsWith(uploadsDir) && !filePath.startsWith(publicDir)) {
            filePath = path.resolve(uploadsDir, 'temp', path.basename(normalizedFilename));
        }
    }

    if (!filePath || (!filePath.startsWith(uploadsDir) && !filePath.startsWith(publicDir))) {
        throw new Error('Access denied: Invalid file path');
    }

    if (!fs.existsSync(filePath)) {
        // Try temp subdir if not already there
        const tempPath = path.resolve(uploadsDir, 'temp', path.basename(filePath));
        if (filePath !== tempPath && fs.existsSync(tempPath)) {
            filePath = tempPath;
        } else if (bucket && userId && filename) {
            // Distributed env: download the raw file from GCS
            console.log(`[Job ${job.id}] Local file missing, downloading from GCS...`);
            const gcsPath = `raw/${userId}/${path.basename(filename)}`;
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            try {
                await bucket.file(gcsPath).download({ destination: filePath });
                console.log(`[Job ${job.id}] Downloaded from GCS: ${gcsPath}`);
            } catch (err) {
                throw new Error(`File not found locally and GCS download failed: ${err.message}`);
            }
        } else {
            throw new Error(`File not found: ${filename || filePath}`);
        }
    }

    console.log(`[Job ${job.id}] 🎤 Analyzing for silence: ${filename}`);
    await job.updateProgress(10);

    const silenceSegments = [];
    let videoDuration = 0;

    await new Promise((resolve, reject) => {
        ffmpeg(filePath)
            .audioFilters(`silencedetect=noise=${threshold}:d=${duration}`)
            .format('null')
            .output('-')
            .on('stderr', (stderrLine) => {
                if (stderrLine.includes('Duration:') && videoDuration === 0) {
                    const match = stderrLine.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
                    if (match) {
                        const hours = parseFloat(match[1]);
                        const mins = parseFloat(match[2]);
                        const secs = parseFloat(match[3]);
                        videoDuration = (hours * 3600) + (mins * 60) + secs;
                    }
                }

                if (stderrLine.includes('silence_start:')) {
                    const match = stderrLine.match(/silence_start: ([\d\.]+)/);
                    if (match) silenceSegments.push({ start: parseFloat(match[1]) });
                }
                if (stderrLine.includes('silence_end:')) {
                    const match = stderrLine.match(/silence_end: ([\d\.]+)/);
                    if (match && silenceSegments.length > 0) {
                        const lastSeg = silenceSegments[silenceSegments.length - 1];
                        if (lastSeg.end === undefined) {
                            lastSeg.end = parseFloat(match[1]);
                        }
                    }
                }
            })
            .on('end', resolve)
            .on('error', reject)
            .run();
    });

    await job.updateProgress(80);

    const activeSegments = [];
    let currentPos = 0;

    silenceSegments.forEach(silence => {
        if (silence.start > currentPos) {
            if (silence.start - currentPos > 0.1) {
                activeSegments.push({
                    start: currentPos,
                    end: silence.start,
                    duration: silence.start - currentPos
                });
            }
        }
        currentPos = silence.end;
    });

    if (videoDuration > currentPos) {
        activeSegments.push({
            start: currentPos,
            end: videoDuration,
            duration: videoDuration - currentPos
        });
    }

    await job.updateProgress(100);
    console.log(`[Job ${job.id}] ✅ Silence Analysis Complete. Found ${activeSegments.length} active segments.`);
    
    return { activeSegments, videoDuration };
};
