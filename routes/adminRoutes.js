// routes/adminRoutes.js — TEMPORARY: remove after running these endpoints once
const express = require('express');
const router = express.Router();
const { bucket } = require('../config/storage');

function requireAdmin(req, res, next) {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!bucket) {
        return res.status(500).json({ error: 'GCS bucket not configured' });
    }
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
            method: ['GET', 'HEAD', 'OPTIONS'],
            responseHeader: [
                'Content-Type',
                'Content-Range',
                'Accept-Ranges',
                'Content-Length',
                'ETag',
            ],
            maxAgeSeconds: 3600,
        }]);
        res.json({ success: true, message: `CORS set on ${bucket.name}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Make all existing proxy objects publicly readable (fixes 403 on already-uploaded files)
router.post('/make-proxies-public', requireAdmin, async (_req, res) => {
    try {
        const [files] = await bucket.getFiles({ prefix: 'proxies/' });
        const results = { ok: [], failed: [] };

        await Promise.all(files.map(async (file) => {
            try {
                await file.makePublic();
                results.ok.push(file.name);
            } catch (err) {
                results.failed.push({ name: file.name, error: err.message });
            }
        }));

        res.json({
            success: true,
            publicized: results.ok.length,
            failed: results.failed.length,
            failures: results.failed,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
