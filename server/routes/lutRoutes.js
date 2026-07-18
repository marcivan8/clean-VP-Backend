'use strict';

/**
 * server/routes/lutRoutes.js
 *
 * LUT Engine API routes.
 *
 * Routes:
 *   GET  /api/luts                  — list all active LUTs (public)
 *   GET  /api/luts/:id              — get single LUT by UUID (public)
 *   GET  /api/luts/:id/preview      — get CSS filter string for preview (public)
 *   POST /api/luts/search           — search LUTs by profile / intent (public)
 *   POST /api/luts/recommend        — context-aware LUT recommendations (auth)
 *   POST /api/luts/upload           — upload a custom .cube LUT (auth)
 *                                     Storage path: luts/{userId}/custom/{assetId}.cube
 *                                     IMPORTANT: userId is always embedded in the path
 *                                     so no user can access another's LUT via a crafted URL.
 */

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');

const { authenticateUser }     = require('../middleware/auth.js');
const { lutService }           = require('../lut-engine/library/LUTService.js');
const { recommendationEngine } = require('../audio-engine/recommendations/RecommendationEngine.js');
const { QueryParser }          = require('../audio-engine/search/QueryParser.js');
const { AssetType }            = require('../audio-engine/types.js');
const { StorageService }       = require('../../services/StorageService.js');
const { supabaseAdmin }        = require('../../config/database.js');

// Multer: memory storage — file is uploaded to GCS, not written to disk
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB max
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.cube') return cb(null, true);
        cb(new Error('Only .cube LUT files are accepted'));
    },
});

// TODO: apply apiLimiter (general rate limiter) to all LUT routes

const qp = new QueryParser();

// ── GET /api/luts ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const limit         = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const cinematicOnly = req.query.cinematic === 'true';
    const category      = req.query.category || null;

    try {
        const luts = await lutService.listLUTs({ limit, cinematicOnly, category });
        return res.json({ luts });
    } catch (err) {
        console.error('[lutRoutes GET /] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── GET /api/luts/:id ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id is required' });

    try {
        const lut = await lutService.getLUTById(id);
        if (!lut) return res.status(404).json({ error: 'LUT not found' });
        return res.json({ lut });
    } catch (err) {
        console.error('[lutRoutes GET /:id] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── GET /api/luts/:id/preview ─────────────────────────────────────────────────
// Returns { cssFilter: string } — NEVER null.
// Used by the editor to apply real-time preview without FFmpeg.
router.get('/:id/preview', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id is required' });

    try {
        const cssFilter = await lutService.getPreviewFilter(id);
        return res.json({ cssFilter });
    } catch (err) {
        console.error('[lutRoutes GET /:id/preview] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/luts/search ─────────────────────────────────────────────────────
router.post('/search', async (req, res) => {
    const { query, warmthMin, warmthMax, contrastMin, contrastMax, saturationMin, saturationMax, cinematicOnly, limit } = req.body || {};

    try {
        let profileQuery = {};

        if (query) {
            // Natural language → structured query
            profileQuery = qp.parse(query, { forcedAssetType: AssetType.LUT });
        } else {
            profileQuery = {
                warmth_min:     warmthMin    ?? -5,
                warmth_max:     warmthMax    ??  5,
                contrast_min:   contrastMin  ?? -5,
                contrast_max:   contrastMax  ??  5,
                saturation_min: saturationMin ?? -5,
                saturation_max: saturationMax ??  5,
                cinematicOnly:  cinematicOnly ?? false,
            };
        }

        const luts = await lutService.searchLUTs(profileQuery, Math.min(parseInt(limit, 10) || 10, 30));
        return res.json({ luts });
    } catch (err) {
        console.error('[lutRoutes POST /search] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/luts/upload ─────────────────────────────────────────────────────
// Upload a custom .cube LUT file scoped to the authenticated user.
//
// Storage path: luts/{userId}/custom/{assetId}.cube
// The userId prefix is the isolation boundary — signed URL generation in
// StorageService always includes this prefix, so no user can craft a URL
// for another user's custom LUT.
//
// Returns { assetId, gcsPath, cssFilterPreview }
// Note: cssFilterPreview will be 'none' — the user should apply the LUT and
// preview via the export pipeline, or provide a manual CSS string.
router.post('/upload', authenticateUser, upload.single('lut'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'A .cube file is required (field name: lut)' });
    }

    const userId    = req.user.id;
    const assetId   = uuidv4();
    const displayName = req.body.name || path.basename(req.file.originalname, '.cube');

    // SECURITY: path is always userId-scoped — no cross-user access possible
    const gcsPath = `luts/${userId}/custom/${assetId}.cube`;

    try {
        const storage = new StorageService();

        // Write buffer to temp file then upload (StorageService expects a file path or buffer)
        const publicUrl = await storage.uploadBuffer(req.file.buffer, gcsPath, 'application/octet-stream');

        // Insert into assets table so it appears in the LUT library for this user
        const { data: asset, error: insertError } = await supabaseAdmin
            .from('assets')
            .insert({
                id:                 assetId,
                type:               AssetType.LUT,
                display_name:       displayName,
                is_active:          true,
                is_user_uploaded:   true,
                uploaded_by:        userId,
                asset_url:          publicUrl || gcsPath,
                gcs_path:           gcsPath,
                css_filter_preview: 'none', // custom LUTs don't have a pre-computed CSS preview
                source:             'user_upload',
                use_count:          0,
            })
            .select()
            .single();

        if (insertError) {
            console.error('[lutRoutes POST /upload] DB insert error:', insertError.message);
            return res.status(500).json({ error: insertError.message });
        }

        return res.status(201).json({
            assetId,
            gcsPath,
            displayName,
            cssFilterPreview: 'none',
            asset,
        });

    } catch (err) {
        console.error('[lutRoutes POST /upload] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── POST /api/luts/recommend ──────────────────────────────────────────────────
router.post('/recommend', authenticateUser, async (req, res) => {
    const { projectState } = req.body || {};

    if (!projectState) {
        return res.status(400).json({ error: 'projectState is required' });
    }

    try {
        const luts = await recommendationEngine.recommendLUTs(
            projectState,
            req.user?.id || null,
            { limit: 3 }
        );
        return res.json({ luts });
    } catch (err) {
        console.error('[lutRoutes POST /recommend] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
