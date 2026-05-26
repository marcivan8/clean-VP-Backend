"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const renderer_1 = require("@revideo/renderer");
const storage_1 = require("@google-cloud/storage");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const uuid_1 = require("uuid");
const gcs = new storage_1.Storage();
const bucketName = process.env.GCS_BUCKET_NAME || 'viral-pilot_bucket';
const bucket = gcs.bucket(bucketName);
const handler = async (event) => {
    try {
        console.log("🎬 Render Lambda triggered", JSON.stringify(event));
        // When triggered via API Gateway, the payload might be in event.body
        const payload = event.body ? JSON.parse(event.body) : event;
        const { tracks = [], duration = 10, fps = 30, aspectRatio = '16:9', backendUrl = '', webhookUrl } = payload;
        // Compute dimensions
        const height = 1080;
        const ratioMap = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
        const ratio = ratioMap[aspectRatio] || 16 / 9;
        const width = Math.round(height * ratio);
        // Lambda gives us 10GB of temporary storage in /tmp
        const outDir = '/tmp/output';
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        const renderId = (0, uuid_1.v4)();
        const outFile = `render_${renderId}.mp4`;
        const outputPath = path.join(outDir, outFile);
        console.log(`🎬 Render start: ${duration}s, ${width}x${height}`);
        await (0, renderer_1.renderVideo)({
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
                '--single-process',
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
    }
    catch (error) {
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
            }
            catch (e) {
                console.error('Failed to send error webhook', e);
            }
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Render failed', error: error.message }),
        };
    }
};
exports.handler = handler;
