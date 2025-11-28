const fs = require('fs');
const path = require('path');
const { extractFrames } = require('../analysis/frameExtractor');
const { detectScenes } = require('../analysis/sceneDetector');
const { analyzePacing } = require('../analysis/pacingAnalyzer');
const { analyzeAudio } = require('../analysis/audioAnalyzer');
const { analyzeEmotionsBatch } = require('../analysis/emotionAnalyzer');
const { analyzeHook } = require('../viralEngine/hooks');
const { scorePacing } = require('../viralEngine/pacing');
const { scoreEmotion } = require('../viralEngine/emotion');
const { analyzeStructure } = require('../viralEngine/structure');
const { calculatePlatformFit } = require('../viralEngine/platformFit');
const { generateActions } = require('../viralEngine/actions');

// Keep existing translations helper
const INSIGHT_TRANSLATIONS = {
  en: { "very_short_video": "⏱️ Very short video", "long_video": "⏱️ Long video" },
  fr: { "very_short_video": "⏱️ Vidéo très courte", "long_video": "⏱️ Vidéo longue" },
  tr: { "very_short_video": "⏱️ Çok kısa video", "long_video": "⏱️ Uzun video" }
};

function getTranslation(key, lang = "en", replacements = {}) {
  // Simplified for brevity, can expand if needed or import from a separate file
  return key;
}

/**
 * Main function to orchestrate video analysis.
 * @param {Object} params - Analysis parameters.
 * @returns {Promise<Object>} - Full analysis results.
 */
async function analyzeVideo({
  videoPath,
  title = "",
  description = "",
  language = "en",
  userId
}) {
  console.log(`🚀 Starting V2 Analysis for: ${videoPath}`);
  const startTime = Date.now();
  const tempDir = path.join(path.dirname(videoPath), `frames-${Date.now()}`);

  try {
    // 1. Parallel Processing: Audio & Scene Detection
    console.log('🔄 Step 1: Audio & Scene Analysis...');
    const [audioAnalysis, sceneTimestamps] = await Promise.all([
      analyzeAudio(videoPath),
      detectScenes(videoPath)
    ]);

    // 2. Frame Extraction (based on scenes or interval)
    console.log('🔄 Step 2: Frame Extraction...');
    // Extract frames every 2 seconds for emotion analysis
    const frames = await extractFrames(videoPath, tempDir, 2);

    // 3. Visual Analysis (Emotion)
    console.log('🔄 Step 3: Visual Emotion Analysis...');
    const emotionAnalysis = await analyzeEmotionsBatch(frames.map(f => f.path));

    // 4. Pacing Analysis
    console.log('🔄 Step 4: Pacing Analysis...');
    const pacingAnalysis = analyzePacing(sceneTimestamps, audioAnalysis.duration);

    // 5. Viral DNA Engine Scoring
    console.log('🔄 Step 5: Viral DNA Scoring...');

    // Aggregate data for scoring
    const multimodalData = {
      transcript: audioAnalysis.transcript,
      audioAnalysis,
      visualAnalysis: {
        frames: emotionAnalysis.results,
        sceneBoundaries: sceneTimestamps
      },
      duration: audioAnalysis.duration,
      pacing: pacingAnalysis,
      emotion: emotionAnalysis
    };

    const hookScore = analyzeHook(multimodalData);
    const pacingScore = scorePacing(pacingAnalysis);
    const emotionScore = scoreEmotion(emotionAnalysis);
    const structureScore = analyzeStructure(multimodalData);

    const platformFit = calculatePlatformFit({
      duration: audioAnalysis.duration,
      pacing: pacingScore,
      emotion: emotionScore,
      hook: hookScore,
      structure: structureScore
    });

    // 6. Action Suggestions (GPT)
    console.log('🔄 Step 6: Generating Actionable Suggestions...');
    const actions = await generateActions({
      transcript: audioAnalysis.transcript,
      platformFit,
      scores: {
        hook: hookScore.score,
        pacing: pacingScore.score,
        emotion: emotionScore.score
      },
      hook: hookScore
    }, language);

    // 7. Cleanup
    console.log('🧹 Cleanup...');
    fs.rmSync(tempDir, { recursive: true, force: true });
    // Note: videoPath cleanup should be handled by the caller or here if we are done with it

    const processingTime = (Date.now() - startTime) / 1000;
    console.log(`✅ Analysis complete in ${processingTime}s`);

    return {
      scores: {
        hook: hookScore.score,
        pacing: pacingScore.score,
        emotion: emotionScore.score,
        structure: structureScore.score,
        platformFit
      },
      details: {
        hook: hookScore,
        pacing: pacingScore,
        emotion: emotionScore,
        structure: structureScore,
        audio: {
          wpm: audioAnalysis.wpm,
          fillerCount: audioAnalysis.fillerCount,
          duration: audioAnalysis.duration
        }
      },
      suggestions: actions,
      transcript: audioAnalysis.transcript,
      metadata: {
        duration: audioAnalysis.duration,
        processingTime,
        language
      }
    };

  } catch (error) {
    console.error('❌ Analysis failed:', error);
    // Try to cleanup temp dir even on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  }
}

module.exports = { analyzeVideo };