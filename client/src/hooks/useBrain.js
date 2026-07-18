/**
 * client/src/hooks/useBrain.js
 *
 * Hook that wraps the Editorial Brain API (/api/brain/*).
 *
 * Usage:
 *   const { sendCommand, analyzeProject, sendFeedback, getBinSummary,
 *           isProcessing, lastResponse, error } = useBrain();
 *
 * Rules:
 * - sendCommand() is fire-and-returns — does not block the existing
 *   WorkflowController pipeline running in ReasoningPanel.
 * - buildProjectState() reads from useTimelineStore.getState() directly
 *   (no React subscription) so it can be called from event handlers.
 * - On any network or parse error: sets `error`, never throws.
 */

import { useState, useCallback, useRef } from 'react';
import useTimelineStore from '../store/useTimelineStore';
import { authFetch } from '../utils/authFetch';

/**
 * Build a lightweight project state snapshot from the current timeline store.
 * This is what gets sent to /api/brain/* as `projectState`.
 *
 * @returns {Object} projectState
 */
function buildProjectState() {
    const state = useTimelineStore.getState();

    const tracks    = state.tracks    || [];
    const assets    = state.assets    || [];
    const duration  = state.duration  || 0;

    const clipCount = tracks.reduce((n, t) => n + (t.clips?.length || 0), 0);

    // Transcript preview: first 300 chars of any caption track's text clips
    let transcriptPreview = null;
    for (const track of tracks) {
        if (track.type === 'text') {
            const texts = (track.clips || [])
                .map(c => c.text || c.caption || '')
                .filter(Boolean);
            if (texts.length > 0) {
                transcriptPreview = texts.join(' ').slice(0, 300);
                break;
            }
        }
    }

    const hasCaptions = tracks.some(t =>
        t.type === 'text' && (t.clips || []).length > 0
    );
    const hasMusicTrack = tracks.some(t =>
        t.type === 'audio' && (t.clips || []).some(c => c.assetId)
    );

    return {
        projectId:        state.projectId    || null,
        platform:         state.platform     || null,
        aspectRatio:      state.aspectRatio  || '16:9',
        duration,
        clipCount,
        hasCaptions,
        hasMusicTrack,
        transcriptPreview,
        // Summary of assets in the bin (type counts only — not full blobs)
        assetSummary: assets.map(a => ({
            id:       a.id,
            type:     a.type,
            name:     a.name,
            duration: a.duration || a.sourceDuration || 0,
            analysis_status: a.analysis_status || null,
        })),
        // Lightweight track summary for the brain's context engine
        tracks: tracks.map(t => ({
            id:        t.id,
            type:      t.type,
            clipCount: (t.clips || []).length,
        })),
    };
}

/**
 * @returns {{
 *   sendCommand:     (rawInput: string, extraState?: Object) => Promise<Object|null>,
 *   analyzeProject:  (trigger?: string, extraState?: Object) => Promise<Object|null>,
 *   sendFeedback:    (suggestionType: string, accepted: boolean, sessionId?: string) => Promise<void>,
 *   getBinSummary:   (projectId: string) => Promise<Object|null>,
 *   isProcessing:    boolean,
 *   lastResponse:    Object|null,
 *   error:           string|null,
 *   buildProjectState: () => Object,
 * }}
 */
export function useBrain() {
    const [isProcessing, setIsProcessing] = useState(false);
    const [lastResponse, setLastResponse] = useState(null);
    const [error, setError]               = useState(null);

    // Track the last session ID returned by the brain for feedback correlation
    const sessionIdRef = useRef(null);

    // ── sendCommand ───────────────────────────────────────────────────────────
    /**
     * Send a natural-language command to the brain. Returns the BrainOutput
     * or null on error.
     *
     * @param {string} rawInput
     * @param {Object} [extraState]  Additional fields merged into projectState
     */
    const sendCommand = useCallback(async (rawInput, extraState = {}) => {
        if (!rawInput?.trim()) return null;

        setIsProcessing(true);
        setError(null);

        try {
            const projectState = { ...buildProjectState(), ...extraState };

            // Guard: projectId is required by brainRoutes
            if (!projectState.projectId) {
                setIsProcessing(false);
                return null; // No project open yet — silently skip
            }

            const res = await authFetch('/api/brain/command', {
                method: 'POST',
                body: JSON.stringify({
                    rawInput,
                    trigger: 'user_typed',
                    projectState,
                }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Brain command failed (${res.status})`);
            }

            const brainOutput = await res.json();

            // Persist session ID for subsequent feedback calls
            sessionIdRef.current = brainOutput?.learning?.sessionId || null;

            setLastResponse(brainOutput);
            return brainOutput;

        } catch (err) {
            console.error('[useBrain] sendCommand error:', err.message);
            setError(err.message);
            return null;
        } finally {
            setIsProcessing(false);
        }
    }, []);

    // ── analyzeProject ────────────────────────────────────────────────────────
    /**
     * Analyze the current project for suggestions (advise mode — no execution).
     *
     * @param {string}  [trigger='project_opened']
     * @param {Object}  [extraState]
     */
    const analyzeProject = useCallback(async (
        trigger = 'project_opened',
        extraState = {}
    ) => {
        setIsProcessing(true);
        setError(null);

        try {
            const projectState = { ...buildProjectState(), ...extraState };

            if (!projectState.projectId) {
                setIsProcessing(false);
                return null;
            }

            const res = await authFetch('/api/brain/analyze', {
                method: 'POST',
                body: JSON.stringify({ projectState, trigger }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Brain analyze failed (${res.status})`);
            }

            const data = await res.json();
            setLastResponse(prev => ({
                ...(prev || {}),
                response: {
                    ...(prev?.response || {}),
                    suggestions: data.nextSuggestions || [],
                    message: data.response?.message || null,
                },
            }));
            return data;

        } catch (err) {
            console.error('[useBrain] analyzeProject error:', err.message);
            setError(err.message);
            return null;
        } finally {
            setIsProcessing(false);
        }
    }, []);

    // ── sendFeedback ──────────────────────────────────────────────────────────
    /**
     * Record accept/dismiss feedback on a suggestion chip.
     * Always resolves — never throws.
     *
     * @param {string}  suggestionType
     * @param {boolean} accepted
     * @param {string}  [sessionId]
     */
    const sendFeedback = useCallback(async (
        suggestionType,
        accepted,
        sessionId
    ) => {
        try {
            await authFetch('/api/brain/feedback', {
                method: 'POST',
                body: JSON.stringify({
                    suggestionType,
                    accepted,
                    sessionId: sessionId || sessionIdRef.current || 'unknown',
                }),
            });
        } catch (err) {
            // Best-effort — feedback loss is acceptable
            console.warn('[useBrain] sendFeedback error (non-fatal):', err.message);
        }
    }, []);

    // ── getBinSummary ─────────────────────────────────────────────────────────
    /**
     * Fetch a lightweight media bin summary (no AI calls, fast DB read).
     *
     * @param {string} projectId
     * @returns {Promise<Object|null>}
     */
    const getBinSummary = useCallback(async (projectId) => {
        if (!projectId) return null;

        try {
            const res = await authFetch(
                `/api/brain/bin-summary?projectId=${encodeURIComponent(projectId)}`
            );

            if (!res.ok) return null;
            return await res.json();

        } catch (err) {
            console.error('[useBrain] getBinSummary error:', err.message);
            return null;
        }
    }, []);

    return {
        sendCommand,
        analyzeProject,
        sendFeedback,
        getBinSummary,
        isProcessing,
        lastResponse,
        error,
        buildProjectState,
    };
}

export default useBrain;
