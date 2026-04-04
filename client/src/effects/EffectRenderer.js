/**
 * EffectRenderer.js
 * Main rendering controller for the Viral Pilot effects engine.
 * 
 * Coordinates real-time preview and deterministic final renders.
 */

import { EffectPipeline } from './EffectPipeline.js';
import { ENGINE_TYPES } from './EffectNode.js';

// ============================================================================
// RENDER MODES
// ============================================================================

export const RENDER_MODE = {
    PREVIEW: 'preview',
    FINAL: 'final'
};

// ============================================================================
// EFFECT RENDERER CLASS
// ============================================================================

export class EffectRenderer {
    constructor(options = {}) {
        // WebGL context
        this.gl = options.gl || null;

        // Effect pipeline
        this.pipeline = options.pipeline || new EffectPipeline();

        // Current mode
        this.mode = options.mode || RENDER_MODE.PREVIEW;

        // Render state
        this.isRendering = false;
        this.renderQueue = [];
        this.currentJob = null;

        // Progress callbacks
        this.onProgress = options.onProgress || null;
        this.onComplete = options.onComplete || null;
        this.onError = options.onError || null;

        // Performance metrics
        this.metrics = {
            framesRendered: 0,
            totalRenderTime: 0,
            lastFrameTime: 0
        };
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    /**
     * Initialize with WebGL context
     */
    init(gl) {
        this.gl = gl;

        // Initialize GPU engine in pipeline
        if (this.pipeline && gl) {
            const { GPUEffectEngine } = require('./engines/GPUEffects.js');
            this.pipeline.setGPUEngine(new GPUEffectEngine(gl));
        }
    }

    /**
     * Set the effect pipeline
     */
    setPipeline(pipeline) {
        this.pipeline = pipeline;

        // Initialize GPU engine if we have GL context
        if (this.gl && pipeline) {
            const { GPUEffectEngine } = require('./engines/GPUEffects.js');
            pipeline.setGPUEngine(new GPUEffectEngine(this.gl));
        }
    }

    // ========================================================================
    // REAL-TIME PREVIEW
    // ========================================================================

    /**
     * Render preview frame
     * @param {WebGLTexture} inputTexture - Source video texture
     * @param {object[]} placements - Active placements at current time
     * @param {number} currentTime - Current timeline time in seconds
     * @param {object} context - Additional context
     * @returns {WebGLTexture} Processed output texture
     */
    renderPreview(inputTexture, placements, currentTime, context = {}) {
        if (!this.pipeline || !this.gl) {
            return inputTexture;
        }

        const startTime = performance.now();

        let output = inputTexture;

        // Process each placement's effects
        for (const placement of placements) {
            if (this.pipeline.hasActiveEffectsAt(placement.id, currentTime, placement)) {
                output = this.pipeline.processPreview(
                    output,
                    placement.id,
                    currentTime,
                    {
                        ...context,
                        placement,
                        width: context.width || this.gl.drawingBufferWidth,
                        height: context.height || this.gl.drawingBufferHeight
                    }
                );
            }
        }

        // Update metrics
        const frameTime = performance.now() - startTime;
        this.metrics.framesRendered++;
        this.metrics.lastFrameTime = frameTime;
        this.metrics.totalRenderTime += frameTime;

        return output;
    }

    /**
     * Render preview for single placement
     */
    renderPlacementPreview(inputTexture, placement, currentTime, context = {}) {
        if (!this.pipeline) {
            return inputTexture;
        }

        return this.pipeline.processPreview(
            inputTexture,
            placement.id,
            currentTime,
            { ...context, placement }
        );
    }

    // ========================================================================
    // FINAL RENDER
    // ========================================================================

    /**
     * Queue a final render job
     */
    queueRender(job) {
        this.renderQueue.push({
            ...job,
            id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            status: 'queued',
            progress: 0
        });

        // Start processing if not already
        if (!this.isRendering) {
            this._processQueue();
        }

        return job.id;
    }

    /**
     * Start final render for timeline
     */
    async renderFinal(timeline, outputPath, options = {}) {
        this.mode = RENDER_MODE.FINAL;

        const job = {
            timeline,
            outputPath,
            options,
            id: `final-${Date.now()}`,
            status: 'processing',
            progress: 0
        };

        this.currentJob = job;
        this.isRendering = true;

        try {
            // 1. Build render job
            const renderData = await this.pipeline.buildRenderJob(timeline, outputPath, {
                ...options,
                getVideoUrl: (targetId) => timeline.getPlacement?.(targetId)?.sourceUrl
            });

            // 2. Pre-analyze AI effects
            this._reportProgress(job, 0.1, 'Analyzing AI effects...');

            // 3. Compile filter graph
            this._reportProgress(job, 0.2, 'Compiling effect filters...');

            // 4. Execute render
            this._reportProgress(job, 0.3, 'Rendering...');

            const result = await this._executeRender(renderData, (progress) => {
                this._reportProgress(job, 0.3 + progress * 0.65, 'Rendering...');
            });

            // 5. Finalize
            this._reportProgress(job, 0.95, 'Finalizing...');

            job.status = 'complete';
            job.progress = 1;
            job.result = result;

            if (this.onComplete) {
                this.onComplete(job);
            }

            return result;

        } catch (error) {
            job.status = 'error';
            job.error = error.message;

            if (this.onError) {
                this.onError(error, job);
            }

            throw error;

        } finally {
            this.isRendering = false;
            this.currentJob = null;
            this.mode = RENDER_MODE.PREVIEW;
        }
    }

    async _executeRender(renderData, onProgress) {
        // Send to backend for FFmpeg processing
        const response = await fetch('/api/export/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(renderData)
        });

        if (!response.ok) {
            throw new Error(`Render failed: ${response.statusText}`);
        }

        // Handle streaming progress if supported
        if (response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                const match = text.match(/progress:\s*([\d.]+)/);
                if (match && onProgress) {
                    onProgress(parseFloat(match[1]));
                }
            }
        }

        return response.json();
    }

    async _processQueue() {
        while (this.renderQueue.length > 0) {
            const job = this.renderQueue.shift();

            try {
                await this.renderFinal(job.timeline, job.outputPath, job.options);
            } catch (error) {
                console.error('[EffectRenderer] Queue job failed:', error);
            }
        }
    }

    _reportProgress(job, progress, stage) {
        job.progress = progress;
        job.stage = stage;

        if (this.onProgress) {
            this.onProgress({
                jobId: job.id,
                progress,
                stage
            });
        }
    }

    // ========================================================================
    // RENDER CONTROLS
    // ========================================================================

    /**
     * Cancel current render
     */
    cancelRender() {
        if (this.currentJob) {
            this.currentJob.status = 'cancelled';
            // Send cancel signal to backend
            fetch('/api/export/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId: this.currentJob.id })
            }).catch(console.error);
        }

        this.isRendering = false;
        this.currentJob = null;
    }

    /**
     * Clear render queue
     */
    clearQueue() {
        this.renderQueue = [];
    }

    /**
     * Get render status
     */
    getStatus() {
        return {
            isRendering: this.isRendering,
            currentJob: this.currentJob,
            queueLength: this.renderQueue.length,
            mode: this.mode
        };
    }

    // ========================================================================
    // EFFECT APPLICATION SHORTCUTS
    // ========================================================================

    /**
     * Apply effect to placement
     */
    applyEffect(effectType, placementId, options = {}) {
        return this.pipeline.addEffect({
            type: effectType,
            targetId: placementId,
            targetType: 'placement',
            ...options
        });
    }

    /**
     * Remove all effects from placement
     */
    clearPlacementEffects(placementId) {
        const effects = this.pipeline.getEffectsForTarget(placementId);
        for (const effect of effects) {
            this.pipeline.removeEffect(effect.id);
        }
    }

    /**
     * Apply preset to placement
     */
    applyPreset(preset, placementId, options = {}) {
        const effects = [];

        for (const effectConfig of preset.effects || []) {
            const effect = this.pipeline.addEffect({
                ...effectConfig,
                targetId: placementId,
                targetType: 'placement',
                startTime: options.startTime,
                endTime: options.endTime
            });
            effects.push(effect);
        }

        return effects;
    }

    // ========================================================================
    // PERFORMANCE
    // ========================================================================

    /**
     * Get performance metrics
     */
    getMetrics() {
        const avgFrameTime = this.metrics.framesRendered > 0
            ? this.metrics.totalRenderTime / this.metrics.framesRendered
            : 0;

        return {
            ...this.metrics,
            averageFrameTime: avgFrameTime,
            estimatedFPS: avgFrameTime > 0 ? 1000 / avgFrameTime : 0
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics() {
        this.metrics = {
            framesRendered: 0,
            totalRenderTime: 0,
            lastFrameTime: 0
        };
    }

    /**
     * Check if GPU effects are available
     */
    hasGPUSupport() {
        return this.gl !== null && this.pipeline?.gpuEngine?.initialized;
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    /**
     * Destroy renderer and release resources
     */
    destroy() {
        this.cancelRender();
        this.clearQueue();

        if (this.pipeline?.gpuEngine) {
            this.pipeline.gpuEngine.destroy();
        }

        this.pipeline = null;
        this.gl = null;
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new effect renderer
 */
export function createEffectRenderer(options = {}) {
    return new EffectRenderer(options);
}

export default EffectRenderer;
