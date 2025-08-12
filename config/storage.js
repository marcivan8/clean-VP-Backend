const { Storage } = require('@google-cloud/storage');

const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE, // Chemin vers service account JSON
});

const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
const bucket = storage.bucket(bucketName);

// Dossiers séparés selon le consentement
const FOLDERS = {
  ANALYSIS_ONLY: 'analysis-only/', // Videos supprimées après 30 jours
  AI_TRAINING: 'ai-training/',     // Videos gardées pour l'IA
  TEMP: 'temp/'                    // Fichiers temporaires
};

module.exports = { storage, bucket, FOLDERS };