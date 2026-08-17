const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Require a secret for all endpoints except health
const WORKER_SECRET = process.env.WORKER_SECRET;

app.use((req, res, next) => {
    if (req.path === '/health') return next();
    
    const auth = req.headers['authorization'] || req.headers['x-worker-secret'];
    if (!WORKER_SECRET || auth !== WORKER_SECRET) {
        return res.status(401).json({ error: 'Unauthorized worker request' });
    }
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', renderer: 'revideo-worker', uptime: process.uptime() });
});

app.post('/render', async (req, res) => {
    // R69 — architecture split: `baseVideoUrl` is FFmpeg's already-cut,
    // already-graded, already-audio-mixed output (jobs/exportProcessor.js's
    // STEP 1-3). `tracks` here is ONLY 'text'/'overlay' tracks — the base
    // video/audio/image tracks that used to be sent are now baked into
    // baseVideoUrl and are never sent to this worker at all.
    console.log('[worker] baseVideoUrl:', req.body.baseVideoUrl);
    console.log('[worker] text/overlay clip[0]:', JSON.stringify(
        req.body.tracks?.[0]?.clips?.[0] || {}, null, 2
    ));
    try {
        const { renderVideo } = await import('@revideo/renderer');

        const { baseVideoUrl = '', tracks = [], duration = 10, fps = 30, aspectRatio = '16:9', backendUrl = '' } = req.body;

        if (!baseVideoUrl) {
            return res.status(400).json({ error: 'baseVideoUrl is required' });
        }

        // Compute dimensions
        const height = 1080;
        const ratioMap = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
        const ratio = ratioMap[aspectRatio] || 16 / 9;
        const width = Math.round(height * ratio);

        const outDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        const outFile = `render_${Date.now()}.mp4`;
        const outputPath = path.join(outDir, outFile);

        console.log(`🎬 Render start: ${duration}s, ${width}x${height}, ${tracks.length} text/overlay track(s)`);

        // R69 FOLLOW-UP — verified via a real end-to-end render in a
        // sandboxed test rig, not just node --check. `renderVideo()`'s real
        // settings shape (confirmed against @revideo/renderer's own
        // render-video.d.ts) takes `settings.puppeteer` (a real
        // PuppeteerLaunchOptions object: {executablePath, args, ...}), NOT a
        // top-level `puppeteerLaunchArgs` array — the old key was silently
        // ignored, so every flag below (including --no-sandbox) was never
        // actually applied to the launched browser.
        await renderVideo({
            projectFile: path.join(__dirname, 'revideo', 'src', 'project.ts'),
            variables: { baseVideoUrl, tracks, duration, aspectRatio, fps, backendUrl },
            settings: {
                outFile,
                outDir,
                dimensions: [width, height],
                logProgress: true,
                range: [0, duration],
                // Point @revideo/ffmpeg at the SYSTEM ffmpeg/ffprobe (installed
                // in the Dockerfile) instead of its own bundled static
                // binaries (@ffmpeg-installer/@ffprobe-installer) — the
                // bundled static ffprobe segfaulted on a network-URL input
                // during testing, a real crash risk. Same "trust the system
                // binary over a bundled static one" precedent this file
                // already applies to Chrome below.
                ffmpeg: {
                    ffmpegPath: '/usr/bin/ffmpeg',
                    ffprobePath: '/usr/bin/ffprobe',
                },
                puppeteer: {
                    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--no-zygote',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                    ],
                },
            },
        });

        if (!fs.existsSync(outputPath)) {
            return res.status(500).json({ error: 'Render completed but output file not found' });
        }

        console.log(`✅ Render complete: ${outputPath}`);

        // Stream the file back to the client
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${outFile}"`);
        
        const fileStream = fs.createReadStream(outputPath);
        fileStream.pipe(res);

        // Delete file after streaming
        fileStream.on('end', () => {
            try { fs.unlinkSync(outputPath); } catch (e) { console.error('Failed to delete', e); }
        });
        
    } catch (error) {
        console.error('❌ Revideo render error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Render failed', message: error.message });
        }
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Render Worker listening on port ${PORT}`);
});
