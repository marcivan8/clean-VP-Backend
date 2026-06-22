const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const storageConfig = require('../config/storage');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Extracts waveform peak data from a video/audio file.
 *
 * Uses the same technique as Premiere, Descript, and Audacity:
 *   1. FFmpeg decodes the audio stream to raw PCM (mono, 8 kHz) in one pass
 *   2. We bucket the Int16 samples into windows and record [min, max] per bucket
 *   3. The result is stored as waveform.json and cached on GCS — never recomputed
 *
 * Returns { peaks: [[min, max], ...], duration }
 *   peaks[i] = [minAmplitude, maxAmplitude] for window i, both in [-1, 1]
 *
 * @param {string} inputPath  Absolute path to the source video/audio file
 * @param {number} [peaksPerSecond=50]  Resolution — 50 peaks/s gives ~1 bar per 20ms,
 *   which renders crisply at any zoom level without blowing up the JSON size.
 */
function generateWaveform(inputPath, peaksPerSecond = 50) {
    const SAMPLE_RATE = 8000; // 8 kHz mono — enough to capture amplitude shape, tiny buffer

    // spawnSync pipes raw PCM straight to stdout. We capture it as a Buffer.
    // FFmpeg always writes diagnostic info to stderr; stdout is pure sample data.
    const result = spawnSync(
        ffmpegPath,
        [
            '-i', inputPath,
            '-ac', '1',                // downmix to mono
            '-ar', String(SAMPLE_RATE),
            '-f', 's16le',             // signed 16-bit little-endian PCM
            '-acodec', 'pcm_s16le',
            '-',                       // write to stdout
        ],
        { maxBuffer: 1024 * 1024 * 200 } // 200 MB — enough for ~3.5 h at 8 kHz
    );

    if (!result.stdout?.length) {
        const errStr = result.stderr?.toString('utf8').slice(-800) || '(no stderr)';
        throw new Error(`FFmpeg waveform extraction produced no output.\n${errStr}`);
    }

    const raw     = result.stdout;
    const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
    const duration = samples.length / SAMPLE_RATE;
    const perPeak  = Math.max(1, Math.floor(SAMPLE_RATE / peaksPerSecond));
    const peaks    = [];

    for (let i = 0; i < samples.length; i += perPeak) {
        let min = 0, max = 0;
        const end = Math.min(i + perPeak, samples.length);
        for (let j = i; j < end; j++) {
            const v = samples[j] / 32768;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        peaks.push([+min.toFixed(3), +max.toFixed(3)]);
    }

    console.log(`[generateWaveform] ${peaks.length} peaks  duration=${duration.toFixed(2)}s  file=${path.basename(inputPath)}`);
    return { peaks, duration };
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
        // Try to make public (works on fine-grained-ACL buckets; no-op on uniform-access).
        try {
            await bucket.file(destinationPath).makePublic();
        } catch (err) {
            if (!err.message?.includes('uniform bucket-level access')) {
                console.warn(`[uploadToStorage] makePublic failed for ${destinationPath}:`, err.message);
            }
        }
        // Always route through our server proxy so clients never hit GCS directly.
        // This avoids 403s on private objects and keeps CORS handling server-side.
        return `/api/proxy/gcs-media/${destinationPath}`;
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
            // This happens when the client uploaded directly to GCS but the worker
            // service lacks GCS credentials (GOOGLE_APPLICATION_CREDENTIALS_JSON /
            // GOOGLE_CLOUD_BUCKET_NAME not set on the Railway worker service), so
            // storage.js fell back to local storage and the file is unreachable.
            throw new Error(
                `Input file not found locally (${absoluteInputPath}) and GCS is unavailable on this worker. ` +
                `Ensure GOOGLE_APPLICATION_CREDENTIALS_JSON and GOOGLE_CLOUD_BUCKET_NAME are set on the worker Railway service.`
            );
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

        // 2. Generate MP4 Proxy
        console.log(`[Job ${job.id}] Generating MP4 proxy...`);
        const mp4Filename = 'proxy.mp4';
        const mp4Path = path.join(tempDir, mp4Filename);

        await new Promise((resolve, reject) => {
            ffmpeg(absoluteInputPath)
                .output(mp4Path)
                .videoCodec('libx264')
                .size('?x540')
                .videoBitrate('1000k')
                .audioCodec('aac')
                .audioBitrate('128k')
                .outputOptions([
                    '-crf 28',
                    '-preset veryfast',
                    '-movflags +faststart', // Crucial for web playback and MP4Demuxer
                    '-pix_fmt yuv420p',     // Ensures compatibility across all browsers
                    '-f mp4'
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
        
        let mp4Url = '';
        let waveformUrl = '';

        for (const file of files) {
            const localFile = path.join(tempDir, file);
            const destPath = `${baseDestPath}/${file}`;
            const url = await uploadToStorage(localFile, destPath);
            
            if (file === mp4Filename) mp4Url = url;
            if (file === 'waveform.json') waveformUrl = url;
        }

        await job.updateProgress(100);
        console.log(`[Job ${job.id}] Completed proxy generation.`);

        return {
            proxyUrl: mp4Url,
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
