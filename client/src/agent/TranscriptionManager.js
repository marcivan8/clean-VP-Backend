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
        this._abortController = null;
        this._cachedAnalysis = null;
        this._currentFilename = null;
        this._error = null;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Start transcription + analysis in the background.
     */
    async startBackgroundTranscription(filename, options = {}) {
        if (!filename) {
            console.warn('[TranscriptionManager] No filename provided — skipping');
            return;
        }

        this._cancel();

        this._currentFilename = filename;
        this._cachedAnalysis = null;
        this._error = null;
        this._abortController = new AbortController();
        const { signal } = this._abortController;

        console.log(`[TranscriptionManager] Starting background transcription for: ${filename}`);
        this._setStatus(TRANSCRIPTION_STATUS.TRANSCRIBING, 0);

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

    cancel() {
        this._cancel();
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
            // FIX: was fetch('/api/audio/transcribe', ...) — no auth header → 401 in production
            const response = await authFetch('/api/audio/transcribe', {
                method: 'POST',
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