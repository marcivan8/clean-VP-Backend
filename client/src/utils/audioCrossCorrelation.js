/**
 * client/src/utils/audioCrossCorrelation.js
 *
 * Automated acoustic waveform cross-correlation for video and audio synchronization.
 * Synchronizes dual-system sound (separate mic + camera scratch track) and
 * multi-camera interview angles with sub-millisecond precision.
 *
 * Hybrid operation:
 * 1. Client-side Web Audio OfflineAudioContext for instant zero-latency sync.
 * 2. Fallback to POST /api/audio/align for large remote assets.
 */

import { authFetch } from './authFetch.js';

/**
 * Computes normalized cross-correlation between two 1D audio sample arrays.
 * Uses a coarse-to-fine search for optimal performance and sub-frame precision.
 *
 * @param {Float32Array|Int16Array|number[]} sigRef - Reference audio signal
 * @param {Float32Array|Int16Array|number[]} sigTarget - Target audio signal to align
 * @param {number} sampleRate - Signal sample rate in Hz (e.g. 8000 or 11025)
 * @param {number} maxOffsetSec - Maximum search window in seconds (default 30s)
 * @returns {{ offsetSeconds: number, confidence: number }}
 */
export function computeCrossCorrelation(sigRef, sigTarget, sampleRate = 8000, maxOffsetSec = 30) {
    if (!sigRef || !sigTarget || sigRef.length === 0 || sigTarget.length === 0) {
        return { offsetSeconds: 0, confidence: 0 };
    }

    const maxLag = Math.min(Math.round(maxOffsetSec * sampleRate), sigRef.length, sigTarget.length);
    const len = Math.min(sigRef.length, sigTarget.length);

    // Compute mean and standard deviation for normalization
    let sumRef = 0;
    let sumTarget = 0;
    for (let i = 0; i < len; i += 4) {
        sumRef += sigRef[i];
        sumTarget += sigTarget[i];
    }
    const meanRef = sumRef / (len / 4);
    const meanTarget = sumTarget / (len / 4);

    let varRef = 0;
    let varTarget = 0;
    for (let i = 0; i < len; i += 4) {
        const dR = sigRef[i] - meanRef;
        const dT = sigTarget[i] - meanTarget;
        varRef += dR * dR;
        varTarget += dT * dT;
    }
    const normFactor = Math.sqrt(varRef * varTarget) || 1;

    let bestLag = 0;
    let maxCorr = -Infinity;

    // Stage 1: Coarse search (stride = 8 samples, ~1ms at 8kHz)
    const coarseStride = 8;
    for (let lag = -maxLag; lag <= maxLag; lag += coarseStride) {
        let sum = 0;
        let count = 0;
        const startI = Math.max(0, -lag);
        const endI = Math.min(len, len - lag);

        for (let i = startI; i < endI; i += 8) {
            sum += (sigRef[i] - meanRef) * (sigTarget[i + lag] - meanTarget);
            count++;
        }

        if (count > 0 && sum > maxCorr) {
            maxCorr = sum;
            bestLag = lag;
        }
    }

    // Stage 2: Fine search around coarse peak (stride = 1 sample)
    const fineRange = coarseStride * 2;
    const startLag = Math.max(-maxLag, bestLag - fineRange);
    const endLag = Math.min(maxLag, bestLag + fineRange);

    for (let lag = startLag; lag <= endLag; lag++) {
        let sum = 0;
        let count = 0;
        const startI = Math.max(0, -lag);
        const endI = Math.min(len, len - lag);

        for (let i = startI; i < endI; i += 2) {
            sum += (sigRef[i] - meanRef) * (sigTarget[i + lag] - meanTarget);
            count++;
        }

        if (count > 0 && sum > maxCorr) {
            maxCorr = sum;
            bestLag = lag;
        }
    }

    const confidence = Math.max(0, Math.min(1, maxCorr / (normFactor / 2)));
    const offsetSeconds = bestLag / sampleRate;

    return {
        offsetSeconds: Number(offsetSeconds.toFixed(4)),
        confidence: Number(confidence.toFixed(3)),
    };
}

/**
 * Decodes an audio or video file URL into a mono Float32Array at a target sample rate.
 *
 * @param {string|Blob|File} source - Media URL or Blob
 * @param {number} targetSampleRate - Desired sample rate (default 8000)
 * @param {number} maxDurationSec - Max duration to decode (default 60s)
 * @returns {Promise<Float32Array>}
 */
export async function decodeAudioToMono(source, targetSampleRate = 8000, maxDurationSec = 60) {
    let arrayBuffer;
    if (typeof source === 'string') {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`Failed to fetch media for audio alignment: ${res.statusText}`);
        arrayBuffer = await res.arrayBuffer();
    } else if (source instanceof Blob || source instanceof File) {
        arrayBuffer = await source.arrayBuffer();
    } else {
        throw new Error('Unsupported audio source format for decoding');
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
        throw new Error('Web Audio API not supported in this environment');
    }

    const tempCtx = new AudioContextClass();
    let audioBuffer;
    try {
        audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    } finally {
        if (tempCtx.close) tempCtx.close().catch(() => {});
    }

    const srcDuration = Math.min(audioBuffer.duration, maxDurationSec);
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        1,
        Math.round(srcDuration * targetSampleRate),
        targetSampleRate
    );

    const sourceNode = offlineCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(offlineCtx.destination);
    sourceNode.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    return renderedBuffer.getChannelData(0);
}

/**
 * Hybrid alignment: Tries client-side Web Audio cross-correlation first.
 * If client decoding fails (e.g. cross-origin media), delegates to /api/audio/align.
 *
 * @param {object} refClip - Reference clip with url/sourceUrl
 * @param {object} targetClip - Target clip to align
 * @param {object} options - Options { maxOffsetSec, sampleRate }
 * @returns {Promise<{ offsetSeconds: number, confidence: number, method: 'client'|'server' }>}
 */
export async function alignAudioClips(refClip, targetClip, options = {}) {
    const maxOffsetSec = options.maxOffsetSec || 30;
    const sampleRate = options.sampleRate || 8000;

    const refUrl = refClip?.sourceUrl || refClip?.url;
    const targetUrl = targetClip?.sourceUrl || targetClip?.url;

    if (!refUrl || !targetUrl) {
        throw new Error('Both clips must have a valid media URL to synchronize.');
    }

    // Attempt 1: Fast in-browser Web Audio cross-correlation
    try {
        const [refSignal, targetSignal] = await Promise.all([
            decodeAudioToMono(refUrl, sampleRate, maxOffsetSec * 2),
            decodeAudioToMono(targetUrl, sampleRate, maxOffsetSec * 2),
        ]);

        const result = computeCrossCorrelation(refSignal, targetSignal, sampleRate, maxOffsetSec);
        if (result.confidence >= 0.25) {
            return { ...result, method: 'client' };
        }
    } catch (clientErr) {
        console.warn('[audioCrossCorrelation] Client decode failed, falling back to server align API:', clientErr.message);
    }

    // Attempt 2: Server-side FFmpeg align endpoint
    const response = await authFetch('/api/audio/align', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            referenceFile: refClip.filename || refUrl,
            targetFile: targetClip.filename || targetUrl,
            maxOffsetSec,
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server audio alignment failed with status ${response.status}`);
    }

    const serverData = await response.json();
    return {
        offsetSeconds: serverData.offsetSeconds,
        confidence: serverData.confidence,
        method: 'server',
    };
}
