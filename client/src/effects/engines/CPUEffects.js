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

        // Built-in filter compilation
        switch (effect.type) {
            case 'fade_in':
                return this._compileFadeIn(params, context, effect);

            case 'fade_out':
                return this._compileFadeOut(params, context, effect);

            case 'speed_change':
                return this._compileSpeedChange(params);

            case 'lut_apply':
                return this._compileLUT(params);

            case 'audio_normalize':
                return this._compileNormalize(params);

            case 'audio_denoise':
                return this._compileDenoise(params);

            case 'crop':
                return this._compileCrop(params, context);

            case 'scale':
                return this._compileScale(params);

            case 'rotate':
                return this._compileRotate(params);

            default:
                console.warn(`[CPUEffects] Unknown effect type: ${effect.type}`);
                return null;
        }
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

        const intensity = params.intensity ?? 1.0;

        if (intensity < 1.0) {
            // Blend with original using mix filter
            return `split[a][b];[a]lut3d=${params.lutFile}[lut];[b][lut]blend=all_opacity=${intensity.toFixed(2)}`;
        }

        return `lut3d=${params.lutFile}`;
    }

    _compileNormalize(params) {
        const targetLevel = params.targetLevel ?? -3;
        return `loudnorm=I=${targetLevel}:TP=-1.5:LRA=11`;
    }

    _compileDenoise(params) {
        const amount = params.amount ?? 0.5;
        const noiseFloor = -20 + amount * 20;
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

        for (const effect of cpuEffects) {
            const filter = this.compileEffect(effect, context);
            if (!filter) continue;

            // Classify as audio or video filter
            if (this._isAudioFilter(effect.type)) {
                audioFilters.push(filter);
            } else {
                videoFilters.push(filter);
            }
        }

        return {
            videoFilter: videoFilters.length > 0 ? videoFilters.join(',') : null,
            audioFilter: audioFilters.length > 0 ? audioFilters.join(',') : null,
            hasVideo: videoFilters.length > 0,
            hasAudio: audioFilters.length > 0
        };
    }

    /**
     * Build complete FFmpeg command arguments
     */
    buildCommand(inputPath, outputPath, effects, context = {}) {
        const { videoFilter, audioFilter, hasVideo, hasAudio } = this.compileChain(effects, context);

        const args = ['-i', inputPath];

        if (hasVideo) {
            args.push('-vf', videoFilter);
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
        const { videoFilter } = this.compileChain(effects, context);
        if (videoFilter) {
            const lastLabel = graph.length > 0 ? `[v${streamIndex - 1}]` : '[0:v]';
            graph.push(`${lastLabel}${videoFilter}[vout]`);
        }

        return {
            filterComplex: graph.join(';'),
            outputMap: graph.length > 0 ? '[vout]' : '[0:v]'
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
