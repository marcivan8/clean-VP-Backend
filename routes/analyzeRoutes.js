// routes/analyzeRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateUser } = require('../middleware/auth');
const { checkUsageLimits } = require('../middleware/usageLimits');
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

// Main video analysis endpoint
router.post('/',
  authenticateUser,           // Vérifier l'authentification
  checkUsageLimits,          // Vérifier les limites d'utilisation
  upload.single('video'),    // Upload du fichier vidéo
  analyzeVideoHandler        // Traiter l'analyse
);

module.exports = router;