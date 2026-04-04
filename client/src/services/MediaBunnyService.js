/**
 * MediaBunnyService
 * 
 * Browser-side media processing using mediabunny.
 * Replaces the backend FFmpeg calls with in-browser operations.
 * 
 * Capabilities:
 * - Read media file metadata (duration, resolution, codecs, tracks)
 * - Trim/split media files
 * - Change playback speed
 * - Convert between formats (MP4, WebM, etc.)
 * - Extract audio tracks
 * - Resize video
 */

import {
    Input,
    Output,
    Conversion,
    ALL_FORMATS,
    BlobSource,
    BufferSource,
    BufferTarget,
    Mp4OutputFormat,
    WebMOutputFormat,
} from 'mediabunny';

import useTimelineStore from '../store/useTimelineStore.js';

/**
 * Create a mediabunny Input from a File, Blob, or ArrayBuffer
 */
function createInput(source) {
    if (source instanceof File || source instanceof Blob) {
        return new Input({
            formats: ALL_FORMATS,
            source: new BlobSource(source),
        });
    }
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
        return new Input({
            formats: ALL_FORMATS,
            source: new BufferSource(source),
        });
    }
    throw new Error('MediaBunnyService: Unsupported source type. Provide a File, Blob, or ArrayBuffer.');
}

/**
 * Get the output format class for a given format string
 */
function getOutputFormat(format = 'mp4') {
    switch (format.toLowerCase()) {
        case 'webm': return new WebMOutputFormat();
        case 'mp4':
        case 'mov':
        default:
            return new Mp4OutputFormat();
    }
}

class MediaBunnyService {
    constructor() {
        this._activeConversion = null;
    }

    // ==================== METADATA ====================

    /**
     * Read metadata from a media file.
     * @param {File|Blob|ArrayBuffer} source - The media source
     * @returns {Promise<object>} Metadata object
     */
    async readMetadata(source) {
        const input = createInput(source);

        try {
            const [format, mimeType, duration, tracks, videoTracks, audioTracks] = await Promise.all([
                input.getFormat(),
                input.getMimeType(),
                input.computeDuration(),
                input.getTracks(),
                input.getVideoTracks(),
                input.getAudioTracks(),
            ]);

            const primaryVideo = await input.getPrimaryVideoTrack();
            const primaryAudio = await input.getPrimaryAudioTrack();

            const metadata = {
                format: format?.constructor?.name || 'unknown',
                mimeType,
                duration,
                trackCount: tracks.length,
                video: primaryVideo ? {
                    width: primaryVideo.displayWidth || primaryVideo.codedWidth,
                    height: primaryVideo.displayHeight || primaryVideo.codedHeight,
                    codec: primaryVideo.codec,
                    frameRate: primaryVideo.frameRate,
                } : null,
                audio: primaryAudio ? {
                    sampleRate: primaryAudio.sampleRate,
                    channels: primaryAudio.numberOfChannels,
                    codec: primaryAudio.codec,
                } : null,
                allTracks: tracks.map((t, i) => ({
                    index: i,
                    type: t.type,
                    codec: t.codec,
                })),
            };

            console.log('[MediaBunnyService] Metadata:', metadata);
            return metadata;
        } finally {
            await input.dispose?.();
        }
    }

    // ==================== TRIMMING / SPLITTING ====================

    /**
     * Trim a media file between two timestamps.
     * @param {File|Blob|ArrayBuffer} source - The input media
     * @param {number} startTime - Start time in seconds
     * @param {number} endTime - End time in seconds
     * @param {object} options - { format, onProgress, signal }
     * @returns {Promise<Blob>} The trimmed media as a Blob
     */
    async trimMedia(source, startTime, endTime, options = {}) {
        const { format = 'mp4', onProgress, signal } = options;

        console.log(`[MediaBunnyService] Trimming: ${startTime}s → ${endTime}s (${format})`);

        const input = createInput(source);
        const target = new BufferTarget();
        const output = new Output({
            format: getOutputFormat(format),
            target,
        });

        const conversion = await Conversion.init({
            input,
            output,
            trim: { start: startTime, end: endTime },
        });

        if (!conversion.isValid) {
            const reasons = conversion.discardedTracks?.map(t => t.reason).join(', ') || 'unknown';
            throw new Error(`Trim conversion invalid: ${reasons}`);
        }

        if (onProgress) {
            conversion.onProgress = onProgress;
        }

        // Support cancellation via AbortSignal
        this._activeConversion = conversion;
        if (signal) {
            signal.addEventListener('abort', () => conversion.cancel());
        }

        try {
            await conversion.execute();
            const blob = new Blob([target.buffer], { type: `video/${format}` });
            console.log(`[MediaBunnyService] Trim complete: ${blob.size} bytes`);
            return blob;
        } finally {
            this._activeConversion = null;
            await input.dispose?.();
        }
    }

    /**
     * Split a media file at a given timestamp into two parts.
     * @param {File|Blob|ArrayBuffer} source - The input media
     * @param {number} splitTime - Timestamp to split at (seconds)
     * @param {object} options - { format, onProgress }
     * @returns {Promise<{partA: Blob, partB: Blob}>}
     */
    async splitMedia(source, splitTime, options = {}) {
        const { format = 'mp4', onProgress } = options;

        console.log(`[MediaBunnyService] Splitting at ${splitTime}s`);

        // Get total duration first
        const metadata = await this.readMetadata(source);
        if (splitTime <= 0 || splitTime >= metadata.duration) {
            throw new Error(`Split time ${splitTime}s is out of bounds [0, ${metadata.duration}s]`);
        }

        // Create Part A: 0 → splitTime
        const partA = await this.trimMedia(source, 0, splitTime, {
            format,
            onProgress: onProgress ? (p) => onProgress(p * 0.5) : undefined,
        });

        // Create Part B: splitTime → end
        const partB = await this.trimMedia(source, splitTime, metadata.duration, {
            format,
            onProgress: onProgress ? (p) => onProgress(0.5 + p * 0.5) : undefined,
        });

        console.log(`[MediaBunnyService] Split complete: A=${partA.size} bytes, B=${partB.size} bytes`);
        return { partA, partB };
    }

    // ==================== SPEED CHANGE ====================

    /**
     * Change the playback speed of a media file.
     * Uses mediabunny's frame rate adjustment for video processing.
     * @param {File|Blob|ArrayBuffer} source - The input media
     * @param {number} speed - Speed multiplier (e.g., 0.5 for half speed, 2.0 for double)
     * @param {object} options - { format, onProgress, signal }
     * @returns {Promise<Blob>}
     */
    async changeSpeed(source, speed, options = {}) {
        const { format = 'mp4', onProgress, signal } = options;

        if (speed <= 0 || speed > 16) {
            throw new Error(`Invalid speed: ${speed}. Range: 0.1-16`);
        }

        console.log(`[MediaBunnyService] Speed change: ${speed}x (${format})`);

        const input = createInput(source);
        const target = new BufferTarget();
        const output = new Output({
            format: getOutputFormat(format),
            target,
        });

        // Adjust frame rate to change perceived speed
        const conversion = await Conversion.init({
            input,
            output,
            video: (videoTrack) => ({
                // Multiply frame rate by speed factor to change perceived speed
                frameRate: (videoTrack.frameRate || 30) * speed,
            }),
            audio: speed === 1 ? undefined : {
                // Audio resampling for speed changes
                sampleRate: 44100,
            },
        });

        if (!conversion.isValid) {
            throw new Error('Speed conversion invalid');
        }

        if (onProgress) conversion.onProgress = onProgress;

        this._activeConversion = conversion;
        if (signal) {
            signal.addEventListener('abort', () => conversion.cancel());
        }

        try {
            await conversion.execute();
            const blob = new Blob([target.buffer], { type: `video/${format}` });
            console.log(`[MediaBunnyService] Speed change complete: ${blob.size} bytes`);
            return blob;
        } finally {
            this._activeConversion = null;
            await input.dispose?.();
        }
    }

    // ==================== FORMAT CONVERSION ====================

    /**
     * Convert a media file to a different format.
     * @param {File|Blob|ArrayBuffer} source - The input media
     * @param {string} outputFormat - Target format ('mp4', 'webm')
     * @param {object} options - { width, height, onProgress, signal }
     * @returns {Promise<Blob>}
     */
    async convertFormat(source, outputFormat = 'mp4', options = {}) {
        const { width, height, onProgress, signal } = options;

        console.log(`[MediaBunnyService] Converting to ${outputFormat}`);

        const input = createInput(source);
        const target = new BufferTarget();
        const output = new Output({
            format: getOutputFormat(outputFormat),
            target,
        });

        const conversionOptions = { input, output };

        // Optional resize
        if (width || height) {
            conversionOptions.video = {
                ...(width && { width }),
                ...(height && { height }),
                ...(width && height && { fit: 'contain' }),
            };
        }

        const conversion = await Conversion.init(conversionOptions);

        if (!conversion.isValid) {
            throw new Error(`Conversion to ${outputFormat} invalid`);
        }

        if (onProgress) conversion.onProgress = onProgress;

        this._activeConversion = conversion;
        if (signal) {
            signal.addEventListener('abort', () => conversion.cancel());
        }

        try {
            await conversion.execute();
            const blob = new Blob([target.buffer], { type: `video/${outputFormat}` });
            console.log(`[MediaBunnyService] Conversion complete: ${blob.size} bytes`);
            return blob;
        } finally {
            this._activeConversion = null;
            await input.dispose?.();
        }
    }

    // ==================== AUDIO EXTRACTION ====================

    /**
     * Extract the audio track from a media file as a WAV blob.
     * @param {File|Blob|ArrayBuffer} source - The input media
     * @param {object} options - { onProgress, signal }
     * @returns {Promise<Blob>}
     */
    async extractAudio(source, options = {}) {
        const { onProgress, signal } = options;

        console.log('[MediaBunnyService] Extracting audio');

        const input = createInput(source);
        const target = new BufferTarget();
        // For audio extraction, we output to MP4 with video discarded
        const output = new Output({
            format: new Mp4OutputFormat(),
            target,
        });

        const conversion = await Conversion.init({
            input,
            output,
            video: { discard: true },
        });

        if (!conversion.isValid) {
            throw new Error('Audio extraction invalid — file may not have an audio track');
        }

        if (onProgress) conversion.onProgress = onProgress;

        this._activeConversion = conversion;
        if (signal) {
            signal.addEventListener('abort', () => conversion.cancel());
        }

        try {
            await conversion.execute();
            const blob = new Blob([target.buffer], { type: 'audio/mp4' });
            console.log(`[MediaBunnyService] Audio extraction complete: ${blob.size} bytes`);
            return blob;
        } finally {
            this._activeConversion = null;
            await input.dispose?.();
        }
    }

    // ==================== HELPERS ====================

    /**
     * Get the current uploaded file from the editor store.
     * @returns {File|null}
     */
    getUploadedFile() {
        const state = useTimelineStore.getState();
        return state.uploadedFile || null;
    }

    /**
     * Cancel the currently active conversion.
     */
    async cancelActive() {
        if (this._activeConversion) {
            await this._activeConversion.cancel();
            this._activeConversion = null;
        }
    }
}

// Singleton
export const mediaBunnyService = new MediaBunnyService();
export default MediaBunnyService;
