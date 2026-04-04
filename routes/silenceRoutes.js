const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * POST /api/silence/detect
 * Body: { filename: "sample.mp4", threshold: "-30dB", duration: "0.5" }
 * Returns: { segments: [{ start: 0, end: 10 }, { start: 12, end: 20 }] } (Active Speech Segments)
 */
router.post('/detect', async (req, res) => {
    try {
        const { filename, threshold = '-30dB', duration = '0.5' } = req.body;

        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }

        // Locate file (assuming it's in uploads or imports)
        // For the IDE demo, we might be using a temp file or the one uploaded to /uploads
        // Let's assume standard path from uploadRoutes or similar.
        // If it's "sample.mp4", let's check root or public. 
        // For robustness, full path logic similar to exportRoutes:

        let filePath = path.join(__dirname, '../uploads', filename);
        if (!fs.existsSync(filePath)) {
            // Fallback for public assets in dev
            filePath = path.join(__dirname, '../client/public', filename);
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: `File not found: ${filename}` });
        }

        console.log(`🎤 Analyzing for silence: ${filename} (Threshold: ${threshold}, MinDuration: ${duration}s)`);

        // Run FFmpeg silence detection
        // We parse stderr because that's where silencedetect outputs logs
        const silenceSegments = [];
        let videoDuration = 0;

        await new Promise((resolve, reject) => {
            ffmpeg(filePath)
                .audioFilters(`silencedetect=noise=${threshold}:d=${duration}`)
                .format('null') // No output file needed
                .output('-')
                .on('stderr', (stderrLine) => {
                    // console.log(stderrLine); // Verbose

                    // Parse Duration: "Duration: 00:00:30.04,"
                    if (stderrLine.includes('Duration:') && videoDuration === 0) {
                        const match = stderrLine.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
                        if (match) {
                            const hours = parseFloat(match[1]);
                            const mins = parseFloat(match[2]);
                            const secs = parseFloat(match[3]);
                            videoDuration = (hours * 3600) + (mins * 60) + secs;
                        }
                    }

                    // Parse Silence Start: "[silencedetect @ ...] silence_start: 12.345"
                    // Parse Silence End: "[silencedetect @ ...] silence_end: 14.567 | silence_duration: 2.222"
                    if (stderrLine.includes('silence_start:')) {
                        const match = stderrLine.match(/silence_start: ([\d\.]+)/);
                        if (match) silenceSegments.push({ start: parseFloat(match[1]) });
                    }
                    if (stderrLine.includes('silence_end:')) {
                        const match = stderrLine.match(/silence_end: ([\d\.]+)/);
                        if (match && silenceSegments.length > 0) {
                            // Find the last open segment
                            const lastSeg = silenceSegments[silenceSegments.length - 1];
                            if (lastSeg.end === undefined) {
                                lastSeg.end = parseFloat(match[1]);
                            }
                        }
                    }
                })
                .on('end', () => {
                    resolve();
                })
                .on('error', (err) => {
                    reject(err);
                })
                .run();
        });

        // Invert to get "Active Segments" (The parts we want to KEEP)
        const activeSegments = [];
        let currentPos = 0;

        silenceSegments.forEach(silence => {
            // If there's content before this silence, keep it
            if (silence.start > currentPos) {
                // Ensure min length to avoid micro-clips? Let's say 0.1s
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

        // Add final segment if file doesn't end with silence
        if (videoDuration > currentPos) {
            activeSegments.push({
                start: currentPos,
                end: videoDuration,
                duration: videoDuration - currentPos
            });
        }

        console.log(`✅ Silence Analysis Complete. Found ${activeSegments.length} active segments.`);
        res.json({ success: true, activeSegments, videoDuration });

    } catch (error) {
        console.error("Silence Detection Failed:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
