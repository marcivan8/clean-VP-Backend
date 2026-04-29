/**
 * Preset Marketplace Routes — Phase 7
 * Static curated preset list for now; full community DB in Phase 8.
 */
const express = require('express');
const router = express.Router();

// Curated marketplace presets (static JSON — Phase 8 will replace with DB)
const MARKETPLACE_PRESETS = [
    {
        id: 'mkt-viral-punch',
        name: 'Viral Punch',
        version: '1.0',
        category: 'composite',
        description: 'High contrast, hyper-saturated look engineered for TikTok virality.',
        author: 'Viral Pilot Team',
        compatibility: ['webgl', 'ffmpeg'],
        downloads: 1240,
        rating: 4.8,
        operations: [
            { type: 'contrast',   params: { value: 1.35 } },
            { type: 'saturation', params: { value: 1.4 } },
            { type: 'sharpen',    params: { value: 0.4 } },
            { type: 'vignette',   params: { intensity: 0.25 } }
        ]
    },
    {
        id: 'mkt-golden-hour',
        name: 'Golden Hour',
        version: '1.0',
        category: 'color',
        description: 'Warm sunset tones with lifted shadows for that golden aesthetic.',
        author: 'Viral Pilot Team',
        compatibility: ['webgl', 'ffmpeg'],
        downloads: 987,
        rating: 4.7,
        operations: [
            { type: 'color_grade', params: { lift: [0.05, 0.02, -0.05], gamma: [1.05, 1.0, 0.9], gain: [1.1, 1.0, 0.8] } },
            { type: 'saturation',  params: { value: 1.15 } },
            { type: 'brightness',  params: { value: 0.05 } }
        ]
    },
    {
        id: 'mkt-clean-audio',
        name: 'Clean Voice',
        version: '1.0',
        category: 'audio',
        description: 'Optimised voice clarity with noise reduction and presence boost.',
        author: 'Viral Pilot Team',
        compatibility: ['ffmpeg'],
        downloads: 654,
        rating: 4.6,
        operations: [
            { type: 'audio_normalize', params: { target: -14 } },
            { type: 'audio_compressor', params: { ratio: 3, threshold: -18 } },
            { type: 'audio_eq', params: { lowcut: 100, presence: { freq: 3500, gain: 3 } } }
        ]
    },
    {
        id: 'mkt-reels-ready',
        name: 'Reels Ready',
        version: '1.0',
        category: 'composite',
        description: 'Instagram Reels optimised look — vibrant, clean, and scroll-stopping.',
        author: 'Viral Pilot Team',
        compatibility: ['webgl', 'ffmpeg'],
        downloads: 1100,
        rating: 4.9,
        operations: [
            { type: 'contrast',    params: { value: 1.12 } },
            { type: 'saturation',  params: { value: 1.25 } },
            { type: 'white_balance', params: { temperature: 5800 } },
            { type: 'sharpen',     params: { value: 0.25 } }
        ]
    }
];

/**
 * GET /api/presets/marketplace
 * Returns the curated preset list.
 */
router.get('/marketplace', (req, res) => {
    res.json(MARKETPLACE_PRESETS);
});

/**
 * POST /api/presets/publish
 * Placeholder for Phase 8 community publishing.
 */
router.post('/publish', (req, res) => {
    res.status(501).json({ message: 'Community publishing coming in Phase 8.' });
});

module.exports = router;
