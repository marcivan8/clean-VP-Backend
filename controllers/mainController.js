// controllers/mainController.js
const path = require("path");
const fs = require("fs");
const { analyzeVideo } = require("../utils/videoAnalyzer");
const VideoAnalysis = require("../models/VideoAnalysis");
const UsageBasedPricingService = require("../services/UsageBasedPricingService");
const ViralityModelService = require("../services/ViralityModelService");

async function safeUnlink(file) {
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`🗑️ File deleted: ${file}`);
    }
  } catch (e) {
    console.warn("⚠️ Cannot delete file:", file, e);
  }
}

const analyzeVideoHandler = async (req, res) => {
  let videoPath = null;
  let analysisId = null;

  try {
    // 1. Validate Request
    if (!req.file) {
      return res.status(400).json({ error: "No video file provided." });
    }

    const { title = "", description = "", language = "en", ai_training_consent = "false" } = req.body;
    const userId = req.user.id;

    // Optional: Title and description are no longer strictly required
    // if (!title || !description) {
    //   return res.status(400).json({ error: "Title and description are required." });
    // }

    videoPath = req.file.path; // Multer diskStorage provides this
    console.log(`🎬 Starting analysis for user ${userId}: ${videoPath}`);

    // 2. Create DB Record
    const analysisRecord = await VideoAnalysis.create({
      user_id: userId,
      title: title.trim(),
      description: description.trim(),
      language: language,
      video_path: videoPath, // Note: This is a temp path, might want to upload to Supabase Storage later
      file_size: req.file.size,
      ai_training_consent: ai_training_consent === 'true'
    });
    analysisId = analysisRecord.id;

    // 3. Run Full Analysis Pipeline
    // analyzeVideo now handles audio extraction, transcription, frame extraction, etc.
    const results = await analyzeVideo({
      videoPath,
      title,
      description,
      language,
      userId
    });

    // Generate Machine Learning Prediction
    // ... (logic handled below)

    // 🆕 Audio Intelligence: Music Bed Suggestion
    const pacingScore = results.scores.pacing || 0;
    const emotionScores = results.scores.emotion || {};

    let suggestedMusic = {
      genre: 'Corporate / Ambient',
      track: 'Modern_Tech_Vibes.mp3',
      mood: 'Neutral',
      reason: 'Balanced pacing detected.'
    };

    // Logic: High Energy / Fast Cuts
    if (pacingScore > 7) {
      suggestedMusic = {
        genre: 'Upbeat / Phonk',
        track: 'High_Energy_Drift.mp3',
        mood: 'Energetic',
        reason: 'Fast pacing detected (> 7/10). Needs high BPM.'
      };
    }
    // Logic: Emotional / Slow
    else if (emotionScores.sad > 0.3 || emotionScores.fearful > 0.3) {
      suggestedMusic = {
        genre: 'Cinematic / Tense',
        track: 'Deep_Atmosphere.mp3',
        mood: 'Dramatic',
        reason: 'Emotional content detected.'
      };
    }
    // Logic: Happy / Vlog
    else if (emotionScores.happy > 0.5) {
      suggestedMusic = {
        genre: 'Lo-Fi / Chill',
        track: 'Summer_Vibes.mp3',
        mood: 'Happy',
        reason: 'Positive sentiment detected.'
      };
    }

    results.suggestions.musicRecommendation = suggestedMusic;
    const mlFeatures = {
      duration: results.metadata.duration,
      hookScore: results.scores.hook,
      pacingScore: results.scores.pacing,
      emotionScore: results.scores.emotion
    };

    // Non-blocking prediction
    let mlPrediction = { predictedViews: 0, viralityAssessment: 'N/A' };
    try {
      mlPrediction = await ViralityModelService.predict(mlFeatures);
      console.log('🤖 ML Prediction:', mlPrediction);
    } catch (e) {
      console.error('⚠️ ML Prediction failed:', e.message);
    }

    // 4. Save Results to DB
    // Map the new V2 results structure to what the DB/Frontend expects
    // The frontend likely expects: viralityScore, bestPlatform, platformScores, insights
    const dbResults = {
      viralityScore: results.scores.platformFit[results.scores.platformFit.best] || results.scores.pacing, // Fallback logic
      bestPlatform: Object.keys(results.scores.platformFit).reduce((a, b) => results.scores.platformFit[a] > results.scores.platformFit[b] ? a : b),
      platformScores: results.scores.platformFit,
      insights: [
        results.suggestions.hookRewrite,
        results.suggestions.ctaRewrite,
        ...results.suggestions.editingTips
      ],
      detailedAnalysis: results, // Store the full V2 object for future use
      predicted_views: mlPrediction.predictedViews,
      virality_assessment: mlPrediction.viralityAssessment
    };

    // Ensure viralityScore is set correctly from the best platform
    dbResults.viralityScore = dbResults.platformScores[dbResults.bestPlatform];

    await VideoAnalysis.updateResults(analysisId, dbResults);

    // 5. Track Usage
    await UsageBasedPricingService.trackUsage(userId, 'VIDEO_ANALYSIS', {
      analysisId: analysisId,
      title: title,
      viralityScore: dbResults.viralityScore,
      platform: dbResults.bestPlatform
    });

    // 6. Cleanup
    await safeUnlink(videoPath);

    // 7. Response
    res.json({
      success: true,
      analysisId: analysisId,
      transcript: results.transcript,
      viralityScore: dbResults.viralityScore,
      bestPlatform: dbResults.bestPlatform,
      platformScores: dbResults.platformScores,
      insights: dbResults.insights,
      suggestions: results.suggestions, // Send full suggestions object too
      details: results.details,
      metadata: results.metadata,
      prediction: {
        views: dbResults.predicted_views,
        assessment: dbResults.virality_assessment
      }
    });

  } catch (err) {
    console.error("❌ Analysis error:", err);
    if (videoPath) await safeUnlink(videoPath);

    if (analysisId) {
      await VideoAnalysis.updateStatus(analysisId, 'failed', err.message);
    }

    res.status(500).json({
      success: false,
      error: err.message || "Internal server error"
    });
  }
};

module.exports = { analyzeVideoHandler };