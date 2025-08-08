const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");

const { analyzeVideo } = require("../utils/videoAnalyzer");

// Instantiate OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const analyzeVideoHandler = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier vidéo envoyé." });
    }

    const videoPath = req.file.path;
    const { title = "", description = "" } = req.body;

    console.log("🎬 Analyse vidéo :", videoPath);
    console.log("📝 Titre :", title);
    console.log("📝 Description :", description);
    console.log("🔐 Clé API chargée (partielle) :", process.env.OPENAI_API_KEY?.slice(0, 8) + "...");

    // Transcription via Whisper API
    console.log("🔁 Transcription en cours...");
    let transcript = "";

    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(videoPath),
        model: "whisper-1",
      });
      transcript = transcription.text;
      console.log("📄 Transcription terminée :", transcript);
    } catch (transcriptionError) {
      console.error("❌ Erreur de transcription détaillée :", transcriptionError.response?.data || transcriptionError.message);
      throw new Error("Erreur de connexion à l'API OpenAI pour la transcription.");
    }

    // You should replace this with actual video duration in seconds!
    const durationSeconds = 60;

    // Analyse de la vidéo avec durée
    const results = analyzeVideo({ title, description, transcript, durationSeconds });

    // Supprimer le fichier temporaire
    fs.unlink(videoPath, (err) => {
      if (err) console.warn("⚠️ Impossible de supprimer le fichier temporaire :", err);
    });

    return res.json({
      transcript,
      analysis: results,
    });

  } catch (error) {
    console.error("❌ Erreur d'analyse vidéo :", error.message || error);
    return res.status(500).json({ error: error.message || "Échec de l'analyse vidéo." });
  }
};

module.exports = {
  analyzeVideoHandler,
};
