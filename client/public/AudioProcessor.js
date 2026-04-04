/**
 * AudioProcessor.js
 * The "Beast" Mixer running in a separate AudioWorklet thread.
 * Handles precise sample-level mixing and buffering.
 */

class RingBuffer {
    constructor(capacity) {
        this.capacity = capacity;
        this.buffer = new Float32Array(capacity);
        this.writePtr = 0;
        this.readPtr = 0;
        this.available = 0;
    }

    push(data) {
        // Data is a Float32Array chunk
        const len = data.length;
        if (len > this.capacity - this.available) {
            // Buffer overflow, drop or overwrite? 
            // Ideally we should warn. For now, we drop new data to preserve continuity of what we have?
            // Or we overwrite old? Overwriting old breaks timeline. 
            // Dropping new means we pause decoding until consumed.
            return false;
        }

        // Two-part write (Ring wrap)
        const firstChunk = Math.min(len, this.capacity - this.writePtr);
        this.buffer.set(data.subarray(0, firstChunk), this.writePtr);

        const secondChunk = len - firstChunk;
        if (secondChunk > 0) {
            this.buffer.set(data.subarray(firstChunk), 0);
            this.writePtr = secondChunk;
        } else {
            this.writePtr = (this.writePtr + firstChunk) % this.capacity;
        }

        this.available += len;
        return true;
    }

    // Read `count` samples into `output` array (accumulate mode)
    // output[i] += sample * volume
    mixInto(output, count, volume) {
        if (this.available < count) {
            // Underrun! Not enough data. 
            // We mix what we have, or nothing?
            // Silence for missing parts.
            return false; // Underrun
        }

        let readIdx = this.readPtr;

        for (let i = 0; i < count; i++) {
            const sample = this.buffer[readIdx];
            output[i] += sample * volume;

            readIdx++;
            if (readIdx >= this.capacity) readIdx = 0;
        }

        this.readPtr = readIdx;
        this.available -= count;
        return true;
    }

    clear() {
        this.writePtr = 0;
        this.readPtr = 0;
        this.available = 0;
    }
}

class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // Map<TrackID, { buffer: RingBuffer, volume: number, muted: boolean, solo: boolean, isPlaying: boolean, rms: number }>
        this.tracks = new Map();

        // Metering State
        this.frameCount = 0;
        this.meteringInterval = 3; // roughly 60ms (48000 / 128 / 3 ~ 16Hz updates)

        // Messaging
        this.port.onmessage = this.handleMessage.bind(this);

        console.log('[AudioWorklet] Processor Initialized');
    }

    handleMessage(event) {
        const { type, payload } = event.data;

        switch (type) {
            case 'INIT_TRACK':
                // payload: { trackId, bufferSize }
                this.tracks.set(payload.trackId, {
                    buffer: new RingBuffer(payload.bufferSize || 48000 * 5),
                    faderVolume: 1.0, // Mixer Volume
                    clipGain: 1.0,    // Clip Volume + Fades (Calculated by Main Thread)
                    muted: false,
                    solo: false,
                    isPlaying: true,
                    rms: 0,
                    // Effects State
                    denoise: false,
                    enhance: false
                });
                break;

            case 'PUSH_DATA':
                const track = this.tracks.get(payload.trackId);
                if (track) {
                    track.buffer.push(payload.data);
                }
                break;

            case 'SET_VOLUME':
                // payload: { trackId, volume } -> Maps to Fader Volume
                if (this.tracks.has(payload.trackId)) {
                    this.tracks.get(payload.trackId).faderVolume = payload.volume;
                }
                break;

            case 'SET_CLIP_GAIN':
                // payload: { trackId, gain } -> Instantaneous Clip Gain (Timeline automation)
                if (this.tracks.has(payload.trackId)) {
                    this.tracks.get(payload.trackId).clipGain = payload.gain;
                }
                break;

            case 'SET_EFFECTS':
                // payload: { trackId, denoise, enhance }
                if (this.tracks.has(payload.trackId)) {
                    const t = this.tracks.get(payload.trackId);
                    if (payload.denoise !== undefined) t.denoise = payload.denoise;
                    if (payload.enhance !== undefined) t.enhance = payload.enhance;
                }
                break;

            case 'SET_MUTE':
                if (this.tracks.has(payload.trackId)) {
                    this.tracks.get(payload.trackId).muted = payload.muted;
                }
                break;

            case 'SET_SOLO':
                if (this.tracks.has(payload.trackId)) {
                    this.tracks.get(payload.trackId).solo = payload.solo;
                }
                break;

            case 'CLEAR_BUFFERS':
                this.tracks.forEach(t => t.buffer.clear());
                break;

            case 'REMOVE_TRACK':
                this.tracks.delete(payload.trackId);
                break;
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channelL = output[0];
        const channelR = output[1];

        if (!channelL) return true;

        const bufferSize = channelL.length;
        channelL.fill(0);
        if (channelR) channelR.fill(0);

        // Determine if any track is soloed
        let soloActive = false;
        for (let t of this.tracks.values()) {
            if (t.solo) {
                soloActive = true;
                break;
            }
        }

        // Iterate Tracks and Mix
        this.tracks.forEach((trackData, trackId) => {
            if (!trackData.isPlaying) return;

            // Mute / Solo Logic
            const isAudible = soloActive ? trackData.solo : !trackData.muted;

            // Effective Volume for Mixing
            // Combine Fader Volume * Clip Gain
            const effVolume = isAudible ? (trackData.faderVolume * trackData.clipGain) : 0.0;

            // Optimization: If silent, consume buffer without adding
            const tempBuffer = new Float32Array(bufferSize); // Allocating in loop is bad? Browser handles small allocs well, or use scratch buffer.
            // Better: use channelL if solo track? No, we mix multiple.
            // Let's rely on RingBuffer to fill tempBuffer.
            // Actually, we don't have a shared scratch buffer.
            // Let's create `this.scratchBuffer` in constructor. (Simplified edit: just Alloc for now)

            // Read from Buffer
            // We read raw samples, THEN apply effects, THEN mix to main.
            // But RingBuffer.mixInto does "read + add * vol". 
            // It doesn't support "read + filter + add".

            // Refactor RingBuffer usage:
            // 1. Read to scratch
            // 2. Apply Effects
            // 3. Add to Output

            // Since we can't change RingBuffer class easily here without huge diff,
            // we will use `mixInto` with volume 1.0 into a CLEAN scratch buffer, then process, then add to main.

            // HACK: Re-use channelR as scratch if mono? No.
            // Let's just create one.
            const scratch = new Float32Array(bufferSize);
            const dataAvailable = trackData.buffer.mixInto(scratch, bufferSize, 1.0); // Extract raw

            if (dataAvailable) {
                // --- EFFECTS CHAIN ---

                // 1. Denoise (Simple LowPass / HighPass)
                if (trackData.denoise) {
                    // Simple moving average (Low Pass) to kill hiss? 
                    // Or HighPass to kill rumble? "Denoiser" typically removes Hiss.
                    // Simple LPF: y[n] = 0.5*x[n] + 0.5*x[n-1]
                    // We need state. `trackData.lastSample`.
                    let last = trackData.lastSample || 0;
                    for (let i = 0; i < bufferSize; i++) {
                        const curr = scratch[i];
                        scratch[i] = (curr + last) * 0.5;
                        last = curr; // Smooth
                    }
                    trackData.lastSample = last;
                }

                // 2. Enhance (Compressor-ish / Boost)
                if (trackData.enhance) {
                    // Slight boost + soft clip
                    for (let i = 0; i < bufferSize; i++) {
                        let s = scratch[i] * 1.5; // Boost
                        // Soft clip: tanh(s)
                        // Approximation: Math.max(-1, Math.min(1, s))
                        if (s > 0.8) s = 0.8 + (s - 0.8) * 0.5; // Compression Knee
                        if (s < -0.8) s = -0.8 + (s + 0.8) * 0.5;
                        scratch[i] = s;
                    }
                }

                // --- MIX TO MASTER ---
                for (let i = 0; i < bufferSize; i++) {
                    channelL[i] += scratch[i] * effVolume;
                }

                // RMS Calculation (on processed audio)
                let sumSq = 0;
                for (let i = 0; i < bufferSize; i++) {
                    sumSq += scratch[i] * scratch[i];
                }
                trackData.rms = Math.sqrt(sumSq / bufferSize) * effVolume;
            } else {
                trackData.rms = 0;
            }
        });

        // Copy L to R
        if (channelR) {
            channelR.set(channelL);
        }

        // Report Levels + Buffer Health
        this.frameCount++;
        if (this.frameCount >= this.meteringInterval) {
            this.frameCount = 0;
            const levels = {};
            const bufferHealth = {};

            this.tracks.forEach((t, id) => {
                levels[id] = t.rms;
                // Report buffer fill in samples (divide by sample rate in main thread to get ms)
                bufferHealth[id] = t.buffer.available;
            });

            this.port.postMessage({
                type: 'VOLUME_LEVELS',
                payload: { levels, bufferHealth }
            });
        }

        return true;
    }
}

registerProcessor('vp-audio-processor', AudioProcessor);
