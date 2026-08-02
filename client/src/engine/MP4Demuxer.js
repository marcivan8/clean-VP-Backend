import * as MP4Box from './libs/mp4box.all.js';

console.log('[MP4Demuxer] Module Loaded. MP4Box (Vendor ESM):', MP4Box);

/**
 * MP4Demuxer
 * Wraps mp4box.js to extract EncodedVideoChunks for WebCodecs VideoDecoder.
 */
class MP4Demuxer {
    constructor(fileUri, { onConfig, onChunk, onStatus, onAudioConfig, onAudioChunk }) {
        this.fileUri = fileUri;
        this.onConfig = onConfig; // Video Config
        this.onChunk = onChunk; // Video Chunk

        this.onAudioConfig = onAudioConfig; // NEW: Audio Config
        this.onAudioChunk = onAudioChunk;   // NEW: Audio Chunk

        this.onStatus = onStatus || console.log;

        this.file = MP4Box.createFile();
        this.file.onError = (e) => console.error("[Demuxer] MP4Box Error:", e);

        // Setup tracks
        this.file.onReady = this.handleReady.bind(this);
        this.file.onSamples = this.handleSamples.bind(this);

        this.videoTrackId = null;
        this.audioTrackId = null;
        this.description = null;

        this.load();
    }

    async load() {
        this.onStatus('[Demuxer] Fetching file...');

        // A single fetch attempt with no retry meant any transient failure —
        // a 502 from the GCS proxy route (Railway restarts, GCS hiccups; see
        // CLAUDE.md R24) — permanently killed this demux with zero video/audio
        // ever decoded. PlaybackEngine.play() has no way to detect that
        // (MP4Demuxer never reports failure back through onConfig/onChunk),
        // so it just waits out its 5s preload timeout and proceeds into
        // PLAYING anyway "with partial buffer" — except the buffer is EMPTY,
        // so playback silently freezes on a black frame forever instead of
        // erroring or recovering. Retrying transient failures here (502/503/
        // network errors are almost always momentary) fixes the freeze at
        // the source instead of requiring the whole player to grow error
        // recovery for a fetch that usually just needed one more try.
        const MAX_ATTEMPTS = 3;
        let lastErr = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(this.fileUri);
                if (!response.ok) {
                    // 5xx = transient (server/proxy issue) → retry.
                    // 4xx = the file genuinely isn't there → retrying won't help.
                    const retryable = response.status >= 500;
                    throw Object.assign(
                        new Error(`Failed to fetch file (${response.status})`),
                        { retryable }
                    );
                }

                // Stream the body into MP4Box (chunk by chunk for large files)
                // For simplicity in this PoC, we read as ArrayBuffer.
                // In production, we should use a proper ReadableStream reader.
                const buffer = await response.arrayBuffer();
                buffer.fileStart = 0;
                this.file.appendBuffer(buffer);
                this.file.flush();
                this.onStatus('[Demuxer] File loaded & flushed.');
                return;
            } catch (e) {
                lastErr = e;
                const retryable = e.retryable !== false; // network errors (no .retryable) are retryable too
                console.error(`[Demuxer] load attempt ${attempt}/${MAX_ATTEMPTS} failed:`, e.message);
                if (!retryable || attempt === MAX_ATTEMPTS) break;
                await new Promise(r => setTimeout(r, 400 * attempt)); // 400ms → 800ms
            }
        }

        console.error(lastErr);
        this.onStatus(`[Demuxer] Error: ${lastErr?.message || 'unknown error'}`);
    }

    handleReady(info) {
        this.onStatus('[Demuxer] MP4 Ready', info);

        // --- 1. Video Track ---
        const vTrack = info.videoTracks[0];
        if (vTrack) {
            this.videoTrackId = vTrack.id;
            this.file.setExtractionOptions(vTrack.id, 'video', { nbSamples: 1000 });

            const config = {
                codec: vTrack.codec,
                codedWidth: vTrack.video.width,
                codedHeight: vTrack.video.height,
                description: this.getDescription(vTrack),
            };
            this.onConfig(config);
        } else {
            this.onStatus('[Demuxer] No video track found');
        }

        // --- 2. Audio Track ---
        const aTrack = info.audioTracks[0];
        if (aTrack) {
            this.audioTrackId = aTrack.id;
            this.file.setExtractionOptions(aTrack.id, 'audio', { nbSamples: 1000 });

            console.log(`[Demuxer] Found Audio Track: Codec=${aTrack.codec}`);

            const audioConfig = {
                codec: aTrack.codec,
                sampleRate: aTrack.audio.sample_rate,
                numberOfChannels: aTrack.audio.channel_count,
            };

            if (this.onAudioConfig) {
                this.onStatus(`[Demuxer] Found Audio Track: ${aTrack.codec}, ${aTrack.audio.sample_rate}Hz, ${aTrack.audio.channel_count}ch`);
                this.onAudioConfig(audioConfig);
            }
        } else {
            console.warn('[Demuxer] No Audio Track Found in the MP4 file!');
            this.onStatus('[Demuxer] No Audio Track Found!');
        }

        this.file.start();
    }

    getDescription(track) {
        // ... same ...
        const trak = this.file.getTrackById(track.id);
        const avccBox = trak.mdia.minf.stbl.stsd.entries[0].avcC || trak.mdia.minf.stbl.stsd.entries[0].hvcC;
        if (!avccBox) return null;

        const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
        avccBox.write(stream);
        return new Uint8Array(stream.buffer.slice(8));
    }

    handleSamples(track_id, user, samples) {
        // Video Samples
        if (track_id === this.videoTrackId) {
            for (const sample of samples) {
                const type = sample.is_sync ? 'key' : 'delta';
                const chunk = new EncodedVideoChunk({
                    type,
                    timestamp: sample.cts * 1000000 / sample.timescale, // Microseconds
                    duration: sample.duration * 1000000 / sample.timescale,
                    data: sample.data
                });

                // Logging ...
                this.onChunk(chunk);
            }
        }

        // Audio Samples
        if (track_id === this.audioTrackId && this.onAudioChunk) {
            for (const sample of samples) {
                const type = sample.is_sync ? 'key' : 'delta';
                const chunk = new EncodedAudioChunk({
                    type,
                    timestamp: sample.cts * 1000000 / sample.timescale, // Microseconds
                    duration: sample.duration * 1000000 / sample.timescale,
                    data: sample.data
                });
                this.onAudioChunk(chunk);
            }
        }
    }

    seek(time) {
        if (!this.videoTrackId || !this.file) return;

        // Correct usage for MP4Box.js in buffer mode:
        // file.seek(time_in_seconds, true); -> Seeks to keyframe before time.

        console.log(`[Demuxer] Seeking to ${time}s`);

        const track = this.file.getTrackById(this.videoTrackId);
        if (!track) return;

        // We must flush/reset any internal extraction loop? 
        // `file.seek` handles it.
        this.file.seek(time, true);
    }
}

export default MP4Demuxer;
