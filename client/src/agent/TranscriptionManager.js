/**
 * TranscriptionManager
 * Singleton that handles background transcription + content analysis
 * immediately after a file is added to the timeline.
 *
 * FIX: All fetch() calls replaced with authFetch() so the Supabase JWT
 *      Bearer token is sent in production. Without this, /api/audio/transcribe
 *      returned 401 Unauthorized and transcription silently failed, leaving
 *      the agent without any word-level transcript data.
 */

import { authFetch } from '../utils/authFetch.js';
import { pollJobResult, DIARIZE_TIMEOUT_MS } from '../utils/jobPoller.js';
import { EventBus, EVENT_TYPES } from './EventBus.js';
import { ContentAnalyzer } from './ContentAnalyzer.js';
import useTimelineStore from '../store/useTimelineStore.js';

export const TRANSCRIPTION_STATUS = {
    IDLE: 'idle',
    TRANSCRIBING: 'transcribing',
    ANALYZING: 'analyzing',
    READY: 'ready',
    FAILED: 'failed',
};

class TranscriptionManagerClass {
    constructor() {
        this._status = TRANSCRIPTION_STATUS.IDLE;
        this._progress = 0;
        // Map<filename, AbortController> — one controller per in-flight transcription
        this._controllers = new Map();
        this._cachedAnalysis = null;
        this._currentFilename = null;
        this._error = null;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Start transcription + analysis in the background.
     * Multiple clips can be transcribed concurrently — each gets its own abort
     * controller and the results accumulate in store.transcripts.
     */
    async startBackgroundTranscription(filename, options = {}) {
        if (!filename) {
            console.warn('[TranscriptionManager] No filename provided — skipping');
            return;
        }

        // If already transcribing this exact file, skip to avoid duplicate work
        if (this._controllers.has(filename)) {
            console.log(`[TranscriptionManager] Already transcribing "${filename}" — skipping duplicate`);
            return;
        }

        this._currentFilename = filename;
        this._error = null;
        const controller = new AbortController();
        this._controllers.set(filename, controller);
        const { signal } = controller;

        console.log(`[TranscriptionManager] Starting background transcription for: ${filename}`);
        this._setStatus(TRANSCRIPTION_STATUS.TRANSCRIBING, 0);

        try {
            const words = await this._transcribe(filename, signal);
            if (signal.aborted) return;

            if (words && words.length > 0) {
                useTimelineStore.getState().setCaptions(words, filename);
                console.log(`[TranscriptionManager] Transcription complete — ${words.length} words`);
            } else {
                console.warn('[TranscriptionManager] Transcription returned no words');
            }

            this._setStatus(TRANSCRIPTION_STATUS.ANALYZING, 55);

            const analysis = await ContentAnalyzer.analyze({
                platform: options.platform || null,
                targetDuration: options.targetDuration || null,
                signal,
            });

            if (signal.aborted) return;

            this._cachedAnalysis = analysis;
            this._setStatus(TRANSCRIPTION_STATUS.READY, 100);

            console.log(`[TranscriptionManager] Analysis cached — mode: ${analysis.editMode}, segments: ${analysis.segments?.length}`);

            EventBus.emit(EVENT_TYPES.ANALYSIS_READY, {
                filename,
                analysis,
                wordCount: words?.length || 0,
            });

        } catch (err) {
            if (err.name === 'AbortError' || signal.aborted) {
                console.log(`[TranscriptionManager] Job cancelled for "${filename}"`);
                this._setStatus(TRANSCRIPTION_STATUS.IDLE, 0);
            } else {
                console.error('[TranscriptionManager] Failed:', err);
                this._error = err.message;
                this._setStatus(TRANSCRIPTION_STATUS.FAILED, 0);
                EventBus.emit(EVENT_TYPES.TRANSCRIPTION_FAILED, { filename, error: err.message });
            }
        } finally {
            this._controllers.delete(filename);
        }
    }

    cancel() {
        // Cancel all in-flight transcriptions
        this._controllers.forEach((ctrl) => ctrl.abort());
        this._controllers.clear();
        this._setStatus(TRANSCRIPTION_STATUS.IDLE, 0);
    }

    getCachedAnalysis() {
        return this._cachedAnalysis;
    }

    getStatus() {
        return {
            status: this._status,
            progress: this._progress,
            filename: this._currentFilename,
            error: this._error,
            ready: this._status === TRANSCRIPTION_STATUS.READY,
        };
    }

    isReady() {
        return this._status === TRANSCRIPTION_STATUS.READY && this._cachedAnalysis !== null;
    }

    clearCache() {
        this._controllers.forEach((ctrl) => ctrl.abort());
        this._controllers.clear();
        this._cachedAnalysis = null;
        this._currentFilename = null;
        this._error = null;
        this._setStatus(TRANSCRIPTION_STATUS.IDLE, 0);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    async _transcribe(filename, signal) {
        this._setStatus(TRANSCRIPTION_STATUS.TRANSCRIBING, 5);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300_000);
        signal.addEventListener('abort', () => controller.abort());

        try {
            // Try diarization first, fall back to standard transcription
            let response = await authFetch('/api/audio/diarize', {
                method: 'POST',
                body: JSON.stringify({ filename }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorData = await response.clone().json().catch(() => null);

                // 402 = quota exhausted — stop immediately, don't waste a second call.
                if (response.status === 402 || errorData?.error === 'AI_OPS_LIMIT') {
                    console.warn('[TranscriptionManager] AI ops limit reached — skipping background transcription');
                    this._setStatus(TRANSCRIPTION_STATUS.IDLE, 0);
                    EventBus.emit(EVENT_TYPES.TRANSCRIPTION_PROGRESS, {
                        status: 'quota_exceeded',
                        progress: 0,
                        filename,
                        message: errorData?.message || "You've used all your AI operations this month.",
                        upgradeRequired: errorData?.upgradeRequired,
                    });
                    return;
                }

                // Fall back to standard transcription when diarization is not configured
                // or when the service is temporarily unavailable (any 5xx).
                // 4xx errors (401, 403, 404) propagate as real errors — they indicate
                // an auth or routing problem that would affect /transcribe equally.
                const shouldFallback =
                    response.status === 503 ||
                    errorData?.code === 'DIARIZE_NOT_CONFIGURED' ||
                    (response.status >= 500 && response.status !== 401 && response.status !== 403);
                if (shouldFallback) {
                    console.log(`[TranscriptionManager] Diarization unavailable (${response.status}), falling back to standard transcribe`);
                    response = await authFetch('/api/audio/transcribe', {
                        method: 'POST',
                        body: JSON.stringify({ filename }),
                        signal: controller.signal,
                    });
                }
            }

            clearTimeout(timeoutId);

            if (!response.ok) {
                const text = await response.text().catch(() => response.statusText);
                throw new Error(`Transcription API error ${response.status}: ${text}`);
            }

            const data = await response.json();

            let words = [];

            if (data.jobId) {
                // Poll /api/jobs/:jobId/status — more reliable than SSE behind Railway's proxy.
                // SSE (EventSource) drops on Railway because the reverse-proxy buffers
                // long-lived streaming connections.
                this._setStatus(TRANSCRIPTION_STATUS.TRANSCRIBING, 20);
                try {
                    // Diarize jobs (WhisperX + pyannote on CPU) can take 8-10 min
                    // for long videos. Use the extended deadline so the client waits
                    // out the full server-side timeout instead of falling back to
                    // plain Whisper (which has no speaker labels) prematurely.
                    const result = await pollJobResult(data.jobId, signal, DIARIZE_TIMEOUT_MS);
                    words = result?.words || [];
                } catch (pollErr) {
                    // If the user aborted, propagate — don't silently swallow cancellations.
                    if (signal?.aborted || pollErr.message === 'Polling cancelled') throw pollErr;

                    // Diarize job failed (Python service error, GCS download issue, etc.).
                    // Fall back to standard Whisper transcription so the transcript tab
                    // still populates even when the diarize microservice is unhealthy.
                    console.warn('[TranscriptionManager] Diarize job failed — falling back to /transcribe:', pollErr.message);
                    const fallbackRes = await authFetch('/api/audio/transcribe', {
                        method: 'POST',
                        body: JSON.stringify({ filename }),
                        signal: controller.signal,
                    });
                    if (!fallbackRes.ok) {
                        const text = await fallbackRes.text().catch(() => fallbackRes.statusText);
                        throw new Error(`Transcription fallback error ${fallbackRes.status}: ${text}`);
                    }
                    const fallbackData = await fallbackRes.json();
                    if (fallbackData.jobId) {
                        const fallbackResult = await pollJobResult(fallbackData.jobId, signal);
                        words = fallbackResult?.words || [];
                    } else {
                        words = fallbackData.words || [];
                    }
                }
            } else {
                words = data.words || [];
            }

            this._setStatus(TRANSCRIPTION_STATUS.TRANSCRIBING, 50);

            EventBus.emit(EVENT_TYPES.TRANSCRIPTION_COMPLETE, {
                filename,
                wordCount: words?.length || 0,
            });

            return words;

        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }

    _setStatus(status, progress) {
        this._status = status;
        this._progress = progress;

        EventBus.emit(EVENT_TYPES.TRANSCRIPTION_PROGRESS, {
            status,
            progress,
            filename: this._currentFilename,
        });
    }
}

export const transcriptionManager = new TranscriptionManagerClass();
export default TranscriptionManagerClass;