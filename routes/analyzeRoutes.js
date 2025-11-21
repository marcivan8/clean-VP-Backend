// routes/analyzeRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateUser } = require('../middleware/auth');
const { checkUsageLimits } = require('../middleware/usageLimits');
const { analyzeVideoHandler } = require('../controllers/mainController');

// Configuration multer pour upload en mémoire
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
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

// Vision analysis endpoint (placeholder)
router.post('/vision', authenticateUser, (req, res) => {
  res.status(200).json({ 
    message: 'Vision analysis endpoint',
    objects: [],
    scenes: [],
    context: 'Vision analysis not yet implemented'
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