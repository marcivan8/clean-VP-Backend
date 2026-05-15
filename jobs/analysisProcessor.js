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

module.exports = async function processAnalysisJob(job) {
    const { videoPath, title, description, language, ai_training_consent, userId, fileSize, filename } = job.data;
    let analysisId = null;

    // Resolve absolute paths
    const uploadsDir = path.resolve(__dirname, '../uploads');
    const absoluteVideoPath = path.resolve(videoPath);
    let localPathToProcess = absoluteVideoPath;

    // We do NOT require bucket dynamically inside the handler so that if bucket throws an error we catch it early.
    // We already require storage above, let's add it there or here.
    const { bucket } = require('../config/storage');

    if (!fs.existsSync(absoluteVideoPath)) {
        if (bucket && filename) {
            console.log(`[Job ${job.id}] Local file not found, attempting to download from GCS...`);
            const gcsRawPath = `raw/${userId}/${filename}`;
            try {
                const dir = path.dirname(absoluteVideoPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                await bucket.file(gcsRawPath).download({ destination: absoluteVideoPath });
                console.log(`[Job ${job.id}] Successfully downloaded from GCS to ${absoluteVideoPath}`);
            } catch (err) {
                throw new Error(`Input file not found locally and failed to download from GCS: ${err.message}`);
            }
        } else {
            throw new Error(`Input file not found: ${absoluteVideoPath}`);
        }
    }

    try {
        await job.updateProgress(5);
        console.log(`[Job ${job.id}] 🎬 Starting analysis for user ${userId}: ${localPathToProcess}`);

        // 2. Create DB Record
        const analysisRecord = await VideoAnalysis.create({
            user_id: userId,
            title: title.trim(),
            description: description.trim(),
            language: language,
            video_path: localPathToProcess,
            file_size: fileSize,
            ai_training_consent: ai_training_consent === 'true'
        });
        analysisId = analysisRecord.id;
        await job.updateProgress(10);

        // 3. Run Full Analysis Pipeline
        const results = await analyzeVideo({
            videoPath: localPathToProcess,
            title,
            description,
            language,
            userId
        });
        await job.updateProgress(70);

        const pacingScore = results.scores?.pacing || 0;
        const emotionScores = results.scores?.emotion || {};

        let suggestedMusic = {
            genre: 'Corporate / Ambient',
            track: 'Modern_Tech_Vibes.mp3',
            mood: 'Neutral',
            reason: 'Balanced pacing detected.'
        };

        if (pacingScore > 7) {
            suggestedMusic = {
                genre: 'Upbeat / Phonk',
                track: 'High_Energy_Drift.mp3',
                mood: 'Energetic',
                reason: 'Fast pacing detected (> 7/10). Needs high BPM.'
            };
        } else if (emotionScores.sad > 0.3 || emotionScores.fearful > 0.3) {
            suggestedMusic = {
                genre: 'Cinematic / Tense',
                track: 'Deep_Atmosphere.mp3',
                mood: 'Dramatic',
                reason: 'Emotional content detected.'
            };
        } else if (emotionScores.happy > 0.5) {
            suggestedMusic = {
                genre: 'Lo-Fi / Chill',
                track: 'Summer_Vibes.mp3',
                mood: 'Happy',
                reason: 'Positive sentiment detected.'
            };
        }

        if (!results.suggestions) results.suggestions = {};
        results.suggestions.musicRecommendation = suggestedMusic;

        const mlFeatures = {
            duration: results.metadata?.duration || 0,
            hookScore: results.scores?.hook || 0,
            pacingScore: pacingScore,
            emotionScore: emotionScores
        };

        let mlPrediction = { predictedViews: 0, viralityAssessment: 'N/A' };
        try {
            mlPrediction = await ViralityModelService.predict(mlFeatures);
            console.log(`[Job ${job.id}] 🤖 ML Prediction:`, mlPrediction);
        } catch (e) {
            console.error(`[Job ${job.id}] ⚠️ ML Prediction failed:`, e.message);
        }
        await job.updateProgress(85);

        const platformFit = results.scores?.platformFit || { best: 'tiktok' };
        
        const dbResults = {
            viralityScore: platformFit[platformFit.best] || pacingScore,
            bestPlatform: Object.keys(platformFit).reduce((a, b) => platformFit[a] > platformFit[b] ? a : b, 'tiktok'),
            platformScores: platformFit,
            insights: [
                results.suggestions.hookRewrite,
                results.suggestions.ctaRewrite,
                ...(results.suggestions.editingTips || [])
            ].filter(Boolean),
            detailedAnalysis: results,
            predicted_views: mlPrediction.predictedViews,
            virality_assessment: mlPrediction.viralityAssessment
        };

        dbResults.viralityScore = dbResults.platformScores[dbResults.bestPlatform] || 0;

        await VideoAnalysis.updateResults(analysisId, dbResults);
        await job.updateProgress(95);

        await UsageBasedPricingService.trackUsage(userId, 'VIDEO_ANALYSIS', {
            analysisId: analysisId,
            title: title,
            viralityScore: dbResults.viralityScore,
            platform: dbResults.bestPlatform
        });

        await safeUnlink(videoPath);
        await job.updateProgress(100);
        console.log(`[Job ${job.id}] ✅ Analysis Complete`);

        return {
            analysisId: analysisId,
            transcript: results.transcript,
            viralityScore: dbResults.viralityScore,
            bestPlatform: dbResults.bestPlatform,
            platformScores: dbResults.platformScores,
            insights: dbResults.insights,
            suggestions: results.suggestions,
            details: results.details,
            metadata: results.metadata,
            prediction: {
                views: dbResults.predicted_views,
                assessment: dbResults.virality_assessment
            }
        };

    } catch (err) {
        console.error(`[Job ${job.id}] ❌ Analysis error:`, err);
        if (videoPath) await safeUnlink(videoPath);
        if (analysisId) {
            await VideoAnalysis.updateStatus(analysisId, 'failed', err.message);
        }
        throw err;
    }
};
