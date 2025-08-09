// controllers/mainController.js
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");
const { extractAudio } = require("../utils/compressVideo"); // garde ce fichier
const { analyzeVideo } = require("../utils/videoAnalyzer");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function safeUnlink(file) {
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) { console.warn("Cannot delete file:", file, e); }
}

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

    // 1) Extract audio (ffmpeg)
    try {
      console.log("🎧 Extraction audio en cours...");
      await extractAudio(videoPath, audioPath);
      console.log("✅ Audio extrait :", audioPath);
    } catch (err) {
      console.error("⚠️ Échec extraction audio :", err);
      // fallback : continue without audio (will analyze title/description only)
    }

    // 2) Transcription (Whisper) — si audio disponible
    let transcript = "";
    if (fs.existsSync(audioPath)) {
      try {
        console.log("🔁 Transcription en cours...");
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model: "whisper-1",
        });
        transcript = transcription?.text || "";
        console.log("📄 Transcription terminée, length:", (transcript || "").length);
      } catch (err) {
        // Log détaillé et on continue avec fallback
        console.error("❌ Erreur de transcription (OpenAI) :", err?.response?.status || err?.status || err?.message || err);
        // si réponse contient data, affiche pour debug
        if (err?.response?.data) console.error("OpenAI response data:", err.response.data);
        transcript = ""; // fallback -> analyse avec title/description
      }
    } else {
      console.warn("⚠️ Aucun audio trouvé, saut de la transcription.");
      transcript = "";
    }

    // 3) Analyse (toujours appelée — accepte transcript vide)
    let results = { bestPlatform: "Unknown", viralityScore: 0, platformScores: {}, insights: [] };
    try {
      results = analyzeVideo({ title, description, transcript });
    } catch (err) {
      console.error("❌ Erreur lors de l'analyse du transcript :", err);
      // fallback safe values (already set)
    }

    // 4) Cleanup (toujours tenter)
    await Promise.all([safeUnlink(videoPath), safeUnlink(audioPath)]);

    // 5) Retourne un objet JSON constant et complet (frontend ne breakera pas)
    return res.json({
      transcript: transcript || "No transcript available",
      viralityScore: typeof results.viralityScore === "number" ? results.viralityScore : 0,
      bestPlatform: results.bestPlatform || "Unknown",
      platformScores: results.platformScores || {},
      insights: results.insights || [],
    });
  } catch (err) {
    console.error("❌ Erreur inattendue analyse :", err);
    return res.status(500).json({
      transcript: "",
      viralityScore: 0,
      bestPlatform: "Unknown",
      platformScores: {},
      insights: ["Erreur interne pendant l'analyse. Voir logs serveur."],
      error: err?.message || "Internal server error"
    });
  }
};

module.exports = { analyzeVideoHandler };
