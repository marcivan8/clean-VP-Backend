const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");
const { extractAudio } = require("../utils/compressVideo");
const { analyzeVideo } = require("../utils/videoAnalyzer");

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
    console.log("🔁 Transcription en cours...");
    let transcript = "";
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-1",
      });
      transcript = transcription.text;
      console.log("📄 Transcription terminée :", transcript);
    } catch (err) {
      console.error("❌ Erreur de transcription :", err.message);
      throw new Error("Erreur de connexion à l'API OpenAI pour la transcription.");
    }

    // Analyse
    const results = analyzeVideo({ title, description, transcript });
    console.log("📊 Résultats de l'analyse :", results);

    // Clean up
    [videoPath, audioPath].forEach((file) =>
      fs.unlink(file, (err) => {
        if (err) console.warn(`⚠️ Impossible de supprimer ${file}:`, err);
      })
    );

    // Return simplified results with matching keys
    res.json({
      transcript,
      viralityScore: results.viralityScore,
      bestPlatform: results.bestPlatform,
      insights: results.insights,
    });

  } catch (err) {
    console.error("❌ Erreur lors de l'analyse :", err.message);
    res.status(500).json({ error: "Erreur lors de l'analyse" });
  }
};

module.exports = { analyzeVideoHandler };
