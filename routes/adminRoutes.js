// routes/adminRoutes.js: admin operations, guarded by the ADMIN_SECRET header
const express = require('express');
const router = express.Router();
const { bucket } = require('../config/storage');

const crypto = require('crypto');

// ADMIN_SECRET must be set: before, an unset secret compared equal to a
// missing header (undefined === undefined) and let anyone in.
function checkAdminSecret(req, res) {
    const expected = process.env.ADMIN_SECRET || '';
    const given = String(req.headers['x-admin-secret'] || '');
    const ok = expected.length >= 16 && given.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) res.status(403).json({ error: 'Forbidden' });
    return ok;
}

function requireAdmin(req, res, next) {
    if (!checkAdminSecret(req, res)) return;
    if (!bucket) {
        return res.status(500).json({ error: 'GCS bucket not configured' });
    }
    next();
}

function requireAdminNoBucket(req, res, next) {
    if (!checkAdminSecret(req, res)) return;
    next();
}

// Set CORS policy on the bucket
router.post('/set-cors', requireAdmin, async (_req, res) => {
    try {
        await bucket.setCorsConfiguration([{
            origin: [
                'https://www.viralpilot.fr',
                'http://localhost:5173',
                'http://localhost:3000',
            ],
            method: ['GET', 'HEAD', 'OPTIONS', 'PUT'],
            responseHeader: [
                'Content-Type',
                'Content-Range',
                'Accept-Ranges',
                'Content-Length',
                'ETag',
                'X-Goog-Upload-Status',
                'X-Goog-Upload-Command',
                'X-Goog-Upload-Offset',
                'X-Goog-Upload-URL',
                'X-Goog-Resumable',
            ],
            maxAgeSeconds: 3600,
        }]);
        res.json({ success: true, message: `CORS set on ${bucket.name}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Remove public read access from every user file (raw uploads, proxies,
// exports, ...). Files are served only through /api/proxy/gcs-media, which
// checks the owner (services/mediaAccess.js). Proxies used to be made public
// here and on upload; run this once to close that. No-op on a uniform-access
// bucket (check the bucket's IAM has no allUsers / allAuthenticatedUsers).
router.post('/make-media-private', requireAdmin, async (_req, res) => {
    try {
        const { USER_PREFIXES } = require('../services/mediaAccess');
        const results = { ok: 0, failed: [] };
        for (const prefix of USER_PREFIXES) {
            const [files] = await bucket.getFiles({ prefix: `${prefix}/` });
            await Promise.all(files.map(async (file) => {
                try {
                    await file.makePrivate();
                    results.ok++;
                } catch (err) {
                    results.failed.push({ name: file.name, error: err.message });
                }
            }));
        }
        res.json({ success: true, madePrivate: results.ok, failed: results.failed.length, failures: results.failed.slice(0, 50) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Run the retention job now. ?dryRun=1 reports what would be warned and
// deleted without sending emails or deleting anything.
router.post('/retention/run', requireAdminNoBucket, async (req, res) => {
    try {
        const dryRun = ['1', 'true', 'yes'].includes(String(req.query.dryRun || '').toLowerCase());
        const { runRetentionNow } = require('../services/retentionScheduler');
        const report = await runRetentionNow({ dryRun });
        res.json({ success: true, dryRun, report });
    } catch (err) {
        console.error('[admin/retention] failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
