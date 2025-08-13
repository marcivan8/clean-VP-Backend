// ===== services/StorageService.js =====
const { bucket, FOLDERS } = require('../config/storage');
const { supabaseAdmin } = require('../config/database');

class StorageService {
  static async uploadVideo(file, userId, hasConsent = false) {
    try {
      if (!file || !file.buffer) {
        throw new Error('Invalid file data');
      }

      const folder = hasConsent ? FOLDERS.AI_TRAINING : FOLDERS.ANALYSIS_ONLY;
      const timestamp = Date.now();
      const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${folder}${userId}/${timestamp}-${sanitizedFilename}`;

      const fileUpload = bucket.file(filename);
      const stream = fileUpload.createWriteStream({
        metadata: {
          contentType: file.mimetype,
          metadata: {
            userId: userId,
            hasAIConsent: hasConsent.toString(),
            uploadedAt: new Date().toISOString(),
            originalName: file.originalname
          }
        },
        resumable: false // Pour les petits fichiers
      });

      return new Promise((resolve, reject) => {
        stream.on('error', (error) => {
          console.error('GCS upload error:', error);
          reject(new Error(`File upload failed: ${error.message}`));
        });
        
        stream.on('finish', async () => {
          try {
            // Vérifier que le fichier a bien été uploadé
            const [exists] = await fileUpload.exists();
            if (!exists) {
              throw new Error('File upload verification failed');
            }

            resolve({
              path: filename,
              publicUrl: `gs://${bucket.name}/${filename}`,
              size: file.size,
              mimeType: file.mimetype
            });
          } catch (verifyError) {
            console.error('Upload verification error:', verifyError);
            reject(new Error('Upload verification failed'));
          }
        });
        
        stream.end(file.buffer);
      });
    } catch (error) {
      console.error('Storage service error:', error);
      throw new Error(`Upload service error: ${error.message}`);
    }
  }

  static async deleteVideo(videoPath) {
    try {
      if (!videoPath) return false;
      
      const file = bucket.file(videoPath);
      await file.delete();
      console.log(`Successfully deleted: ${videoPath}`);
      return true;
    } catch (error) {
      console.error(`Error deleting video ${videoPath}:`, error);
      return false;
    }
  }

  static async downloadVideo(videoPath) {
    try {
      if (!videoPath) {
        throw new Error('Video path is required');
      }

      const file = bucket.file(videoPath);
      const [exists] = await file.exists();
      
      if (!exists) {
        throw new Error('File not found in storage');
      }

      const [buffer] = await file.download();
      return buffer;
    } catch (error) {
      console.error(`Error downloading video ${videoPath}:`, error);
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  static async cleanupExpiredVideos() {
    try {
      // Récupérer les analyses expirées depuis Supabase
      const { data: expiredAnalyses, error } = await supabaseAdmin
        .from('video_analyses')
        .select('id, video_path, user_id')
        .lt('expires_at', new Date().toISOString())
        .not('expires_at', 'is', null);

      if (error) {
        console.error('Error fetching expired analyses:', error);
        throw error;
      }

      if (!expiredAnalyses || expiredAnalyses.length === 0) {
        console.log('No expired videos to clean up');
        return 0;
      }

      console.log(`Found ${expiredAnalyses.length} expired videos to clean up`);

      // Supprimer de GCS en parallèle avec gestion d'erreurs
      const deletePromises = expiredAnalyses.map(async (analysis) => {
        try {
          const deleted = await this.deleteVideo(analysis.video_path);
          return { id: analysis.id, deleted, path: analysis.video_path };
        } catch (error) {
          console.warn(`Failed to delete ${analysis.video_path}:`, error);
          return { id: analysis.id, deleted: false, path: analysis.video_path, error: error.message };
        }
      });
      
      const deleteResults = await Promise.allSettled(deletePromises);
      const successfulDeletes = deleteResults
        .filter(result => result.status === 'fulfilled' && result.value.deleted)
        .map(result => result.value.id);

      // Supprimer les enregistrements de la DB (même si GCS a échoué)
      const { error: deleteError } = await supabaseAdmin
        .from('video_analyses')
        .delete()
        .in('id', expiredAnalyses.map(a => a.id));

      if (deleteError) {
        console.error('Error deleting from database:', deleteError);
        throw deleteError;
      }

      console.log(`Successfully cleaned up ${expiredAnalyses.length} expired videos`);
      console.log(`GCS deletions: ${successfulDeletes.length}/${expiredAnalyses.length} successful`);
      
      return expiredAnalyses.length;
    } catch (error) {
      console.error('Cleanup service error:', error);
      throw error;
    }
  }

  // Nouvelle méthode pour obtenir les stats de stockage
  static async getStorageStats(userId) {
    try {
      const { data: userAnalyses, error } = await supabaseAdmin
        .from('video_analyses')
        .select('video_path, created_at')
        .eq('user_id', userId)
        .not('video_path', 'is', null);

      if (error) throw error;

      return {
        totalVideos: userAnalyses.length,
        paths: userAnalyses.map(a => a.video_path)
      };
    } catch (error) {
      console.error('Storage stats error:', error);
      throw error;
    }
  }
}

module.exports = StorageService;