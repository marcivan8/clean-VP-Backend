// ===== routes/analyzeRoutes.js =====
const express = require('express');
const multer = require('multer');
const { authenticateUser } = require('../middleware/auth');
const { checkUsageLimits } = require('../middleware/usageLimits');
const StorageService = require('../services/StorageService');
const VideoAnalysis = require('../models/VideoAnalysis');
const User = require('../models/User');
const { analyzeVideo } = require('../utils/videoAnalyzer');
const { extractAudio } = require('../utils/compressVideo');
const { translateError, validateLanguage } = require('../utils/translations');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuration Multer améliorée
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Vérifier le type MIME
    if (!file.mimetype.startsWith('video/')) {
      return cb(new Error('Only video files are allowed'), false);
    }
    
    // Vérifier l'extension
    const allowedExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      return cb(new Error('Unsupported video format'), false);
    }
    
    cb(null, true);
  }
});

// Middleware de validation des données
const validateAnalysisData = (req, res, next) => {
  const { title, description, language = 'en' } = req.body;
  
  if (!title || title.trim().length < 3) {
    return res.status(400).json({ 
      error: translateError('missing_title', language),
      field: 'title' 
    });
  }
  
  if (!description || description.trim().length < 10) {
    return res.status(400).json({ 
      error: translateError('missing_description', language),
      field: 'description' 
    });
  }
  
  // Valider et normaliser la langue
  req.body.language = validateLanguage(language);
  
  next();
};

// Route principale d'analyse
router.post('/', 
  authenticateUser,
  checkUsageLimits, 
  upload.single('video'),
  validateAnalysisData,
  async (req, res) => {
    let tempVideoPath = null;
    let tempAudioPath = null;
    let analysisRecord = null;

    try {
      const { title, description, language, ai_training_consent = 'false' } = req.body;
      const userId = req.user.id;
      const hasConsent = ai_training_consent === 'true';
      
      if (!req.file) {
        return res.status(400).json({ 
          error: translateError('no_file', language) 
        });
      }

      console.log(`🎬 Starting analysis for user ${userId}, file: ${req.file.originalname}`);
      
      // 1. Upload vers Google Cloud Storage
      let uploadResult;
      try {
        uploadResult = await StorageService.uploadVideo(req.file, userId, hasConsent);
        console.log('✅ Video uploaded to GCS:', uploadResult.path);
      } catch (uploadError) {
        console.error('❌ Upload failed:', uploadError);
        return res.status(500).json({ 
          error: translateError('internal_error', language),
          details: 'Upload failed' 
        });
      }
      
      // 2. Créer l'enregistrement d'analyse
      try {
        analysisRecord = await VideoAnalysis.create({
          user_id: userId,
          title: title.trim(),
          description: description.trim(),
          original_filename: req.file.originalname,
          video_path: uploadResult.path,
          ai_training_consent: hasConsent,
          language: language,
          file_size: req.file.size,
          mime_type: req.file.mimetype
        });
        console.log('✅ Analysis record created:', analysisRecord.id);
      } catch (dbError) {
        console.error('❌ Database error:', dbError);
        // Nettoyer le fichier uploadé
        await StorageService.deleteVideo(uploadResult.path);
        return res.status(500).json({ 
          error: translateError('internal_error', language),
          details: 'Database error' 
        });
      }
      
      // 3. Traitement du fichier vidéo
      try {
        // Télécharger temporairement pour traitement
        const videoBuffer = await StorageService.downloadVideo(uploadResult.path);
        tempVideoPath = path.join('/tmp', `${Date.now()}-${req.file.originalname}`);
        fs.writeFileSync(tempVideoPath, videoBuffer);
        
        // Extraction audio et transcription
        tempAudioPath = path.join('/tmp', `${Date.now()}-audio.mp3`);
        let transcript = '';
        
        try {
          await extractAudio(tempVideoPath, tempAudioPath);
          console.log('✅ Audio extracted');
          
          if (fs.existsSync(tempAudioPath)) {
            const transcription = await openai.audio.transcriptions.create({
              file: fs.createReadStream(tempAudioPath),
              model: 'whisper-1',
              language: language === 'fr' ? 'fr' : language === 'tr' ? 'tr' : 'en'
            });
            transcript = transcription.text || '';
            console.log(`✅ Transcription completed: ${transcript.length} chars`);
          }
        } catch (transcriptError) {
          console.warn('⚠️ Transcription failed:', transcriptError.message);
          // Continuer sans transcription
        }
        
        // 4. Analyse IA du contenu
        const analysisResults = analyzeVideo({
          title: title.trim(),
          description: description.trim(), 
          transcript,
          language
        });
        
        console.log('✅ AI analysis completed:', analysisResults.bestPlatform, analysisResults.viralityScore);
        
        // 5. Mise à jour des résultats dans la DB
        await VideoAnalysis.updateResults(analysisRecord.id, analysisResults);
        
        // 6. Mise à jour de l'usage utilisateur
        await User.updateUsage(userId);
        
        console.log('✅ Analysis complete for user:', userId);
        
        // 7. Réponse avec résultats complets
        res.json({
          success: true,
          analysis_id: analysisRecord.id,
          transcript: transcript || '',
          viralityScore: analysisResults.viralityScore,
          bestPlatform: analysisResults.bestPlatform,
          platformScores: analysisResults.platformScores,
          insights: analysisResults.insights,
          language: language,
          metadata: {
            ...analysisResults.metadata,
            fileSize: req.file.size,
            processingTime: Date.now() - parseInt(analysisRecord.id.split('-')[0]) // Approximation
          },
          consent_given: hasConsent
        });
        
      } catch (processingError) {
        console.error('❌ Processing error:', processingError);
        
        // Marquer l'analyse comme échouée
        if (analysisRecord) {
          await VideoAnalysis.updateStatus(analysisRecord.id, 'failed', {
            error: processingError.message,
            timestamp: new Date().toISOString()
          });
        }
          
        res.status(500).json({ 
          error: translateError('analysis_failed', language),
          details: process.env.NODE_ENV === 'development' ? processingError.message : undefined
        });
      }
      
    } catch (error) {
      console.error('❌ Analysis endpoint error:', error);
      
      // Cleanup en cas d'erreur générale
      if (analysisRecord) {
        await VideoAnalysis.updateStatus(analysisRecord.id, 'failed', {
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
      
      res.status(500).json({ 
        error: translateError('internal_error', language),
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    } finally {
      // Nettoyage des fichiers temporaires
      if (tempVideoPath) {
        try { fs.unlinkSync(tempVideoPath); } catch (e) { console.warn('Temp video cleanup failed:', e); }
      }
      if (tempAudioPath) {
        try { fs.unlinkSync(tempAudioPath); } catch (e) { console.warn('Temp audio cleanup failed:', e); }
      }
    }
  }
);

// Récupérer l'historique des analyses
router.get('/history', authenticateUser, async (req, res) => {
  try {
    const { limit = 10, offset = 0 } = req.query;
    const analyses = await VideoAnalysis.findByUser(
      req.user.id, 
      parseInt(limit), 
      parseInt(offset)
    );
    
    res.json({ 
      analyses,
      total: analyses.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Récupérer une analyse spécifique
router.get('/:analysisId', authenticateUser, async (req, res) => {
  try {
    const { analysisId } = req.params;
    const analysis = await VideoAnalysis.findById(analysisId);
    
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    
    // Vérifier que l'utilisateur a accès à cette analyse
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({ analysis });
  } catch (error) {
    console.error('Analysis fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch analysis' });
  }
});

// Supprimer une analyse
router.delete('/:analysisId', authenticateUser, async (req, res) => {
  try {
    const { analysisId } = req.params;
    const analysis = await VideoAnalysis.findById(analysisId);
    
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Supprimer le fichier vidéo de GCS
    if (analysis.video_path) {
      await StorageService.deleteVideo(analysis.video_path);
    }
    
    // Supprimer l'enregistrement de la DB
    await VideoAnalysis.delete(analysisId);
    
    res.json({ success: true, message: 'Analysis deleted successfully' });
  } catch (error) {
    console.error('Analysis deletion error:', error);
    res.status(500).json({ error: 'Failed to delete analysis' });
  }
});

// Health check pour l'endpoint d'analyse
router.get('/health/check', async (req, res) => {
  try {
    // Vérifier la connexion DB
    const { data, error } = await require('../config/database').supabaseAdmin
      .from('profiles')
      .select('count')
      .limit(1);
    
    if (error) throw error;
    
    // Vérifier la connexion GCS
    const { bucket } = require('../config/storage');
    await bucket.getMetadata();
    
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        storage: 'connected',
        openai: !!process.env.OPENAI_API_KEY
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;