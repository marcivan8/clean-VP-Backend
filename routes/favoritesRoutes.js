'use strict';

/**
 * routes/favoritesRoutes.js
 *
 * Lightweight "favorite" bookmarking — distinct from server/routes/presetRoutes.js's
 * POST /api/presets/user, which saves a NAMED, CUSTOM set of settings. Favorites just
 * mark an existing asset (SFX/LUT row in `assets`) or a fixed transition type
 * (fade/crossfade/slide/zoom) for quick access. See supabase/migrations/
 * 20240003_favorites.sql for the schema and CLAUDE.md for the distinction.
 *
 * Routes:
 *   GET    /api/favorites              — list current user's favorites (auth)
 *   POST   /api/favorites              — add a favorite: { assetId } or { transitionType } (auth)
 *   DELETE /api/favorites              — remove a favorite: { assetId } or { transitionType } (auth)
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { authenticateUser } = require('../middleware/auth');
const { supabaseAdmin } = require('../config/database');

// Cheap reads/writes, but still rate-limited against abuse.
const favoritesLimiter = rateLimit({
    windowMs: 60_000, max: 60,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many favorite requests. Please slow down.' },
});

const ALLOWED_TRANSITION_TYPES = ['fade', 'crossfade', 'slide', 'zoom'];

function validateTarget(body) {
    const { assetId, transitionType } = body || {};
    if (!assetId && !transitionType) {
        return { error: 'assetId or transitionType is required' };
    }
    if (assetId && transitionType) {
        return { error: 'Provide only one of assetId or transitionType, not both' };
    }
    if (transitionType && !ALLOWED_TRANSITION_TYPES.includes(transitionType)) {
        return { error: `Invalid transitionType: ${transitionType}` };
    }
    return { assetId: assetId || null, transitionType: transitionType || null };
}

// ── GET /api/favorites ────────────────────────────────────────────────────────
router.get('/', authenticateUser, favoritesLimiter, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('user_favorites')
            .select('id, asset_id, transition_type, created_at')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return res.json({
            favorites: data || [],
            assetIds: (data || []).filter(f => f.asset_id).map(f => f.asset_id),
            transitionTypes: (data || []).filter(f => f.transition_type).map(f => f.transition_type),
        });
    } catch (err) {
        console.error('[favoritesRoutes GET /] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/favorites ────────────────────────────────────────────────────────
router.post('/', authenticateUser, favoritesLimiter, async (req, res) => {
    const target = validateTarget(req.body);
    if (target.error) return res.status(400).json({ error: target.error });

    try {
        const { data, error } = await supabaseAdmin
            .from('user_favorites')
            .insert({
                user_id: req.user.id,
                asset_id: target.assetId,
                transition_type: target.transitionType,
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                // Already favorited — idempotent no-op, not an error the client needs to handle.
                return res.status(200).json({ favorite: null, alreadyFavorited: true });
            }
            throw error;
        }
        return res.status(201).json({ favorite: data });
    } catch (err) {
        console.error('[favoritesRoutes POST /] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── DELETE /api/favorites ──────────────────────────────────────────────────────
router.delete('/', authenticateUser, favoritesLimiter, async (req, res) => {
    const target = validateTarget(req.body);
    if (target.error) return res.status(400).json({ error: target.error });

    try {
        let query = supabaseAdmin
            .from('user_favorites')
            .delete()
            .eq('user_id', req.user.id);

        query = target.assetId
            ? query.eq('asset_id', target.assetId)
            : query.eq('transition_type', target.transitionType);

        const { error } = await query;
        if (error) throw error;

        return res.json({ success: true });
    } catch (err) {
        console.error('[favoritesRoutes DELETE /] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
