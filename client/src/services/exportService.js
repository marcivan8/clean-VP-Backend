/**
 * Export Service
 * Connects to Backend POST /api/render
 */

const EXPORT_URL = '/api/render';

export const exportTimeline = async (tracks, settings, onProgress, onComplete, onError) => {
    try {
        const response = await fetch(EXPORT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                timeline: {
                    tracks: tracks
                },
                settings: settings // Pass export settings
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Export failed');
        }

        const data = await response.json();

        if (data.success && data.url) {
            onComplete(data.url);
        } else {
            throw new Error('Invalid export response');
        }

    } catch (error) {
        console.error("Export Error:", error);
        if (onError) onError(error);
    }
};
