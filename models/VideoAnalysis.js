const { supabaseAdmin } = require('../config/database');

class VideoAnalysis {
  static async create(analysisData) {
    try {
      // Définir expiration selon le consentement
      const expiresAt = analysisData.ai_training_consent 
        ? null 
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours
      
      const { data, error } = await supabaseAdmin
        .from('video_analyses')
        .insert([{
          ...analysisData,
          expires_at: expiresAt,
          processing_status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
        
      if (error) {
        console.error('VideoAnalysis creation error:', error);
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Error in VideoAnalysis.create:', error);
      throw error;
    }
  }
  
  static async updateResults(analysisId, results) {
    try {
      const { data, error } = await supabaseAdmin
        .from('video_analyses')
        .update({
          analysis_results: results,
          virality_score: results.viralityScore,
          best_platform: results.bestPlatform,
          platform_scores: results.platformScores,
          insights: results.insights,
          processing_status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', analysisId)
        .select()
        .single();
        
      if (error) {
        console.error('VideoAnalysis update error:', error);
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Error in VideoAnalysis.updateResults:', error);
      throw error;
    }
  }

  static async updateStatus(analysisId, status, errorDetails = null) {
    try {
      const updateData = {
        processing_status: status,
        updated_at: new Date().toISOString()
      };

      if (errorDetails) {
        updateData.error_details = errorDetails;
      }

      const { data, error } = await supabaseAdmin
        .from('video_analyses')
        .update(updateData)
        .eq('id', analysisId)
        .select()
        .single();
        
      if (error) {
        console.error('VideoAnalysis status update error:', error);
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Error in VideoAnalysis.updateStatus:', error);
      throw error;
    }
  }
  
  static async findById(analysisId) {
    try {
      if (!analysisId) {
        throw new Error('Analysis ID is required');
      }

      const { data, error } = await supabaseAdmin
        .from('video_analyses')
        .select('*')
        .eq('id', analysisId)
        .single();
        
      if (error) {
        if (error.code === 'PGRST116') { // No rows found
          return null;
        }
        console.error('VideoAnalysis findById error:', error);
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Error in VideoAnalysis.findById:', error);
      throw error;
    }
  }
  
  static async findByUser(userId, limit = 10, offset = 0) {
    try {
      if (!userId) {
        throw new Error('User ID is required');
      }

      const { data, error } = await supabaseAdmin
        .from('video_analyses')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
        
      if (error) {
        console.error('VideoAnalysis findByUser error:', error);
        throw error;
      }
      
      return data || [];
    } catch (error) {
      console.error('Error in VideoAnalysis.findByUser:', error);
      throw error;
    }
  }
  
  static async delete(analysisId) {
    try {
      if (!analysisId) {
        throw new Error('Analysis ID is required');
      }

      const { error } = await supabaseAdmin
        .from('video_analyses')
        .delete()
        .eq('id', analysisId);
        
      if (error) {
        console.error('VideoAnalysis delete error:', error);
        throw error;
      }
      
      return true;
    } catch (error) {
      console.error('Error in VideoAnalysis.delete:', error);
      throw error;
    }
  }
  
  static async findExpired() {
    try {
      const { data, error } = await supabaseAdmin
        .from('video_analyses')
        .select('*')
        .lt('expires_at', new Date().toISOString())
        .not('expires_at', 'is', null);
        
      if (error) {
        console.error('VideoAnalysis findExpired error:', error);
        throw error;
      }
      
      return data || [];
    } catch (error) {
      console.error('Error in VideoAnalysis.findExpired:', error);
      throw error;
    }
  }
}

module.exports = VideoAnalysis;