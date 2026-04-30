/**
 * TranscriptionManager
 * Singleton that handles background transcription + content analysis
 * immediately after a file is added to the timeline.
 *
 * Flow:
 *   file added → startBackgroundTranscription()
 *     → /api/audio/transcribe  (Whisper)
 *     → setCaptions() on store
 *     → ContentAnalyzer.analyze()
 *     → setContentAnalysis() on store
 *     → emits ANALYSIS_READY
 *
 * EditJobManager checks getCachedAnalysis() before running ContentAnalyzer,
 * so if the user types their first message after upload the plan appears
 * in ~2s instead of 30-45s.
 */

import { EventBus, EVENT_TYPES } from './EventBus.js';
import { ContentAnalyzer } from './ContentAnalyzer.js';
import useTimelineStore from '../store/useTimelineStore.js';

// ─── Status constants ────────────────────────────────────────────────────────
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
        this._progress = 0;           // 0-100
        this._abortController = null;
        this._cachedAnalysis = null;
        this._currentFilename = null;
        this._error = null;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Start transcription + analysis in the background.
     * Safe to call multiple times — cancels any in-progress job first.
     *
     * @param {string} filename - Filename sent to /api/audio/transcribe
     * @param {object} [options]
     * @param {string} [options.platform] - Passed to ContentAnalyzer
     * @param {number} [options.targetDuration]
     */
    async startBackgroundTranscription(filename, options = {}) {
        if (!filename) {
            console.warn('[TranscriptionManager] No filename provided — skipping');
            return;
        }

        // Cancel any running job
        this._cancel();

        this._currentFilename = filename;
        this._cachedAnalysis = null;
        this._error = null;
        this._abortController = new AbortController();
        const { signal } = this._abortController;

        console.log(`[TranscriptionManager] Starting background transcription for: ${filename}`);
        this._setStatus(TRANSCRIPTION_STATUS.TRANSCRIBING, 0);

        // ── Phase 1: Transcribe ───────────────────────────────────────────────
        try {
            const words = await this._transcribe(filename, signal);
            if (signal.aborted) return;

            if (words && words.length > 0) {
                useTimelineStore.getState().setCaptions(words);
                console.log(`[TranscriptionManager] Transcription complete — ${words.length} words`);
            } else {
                console.warn('[TranscriptionManager] Transcription returned no words');
            }

            this._setStatus(TRANSCRIPTION_STATUS.ANALYZING, 55);

            // ── Phase 2: Analyze content ──────────────────────────────────────
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
                console.log('[TranscriptionManager] Job cancelled');
                this._setStatus(TRANSCRIPTION_STATUS.IDLE, 0);
                return;
            }

            console.error('[TranscriptionManager] Failed:', err);
            this._error = err.message;
            this._setStatus(TRANSCRIPTION_STATUS.FAILED, 0);

            EventBus.emit(EVENT_TYPES.TRANSCRIPTION_FAILED, {
                filename,
                error: err.message,
            });
        }
    }

    /** Cancel any in-progress transcription/analysis job */
    cancel() {
        this._cancel();
        this._setStatus(TRANSCRIPTION_STATUS.IDLE, 0);
    }

    /** Returns the cached ContentAnalyzer result, or null if not ready */
    getCachedAnalysis() {
        return this._cachedAnalysis;
    }

    /** Returns current status string */
    getStatus() {
        return {
            status: this._status,
            progress: this._progress,
            filename: this._currentFilename,
            error: this._error,
            ready: this._status === TRANSCRIPTION_STATUS.READY,
        };
    }

    /** True if analysis is cached and ready to use */
    isReady() {
        return this._status === TRANSCRIPTION_STATUS.READY && this._cachedAnalysis !== null;
    }

    /** Clear the cached analysis (e.g. when a new file is loaded) */
    clearCache() {
        this._cachedAnalysis = null;
        this._currentFilename = null;
        this._error = null;
        this._setStatus(TRANSCRIPTION_STATUS.IDLE, 0);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    async _transcribe(filename, signal) {
        // Emit initial progress
        this._setStatus(TRANSCRIPTION_STATUS.TRANSCRIBING, 5);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300_000); // 5 min max
        signal.addEventListener('abort', () => controller.abort());

        try {
            const response = await fetch('/api/audio/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const text = await response.text().catch(() => response.statusText);
                throw new Error(`Transcription API error ${response.status}: ${text}`);
            }

            const data = await response.json();

            this._setStatus(TRANSCRIPTION_STATUS.TRANSCRIBING, 50);

            EventBus.emit(EVENT_TYPES.TRANSCRIPTION_COMPLETE, {
                filename,
                wordCount: data.words?.length || 0,
            });

            return data.words || [];

        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }

    _cancel() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
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