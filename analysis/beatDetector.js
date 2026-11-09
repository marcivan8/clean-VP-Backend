const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(require('ffmpeg-static'));

const WINDOW_SIZE = 1024;
const HISTORY_WINDOWS = 43; // approximately one second at 44.1 kHz

/** Accumulates only short-window energy values, not every decoded PCM sample. */
class PCMBeatAnalyzer {
    constructor(sampleRate = 44100) {
        this.sampleRate = sampleRate;
        this.energy = 0;
        this.samplesInWindow = 0;
        this.pendingByte = null;
        this.energies = [];
    }

    addChunk(chunk) {
        let i = 0;
        if (this.pendingByte !== null && chunk.length) {
            const sample = Buffer.from([this.pendingByte, chunk[0]]).readInt16LE(0) / 32768;
            this._addSample(sample);
            this.pendingByte = null;
            i = 1;
        }
        for (; i + 1 < chunk.length; i += 2) this._addSample(chunk.readInt16LE(i) / 32768);
        if (i < chunk.length) this.pendingByte = chunk[i];
    }

    _addSample(sample) {
        this.energy += sample * sample;
        this.samplesInWindow += 1;
        if (this.samplesInWindow === WINDOW_SIZE) this._flushWindow();
    }

    _flushWindow() {
        this.energies.push(this.energy / this.samplesInWindow);
        this.energy = 0;
        this.samplesInWindow = 0;
    }

    finish(options = {}) {
        if (this.samplesInWindow) this._flushWindow();
        return analyzeEnergies(this.energies, this.sampleRate, options);
    }
}

function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function analyzeEnergies(energies, sampleRate = 44100, options = {}) {
    if (!Array.isArray(energies) || energies.length < 3) return { bpm: 0, beats: [] };
    const prefix = new Float64Array(energies.length + 1);
    for (let i = 0; i < energies.length; i++) prefix[i + 1] = prefix[i] + energies[i];

    const peaks = [];
    const minDistance = Math.ceil((0.25 * sampleRate) / WINDOW_SIZE);
    const requestedSensitivity = Number(options.sensitivity);
    const sensitivity = Number.isFinite(requestedSensitivity)
        ? Math.max(0, Math.min(1, requestedSensitivity))
        : 0.5;
    const threshold = 1.65 - sensitivity * 0.55;
    for (let i = 1; i < energies.length - 1; i++) {
        const start = Math.max(0, i - HISTORY_WINDOWS);
        const count = i - start;
        if (!count) continue;
        const average = (prefix[i] - prefix[start]) / count;
        const current = energies[i];
        // Require an actual local peak and a clear rise over the recent noise floor.
        if (current < 0.00002 || current <= energies[i - 1] || current < energies[i + 1] || current < average * threshold) continue;
        const last = peaks[peaks.length - 1];
        if (last && i - last.index < minDistance) {
            if (current > last.energy) peaks[peaks.length - 1] = { index: i, energy: current };
        } else peaks.push({ index: i, energy: current });
    }

    const beats = peaks.map(({ index }) => Number(((index * WINDOW_SIZE) / sampleRate).toFixed(3)));
    const intervals = beats.slice(1).map((time, i) => time - beats[i]).filter(value => value >= 0.25 && value <= 2);
    let bpm = intervals.length ? 60 / median(intervals) : 0;
    // Beat trackers commonly report half/double tempo; normalize into a useful range.
    while (bpm && bpm < 60) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return { bpm: bpm ? Math.round(bpm) : 0, beats };
}

async function detectBeats(filePath, options = {}) {
    return new Promise((resolve, reject) => {
        const analyzer = new PCMBeatAnalyzer(44100);
        let settled = false;
        const stream = ffmpeg(filePath)
            .noVideo()
            .audioCodec('pcm_s16le')
            .audioChannels(1)
            .audioFrequency(44100)
            .format('s16le')
            .on('error', error => {
                if (!settled) { settled = true; reject(error); }
            })
            .pipe();
        stream.on('data', chunk => analyzer.addChunk(chunk));
        stream.on('error', error => {
            if (!settled) { settled = true; reject(error); }
        });
        stream.on('end', () => {
            if (settled) return;
            try {
                settled = true;
                resolve(analyzer.finish(options));
            } catch (error) { reject(error); }
        });
    });
}

module.exports = { detectBeats, analyzeEnergies, PCMBeatAnalyzer };
