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
const { TaxonomyService }        = require('../audio-engine/search/TaxonomyService.js');
const { timelineEventDetector }  = require('../audio-engine/timeline/TimelineEventDetector.js');
const {
    SEMANTIC_EVENT_TYPES,
    animationsForEventType,
    sfxIntentsForEventType,
}                                 = require('../audio-engine/timeline/AnimationKnowledgeGraph.js');

// TODO: apply apiLimiter to search and recommendation routes

const qp = new QueryParser();
const taxonomyService = new TaxonomyService();

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

// ── POST /api/audio/animate-automatically ─────────────────────────────────────
// R68 — AI Animation Intelligence. "Brain chooses animations. Users don't."
// One explicit command: detect the four semantic events heuristically
// (TimelineEventDetector.js), resolve each through AnimationKnowledgeGraph.js
// into a real motion preset id + real SFX rows, and hand back a flat plan.
// This route only DETECTS and RESOLVES — it never writes to the timeline;
// applying the plan (calling applyPresetToClip, inserting SFX clips) happens
// client-side as one undoable action (client/src/agent/MediaExecutionEngine.js
// `animate_automatically`), matching how every other timeline mutation in
// this app is required to go through the store's own history/undo path.
router.post('/animate-automatically', authenticateUser, async (req, res) => {
    const { projectState } = req.body || {};

    if (!projectState || !Array.isArray(projectState.tracks)) {
        return res.status(400).json({ error: 'projectState.tracks is required' });
    }

    try {
        const events = timelineEventDetector
            .detect(projectState)
            .filter(e => SEMANTIC_EVENT_TYPES.includes(e.eventType));

        // clipId → layer kind, so animations resolve to the right preset
        // family (text vs camera) for the clip the event actually landed on.
        const clipKind = {};
        for (const track of projectState.tracks) {
            for (const clip of (track.clips || [])) {
                if (!clip?.id) continue;
                const t = clip.type || track.type;
                clipKind[clip.id] = (t === 'text' || t === 'caption' || clip.isCaption) ? 'text' : 'video';
            }
        }

        // Memoize SFX lookups per event type within this request — several
        // events of the same type shouldn't re-query Supabase identically.
        const sfxCache = new Map();
        const plan = [];
        for (const event of events) {
            const kind = clipKind[event.clipId] || 'video';
            const presetId = animationsForEventType(event.eventType, kind)[0] || null;

            const intents = sfxIntentsForEventType(event.eventType);
            let sfx = [];
            if (intents.length) {
                if (!sfxCache.has(event.eventType)) {
                    sfxCache.set(event.eventType, await taxonomyService.getSFXByIntents(intents, 3));
                }
                sfx = sfxCache.get(event.eventType);
            }

            plan.push({
                eventType:    event.eventType,
                timelineTime: event.timelineTime,
                clipId:       event.clipId,
                trackId:      event.trackId,
                presetId,
                sfx,
            });
        }

        return res.json({ events, plan });
    } catch (err) {
        console.error('[audioEngineRoutes POST /animate-automatically] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
