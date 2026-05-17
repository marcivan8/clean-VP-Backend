const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const storageConfig = require('../config/storage');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Extracts waveform data from a video file.
 * Returns an array of peak values.
 */
async function generateWaveform(inputPath) {
    return new Promise((resolve, reject) => {
        const peaks = [];
        let duration = 0;
        
        ffmpeg(inputPath)
            .audioFilters('aresample=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level')
            .format('null')
            .output('-')
            .on('stderr', (line) => {
                // Parse duration
                if (line.includes('Duration:')) {
                    const match = line.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
                    if (match) {
                        const hours = parseFloat(match[1]);
                        const mins = parseFloat(match[2]);
                        const secs = parseFloat(match[3]);
                        duration = (hours * 3600) + (mins * 60) + secs;
                    }
                }
                // Parse astats output
                // Example: [Parsed_ametadata_2 @ 0x...] lavfi.astats.Overall.RMS_level=-25.432
                if (line.includes('lavfi.astats.Overall.RMS_level')) {
                    const match = line.match(/RMS_level=([-\d\.]+)/);
                    if (match) {
                        const db = parseFloat(match[1]);
                        // Normalize roughly between -60dB (0) and 0dB (1)
                        const normalized = Math.max(0, Math.min(1, (db + 60) / 60));
                        peaks.push(normalized);
                    }
                }
            })
            .on('end', () => {
                // Return roughly 1 value per second if there are many peaks
                // astats with reset=1 outputs per frame. We need to subsample it.
                // Assuming ~30 fps or frame rate, let's just bucket it to ~1 second bins.
                const sampledPeaks = [];
                if (duration > 0 && peaks.length > 0) {
                    const samplesPerSec = peaks.length / duration;
                    const step = Math.max(1, Math.floor(samplesPerSec));
                    for (let i = 0; i < peaks.length; i += step) {
                        sampledPeaks.push(peaks[i]);
                    }
                } else {
                    sampledPeaks.push(...peaks);
                }
                
                resolve({
                    peaks: sampledPeaks,
                    duration,
                    sampleRate: 8000
                });
            })
            .on('error', reject)
            .run();
    });
}

/**
 * Uploads a local file to GCS or falls back to local uploads logic
 */
async function uploadToStorage(localFilePath, destinationPath) {
    const { bucket, useLocalStorage } = storageConfig;
    if (useLocalStorage || !bucket) {
        const dest = path.join(__dirname, '..', 'uploads', destinationPath);
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(localFilePath, dest);
        return `/uploads/${destinationPath}`;
    } else {
        await bucket.upload(localFilePath, {
            destination: destinationPath,
            metadata: { cacheControl: 'public, max-age=31536000' },
        });
        return `https://storage.googleapis.com/${bucket.name}/${destinationPath}`;
    }
}

module.exports = async function processVideoJob(job) {
    const { filename, userId, inputPath, outputDir } = job.data;
    
    // Resolve absolute paths
    const uploadsDir = path.resolve(__dirname, '../uploads');
    const absoluteInputPath = path.resolve(uploadsDir, inputPath);
    
    if (!fs.existsSync(absoluteInputPath)) {
        const { bucket } = storageConfig;
        if (bucket) {
            console.log(`[Job ${job.id}] Local file not found, attempting to download from GCS...`);
            const gcsRawPath = `raw/${userId}/${filename}`;
            try {
                const dir = path.dirname(absoluteInputPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                await bucket.file(gcsRawPath).download({ destination: absoluteInputPath });
                console.log(`[Job ${job.id}] Successfully downloaded from GCS to ${absoluteInputPath}`);
            } catch (err) {
                throw new Error(`Input file not found locally and failed to download from GCS: ${err.message}`);
            }
        } else {
            throw new Error(`Input file not found: ${absoluteInputPath}`);
        }
    }

    const tempDir = path.join(uploadsDir, 'temp', job.id);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    try {
        await job.updateProgress(10);

        // 1. Generate Waveform JSON
        console.log(`[Job ${job.id}] Generating waveform...`);
        const waveform = await generateWaveform(absoluteInputPath);
        
        const waveformPath = path.join(tempDir, 'waveform.json');
        fs.writeFileSync(waveformPath, JSON.stringify(waveform));
        await job.updateProgress(30);

        // 2. Generate HLS Proxy
        console.log(`[Job ${job.id}] Generating HLS proxy...`);
        const m3u8Filename = 'proxy.m3u8';
        const m3u8Path = path.join(tempDir, m3u8Filename);

        await new Promise((resolve, reject) => {
            ffmpeg(absoluteInputPath)
                .output(m3u8Path)
                .videoCodec('libx264')
                .size('?x540')
                .videoBitrate('1000k')
                .audioCodec('aac')
                .audioBitrate('128k')
                .outputOptions([
                    '-crf 28',
                    '-preset veryfast',
                    '-hls_time 4',
                    '-hls_list_size 0',
                    '-f hls'
                ])
                .on('progress', (progress) => {
                    // Update progress between 30 and 80
                    if (progress.percent) {
                        job.updateProgress(30 + Math.floor(progress.percent * 0.5));
                    }
                })
                .on('end', resolve)
                .on('error', reject)
                .run();
        });

        await job.updateProgress(80);

        // 3. Upload to GCS / Storage
        console.log(`[Job ${job.id}] Uploading files to storage...`);
        const files = fs.readdirSync(tempDir);
        
        // Base destination path e.g., 'proxies/{userId}/{filename}/'
        const baseDestPath = `proxies/${userId || 'anonymous'}/${filename}`;
        
        let m3u8Url = '';
        let waveformUrl = '';

        for (const file of files) {
            const localFile = path.join(tempDir, file);
            const destPath = `${baseDestPath}/${file}`;
            const url = await uploadToStorage(localFile, destPath);
            
            if (file === m3u8Filename) m3u8Url = url;
            if (file === 'waveform.json') waveformUrl = url;
        }

        await job.updateProgress(100);
        console.log(`[Job ${job.id}] Completed proxy generation.`);

        return {
            proxyUrl: m3u8Url,
            waveformUrl: waveformUrl,
            originalPath: inputPath,
            // proxyPath = uploads-relative raw file path; audioRoutes resolves from uploads/ dir
            proxyPath: inputPath,
        };

    } finally {
        // Cleanup temp local files
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
};
