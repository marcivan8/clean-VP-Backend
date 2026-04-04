/**
 * AIEffects.js
 * AI-powered effect engine for intelligent video processing.
 * 
 * Provides async analysis for smart zoom, beat detection, and emotion framing.
 */

import { ENGINE_TYPES } from '../EffectNode.js';

// ============================================================================
// AI EFFECT ENGINE CLASS
// ============================================================================

export class AIEffectEngine {
    constructor(options = {}) {
        this.apiBase = options.apiBase || '/api/effects';
        this.cache = new Map();
        this.cacheExpiry = options.cacheExpiry || 5 * 60 * 1000; // 5 minutes
        this.fallbackEnabled = options.fallbackEnabled ?? true;
    }

    // ========================================================================
    // SMART ZOOM ANALYSIS
    // ========================================================================

    /**
     * Analyze video for smart zoom tracking
     * @param {string} videoUrl - Video source URL
     * @param {object} options - Analysis options
     * @returns {Promise<object>} Zoom keyframes and tracking data
     */
    async analyzeSmartZoom(videoUrl, options = {}) {
        const cacheKey = `smart_zoom:${videoUrl}:${JSON.stringify(options)}`;

        // Check cache
        const cached = this._getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const response = await fetch(`${this.apiBase}/smart-zoom`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoUrl,
                    subject: options.subject || 'face',
                    zoomLevel: options.zoomLevel || 1.5,
                    smoothness: options.smoothness || 0.5,
                    startTime: options.startTime,
                    endTime: options.endTime
                })
            });

            if (!response.ok) {
                throw new Error(`Smart zoom analysis failed: ${response.statusText}`);
            }

            const result = await response.json();

            // Cache result
            this._setCache(cacheKey, result);

            return result;
        } catch (error) {
            console.warn('[AIEffects] Smart zoom analysis failed:', error.message);

            if (this.fallbackEnabled) {
                return this._fallbackSmartZoom(options);
            }

            throw error;
        }
    }

    _fallbackSmartZoom(options) {
        const zoomLevel = options.zoomLevel || 1.5;
        const startTime = options.startTime || 0;
        const endTime = options.endTime || 10;
        const duration = endTime - startTime;

        // Generate static center zoom as fallback
        return {
            success: false,
            fallback: true,
            keyframes: [
                {
                    time: startTime,
                    x: 0.5,
                    y: 0.5,
                    scale: 1.0,
                    easing: 'easeInOut'
                },
                {
                    time: startTime + duration * 0.2,
                    x: 0.5,
                    y: 0.4,  // Slight upward pan assuming face
                    scale: zoomLevel,
                    easing: 'linear'
                },
                {
                    time: endTime - duration * 0.2,
                    x: 0.5,
                    y: 0.4,
                    scale: zoomLevel,
                    easing: 'easeInOut'
                },
                {
                    time: endTime,
                    x: 0.5,
                    y: 0.5,
                    scale: 1.0,
                    easing: 'linear'
                }
            ],
            detections: []
        };
    }

    // ========================================================================
    // BEAT DETECTION
    // ========================================================================

    /**
     * Detect beats in audio track
     * @param {string} audioUrl - Audio source URL
     * @param {object} options - Detection options
     * @returns {Promise<object>} Beat timestamps and BPM info
     */
    async analyzeBeatSync(audioUrl, options = {}) {
        const cacheKey = `beat_sync:${audioUrl}:${JSON.stringify(options)}`;

        const cached = this._getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const response = await fetch(`${this.apiBase}/beat-detect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audioUrl,
                    beatDivision: options.beatDivision || 1,
                    sensitivity: options.sensitivity || 0.5,
                    startTime: options.startTime,
                    endTime: options.endTime
                })
            });

            if (!response.ok) {
                throw new Error(`Beat detection failed: ${response.statusText}`);
            }

            const result = await response.json();

            this._setCache(cacheKey, result);

            return result;
        } catch (error) {
            console.warn('[AIEffects] Beat detection failed:', error.message);

            if (this.fallbackEnabled) {
                return this._fallbackBeatSync(options);
            }

            throw error;
        }
    }

    _fallbackBeatSync(options) {
        // Generate regular beat pattern as fallback (assume 120 BPM)
        const bpm = 120;
        const beatInterval = 60 / bpm / (options.beatDivision || 1);
        const startTime = options.startTime || 0;
        const endTime = options.endTime || 30;

        const beats = [];
        for (let t = startTime; t < endTime; t += beatInterval) {
            beats.push(t);
        }

        return {
            success: false,
            fallback: true,
            bpm,
            beats,
            confidence: 0
        };
    }

    /**
     * Generate effect keyframes synced to beats
     */
    generateBeatSyncKeyframes(beatData, effectType, options = {}) {
        const { beats = [] } = beatData;
        const intensity = options.intensity || 0.5;
        const keyframes = [];

        for (const beatTime of beats) {
            switch (effectType) {
                case 'zoom_pulse':
                    // Quick zoom in and out on beat
                    keyframes.push(
                        { time: beatTime, scale: 1.0 + intensity * 0.3, easing: 'easeOut' },
                        { time: beatTime + 0.1, scale: 1.0, easing: 'easeIn' }
                    );
                    break;

                case 'flash':
                    // Brightness flash
                    keyframes.push(
                        { time: beatTime, brightness: 100 + intensity * 50, easing: 'linear' },
                        { time: beatTime + 0.05, brightness: 100, easing: 'linear' }
                    );
                    break;

                case 'shake':
                    // Shake intensity spike
                    keyframes.push(
                        { time: beatTime, intensity: intensity * 10, easing: 'linear' },
                        { time: beatTime + 0.1, intensity: 0, easing: 'easeOut' }
                    );
                    break;

                case 'cut':
                    // Just return beat times for cut markers
                    keyframes.push({ time: beatTime, cut: true });
                    break;
            }
        }

        return keyframes;
    }

    // ========================================================================
    // EMOTION-BASED FRAMING
    // ========================================================================

    /**
     * Analyze video for emotion-based framing suggestions
     */
    async analyzeEmotionFraming(videoUrl, options = {}) {
        const cacheKey = `emotion:${videoUrl}:${JSON.stringify(options)}`;

        const cached = this._getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const response = await fetch(`${this.apiBase}/emotion-frame`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoUrl,
                    framingStyle: options.framingStyle || 'dynamic',
                    transitionSpeed: options.transitionSpeed || 0.5,
                    startTime: options.startTime,
                    endTime: options.endTime
                })
            });

            if (!response.ok) {
                throw new Error(`Emotion analysis failed: ${response.statusText}`);
            }

            const result = await response.json();

            this._setCache(cacheKey, result);

            return result;
        } catch (error) {
            console.warn('[AIEffects] Emotion analysis failed:', error.message);

            if (this.fallbackEnabled) {
                return this._fallbackEmotionFraming(options);
            }

            throw error;
        }
    }

    _fallbackEmotionFraming(options) {
        const style = options.framingStyle || 'dynamic';
        const startTime = options.startTime || 0;
        const endTime = options.endTime || 10;

        // Static framing suggestions based on style
        const framings = {
            tight: { x: 0.5, y: 0.35, scale: 2.0 },
            wide: { x: 0.5, y: 0.5, scale: 1.0 },
            cinematic: { x: 0.5, y: 0.45, scale: 1.2 },
            dynamic: { x: 0.5, y: 0.4, scale: 1.5 }
        };

        const framing = framings[style] || framings.dynamic;

        return {
            success: false,
            fallback: true,
            segments: [
                {
                    startTime,
                    endTime,
                    emotion: 'neutral',
                    confidence: 0,
                    framing
                }
            ]
        };
    }

    // ========================================================================
    // SCENE DETECTION
    // ========================================================================

    /**
     * Detect scene changes in video
     */
    async detectScenes(videoUrl, options = {}) {
        const cacheKey = `scenes:${videoUrl}:${JSON.stringify(options)}`;

        const cached = this._getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const response = await fetch(`${this.apiBase}/scene-detect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoUrl,
                    threshold: options.threshold || 0.3,
                    minSceneDuration: options.minSceneDuration || 1.0
                })
            });

            if (!response.ok) {
                throw new Error(`Scene detection failed: ${response.statusText}`);
            }

            const result = await response.json();

            this._setCache(cacheKey, result);

            return result;
        } catch (error) {
            console.warn('[AIEffects] Scene detection failed:', error.message);
            return { success: false, scenes: [] };
        }
    }

    // ========================================================================
    // SPEAKER DIARIZATION
    // ========================================================================

    /**
     * Identify speakers and their active segments
     */
    async analyzeSpeakers(videoUrl, options = {}) {
        const cacheKey = `speakers:${videoUrl}:${JSON.stringify(options)}`;

        const cached = this._getFromCache(cacheKey);
        if (cached) return cached;

        try {
            const response = await fetch(`${this.apiBase}/speaker-diarize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoUrl })
            });

            if (!response.ok) {
                throw new Error(`Speaker analysis failed: ${response.statusText}`);
            }

            const result = await response.json();

            this._setCache(cacheKey, result);

            return result;
        } catch (error) {
            console.warn('[AIEffects] Speaker analysis failed:', error.message);
            return { success: false, speakers: [] };
        }
    }

    // ========================================================================
    // UNIFIED EFFECT PROCESSING
    // ========================================================================

    /**
     * Process an AI effect node, generating necessary analysis data
     */
    async processEffect(effect, context = {}) {
        if (effect.engine !== ENGINE_TYPES.AI) {
            throw new Error(`Expected AI effect, got: ${effect.engine}`);
        }

        const params = effect.getParamsSnapshot();
        const videoUrl = context.videoUrl || context.sourceUrl;
        const audioUrl = context.audioUrl || videoUrl;

        switch (effect.type) {
            case 'smart_zoom':
                return this.analyzeSmartZoom(videoUrl, {
                    ...params,
                    startTime: effect.startTime,
                    endTime: effect.endTime
                });

            case 'beat_sync':
                const beatData = await this.analyzeBeatSync(audioUrl, {
                    beatDivision: params.beatDivision,
                    startTime: effect.startTime,
                    endTime: effect.endTime
                });

                // Generate effect keyframes
                beatData.effectKeyframes = this.generateBeatSyncKeyframes(
                    beatData,
                    params.effectType || 'zoom_pulse',
                    { intensity: params.intensity }
                );

                return beatData;

            case 'emotion_frame':
                return this.analyzeEmotionFraming(videoUrl, {
                    ...params,
                    startTime: effect.startTime,
                    endTime: effect.endTime
                });

            default:
                throw new Error(`Unknown AI effect type: ${effect.type}`);
        }
    }

    /**
     * Pre-analyze all AI effects in a chain
     */
    async preAnalyzeChain(effects, context = {}) {
        const aiEffects = effects.filter(e => e.enabled && e.engine === ENGINE_TYPES.AI);

        const results = {};

        // Process in parallel
        await Promise.all(
            aiEffects.map(async (effect) => {
                try {
                    results[effect.id] = await this.processEffect(effect, context);
                } catch (error) {
                    console.error(`[AIEffects] Failed to process ${effect.id}:`, error);
                    results[effect.id] = { error: error.message };
                }
            })
        );

        return results;
    }

    // ========================================================================
    // CACHE MANAGEMENT
    // ========================================================================

    _getFromCache(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    _setCache(key, data) {
        this.cache.set(key, {
            data,
            expiry: Date.now() + this.cacheExpiry
        });
    }

    clearCache() {
        this.cache.clear();
    }

    // ========================================================================
    // STATUS
    // ========================================================================

    /**
     * Check if AI API is available
     */
    async checkHealth() {
        try {
            const response = await fetch(`${this.apiBase}/health`, {
                method: 'GET',
                timeout: 5000
            });

            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Check if effect type is supported
     */
    supportsEffect(type) {
        const supported = ['smart_zoom', 'beat_sync', 'emotion_frame'];
        return supported.includes(type);
    }
}

export default AIEffectEngine;
