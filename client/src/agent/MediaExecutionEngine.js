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
import { TimelineActions } from '../timeline/index.js';
import { mediaBunnyService } from '../services/MediaBunnyService.js';
import useAIStore from '../store/useAIStore.js';

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

/**
 * Resolve the server-side storage path ("raw/<user>/<file>") for an asset from
 * whichever URL shape it happens to carry. Diarization and frame-extraction
 * routes need this path; assets store it inconsistently depending on whether
 * the proxy job has finished. Returns null when nothing usable is present.
 */
function resolveAssetServerPath(asset) {
    if (!asset) return null;
    const fromUrl = (url) => {
        if (!url || typeof url !== 'string') return null;
        if (url.startsWith('raw/') || url.startsWith('temp/')) return url;
        const m = url.match(/\/(raw\/[^?#]+)/);
        if (m) return decodeURIComponent(m[1]);
        // Proxy path → recover the raw counterpart: proxies/<user>/<file>
        const p = url.match(/\/api\/proxy\/gcs-media\/proxies\/([^/]+)\/([^/?#]+)/);
        if (p) return `raw/${p[1]}/${decodeURIComponent(p[2])}`;
        const g = url.match(/storage\.googleapis\.com\/[^/]+\/(raw\/[^?#]+)/);
        if (g) return decodeURIComponent(g[1]);
        return null;
    };
    return fromUrl(asset.gcsPath)
        || fromUrl(asset.sourceUrl)
        || fromUrl(asset.proxyUrl)
        || fromUrl(asset.url)
        || null;
}

/**
 * Group word-level timestamps into caption lines.
 * Splits on natural pauses (gap > 0.4 s) or every MAX_WORDS words.
 */
function groupWordsIntoCaptions(words, maxWords = 6, pauseThreshold = 0.4) {
    if (!words || words.length === 0) return [];
    const captions = [];
    let group = [];
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const gap = i > 0 ? (w.start || 0) - (words[i - 1].end || 0) : 0;
        const shouldFlush = group.length >= maxWords || (group.length > 0 && gap >= pauseThreshold);
        if (shouldFlush) {
            captions.push({
                text: group.map(x => x.word).join(' '),
                start: group[0].start,
                end: group[group.length - 1].end,
            });
            group = [];
        }
        group.push(w);
    }
    if (group.length > 0) {
        captions.push({
            text: group.map(x => x.word).join(' '),
            start: group[0].start,
            end: group[group.length - 1].end,
        });
    }
    return captions;
}

/**
 * Re-map word timestamps from source-file time to timeline time.
 *
 * After silence/filler removal the video track has many short clips, each with:
 *   clip.offset   — where in the source file the clip starts (seconds)
 *   clip.start    — where on the timeline the clip is placed (seconds)
 *   clip.duration — how long it plays
 *
 * Words that fall entirely within a kept segment are shifted so their
 * timestamps describe their position on the edited timeline, not the raw file.
 * Words that were cut are dropped.
 */
function deriveTimelineTranscript(tracks, originalWords) {
    if (!originalWords?.length) return null;
    const videoTrack = tracks?.find(t => t.type === 'video');
    if (!videoTrack?.clips?.length) return null;

    const clips = [...videoTrack.clips]
        .sort((a, b) => a.start - b.start)
        .filter(c => c.duration > 0);

    const timelineWords = [];
    for (const clip of clips) {
        const srcStart = clip.offset || 0;
        const srcEnd   = srcStart + clip.duration;
        const tlBase   = clip.start;
        const speed    = clip.speed || 1;

        for (const w of originalWords) {
            const wStart = w.start ?? 0;
            const wEnd   = w.end   ?? wStart;
            if (wStart >= srcStart - 0.01 && wEnd <= srcEnd + 0.01) {
                timelineWords.push({
                    word:  w.word || w.content || w.text || '',
                    start: tlBase + (wStart - srcStart) / speed,
                    end:   tlBase + (wEnd   - srcStart) / speed,
                });
            }
        }
    }
    return timelineWords.length > 0 ? timelineWords : null;
}

// ─── MediaExecutionEngine ────────────────────────────────────────────────────

export class MediaExecutionEngine {
    constructor() {
        this.queue       = [];
        this.activeJob   = null;
        this.isProcessing = false;
        this.listeners   = new Map();
        // "Ask once, then allow" guard for split_speakers — see the case body
        // for why. Cleared after use or after DESTRUCTIVE_CONFIRM_WINDOW_MS.
        this._pendingSplitSpeakersConfirm = null;
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
                // If a clip is actively selected, target that specific clip.
                // Otherwise fan out to ALL clips on all video tracks so operations
                // like volume, mute, color grade apply everywhere — not just clip[0].
                if (store.activeClipId) {
                    args[key] = store.activeClipId;
                } else {
                    const allVideoClips = (store.tracks || [])
                        .filter(t => t.type === 'video')
                        .flatMap(t => t.clips || []);
                    args[key] = allVideoClips.length === 1
                        ? allVideoClips[0].id   // single clip — keep original behavior
                        : '$ALL_CLIPS';          // multiple clips — fan out in executeStoreAction
                }
            } else if (val === '$uploaded_file') {
                // Prefer the server-side path stored after proxy upload
                let serverPath = store.uploadedFilePath;
                const fileName   = store.uploadedFile?.name;

                // Fallback: recover GCS raw path from any URL format stored on the asset.
                if (!serverPath && store.assets) {
                    const videoAsset = store.assets.find(a => a.type === 'video');
                    if (videoAsset) {
                        const toGcsRawPath = (url) => {
                            if (!url) return null;
                            if (url.startsWith('raw/') || url.startsWith('temp/')) return url;
                            const m = url.match(/\/(raw\/[^?#]+)/);
                            if (m) return m[1];
                            const p = url.match(/\/api\/proxy\/gcs-media\/proxies\/([^/]+)\/([^/]+)/);
                            if (p) return `raw/${p[1]}/${p[2]}`;
                            return null;
                        };
                        serverPath = toGcsRawPath(videoAsset.sourceUrl) || toGcsRawPath(videoAsset.proxyUrl);
                        if (serverPath) console.log('[MediaExecutionEngine] Recovered GCS path from asset URLs:', serverPath);
                    }
                }

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
            case 'updateClip': {
                if (args.clipId === '$ALL_CLIPS') {
                    // Fan out to every clip on every video track — one history snapshot total
                    store._saveHistory?.();
                    const videoTracks = (store.tracks || []).filter(t => t.type === 'video');
                    for (const track of videoTracks) {
                        for (const clip of (track.clips || [])) {
                            store.updateClip(track.id, clip.id, args.updates, { skipHistory: true });
                        }
                    }
                } else {
                    this._callStore(store, 'updateClip', args.trackId, args.clipId, args.updates);
                }
                return { action, success: true };
            }
            case 'duplicateClip':  this._callStore(store, 'duplicateClip', args.trackId, args.clipId); return { action, success: true };
            case 'trimClip':       this._callStore(store, 'trimClip', args.trackId, args.clipId, args.trimFrom, args.amount); return { action, success: true };
            case 'rippleDelete':   this._callStore(store, 'rippleDelete', args.atTime); return { action, success: true };
            case 'addTransition': {
                if (args.clipId === '$ALL_CLIPS') {
                    const videoTracks = (store.tracks || []).filter(t => t.type === 'video');
                    for (const track of videoTracks) {
                        for (const clip of (track.clips || [])) {
                            this._callStore(store, 'addTransition', clip.id, args.type, args.duration);
                        }
                    }
                } else {
                    this._callStore(store, 'addTransition', args.clipId, args.type, args.duration);
                }
                return { action, success: true };
            }
            case 'addFilter': {
                if (args.clipId === '$ALL_CLIPS') {
                    const videoTracks = (store.tracks || []).filter(t => t.type === 'video');
                    for (const track of videoTracks) {
                        for (const clip of (track.clips || [])) {
                            this._callStore(store, 'addFilter', clip.id, args.filterType, args.intensity);
                        }
                    }
                } else {
                    this._callStore(store, 'addFilter', args.clipId, args.filterType, args.intensity);
                }
                return { action, success: true };
            }
            case 'addTextOverlay': this._callStore(store, 'addTextOverlay', args.text, args.position, args.duration, args.style); return { action, success: true };
            case 'applyColorGrade': {
                if (args.clipId === '$ALL_CLIPS') {
                    store._saveHistory?.();
                    const videoTracks = (store.tracks || []).filter(t => t.type === 'video');
                    for (const track of videoTracks) {
                        for (const clip of (track.clips || [])) {
                            this._callStore(store, 'applyColorGrade', clip.id, args.adjustments);
                        }
                    }
                } else {
                    this._callStore(store, 'applyColorGrade', args.clipId, args.adjustments);
                }
                return { action, success: true };
            }
            case 'undo':           this._callStore(store, 'undo'); return { action, success: true };
            case 'redo':           this._callStore(store, 'redo'); return { action, success: true };
            case 'chat':           return { action, success: true, message: args.message, isChat: true };
            case 'createBrollTrack': {
                const { trackId } = args;
                const existing = store.tracks?.find(t => t.id === trackId);
                if (!existing) {
                    // addTrack returns the generated id; we need the caller's id so we
                    // dispatch directly via the store's timelineManager-level addTrack.
                    this._callStore(store, 'addTrack', 'video');
                    // Rename the just-created track to "B-Roll"
                    const fresh = store.tracks?.find(t => t.type === 'video' && t.id !== args._mainTrackId);
                    if (fresh) this._callStore(store, 'renameTrack', fresh.id, 'B-Roll');
                }
                return { action, success: true };
            }
            case 'moveClipToTrack': {
                const { fromTrackId, clipId, toTrackId } = args;
                // Resolve the target track: if it was created by createBrollTrack in this
                // same execution pass, look up the actual id (second video track).
                let resolvedTrackId = toTrackId;
                if (!store.tracks?.find(t => t.id === toTrackId)) {
                    const secondVideoTrack = store.tracks?.filter(t => t.type === 'video')[1];
                    if (secondVideoTrack) resolvedTrackId = secondVideoTrack.id;
                }
                if (!resolvedTrackId) return { action, success: false, message: 'B-Roll track not found' };
                this._callStore(store, 'moveClipToTrack', fromTrackId, clipId, resolvedTrackId);
                return { action, success: true, message: `Moved clip to b-roll track` };
            }

            // ── Playhead seek — handled directly without VideoEditorTools ─────────
            case 'seek_to': {
                const time = typeof args.time === 'number' ? args.time : 0;
                if (typeof store.seek === 'function') store.seek(time);
                return { action, success: true, message: `Seeked to ${time}s` };
            }

            // ── Phrase-range cut — removes a source-file span from the timeline ──
            case 'cut_source_range': {
                const srcStart = command.src_start ?? args.src_start ?? args.srcStart;
                const srcEnd   = command.src_end   ?? args.src_end   ?? args.srcEnd;
                if (typeof srcStart !== 'number' || typeof srcEnd !== 'number' || srcEnd <= srcStart) {
                    return { action, success: false, message: `cut_source_range: invalid range ${srcStart}–${srcEnd}` };
                }
                if (typeof store.cutSourceRange === 'function') {
                    store.cutSourceRange(srcStart, srcEnd);
                    return { action, success: true, message: `Cut source range ${srcStart.toFixed(1)}s–${srcEnd.toFixed(1)}s` };
                }
                return { action, success: false, message: 'cutSourceRange not available in store' };
            }

            // ── All long-form semantic actions — delegate to VideoEditorTools ─────
            case 'cutSegment':
            case 'reorderSegment':
            case 'findHook':
            case 'removeRepetition':
            case 'add_transitions_to_sections':
            case 'analyzeStructure':
            case 'apply_zoom':        // alias — server fallback generates this for "zoom in/out"
            case 'apply_smart_zoom':
            case 'smart_cleanup':
            case 'longFormEdit': {
                let VideoEditorTools;
                try {
                    const module = await import('./VideoEditorTools.js');
                    VideoEditorTools = module.VideoEditorTools;
                } catch (err) {
                    // Auto-recover if the server deployed a new version and this chunk's hash changed
                    if (err.message && (err.message.includes('fetch dynamically imported module') || err.message.includes('MIME type'))) {
                        console.warn('[MediaExecutionEngine] New app deployment detected. Reloading page to fetch the latest chunks...');
                        useTimelineStore.getState().saveProject(); // save current state before reload
                        window.location.reload();
                        return { action: command.action, success: false, message: 'App updated. Reloading...', skipped: true };
                    }
                    throw err;
                }
                const tools = new VideoEditorTools();
                const toolName = action
                    .replace(/([A-Z])/g, m => `_${m.toLowerCase()}`)
                    .replace(/^_/, '');

                // 120 s cap per tool call — belt-and-suspenders below the 180 s
                // WorkflowController timeout. Ensures a hanging ContentAnalyzer
                // API call produces a clean rejection instead of a zombie promise.
                //
                // toolAbortController is aborted when the timeout fires so the
                // orphaned tools.execute() promise actually stops: ContentAnalyzer
                // cancels its fetch and the inner mediaExecutionEngine job cancels
                // its poller — preventing ghost _applySegmentsToTimeline calls.
                const TOOL_TIMEOUT_MS = 120_000;
                const toolAbortController = new AbortController();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => {
                        toolAbortController.abort();
                        reject(new Error(`Tool '${toolName}' timed out after ${TOOL_TIMEOUT_MS / 1000}s`));
                    }, TOOL_TIMEOUT_MS)
                );
                // Also abort if the outer job is cancelled (e.g. user presses stop)
                job.signal.addEventListener('abort', () => toolAbortController.abort(), { once: true });
                const result = await Promise.race([
                    tools.execute({ name: toolName, args, signal: toolAbortController.signal }),
                    timeoutPromise
                ]);
                return { action, success: result.success !== false, message: result.message || action, result };
            }

            // ── Split speakers — "separate the two people" ───────────────────
            // Full pipeline:
            //   1. Queue diarize job  → Node server streams WAV to Python service
            //   2. Poll until complete → { words, speakers, language }
            //   3. Call build-tracks  → { tracks: [{ speaker, clips }] }
            //   4. Create one video track per speaker, fill it with their clips
            case 'split_speakers': {
                const spStore      = useTimelineStore.getState();
                const uploadedPath = spStore.uploadedFilePath;
                const videoAsset   = (spStore.assets || []).find(a => a.type === 'video');

                if (!uploadedPath) {
                    return { action, success: false, message: 'No uploaded file path found. Re-upload the video and try again.' };
                }
                if (!videoAsset) {
                    return { action, success: false, message: 'No video asset in timeline.' };
                }

                // ── Destructive-work guard ──────────────────────────────────────
                // split_speakers removes ALL clips on the video track(s) and rebuilds
                // them from scratch with no metadata carried over — unlike silence/
                // filler removal and re-running virtual_multicam, there's no sensible
                // way to remap a per-speaker-track rebuild onto existing per-clip
                // virtualCam angles / zoom-rhythm keyframes, so it just wipes them
                // (see R16 in CLAUDE.md). Warn once and require the user to re-issue
                // the command before actually destroying that work.
                const DESTRUCTIVE_CONFIRM_WINDOW_MS = 2 * 60 * 1000;
                const spVideoTracks = (spStore.tracks || []).filter(t => t.type === 'video');
                const spExistingClips = spVideoTracks.flatMap(t => t.clips || []);
                const spVmCount = spExistingClips.filter(c => c.virtualCam).length;
                const spZoomCount = spExistingClips.filter(c => c.keyframes?.scale?.length).length;
                const spHasPriorWork = spVmCount > 0 || spZoomCount > 0;

                const pending = this._pendingSplitSpeakersConfirm;
                const confirmedRecently = pending && (Date.now() - pending.ts) < DESTRUCTIVE_CONFIRM_WINDOW_MS;

                if (spHasPriorWork && !confirmedRecently && !args.confirmed) {
                    this._pendingSplitSpeakersConfirm = { ts: Date.now() };
                    const parts = [];
                    if (spVmCount > 0)   parts.push(`${spVmCount} multicam-tagged clip${spVmCount > 1 ? 's' : ''}`);
                    if (spZoomCount > 0) parts.push(`${spZoomCount} zoom-rhythm clip${spZoomCount > 1 ? 's' : ''}`);
                    return {
                        action,
                        success: false,
                        message:
                            `Splitting speakers will remove ${parts.join(' and ')} already applied to this video — ` +
                            `it rebuilds the video track from scratch with no way to carry that work over.\n\n` +
                            `Run "split speakers" again if you want to proceed anyway — it won't ask twice within the next couple of minutes.`,
                    };
                }
                this._pendingSplitSpeakersConfirm = null; // consumed

                const spLanguage = args.language || null;

                // ── 1. Diarization — CACHE FIRST ──────────────────────────────
                // This used to unconditionally queue a fresh diarize job (1–5 min)
                // even when `detect_speakers` had just produced exactly this data.
                // Running the atomic chain therefore paid for diarization twice.
                // `_getDiarizationForAsset` resolves cache → speakerMap → new job,
                // so the chain is now free and `split_by_speaker` on its own still
                // works standalone (it falls through to queuing the job).
                let words, speakers;
                const spCached = await this._getDiarizationForAsset(videoAsset.id, {
                    isPrimary: true,
                    signal: job?.signal ?? null,
                });

                if (spCached?.words?.length) {
                    ({ words, speakers } = spCached);
                    console.log(`[MediaExecutionEngine] split_speakers: reusing cached diarization (${words.length} words, ${speakers.length} speaker(s)) — no job queued`);
                } else {
                    console.log('[MediaExecutionEngine] split_speakers: no cached diarization — queuing job…');
                    const diarizeRes = await authFetch('/api/interview/split-speakers', {
                        method: 'POST',
                        body:   JSON.stringify({
                            filename: uploadedPath,
                            ...(spLanguage ? { language: spLanguage } : {}),
                        }),
                    });
                    if (!diarizeRes.ok) {
                        const errBody = await diarizeRes.json().catch(() => ({}));
                        throw new Error(errBody.error || `split-speakers returned ${diarizeRes.status}`);
                    }
                    const { jobId: diarizeJobId } = await diarizeRes.json();
                    if (!diarizeJobId) throw new Error('split-speakers did not return a jobId');

                    console.log(`[MediaExecutionEngine] split_speakers: polling job ${diarizeJobId}…`);
                    const diarizeResult = await pollJobResult(diarizeJobId, job.signal);
                    if (!diarizeResult?.words?.length) {
                        return { action, success: false, message: 'Diarization returned no words — check that ASSEMBLYAI_API_KEY or DIARIZE_SERVICE_URL is configured.' };
                    }
                    ({ words, speakers } = diarizeResult);
                    // Cache so a later multicam/angle step doesn't re-pay for it
                    useTimelineStore.getState().setAssetDiarization?.(videoAsset.id, { words, speakers });
                }
                console.log(`[MediaExecutionEngine] split_speakers: ${words.length} words, ${speakers.length} speaker(s): ${speakers.join(', ')}`);

                if (speakers.length < 2) {
                    // Persist the diarization result even though there's nothing to
                    // split. virtual_multicam reads speakerMap as its primary word
                    // source — returning early without storing it left the compound
                    // "split speakers + multicam" flow with no diarization data, so
                    // multicam bailed with "needs speaker diarization" and silently
                    // changed nothing. Solo mode works fine off a single speaker.
                    const soloMap = {};
                    for (const spk of speakers) {
                        soloMap[spk] = { role: null, label: null, words: words.filter(w => w.speaker === spk) };
                    }
                    if (Object.keys(soloMap).length > 0) {
                        useTimelineStore.getState().setSpeakerMap(soloMap);
                        console.log(`[MediaExecutionEngine] split_speakers: 1 speaker — speakerMap stored for downstream commands`);
                    }
                    return {
                        action,
                        success: true,
                        message: `Only one speaker detected in this video (${words.length} words). Nothing to split — "interview angles" will use single-speaker wide/mid/close framing, or try "make it more dynamic".`,
                    };
                }

                // ── 3. Build per-speaker clip ranges ─────────────────────────
                const videoDuration = videoAsset.duration || videoAsset.sourceDuration || 0;
                const buildRes = await authFetch('/api/interview/build-tracks', {
                    method: 'POST',
                    body: JSON.stringify({
                        words,
                        speakers,
                        videoDuration,
                        assetId: videoAsset.id,
                    }),
                });
                if (!buildRes.ok) throw new Error(`build-tracks returned ${buildRes.status}`);
                const { tracks: speakerTracks } = await buildRes.json();
                if (!speakerTracks?.length) {
                    return { action, success: false, message: 'build-tracks returned no tracks.' };
                }

                // ── 4. Populate the timeline ──────────────────────────────────
                // Re-read store so we have the freshest track list.
                const freshStore     = useTimelineStore.getState();
                const proxyUrl       = videoAsset.proxyUrl || videoAsset.url || '';
                const existingVTrack = freshStore.tracks?.find(t => t.type === 'video');

                speakerTracks.forEach(({ speaker, clips: spClips }, idx) => {
                    const label = `Speaker ${String(idx + 1).padStart(2, '0')}`;
                    let trackId;

                    if (idx === 0 && existingVTrack) {
                        // Reuse the first video track — remove its existing clips
                        trackId = existingVTrack.id;
                        (existingVTrack.clips || []).forEach(c => {
                            useTimelineStore.getState().removeClip(trackId, c.id);
                        });
                        useTimelineStore.getState().renameTrack(trackId, label);
                    } else {
                        // Track IDs before the new addTrack call
                        const beforeIds = new Set(useTimelineStore.getState().tracks.map(t => t.id));
                        trackId = useTimelineStore.getState().addTrack('video');
                        // addTrack returns the id directly
                        useTimelineStore.getState().renameTrack(trackId, label);
                    }

                    // Place each speaker clip at its natural source-video position
                    spClips.forEach((clip, clipIdx) => {
                        useTimelineStore.getState().addClip(trackId, {
                            id:           `sp${idx}-clip${clipIdx}-${Date.now()}`,
                            assetId:      videoAsset.id,
                            name:         `${label} · clip ${clipIdx + 1}`,
                            type:         'video',
                            url:          proxyUrl,
                            sourceUrl:    videoAsset.sourceUrl || proxyUrl,
                            offset:       clip.start,     // source video position
                            start:        clip.start,     // timeline position = source position
                            duration:     clip.duration,
                            sourceDuration: clip.duration,
                        });
                    });
                });

                // ── 5. Persist speakerMap ─────────────────────────────────────
                // Group words by speaker so ContextGenerator can include them in
                // GPT-4o context — enabling remove_speaker and semantic_cut.
                const speakerMapInit = {};
                for (const spk of speakers) {
                    speakerMapInit[spk] = {
                        role:  null,
                        label: null,
                        words: words.filter(w => w.speaker === spk),
                    };
                }
                useTimelineStore.getState().setSpeakerMap(speakerMapInit);
                console.log(`[MediaExecutionEngine] speakerMap stored: ${speakers.join(', ')}`);

                // ── 6. Identify speaker roles (non-blocking) ──────────────────
                // Fire-and-forget: enriches speakerMap with role labels (interviewer/guest).
                // Failure is safe — speakerMap still works with null roles.
                authFetch('/api/interview/identify-speakers', {
                    method: 'POST',
                    body: JSON.stringify({ words, speakers }),
                }).then(async r => {
                    if (!r.ok) return;
                    const roles = await r.json();
                    const store = useTimelineStore.getState();
                    for (const [spk, info] of Object.entries(roles)) {
                        if (info?.role) {
                            store.setSpeakerRole(spk, info.role, info.role === 'interviewer' ? 'Interviewer' : 'Guest');
                        }
                    }
                    console.log('[MediaExecutionEngine] speaker roles identified:', JSON.stringify(roles));
                }).catch(e => console.warn('[MediaExecutionEngine] identify-speakers failed (non-critical):', e.message));

                const summary = speakerTracks
                    .map((t, i) => `Speaker ${i + 1}: ${t.clips.length} clip${t.clips.length !== 1 ? 's' : ''}`)
                    .join(' · ');

                return {
                    action,
                    success: true,
                    message: `Split into ${speakerTracks.length} speaker tracks — ${summary}. You can now say "remove the interviewer" or "cut everything the guest says".`,
                };
            }

            // ── Remove speaker — "remove everything the interviewer says" ────────
            // Reads speakerMap from store, finds the target speaker by role or id,
            // groups their word timestamps into continuous segments, and cuts each
            // from the timeline using the existing silence_removal segment logic.
            case 'remove_speaker': {
                const rsStore = useTimelineStore.getState();
                const { speakerMap } = rsStore;

                if (!speakerMap || Object.keys(speakerMap).length === 0) {
                    return {
                        action, success: false,
                        message: 'No speaker data found. Run "split speakers" first so I can identify who said what.',
                    };
                }

                // Resolve speaker by role or explicit id
                const { role, speakerId } = args;
                let targetId = speakerId || null;

                if (!targetId && role) {
                    // Match by role (set by identify-speakers) or by label substring
                    const normalizedRole = role.toLowerCase();
                    for (const [id, info] of Object.entries(speakerMap)) {
                        const infoRole  = (info.role  || '').toLowerCase();
                        const infoLabel = (info.label || '').toLowerCase();
                        if (infoRole === normalizedRole || infoLabel.includes(normalizedRole)) {
                            targetId = id;
                            break;
                        }
                    }
                }

                // Fallback: if role is 'interviewer' and no match, pick the speaker
                // with fewer total words (interviewers speak less than guests on average).
                if (!targetId && role) {
                    const sorted = Object.entries(speakerMap).sort(
                        (a, b) => (a[1].words?.length || 0) - (b[1].words?.length || 0)
                    );
                    const isInterviewerLookup = /interview|host/.test(role.toLowerCase());
                    targetId = isInterviewerLookup ? sorted[0]?.[0] : sorted[sorted.length - 1]?.[0];
                    console.warn(`[MediaExecutionEngine] remove_speaker: no role match for "${role}", falling back to word-count heuristic → ${targetId}`);
                }

                if (!targetId || !speakerMap[targetId]) {
                    return {
                        action, success: false,
                        message: `I couldn't identify a "${role}" in the speaker data. Try "split speakers" again — I'll label the interviewer and guest automatically.`,
                    };
                }

                const targetInfo = speakerMap[targetId];
                const targetWords = targetInfo.words || [];
                if (targetWords.length === 0) {
                    return { action, success: true, message: `No words found for ${targetInfo.label || targetId}.` };
                }

                // Group consecutive words (gap ≤ 0.5s) into segments to cut
                const MERGE_GAP = 0.5;
                const segments = [];
                let segStart = targetWords[0].start;
                let segEnd   = targetWords[0].end;

                for (let i = 1; i < targetWords.length; i++) {
                    const w = targetWords[i];
                    if ((w.start - segEnd) <= MERGE_GAP) {
                        segEnd = w.end;
                    } else {
                        segments.push({ start: segStart, end: segEnd });
                        segStart = w.start;
                        segEnd   = w.end;
                    }
                }
                segments.push({ start: segStart, end: segEnd });

                console.log(`[MediaExecutionEngine] remove_speaker: cutting ${segments.length} segments for ${targetId} (${targetInfo.role || 'unknown role'})`);

                // Apply cuts in reverse order so earlier indices stay valid
                const videoTrack = useTimelineStore.getState().tracks?.find(t => t.type === 'video');
                if (!videoTrack) {
                    return { action, success: false, message: 'No video track found.' };
                }

                let cutCount = 0;
                for (const seg of [...segments].reverse()) {
                    const clipsInRange = videoTrack.clips.filter(c =>
                        c.start < seg.end && (c.start + c.duration) > seg.start
                    );
                    for (const clip of clipsInRange) {
                        const clipEnd = clip.start + clip.duration;
                        // Full removal
                        if (clip.start >= seg.start && clipEnd <= seg.end) {
                            useTimelineStore.getState().removeClip(videoTrack.id, clip.id);
                            cutCount++;
                        } else if (clip.start < seg.start && clipEnd > seg.end) {
                            // Segment is in the middle — trim the clip (keep before seg)
                            useTimelineStore.getState().updateClip(videoTrack.id, clip.id, { duration: seg.start - clip.start });
                            cutCount++;
                        } else if (clip.start < seg.end && clipEnd > seg.start) {
                            // Partial overlap — trim to exclude the speaker segment
                            if (clip.start < seg.start) {
                                useTimelineStore.getState().updateClip(videoTrack.id, clip.id, { duration: seg.start - clip.start });
                            } else {
                                const newStart = seg.end;
                                const newDur   = clipEnd - seg.end;
                                if (newDur > 0.1) {
                                    useTimelineStore.getState().updateClip(videoTrack.id, clip.id, { start: newStart, offset: (clip.offset || 0) + (seg.end - clip.start), duration: newDur });
                                } else {
                                    useTimelineStore.getState().removeClip(videoTrack.id, clip.id);
                                }
                                cutCount++;
                            }
                        }
                    }
                }

                const label = targetInfo.label || targetInfo.role || targetId;
                return {
                    action, success: true,
                    message: `Removed ${cutCount} segment${cutCount !== 1 ? 's' : ''} from ${label} — ${segments.length} speaking turn${segments.length !== 1 ? 's' : ''} cut.`,
                };
            }

            // ── Semantic cut — "remove the part where I hesitate to say X" ────────
            // GPT-4o already resolved { start, end } from SpeakerWordTimestamps in
            // context during the planning phase. We just apply the cut here.
            // If start/end are missing, we return a helpful error so the user can
            // rephrase more specifically.
            case 'semantic_cut': {
                const { description, start, end } = args;

                if (start == null || end == null) {
                    return {
                        action, success: false,
                        message: `I wasn't able to locate that specific moment in the transcript. Try phrasing it with a keyword: "remove the part where I say [specific word or phrase]".`,
                    };
                }

                if (typeof start !== 'number' || typeof end !== 'number' || end <= start) {
                    return {
                        action, success: false,
                        message: `Invalid segment range: start=${start}, end=${end}. The AI may have returned bad timestamps.`,
                    };
                }

                // Use the existing cut_segment-style logic: find clips in range and trim/remove
                const scStore = useTimelineStore.getState();
                const scTrack = scStore.tracks?.find(t => t.type === 'video');
                if (!scTrack) return { action, success: false, message: 'No video track found.' };

                const clipsInRange = scTrack.clips.filter(c => c.start < end && (c.start + c.duration) > start);
                let cutCount = 0;

                for (const clip of [...clipsInRange].reverse()) {
                    const clipEnd = clip.start + clip.duration;
                    if (clip.start >= start && clipEnd <= end) {
                        scStore.removeClip(scTrack.id, clip.id);
                        cutCount++;
                    } else if (clip.start < start) {
                        scStore.updateClip(scTrack.id, clip.id, { duration: start - clip.start });
                        cutCount++;
                    } else {
                        const newDur = clipEnd - end;
                        if (newDur > 0.1) {
                            scStore.updateClip(scTrack.id, clip.id, { start: end, offset: (clip.offset || 0) + (end - clip.start), duration: newDur });
                        } else {
                            scStore.removeClip(scTrack.id, clip.id);
                        }
                        cutCount++;
                    }
                }

                const durSec = (end - start).toFixed(1);
                return {
                    action, success: true,
                    message: `Cut ${durSec}s segment (${start.toFixed(2)}s – ${end.toFixed(2)}s)${description ? ` — "${description.slice(0, 60)}"` : ''}.`,
                };
            }

            // ── Zoom rhythm — "make it feel multi-camera" ─────────────────────
            // Calls the synchronous /api/interview/rhythm-zoom endpoint, then
            // applies one static scale keyframe at t=0 per clip.
            // Requires: ≥2 clips on the video track + captions in the store.
            case 'rhythm_zoom': {
                const rzStore = useTimelineStore.getState();
                // MULTI-TRACK: after split_speakers there is one video track per
                // speaker. This used to read only the FIRST video track, so the
                // second speaker's clips silently got no zoom rhythm at all.
                // Clips carry _trackId so keyframes are written back to the right
                // track, and shot assignment sees the whole conversation in
                // timeline order rather than one speaker's half of it.
                const rzVideoTracks = (rzStore.tracks ?? []).filter(t => t.type === 'video');
                const rzVideoTrack  = rzVideoTracks[0]; // legacy anchor
                const rzClips = rzVideoTracks
                    .flatMap(t => (t.clips ?? []).map(c => ({ ...c, _trackId: t.id })))
                    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
                const rzWords      = rzStore.captions ?? [];
                const rzStyle      = args.style || 'dynamic';

                if (rzClips.length < 2) {
                    // This should not normally be reached — IntentParser auto-upgrades
                    // "make it more dynamic" to compound_clean_dynamic when clips < 2.
                    // This is a safety net for the GPT-routed path.
                    return {
                        action, success: false,
                        message: `I need to split your clip into segments first before applying zoom rhythm. Try: "clean this clip then make it dynamic" — that removes silences to create segments, then applies the zoom effect in one go.`,
                    };
                }
                if (rzWords.length === 0) {
                    return {
                        action, success: false,
                        message: `Zoom rhythm syncs with your speech to decide when to zoom in or out, so it needs a transcript.\n\nRun "add captions" to generate one, then try "make it more dynamic" again.`,
                    };
                }

                const rzPayload = {
                    clips: rzClips.map(c => {
                        // Pass assetName so the server can resolve the file path for
                        // ML frame extraction (CLIP + MediaPipe).  Falls back gracefully
                        // to transcript-only GPT scoring if assetName is unavailable.
                        const asset = rzStore.assets?.find(a => a.id === c.assetId);
                        return {
                            id:        c.id,
                            offset:    c.offset   ?? 0,
                            duration:  c.duration ?? 0,
                            assetName: asset?.name || null,
                        };
                    }),
                    words: rzWords,
                    style: rzStyle,
                };
                console.log(`[MediaExecutionEngine] rhythm_zoom: ${rzClips.length} clips, ${rzWords.length} words, style=${rzStyle}`);

                const rzRes  = await authFetch('/api/interview/rhythm-zoom', { method: 'POST', body: JSON.stringify(rzPayload) });
                const rzData = await rzRes.json();
                if (!rzRes.ok) throw new Error(rzData.error || `rhythm-zoom error ${rzRes.status}`);

                const { clipZooms, summary } = rzData;

                // Clear existing scale keyframes, then apply the motion plan.
                // Three motion kinds (see /rhythm-zoom's buildMotion):
                //   static   → one keyframe at t=0
                //   push_in  → slow zoom across the clip (2 keyframes, easeOutCubic)
                //   punch_in → hold, then snap to target ON the emphasized word
                //              (keyframe pair 80ms before / 60ms after the word start)
                // Clear on each clip's OWN track — using the first track's id for
                // every clip silently no-oped for clips on other video tracks.
                // (addTransformKeyframe below resolves the track from the clip id
                // itself, so it was already multi-track safe.)
                rzClips.forEach(clip => {
                    if (clip.keyframes?.scale?.length) {
                        rzStore.updateClip(clip._trackId || rzVideoTrack.id, clip.id, {
                            keyframes: { ...(clip.keyframes || {}), scale: [] },
                        });
                    }
                });

                const rzDurById = {};
                rzClips.forEach(c => { rzDurById[c.id] = c.duration ?? 0; });

                clipZooms.forEach(({ clipId, scale, motion }) => {
                    const m   = motion || { kind: 'static', from: scale, to: scale };
                    const dur = rzDurById[clipId] ?? 0;

                    if (m.kind === 'push_in' && dur > 0.5) {
                        rzStore.addTransformKeyframe(clipId, 'scale', 0, m.from, 'linear');
                        rzStore.addTransformKeyframe(clipId, 'scale', dur, m.to, 'easeOutCubic');
                    } else if (m.kind === 'punch_in' && typeof m.at === 'number') {
                        rzStore.addTransformKeyframe(clipId, 'scale', 0, m.from, 'linear');
                        rzStore.addTransformKeyframe(clipId, 'scale', Math.max(0.01, m.at - 0.08), m.from, 'linear');
                        rzStore.addTransformKeyframe(clipId, 'scale', Math.min(dur, m.at + 0.06), m.to, 'easeOutCubic');
                    } else {
                        rzStore.addTransformKeyframe(clipId, 'scale', 0, m.to ?? scale, 'linear');
                    }
                });

                const { counts = {}, motions = {} } = summary || {};
                const punchNote = (motions.punch_in || 0) > 0
                    ? ` ${motions.punch_in} punch-in${motions.punch_in > 1 ? 's land' : ' lands'} right on emphasized words.`
                    : '';
                return {
                    action,
                    success: true,
                    message:
                        `Zoom rhythm applied — ${counts.wide ?? 0}W / ${counts.medium ?? 0}M / ${counts.close ?? 0}C ` +
                        `across ${rzClips.length} shots, with ${motions.push_in ?? 0} slow push-ins.${punchNote}`,
                };
            }

            // ── Semantic clip organizer — "organize my clips" ─────────────────
            // 1. Collect all clips from all video tracks (sorted by current start time)
            // 2. POST to /api/interview/organize-clips with frame extraction server-side
            // 3. Get back orderedIds + per-clip metadata + rationale
            // 4. Rebuild clip start positions on the timeline in the new order
            //    (each clip placed immediately after the previous one, no gaps)
            case 'organize_clips': {
                const ocStore  = useTimelineStore.getState();
                const ocTracks = (ocStore.tracks || []).filter(t => t.type === 'video');
                const ocAssets = ocStore.assets || [];

                console.log(`[organize_clips] store has ${ocAssets.length} asset(s), ${ocTracks.length} video track(s)`);
                if (ocAssets.length > 0) {
                    console.log(`[organize_clips] asset types:`,
                        ocAssets.map(a => `${a.name}(type=${a.type},proxying=${a.isProxying})`).join(', '));
                }

                // Gather all clips across all video tracks, sorted by current timeline position
                let allClips = ocTracks.flatMap(t =>
                    (t.clips || []).map(c => ({ ...c, _trackId: t.id }))
                ).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

                // ── Step 1: place any unplaced bin assets on the timeline ────────
                // Broad type match: accept 'video', 'Video', or anything that includes 'video'
                const readyAssets = ocAssets.filter(
                    a => !a.isProxying && typeof a.type === 'string' && a.type.toLowerCase().includes('video')
                );
                const timelineAssetIds = new Set(allClips.map(c => c.assetId));
                const unplacedAssets   = readyAssets.filter(a => !timelineAssetIds.has(a.id));

                console.log(`[organize_clips] ready=${readyAssets.length}, unplaced=${unplacedAssets.length}, on-timeline=${allClips.length}`);

                let justPlaced = 0;
                if (unplacedAssets.length > 0) {
                    console.log(`[organize_clips] adding ${unplacedAssets.length} unplaced asset(s) to timeline`);
                    for (const asset of unplacedAssets) {
                        useTimelineStore.getState().addAssetToTimeline(asset);
                        justPlaced++;
                    }
                    // Re-read after adding — Zustand set() is synchronous so this is fresh
                    const freshTracks = useTimelineStore.getState().tracks.filter(t => t.type === 'video');
                    allClips = freshTracks.flatMap(t =>
                        (t.clips || []).map(c => ({ ...c, _trackId: t.id }))
                    ).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
                    console.log(`[organize_clips] after placement: ${allClips.length} clip(s) on timeline`);
                }

                // If still no clips after placement attempt, throw so the upstream
                // reports a real error (not "complete"). Returning {success:false}
                // without throwing is swallowed by execute() as a success.
                if (allClips.length === 0) {
                    throw new Error('No clips found. Import some video clips first.');
                }

                if (allClips.length === 1) {
                    return {
                        action,
                        success: true,
                        message: justPlaced > 0
                            ? 'Added your clip to the timeline.'
                            : 'Only one clip on the timeline — import more to organize.',
                    };
                }

                // ── Step 2: semantic ML ordering (best-effort; placement already done) ─
                const placedMsg = justPlaced > 0
                    ? `Added ${justPlaced} clip(s) to the timeline.`
                    : '';

                const captions   = ocStore.captions ?? [];
                const uploadedFP = ocStore.uploadedFilePath || null;

                const clipPayload = allClips.map(clip => {
                    const asset      = ocAssets.find(a => a.id === clip.assetId);
                    const assetName  = asset?.name || clip.name || null;
                    const clipOffset = clip.offset ?? 0;
                    const clipEnd    = clipOffset + (clip.duration ?? 0);
                    const transcript = captions
                        .filter(w => w.start >= clipOffset - 0.1 && w.end <= clipEnd + 0.1)
                        .map(w => w.word).join(' ').trim().slice(0, 300);

                    return {
                        id:         clip.id,
                        assetName,
                        filePath:   uploadedFP || null,
                        offset:     clipOffset,
                        duration:   clip.duration ?? 0,
                        transcript: transcript || undefined,
                    };
                });

                console.log(`[organize_clips] ${clipPayload.length} clips → POST /api/interview/organize-clips`);

                let orderMsg = '';
                try {
                    const ocRes  = await authFetch('/api/interview/organize-clips', {
                        method: 'POST',
                        body:   JSON.stringify({ clips: clipPayload }),
                    });
                    const ocData = await ocRes.json();

                    if (!ocRes.ok) {
                        throw new Error(ocData.error || `organize-clips returned ${ocRes.status}`);
                    }

                    const { orderedIds = [], clipMeta = [], rationale = '' } = ocData;

                    if (orderedIds.length > 0) {
                        const currentIds   = allClips.map(c => c.id);
                        const alreadySorted = orderedIds.every((id, i) => id === currentIds[i]);

                        if (alreadySorted) {
                            orderMsg = `Clips are already in the recommended order. ${rationale}`;
                        } else {
                            // Reorder: place each clip consecutively with no gaps.
                            //
                            // Three things this has to get right, all of which used to
                            // leave the player on a blank dark frame:
                            //  1. Pack PER TRACK. A single global cursor spread clips of
                            //     different tracks along one shared ruler, so tracks
                            //     overlapped and the player (which takes the first
                            //     matching clip across video tracks) showed the wrong one.
                            //  2. Include clips the API DIDN'T return. Anything missing
                            //     from orderedIds kept its old start while everything else
                            //     moved to 0..N — leaving gaps the playhead could sit in.
                            //  3. Move the playhead. After repacking, currentTime often
                            //     pointed past the new end or into a gap, so no clip was
                            //     active and the canvas cleared to black.
                            const clipById  = {};
                            allClips.forEach(c => { clipById[c.id] = c; });
                            const freshStore = useTimelineStore.getState();

                            // Ordered first, then any clip the API omitted (stable order)
                            const orderedSet = new Set(orderedIds);
                            const finalOrder = [
                                ...orderedIds.filter(id => clipById[id]),
                                ...allClips.filter(c => !orderedSet.has(c.id)).map(c => c.id),
                            ];

                            const cursorByTrack = {};
                            for (const clipId of finalOrder) {
                                const clip = clipById[clipId];
                                if (!clip) continue;
                                const tId = clip._trackId;
                                const at  = cursorByTrack[tId] ?? 0;
                                freshStore.updateClip(tId, clipId, { start: at });
                                cursorByTrack[tId] = at + (clip.duration ?? 0);
                            }

                            // Park the playhead on the first clip so a frame is always
                            // available immediately after the reorder.
                            useTimelineStore.getState().seek(0);

                            const metaById = {};
                            clipMeta.forEach(m => { metaById[m.id] = m; });
                            const orderDesc = orderedIds
                                .map((id, i) => {
                                    const m = metaById[id];
                                    return m ? `${i + 1}. ${m.type || 'clip'} (${m.energy || ''})` : `${i + 1}. clip`;
                                })
                                .join(' → ');

                            console.log(`[organize_clips] reordered ${orderedIds.length} clips — ${orderDesc}`);
                            orderMsg = `Semantically organized ${orderedIds.length} clips.\n\n${rationale}\n\nOrder: ${orderDesc}`;
                        }
                    }
                } catch (apiErr) {
                    // ML ordering failed — clips are still placed, just not reordered.
                    // Don't throw: the placement in Step 1 already succeeded.
                    console.warn(`[organize_clips] ML ordering skipped (${apiErr.message}) — clips placed in upload order`);
                    orderMsg = justPlaced > 0 ? '' : 'Could not determine optimal order — clips kept in current order.';
                }

                return {
                    action,
                    success: true,
                    message: [placedMsg, orderMsg].filter(Boolean).join('\n\n') ||
                             `${allClips.length} clips are on the timeline.`,
                };
            }

            // ── Virtual multicam — "interview close shots / cut between speakers" ─
            // Uses diarization data already stored in the timeline (captions/words
            // with speaker labels) to assign crop regions to each existing clip.
            // No new clips are created — each clip gets a `virtualCam` metadata field:
            //   { angle, cropX, cropY, cropW, cropH }
            // PlaybackEngine reads virtualCam at render time and applies UV crop.
            //
            // Requirements:
            //   • At least 1 clip on the video track
            //   • store.captions must contain words with .speaker fields (from diarize)
            case 'virtual_multicam': {
                const vmStore = useTimelineStore.getState();

                // ── Collect clips from ALL video tracks ───────────────────────
                // After split-speakers there are 2 video tracks (one per speaker).
                // We tag clips from every video track so none are missed.
                const vmVideoTracks = (vmStore.tracks ?? []).filter(t => t.type === 'video');
                // Flatten, keeping track id per clip so updateClip targets the right track
                const vmAllClips = vmVideoTracks.flatMap(t =>
                    (t.clips ?? []).map(c => ({ ...c, _trackId: t.id }))
                );

                // NOTE: word sourcing now happens PER ASSET in
                // _getDiarizationForAsset() — speakerMap for the asset
                // split_speakers ran on, a queued diarize job for the others.
                // The old single-source block that lived here only ever produced
                // words for ONE file, which is why clips from other uploads went
                // untagged. Its timeline→source caption remap is preserved there
                // for the primary asset via the speakerMap path (always source
                // space), so no remap is needed here anymore.

                if (vmAllClips.length === 0) {
                    throw new Error('No clips on the timeline. Add your interview video first.');
                }

                // Speaker COUNT is resolved per asset below — a single speaker is
                // fine, the backend switches that asset to SOLO mode (centered
                // wide/mid/close) instead of the 2-person left/right crops.
                console.log(
                    `[virtual_multicam] ${vmAllClips.length} clips across ${vmVideoTracks.length} track(s)`
                );

                // Send the GCS server-side path so the backend can extract frames
                // for face-anchor detection (detectSceneLayout — GPT-4o-mini Vision).
                const vmUploadedPath = vmStore.uploadedFilePath || null;

                // Speaker roles from identify-speakers (stored in speakerMap after
                // split_speakers) — lets the backend make the interviewer the host
                // instead of assuming diarization label order.
                const vmRoles = {};
                for (const [spk, info] of Object.entries(vmStore.speakerMap || {})) {
                    if (info?.role) vmRoles[spk] = info.role;
                }

                // ── Per-asset analysis ────────────────────────────────────────
                // Diarization and the camera-angle plan are BOTH per-source-file:
                // their timestamps only mean anything within the file they came
                // from. A timeline assembled from several uploads therefore needs
                // one analysis per asset, and each clip must be tagged from its
                // OWN asset's segments — otherwise one video's speaker turns get
                // painted onto another's footage.
                const vmBasename     = p => (p || '').split(/[\\/]/).pop();
                const vmUploadedBase = vmBasename(vmStore.uploadedFilePath || '');
                const vmStrippedBase = vmUploadedBase.replace(/^\d+-/, '');
                const vmAssetIds     = [...new Set(vmAllClips.map(c => c.assetId).filter(Boolean))];

                // Which asset did split_speakers/captions already run on? Its
                // diarization is free to reuse; the others must be queued.
                const vmPrimaryAssetId = (() => {
                    if (!vmUploadedBase) return vmAssetIds[0] ?? null;
                    const match = (vmStore.assets || []).find(a => {
                        const an = vmBasename(a.name || '');
                        if (!an) return false;
                        return an === vmUploadedBase
                            || an.replace(/^\d+-/, '') === vmStrippedBase
                            || vmUploadedBase.endsWith(an);
                    });
                    return match?.id ?? (vmAssetIds.length === 1 ? vmAssetIds[0] : null);
                })();

                if (vmAssetIds.length === 0) {
                    return { action, success: false, message: 'Timeline clips have no linked media — re-add your video and try again.' };
                }
                if (vmAssetIds.length > 1) {
                    console.log(`[virtual_multicam] ${vmAssetIds.length} assets on the timeline — analysing each separately`);
                }

                // assetId → { segments, mode, hostSide, host, guest }
                const vmAnalysisByAsset = {};
                const vmFailedAssets    = [];

                for (const assetId of vmAssetIds) {
                    const assetObj  = (vmStore.assets || []).find(a => a.id === assetId);
                    const assetName = assetObj?.name || assetId;

                    // Reuse a cached analysis from a prior `detect_scene` run. This is
                    // what makes `apply_angle` an instant, re-runnable step instead of
                    // repeating diarization + Vision every time (R23).
                    const cachedScene = vmStore.sceneAnalysisByAsset?.[assetId];
                    if (cachedScene?.segments?.length && !args.forceReanalyze) {
                        vmAnalysisByAsset[assetId] = cachedScene;
                        console.log(`[virtual_multicam] "${assetName}": reusing cached scene analysis (${cachedScene.segments.length} segments)`);
                        continue;
                    }

                    let diar = null;
                    try {
                        diar = await this._getDiarizationForAsset(assetId, {
                            isPrimary: assetId === vmPrimaryAssetId,
                            signal:    job?.signal ?? null,
                        });
                    } catch (diarErr) {
                        console.warn(`[virtual_multicam] diarization failed for "${assetName}":`, diarErr.message);
                    }
                    if (!diar?.words?.length) {
                        vmFailedAssets.push({ name: assetName, reason: 'no speaker data' });
                        continue;
                    }

                    // Roles only apply to the asset split_speakers ran on.
                    const rolesForAsset = assetId === vmPrimaryAssetId ? vmRoles : {};
                    const filenameForAsset = assetId === vmPrimaryAssetId
                        ? (vmUploadedPath || resolveAssetServerPath(assetObj))
                        : resolveAssetServerPath(assetObj);

                    const res = await authFetch('/api/interview/virtual-multicam', {
                        method: 'POST',
                        body:   JSON.stringify({
                            words:    diar.words,
                            speakers: diar.speakers,
                            roles:    rolesForAsset,
                            frames:   [],
                            filename: filenameForAsset,  // per-asset path for Vision frame extraction
                        }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                        console.warn(`[virtual_multicam] analysis failed for "${assetName}": ${data.error || res.status}`);
                        vmFailedAssets.push({ name: assetName, reason: data.error || `HTTP ${res.status}` });
                        continue;
                    }
                    if (!data.segments?.length) {
                        vmFailedAssets.push({ name: assetName, reason: 'no segments returned' });
                        continue;
                    }
                    vmAnalysisByAsset[assetId] = data;
                    // Cache so a later apply_angle / re-run is instant
                    useTimelineStore.getState().setSceneAnalysis?.(assetId, data);
                    console.log(`[virtual_multicam] "${assetName}": ${data.segments.length} segments (${data.mode || 'duo'} mode)`);
                }

                if (Object.keys(vmAnalysisByAsset).length === 0) {
                    return {
                        action,
                        success: false,
                        message:
                            `Multicam couldn't analyse any of your clips.\n\n` +
                            vmFailedAssets.map(f => `• ${f.name}: ${f.reason}`).join('\n') +
                            `\n\nSpeaker detection needs the video's audio on the server — if you just uploaded, ` +
                            `wait for processing to finish and try again.`,
                    };
                }

                // Headline numbers come from the primary asset (or the first analysed one)
                const vmHeadline = vmAnalysisByAsset[vmPrimaryAssetId] || Object.values(vmAnalysisByAsset)[0];
                const { hostSide, host, guest } = vmHeadline;
                const vmMode = vmHeadline.mode || 'duo';
                const vmTotalSegments = Object.values(vmAnalysisByAsset)
                    .reduce((n, d) => n + (d.segments?.length || 0), 0);

                // ── Build new track structure: split long clips + tag each piece ─────
                //
                // Problem with "greatest overlap" approach on raw (un-split) files:
                //   A whole 5-min clip overlaps with ALL ~200 segments; the one with
                //   the biggest single duration "wins" → all clips get the same angle.
                //
                // Fix: when a clip spans multiple diarization segments, SPLIT it at
                // segment boundaries and tag each piece individually. This produces
                // the same 100–200 short tagged clips that we get after silence
                // removal, but works even when the files haven't been pre-chopped.
                //
                // This path also handles the pre-chopped case (1 segment per clip)
                // transparently — the split branch is never entered.
                const freshStore = useTimelineStore.getState();
                const tm         = freshStore.manager;

                // Angle counters — dynamic: duo mode returns speakerA/speakerB/
                // reactionA/reactionB, solo mode returns mid/close. A fixed key
                // set would silently drop solo angles from the count.
                const angleCounts = {};
                const countAngle  = (a) => { if (a) angleCounts[a] = (angleCounts[a] || 0) + 1; };
                let droppedZoomKfCount = 0; // clips whose stale zoom-rhythm keyframes had to be cleared (see split branch below)

                freshStore._saveHistory?.();

                // Per-asset segment lookup, each pre-sorted by source time.
                const sortedSegsByAsset = {};
                for (const [aid, data] of Object.entries(vmAnalysisByAsset)) {
                    sortedSegsByAsset[aid] = [...data.segments].sort((a, b) => a.start - b.start);
                }

                let vmSplitPieces = 0;   // clips that were split into ≥2 angle pieces
                let vmNoOverlap   = 0;   // clips no segment matched (left untouched)
                let vmOtherAsset  = 0;   // clips whose asset had no usable analysis

                const newTracks = freshStore.tracks.map(track => {
                    if (track.type !== 'video') return track;

                    const expandedClips = [];

                    for (const clip of (track.clips ?? [])) {
                        // Use the segments computed for THIS clip's own asset. A
                        // clip whose asset couldn't be analysed is left untouched
                        // rather than tagged with another video's speaker turns.
                        const clipSegs = sortedSegsByAsset[clip.assetId]
                            || (vmAssetIds.length === 1 ? Object.values(sortedSegsByAsset)[0] : null);
                        if (!clipSegs) {
                            vmOtherAsset++;
                            expandedClips.push(clip);
                            continue;
                        }

                        const srcStart = clip.offset ?? 0;
                        const srcEnd   = srcStart + (clip.duration ?? 0);

                        // Segments that overlap this clip's source range
                        const overlapping = clipSegs.filter(s => s.end > srcStart && s.start < srcEnd);

                        if (overlapping.length === 0) {
                            vmNoOverlap++;
                            expandedClips.push(clip);
                            continue;
                        }

                        if (overlapping.length === 1) {
                            // Single segment — tag in-place, no split needed
                            const seg = overlapping[0];
                            countAngle(seg.angle);
                            expandedClips.push({
                                ...clip,
                                virtualCam: {
                                    angle:   seg.angle,
                                    scale:   seg.scale  ?? 1,
                                    x:       seg.x      ?? 0,
                                    y:       seg.y      ?? 0,
                                    cropX:   seg.cropX,
                                    cropY:   seg.cropY,
                                    cropW:   seg.cropW,
                                    cropH:   seg.cropH,
                                    speaker: seg.speaker || null,
                                },
                            });
                            continue;
                        }

                        // Multiple segments — split the clip at diarization boundaries.
                        // Pieces are laid out INSIDE the original clip's timeline span
                        // (see the `pieceCursor` below): their durations sum to the
                        // original duration, so the surrounding timeline is untouched.
                        vmSplitPieces++;
                        let pieceCursor = clip.start ?? 0;
                        for (const seg of overlapping) {
                            const pSrcStart = Math.max(seg.start, srcStart);
                            const pSrcEnd   = Math.min(seg.end,   srcEnd);
                            const pDur      = pSrcEnd - pSrcStart;
                            if (pDur < 0.05) continue; // skip hairline slivers

                            countAngle(seg.angle);
                            const pieceStart = pieceCursor;
                            pieceCursor += pDur;
                            expandedClips.push({
                                ...clip,
                                // Millisecond-resolution id: Math.round(x*10) collided
                                // for segments starting <0.1s apart, and duplicate ids
                                // overwrite each other when the entity graph is rebuilt.
                                id:       `${clip.id}_vm${Math.round(pSrcStart * 1000)}`,
                                offset:   pSrcStart,
                                duration: pDur,
                                start:    pieceStart,
                                end:      pieceStart + pDur,
                                // Any existing zoom-rhythm keyframes were authored against
                                // clip's OLD (longer) duration — their timestamps no longer
                                // correspond to anything meaningful on this new, shorter
                                // fragment. Drop them rather than silently apply a stale/
                                // wrong zoom; re-run "make it dynamic" after multicam to
                                // regenerate a rhythm that matches the new segments.
                                keyframes: (() => {
                                    if (clip.keyframes?.scale?.length) droppedZoomKfCount++;
                                    return clip.keyframes ? { ...clip.keyframes, scale: [] } : clip.keyframes;
                                })(),
                                virtualCam: {
                                    angle:   seg.angle,
                                    scale:   seg.scale  ?? 1,
                                    x:       seg.x      ?? 0,
                                    y:       seg.y      ?? 0,
                                    cropX:   seg.cropX,
                                    cropY:   seg.cropY,
                                    cropW:   seg.cropW,
                                    cropH:   seg.cropH,
                                    speaker: seg.speaker || null,
                                },
                            });
                        }
                    }

                    // Each clip's pieces were already laid out inside that clip's own
                    // timeline span above, so track positions are preserved as-is.
                    //
                    // This REPLACED a global "pack every clip from cursor=0" re-layout,
                    // which was destructive after split_speakers: with one video track
                    // per speaker, packing each track independently from 0 stacked both
                    // tracks on top of each other at t=0. VideoPlayer picks the FIRST
                    // matching clip across video tracks, so the second speaker's angles
                    // became unreachable and the timeline duration collapsed — the
                    // "multicam isn't applying" symptom.
                    return {
                        ...track,
                        clips: [...expandedClips].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)).map(c => {
                            const start = c.start ?? 0;
                            return { ...c, start, end: start + (c.duration ?? 0) };
                        }),
                    };
                });

                // Rebuild timeline entity graph from new track structure and sync to React
                tm.fromLegacyTracks(newTracks);
                useTimelineStore.setState({ tracks: tm.toLegacyTracks() });

                const totalTagged = Object.values(angleCounts).reduce((s, n) => s + n, 0);
                console.log(
                    `[virtual_multicam] Applied to ${totalTagged} clips (split from ${vmAllClips.length}) ` +
                    `[${vmMode}]: ${JSON.stringify(angleCounts)} | host=${host} on ${hostSide} | ` +
                    `assets=${Object.keys(vmAnalysisByAsset).length}/${vmAssetIds.length}, ` +
                    `segments=${vmTotalSegments}, splitClips=${vmSplitPieces}, ` +
                    `noOverlap=${vmNoOverlap}, otherAsset=${vmOtherAsset}`
                );

                // ── Honest outcome reporting ──────────────────────────────────
                // These two states used to return a cheerful success message while
                // the video looked completely unchanged, which is what "it's not
                // applying" felt like from the outside. Report them as failures
                // with the actual diagnostic instead.
                if (totalTagged === 0) {
                    return {
                        action,
                        success: false,
                        message:
                            `Multicam couldn't match any camera angles to your clips.\n\n` +
                            `The analysis returned ${vmTotalSegments} speaker segment(s), but none lined up with ` +
                            `the ${vmAllClips.length} clip(s) on the timeline (their source ranges don't overlap). ` +
                            `This usually means the transcript and the clips are out of sync — try re-running ` +
                            `"add captions" on the current timeline, then "interview angles" again.`,
                    };
                }

                const nonWideCount = totalTagged - (angleCounts.wide || 0);
                if (nonWideCount === 0) {
                    return {
                        action,
                        success: false,
                        message:
                            `Multicam ran but every shot came back wide — no close-ups were created.\n\n` +
                            `${vmTotalSegments} segment(s) across ${vmAssetIds.length} video(s) were analysed in ` +
                            `${vmMode} mode. This happens when the speaking turns are too short to hold a close-up, ` +
                            `or when face detection couldn't locate the speakers. Check that the video shows the ` +
                            `speakers on camera, and that the transcript covers the whole conversation.`,
                    };
                }

                // Seek to the first non-wide clip so the user immediately sees a close-up.
                // The VideoPlayer main effect fires when `tracks` changes above — it calls
                // setCrop() before renderOnce()+seek() — so crop uniforms are always set
                // before the new frame arrives. We just need to position the playhead there.
                const allNewClips = newTracks
                    .filter(t => t.type === 'video')
                    .flatMap(t => t.clips ?? []);
                const firstCloseUp = allNewClips.find(c =>
                    c.virtualCam && c.virtualCam.angle && c.virtualCam.angle !== 'wide'
                );
                if (firstCloseUp) {
                    // Small offset into the clip avoids boundary edge cases
                    const previewTime = firstCloseUp.start + Math.min(0.5, firstCloseUp.duration * 0.3);
                    useTimelineStore.getState().seek(previewTime);
                    console.log(`[virtual_multicam] Seeking to first close-up at t=${previewTime.toFixed(2)} (clip: ${firstCloseUp.virtualCam.angle})`);
                }

                const wideN  = angleCounts.wide || 0;
                const closeN = (angleCounts.speakerA || 0) + (angleCounts.speakerB || 0) + (angleCounts.close || 0);
                const midN   = angleCounts.mid || 0;
                const rxTotal = (angleCounts.reactionA || 0) + (angleCounts.reactionB || 0);

                const vmSummary = vmMode === 'solo'
                    ? `${wideN} wide  ·  ${midN} mid  ·  ${closeN} close-ups\n\n` +
                      `Single speaker detected — simulated 3-camera edit (wide/mid/close on the same subject). `
                    : `${wideN} wide  ·  ${closeN} close-ups  ·  ${rxTotal} reaction shots\n\n` +
                      `Host (${host}) detected on the ${hostSide}. `;

                const droppedZoomNote = droppedZoomKfCount > 0
                    ? `\n\nNote: ${droppedZoomKfCount} clip(s) had an existing zoom rhythm that no longer matched the new camera cuts, so it was cleared — run "make it more dynamic" again to re-add it on top of these angles.`
                    : '';

                // Multi-upload timelines: report what was analysed and what wasn't.
                const analysedCount = Object.keys(vmAnalysisByAsset).length;
                const multiAssetNote = vmAssetIds.length > 1
                    ? `\n\nAnalysed ${analysedCount} of ${vmAssetIds.length} videos on the timeline — each got its own speaker detection and camera plan.`
                    : '';
                const otherAssetNote = vmFailedAssets.length > 0
                    ? `\n\nSkipped (left untouched): ` +
                      vmFailedAssets.map(f => `${f.name} (${f.reason})`).join(', ') + '.'
                    : '';

                return {
                    action,
                    success: true,
                    message:
                        `Virtual multicam applied — ${totalTagged} angle-tagged segments.\n\n` +
                        vmSummary +
                        `Jumped to the first close-up — scrub the timeline to review all angle cuts.` +
                        multiAssetNote + droppedZoomNote + otherAssetNote,
                };
            }

            // ── Atomic stage 1: detect speakers ──────────────────────────────
            // Diarization ONLY. Touches no clips, so it's safe to run at any
            // point and re-run freely. Previously this was buried inside
            // split_speakers (which also rebuilt the whole video track) and
            // inside virtual_multicam — you couldn't ask "who's talking?"
            // without also restructuring your timeline.
            case 'detect_speakers': {
                const dsStore  = useTimelineStore.getState();
                const dsClips  = (dsStore.tracks || []).filter(t => t.type === 'video')
                                    .flatMap(t => t.clips || []);
                const dsAssets = [...new Set(dsClips.map(c => c.assetId).filter(Boolean))];
                if (dsAssets.length === 0) {
                    return { action, success: false, message: 'No video clips on the timeline to analyse.' };
                }

                const done = [], failed = [];
                for (const assetId of dsAssets) {
                    const name = (dsStore.assets || []).find(a => a.id === assetId)?.name || assetId;
                    try {
                        const diar = await this._getDiarizationForAsset(assetId, {
                            isPrimary: assetId === dsAssets[0],
                            signal: job?.signal ?? null,
                        });
                        if (diar?.speakers?.length) done.push({ name, speakers: diar.speakers.length, words: diar.words.length });
                        else failed.push(name);
                    } catch (e) {
                        console.warn(`[detect_speakers] "${name}" failed:`, e.message);
                        failed.push(name);
                    }
                }

                if (done.length === 0) {
                    return {
                        action, success: false,
                        message: `Couldn't detect speakers on ${failed.join(', ')}.\n\nSpeaker detection needs the audio on the server — if you just uploaded, wait for processing to finish.`,
                    };
                }
                const total = done.reduce((n, d) => n + d.speakers, 0);
                return {
                    action, success: true,
                    message:
                        `Analysed ${done.length} video(s):\n` +
                        done.map(d => `  • ${d.name} — ${d.speakers} speaker(s), ${d.words} words`).join('\n') +
                        (failed.length ? `\n\nCouldn't analyse: ${failed.join(', ')}` : '') +
                        `\n\nNothing on your timeline changed. Next: "analyse the shot" or "apply camera angles".`,
                };
            }

            // ── Atomic stage 2: analyse framing ──────────────────────────────
            // Vision pass + angle PLAN, cached per asset. Still touches no clips —
            // it answers "what would the angles be?" so the plan can be inspected
            // (and reused) before anything is applied.
            case 'detect_scene': {
                const scStore  = useTimelineStore.getState();
                const scClips  = (scStore.tracks || []).filter(t => t.type === 'video')
                                    .flatMap(t => t.clips || []);
                const scAssets = [...new Set(scClips.map(c => c.assetId).filter(Boolean))];
                if (scAssets.length === 0) {
                    return { action, success: false, message: 'No video clips on the timeline to analyse.' };
                }

                const analysed = [], skipped = [];
                for (const assetId of scAssets) {
                    const assetObj = (scStore.assets || []).find(a => a.id === assetId);
                    const name = assetObj?.name || assetId;
                    try {
                        const diar = await this._getDiarizationForAsset(assetId, {
                            isPrimary: assetId === scAssets[0],
                            signal: job?.signal ?? null,
                        });
                        if (!diar?.words?.length) { skipped.push(`${name} (no speaker data)`); continue; }

                        const roles = {};
                        for (const [spk, info] of Object.entries(scStore.speakerMap || {})) {
                            if (info?.role) roles[spk] = info.role;
                        }
                        const res = await authFetch('/api/interview/virtual-multicam', {
                            method: 'POST',
                            body: JSON.stringify({
                                words: diar.words, speakers: diar.speakers, roles, frames: [],
                                filename: resolveAssetServerPath(assetObj),
                            }),
                        });
                        const data = await res.json();
                        if (!res.ok || !data.segments?.length) { skipped.push(`${name} (${data.error || 'no plan returned'})`); continue; }

                        useTimelineStore.getState().setSceneAnalysis?.(assetId, data);
                        const counts = {};
                        data.segments.forEach(s => { counts[s.angle] = (counts[s.angle] || 0) + 1; });
                        analysed.push({
                            name,
                            mode: data.mode || 'duo',
                            segments: data.segments.length,
                            counts,
                            layout: data.layout || null,
                            speakers: diar.speakers.length,
                        });
                    } catch (e) {
                        console.warn(`[detect_scene] "${name}" failed:`, e.message);
                        skipped.push(`${name} (${e.message})`);
                    }
                }

                if (analysed.length === 0) {
                    return { action, success: false, message: `Couldn't analyse framing.\n\n${skipped.join('\n')}` };
                }
                // Report what's actually IN the shot, not just how many angles were
                // planned — that's the point of having this as its own command.
                const describe = (a) => {
                    const L = a.layout;
                    const people = L?.onScreenCount;
                    const who = people === 0 ? 'no one visible on camera'
                              : people === 1 ? '1 person on camera'
                              : typeof people === 'number' ? `${people} people on camera`
                              : 'framing not detected';
                    const heard = `${a.speakers} voice${a.speakers === 1 ? '' : 's'} heard`;
                    // The interesting disagreement: more voices than faces = someone off-camera
                    const note = (typeof people === 'number' && people === 1 && a.speakers > 1)
                        ? ' — interviewer is off-camera, so it will frame the visible person'
                        : '';
                    const shots = Object.entries(a.counts).map(([k, v]) => `${v} ${k}`).join(', ');
                    return `  • ${a.name}\n      ${who}, ${heard}${note}\n      Plan: ${a.mode} mode, ${a.segments} shots (${shots})`;
                };

                return {
                    action, success: true,
                    message:
                        `Here's what's in the shot — nothing applied yet:\n\n` +
                        analysed.map(describe).join('\n\n') +
                        (skipped.length ? `\n\nSkipped: ${skipped.join(', ')}` : '') +
                        `\n\nRun "apply camera angles" to use this plan, or re-shoot the analysis after editing.`,
                };
            }

            // ── Atomic spatial crop ──────────────────────────────────────────
            // The command that didn't exist: "crop the parts where speaker 00 is
            // speaking to 200%". Because nothing could express it, the parser fell
            // through to the nearest keyword match and ran silence removal. This
            // does ONE thing — set clip.virtualCam — so it composes with angles,
            // rhythm zoom and cleanup instead of bundling them (R16 composition
            // rules still apply: preview and both export paths read virtualCam).
            case 'crop_clip': {
                const ccStore  = useTimelineStore.getState();
                const ccTracks = (ccStore.tracks || []).filter(t => t.type === 'video');
                const ccClips  = ccTracks.flatMap(t => (t.clips || []).map(c => ({ ...c, _trackId: t.id })));
                if (ccClips.length === 0) {
                    return { action, success: false, message: 'No clips on the timeline to crop.' };
                }

                // amount: 2.0 = 200% = punch in 2×. Clamp to something renderable.
                const amount = Math.max(1.0, Math.min(4.0, Number(args.amount) || 1.5));
                if (amount <= 1.001) {
                    return { action, success: false, message: 'That crop amount is 100% — nothing would change. Try "crop to 150%".' };
                }

                // Optional speaker filter — only crop clips where this speaker talks.
                const wantSpeaker = args.speaker ? String(args.speaker).toLowerCase() : null;
                const normSpk = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const wantNorm = wantSpeaker ? normSpk(wantSpeaker) : null;

                // Resolve which clips the speaker is talking over, using the same
                // per-asset diarization the multicam path uses.
                let speakerRanges = [];
                if (wantNorm) {
                    const diar = ccStore.diarizationByAsset || {};
                    const spWords = Object.entries(ccStore.speakerMap || {})
                        .flatMap(([spk, info]) => (info?.words || []).map(w => ({ ...w, speaker: w.speaker || spk })));
                    const allWords = spWords.length
                        ? spWords
                        : Object.values(diar).flatMap(d => d?.words || []);
                    speakerRanges = allWords
                        .filter(w => normSpk(w.speaker).includes(wantNorm) || wantNorm.includes(normSpk(w.speaker)))
                        .map(w => ({ start: w.start, end: w.end }));
                    if (speakerRanges.length === 0) {
                        return {
                            action, success: false,
                            message: `I couldn't find "${args.speaker}" in the speaker data.\n\nRun "detect speakers" first, then try again.`,
                        };
                    }
                }

                const overlapsSpeaker = (clip) => {
                    if (!wantNorm) return true;
                    const s = clip.offset ?? 0, e = s + (clip.duration ?? 0);
                    return speakerRanges.some(r => r.end > s && r.start < e);
                };

                // Centre the crop on the detected face when we have one, else frame centre.
                const anchors = Object.values(ccStore.diarizationByAsset || {})
                    .map(d => d?.anchor).filter(Boolean);
                const cx = anchors.length ? anchors.reduce((a, x) => a + x.cx, 0) / anchors.length : 0.5;
                const cy = anchors.length ? anchors.reduce((a, x) => a + x.cy, 0) / anchors.length : 0.42;

                const w = 1 / amount, h = 1 / amount;
                const crop = {
                    cropX: Math.max(0, Math.min(1 - w, cx - w / 2)),
                    cropY: Math.max(0, Math.min(1 - h, cy - h / 2)),
                    cropW: w,
                    cropH: h,
                };

                ccStore._saveHistory?.();
                let cropped = 0;
                for (const clip of ccClips) {
                    if (!overlapsSpeaker(clip)) continue;
                    ccStore.updateClip(clip._trackId, clip.id, {
                        virtualCam: { angle: 'custom', scale: amount, x: cx - 0.5, y: cy - 0.5, ...crop, speaker: args.speaker || null },
                    });
                    cropped++;
                }

                if (cropped === 0) {
                    return { action, success: false, message: `No clips matched${args.speaker ? ` speaker "${args.speaker}"` : ''} — nothing was cropped.` };
                }
                return {
                    action, success: true,
                    message: `Cropped ${cropped} clip(s) to ${Math.round(amount * 100)}%` +
                             `${args.speaker ? ` where ${args.speaker} is speaking` : ''}.`,
                };
            }

            // ── Atomic stage 4: apply the angles ─────────────────────────────
            // Pure application. Delegates to the virtual_multicam tagging path,
            // which now prefers the cached plan from detect_scene — so running
            // these as separate steps costs nothing extra, and re-running this
            // one is instant. Kept as a thin delegation rather than a copy so
            // the split/layout rules (R14/R18) live in exactly one place.
            case 'apply_angle':
                return this.executeStoreAction({ ...command, action: 'virtual_multicam' }, job);

            case 'reset_crop': {
                const rcStore = useTimelineStore.getState();
                const rcTracks = (rcStore.tracks || []).filter(t => t.type === 'video');
                let cleared = 0;
                rcStore._saveHistory?.();
                for (const t of rcTracks) {
                    for (const c of (t.clips || [])) {
                        if (c.virtualCam) { rcStore.updateClip(t.id, c.id, { virtualCam: null }); cleared++; }
                    }
                }
                return {
                    action, success: cleared > 0,
                    message: cleared > 0 ? `Framing reset on ${cleared} clip(s).` : 'No crops to reset.',
                };
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
                let serverPath = store.uploadedFilePath;
                
                // Fallback for page reloads where store.uploadedFilePath was lost
                if (!serverPath && store.assets) {
                    const videoAsset = store.assets.find(a => a.type === 'video');
                    if (videoAsset) {
                        const toGcsRawPath = (url) => {
                            if (!url) return null;
                            if (url.startsWith('raw/') || url.startsWith('temp/')) return url;
                            const m = url.match(/\/(raw\/[^?#]+)/);
                            if (m) return m[1];
                            const p = url.match(/\/api\/proxy\/gcs-media\/proxies\/([^/]+)\/([^/]+)/);
                            if (p) return `raw/${p[1]}/${p[2]}`;
                            return null;
                        };
                        serverPath = toGcsRawPath(videoAsset.sourceUrl) || toGcsRawPath(videoAsset.proxyUrl);
                    }
                }

                resolvedPayload[key] = serverPath || store.uploadedFile?.name || 'video.mp4';
                console.log(`[MediaExecutionEngine] Resolved $uploaded_file → "${resolvedPayload[key]}"`);
            }
        }

        // Guard: if $uploaded_file couldn't resolve to a real GCS path, the
        // server can't locate the file. Surface a clear error now rather than
        // sending a request that will fail with a cryptic 400/502.
        if (endpoint === '/api/audio/filler/detect' || endpoint === '/api/silence/detect') {
            const resolvedFilename = resolvedPayload.filename || '';
            const looksUnresolved = resolvedFilename === 'video.mp4' ||
                (!resolvedFilename.startsWith('raw/') && !resolvedFilename.startsWith('temp/') && resolvedFilename !== '');
            if (looksUnresolved) {
                console.warn(`[MediaExecutionEngine] ⚠️  ${endpoint}: filename "${resolvedFilename}" looks unresolved — aborting to avoid server 400`);
                return {
                    engine: 'api',
                    success: false,
                    endpoint,
                    error: `Can't find the source video on the server. Try re-uploading the file — or run "Generate captions" first, which stores the video path needed for filler and silence removal.`,
                };
            }
        }

        // If we already have a Whisper transcript for this file, derive caption
        // timestamps directly from the current timeline clip positions instead of
        // calling Whisper again. This handles both fresh sessions (single clip,
        // timestamps match 1:1) and edited timelines (silence/filler removed,
        // timestamps re-mapped through clip offsets so captions land correctly).
        if (endpoint === '/api/captions/generate') {
            const bname = (p) => (p || '').split(/[\\/]/).pop();
            const processedFile = Object.entries(resolvedPayload).find(([, v]) => typeof v === 'string' && (v.startsWith('raw/') || v.startsWith('temp/')));
            const processedBase = processedFile ? bname(processedFile[1]) : bname(store.uploadedFilePath);

            const originalWords = (store.transcripts && processedBase && store.transcripts[processedBase])
                ? store.transcripts[processedBase]
                : (processedBase && bname(store.captionsFilePath) === processedBase ? store.captions : null)
                ?? (store.captions?.length > 0 ? store.captions : null);

            if (originalWords?.length > 0) {
                // Re-map word timestamps through the current clip positions so captions
                // are in sync with the edited timeline (not the raw source file).
                const timelineWords = deriveTimelineTranscript(store.tracks, originalWords);
                const words = timelineWords || originalWords.map(c => ({ word: c.word || c.content || c.text || '', start: c.start, end: c.end }));
                console.log(`[MediaExecutionEngine] ⚡ autoCaptions: derived ${words.length} words from timeline — skipping Whisper`);

                // Apply captions inline — the normal autoCaptions handler at the bottom
                // of this function is never reached when we return early, so we must
                // call setCaptions and addCaptionClips here before returning.
                if (store.setCaptions) store.setCaptions(words, processedBase || null);
                if (words.length > 0) {
                    const captions = groupWordsIntoCaptions(words);
                    console.log(`[MediaExecutionEngine] 💬 autoCaptions (short-circuit): adding ${captions.length} caption clips`);
                    store.addCaptionClips(captions);
                }

                return { engine: 'api', success: true, endpoint, result: { text: words.map(w => w.word).join(' '), words } };
            }
        }

        // Inject transcript for silence detection and filler-word removal.
        // Look up the transcript that belongs to the SPECIFIC file being processed
        // (resolved from $uploaded_file above) rather than the last globally-stored
        // captions — this ensures multi-clip timelines each get the right words.
        const isTranscriptEndpoint = endpoint === '/api/silence/detect' || endpoint === '/api/audio/filler/detect';
        if (isTranscriptEndpoint) {
            const basename = (p) => (p || '').split(/[\\/]/).pop();
            // Identify the file being processed: prefer the already-resolved filename key,
            // then fall back to uploadedFilePath (single-clip projects).
            const processedFile = Object.entries(resolvedPayload).find(([, v]) => typeof v === 'string' && (v.startsWith('raw/') || v.startsWith('temp/')));
            const processedBase = processedFile ? basename(processedFile[1]) : basename(store.uploadedFilePath);

            // Look up per-file transcript map first, fall back to legacy captions for older sessions
            const clipWords = (store.transcripts && processedBase && store.transcripts[processedBase])
                ? store.transcripts[processedBase]
                : (basename(store.captionsFilePath) === processedBase ? store.captions : null);

            if (clipWords && clipWords.length > 0) {
                const lastWordEnd  = clipWords[clipWords.length - 1]?.end ?? 0;
                // Find the clip being processed to determine coverage
                const videoTrack   = store.tracks?.find(t => t.type === 'video');
                const matchedClip  = videoTrack?.clips?.find(c => {
                    const assetName = store.assets?.find(a => a.id === c.assetId)?.name || '';
                    return basename(assetName) === processedBase || basename(c.name || '') === processedBase;
                });
                const clipDuration = matchedClip?.duration ?? videoTrack?.clips?.[0]?.duration ?? 0;
                const coverageOk   = clipDuration <= 0 || lastWordEnd >= clipDuration * 0.30;

                if (coverageOk) {
                    resolvedPayload.transcript = clipWords.map(c => ({
                        start: c.start,
                        end:   c.end,
                        word:  c.word || c.content || c.text || ''
                    }));
                    console.log(`[MediaExecutionEngine] Injected transcript for "${processedBase}" (${resolvedPayload.transcript.length} words, coverage ${lastWordEnd.toFixed(1)}s/${clipDuration.toFixed(1)}s) into ${endpoint}`);
                } else {
                    console.warn(`[MediaExecutionEngine] Transcript for "${processedBase}" covers only ${((lastWordEnd / clipDuration) * 100).toFixed(0)}% — using FFmpeg fallback`);
                }
            } else {
                console.warn(`[MediaExecutionEngine] No transcript found for "${processedBase}" — using FFmpeg fallback`);
            }

            // Pass micro-padding config through to the worker
            if (!resolvedPayload.padding_ms) resolvedPayload.padding_ms = 100;
        }

        // Inject word list + duration for repeated-take detection.
        // The backend expects { words: [{word, start, end}], totalDuration } rather
        // than a filename — it operates on the pre-existing transcript, not the audio file.
        if (endpoint === '/api/ai/detect-repeated-takes') {
            const allWords = store.captions?.length > 0
                ? store.captions
                : Object.values(store.transcripts || {}).flat();

            if (allWords?.length > 0) {
                resolvedPayload.words = allWords.map(w => ({
                    word:  w.word || w.content || w.text || '',
                    start: w.start,
                    end:   w.end,
                }));
                resolvedPayload.totalDuration = allWords[allWords.length - 1]?.end || 0;
                // Remove filename field — endpoint doesn't use it
                delete resolvedPayload.filename;
                console.log(`[MediaExecutionEngine] Injected ${resolvedPayload.words.length} words for detect-repeated-takes`);
            } else {
                console.warn('[MediaExecutionEngine] detect-repeated-takes: no transcript in store — endpoint will return no cuts');
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
                    if (response.status === 402 || errorBody.error === 'AI_OPS_LIMIT') {
                        // Quota exhausted — surface a user-friendly upgrade message
                        const msg = errorBody.message || "You've used all your AI operations this month.";
                        const upgrade = errorBody.upgradeRequired ? ` Upgrade to ${errorBody.upgradeRequired} to continue.` : '';
                        throw new Error(`${msg}${upgrade}`);
                    }
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
                const fillerClipId  = command.args?.clip_id  || null;
                const fillerAssetId = command.args?.asset_id || null;

                // Same editorial + frame-check refinement silence-removal gets
                // (R17 / R25) — filler cleanup used to apply the backend's cut
                // spans raw, with no transcript-aware pause reprieve and no
                // on-screen check at the resulting cut points.
                let fillerSegments = result.activeSegments;
                if (fillerSegments.length > 1) {
                    const fillerWords = result.words?.length > 0 ? result.words : (useTimelineStore.getState().captions || []);
                    fillerSegments = await this._refineCutsWithIntelligence(fillerSegments, fillerWords);
                    fillerSegments = await this._refineCutPointFrames(fillerSegments, resolvedPayload?.filename || null);
                }

                this._applySegmentsToTimeline(fillerSegments, 'filler', fillerClipId, fillerAssetId);

                // Re-derive timeline transcript — keep original in transcripts index,
                // push derived words to store.captions via setTimelineTranscript.
                const fillerPostStore = useTimelineStore.getState();
                const fillerBase  = (resolvedPayload?.filename || '').split(/[\\/]/).pop();
                const fillerOrig  = (fillerBase && fillerPostStore.transcripts?.[fillerBase])
                    ? fillerPostStore.transcripts[fillerBase] : null;
                if (fillerOrig?.length > 0) {
                    const tlWords = deriveTimelineTranscript(fillerPostStore.tracks, fillerOrig);
                    if (tlWords && fillerPostStore.setTimelineTranscript) fillerPostStore.setTimelineTranscript(tlWords);
                }
            }

            // ── 5. Audio denoise / normalize ──────────────────────────────
            if ((command.action === 'audioDenoise' || command.action === 'audioNormalize') && result?.url) {
                const timelineStore = useTimelineStore.getState();
                const videoTrack    = timelineStore.tracks?.find(t => t.type === 'video');
                const assetId       = videoTrack?.clips?.[0]?.assetId;
                if (assetId) {
                    // Update the asset so future clip additions use the processed URL
                    timelineStore.updateAsset(assetId, { proxyUrl: result.url });
                    // Backfill ALL clips that reference this asset so the player
                    // immediately reloads from the processed file (not the original).
                    (videoTrack?.clips || []).forEach(clip => {
                        if (clip.assetId === assetId) {
                            timelineStore.updateClip(videoTrack.id, clip.id, { url: result.url }, { skipHistory: true });
                        }
                    });
                    console.log(`[MediaExecutionEngine] ✅ Asset and ${videoTrack?.clips?.length ?? 0} clip(s) updated with processed audio`);
                } else {
                    console.warn('[MediaExecutionEngine] No assetId found on first clip — cannot update proxy URL');
                }
            }

            // ── 6. Repeated-takes detection ───────────────────────────────
            if (command.action === 'detectRepeatedTakes' && result?.activeSegments?.length > 0) {
                console.log(`[MediaExecutionEngine] ✂️  detectRepeatedTakes: ${result.activeSegments.length} segments`);
                this._applySegmentsToTimeline(result.activeSegments, 'take');
            }

            // ── 7. Auto captions ─────────────────────────────────────────
            if (command.action === 'autoCaptions') {
                const wordCount = result?.words?.length ?? 0;
                console.log(`[MediaExecutionEngine] autoCaptions result: ${wordCount} words, text="${(result?.text || '').slice(0, 60)}"`);

                const store = useTimelineStore.getState();
                // Store with filename so subsequent caption requests short-circuit via transcripts map
                const captionFilename = resolvedPayload?.filename || null;
                if (store.setCaptions) store.setCaptions(result.words || [], captionFilename);
                
                if (wordCount > 0) {
                    // Re-map Whisper's source-file timestamps through the current clip offsets
                    // so captions land on the correct timeline positions after any trimming or
                    // silence removal. Same remapping the short-circuit path already applies.
                    const timelineWords = deriveTimelineTranscript(store.tracks, result.words);
                    const words = timelineWords || result.words;
                    const captions = groupWordsIntoCaptions(words);
                    console.log(`[MediaExecutionEngine] 💬 autoCaptions: adding ${captions.length} caption clips`);
                    store.addCaptionClips(captions);
                } else {
                    console.warn('[MediaExecutionEngine] ⚠️ autoCaptions: no word timestamps returned — captions cannot be placed');
                }
            }

            // ── 8. Silence detection ──────────────────────────────────────
            if (command.action === 'silenceDetect') {
                // Cache the transcript so future caption requests can reuse it without Whisper
                if (result?.words?.length > 0) {
                    const silenceFilename = resolvedPayload?.filename || null;
                    const silenceStore = useTimelineStore.getState();
                    if (silenceStore.setCaptions) silenceStore.setCaptions(result.words, silenceFilename);
                }

                let activeSegments = result.activeSegments;

                // Fallback: derive from word timestamps if backend sent words[]
                // Defaults raised from 0.5/0.1 — ASR word timestamps routinely
                // clip trailing phonemes, so 100ms padding literally cut word
                // endings, and a 0.5s threshold treated ordinary speech cadence
                // as removable silence ("too rough and aggressive").
                if (!activeSegments && result.words?.length > 0) {
                    const p        = (command.args || {}).payload || {};
                    const minSil   = parseFloat(p.min_duration) || 0.8;
                    const pad      = parseFloat(p.padding)      || 0.2;
                    activeSegments = buildActiveSegmentsFromWords(result.words, minSil, pad);
                    console.log(`[MediaExecutionEngine] Derived ${activeSegments.length} segments from ${result.words.length} words`);
                }

                // Editorial pass: reprieve pauses that carry meaning (thinking
                // before an answer, dramatic beat) instead of cutting every gap.
                if (activeSegments?.length > 1) {
                    const refineWords = result.words?.length > 0 ? result.words : (useTimelineStore.getState().captions || []);
                    activeSegments = await this._refineCutsWithIntelligence(activeSegments, refineWords);
                    activeSegments = await this._refineCutPointFrames(activeSegments, resolvedPayload?.filename || null);
                }

                if (!activeSegments || activeSegments.length === 0) {
                    console.warn('[MediaExecutionEngine] ⚠️  silenceDetect returned no activeSegments — nothing to cut');
                } else {
                    console.log(`[MediaExecutionEngine] ✂️  silenceDetect: applying ${activeSegments.length} segments`);
                    const clipId  = command.args?.clip_id  || null;
                    const assetId = command.args?.asset_id || null;
                    this._applySegmentsToTimeline(activeSegments, 'silence', clipId, assetId);

                    // Store original Whisper words indexed by filename (offset-based filtering
                    // in smartCleanup depends on source timestamps being preserved here).
                    // Then store the timeline-derived version in store.captions only.
                    const postStore = useTimelineStore.getState();
                    const srcWords  = result?.words?.length > 0 ? result.words : null;
                    if (srcWords?.length > 0) {
                        postStore.setCaptions(srcWords, resolvedPayload?.filename || null);
                        const tlWords = deriveTimelineTranscript(postStore.tracks, srcWords);
                        if (tlWords && postStore.setTimelineTranscript) postStore.setTimelineTranscript(tlWords);
                    }
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
     * _getDiarizationForAsset
     *
     * Returns { words, speakers } for ONE asset, in that asset's own source
     * time base. Resolution order (cheapest first):
     *   1. store.diarizationByAsset[assetId]      — already computed this session
     *   2. store.speakerMap                        — split_speakers ran on THIS asset
     *   3. queue a diarize job for the asset's file and poll it
     *
     * Diarization is inherently per-file, so a timeline assembled from several
     * uploads needs one of these per asset — otherwise one video's speaker turns
     * get applied to another's footage.
     *
     * @returns {Promise<{words:Array, speakers:string[]}|null>} null if unavailable
     */
    async _getDiarizationForAsset(assetId, { isPrimary = false, signal = null } = {}) {
        const store = useTimelineStore.getState();

        const cached = store.diarizationByAsset?.[assetId];
        if (cached?.words?.length) return cached;

        // The asset split_speakers already ran on — reuse those words for free.
        if (isPrimary) {
            const spWords = Object.entries(store.speakerMap || {})
                .flatMap(([spk, info]) => (info?.words || []).map(w => ({ ...w, speaker: w.speaker || spk })))
                .sort((a, b) => a.start - b.start);
            if (spWords.length > 0) {
                const speakers = [...new Set(spWords.map(w => w.speaker).filter(Boolean))].sort();
                const data = { words: spWords, speakers };
                store.setAssetDiarization?.(assetId, data);
                return data;
            }
        }

        const asset = (store.assets || []).find(a => a.id === assetId);
        const serverPath = resolveAssetServerPath(asset);
        if (!serverPath) {
            console.warn(`[virtual_multicam] no server path for asset "${asset?.name || assetId}" — cannot diarize it`);
            return null;
        }

        console.log(`[virtual_multicam] diarizing "${asset?.name || assetId}" (${serverPath})…`);
        const res = await authFetch('/api/interview/split-speakers', {
            method: 'POST',
            body: JSON.stringify({ filename: serverPath }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.warn(`[virtual_multicam] diarize request failed for "${asset?.name}": ${body.error || res.status}`);
            return null;
        }
        const { jobId } = await res.json();
        if (!jobId) return null;

        const result = await pollJobResult(jobId, signal);
        if (!result?.words?.length) {
            console.warn(`[virtual_multicam] diarization returned no words for "${asset?.name}"`);
            return null;
        }

        const speakers = result.speakers?.length
            ? result.speakers
            : [...new Set(result.words.map(w => w.speaker).filter(Boolean))].sort();
        const data = { words: result.words, speakers };
        useTimelineStore.getState().setAssetDiarization?.(assetId, data);
        console.log(`[virtual_multicam] "${asset?.name}": ${result.words.length} words, ${speakers.length} speaker(s)`);
        return data;
    }

    /**
     * _refineCutsWithIntelligence
     *
     * Post-filter on silence-removal segments: the gaps BETWEEN consecutive
     * active segments are the pauses about to be cut. Instead of cutting all
     * of them blindly, ask /api/interview/classify-pauses (GPT-4o-mini with
     * transcript context) which are dead air ('cut'), which are intentional
     * beats ('keep' — dramatic pause, comedic timing), and which are thinking
     * pauses worth preserving in shortened form ('shorten' → a 0.45s beat).
     *
     * Works regardless of where the segments came from (backend VAD or
     * client word-gap derivation). Degrades gracefully:
     *   - API unavailable → local heuristics (mid-sentence pause < 1.5s kept
     *     as a beat, everything > 2.5s cut, rest cut as before)
     *   - Any error → returns the original segments unchanged
     */
    async _refineCutsWithIntelligence(segments, words) {
        try {
            const sorted = [...segments].sort((a, b) => a.start - b.start);
            const SHORTEN_BEAT = 0.45; // seconds of pause retained for 'shorten'
            const MAX_KEEP_DUR = 4.0;  // never keep a pause longer than this outright

            // Build the pause list (gap between consecutive segments)
            const pauses = [];
            for (let i = 0; i < sorted.length - 1; i++) {
                const gapStart = sorted[i].end;
                const gapEnd   = sorted[i + 1].start;
                const dur      = gapEnd - gapStart;
                if (dur < 0.15) continue; // hairline — not worth classifying
                const before = (words || [])
                    .filter(w => w.end <= gapStart && w.end > gapStart - 6)
                    .map(w => w.word).join(' ');
                const after = (words || [])
                    .filter(w => w.start >= gapEnd && w.start < gapEnd + 6)
                    .map(w => w.word).join(' ');
                pauses.push({ i, dur, before, after, gapStart, gapEnd });
            }
            if (pauses.length === 0) return segments;

            // ── Get decisions: GPT endpoint first, heuristics as fallback ──────
            let decisionByIdx = {};
            try {
                const resp = await authFetch('/api/interview/classify-pauses', {
                    method: 'POST',
                    body: JSON.stringify({
                        pauses: pauses.map(({ i, dur, before, after }) => ({ i, dur, before, after })),
                    }),
                });
                if (!resp.ok) throw new Error(`classify-pauses ${resp.status}`);
                const { decisions = [] } = await resp.json();
                decisions.forEach(d => { decisionByIdx[d.i] = d.action; });
                console.log(`[MediaExecutionEngine] pause intelligence: ${decisions.length} decisions from GPT`);
            } catch (apiErr) {
                console.warn(`[MediaExecutionEngine] classify-pauses unavailable (${apiErr.message}) — using heuristics`);
                for (const p of pauses) {
                    const endsMidSentence = p.before && !/[.!?…]\s*$/.test(p.before.trim());
                    if (p.dur > 2.5)            decisionByIdx[p.i] = 'cut';
                    else if (endsMidSentence && p.dur < 1.5) decisionByIdx[p.i] = 'shorten';
                    else                        decisionByIdx[p.i] = 'cut';
                }
            }

            // ── Apply decisions: merge segments across kept pauses ─────────────
            const refined = [sorted[0]];
            let keptCount = 0, shortenedCount = 0;
            for (const p of pauses) {
                const nextSeg = sorted[p.i + 1];
                const action  = decisionByIdx[p.i] || 'cut';
                const last    = refined[refined.length - 1];

                if (action === 'keep' && p.dur <= MAX_KEEP_DUR) {
                    // Absorb the whole pause: extend the previous segment through it
                    last.end      = nextSeg.end;
                    last.duration = last.end - last.start;
                    keptCount++;
                } else if (action === 'shorten' || (action === 'keep' && p.dur > MAX_KEEP_DUR)) {
                    // Keep a short natural beat at the start of the pause, cut the rest
                    const beat    = Math.min(SHORTEN_BEAT, p.dur);
                    last.end      = last.end + beat;
                    last.duration = last.end - last.start;
                    refined.push({ ...nextSeg });
                    shortenedCount++;
                } else {
                    refined.push({ ...nextSeg });
                }
            }

            if (keptCount || shortenedCount) {
                console.log(
                    `[MediaExecutionEngine] pause intelligence: kept ${keptCount} intentional beat(s), ` +
                    `shortened ${shortenedCount} thinking pause(s), cut the rest ` +
                    `(${segments.length} → ${refined.length} segments)`
                );
            }
            return refined;
        } catch (err) {
            console.warn('[MediaExecutionEngine] _refineCutsWithIntelligence failed — using raw segments:', err.message);
            return segments;
        }
    }

    /**
     * _refineCutPointFrames
     *
     * Frame-check pass on top of _refineCutsWithIntelligence: classify-pauses
     * decides WHICH gaps to cut using transcript timing alone, with no idea
     * what's actually on screen at the exact millisecond the cut lands. A cut
     * chosen purely from word timing can land mid-blink, mid-gesture, or on a
     * motion-blurred frame — reads as a jump-cut glitch even when the audio
     * edit itself was correct.
     *
     * For every internal cut boundary in `segments` (the tail of one kept
     * segment and the head of the next — both are hard cuts in the exported
     * video), asks /api/interview/refine-cut-frames to nudge the timestamp
     * onto a nearby clean frame (low motion, not blurred), always within the
     * pause being removed and never more than ~150ms — small enough it can't
     * reintroduce audible dead air or clip into kept speech.
     *
     * Degrades the same way _refineCutsWithIntelligence does: any failure
     * (network, no source file, ffmpeg unavailable) returns the segments
     * unchanged rather than blocking the edit.
     */
    async _refineCutPointFrames(segments, filename) {
        try {
            if (!filename || !segments || segments.length < 2) return segments;
            const sorted = [...segments].sort((a, b) => a.start - b.start);

            const points = [];
            for (let i = 0; i < sorted.length - 1; i++) {
                points.push({ id: `tail_${i}`, t: sorted[i].end,       seg: i,     edge: 'end'   });
                points.push({ id: `head_${i}`, t: sorted[i + 1].start, seg: i + 1, edge: 'start' });
            }
            if (points.length === 0) return sorted;

            const capped = points.slice(0, 80); // matches the endpoint's own cap

            const resp = await authFetch('/api/interview/refine-cut-frames', {
                method: 'POST',
                body: JSON.stringify({ filename, points: capped.map(p => ({ id: p.id, t: p.t })) }),
            });
            if (!resp.ok) throw new Error(`refine-cut-frames ${resp.status}`);
            const { picks = [] } = await resp.json();
            const pickById = new Map(picks.map(p => [p.id, p]));

            const refined = sorted.map(s => ({ ...s }));
            let adjusted = 0;
            for (const p of capped) {
                const pick = pickById.get(p.id);
                if (!pick || !pick.offsetSec) continue;
                const target = refined[p.seg];
                if (!target) continue;
                if (p.edge === 'end') {
                    target.end = Math.max(target.start + 0.05, target.end + pick.offsetSec);
                } else {
                    target.start = Math.min(target.end - 0.05, target.start + pick.offsetSec);
                }
                target.duration = target.end - target.start;
                adjusted++;
            }
            if (adjusted > 0) {
                console.log(`[MediaExecutionEngine] frame check: nudged ${adjusted} cut point(s) off motion/blur frames`);
            }
            return refined;
        } catch (err) {
            console.warn('[MediaExecutionEngine] _refineCutPointFrames failed — using original cut points:', err.message);
            return segments;
        }
    }

    /**
     * _applySegmentsToTimeline
     *
     * Replaces one or more timeline clips with segment-clips derived from the
     * silence/filler detection result.
     *
     * @param {Array<{start,end,duration}>} segments  - active segments to keep
     * @param {string}  prefix        - clip-ID prefix for debugging ('silence'|'filler')
     * @param {string|null} targetClipId   - replace exactly this one clip (legacy per-clip steps)
     * @param {string|null} targetAssetId  - replace ALL clips sharing this assetId (per-asset steps)
     *
     * Priority: targetAssetId > targetClipId > single-clip fallback > filename match
     */
    _applySegmentsToTimeline(segments, prefix = 'seg', targetClipId = null, targetAssetId = null) {
        const timelineStore = useTimelineStore.getState();

        // MULTI-TRACK: after split_speakers there is one video track per speaker.
        // This used to grab only `.find(t => t.type === 'video')`, so cleanup
        // silently skipped every clip on the second speaker's track. All video
        // tracks are considered now, and each clip is rebuilt on its OWN track
        // (`_trackId`) using a SHARED source→timeline map so the tracks stay in
        // sync after time is removed.
        const videoTracks = (timelineStore.tracks ?? []).filter(t => t.type === 'video');
        const videoTrack  = videoTracks[0]; // legacy anchor for single-track paths

        if (videoTracks.length === 0) {
            console.warn(`[MediaExecutionEngine] _applySegmentsToTimeline: no video track found`);
            return;
        }

        const allVideoClips = videoTracks.flatMap(t =>
            (t.clips ?? []).map(c => ({ ...c, _trackId: t.id }))
        );
        if (allVideoClips.length === 0) {
            console.warn(`[MediaExecutionEngine] _applySegmentsToTimeline: video track has no clips`);
            return;
        }

        const basename = (p) => (p || '').split(/[\\/]/).pop();
        const processedBase = basename(timelineStore.uploadedFilePath || '');
        const strippedBase  = processedBase ? processedBase.replace(/^\d+-/, '') : '';

        // ── Resolve which clips to replace ───────────────────────────────────
        // baseClip  = template for new clip properties (url, assetId, etc.)
        // baseClips = the full list of clips to remove before inserting segments
        let baseClip, baseClips;

        if (targetAssetId) {
            // Per-asset mode: replace ALL clips that share this assetId.
            // This correctly handles timelines where a previous silence removal
            // already exploded one original clip into N small segments.
            baseClips = allVideoClips
                .filter(c => c.assetId === targetAssetId)
                .sort((a, b) => a.start - b.start);
            if (baseClips.length === 0) {
                console.warn(`[MediaExecutionEngine] _applySegmentsToTimeline: no clips found for asset "${targetAssetId}" — skipping`);
                return;
            }
            baseClip = baseClips[0];
        } else if (targetClipId) {
            baseClip = allVideoClips.find(c => c.id === targetClipId);
            if (!baseClip) {
                console.warn(`[MediaExecutionEngine] _applySegmentsToTimeline: clip "${targetClipId}" not found — skipping`);
                return;
            }
            baseClips = [baseClip];
        } else if (allVideoClips.length === 1) {
            baseClip  = allVideoClips[0];
            baseClips = [baseClip];
        } else {
            // Filename fallback: check both the timestamped GCS name and the stripped
            // original name (e.g. "1780602619818-IMG_7362.mov" → "IMG_7362.mov").
            const sortedByStart = [...allVideoClips].sort((a, b) => a.start - b.start);
            if (processedBase) {
                baseClip = sortedByStart.find(c => {
                    const assetName    = basename(timelineStore.assets?.find(a => a.id === c.assetId)?.name || '');
                    const strippedAsset = assetName.replace(/^\d+-/, '');
                    const cName   = basename(c.name      || '');
                    const cUrl    = basename(c.url        || '');
                    const cSource = basename(c.sourceUrl  || '');
                    return assetName     === processedBase  ||
                           assetName     === strippedBase   ||
                           strippedAsset === strippedBase   ||
                           processedBase.endsWith(assetName) ||
                           cName    === processedBase || cName    === strippedBase ||
                           cUrl     === processedBase || cUrl     === strippedBase ||
                           cSource  === processedBase || cSource  === strippedBase;
                });
            }
            if (!baseClip) {
                // No filename match — fall back to applying to ALL clips from the
                // most-represented assetId (i.e. the primary uploaded file).
                // This handles the common case where silence_removal is run on a
                // track that already has N clips from one asset.
                const assetCounts = {};
                for (const c of allVideoClips) {
                    if (c.assetId) assetCounts[c.assetId] = (assetCounts[c.assetId] || 0) + 1;
                }
                const primaryAssetId = Object.entries(assetCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
                if (primaryAssetId) {
                    console.log(`[MediaExecutionEngine] _applySegmentsToTimeline: no filename match — applying to all clips for asset "${primaryAssetId}"`);
                    baseClips = allVideoClips
                        .filter(c => c.assetId === primaryAssetId)
                        .sort((a, b) => a.start - b.start);
                    baseClip = baseClips[0];
                } else {
                    // Ultimate fallback: all clips sorted by start time
                    console.log(`[MediaExecutionEngine] _applySegmentsToTimeline: no assetId found — applying to all ${allVideoClips.length} clips`);
                    baseClips = [...allVideoClips].sort((a, b) => a.start - b.start);
                    baseClip  = baseClips[0];
                }
            } else {
                // Filename match found — but expand to ALL clips sharing the same
                // assetId, not just the first one.
                //
                // When virtual_multicam ran before this pass it split the original
                // single clip into N angle-tagged sub-clips (each with the same
                // assetId). sortedByStart.find() returns only the first of those N
                // clips. If baseClips = [baseClip], srcVirtualCamRanges covers only
                // that first clip's source range, and every silence-removed segment
                // outside that range falls back to the same zoom level — wiping every
                // other virtual-multicam angle.
                //
                // Expanding here gives the full VM range map so each new clip
                // inherits the correct angle from the right diarization segment.
                const foundAssetId = baseClip.assetId;
                if (foundAssetId) {
                    baseClips = allVideoClips
                        .filter(c => c.assetId === foundAssetId)
                        .sort((a, b) => a.start - b.start);
                    baseClip = baseClips[0]; // re-anchor to sorted first
                    if (baseClips.length > 1) {
                        console.log(
                            `[MediaExecutionEngine] _applySegmentsToTimeline: expanded baseClips ` +
                            `from 1 to ${baseClips.length} clips (same assetId "${foundAssetId}") ` +
                            `— preserves per-clip virtualCam angles through silence removal`
                        );
                    }
                } else {
                    baseClips = [baseClip];
                }
            }
        }

        // ── Compute replacement range ─────────────────────────────────────────
        // For per-asset mode, the "range" spans from the first clip's start to
        // the last clip's end — covering all N previously-segmented pieces.
        const lastBaseClip    = baseClips[baseClips.length - 1];
        const rangeStart      = baseClip.start;
        const rangeEnd        = lastBaseClip.start + (lastBaseClip.duration || 0);
        const totalOriginalDuration = rangeEnd - rangeStart;

        // Filter out degenerate segments
        const validSegs = segments.filter(s => s.duration > 0.05);
        if (validSegs.length === 0) {
            console.warn(`[MediaExecutionEngine] _applySegmentsToTimeline: all segments are too short, skipping`);
            return;
        }

        // Sanity guard: active duration < 10% of the source material → detection failed
        const totalActiveTime = validSegs.reduce((t, s) => t + s.duration, 0);
        if (totalOriginalDuration > 30 && totalActiveTime < totalOriginalDuration * 0.10) {
            console.error(
                `[MediaExecutionEngine] _applySegmentsToTimeline: REJECTED — active duration ` +
                `${totalActiveTime.toFixed(1)}s is less than 10% of original ${totalOriginalDuration.toFixed(1)}s.`
            );
            useAIStore.getState().addLog({
                id: `step-sanity-${Date.now()}`,
                type: 'error',
                message: `Detection result rejected — only ${totalActiveTime.toFixed(1)}s active out of ` +
                    `${totalOriginalDuration.toFixed(1)}s. Try running again or adjusting settings.`,
                timestamp: new Date().toLocaleTimeString()
            });
            return;
        }

        const ts = Date.now();
        useAIStore.getState().addLog({
            id: `step-seg-${ts}`,
            type: 'step',
            message: `Applying ${validSegs.length} segment(s) to timeline…`,
            timestamp: new Date().toLocaleTimeString()
        });

        // ── Save ONE history snapshot for the entire segment-replace operation ─
        // Previously each addClip call saved its own entry, causing 100+ history
        // pushes that could leave the timeline in an empty intermediate state if
        // rhythm_zoom or any subsequent step inspected the store mid-operation.
        timelineStore.saveToHistory?.();

        // Collect virtual-multicam data from existing clips BEFORE removing them.
        // When virtual_multicam ran before this cleanup pass, each clip has its own
        // angle (close_host / close_guest / wide). Blindly spreading ...baseClip would
        // copy the FIRST clip's angle to every new clip, wiping out the per-shot angles.
        // Instead we build a source-time-range → virtualCam lookup so each new clip
        // inherits the angle from whichever old clip has the most source-time overlap.
        const srcVirtualCamRanges = baseClips
            .filter(c => c.virtualCam)
            .map(c => ({
                start:     c.offset ?? 0,
                end:       (c.offset ?? 0) + (c.duration ?? 0),
                virtualCam: c.virtualCam,
            }));

        // Remove all clips in the range from THEIR OWN tracks — skipHistory
        // because we already saved one snapshot above (prevents N intermediate
        // empty-timeline states).
        for (const clip of baseClips) {
            timelineStore.removeClip(clip._trackId || videoTrack.id, clip.id, { skipHistory: true });
        }

        // ── Shared source→timeline map ───────────────────────────────────────
        // Every kept segment gets ONE output position, computed once and reused
        // by every track. This is what keeps multiple video tracks in sync after
        // time is removed: previously each track was packed independently from
        // its own cursor, so two speaker tracks drifted apart (or stacked).
        const orderedSegs = [...validSegs].sort((a, b) => a.start - b.start);
        let acc = rangeStart;
        const segOut = orderedSegs.map(seg => {
            const out = acc;
            acc += seg.duration;
            return { ...seg, outStart: out, srcEnd: seg.start + seg.duration };
        });
        const timelineEnd = acc;

        let droppedZoomKfCount = 0; // clips whose stale zoom-rhythm keyframes had to be cleared (see below)
        let inserted = 0;

        // Rebuild each base clip by intersecting it with the kept segments.
        // A clip only yields pieces for the parts of ITS OWN source range that
        // survive, and each piece lands at the shared output position — so a
        // clip on track 2 stays aligned with the matching moment on track 1.
        baseClips.forEach((srcClip, clipIdx) => {
            const trackId     = srcClip._trackId || videoTrack.id;
            const clipSrcFrom = srcClip.offset ?? 0;
            const clipSrcTo   = clipSrcFrom + (srcClip.duration ?? 0);
            const persistentUrl = srcClip.sourceUrl || srcClip.url || '';

            if (srcClip.keyframes?.scale?.length) droppedZoomKfCount++;

            segOut.forEach((seg, segIdx) => {
                const from = Math.max(seg.start, clipSrcFrom);
                const to   = Math.min(seg.srcEnd, clipSrcTo);
                const dur  = to - from;
                if (dur < 0.05) return; // no meaningful overlap with this clip

                // Inherit the correct virtualCam angle from the pre-cleanup clips
                // by matching on source-time overlap. Falls back to this clip's own
                // virtualCam when no per-clip map exists (i.e. VM hasn't run yet).
                let inheritedVirtualCam = srcClip.virtualCam ?? null;
                if (srcVirtualCamRanges.length > 0) {
                    let bestOverlap = 0;
                    for (const vc of srcVirtualCamRanges) {
                        const overlap = Math.max(0, Math.min(vc.end, to) - Math.max(vc.start, from));
                        if (overlap > bestOverlap) {
                            bestOverlap = overlap;
                            inheritedVirtualCam = vc.virtualCam;
                        }
                    }
                }

                const newClip = {
                    ...srcClip,
                    id:           `clip_${prefix}_${ts}_${clipIdx}_${segIdx}`,
                    start:        seg.outStart + (from - seg.start),
                    duration:     dur,
                    offset:       from,
                    name:         `Segment ${inserted + 1}`,
                    originalName: srcClip.originalName || srcClip.name,
                    url:          persistentUrl,
                    sourceUrl:    srcClip.sourceUrl || persistentUrl,
                    virtualCam:   inheritedVirtualCam,
                    // Same staleness problem virtualCam used to have: keyframes.scale
                    // was authored against the OLD clip duration/offset, so it would
                    // apply the wrong zoom at the wrong time on a re-cut fragment.
                    // No meaningful remap exists for an animation curve — drop it.
                    keyframes:    srcClip.keyframes ? { ...srcClip.keyframes, scale: [] } : srcClip.keyframes,
                };
                delete newClip._trackId;
                timelineStore.addClip(trackId, newClip, { skipHistory: true });
                inserted++;
            });
        });

        console.log(
            `[MediaExecutionEngine] _applySegmentsToTimeline: inserted ${inserted} clip(s) across ` +
            `${new Set(baseClips.map(c => c._trackId || videoTrack.id)).size} track(s) from ${baseClips.length} source clip(s)`
        );

        // Shift clips that came AFTER the replaced range — on EVERY video track,
        // by the same delta, so tracks that weren't re-cut stay aligned too.
        const durationDiff = timelineEnd - rangeEnd;
        if (Math.abs(durationDiff) > 0.01) {
            const freshTracks = (useTimelineStore.getState().tracks || []).filter(t => t.type === 'video');
            for (const ft of freshTracks) {
                (ft.clips || [])
                    .filter(c => c.start >= rangeEnd - 0.01 && !c.id.startsWith(`clip_${prefix}_${ts}_`))
                    .sort((a, b) => a.start - b.start)
                    .forEach(c => {
                        timelineStore.updateClip(ft.id, c.id, { start: c.start + durationDiff }, { skipHistory: true });
                    });
            }
        }

        const label = baseClips.length > 1
            ? `${baseClips.length} clips (asset ${targetAssetId})`
            : `"${baseClip.name}"`;
        console.log(`[MediaExecutionEngine] ✅ Applied ${validSegs.length} segments to ${label}, total active ${timelineEnd.toFixed(2)}s`);
        if (droppedZoomKfCount > 0) {
            console.warn(
                `[MediaExecutionEngine] ⚠️ Cleared stale zoom-rhythm keyframes on ${droppedZoomKfCount} ` +
                `re-segmented clip(s) — re-run "make it more dynamic" after this to reapply the rhythm ` +
                `to the new segments (see R16 in CLAUDE.md).`
            );
        }

        // Auto-preview: seek to start and briefly play
        const freshStore = useTimelineStore.getState();
        freshStore.seek(rangeStart);
        freshStore.setIsPlaying(true);
        setTimeout(() => {
            useTimelineStore.getState().setIsPlaying(false);
        }, 4000);
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