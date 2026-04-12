import MP4Demuxer from './MP4Demuxer.js';

/**
 * VideoWorker.js (Real Decoding)
 * 1. Receive file URL.
 * 2. Setup VideoDecoder.
 * 3. Setup MP4Demuxer.
 * 4. Demuxer feeds Decoder -> Decoder feeds Main Thread.
 */

// Log forwarding
const log = (msg, data) => self.postMessage({ type: 'LOG', payload: { level: 'log', msg, data } });
const error = (msg, data) => self.postMessage({ type: 'LOG', payload: { level: 'error', msg, data } });

// Override console for convenience (optional, but ensures we catch everything)
console.log = log;
console.error = error;

let decoder = null;
let audioDecoder = null;
let demuxer = null;
let pendingFrames = [];
let isReady = false;
let qualityScale = 1.0; // 1.0 = High, 0.5 = Low

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'INIT': // Not strictly used yet, but good practice
            break;

        case 'SET_QUALITY':
            if (payload.quality === 'low') {
                qualityScale = 0.5;
                console.log('[Worker] Switched to Low Quality (0.5x)');
            } else {
                qualityScale = 1.0;
                console.log('[Worker] Switched to High Quality (1.0x)');
            }
            break;

        case 'START_GENERATING': // Actually "Start Decoding"
            // If payload has URL, start fresh. If not, resume?
            // For this PoC, we expect payload.url OR we hardcode the sample for now?
            // Ideally MainThread sends the File URL.
            // Let's assume payload.url is passed.
            if (payload.url) {
                initializePipeline(payload.url);
            } else if (!demuxer) {
                console.warn('[Worker] START_GENERATING called without URL and no Demuxer ready.');
            } else {
                console.log('[Worker] Resuming playback with existing pipeline.');
            }
            break;

        case 'STOP':
            // Pause logic?
            break;

        case 'SEEK':
            if (demuxer) {
                // Determine seek time
                const time = payload.time;
                console.log(`[Worker] Seeking Demuxer to ${time}`);

                if (decoder && decoder.state === 'configured') await decoder.flush();
                if (audioDecoder && audioDecoder.state === 'configured') await audioDecoder.flush();

                // Seek Demuxer (which will start sending chunks from that time)
                demuxer.seek(time);
            }
            break;
    }
};

function initializePipeline(url) {
    if (decoder && demuxer && demuxer.fileUri === url) {
        console.log('[Worker] Pipeline already initialized for:', url);
        return;
    }

    console.log('[Worker] Initializing Video Pipeline for:', url);

    // 1. Create Video Decoder
    decoder = new VideoDecoder({
        output: async (frame) => {
            try {
                // WORKER-SIDE DOWNSCALING
                let resizeOptions = undefined;
                if (qualityScale !== 1.0) {
                    resizeOptions = {
                        resizeWidth: Math.floor(frame.displayWidth * qualityScale),
                        resizeHeight: Math.floor(frame.displayHeight * qualityScale)
                    };
                }

                const bitmap = await self.createImageBitmap(frame, resizeOptions);
                const timestamp = frame.timestamp / 1000000;
                frame.close();

                self.postMessage({
                    type: 'NEW_FRAME',
                    payload: { data: bitmap, timestamp }
                }, [bitmap]);
            } catch (err) {
                console.error('[Worker] Bitmap creation failed', err);
                frame.close();
            }
        },
        error: (e) => console.error('[Worker] Decoder Error:', e),
    });

    // 2. Create Audio Decoder
    audioDecoder = new AudioDecoder({
        output: (audioData) => {
            // Processing Audio Data
            const format = audioData.format;
            const channels = audioData.numberOfChannels;
            const count = audioData.numberOfFrames;
            const timestamp = audioData.timestamp / 1000000; // seconds
            const sRate = audioData.sampleRate;              // capture before close()
            const dur = audioData.duration;                  // capture before close()

            const buffers = [];

            // Heuristic to detect if truly planar
            let isPlanar = format === 'f32-planar' || format.endsWith('planar');

            // Verify if we can access the last plane if > 1 channel
            if (isPlanar && channels > 1) {
                try {
                    audioData.allocationSize({ planeIndex: channels - 1, format: 'f32' });
                } catch (e) {
                    // Known browser quirk: Reports planar but provides interleaved
                    // console.warn(`[Worker] Audio format '${format}' reported ${channels} channels but plane ${channels - 1} access failed. Falling back to interleaved.`);
                    isPlanar = false;
                }
            }

            if (isPlanar) {
                // Planar: Each channel is a separate plane
                for (let i = 0; i < channels; i++) {
                    const options = { planeIndex: i, format: 'f32' };
                    const size = audioData.allocationSize(options);
                    const buffer = new Float32Array(size / 4);
                    audioData.copyTo(buffer, options);
                    buffers.push(buffer);
                }
            } else {
                // Interleaved (e.g. 'f32', 's16'): All channels in plane 0 (L, R, L, R...)
                const options = { planeIndex: 0, format: 'f32' };
                const size = audioData.allocationSize(options);
                const interleaved = new Float32Array(size / 4);
                audioData.copyTo(interleaved, options);

                // De-interleave into separate channel buffers
                for (let ch = 0; ch < channels; ch++) {
                    const chanBuffer = new Float32Array(count);
                    for (let i = 0; i < count; i++) {
                        chanBuffer[i] = interleaved[i * channels + ch];
                    }
                    buffers.push(chanBuffer);
                }
            }

            // --- Waveform Extraction (Downsampled Peaks) ---
            // Target: ~187 peaks/sec (1 peak per 256 samples at 48kHz)
            const SAMPLES_PER_PEAK = 256;
            const peakCount = Math.ceil(count / SAMPLES_PER_PEAK);
            const peaks = new Float32Array(peakCount);

            // Use Channel 0 (Left) or Mix? Let's use Channel 0 for speed for now.
            // Or better: Max of all channels.
            const sourceData = buffers[0];

            for (let i = 0; i < peakCount; i++) {
                const start = i * SAMPLES_PER_PEAK;
                const end = Math.min(start + SAMPLES_PER_PEAK, count);
                let max = 0;

                // Find max amplitude in this chunk
                for (let j = start; j < end; j++) {
                    const abs = Math.abs(sourceData[j]);
                    if (abs > max) max = abs;
                }
                peaks[i] = max;
            }

            audioData.close();

            // Transfer buffers to main thread (use captured values — audioData is closed)
            self.postMessage({
                type: 'AUDIO_DATA',
                payload: {
                    buffers,
                    peaks, // <--- New Waveform Data
                    sampleRate: sRate,
                    timestamp,
                    duration: dur / 1000000
                }
            }, [peaks.buffer, ...buffers.map(b => b.buffer)]);
        },
        error: (e) => console.error('[Worker] Audio Decoder Error:', e)
    });

    // 3. Create Demuxer
    demuxer = new MP4Demuxer(url, {
        onConfig: (config) => {
            console.log('[Worker] Configuring Video Decoder:', config);
            decoder.configure(config);
            isReady = true;
        },
        onChunk: (chunk) => {
            decoder.decode(chunk);
        },
        onAudioConfig: (config) => {
            console.log('[Worker] Configuring Audio Decoder:', config);
            audioDecoder.configure(config);
        },
        onAudioChunk: (chunk) => {
            audioDecoder.decode(chunk);
        },
        onStatus: (msg) => console.log(msg),
    });
}
