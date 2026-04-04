const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

/**
 * Detects BPM and Beat Timestamps from an audio/video file.
 * Uses FFmpeg to stream raw PCM data and analyzes energy peaks.
 * 
 * @param {string} filePath - Path to audio/video file
 * @returns {Promise<Object>} - { bpm: number, beats: number[] (timestamps in seconds) }
 */
async function detectBeats(filePath) {
    return new Promise((resolve, reject) => {
        const pcmData = [];

        // 1. Decode to Raw PCM (Signed 16-bit Little Endian, 44.1kHz, Mono)
        const stream = ffmpeg(filePath)
            .audioCodec('pcm_s16le')
            .audioChannels(1)
            .audioFrequency(44100)
            .format('s16le')
            .on('error', (err) => reject(err))
            .pipe();

        stream.on('data', (chunk) => {
            // Chunk is a Buffer. Convert to Float array for analysis.
            // s16le = 2 bytes per sample.
            for (let i = 0; i < chunk.length; i += 2) {
                // Read Int16 (-32768 to 32767) and normalize to -1.0 to 1.0
                const int16 = chunk.readInt16LE(i);
                pcmData.push(int16 / 32768.0);
            }
        });

        stream.on('end', () => {
            try {
                const result = analyzePCM(pcmData, 44100);
                resolve(result);
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Simple Energy-Based Beat Detection Strategy
 */
function analyzePCM(buffer, sampleRate) {
    // Optimization: Downsample to ~100Hz for energy calculation to save CPU?
    // Or just analyze chunks. 
    // Let's use a standard "Energy Threshold" algorithm.

    // 1. Calculate Instantaneous Energy in windows
    const windowSize = 1024; // ~23ms
    const energies = [];

    for (let i = 0; i < buffer.length; i += windowSize) {
        let sum = 0;
        for (let j = 0; j < windowSize; j++) {
            if (i + j < buffer.length) {
                sum += buffer[i + j] * buffer[i + j];
            }
        }
        energies.push(sum);
    }

    // 2. Compute Local Average Energy (History Buffer)
    // We look at ~1 second history (43 windows of 1024 samples @ 44100Hz)
    const historySize = 43;
    const beats = [];

    for (let i = 0; i < energies.length; i++) {
        // Get local history average
        const start = Math.max(0, i - historySize);
        const end = i; // Up to current
        let avgSum = 0;
        let count = 0;
        for (let k = start; k < end; k++) {
            avgSum += energies[k];
            count++;
        }

        const localAvg = count > 0 ? avgSum / count : 0;
        const variance = 1.3; // Sensitivity threshold. 1.3 to 1.5 is standard.
        const c = 1.3;

        // 3. Peak Detection
        // If instant energy > local average * C, it's a beat.
        if (energies[i] > localAvg * c && energies[i] > 0.01) { // 0.01 silence gate
            // We found a peak. But we assume beats don't happen faster than 250ms (240 BPM)
            // Debounce logic
            const timeSeconds = (i * windowSize) / sampleRate;
            const lastBeat = beats.length > 0 ? beats[beats.length - 1] : -1;

            if (timeSeconds - lastBeat > 0.25) {
                beats.push(timeSeconds);
            }
        }
    }

    // 4. Calculate Approximate BPM
    let bpm = 0;
    if (beats.length > 1) {
        // Calculate intervals
        const intervals = [];
        for (let i = 0; i < beats.length - 1; i++) {
            intervals.push(beats[i + 1] - beats[i]);
        }

        // Get average interval
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        if (avgInterval > 0) {
            bpm = 60 / avgInterval;
        }
    }

    // Clean up BPM (Rounding)
    bpm = Math.round(bpm);

    return {
        bpm,
        beats: beats.map(b => parseFloat(b.toFixed(3)))
    };
}

module.exports = { detectBeats };
