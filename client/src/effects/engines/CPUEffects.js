/**
 * CPUEffects.js
 * FFmpeg-based effect engine for deterministic final rendering.
 * 
 * Compiles effect chains to FFmpeg filter graphs for export.
 */

import { ENGINE_TYPES } from '../EffectNode.js';
import { effectRegistry } from '../EffectRegistry.js';

// ============================================================================
// CPU EFFECT ENGINE CLASS
// ============================================================================

export class CPUEffectEngine {
    constructor(options = {}) {
        this.apiEndpoint = options.apiEndpoint || '/api/export';
    }

    // ========================================================================
    // FILTER COMPILATION
    // ========================================================================

    /**
     * Compile a single effect to FFmpeg filter string
     * @param {EffectNode} effect - Effect to compile
     * @param {object} context - Compilation context
     * @returns {string|null} FFmpeg filter string
     */
    compileEffect(effect, context = {}) {
        if (effect.engine !== ENGINE_TYPES.CPU) {
            return null;
        }

        const params = effect.getParamsSnapshot();
        const effectDef = effectRegistry.get(effect.type);

        // These effects have maintained implementations below. Prefer them
        // over legacy registry callbacks so declared controls (fade color,
        // pitch preservation, LUT intensity, etc.) are not silently skipped.
        switch (effect.type) {
            case 'fade_in': return this._compileFadeIn(params, context, effect);
            case 'fade_out': return this._compileFadeOut(params, context, effect);
            case 'speed_change': return this._compileSpeedChange(params);
            case 'lut_apply': return this._compileLUT(params);
            case 'audio_normalize': return this._compileNormalize(params);
            case 'audio_denoise': return this._compileDenoise(params);
            case 'crop': return this._compileCrop(params, context);
            case 'scale': return this._compileScale(params);
            case 'rotate': return this._compileRotate(params);
            default: break;
        }

        // Use definition's FFmpeg filter generator if available
        if (effectDef?.ffmpegFilter) {
            if (typeof effectDef.ffmpegFilter === 'function') {
                return effectDef.ffmpegFilter(params, {
                    ...context,
                    startTime: effect.startTime,
                    endTime: effect.endTime
                });
            }
            return effectDef.ffmpegFilter;
        }

        console.warn(`[CPUEffects] Unknown effect type: ${effect.type}`);
        return null;
    }

    // ========================================================================
    // INDIVIDUAL FILTER COMPILERS
    // ========================================================================

    _compileFadeIn(params, context, effect) {
        const startTime = effect.startTime ?? context.startTime ?? 0;
        const duration = params.duration || 0.5;
        const color = params.color || [0, 0, 0];
        const colorHex = this._rgbToHex(color);

        return `fade=t=in:st=${startTime.toFixed(3)}:d=${duration.toFixed(3)}:color=${colorHex}`;
    }

    _compileFadeOut(params, context, effect) {
        const endTime = effect.endTime ?? context.endTime ?? context.duration ?? 10;
        const duration = params.duration || 0.5;
        const color = params.color || [0, 0, 0];
        const colorHex = this._rgbToHex(color);
        const startTime = endTime - duration;

        return `fade=t=out:st=${startTime.toFixed(3)}:d=${duration.toFixed(3)}:color=${colorHex}`;
    }

    _compileSpeedChange(params) {
        const speed = params.speed || 1.0;
        if (speed === 1.0) return null;

        const pts = 1 / speed;
        const filters = [`setpts=${pts.toFixed(4)}*PTS`];

        // Audio speed adjustment
        if (params.maintainPitch) {
            // atempo only accepts 0.5 to 2.0, chain for extreme speeds
            let remaining = speed;
            while (remaining > 2.0) {
                filters.push('atempo=2.0');
                remaining /= 2.0;
            }
            while (remaining < 0.5) {
                filters.push('atempo=0.5');
                remaining /= 0.5;
            }
            filters.push(`atempo=${remaining.toFixed(4)}`);
        } else {
            // Simple pitch-shifting
            filters.push(`asetrate=44100*${speed.toFixed(4)},aresample=44100`);
        }

        return filters.join(',');
    }

    _compileLUT(params) {
        if (!params.lutFile) return null;
        return `lut3d=file='${this._escapeFilterPath(params.lutFile)}'`;
    }

    _compileNormalize(params) {
        const targetLevel = params.targetLevel ?? -3;
        return `loudnorm=I=${targetLevel}:TP=-1.5:LRA=11`;
    }

    _compileDenoise(params) {
        const amount = Math.max(0, Math.min(1, Number(params.amount ?? 0.5)));
        // FFmpeg afftdn accepts nf in [-80, -20]. Move toward -20 for
        // stronger denoising; the old -20 + amount*20 formula exceeded the
        // filter's legal range for every positive strength and failed export.
        const noiseFloor = -80 + amount * 60;
        return `afftdn=nf=${noiseFloor.toFixed(1)}`;
    }

    _compileCrop(params, context) {
        const w = params.width || context.width || 1920;
        const h = params.height || context.height || 1080;
        const x = params.x || 0;
        const y = params.y || 0;

        return `crop=${w}:${h}:${x}:${y}`;
    }

    _compileScale(params) {
        const w = params.width || -1;
        const h = params.height || -1;
        const algorithm = params.algorithm || 'lanczos';

        return `scale=${w}:${h}:flags=${algorithm}`;
    }

    _compileRotate(params) {
        const angle = params.angle || 0;
        const radians = angle * Math.PI / 180;

        return `rotate=${radians.toFixed(4)}:c=black:ow=rotw(${radians.toFixed(4)}):oh=roth(${radians.toFixed(4)})`;
    }

    // ========================================================================
    // CHAIN COMPILATION
    // ========================================================================

    /**
     * Compile array of effects to FFmpeg filter_complex string
     * @param {EffectNode[]} effects - Effects to compile
     * @param {object} context - Compilation context
     * @returns {object} Compiled filter info
     */
    compileChain(effects, context = {}) {
        const cpuEffects = effects.filter(e => e.enabled && e.engine === ENGINE_TYPES.CPU);

        if (cpuEffects.length === 0) {
            return { filter: null, hasVideo: false, hasAudio: false };
        }

        const videoFilters = [];
        const audioFilters = [];
        const needsFilterGraph = cpuEffects.some(effect => effect.type === 'lut_apply'
            && effect.getParamsSnapshot().lutFile
            && Number(effect.getParamsSnapshot().intensity ?? 1) < 1);

        let filterComplex = null;
        if (needsFilterGraph) {
            const graph = [];
            let current = '0:v';
            let labelIndex = 0;
            for (const effect of cpuEffects) {
                const filter = this.compileEffect(effect, context);
                if (!filter) continue;
                if (this._isAudioFilter(effect.type)) {
                    audioFilters.push(filter);
                    continue;
                }
                if (effect.type === 'speed_change') {
                    const [videoFilter, ...speedFilters] = filter.split(',');
                    if (videoFilter) {
                        const output = `fxv${labelIndex++}`;
                        graph.push(`[${current}]${videoFilter}[${output}]`);
                        current = output;
                    }
                    if (speedFilters.length) audioFilters.push(speedFilters.join(','));
                    continue;
                }
                if (effect.type === 'lut_apply') {
                    const params = effect.getParamsSnapshot();
                    const intensity = Math.max(0, Math.min(1, Number(params.intensity ?? 1)));
                    if (!params.lutFile || intensity >= 1) {
                        const output = `fxv${labelIndex++}`;
                        graph.push(`[${current}]${filter}[${output}]`);
                        current = output;
                        continue;
                    }
                    const index = labelIndex++;
                    const base = `lutbase${index}`, lutInput = `lutinput${index}`;
                    const lutOutput = `lutout${index}`, output = `fxv${index}`;
                    graph.push(`[${current}]split=2[${base}][${lutInput}]`);
                    graph.push(`[${lutInput}]lut3d=file='${this._escapeFilterPath(params.lutFile)}'[${lutOutput}]`);
                    graph.push(`[${base}][${lutOutput}]blend=all_opacity=${intensity.toFixed(3)}[${output}]`);
                    current = output;
                    continue;
                }
                const output = `fxv${labelIndex++}`;
                graph.push(`[${current}]${filter}[${output}]`);
                current = output;
            }
            graph.push(`[${current}]null[vout]`);
            filterComplex = graph.join(';');
        }

        if (!needsFilterGraph) for (const effect of cpuEffects) {
            const filter = this.compileEffect(effect, context);
            if (!filter) continue;

            // Classify as audio or video filter
            if (this._isAudioFilter(effect.type)) {
                audioFilters.push(filter);
            } else if (effect.type === 'speed_change') {
                const [videoFilter, ...speedFilters] = filter.split(',');
                if (videoFilter) videoFilters.push(videoFilter);
                if (speedFilters.length) audioFilters.push(speedFilters.join(','));
            } else {
                videoFilters.push(filter);
            }
        }

        return {
            videoFilter: videoFilters.length > 0 ? videoFilters.join(',') : null,
            filterComplex,
            videoFilterComplex: needsFilterGraph,
            audioFilter: audioFilters.length > 0 ? audioFilters.join(',') : null,
            hasVideo: videoFilters.length > 0 || needsFilterGraph,
            hasAudio: audioFilters.length > 0
        };
    }

    /**
     * Build complete FFmpeg command arguments
     */
    buildCommand(inputPath, outputPath, effects, context = {}) {
        const { videoFilter, filterComplex, videoFilterComplex, audioFilter, hasVideo, hasAudio } = this.compileChain(effects, context);

        const args = ['-i', inputPath];

        if (hasVideo) {
            if (videoFilterComplex) args.push('-filter_complex', filterComplex, '-map', '[vout]', '-map', '0:a?');
            else args.push('-vf', videoFilter);
        }

        if (hasAudio) {
            args.push('-af', audioFilter);
        }

        // Output settings
        if (context.codec) {
            args.push('-c:v', context.codec);
        }

        if (context.crf !== undefined) {
            args.push('-crf', String(context.crf));
        }

        if (context.preset) {
            args.push('-preset', context.preset);
        }

        args.push('-y', outputPath);

        return args;
    }

    // ========================================================================
    // FILTER GRAPH (Complex Compositions)
    // ========================================================================

    /**
     * Build filter_complex for multi-input compositions
     */
    buildFilterComplex(inputs, effects, context = {}) {
        const graph = [];
        let streamIndex = 0;

        // Input streams
        const inputLabels = inputs.map((_, i) => `[${i}:v]`);

        // Overlay composition (if multiple inputs)
        if (inputs.length > 1) {
            let baseLabel = inputLabels[0];

            for (let i = 1; i < inputs.length; i++) {
                const outLabel = `[v${streamIndex++}]`;
                const overlayPos = inputs[i].position || { x: 0, y: 0 };

                graph.push(
                    `${baseLabel}${inputLabels[i]}overlay=${overlayPos.x}:${overlayPos.y}${outLabel}`
                );

                baseLabel = outLabel;
            }
        }

        // Apply effects to final composite
        const compiled = this.compileChain(effects, context);
        const { videoFilter, audioFilter } = compiled;
        let videoOutput = graph.length > 0 ? `[v${streamIndex - 1}]` : '[0:v]';
        if (compiled.videoFilterComplex && compiled.filterComplex) {
            graph.push(compiled.filterComplex.replaceAll('[0:v]', videoOutput));
            videoOutput = '[vout]';
        } else if (videoFilter) {
            graph.push(`${videoOutput}${videoFilter}[vout]`);
            videoOutput = '[vout]';
        } else if (inputs.length > 1) {
            // An overlay graph always needs a named terminal stream. Returning
            // [vout] without creating it made effect-free multi-input renders
            // fail at FFmpeg's output-map stage.
            graph.push(`${videoOutput}null[vout]`);
            videoOutput = '[vout]';
        }

        // Audio is opt-in because some image/video inputs have no audio
        // stream. The caller can mark the base input (`hasAudio: true`) or
        // provide an explicit stream index in context.
        const explicitAudioInput = Number.isInteger(context.audioInputIndex);
        const audioInputIndex = explicitAudioInput
            ? context.audioInputIndex
            : inputs.findIndex(input => input?.hasAudio === true);
        let audioOutput = null;
        if (audioFilter && audioInputIndex >= 0 && (explicitAudioInput || audioInputIndex < inputs.length)) {
            graph.push(`[${audioInputIndex}:a]${audioFilter}[aout]`);
            audioOutput = '[aout]';
        }

        return {
            filterComplex: graph.join(';'),
            outputMap: videoOutput,
            audioMap: audioOutput,
            hasAudio: audioOutput !== null,
        };
    }

    // ========================================================================
    // UTILITIES
    // ========================================================================

    _isAudioFilter(type) {
        const audioTypes = [
            'audio_normalize',
            'audio_denoise',
            'audio_eq',
            'audio_compress',
            'volume'
        ];
        return audioTypes.includes(type);
    }

    _rgbToHex(rgb) {
        const r = Math.round((rgb[0] || 0) * 255);
        const g = Math.round((rgb[1] || 0) * 255);
        const b = Math.round((rgb[2] || 0) * 255);
        return `0x${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    _escapeFilterPath(path) {
        return String(path || '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    }

    // ========================================================================
    // API INTERACTION
    // ========================================================================

    /**
     * Execute FFmpeg job via API
     */
    async executeJob(inputPath, outputPath, effects, context = {}, onProgress = null) {
        const command = this.buildCommand(inputPath, outputPath, effects, context);

        const response = await fetch(`${this.apiEndpoint}/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                command,
                inputPath,
                outputPath
            })
        });

        if (!response.ok) {
            throw new Error(`FFmpeg job failed: ${response.statusText}`);
        }

        // Handle progress streaming if available
        if (response.body && onProgress) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                const progress = this._parseProgress(text);
                if (progress !== null) {
                    onProgress(progress);
                }
            }
        }

        return response.json();
    }

    _parseProgress(text) {
        // Parse FFmpeg progress output
        const match = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
        if (match) {
            const hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            const seconds = parseFloat(match[3]);
            return hours * 3600 + minutes * 60 + seconds;
        }
        return null;
    }

    /**
     * Check if effect type is supported
     */
    supportsEffect(type) {
        const def = effectRegistry.get(type);
        return def?.engine === ENGINE_TYPES.CPU;
    }

    /**
     * Get list of supported effects
     */
    getSupportedEffects() {
        return effectRegistry.getByEngine(ENGINE_TYPES.CPU).map(e => e.type);
    }
}

export default CPUEffectEngine;
