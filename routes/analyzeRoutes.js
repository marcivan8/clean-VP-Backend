const express = require('express');
const multer = require('multer');
const { authenticateUser } = require('../middleware/auth');
const { checkUsageLimits } = require('../middleware/usageLimits');
const StorageService = require('../services/StorageService');
const VideoAnalysis = require('../models/VideoAnalysis');
const User = require('../models/User');
const { analyzeVideo } = require('../utils/videoAnalyzer');
const { extractAudio } = require('../utils/compressVideo');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuration Multer pour upload en mémoire
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files allowed'), false);
    }
  }
});

router.post('/', 
  authenticateUser,
  checkUsageLimits, 
  upload.single('video'),
  async (req, res) => {
    try {
      const { title, description, language = 'en', ai_training_consent = 'false' } = req.body;
      const userId = req.user.id;
      const hasConsent = ai_training_consent === 'true';
      
      if (!req.file) {
        return res.status(400).json({ error: 'No video file provided' });
      }
      
      if (!title || !description) {
        return res.status(400).json({ error: 'Title and description required' });
      }
      
      // 1. Upload vers Google Cloud Storage
      const uploadResult = await StorageService.uploadVideo(req.file, userId, hasConsent);
      
      // 2. Créer l'enregistrement d'analyse
      const analysisRecord = await VideoAnalysis.create({
        user_id: userId,
        title: title,
        description: description,
        original_filename: req.file.originalname,
        video_path: uploadResult.path,
        ai_training_consent: hasConsent,
        language: language
      });
      
      // 3. Traitement asynchrone (ou synchrone pour MVP)
      try {
        // Télécharger temporairement pour traitement
        const videoBuffer = await StorageService.downloadVideo(uploadResult.path);
        const tempVideoPath = path.join('/tmp', `${Date.now()}-${req.file.originalname}`);
        fs.writeFileSync(tempVideoPath, videoBuffer);
        
        // Extraction audio et transcription
        const tempAudioPath = path.join('/tmp', `${Date.now()}-audio.mp3`);
        let transcript = '';
        
        try {
          await extractAudio(tempVideoPath, tempAudioPath);
          const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempAudioPath),
            model: 'whisper-1'
          });
          transcript = transcription.text || '';
        } catch (transcriptError) {
          console.warn('Transcription failed:', transcriptError);
        }
        
        // Analyse IA
        const analysisResults = analyzeVideo({
          title,
          description, 
          transcript,
          language
        });
        
        // Mise à jour des résultats
        await VideoAnalysis.updateResults(analysisRecord.id, analysisResults);
        
        // Nettoyage des fichiers temporaires
        [tempVideoPath, tempAudioPath].forEach(file => {
          try { fs.unlinkSync(file); } catch (e) { }
        });
        
        // Mise à jour de l'usage utilisateur
        await User.updateUsage(userId, { analyses: 1 });
        
        res.json({
          success: true,
          analysis_id: analysisRecord.id,
          ...analysisResults,
          consent_given: hasConsent
        });
        
      } catch (processingError) {
        console.error('Processing error:', processingError);
        
        // Marquer l'analyse comme échouée
        await supabaseAdmin
          .from('video_analyses')
          .update({ processing_status: 'failed' })
          .eq('id', analysisRecord.id);
          
        res.status(500).json({ error: 'Video processing failed' });
      }
      
    } catch (error) {
      console.error('Analysis endpoint error:', error);
      res.status(500).json({ error: 'Analysis failed' });
    }
  }
);

// Récupérer l'historique des analyses
router.get('/history', authenticateUser, async (req, res) => {
  try {
    const analyses = await VideoAnalysis.findByUser(req.user.id);
    res.json({ analyses });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;