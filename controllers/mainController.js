const path = require("path");
const fs = require("fs");
const { OpenAI } = require("openai");
const { analyzeVideo } = require("../utils/videoAnalyzer");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const analyzeVideoHandler = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded." });
    }

    const videoPath = req.file.path;
    const { title = "", description = "" } = req.body;

    console.log("🎬 Analyzing video:", videoPath);
    console.log("📝 Title:", title);
    console.log("📝 Description:", description);

    // Transcrire audio/vidéo avec OpenAI Whisper
    console.log("🔁 Transcription en cours...");
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(videoPath),
      model: "whisper-1",
    });

    const transcript = transcription.text;
    console.log("📄 Transcription terminée :", transcript);

    // Analyser la transcription
    const results = analyzeVideo({
      title,
      description,
      transcript,
    });

    // Supprimer fichier temporaire
    fs.unlink(videoPath, (err) => {
      if (err) console.warn("⚠️ Failed to delete uploaded file:", err);
    });

    // Retourner la transcription + l’analyse
    return res.json({
      transcript,
      analysis: results,
    });
  } catch (error) {
    console.error("❌ Error during video analysis:", error.message || error);
    console.error(error.stack);
    return res.status(500).json({ error: "Video analysis failed." });
  }
};

module.exports = {
  analyzeVideoHandler,
};

