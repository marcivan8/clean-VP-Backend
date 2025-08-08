const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");
const { analyzeVideo } = require("../utils/videoAnalyzer");

ffmpeg.setFfmpegPath(ffmpegPath);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata.format.duration; // seconds
      resolve(duration);
    });
  });
}

const analyzeVideoHandler = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier vidéo envoyé." });

    const videoPath = req.file.path;
    const { title = "", description = "" } = req.body;

    console.log("🎬 Analyse vidéo :", videoPath);
    console.log("📝 Titre :", title);
    console.log("📝 Description :", description);
    console.log("🔐 Clé API chargée (partielle) :", process.env.OPENAI_API_KEY?.slice(0, 8) + "...");

    // Get video duration
    const duration = await getVideoDuration(videoPath);
    console.log(`⏱️ Durée vidéo: ${duration} secondes`);

    // Transcription
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

    // Analyse vidéo avec durée et transcript
    const results = analyzeVideo({ title, description, transcript, duration });

    // Supprimer le fichier temporaire
    fs.unlink(videoPath, (err) => {
      if (err) console.warn("⚠️ Impossible de supprimer le fichier temporaire :", err);
    });

    // Retourner la réponse
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
