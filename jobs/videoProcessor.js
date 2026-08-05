const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const storageConfig = require('../config/storage');

ffmpeg.setFfmpegPath(ffmpegPath);

// NOTE: this file used to also have a generateWaveform() step that ran a full
// ffmpeg astats pass over the ENTIRE raw input (no -vn, so it decoded every
// video frame too) just to produce a waveform.json — for a 48-min 4K source
// that's a full redundant decode pass before the real proxy encode even
// starts. Removed: nothing in the client ever read `asset.waveformUrl` (grep
// confirmed zero consumers under client/src) — peaks are owned exclusively by
// services/WaveformEngine.js per R31. See CLAUDE.md R36.

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
            throw new Error(`Input file not found: ${absoluteInputPath}`);
        }
    }

    const tempDir = path.join(uploadsDir, 'temp', job.id);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    try {
        await job.updateProgress(10);

        // 1. Generate MP4 Proxy
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
                    '-threads 0',           // explicit auto — use every core available to the job
                    '-movflags +faststart', // Crucial for web playback and MP4Demuxer
                    '-pix_fmt yuv420p',     // Ensures compatibility across all browsers
                    '-f mp4'
                ])
                .on('progress', (progress) => {
                    // Update progress between 10 and 90 (was 30-80 back when a
                    // separate waveform pass owned 10-30 — see the removal note above)
                    if (progress.percent) {
                        job.updateProgress(10 + Math.floor(Math.min(progress.percent, 100) * 0.8));
                    }
                })
                .on('end', resolve)
                .on('error', reject)
                .run();
        });

        await job.updateProgress(90);

        // 2. Upload to GCS / Storage
        console.log(`[Job ${job.id}] Uploading files to storage...`);
        const files = fs.readdirSync(tempDir);

        // Base destination path e.g., 'proxies/{userId}/{filename}/'
        const baseDestPath = `proxies/${userId || 'anonymous'}/${filename}`;

        let mp4Url = '';

        for (const file of files) {
            const localFile = path.join(tempDir, file);
            const destPath = `${baseDestPath}/${file}`;
            const url = await uploadToStorage(localFile, destPath);

            if (file === mp4Filename) mp4Url = url;
        }

        await job.updateProgress(100);
        console.log(`[Job ${job.id}] Completed proxy generation.`);

        // rawGcsPath lets the client set sourceUrl on the asset so the
        // export worker can fetch the original file directly from GCS.
        const rawGcsPath = storageConfig.bucket && !storageConfig.useLocalStorage
            ? `raw/${userId}/${filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '')}`
            : null;

        return {
            proxyUrl: mp4Url,
            originalPath: inputPath,
            // proxyPath = uploads-relative raw file path; audioRoutes resolves from uploads/ dir
            proxyPath: inputPath,
            rawGcsPath,
        };

    } finally {
        // Cleanup temp local files
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
};
