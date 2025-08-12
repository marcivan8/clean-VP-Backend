// services/StorageService.js
const { bucket, FOLDERS } = require('../config/storage');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Initialize Supabase Admin client
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Service role key, not anon key
);

class StorageService {
  static async uploadVideo(file, userId, hasConsent = false) {
    const folder = hasConsent ? FOLDERS.AI_TRAINING : FOLDERS.ANALYSIS_ONLY;
    const filename = `${folder}${userId}/${Date.now()}-${file.originalname}`;

    const fileUpload = bucket.file(filename);

    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        metadata: {
          userId: userId,
          hasAIConsent: hasConsent.toString(),
          uploadedAt: new Date().toISOString()
        }
      }
    });

    return new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', () => {
        resolve({
          path: filename,
          publicUrl: `gs://${bucket.name}/${filename}`
        });
      });
      stream.end(file.buffer);
    });
  }

  static async deleteVideo(videoPath) {
    try {
      await bucket.file(videoPath).delete();
      return true;
    } catch (error) {
      console.error('Error deleting video:', error);
      return false;
    }
  }

  static async downloadVideo(videoPath) {
    const [buffer] = await bucket.file(videoPath).download();
    return buffer;
  }

  static async cleanupExpiredVideos() {
    const VideoAnalysis = require('../models/VideoAnalysis');
    const expiredAnalyses = await VideoAnalysis.findExpired();

    // Delete from GCS
    const deletePromises = expiredAnalyses.map(analysis =>
      this.deleteVideo(analysis.video_path)
    );
    await Promise.all(deletePromises);

    // Delete from Supabase table
    const { error } = await supabaseAdmin
      .from('video_analyses')
      .delete()
      .in('id', expiredAnalyses.map(a => a.id));

    if (error) throw error;

    console.log(`Cleaned up ${expiredAnalyses.length} expired videos`);
    return expiredAnalyses.length;
  }
}

module.exports = StorageService;
