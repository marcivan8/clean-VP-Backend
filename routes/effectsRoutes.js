/**
 * effectsRoutes.js
 * Routes for AI-driven video effects and analysis.
 */

const express = require('express');
const router = express.Router();
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const authMiddleware = process.env.NODE_ENV === 'production' ? authenticateUser : optionalAuth;
const {
    smartZoom,
    beatSync,
    emotionFrame
} = require('../controllers/effectsController');

// Smart Zoom Analysis
router.post('/smart-zoom', authMiddleware, smartZoom);

// Audio Beat Synchronization
router.post('/beat-sync', authMiddleware, beatSync);

// Emotion-based Framing/Coloring
router.post('/emotion-frame', authMiddleware, emotionFrame);

// Health check for effects service
router.get('/health', (req, res) => {
    res.json({
        service: 'effects-engine',
        status: 'online',
        gpuAvailable: false // Detect in future
    });
});

module.exports = router;
