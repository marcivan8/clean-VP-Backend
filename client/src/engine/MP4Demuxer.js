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
        try {
            const response = await fetch(this.fileUri);
            if (!response.ok) throw new Error("Failed to fetch file");

            // Stream the body into MP4Box (chunk by chunk for large files)
            // For simplicity in this PoC, we read as ArrayBuffer.
            // In production, we should use a proper ReadableStream reader.
            const buffer = await response.arrayBuffer();
            buffer.fileStart = 0;
            this.file.appendBuffer(buffer);
            this.file.flush();
            this.onStatus('[Demuxer] File loaded & flushed.');
        } catch (e) {
            console.error(e);
            this.onStatus(`[Demuxer] Error: ${e.message}`);
        }
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
