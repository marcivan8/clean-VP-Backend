const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { authenticateUser } = require('../middleware/auth');
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const { v4: uuidv4 } = require('uuid');

// In-memory cache for render jobs
const renderJobs = new Map();
const storageConfig = require('../config/storage');
const gcsBucket = storageConfig.bucket;

const toSignedUrl = async (gcsUrl) => {
    if (!gcsUrl) return gcsUrl;
    try {
        if (!gcsBucket) return gcsUrl; // Fallback if GCS is not configured
        
        // Extract path: "raw/userId/filename.mp4"
        const url = new URL(gcsUrl);
        const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME || process.env.GCS_BUCKET_NAME || 'viral-pilot_bucket';
        const gcsPath = url.pathname.replace(`/${bucketName}/`, '');
        const decodedPath = decodeURIComponent(gcsPath);

        const [signed] = await gcsBucket.file(decodedPath).getSignedUrl({
            version: 'v4',
            action:  'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour — enough for any render
        });
        return signed;
    } catch (err) {
        console.warn('[render] Could not sign URL:', gcsUrl, err.message);
        return gcsUrl; // fall back to unsigned
    }
};

/**
 * Revideo Render Proxy Routes
 * 
 * Proxies render requests to the Fly.io render worker
 * and streams the MP4 response back to the client.
 */

// Heavy compute: 5 req/min
const renderLimiter = rateLimit({
  windowMs: 60_000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Render rate limit reached. Please wait before starting another render.' }
});

// POST /api/revideo/render
router.post('/render', authenticateUser, renderLimiter, async (req, res) => {
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
            // Use sourceUrl if populated
            const raw = clip.sourceUrl || clip.url || clip.src || clip.videoUrl || clip.proxyUrl;
            if (raw && raw !== '' && !raw.startsWith('blob:')) {
                return encodeGCSUrl(raw);
            }

            // Blob or empty → build from filename
            const filename = clip.name || clip.originalName;
            if (filename) {
                return `https://storage.googleapis.com/${bucket}/raw/${userId}/${encodeURIComponent(filename)}`;
            }

            // Last resort
            if (sourceVideoUrl) return sourceVideoUrl;

            console.warn(`[render] Cannot resolve URL for clip ${clip.id}`);
            return undefined;
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

        const signedTracks = await Promise.all(
            normalizedTracks.map(async track => ({
                ...track,
                clips: await Promise.all(
                    (track.clips || []).map(async clip => ({
                        ...clip,
                        url: await toSignedUrl(clip.url),
                    }))
                ),
            }))
        );

        console.log(`📡 Triggering AWS Lambda render for video`);

        const backendUrl = process.env.FRONTEND_URL || process.env.PUBLIC_URL || 'https://your-railway-app.railway.app';
        
        const jobId = uuidv4();
        renderJobs.set(jobId, { status: 'rendering', progress: 0 });

        // Setup payload for Lambda
        const payload = {
            tracks: signedTracks,
            duration,
            fps,
            aspectRatio,
            backendUrl,
            webhookUrl: `${backendUrl}/api/revideo/webhook?jobId=${jobId}`
        };

        // Forward the request to the Lambda asynchronously
        const command = new InvokeCommand({
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME || 'revideo-render-lambda',
            InvocationType: 'Event', // Asynchronous execution
            Payload: Buffer.from(JSON.stringify(payload)),
        });

        await lambdaClient.send(command);

        res.status(202).json({
            message: 'Rendering started successfully. A webhook will be sent upon completion.',
            status: 'rendering',
            jobId
        });

    } catch (error) {
        console.error('❌ AWS Lambda proxy error:', error.message);
        res.status(500).json({
            error: 'Render initialization failed',
            message: error.message
        });
    }
});

// POST /api/revideo/webhook
// Receives completion notification from AWS Lambda
router.post('/webhook', express.json(), async (req, res) => {
    console.log('[webhook] Render Lambda callback received:', req.body, req.query);
    
    const { status, renderId, url, error } = req.body;
    const { jobId } = req.query;
    
    if (jobId) {
        if (status === 'success') {
            renderJobs.set(jobId, { status: 'success', url, renderId });
            console.log(`✅ Webhook: Job ${jobId} succeeded. Video at ${url}`);
        } else {
            renderJobs.set(jobId, { status: 'error', error });
            console.log(`❌ Webhook: Job ${jobId} failed. Error: ${error}`);
        }
    }

    res.status(200).send('Webhook received');
});

// GET /api/revideo/status/:jobId
// Frontend polling endpoint
router.get('/status/:jobId', (req, res) => {
    const job = renderJobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
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
