'use strict';

/**
 * server/routes/stickerRoutes.js
 *
 * R97 — icon/emoji insert command: search the sticker library (icons/emoji,
 * R83's `assets` + `stickers` tables via TaxonomyService) by free-text
 * keywords, so the client's `add_sticker` AI command can resolve a request
 * like "add a fire icon" to a real, placeable library asset.
 *
 * Deliberately NOT folded into audioEngineRoutes.js's `/api/audio/search` —
 * that route's AssetSearchEngine three-pass engine only knows SOUND_EFFECT,
 * LUT and TEMPLATE (see its own file header: "ONE search engine for ALL
 * asset types (SFX, LUT, Preset)"). Stickers are a separate, simpler,
 * single-table lookup (TaxonomyService.getStickersByKeywords/getStickersByKind),
 * so a small dedicated route avoids widening that engine's type-dispatch
 * for a shape it was never designed to carry.
 *
 * Routes:
 *   POST /api/stickers/search — keyword search over icons/emoji
 */

const express = require('express');
const router  = express.Router();

const { TaxonomyService } = require('../audio-engine/search/TaxonomyService.js');

// TODO: apply apiLimiter to this route

const taxonomyService = new TaxonomyService();

// A handful of very common words that carry no search signal on their own —
// stripped so "add a fire emoji" searches on "fire", not "fire emoji" (every
// sticker row already matches "emoji"/"icon" via sticker_kind, not keywords).
const STOPWORDS = new Set([
    'a', 'an', 'the', 'add', 'insert', 'put', 'place', 'some', 'me', 'please',
    'emoji', 'emojis', 'icon', 'icons', 'sticker', 'stickers', 'of', 'to', 'for',
]);

function keywordsFromQuery(query) {
    return String(query || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

// ── POST /api/stickers/search ─────────────────────────────────────────────
// Public route: userId is not used (no personalised ranking for stickers yet).
router.post('/search', async (req, res) => {
    const {
        query = '',
        kind  = null, // 'icon' | 'emoji' | null (either)
        limit = 10,
    } = req.body || {};

    const keywords = keywordsFromQuery(query);

    if (keywords.length === 0 && !kind) {
        return res.status(400).json({ error: 'query is required' });
    }

    try {
        const kindFilter = (kind === 'icon' || kind === 'emoji') ? kind : null;
        const safeLimit = Math.min(Number(limit) || 10, 50);

        const results = keywords.length > 0
            ? await taxonomyService.getStickersByKeywords(keywords, kindFilter, safeLimit)
            : await taxonomyService.getStickersByKind(kindFilter, safeLimit);

        return res.json({ results, keywords, kind: kindFilter });
    } catch (err) {
        console.error('[stickerRoutes POST /search] error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
