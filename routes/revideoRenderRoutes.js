const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { authenticateUser } = require('../middleware/auth');
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const { v4: uuidv4 } = require('uuid');

// In-memory cache for render jobs.
// Janitor below evicts entries older than 60 min so recovered/abandoned jobs
// (including bogus jobIds polled by mistake) can't grow the Map unboundedly.
const renderJobs = new Map();
const RENDER_JOB_TTL_MS = 60 * 60 * 1000;
setInterval(() => {
    const cutoff = Date.now() - RENDER_JOB_TTL_MS;
    for (const [id, job] of renderJobs) {
        if ((job.createdAt || 0) < cutoff) renderJobs.delete(id);
    }
}, 10 * 60 * 1000).unref();
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

/**
 * Scans tracks for the first caption/text clip and returns its style.
 * Used as a fallback when the client doesn't send captionStyle explicitly.
 */
function extractCaptionStyleFromTracks(tracks) {
    for (const track of (tracks || [])) {
        for (const clip of (track.clips || [])) {
            if (clip.type === 'caption' || clip.type === 'text') {
                return {
                    fontFamily:      clip.fontFamily      || null,
                    fontSize:        clip.fontSize        || null,
                    fontWeight:      clip.fontWeight      || null,
                    color:           clip.color           || null,
                    backgroundColor: clip.backgroundColor || null,
                };
            }
        }
    }
    return null;
}

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

        // Extract caption style from the request body, or scan tracks as fallback.
        // This is forwarded to the Lambda so FontInstaller knows which font to load.
        const captionStyle = req.body.captionStyle || extractCaptionStyleFromTracks(tracks);

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

        // backendUrl serves two purposes: the completion webhook target AND the
        // font-download fallback source for the Lambda (it fetches committed TTFs
        // from ${backendUrl}/fonts/<file> — same files the FFmpeg path uses).
        // The old hardcoded fallback ('https://your-railway-app.railway.app') was
        // a placeholder that silently sent every webhook to a dead domain — the #1
        // cause of renders stuck at 'rendering' until the client timed out.
        const backendUrl = process.env.FRONTEND_URL || process.env.PUBLIC_URL || null;
        if (!backendUrl) {
            console.warn(
                '⚠️  [render] FRONTEND_URL / PUBLIC_URL not set — Lambda webhook + font fallback disabled. ' +
                'Completion will be detected via GCS polling only (slower). Set PUBLIC_URL to this backend\'s public URL.'
            );
        }

        const jobId = uuidv4();
        renderJobs.set(jobId, { status: 'rendering', progress: 0, createdAt: Date.now() });

        // Setup payload for Lambda.
        // renderId = jobId is CRITICAL: it makes the Lambda's GCS output path
        // deterministic (renders/{jobId}.mp4), which lets GET /status/:jobId
        // detect completion directly from GCS even if the webhook never arrives
        // (bad/missing backendUrl, Railway restart wiping renderJobs, transient
        // network failure — all previously fatal, see R10-style ephemerality).
        const payload = {
            tracks: signedTracks,
            duration,
            fps,
            aspectRatio,
            backendUrl: backendUrl || '',
            captionStyle,   // ← font family + style so Lambda can pre-load the right font
            renderId: jobId,
            ...(backendUrl ? { webhookUrl: `${backendUrl}/api/revideo/webhook?jobId=${jobId}` } : {}),
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
        const createdAt = renderJobs.get(jobId)?.createdAt || Date.now();
        if (status === 'success') {
            renderJobs.set(jobId, { status: 'success', url, renderId, createdAt });
            console.log(`✅ Webhook: Job ${jobId} succeeded. Video at ${url}`);
        } else {
            renderJobs.set(jobId, { status: 'error', error, createdAt });
            console.log(`❌ Webhook: Job ${jobId} failed. Error: ${error}`);
        }
    }

    res.status(200).send('Webhook received');
});

// GET /api/revideo/status/:jobId
// Frontend polling endpoint.
//
// Completion detection is TWO-SOURCE:
//   1. The Lambda webhook (fast path) — updates renderJobs when it arrives.
//   2. Direct GCS check for renders/{jobId}.mp4 (recovery path) — because the
//      webhook can be lost forever (backendUrl unset/wrong, Railway restart
//      wiping the in-memory Map, transient network failure between AWS and
//      Railway). The Lambda writes its output to a jobId-deterministic path
//      precisely so this check is possible.
// GCS checks are throttled to ≥5s apart per job and only start after a 15s
// grace period (a render can never finish faster than that).
const GCS_CHECK_GRACE_MS    = 15_000;
const GCS_CHECK_INTERVAL_MS = 5_000;

router.get('/status/:jobId', async (req, res) => {
    const { jobId } = req.params;
    // UUID-shape guard — jobId feeds a GCS object path below
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
        return res.status(400).json({ error: 'Invalid job id' });
    }

    let job = renderJobs.get(jobId);

    // Unknown job (e.g. server restarted since render started): treat it as a
    // possibly-in-flight render and rely on the GCS check below. createdAt is
    // backdated past the grace period so the GCS check fires immediately.
    if (!job) {
        job = { status: 'rendering', progress: 0, createdAt: Date.now() - GCS_CHECK_GRACE_MS - 1, _recovered: true };
        renderJobs.set(jobId, job);
    }

    if (job.status === 'rendering' && gcsBucket) {
        const now      = Date.now();
        const oldEnough = (now - (job.createdAt || 0)) > GCS_CHECK_GRACE_MS;
        const throttled = job._lastGcsCheck && (now - job._lastGcsCheck) < GCS_CHECK_INTERVAL_MS;
        if (oldEnough && !throttled) {
            job._lastGcsCheck = now;
            try {
                const file = gcsBucket.file(`renders/${jobId}.mp4`);
                const [exists] = await file.exists();
                if (exists) {
                    const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME || process.env.GCS_BUCKET_NAME || 'viral-pilot_bucket';
                    job = { status: 'success', url: `https://storage.googleapis.com/${bucketName}/renders/${jobId}.mp4`, renderId: jobId };
                    renderJobs.set(jobId, job);
                    console.log(`✅ [status] Job ${jobId} detected complete via GCS check (webhook missed or pending)`);
                }
            } catch (gcsErr) {
                console.warn(`[status] GCS check failed for job ${jobId}:`, gcsErr.message);
            }
        }
    }

    // Sign the download URL on success reads — the raw storage.googleapis.com
    // URL only works if the bucket is public (it usually isn't). toSignedUrl
    // is a no-op passthrough for non-GCS URLs and on any signing failure.
    if (job.status === 'success' && job.url && !job._signedUrl) {
        job._signedUrl = await toSignedUrl(job.url);
        renderJobs.set(jobId, job);
    }

    const { _lastGcsCheck, _signedUrl, _recovered, ...publicJob } = job;
    res.json({ ...publicJob, url: _signedUrl || job.url });
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
