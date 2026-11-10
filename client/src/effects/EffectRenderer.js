/**
 * EffectRenderer.js
 * Main rendering controller for the Viral Pilot effects engine.
 * 
 * Coordinates real-time preview and deterministic final renders.
 */

import { EffectPipeline } from './EffectPipeline.js';
import { ENGINE_TYPES } from './EffectNode.js';
import { GPUEffectEngine } from './engines/GPUEffects.js';
import { authFetch } from '../utils/authFetch.js';
import { pollJobResult } from '../utils/jobPoller.js';

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
        // GPU resources created by this renderer. Keep ownership explicit so
        // reinitializing or swapping pipelines cannot leak WebGL allocations
        // or accidentally destroy a GPU engine supplied by another owner.
        this._ownedGpuEngine = null;
        this._ownedGpuPipeline = null;

        // Current mode
        this.mode = options.mode || RENDER_MODE.PREVIEW;

        // Render state
        this.isRendering = false;
        this.renderQueue = [];
        this.currentJob = null;
        this.renderJobs = new Map();
        this.maxRenderJobHistory = 100;
        this.renderAbortController = null;

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
        this._releaseOwnedGpuEngine();
        this.gl = gl;

        // Initialize GPU engine in pipeline
        if (this.pipeline && gl) {
            this._ownedGpuEngine = new GPUEffectEngine(gl);
            this._ownedGpuPipeline = this.pipeline;
            this.pipeline.setGPUEngine(this._ownedGpuEngine);
        }
    }

    /**
     * Set the effect pipeline
     */
    setPipeline(pipeline) {
        this._releaseOwnedGpuEngine();
        this.pipeline = pipeline;

        // Initialize GPU engine if we have GL context
        if (this.gl && pipeline) {
            this._ownedGpuEngine = new GPUEffectEngine(this.gl);
            this._ownedGpuPipeline = pipeline;
            pipeline.setGPUEngine(this._ownedGpuEngine);
        }
    }

    _releaseOwnedGpuEngine() {
        if (!this._ownedGpuEngine) return;
        const engine = this._ownedGpuEngine;
        const pipeline = this._ownedGpuPipeline;
        this._ownedGpuEngine = null;
        this._ownedGpuPipeline = null;
        engine.destroy();
        if (pipeline?.gpuEngine === engine) pipeline.setGPUEngine(null);
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

        // PlaybackEngine decodes one source clip per frame. Timeline placements
        // may also include overlays and audio, so their effects must not be
        // chained onto this unrelated source texture. Callers that render a
        // layer independently can use renderPlacementPreview with that layer's
        // own source texture.
        const hasSourceClip = Object.prototype.hasOwnProperty.call(context, 'sourceClipId');
        const sourceClipId = context.sourceClipId;
        const sourcePlacements = hasSourceClip
            ? (sourceClipId ? placements.filter(placement => placement.id === sourceClipId
                || placement.clipId === sourceClipId
                || placement.clip?.id === sourceClipId) : [])
            : placements;

        // Process each placement's effects
        for (const placement of sourcePlacements) {
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
        const queuedJob = {
            ...job,
            id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            status: 'queued',
            progress: 0
        };
        this.renderJobs.set(queuedJob.id, queuedJob);
        this._pruneRenderJobs();
        this.renderQueue.push(queuedJob);

        // Start processing if not already
        if (!this.isRendering) {
            this._processQueue();
        }

        return queuedJob.id;
    }

    /**
     * Start final render for timeline
     */
    async renderFinal(timeline, outputPath, options = {}, queuedJob = null) {
        if (this.isRendering) {
            throw new Error('A render is already in progress');
        }
        this.mode = RENDER_MODE.FINAL;

        const job = queuedJob || {
            timeline,
            outputPath,
            options,
            id: `final-${Date.now()}`,
            status: 'processing',
            progress: 0
        };
        job.timeline = timeline;
        job.outputPath = outputPath;
        job.options = options;
        job.status = 'processing';
        job.progress = 0;
        this.renderJobs.set(job.id, job);

        this.currentJob = job;
        this.isRendering = true;
        this.renderAbortController = new AbortController();

        try {
            // 1. Build render job
            const renderData = await this.pipeline.buildRenderJob(timeline, outputPath, {
                ...options,
                settings: options.settings || options.exportSettings || options,
                assets: timeline.assets || options.assets || [],
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
            }, this.renderAbortController.signal);

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
            const wasCancelled = Boolean(this.renderAbortController?.signal.aborted);
            job.status = wasCancelled ? 'cancelled' : 'error';
            job.error = error.message;

            if (!wasCancelled && this.onError) {
                this.onError(error, job);
            }

            throw error;

        } finally {
            this.isRendering = false;
            this.currentJob = null;
            this.renderAbortController = null;
            this.mode = RENDER_MODE.PREVIEW;
        }
    }

    async _executeRender(renderData, onProgress, signal) {
        // Use the app's queued export endpoint and poll its canonical job status.
        const response = await authFetch('/api/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(renderData),
            signal
        });

        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.error || `Render enqueue failed: ${response.status} ${response.statusText}`);
        }
        const { jobId } = await response.json();
        if (!jobId) throw new Error('Render API did not return a job ID');
        const result = await pollJobResult(jobId, signal, 30 * 60 * 1000, progress => {
            onProgress?.(Math.max(0, Math.min(1, progress / 100)));
        });
        if (!result || result.success === false || (!result.url && !result.outputUrl && !result.outputPath)) {
            throw new Error(result?.error || 'Render job completed without a verified output video');
        }
        return result;
    }

    async _processQueue() {
        while (this.renderQueue.length > 0) {
            const job = this.renderQueue.shift();

            try {
                await this.renderFinal(job.timeline, job.outputPath, job.options, job);
            } catch (error) {
                if (error?.name !== 'AbortError' && !/cancelled/i.test(String(error?.message || ''))) {
                    console.error('[EffectRenderer] Queue job failed:', error);
                }
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

    _pruneRenderJobs() {
        if (this.renderJobs.size <= this.maxRenderJobHistory) return;
        for (const [id, job] of this.renderJobs) {
            if (this.renderJobs.size <= this.maxRenderJobHistory) break;
            if (job.status === 'queued' || job.status === 'processing') continue;
            this.renderJobs.delete(id);
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
            this.renderAbortController?.abort();
            // Keep the renderer busy until renderFinal's finally block has
            // released the active request. Otherwise a new queueRender call
            // can start a second export while the aborted request is settling.
            return true;
        }
        return false;
    }

    /**
     * Clear render queue
     */
    clearQueue() {
        const removed = this.renderQueue.length;
        for (const job of this.renderQueue) {
            job.status = 'cancelled';
            job.error = 'Render removed from queue';
        }
        this.renderQueue = [];
        return removed;
    }

    /** Return the latest known state for a queued or completed render. */
    getRenderJob(jobId) {
        return this.renderJobs.get(jobId) || null;
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

        this._releaseOwnedGpuEngine();

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
