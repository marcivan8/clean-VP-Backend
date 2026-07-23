'use strict';

/**
 * server/routes/audioEngineRoutes.js
 *
 * Creative Asset Intelligence — unified search and recommendation routes.
 *
 * Routes:
 *   POST /api/audio/search          — universal asset search (SFX + LUTs + presets)
 *   POST /api/audio/recommend       — all recommendations combined (SFX + LUTs + presets)
 *   POST /api/audio/recommend/sfx   — SFX recommendations only
 *
 * These routes mount on the same /api/audio prefix as audioExportRoutes and
 * the existing audioRoutes — Express dispatches by path, no conflicts.
 */

const express = require('express');
const router  = express.Router();

const { authenticateUser }       = require('../../middleware/auth.js');
const { assetSearchEngine }      = require('../audio-engine/search/AssetSearchEngine.js');
const { recommendationEngine }   = require('../audio-engine/recommendations/RecommendationEngine.js');
const { userPreferenceEngine }   = require('../audio-engine/search/UserPreferenceEngine.js');
const { QueryParser }            = require('../audio-engine/search/QueryParser.js');

// TODO: apply apiLimiter to search and recommendation routes

const qp = new QueryParser();

// ── POST /api/audio/search ────────────────────────────────────────────────────
// Universal asset search — SFX, LUTs, and presets via the three-pass engine.
// Public route: userId is optional (used for personalised ranking if present).
router.post('/search', async (req, res) => {
    const {
        query      = '',
        assetTypes = null,
        intents    = null,
        emotions   = null,
        limit      = 10,
    } = req.body || {};

    if (!query && !assetTypes && !intents) {
        return res.status(400).json({ error: 'query, assetTypes, or intents is required' });
    }

    try {
        // Parse the natural language query into a structured SemanticSearchQuery.
        // NOTE: QueryParser reads context.forcedAssetType (singular) — the plural
        // form was a typo that caused the type hint to be silently ignored.
        const parsed = qp.parse(query, {
            forcedAssetType: assetTypes?.length === 1 ? assetTypes[0] : undefined,
        });

        // Override limit from request
        if (limit) parsed.limit = Math.min(Number(limit), 50);

        // Merge explicit intents/emotions if provided
        if (intents  && Array.isArray(intents))  parsed.intents  = [...new Set([...(parsed.intents  || []), ...intents])];
        if (emotions && Array.isArray(emotions)) parsed.emotions = [...new Set([...(parsed.emotions || []), ...emotions])];

        // Fetch user preferences for ranking (optional, non-blocking)
        const userId = req.user?.id || null;
        const userPrefs = userId ? await userPreferenceEngine.getUserPrefs(userId).catch(() => null) : null;

        const results = await assetSearchEngine.search(parsed, { userPrefs, userId });

        return res.json({ results, query: parsed });
    } catch (err) {
        console.error('[audioEngineRoutes POST /search] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/audio/recommend ─────────────────────────────────────────────────
// All recommendations in one call — SFX + LUTs + presets concurrently.
// Requires auth (recommendations are user-personalised).
router.post('/recommend', authenticateUser, async (req, res) => {
    const { projectState, limit = 5 } = req.body || {};

    if (!projectState) {
        return res.status(400).json({ error: 'projectState is required' });
    }

    try {
        const all = await recommendationEngine.recommendAll(
            projectState,
            req.user.id,
            { limit: Math.min(Number(limit), 20) }
        );
        return res.json(all); // { sfx, luts, presets }
    } catch (err) {
        console.error('[audioEngineRoutes POST /recommend] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/audio/recommend/sfx ─────────────────────────────────────────────
// SFX-only recommendations.
router.post('/recommend/sfx', authenticateUser, async (req, res) => {
    const { projectState, limit = 5 } = req.body || {};

    if (!projectState) {
        return res.status(400).json({ error: 'projectState is required' });
    }

    try {
        const results = await recommendationEngine.recommendSFX(
            projectState,
            req.user.id,
            { limit: Math.min(Number(limit), 20) }
        );
        return res.json({ results });
    } catch (err) {
        console.error('[audioEngineRoutes POST /recommend/sfx] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
