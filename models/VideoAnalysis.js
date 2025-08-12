const { supabaseAdmin } = require('../config/database');

class VideoAnalysis {
  static async create(analysisData) {
    // Définir expiration selon le consentement
    const expiresAt = analysisData.ai_training_consent 
      ? null 
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours
    
    const { data, error } = await supabaseAdmin
      .from('video_analyses')
      .insert([{
        ...analysisData,
        expires_at: expiresAt,
        processing_status: 'pending'
      }])
      .select()
      .single();
      
    if (error) throw error;
    return data;
  }
  
  static async updateResults(analysisId, results) {
    const { data, error } = await supabaseAdmin
      .from('video_analyses')
      .update({
        analysis_results: results,
        virality_score: results.viralityScore,
        best_platform: results.bestPlatform,
        platform_scores: results.platformScores,
        insights: results.insights,
        processing_status: 'completed'
      })
      .eq('id', analysisId)
      .select()
      .single();
      
    if (error) throw error;
    return data;
  }
  
  static async findByUser(userId, limit = 10) {
    const { data, error } = await supabaseAdmin
      .from('video_analyses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
      
    if (error) throw error;
    return data;
  }
  
  static async findExpired() {
    const { data, error } = await supabaseAdmin
      .from('video_analyses')
      .select('*')
      .lt('expires_at', new Date().toISOString())
      .not('expires_at', 'is', null);
      
    if (error) throw error;
    return data;
  }
}

module.exports = VideoAnalysis;