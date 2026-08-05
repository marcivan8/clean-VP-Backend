/**
 * routes/dataHealthRoutes.js
 *
 * Diagnostic endpoint for the "silently empty table" failure class documented in
 * CLAUDE.md R12 / R21 / R37 / R38.
 *
 * Mounted at /api/health.
 *   GET /api/health/data — row counts + problems for every dependency table.
 *
 * Follows the shape already established by GET /api/revideo/health: a `checks`
 * object plus an explicit `problems` array, so a failure is readable without
 * having to interpret the raw numbers.
 *
 * ACCESS: gated behind ADMIN_SECRET (x-admin-secret header). The counts
 * themselves are not sensitive, but an unauthenticated endpoint that enumerates
 * internal table names is free reconnaissance. Deliberately NOT added to the
 * public GET /health that Railway polls for deploys — an empty seed table must
 * never fail a health check and roll back a deploy (same reasoning as R28: a new
 * blocking gate with no track record breaks the platform rather than protecting
 * it).
 *
 * Rate limiter: none applied at mount. It's admin-secret gated and does ~7 head
 * count queries; if it ever becomes public, apply a limiter here.
 */

'use strict';

const express = require('express');
const router  = express.Router();

const { checkDataHealth } = require('../services/DataHealthProbe');

function requireAdminSecret(req, res, next) {
    const expected = process.env.ADMIN_SECRET;

    // Fail CLOSED: with no ADMIN_SECRET configured this endpoint stays shut
    // rather than falling open to everyone.
    if (!expected) {
        return res.status(503).json({
            error: 'ADMIN_SECRET is not configured — data health endpoint is disabled',
        });
    }
    if (req.headers['x-admin-secret'] !== expected) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}

// ── GET /api/health/data ─────────────────────────────────────────────────────
// Reports which dependency tables actually contain data.
// 200 with status:'ok' when every table has rows; 200 with status:'degraded'
// and a populated `problems` array otherwise — never a 5xx, because a data
// problem is not a server fault and this must not read as "the API is down".
router.get('/data', requireAdminSecret, async (_req, res) => {
    try {
        const report = await checkDataHealth();
        return res.json(report);
    } catch (err) {
        console.error('[dataHealthRoutes] /data error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
