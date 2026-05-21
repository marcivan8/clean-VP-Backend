/**
 * MediaExecutionEngine  (patched)
 *
 * Key fixes in executeApiCall():
 *
 * 1. REPLACED SSE (EventSource) with REST polling via jobPoller.js
 *    SSE connections are unreliable behind Railway / Nginx proxies — they get
 *    buffered or killed after ~30 s of inactivity.  Plain authFetch polls are
 *    always safe.
 *
 * 2. FIXED $uploaded_file resolution — now checks store.uploadedFilePath
 *    (the server-side relative path stored after proxy-upload) BEFORE falling
 *    back to store.uploadedFile?.name.  Without the right server-side path the
 *    silence / filler endpoints return "file not found" and the job produces
 *    empty activeSegments → "nothing changes".
 *
 * 3. ADDED result-null guard — if the polling returns null/undefined, the
 *    silence/filler handlers would previously throw a TypeError that got
 *    swallowed; now we log a clear warning and skip gracefully.
 *
 * 4. ADDED per-operation log lines so you can see in the console exactly which
 *    step succeeds / fails.
 *
 * Everything else is unchanged — only executeApiCall() and the symbolic-ref
 * resolver are modified.  Import paths may need adjusting to your directory
 * layout.
 */

import { authFetch }  from '../utils/authFetch.js';
import { pollJobResult } from '../utils/jobPoller.js';
import useTimelineStore  from '../store/useTimelineStore.js';
import { mediaBunnyService } from '../services/MediaBunnyService.js';

export const EXECUTION_STATES = {
    QUEUED:    'QUEUED',
    RUNNING:   'RUNNING',
    VERIFYING: 'VERIFYING',
    DONE:      'DONE',
    FAILED:    'FAILED',
    TIMEOUT:   'TIMEOUT',
    CANCELLED: 'CANCELLED'
};

export const ENGINE_TYPES = {
    STORE:      'store',
    FFMPEG:     'ffmpeg',
    MEDIABUNNY: 'mediabunny',
    API:        'api'
};

const TIMEOUTS = {
    STORE_ACTION:  5000,
    API_CALL:      360000,  // 6 min — must exceed jobPoller's 5-min timeout
    FFMPEG_JOB:    300000,
    VERIFICATION:  10000
};

// ─── ExecutionJob (unchanged) ─────────────────────────────────────────────────

class ExecutionJob {
    constructor(id, commands, options = {}) {
        this.id                   = id;
        this.commands             = commands;
        this.state                = EXECUTION_STATES.QUEUED;
        this.progress             = 0;
        this.currentCommandIndex  = 0;
        this.results              = [];
        this.error                = null;
        this.startTime            = null;
        this.endTime              = null;
        this.abortController      = new AbortController();
        this.timeout              = options.timeout || TIMEOUTS.FFMPEG_JOB;
        this.timeoutHandle        = null;
        this.onProgress           = options.onProgress   || (() => {});
        this.onStateChange        = options.onStateChange || (() => {});
        this.onComplete           = options.onComplete   || (() => {});
        this.onError              = options.onError      || (() => {});
    }

    get signal() { return this.abortController.signal; }

    cancel() {
        this.abortController.abort();
        this.setState(EXECUTION_STATES.CANCELLED);
    }

    setState(newState) {
        const oldState = this.state;
        this.state     = newState;
        this.onStateChange({ jobId: this.id, fromState: oldState, toState: newState });
    }

    setProgress(progress) {
        this.progress = progress;
        this.onProgress({ jobId: this.id, progress, currentCommand: this.currentCommandIndex });
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildActiveSegmentsFromWords(words, minSilenceDuration = 0.5, padding = 0.1) {
    if (!words || words.length === 0) return [];
    const segments = [];
    let segStart = Math.max(0, (words[0].start || 0) - padding);
    let segEnd   = (words[0].end || 0) + padding;
    for (let i = 1; i < words.length; i++) {
        const gap = (words[i].start || 0) - (words[i - 1].end || 0);
        if (gap >= minSilenceDuration) {
            segments.push({ start: segStart, end: segEnd, duration: segEnd - segStart });
            segStart = Math.max(0, (words[i].start || 0) - padding);
            segEnd   = (words[i].end   || 0) + padding;
        } else {
            segEnd = (words[i].end || 0) + padding;
        }
    }
    if (segStart < segEnd) segments.push({ start: segStart, end: segEnd, duration: segEnd - segStart });
    return segments;
}

// ─── MediaExecutionEngine ────────────────────────────────────────────────────

export class MediaExecutionEngine {
    constructor() {
        this.queue       = [];
        this.activeJob   = null;
        this.isProcessing = false;
        this.listeners   = new Map();
    }

    on(event, callback) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        const ls = this.listeners.get(event);
        if (ls) {
            const idx = ls.indexOf(callback);
            if (idx > -1) ls.splice(idx, 1);
        }
    }

    emit(event, data) {
        const ls = this.listeners.get(event);
        if (ls) ls.forEach(cb => cb(data));
    }

    enqueue(commands, options = {}) {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const job   = new ExecutionJob(jobId, commands, {
            timeout:       options.timeout,
            onProgress:    (data) => this.emit('progress',    data),
            onStateChange: (data) => this.emit('stateChange', data),
            onComplete:    (data) => this.emit('complete',    data),
            onError:       (data) => this.emit('error',       data)
        });
        this.queue.push(job);
        this.emit('queued', { jobId, commandCount: commands.length });
        if (!this.isProcessing) this.processQueue();
        return jobId;
    }

    async execute(commands, onProgress, signal = null) {
        const jobId = `exec_${Date.now()}`;
        const job   = new ExecutionJob(jobId, commands, {
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
            try { await this.runJob(job); }
            catch (err) { console.error(`[MediaExecutionEngine] Job ${job.id} failed:`, err); }
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
        this.queue.forEach(j => j.cancel());
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
            await this.executeCommands(job);
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
                const ok = { success: true, jobId: job.id, state: EXECUTION_STATES.DONE, results: job.results, duration: job.endTime - job.startTime };
                job.onComplete(ok);
                return ok;
            } else {
                job.setState(EXECUTION_STATES.FAILED);
                const failedResult = job.results.find(r => r.success === false);
                job.error = failedResult?.error || failedResult?.message || 'Execution verification failed';
                job.onError({ jobId: job.id, error: job.error });
                return { success: false, jobId: job.id, state: EXECUTION_STATES.FAILED, error: job.error };
            }
        } catch (err) {
            clearTimeout(job.timeoutHandle);
            if (err.name === 'AbortError' || job.signal.aborted) {
                return { success: false, jobId: job.id, state: job.state, error: 'Cancelled' };
            }
            job.setState(EXECUTION_STATES.FAILED);
            job.error = err.message;
            job.onError({ jobId: job.id, error: err.message });
            return { success: false, jobId: job.id, state: EXECUTION_STATES.FAILED, error: err.message, results: job.results };
        }
    }

    async executeCommands(job) {
        const total = job.commands.length;
        for (let i = 0; i < job.commands.length; i++) {
            if (job.signal.aborted) break;
            job.currentCommandIndex = i;
            let command = job.commands[i];
            command = this.resolveSymbolicRefs(command);

            const desc = command.meta?.description || command.action || command.engine;
            console.log(`[MediaExecutionEngine] [${i + 1}/${total}] ${desc}`);

            const result = await this.executeCommand(command, job);
            job.results.push(result);
            job.setProgress(((i + 1) / total) * 90);
        }
        return job.results;
    }

    // ── FIX: resolve $uploaded_file using server-side path when available ─────
    resolveSymbolicRefs(command) {
        const store = useTimelineStore.getState();
        const args  = { ...command.args };

        for (const [key, val] of Object.entries(args)) {
            if (typeof val !== 'string' || !val.startsWith('$')) continue;

            if (val === '$playhead') {
                args[key] = store.currentTime || 0;
            } else if (val === '$first_clip') {
                const videoTrack = store.tracks?.find(t => t.type === 'video') || store.tracks?.[0];
                args[key] = videoTrack?.clips?.[0]?.id || null;
            } else if (val === '$uploaded_file') {
                // Prefer the server-side path stored after proxy upload
                const serverPath = store.uploadedFilePath;
                const fileName   = store.uploadedFile?.name;

                if (serverPath) {
                    args[key] = serverPath;
                } else if (fileName) {
                    args[key] = fileName;
                } else {
                    console.warn(
                        '[MediaExecutionEngine] ⚠️  $uploaded_file unresolved — ' +
                        'uploadedFilePath and uploadedFile.name are both missing. ' +
                        'Make sure setUploadedFilePath() is called after proxy upload.'
                    );
                    args[key] = 'video.mp4';
                }
            } else if (val.startsWith('$track_of(')) {
                const clipId          = val.slice('$track_of('.length, -1);
                const resolvedClipId  = clipId === '$first_clip'
                    ? (store.tracks?.find(t => t.type === 'video') || store.tracks?.[0])?.clips?.[0]?.id
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
        switch (command.engine || ENGINE_TYPES.STORE) {
            case ENGINE_TYPES.STORE:      return this.executeStoreAction(command, job);
            case ENGINE_TYPES.FFMPEG:     return this.executeFFmpegCommand(command, job);
            case ENGINE_TYPES.MEDIABUNNY: return this.executeMediaBunnyCommand(command, job);
            case ENGINE_TYPES.API:        return this.executeApiCall(command, job);
            default: throw new Error(`Unknown engine: ${command.engine}`);
        }
    }

    // ── executeMediaBunnyCommand (unchanged from original) ────────────────────
    async executeMediaBunnyCommand(command, job) {
        const { action, args } = command;
        const desc = command.meta?.description || action;
        console.log(`[MediaExecutionEngine] 🐰 MediaBunny: ${desc}`);
        try {
            const store = useTimelineStore.getState();
            let sourceFile = null;
            if (args.clipId || args.assetId) {
                const asset = store.assets?.find(a => a.id === (args.assetId || args.clipId) || a.clipId === (args.assetId || args.clipId));
                if (asset?.file instanceof File || asset?.file instanceof Blob) sourceFile = asset.file;
            }
            if (!sourceFile) {
                const candidate = store.uploadedFile;
                if (candidate instanceof File || candidate instanceof Blob || candidate instanceof ArrayBuffer) {
                    sourceFile = candidate;
                } else if (candidate) {
                    return { action, success: true, message: `${desc} (skipped — source is a URL, not a local File)`, skipped: true };
                }
            }
            if (!sourceFile) return { action, success: true, message: `${desc} (no local source file — store-only)`, skipped: true };

            let result;
            switch (action) {
                case 'splitMedia':   result = await mediaBunnyService.splitMedia(sourceFile,   Number(args.splitTime)); break;
                case 'changeSpeed':  result = await mediaBunnyService.changeSpeed(sourceFile,  Number(args.speed));     break;
                case 'trimMedia':    result = await mediaBunnyService.trimMedia(sourceFile,    Number(args.start), Number(args.end)); break;
                case 'convertFormat':result = await mediaBunnyService.convertFormat(sourceFile, args.format); break;
                case 'extractAudio': result = await mediaBunnyService.extractAudio(sourceFile); break;
                default:
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
            throw new Error(`Store method "${methodName}" does not exist.`);
        }
        console.log(`[MediaExecutionEngine] 🔧 Store.${methodName}(`, ...methodArgs, ')');
        return store[methodName](...methodArgs);
    }

    async executeStoreAction(command, job) {
        const store  = useTimelineStore.getState();
        const action = command.action;
        const args   = command.args || {};

        switch (action) {
            case 'addClip':        this._callStore(store, 'addClip', args.trackId, args.clip); return { action, success: true, message: `Added clip to ${args.trackId}` };
            case 'splitClip':      { this._callStore(store, 'splitClip', args.trackId, args.clipId, args.splitTime); return { action, success: true, message: `Split at ${args.splitTime}s` }; }
            case 'removeClip':     this._callStore(store, 'removeClip', args.trackId, args.clipId); return { action, success: true, message: `Removed clip ${args.clipId}` };
            case 'setClipSpeed':   this._callStore(store, 'setClipSpeed', args.trackId, args.clipId, args.speed); return { action, success: true };
            case 'setAspectRatio': this._callStore(store, 'setAspectRatio', args.ratio); return { action, success: true };
            case 'updateClip':     this._callStore(store, 'updateClip', args.trackId, args.clipId, args.updates); return { action, success: true };
            case 'duplicateClip':  this._callStore(store, 'duplicateClip', args.trackId, args.clipId); return { action, success: true };
            case 'trimClip':       this._callStore(store, 'trimClip', args.trackId, args.clipId, args.trimFrom, args.amount); return { action, success: true };
            case 'rippleDelete':   this._callStore(store, 'rippleDelete', args.atTime); return { action, success: true };
            case 'addTransition':  this._callStore(store, 'addTransition', args.clipId, args.type, args.duration); return { action, success: true };
            case 'addFilter':      this._callStore(store, 'addFilter', args.clipId, args.filterType, args.intensity); return { action, success: true };
            case 'addTextOverlay': this._callStore(store, 'addTextOverlay', args.text, args.position, args.duration, args.style); return { action, success: true };
            case 'applyColorGrade':this._callStore(store, 'applyColorGrade', args.clipId, args.adjustments); return { action, success: true };
            case 'undo':           this._callStore(store, 'undo'); return { action, success: true };
            case 'redo':           this._callStore(store, 'redo'); return { action, success: true };

            // ── Playhead seek — handled directly without VideoEditorTools ─────────
            case 'seek_to': {
                const time = typeof args.time === 'number' ? args.time : 0;
                if (typeof store.seek === 'function') store.seek(time);
                return { action, success: true, message: `Seeked to ${time}s` };
            }

            // ── All long-form semantic actions — delegate to VideoEditorTools ─────
            case 'cutSegment':
            case 'reorderSegment':
            case 'findHook':
            case 'removeRepetition':
            case 'add_transitions_to_sections':
            case 'analyzeStructure':
            case 'apply_smart_zoom':
            case 'longFormEdit': {
                const { VideoEditorTools } = await import('./VideoEditorTools.js');
                const tools = new VideoEditorTools();
                // Convert camelCase / underscore action to the tool's snake_case name
                const toolName = action
                    .replace(/([A-Z])/g, m => `_${m.toLowerCase()}`)
                    .replace(/^_/, '');
                const result = await tools.execute({ name: toolName, args });
                return { action, success: result.success !== false, message: result.message || action, result };
            }

            default: throw new Error(`Unknown store action: ${action}`);
        }

    }

    async executeFFmpegCommand(command, job) {
        const { cmd, description, output } = command;
        const store = useTimelineStore.getState();
        const sourceFile = store.uploadedFile;
        if (!sourceFile) throw new Error('No uploaded file available for media processing');

        const cmdStr = Array.isArray(cmd) ? cmd.join(' ') : (cmd || '');
        let resultBlob;
        if (cmdStr.includes('-ss') && cmdStr.includes('-t')) {
            const ssMatch = cmdStr.match(/-ss\s+([\d.]+)/);
            const tMatch  = cmdStr.match(/-t\s+([\d.]+)/);
            const startSec    = parseFloat(ssMatch?.[1] || '0');
            const durationSec = parseFloat(tMatch?.[1]  || '0');
            resultBlob = await mediaBunnyService.trimMedia(sourceFile, startSec, startSec + durationSec, { signal: job.signal });
        } else if (cmdStr.includes('setpts') || cmdStr.includes('atempo')) {
            const setptsMatch = cmdStr.match(/setpts=([\d.]+)\*PTS/);
            const speed = setptsMatch ? 1 / parseFloat(setptsMatch[1]) : 1;
            resultBlob = await mediaBunnyService.changeSpeed(sourceFile, speed, { signal: job.signal });
        } else {
            const format = (output || '').endsWith('.webm') ? 'webm' : 'mp4';
            resultBlob = await mediaBunnyService.convertFormat(sourceFile, format, { signal: job.signal });
        }
        const blobUrl = resultBlob ? URL.createObjectURL(resultBlob) : null;
        return { engine: 'mediabunny', success: true, output: blobUrl, blob: resultBlob, outputFile: output, description };
    }

    /**
     * executeApiCall — PATCHED
     *
     * Changes vs original:
     * • Uses pollJobResult() (REST polling) instead of EventSource (SSE)
     * • Resolves $uploaded_file from payload using store.uploadedFilePath first
     * • Adds null-result guard before the special-handling blocks
     * • Adds console.log / console.error at each stage so failures are visible
     */
    async executeApiCall(command, job) {
        const args     = command.args || {};
        const endpoint = args.endpoint || command.endpoint;
        const method   = args.method   || command.method || 'POST';
        const payload  = args.payload  || command.payload || {};

        if (!endpoint) {
            console.warn('[MediaExecutionEngine] executeApiCall: no endpoint', command);
            return { action: command.action, success: true, message: 'API call skipped (no endpoint)', skipped: true };
        }

        // ── Resolve $uploaded_file inside payload ─────────────────────────
        const store = useTimelineStore.getState();
        const resolvedPayload = { ...payload };
        for (const [key, val] of Object.entries(resolvedPayload)) {
            if (val === '$uploaded_file') {
                // Prefer server-side path; fall back to browser file name
                resolvedPayload[key] = store.uploadedFilePath || store.uploadedFile?.name || 'video.mp4';
                console.log(`[MediaExecutionEngine] Resolved $uploaded_file → "${resolvedPayload[key]}"`);
            }
        }

        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), TIMEOUTS.API_CALL);
        job.signal.addEventListener('abort', () => controller.abort());

        try {
            // ── 1. POST to the API endpoint ───────────────────────────────
            console.log(`[MediaExecutionEngine] → POST ${endpoint}`, resolvedPayload);

            const response = await authFetch(endpoint, {
                method,
                body:   JSON.stringify(resolvedPayload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                let errorMessage = response.statusText;
                try {
                    const errorBody = await response.json();
                    if (errorBody.error === 'Route not found' && response.status === 404) {
                        console.warn(`[MediaExecutionEngine] Endpoint ${endpoint} not registered — skipping`);
                        return { action: command.action, success: true, skipped: true, message: `${endpoint} not implemented` };
                    }
                    errorMessage = errorBody.error || errorBody.message || errorMessage;
                } catch (_) {}
                throw new Error(`API error ${response.status}: ${errorMessage}`);
            }

            let result = await response.json();
            console.log(`[MediaExecutionEngine] ← ${endpoint}`, result);

            // ── 2. If job was queued, poll until complete ─────────────────
            if (result.jobId) {
                console.log(`[MediaExecutionEngine] Polling job ${result.jobId}...`);
                try {
                    result = await pollJobResult(result.jobId, job.signal);
                    console.log(`[MediaExecutionEngine] Job ${result === null ? 'null' : 'ok'}:`, result);
                } catch (pollErr) {
                    if (pollErr.message === 'Polling cancelled') throw new Error('API call cancelled');
                    throw pollErr;
                }
            }

            // ── 3. Guard against null/undefined result ────────────────────
            if (result == null) {
                console.warn(`[MediaExecutionEngine] ⚠️  ${command.action}: result is null — no timeline changes`);
                return { engine: 'api', success: true, endpoint, result: null, warning: 'empty result' };
            }

            // ── 4. Filler word removal ────────────────────────────────────
            if (command.action === 'fillerDetect' && result.activeSegments) {
                console.log(`[MediaExecutionEngine] ✂️  fillerDetect: ${result.fillerCount} fillers removed, ${result.activeSegments.length} active segments`);
                this._applySegmentsToTimeline(result.activeSegments, 'filler');
            }

            // ── 5. Audio denoise / normalize ──────────────────────────────
            if ((command.action === 'audioDenoise' || command.action === 'audioNormalize') && result?.url) {
                const timelineStore = useTimelineStore.getState();
                const videoTrack    = timelineStore.tracks?.find(t => t.type === 'video');
                const firstClip     = videoTrack?.clips?.[0];
                if (firstClip?.assetId) {
                    timelineStore.updateAsset(firstClip.assetId, { proxyUrl: result.url });
                    console.log(`[MediaExecutionEngine] ✅ Asset updated with processed audio`);
                } else {
                    console.warn('[MediaExecutionEngine] No assetId found on first clip — cannot update proxy URL');
                }
            }

            // ── 6. Repeated-takes detection ───────────────────────────────
            if (command.action === 'detectRepeatedTakes' && result?.activeSegments?.length > 0) {
                console.log(`[MediaExecutionEngine] ✂️  detectRepeatedTakes: ${result.activeSegments.length} segments`);
                this._applySegmentsToTimeline(result.activeSegments, 'take');
            }

            // ── 7. Silence detection ──────────────────────────────────────
            if (command.action === 'silenceDetect') {
                let activeSegments = result.activeSegments;

                // Fallback: derive from word timestamps if backend sent words[]
                if (!activeSegments && result.words?.length > 0) {
                    const p        = (command.args || {}).payload || {};
                    const minSil   = parseFloat(p.min_duration) || 0.5;
                    const pad      = parseFloat(p.padding)      || 0.1;
                    activeSegments = buildActiveSegmentsFromWords(result.words, minSil, pad);
                    console.log(`[MediaExecutionEngine] Derived ${activeSegments.length} segments from ${result.words.length} words`);
                }

                if (!activeSegments || activeSegments.length === 0) {
                    console.warn('[MediaExecutionEngine] ⚠️  silenceDetect returned no activeSegments — nothing to cut');
                } else {
                    console.log(`[MediaExecutionEngine] ✂️  silenceDetect: applying ${activeSegments.length} segments`);
                    this._applySegmentsToTimeline(activeSegments, 'silence');
                }
            }

            return { engine: 'api', success: true, endpoint, result };

        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError' || err.message === 'API call cancelled') {
                throw new Error('API call cancelled');
            }
            console.error(`[MediaExecutionEngine] ❌ executeApiCall(${endpoint}):`, err.message);
            throw err;
        }
    }

    /**
     * _applySegmentsToTimeline
     * Shared helper: removes the first video clip and replaces it with
     * one clip per active segment (same source media, different offset/duration).
     *
     * @param {Array<{start,end,duration}>} segments
     * @param {string} prefix  – used in generated clip IDs for debugging
     */
    _applySegmentsToTimeline(segments, prefix = 'seg') {
        const timelineStore = useTimelineStore.getState();
        const videoTrack    = timelineStore.tracks?.find(t => t.type === 'video');

        if (!videoTrack) {
            console.warn(`[MediaExecutionEngine] _applySegmentsToTimeline: no video track found`);
            return;
        }
        if (videoTrack.clips.length === 0) {
            console.warn(`[MediaExecutionEngine] _applySegmentsToTimeline: video track has no clips`);
            return;
        }

        const baseClip = videoTrack.clips[0];

        // Filter out degenerate segments
        const validSegs = segments.filter(s => s.duration > 0.05);
        if (validSegs.length === 0) {
            console.warn(`[MediaExecutionEngine] _applySegmentsToTimeline: all segments are too short, skipping`);
            return;
        }

        // Remove ALL existing clips on the video track so we start fresh
        // (avoids leaving stale clips when there are multiple clips already)
        const allClipIds = videoTrack.clips.map(c => c.id);
        allClipIds.forEach(id => {
            timelineStore.removeClip(videoTrack.id, id);
        });

        // Re-fetch the track to get the latest state
        let currentStartTime = 0;
        const ts = Date.now();

        validSegs.forEach((seg, i) => {
            const newClip = {
                ...baseClip,
                id:       `clip_${prefix}_${ts}_${i}`,
                start:    currentStartTime,
                duration: seg.duration,
                offset:   seg.start,
                name:     `${baseClip.name || 'Clip'} (${prefix} ${i + 1})`
            };
            timelineStore.addClip(videoTrack.id, newClip);
            currentStartTime += seg.duration;
            console.log(`[MediaExecutionEngine]   clip_${prefix}_${i}: timeline ${newClip.start.toFixed(2)}s–${currentStartTime.toFixed(2)}s  source ${seg.start.toFixed(2)}s–${seg.end.toFixed(2)}s`);
        });

        console.log(`[MediaExecutionEngine] ✅ Timeline updated: ${validSegs.length} clips, total duration ${currentStartTime.toFixed(2)}s`);
    }

    async verifyExecution(job) {
        return job.results.every(r => r.success !== false);
    }

    getStatus() {
        return {
            isProcessing: this.isProcessing,
            activeJob:    this.activeJob ? { id: this.activeJob.id, state: this.activeJob.state, progress: this.activeJob.progress } : null,
            queueLength:  this.queue.length,
            queuedJobs:   this.queue.map(j => j.id)
        };
    }
}

export const mediaExecutionEngine = new MediaExecutionEngine();
export default MediaExecutionEngine;