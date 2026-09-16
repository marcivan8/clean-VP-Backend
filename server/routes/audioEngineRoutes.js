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
    layerKindForClip,
    resolveOverlayAnimations,
}                                 = require('../audio-engine/timeline/AnimationKnowledgeGraph.js');
const { computeIntensity, pickPresetForIntensity } = require('../audio-engine/timeline/AnimationIntensity.js'); // R81 — zero-cost bespoke-animation synthesizer
const { computeStyleSeed, pickSecondaryPreset } = require('../audio-engine/timeline/AnimationCombiner.js'); // R82 — zero-cost animation combinations

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
// One explicit command: detect the five semantic events heuristically
// (TimelineEventDetector.js — R79 added CHAPTER_START to the original four),
// resolve each through AnimationKnowledgeGraph.js
// into a real motion preset id + real SFX rows, and hand back a flat plan.
// R81 adds one more field per plan item: `intensity`, a 0..1 value computed
// from that SPECIFIC event's own metadata (AnimationIntensity.js) — so the
// preset choice AND the eventual keyframes are no longer identical for every
// instance of the same event type. This route only DETECTS and RESOLVES — it
// never writes to the timeline; applying the plan (calling
// applyPresetToClip, inserting SFX clips) happens client-side as one
// undoable action (client/src/agent/MediaExecutionEngine.js
// `animate_automatically`), matching how every other timeline mutation in
// this app is required to go through the store's own history/undo path.
router.post('/animate-automatically', authenticateUser, async (req, res) => {
    const { projectState, projectId } = req.body || {};

    if (!projectState || !Array.isArray(projectState.tracks)) {
        return res.status(400).json({ error: 'projectState.tracks is required' });
    }

    try {
        // R82 — a project's cached tone (ProjectIntelligence.js), READ ONLY.
        // getMap never triggers a fresh computation (that's ensureMap/
        // deriveMap, which call OpenAI) — a missing row just means no tone
        // signal, not an error. Mirrors the exact pattern lutRoutes.js's own
        // POST /recommend already uses for the same reason.
        const userId = req.user?.id || null;
        let projectTone = null;
        if (projectId && userId) {
            try {
                const { ProjectIntelligence } = require('../brain/ProjectIntelligence');
                const map = await new ProjectIntelligence().getMap(projectId, userId);
                projectTone = map?.tone || null;
            } catch (piErr) {
                console.warn('[audioEngineRoutes POST /animate-automatically] tone lookup failed (continuing without it):', piErr.message);
            }
        }

        const events = timelineEventDetector
            .detect(projectState)
            .filter(e => SEMANTIC_EVENT_TYPES.includes(e.eventType));

        // clipId → { kind, trackId }, so animations resolve to the right preset
        // family for the clip an event actually landed on. layerKindForClip is
        // the real 5-kind classifier (text/caption/image/video/sticker) ported
        // from ClipAdapter.inferKind — this used to be a crude text-vs-video
        // ternary, which is why an overlay photo/sticker could never resolve to
        // its own preset family even if an event had somehow targeted one.
        const clipInfo = {};
        for (const track of projectState.tracks) {
            for (const clip of (track.clips || [])) {
                if (!clip?.id) continue;
                clipInfo[clip.id] = {
                    kind:    layerKindForClip(clip, track.type),
                    trackId: track.id || null,
                };
            }
        }

        // Memoize SFX lookups per event type within this request — several
        // events of the same type shouldn't re-query Supabase identically.
        const sfxCache = new Map();
        const plan = [];
        for (const event of events) {
            const primaryInfo = clipInfo[event.clipId];
            const kind = primaryInfo?.kind || 'video';
            const candidates = animationsForEventType(event.eventType, kind);
            // R81 — "brain chooses animations" used to mean "the brain always
            // chooses the SAME animation" for a given event type. intensity is
            // a real 0..1 signal (loudness, pause length, push-in size — see
            // AnimationIntensity.js) computed from THIS event's own metadata,
            // so two PUNCHLINE_DETECTED moments with different db/silenceGapS
            // now resolve to genuinely different keyframes downstream
            // (ClipAdapter.applyPresetToClip → AnimationSynthesizer.js), not
            // just the same fixed preset replayed twice.
            const intensity = computeIntensity(event.eventType, event.metadata);
            const presetId  = pickPresetForIntensity(candidates, intensity);
            // R82 — layer a complementary secondary preset (a different
            // animation-type channel, e.g. scale+glow) on top of the primary,
            // deterministically chosen from this event's own text/label plus
            // the project's cached tone (both free — see AnimationCombiner.js).
            const secondaryPresetId = pickSecondaryPreset(presetId, computeStyleSeed(event, projectTone));

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
                secondaryPresetId,
                intensity,
                sfx,
            });
        }

        // Overlay clips (images/stickers/shapes the user has manually placed
        // via "add as overlay") and secondary/picture-in-picture video clips
        // are invisible to the heuristics above — REVEAL/PUNCHLINE/EMPHASIS/
        // EMOTIONAL_BEAT only ever look at the base video/audio/caption
        // tracks for a clipId to attach an event to. But if a moment is
        // happening on screen, whatever else is ALSO visible at that same
        // instant should react to it too — a photo sitting on the overlay
        // track during a punchline should still get its own punch, not just
        // sit static. No SFX on these — one moment triggers one sound
        // effect, already on the primary item above.
        plan.push(...resolveOverlayAnimations(events, projectState.tracks, projectTone));

        return res.json({ events, plan });
    } catch (err) {
        console.error('[audioEngineRoutes POST /animate-automatically] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
