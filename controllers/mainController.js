const fs = require('fs');
const { transcribeAudio } = require('../utils/transcribe');
const { analyzeVideo: analyzeCore } = require('../utils/videoAnalyzer');

exports.analyzeVideo = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded.' });
  }

  const filePath = req.file.path;
  const { title = '', description = '' } = req.body;

  try {
    console.log('🔁 Transcription en cours...');
    const transcript = await transcribeAudio(filePath);

    console.log('📊 Analyse en cours...');
    const result = analyzeCore({
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
    fs.unlink(filePath, (err) => {
      if (err) console.error('Erreur suppression fichier:', err);
    });
  }
};
