// config/storage.js
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '..', 'uploads');

function setupLocalStorage() {
    for (const sub of ['', 'analysis-only', 'ai-training', 'temp']) {
        const dir = path.join(uploadsDir, sub);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    console.log('📁 Using local storage at:', uploadsDir);
    exports.useLocalStorage = true;
    exports.bucket = null;
    exports.storage = null;
}

/**
 * Resolve GCS credentials from whichever env var is set.
 *
 * Resolution order:
 *   1. GOOGLE_APPLICATION_CREDENTIALS_JSON  — JSON string (Railway-friendly custom var)
 *   2. GOOGLE_APPLICATION_CREDENTIALS       — JSON string content OR file path
 *      - starts with '{' → parse as JSON inline
 *      - file path that exists  → read and parse
 *      - any other value        → let the GCS SDK use it natively
 *
 * Returns:
 *   { type: 'object', value: <credentials JS object> }
 *   { type: 'native' }   — SDK reads GOOGLE_APPLICATION_CREDENTIALS on its own
 *   null                 — no credentials found
 */
function resolveCredentials() {
    const jsonEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (jsonEnv && jsonEnv.trim() && jsonEnv !== '{}' && jsonEnv !== 'your-credentials-here') {
        try {
            const parsed = JSON.parse(jsonEnv);
            console.log('🔑 GCS credentials: GOOGLE_APPLICATION_CREDENTIALS_JSON');
            return { type: 'object', value: parsed };
        } catch {
            console.warn('⚠️ GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON — ignoring');
        }
    }

    const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (gac && gac.trim()) {
        if (gac.trim().startsWith('{')) {
            // JSON content stored directly in the standard env var
            try {
                const parsed = JSON.parse(gac);
                console.log('🔑 GCS credentials: GOOGLE_APPLICATION_CREDENTIALS (inline JSON)');
                return { type: 'object', value: parsed };
            } catch {
                console.warn('⚠️ GOOGLE_APPLICATION_CREDENTIALS looks like JSON but failed to parse — ignoring');
            }
        } else if (fs.existsSync(gac)) {
            // File path pointing to a service account JSON file
            try {
                const parsed = JSON.parse(fs.readFileSync(gac, 'utf8'));
                console.log('🔑 GCS credentials: GOOGLE_APPLICATION_CREDENTIALS (file:', gac, ')');
                return { type: 'object', value: parsed };
            } catch {
                console.warn('⚠️ GOOGLE_APPLICATION_CREDENTIALS file cannot be read/parsed — ignoring');
            }
        } else {
            // Non-JSON, non-existent-path value — let the GCS SDK handle it natively
            console.log('🔑 GCS credentials: GOOGLE_APPLICATION_CREDENTIALS (native SDK resolution)');
            return { type: 'native' };
        }
    }

    return null;
}

// Mutable exports — async bucket.exists() callback can update these in-place
exports.storage = null;
exports.bucket = null;
exports.useLocalStorage = false;
exports.FOLDERS = {
    ANALYSIS_ONLY: 'analysis-only/',
    AI_TRAINING: 'ai-training/',
    TEMP: 'temp/',
};

// Accept either naming convention used across different parts of the codebase.
// GOOGLE_CLOUD_BUCKET_NAME  — used here and in revideoRenderRoutes
// GCS_BUCKET_NAME           — used in exportRoutes, silenceRoutes, etc.
const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME || process.env.GCS_BUCKET_NAME;
const creds = resolveCredentials();

if (!creds || !bucketName || bucketName === 'your-bucket-name') {
    console.log('ℹ️  No GCS credentials or bucket name configured — using local storage');
    setupLocalStorage();
} else {
    try {
        const storageOpts = {};
        if (creds.type === 'object') {
            storageOpts.credentials = creds.value;
            storageOpts.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || creds.value.project_id;
        } else {
            // native: GCS SDK reads GOOGLE_APPLICATION_CREDENTIALS itself
            if (process.env.GOOGLE_CLOUD_PROJECT_ID) {
                storageOpts.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
            }
        }

        const gcsStorage = new Storage(storageOpts);
        const gcsBucket = gcsStorage.bucket(bucketName);

        // Do NOT export the bucket until verification succeeds.
        // Exporting it before the async check resolves creates a race where jobs
        // start with a non-null bucket reference, the auth call inside fails, the
        // catch handler nulls it out, and all retries see null.
        //
        // Railway containers sometimes lack full outbound connectivity for the first
        // few seconds after boot. A single cold-start attempt to oauth2.googleapis.com
        // can time out or drop with an empty 'reason', permanently flipping the service
        // to local storage for the entire container lifetime. Retry with backoff to
        // absorb transient startup network hiccups.
        const verifyWithRetry = async (attempt = 1) => {
            const MAX_ATTEMPTS = 5;
            const DELAYS_MS = [2000, 5000, 10000, 20000]; // 2s, 5s, 10s, 20s

            try {
                const [exists] = await gcsBucket.exists();
                if (exists) {
                    exports.storage = gcsStorage;
                    exports.bucket = gcsBucket;
                    console.log(`✅ Google Cloud Storage ready — bucket: ${bucketName}` +
                        (attempt > 1 ? ` (succeeded on attempt ${attempt})` : ''));
                } else {
                    console.warn(`⚠️ GCS bucket "${bucketName}" does not exist — falling back to local storage`);
                    setupLocalStorage();
                }
            } catch (err) {
                if (attempt < MAX_ATTEMPTS) {
                    const delay = DELAYS_MS[attempt - 1] ?? 20000;
                    console.warn(
                        `⚠️ GCS verification attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}` +
                        ` — retrying in ${delay / 1000}s`
                    );
                    setTimeout(() => verifyWithRetry(attempt + 1), delay);
                } else {
                    console.warn(`⚠️ GCS bucket verification failed after ${MAX_ATTEMPTS} attempts: ${err.message} — falling back to local storage`);
                    setupLocalStorage();
                }
            }
        };

        verifyWithRetry();
    } catch (err) {
        console.error('⚠️ Failed to initialize GCS client:', err.message, '— using local storage');
        setupLocalStorage();
    }
}
