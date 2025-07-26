const express = require('express');
const multer = require('multer');
const path = require('path');
const { analyzeVideo } = require('../controllers/mainController');

const router = express.Router();

// Configuration de stockage pour multer
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

// Route POST : upload vidéo + métadonnées
router.post('/', upload.single('video'), (req, res) => {
  const { title, description } = req.body;
  const videoPath = req.file ? req.file.path : null;

  if (!videoPath) {
    return res.status(400).json({ error: 'Aucune vidéo téléchargée.' });
  }

  // Appelle le contrôleur avec les bonnes données
  analyzeVideo(req, res, {
    title,
    description,
    videoPath,
  });
});

module.exports = router;
