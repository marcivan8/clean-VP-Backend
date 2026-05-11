/**
 * MediaExecutionEngine
 *
 * FIX: executeApiCall() was using raw fetch() without an Authorization header.
 *      In production every ENGINE.API command (silence detection, filler removal,
 *      audio normalize, denoise, captions, etc.) returned 401 Unauthorized.
 *      The engine marked these results as successful (the fetch itself didn't throw)
 *      but the backend never actually processed anything, leaving the timeline
 *      unchanged while the job completed with success: true.
 *
 *      All fetch() calls in executeApiCall() replaced with authFetch().
 */

import { authFetch } from '../utils/authFetch.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { mediaBunnyService } from '../services/MediaBunnyService.js';

export const EXECUTION_STATES = {
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    VERIFYING: 'VERIFYING',
    DONE: 'DONE',
    FAILED: 'FAILED',
    TIMEOUT: 'TIMEOUT',
    CANCELLED: 'CANCELLED'
};

export const ENGINE_TYPES = {
    STORE: 'store',
    FFMPEG: 'ffmpeg',
    MEDIABUNNY: 'mediabunny',
    API: 'api'
};

const TIMEOUTS = {
    STORE_ACTION: 5000,
    API_CALL: 60000,
    FFMPEG_JOB: 300000,
    VERIFICATION: 10000
};

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

    get signal() { return this.abortController.signal; }

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

export class MediaExecutionEngine {
    constructor() {
        this.queue = [];
        this.activeJob = null;
        this.isProcessing = false;
        this.listeners = new Map();
    }

    on(event, callback) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
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
        if (listeners) listeners.forEach(cb => cb(data));
    }

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

        if (!this.isProcessing) this.processQueue();
        return jobId;
    }

    async execute(commands, onProgress, signal = null) {
        const jobId = `exec_${Date.now()}`;
        const job = new ExecutionJob(jobId, commands, {
            onProgress: (data) => onProgress?.(data.progress)
        });

        if (signal) signal.addEventListener('abort', () => job.cancel());
        return this.runJob(job);
    }

    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
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

    cancel(jobId) {
        if (this.activeJob?.id === jobId) { this.activeJob.cancel(); return true; }
        const idx = this.queue.findIndex(j => j.id === jobId);
        if (idx > -1) { this.queue[idx].cancel(); this.queue.splice(idx, 1); return true; }
        return false;
    }

    cancelAll() {
        if (this.activeJob) this.activeJob.cancel();
        this.queue.forEach(job => job.cancel());
        this.queue = [];
    }

    async runJob(job) {
        console.log(`[MediaExecutionEngine] Starting job ${job.id}`);
        job.startTime = Date.now();
        job.setState(EXECUTION_STATES.RUNNING);

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
                return { success: false, jobId: job.id, state: job.state, error: job.error || 'Job was cancelled' };
            }

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
                return { success: false, jobId: job.id, state: EXECUTION_STATES.FAILED, error: job.error };
            }

        } catch (error) {
            clearTimeout(job.timeoutHandle);
            if (error.name === 'AbortError' || job.signal.aborted) {
                return { success: false, jobId: job.id, state: job.state, error: 'Cancelled' };
            }
            job.setState(EXECUTION_STATES.FAILED);
            job.error = error.message;
            job.onError({ jobId: job.id, error: error.message });
            return { success: false, jobId: job.id, state: EXECUTION_STATES.FAILED, error: error.message, results: job.results };
        }
    }

    async executeCommands(job) {
        const commands = job.commands;
        const total = commands.length;

        for (let i = 0; i < commands.length; i++) {
            if (job.signal.aborted) break;
            job.currentCommandIndex = i;
            let command = commands[i];
            command = this.resolveSymbolicRefs(command);

            const desc = command.meta?.description || command.action || command.engine;
            console.log(`[MediaExecutionEngine] Executing [${i + 1}/${total}]: ${desc}`);

            const result = await this.executeCommand(command, job);
            job.results.push(result);

            const progress = ((i + 1) / total) * 90;
            job.setProgress(progress);
        }

        return job.results;
    }

    resolveSymbolicRefs(command) {
        const store = useTimelineStore.getState();
        const args = { ...command.args };

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
                console.warn(`[MediaExecutionEngine] Unresolved computed ref: ${val}`);
            }
        }

        return { ...command, args };
    }

    async executeCommand(command, job) {
        const engine = command.engine || ENGINE_TYPES.STORE;
        switch (engine) {
            case ENGINE_TYPES.STORE: return this.executeStoreAction(command, job);
            case ENGINE_TYPES.FFMPEG: return this.executeFFmpegCommand(command, job);
            case ENGINE_TYPES.MEDIABUNNY: return this.executeMediaBunnyCommand(command, job);
            case ENGINE_TYPES.API: return this.executeApiCall(command, job);
            default: throw new Error(`Unknown engine: ${engine}`);
        }
    }

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
                case 'splitMedia': result = await mediaBunnyService.splitMedia(sourceFile, Number(args.splitTime)); break;
                case 'changeSpeed': result = await mediaBunnyService.changeSpeed(sourceFile, Number(args.speed)); break;
                case 'trimMedia': result = await mediaBunnyService.trimMedia(sourceFile, Number(args.start), Number(args.end)); break;
                case 'convertFormat': result = await mediaBunnyService.convertFormat(sourceFile, args.format); break;
                case 'extractAudio': result = await mediaBunnyService.extractAudio(sourceFile); break;
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

    _callStore(store, methodName, ...methodArgs) {
        if (typeof store[methodName] !== 'function') {
            throw new Error(`Store method "${methodName}" does not exist. Available: ${Object.keys(store).filter(k => typeof store[k] === 'function').join(', ')}`);
        }
        console.log(`[MediaExecutionEngine] 🔧 Store.${methodName}(`, ...methodArgs, ')');
        return store[methodName](...methodArgs);
    }

    async executeStoreAction(command, job) {
        const store = useTimelineStore.getState();
        const action = command.action;
        const args = command.args || {};

        console.log(`[MediaExecutionEngine] Executing store action: ${action}`, args);

        switch (action) {
            case 'addClip': this._callStore(store, 'addClip', args.trackId, args.clip); return { action, success: true, message: `Added clip to ${args.trackId}` };
            case 'splitClip': { this._callStore(store, 'splitClip', args.trackId, args.clipId, args.splitTime); const numTime = Number(args.splitTime); return { action, success: true, message: `Split at ${!isNaN(numTime) ? numTime.toFixed(2) : args.splitTime}s` }; }
            case 'removeClip': this._callStore(store, 'removeClip', args.trackId, args.clipId); return { action, success: true, message: `Removed clip ${args.clipId}` };
            case 'setClipSpeed': this._callStore(store, 'setClipSpeed', args.trackId, args.clipId, args.speed); return { action, success: true, message: `Speed set to ${args.speed}x` };
            case 'setAspectRatio': this._callStore(store, 'setAspectRatio', args.ratio); return { action, success: true, message: `Aspect ratio: ${args.ratio}` };
            case 'updateClip': this._callStore(store, 'updateClip', args.trackId, args.clipId, args.updates); return { action, success: true, message: 'Clip updated' };
            case 'duplicateClip': this._callStore(store, 'duplicateClip', args.trackId, args.clipId); return { action, success: true, message: 'Clip duplicated' };
            case 'trimClip': this._callStore(store, 'trimClip', args.trackId, args.clipId, args.trimFrom, args.amount); return { action, success: true, message: 'Clip trimmed' };
            case 'rippleDelete': this._callStore(store, 'rippleDelete', args.atTime); return { action, success: true, message: 'Ripple delete applied' };
            case 'addTransition': this._callStore(store, 'addTransition', args.clipId, args.type, args.duration); return { action, success: true, message: `Added ${args.type} transition` };
            case 'addFilter': this._callStore(store, 'addFilter', args.clipId, args.filterType, args.intensity); return { action, success: true, message: `Added ${args.filterType} filter` };
            case 'addTextOverlay': this._callStore(store, 'addTextOverlay', args.text, args.position, args.duration); return { action, success: true, message: `Added text: "${args.text}"` };
            case 'applyColorGrade': this._callStore(store, 'applyColorGrade', args.clipId, args.adjustments); return { action, success: true, message: 'Color grade applied' };
            case 'undo': this._callStore(store, 'undo'); return { action, success: true, message: 'Undone' };
            case 'redo': this._callStore(store, 'redo'); return { action, success: true, message: 'Redone' };
            case 'analyzeStructure':
            case 'longFormEdit':
            case 'findHook':
            case 'removeRepetition':
            case 'reorderSegment': {
                const { VideoEditorTools } = await import('./VideoEditorTools.js');
                const tools = new VideoEditorTools();
                const toolName = action.replace(/([A-Z])/g, m => `_${m.toLowerCase()}`);
                const result = await tools.execute({ name: toolName, args });
                return { action, success: result.success !== false, message: result.message || action, result };
            }
            default: throw new Error(`Unknown store action: ${action}`);
        }
    }

    async executeFFmpegCommand(command, job) {
        const { cmd, description, output } = command;
        console.log(`[MediaExecutionEngine] Media Processing (mediabunny): ${description || 'processing'}`);
        const startTime = performance.now();

        try {
            const state = useTimelineStore.getState();
            const sourceFile = state.uploadedFile;
            if (!sourceFile) throw new Error('No uploaded file available for media processing');

            let resultBlob = null;
            const cmdStr = Array.isArray(cmd) ? cmd.join(' ') : (cmd || '');

            if (cmdStr.includes('-ss') && cmdStr.includes('-t')) {
                const ssMatch = cmdStr.match(/-ss\s+([\d.]+)/);
                const tMatch = cmdStr.match(/-t\s+([\d.]+)/);
                const startSec = parseFloat(ssMatch?.[1] || '0');
                const durationSec = parseFloat(tMatch?.[1] || '0');
                resultBlob = await mediaBunnyService.trimMedia(sourceFile, startSec, startSec + durationSec, { onProgress: (p) => job.setProgress(job.progress + p * 10), signal: job.signal });
            } else if (cmdStr.includes('setpts') || cmdStr.includes('atempo')) {
                const setptsMatch = cmdStr.match(/setpts=([\d.]+)\*PTS/);
                const speed = setptsMatch ? 1 / parseFloat(setptsMatch[1]) : 1;
                resultBlob = await mediaBunnyService.changeSpeed(sourceFile, speed, { onProgress: (p) => job.setProgress(job.progress + p * 10), signal: job.signal });
            } else {
                const format = (output || '').endsWith('.webm') ? 'webm' : 'mp4';
                resultBlob = await mediaBunnyService.convertFormat(sourceFile, format, { onProgress: (p) => job.setProgress(job.progress + p * 10), signal: job.signal });
            }

            const durationMs = (performance.now() - startTime).toFixed(2);
            const blobUrl = resultBlob ? URL.createObjectURL(resultBlob) : null;

            return { engine: 'mediabunny', success: true, output: blobUrl, blob: resultBlob, outputFile: output, duration: durationMs, description };

        } catch (error) {
            if (error.name === 'AbortError' || error.message?.includes('cancel')) throw new Error('Media processing cancelled');
            console.error('[MediaExecutionEngine] Media processing failed:', error);
            throw error;
        }
    }

    /**
     * Execute an ENGINE.API command via an authenticated fetch call.
     *
     * FIX: was using raw fetch() without an Authorization header.
     *      In production, all /api/* routes require a Supabase JWT Bearer token.
     *      Without it, every API command (silence detect, filler detect, normalize,
     *      denoise, captions, etc.) returned 401. The engine didn't throw — it
     *      just received a non-OK response — so jobs reported success but nothing
     *      was ever processed on the backend.
     */
    async executeApiCall(command, job) {
        const args = command.args || {};
        const endpoint = args.endpoint || command.endpoint;
        const method = args.method || command.method || 'POST';
        const payload = args.payload || command.payload || {};

        if (!endpoint) {
            console.warn('[MediaExecutionEngine] executeApiCall: no endpoint provided', command);
            return { action: command.action, success: true, message: 'API call skipped (no endpoint)', skipped: true };
        }

        const store = useTimelineStore.getState();
        const resolvedPayload = { ...payload };
        for (const [key, val] of Object.entries(resolvedPayload)) {
            if (val === '$uploaded_file') {
                resolvedPayload[key] = store.uploadedFile?.name || 'video.mp4';
            }
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.API_CALL);
        job.signal.addEventListener('abort', () => controller.abort());

        try {
            // FIX: replaced fetch() with authFetch() — injects Bearer token automatically
            const response = await authFetch(endpoint, {
                method,
                body: JSON.stringify(resolvedPayload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorMessage = response.statusText;
                try {
                    const errorData = await response.json();
                    if (errorData.error) errorMessage = errorData.error;
                    else if (errorData.message) errorMessage = errorData.message;
                } catch (e) { /* ignore */ }
                throw new Error(`API error: ${errorMessage}`);
            }

            const result = await response.json();

            // Special handling for filler word removal — rebuild timeline from non-filler segments
            if (command.action === 'fillerDetect' && result.activeSegments) {
                console.log(`[MediaExecutionEngine] ✂️ Applying filler cuts. Removed: ${result.fillerCount}, Keep segments: ${result.activeSegments.length}`);

                const timelineStore = useTimelineStore.getState();
                const videoTrack = timelineStore.tracks?.find(t => t.type === 'video');

                if (videoTrack && videoTrack.clips.length > 0) {
                    const baseClip = videoTrack.clips[0];
                    timelineStore.removeClip(videoTrack.id, baseClip.id);

                    let currentStartTime = 0;
                    result.activeSegments.forEach((seg, i) => {
                        const newClip = {
                            ...baseClip,
                            id: `clip_filler_${Date.now()}_${i}`,
                            start: currentStartTime,
                            duration: seg.duration,
                            offset: seg.start,
                            name: `${baseClip.name || 'Clip'} (Speech ${i + 1})`,
                        };
                        timelineStore.addClip(videoTrack.id, newClip);
                        currentStartTime += seg.duration;
                    });
                } else {
                    console.warn('[MediaExecutionEngine] fillerDetect: no video track or clips found to cut');
                }
            }

            // Special handling for silence detection — auto-cut the timeline
            if (command.action === 'silenceDetect' && result.activeSegments) {
                console.log(`[MediaExecutionEngine] ✂️ Applying silence cuts. Segments: ${result.activeSegments.length}`);

                const timelineStore = useTimelineStore.getState();
                const videoTrack = timelineStore.tracks?.find(t => t.type === 'video');

                if (videoTrack && videoTrack.clips.length > 0) {
                    const baseClip = videoTrack.clips[0];
                    timelineStore.removeClip(videoTrack.id, baseClip.id);

                    let currentStartTime = 0;
                    result.activeSegments.forEach((seg, i) => {
                        const newClip = {
                            ...baseClip,
                            id: `clip_silence_${Date.now()}_${i}`,
                            start: currentStartTime,
                            duration: seg.duration,
                            offset: seg.start,
                            name: `${baseClip.name || 'Clip'} (Cut ${i + 1})`
                        };
                        timelineStore.addClip(videoTrack.id, newClip);
                        currentStartTime += seg.duration;
                    });
                }
            }

            return { engine: 'api', success: true, endpoint, result };

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('API call cancelled');
            throw error;
        }
    }

    async verifyExecution(job) {
        return job.results.every(r => r.success !== false);
    }

    getStatus() {
        return {
            isProcessing: this.isProcessing,
            activeJob: this.activeJob ? { id: this.activeJob.id, state: this.activeJob.state, progress: this.activeJob.progress } : null,
            queueLength: this.queue.length,
            queuedJobs: this.queue.map(j => j.id)
        };
    }
}

export const mediaExecutionEngine = new MediaExecutionEngine();
export default MediaExecutionEngine;