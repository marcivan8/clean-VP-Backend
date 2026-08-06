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

const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
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

        // ── Connection pooling + retry ───────────────────────────────────────
        // Without these the SDK uses Node's DEFAULT https agent: unbounded
        // sockets, keep-alive managed by the remote. Under an upload burst
        // (5 files ⇒ ~8 waveform extracts + ~6 proxy range reads + waveform
        // JSON reads/writes + thumbnail upload + diarize downloads, all against
        // GCS at once) two things go wrong:
        //
        //   1. A pooled socket that GCS has already closed gets picked for a new
        //      request, and the write fails as "socket hang up" — observed
        //      hitting getMetadata, range reads, whole-object reads AND uploads
        //      within the same two seconds.
        //   2. Nothing bounds total concurrency, so the process opens as many
        //      connections as there are in-flight requests and starves itself of
        //      CPU (ffmpeg was decoding at speed=0.18x during that burst).
        //
        // maxSockets is the right lever for both: it is a real backpressure
        // mechanism (requests queue instead of piling on), and it keeps the
        // keep-alive pool small enough to stay warm rather than going stale.
        // R47's per-request retries stay as the last line of defence for the
        // drops that still happen.
        const https = require('https');
        storageOpts.retryOptions = {
            autoRetry: true,
            maxRetries: 3,
            // Retry the transient network faults, not 4xx.
            retryableErrorFn: (err) => {
                const code = err?.code || err?.statusCode;
                return (
                    code === 'ECONNRESET' || code === 'ETIMEDOUT' ||
                    code === 'EPIPE'      || code === 'ECONNREFUSED' ||
                    code === 'EAI_AGAIN'  ||
                    /socket hang up/i.test(err?.message || '') ||
                    code === 429 || (typeof code === 'number' && code >= 500)
                );
            },
        };
        // Bounded, warm pool. 25 is comfortably above steady-state need and well
        // below what a burst would otherwise open.
        storageOpts.agent = new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 10_000,
            maxSockets: Number(process.env.GCS_MAX_SOCKETS || 25),
            maxFreeSockets: 10,
            timeout: 60_000,
        });

        const gcsStorage = new Storage(storageOpts);
        const gcsBucket = gcsStorage.bucket(bucketName);

        exports.storage = gcsStorage;
        exports.bucket = gcsBucket;

        // Async verification — updates exports in-place if the bucket turns out to be bad
        gcsBucket.exists()
            .then(([exists]) => {
                if (exists) {
                    console.log(`✅ Google Cloud Storage ready — bucket: ${bucketName}`);
                } else {
                    console.warn(`⚠️ GCS bucket "${bucketName}" does not exist — falling back to local storage`);
                    setupLocalStorage();
                }
            })
            .catch(err => {
                console.warn('⚠️ GCS bucket verification failed:', err.message, '— falling back to local storage');
                setupLocalStorage();
            });
    } catch (err) {
        console.error('⚠️ Failed to initialize GCS client:', err.message, '— using local storage');
        setupLocalStorage();
    }
}
