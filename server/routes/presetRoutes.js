'use strict';

/**
 * server/routes/presetRoutes.js
 *
 * Preset Engine API routes.
 *
 * Routes:
 *   GET  /api/presets                  — list system presets (public)
 *   GET  /api/presets/:id              — get single preset (public)
 *   POST /api/presets/recommend        — context recommendations (auth)
 *   POST /api/presets/:id/apply        — execute preset (auth, FULL_EDIT requires approved=true)
 *   GET  /api/presets/user/mine        — user's personal presets (auth)
 *   POST /api/presets/user             — save a custom preset (auth)
 */

const express  = require('express');
const router   = express.Router();

const { authenticateUser } = require('../middleware/auth.js');
const { presetExecutor }   = require('../presets-engine/library/PresetExecutor.js');
const { presetLearner }    = require('../presets-engine/library/PresetLearner.js');
const { TaxonomyService }  = require('../audio-engine/search/TaxonomyService.js');
const { recommendationEngine } = require('../audio-engine/recommendations/RecommendationEngine.js');
const { supabaseAdmin }    = require('../../config/database.js');
const { PresetType }       = require('../audio-engine/types.js');

// TODO: apply apiLimiter to all routes

const taxonomy = new TaxonomyService();

// ── GET /api/presets ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const limit      = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const presetType = req.query.type || null;

    try {
        let presets;
        if (presetType) {
            presets = await taxonomy.getPresetsByType(presetType, limit);
        } else {
            presets = await taxonomy.getPresetsByIntents([], null, limit);
        }
        return res.json({ presets });
    } catch (err) {
        console.error('[presetRoutes GET /] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── GET /api/presets/user/mine ────────────────────────────────────────────────
// NOTE: Must be before /:id to avoid "user" being treated as an ID
router.get('/user/mine', authenticateUser, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    try {
        const { data, error } = await supabaseAdmin
            .from('user_presets')
            .select('*')
            .eq('user_id', req.user.id)
            .order('use_count', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return res.json({ presets: data || [] });
    } catch (err) {
        console.error('[presetRoutes GET /user/mine] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/presets/recommend ───────────────────────────────────────────────
router.post('/recommend', authenticateUser, async (req, res) => {
    const { projectState, presetType } = req.body || {};

    if (!projectState) {
        return res.status(400).json({ error: 'projectState is required' });
    }

    try {
        const presets = await recommendationEngine.recommendPresets(
            projectState,
            req.user?.id || null,
            { limit: 5, presetType: presetType || null }
        );
        return res.json({ presets });
    } catch (err) {
        console.error('[presetRoutes POST /recommend] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/presets/user ────────────────────────────────────────────────────
router.post('/user', authenticateUser, async (req, res) => {
    const { name, presetType, settings, commandSequence, isPublic } = req.body || {};

    if (!name)       return res.status(400).json({ error: 'name is required' });
    if (!presetType) return res.status(400).json({ error: 'presetType is required' });
    if (!settings)   return res.status(400).json({ error: 'settings is required' });

    if (!Object.values(PresetType).includes(presetType)) {
        return res.status(400).json({ error: `Invalid presetType: ${presetType}` });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('user_presets')
            .insert({
                user_id:          req.user.id,
                name,
                preset_type:      presetType,
                settings,
                command_sequence: commandSequence || null,
                is_public:        isPublic ?? false,
                use_count:        0,
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // unique violation
                return res.status(409).json({ error: 'A preset with this name already exists' });
            }
            throw error;
        }
        return res.status(201).json({ preset: data });
    } catch (err) {
        console.error('[presetRoutes POST /user] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── GET /api/presets/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id is required' });

    try {
        const preset = await taxonomy.getPresetByName(id);
        if (!preset) return res.status(404).json({ error: 'Preset not found' });
        return res.json({ preset });
    } catch (err) {
        console.error('[presetRoutes GET /:id] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/presets/:id/apply ───────────────────────────────────────────────
// FULL_EDIT presets require body.approved === true.
router.post('/:id/apply', authenticateUser, async (req, res) => {
    const { id }         = req.params;
    const { projectId, approved } = req.body || {};

    if (!id)        return res.status(400).json({ error: 'preset id is required' });
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    try {
        const result = await presetExecutor.execute(
            id,
            projectId,
            req.user.id,
            approved === true
        );

        if (!result.success) {
            const status = result.error?.includes('requires user approval') ? 403 : 422;
            return res.status(status).json({ error: result.error });
        }

        // Record for learning — fire-and-forget
        presetLearner.recordApplication(req.user.id, id, projectId, true);

        return res.json({
            success:  result.success,
            executed: result.executed,
            skipped:  result.skipped,
        });
    } catch (err) {
        console.error('[presetRoutes POST /:id/apply] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
