// routes/analyzeRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateUser } = require('../middleware/auth');
const { aiGate } = require('../middleware/usageGate');
const { analyzeVideoHandler } = require('../controllers/mainController');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads/temp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuration multer pour upload sur disque
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max (increased from 100MB)
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'));
    }
  }
});

// Health check
router.get('/health/check', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Analysis endpoint is healthy',
    timestamp: new Date().toISOString()
  });
});

// Vision analysis endpoint
router.post('/vision', authenticateUser, (req, res) => {
  res.status(200).json({
    message: 'Vision analysis endpoint',
    objects: [],
    scenes: [],
    context: 'Vision analysis not yet implemented'
  });
});

const { analysisQueue } = require('../queue/queues');
const storageConfig = require('../config/storage');

// Main video analysis endpoint
router.post('/',
  authenticateUser,          // Real authentication — verified Supabase JWT
  aiGate,                    // Check plan limits
  upload.single('video'),    // Upload the video file
  async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No video file provided." });
        }
        
        const { title = "", description = "", language = "en", ai_training_consent = "false" } = req.body;
        const userId = req.user.id;
        const videoPath = req.file.path;

        console.log(`🎬 Upload received for analysis user ${userId}: ${videoPath}`);

        // If using GCS, upload the raw file immediately so background workers
        // running on different nodes (e.g. Railway) can access it.
        if (storageConfig.bucket && !storageConfig.useLocalStorage) {
            const destPath = `raw/${userId}/${req.file.filename}`;
            console.log(`🎬 Uploading raw file to GCS: ${destPath}...`);
            await storageConfig.bucket.upload(req.file.path, { destination: destPath });
            console.log(`🎬 Raw file uploaded to GCS.`);
        }

        console.log(`🎬 Enqueuing analysis for user ${userId}: ${videoPath}`);

        const uniqueJobId = `analyze-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;
        const job = await analysisQueue.add('analyze-video', {
            videoPath,
            title,
            description,
            language,
            ai_training_consent,
            userId,
            fileSize: req.file.size,
            filename: req.file.filename
        }, {
            jobId: uniqueJobId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 }
        });

        res.json({
            jobId: job.id,
            status: 'queued'
        });
    } catch (err) {
        console.error('❌ Failed to enqueue analysis:', err);
        res.status(500).json({ error: 'Failed to enqueue analysis job' });
    }
  }
);

module.exports = router;