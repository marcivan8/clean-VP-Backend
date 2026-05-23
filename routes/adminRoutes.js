// routes/adminRoutes.js — TEMPORARY: remove after running /api/admin/set-cors once
const express = require('express');
const router = express.Router();
const { bucket } = require('../config/storage');

router.post('/set-cors', async (req, res) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!bucket) {
        return res.status(500).json({ error: 'GCS bucket not configured' });
    }
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

module.exports = router;
