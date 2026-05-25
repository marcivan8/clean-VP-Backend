const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authenticateUser } = require('../middleware/auth');

/**
 * Revideo Render Routes
 * 
 * Uses @revideo/renderer to render videos server-side.
 * The renderVideo() function launches a headless browser,
 * builds the Revideo project, and outputs an MP4.
 */

// POST /api/revideo/render
router.post('/render', authenticateUser, async (req, res) => {
    try {
        // Dynamic import (ES module)
        const { renderVideo } = await import('@revideo/renderer');

        const { tracks = [], duration = 10, fps = 30 } = req.body.timeline || req.body;

        // Whitelist aspectRatio to prevent injection
        const ALLOWED_RATIOS = ['16:9', '9:16', '1:1', '4:5'];
        const aspectRatio = ALLOWED_RATIOS.includes(req.body.aspectRatio) ? req.body.aspectRatio : '16:9';

        // Compute dimensions
        const height = 1080;
        const ratioMap = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
        const ratio = ratioMap[aspectRatio] || 16 / 9;
        const width = Math.round(height * ratio);

        const outDir = path.join(__dirname, '..', 'output');
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        const outFile = `render_${Date.now()}.mp4`;

        console.log(`🎬 Starting Revideo render: ${tracks.reduce((acc, t) => acc + t.clips.length, 0)} clips, ${duration}s, ${width}x${height}`);

        await renderVideo({
            projectFile: path.join(__dirname, '..', 'revideo', 'src', 'project.ts'),
            variables: { tracks, duration, aspectRatio, fps },
            settings: {
                outFile,
                outDir,
                dimensions: [width, height],
                logProgress: true,
            },
            puppeteerLaunchArgs: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--no-zygote',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
            ]
        });

        const outputPath = path.join(outDir, outFile);

        if (!fs.existsSync(outputPath)) {
            return res.status(500).json({ error: 'Render completed but output file not found' });
        }

        console.log(`✅ Render complete: ${outputPath}`);

        res.download(outputPath, outFile, (err) => {
            if (err) {
                console.error('Download error:', err);
            }
            // Clean up after download
            try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
        });

    } catch (error) {
        console.error('❌ Revideo render error:', error);
        res.status(500).json({
            error: 'Render failed',
            message: error.message
        });
    }
});

// GET /api/revideo/health
router.get('/health', (req, res) => {
    res.json({ status: 'ok', renderer: 'revideo' });
});

module.exports = router;
