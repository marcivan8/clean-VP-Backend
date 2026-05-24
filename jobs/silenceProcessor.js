const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

module.exports = async function processSilenceJob(job) {
    const { filename, filePath: jobFilePath, userId, threshold = '-30dB', duration = '0.5', transcript } = job.data;

    const uploadsDir = path.resolve(__dirname, '../uploads');
    const publicDir = path.resolve(__dirname, '../client/public');
    const storageConfig = require('../config/storage');

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
        } else if (storageConfig.bucket && userId && filename) {
            // Distributed env: download the raw file from GCS
            console.log(`[Job ${job.id}] Local file missing, downloading from GCS...`);
            const gcsPath = `raw/${userId}/${path.basename(filename)}`;
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            try {
                await storageConfig.bucket.file(gcsPath).download({ destination: filePath });
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

    let videoDuration = 0;
    const activeSegments = [];

    // ── Transcript-Aware Silence Detection ─────────────────────────────────
    if (transcript && Array.isArray(transcript) && transcript.length > 0) {
        console.log(`[Job ${job.id}] 📝 Using transcript-aware silence detection (${transcript.length} words, gap=${duration}s)`);
        
        // Get true video duration first
        try {
            videoDuration = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(filePath, (err, metadata) => {
                    if (err) return reject(err);
                    resolve(metadata.format.duration);
                });
            });
        } catch (err) {
            console.warn(`[Job ${job.id}] ffprobe failed to get duration: ${err.message}`);
            videoDuration = transcript[transcript.length - 1].end;
        }

        const minGap = parseFloat(duration);
        let currentSegment = { start: transcript[0].start, end: transcript[0].end };

        for (let i = 1; i < transcript.length; i++) {
            const word = transcript[i];
            const gap = word.start - currentSegment.end;

            if (gap >= minGap) {
                // Gap is large enough to be considered silence.
                // Close the current segment and start a new one.
                currentSegment.duration = currentSegment.end - currentSegment.start;
                activeSegments.push(currentSegment);
                currentSegment = { start: word.start, end: word.end };
            } else {
                // Gap is small, merge the word into the current segment.
                currentSegment.end = word.end;
            }
        }
        
        // Push the final segment
        currentSegment.duration = currentSegment.end - currentSegment.start;
        activeSegments.push(currentSegment);

        await job.updateProgress(100);
        console.log(`[Job ${job.id}] ✅ Transcript-Aware Analysis Complete. Found ${activeSegments.length} active segments.`);
        return { activeSegments, videoDuration };
    }

    // ── Fallback: FFmpeg Energy-Based Detection ────────────────────────────
    console.log(`[Job ${job.id}] 🔊 Using FFmpeg energy-based silence detection (threshold=${threshold}, minDur=${duration}s)`);
    
    const silenceSegments = [];
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
    console.log(`[Job ${job.id}] ✅ FFmpeg Silence Analysis Complete. Found ${activeSegments.length} active segments.`);
    
    return { activeSegments, videoDuration };
};
