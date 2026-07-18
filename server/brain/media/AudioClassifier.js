/**
 * server/brain/media/AudioClassifier.js
 *
 * Analyses audio characteristics of a media file using ffmpeg-static.
 * Pattern mirrors silenceRoutes.js — uses the same ffmpeg-static binary.
 *
 * All methods return safe default objects on error — never throw to caller.
 */

'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execFileAsync = promisify(execFile);

// Match silenceRoutes.js — use ffmpeg-static explicitly
let ffmpegPath;
try {
    ffmpegPath = require('ffmpeg-static');
} catch {
    ffmpegPath = 'ffmpeg'; // system fallback
}

const MAX_BUFFER = 1024 * 1024 * 50; // 50 MB

class AudioClassifier {

    /**
     * Classify the audio content of a media file.
     *
     * @param {string} filePath  - Absolute path to the media file
     * @returns {Promise<Object>} Audio analysis result
     */
    async classify(filePath) {
        try {
            const hasAudio = await this.detectAudio(filePath);
            if (!hasAudio) {
                return { audioType: 'silent', hasAudio: false, hasSpokenWord: false };
            }

            const [loudness, spectrum] = await Promise.all([
                this.analyzeLoudness(filePath).catch(() => null),
                this.analyzeSpectrum(filePath).catch(() => null),
            ]);

            const audioType = this._inferAudioType(loudness, spectrum);

            return {
                audioType,
                hasAudio: true,
                hasSpokenWord: audioType === 'speech' || audioType === 'speech_with_music',
                integratedLoudness: loudness?.integratedLoudness ?? null,
                loudnessRange:      loudness?.loudnessRange ?? null,
                truePeak:           loudness?.truePeak ?? null,
                spectrumPeak:       spectrum?.peakFreq ?? null,
                rmsLevel:           spectrum?.rmsLevel ?? null,
                isMono:             spectrum?.isMono ?? null,
                rawLoudness:        loudness,
                rawSpectrum:        spectrum,
            };
        } catch (err) {
            console.error('[AudioClassifier] classify error:', err.message);
            return { audioType: 'unknown', hasAudio: false, hasSpokenWord: false, error: true };
        }
    }

    /**
     * Detect whether the file has any audio stream.
     * @param {string} filePath
     * @returns {Promise<boolean>}
     */
    async detectAudio(filePath) {
        try {
            if (!fs.existsSync(filePath)) return false;

            const { stdout } = await execFileAsync(ffmpegPath, [
                '-i', filePath,
                '-hide_banner',
            ], { maxBuffer: MAX_BUFFER }).catch(err => ({
                // ffmpeg exits non-zero for -i alone — stderr has what we need
                stdout: '', stderr: err.stderr || err.message || '',
            }));

            // Also check stderr (ffmpeg writes probe info to stderr)
            const { stderr } = await execFileAsync(ffmpegPath, [
                '-i', filePath, '-hide_banner',
            ], { maxBuffer: MAX_BUFFER }).catch(err => ({
                stdout: '', stderr: err.stderr || '',
            }));

            const combined = (stdout + stderr);
            return /Stream.*Audio/.test(combined);
        } catch {
            return false;
        }
    }

    /**
     * Measure integrated loudness using the EBU R128 loudnorm filter.
     * @param {string} filePath
     * @returns {Promise<Object|null>}
     */
    async analyzeLoudness(filePath) {
        try {
            // ffmpeg loudnorm in measurement-only mode writes JSON to stderr
            const { stderr } = await execFileAsync(ffmpegPath, [
                '-i', filePath,
                '-af', 'loudnorm=print_format=json',
                '-f', 'null', '-',
            ], { maxBuffer: MAX_BUFFER }).catch(err => ({
                stdout: '', stderr: err.stderr || '',
            }));

            // Extract the JSON block from loudnorm output
            const match = stderr.match(/\{[\s\S]*"input_i"[\s\S]*?\}/);
            if (!match) return null;

            const parsed = JSON.parse(match[0]);
            return {
                integratedLoudness: parseFloat(parsed.input_i) || null,
                loudnessRange:      parseFloat(parsed.input_lra) || null,
                truePeak:           parseFloat(parsed.input_tp) || null,
                threshold:          parseFloat(parsed.input_thresh) || null,
            };
        } catch (err) {
            console.error('[AudioClassifier] analyzeLoudness error:', err.message);
            return null;
        }
    }

    /**
     * Measure audio spectrum characteristics using astats filter.
     * @param {string} filePath
     * @returns {Promise<Object|null>}
     */
    async analyzeSpectrum(filePath) {
        try {
            const { stderr } = await execFileAsync(ffmpegPath, [
                '-i', filePath,
                '-af', 'astats=metadata=1:reset=1',
                '-f', 'null', '-',
            ], { maxBuffer: MAX_BUFFER }).catch(err => ({
                stdout: '', stderr: err.stderr || '',
            }));

            // Extract RMS level from astats output
            const rmsMatch  = stderr.match(/RMS level dB:\s+([-\d.]+)/);
            const peakMatch = stderr.match(/Peak level dB:\s+([-\d.]+)/);
            const monoMatch = stderr.match(/Number of channels:\s+(\d+)/);

            return {
                rmsLevel:  rmsMatch  ? parseFloat(rmsMatch[1])  : null,
                peakLevel: peakMatch ? parseFloat(peakMatch[1]) : null,
                isMono:    monoMatch ? parseInt(monoMatch[1], 10) === 1 : null,
                peakFreq:  null, // astats doesn't give dominant frequency — would need afftfilt
            };
        } catch (err) {
            console.error('[AudioClassifier] analyzeSpectrum error:', err.message);
            return null;
        }
    }

    /**
     * Infer audio type from loudness and spectrum measurements.
     * @private
     */
    _inferAudioType(loudness, spectrum) {
        if (!loudness && !spectrum) return 'audio'; // generic

        const integrated = loudness?.integratedLoudness;
        const rms        = spectrum?.rmsLevel;

        // Very low level = probably ambient/background only
        if (integrated !== null && integrated < -40) return 'ambient';

        // Typical speech: -18 to -28 LUFS integrated
        if (integrated !== null && integrated >= -28 && integrated <= -12) return 'speech';

        // Loud and dynamic = likely music
        if (integrated !== null && integrated > -10) return 'music';

        // Loud with speech mix
        if (integrated !== null && integrated >= -15 && rms !== null && rms > -20) return 'speech_with_music';

        return 'audio';
    }
}

module.exports = { AudioClassifier };
