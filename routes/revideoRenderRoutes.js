const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticateUser } = require('../middleware/auth');

/**
 * Revideo Render Proxy Routes
 * 
 * Proxies render requests to the Fly.io render worker
 * and streams the MP4 response back to the client.
 */

// POST /api/revideo/render
router.post('/render', authenticateUser, async (req, res) => {
    try {
        const { RENDER_WORKER_URL, WORKER_SECRET } = process.env;

        if (!RENDER_WORKER_URL || !WORKER_SECRET) {
            console.error('❌ Missing RENDER_WORKER_URL or WORKER_SECRET environment variables');
            return res.status(500).json({ error: 'Render proxy not configured' });
        }

        const { tracks = [], duration = 10, fps = 30 } = req.body.timeline || req.body;

        // Whitelist aspectRatio
        const ALLOWED_RATIOS = ['16:9', '9:16', '1:1', '4:5'];
        const aspectRatio = ALLOWED_RATIOS.includes(req.body.aspectRatio) ? req.body.aspectRatio : '16:9';

        console.log(`📡 Proxying render to worker: ${RENDER_WORKER_URL}`);

        // Forward the request to the worker
        const response = await axios({
            method: 'POST',
            url: `${RENDER_WORKER_URL}/render`,
            headers: {
                'x-worker-secret': WORKER_SECRET,
                'Content-Type': 'application/json'
            },
            data: { tracks, duration, fps, aspectRatio },
            responseType: 'stream',
            timeout: 300000 // 5 minute timeout for long renders
        });

        // Set the appropriate headers for an MP4 download
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', response.headers['content-disposition'] || 'attachment; filename="render.mp4"');

        // Pipe the video stream directly back to the client
        response.data.pipe(res);

    } catch (error) {
        console.error('❌ Revideo proxy error:', error.message);
        if (error.response) {
            // Worker returned an error
            res.status(error.response.status).json({
                error: 'Render worker failed',
                message: error.response.data?.message || error.message
            });
        } else {
            // Network or timeout error
            res.status(500).json({
                error: 'Render proxy failed',
                message: error.message
            });
        }
    }
});

// GET /api/revideo/health
router.get('/health', async (req, res) => {
    try {
        const { RENDER_WORKER_URL } = process.env;
        if (!RENDER_WORKER_URL) {
            return res.json({ status: 'ok', renderer: 'proxy-unconfigured' });
        }
        
        const response = await axios.get(`${RENDER_WORKER_URL}/health`, { timeout: 5000 });
        res.json({ status: 'ok', renderer: 'proxy', worker: response.data });
    } catch (error) {
        res.json({ status: 'degraded', renderer: 'proxy', workerError: error.message });
    }
});

module.exports = router;
