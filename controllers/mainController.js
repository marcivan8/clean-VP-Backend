const path = require("path");
const fs = require("fs");
const OpenAI = require("openai"); // ✅ Use correct constructor
const { extractAudio } = require("../utils/compressVideo");
const { analyzeVideo } = require("../utils/videoAnalyzer");

// ✅ Initialize OpenAI client with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const analyzeVideoHandler = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier vidéo envoyé." });
    }

    const videoPath = req.file.path;
    const audioPath = path.join("uploads", `${Date.now()}-audio.mp3`);
    const { title = "", description = "" } = req.body;

    console.log("🎬 Analyse vidéo :", videoPath);
    console.log("📝 Titre :", title);
    console.log("📝 Description :", description);

    // Extract audio
    console.log("🎧 Extraction audio en cours...");
    await extractAudio(videoPath, audioPath);
    console.log("✅ Audio extrait :", audioPath);

    // Transcription
    let transcript = "";
    try {
      console.log("🔁 Transcription en cours...");
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-1",
      });
      transcript = transcription.text || "";
      console.log("📄 Transcription terminée :", transcript);
    } catch (err) {
      console.error("❌ Erreur de transcription :", err.message);
      // ✅ Return partial result instead of crashing
      return res.status(500).json({
        error: "Erreur de transcription audio.",
        details: err.message,
      });
    }

    // Analyse
    const results = analyzeVideo({ title, description, transcript });
    console.log("📊 Résultats de l'analyse :", results);

    // Clean up uploaded and extracted files
    [videoPath, audioPath].forEach((file) =>
      fs.unlink(file, (err) => {
        if (err) console.warn(`⚠️ Impossible de supprimer ${file}:`, err);
      })
    );

    // ✅ Send complete response with all fields
    res.json({
      transcript,
      bestPlatform: results.bestPlatform,
      platformScores: results.platformScores,
      insights: results.insights,
    });
  } catch (err) {
    console.error("❌ Erreur lors de l'analyse :", err.message);
    res.status(500).json({ error: "Erreur lors de l'analyse" });
  }
};

module.exports = { analyzeVideoHandler };
