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

            let words = [];

            if (data.jobId) {
                // If it's queued, subscribe to SSE
                words = await new Promise((resolve, reject) => {
                    const source = new EventSource(`/api/jobs/${data.jobId}/progress`);
                    
                    source.onmessage = (e) => {
                        try {
                            const eventData = JSON.parse(e.data);
                            if (eventData.error) {
                                source.close();
                                return reject(new Error(eventData.error));
                            }
                            
                            // Map progress (0-100) to our state progress range (5-50)
                            if (eventData.progress !== undefined) {
                                this._setStatus(TRANSCRIPTION_STATUS.TRANSCRIBING, 5 + Math.floor(eventData.progress * 0.45));
                            }
                            
                            if (eventData.state === 'completed') {
                                source.close();
                                resolve(eventData.result.words || []);
                            } else if (eventData.state === 'failed') {
                                source.close();
                                reject(new Error(eventData.error || 'Transcription job failed'));
                            }
                        } catch (err) {
                            console.error('[TranscriptionManager] Error parsing SSE message:', err);
                        }
                    };

                    source.onerror = (err) => {
                        source.close();
                        reject(new Error('SSE connection failed'));
                    };
                    
                    // Abort support for long SSE
                    signal.addEventListener('abort', () => {
                        source.close();
                        reject(new Error('AbortError'));
                    });
                });
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