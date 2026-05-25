import { renderVideo } from '@revideo/renderer';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Handler } from 'aws-lambda';

const gcs = new Storage();
const bucketName = process.env.GCS_BUCKET_NAME || 'viral-pilot_bucket';
const bucket = gcs.bucket(bucketName);

export const handler: Handler = async (event) => {
    try {
        console.log("🎬 Render Lambda triggered", JSON.stringify(event));
        
        // When triggered via API Gateway, the payload might be in event.body
        const payload = event.body ? JSON.parse(event.body) : event;
        const { tracks = [], duration = 10, fps = 30, aspectRatio = '16:9', backendUrl = '', webhookUrl } = payload;

        // Compute dimensions
        const height = 1080;
        const ratioMap: Record<string, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
        const ratio = ratioMap[aspectRatio] || 16 / 9;
        const width = Math.round(height * ratio);

        // Lambda gives us 10GB of temporary storage in /tmp
        const outDir = '/tmp/output';
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        const renderId = uuidv4();
        const outFile = `render_${renderId}.mp4`;
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
                '--single-process', // Crucial for AWS Lambda to avoid zombie processes
                '--no-first-run',
            ]
        });

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

        // If a webhook URL was provided, notify the backend that the render is complete
        if (webhookUrl) {
            console.log(`🔔 Sending webhook to ${webhookUrl}...`);
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'success', renderId, url: finalUrl })
            });
        }

        // Clean up /tmp to avoid filling up disk space on warm invocations
        fs.unlinkSync(outputPath);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Render complete', url: finalUrl, renderId }),
        };

    } catch (error: any) {
        console.error('❌ Render Lambda Error:', error);
        
        // Notify webhook of failure if possible
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
