// ===== services/StorageService.js =====
const { bucket, FOLDERS, useLocalStorage } = require('../config/storage');
const { supabaseAdmin } = require('../config/database');
const fs = require('fs');
const path = require('path');

class StorageService {
  static async uploadVideo(file, userId, hasConsent = false) {
    try {
      if (!file || !file.buffer) {
        throw new Error('Invalid file data');
      }

      console.log(`📤 Uploading video for user ${userId}, consent: ${hasConsent}, useLocalStorage: ${useLocalStorage}`);

      if (useLocalStorage) {
        return this.uploadToLocal(file, userId, hasConsent);
      } else {
        return this.uploadToGCS(file, userId, hasConsent);
      }
    } catch (error) {
      console.error('Storage service error:', error);
      throw new Error(`Upload service error: ${error.message}`);
    }
  }

  static async uploadToLocal(file, userId, hasConsent) {
    try {
      const folder = hasConsent ? FOLDERS.AI_TRAINING : FOLDERS.ANALYSIS_ONLY;
      const timestamp = Date.now();
      const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${folder}${userId}/${timestamp}-${sanitizedFilename}`;
      
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      const userDir = path.join(uploadsDir, folder, userId);
      
      // Create user directory if it doesn't exist
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      
      const filePath = path.join(uploadsDir, filename);
      
      // Write file to local storage
      fs.writeFileSync(filePath, file.buffer);
      
      console.log(`✅ File uploaded locally: ${filePath}`);
      
      return {
        path: filename,
        publicUrl: `file://${filePath}`,
        size: file.size,
        mimeType: file.mimetype,
        isLocal: true
      };
    } catch (error) {
      console.error('Local upload error:', error);
      throw new Error(`Local upload failed: ${error.message}`);
    }
  }

  static async uploadToGCS(file, userId, hasConsent) {
    try {
      if (!bucket) {
        throw new Error('Google Cloud Storage not configured');
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
              mimeType: file.mimetype,
              isLocal: false
            });
          } catch (verifyError) {
            console.error('Upload verification error:', verifyError);
            reject(new Error('Upload verification failed'));
          }
        });
        
        stream.end(file.buffer);
      });
    } catch (error) {
      console.error('GCS upload error:', error);
      throw new Error(`GCS upload failed: ${error.message}`);
    }
  }

  static async deleteVideo(videoPath) {
    try {
      if (!videoPath) return false;
      
      console.log(`🗑️ Deleting video: ${videoPath}`);
      
      if (useLocalStorage || videoPath.startsWith('file://')) {
        return this.deleteFromLocal(videoPath);
      } else {
        return this.deleteFromGCS(videoPath);
      }
    } catch (error) {
      console.error(`Error deleting video ${videoPath}:`, error);
      return false;
    }
  }

  static async deleteFromLocal(videoPath) {
    try {
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      const filePath = videoPath.startsWith('file://') 
        ? videoPath.replace('file://', '') 
        : path.join(uploadsDir, videoPath);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`✅ Local file deleted: ${filePath}`);
        return true;
      } else {
        console.warn(`⚠️ Local file not found: ${filePath}`);
        return false;
      }
    } catch (error) {
      console.error('Local delete error:', error);
      return false;
    }
  }

  static async deleteFromGCS(videoPath) {
    try {
      if (!bucket) {
        console.warn('⚠️ GCS not configured, cannot delete');
        return false;
      }

      const file = bucket.file(videoPath);
      await file.delete();
      console.log(`✅ GCS file deleted: ${videoPath}`);
      return true;
    } catch (error) {
      console.error('GCS delete error:', error);
      return false;
    }
  }

  static async downloadVideo(videoPath) {
    try {
      if (!videoPath) {
        throw new Error('Video path is required');
      }

      console.log(`📥 Downloading video: ${videoPath}`);
      
      if (useLocalStorage || videoPath.startsWith('file://')) {
        return this.downloadFromLocal(videoPath);
      } else {
        return this.downloadFromGCS(videoPath);
      }
    } catch (error) {
      console.error(`Error downloading video ${videoPath}:`, error);
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  static async downloadFromLocal(videoPath) {
    try {
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      const filePath = videoPath.startsWith('file://') 
        ? videoPath.replace('file://', '') 
        : path.join(uploadsDir, videoPath);
      
      if (!fs.existsSync(filePath)) {
        throw new Error('File not found in local storage');
      }

      const buffer = fs.readFileSync(filePath);
      console.log(`✅ Local file downloaded: ${filePath}`);
      return buffer;
    } catch (error) {
      console.error('Local download error:', error);
      throw new Error(`Local download failed: ${error.message}`);
    }
  }

  static async downloadFromGCS(videoPath) {
    try {
      if (!bucket) {
        throw new Error('Google Cloud Storage not configured');
      }

      const file = bucket.file(videoPath);
      const [exists] = await file.exists();
      
      if (!exists) {
        throw new Error('File not found in storage');
      }

      const [buffer] = await file.download();
      console.log(`✅ GCS file downloaded: ${videoPath}`);
      return buffer;
    } catch (error) {
      console.error('GCS download error:', error);
      throw new Error(`GCS download failed: ${error.message}`);
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

      // Supprimer les fichiers en parallèle avec gestion d'erreurs
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

      // Supprimer les enregistrements de la DB (même si la suppression de fichier a échoué)
      const { error: deleteError } = await supabaseAdmin
        .from('video_analyses')
        .delete()
        .in('id', expiredAnalyses.map(a => a.id));

      if (deleteError) {
        console.error('Error deleting from database:', deleteError);
        throw deleteError;
      }

      console.log(`Successfully cleaned up ${expiredAnalyses.length} expired videos`);
      console.log(`File deletions: ${successfulDeletes.length}/${expiredAnalyses.length} successful`);
      
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
        .select('video_path, created_at, file_size')
        .eq('user_id', userId)
        .not('video_path', 'is', null);

      if (error) throw error;

      const totalSize = userAnalyses.reduce((sum, analysis) => {
        return sum + (analysis.file_size || 0);
      }, 0);

      return {
        totalVideos: userAnalyses.length,
        totalSize: totalSize,
        paths: userAnalyses.map(a => a.video_path),
        storageType: useLocalStorage ? 'local' : 'gcs'
      };
    } catch (error) {
      console.error('Storage stats error:', error);
      throw error;
    }
  }

  // Check storage health
  static async checkStorageHealth() {
    try {
      if (useLocalStorage) {
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        const exists = fs.existsSync(uploadsDir);
        return {
          type: 'local',
          healthy: exists,
          path: uploadsDir,
          writable: exists && fs.constants && fs.access ? await fs.promises.access(uploadsDir, fs.constants.W_OK).then(() => true).catch(() => false) : exists
        };
      } else if (bucket) {
        try {
          await bucket.getMetadata();
          return {
            type: 'gcs',
            healthy: true,
            bucketName: bucket.name
          };
        } catch (error) {
          return {
            type: 'gcs',
            healthy: false,
            error: error.message
          };
        }
      } else {
        return {
          type: 'none',
          healthy: false,
          error: 'No storage configured'
        };
      }
    } catch (error) {
      return {
        type: 'error',
        healthy: false,
        error: error.message
      };
    }
  }
}

module.exports = StorageService;