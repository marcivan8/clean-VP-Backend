// ===== index.js =====
const Sentry = require('@sentry/node');

// Must be initialised before any other require so Sentry can instrument them.
// SENTRY_DSN is set in Railway environment variables — no-op when absent.
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 0.1,
    });
}

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const fs         = require('fs');
const { execSync } = require('child_process');
require('dotenv').config();

const app = express();
// Railway injects PORT dynamically — process.env.PORT is authoritative
const port = process.env.PORT || 3000;

// ── Proxy trust ───────────────────────────────────────────────────────────────
// Required when running behind Railway / any reverse-proxy that sets
// X-Forwarded-For. Without this, express-rate-limit throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request.
// '1' means trust the first proxy hop (the Railway load-balancer).
app.set('trust proxy', 1);

// ── ffmpeg-static startup verification ────────────────────────────────────────
// Catch broken binaries early so the issue shows in Railway build/deploy logs
let ffmpegVersion = null;
try {
  const ffmpegBin = require('ffmpeg-static');
  const result = execSync(`"${ffmpegBin}" -version 2>&1 | head -1`, { timeout: 5000 }).toString().trim();
  ffmpegVersion = result;
  console.log(`✅ ffmpeg-static ready: ${result}`);
} catch (err) {
  console.error(`❌ ffmpeg-static failed to load: ${err.message}`);
  // Non-fatal: the server still starts, but audio/video routes will fail
}

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  // Allow cross-origin loads for media served from /uploads and GCS signed URLs.
  // Setting the header explicitly (cross-origin) is safer than disabling it (false).
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  contentSecurityPolicy: {
    directives: {
      defaultSrc:              ["'self'"],
      scriptSrc:               ["'self'", "https://cdn.iubenda.com",
                                // Hash of the Iubenda config inline script in the old build.
                                // Safe to remove once the frontend is rebuilt (the new build
                                // loads /iubenda-config.js as an external file instead).
                                "'sha256-nkFQkdgl82bXmdiehongvIXI8phjn3IWsIBf7u/rHH8='"],
      styleSrc:                ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:                 ["'self'", "https://fonts.gstatic.com"],
      imgSrc:                  ["'self'", "data:", "blob:", "https://storage.googleapis.com", "https://*.iubenda.com"],
      mediaSrc:                ["'self'", "blob:", "https://storage.googleapis.com"],
      connectSrc: [
        "'self'",
        "https://*.supabase.co",
        "wss://*.supabase.co",
        "https://storage.googleapis.com",
        "https://*.iubenda.com",
        // Sentry error reporting — both ingest domains (EU + global)
        "https://*.ingest.sentry.io",
        "https://*.ingest.de.sentry.io",
        ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
      ],
      objectSrc:               ["'none'"],
      frameSrc:                ["'self'", "https://*.iubenda.com"],
      baseUri:                 ["'self'"],
      upgradeInsecureRequests: [],
    },
  },

  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.FRONTEND_URL, process.env.PUBLIC_URL].filter(Boolean)
  : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'];

const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      }
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'Content-Type', 'X-Export-Filename', 'X-Export-Target'],
  maxAge: 86400,
};

const corsMiddleware = cors(corsOptions);
app.use(corsMiddleware);
// Reuse the same configured middleware for preflight — never allow wildcard here.
app.options('*', corsMiddleware);

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Global: 120 req/min per IP
const globalLimiter = rateLimit({
  windowMs: 60_000, max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' }
});
app.use(globalLimiter);

// AI routes: 15 req/min (GPT-4o calls cost money)
const aiLimiter = rateLimit({
  windowMs: 60_000, max: 15,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'AI rate limit reached. Please wait before sending more requests.' }
});

// Heavy compute: 5 req/min (FFmpeg / headless Chrome)
const renderLimiter = rateLimit({
  windowMs: 60_000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Render rate limit reached. Please wait before starting another render.' }
});

// Upload + transcribe: 10 req/min
const uploadLimiter = rateLimit({
  windowMs: 60_000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Upload rate limit reached. Please wait a moment.' }
});

// Auth routes: 20 attempts per 15 min per IP, counting only failures.
// Prevents brute-force against profile creation and token-based endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
});

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.headers.authorization) {
    console.log('   Auth: Present');
  }
  next();
});

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import routes - ONLY auth and analyze (no payment routes)
let authRoutes, analyzeRoutes, exportRoutes, audioRoutes;

try {
  authRoutes = require('./routes/auth');
  console.log('✅ Auth routes loaded');
} catch (e) {
  console.error('❌ Failed to load auth routes:', e.message);
  authRoutes = express.Router();
}

try {
  analyzeRoutes = require('./routes/analyzeRoutes');
  console.log('✅ Analyze routes loaded');
} catch (e) {
  console.error('❌ Failed to load analyze routes:', e.message);
  analyzeRoutes = express.Router();
}

try {
  exportRoutes = require('./routes/exportRoutes');
  console.log('✅ Export routes loaded');
} catch (e) {
  console.error('❌ Failed to load export routes:', e.message);
  exportRoutes = express.Router();
}

try {
  audioRoutes = require('./routes/audioRoutes');
  console.log('✅ Audio routes loaded');
} catch (e) {
  console.error('❌ Failed to load audio routes:', e.message);
  audioRoutes = express.Router();
}

// Health check endpoint — used by Railway for zero-downtime deploys
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    port: port,
    version: '2.0.0',
    services: {
      ffmpeg: !!ffmpegVersion,
      openai: !!process.env.OPENAI_API_KEY,
    }
  });
});

// Test endpoint for analyze
app.get('/api/analyze/test', (req, res) => {
  res.json({
    message: 'Analyze endpoint is reachable',
    timestamp: new Date().toISOString()
  });
});

// Mount API routes — rate limiters applied to expensive endpoints
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/analyze', uploadLimiter, analyzeRoutes);
app.use('/api/v2/analyze', uploadLimiter, analyzeRoutes);
app.use('/analyze', uploadLimiter, analyzeRoutes);          // legacy/proxy
app.use('/api/render', renderLimiter, exportRoutes);        // FFmpeg export
app.use('/api/audio', uploadLimiter, audioRoutes);          // audio processing
app.use('/api/filler', uploadLimiter, audioRoutes);         // alias: /api/filler/detect → /api/audio/filler/detect
app.use('/api/silence', require('./routes/silenceRoutes'));
app.use('/api/ai', aiLimiter, require('./routes/aiRoutes')); // GPT-4o — expensive
app.use('/api/effects', require('./routes/effectsRoutes'));
app.use('/api/proxy', uploadLimiter, require('./routes/proxyRoutes'));
app.use('/api/revideo', require('./routes/revideoRenderRoutes')); // headless Chrome
app.use('/api/presets', require('./routes/presetRoutes'));
app.use('/api/export', uploadLimiter, require('./routes/nleExport')); // NLE export (OTIO)
app.use('/api/jobs', require('./routes/jobRoutes')); // Job Queue SSE monitoring
app.use('/api/session', require('./routes/sessionRoutes')); // Anonymous sessions
app.use('/api/captions', require('./routes/captionRoutes')); // Caption generation
app.use('/api/admin',   require('./routes/adminRoutes'));   // Temp admin ops (remove after use)
app.use('/api/polar',    require('./routes/polarWebhook'));   // Polar subscription webhooks
app.use('/api/checkout', require('./routes/polarWebhook'));  // alias: /api/checkout/create
app.use('/api/projects', require('./routes/projectRoutes')); // Project thumbnail upload



// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Viral Pilot API v2',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      test: 'GET /api/analyze/test',
      analyze: 'POST /api/analyze',
      auth: 'POST /api/auth/profile',
      usage: 'GET /api/auth/usage'
    }
  });
});

// ── Serve React Frontend (Production) ─────────────────────────────────────────
// Serve static files from the React build
const clientBuildPath = path.join(__dirname, 'client', 'dist');
app.use(express.static(clientBuildPath));

// Catch-all route for React client-side routing.
// Must be placed AFTER all API routes but BEFORE the 404 handler.
app.get('*', (req, res, next) => {
  // If the request was for the API and wasn't caught by a route, pass it to the 404 handler
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
    return next();
  }
  
  const indexPath = path.join(clientBuildPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next(); // Fall through to 404 if frontend hasn't been built
  }
});

// 404 handler (API only, since frontend is caught above)
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Sentry error handler — must be registered before any other error middleware.
if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
}

// Error handler
app.use((err, req, res, next) => {
  console.error('💥 Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Only bind a port when the file is run directly (node index.js / npm start).
// When required by tests, supertest creates its own ephemeral server,
// so we must not call app.listen() — it causes EADDRINUSE across test workers.
if (require.main === module) {
  const server = app.listen(port, '0.0.0.0', async () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║                                               ║
║      🚀 Viral Pilot Backend Server v2.0      ║
║           (Simplified - No Payments)          ║
║                                               ║
╠═══════════════════════════════════════════════╣
║  Status:     Running                          ║
║  Port:       ${port}                            ║
║  Mode:       ${process.env.NODE_ENV || 'development'}                   ║
║  API URL:    http://localhost:${port}/api        ║
║  Health:     http://localhost:${port}/health     ║
╚═══════════════════════════════════════════════╝
    `);

    // Start daily cleanup job
    const runCleanup = require('./scripts/cleanup');
    runCleanup();
    setInterval(runCleanup, 24 * 60 * 60 * 1000);

    // When using local storage (no GCS), web + worker must share a filesystem.
    const storageConfig = require('./config/storage');
    if (storageConfig.useLocalStorage || !storageConfig.bucket || process.env.WORKER_INLINE === 'true') {
      console.log('👷 Starting inline workers (local storage mode — no GCS configured)...');
      console.log('   ⚠️  If you have a separate Railway worker service, shut it down — it cannot access local files.');
      require('./worker');
    }
  });
}

module.exports = app;