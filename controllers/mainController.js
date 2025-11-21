// controllers/mainController.js
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");
const { extractAudio } = require("../utils/compressVideo");
const { analyzeVideo } = require("../utils/videoAnalyzer");
const User = require("../models/User");
const VideoAnalysis = require("../models/VideoAnalysis");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function safeUnlink(file) {
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`🗑️ Fichier supprimé: ${file}`);
    }
  } catch (e) {
    console.warn("⚠️ Cannot delete file:", file, e);
  }
}

const analyzeVideoHandler = async (req, res) => {
  let videoPath = null;
  let audioPath = null;
  let analysisId = null;

  try {
    // Vérifier le fichier
    if (!req.file) {
      console.error('❌ No file uploaded');
      return res.status(400).json({
        error: "No video file provided.",
        viralityScore: 0,
        bestPlatform: "Unknown",
        platformScores: {},
        insights: ["Please upload a video file to analyze."]
      });
    }

    // Récupérer les données du formulaire
    const { title = "", description = "", language = "en", ai_training_consent = "false" } = req.body;
    const userId = req.user.id;

    console.log("🎬 Starting video analysis:", {
      userId,
      title: title.substring(0, 50),
      fileSize: req.file.size,
      language
    });

    // Valider les champs requis
    if (!title || !description) {
      console.error('❌ Missing title or description');
      return res.status(400).json({
        error: "Title and description are required.",
        viralityScore: 0,
        bestPlatform: "Unknown",
        platformScores: {},
        insights: ["Please provide both title and description."]
      });
    }

    // Sauvegarder temporairement le fichier vidéo
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'temp');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const timestamp = Date.now();
    const sanitizedFilename = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    videoPath = path.join(uploadsDir, `${timestamp}-${sanitizedFilename}`);
    audioPath = path.join(uploadsDir, `${timestamp}-audio.mp3`);

    // Écrire le buffer dans un fichier
    fs.writeFileSync(videoPath, req.file.buffer);
    console.log(`✅ Video saved to: ${videoPath}`);

    // Créer l'enregistrement d'analyse dans la DB
    const analysisRecord = await VideoAnalysis.create({
      user_id: userId,
      title: title.trim(),
      description: description.trim(),
      language: language,
      video_path: videoPath,
      file_size: req.file.size,
      ai_training_consent: ai_training_consent === 'true'
    });
    analysisId = analysisRecord.id;
    console.log(`📊 Analysis record created: ${analysisId}`);

    // 1) Extraire l'audio
    let transcript = "";
    try {
      console.log("🎧 Extracting audio...");
      await extractAudio(videoPath, audioPath);
      console.log("✅ Audio extracted successfully");

      // 2) Transcription avec Whisper
      if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0) {
        try {
          console.log("🔁 Transcribing audio with Whisper...");
          const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
          });
          transcript = transcription?.text || "";
          console.log(`✅ Transcription completed, length: ${transcript.length}`);
        } catch (transcriptionError) {
          console.error("❌ Transcription error:", transcriptionError?.message);
          transcript = "";
        }
      }
    } catch (audioError) {
      console.error("⚠️ Audio extraction failed:", audioError?.message);
      transcript = "";
    }

    // 3) Analyser avec le videoAnalyzer
    console.log("🔍 Analyzing video content...");
    let results = {
      viralityScore: 0,
      bestPlatform: "Unknown",
      platformScores: {},
      insights: []
    };

    try {
      results = analyzeVideo({
        title,
        description,
        transcript,
        language
      });
      console.log(`✅ Analysis completed - Score: ${results.viralityScore}, Platform: ${results.bestPlatform}`);

      // Generate AI-powered specific insights
      if (transcript && results.bestPlatform !== "Unknown") {
        try {
          console.log("🧠 Generating AI insights...");
          const prompt = `
            You are a professional video content strategist.
            Analyze the following video content and provide 3-5 specific, actionable, and detailed insights on how to improve this specific video for better performance on **${results.bestPlatform}**.
            
            Context:
            - Title: "${title}"
            - Description: "${description}"
            - Transcript (excerpt): "${transcript.substring(0, 1500)}..."
            - Current Virality Score: ${results.viralityScore}/100
            
            Your insights must be:
            1. Specific to the content (quote specific parts if needed).
            2. Actionable (tell exactly what to change or add).
            3. Tailored to ${results.bestPlatform}'s algorithm and audience.
            4. Not generic advice like "improve lighting" unless specifically relevant to the content description.
            
            Format the output as a JSON object with a single key "insights" containing an array of strings. Example: { "insights": ["Insight 1", "Insight 2"] }
          `;

          const completion = await openai.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "gpt-3.5-turbo",
            response_format: { type: "json_object" },
          });

          const aiContent = JSON.parse(completion.choices[0].message.content);
          if (aiContent && Array.isArray(aiContent.insights)) {
            if (aiContent.insights.length > 0) {
              results.insights = aiContent.insights;
              console.log("✅ AI insights generated successfully");
            }
          }
        } catch (aiError) {
          console.error("⚠️ Failed to generate AI insights, falling back to static ones:", aiError.message);
          // Fallback is already in results.insights from analyzeVideo
        }
      }
    } catch (analysisError) {
      console.error("❌ Analysis error:", analysisError);
      results.insights = ["Analysis completed with limited data. Try adding more details."];
    }

    // 4) Mettre à jour l'enregistrement avec les résultats
    await VideoAnalysis.updateResults(analysisId, results);
    console.log(`✅ Results saved to database`);

    // 5) Mettre à jour l'usage utilisateur
    await User.updateUsage(userId);
    console.log(`✅ User usage updated`);

    // 6) Nettoyer les fichiers temporaires
    await Promise.allSettled([
      safeUnlink(videoPath),
      safeUnlink(audioPath)
    ]);

    // 7) Retourner les résultats
    const response = {
      success: true,
      analysisId: analysisId,
      transcript: transcript || "No transcript available",
      viralityScore: results.viralityScore || 0,
      bestPlatform: results.bestPlatform || "Unknown",
      platformScores: results.platformScores || {},
      insights: results.insights || [],
      language: language,
      metadata: results.metadata || {
        wordCount: transcript.split(/\s+/).length,
        analysisTimestamp: new Date().toISOString()
      }
    };

    console.log("✅ Analysis completed successfully:", {
      analysisId,
      score: response.viralityScore,
      platform: response.bestPlatform
    });

    return res.json(response);

  } catch (err) {
    console.error("❌ Analysis error:", err);

    // Nettoyer les fichiers en cas d'erreur
    if (videoPath) await safeUnlink(videoPath);
    if (audioPath) await safeUnlink(audioPath);

    // Mettre à jour le statut en erreur
    if (analysisId) {
      try {
        await VideoAnalysis.updateStatus(analysisId, 'failed', err.message);
      } catch (updateError) {
        console.error("❌ Failed to update error status:", updateError);
      }
    }

    return res.status(500).json({
      success: false,
      error: err?.message || "Internal server error",
      transcript: "",
      viralityScore: 0,
      bestPlatform: "Unknown",
      platformScores: {},
      insights: ["Analysis failed. Please try again."]
    });
  }
};

module.exports = { analyzeVideoHandler };