const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Extrait des frames d'une vidéo à intervalles réguliers
 * @param {string} videoPath - Chemin vers la vidéo
 * @param {string} outputDir - Répertoire de sortie pour les frames
 * @param {number} frameCount - Nombre de frames à extraire (défaut: 5)
 * @returns {Promise<string[]>} - Tableau des chemins des frames extraites
 */
function extractFrames(videoPath, outputDir, frameCount = 5) {
  return new Promise((resolve, reject) => {
    // Créer le répertoire de sortie s'il n'existe pas
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const frames = [];
    let frameIndex = 0;

    // Obtenir la durée de la vidéo d'abord
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        return reject(err);
      }

      const duration = metadata.format.duration;
      const interval = duration / (frameCount + 1); // Extraire à intervalles réguliers

      // Extraire les frames
      ffmpeg(videoPath)
        .on("end", () => {
          console.log(`✅ ${frames.length} frames extraites`);
          resolve(frames);
        })
        .on("error", (err) => {
          console.error("❌ Erreur extraction frames:", err);
          reject(err);
        })
        .screenshots({
          timestamps: Array.from({ length: frameCount }, (_, i) => (i + 1) * interval),
          filename: "frame-%03d.png",
          folder: outputDir,
          size: "640x360" // Taille réduite pour traitement plus rapide
        })
        .on("filenames", (filenames) => {
          filenames.forEach((filename) => {
            const framePath = path.join(outputDir, filename);
            if (fs.existsSync(framePath)) {
              frames.push(framePath);
            }
          });
        });
    });
  });
}

/**
 * Extrait une frame à un moment spécifique
 * @param {string} videoPath - Chemin vers la vidéo
 * @param {string} outputPath - Chemin de sortie pour la frame
 * @param {number} timestamp - Timestamp en secondes
 * @returns {Promise<string>} - Chemin de la frame extraite
 */
function extractFrameAtTimestamp(videoPath, outputPath, timestamp) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .output(outputPath)
      .size("640x360")
      .on("end", () => {
        if (fs.existsSync(outputPath)) {
          resolve(outputPath);
        } else {
          reject(new Error("Frame non créée"));
        }
      })
      .on("error", (err) => reject(err))
      .run();
  });
}

module.exports = { extractFrames, extractFrameAtTimestamp };

