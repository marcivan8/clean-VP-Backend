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
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded.' });
  }

  const filePath = req.file.path;
  const { title = '', description = '' } = req.body;

  try {
    console.log('🔁 Transcription en cours...');
    const transcript = await transcribeAudio(filePath);

    console.log('📊 Analyse en cours...');
    const result = analyzeVideo({
      title,
      description,
      transcript,
    });

    console.log('✅ Analyse terminée');

    res.json(result);
  } catch (err) {
    console.error('❌ Erreur pendant l’analyse :', err);
    res.status(500).json({ error: 'Video analysis failed.' });
  } finally {
    // Nettoyage du fichier temporaire même en cas d’erreur
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) console.error('Erreur suppression fichier:', unlinkErr);
    });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
