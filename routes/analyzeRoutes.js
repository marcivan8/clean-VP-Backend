// ===== routes/analyzeRoutes.js - FIXED VERSION =====
const express = require('express');
const multer = require('multer');
const { authenticateUser } = require('../middleware/auth');
const { checkUsageLimits } = require('../middleware/usageLimits');
const StorageService = require('../services/StorageService');
const VideoAnalysis = require('../models/VideoAnalysis');
const { analyzeVideo } = require('../utils/videoAnalyzer');
const { extractAudio } = require('../utils/compressVideo');
const { translateError, validateLanguage } = require('../utils/translations');
const { extractFrames } = require('../utils/extractFrames');
const { analyzeEmotionsBatch } = require('../utils/emotionAnalyzer');
const { analyzeScenesBatch } = require('../utils/sceneAnalyzer');
const { classifyAudio } = require('../utils/audioClassifier');
const UsageBasedPricingService = require('../services/UsageBasedPricingService');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

const router = express.Router();

// Initialize OpenAI with proper error handling
let openai = null;
try {
  if (!process.env.OPENAI_API_KEY) {
    console.error('⚠️ OPENAI_API_KEY not found in environment variables');
  } else {
    openai = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 2,
      timeout: 30000 // 30 second timeout
    });
    console.log('✅ OpenAI client initialized');
  }
} catch (error) {
  console.error('❌ Failed to initialize OpenAI client:', error.message);
}

// Ensure temp directory exists
const getTempDir = () => {
  const tempDir = process.env.TEMP_DIR || path.join(os.tmpdir(), 'video-analyzer');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
};

// Enhanced Multer configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Log incoming file details
    console.log('📁 Incoming file:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    
    // Check MIME type
    if (!file.mimetype.startsWith('video/')) {
      return cb(new Error('Only video files are allowed'), false);
    }
    
    // Check extension
    const allowedExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.m4v', '.mpeg'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      console.warn(`⚠️ Unsupported video format: ${fileExtension}`);
      return cb(new Error(`Unsupported video format: ${fileExtension}`), false);
    }
    
    cb(null, true);
  }
});

// Data validation middleware
const validateAnalysisData = (req, res, next) => {
  const { title, description, language = 'en' } = req.body;
  
  console.log('📝 Validating analysis data:', { 
    title: title?.substring(0, 50), 
    descriptionLength: description?.length,
    language 
  });
  
  if (!title || title.trim().length < 3) {
    return res.status(400).json({ 
      error: translateError('missing_title', language),
      field: 'title',
      code: 'VALIDATION_ERROR'
    });
  }
  
  if (!description || description.trim().length < 10) {
    return res.status(400).json({ 
      error: translateError('missing_description', language),
      field: 'description',
      code: 'VALIDATION_ERROR'
    });
  }
  
  // Validate and normalize language
  req.body.language = validateLanguage(language);
  
  next();
};

// Main analysis route with enhanced error handling
router.post('/', 
  authenticateUser,
  checkUsageLimits, 
  upload.single('video'),
  validateAnalysisData,
  async (req, res) => {
    const startTime = Date.now();
    let tempVideoPath = null;
    let tempAudioPath = null;
    let analysisRecord = null;
    const tempDir = getTempDir();

    try {
      const { title, description, language, ai_training_consent = 'false' } = req.body;
      const userId = req.user.id;
      const hasConsent = ai_training_consent === 'true';
      
      if (!req.file) {
        console.error('❌ No file in request');
        return res.status(400).json({ 
          error: translateError('no_file', language),
          code: 'NO_FILE'
        });
      }

      console.log(`🎬 Starting analysis for user ${userId}`);
      console.log(`📊 File details: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)}MB)`);
      
      // 1. Upload to storage (GCS or local)
      let uploadResult;
      try {
        console.log('📤 Uploading video to storage...');
        uploadResult = await StorageService.uploadVideo(req.file, userId, hasConsent);
        console.log('✅ Video uploaded successfully:', uploadResult.path);
      } catch (uploadError) {
        console.error('❌ Storage upload failed:', uploadError.message);
        return res.status(500).json({ 
          error: translateError('internal_error', language),
          details: 'Storage upload failed',
          code: 'STORAGE_UPLOAD_FAILED'
        });
      }
      
      // 2. Create analysis record in database
      try {
        console.log('💾 Creating analysis record...');
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
        console.error('❌ Database error:', dbError.message);
        // Clean up uploaded file
        await StorageService.deleteVideo(uploadResult.path).catch(e => 
          console.warn('Failed to cleanup uploaded file:', e.message)
        );
        return res.status(500).json({ 
          error: translateError('internal_error', language),
          details: 'Database error',
          code: 'DATABASE_ERROR'
        });
      }
      
      // 3. Process video for analysis
      try {
        console.log('🎥 Starting video processing...');
        
        // Download video for processing
        let videoBuffer;
        try {
          videoBuffer = await StorageService.downloadVideo(uploadResult.path);
          console.log(`✅ Video downloaded (${(videoBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
        } catch (downloadError) {
          console.error('❌ Video download failed:', downloadError.message);
          throw new Error('Failed to download video for processing');
        }
        
        // Save to temp file for ffmpeg processing
        const timestamp = Date.now();
        const safeFilename = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        tempVideoPath = path.join(tempDir, `${timestamp}-${safeFilename}`);
        
        fs.writeFileSync(tempVideoPath, videoBuffer);
        console.log('💾 Temp video saved:', tempVideoPath);
        
        // Extract audio and transcribe
        let transcript = '';
        
        if (openai) {
          tempAudioPath = path.join(tempDir, `${timestamp}-audio.mp3`);
          
          try {
            console.log('🎧 Extracting audio...');
            await extractAudio(tempVideoPath, tempAudioPath);
            console.log('✅ Audio extracted successfully');
            
            if (fs.existsSync(tempAudioPath)) {
              const audioSize = fs.statSync(tempAudioPath).size;
              console.log(`📊 Audio file size: ${(audioSize / 1024 / 1024).toFixed(2)}MB`);
              
              // Check audio file size (Whisper API limit is 25MB)
              if (audioSize > 25 * 1024 * 1024) {
                console.warn('⚠️ Audio file too large for Whisper API (>25MB)');
              } else {
                try {
                  console.log('🔄 Starting transcription with Whisper...');
                  const transcription = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(tempAudioPath),
                    model: 'whisper-1',
                    language: language === 'fr' ? 'fr' : language === 'tr' ? 'tr' : 'en',
                    response_format: 'text'
                  });
                  
                  transcript = transcription || '';
                  console.log(`✅ Transcription completed: ${transcript.length} characters`);
                } catch (transcriptError) {
                  console.error('❌ Transcription error:', {
                    message: transcriptError.message,
                    status: transcriptError.response?.status,
                    data: transcriptError.response?.data
                  });
                  
                  // Continue without transcript
                  console.warn('⚠️ Continuing without transcript - will analyze title/description only');
                }
              }
            }
          } catch (audioError) {
            console.warn('⚠️ Audio extraction failed:', audioError.message);
            console.log('📝 Continuing with text-only analysis');
          }
        } else {
          console.warn('⚠️ OpenAI client not initialized - skipping transcription');
        }
        
        // 4. Extract frames for visual analysis
        let emotionAnalysis = null;
        let sceneAnalysis = null;
        let audioClassification = null;
        let framesDir = null;
        
        try {
          console.log('🎬 Extracting video frames...');
          framesDir = path.join(tempDir, `${timestamp}-frames`);
          const framePaths = await extractFrames(tempVideoPath, framesDir, 5);
          console.log(`✅ ${framePaths.length} frames extracted`);
          
          // 4a. Analyze emotions from frames
          if (framePaths.length > 0) {
            try {
              console.log('😊 Analyzing emotions...');
              emotionAnalysis = await analyzeEmotionsBatch(framePaths);
              console.log(`✅ Emotion analysis complete: ${emotionAnalysis.totalFacesDetected || 0} faces detected`);
            } catch (emotionError) {
              console.warn('⚠️ Emotion analysis failed:', emotionError.message);
            }
            
            // 4b. Analyze scenes with GPT-4o-mini-vision
            if (openai) {
              try {
                console.log('🎨 Analyzing scenes with GPT-4o-mini-vision...');
                sceneAnalysis = await analyzeScenesBatch(framePaths, language);
                console.log(`✅ Scene analysis complete: ${sceneAnalysis.framesAnalyzed} frames analyzed`);
              } catch (sceneError) {
                console.warn('⚠️ Scene analysis failed:', sceneError.message);
              }
            }
          }
        } catch (frameError) {
          console.warn('⚠️ Frame extraction failed:', frameError.message);
        }
        
        // 4c. Classify audio
        if (tempAudioPath && fs.existsSync(tempAudioPath)) {
          try {
            console.log('🎵 Classifying audio...');
            audioClassification = await classifyAudio(tempAudioPath);
            if (audioClassification.success) {
              console.log(`✅ Audio classification complete: ${audioClassification.dominantCategory}`);
            }
          } catch (audioClassError) {
            console.warn('⚠️ Audio classification failed:', audioClassError.message);
          }
        }
        
        // 5. Perform AI analysis with all data
        console.log('🤖 Starting AI analysis...');
        const analysisResults = analyzeVideo({
          title: title.trim(),
          description: description.trim(), 
          transcript: transcript || '',
          language,
          emotionAnalysis,
          sceneAnalysis,
          audioClassification
        });
        
        console.log('✅ AI analysis completed:', {
          platform: analysisResults.bestPlatform,
          score: analysisResults.viralityScore,
          insights: analysisResults.insights.length
        });
        
        // 6. Update database with results
        await VideoAnalysis.updateResults(analysisRecord.id, analysisResults);
        
        // 7. Track usage via pricing service (non-blocking)
        try {
          await UsageBasedPricingService.trackUsage(userId, 'videoAnalysis', {
            analysisId: analysisRecord.id,
            bestPlatform: analysisResults.bestPlatform,
            viralityScore: analysisResults.viralityScore
          });
        } catch (usageError) {
          console.warn('⚠️ Failed to track usage:', usageError.message);
        }
        
        const processingTime = Date.now() - startTime;
        console.log(`✅ Analysis complete for user ${userId} (${processingTime}ms)`);
        
        // 8. Send successful response
        res.json({
          success: true,
          analysis_id: analysisRecord.id,
          transcript: transcript || 'No transcript available',
          viralityScore: analysisResults.viralityScore,
          bestPlatform: analysisResults.bestPlatform,
          platformScores: analysisResults.platformScores,
          insights: analysisResults.insights,
          language: language,
          emotionAnalysis: emotionAnalysis,
          sceneAnalysis: sceneAnalysis,
          audioClassification: audioClassification,
          metadata: {
            ...analysisResults.metadata,
            fileSize: req.file.size,
            processingTime: processingTime
          },
          consent_given: hasConsent
        });
        
      } catch (processingError) {
        console.error('❌ Processing error:', processingError);
        
        // Mark analysis as failed in database
        if (analysisRecord) {
          await VideoAnalysis.updateStatus(analysisRecord.id, 'failed', {
            error: processingError.message,
            timestamp: new Date().toISOString()
          }).catch(e => console.error('Failed to update analysis status:', e));
        }
          
        res.status(500).json({ 
          error: translateError('analysis_failed', language),
          details: process.env.NODE_ENV === 'development' ? processingError.message : 'Processing failed',
          code: 'PROCESSING_ERROR'
        });
      }
      
    } catch (error) {
      console.error('❌ Unexpected error in analysis endpoint:', error);
      
      // Update analysis status if record exists
      if (analysisRecord) {
        await VideoAnalysis.updateStatus(analysisRecord.id, 'failed', {
          error: error.message,
          timestamp: new Date().toISOString()
        }).catch(e => console.error('Failed to update analysis status:', e));
      }
      
      res.status(500).json({ 
        error: translateError('internal_error', language || 'en'),
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        code: 'INTERNAL_ERROR'
      });
      
    } finally {
      // Cleanup temporary files
      if (tempVideoPath && fs.existsSync(tempVideoPath)) {
        try { 
          fs.unlinkSync(tempVideoPath); 
          console.log('🗑️ Temp video cleaned up');
        } catch (e) { 
          console.warn('Failed to cleanup temp video:', e.message); 
        }
      }
      
      if (tempAudioPath && fs.existsSync(tempAudioPath)) {
        try { 
          fs.unlinkSync(tempAudioPath); 
          console.log('🗑️ Temp audio cleaned up');
        } catch (e) { 
          console.warn('Failed to cleanup temp audio:', e.message); 
        }
      }
      
      // Cleanup frames directory
      if (framesDir && fs.existsSync(framesDir)) {
        try {
          const frameFiles = fs.readdirSync(framesDir);
          frameFiles.forEach(file => {
            const filePath = path.join(framesDir, file);
            if (fs.statSync(filePath).isFile()) {
              fs.unlinkSync(filePath);
            }
          });
          fs.rmdirSync(framesDir);
          console.log('🗑️ Frames directory cleaned up');
        } catch (e) {
          console.warn('Failed to cleanup frames directory:', e.message);
        }
      }
    }
  }
);

// Get analysis history
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
    res.status(500).json({ 
      error: 'Failed to fetch history',
      code: 'HISTORY_ERROR'
    });
  }
});

// Get specific analysis
router.get('/:analysisId', authenticateUser, async (req, res) => {
  try {
    const { analysisId } = req.params;
    const analysis = await VideoAnalysis.findById(analysisId);
    
    if (!analysis) {
      return res.status(404).json({ 
        error: 'Analysis not found',
        code: 'NOT_FOUND'
      });
    }
    
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ 
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }
    
    res.json({ analysis });
  } catch (error) {
    console.error('Analysis fetch error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch analysis',
      code: 'FETCH_ERROR'
    });
  }
});

// Delete analysis
router.delete('/:analysisId', authenticateUser, async (req, res) => {
  try {
    const { analysisId } = req.params;
    const analysis = await VideoAnalysis.findById(analysisId);
    
    if (!analysis) {
      return res.status(404).json({ 
        error: 'Analysis not found',
        code: 'NOT_FOUND'
      });
    }
    
    if (analysis.user_id !== req.user.id) {
      return res.status(403).json({ 
        error: 'Access denied',
        code: 'ACCESS_DENIED'
      });
    }
    
    // Delete video file from storage
    if (analysis.video_path) {
      await StorageService.deleteVideo(analysis.video_path)
        .catch(e => console.warn('Failed to delete video file:', e));
    }
    
    // Delete database record
    await VideoAnalysis.delete(analysisId);
    
    res.json({ 
      success: true, 
      message: 'Analysis deleted successfully' 
    });
  } catch (error) {
    console.error('Analysis deletion error:', error);
    res.status(500).json({ 
      error: 'Failed to delete analysis',
      code: 'DELETE_ERROR'
    });
  }
});

// Enhanced health check endpoint
router.get('/health/check', async (req, res) => {
  const health = {
    status: 'checking',
    timestamp: new Date().toISOString(),
    services: {}
  };

  try {
    // Check database connection
    try {
      const { supabaseAdmin } = require('../config/database');
      const { error } = await supabaseAdmin
        .from('profiles')
        .select('count')
        .limit(1)
        .single();
      
      if (error) throw error;
      health.services.database = 'connected';
    } catch (dbError) {
      console.error('Database health check failed:', dbError.message);
      health.services.database = 'error';
      health.errors = health.errors || [];
      health.errors.push(`Database: ${dbError.message}`);
    }
    
    // Check storage health
    try {
      const storageHealth = await StorageService.checkStorageHealth();
      health.services.storage = storageHealth.healthy ? 'connected' : 'error';
      health.services.storageType = storageHealth.type;
      
      if (!storageHealth.healthy) {
        health.errors = health.errors || [];
        health.errors.push(`Storage: ${storageHealth.error}`);
      }
    } catch (storageError) {
      console.error('Storage health check failed:', storageError.message);
      health.services.storage = 'error';
      health.errors = health.errors || [];
      health.errors.push(`Storage: ${storageError.message}`);
    }
    
    // Check OpenAI
    health.services.openai = openai ? 'configured' : 'not_configured';
    if (!openai && process.env.OPENAI_API_KEY) {
      health.warnings = health.warnings || [];
      health.warnings.push('OpenAI API key present but client initialization failed');
    }
    
    // Check temp directory
    try {
      const tempDir = getTempDir();
      health.services.tempDir = fs.existsSync(tempDir) ? 'available' : 'missing';
    } catch (tempError) {
      health.services.tempDir = 'error';
      health.errors = health.errors || [];
      health.errors.push(`Temp directory: ${tempError.message}`);
    }
    
    // Determine overall health status
    if (health.errors && health.errors.length > 0) {
      health.status = 'unhealthy';
      res.status(503).json(health);
    } else if (health.warnings && health.warnings.length > 0) {
      health.status = 'degraded';
      res.status(200).json(health);
    } else {
      health.status = 'healthy';
      res.status(200).json(health);
    }
    
  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({ 
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;