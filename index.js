// index.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { analyzeVideo } = require('./utils/videoAnalyzer');
const { transcribeAudio } = require('./utils/transcribe');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

app.post('/analyze', upload.single('video'), async (req, res) => {
  try {
    const filePath = req.file.path;

    // 1. Transcrire la vidéo
    const transcript = await transcribeAudio(filePath);

    // 2. Analyser la transcription
    const result = analyzeVideo({
      title: req.body.title,
      description: req.body.description,
      transcript,
    });

    // 3. Supprimer la vidéo temporaire
    fs.unlink(filePath, () => {});

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Video analysis failed.' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
