const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");
const { analyzeVideo } = require("../utils/videoAnalyzer");
const { extractAudio } = require("../utils/compressVideo");

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

    // Clean up
    [videoPath, audioPath].forEach((file) =>
      fs.unlink(file, (err) => {
        if (err) console.warn(`⚠️ Impossible de supprimer ${file}:`, err);
      })
    );

    res.json({
      transcript,
      analysis: results,
    });

  } catch (error) {
    console.error("❌ Erreur d'analyse vidéo :", error.message || error);
    res.status(500).json({ error: error.message || "Échec de l'analyse vidéo." });
  }
};

module.exports = { analyzeVideoHandler };
