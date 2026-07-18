'use strict';

/**
 * server/audio-engine/export/AudioExportService.js
 *
 * Extracts and converts audio from video sources using FFmpeg.
 *
 * Supported output formats: mp3, wav, aac, m4a
 *
 * Design rules:
 * - Uses ffmpeg-static (same as the rest of the codebase) — no system FFmpeg dep
 * - Output written to os.tmpdir() as a temp file
 * - Caller is responsible for streaming + cleanup (use streamAndCleanup())
 * - All operations are async, never block the event loop
 * - Never throws — wrap in try/catch at the call site
 */

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const ffmpeg          = require('fluent-ffmpeg');
const ffmpegPath      = require('ffmpeg-static');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_FORMATS = ['mp3', 'wav', 'aac', 'm4a'];

/** @type {Record<string, string>} */
const MIME_TYPES = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
};

/** @type {Record<string, string>} FFmpeg audio codec per format */
const CODECS = {
    mp3: 'libmp3lame',
    wav: 'pcm_s16le',
    aac: 'aac',
    m4a: 'aac',
};

/** @type {Record<string, string>} FFmpeg container format per output format */
const CONTAINER_FORMATS = {
    mp3: 'mp3',
    wav: 'wav',
    aac: 'adts',
    m4a: 'ipod',
};

// ── Class ─────────────────────────────────────────────────────────────────────

class AudioExportService {
    /**
     * Extract audio from a video source and write to a temp file.
     *
     * @param {string} sourceInput — local file path or remote URL (GCS signed URL, etc.)
     * @param {import('../types').AudioExportOptions} opts
     * @returns {Promise<{ outputPath: string, format: string, mimeType: string }>}
     */
    async extractAudio(sourceInput, opts = {}) {
        if (!sourceInput) throw new Error('sourceInput is required');

        const format = (opts.format || 'mp3').toLowerCase();
        if (!SUPPORTED_FORMATS.includes(format)) {
            throw new Error(`Unsupported format "${format}". Supported: ${SUPPORTED_FORMATS.join(', ')}`);
        }

        const ext        = format; // mp3, wav, aac, m4a — all usable as extensions
        const uid        = crypto.randomBytes(6).toString('hex');
        const outputPath = path.join(os.tmpdir(), `vibed_audio_${Date.now()}_${uid}.${ext}`);

        // If a fade-out is requested we need the total duration to calculate the
        // start time for the afade filter.  Get it up front via ffprobe.
        let totalDuration = null;
        if (opts.fadeOut && opts.fadeOut > 0) {
            totalDuration = await this._getDuration(sourceInput).catch(() => null);
        }

        await this._runFFmpeg(sourceInput, outputPath, format, opts, totalDuration);

        return {
            outputPath,
            format,
            mimeType: MIME_TYPES[format],
        };
    }

    /**
     * Pipe an already-generated audio temp file to an Express response,
     * then delete the temp file when the stream closes.
     *
     * @param {string}                         filePath
     * @param {string}                         mimeType
     * @param {string}                         format
     * @param {import('express').Response}     res
     */
    streamAndCleanup(filePath, mimeType, format, res) {
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch (err) {
            console.error('[AudioExportService.streamAndCleanup] file not found:', err.message);
            if (!res.headersSent) res.status(500).json({ error: 'Audio export file not found' });
            return;
        }

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename="audio_export.${format}"`);
        res.setHeader('Cache-Control', 'no-store');

        const readStream = fs.createReadStream(filePath);

        // Cleanup fires once — whether stream ends normally or client disconnects
        let cleaned = false;
        const cleanup = () => {
            if (!cleaned) {
                cleaned = true;
                this.cleanup(filePath);
            }
        };

        readStream.on('end',   cleanup);
        readStream.on('close', cleanup);
        readStream.on('error', err => {
            console.error('[AudioExportService] read stream error:', err.message);
            cleanup();
            if (!res.headersSent) res.status(500).end();
        });

        res.on('close', cleanup); // fires if client disconnects early

        readStream.pipe(res);
    }

    /**
     * Delete a temp file. Safe to call even if the file no longer exists.
     *
     * @param {string|null} filePath
     */
    cleanup(filePath) {
        if (!filePath) return;
        fs.unlink(filePath, err => {
            if (err && err.code !== 'ENOENT') {
                console.warn('[AudioExportService.cleanup] unlink failed:', err.message);
            }
        });
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Run FFmpeg to extract and convert audio.
     *
     * @private
     * @param {string} input
     * @param {string} output
     * @param {string} format
     * @param {import('../types').AudioExportOptions} opts
     * @param {number|null} totalDuration — pre-fetched video duration (seconds)
     * @returns {Promise<void>}
     */
    _runFFmpeg(input, output, format, opts, totalDuration) {
        return new Promise((resolve, reject) => {
            let cmd = ffmpeg(input);

            // Seek before decoding (fast seek)
            if (opts.trimStart && opts.trimStart > 0) {
                cmd = cmd.seekInput(opts.trimStart);
            }

            // Duration / trim end
            if (opts.trimEnd && opts.trimEnd > 0) {
                const start    = opts.trimStart || 0;
                const duration = opts.trimEnd - start;
                if (duration > 0) cmd = cmd.duration(duration);
            }

            // Strip video stream
            cmd = cmd.noVideo();

            // Audio codec
            cmd = cmd.audioCodec(CODECS[format]);

            // Bitrate (meaningless for lossless wav)
            if (format !== 'wav' && opts.bitrate) {
                cmd = cmd.audioBitrate(opts.bitrate);
            }

            // Sample rate
            if (opts.sampleRate) {
                cmd = cmd.audioFrequency(opts.sampleRate);
            }

            // Channels (1=mono, 2=stereo)
            if (opts.channels) {
                cmd = cmd.audioChannels(opts.channels);
            }

            // Audio filters — composed into a single -af chain
            const filters = [];

            if (opts.normalize) {
                // EBU R128 loudness normalisation
                filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
            }

            if (opts.fadeIn && opts.fadeIn > 0) {
                filters.push(`afade=t=in:d=${opts.fadeIn}`);
            }

            if (opts.fadeOut && opts.fadeOut > 0 && totalDuration) {
                // Calculate start time relative to the (possibly trimmed) output
                const outDuration = opts.trimEnd
                    ? (opts.trimEnd - (opts.trimStart || 0))
                    : totalDuration - (opts.trimStart || 0);
                const st = outDuration - opts.fadeOut;
                if (st > 0) filters.push(`afade=t=out:st=${st.toFixed(3)}:d=${opts.fadeOut}`);
            }

            if (filters.length > 0) {
                cmd = cmd.audioFilters(filters);
            }

            // Container format
            cmd = cmd.format(CONTAINER_FORMATS[format]);

            cmd
                .on('start', cmdLine => {
                    console.log('[AudioExportService] FFmpeg started:', cmdLine);
                })
                .on('end', () => {
                    console.log('[AudioExportService] FFmpeg completed:', output);
                    resolve();
                })
                .on('error', (err, _stdout, stderr) => {
                    console.error('[AudioExportService] FFmpeg error:', err.message);
                    if (stderr) console.error('[AudioExportService] stderr:', stderr);
                    reject(new Error(`FFmpeg failed: ${err.message}`));
                })
                .save(output);
        });
    }

    /**
     * Use ffprobe to get the duration of a media file or URL.
     *
     * @private
     * @param {string} input
     * @returns {Promise<number|null>} duration in seconds
     */
    _getDuration(input) {
        return new Promise((resolve) => {
            ffmpeg.ffprobe(input, (err, metadata) => {
                if (err) {
                    console.warn('[AudioExportService._getDuration] ffprobe error:', err.message);
                    resolve(null);
                } else {
                    resolve(metadata?.format?.duration || null);
                }
            });
        });
    }
}

// Singleton
const audioExportService = new AudioExportService();
module.exports = { AudioExportService, audioExportService };
