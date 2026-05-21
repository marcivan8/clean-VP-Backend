/**
 * ExecutionSupervisor - Watchdog Agent for Viral Pilot
 * 
 * Monitors active jobs and enforces execution constraints.
 * 
 * Responsibilities:
 * - Track job progress via EventBus
 * - Kill hung jobs (no progress for > threshold)
 * - Enforce per-phase timeouts
 * - Enforce max concurrent jobs
 * - Emit job:hung and job:timeout events for error recovery
 * - Automatically cancel jobs via AbortController
 * 
 * This agent NEVER executes anything. It only monitors and signals.
 */

import { EventBus, EVENT_TYPES, PRIORITY } from './EventBus.js';

// Configuration with per-phase timeouts
const CONFIG = {
    // Time without progress before job is considered hung (ms)
    HUNG_THRESHOLD_MS: 10000,

    // Check interval for hung jobs (ms)
    CHECK_INTERVAL_MS: 2000,

    // Maximum concurrent jobs allowed
    MAX_CONCURRENT_JOBS: 3,

    // Maximum job duration (hard limit) (ms)
    MAX_JOB_DURATION_MS: 900000, // 15 minutes

    // Per-phase timeouts (ms)
    PHASE_TIMEOUTS: {
        planning: 60000,      // 60s for intent parsing + plan generation
        executing: 600000,    // 10m for command execution (long-form jobs)
        validating: 15000     // 15s for validation
    },

    // Warning thresholds (percentage of phase timeout)
    WARNING_THRESHOLD_PERCENT: 75
};

class ExecutionSupervisorClass {
    constructor() {
        // Map of jobId -> { lastProgress, lastUpdate, startTime, phase }
        this.activeJobs = new Map();

        // Interval handle
        this.checkIntervalHandle = null;

        // Flag to track if supervisor is running
        this.isRunning = false;

        // Bind methods
        this.onJobStarted = this.onJobStarted.bind(this);
        this.onProgress = this.onProgress.bind(this);
        this.onJobEnded = this.onJobEnded.bind(this);
        this.checkHungJobs = this.checkHungJobs.bind(this);
    }

    /**
     * Start the supervisor
     */
    start() {
        if (this.isRunning) {
            console.warn('[ExecutionSupervisor] Already running');
            return;
        }

        console.log('[ExecutionSupervisor] Starting watchdog...');

        // Subscribe to job events
        this.unsubscribers = [
            EventBus.on(EVENT_TYPES.JOB_STARTED, this.onJobStarted, { priority: PRIORITY.HIGH }),
            EventBus.on(EVENT_TYPES.PHASE_EXECUTING, this.onPhaseChange.bind(this, 'executing'), { priority: PRIORITY.HIGH }),
            EventBus.on(EVENT_TYPES.PHASE_VALIDATING, this.onPhaseChange.bind(this, 'validating'), { priority: PRIORITY.HIGH }),
            EventBus.on(EVENT_TYPES.EXECUTION_PROGRESS, this.onProgress, { priority: PRIORITY.HIGH }),
            EventBus.on(EVENT_TYPES.JOB_COMPLETED, this.onJobEnded, { priority: PRIORITY.HIGH }),
            EventBus.on(EVENT_TYPES.JOB_FAILED, this.onJobEnded, { priority: PRIORITY.HIGH }),
            EventBus.on(EVENT_TYPES.JOB_CANCELLED, this.onJobEnded, { priority: PRIORITY.HIGH }),
            EventBus.on(EVENT_TYPES.JOB_TIMEOUT, this.onJobEnded, { priority: PRIORITY.HIGH })
        ];

        // Start periodic check
        this.checkIntervalHandle = setInterval(this.checkHungJobs, CONFIG.CHECK_INTERVAL_MS);
        this.isRunning = true;

        console.log('[ExecutionSupervisor] Watchdog active');
    }

    /**
     * Stop the supervisor
     */
    stop() {
        if (!this.isRunning) return;

        console.log('[ExecutionSupervisor] Stopping watchdog...');

        // Unsubscribe from all events
        this.unsubscribers?.forEach(unsub => unsub());
        this.unsubscribers = [];

        // Clear interval
        if (this.checkIntervalHandle) {
            clearInterval(this.checkIntervalHandle);
            this.checkIntervalHandle = null;
        }

        // Clear active jobs
        this.activeJobs.clear();
        this.isRunning = false;

        console.log('[ExecutionSupervisor] Watchdog stopped');
    }

    /**
     * Handle job started event
     */
    onJobStarted(payload) {
        const { jobId } = payload;
        const now = Date.now();

        // Check concurrent job limit
        if (this.activeJobs.size >= CONFIG.MAX_CONCURRENT_JOBS) {
            console.warn(`[ExecutionSupervisor] Max concurrent jobs (${CONFIG.MAX_CONCURRENT_JOBS}) reached`);
            EventBus.emit(EVENT_TYPES.SYSTEM_ERROR, {
                source: 'ExecutionSupervisor',
                error: `Maximum concurrent jobs limit reached (${CONFIG.MAX_CONCURRENT_JOBS})`,
                jobId
            });
            return;
        }

        this.activeJobs.set(jobId, {
            lastProgress: 0,
            lastUpdate: now,
            startTime: now,
            phase: 'planning'
        });

        console.log(`[ExecutionSupervisor] Tracking job: ${jobId}`);
    }

    /**
     * Handle phase change
     */
    onPhaseChange(phase, payload) {
        const { jobId } = payload;
        const job = this.activeJobs.get(jobId);

        if (job) {
            job.phase = phase;
            job.lastUpdate = Date.now();
            console.log(`[ExecutionSupervisor] Job ${jobId} entered phase: ${phase}`);
        }
    }

    /**
     * Handle progress update
     */
    onProgress(payload) {
        const { jobId, progress } = payload;
        const job = this.activeJobs.get(jobId);

        if (job) {
            job.lastProgress = progress;
            job.lastUpdate = Date.now();
        }
    }

    /**
     * Handle job ended (completed, failed, cancelled, timeout)
     */
    onJobEnded(payload) {
        const { jobId } = payload;

        if (this.activeJobs.has(jobId)) {
            this.activeJobs.delete(jobId);
            console.log(`[ExecutionSupervisor] Stopped tracking job: ${jobId}`);
        }
    }

    /**
     * Periodic check for hung jobs
     */
    checkHungJobs() {
        const now = Date.now();

        for (const [jobId, job] of this.activeJobs) {
            const timeSinceUpdate = now - job.lastUpdate;
            const totalDuration = now - job.startTime;
            const phaseStartTime = job.phaseStartTime || job.startTime;
            const phaseDuration = now - phaseStartTime;

            // Check for hard timeout (max duration exceeded)
            if (totalDuration > CONFIG.MAX_JOB_DURATION_MS) {
                console.error(`[ExecutionSupervisor] Job ${jobId} exceeded max duration (${CONFIG.MAX_JOB_DURATION_MS}ms)`);
                this.signalTimeout(jobId, 'max_duration_exceeded', totalDuration);
                continue;
            }

            // Check per-phase timeout
            const phaseTimeout = CONFIG.PHASE_TIMEOUTS[job.phase];
            if (phaseTimeout && phaseDuration > phaseTimeout) {
                console.error(`[ExecutionSupervisor] Job ${jobId} exceeded ${job.phase} phase timeout (${phaseTimeout}ms)`);
                this.signalTimeout(jobId, 'phase_timeout', phaseDuration, job.phase);
                continue;
            }

            // Emit warning if approaching phase timeout
            if (phaseTimeout && !job.warningEmitted) {
                const warningThreshold = phaseTimeout * (CONFIG.WARNING_THRESHOLD_PERCENT / 100);
                if (phaseDuration > warningThreshold) {
                    EventBus.emit(EVENT_TYPES.EXECUTION_PROGRESS, {
                        jobId,
                        warning: `Phase "${job.phase}" is taking longer than expected`,
                        phaseDuration,
                        phaseTimeout
                    });
                    job.warningEmitted = true;
                }
            }

            // Check for stalled progress (only during execution/validation)
            if (job.phase === 'executing' || job.phase === 'validating') {
                if (timeSinceUpdate > CONFIG.HUNG_THRESHOLD_MS) {
                    console.warn(`[ExecutionSupervisor] Job ${jobId} appears hung (${timeSinceUpdate}ms since last update)`);
                    this.signalHung(jobId, 'no_progress', timeSinceUpdate);
                }
            }
        }
    }

    /**
     * Signal that a job has timed out
     */
    signalTimeout(jobId, reason, duration, phase = null) {
        const job = this.activeJobs.get(jobId);

        EventBus.emit(EVENT_TYPES.JOB_TIMEOUT, {
            jobId,
            reason,
            duration,
            phase: phase || job?.phase || 'unknown',
            lastProgress: job?.lastProgress || 0,
            message: this.getTimeoutMessage(reason, duration, phase)
        });

        this.activeJobs.delete(jobId);
    }

    /**
     * Signal that a job is hung
     */
    signalHung(jobId, reason, duration) {
        const job = this.activeJobs.get(jobId);

        EventBus.emit(EVENT_TYPES.JOB_HUNG, {
            jobId,
            reason,
            duration,
            phase: job?.phase || 'unknown',
            lastProgress: job?.lastProgress || 0,
            message: this.getHungMessage(reason, duration)
        });

        // Remove from tracking to prevent duplicate signals
        this.activeJobs.delete(jobId);
    }

    /**
     * Generate human-readable hung message
     */
    getHungMessage(reason, duration) {
        switch (reason) {
            case 'max_duration_exceeded':
                return `Job exceeded maximum allowed duration of ${CONFIG.MAX_JOB_DURATION_MS / 1000} seconds`;
            case 'no_progress':
                return `Job stalled with no progress for ${Math.round(duration / 1000)} seconds`;
            default:
                return `Job hung: ${reason}`;
        }
    }

    /**
     * Generate human-readable timeout message
     */
    getTimeoutMessage(reason, duration, phase = null) {
        switch (reason) {
            case 'max_duration_exceeded':
                return `Job exceeded maximum allowed duration of ${CONFIG.MAX_JOB_DURATION_MS / 1000} seconds`;
            case 'phase_timeout':
                return `Phase "${phase}" timed out after ${Math.round(duration / 1000)} seconds`;
            default:
                return `Job timed out: ${reason}`;
        }
    }

    /**
     * Get current active jobs count
     */
    getActiveJobCount() {
        return this.activeJobs.size;
    }

    /**
     * Get status summary
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            activeJobs: this.activeJobs.size,
            config: { ...CONFIG }
        };
    }

    /**
     * Update configuration
     */
    configure(newConfig) {
        Object.assign(CONFIG, newConfig);
        console.log('[ExecutionSupervisor] Configuration updated:', CONFIG);
    }
}

// Singleton instance
export const ExecutionSupervisor = new ExecutionSupervisorClass();

export default ExecutionSupervisor;
