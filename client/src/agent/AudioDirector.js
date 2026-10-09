/**
 * client/src/agent/AudioDirector.js
 *
 * Creative Suite: Beat-Matched Synchronization and Intelligent Music Auto-Ducking.
 *
 * 1. BEAT SYNCHRONIZATION:
 *    - `detectMusicalBeats(peaks, duration, opts)` analyzes audio peak waveforms
 *      to find musical transients and rhythmic downbeats.
 *    - `snapToNearestBeat(time, beats, tolerance)` quantizes cuts, transitions,
 *      B-roll drops, and graphics pops onto the rhythm.
 *
 * 2. INTELLIGENT AUTO-DUCKING:
 *    - `buildDuckingEnvelope(speechIntervals, totalDuration, opts)` generates a
 *      dynamic volume envelope for background music tracks (e.g., -14dB to -18dB
 *      during speech, swelling naturally during pauses).
 *    - `buildFfmpegDuckingFilter(envelope, inputIdx)` formats a volume expression
 *      for server-side FFmpeg audio mixing.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Detect transient rhythmic beats from peak data (array of normalized 0..1 values).
 *
 * @param {Array<number>} peaks array of peak values (e.g., 100-1000 samples)
 * @param {number} duration total audio duration in seconds
 * @param {object} [opts]
 * @param {number} [opts.minGapSec=0.28] minimum seconds between detected beats (tempo limit ~210 bpm)
 * @param {number} [opts.sensitivity=1.25] peak threshold multiplier above moving average
 * @returns {Array<number>} sorted beat timestamps in seconds
 */
export function detectMusicalBeats(peaks, duration, opts = {}) {
    if (!Array.isArray(peaks) || peaks.length < 4 || !(duration > 0)) return [];

    const minGap = Number(opts.minGapSec) || 0.28;
    const sens = Number(opts.sensitivity) || 1.25;
    const len = peaks.length;
    const secPerSample = duration / len;

    // 1. Moving average baseline energy
    const windowSize = Math.max(3, Math.round(0.5 / secPerSample));
    const beats = [];
    let lastBeatTime = -minGap;

    for (let i = 1; i < len - 1; i++) {
        const val = peaks[i];
        if (val < 0.15) continue; // Noise gate

        // Local peak check
        if (val >= peaks[i - 1] && val >= peaks[i + 1]) {
            const startW = Math.max(0, i - windowSize);
            const endW = Math.min(len, i + windowSize);
            let sum = 0;
            for (let j = startW; j < endW; j++) sum += peaks[j];
            const avg = sum / (endW - startW);

            if (val > avg * sens) {
                const t = Number((i * secPerSample).toFixed(3));
                if (t - lastBeatTime >= minGap) {
                    beats.push(t);
                    lastBeatTime = t;
                }
            }
        }
    }

    return beats;
}

/**
 * Snap a visual or cut timestamp onto the nearest musical beat if within tolerance.
 *
 * @param {number} time timestamp in seconds
 * @param {Array<number>} beats sorted beat timestamps
 * @param {number} [tolerance=0.18] maximum snap window in seconds
 * @returns {number} quantized timestamp
 */
export function snapToNearestBeat(time, beats, tolerance = 0.18) {
    const t = Number(time);
    if (!Array.isArray(beats) || beats.length === 0 || !Number.isFinite(t)) return t;

    let closest = t;
    let minDiff = tolerance;

    for (const beat of beats) {
        const diff = Math.abs(beat - t);
        if (diff < minDiff) {
            minDiff = diff;
            closest = beat;
        }
        if (beat > t + tolerance) break;
    }

    return closest;
}

/**
 * Generate a dynamic volume envelope for background music, ducking under speech.
 *
 * @param {Array<{start:number, end:number}>} speechIntervals segments where dialogue occurs
 * @param {number} totalDuration duration of music track
 * @param {object} [opts]
 * @param {number} [opts.duckGain=0.22] volume level when speech is active (0.22 ≈ -13 dB)
 * @param {number} [opts.normalGain=1.0] volume level during pauses
 * @param {number} [opts.attack=0.18] fade-down time in seconds
 * @param {number} [opts.release=0.35] fade-up time in seconds
 * @returns {Array<{time:number, volume:number}>} sorted keyframe envelope
 */
export function buildDuckingEnvelope(speechIntervals, totalDuration, opts = {}) {
    const dur = Math.max(0.5, Number(totalDuration) || 0);
    const duckGain = clamp(Number.isFinite(Number(opts.duckGain)) ? Number(opts.duckGain) : 0.22, 0.05, 0.8);
    const normalGain = clamp(Number.isFinite(Number(opts.normalGain)) ? Number(opts.normalGain) : 1.0, 0.2, 1.5);
    const attack = clamp(Number(opts.attack) || 0.18, 0.05, 0.5);
    const release = clamp(Number(opts.release) || 0.35, 0.1, 1.0);

    if (!Array.isArray(speechIntervals) || speechIntervals.length === 0) {
        return [
            { time: 0, volume: normalGain },
            { time: dur, volume: normalGain },
        ];
    }

    // Merge overlapping speech intervals with 0.3s padding bridge
    const sorted = [...speechIntervals]
        .map(s => ({ start: Math.max(0, Number(s.start) || 0), end: Math.min(dur, Number(s.end) || 0) }))
        .filter(s => s.end > s.start)
        .sort((a, b) => a.start - b.start);

    const merged = [];
    for (const seg of sorted) {
        if (!merged.length) {
            merged.push({ ...seg });
        } else {
            const last = merged[merged.length - 1];
            if (seg.start <= last.end + 0.3) {
                last.end = Math.max(last.end, seg.end);
            } else {
                merged.push({ ...seg });
            }
        }
    }

    const points = [];
    let curTime = 0;

    for (const seg of merged) {
        // Pre-speech resting normal
        const duckStart = Math.max(0, seg.start - attack);
        if (duckStart > curTime) {
            points.push({ time: Number(curTime.toFixed(3)), volume: normalGain });
            points.push({ time: Number(duckStart.toFixed(3)), volume: normalGain });
        }

        // Ramp down into duck
        points.push({ time: Number(seg.start.toFixed(3)), volume: duckGain });

        // Hold during speech
        points.push({ time: Number(seg.end.toFixed(3)), volume: duckGain });

        // Ramp up after speech
        const recoverEnd = Math.min(dur, seg.end + release);
        points.push({ time: Number(recoverEnd.toFixed(3)), volume: normalGain });

        curTime = recoverEnd;
    }

    if (curTime < dur) {
        points.push({ time: Number(dur.toFixed(3)), volume: normalGain });
    }

    // Deduplicate identical adjacent timestamps
    const clean = [];
    for (const pt of points) {
        if (!clean.length || Math.abs(clean[clean.length - 1].time - pt.time) > 0.01) {
            clean.push(pt);
        }
    }

    return clean;
}

/**
 * Format an FFmpeg volume filter expression for the ducking envelope.
 *
 * @param {Array<{time:number, volume:number}>} envelope
 * @returns {string} e.g. "volume='if(between(t,1.2,4.5),0.22,1.0)'"
 */
export function buildFfmpegDuckingFilter(envelope) {
    if (!Array.isArray(envelope) || envelope.length < 2) return 'volume=1.0';

    // Build piecewise linear interpolation formula or stepped intervals
    const ducks = [];
    for (let i = 0; i < envelope.length - 1; i++) {
        const p1 = envelope[i];
        const p2 = envelope[i + 1];
        if (p1.volume < 0.8 || p2.volume < 0.8) {
            ducks.push(`between(t,${p1.time},${p2.time})*${((p1.volume + p2.volume) / 2).toFixed(2)}`);
        }
    }

    if (!ducks.length) return 'volume=1.0';
    return `volume='if(${ducks.join('+')},${ducks[0].split('*')[1] || '0.25'},1.0)'`;
}

export default {
    detectMusicalBeats,
    snapToNearestBeat,
    buildDuckingEnvelope,
    buildFfmpegDuckingFilter,
};
