/**
 * aiService.js — "The Editing Brain"
 *
 * FIX: fetch('/api/analyze', ...) was sent without an Authorization header.
 *      In production this returns 401 Unauthorized, so video analysis never ran.
 *      The frontend received an error and showed "Analysis Failed" even though
 *      the file uploaded correctly.
 *
 *      Replaced with authFetch() which injects the Supabase JWT Bearer token.
 *      Note: FormData body — authFetch correctly skips the Content-Type header
 *      so the browser can set the multipart boundary automatically.
 */

import { authFetch } from '../utils/authFetch.js';
import useTimelineStore from '../store/useTimelineStore';

const API_URL = '/api/analyze';

export const analyzeFile = async (file, onLog, onSuggestion, onComplete, onError) => {

    onLog({
        id: 'log-start',
        timestamp: new Date().toLocaleTimeString(),
        type: 'info',
        message: `Reading file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`
    });

    const formData = new FormData();
    formData.append('video', file);
    formData.append('title', file.name);
    formData.append('ai_training_consent', 'true');

    try {
        onLog({
            id: 'log-uploading',
            timestamp: new Date().toLocaleTimeString(),
            type: 'info',
            message: 'Uploading to Vibed for deep analysis...'
        });

        // FIX: was fetch(API_URL, { method: 'POST', body: formData }) — no auth → 401
        // authFetch detects FormData and skips Content-Type so the multipart
        // boundary is set correctly by the browser.
        const response = await authFetch(API_URL, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Analysis failed');
        }

        const data = await response.json();

        onLog({
            id: 'log-complete',
            timestamp: new Date().toLocaleTimeString(),
            type: 'success',
            message: `Analysis Complete! Processing Time: ${data.metadata?.processingTime?.toFixed(2)}s`
        });

        onLog({
            id: 'log-score',
            timestamp: new Date().toLocaleTimeString(),
            type: 'success',
            message: `DETECTED: Virality Score ${data.viralityScore}/10`
        });

        if (data.details?.pacing?.segments) {
            useTimelineStore.getState().setPacingSegments(data.details.pacing.segments);
            onLog({
                id: 'log-pacing',
                timestamp: new Date().toLocaleTimeString(),
                type: 'info',
                message: `Pacing Analyzed: ${data.details.pacing.cutsPerMinute} cut/min`
            });
        }

        if (data.details?.words && Array.isArray(data.details.words)) {
            useTimelineStore.getState().setCaptions(data.details.words);
            onLog({
                id: 'log-captions',
                timestamp: new Date().toLocaleTimeString(),
                type: 'info',
                message: `Generated Captions: ${data.details.words.length} words.`
            });
        }

        if (data.suggestions?.musicRecommendation) {
            const musicRef = data.suggestions.musicRecommendation;
            onSuggestion({
                id: 'sugg-music-' + Date.now(),
                title: 'Music Soundtrack',
                description: `Suggested Track: ${musicRef.track} (${musicRef.genre})`,
                reason: musicRef.reason,
                type: 'music',
                data: musicRef,
                executionData: {
                    action: 'addMusicTrack',
                    params: { url: `/assets/music/${musicRef.track}`, name: musicRef.track, duration: 30 }
                }
            });
        }

        if (data.bestPlatform) {
            onLog({
                id: 'log-platform',
                timestamp: new Date().toLocaleTimeString(),
                type: 'info',
                message: `Optimal Platform: ${data.bestPlatform.toUpperCase()}`
            });
        }

        let suggCount = 0;

        if (data.suggestions?.hookRewrite) {
            suggCount++;
            onSuggestion({
                id: 'sugg-hook',
                title: 'Optimize Hook',
                description: data.suggestions.hookRewrite,
                reason: `Hook score is ${data.scores?.hook?.toFixed(1) || 'low'}. Better hooks increase retention.`,
                actionType: 'replace_hook',
                executionData: { action: 'trimStart', params: { duration: 2 } }
            });
        }

        if (data.suggestions?.ctaRewrite) {
            suggCount++;
            onSuggestion({
                id: 'sugg-cta',
                title: 'Stronger Call-to-Action',
                description: data.suggestions.ctaRewrite,
                reason: 'Clear CTAs drive conversion.',
                actionType: 'replace_cta'
            });
        }

        if (data.suggestions?.editingTips?.length > 0) {
            data.suggestions.editingTips.slice(0, 2).forEach((tip, idx) => {
                suggCount++;
                onSuggestion({
                    id: `sugg-tip-${idx}`,
                    title: 'Editing Tip',
                    description: tip,
                    reason: 'Algorithm optimization.',
                    actionType: 'tip',
                    executionData: { action: 'applyColor', params: { color: 'bg-purple-500' } }
                });
            });
        }

        onLog({
            id: 'log-all-sugg',
            timestamp: new Date().toLocaleTimeString(),
            type: 'info',
            message: `${suggCount} actionable suggestions generated.`
        });

        onComplete();

    } catch (error) {
        console.error('Analysis Error:', error);
        onLog({
            id: 'log-error',
            timestamp: new Date().toLocaleTimeString(),
            type: 'warning',
            message: `Analysis Failed: ${error.message}`
        });
        if (onError) onError(error);
        onComplete();
    }
};