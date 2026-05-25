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
    console.log('[render] body keys:', Object.keys(req.body));
    console.log('[render] sourceVideoUrl:', req.body.sourceVideoUrl);
    console.log('[render] first clip sample:', JSON.stringify(
        (req.body.timeline?.tracks?.[0]?.clips?.[0] || req.body.tracks?.[0]?.clips?.[0] || {}),
        null, 2
    ));
    try {
        const { RENDER_WORKER_URL, WORKER_SECRET } = process.env;

        if (!RENDER_WORKER_URL || !WORKER_SECRET) {
            console.error('❌ Missing RENDER_WORKER_URL or WORKER_SECRET environment variables');
            return res.status(500).json({ error: 'Render proxy not configured' });
        }

        const { tracks = [], duration = 10, fps = 30, sourceVideoUrl } = req.body.timeline || req.body;

        // Whitelist aspectRatio
        const ALLOWED_RATIOS = ['16:9', '9:16', '1:1', '4:5'];
        const aspectRatio = ALLOWED_RATIOS.includes(req.body.aspectRatio) ? req.body.aspectRatio : '16:9';

        // Resolve blob URLs to GCS URLs before proxying
        const userId = req.user.id;
        const bucket = process.env.GCS_BUCKET_NAME || 'viral-pilot_bucket';

        const resolveUrl = (clip) => {
            const raw = clip.url || clip.src || clip.videoUrl || clip.proxyUrl;

            // Silence-removal segments: no URL, use the source video
            if (!raw) {
                if (sourceVideoUrl) return sourceVideoUrl;
                console.warn(`[render] clip ${clip.id} has no URL and no sourceVideoUrl`);
                return undefined;
            }

            // Blob → GCS
            if (raw.startsWith('blob:')) {
                if (clip.gcsPath) {
                    return `https://storage.googleapis.com/${bucket}/${clip.gcsPath
                        .split('/').map(encodeURIComponent).join('/')}`;
                }
                const filename = clip.originalName || clip.name;
                if (filename) {
                    return `https://storage.googleapis.com/${bucket}/raw/${userId}/${encodeURIComponent(filename)}`;
                }
                return undefined;
            }

            // Already a GCS URL — just return it (will be encoded below)
            return raw;
        };

        const encodeGCSUrl = (url) => {
            if (!url) return url;
            if (!url.startsWith('https://storage.googleapis.com')) return url;
            // Don't double-encode already-encoded URLs
            if (!url.includes(' ')) return url;
            try {
                const u = new URL(url);
                // Encode each path segment individually, preserving slashes
                u.pathname = u.pathname
                    .split('/')
                    .map(seg => encodeURIComponent(decodeURIComponent(seg)))
                    .join('/');
                return u.toString();
            } catch {
                return url.replace(/ /g, '%20');
            }
        };

        const normalizedTracks = tracks.map(track => ({
            ...track,
            clips: (track.clips || []).map(clip => ({
                ...clip,
                url: encodeGCSUrl(resolveUrl(clip)),
            }))
        }));

        console.log(`📡 Proxying render to worker: ${RENDER_WORKER_URL}`);

        // Forward the request to the worker
        const response = await axios({
            method: 'POST',
            url: `${RENDER_WORKER_URL}/render`,
            headers: {
                'x-worker-secret': WORKER_SECRET,
                'Content-Type': 'application/json'
            },
            data: { 
                tracks: normalizedTracks, 
                duration, 
                fps, 
                aspectRatio,
                backendUrl: process.env.FRONTEND_URL || process.env.PUBLIC_URL || 'https://your-railway-app.railway.app'
            },
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
