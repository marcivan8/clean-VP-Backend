// scripts/set-gcs-cors.js
// Usage (local with .env):  node scripts/set-gcs-cors.js
// Usage (Railway env vars): railway run node scripts/set-gcs-cors.js
require('dotenv').config();

const { Storage } = require('@google-cloud/storage');
const fs = require('fs');

const BUCKET = process.env.GOOGLE_CLOUD_BUCKET_NAME || 'viral-pilot_bucket';

function resolveCredentials() {
    const jsonEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (jsonEnv && jsonEnv.trim() && jsonEnv !== '{}') {
        try { return { type: 'object', value: JSON.parse(jsonEnv) }; } catch {}
    }
    const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (gac && gac.trim()) {
        if (gac.trim().startsWith('{')) {
            try { return { type: 'object', value: JSON.parse(gac) }; } catch {}
        } else if (fs.existsSync(gac)) {
            try { return { type: 'object', value: JSON.parse(fs.readFileSync(gac, 'utf8')) }; } catch {}
        } else {
            return { type: 'native' };
        }
    }
    return null;
}

async function setCors() {
    const creds = resolveCredentials();
    if (!creds) {
        console.error(
            '❌ No GCS credentials found.\n' +
            '   Set GOOGLE_APPLICATION_CREDENTIALS_JSON in .env, or run:\n' +
            '     railway run node scripts/set-gcs-cors.js\n' +
            '   (to use Railway\'s environment variables directly)'
        );
        process.exit(1);
    }

    const opts = {};
    if (creds.type === 'object') {
        opts.credentials = creds.value;
        opts.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || creds.value.project_id;
    } else if (process.env.GOOGLE_CLOUD_PROJECT_ID) {
        opts.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    }

    const storage = new Storage(opts);

    await storage.bucket(BUCKET).setCorsConfiguration([
        {
            origin: [
                'https://www.viralpilot.fr',
                'http://localhost:5173',
                'http://localhost:3000',
            ],
            method: ['GET', 'HEAD', 'OPTIONS'],
            responseHeader: [
                'Content-Type',
                'Content-Range',
                'Accept-Ranges',
                'Content-Length',
                'ETag',
            ],
            maxAgeSeconds: 3600,
        },
    ]);

    console.log(`✅ CORS set on ${BUCKET}`);
}

setCors().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
