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
    try {
        const { renderVideo } = await import('@revideo/renderer');
        
        const { tracks = [], duration = 10, fps = 30, aspectRatio = '16:9', backendUrl = '' } = req.body;
        
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

        console.log(`🎬 Render start: ${duration}s, ${width}x${height}`);

        await renderVideo({
            projectFile: path.join(__dirname, 'revideo', 'src', 'project.ts'),
            variables: { tracks, duration, aspectRatio, fps, backendUrl },
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
