/**
 * Export Service
 * Connects to Backend POST /api/render
 *
 * The render route now returns { jobId } immediately.
 * We poll /api/jobs/:jobId/status until the job completes and then
 * call onComplete with the final video URL.
 */

import { pollJobResult } from '../utils/jobPoller.js';

const EXPORT_URL = '/api/render';

export const exportTimeline = async (tracks, settings, onProgress, onComplete, onError) => {
    try {
        // 1. Enqueue the export job
        const response = await fetch(EXPORT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timeline: { tracks },
                settings,
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || 'Export failed');
        }

        const data = await response.json();

        if (!data.jobId) {
            throw new Error('Export response missing jobId');
        }

        // 2. Poll until done (jobPoller backs off from 1.5s → 5s; 8-min timeout —
        //    same override MediaExecutionEngine.js already uses for other long jobs,
        //    the bare 5-min default was cutting off exports that were still rendering)
        if (onProgress) onProgress({ status: 'rendering', progress: 0 });

        const result = await pollJobResult(data.jobId, null, 8 * 60 * 1000);

        if (result?.url) {
            onComplete(result.url);
        } else {
            throw new Error('Export completed but no URL returned');
        }

    } catch (error) {
        console.error('Export Error:', error);
        if (onError) onError(error);
    }
};
