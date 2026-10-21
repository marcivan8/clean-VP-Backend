'use strict';

/**
 * routes/stockMediaRoutes.js
 *
 * REST API endpoints for Stock Media Provider integration (Level 1).
 *
 * Routes:
 *   GET /api/stock/search   - Search stock videos or photos from provider
 *   GET /api/stock/status   - Check whether stock provider is configured
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const { stockGate } = require('../middleware/usageGate');
const { pexelsService } = require('../services/PexelsService');
const { vecteezyService } = require('../services/VecteezyService');

function getActiveStockService() {
    const pref = String(process.env.STOCK_PROVIDER || '').toLowerCase().trim();
    if (pref === 'vecteezy' && vecteezyService.isConfigured()) return vecteezyService;
    if (pref === 'pexels' && pexelsService.isConfigured()) return pexelsService;
    if (vecteezyService.isConfigured()) return vecteezyService;
    if (pexelsService.isConfigured()) return pexelsService;
    return pref === 'pexels' ? pexelsService : vecteezyService;
}

// Stock media search rate limiter (30 requests per minute per IP)
const stockLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Stock search rate limit exceeded. Please wait a moment before searching again.' },
});

const authMiddleware = process.env.NODE_ENV === 'production' ? authenticateUser : optionalAuth;

/**
 * GET /api/stock/status
 * Returns provider readiness status without exposing any secrets.
 */
router.get('/status', (req, res) => {
    const service = getActiveStockService();
    const isConfigured = service.isConfigured() || pexelsService.isConfigured();
    res.json({
        provider: service.providerName || 'vecteezy',
        configured: isConfigured,
        supportedMedia: ['video', 'photo'],
    });
});

/**
 * GET /api/stock/search
 * Query params:
 *   - query: string (required)
 *   - type: 'video' (default) | 'photo' | 'all'
 *   - page: number (default 1)
 *   - perPage: number (default 15, max 30)
 *   - orientation: 'landscape' | 'portrait' | 'square' (optional)
 */
router.get('/search', stockLimiter, authMiddleware, stockGate, async (req, res) => {
    const query = String(req.query.query || '').trim();
    const type = String(req.query.type || 'video').toLowerCase();
    const page = parseInt(req.query.page, 10) || 1;
    const perPage = parseInt(req.query.perPage, 10) || 15;
    const orientation = req.query.orientation ? String(req.query.orientation).toLowerCase() : undefined;

    if (!query) {
        return res.status(400).json({ error: 'Search query is required.' });
    }

    const service = getActiveStockService();
    if (!service.isConfigured() && !pexelsService.isConfigured()) {
        return res.status(503).json({
            error: 'Stock media search is currently not configured.',
            code: 'NOT_CONFIGURED',
            provider: service.providerName || 'vecteezy',
        });
    }

    const providerToUse = service.isConfigured() ? service : pexelsService;

    try {
        if (type === 'photo' || type === 'image') {
            const data = await providerToUse.searchPhotos(query, { page, perPage, orientation });
            return res.json(data);
        }

        // Default: video search
        const data = await providerToUse.searchVideos(query, { page, perPage, orientation });
        return res.json(data);
    } catch (err) {
        console.error('[stockMediaRoutes /search] error:', err.message);

        const status = err.status || (err.code === 'RATE_LIMIT' ? 429 : 500);
        return res.status(status).json({
            error: err.message || 'Failed to search stock media.',
            code: err.code || 'SEARCH_FAILED',
            provider: providerToUse.providerName || 'vecteezy',
        });
    }
});

const { brollSuggesterService } = require('../services/BrollSuggesterService');

/**
 * POST /api/stock/suggest-broll
 * Context-aware stock B-roll suggestions based on transcript segments and scene context (Level 2).
 *
 * Body:
 *   - words: Array<{ start: number, end?: number, word?: string, text?: string }> (required)
 *   - chapters: Array<number> (optional)
 *   - maxSuggestions: number (optional, default 4)
 */
router.post('/suggest-broll', stockLimiter, authMiddleware, stockGate, async (req, res) => {
    const { words = [], chapters = [], maxSuggestions = 4 } = req.body || {};

    if (!Array.isArray(words) || words.length === 0) {
        return res.status(400).json({ error: 'Transcript words array is required.' });
    }

    const service = getActiveStockService();
    if (!service.isConfigured() && !pexelsService.isConfigured()) {
        return res.status(503).json({
            error: 'Stock media service is currently not configured.',
            code: 'NOT_CONFIGURED',
            provider: service.providerName || 'vecteezy',
        });
    }

    try {
        const result = await brollSuggesterService.suggestBroll({
            words,
            chapters,
            maxSuggestions: parseInt(maxSuggestions, 10) || 4,
        });

        return res.json(result);
    } catch (err) {
        console.error('[stockMediaRoutes /suggest-broll] error:', err.message);

        const status = err.status || (err.code === 'RATE_LIMIT' ? 429 : 500);
        return res.status(status).json({
            error: err.message || 'Failed to generate B-roll suggestions.',
            code: err.code || 'SUGGESTION_FAILED',
            provider: service.providerName || 'vecteezy',
        });
    }
});

module.exports = router;
