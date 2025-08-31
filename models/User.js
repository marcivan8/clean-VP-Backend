const { supabaseAdmin } = require('../config/database');

class User {
  static async findById(userId) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
      
    if (error) throw error;
    return data;
  }
  
  static async create(userData) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .insert([{
        ...userData,
        monthly_usage: { analyses: 0 },
        usage_reset_at: new Date().toISOString()
      }])
      .select()
      .single();
      
    if (error) throw error;
    return data;
  }
  
  static async updateUsage(userId) {
    const user = await this.findById(userId);
    const currentUsage = user.monthly_usage || { analyses: 0 };
    
    const newUsage = {
      analyses: currentUsage.analyses + 1
    };
    
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ 
        monthly_usage: newUsage,
        last_analysis_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();
      
    if (error) throw error;
    return data;
  }
  
  static async checkUsageLimits(userId) {
    const user = await this.findById(userId);
    const usage = user.monthly_usage || { analyses: 0 };
    
    // FIXED LIMIT: 20 analyses per month for ALL users
    const MONTHLY_LIMIT = 20;
    
    return {
      canAnalyze: usage.analyses < MONTHLY_LIMIT,
      usage: usage.analyses,
      limit: MONTHLY_LIMIT,
      remaining: Math.max(0, MONTHLY_LIMIT - usage.analyses)
    };
  }
  
  static async getUsage(userId) {
    const user = await this.findById(userId);
    const usage = user.monthly_usage || { analyses: 0 };
    
    return {
      analyses: usage.analyses,
      limit: 20,
      remaining: Math.max(0, 20 - usage.analyses),
      lastAnalysisAt: user.last_analysis_at,
      resetAt: user.usage_reset_at
    };
  }
  
  // Reset monthly usage for all users (run via cron job)
  static async resetAllMonthlyUsage() {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ 
        monthly_usage: { analyses: 0 },
        usage_reset_at: new Date().toISOString()
      })
      .not('id', 'is', null);
      
    if (error) throw error;
    console.log('✅ Monthly usage reset for all users');
    return true;
  }
  
  // Check if user needs reset (if it's been > 30 days)
  static async checkAndResetIfNeeded(userId) {
    const user = await this.findById(userId);
    const resetDate = user.usage_reset_at ? new Date(user.usage_reset_at) : new Date(0);
    const now = new Date();
    const daysSinceReset = (now - resetDate) / (1000 * 60 * 60 * 24);
    
    if (daysSinceReset >= 30) {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ 
          monthly_usage: { analyses: 0 },
          usage_reset_at: now.toISOString()
        })
        .eq('id', userId)
        .select()
        .single();
        
      if (error) throw error;
      console.log(`✅ Usage reset for user ${userId}`);
      return data;
    }
    
    return user;
  }
}

module.exports = User;