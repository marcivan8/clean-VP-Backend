const { Storage } = require('@google-cloud/storage');

let storage;
try {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable is not set');
  }
  
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  
  storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    credentials: credentials
  });
} catch (error) {
  console.error('Error initializing Google Cloud Storage:', error);
  // Optionally, throw or handle gracefully depending on your app needs
  throw error;
}

const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
const bucket = storage.bucket(bucketName);

// Dossiers séparés selon le consentement
const FOLDERS = {
  ANALYSIS_ONLY: 'analysis-only/', // Videos supprimées après 30 jours
  AI_TRAINING: 'ai-training/',     // Videos gardées pour l'IA
  TEMP: 'temp/'                    // Fichiers temporaires
};

module.exports = { storage, bucket, FOLDERS };