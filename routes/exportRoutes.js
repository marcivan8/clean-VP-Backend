const express = require('express');
const router = express.Router();
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const { exportQueue } = require('../queue/queues');


// ============================================================================
// PLATFORM PRESETS
// ============================================================================

const PLATFORM_PRESETS = {
    tiktok: {
        label: 'TikTok',
        width: 1080, height: 1920,
        aspectRatio: '9:16',
        fps: 30,
        bitrate: '6000k',
        audioBitrate: '128k',
        maxDuration: 60,
        codec: 'libx264',
        profile: 'high',
        level: '4.0'
    },
    youtube: {
        label: 'YouTube',
        width: 1920, height: 1080,
        aspectRatio: '16:9',
        fps: 30,
        bitrate: '8000k',
        audioBitrate: '192k',
        maxDuration: null,
        codec: 'libx264',
        profile: 'high',
        level: '4.2'
    },
    reels: {
        label: 'Instagram Reels',
        width: 1080, height: 1920,
        aspectRatio: '9:16',
        fps: 30,
        bitrate: '5500k',
        audioBitrate: '128k',
        maxDuration: 90,
        codec: 'libx264',
        profile: 'high',
        level: '4.0'
    },
    shorts: {
        label: 'YouTube Shorts',
        width: 1080, height: 1920,
        aspectRatio: '9:16',
        fps: 60,
        bitrate: '6000k',
        audioBitrate: '192k',
        maxDuration: 60,
        codec: 'libx264',
        profile: 'high',
        level: '4.1'
    },
    custom: null  // Use user-provided settings
};

// ============================================================================
// RESOLUTION PRESETS
// ============================================================================

const RESOLUTION_PRESETS = {
    '720p':  { width: 1280, height: 720,  bitrate: '4000k' },
    '1080p': { width: 1920, height: 1080, bitrate: '8000k' },
    '2k':    { width: 2560, height: 1440, bitrate: '16000k' },
    '4k':    { width: 3840, height: 2160, bitrate: '35000k' }
};

// ============================================================================
// HELPERS
// ============================================================================

function buildScaleFilter(width, height) {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

// ============================================================================
// POST /render — Enqueue export job and return immediately
// ============================================================================

const authMiddleware = process.env.NODE_ENV === 'production' ? authenticateUser : optionalAuth;

router.post('/', authMiddleware, async (req, res) => {
    try {
        const { timeline, settings = {} } = req.body;

        if (!timeline || !timeline.tracks) {
            return res.status(400).json({ error: 'Invalid timeline data' });
        }

        const hasVideoClips = timeline.tracks.some(t =>
            (t.type === 'video' || t.type === 'image') && t.clips?.length > 0
        );
        if (!hasVideoClips) {
            return res.status(400).json({ error: 'No video or image clips found in timeline' });
        }

        // Build assetId→asset map from the assets array the client sends.
        // The worker needs this to recover source URLs for segment clips.
        const sentAssets = Array.isArray(timeline.assets) ? timeline.assets : [];
        const assetMap = {};
        sentAssets.forEach(a => { if (a.id) assetMap[a.id] = a; });

        const userId = req.user ? req.user.id : 'anonymous';

        const job = await exportQueue.add('render', {
            timeline,
            settings,
            userId,
            assetMap,
        });

        console.log(`🎬 Export job ${job.id} queued for user ${userId}`);

        res.json({ jobId: job.id });

    } catch (error) {
        console.error('❌ Export enqueue failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /presets — Return platform and resolution presets for the frontend
// ============================================================================

router.get('/presets', (req, res) => {
    res.json({
        platforms: Object.entries(PLATFORM_PRESETS)
            .filter(([k, v]) => v !== null)
            .map(([key, preset]) => ({
                id: key,
                label: preset.label,
                aspectRatio: preset.aspectRatio,
                resolution: `${preset.width}x${preset.height}`,
                fps: preset.fps,
                maxDuration: preset.maxDuration
            })),
        resolutions: Object.entries(RESOLUTION_PRESETS).map(([key, preset]) => ({
            id: key,
            label: key.toUpperCase(),
            width: preset.width,
            height: preset.height,
            bitrate: preset.bitrate
        }))
    });
});

module.exports = router;
