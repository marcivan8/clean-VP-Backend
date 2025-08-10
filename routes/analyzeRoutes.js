// routes/analyzeRoutes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { analyzeVideoHandler } = require("../controllers/mainController");

const router = express.Router();

// Créer le dossier uploads s'il n'existe pas
const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("📁 Dossier uploads créé :", uploadsDir);
}

// Configuration Multer avec validation renforcée
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Nom de fichier sécurisé avec timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `video-${uniqueSuffix}${ext}`);
  },
});

// Filtres et limites
const fileFilter = (req, file, cb) => {
  // Types MIME autorisés
  const allowedMimes = [
    'video/mp4',
    'video/mpeg',
    'video/quicktime', // MOV
    'video/x-msvideo', // AVI
    'video/webm',
    'video/3gpp',
    'video/x-flv'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Type de fichier non supporté: ${file.mimetype}. Utilisez MP4, MOV, AVI, WebM, etc.`), false);
  }
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
    files: 1 // 1 seul fichier
  }
});

// Middleware de gestion d'erreurs Multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({ 
          error: "Fichier trop volumineux. Taille maximale : 100MB" 
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({ 
          error: "Trop de fichiers. Un seul fichier autorisé." 
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({ 
          error: "Champ de fichier inattendu." 
        });
      default:
        return res.status(400).json({ 
          error: `Erreur upload: ${err.message}` 
        });
    }
  }
  
  if (err.message && err.message.includes('Type de fichier non supporté')) {
    return res.status(400).json({ error: err.message });
  }
  
  next(err);
};

// Route principale d'analyse
router.post("/", (req, res, next) => {
  upload.single("video")(req, res, (err) => {
    if (err) {
      return handleMulterError(err, req, res, next);
    }
    
    // Validation supplémentaire des champs
    const { title, description, language } = req.body;
    
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ 
        error: "Titre requis pour l'analyse." 
      });
    }
    
    if (!description || description.trim().length === 0) {
      return res.status(400).json({ 
        error: "Description requise pour l'analyse." 
      });
    }

    // Validation de la langue
    const supportedLanguages = ['en', 'fr', 'tr'];
    if (language && !supportedLanguages.includes(language)) {
      console.warn(`⚠️ Langue non supportée: ${language}, fallback vers 'en'`);
      req.body.language = 'en';
    }
    
    console.log("✅ Validation réussie, transfert vers analyzeVideoHandler");
    analyzeVideoHandler(req, res);
  });
});

// Route de test de santé
router.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    service: "Video Analyzer API",
    timestamp: new Date().toISOString(),
    uploadsDir: fs.existsSync(uploadsDir) ? "✅ Available" : "❌ Missing"
  });
});

module.exports = router;