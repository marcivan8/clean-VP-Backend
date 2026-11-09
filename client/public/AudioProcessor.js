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
        this.readFraction = 0;
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
    mixInto(output, count, volume, rate = 1) {
        const step = Math.max(0.1, Math.min(4, Number(rate) || 1));
        let phase = this.readFraction;
        let mixed = false;
        for (let i = 0; i < count; i++) {
            const base = Math.floor(phase);
            if (base >= this.available) break;
            const firstIndex = (this.readPtr + base) % this.capacity;
            const secondIndex = base + 1 < this.available ? (firstIndex + 1) % this.capacity : firstIndex;
            const fraction = phase - base;
            const sample = this.buffer[firstIndex] * (1 - fraction) + this.buffer[secondIndex] * fraction;
            output[i] += sample * volume;
            phase += step;
            mixed = true;
        }
        const availableBeforeRead = this.available;
        const consumed = Math.min(availableBeforeRead, Math.floor(phase));
        this.readPtr = (this.readPtr + consumed) % this.capacity;
        this.available = availableBeforeRead - consumed;
        this.readFraction = consumed >= availableBeforeRead ? 0 : phase - consumed;
        return mixed;
    }

    sampleAt(offset) {
        const index = Math.trunc(offset);
        if (index < 0 || index >= this.available) return 0;
        return this.buffer[(this.readPtr + index) % this.capacity];
    }

    discard(count) {
        const consumed = Math.max(0, Math.min(this.available, Math.trunc(count)));
        this.readPtr = (this.readPtr + consumed) % this.capacity;
        this.available -= consumed;
        this.readFraction = 0;
        return consumed;
    }

    clear() {
        this.writePtr = 0;
        this.readPtr = 0;
        this.readFraction = 0;
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
                    playbackRate: 1,
                    maintainPitch: true,
                    pitchStretch: null,
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

            case 'SET_PLAYBACK_RATE':
                if (this.tracks.has(payload.trackId)) {
                    const track = this.tracks.get(payload.trackId);
                    track.playbackRate = Math.max(0.1, Math.min(4, Number(payload.rate) || 1));
                    if (payload.maintainPitch !== undefined) track.maintainPitch = payload.maintainPitch !== false;
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
                this.tracks.forEach(t => {
                    t.buffer.clear();
                    t.pitchStretch = null;
                });
                break;

            case 'REMOVE_TRACK':
                this.tracks.delete(payload.trackId);
                break;
        }
    }

    mixPitchPreservedInto(trackData, output, count, rate) {
        const hopSize = Math.max(256, Math.round((globalThis.sampleRate || 48000) * 0.01));
        const windowSize = hopSize * 2;
        const searchRadius = Math.max(16, Math.round((globalThis.sampleRate || 48000) * 0.005));
        let state = trackData.pitchStretch;
        if (!state || state.hopSize !== hopSize) {
            state = trackData.pitchStretch = {
                hopSize,
                windowSize,
                searchRadius,
                tail: new Float32Array(hopSize),
                grain: new Float32Array(windowSize),
                hop: new Float32Array(hopSize),
                hopOffset: hopSize,
                initialized: false,
                firstOverlap: true,
                lastRate: rate,
            };
        }

        const generateHop = () => {
            const { buffer } = trackData;
            const H = state.hopSize;
            const W = state.windowSize;
            const S = state.searchRadius;
            if (!state.initialized) {
                if (buffer.available < W) return false;
                for (let i = 0; i < W; i++) state.grain[i] = buffer.sampleAt(i);
                state.hop.set(state.grain.subarray(0, H));
                state.tail.set(state.grain.subarray(H, W));
                state.initialized = true;
                state.firstOverlap = true;
                state.lastRate = rate;
                state.hopOffset = 0;
                return true;
            }

            const predicted = state.firstOverlap
                ? rate * H
                : Math.max(0, S + (rate - state.lastRate) * H);
            const minStart = Math.max(0, Math.floor(predicted - S));
            const maxStart = Math.max(minStart, Math.ceil(predicted + S));
            if (buffer.available < maxStart + W) return false;

            // WSOLA: align the next grain to the prior overlap, then crossfade
            // a 10ms hop. Coarse search plus local refinement keeps the audio
            // thread bounded while retaining a stable waveform phase.
            let bestStart = minStart;
            let bestScore = -Infinity;
            for (let start = minStart; start <= maxStart; start += 8) {
                let score = 0;
                for (let i = 0; i < H; i += 8) score += state.tail[i] * buffer.sampleAt(start + i);
                if (score > bestScore) { bestScore = score; bestStart = start; }
            }
            const coarseStart = bestStart;
            const refineStart = Math.max(minStart, coarseStart - 7);
            const refineEnd = Math.min(maxStart, coarseStart + 7);
            for (let start = refineStart; start <= refineEnd; start++) {
                let score = 0;
                for (let i = 0; i < H; i += 4) score += state.tail[i] * buffer.sampleAt(start + i);
                if (score > bestScore) { bestScore = score; bestStart = start; }
            }

            for (let i = 0; i < H; i++) {
                const mix = i / Math.max(1, H - 1);
                state.hop[i] = state.tail[i] * (1 - mix) + buffer.sampleAt(bestStart + i) * mix;
                state.tail[i] = buffer.sampleAt(bestStart + H + i);
            }
            const advance = Math.max(1, Math.round(rate * H));
            // Keep a search window before the next predicted grain so WSOLA
            // can align in either direction without reading consumed samples.
            buffer.discard(Math.max(0, bestStart + advance - S));
            state.firstOverlap = false;
            state.lastRate = rate;
            state.hopOffset = 0;
            return true;
        };

        let mixed = false;
        let written = 0;
        while (written < count) {
            if (state.hopOffset >= state.hopSize && !generateHop()) break;
            const available = state.hopSize - state.hopOffset;
            const take = Math.min(count - written, available);
            for (let i = 0; i < take; i++) output[written + i] += state.hop[state.hopOffset + i];
            state.hopOffset += take;
            written += take;
            mixed = true;
        }
        return mixed;
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
            let dataAvailable;
            if (trackData.maintainPitch && Math.abs(trackData.playbackRate - 1) > 0.001) {
                dataAvailable = this.mixPitchPreservedInto(trackData, scratch, bufferSize, trackData.playbackRate);
            } else {
                trackData.pitchStretch = null;
                dataAvailable = trackData.buffer.mixInto(scratch, bufferSize, 1.0, trackData.playbackRate);
            }

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
