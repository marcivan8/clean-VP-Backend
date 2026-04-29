import useTimelineStore from '../store/useTimelineStore.js';
import { mediaBunnyService } from '../services/MediaBunnyService.js';

/**
 * Media Execution Engine for Viral Pilot
 * 
 * Executes compiled media commands with:
 * - Job queue system
 * - Real-time progress events
 * - Timeout enforcement
 * - Cancellation support
 * 
 * States: QUEUED → RUNNING → VERIFYING → DONE | FAILED | TIMEOUT
 * 
 * Constraints:
 * - NO AI reasoning
 * - NO planning
 * - Deterministic execution only
 */

// Execution states
export const EXECUTION_STATES = {
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    VERIFYING: 'VERIFYING',
    DONE: 'DONE',
    FAILED: 'FAILED',
    TIMEOUT: 'TIMEOUT',
    CANCELLED: 'CANCELLED'
};

// Engine types
export const ENGINE_TYPES = {
    STORE: 'store',
    FFMPEG: 'ffmpeg',
    MEDIABUNNY: 'mediabunny',
    API: 'api'
};

// Default timeouts (ms)
const TIMEOUTS = {
    STORE_ACTION: 5000,
    API_CALL: 60000,
    FFMPEG_JOB: 300000, // 5 minutes
    VERIFICATION: 10000
};

/**
 * Execution Job class
 */
class ExecutionJob {
    constructor(id, commands, options = {}) {
        this.id = id;
        this.commands = commands;
        this.state = EXECUTION_STATES.QUEUED;
        this.progress = 0;
        this.currentCommandIndex = 0;
        this.results = [];
        this.error = null;
        this.startTime = null;
        this.endTime = null;
        this.abortController = new AbortController();
        this.timeout = options.timeout || TIMEOUTS.FFMPEG_JOB;
        this.timeoutHandle = null;
        this.onProgress = options.onProgress || (() => { });
        this.onStateChange = options.onStateChange || (() => { });
        this.onComplete = options.onComplete || (() => { });
        this.onError = options.onError || (() => { });
    }

    get signal() {
        return this.abortController.signal;
    }

    cancel() {
        this.abortController.abort();
        this.setState(EXECUTION_STATES.CANCELLED);
    }

    setState(newState) {
        const oldState = this.state;
        this.state = newState;
        this.onStateChange({ jobId: this.id, fromState: oldState, toState: newState });
    }

    setProgress(progress) {
        this.progress = progress;
        this.onProgress({ jobId: this.id, progress, currentCommand: this.currentCommandIndex });
    }
}

/**
 * Media Execution Engine
 */
export class MediaExecutionEngine {
    constructor() {
        this.queue = [];
        this.activeJob = null;
        this.isProcessing = false;
        this.listeners = new Map();
    }

    // ==================== EVENT EMITTER ====================

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        const listeners = this.listeners.get(event);
        if (listeners) {
            const idx = listeners.indexOf(callback);
            if (idx > -1) listeners.splice(idx, 1);
        }
    }

    emit(event, data) {
        const listeners = this.listeners.get(event);
        if (listeners) {
            listeners.forEach(cb => cb(data));
        }
    }

    // ==================== QUEUE MANAGEMENT ====================

    /**
     * Queue commands for execution
     * @param {Array} commands - Compiled commands
     * @param {Object} options - Execution options
     * @returns {string} Job ID
     */
    enqueue(commands, options = {}) {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        const job = new ExecutionJob(jobId, commands, {
            timeout: options.timeout,
            onProgress: (data) => this.emit('progress', data),
            onStateChange: (data) => this.emit('stateChange', data),
            onComplete: (data) => this.emit('complete', data),
            onError: (data) => this.emit('error', data)
        });

        console.log(`[MediaExecutionEngine] Job ${jobId} queued with ${commands.length} commands`);

        this.queue.push(job);
        this.emit('queued', { jobId, commandCount: commands.length });

        // Start processing if not already
        if (!this.isProcessing) {
            this.processQueue();
        }

        return jobId;
    }

    /**
     * Execute commands immediately (bypasses queue)
     * @param {Array} commands - Commands to execute
     * @param {Function} onProgress - Progress callback
     * @param {AbortSignal} signal - External abort signal
     * @returns {Promise<Object>} Execution result
     */
    async execute(commands, onProgress, signal = null) {
        const jobId = `exec_${Date.now()}`;

        const job = new ExecutionJob(jobId, commands, {
            onProgress: (data) => onProgress?.(data.progress)
        });

        if (signal) {
            signal.addEventListener('abort', () => job.cancel());
        }

        return this.runJob(job);
    }

    /**
     * Process queued jobs
     */
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.queue.length > 0) {
            const job = this.queue.shift();
            this.activeJob = job;

            try {
                await this.runJob(job);
            } catch (error) {
                console.error(`[MediaExecutionEngine] Job ${job.id} failed:`, error);
            }

            this.activeJob = null;
        }

        this.isProcessing = false;
    }

    /**
     * Cancel a job by ID
     */
    cancel(jobId) {
        // Check active job
        if (this.activeJob?.id === jobId) {
            this.activeJob.cancel();
            return true;
        }

        // Check queue
        const idx = this.queue.findIndex(j => j.id === jobId);
        if (idx > -1) {
            this.queue[idx].cancel();
            this.queue.splice(idx, 1);
            return true;
        }

        return false;
    }

    /**
     * Cancel all jobs
     */
    cancelAll() {
        if (this.activeJob) {
            this.activeJob.cancel();
        }
        this.queue.forEach(job => job.cancel());
        this.queue = [];
    }

    // ==================== JOB EXECUTION ====================

    async runJob(job) {
        console.log(`[MediaExecutionEngine] Starting job ${job.id}`);

        job.startTime = Date.now();
        job.setState(EXECUTION_STATES.RUNNING);

        // Setup timeout
        job.timeoutHandle = setTimeout(() => {
            console.warn(`[MediaExecutionEngine] Job ${job.id} timed out`);
            job.cancel();
            job.setState(EXECUTION_STATES.TIMEOUT);
            job.error = 'Execution timed out';
        }, job.timeout);

        try {
            const result = await this.executeCommands(job);

            clearTimeout(job.timeoutHandle);

            if (job.state === EXECUTION_STATES.CANCELLED || job.state === EXECUTION_STATES.TIMEOUT) {
                return {
                    success: false,
                    jobId: job.id,
                    state: job.state,
                    error: job.error || 'Job was cancelled'
                };
            }

            // Verification phase
            job.setState(EXECUTION_STATES.VERIFYING);
            const verified = await this.verifyExecution(job);

            if (verified) {
                job.setState(EXECUTION_STATES.DONE);
                job.endTime = Date.now();
                job.setProgress(100);

                const successResult = {
                    success: true,
                    jobId: job.id,
                    state: EXECUTION_STATES.DONE,
                    results: job.results,
                    duration: job.endTime - job.startTime
                };

                job.onComplete(successResult);
                return successResult;
            } else {
                job.setState(EXECUTION_STATES.FAILED);
                job.error = 'Verification failed';
                job.onError({ jobId: job.id, error: job.error });

                return {
                    success: false,
                    jobId: job.id,
                    state: EXECUTION_STATES.FAILED,
                    error: job.error
                };
            }

        } catch (error) {
            clearTimeout(job.timeoutHandle);

            if (error.name === 'AbortError' || job.signal.aborted) {
                return {
                    success: false,
                    jobId: job.id,
                    state: job.state,
                    error: 'Cancelled'
                };
            }

            job.setState(EXECUTION_STATES.FAILED);
            job.error = error.message;
            job.onError({ jobId: job.id, error: error.message });

            return {
                success: false,
                jobId: job.id,
                state: EXECUTION_STATES.FAILED,
                error: error.message,
                results: job.results
            };
        }
    }

    async executeCommands(job) {
        const commands = job.commands;
        const total = commands.length;

        for (let i = 0; i < commands.length; i++) {
            if (job.signal.aborted) break;

            job.currentCommandIndex = i;
            let command = commands[i];

            // Level 2: Logical validation — resolve symbolic refs before execution
            command = this.resolveSymbolicRefs(command);

            const desc = command.meta?.description || command.action || command.engine;
            console.log(`[MediaExecutionEngine] Executing [${i + 1}/${total}]: ${desc}`);

            const result = await this.executeCommand(command, job);
            job.results.push(result);

            // Update progress
            const progress = ((i + 1) / total) * 90; // Reserve 10% for verification
            job.setProgress(progress);
        }

        return job.results;
    }

    /**
     * Level 2: Logical Validation — resolve symbolic refs ($playhead, $first_clip, $track_of, etc.)
     * This bridges the symbolic CommandContract from the compiler with concrete values.
     */
    resolveSymbolicRefs(command) {
        const store = useTimelineStore.getState();
        const args = { ...command.args };

        // Deep-resolve all string values in args
        for (const [key, val] of Object.entries(args)) {
            if (typeof val !== 'string' || !val.startsWith('$')) continue;

            if (val === '$playhead') {
                args[key] = store.currentTime || 0;
            } else if (val === '$first_clip') {
                const firstTrack = store.tracks?.[0];
                const firstClip = firstTrack?.clips?.[0];
                args[key] = firstClip?.id || null;
            } else if (val === '$uploaded_file') {
                args[key] = store.uploadedFile?.name || 'video.mp4';
            } else if (val.startsWith('$track_of(')) {
                // $track_of(clipId) → find the track containing clipId
                const clipId = val.slice('$track_of('.length, -1);
                const resolvedClipId = clipId === '$first_clip'
                    ? store.tracks?.[0]?.clips?.[0]?.id
                    : clipId;
                for (const track of store.tracks || []) {
                    if (track.clips?.some(c => c.id === resolvedClipId)) {
                        args[key] = track.id;
                        break;
                    }
                }
            } else if (val.startsWith('$computed.')) {
                // $computed.key — these should have been resolved at compile time
                console.warn(`[MediaExecutionEngine] Unresolved computed ref: ${val}`);
            }
        }

        return { ...command, args };
    }

    async executeCommand(command, job) {
        const engine = command.engine || ENGINE_TYPES.STORE;

        switch (engine) {
            case ENGINE_TYPES.STORE:
                return this.executeStoreAction(command, job);

            case ENGINE_TYPES.FFMPEG:
                return this.executeFFmpegCommand(command, job);

            case ENGINE_TYPES.MEDIABUNNY:
                return this.executeMediaBunnyCommand(command, job);

            case ENGINE_TYPES.API:
                return this.executeApiCall(command, job);

            default:
                throw new Error(`Unknown engine: ${engine}`);
        }
    }

    /**
     * Execute a mediabunny command via the MediaBunnyService.
     */
    async executeMediaBunnyCommand(command, job) {
        const { action, args } = command;
        const desc = command.meta?.description || action;
        console.log(`[MediaExecutionEngine] 🐰 MediaBunny: ${desc}`, args);

        try {
            const store = useTimelineStore.getState();
            const sourceFile = store.uploadedFile;

            if (!sourceFile) {
                console.warn(`[MediaExecutionEngine] No uploaded file for mediabunny action: ${action}`);
                return { action, success: true, message: `${desc} (no source file — store-only)`, skipped: true };
            }

            let result;
            switch (action) {
                case 'splitMedia':
                    result = await mediaBunnyService.splitMedia(sourceFile, Number(args.splitTime));
                    break;
                case 'changeSpeed':
                    result = await mediaBunnyService.changeSpeed(sourceFile, Number(args.speed));
                    break;
                case 'trimMedia':
                    result = await mediaBunnyService.trimMedia(sourceFile, Number(args.start), Number(args.end));
                    break;
                case 'convertFormat':
                    result = await mediaBunnyService.convertFormat(sourceFile, args.format);
                    break;
                case 'extractAudio':
                    result = await mediaBunnyService.extractAudio(sourceFile);
                    break;
                default:
                    console.warn(`[MediaExecutionEngine] Unknown mediabunny action: ${action}`);
                    return { action, success: true, message: `Unknown mediabunny action: ${action}`, skipped: true };
            }

            return { action, success: true, message: desc, result };
        } catch (err) {
            console.error(`[MediaExecutionEngine] MediaBunny error:`, err);
            return { action, success: false, error: err.message };
        }
    }

    // ==================== ENGINE EXECUTORS ====================

    /**
     * Call a store method with a guard — throws if method is missing instead of silently succeeding.
     */
    _callStore(store, methodName, ...methodArgs) {
        if (typeof store[methodName] !== 'function') {
            throw new Error(`Store method "${methodName}" does not exist. Available: ${Object.keys(store).filter(k => typeof store[k] === 'function').join(', ')}`);
        }
        console.log(`[MediaExecutionEngine] 🔧 Store.${methodName}(`, ...methodArgs, ')');
        return store[methodName](...methodArgs);
    }

    executeStoreAction(command, job) {
        const store = useTimelineStore.getState();
        const action = command.action;
        const args = command.args || {};

        console.log(`[MediaExecutionEngine] Executing store action: ${action}`, args);

        switch (action) {
            case 'addClip': {
                this._callStore(store, 'addClip', args.trackId, args.clip);
                return { action, success: true, message: `Added clip to ${args.trackId}` };
            }

            case 'splitClip': {
                this._callStore(store, 'splitClip', args.trackId, args.clipId, args.splitTime);
                const numTime = Number(args.splitTime);
                return { action, success: true, message: `Split at ${!isNaN(numTime) ? numTime.toFixed(2) : args.splitTime}s` };
            }

            case 'removeClip': {
                this._callStore(store, 'removeClip', args.trackId, args.clipId);
                return { action, success: true, message: `Removed clip ${args.clipId}` };
            }

            case 'setClipSpeed': {
                this._callStore(store, 'setClipSpeed', args.trackId, args.clipId, args.speed);
                return { action, success: true, message: `Speed set to ${args.speed}x` };
            }

            case 'setAspectRatio': {
                this._callStore(store, 'setAspectRatio', args.ratio);
                return { action, success: true, message: `Aspect ratio: ${args.ratio}` };
            }

            case 'updateClip': {
                this._callStore(store, 'updateClip', args.trackId, args.clipId, args.updates);
                return { action, success: true, message: 'Clip updated' };
            }

            case 'duplicateClip': {
                this._callStore(store, 'duplicateClip', args.trackId, args.clipId);
                return { action, success: true, message: 'Clip duplicated' };
            }

            case 'trimClip': {
                this._callStore(store, 'trimClip', args.trackId, args.clipId, args.trimFrom, args.amount);
                return { action, success: true, message: 'Clip trimmed' };
            }

            case 'rippleDelete': {
                this._callStore(store, 'rippleDelete', args.atTime);
                return { action, success: true, message: 'Ripple delete applied' };
            }

            case 'addTransition': {
                this._callStore(store, 'addTransition', args.clipId, args.type, args.duration);
                return { action, success: true, message: `Added ${args.type} transition` };
            }

            case 'addFilter': {
                this._callStore(store, 'addFilter', args.clipId, args.filterType, args.intensity);
                return { action, success: true, message: `Added ${args.filterType} filter` };
            }

            case 'addTextOverlay': {
                this._callStore(store, 'addTextOverlay', args.text, args.position, args.duration);
                return { action, success: true, message: `Added text: "${args.text}"` };
            }

            case 'applyColorGrade': {
                this._callStore(store, 'applyColorGrade', args.clipId, args.adjustments);
                return { action, success: true, message: 'Color grade applied' };
            }

            case 'undo': {
                this._callStore(store, 'undo');
                return { action, success: true, message: 'Undone' };
            }

            case 'redo': {
                this._callStore(store, 'redo');
                return { action, success: true, message: 'Redone' };
            }

            default:
                throw new Error(`Unknown store action: ${action}`);
        }
    }

    async executeFFmpegCommand(command, job) {
        const { cmd, description, output } = command;

        console.log(`[MediaExecutionEngine] Media Processing (mediabunny): ${description || 'processing'}`);

        const startTime = performance.now();

        try {
            // Get the source file from the editor store
            const state = useTimelineStore.getState();
            const sourceFile = state.uploadedFile;

            if (!sourceFile) {
                throw new Error('No uploaded file available for media processing');
            }

            let resultBlob = null;

            // Parse the FFmpeg command to determine the intent
            const cmdStr = Array.isArray(cmd) ? cmd.join(' ') : (cmd || '');

            if (cmdStr.includes('-ss') && cmdStr.includes('-t')) {
                // --- SPLIT / TRIM operation ---
                const ssMatch = cmdStr.match(/-ss\s+([\d.]+)/);
                const tMatch = cmdStr.match(/-t\s+([\d.]+)/);
                const startSec = parseFloat(ssMatch?.[1] || '0');
                const durationSec = parseFloat(tMatch?.[1] || '0');
                const endSec = startSec + durationSec;

                console.log(`[MediaExecutionEngine] → Trim: ${startSec}s to ${endSec}s`);
                resultBlob = await mediaBunnyService.trimMedia(sourceFile, startSec, endSec, {
                    onProgress: (p) => job.setProgress(job.progress + p * 10),
                    signal: job.signal,
                });

            } else if (cmdStr.includes('setpts') || cmdStr.includes('atempo')) {
                // --- SPEED CHANGE operation ---
                const setptsMatch = cmdStr.match(/setpts=([\d.]+)\*PTS/);
                let speed = 1;
                if (setptsMatch) {
                    speed = 1 / parseFloat(setptsMatch[1]);
                }

                console.log(`[MediaExecutionEngine] → Speed change: ${speed}x`);
                resultBlob = await mediaBunnyService.changeSpeed(sourceFile, speed, {
                    onProgress: (p) => job.setProgress(job.progress + p * 10),
                    signal: job.signal,
                });

            } else {
                // --- GENERIC conversion / fallback ---
                const outputFile = output || '';
                const format = outputFile.endsWith('.webm') ? 'webm' : 'mp4';

                console.log(`[MediaExecutionEngine] → Generic conversion to ${format}`);
                resultBlob = await mediaBunnyService.convertFormat(sourceFile, format, {
                    onProgress: (p) => job.setProgress(job.progress + p * 10),
                    signal: job.signal,
                });
            }

            const durationMs = (performance.now() - startTime).toFixed(2);

            // Create a URL for the processed blob
            const blobUrl = resultBlob ? URL.createObjectURL(resultBlob) : null;

            console.log(`[MediaExecutionEngine] Media processing complete (${durationMs}ms), output: ${blobUrl}`);

            return {
                engine: 'mediabunny',
                success: true,
                output: blobUrl,
                blob: resultBlob,
                outputFile: output,
                duration: durationMs,
                description,
            };

        } catch (error) {
            if (error.name === 'AbortError' || error.message?.includes('cancel')) {
                throw new Error('Media processing cancelled');
            }
            console.error('[MediaExecutionEngine] Media processing failed:', error);
            throw error;
        }
    }

    async executeApiCall(command, job) {
        const { endpoint, method, payload } = command;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.API_CALL);

        job.signal.addEventListener('abort', () => controller.abort());

        try {
            const response = await fetch(endpoint, {
                method: method || 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {}),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorMessage = response.statusText;
                try {
                    const errorData = await response.json();
                    if (errorData.error) errorMessage = errorData.error;
                    else if (errorData.message) errorMessage = errorData.message;
                } catch (e) {
                    // ignore JSON parse error
                }
                throw new Error(`API error: ${errorMessage}`);
            }

            const result = await response.json();

            // Special handling for silence detection - auto cut the timeline
            if (command.action === 'silenceDetect' && result.activeSegments) {
                console.log(`[MediaExecutionEngine] ✂️ Applying silence cuts. Segments: ${result.activeSegments.length}`);
                
                // Import useTimelineStore dynamically to avoid circular dependencies if any
                const { default: useTimelineStore } = await import('../store/useTimelineStore.js');
                const store = useTimelineStore.getState();
                const videoTrack = store.tracks?.find(t => t.type === 'video');
                
                if (videoTrack && videoTrack.clips.length > 0) {
                    const baseClip = videoTrack.clips[0]; // Assuming first clip is the raw import
                    
                    // Remove the uncut original clip
                    store.removeClip(videoTrack.id, baseClip.id);
                    
                    let currentStartTime = 0;
                    result.activeSegments.forEach((seg, i) => {
                        const newClip = {
                            ...baseClip,
                            id: `clip_silence_${Date.now()}_${i}`,
                            start: currentStartTime,
                            duration: seg.duration,
                            offset: seg.start, // Trims the source video to start exactly at the segment start
                            name: `${baseClip.name || 'Clip'} (Cut ${i+1})`
                        };
                        store.addClip(videoTrack.id, newClip);
                        currentStartTime += seg.duration; // Ripple edit: next clip starts immediately after
                    });
                }
            }

            return {
                engine: 'api',
                success: true,
                endpoint,
                result
            };

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('API call cancelled');
            }
            throw error;
        }
    }

    // ==================== VERIFICATION ====================

    async verifyExecution(job) {
        // Basic verification - check all results succeeded
        const allSuccess = job.results.every(r => r.success !== false);

        if (!allSuccess) {
            return false;
        }

        // Additional verification could be added here:
        // - Check timeline integrity
        // - Verify output files exist
        // - Validate media properties

        return true;
    }

    // ==================== STATUS ====================

    getStatus() {
        return {
            isProcessing: this.isProcessing,
            activeJob: this.activeJob ? {
                id: this.activeJob.id,
                state: this.activeJob.state,
                progress: this.activeJob.progress
            } : null,
            queueLength: this.queue.length,
            queuedJobs: this.queue.map(j => j.id)
        };
    }
}

// Singleton instance
export const mediaExecutionEngine = new MediaExecutionEngine();

export default MediaExecutionEngine;
