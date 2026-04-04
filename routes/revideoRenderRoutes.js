const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

/**
 * Revideo Render Routes
 * 
 * Uses @revideo/renderer to render videos server-side.
 * The renderVideo() function launches a headless browser,
 * builds the Revideo project, and outputs an MP4.
 */

// POST /api/revideo/render
router.post('/render', async (req, res) => {
    try {
        // Dynamic import (ES module)
        const { renderVideo } = await import('@revideo/renderer');

        const { clips = [], duration = 10, aspectRatio = '16:9', fps = 30 } = req.body;

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

        console.log(`🎬 Starting Revideo render: ${clips.length} clips, ${duration}s, ${width}x${height}`);

        await renderVideo({
            projectFile: path.join(__dirname, '..', 'revideo', 'src', 'project.ts'),
            variables: { clips, duration, aspectRatio, fps },
            settings: {
                outFile,
                outDir,
                dimensions: [width, height],
                logProgress: true,
            },
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
