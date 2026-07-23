import { renderVideo } from '@revideo/renderer';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Handler } from 'aws-lambda';
import { FontInstaller } from './fonts/FontInstaller';

const gcs = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME || 'viral-pilot_bucket';
const bucket = gcs.bucket(bucketName);

// Module-level singleton — FontInstaller creates /tmp/vibed-fonts/ once and
// the instance (along with any warm-start /tmp cache) persists across invocations.
const fontInstaller = new FontInstaller();

export const handler: Handler = async (event) => {
    try {
        console.log("🎬 Render Lambda triggered", JSON.stringify(event));

        // When triggered via API Gateway, the payload might be in event.body
        const payload = event.body ? JSON.parse(event.body) : event;
        const {
            tracks       = [],
            duration     = 10,
            fps          = 30,
            aspectRatio  = '16:9',
            backendUrl   = '',
            webhookUrl,
            captionStyle = null,   // ← font family + style from the UI caption panel
        } = payload;

        // Compute dimensions
        const height = 1080;
        const ratioMap: Record<string, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
        const ratio = ratioMap[aspectRatio] || 16 / 9;
        const width = Math.round(height * ratio);

        // Lambda gives us /tmp for output; ensure the directory exists.
        const outDir = '/tmp/output';
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        const renderId = uuidv4();
        const outFile = `render_${renderId}.mp4` as `${string}.mp4`;
        const outputPath = path.join(outDir, outFile);

        console.log(`🎬 Render start: ${duration}s, ${width}x${height}`);

        // ── Font resolution ───────────────────────────────────────────────────
        // Determine which fonts this render needs, then resolve them from:
        //   /opt/fonts (Lambda Layer) → /tmp/vibed-fonts (warm cache) → jsDelivr CDN
        // Returns @font-face CSS with base64 data URLs, or '' if no text clips found.
        // Wrapped in try/catch so a font failure never aborts the render.
        let fontFaceCSS = '';
        try {
            const usedFonts = fontInstaller.extractUsedFonts(tracks, captionStyle);
            if (usedFonts.length > 0) {
                console.log(`🔤 Fonts needed: ${usedFonts.join(', ')}`);
                fontFaceCSS = await fontInstaller.ensureFonts(usedFonts);
                console.log(`✅ Font CSS ready (${Math.round(fontFaceCSS.length / 1024)}KB)`);
            } else {
                console.log('ℹ️  No text/caption clips — skipping font resolution');
            }
        } catch (fontErr: any) {
            // Font failure is non-fatal: Chrome falls back to system sans-serif.
            console.warn('⚠️  Font resolution failed (render will continue with system fonts):', fontErr.message);
        }

        await renderVideo({
            projectFile: path.join(__dirname, 'revideo', 'src', 'project.ts'),
            variables: {
                tracks,
                duration,
                aspectRatio,
                fps,
                backendUrl,
                fontFaceCSS,   // ← injected into Revideo scene before first frame renders
            },
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
                '--single-process',
                '--no-first-run',
                // Allow the scene page to read data: URIs in @font-face src
                // (technically allowed by default, but explicit for future-proofing)
                '--enable-font-antialiasing',
                '--font-render-hinting=none',
            ]
        } as any);

        if (!fs.existsSync(outputPath)) {
            throw new Error('Render completed but output file not found in /tmp');
        }

        console.log(`✅ Render complete. Uploading to GCS...`);
        const destPath = `renders/${renderId}.mp4`;

        await bucket.upload(outputPath, {
            destination: destPath,
            metadata: {
                contentType: 'video/mp4',
            }
        });

        const finalUrl = `https://storage.googleapis.com/${bucketName}/${destPath}`;
        console.log(`✅ Upload complete: ${finalUrl}`);

        // Notify the backend that the render is complete
        if (webhookUrl) {
            console.log(`🔔 Sending webhook to ${webhookUrl}...`);
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'success', renderId, url: finalUrl })
            });
        }

        // Clean up render output — font cache in /tmp stays for warm starts
        fs.unlinkSync(outputPath);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Render complete', url: finalUrl, renderId }),
        };

    } catch (error: any) {
        console.error('❌ Render Lambda Error:', error);

        const payload = event.body ? JSON.parse(event.body) : event;
        if (payload?.webhookUrl) {
            try {
                await fetch(payload.webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'error', error: error.message })
                });
            } catch (e) {
                console.error('Failed to send error webhook', e);
            }
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Render failed', error: error.message }),
        };
    }
};
