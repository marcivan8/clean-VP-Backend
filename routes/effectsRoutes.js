/**
 * effectsRoutes.js
 * Routes for AI-driven video effects and analysis.
 */

const express = require('express');
const router = express.Router();
const {
    smartZoom,
    beatSync,
    emotionFrame
} = require('../controllers/effectsController');

// Smart Zoom Analysis
router.post('/smart-zoom', smartZoom);

// Audio Beat Synchronization
router.post('/beat-sync', beatSync);

// Emotion-based Framing/Coloring
router.post('/emotion-frame', emotionFrame);

// Health check for effects service
router.get('/health', (req, res) => {
    res.json({
        service: 'effects-engine',
        status: 'online',
        gpuAvailable: false // Detect in future
    });
});

module.exports = router;
