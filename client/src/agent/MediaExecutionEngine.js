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
import { EventBus, EVENT_TYPES } from './EventBus.js';
// R58 — Motion Graphics engine. Caption grouping now preserves per-word
// timings instead of collapsing them to a line of text; see
// groupWordsIntoCaptions below and client/src/motion/CaptionModel.js.
import { groupWordsIntoSegments, stylePackToClipFields } from '../motion/CaptionModel.js';
import { STYLE_RECIPES, recipeTransitionForCut, pickTransitionCuts } from '../motion/StyleRecipes.js';
import { TRANSITION_DEFAULT_DURATION } from '../motion/TransitionFX.js';
import { autoEmphasizeCaptions } from '../utils/captionEmphasis.js';
import { mapTranscriptToTimeline, listMainTrackSources } from '../timeline/transcriptMap.js';
import { transcriptionManager } from './TranscriptionManager.js';
// R68 — AI Animation Intelligence. `animate_automatically` applies the
// server's resolved plan (AnimationKnowledgeGraph.js) the exact same way
// the manual Motion tab does, so a brain-picked preset and a hand-picked one
// are indistinguishable to every downstream consumer (preview, export).
import { applyPresetToClip, AUTO_ANIMATE } from '../motion/ClipAdapter.js';
// R92 — motion written by the AI (with a rules fallback)
import { composeMotion, planMotionFromBrief, COMPOSED } from '../motion/MotionComposer.js';
import { normalizeMatte } from '../motion/MatteSettings.js';
import { sfxLevel, sfxVolume, collectSfxCues, SFX_QUERIES } from './sfxCues.js'; // R92 round A
import { pickMotionTargets, layersForPrompt, scriptFor } from './composeMotionTargets.js';
import { selectAnimateMoments, sfxPlayableUrl, countMoments, CLUSTER_S } from './animateMoments.js';
import i18next from 'i18next';
import { resolveRetakeSource, retakeReviewLines, makeRetakeT, findTranscript } from './retakeSource.js';
import { clipSourceWords, buildRhythmRequest, shotsToKeyframes } from './rhythmShots.js';
import { findBestShortWindow, findShortCandidates, rangesOutside } from './shortPicker.js';
import { PLATFORM_PROFILES, assignPlatforms, platformsFromText } from './PlatformProfiles.js'; // R92 round B
import { polishShort } from './shortPolish.js'; // R92 round C
import { packSegments } from './segmentPacking.js';

// See _deriveAudioPeaksForClip below.
const DERIVED_PEAK_DB_FLOOR = -8;

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
 *
 * R58: delegates to the Motion Graphics engine's caption model, which returns
 * the SAME `{ text, start, end }` fields PLUS a `words` array.
 *
 * WHY THIS MATTERS: this function was the single place per-word timings died.
 * Three providers produce them (AssemblyAI, Whisper `verbose_json`, WhisperX)
 * and they survive all the way into `state.captions` — and then the old body
 * here did `group.map(x => x.word).join(' ')` and dropped the array on the
 * floor. Every caption downstream was therefore only ever a line of text,
 * which is why per-word highlighting looked like it needed "adding word-level
 * timing" when the timings had been there the whole time.
 *
 * Callers reading only `text`/`start`/`end` are unaffected — the extra field
 * is purely additive, which is what makes this safe to swap in.
 */
function groupWordsIntoCaptions(words, maxWords = 6, pauseThreshold = 0.4) {
    return groupWordsIntoSegments(words, maxWords, pauseThreshold);
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
    // Delegates to timeline/transcriptMap.js. The old version here applied ONE
    // file's transcript to every clip of the first video track and ignored
    // clip speed, so on a multi-file or reordered edit, clips received words
    // from the wrong file / wrong moment. Now every main-track clip is mapped
    // through ITS OWN source file's transcript (clip.assetId → store.assets →
    // store.transcripts). `originalWords` is only used as a fallback for
    // single-source timelines whose file isn't in the transcripts map yet.
    // Only transcripts known to be in SOURCE time are used — entries written
    // before the setCaptions fix below may hold timeline-time words.
    const { assets, transcripts, transcriptVerified } = useTimelineStore.getState();
    const verified = {};
    for (const [k, v] of Object.entries(transcripts || {})) {
        if (transcriptVerified?.[k]) verified[k] = v;
    }
    const mapped = mapTranscriptToTimeline({ tracks, assets, transcripts: verified, fallbackWords: originalWords || null });
    return mapped.length > 0 ? mapped : null;
}

// ─── MediaExecutionEngine ────────────────────────────────────────────────────


/** R91: AbortSignal that fires after `ms` (undefined where unsupported). */
function timeoutSignal(ms) {
    try {
        return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
    } catch (err) {
        console.warn('[MediaExecutionEngine] timeoutSignal unavailable:', err.message);
        return undefined;
    }
}


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

    /**
     * R68 fix — TimelineEventDetector's PUNCHLINE_DETECTED/EMPHASIS_MOMENT
     * heuristics read `clip.peaks`/`clip.audioPeaks` (discrete {offset, db}
     * markers), but nothing in this codebase ever wrote that field onto any
     * clip — WaveformEngine's real per-asset amplitude data (50 samples/sec,
     * normalised 0-1, already cached in `store.waveformsByAsset` for the
     * waveform UI) was never converted into it. Net effect: those two event
     * types — the only ones in AnimationKnowledgeGraph.js with a `video`
     * preset (camera-shake / camera-zoom) — could never fire, so
     * `animate_automatically` could only ever land on caption/text clips
     * (REVEAL via keyword match, EMOTIONAL_BEAT by construction) and the
     * base video clip was never animated no matter how punchy the audio was.
     *
     * This derives real discrete peaks for a video clip's VISIBLE (trimmed)
     * window from the already-cached asset waveform — local maxima only
     * (not all 50 samples/sec, which would flood the detector with false
     * emphasis events on any sustained-loud stretch), converted from
     * normalised amplitude to an approximate dB value on the same scale
     * TimelineEventDetector's PUNCHLINE_PEAK_DB/EMPHASIS_PEAK_DB constants
     * already use (20·log10(amplitude), so amplitude 1.0 → 0dB).
     *
     * Read-only: builds a plain array, never mutates the clip or touches
     * the store, so it can't affect persistence/undo (R29/R4).
     */
    _deriveAudioPeaksForClip(store, clip) {
        const asset = clip?.assetId ? store.waveformsByAsset?.[clip.assetId] : null;
        const samples = asset?.peaks;
        if (!Array.isArray(samples) || samples.length === 0) return [];

        const SAMPLE_RATE_HZ = 50; // matches routes/waveformRoutes.js SAMPLES_PER_WIN extraction rate
        const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
        const sourceStart = Number(clip.offset) || 0;
        const duration     = Number(clip.duration) || 0;
        if (duration <= 0) return [];
        // The clip shows duration × speed seconds of source (timeline/speedChange.js).
        const sourceEnd = sourceStart + duration * speed;

        const firstIdx = Math.max(0, Math.floor(sourceStart * SAMPLE_RATE_HZ));
        const lastIdx  = Math.min(samples.length - 1, Math.ceil(sourceEnd * SAMPLE_RATE_HZ));
        if (lastIdx <= firstIdx) return [];

        // Only PROMINENT peaks: the loudest point within ±1 s, at least 60% of
        // the loudest sound in this clip, and at least 2.5 s apart. Every
        // local maximum of normal speech used to count (dozens per sentence),
        // which would have flooded the detector with "emphasis" moments.
        // dB is relative to the clip's loudest point (0 dB), the scale
        // TimelineEventDetector's -4 / -8 dB thresholds read.
        let maxA = 0;
        for (let i = firstIdx; i <= lastIdx; i++) if (samples[i] > maxA) maxA = samples[i];
        if (!(maxA > 0)) return [];
        const WIN = SAMPLE_RATE_HZ; // ±1 s
        const candidates = [];
        for (let i = firstIdx; i <= lastIdx; i++) {
            const a = samples[i];
            if (typeof a !== 'number' || a < maxA * 0.6) continue;
            let isMax = true;
            for (let j = Math.max(firstIdx, i - WIN); j <= Math.min(lastIdx, i + WIN); j++) {
                if (samples[j] > a || (samples[j] === a && j < i)) { isMax = false; break; }
            }
            if (!isMax) continue;
            const db = 20 * Math.log10(a / maxA);
            if (db < DERIVED_PEAK_DB_FLOOR) continue;
            candidates.push({ i, a, db });
        }
        candidates.sort((x, y) => y.a - x.a);
        const kept = [];
        for (const c of candidates) {
            if (kept.every(k => Math.abs(k.i - c.i) >= 2.5 * SAMPLE_RATE_HZ)) kept.push(c);
        }
        return kept
            .sort((x, y) => x.i - y.i)
            // offset = TIMELINE seconds from the clip start
            .map(c => ({ offset: (c.i / SAMPLE_RATE_HZ - sourceStart) / speed, db: c.db }));
    }

    /**
     * R68 fix — clones `store.tracks` with `peaks` attached to every video
     * clip (see `_deriveAudioPeaksForClip` above) for the ONE
     * `animate_automatically` request body. Does not touch the store.
     */
    /**
     * R90 — reveal / punchline / emphasis moments for word-synced placements,
     * from the same detector the "animate" command uses (the animate route
     * detects and resolves only; it never writes). Empty on any failure: the
     * placements then still land on their words, just without the moment bonus.
     */
    async _fetchSemanticEvents() {
        try {
            const st = useTimelineStore.getState();
            const tracks = this._tracksWithDerivedAudioPeaks(st);
            const words = (st.captions || [])
                .map(w => ({ start: Number(w?.start), end: Number(w?.end) }))
                .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end));
            const res = await authFetch('/api/audio/animate-automatically', {
                method: 'POST',
                body: JSON.stringify({ projectState: { tracks, words }, projectId: st.projectId || null, editingStyle: st.editingStyle || null }),
                signal: timeoutSignal(45_000), // R91: placements still run without events
            });
            if (!res.ok) return [];
            const data = await res.json();
            return (Array.isArray(data?.plan) ? data.plan : [])
                .filter(p => p && Number.isFinite(Number(p.timelineTime)))
                .map(p => ({ eventType: p.eventType, timelineTime: Number(p.timelineTime) }));
        } catch (err) {
            console.warn('[MediaExecutionEngine] semantic events unavailable:', err.message);
            return [];
        }
    }

    _tracksWithDerivedAudioPeaks(store) {
        return (store.tracks || []).map(track => {
            if (track.type !== 'video') return track;
            return {
                ...track,
                clips: (track.clips || []).map(clip => {
                    if (clip.peaks?.length || clip.audioPeaks?.length) return clip;
                    const peaks = this._deriveAudioPeaksForClip(store, clip);
                    return peaks.length ? { ...clip, peaks } : clip;
                }),
            };
        });
    }

    /**
     * Undo what the previous "animate" run added, so running it again
     * REPLACES its result: animations tagged AUTO_ANIMATE come off every clip
     * (animations the user picked stay), and its sound effects (autoAnimate)
     * are removed. No history entry: the caller saved one.
     */
    _clearAutoAnimate() {
        const store = useTimelineStore.getState();
        for (const track of (store.tracks || [])) {
            for (const clip of (track.clips || [])) {
                if (track.type === 'audio' && clip.autoAnimate) {
                    useTimelineStore.getState().removeClip(track.id, clip.id, { skipHistory: true });
                    continue;
                }
                const anims = Array.isArray(clip.animations) ? clip.animations : null;
                if (anims && anims.some(a => a?.source === AUTO_ANIMATE)) {
                    useTimelineStore.getState().updateClip(track.id, clip.id,
                        { animations: anims.filter(a => a?.source !== AUTO_ANIMATE) }, { skipHistory: true });
                }
            }
        }
    }

    /**
     * R67 — find which track a clip id lives on. Several new Object
     * Intelligence cases (separate_speaker/zoom_speaker/track_speaker/
     * blur_background) take a bare clipId the way most other single-clip
     * commands in this file already assume a trackId is known ahead of
     * time — this is the one place that assumption gets resolved, so those
     * cases don't each duplicate a `tracks.flatMap(...)` scan.
     * Returns { trackId: null, clipId: null } (not throw) when not found —
     * every caller above already checks `!clipId` and returns a clean error.
     */
    /** R92: the SFX audio track (created once, named "SFX"). */
    _ensureSfxTrack() {
        const live = useTimelineStore.getState();
        const existing = live.tracks?.find(t => t.type === 'audio' && t.name === 'SFX');
        if (existing) return existing.id;
        const id = live.addTrack('audio');
        if (id) useTimelineStore.getState().renameTrack(id, 'SFX');
        return id || null;
    }

    /** R92: best library sound for a query, or null. Cached per call site. */
    async _fetchSfxAsset(query, cache = new Map()) {
        if (cache.has(query)) return cache.get(query);
        let asset = null;
        try {
            const res = await authFetch('/api/audio/search', {
                method: 'POST',
                body: JSON.stringify({ query, assetTypes: ['SOUND_EFFECT'], limit: 5 }),
            });
            const data = await res.json().catch(() => ({}));
            const rows = Array.isArray(data?.results) ? data.results : [];
            asset = rows.map(r => r?.asset || r).find(a => sfxPlayableUrl(a)) || null;
        } catch (err) {
            console.warn('[sfx] search failed:', err.message);
        }
        cache.set(query, asset);
        return asset;
    }

    /**
     * R92: place sound effects on cues. Clips are tagged `sfxCue` so a re-run
     * replaces them instead of stacking. Call inside a history step.
     * @returns {Promise<{placed:number, missing:string[]}>}
     */
    async _placeSfxCues(cues, level) {
        if (level === 'none' || !Array.isArray(cues) || cues.length === 0) return { placed: 0, missing: [] };
        const cache = new Map();
        const missing = new Set();
        const trackId = this._ensureSfxTrack();
        if (!trackId) return { placed: 0, missing: ['SFX track'] };
        // Replace this command's earlier cues (not sounds the user placed).
        const old = (useTimelineStore.getState().tracks || []).find(t => t.id === trackId)?.clips || [];
        old.filter(c => c.sfxCue).forEach(c => useTimelineStore.getState().removeClip(trackId, c.id, { skipHistory: true }));
        let placed = 0;
        for (const cue of cues) {
            const asset = await this._fetchSfxAsset(SFX_QUERIES[cue.kind] || cue.kind, cache);
            const url = sfxPlayableUrl(asset);
            if (!asset || !url) { missing.add(cue.kind); continue; }
            useTimelineStore.getState().addClip(trackId, {
                id: `sfx-${cue.kind}-${Math.round(cue.t * 1000)}-${placed}-${Date.now()}`,
                type: 'audio',
                name: asset.display_name || asset.displayName || asset.name || cue.kind,
                url, src: url, sourceUrl: url,
                assetId: asset.id || null,
                start: Math.max(0, cue.t),
                duration: Number(asset.duration) > 0 ? Math.min(3, Number(asset.duration)) : 1,
                volume: sfxVolume(asset.recommended_volume, level),
                isSFX: true,
                sfxCue: cue.kind,
            }, { skipHistory: true });
            placed += 1;
        }
        return { placed, missing: [...missing] };
    }

    /**
     * R92: playable URL of a clip's source, same rule as VideoPlayer's
     * ObjectLayerOverlay prop (proxy first, GCS paths through the media proxy).
     */
    _clipSourceUrl(store, clip) {
        const asset = clip?.assetId ? (store.assets || []).find(a => a.id === clip.assetId) : null;
        let url = asset?.proxyUrl || clip?.url || asset?.url || null;
        if (url && (url.startsWith('proxies/') || url.startsWith('raw/'))) url = `/api/proxy/gcs-media/${url}`;
        return url;
    }

    /**
     * R92: which video clips a background request applies to. "all" / "every"
     * → every video clip; otherwise the given or selected clip, then the clip
     * under the playhead, then the first video clip.
     */
    _matteTargets(store, args = {}) {
        const videoTracks = (store.tracks || []).filter(t => t.type === 'video');
        const all = videoTracks.flatMap(t => (t.clips || []).filter(c => c.type !== 'image').map(c => ({ trackId: t.id, clipId: c.id, clip: c })));
        if (all.length === 0) return [];
        if (args.all) return all;
        const wanted = args.clipId || (store.selectedClipIds || []).find(id => all.some(x => x.clipId === id)) || store.activeClipId;
        const byId = all.find(x => x.clipId === wanted);
        if (byId) return [byId];
        const t = Number(store.currentTime) || 0;
        const under = all.find(x => t >= (Number(x.clip.start) || 0) && t < (Number(x.clip.start) || 0) + (Number(x.clip.duration) || 0));
        return [under || all[0]];
    }

    /**
     * R92: make sure a clip has a mask covering its trimmed range; bake one
     * in the browser if not. Returns { ok, baked, people, error }.
     */
    async _ensureMatte(trackId, clipId, job) {
        const st = useTimelineStore.getState();
        const clip = (st.tracks || []).find(t => t.id === trackId)?.clips?.find(c => c.id === clipId);
        if (!clip) return { ok: false, error: `clip "${clipId}" not found` };
        const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
        const need0 = Number(clip.offset) || 0;
        const need1 = need0 + (Number(clip.duration) || 0) * speed;
        const lm = clip.layerMask;
        const covers = lm && (lm.maskAssetPath || lm.maskAssetUrl)
            && Number.isFinite(Number(lm.sourceStart)) && Number.isFinite(Number(lm.sourceDuration))
            && Number(lm.sourceStart) <= need0 + 0.05
            && Number(lm.sourceStart) + Number(lm.sourceDuration) >= need1 - 0.15;
        if (covers) return { ok: true, baked: false, people: (lm.bboxTrack || []).length > 0 };
        const sourceUrl = this._clipSourceUrl(st, clip);
        if (!sourceUrl) return { ok: false, error: 'This clip has no playable source yet. Wait for the upload to finish.' };
        const { bakeMatte } = await import('../vision/MatteBaker.js');
        const baked = await bakeMatte({ sourceUrl, sourceStart: need0, sourceDuration: need1 - need0, signal: job?.signal });
        const applied = useTimelineStore.getState().applyLayerSeparation(trackId, clipId, { ...baked, settings: lm?.settings, skipHistory: true });
        if (!applied?.success) return { ok: false, error: applied?.error };
        return { ok: true, baked: true, people: baked.bboxTrack.length > 0 };
    }

    _findClipAndTrack(store, clipId) {
        if (!clipId) return { trackId: null, clipId: null };
        for (const track of (store.tracks || [])) {
            const clip = (track.clips || []).find(c => c.id === clipId);
            if (clip) return { trackId: track.id, clipId: clip.id };
        }
        return { trackId: null, clipId: null };
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
            case 'setAspectRatio': {
                this._callStore(store, 'setAspectRatio', args.ratio);
                // R91: a reel fills 9:16 with a crop on the speaker, not bars; going
                // back to a wider frame removes that crop again.
                const fresh = useTimelineStore.getState();
                const hasOurCrop = (fresh.tracks || []).some(t => (t.clips || []).some(c => c.virtualCam?.reframe));
                if ((args.reframeMode === 'face' || hasOurCrop) && typeof fresh.reframeToFrame === 'function') {
                    const r = fresh.reframeToFrame();
                    if (r.reframed > 0) {
                        const face = r.faceAware > 0 ? `, ${r.faceAware} centred on the detected speaker` : ', centred (no face data yet)';
                        return { action, success: true, message: `Set to ${args.ratio}. Reframed ${r.reframed} clip(s) to fill the frame${face}.` };
                    }
                }
                return { action, success: true };
            }
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
                    // Every CUT: a transition sits at a clip's end, so the last
                    // clip of each track is skipped (R89 — it would otherwise
                    // fade the whole video out).
                    const videoTracks = (store.tracks || []).filter(t => t.type === 'video');
                    for (const track of videoTracks) {
                        const ordered = [...(track.clips || [])].sort((a, b) => a.start - b.start);
                        for (const clip of ordered.slice(0, -1)) {
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
            // R65 — Motion Graphics Components. The AI-tool entry point for
            // client/src/motion/ComponentLibrary.js: `{ action: 'addMotionComponent',
            // args: { component: 'CTAWidget', preset: 'subscribe', params: {...} } }`.
            // `component`/`preset` are top-level (matching how the feature was
            // asked for) with everything content-specific — text/url/emoji/
            // direction/position — under `params`, so those two reserved keys
            // can never collide with a component's own fields.
            case 'addMotionComponent': {
                const result = this._callStore(store, 'addMotionComponent', args.component, args.preset, args.params || {});
                return { action, success: !!result?.success, error: result?.error, message: result?.success ? `Added ${args.component} (${args.preset})` : result?.error };
            }
            // R66 — clip grouping. `groupId` is returned by `addMotionComponent`
            // on success as part of the created clips (see ComponentLibrary.js);
            // callers building on a composite component pass it straight back in.
            case 'moveClipGroup': {
                const result = this._callStore(store, 'moveClipGroup', args.groupId, args.delta || {});
                return { action, success: !!result?.success, error: result?.error };
            }
            case 'duplicateClipGroup': {
                const result = this._callStore(store, 'duplicateClipGroup', args.groupId, args.options || {});
                return { action, success: !!result?.success, error: result?.error, groupId: result?.groupId };
            }
            case 'removeClipGroup': {
                const result = this._callStore(store, 'removeClipGroup', args.groupId);
                return { action, success: !!result?.success, error: result?.error };
            }
            // R67 — Object Intelligence Integration ("separate speaker" → SAM2
            // → speaker/background layers → target-aware motion). This case owns
            // the actual network call + job polling (same shape as `detect_scene`
            // above — resolveAssetServerPath + authFetch + pollJobResult); the
            // store action it calls at the end (`applyLayerSeparation`) only
            // stores the result, exactly like `setSceneAnalysis` does for
            // detect_scene. SAM2 video inference is minutes, not seconds — the
            // timeout below is generous on purpose (matches the diarize
            // Whisper-job timeout precedent elsewhere in this file).
            // R92: the free browser matte replaces the paid SAM2 job. Same
            // result shape (mask + bboxTrack), so zoom/track speaker work on it.
            case 'separate_speaker': {
                const [target] = this._matteTargets(store, args);
                if (!target) return { action, success: false, error: 'There is no video clip to work on.' };
                const m = await this._ensureMatte(target.trackId, target.clipId, job);
                if (!m.ok) return { action, success: false, error: m.error };
                return {
                    action, success: true,
                    message: m.people === false
                        ? 'No person was found in this clip, so speaker tools have nothing to follow.'
                        : 'The speaker is separated from the background. You can now say "zoom to the speaker", "track the speaker" or "blur the background".',
                };
            }
            // ── R92: free background removal (vision/MatteBaker.js) ──────────
            // Blur, dim, colour or image behind the person. The mask is made
            // in the browser with a free model the first time, then reused.
            case 'remove_background': {
                const st = useTimelineStore.getState();
                const targets = this._matteTargets(st, args);
                if (targets.length === 0) return { action, success: false, message: 'There is no video clip to work on. Add a video first.' };
                const settings = {};
                if (args.mode) settings.mode = args.mode;
                if (args.color) settings.color = args.color;
                if (Number.isFinite(Number(args.blur))) settings.blur = Number(args.blur);
                if (args.reveal) settings.reveal = args.reveal;
                if (Number.isFinite(Number(args.revealDuration))) settings.revealDuration = Number(args.revealDuration);
                let done = 0;
                let noPerson = 0;
                const failures = [];
                st._saveHistory?.();
                for (const { trackId, clipId } of targets) {
                    try {
                        const m = await this._ensureMatte(trackId, clipId, job);
                        if (!m.ok) { failures.push(m.error); continue; }
                        if (m.people === false) noPerson += 1;
                        const live = useTimelineStore.getState();
                        const clip = (live.tracks || []).find(t => t.id === trackId)?.clips?.find(c => c.id === clipId);
                        const merged = { ...(clip?.layerMask?.settings || {}), ...settings };
                        live.updateClip(trackId, clipId, {
                            layerMask: { ...clip.layerMask, settings: normalizeMatte(merged) },
                            layerTarget: 'background',
                        }, { skipHistory: true });
                        done += 1;
                    } catch (err) {
                        if (err?.name === 'AbortError') throw err;
                        console.warn('[remove_background] failed:', err.message);
                        failures.push(err.message);
                    }
                }
                if (done === 0) return { action, success: false, message: failures[0] || 'The background could not be removed.' };
                const look = normalizeMatte(settings).mode;
                const lookText = { blur: 'blurred', dim: 'darkened', color: 'replaced with a solid colour', image: 'replaced with your image' }[look] || 'changed';
                const revText = settings.reveal && settings.reveal !== 'none' ? ` with ${settings.reveal} reveal animation` : '';
                const warn = noPerson ? ` No person was found in ${noPerson} clip(s), so they may look fully replaced.` : '';
                return { action, success: true, message: `Background ${lookText}${revText} on ${done} clip(s). Adjust it in the Background panel. One undo reverts it.${warn}`, details: { done, mode: look, reveal: settings.reveal } };
            }
            case 'sandwich_text':
            case 'put_text_behind_speaker': {
                const st = useTimelineStore.getState();
                const textTracks = (st.tracks || []).filter(t => t.type === 'text');
                const allTextClips = textTracks.flatMap(t => (t.clips || []).map(c => ({ clip: c, trackId: t.id })));
                if (allTextClips.length === 0) {
                    return { action, success: false, message: 'There is no text or caption clip to place behind the speaker. Add text first.' };
                }
                const activeId = st.activeClipId;
                const target = (activeId && allTextClips.find(item => item.clip.id === activeId))
                    || allTextClips.find(item => st.currentTime >= item.clip.start && st.currentTime <= item.clip.start + item.clip.duration)
                    || allTextClips[0];
                
                st.saveToHistory?.();
                st.updateClip(target.trackId, target.clip.id, { placement: 'behind_subject' });

                const vidTargets = this._matteTargets(st, args);
                let matteMsg = '';
                if (vidTargets.length > 0) {
                    const firstVid = vidTargets[0];
                    const vClip = (st.tracks || []).find(t => t.id === firstVid.trackId)?.clips?.find(c => c.id === firstVid.clipId);
                    if (vClip && vClip.layerTarget !== 'background') {
                        await this.executeStoreAction({ action: 'remove_background', args: { mode: 'blur', blur: 16 } }, job);
                        matteMsg = ' Video background blur enabled to reveal depth.';
                    }
                }

                return {
                    action,
                    success: true,
                    message: `Text placed behind the speaker in the sandwich layer.${matteMsg}`,
                    details: { clipId: target.clip.id, placement: 'behind_subject' },
                };
            }
            case 'zoom_speaker': {
                const [target] = this._matteTargets(store, args);
                if (!target) return { action, success: false, error: 'There is no video clip to work on.' };
                const { trackId, clipId } = target;
                const zm = await this._ensureMatte(trackId, clipId, job);
                if (!zm.ok) return { action, success: false, error: zm.error };
                const result = this._callStore(useTimelineStore.getState(), 'zoomToSpeaker', trackId, clipId);
                return { action, success: !!result?.success, error: result?.error };
            }
            case 'track_speaker': {
                const [target] = this._matteTargets(store, args);
                if (!target) return { action, success: false, error: 'There is no video clip to work on.' };
                const { trackId, clipId } = target;
                const tm = await this._ensureMatte(trackId, clipId, job);
                if (!tm.ok) return { action, success: false, error: tm.error };
                const result = this._callStore(useTimelineStore.getState(), 'trackSpeaker', trackId, clipId, args.options || {});
                return { action, success: !!result?.success, error: result?.error, segments: result?.segments };
            }
            case 'blur_background': {
                // R92: same free matte path as remove_background, blur look.
                return this.executeStoreAction({ action: 'remove_background', args: { ...args, mode: 'blur' } }, job);
            }
            // ── R90 (A6): beat-synced cutaways + number pops ──────────────────
            // B-roll starts on the word it illustrates, favouring reveal /
            // punchline / emphasis moments; spoken prices and key numbers get a
            // pop on the word. One undo step. Reports what it could not do.
            case 'sync_cutaways': {
                const events = await this._fetchSemanticEvents();
                const { VideoEditorTools } = await import('./VideoEditorTools.js');
                const tools = new VideoEditorTools();
                const st = useTimelineStore.getState();
                if (!Array.isArray(st.captions) || st.captions.length === 0) {
                    return { action, success: false, message: 'Cutaways are placed on the spoken words, so they need a transcript. Run "add captions" first.' };
                }
                let broll = null, pops = null;
                st.beginHistoryGroup();
                try {
                    if (args.broll !== false) broll = await tools.placeContextualBroll({ wordSync: true, events, layout: args.layout || 'fullscreen' }, job?.signal ?? null);
                    if (args.numberPops !== false) pops = tools.placeNumberPops({ events });
                } finally {
                    useTimelineStore.getState().endHistoryGroup();
                }
                const nBroll = Array.isArray(broll?.placements) ? broll.placements.length : 0;
                const nPops = pops?.placed || 0;
                const onMoments = (broll?.placements || []).filter(p => p.event).length;
                if (nBroll === 0 && nPops === 0) {
                    return { action, success: false, message: [broll?.message, pops?.message].filter(Boolean).join(' ') || 'Nothing to place.' };
                }
                const parts = [];
                if (nBroll > 0) parts.push(`${nBroll} b-roll cutaway(s) on the words they illustrate${onMoments ? ` (${onMoments} on key moments)` : ''}`);
                if (nPops > 0) parts.push(`${nPops} number pop(s)`);
                return { action, success: true, message: `Placed ${parts.join(' and ')}.` };
            }

            // ── R91: Reel style, keep the strongest 15-60 s ───────────────────
            case 'extract_short': {
                const st = useTimelineStore.getState();
                const words = Array.isArray(st.captions) ? st.captions : [];
                if (words.length === 0) {
                    return { action, success: false, message: 'Picking the best moment needs a transcript. Run "add captions" first.' };
                }
                const target = Math.min(180, Math.max(10, Number(args.target) || 60));
                const tracks = st.tracks || [];
                const total = tracks.reduce((m, t) => Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
                if (total <= target + 1) {
                    return { action, success: true, message: `The video is already ${Math.round(total)} s, short enough for a ${target} s short. Nothing was cut.` };
                }
                const events = await this._fetchSemanticEvents();
                const win = findBestShortWindow(words, { events, target, min: Math.min(15, target), max: target });
                if (!win) {
                    return { action, success: false, message: 'No sentence-aligned moment of the right length was found in the transcript.' };
                }
                const ranges = rangesOutside(win, total);
                if (ranges.length === 0) {
                    return { action, success: true, message: 'The strongest moment already covers the whole video. Nothing was cut.' };
                }
                const cut = st.cutTimelineRanges(ranges);
                if (!cut) return { action, success: false, message: 'The short could not be cut from the timeline.' };
                const len = Math.round(Math.min(total, win.end + 0.3) - Math.max(0, win.start - 0.15));
                const hook = win.hookEvent ? ' It opens on a key moment.' : '';
                return { action, success: true, message: `Kept the strongest ${len} s (from ${win.start.toFixed(1)} s): "${win.text.slice(0, 80)}".${hook}` };
            }

            // ── R90 (A7): one-click style recipes ────────────────────────────
            case 'apply_style_recipe': {
                const recipe = STYLE_RECIPES[args.recipeId];
                if (!recipe) return { action, success: false, message: `Which style recipe? Choose one: ${Object.keys(STYLE_RECIPES).join(', ')} (for example "apply the punchy recipe").` };
                const done = [];
                const skipped = [];
                const st0 = useTimelineStore.getState();
                st0.beginHistoryGroup();
                try {
                    // 1. Caption look (global), from the style pack.
                    const textTracks = (useTimelineStore.getState().tracks || []).filter(t => t.type === 'text' && (t.clips || []).length > 0);
                    const fields = recipe.captionPack ? stylePackToClipFields(recipe.captionPack) : null;
                    if (fields && textTracks.length > 0) {
                        const first = textTracks[0].clips[0];
                        useTimelineStore.getState().applyCaptionUpdate(fields, { clipId: first.id, scope: 'global', skipHistory: true });
                        done.push('caption style');
                    } else if (fields) {
                        skipped.push('caption style (no captions yet)');
                    }
                    // 2. Keyword emphasis.
                    if (recipe.keywords && textTracks.length > 0) {
                        const r = await autoEmphasizeCaptions({ useLLM: true, source: 'assistant' });
                        if (r.updated > 0) done.push(`key words on ${r.updated} caption(s)`);
                    }
                    // 3. Transitions on the cuts that are scene changes, plus spaced
                    // jump cuts for punchy recipes (R91: not one on every jump cut).
                    const live = useTimelineStore.getState();
                    const base = (live.tracks || []).find(t => t.type === 'video' && (t.clips || []).length > 0);
                    const picked = base ? pickTransitionCuts(base.clips, recipe) : [];
                    if (picked.length > 0) {
                        picked.forEach((clipId, i) => {
                            const tr = recipeTransitionForCut(recipe, i);
                            if (tr) useTimelineStore.getState().addTransition(clipId, tr.type, tr.duration || TRANSITION_DEFAULT_DURATION[tr.type]);
                        });
                        done.push(`transitions on ${picked.length} cut(s)`);
                    } else if (recipe.transitions) {
                        skipped.push(base && base.clips.length > 1 ? 'transitions (no scene change to mark)' : 'transitions (only one clip, no cut)');
                    }
                    // 4. Zoom rhythm (needs a transcript; reported if it cannot run).
                    if (recipe.rhythmZoom) {
                        try {
                            const rz = await this.executeStoreAction({ action: 'rhythm_zoom', args: { style: recipe.rhythmZoom } }, job);
                            if (rz?.success) done.push('zoom rhythm'); else skipped.push('zoom rhythm (needs captions)');
                        } catch (rzErr) {
                            console.warn('[apply_style_recipe] rhythm zoom failed:', rzErr.message);
                            skipped.push('zoom rhythm (service unavailable)');
                        }
                    }
                    // 5. Automatic placements on the words (A6).
                    const hasWords = Array.isArray(useTimelineStore.getState().captions) && useTimelineStore.getState().captions.length > 0;
                    if ((recipe.broll || recipe.numberPops) && hasWords) {
                        const events = await this._fetchSemanticEvents();
                        const { VideoEditorTools } = await import('./VideoEditorTools.js');
                        const tools = new VideoEditorTools();
                        if (recipe.broll) {
                            const br = await tools.placeContextualBroll({ wordSync: true, events, layout: recipe.broll.layout }, job?.signal ?? null);
                            const n = Array.isArray(br?.placements) ? br.placements.length : 0;
                            if (n > 0) done.push(`${n} b-roll cutaway(s)`); else skipped.push('b-roll (none matched the dialogue)');
                        }
                        if (recipe.numberPops) {
                            const pp = tools.placeNumberPops({ events });
                            if (pp.placed > 0) done.push(`${pp.placed} number pop(s)`);
                        }
                    } else if (recipe.broll || recipe.numberPops) {
                        skipped.push('b-roll and number pops (need captions)');
                    }
                    // 6. R92: sound effects on what the recipe placed (whoosh on
                    // transitions, pop on number pops), level from the style.
                    const lvl = sfxLevel(useTimelineStore.getState().editingStyle, recipe.id);
                    if (lvl !== 'none') {
                        const cues = collectSfxCues(useTimelineStore.getState().tracks, { level: lvl });
                        if (cues.length > 0) {
                            const sfx = await this._placeSfxCues(cues, lvl);
                            if (sfx.placed > 0) done.push(`${sfx.placed} sound effect(s)${lvl === 'subtle' ? ' (soft)' : ''}`);
                            else skipped.push('sound effects (none found in the library)');
                        }
                    }
                } finally {
                    useTimelineStore.getState().endHistoryGroup();
                }
                if (done.length === 0) {
                    return { action, success: false, message: `Nothing could be applied yet: ${skipped.join(', ')}.` };
                }
                const skippedText = skipped.length ? ` Skipped: ${skipped.join(', ')}.` : '';
                return { action, success: true, message: `Style recipe applied: ${done.join(', ')}. One undo reverts it.${skippedText}` };
            }

            // ── R92: sound effects on the whole edit ("add sound effects") ────
            case 'auto_sfx': {
                const st = useTimelineStore.getState();
                const level = args.level || sfxLevel(st.editingStyle);
                if (level === 'none') {
                    return { action, success: true, message: 'This editing style is kept calm, so no sound effects were added. Pick another style or add one by name, for example "add a whoosh".' };
                }
                const cues = collectSfxCues(st.tracks, { level });
                if (cues.length === 0) {
                    return { action, success: false, message: 'There is nothing to sound yet: no transitions, number pops, templates or stickers. Add some, or say "add a whoosh" to place one at the playhead.' };
                }
                // The track first (addTrack records its own step), then ONE step for the sounds.
                this._ensureSfxTrack();
                useTimelineStore.getState()._saveHistory?.();
                const { placed, missing } = await this._placeSfxCues(cues, level);
                if (placed === 0) return { action, success: false, message: 'No matching sounds were found in the library.' };
                const soft = level === 'subtle' ? ' Kept soft for this style.' : '';
                const miss = missing.length ? ` No sound found for: ${missing.join(', ')}.` : '';
                return { action, success: true, message: `Added ${placed} sound effect(s) on the transitions and pops.${soft}${miss} One undo removes them.` };
            }

            // ── R92: one named sound at the playhead ("add a whoosh") ──────────
            case 'place_sfx': {
                const st = useTimelineStore.getState();
                const query = String(args.query || 'whoosh').slice(0, 60);
                const asset = await this._fetchSfxAsset(query);
                const url = sfxPlayableUrl(asset);
                if (!asset || !url) return { action, success: false, message: `No "${query}" sound was found in the library. Try another word, like whoosh, pop or riser.` };
                const trackId = this._ensureSfxTrack();
                if (!trackId) return { action, success: false, message: 'The SFX track could not be created.' };
                const at = Number.isFinite(Number(args.at)) ? Number(args.at) : (Number(st.currentTime) || 0);
                useTimelineStore.getState().addClip(trackId, {
                    id: `sfx-${Date.now()}`,
                    type: 'audio',
                    name: asset.display_name || asset.displayName || asset.name || query,
                    url, src: url, sourceUrl: url,
                    assetId: asset.id || null,
                    start: Math.max(0, at),
                    duration: Number(asset.duration) > 0 ? Number(asset.duration) : 1,
                    volume: sfxVolume(asset.recommended_volume, 'full'),
                    isSFX: true,
                });
                return { action, success: true, message: `Added "${asset.display_name || asset.name || query}" at ${at.toFixed(1)} s.` };
            }

            // ── R92 round C: the pro short finish on the MAIN edit ────────────
            // For a project that IS the short (Reel style, or after "make a
            // short"): hook title with written motion, platform captions with
            // key words, camera punch-ins, number pops, transitions, then sound
            // effects. One undo.
            case 'polish_short': {
                const isFinishLayer = c => String(c?.id || '').startsWith('short-') || String(c?.clipId || '').startsWith('short-');
                const st = useTimelineStore.getState();
                const named = platformsFromText(String(args.brief || ''))[0];
                const platform = named || (st.editingStyle === 'reel' ? 'reels' : 'tiktok');
                const profile = PLATFORM_PROFILES[platform];
                const total = (st.tracks || []).reduce((m, t) => Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
                if (!(total > 0)) return { action, success: false, message: 'There is nothing on the timeline to finish yet.' };
                const words = Array.isArray(st.captions) ? st.captions : [];
                const events = await this._fetchSemanticEvents();
                let plan = null;
                const text = words.slice(0, 400).map(w => String(w.word ?? w.text ?? '')).join(' ');
                if (text) {
                    const { fetchShortPlan } = await import('./shortFinisher.js');
                    plan = await fetchShortPlan(text, platform, total);
                }
                // Earlier finish replaced, not stacked.
                const before = JSON.parse(JSON.stringify(st.tracks || []));
                const polished = polishShort({ tracks: before.map(t => ({ ...t, clips: t.clips.filter(c => !isFinishLayer(c)) })), duration: total, aspectRatio: st.aspectRatio },
                    profile, { words, events, plan });
                st._saveHistory?.();
                // Remove the previous finish layers, then write the changes clip by clip.
                for (const t of (useTimelineStore.getState().tracks || [])) {
                    for (const c of (t.clips || [])) {
                        if (isFinishLayer(c)) useTimelineStore.getState().removeClip(t.id, c.id, { skipHistory: true });
                    }
                }
                const origById = new Map(before.flatMap(t => t.clips.map(c => [c.id, { trackId: t.id, clip: c }])));
                const FIELDS = ['animations', 'animation', 'transition', 'emphasis', 'x', 'y', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'stroke', 'textShadow', 'captionStyle', 'textAlign', 'layerTarget', 'layerMask'];
                const newTrackIds = {};
                for (const t of polished.tracks) {
                    for (const c of t.clips) {
                        const orig = origById.get(c.id);
                        if (orig) {
                            const patch = {};
                            for (const k of FIELDS) if (JSON.stringify(c[k]) !== JSON.stringify(orig.clip[k]) && c[k] !== undefined) patch[k] = c[k];
                            if (Object.keys(patch).length) useTimelineStore.getState().updateClip(orig.trackId, c.id, patch, { skipHistory: true });
                            continue;
                        }
                        // A new layer: the hook title, its underline, number pops.
                        if (!newTrackIds[t.id]) {
                            const live = useTimelineStore.getState();
                            const existing = live.tracks.find(x => x.type === t.type && x.name === t.name);
                            newTrackIds[t.id] = existing?.id || live.addTrack(t.type);
                            if (!existing && newTrackIds[t.id]) useTimelineStore.getState().renameTrack?.(newTrackIds[t.id], t.name);
                        }
                        if (newTrackIds[t.id]) useTimelineStore.getState().addClip(newTrackIds[t.id], c, { skipHistory: true });
                    }
                }
                let sfxNote = '';
                const lvl = sfxLevel(useTimelineStore.getState().editingStyle) === 'none' ? 'none' : profile.sfx;
                if (lvl !== 'none') {
                    const cues = collectSfxCues(useTimelineStore.getState().tracks, { level: lvl });
                    if (cues.length) {
                        const r = await this._placeSfxCues(cues, lvl);
                        if (r.placed) sfxNote = `, ${r.placed} sound effect(s)`;
                    }
                }
                const by = plan?.headline ? `AI headline "${plan.headline}", ` : '';
                return { action, success: true, message: `Finished for ${profile.label}: ${by}${polished.applied.join(', ')}${sfxNote}. One undo reverts it.`, details: { applied: polished.applied, platform } };
            }

            // ── R92 round B: several shorts from one long video ──────────────
            // One per platform (TikTok, Reels, Shorts) unless the request names
            // platforms or a count. Saved as a list for the Shorts tab; the
            // main edit is not changed.
            case 'repurpose_shorts': {
                const st = useTimelineStore.getState();
                const words = Array.isArray(st.captions) ? st.captions : [];
                if (words.length === 0) {
                    return { action, success: false, message: 'Finding the best moments needs a transcript. Run "add captions" first, then ask again.' };
                }
                const count = Math.max(1, Math.min(5, Number(args.count) || 3));
                const platforms = assignPlatforms(count, Array.isArray(args.platforms) ? args.platforms : []);
                const total = (st.tracks || []).reduce((m, t) => Math.max(m, ...(t.clips || []).map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))), 0);
                const slots = platforms.map(id => {
                    const p = PLATFORM_PROFILES[id];
                    const [lo, hi] = p.length.ideal;
                    return { platform: id, min: Math.max(p.length.min, lo * 0.75), max: Math.min(p.length.max, hi * 1.3), target: (lo + hi) / 2 };
                });
                if (total < Math.min(...slots.map(s => s.min)) + 5) {
                    return { action, success: false, message: `The video is ${Math.round(total)} s long, too short to cut shorts out of. It can be exported as one short as it is.` };
                }
                const events = await this._fetchSemanticEvents();
                const found = findShortCandidates(words, { events, slots });
                if (found.length === 0) {
                    return { action, success: false, message: 'No sentence-aligned moments of the right length were found in the transcript.' };
                }
                const now = Date.now();
                const shorts = found.map((f, i) => ({
                    id: `short-${now.toString(36)}-${i}`,
                    platform: f.platform,
                    start: Math.round(f.start * 100) / 100,
                    end: Math.round(f.end * 100) / 100,
                    score: Math.round(f.score * 100) / 100,
                    hookEvent: f.hookEvent || null,
                    title: String(f.text || '').slice(0, 90),
                    createdAt: now,
                    exportUrl: null,
                    // R92 round C: the moments inside this short (timeline time),
                    // so its camera punches land on them at export.
                    events: (events || []).filter(e => Number(e?.timelineTime) >= f.start && Number(e?.timelineTime) <= f.end)
                        .slice(0, 12).map(e => ({ eventType: e.eventType, timelineTime: Number(e.timelineTime) })),
                }));
                st.setShorts(shorts);
                try { useAIStore.getState().setActiveTab?.('shorts'); } catch { /* panel switch is a convenience */ }
                const lines = shorts.map(s => `${PLATFORM_PROFILES[s.platform].label}: ${Math.round(s.end - s.start)} s from ${s.start.toFixed(0)} s, "${s.title.slice(0, 50)}"`);
                const missing = count - shorts.length;
                const missText = missing > 0 ? ` ${missing} more could not fit without overlapping.` : '';
                return {
                    action, success: true,
                    message: `Found ${shorts.length} short(s): ${lines.join('; ')}.${missText} In the Shorts tab each one exports finished: AI hook title with motion, platform captions, camera punch-ins, number pops, transitions and sound effects. Your main edit is unchanged.`,
                    details: { count: shorts.length, platforms: shorts.map(s => s.platform) },
                };
            }

            // ── R92: custom motion written from a description ────────────────
            case 'compose_motion': {
                const st = useTimelineStore.getState();
                const brief = String(args.brief || '').trim() || 'animate it';
                const { layers, label } = pickMotionTargets(st.tracks || [], brief, st.selectedClipIds || []);
                if (layers.length === 0) {
                    return { action, success: false, message: 'There is no title, caption or graphic to animate yet. Add text or a graphic first.' };
                }
                let scripts = null;
                let source = 'rules';
                let notes = null;
                try {
                    const res = await authFetch('/api/motion/compose', {
                        method: 'POST',
                        body: JSON.stringify({ brief, layers: layersForPrompt(layers), editingStyle: st.editingStyle ?? null }),
                        signal: job?.signal,
                    });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok && data?.layers) { scripts = data.layers; source = data.source || 'rules'; notes = data.notes || null; }
                } catch (mErr) {
                    if (mErr?.name === 'AbortError') throw mErr;
                    console.warn('[compose_motion] motion route unavailable, using rules:', mErr.message);
                }
                st._saveHistory?.();
                let applied = 0;
                const verbs = new Set();
                for (const l of layers) {
                    const duration = Math.max(0.2, Number(l.clip.duration) || 3);
                    const kind = l.kind === 'shape' ? 'shape' : l.kind;
                    const script = scriptFor(l, scripts) || planMotionFromBrief(brief, { duration });
                    let { animations } = composeMotion(script, { duration, kind, source: COMPOSED });
                    if (animations.length === 0) ({ animations } = composeMotion(planMotionFromBrief(brief, { duration }), { duration, kind, source: COMPOSED }));
                    if (animations.length === 0) continue;
                    (script.beats || []).forEach(b => b?.verb && verbs.add(String(b.verb)));
                    useTimelineStore.getState().updateClip(l.trackId, l.clip.id, { animations, animation: 'none' }, { skipHistory: true });
                    applied += 1;
                }
                if (applied === 0) return { action, success: false, message: 'No motion could be built from that description. Try naming a motion, for example "slam in" or "float".' };
                const by = source === 'llm' ? 'written by the AI' : source === 'mixed' ? 'partly written by the AI' : 'built from the motion library';
                const what = verbs.size ? ` (${[...verbs].slice(0, 6).join(', ')})` : '';
                return { action, success: true, message: `Animated ${applied} layer(s), ${label}${what}, ${by}.${notes ? ` ${notes}` : ''} One undo reverts it.`, details: { applied, source, verbs: [...verbs] } };
            }

            // R68 — AI Animation Intelligence. "Brain chooses animations.
            // Users don't." Explicit command, autonomous execution: one call
            // detects reveal/punchline/emphasis/emotional-beat moments on the
            // server (TimelineEventDetector.js), resolves each through
            // AnimationKnowledgeGraph.js into a real preset id + real SFX
            // rows, and this case applies the whole plan as ONE undoable
            // action — the same `_saveHistory()`-once-then-`skipHistory`
            // fan-out pattern already used by the `$ALL_CLIPS` branches above.
            case 'animate_automatically': {
                const aaStore = useTimelineStore.getState();
                try {
                    // See _tracksWithDerivedAudioPeaks — without this, video clips
                    // never carry the peak markers PUNCHLINE_DETECTED/EMPHASIS_MOMENT
                    // need, so the brain could only ever animate text.
                    const aaTracks = this._tracksWithDerivedAudioPeaks(aaStore);
                    // Timeline-time words: the detector reads pauses in the
                    // speech from them (gaps between clips are gone once a
                    // video is cleaned up).
                    const aaWords = (aaStore.captions || [])
                        .map(w => ({ start: Number(w?.start), end: Number(w?.end) }))
                        .filter(w => Number.isFinite(w.start) && Number.isFinite(w.end));
                    // R82 — projectId lets the route do a READ-ONLY lookup of
                    // this project's already-cached tone (ProjectIntelligence
                    // .getMap(), never a fresh/paid computation) to flavour
                    // which secondary preset gets combined in. Omitted/null
                    // (no project open yet) just means no tone signal.
                    const aaRes = await authFetch('/api/audio/animate-automatically', {
                        method: 'POST',
                        // R91: podcast / interview get softer motion and no impact SFX (server side).
                        body: JSON.stringify({ projectState: { tracks: aaTracks, words: aaWords }, projectId: aaStore.projectId || null, editingStyle: aaStore.editingStyle || null }),
                    });
                    const aaData = await aaRes.json();
                    if (!aaRes.ok) {
                        return { action, success: false, error: aaData.error || 'animate-automatically failed' };
                    }

                    // The strongest moments, spaced out (animateMoments.js).
                    const plan = selectAnimateMoments(aaData.plan || [], aaStore.duration);
                    if (plan.length === 0) {
                        return {
                            action, success: true,
                            message: 'No reveal, punchline, emphasis, or emotional-beat moments detected to animate.',
                        };
                    }

                    // ONE undo step: clearing the previous run + this run.
                    aaStore._saveHistory?.();
                    this._clearAutoAnimate();

                    let animatedCount = 0, sfxCount = 0, sfxTrackId = null;
                    let lastSfxAt = -Infinity; // one sound effect per moment
                    // R92: Reel/Vlog full, Talking head soft, Podcast/Interview none.
                    const aaSfxLevel = sfxLevel(aaStore.editingStyle);

                    for (const item of plan) {
                        if (item.presetId && item.clipId) {
                            // Always the LIVE clip: two moments on one clip must
                            // both land (the second used to overwrite the first
                            // from a stale copy).
                            const live = useTimelineStore.getState();
                            const { trackId, clipId } = this._findClipAndTrack(live, item.clipId);
                            const clip = clipId
                                ? (live.tracks || []).find(t => t.id === trackId)?.clips?.find(c => c.id === clipId)
                                : null;
                            if (clip) {
                                // Play AT the detected moment, not at the clip's
                                // first frame (presets are authored at 0).
                                const at = Math.max(0, (Number(item.timelineTime) || 0) - (Number(clip.start) || 0));
                                // R81 intensity / R82 secondary preset, as before.
                                const updates = applyPresetToClip(clip, item.presetId, {
                                    intensity: item.intensity,
                                    secondaryPresetId: item.secondaryPresetId,
                                    source: AUTO_ANIMATE,
                                    at,
                                });
                                if (updates.animations) {
                                    live.updateClip(trackId, clipId, updates, { skipHistory: true });
                                    animatedCount++;
                                }
                            }
                        }

                        // Top SFX pick only — ranking (use_count desc) comes from
                        // TaxonomyService, so index 0 is the best match.
                        const topSfx = item.sfx?.[0];
                        const sfxUrl = sfxPlayableUrl(topSfx);
                        if (aaSfxLevel !== 'none' && topSfx && sfxUrl && Number(item.timelineTime) - lastSfxAt > CLUSTER_S) {
                            lastSfxAt = Number(item.timelineTime);
                            const live = useTimelineStore.getState();
                            if (!sfxTrackId) {
                                const existingSfxTrack = live.tracks?.find(t => t.type === 'audio' && t.name === 'SFX');
                                sfxTrackId = existingSfxTrack?.id || live.addTrack('audio');
                                if (sfxTrackId && !existingSfxTrack) useTimelineStore.getState().renameTrack(sfxTrackId, 'SFX');
                            }
                            if (sfxTrackId) {
                                useTimelineStore.getState().addClip(sfxTrackId, {
                                    id:          `sfx-${item.eventType}-${Math.round(item.timelineTime * 1000)}-${Date.now()}`,
                                    type:        'audio',
                                    name:        topSfx.display_name || topSfx.displayName || topSfx.name || 'SFX',
                                    url:         sfxUrl,
                                    src:         sfxUrl,
                                    sourceUrl:   sfxUrl,
                                    assetId:     topSfx.id || null,
                                    start:       Math.max(0, item.timelineTime),
                                    duration:    Number(topSfx.duration) > 0 ? Number(topSfx.duration) : 1,
                                    volume:      sfxVolume(topSfx.recommended_volume, aaSfxLevel),
                                    isSFX:       true,
                                    // Marks it as this command's own, so a re-run
                                    // replaces it instead of stacking another.
                                    autoAnimate: true,
                                }, { skipHistory: true });
                                sfxCount++;
                            }
                        }
                    }

                    return {
                        action, success: true,
                        message: `Animated ${countMoments(plan)} moment${countMoments(plan) !== 1 ? 's' : ''} (${animatedCount} layer${animatedCount !== 1 ? 's' : ''})` +
                            (sfxCount > 0 ? ` and added ${sfxCount} sound effect${sfxCount !== 1 ? 's' : ''}` : '') +
                            `, on the reveals, punchlines and key moments the AI found.`,
                    };
                } catch (err) {
                    console.warn('[animate_automatically] failed:', err.message);
                    return { action, success: false, error: err.message };
                }
            }
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
                // The server finds the phrase in the captions the client sent
                // (store.captions). Once captions have been placed on an edited
                // timeline those words are in TIMELINE time (each carries
                // srcStart from transcriptMap.js), so cut the timeline range,
                // same as the transcript panel. Raw source-time captions keep
                // the old source-range cut.
                const timelineWords = Array.isArray(store.captions) && store.captions.some(w => w && w.srcStart !== undefined);
                if (timelineWords && typeof store.cutTimelineRange === 'function') {
                    store.cutTimelineRange(srcStart, srcEnd);
                    return { action, success: true, message: `Cut ${srcStart.toFixed(1)}s–${srcEnd.toFixed(1)}s` };
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
            case 'identify_quotable_moments':
            case 'place_contextual_broll':
            case 'apply_lut':
            case 'clear_lut':
            case 'emphasize_keywords':
            case 'clear_keywords':
            case 'add_template':
            case 'layout_split_screen':
            case 'layout_picture_in_picture':
            case 'layout_fullscreen':
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
            // Each clip is a shot; a long clip is split into virtual shots at
            // sentence ends and pauses (rhythmShots.js), so a single uncut
            // recording works too and nothing is cut. The server picks a shot
            // type and motion per shot from that shot's SOURCE-time words; the
            // result becomes one scale-keyframe track per clip, written as ONE
            // undo step.
            case 'rhythm_zoom': {
                const rzStore = useTimelineStore.getState();
                // MULTI-TRACK: after split_speakers there is one video track per
                // speaker; every video track's clips take part, in timeline order.
                const rzVideoTracks = (rzStore.tracks ?? []).filter(t => t.type === 'video');
                const rzClips = rzVideoTracks
                    .flatMap(t => (t.clips ?? []).map(c => ({ ...c, _trackId: t.id })))
                    .filter(c => (Number(c.duration) || 0) > 0)
                    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
                const rzStyle = args.style || 'dynamic';

                if (rzClips.length === 0) {
                    return { action, success: false, message: 'Add a video to the timeline first, then try "add zoom rhythm" again.' };
                }

                const rzAssetById = new Map((rzStore.assets || []).map(a => [a.id, a]));
                const rzWordsFor = (clip) => clipSourceWords(
                    clip,
                    findTranscript(rzStore, rzAssetById.get(clip.assetId) || null),
                    rzStore.captions,
                );
                const { shots, payloadClips, words: rzWords } = buildRhythmRequest(
                    rzClips, rzWordsFor, (clip) => rzAssetById.get(clip.assetId)?.name || null,
                );

                if (rzWords.length === 0) {
                    return {
                        action, success: false,
                        message: `Zoom rhythm syncs with your speech to decide when to zoom in or out, so it needs a transcript.\n\nRun "add captions" to generate one, then try "add zoom rhythm" again.`,
                    };
                }

                console.log(`[MediaExecutionEngine] rhythm_zoom: ${rzClips.length} clips → ${shots.length} shots, ${rzWords.length} words, style=${rzStyle}`);

                const rzRes  = await authFetch('/api/interview/rhythm-zoom', {
                    method: 'POST',
                    body: JSON.stringify({ clips: payloadClips, words: rzWords, style: rzStyle, editingStyle: useTimelineStore.getState().editingStyle || null }),
                    // R91: a stalled request must not hold a recipe / Auto run open.
                    signal: timeoutSignal(120_000),
                });
                const rzData = await rzRes.json();
                if (!rzRes.ok) throw new Error(rzData.error || `rhythm-zoom error ${rzRes.status}`);

                const { clipZooms, summary } = rzData;
                const rzDurById = new Map(rzClips.map(c => [c.id, Number(c.duration) || 0]));
                const rzKeyframes = shotsToKeyframes(shots, clipZooms, (id) => rzDurById.get(id));

                // A plan that matches no clip on the timeline (deleted or
                // re-segmented between request and answer) changes nothing, and
                // must not report the server's counts as if it had.
                const rzTargets = rzClips.filter(c => (rzKeyframes.get(c.id) || []).length > 0);
                const rzApplied = rzTargets.length; // clips that actually receive keyframes
                if (rzApplied === 0) {
                    return {
                        action,
                        success: false,
                        message: "The zoom plan didn't match any clips currently on the timeline — nothing was changed. Try re-running it.",
                    };
                }

                // One undo step for the whole rhythm (it used to be one per
                // keyframe: about three undos per shot).
                rzStore._saveHistory?.();
                rzTargets.forEach(clip => {
                    useTimelineStore.getState().updateClip(clip._trackId, clip.id, {
                        keyframes: { ...(clip.keyframes || {}), scale: rzKeyframes.get(clip.id) },
                    }, { skipHistory: true });
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
                        `across ${shots.length} shots, with ${motions.push_in ?? 0} slow push-ins.${punchNote}`,
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
                        // assetId unlocks the server's stored media_assets profile
                        // (Organize v2) — without it every clip falls back to live
                        // frame extraction even when the footage was analysed at upload.
                        assetId:    clip.assetId || asset?.id || null,
                        assetName,
                        // PER-ASSET storage key. `uploadedFilePath` is a single global
                        // field each upload overwrites (R21), so sending it as the
                        // primary path made every clip in a batch resolve to the SAME
                        // source file — frames for clip 2..N came from clip 1's video.
                        // Kept only as a last-resort fallback for the legacy flow.
                        gcsPath:    asset?.gcsPath || null,
                        filePath:   asset?.gcsPath ? null : (uploadedFP || null),
                        offset:     clipOffset,
                        duration:   clip.duration ?? 0,
                        transcript: transcript || undefined,
                    };
                });

                console.log(`[organize_clips] ${clipPayload.length} clips → POST /api/interview/organize-clips`);

                // FIX: DirectorIntelligence's 'hook_buried' and 'through_line_buried'
                // proposals both route to this same command when the STORED story map
                // (server/brain/StoryIntelligence.js) found the hook in the wrong place
                // or the order burying the through-line — but until now that call was
                // indistinguishable from a bare "organize my clips" with no memory of
                // what was actually wrong. args.storyHints (set by DirectorIntelligence's
                // proposal params, see CommandCompiler.compileOrganizeClips) carries the
                // specific finding forward so the SAME re-organize call can act on it.
                const storyHints = args.storyHints || null;

                let orderMsg = '';
                try {
                    const ocRes  = await authFetch('/api/interview/organize-clips', {
                        method: 'POST',
                        // projectId lets the server run the SAME real analysis
                        // (MediaIntelligencePipeline) it queues at upload for any
                        // clip that doesn't have a stored profile yet, instead of
                        // writing a media_assets row with no project attached.
                        body:   JSON.stringify({
                            clips: clipPayload,
                            projectId: ocStore.projectId || null,
                            storyHints,
                            // R91: vlog / interview / podcast keep the recorded order.
                            editingStyle: ocStore.editingStyle || null,
                        }),
                    });
                    const ocData = await ocRes.json();

                    if (!ocRes.ok) {
                        throw new Error(ocData.error || `organize-clips returned ${ocRes.status}`);
                    }

                    const {
                        orderedIds = [], clipMeta = [], rationale = '',
                        pipeline = '', coverage = null, reason = '',
                    } = ocData;

                    // R30: the server returns an EMPTY order when it had no
                    // profile and no readable frame for any clip. Reordering on
                    // that would be arbitrary, and calling it "semantically
                    // organized" is the exact failure this guard exists to stop.
                    if (pipeline === 'none' || orderedIds.length === 0) {
                        console.warn(`[organize_clips] no ordering signal — ${reason || 'server returned no order'}`);
                        return {
                            action,
                            success: justPlaced > 0,
                            message: justPlaced > 0
                                ? `${placedMsg}\n\nI couldn't order them yet — ${reason || 'your footage is still being analysed'}. Ask me again once analysis finishes.`
                                : `I couldn't organize these clips — ${reason || 'your footage is still being analysed'}. Ask me again once analysis finishes.`,
                        };
                    }

                    // Partial coverage: some clips were placed on real analysis,
                    // others on nothing. Say which rather than implying all N
                    // were understood equally.
                    let coverageNote = '';
                    if (coverage && coverage.unanalyzed > 0) {
                        coverageNote =
                            `\n\nNote: ${coverage.unanalyzed} of ${coverage.total} clip(s) hadn't finished analysing, ` +
                            `so I placed them conservatively. Re-run this once analysis completes for a better order.`;
                    }

                    if (orderedIds.length > 0) {
                        const currentIds   = allClips.map(c => c.id);
                        const alreadySorted = orderedIds.every((id, i) => id === currentIds[i]);

                        if (alreadySorted) {
                            orderMsg = `Clips are already in the recommended order. ${rationale}${coverageNote}`;
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

                            console.log(`[organize_clips] reordered ${orderedIds.length} clips (${pipeline}) — ${orderDesc}`);
                            orderMsg = `Semantically organized ${orderedIds.length} clips.\n\n${rationale}\n\nOrder: ${orderDesc}${coverageNote}`;
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
                    const s = clip.offset ?? 0, e = s + (clip.duration ?? 0) * (clip.speed || 1);
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
     * Captions for a timeline built from one or more source files.
     * 1. Each main-track source without a verified (source-time) transcript is
     *    transcribed, one at a time (the audio worker runs one job at a time,
     *    and a queued job must not sit out its own poll timeout). A file the
     *    background upload transcription is still working on is waited for
     *    instead of being transcribed twice. Each finished transcript is saved
     *    right away, so an interrupted run resumes where it stopped.
     * 2. All transcripts are mapped through the clips that play them
     *    (timeline/transcriptMap.js) and replace the caption clips.
     * Files that fail are skipped; captions still go on the clips that have
     * words. Running out of AI operations stops the loop and shows the
     * upgrade prompt, like every other quota hit.
     */
    async _captionMainTrackSources(sources, resolvedPayload, job, endpoint) {
        // Per-file progress for the mobile Roka bar (useAIStore.captionProgress).
        // Only shown when there is more than one video; always cleared at the end.
        const showProgress = sources.length > 1;
        const progress = sources.map(s => ({ key: s.key, name: s.name || s.key, state: 'waiting' }));
        const setFile = (key, state) => {
            if (!showProgress) return;
            const f = progress.find(x => x.key === key);
            if (f) f.state = state;
            useAIStore.getState().setCaptionProgress?.({ files: progress.map(x => ({ ...x })) });
        };
        try {
            return await this._captionMainTrackSourcesRun(sources, resolvedPayload, job, endpoint, setFile, progress);
        } finally {
            if (showProgress) useAIStore.getState().setCaptionProgress?.(null);
        }
    }

    async _captionMainTrackSourcesRun(sources, resolvedPayload, job, endpoint, setFile, progress) {
        const isDone = (key) => {
            const s = useTimelineStore.getState();
            return !!s.transcriptVerified?.[key] && Array.isArray(s.transcripts?.[key]) && s.transcripts[key].length > 0;
        };
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const failed = [];
        let quotaHit = false;
        let transcribed = 0;
        let noSpeech = 0;

        // The whole job has a single 5-min budget (runJob), sized for ONE
        // Whisper run. With several files to transcribe, give it one budget per
        // file so a 3-file edit isn't cancelled halfway. Never shortens it.
        const pending = sources.filter(s => !isDone(s.key)).length;
        if (pending > 1 && job.timeoutHandle) {
            clearTimeout(job.timeoutHandle);
            job.timeoutHandle = setTimeout(() => {
                console.warn(`[MediaExecutionEngine] Job ${job.id} timed out`);
                job.cancel();
                job.setState(EXECUTION_STATES.TIMEOUT);
                job.error = 'Execution timed out';
            }, pending * TIMEOUTS.API_CALL);
        }

        for (const { key } of sources) if (isDone(key)) { const f = progress.find(x => x.key === key); if (f) f.state = 'done'; }
        setFile(null, null);

        for (const { key, path } of sources) {
            if (job.signal.aborted) throw new Error('API call cancelled');
            if (isDone(key)) continue;
            setFile(key, 'running');

            // Upload-time background transcription of this same file still
            // running → wait for it (bounded) rather than paying for it twice.
            const waitUntil = Date.now() + 330_000;
            while (transcriptionManager.isTranscribing(path) && Date.now() < waitUntil) {
                if (job.signal.aborted) throw new Error('API call cancelled');
                await sleep(1000);
            }
            if (isDone(key)) { setFile(key, 'done'); continue; }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.API_CALL);
            const onAbort = () => controller.abort();
            job.signal.addEventListener('abort', onAbort, { once: true });
            try {
                console.log(`[MediaExecutionEngine] 💬 captions: transcribing "${path}"`);
                const response = await authFetch(endpoint, {
                    method: 'POST',
                    body: JSON.stringify({ ...resolvedPayload, filename: path }),
                    signal: controller.signal,
                });
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    if (response.status === 402 || body?.error === 'AI_OPS_LIMIT') {
                        EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                            reason: 'ai_ops',
                            message: body?.message || "You've used all your AI operations this month.",
                            upgradeRequired: body?.upgradeRequired || 'creator',
                        });
                        quotaHit = true;
                        setFile(key, 'failed');
                        break;
                    }
                    throw new Error(`API error ${response.status}: ${body?.error || body?.message || response.statusText}`);
                }
                let result = await response.json();
                if (result?.jobId) result = await pollJobResult(result.jobId, job.signal);
                const words = Array.isArray(result?.words) ? result.words : [];
                if (words.length > 0) {
                    // Source-time words for THIS file → transcripts[key], marked verified.
                    useTimelineStore.getState().setCaptions(words, path);
                    transcribed++;
                    setFile(key, 'done');
                } else {
                    noSpeech++;
                    setFile(key, 'done');
                    console.warn(`[MediaExecutionEngine] captions: no words for "${path}" (no speech?)`);
                }
            } catch (err) {
                if (job.signal.aborted || err?.message === 'Polling cancelled') throw new Error('API call cancelled');
                console.error(`[MediaExecutionEngine] captions: transcription failed for "${path}":`, err);
                failed.push(key);
                setFile(key, 'failed');
            } finally {
                clearTimeout(timeoutId);
                job.signal.removeEventListener('abort', onAbort);
            }
        }

        if (job.signal.aborted) throw new Error('API call cancelled');

        const store = useTimelineStore.getState();
        const verified = {};
        for (const [k, v] of Object.entries(store.transcripts || {})) {
            if (store.transcriptVerified?.[k]) verified[k] = v;
        }
        const words = mapTranscriptToTimeline({ tracks: store.tracks, assets: store.assets, transcripts: verified });
        console.log(`[MediaExecutionEngine] 💬 captions: ${sources.length} source file(s), ${transcribed} transcribed now, ${failed.length} failed, ${words.length} words on the timeline`);

        if (words.length === 0) {
            return {
                engine: 'api', success: false, endpoint,
                error: quotaHit
                    ? "You've used all your AI operations this month."
                    : failed.length > 0
                        ? 'Transcription failed, so no captions could be placed. Try again in a moment.'
                        : 'No speech was found in this video, so there are no captions to add.',
            };
        }

        store.setTimelineTranscript?.(words);
        const captions = groupWordsIntoCaptions(words);
        console.log(`[MediaExecutionEngine] 💬 captions: adding ${captions.length} caption clips`);
        store.addCaptionClips(captions);

        // Files still without words, not counting ones that simply have no speech.
        const missing = Math.max(0, sources.filter(s => !isDone(s.key)).length - noSpeech);
        return {
            engine: 'api', success: true, endpoint,
            result: { text: words.map(w => w.word).join(' '), words },
            ...(missing > 0 ? { message: `Captions added. ${missing} of ${sources.length} video files couldn't be transcribed, so their clips have no captions yet.` } : {}),
        };
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
                        // Prefer the asset's own gcsPath field — set directly at upload
                        // time (IDELayout.jsx: updateAsset(assetId, { gcsPath })) and
                        // always exactly correct, including the Date.now()-prefixed
                        // filename GCS actually stores the raw upload under. The
                        // sourceUrl/proxyUrl regex fallback below can't reconstruct
                        // that timestamp prefix from a proxy URL (proxies are named
                        // differently from raw uploads), which was silently sending
                        // a filename-only path to the server — producing "File not
                        // found locally and GCS download failed" once the server
                        // guessed a raw/{userId}/{filename} path missing the prefix.
                        if (videoAsset.gcsPath) {
                            serverPath = videoAsset.gcsPath;
                        } else {
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
                }

                resolvedPayload[key] = serverPath || store.uploadedFile?.name || 'video.mp4';
                console.log(`[MediaExecutionEngine] Resolved $uploaded_file → "${resolvedPayload[key]}"`);
            }
        }

        // /api/luts/recommend requires projectState OR projectId (server-side
        // R75 fix). CommandCompiler is pure/sync and cannot read the store, so
        // compileRecommendLUTs' payload only ever has { limit } — without this,
        // every AI-triggered "recommend a lut" (typed or a Brain suggestion
        // accept) 400'd. Injecting projectId here lets the server derive the
        // rest (tone, etc.) itself, mirroring the storyHints pattern.
        if (endpoint === '/api/luts/recommend' && !resolvedPayload.projectId) {
            resolvedPayload.projectId = store.projectId || null;
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
            // Every source file heard on the main track gets its own
            // transcript (one Whisper run per file that doesn't have a verified
            // one yet), then all of them are mapped through the clips. This
            // used to transcribe only $uploaded_file, so clips from any other
            // file got no captions at all.
            const sources = listMainTrackSources(store.tracks, store.assets);
            if (sources.length > 0) {
                return await this._captionMainTrackSources(sources, resolvedPayload, job, endpoint);
            }

            const bname = (p) => (p || '').split(/[\\/]/).pop();
            const processedFile = Object.entries(resolvedPayload).find(([, v]) => typeof v === 'string' && (v.startsWith('raw/') || v.startsWith('temp/')));
            const processedBase = processedFile ? bname(processedFile[1]) : bname(store.uploadedFilePath);

            // Only reuse a transcript known to be in SOURCE time. `store.captions`
            // is no longer a fallback: after any edit it holds TIMELINE-time
            // words, and re-mapping those through clip offsets a second time is
            // exactly what desynced captions. Unknown → fresh Whisper below.
            const originalWords = (processedBase && store.transcriptVerified?.[processedBase]
                && store.transcripts?.[processedBase]?.length > 0)
                ? store.transcripts[processedBase]
                : null;

            if (originalWords?.length > 0) {
                // Re-map word timestamps through the current clip positions so captions
                // are in sync with the edited timeline (not the raw source file).
                const timelineWords = deriveTimelineTranscript(store.tracks, originalWords);
                const words = timelineWords || originalWords.map(c => ({ word: c.word || c.content || c.text || '', start: c.start, end: c.end }));
                console.log(`[MediaExecutionEngine] ⚡ autoCaptions: derived ${words.length} words from timeline — skipping Whisper`);

                // Apply captions inline — the normal autoCaptions handler at the bottom
                // of this function is never reached when we return early, so we must
                // call setCaptions and addCaptionClips here before returning.
                // TIMELINE-time words → store.captions only. This used to be
                // setCaptions(words, processedBase), which OVERWROTE the file's
                // source-time transcript with timeline-time words, so every later
                // caption run / transcript view re-mapped already-mapped times.
                if (store.setTimelineTranscript) store.setTimelineTranscript(words);
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
        // Retakes: ONE video's transcript in SOURCE time (retakeSource.js) —
        // it used to send timeline-time captions (wrong places once silences
        // were cut) or every video's words flattened together.
        let retakeAssetId = null;
        if (endpoint === '/api/ai/detect-repeated-takes') {
            const source = resolveRetakeSource(store, {
                assetId:  command.args?.asset_id || null,
                filePath: resolvedPayload.filename || store.uploadedFilePath || null,
            });

            if (!source.error && source.words.length > 0) {
                retakeAssetId = source.assetId;
                resolvedPayload.words = source.words;
                const asset = store.assets?.find(a => a.id === source.assetId);
                resolvedPayload.totalDuration = Number(asset?.sourceDuration || asset?.duration) || source.words[source.words.length - 1].end;
                resolvedPayload.language = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language.slice(0, 5) : null;
                // Remove filename field — endpoint doesn't use it
                delete resolvedPayload.filename;
                console.log(`[MediaExecutionEngine] Injected ${resolvedPayload.words.length} source-time words (asset ${retakeAssetId}) for detect-repeated-takes`);
            } else {
                // Bail with an actionable message rather than POSTing a payload
                // the endpoint is guaranteed to reject (it 400s without `words`).
                // Repeated-take detection is purely transcript-driven — there is
                // no audio fallback — so "no transcript" is a precondition
                // failure the user can actually fix, not a server error.
                console.warn('[MediaExecutionEngine] detect-repeated-takes: no transcript in store — aborting');
                if (command.args?.optional) {
                    // Part of a full clean-up: silences/fillers still apply.
                    return { engine: 'api', success: true, endpoint, skipped: true, message: 'Repeated takes skipped: they need a transcript. Add captions, then say "remove repeated takes".' };
                }
                return {
                    engine: 'api',
                    success: false,
                    endpoint,
                    error: 'Repetition removal needs a transcript. Run "Generate captions" first, then try again.',
                };
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
                        // Quota exhausted — surface a user-friendly upgrade message.
                        // Previously this just threw, and the message ended up (at
                        // best) as a line of chat/log text with no way to act on it
                        // — no button, no link to checkout. Emitting on the shared
                        // QUOTA_EXCEEDED channel lets IDELayout show a real upgrade
                        // modal wired to /api/checkout/create; the throw below is
                        // kept so existing callers that surface err.message still
                        // get a readable string.
                        const msg = errorBody.message || "You've used all your AI operations this month.";
                        const upgrade = errorBody.upgradeRequired ? ` Upgrade to ${errorBody.upgradeRequired} to continue.` : '';
                        EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, {
                            reason: 'ai_ops',
                            message: msg,
                            upgradeRequired: errorBody.upgradeRequired || 'creator',
                        });
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
                    fillerSegments = await this._refineCutPointFrames(fillerSegments, resolvedPayload?.filename || null, fillerAssetId);
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
            if ((command.action === 'audioDenoise' || command.action === 'audioNormalize' || command.action === 'audioEnhance') && result?.url) {
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
            if (command.action === 'detectRepeatedTakes') {
                const takeSegs = result?.activeSegments || [];
                // removedCount === 0 means the backend scanned and found nothing
                // to cut. Report that honestly instead of letting the generic
                // API-success path claim the edit was applied — a command that
                // says "done" over a visually identical timeline is the exact
                // failure mode this whole path was rewired to eliminate.
                if (takeSegs.length === 0 || result?.removedCount === 0) {
                    if (command.args?.optional) {
                        return { engine: 'api', success: true, endpoint, skipped: true, message: 'No repeated takes found, nothing to remove there.' };
                    }
                    return {
                        engine: 'api',
                        success: false,
                        endpoint,
                        error: 'No repeated takes found — nothing was changed. The transcript had no segments similar enough to be a re-take.',
                    };
                }
                // Show what was found before cutting (approval sheet / dialog).
                if (Array.isArray(result?.groups) && result.groups.length > 0) {
                    // R92: Auto mode runs hands-free, so it takes the AI's retake picks.
                    const { isAutopilotRunning } = await import('./StyleAutopilot.js');
                    const approved = isAutopilotRunning() ? true : await this._reviewRetakes(result.groups, job.signal);
                    if (!approved) {
                        return { engine: 'api', success: true, endpoint, skipped: true, message: makeRetakeT(i18next)('retakes.kept', { defaultValue: 'Retakes kept as they are.' }) };
                    }
                }
                console.log(`[MediaExecutionEngine] ✂️  detectRepeatedTakes: ${takeSegs.length} segments, ${result?.removedCount ?? '?'} take(s) cut`);
                this._applySegmentsToTimeline(takeSegs, 'take', null, retakeAssetId);
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
                    const timelineWords = deriveTimelineTranscript(useTimelineStore.getState().tracks, result.words);
                    const words = timelineWords || result.words;
                    // Keep store.captions on the timeline clock too (setCaptions
                    // above left it holding the raw source-time words).
                    if (timelineWords) useTimelineStore.getState().setTimelineTranscript?.(timelineWords);
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
                    activeSegments = await this._refineCutPointFrames(
                        activeSegments,
                        resolvedPayload?.filename || null,
                        command.args?.asset_id || null
                    );
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
            // R92: an optional step (audio enhancement inside "clean up") must
            // not fail the whole plan; it is reported as skipped instead.
            if (command.args?.optional) {
                console.warn(`[MediaExecutionEngine] optional step skipped (${endpoint}):`, err.message);
                return { engine: 'api', success: true, endpoint, skipped: true, message: `Skipped: ${err.message}` };
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
    /**
     * Raw phone uploads (.MOV) routinely have their moov atom at the end of the
     * file, which makes ffmpeg's -ss seek over a signed HTTP URL slow or prone
     * to failing outright for anything beyond a single-frame grab. The proxy
     * (`videoProcessor.js` always encodes it with `-movflags +faststart`, see
     * R7) is built specifically to be cheaply seekable, is already downscaled,
     * and — since proxy generation never trims — shares the exact same time
     * base as the raw file, so segment timestamps carry over unchanged.
     * Returns a GCS-relative path (e.g. "proxies/{userId}/{file}/proxy.mp4")
     * or null if the asset has no proxy yet.
     */
    _proxyGcsPathForAsset(assetId) {
        if (!assetId) return null;
        const asset = useTimelineStore.getState().assets?.find(a => a.id === assetId);
        const m = asset?.proxyUrl?.match(/\/api\/proxy\/gcs-media\/(.+)$/);
        return m ? m[1] : null;
    }

    async _refineCutPointFrames(segments, filename, assetId = null) {
        try {
            if (!segments || segments.length < 2) return segments;
            const proxyPath = this._proxyGcsPathForAsset(assetId);
            const sourcePath = proxyPath || filename;
            if (!sourcePath) return segments;
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
                body: JSON.stringify({ filename: sourcePath, points: capped.map(p => ({ id: p.id, t: p.t })) }),
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
    /**
     * Retake review: list each group ("3 takes of …: keeping take 3") and wait
     * for Apply / Cancel on the shared approval channel (desktop
     * ApprovalDialog, mobile MobileRokaApproval). Cancel, abort or 5 minutes
     * without an answer → nothing is cut.
     */
    _reviewRetakes(groups, signal) {
        const t = makeRetakeT(i18next);
        const jobId = `retakes-${Date.now()}`;
        return new Promise((resolve) => {
            let settled = false;
            const done = (value) => {
                if (settled) return;
                settled = true;
                offGrant?.(); offDeny?.();
                clearTimeout(timer);
                signal?.removeEventListener?.('abort', onAbort);
                resolve(value);
            };
            const offGrant = EventBus.on(EVENT_TYPES.APPROVAL_GRANTED, (p) => { if (p?.jobId === jobId) done(true); });
            const offDeny  = EventBus.on(EVENT_TYPES.APPROVAL_DENIED,  (p) => { if (p?.jobId === jobId) done(false); });
            const onAbort = () => {
                EventBus.emit(EVENT_TYPES.APPROVAL_DENIED, { jobId, reason: 'cancelled', deniedAt: Date.now() });
                done(false);
            };
            signal?.addEventListener?.('abort', onAbort, { once: true });
            const timer = setTimeout(() => {
                EventBus.emit(EVENT_TYPES.APPROVAL_DENIED, { jobId, reason: 'timeout', deniedAt: Date.now() });
                done(false);
            }, 5 * 60 * 1000);

            useAIStore.getState().setIsAnalyzing?.(false);
            EventBus.emit(EVENT_TYPES.APPROVAL_REQUIRED, {
                jobId,
                kind: 'take_review',
                operation: 'remove_repetition',
                title: t('retakes.title', { defaultValue: 'Retakes found' }),
                description: t('retakes.description', { count: groups.length, defaultValue: 'Roka found {{count}} line(s) you said more than once. It will keep the best take of each:' }),
                actions: retakeReviewLines(groups, t).map(l => `• ${l}`).join('\n'),
                reasons: [],
            });
        });
    }

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

        // ── Close any gap that already exists BEFORE this range ────────────────
        // The "shift clips after" logic further down only ever accounts for
        // clips AFTER rangeEnd — nothing in this function has ever looked left.
        // In a per-asset batch (silence/filler cleanup run once per asset on the
        // timeline — see R25), that means a gap sitting between asset N's clip
        // and asset N+1's clip survives this pass untouched no matter how many
        // times cleanup runs, because each step only ever tidies its OWN clip's
        // neighborhood on the right. Across a 5-asset batch that reads as "the
        // cleanup scattered the timeline" even though every individual step
        // behaved correctly in isolation.
        // Scoped to the single-source-clip case only — after split_speakers,
        // multiple video tracks must stay in lockstep (R18) and a per-track
        // leading-gap close could desync them, so that case is left alone.
        // Capped at GAP_CLOSE_LIMIT so an intentionally large gap (title card,
        // deliberate spacing) isn't silently eaten by an automated cleanup pass.
        const GAP_CLOSE_LIMIT = 30; // seconds
        let leadingGapClosed = 0;
        if (baseClips.length === 1) {
            const anchorTrackId = baseClip._trackId || videoTrack.id;
            const precedingEnd = allVideoClips
                .filter(c => c._trackId === anchorTrackId && c.id !== baseClip.id && (c.start + (c.duration || 0)) <= rangeStart + 0.01)
                .reduce((max, c) => Math.max(max, c.start + (c.duration || 0)), 0);
            const leadingGap = rangeStart - precedingEnd;
            if (leadingGap > 0.05 && leadingGap <= GAP_CLOSE_LIMIT) {
                leadingGapClosed = leadingGap;
                console.log(`[MediaExecutionEngine] _applySegmentsToTimeline: closing ${leadingGap.toFixed(2)}s pre-existing gap before "${baseClip.name}"`);
            }
        }
        const effectiveRangeStart = rangeStart - leadingGapClosed;

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
                end:       (c.offset ?? 0) + (c.duration ?? 0) * (c.speed || 1),
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
        // Segments are SOURCE time. A clip shows duration × speed seconds of
        // source, so on a sped-up/slowed clip a kept segment lasts
        // srcDuration / speed on the timeline (speed of the clip it falls in).
        // R91 fix (agent/segmentPacking.js): only the parts of a segment the
        // clips still show take timeline space. Packing whole segments re-opened
        // every range an earlier cut removed as a gap ("remove filler words"
        // after "remove silences"). Uncut clips give the same result as before.
        const { pieces: segOut, end: timelineEnd } = packSegments(validSegs, baseClips, effectiveRangeStart);

        let droppedZoomKfCount = 0; // clips whose stale zoom-rhythm keyframes had to be cleared (see below)
        let inserted = 0;

        // Rebuild each base clip by intersecting it with the kept segments.
        // A clip only yields pieces for the parts of ITS OWN source range that
        // survive, and each piece lands at the shared output position — so a
        // clip on track 2 stays aligned with the matching moment on track 1.
        baseClips.forEach((srcClip, clipIdx) => {
            const trackId     = srcClip._trackId || videoTrack.id;
            const clipSpeed   = Number(srcClip.speed) > 0 ? Number(srcClip.speed) : 1;
            const clipSrcFrom = srcClip.offset ?? 0;
            const clipSrcTo   = clipSrcFrom + (srcClip.duration ?? 0) * clipSpeed;
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
                    start:        seg.outStart + (from - seg.start) / seg.speed,
                    duration:     dur / clipSpeed,
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
        freshStore.seek(effectiveRangeStart);
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